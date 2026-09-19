# TASK-009 - AIE server use case: resolveAsset

## Objective

Give the rest of Aligna one small server-side entry point for asset resolution, so that no future
route, server action or service needs to know about providers, ANBIMA, tokens, the process
environment, VerificationPolicy or the execution pipeline.

    server consumer
      -> resolveAsset(candidate)            lib/aie/server/resolve-asset.ts
      -> getServerAie()                     lib/aie/server/create-server-aie.ts (only env boundary)
      -> AssetResolutionEngine
      -> ResolutionResult

## Public server API

    resolveAsset(candidateAsset: CandidateAsset): Promise<ResolutionResult>

- Input: the existing domain type `CandidateAsset` (no parallel DTO).
- Output: the existing `ResolutionResult`, returned unchanged.
- Single-asset resolution only. Batch resolution (with concurrency and rate-limit control) is a
  future task.
- `resolveAssetWithEngine(engine, candidate)` is the delegation helper used by `resolveAsset`
  and by unit tests with a fake engine.
- Only `candidateAsset` is forwarded to the engine; no evidence, searches or timestamps are
  injected by callers.

## Delegation boundary

`resolveAsset` contains no business logic. It does not evaluate VerificationPolicy, build a
ResolutionPlan, call providers, transform ANBIMA records, create VerifiedAsset or match anything.
It does not read the process environment. Tests assert that its code (comments excluded) does not
reference those components.

## Three outcomes, kept distinct

1. Unresolved asset: a NORMAL return value (`needs-more-evidence`, `verifiedAsset: null`).
2. Provider/search failure: already recorded in `InvestigationCase.searches` (status `failed`)
   and returned, never thrown.
3. Server/runtime failure: throws `AieServerError` with a fixed safe message.
   - `kind: "configuration"`: the server AIE could not be created because of invalid ANBIMA
     configuration (incomplete credentials or invalid environment).
   - `kind: "unexpected"`: any other failure obtaining or running the engine.
   The message never contains secrets or environment detail, and the original error is
   deliberately NOT attached (no `cause`), so nothing sensitive can leak through serialization.

## No client-side imports

`lib/aie/server/*` is server-only. It is not exported from the browser-safe `lib/aie` barrel, and
the static guard test fails if any "use client" module can reach `resolve-asset.ts` (or the rest of
the server boundary).

## Limitations

- The original error of an unexpected failure is not preserved. Server-side diagnostics must come
  from structured, secret-free logging added in a later task.
- No input validation here: `CandidateAsset` is trusted. Validation belongs to the future API
  route (TASK-010).
- No build-time "server-only" guard (see TASK-008), no throttling/retry/feed cache for ANBIMA, and
  the RegistryProvider is still not registered.
