# TASK-015 - ANBIMA feed cache and rate limiting

## Objective

Make the ANBIMA client cheap and polite. Before this task every `findSecondaryMarketDebentureByCode` performed a
full feed download (there is no server-side filter by `codigo_ativo`) and nothing limited the request rate, while
ANBIMA documents at most 15 requests per second in production. Everything lives INSIDE `infrastructure/anbima`:

    AnbimaDebentureProvider -> AnbimaDebentureFeedClient -> AnbimaHttpClient
                                                              |- feed cache (single entry, TTL, in-flight sharing)
                                                              |- token cache (unchanged, independent)
                                                              '- AnbimaRateLimiter (token + feed requests)

Not touched: `resolveAssets`, `AssetResolutionEngine`, `ProviderExecutionPipeline`, `AnbimaDebentureProvider`, the
route, the runtime factory. The public interface `findSecondaryMarketDebentureByCode(instrumentCode)` is unchanged;
the lookup is still exact (trim + uppercase) and local.

## Feed cache

- Internal method `getSecondaryMarketDebentureFeed()`: cache hit -> the cached records; otherwise one shared load
  (`loadSecondaryMarketFeed`: token + rate limit + HTTP + 401 retry + strict parse) that populates the cache.
- Exactly one cached entry (the latest feed, no `data` parameter) and at most one in-flight load. There is no map per
  code. Memory is bounded by one feed. Records are frozen, so a consumer cannot corrupt the shared cache.
- TTL: `feedCacheTtlMs`, default `ANBIMA_DEFAULT_FEED_CACHE_TTL_MS` = 5 minutes, validated (finite, >= 0; invalid ->
  `INVALID_CONFIGURATION`). `0` disables reuse. Time comes from the injectable `now`.
- The TTL is measured from the moment the feed was parsed. It is NOT coupled to the token expiry: the feed can be
  served after the token expired (no token request for a cache hit) and can be refreshed while the token is still valid.
- Only a successfully parsed feed is cached. A 401, any non-2xx, a network failure, invalid JSON or a malformed feed
  leaves the cache as it was and clears the in-flight slot, so the next call retries. (A feed that parses but lists one
  code with different issuers stays cached; only the lookup of THAT code fails with `FEED_RESPONSE_INVALID`.)
- No public invalidation method: refreshing happens only through the TTL.
- No persistence: not in the browser, not on the file system, not in a database.

## Coalescing (concurrency on a miss)

The in-flight load is a shared promise. On an empty or expired cache N concurrent lookups produce one token request
(if needed) and one feed request, and all N receive the same outcome. The promise is cleared with `finally`, so both a
success and a failure free the slot. The token request keeps its own shared in-flight promise.

## Rate limiter

`anbima-rate-limiter.ts`, ANBIMA-local (not a project-wide framework): a **sliding window with a FIFO queue**.

- At most `maxRequests` grants in any window of `intervalMs`; a grant leaves the window exactly `intervalMs` after it
  was issued. Callers without capacity wait in arrival order (FIFO fairness).
- No busy-wait: one timer is armed for the moment the oldest grant leaves the window (`setTimeout` by default,
  injectable `setTimer` + `now` in tests, so the tests never sleep).
- Default: 14 requests per 1000 ms. ANBIMA documents 15 per second; one below leaves a margin for clock and network
  jitter. Configurable through `rateLimit: { maxRequests, intervalMs }` (integer >= 1 / finite > 0).
- `acquire()` never rejects, so a failed request can never block the queue (the attempt consumed its slot, which is
  correct because the request was really made).
- Token requests, feed requests and the 401 retry all go through the same limiter (conservative interpretation of the
  15 req/s limit): `send()` is the only place that calls fetch and it acquires first. Cache hits never reach it.

## Concurrency is not rate limiting (recap)

`resolveAssets` bounds simultaneous work (worker pool). The limiter bounds requests per time toward ANBIMA. They are
different mechanisms at different layers; the cache also means a batch of debentures now costs one feed request
instead of one per debenture.

## Multi-instance limitation (important)

The cache and the limiter are in memory and per process. They only control THIS process. With several server
instances (several containers/serverless instances) each one has its own limiter and its own cache, so a global limit
of 15 requests per second is **NOT guaranteed**: N instances can together send up to N x the per-instance rate, and
each downloads the feed independently. A distributed limiter/cache (shared store) is future work. Until then the
default of 14/s is a per-instance figure; size the deployment accordingly.

## Error safety (unchanged)

Errors keep fixed messages with only codes and HTTP status. They never contain the client secret, the access token,
the Basic payload, headers or response bodies; a network failure is reported without cause. The new configuration
errors carry no value.

## Tests

- `anbima-rate-limiter.test.ts`: defaults, immediate grants without timers, queueing, FIFO, sliding window, never more
  than max per window, single timer, no permanent block, invalid configuration.
- `anbima-feed-cache.test.ts`: cache reuse within TTL (also for different codes), no token on hit, refresh after TTL,
  replacement, TTL 0, failed/network/malformed/401 not cached, coalescing on empty and expired cache, in-flight
  cleared after success and failure, exact matching, no `data` parameter, frozen records, configuration validation,
  token and feed sharing one limiter, 401 retry through the limiter, second 401 still failing, cache hits bypassing the
  limiter, recovery after failure, default 14/s, error safety, no real network.
- `anbima-http-client.test.ts` (TASK-006) runs with `feedCacheTtlMs: 0` so it keeps observing every request.
- `resolve-assets.integration.test.ts` now expects ONE feed request for a two-debenture batch (was one per debenture).
- `fake-anbima-clock.ts`: deterministic clock/timer used by the new tests.

## Remaining limitations

- Per-process state only (see above). No distributed cache/limiter, no persistence, no shared token cache.
- No retry/backoff beyond the single 401 retry; no handling of ANBIMA `429`/`Retry-After` beyond reporting the failure.
- The whole feed is kept in memory (one entry). A very large feed is a memory cost of that entry only.
- Stale-while-revalidate is not implemented: after the TTL the first caller waits for the refresh.
- The sandbox token URL is still unconfirmed (see TASK-006).
