/** Options for constructing a {@link CellystialClient}. */
export interface CellystialClientOptions {
  /** API key — starts with `sk_prod_` (live) or `sk_test_` (test). Required. */
  apiKey: string;
  /** API base URL. Defaults to `https://api.cellystial.com`. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds. Defaults to 30000. */
  timeout?: number;
}

/** A template as returned by `listTemplates`. */
export interface Template {
  id: string;
  name: string;
  description: string | null;
  /** Field schema (or sample data as a fallback) describing the dynamic fields. */
  schema: Record<string, unknown> | null;
  createdAt: string;
}

/** Pagination params for `listTemplates`. */
export interface ListTemplatesParams {
  /** 1-based page number. Default 1. */
  page?: number;
  /** Page size. Default 100. */
  limit?: number;
}

/**
 * Per-request email delivery overrides. Only honored when email delivery is
 * enabled on the account, or when `to` is provided.
 *
 * Note: the wire API uses snake_case (`from_name`, `reply_to`); this SDK exposes
 * camelCase and maps at the request boundary.
 */
export interface EmailDelivery {
  to: string;
  subject?: string;
  body?: string;
  fromName?: string;
  replyTo?: string;
}

/** Printing permission for a password-protected PDF. */
export type PdfPrintPermission = 'full' | 'low' | 'none';

/** Modification permission for a password-protected PDF. */
export type PdfModifyPermission = 'all' | 'annotate' | 'form' | 'assembly' | 'none';

/** Permission restrictions applied to a protected PDF. */
export interface PdfPermissions {
  /** Printing permission. Default `full`. */
  printing?: PdfPrintPermission;
  /** Modification permission. Default `all`. */
  modify?: PdfModifyPermission;
  /** Allow copying/extracting text and graphics. Default `true`. */
  extract?: boolean;
}

/**
 * Password protection / AES-256 encryption for the generated PDF.
 *
 * Paid plans only — Free-tier accounts receive a `ForbiddenError` (403).
 *
 * Note: if `ownerPassword` is omitted the server generates a strong random one,
 * so permission restrictions cannot be lifted. Do not set it equal to
 * `userPassword`, or any reader could strip the restrictions. Passwords are
 * never stored — a lost password makes the PDF unrecoverable.
 */
export interface PdfProtection {
  /** Password required to OPEN the PDF. Omit for permissions-only protection. */
  userPassword?: string;
  /** Owner password controlling permissions. Omit to auto-generate a random one. */
  ownerPassword?: string;
  permissions?: PdfPermissions;
}

/** Options for `generatePdf`. */
export interface GeneratePdfOptions {
  emailDelivery?: EmailDelivery;
  /** Override the account storage default for this request. */
  saveToStorage?: boolean;
  /** Password-protect / encrypt the output (paid plans only). */
  protection?: PdfProtection;
}

/**
 * One document in a keyed batch (see `generateBatchItems`). `documentId` is your
 * own stable identifier — echoed back in every status/webhook result and used as
 * the output PDF filename unless `filename` overrides it. Must be unique per batch.
 */
export interface BatchItem {
  /** Your unique id for this document. Echoed back in results; used as the filename. */
  documentId: string;
  /** Optional output filename. Defaults to `documentId`. */
  filename?: string;
  /** Dynamic values injected into the template for this document. */
  data: Record<string, unknown>;
}

/** Result of `generatePdf` — the PDF bytes plus useful response metadata. */
export interface GenerateResult {
  /** The generated PDF. */
  content: Buffer;
  /** Filename parsed from the `Content-Disposition` header. */
  filename: string;
  /** Server-side generation time from `X-API-Duration-MS`, or null if absent. */
  durationMs: number | null;
}

/** Overall status of a batch (see {@link BatchStatus}). */
export type BatchStatusValue = 'queued' | 'processing' | 'completed' | 'failed';

/** Status of a single document within a batch (see {@link BatchResult}). */
export type BatchItemStatusValue = 'pending' | 'processing' | 'completed' | 'failed';

/**
 * Acknowledgement returned when a batch is queued by `generateBatch` /
 * `generateBatchItems`. The batch runs asynchronously — poll
 * `getBatchStatus(batchId)` or set a `webhookUrl` to receive `batch.completed`.
 */
export interface BatchResponse {
  /** The batch id — pass to `getBatchStatus`, or correlate with the webhook. */
  batchId: string;
  /** Always `'queued'` — the batch was accepted for processing. */
  status: 'queued';
  /** Human-readable confirmation (e.g. how many items were enqueued). */
  message: string;
}

/** One document's result within a batch (see {@link BatchStatus}). */
export interface BatchResult {
  /** Zero-based position of this document in the input array. */
  rowIndex: number;
  /** Your `documentId` — present only for the keyed `items[]` shape. */
  documentId?: string;
  /** Output filename (always ends in `.pdf`). */
  filename: string;
  /** This document's status. */
  status: BatchItemStatusValue;
  /** Presigned download URL once generated; `null` until the document completes. */
  downloadUrl: string | null;
  /** Error message — present only when `status` is `'failed'`. */
  error?: string;
}

/** Status of a batch, as returned by `getBatchStatus`. */
export interface BatchStatus {
  /** The batch id. */
  id: string;
  /** Overall batch status. */
  status: BatchStatusValue;
  /** Total number of documents in the batch. */
  total: number;
  /** Number of documents completed so far. */
  completed: number;
  /** Number of documents that failed. */
  failed: number;
  /** Per-document results. */
  results: BatchResult[];
  /** A single ZIP of every PDF — set only for storage-off (ephemeral) accounts. */
  zipUrl?: string;
}

/** Options for `verifyWebhook`. */
export interface VerifyWebhookOptions {
  /** Max allowed age of the signature timestamp, in seconds. Default 300. */
  toleranceSeconds?: number;
  /** Override "now" (unix seconds) — for testing. */
  now?: number;
}

/** An event a webhook subscription can subscribe to. */
export type WebhookEvent =
  | 'pdf.generated'
  | 'batch.completed'
  | 'template.created'
  | 'template.updated'
  | 'template.deleted';

/** A webhook subscription as returned by the webhooks API. */
export interface WebhookSubscription {
  id: string;
  url: string;
  events: WebhookEvent[];
  description: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * A newly-created subscription. Includes the signing `secret`, which is returned
 * ONLY at creation and is never recoverable afterwards — store it immediately.
 */
export interface WebhookSubscriptionWithSecret extends WebhookSubscription {
  /** The `whsec_…` signing secret. Pass it to {@link verifyWebhook}. */
  secret: string;
}

/** Params for `createWebhook`. */
export interface CreateWebhookParams {
  /** The HTTPS endpoint that receives signed event deliveries. */
  url: string;
  /** Events this endpoint subscribes to (at least one). */
  events: WebhookEvent[];
  /** Optional label (e.g. the integration that created it). */
  description?: string;
}

/** Params for `updateWebhook` — every field is optional. */
export interface UpdateWebhookParams {
  url?: string;
  events?: WebhookEvent[];
  active?: boolean;
  description?: string;
}
