# Changelog

All notable changes to this package are documented here. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.0

Initial public release.

### Added

- `CellystialClient` with `listTemplates`, `generatePdf`, `generateBatch`,
  `generateBatchItems`, and `getBatchStatus`.
- Webhook subscription management — `createWebhook`, `listWebhooks`, `getWebhook`,
  `updateWebhook`, `deleteWebhook` — plus the standalone `verifyWebhook` signature check.
- `generatePdf` options: email delivery, storage override, and AES-256 password protection.
- Typed error hierarchy: `ValidationError`, `AuthenticationError`, `QuotaExceededError`,
  `ForbiddenError`, `NotFoundError`, `RateLimitError`, `ApiError`, `ConnectionError`.
- `RateLimitError.retryAfter` surfaces the `Retry-After` delay (in seconds) on `429`s.
- Fully typed batch responses: `BatchResponse`, `BatchStatus`, `BatchResult`.
- Per-request timeout with `AbortController` (default 30s, configurable).
- Zero runtime dependencies; uses the built-in `fetch` (Node.js 18+).
