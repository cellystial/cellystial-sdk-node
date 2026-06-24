/**
 * Typed errors for the Cellystial SDK.
 *
 * The API returns NestJS-style error bodies: `{ statusCode, message, error }`,
 * where `message` is sometimes a string and sometimes a string[] (validation).
 * Every error normalizes that into a single `message` plus the raw `messages`.
 */

export class CellystialError extends Error {
  /** HTTP status code, or 0 for network/transport errors. */
  readonly statusCode: number;
  /** All server-provided messages (validation errors can have several). */
  readonly messages: string[];
  /** The raw parsed response body, when available. */
  readonly raw: unknown;

  constructor(message: string, statusCode: number, messages?: string[], raw?: unknown) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.messages = messages && messages.length ? messages : [message];
    this.raw = raw;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** 400 — invalid payload (bad JSON, missing templateId, malformed batch, …). */
export class ValidationError extends CellystialError {}

/** 401 — missing or invalid API key. */
export class AuthenticationError extends CellystialError {}

/** 402 — monthly credit limit reached. */
export class QuotaExceededError extends CellystialError {}

/** 403 — the account's plan does not allow this feature (e.g. PDF protection). */
export class ForbiddenError extends CellystialError {}

/** 404 — unknown template or batch id. */
export class NotFoundError extends CellystialError {}

/** 429 — rate / throughput limit hit. */
export class RateLimitError extends CellystialError {
  /**
   * Seconds to wait before retrying, parsed from the `Retry-After` response
   * header. `null` when the server did not send one.
   */
  readonly retryAfter: number | null;

  constructor(
    message: string,
    statusCode: number,
    messages?: string[],
    raw?: unknown,
    retryAfter?: number | null,
  ) {
    super(message, statusCode, messages, raw);
    this.retryAfter = retryAfter ?? null;
  }
}

/** 5xx and any other non-2xx not covered above. */
export class ApiError extends CellystialError {}

/** Raised by the network layer (timeout, DNS, connection reset). */
export class ConnectionError extends CellystialError {
  constructor(message: string, raw?: unknown) {
    super(message, 0, [message], raw);
  }
}

/**
 * Parses a `Retry-After` header into a number of seconds. Handles both forms:
 * a delta in seconds (`"120"`) and an HTTP-date (`"Wed, 21 Oct 2026 07:28:00 GMT"`).
 * Returns `null` when absent or unparseable; never returns a negative value.
 */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds));
  const at = Date.parse(value);
  if (!Number.isNaN(at)) return Math.max(0, Math.round((at - now) / 1000));
  return null;
}

/**
 * Maps an HTTP status + normalized message to the right typed error.
 * Used internally by the client; exported for advanced consumers.
 */
export function errorFromStatus(
  statusCode: number,
  message: string,
  messages: string[],
  raw: unknown,
  retryAfter: number | null = null,
): CellystialError {
  switch (statusCode) {
    case 400:
      return new ValidationError(message, statusCode, messages, raw);
    case 401:
      return new AuthenticationError(message, statusCode, messages, raw);
    case 402:
      return new QuotaExceededError(message, statusCode, messages, raw);
    case 403:
      return new ForbiddenError(message, statusCode, messages, raw);
    case 404:
      return new NotFoundError(message, statusCode, messages, raw);
    case 429:
      return new RateLimitError(message, statusCode, messages, raw, retryAfter);
    default:
      return new ApiError(message, statusCode, messages, raw);
  }
}
