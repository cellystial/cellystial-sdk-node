# Cellystial SDK — Shared API Surface

**Status:** Draft v1 · **Owner:** Platform
**Purpose:** One contract that every official SDK (`cellystial-sdk-node`, `-python`, `-php`, `-go`) and any
auto-generator (Stainless / Speakeasy / OpenAPI Generator) mirrors, so the four clients never drift.

Every fact in this doc is grounded in the live backend, not invented. Source references are inline.

---

## 1. Scope

This is the **public, key-authenticated** surface only — the same routes exposed in the Scalar product
docs (template discovery + PDF generation). Account, internal, billing, and reporting routes are
**out of scope** for the SDK and must not be added.

In scope for SDK v1:

| Capability        | Method (canonical)   | Endpoint                                | Status |
|-------------------|----------------------|-----------------------------------------|--------|
| List templates    | `listTemplates`      | `GET  /integration/templates`           | ✅ ship |
| Generate a PDF    | `generatePdf`        | `POST /generate`                        | ✅ ship |
| Generate in bulk (positional) | `generateBatch`      | `POST /generate/batch`             | ✅ ship |
| Generate in bulk (keyed)      | `generateBatchItems` | `POST /generate/batch`             | ✅ ship |
| Check batch status            | `getBatchStatus`     | `GET  /generate/batch/{batchId}`   | ✅ ship |
| Verify a webhook  | `verifyWebhook`      | (client-side only)                      | ✅ ship — backend now signs, see §7 |

---

## 2. Conventions

- **Base URL:** `https://api.cellystial.com`
- **Global prefix:** every path is prefixed with `/api/v1` (`main.ts` → `setGlobalPrefix('api/v1')`).
  So the full generate URL is `https://api.cellystial.com/api/v1/generate`.
- **Auth:** `Authorization: Bearer <apiKey>` on every request.
  Keys start with `sk_prod_` (live) or `sk_test_` (test). Test keys are not a separate flag —
  the server detects the prefix and applies a `TEST_MODE` watermark + restricts email to the account owner.
- **Encoding:** requests send `Content-Type: application/json`. `generatePdf` sends `Accept: application/pdf`.
- **Versioning:** the `v1` in the prefix is the API version. SDK semver is independent of it.

### Client construction (canonical shape)

```
CellystialClient({
  apiKey:   string,          // required
  baseUrl?: string,          // default "https://api.cellystial.com"; override for self-host/testing
  timeout?: number,          // ms; default 30000
})
```

Each language uses its own idiom for options (see §6), but the field names and defaults are identical.

---

## 3. Methods

### 3.1 `listTemplates(params?) → Template[]`

`GET /integration/templates?page={page}&limit={limit}`
Source: `ApiController.getTemplates` (`templates/api.controller.ts`).

- **Params (all optional):** `page` (default `1`), `limit` (default `100`).
- **Returns:** a bare JSON array (not wrapped) of:

```
Template {
  id:          string
  name:        string
  description: string | null
  schema:      object | null     // field schema (or sampleData fallback) for dynamic data
  createdAt:   string            // ISO timestamp
}
```

### 3.2 `generatePdf(templateId, data, options?) → GenerateResult`

`POST /generate` → `200` with a binary PDF body.
Source: `ApiController.generatePdf` + `GeneratePdfDto`.

- **Request body:**

```
{
  templateId: string,            // ID or slug
  data:       object,            // dynamic values injected into the template
  emailDelivery?: {              // only honored if account email delivery is on, or "to" is set
    to:         string,          // required within emailDelivery
    subject?:   string,
    body?:      string,
    from_name?: string,
    reply_to?:  string
  },
  saveToStorage?: boolean,       // per-request override of the account storage default
  protection?: {                 // password protection / AES-256 encryption — PAID PLANS ONLY (403 on Free)
    userPassword?: string,       // password to OPEN the PDF; omit for permissions-only protection
    ownerPassword?: string,      // permissions password; omit → server auto-generates a random one
    permissions?: {
      printing?: 'full' | 'low' | 'none',                          // default 'full'
      modify?:   'all' | 'annotate' | 'form' | 'assembly' | 'none', // default 'all'
      extract?:  boolean         // allow copy/extract; default true
    }
  }
}
```

  > Wire-field casing differs by object: `emailDelivery` uses **snake_case** (`from_name` / `reply_to`)
  > while `protection` uses **camelCase** (`userPassword` / `ownerPassword`). camelCase-language SDKs map
  > the email fields at the boundary; `protection` passes through unchanged.
  >
  > **Owner-password rule:** never set `ownerPassword` equal to `userPassword` — any reader could then
  > lift the permission restrictions. Omit it and the server mints a random one. Passwords are never
  > stored; a lost `userPassword` makes the PDF unrecoverable.

- **Response:** raw PDF bytes. Useful response headers the SDK should surface:
  - `Content-Disposition: attachment; filename="<template name>.pdf"`
  - `Content-Length`
  - `X-API-Duration-MS` — server-side generation time
- **Returns** a small result object so callers get bytes + metadata without re-parsing headers:

```
GenerateResult {
  content:    bytes             // the PDF (Buffer / bytes / []byte / string)
  filename:   string           // parsed from Content-Disposition
  durationMs: number | null    // parsed from X-API-Duration-MS
}
```

### 3.3 `generateBatch(templateId, dataArray, options?)` · `generateBatchItems(templateId, items, options?) → BatchQueued`

`POST /generate/batch` → `202`.
Source: `ApiController.generatePdfBatch`.

Two request shapes — send **exactly one** (the server 400s on both or neither):

- **Positional — `generateBatch`:** `{ templateId: string, data: object[], webhookUrl?: string }`.
  Outputs map back to inputs by array index (`row-0.pdf`, `row-1.pdf`, …).
- **Keyed — `generateBatchItems`:** `{ templateId: string, items: BatchItem[], webhookUrl?: string }`.
  Each item carries a caller-owned `documentId`, echoed back in every result and used as the output
  filename unless `filename` overrides it. `documentId` MUST be unique within the batch.

```
BatchItem {
  documentId: string            // your unique id; echoed back in results, used as the filename
  filename?:  string            // optional output filename; defaults to documentId
  data:       object            // dynamic values injected into the template for this document
}
```

  > Expose `generateBatchItems` as a **sibling** of `generateBatch` (not an overload) so the surface
  > stays identical across all four languages — Go has no overloads/optional args. Wire key is
  > `documentId`; idiomatic casing varies (`documentId` / `document_id` / `DocumentID`), mapped at the
  > boundary. SDKs MAY also accept a plain object/dict already in wire shape.

- **Returns:** the queue result object (`BatchQueued`) — at minimum a batch identifier (`batchId`).
  The SDK returns it as-is/typed; the field used by `getBatchStatus` is the batch id.

### 3.4 `getBatchStatus(batchId) → BatchStatus`

`GET /generate/batch/{batchId}` → `200`.
Source: `ApiController.getBatchStatus`. Returns the batch's current status, with one result per
document, ordered by input position:

```
BatchStatus {
  id:        string
  status:    "queued" | "processing" | "completed" | "failed"
  total:     number
  completed: number
  failed:    number
  results: Array<{
    rowIndex:    number          // 0-based input position
    documentId?: string          // present only for the keyed (items) shape
    filename:    string          // resolved output filename
    status:      "pending" | "processing" | "completed" | "failed"
    downloadUrl: string | null   // freshly signed; null until the item completes
    error?:      string          // present only when status is "failed"
  }>
  zipUrl?: string                // storage-off (ephemeral) accounts only — one ZIP of every PDF
}
```

Today all four SDKs return this parsed object as-is (generic map/dict); typing it is optional.

---

## 4. Error model

The API uses standard NestJS error responses: a JSON body

```
{ statusCode: number, message: string | string[], error: string }
```

`message` is **sometimes an array** (validation errors). Every SDK MUST normalize this: expose a single
`message` string (array joined with `", "`) and also keep the raw list.

Canonical typed exceptions — same names/semantics in every SDK (idiomatic casing per language):

| HTTP status | Exception class        | Meaning / trigger                                              |
|-------------|------------------------|---------------------------------------------------------------|
| 400         | `ValidationError`      | Bad payload (invalid JSON, missing `templateId`, bad batch).   |
| 401         | `AuthenticationError`  | Missing/invalid API key.                                       |
| 402         | `QuotaExceededError`   | Monthly credit limit reached (incl. predictive batch check).   |
| 403         | `ForbiddenError`       | Plan doesn't allow the feature (e.g. PDF protection on Free).   |
| 404         | `NotFoundError`        | Unknown template/batch id.                                     |
| 429         | `RateLimitError`       | Throttler / leaky-bucket limit hit.                            |
| 5xx / other | `ApiError`             | Server/unknown error. Base class for all of the above.        |

Every exception carries: `statusCode`, `message` (normalized string), `messages` (string[]), and the
raw HTTP response for escape-hatch debugging. `ApiError` is the catch-all base type users can rescue on.

---

## 5. What an SDK does NOT do

- No account/auth/billing/reporting calls (kept out per the public-docs policy).
- No `verifyWebhook` yet — see §7.
- No `/users/me` as a headline method. An SDK MAY offer an optional, clearly-undocumented
  connectivity probe internally, but it is not part of the public surface.

---

## 6. Per-language naming (same surface, idiomatic casing)

| Canonical        | Node/TS            | Python              | PHP                  | Go (exported)       |
|------------------|--------------------|---------------------|----------------------|---------------------|
| client ctor      | `new CellystialClient(opts)` | `CellystialClient(...)` | `new CellystialClient($opts)` | `cellystial.New(opts)` |
| listTemplates    | `listTemplates()`  | `list_templates()`  | `listTemplates()`    | `ListTemplates()`   |
| generatePdf      | `generatePdf()`    | `generate_pdf()`    | `generatePdf()`      | `GeneratePDF()`     |
| generateBatch     | `generateBatch()`      | `generate_batch()`       | `generateBatch()`      | `GenerateBatch()`      |
| generateBatchItems| `generateBatchItems()` | `generate_batch_items()` | `generateBatchItems()` | `GenerateBatchItems()` |
| getBatchStatus    | `getBatchStatus()`     | `get_batch_status()`     | `getBatchStatus()`     | `GetBatchStatus()`     |

Registries: npm `@cellystial/sdk` · PyPI `cellystial` · Composer `cellystial/cellystial` · Go module
`github.com/<org>/cellystial-go`.

---

## 7. Webhooks — signed (implemented)

The outbound "PDF ready" webhook POSTs the following JSON body (`pdf-delivery.consumer.ts`):

```
{ "event": "pdf.generated", "filename": "<name>.pdf", "base64": "<pdf bytes as base64>" }
```

### Signing scheme (HMAC-SHA256, Stripe-compatible)

Every signed delivery carries a header:

```
X-Cellystial-Signature: t=<unixSeconds>,v1=<hmacHex>
```

- `v1 = HMAC_SHA256(secret, "<t>.<rawBody>")` as lowercase hex.
- `rawBody` is the **exact** request-body bytes — the server serializes the JSON once and signs that
  same string, so verification is byte-for-byte. SDKs MUST verify against the raw body, not a
  re-serialized object (key ordering/whitespace would differ).

### The secret

- Format `whsec_<base64url(32 random bytes)>`. Server-generated, never client-set.
- Stored **encrypted at rest** (AES-256-GCM via `EncryptionService`, key from `ENCRYPTION_KEY`), in
  `user_settings.webhookSecretEncrypted` (`select:false`).
- Minted automatically the first time webhooks are enabled. Revealed/rotated via:
  - `GET  /api/v1/users/me/webhook-secret`        → `{ "secret": "whsec_…" }`
  - `POST /api/v1/users/me/webhook-secret/roll`   → `{ "secret": "whsec_…" }` (old secret invalidated)
  - These are dashboard/account routes (JWT-auth), **not** part of the key-authed SDK surface.

### `verifyWebhook(rawBody, signatureHeader, secret, opts?) → bool`

Client-side helper present in all four SDKs. It MUST:

1. Parse `t` and `v1` from the header.
2. Recompute `HMAC_SHA256(secret, "<t>.<rawBody>")` and compare to `v1` with a **constant-time** compare.
3. Reject if `|now - t| > tolerance` (default **300s**) to bound replay. `opts.toleranceSeconds`
   (and `opts.now` for testing) MAY override.

Returns boolean (or raises a typed `SignatureVerificationError` in languages where that's idiomatic —
keep it consistent: prefer returning bool + a separate throwing `verifyWebhookOrThrow` if desired).

> Backward-compat note: if an account somehow has webhooks enabled but no secret (legacy), the server
> logs a warning and delivers **unsigned** (no header). SDK consumers should treat a missing header as
> "unverified" and decide their own policy.

### Events & subscriptions

The signing scheme above applies to **every** event delivery — not just `pdf.generated`. The full catalog:

| Event | When |
|---|---|
| `pdf.generated` | a single PDF finished rendering |
| `batch.completed` | a bulk batch finished (now signed + 10s timeout + delivery-status tracked, at parity with `pdf.generated`) |
| `template.created` / `template.updated` / `template.deleted` | template lifecycle |

Beyond the single account-level `webhookUrl`, accounts can register multiple **webhook subscriptions**
(key-authed — this is what the n8n/Make/Zapier triggers and the SDK use). Each subscription has its own
`whsec_…` secret, returned exactly once at creation:

- `POST   /api/v1/webhooks` `{ url, events[], description? }` → `{ id, …, secret }`
- `GET    /api/v1/webhooks` — list (secrets never returned) · `GET /api/v1/webhooks/:id` — one
- `PATCH  /api/v1/webhooks/:id` — update `url` / `events` / `active` · `DELETE /api/v1/webhooks/:id`
- `POST   /api/v1/webhooks/:id/test` — send a synthetic `ping`
- `GET    /api/v1/webhooks/events/recent?event=` — recent deliveries (sample data for trigger setup)

Subscriptions coexist with the legacy single `webhookUrl`; both fan out independently. The SSRF guard
runs at delivery time, so subscription targets must resolve to a public host.

---

## 8. Status

The webhook-signing decision (sign now, encrypt at rest) is **implemented in the backend**:
`EncryptionService` + `ENCRYPTION_KEY` env, the `webhookSecretEncrypted` column + migration, the
generate/reveal/rotate lifecycle, and HMAC signing in the delivery consumer. The Node SDK
(`@cellystial/sdk` v1.0.0) ships `verifyWebhook` plus the subscription CRUD methods; `batch.completed`
and the `template.*` events are signed and fanned out to subscriptions. Remaining: the Python/PHP/Go
SDKs and the dashboard subscriptions-management UI.

**Ops requirement:** set `ENCRYPTION_KEY` (64 hex chars = 32 bytes) in every backend environment, e.g.
`openssl rand -hex 32`. Without it, signing is skipped (webhooks deliver unsigned) and the
reveal/rotate endpoints return 500.
