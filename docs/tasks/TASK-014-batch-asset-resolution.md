# TASK-014 - Batch asset resolution service

## Objective

Resolve many `CandidateAsset` values through the server AIE with bounded concurrency, reusing the single-asset
use case. Ingestion and resolution stay separate:

    CSV / structured adapter -> CandidateAsset[]                 (TASK-011..013, fail-fast)
    CandidateAsset[] -> resolveAssets -> BatchResolutionResult   (this task, per-item outcomes)

`lib/aie/server/resolve-assets.ts` is server-only (like the rest of `lib/aie/server/*`). It is not used by
`route.ts`, the engine, the pipeline or the ANBIMA client, and it does not parse CSV/JSON.

## API

    resolveAssets(candidateAssets: readonly CandidateAsset[], options?: { concurrency?: number }): Promise<BatchResolutionResult>
    resolveAssetsWithResolver(candidateAssets, resolver, options?)     // injectable resolver, used by tests
    BatchResolutionError                                                // invalid request (see below)

    BatchResolutionResult { items: BatchResolutionItem[] }
    BatchResolutionItem   { index, candidateAssetId } & ( { ok: true, result: ResolutionResult }
                                                        | { ok: false, error: { code, message } } )

- `resolveAssets` obtains the server engine ONCE (`acquireServerAie()`, a helper extracted from `resolve-asset.ts`
  that owns the safe classification of engine-creation failures) and delegates each item to
  `resolveAssetWithEngine(engine, candidate)`. The single-asset behavior of `resolveAsset` is unchanged.
- The batch service contains no policy, planning, provider or ANBIMA logic and never reads the process environment.

## Bounded concurrency

A small worker pool over a shared index: `min(concurrency, n)` workers repeatedly claim the next unclaimed index
(the claim is synchronous, so no item runs twice) and run it. There is one `Promise.all`, over the workers only,
never over the input items; items start lazily as workers free up.

- Default concurrency: 3. Maximum: 10 (`MAX_BATCH_CONCURRENCY`). Must be an integer >= 1; `0`, negatives,
  fractions, `NaN`, `Infinity`, strings and `null` are rejected with `BatchResolutionError("INVALID_CONCURRENCY")`.
  Only `undefined` selects the default.
- Maximum batch size: 100 (`MAX_BATCH_SIZE`). A larger input is rejected with `BATCH_TOO_LARGE`, never truncated.
  Why 100: each lookup can trigger an external request (the ANBIMA client downloads the whole feed per lookup) and
  the whole batch is resolved within one request/response; callers split bigger portfolios into several batches.
- A non-array input is rejected with `INVALID_INPUT`. Request validation happens before the engine is obtained.
- An empty array returns `{ items: [] }` immediately, without obtaining the engine or making any request.

## Ordering

`items` always has one entry per input position, in input order, with `index` and `candidateAssetId`.
Execution may interleave and finish in any order; the output order never changes. Nothing is ever lost.

## Per-item failure policy (partial success)

One failing asset never fails the batch; other assets continue.

- A normal unresolved `ResolutionResult` and provider failures already recorded in
  `InvestigationCase.searches` are `ok: true` results, returned unchanged (same object).
- A resolver/engine rejection becomes `ok: false` with a safe, fixed error: `AIE_CONFIGURATION_UNAVAILABLE`
  ("Asset resolution is temporarily unavailable.") or `AIE_INTERNAL_ERROR` ("Unable to resolve asset.").
  Never the original exception, stack, secrets, tokens or configuration.
- If the server engine cannot be created (invalid configuration), the initialization is attempted ONCE and the
  same safe error is reported on every item (no N repeated initializations, no batch-level throw).

This is intentionally different from the ingestion adapters, which are fail-fast: a structurally invalid file is
invalid as a whole and no partial portfolio should be produced, whereas each asset here is an independent lookup
against external sources.

## Concurrency is not rate limiting

The concurrency limit bounds simultaneous work and protects against bursts. It does NOT guarantee a maximum
requests-per-second toward any external source (a fast lookup frees a worker quickly, so throughput can still be
high). ANBIMA documents a production limit of 15 requests per second; enforcing it, and caching the feed, belong to
the ANBIMA infrastructure (a later task), not to this generic service. No ANBIMA constants live here.

## Out of scope / future work

No deduplication (the same candidate listed twice is resolved twice and keeps both positions), no caching, no
retries, no persistence, no queue/background jobs, no cancellation (`AbortController`), no distributed rate limiting,
no HTTP route or UI for batches, and no CSV parsing. These are future tasks (rate limit/cache in the ANBIMA
infrastructure first).
