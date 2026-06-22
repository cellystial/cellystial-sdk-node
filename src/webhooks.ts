import * as crypto from 'crypto';
import { VerifyWebhookOptions } from './types';

const DEFAULT_TOLERANCE_SECONDS = 300;

/** Parses a `t=<unix>,v1=<hex>` signature header into its parts. */
function parseSignatureHeader(header: string): { t: number; v1: string } | null {
  const parts: Record<string, string> = {};
  for (const segment of header.split(',')) {
    const idx = segment.indexOf('=');
    if (idx === -1) continue;
    const key = segment.slice(0, idx).trim();
    const value = segment.slice(idx + 1).trim();
    if (key) parts[key] = value;
  }
  const t = Number(parts.t);
  if (!parts.t || !Number.isFinite(t) || !parts.v1) return null;
  return { t, v1: parts.v1 };
}

/** Constant-time hex string comparison; false if lengths differ. */
function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length === 0 || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verifies a Cellystial webhook signature.
 *
 * Recomputes `HMAC_SHA256(secret, "<t>.<rawBody>")` and compares it to the `v1`
 * value in the `X-Cellystial-Signature` header using a constant-time compare,
 * then enforces a timestamp tolerance (default 300s) to bound replay.
 *
 * IMPORTANT: pass the **raw request body** exactly as received (string or
 * Buffer) — never a re-serialized object, or the bytes will differ and
 * verification will fail.
 *
 * @param rawBody          The raw webhook request body.
 * @param signatureHeader  The `X-Cellystial-Signature` header value.
 * @param secret           Your `whsec_…` signing secret.
 * @returns `true` if the signature is valid and fresh, otherwise `false`.
 */
export function verifyWebhook(
  rawBody: string | Buffer,
  signatureHeader: string | null | undefined,
  secret: string,
  options: VerifyWebhookOptions = {},
): boolean {
  if (!signatureHeader || !secret) return false;

  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) return false;

  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.t) > tolerance) return false;

  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${parsed.t}.${body}`)
    .digest('hex');

  return timingSafeEqualHex(expected, parsed.v1);
}
