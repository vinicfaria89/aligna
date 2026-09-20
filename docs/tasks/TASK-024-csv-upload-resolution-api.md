# TASK-024 - CSV portfolio upload resolution API

Status: implemented. It connects pieces that already exist; it adds no parser, no normalization and no policy.

    raw CSV request
      -> authorization (TASK-017/020/021)  -> identity usage control (TASK-023)
      -> media type -> byte limit -> UTF-8 -> parsePortfolioCsv -> ingestPortfolioCandidates (ingestPortfolioCsv)
      -> batch-size limit -> resolveAssets (TASK-014) -> the same BatchResolutionResult response as resolve-assets

## Endpoint

`POST /api/aie/resolve-csv` (`app/api/aie/resolve-csv/route.ts`, POST only, `runtime = "nodejs"`,
`dynamic = "force-dynamic"`). The route is thin; the mapping lives in `lib/aie/server/resolve-csv-http.ts`. The route reads no
environment and imports nothing provider-specific. Importing it performs no network request.

## Request

- The body is the raw CSV text. There is NO multipart/form-data and no file upload yet: a browser sends `file.text()`.
- `Content-Type: text/csv`, optionally with `charset=utf-8` (case-insensitive, quotes tolerated). Anything else,
  including `application/json`, another charset or another parameter, is `415 UNSUPPORTED_MEDIA_TYPE`
  ("Content-Type must be text/csv.").
- Encoding: strict UTF-8. Invalid UTF-8 is refused (400), never silently replaced. A leading BOM is passed to the CSV adapter,
  which owns BOM handling.
- The CSV format is the TASK-013 contract, unchanged: canonical headers (`id rawName assetType ticker isin cnpj instrumentCode
  issuerName fundName maturityDate currency amount fileId fileName section row institution`), `rawName` required, strict
  amounts, quoted fields, LF/CRLF. **Every row also needs an `id`, or both `fileId` and `row`** (the ingestion layer derives
  no other id and never uses randomness); a CSV with only `rawName` is a 400. No id is invented from the request.

## Limits

- Body: `MAX_CSV_BODY_BYTES` = 512 KiB, counted in BYTES. A declared `Content-Length` above it is rejected before reading;
  otherwise the body is streamed and cancelled once it exceeds the limit (shared reader `bounded-body.ts`, also used by the
  JSON batch route). Nothing is truncated. 512 KiB comfortably holds 100 rows even at every field's maximum length (checked by a
  test) while keeping memory bounded.
- Rows: at most `MAX_BATCH_SIZE` (100, imported from the batch service) candidates. More is `400 INVALID_PORTFOLIO_CSV`
  with issue `rows / too_long`, before any resolution; never truncated.

## Authorization and entitlement

The endpoint resolves a batch, so it uses the SAME authorization as `resolve-assets`: authenticated, active, allowed role, and
`entitlements.aie_batch === true` (TASK-021), including its 401 / 403 / 500 semantics and the malformed-entitlement failure
mode. Decision: the operation is the fixed literal `"resolve-assets"` (option A). CSV upload is only another TRANSPORT of the
same paid capability, so reusing the operation avoids duplicating entitlement and quota policy and adds no new entitlement or
literal. The operation is never derived from the request. Trade-off: the audit records `resolve-assets` for both transports
and does not tell them apart (on purpose, to keep the audit minimal).

Nothing in the CSV can grant access: role/userId/isAdmin/apiKey/entitlement/premium columns are rejected as data, and
authorization happens before the body is even read.

## Usage limit (TASK-023)

It consumes the BATCH bucket (default 5 requests per minute per subject), shared with the JSON batch route. One CSV request
is exactly one slot, whatever the number of rows (100 rows still cost one slot). No additional usage controller exists. An
unauthenticated or forbidden caller creates no limiter state; a rate-limited request answers 429 with `Retry-After` and its
body is never read.

## Order of execution (tested)

1. correlation id; 2. authorization; 3. usage control; 4. media type; 5. byte limit; 6. UTF-8 decoding and CSV parsing;
7. ingestion; 8. batch-size limit; 9. `resolveAssets`; 10. response.
Denied (401/403/500 authorization), rate-limited (429) and usage-control-failure requests leave the request body UNUSED
(asserted through `Request.bodyUsed`). A CSV that fails parsing or ingestion never calls the batch service or the network.

## Responses

Every response carries `X-Correlation-Id` and `Cache-Control: no-store`.

| Status | Body |
|---|---|
| 200 | `{ "ok": true, "result": { "items": [ ... ] } }`: the unchanged `BatchResolutionResult` (same shape as `resolve-assets`) |
| 400 | `{ "ok": false, "error": { "code": "INVALID_PORTFOLIO_CSV", "message": "Invalid portfolio CSV.", "issues": [ {path, code} ] } }` |
| 413 | `PAYLOAD_TOO_LARGE` |
| 415 | `UNSUPPORTED_MEDIA_TYPE` |
| 401 / 403 / 429 / 500 | as for `resolve-assets` (`AIE_UNAUTHENTICATED`, `AIE_FORBIDDEN`, `AIE_RATE_LIMITED`, `AIE_AUTHORIZATION_ERROR`, `AIE_USAGE_CONTROL_ERROR`, `AIE_INTERNAL_ERROR`) |

- Partial success: CSV errors happen before resolution and are 400. Once the batch runs, a per-item failure (a normal
  unresolved result, a provider failure inside the investigation, or a safe item error) stays inside `items` and the request
  is 200, exactly as in TASK-014/016. A header-only CSV is a valid empty portfolio: 200 with `items: []` and no provider call.
- The shared 200/error mapping (`resolveBatchToResponse`) was extracted from `resolve-assets-http.ts` and is used by both
  routes, so the result contract is not duplicated.

Issue paths are structural locations only: `header[3]`, `header` (a missing `rawName`), `row[4]`, `row[4].amount`, `rows`, `$`.
Codes are the adapters' stable codes (`malformed_csv`, `unknown_field`, `forbidden_field`, `duplicate_header`, `empty_header`,
`extra_columns`, `missing_columns`, `required`, `empty`, `invalid_value`, `too_long`, ...). Never a cell value, a header name, a
row or the CSV (a test uses sentinel values). Ingestion errors are reported as CSV row N+2 for data index N (TASK-013's
convention: the header is row 1); if the file has blank lines that number is the data-row ordinal plus one rather than the
physical line.

## Privacy and audit

- The CSV privacy rules are unchanged and enforced by the adapter: `customerName`, `cpf`, `accountNumber`, `totalWealth`,
  `portfolioBalance`, `password`, `token`, `access_token`, `clientSecret` (and unknown headers) are rejected; no customer
  identity was added to `PortfolioAssetInput` or any contract. A filename HTTP header is never read or trusted (only a `fileName`
  COLUMN, if present, is data); nothing is invented from headers.
- Audit (TASK-022) is reused through the same orchestration, with the fixed metadata only: correlation id, timestamp, operation,
  subject, outcome/decision and status. No CSV content, row, `rawName`, `instrumentCode`, amount, filename or portfolio size ever
  enters an event (tested with sentinels across success, 400 and 429).
- The bearer, ANBIMA credentials and tokens never appear in a response; the customer's CSV values never travel to ANBIMA.

## Files

`resolve-csv-http.ts` and `app/api/aie/resolve-csv/route.ts` (new); `bounded-body.ts` (shared byte-bounded reader, extracted
from the JSON batch mapping); `resolve-assets-http.ts` (now uses the shared reader and exports `resolveBatchToResponse`);
`aie-http.ts` (issues typed as `{path, code}` for any stable code, and the CSV 415 response).

## Not implemented (future)

React upload UI, drag-and-drop, multipart form upload, file persistence, Excel, PDF/OCR, background jobs, portfolio persistence,
progress and async polling. The browser UI will read the file locally, preview it, and send `file.text()` as `text/csv`.

## Limitations

- The whole CSV is parsed and ingested (bounded by 512 KiB) before the row limit is applied, so a very long file of tiny rows costs
  a bounded amount of parsing before its 400.
- Usage limits are per process (TASK-023); ANBIMA limits and cache are per process (TASK-015).
- The audit does not distinguish CSV from JSON batch requests.
- Row numbers of ingestion errors ignore blank lines (see above).

## Update (TASK-025)

The endpoint accepts ONE optional query parameter, `fileId`, an opaque upload id (`[A-Za-z0-9._-]{1,64}`). Rows that state no `id` then get
`portfolio:<fileId>:<row>` through the CSV adapter's new optional `defaultFileId` (the CSV text is never edited). Any other query parameter
or a malformed or repeated `fileId` is a 400. Without `fileId` the contract above is unchanged. The byte and row limits now come from one
browser-safe module shared with the UI. See `TASK-025-csv-portfolio-resolution-ui.md`.