# Changelog

All notable changes to this package are documented here. This project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

### Added

- `generateImage(templateId, data, { format, page, width, quality })`: one page of a
  document as a PNG or JPEG image (for chat apps, previews and thumbnails), with its
  pixel size and the document's page count. Needs the server's image output
  (`POST /generate` with `format: "png" | "jpeg"`).

## 1.0.1

### Fixed

- Broken `docs/sdk_api_surface.md` link in the README. The link pointed at
  `../docs/…`, which escaped the repository root and 404'd on npm/GitHub. The
  shared API-surface doc now lives in this repo and ships in the package.

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
