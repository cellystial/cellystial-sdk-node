import { ConnectionError, errorFromStatus, parseRetryAfter } from './errors';
import {
  BatchItem,
  BatchResponse,
  BatchStatus,
  CellystialClientOptions,
  CreateWebhookParams,
  GeneratePdfOptions,
  GenerateResult,
  ListTemplatesParams,
  Template,
  UpdateWebhookParams,
  WebhookSubscription,
  WebhookSubscriptionWithSecret,
} from './types';

const DEFAULT_BASE_URL = 'https://api.cellystial.com';
const DEFAULT_TIMEOUT_MS = 30000;
const API_PREFIX = '/api/v1';

/** Normalizes a NestJS `message` (string | string[]) into [primary, all]. */
function normalizeMessages(body: unknown, fallback: string): { message: string; messages: string[] } {
  const raw = (body as { message?: unknown } | null)?.message;
  if (Array.isArray(raw)) {
    const messages = raw.map(String);
    return { message: messages.join(', '), messages };
  }
  if (typeof raw === 'string' && raw) {
    return { message: raw, messages: [raw] };
  }
  return { message: fallback, messages: [fallback] };
}

/** Parses the `filename` out of a Content-Disposition header. */
function parseFilename(disposition: string | null): string {
  if (!disposition) return 'document.pdf';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return match ? decodeURIComponent(match[1]) : 'document.pdf';
}

/**
 * Client for the Cellystial API.
 *
 * ```ts
 * const client = new CellystialClient({ apiKey: process.env.CELLYSTIAL_API_KEY! });
 * const { content } = await client.generatePdf('invoice', { total: 42 });
 * fs.writeFileSync('out.pdf', content);
 * ```
 */
export class CellystialClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(options: CellystialClientOptions) {
    if (!options || !options.apiKey) {
      throw new Error('CellystialClient requires an `apiKey`.');
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;
  }

  /** Lists templates available to this account. */
  async listTemplates(params: ListTemplatesParams = {}): Promise<Template[]> {
    const query = new URLSearchParams();
    if (params.page != null) query.set('page', String(params.page));
    if (params.limit != null) query.set('limit', String(params.limit));
    const qs = query.toString();
    const res = await this.request('GET', `/integration/templates${qs ? `?${qs}` : ''}`);
    return (await this.parseJson(res)) as Template[];
  }

  /** Generates a PDF from a template, returning the bytes + metadata. */
  async generatePdf(
    templateId: string,
    data: Record<string, unknown>,
    options: GeneratePdfOptions = {},
  ): Promise<GenerateResult> {
    const body: Record<string, unknown> = { templateId, data };
    if (options.emailDelivery) {
      const e = options.emailDelivery;
      body.emailDelivery = {
        to: e.to,
        ...(e.subject !== undefined && { subject: e.subject }),
        ...(e.body !== undefined && { body: e.body }),
        ...(e.fromName !== undefined && { from_name: e.fromName }),
        ...(e.replyTo !== undefined && { reply_to: e.replyTo }),
      };
    }
    if (options.saveToStorage !== undefined) body.saveToStorage = options.saveToStorage;
    // protection field names are camelCase and map 1:1 to the wire — pass through.
    if (options.protection) body.protection = options.protection;

    const res = await this.request('POST', '/generate', body, 'application/pdf');
    const content = Buffer.from(await res.arrayBuffer());
    const durationHeader = res.headers.get('x-api-duration-ms');
    return {
      content,
      filename: parseFilename(res.headers.get('content-disposition')),
      durationMs: durationHeader != null ? Number(durationHeader) : null,
    };
  }

  /**
   * Queues a bulk batch of PDFs for asynchronous generation (positional shape).
   * Each output maps back to its input by array index (`row-0`, `row-1`, …).
   * Prefer {@link generateBatchItems} when you want to map outputs to your own ids.
   */
  async generateBatch(
    templateId: string,
    data: Array<Record<string, unknown>>,
    options: { webhookUrl?: string } = {},
  ): Promise<BatchResponse> {
    const body: Record<string, unknown> = { templateId, data };
    if (options.webhookUrl) body.webhookUrl = options.webhookUrl;
    const res = await this.request('POST', '/generate/batch', body);
    return (await this.parseJson(res)) as BatchResponse;
  }

  /**
   * Queues a bulk batch using the keyed `items` shape — each document carries your
   * own `documentId` (echoed back in every result and used as the output filename
   * unless `filename` overrides it). Use this over {@link generateBatch} when you
   * need to map each generated PDF back to your own records. `documentId` must be
   * unique within the batch.
   */
  async generateBatchItems(
    templateId: string,
    items: BatchItem[],
    options: { webhookUrl?: string } = {},
  ): Promise<BatchResponse> {
    const body: Record<string, unknown> = { templateId, items };
    if (options.webhookUrl) body.webhookUrl = options.webhookUrl;
    const res = await this.request('POST', '/generate/batch', body);
    return (await this.parseJson(res)) as BatchResponse;
  }

  /** Fetches the status of a previously queued batch. */
  async getBatchStatus(batchId: string): Promise<BatchStatus> {
    const res = await this.request('GET', `/generate/batch/${encodeURIComponent(batchId)}`);
    return (await this.parseJson(res)) as BatchStatus;
  }

  // ── Webhooks ────────────────────────────────────────────────────────────────

  /**
   * Registers a webhook subscription that receives signed deliveries for the
   * given events. The returned `secret` is shown ONLY here — store it and pass
   * it to {@link verifyWebhook}.
   */
  async createWebhook(params: CreateWebhookParams): Promise<WebhookSubscriptionWithSecret> {
    const body: Record<string, unknown> = { url: params.url, events: params.events };
    if (params.description !== undefined) body.description = params.description;
    const res = await this.request('POST', '/webhooks', body);
    return (await this.parseJson(res)) as WebhookSubscriptionWithSecret;
  }

  /** Lists this account's webhook subscriptions (secrets are never returned). */
  async listWebhooks(): Promise<WebhookSubscription[]> {
    const res = await this.request('GET', '/webhooks');
    return (await this.parseJson(res)) as WebhookSubscription[];
  }

  /** Fetches a single webhook subscription by id. */
  async getWebhook(id: string): Promise<WebhookSubscription> {
    const res = await this.request('GET', `/webhooks/${encodeURIComponent(id)}`);
    return (await this.parseJson(res)) as WebhookSubscription;
  }

  /** Updates a webhook subscription (any of url / events / active / description). */
  async updateWebhook(id: string, params: UpdateWebhookParams): Promise<WebhookSubscription> {
    const res = await this.request('PATCH', `/webhooks/${encodeURIComponent(id)}`, { ...params });
    return (await this.parseJson(res)) as WebhookSubscription;
  }

  /** Deletes a webhook subscription. */
  async deleteWebhook(id: string): Promise<void> {
    await this.request('DELETE', `/webhooks/${encodeURIComponent(id)}`);
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private async request(
    method: string,
    path: string,
    body?: unknown,
    accept = 'application/json',
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${API_PREFIX}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: accept,
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new ConnectionError(`Request to ${path} failed: ${reason}`, err);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) await this.throwForResponse(res);
    return res;
  }

  /** Reads + parses an error response (always JSON) and throws the typed error. */
  private async throwForResponse(res: Response): Promise<never> {
    let parsed: unknown = null;
    try {
      const text = await res.text();
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // Non-JSON error body — fall through to the status-only fallback.
    }
    const { message, messages } = normalizeMessages(parsed, `Request failed with status ${res.status}`);
    const retryAfter = res.status === 429 ? parseRetryAfter(res.headers.get('retry-after')) : null;
    throw errorFromStatus(res.status, message, messages, parsed, retryAfter);
  }

  private async parseJson(res: Response): Promise<unknown> {
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
}
