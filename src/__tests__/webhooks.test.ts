import * as crypto from 'crypto';
import { verifyWebhook } from '../webhooks';

/** Produces a valid `t=<unix>,v1=<hex>` header for a body (mirrors the server). */
function sign(secret: string, rawBody: string, t: number): string {
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

describe('verifyWebhook', () => {
  const secret = 'whsec_abc';
  const body = JSON.stringify({ event: 'pdf.generated', filename: 'a.pdf' });
  const now = 1_700_000_000;

  it('accepts a valid, fresh signature', () => {
    expect(verifyWebhook(body, sign(secret, body, now), secret, { now })).toBe(true);
  });

  it('verifies a Buffer body identically to a string', () => {
    const header = sign(secret, body, now);
    expect(verifyWebhook(Buffer.from(body, 'utf8'), header, secret, { now })).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(verifyWebhook(body + 'x', sign(secret, body, now), secret, { now })).toBe(false);
  });

  it('rejects the wrong secret', () => {
    expect(verifyWebhook(body, sign(secret, body, now), 'whsec_other', { now })).toBe(false);
  });

  it('rejects a stale timestamp beyond the default tolerance', () => {
    expect(verifyWebhook(body, sign(secret, body, now - 1000), secret, { now })).toBe(false);
  });

  it('accepts a stale timestamp within a custom tolerance', () => {
    expect(verifyWebhook(body, sign(secret, body, now - 1000), secret, { now, toleranceSeconds: 2000 })).toBe(true);
  });

  it('rejects a missing, empty, or malformed header', () => {
    expect(verifyWebhook(body, null, secret, { now })).toBe(false);
    expect(verifyWebhook(body, undefined, secret, { now })).toBe(false);
    expect(verifyWebhook(body, 'garbage', secret, { now })).toBe(false);
    expect(verifyWebhook(body, 't=,v1=', secret, { now })).toBe(false);
  });

  it('rejects when the secret is empty', () => {
    expect(verifyWebhook(body, sign(secret, body, now), '', { now })).toBe(false);
  });
});
