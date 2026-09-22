# TASK-010 - Server asset resolution API

## Objective

Expose the server-side use case `resolveAsset(candidateAsset)` through a controlled Next.js Route Handler.

    browser/client
      -> POST /api/aie/resolve-asset          app/api/aie/resolve-asset/route.ts
      -> HTTP mapping + validation            lib/aie/server/resolve-asset-http.ts
      -> resolveAsset(...)                    lib/aie/server/resolve-asset.ts
      -> getServerAie() -> AssetResolutionEngine

The route knows nothing about ANBIMA, credentials, tokens, providers, the verification policy or the
execution pipeline. It only accepts input, validates it, calls `resolveAsset()` and maps safe
results/errors to HTTP. `route.ts` exports only `POST` (plus `runtime`/`dynamic`); the framework
answers other methods with 405. The logic lives in `lib/aie/server/*` so route files stay thin and
testable; `route.ts` imports it by relative path.

## Endpoint

    POST /api/aie/resolve-asset
    Content-Type: application/json

## Request

A JSON `CandidateAsset`:

    {
      "id": "asset-1",
      "rawName": "DEB PETROBRAS",
      "source": { "fileId?", "fileName?", "section?", "row?", "institution?" },
      "hints": {
        "assetType?", "ticker?", "isin?", "cnpj?", "instrumentCode?",
        "issuerName?", "fundName?", "maturityDate?", "currency?", "amount?"
      }
    }

Validation (`candidate-asset-validation.ts`, no new dependency; the project has no validation library):

- the body must be a JSON object; `id`, `rawName`, `source` and `hints` are required;
- unknown fields are REJECTED at the top level, in `source` and in `hints`, so a client can never send
  provider, environment, URL, credential or token fields;
- nothing is coerced: wrong types (including `null`) are rejected;
- strings must be non-blank, free of control characters and within limits
  (id 128, rawName 256, source texts 256, ticker/isin/cnpj 32, instrumentCode 64, issuerName/fundName 256,
  maturityDate 32, currency 8);
- `assetType` must be a known `CandidateAssetType`; `amount` must be a finite number >= 0;
  `source.row` must be a non-negative safe integer;
- the body is limited to 16 KiB (declared `Content-Length` and actual size);
- `Content-Type` must be `application/json` (this also forces browsers through a CORS preflight for
  cross-site requests).

## Responses

| Status | Body | When |
| --- | --- | --- |
| 200 | `{ "ok": true, "result": <ResolutionResult> }` | any normal result: `verified`, `needs-more-evidence`, provider failures recorded in `InvestigationCase.searches` |
| 400 | `{ "ok": false, "error": { "code": "INVALID_CANDIDATE_ASSET", "message": "Invalid candidate asset.", "issues": [{ "path", "code" }] } }` | malformed JSON, oversized body, invalid CandidateAsset |
| 415 | `{ "ok": false, "error": { "code": "UNSUPPORTED_MEDIA_TYPE", ... } }` | Content-Type is not application/json |
| 503 | `{ "ok": false, "error": { "code": "AIE_CONFIGURATION_UNAVAILABLE", "message": "Asset resolution is temporarily unavailable." } }` | `AieServerError` kind `configuration` |
| 500 | `{ "ok": false, "error": { "code": "AIE_INTERNAL_ERROR", "message": "Unable to resolve asset." } }` | `AieServerError` kind `unexpected` or any other exception |

- An unresolved asset is HTTP 200. It is never an HTTP error.
- Validation `issues` carry only a known field path and a code (`required`, `type`, `empty`, `too_long`,
  `invalid_value`, `invalid_json`, `unknown_field`). They never echo submitted values or unknown key names.
- Server errors carry fixed messages: no stack traces, no environment variable names, no secrets, no
  original exception.
- All responses send `Cache-Control: no-store`.

## Privacy and secrets

- The request is validated into a fresh `CandidateAsset`; the request body is never logged (nothing is
  logged at all in this task).
- The AIE query pipeline is unchanged: only instrument identifiers reach providers. Customer data in
  `source` (file name, institution) and `amount` never reach ANBIMA; an integration test asserts it.
- `ResolutionResult` is plain data. A test serializes a successful response built on the real server
  composition (fake fetch) and searches it for sentinel credentials, tokens and Basic values.
- `route.ts` and the HTTP mapping do not read `process.env`; the only AIE environment reader remains
  `lib/aie/server/create-server-aie.ts`.

## Limitations

- Rate limiting is future work (no distributed limiter, no abuse protection beyond input limits).
- No authentication/authorization on the endpoint yet: it must be added before exposing it beyond the
  application (the route is same-origin only by convention).
- Structured, secret-free server observability is a separate task; unexpected errors are not logged.
- Single-asset resolution only.
- The Registry provider is still not registered and there is no build-time `server-only` guard (see TASK-008).
