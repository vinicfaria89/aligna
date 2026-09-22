# TASK-016 - Batch resolution HTTP API

## Objective

Expose the server-side batch use case (`resolveAssets`, TASK-014) through a controlled Route Handler:

    client -> POST /api/aie/resolve-assets
           -> content type / body size / JSON / batch shape (validateBatchRequest)
           -> CandidateAsset[] (existing validateCandidateAsset, no second validator)
           -> resolveAssets(assets, options) -> bounded concurrency -> shared server AIE
           -> safe JSON

Ingestion (CSV / structured JSON adapters, TASK-011..013) stays separate: this endpoint receives already-built
`CandidateAsset` objects, it does not parse files.

Files: `app/api/aie/resolve-assets/route.ts` (thin, POST only, `runtime = "nodejs"`, `dynamic = "force-dynamic"`),
`lib/aie/server/resolve-assets-http.ts` (validation + mapping), `lib/aie/server/aie-http.ts` (response helpers shared
with the single-asset route: `jsonResponse`, `errorResponse`, `hasJsonContentType`, `unsupportedMediaType`; the
single-asset handler now uses them, its behavior is unchanged).

The route knows nothing about ANBIMA, credentials, OAuth, providers, cache, the rate limiter, the verification policy,
the planner or the pipeline, never reads `process.env` and logs nothing.

## Request

`Content-Type: application/json` (a charset suffix is accepted).

    {
      "assets":  [ <CandidateAsset>, ... ],      // required, array
      "options": { "concurrency": 3 }            // optional
    }

- Only `assets` and `options` are accepted at the root; only `concurrency` inside `options`. Anything else is
  rejected (`unknown_field`), so a client can never set credentials, providers, URLs, environment, rate-limit or cache
  settings, or a different batch limit.
- Each asset goes through the existing `validateCandidateAsset` (unknown fields rejected, including the sensitive
  customer fields; no coercion). Its issue paths are prefixed with the array position: `assets[2].hints.ticker`.
- An empty `assets` array is valid and returns `items: []` without touching the engine.

## Limits

- Batch size: `MAX_BATCH_SIZE` (100), imported from the batch service. More assets -> 400 (`assets` / `too_long`),
  never truncated.
- Body size: `MAX_BATCH_BODY_BYTES` = 512 KiB. One validated asset is well under 4 KiB at its field limits, so 100 fit
  comfortably while the body stays bounded. `Content-Length` above the limit is rejected before reading; otherwise the
  body is streamed and the stream is cancelled as soon as it exceeds the limit (bytes, not characters).
- Concurrency (design A): `options.concurrency` is exposed, an integer between 1 and `MAX_BATCH_CONCURRENCY` (10); when
  omitted the service default (3) applies. It is safe to expose because it only bounds simultaneous work inside the
  request and is capped. Rate limiting is NOT client-configurable.

## Response

Always `Content-Type: application/json; charset=utf-8` and `Cache-Control: no-store`.

    200  { "ok": true, "result": { "items": [ { index, candidateAssetId, ok: true,  result: ResolutionResult }
                                              | { index, candidateAssetId, ok: false, error: { code, message } } ] } }
    400  { "ok": false, "error": { "code": "INVALID_ASSET_BATCH", "message": "Invalid asset batch.", "issues": [ {path, code} ] } }
    413  { "ok": false, "error": { "code": "PAYLOAD_TOO_LARGE", "message": "Request payload is too large." } }
    415  { "ok": false, "error": { "code": "UNSUPPORTED_MEDIA_TYPE", "message": "Content-Type must be application/json." } }
    500  { "ok": false, "error": { "code": "AIE_INTERNAL_ERROR", "message": "Unable to resolve assets." } }

Issues are `{ path, code }` only (at most 20), never values and never unknown key names.

## Partial-success semantics

HTTP 200 means "the batch ran". Unresolved assets, provider failures already recorded in the `InvestigationCase`, and
item-level safe errors (`AIE_CONFIGURATION_UNAVAILABLE`, `AIE_INTERNAL_ERROR`) are all inside `items`; items keep the
input order and one entry per input position. A partial failure is never an HTTP error.

Difference from the single-asset route: there is NO 503. If the server AIE cannot be created (for example incomplete
ANBIMA credentials), `resolveAssets` attempts it once and reports `AIE_CONFIGURATION_UNAVAILABLE` on every item
(TASK-014 contract); the HTTP layer does not reinterpret that. A `BatchResolutionError` thrown by the service (which
cannot happen after validation) is mapped defensively to 400; any other exception is a generic 500.

## Security

- Nothing sensitive is returned: no client id/secret, token, Authorization/Basic payload, environment, providers or
  fetch options. Secret/token sentinels are asserted absent from serialized responses.
- No console logging (the batch is never logged).
- CORS: none. No `Access-Control-*` header is set anywhere, so the endpoint stays same-origin. Requiring
  `application/json` also forces a preflight for cross-site browser requests.
- **Authentication/authorization: none exists in the application yet, and none was invented here (no fake API keys).
  It is REQUIRED before this endpoint is publicly exposed.** (Superseded by TASK-017: the route is now fail-closed and
  answers 401 to every request until a real identity system implements `AieRequestAuthorizer`.)

## Concurrency is not rate limiting

`options.concurrency` bounds simultaneous item resolution. The outbound ANBIMA rate (default 14/s) and the feed cache
belong to the ANBIMA infrastructure (TASK-015) and are per process: with several server instances a global 15 req/s is
not guaranteed. A batch of debentures costs one token and one feed request thanks to the cache.

## Tests

- `resolve-assets-route.test.ts` (42): success semantics (empty, one, several, order, unresolved, item errors, mixed,
  configuration failure per item), request validation (malformed JSON, non-object root, missing/non-array assets,
  invalid asset index and path, no value echo, unknown root field, sensitive fields, batch limit boundary), body size
  (declared, streamed, bytes vs characters) and media type (415), concurrency (valid, min/max, invalid, non-object
  options, no client-controlled rate limit/cache/provider/environment), errors and headers (generic 500, defensive 400,
  `no-store`, no CORS headers, no secret), route boundary (exports, imports, no `process.env`/provider code/logging/
  wildcard CORS, no network on import, single-asset route untouched).
- `resolve-assets-route.integration.test.ts` (6): real route mapping + real `resolveAssets` + real `getServerAie` with a
  fake global fetch: order, one token and one feed request per batch and across requests, no leaks, ANBIMA disabled,
  provider failure inside the investigation, incomplete credentials per item, invalid request touching nothing.

## Out of scope / future work

Authentication/authorization, per-caller rate limiting and quotas, deduplication of repeated candidates, async/background
jobs and pagination for larger portfolios, a CSV upload endpoint, UI.

## Update (TASK-024)

The byte-bounded body reader and the 200/error mapping of the batch were extracted to shared modules (`bounded-body.ts`, `resolveBatchToResponse`) so the CSV endpoint `POST /api/aie/resolve-csv` reuses them; this route's behavior is unchanged. See `TASK-024-csv-upload-resolution-api.md`.
