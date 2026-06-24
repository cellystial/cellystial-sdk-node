/* eslint-disable no-console */
/**
 * SDK smoke test — exercises every public method of cellystial-sdk against a
 * live API. Run against the LOCAL build:
 *
 *   npm run build
 *   CELLYSTIAL_API_KEY=sk_test_xxx node scripts/smoke.js
 *
 * Env:
 *   CELLYSTIAL_API_KEY     (required)  sk_test_… recommended (bypasses credit limits, no real billing)
 *   CELLYSTIAL_BASE_URL    (optional)  defaults to https://api.cellystial.com
 *   CELLYSTIAL_TEMPLATE_ID (optional)  defaults to the first template from listTemplates()
 *   CELLYSTIAL_DATA_JSON   (optional)  JSON object of template variables (defaults to {})
 *   SMOKE_EMAIL_TO         (optional)  if set, tests emailDelivery (SENDS A REAL EMAIL)
 *   SMOKE_SAVE_STORAGE     (optional)  '1' to test saveToStorage (writes to R2)
 *   SMOKE_WEBHOOK_URL      (optional)  URL used for webhook CRUD (default https://example.com/cellystial-webhook)
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { CellystialClient, verifyWebhook, ForbiddenError, ValidationError } = require('../dist');

const API_KEY = process.env.CELLYSTIAL_API_KEY;
const BASE_URL = process.env.CELLYSTIAL_BASE_URL || 'https://api.cellystial.com';
const DATA = process.env.CELLYSTIAL_DATA_JSON ? JSON.parse(process.env.CELLYSTIAL_DATA_JSON) : {};
const WEBHOOK_URL = process.env.SMOKE_WEBHOOK_URL || 'https://example.com/cellystial-webhook';

if (!API_KEY) {
  console.error('✗ CELLYSTIAL_API_KEY is required.');
  process.exit(2);
}

const client = new CellystialClient({ apiKey: API_KEY, baseUrl: BASE_URL });
const results = [];

async function step(name, fn, { optional = false } = {}) {
  const t0 = Date.now();
  try {
    const detail = await fn();
    const ms = Date.now() - t0;
    console.log(`✓ ${name}${detail ? ` — ${detail}` : ''} (${ms}ms)`);
    results.push({ name, ok: true });
  } catch (err) {
    const ms = Date.now() - t0;
    const msg = err && err.messages ? err.messages.join('; ') : err && err.message;
    console.log(`${optional ? '⚠' : '✗'} ${name} — ${err && err.constructor && err.constructor.name}: ${msg} (${ms}ms)`);
    results.push({ name, ok: false, optional });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

(async () => {
  console.log(`\nCellystial SDK smoke test → ${BASE_URL}\n${'─'.repeat(48)}`);

  // 1. listTemplates — also resolves a template id to use downstream.
  let templateId = process.env.CELLYSTIAL_TEMPLATE_ID || '';
  await step('listTemplates', async () => {
    const templates = await client.listTemplates({ limit: 50 });
    assert(Array.isArray(templates), 'expected an array');
    if (!templateId && templates.length) templateId = templates[0].id;
    return `${templates.length} template(s); using "${templateId || '(none)'}"`;
  });

  if (!templateId) {
    console.log('\n✗ No template id available (account has no templates and CELLYSTIAL_TEMPLATE_ID unset). Stopping generate tests.');
  } else {
    // 2. generatePdf — basic. Writes the PDF locally and checks the magic bytes.
    await step('generatePdf (basic)', async () => {
      const { content, filename, durationMs } = await client.generatePdf(templateId, DATA);
      assert(Buffer.isBuffer(content), 'content is not a Buffer');
      assert(content.slice(0, 5).toString() === '%PDF-', 'output is not a PDF (missing %PDF- header)');
      const out = path.join(require('os').tmpdir(), 'cellystial-smoke.pdf');
      fs.writeFileSync(out, content);
      return `${content.length}B → ${out}, filename="${filename}", durationMs=${durationMs}`;
    });

    // 3. generatePdf — password protection (paid-gated). ForbiddenError is an EXPECTED
    //    pass on Free tier; a real PDF is an expected pass on paid tiers.
    await step('generatePdf (protection)', async () => {
      try {
        const { content } = await client.generatePdf(templateId, DATA, {
          protection: { userPassword: 's3cret', permissions: { printing: 'low', extract: false } },
        });
        assert(Buffer.isBuffer(content) && content.length > 0, 'no protected PDF returned');
        return 'paid tier: encrypted PDF returned';
      } catch (err) {
        if (err instanceof ForbiddenError) return 'Free tier: correctly blocked with ForbiddenError';
        throw err;
      }
    });

    // 4. generatePdf — email delivery (opt-in; SENDS A REAL EMAIL).
    if (process.env.SMOKE_EMAIL_TO) {
      await step('generatePdf (emailDelivery)', async () => {
        await client.generatePdf(templateId, DATA, {
          emailDelivery: { to: process.env.SMOKE_EMAIL_TO, subject: 'Cellystial SDK smoke test' },
        });
        return `email queued to ${process.env.SMOKE_EMAIL_TO}`;
      }, { optional: true });
    }

    // 5. generatePdf — saveToStorage (opt-in; writes to R2).
    if (process.env.SMOKE_SAVE_STORAGE === '1') {
      await step('generatePdf (saveToStorage)', async () => {
        await client.generatePdf(templateId, DATA, { saveToStorage: true });
        return 'saved to storage';
      }, { optional: true });
    }

    // 6. generateBatch — positional shape (maps by index).
    let batchId;
    await step('generateBatch (positional)', async () => {
      const res = await client.generateBatch(templateId, [DATA, DATA]);
      batchId = res.batchId || res.id;
      return `batchId=${batchId}, keys=${Object.keys(res).join(',')}`;
    });

    // 7. getBatchStatus — poll the batch from step 6 a few times.
    if (batchId) {
      await step('getBatchStatus', async () => {
        let status;
        for (let i = 0; i < 5; i++) {
          status = await client.getBatchStatus(batchId);
          if (['completed', 'failed', 'partial'].includes(String(status.status))) break;
          await new Promise((r) => setTimeout(r, 1500));
        }
        return `status=${status.status}, completed=${status.completed}, failed=${status.failed}`;
      });
    }

    // 8. generateBatchItems — keyed shape (maps by your documentId).
    await step('generateBatchItems (keyed)', async () => {
      const res = await client.generateBatchItems(templateId, [
        { documentId: 'smoke-1', data: DATA },
        { documentId: 'smoke-2', data: DATA, filename: 'second.pdf' },
      ]);
      return `batchId=${res.batchId || res.id}`;
    });
  }

  // 9. Webhook CRUD — create → list → get → update → delete (always cleans up).
  let webhookId;
  await step('createWebhook', async () => {
    const sub = await client.createWebhook({
      url: WEBHOOK_URL,
      events: ['template.created', 'template.updated'],
      description: 'sdk-smoke',
    });
    webhookId = sub.id;
    assert(typeof sub.secret === 'string' && sub.secret.startsWith('whsec_'), 'create did not return a whsec_ secret');
    return `id=${webhookId}, secret=whsec_…(${sub.secret.length} chars, shown once)`;
  });
  if (webhookId) {
    await step('listWebhooks', async () => {
      const list = await client.listWebhooks();
      assert(list.some((w) => w.id === webhookId), 'created webhook not present in list');
      return `${list.length} subscription(s)`;
    });
    await step('getWebhook', async () => {
      const w = await client.getWebhook(webhookId);
      assert(w.id === webhookId, 'id mismatch');
      assert(w.secret === undefined, 'secret should NOT be returned on get');
      return `events=${(w.events || []).join(',')}`;
    });
    await step('updateWebhook', async () => {
      const w = await client.updateWebhook(webhookId, { description: 'sdk-smoke-updated', active: false });
      return `description="${w.description}", active=${w.active}`;
    });
    await step('deleteWebhook', async () => {
      await client.deleteWebhook(webhookId);
      return 'deleted (cleaned up)';
    });
  }

  // 10. verifyWebhook — fully local; signs with a known secret and checks accept/reject.
  await step('verifyWebhook (local)', async () => {
    const secret = 'whsec_smoke';
    const body = JSON.stringify({ event: 'template.created', id: 'tmpl_1' });
    const t = Math.floor(Date.now() / 1000);
    const v1 = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    const header = `t=${t},v1=${v1}`;
    assert(verifyWebhook(body, header, secret) === true, 'valid signature rejected');
    assert(verifyWebhook(body + 'x', header, secret) === false, 'tampered body accepted');
    assert(verifyWebhook(body, header, 'whsec_wrong') === false, 'wrong secret accepted');
    const staleV1 = crypto.createHmac('sha256', secret).update(`${t - 3600}.${body}`).digest('hex');
    assert(verifyWebhook(body, `t=${t - 3600},v1=${staleV1}`, secret) === false, 'stale timestamp accepted');
    return 'accept/tamper/wrong-secret/replay all correct';
  });

  // ── summary ──
  const required = results.filter((r) => !r.optional);
  const failed = required.filter((r) => !r.ok);
  console.log(`${'─'.repeat(48)}\n${required.length - failed.length}/${required.length} required checks passed${failed.length ? `; FAILED: ${failed.map((f) => f.name).join(', ')}` : ''}`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error('\n✗ Fatal:', err);
  process.exit(1);
});
