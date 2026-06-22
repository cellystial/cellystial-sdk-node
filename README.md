# @cellystial/sdk

Official Cellystial SDK for Node.js & TypeScript. Generate PDFs from your templates with a clean,
typed client. Reference implementation — the Python, PHP, and Go SDKs mirror this surface
(see [`docs/sdk_api_surface.md`](../docs/sdk_api_surface.md)).

## Install

```bash
npm install @cellystial/sdk
```

Requires Node.js 18+ (uses the built-in `fetch`). No runtime dependencies.

## Quick start

```ts
import { CellystialClient } from '@cellystial/sdk';
import { writeFileSync } from 'node:fs';

const client = new CellystialClient({ apiKey: process.env.CELLYSTIAL_API_KEY! });

const { content, filename, durationMs } = await client.generatePdf('invoice', {
  customer: 'Acme Corp',
  total: 42.0,
});

writeFileSync(filename, content);
console.log(`Generated ${filename} in ${durationMs}ms`);
```

Keys start with `sk_prod_` (live) or `sk_test_` (test — watermarked, email restricted to the owner).

## API

| Method | Description |
|--------|-------------|
| `listTemplates({ page?, limit? })` | List templates available to your account. |
| `generatePdf(templateId, data, options?)` | Generate a PDF. Returns `{ content, filename, durationMs }`. |
| `generateBatch(templateId, data[], { webhookUrl? })` | Queue a bulk batch — positional; outputs map back by array index (async). |
| `generateBatchItems(templateId, items[], { webhookUrl? })` | Queue a bulk batch — keyed by your own `documentId` (async). |
| `getBatchStatus(batchId)` | Check a batch's status; returns per-document `results[]`. |
| `createWebhook({ url, events, description? })` | Register a webhook subscription. Returns it incl. the `secret` (shown once). |
| `listWebhooks()` / `getWebhook(id)` | List or fetch your webhook subscriptions. |
| `updateWebhook(id, { url?, events?, active?, description? })` | Update a subscription. |
| `deleteWebhook(id)` | Delete a subscription. |
| `verifyWebhook(rawBody, header, secret, opts?)` | Verify a webhook signature (any event). |

### Bulk / batch generation

Both shapes are async — poll `getBatchStatus(batchId)` or set a `webhookUrl` to receive the results.

```ts
// Keyed (recommended): your own documentId per document. It's echoed back in every
// result and becomes the PDF filename (override per item with `filename`).
const { batchId } = await client.generateBatchItems('invoice', [
  { documentId: 'INV-1042', data: { customer: 'Jane', amount: '$500' } },
  { documentId: 'INV-1043', filename: 'acme-oct.pdf', data: { customer: 'Acme', amount: '$750' } },
]);

// Positional: a plain array; outputs map back by index (row-0, row-1, …).
await client.generateBatch('invoice', [{ customer: 'Jane' }, { customer: 'Acme' }]);

const status = await client.getBatchStatus(batchId);
// status.results → [{ rowIndex, documentId, filename, status, downloadUrl, error? }]
// status.zipUrl  → set for storage-off accounts (one ZIP of every PDF)
```

### Email delivery & storage overrides

```ts
await client.generatePdf('invoice', data, {
  emailDelivery: { to: 'client@acme.com', subject: 'Your invoice', fromName: 'Acme Billing' },
  saveToStorage: true,
});
```

### Password protection (paid plans)

Encrypt the output with AES-256. Omit `ownerPassword` and the server mints a random one — never set it
equal to `userPassword`, or any reader could strip the restrictions. Passwords are never stored, and
Free-tier accounts get a `ForbiddenError`.

```ts
import { ForbiddenError } from '@cellystial/sdk';

try {
  const { content } = await client.generatePdf('invoice', data, {
    protection: {
      userPassword: 's3cret',                            // required to open the PDF
      permissions: { printing: 'low', extract: false },  // allow low-res print, block copy/extract
    },
  });
} catch (err) {
  if (err instanceof ForbiddenError) console.error('Upgrade required:', err.message);
  else throw err;
}
```

### Managing webhook subscriptions

Register endpoints that receive signed deliveries for the events you choose — `pdf.generated`,
`batch.completed`, `template.created`, `template.updated`, `template.deleted`. Each subscription
gets its own signing secret, returned **once** at creation.

```ts
const sub = await client.createWebhook({
  url: 'https://hooks.example.com/cellystial',
  events: ['pdf.generated', 'batch.completed'],
  description: 'My integration',
});
console.log(sub.secret); // whsec_… — store it now; it is never shown again

await client.listWebhooks();
await client.updateWebhook(sub.id, { active: false });
await client.deleteWebhook(sub.id);
```

### Verifying webhooks

Cellystial signs every webhook with `X-Cellystial-Signature: t=<unix>,v1=<hmac>`. Verify it against
the **raw** request body (not a re-parsed object) using your `whsec_…` secret (reveal/rotate it in your
dashboard settings):

```ts
import { verifyWebhook } from '@cellystial/sdk';

// Express example — capture the raw body, e.g. express.json({ verify: (req, _res, buf) => { req.rawBody = buf } })
app.post('/webhooks/cellystial', (req, res) => {
  const ok = verifyWebhook(req.rawBody, req.header('X-Cellystial-Signature'), process.env.CELLYSTIAL_WEBHOOK_SECRET!);
  if (!ok) return res.status(400).send('invalid signature');

  const { event, filename, base64 } = JSON.parse(req.rawBody.toString('utf8'));
  // … persist the PDF (Buffer.from(base64, 'base64')) …
  res.sendStatus(200);
});
```

## Errors

All failures throw a subclass of `CellystialError` carrying `statusCode`, `message`, and `messages[]`:

`ValidationError` (400) · `AuthenticationError` (401) · `QuotaExceededError` (402) ·
`ForbiddenError` (403) · `NotFoundError` (404) · `RateLimitError` (429) · `ApiError` (5xx/other) ·
`ConnectionError` (transport).

```ts
import { QuotaExceededError } from '@cellystial/sdk';

try {
  await client.generatePdf('invoice', data);
} catch (err) {
  if (err instanceof QuotaExceededError) console.error('Out of credits:', err.message);
  else throw err;
}
```
