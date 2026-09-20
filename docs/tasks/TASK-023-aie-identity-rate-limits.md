# TASK-023 - AIE identity rate limits

Status: implemented. Policy source: `TASK-019-aie-access-policy.md` (anonymous access: no; quota/rate control is TASK-023).

## What this is, and what it is not

An application-level usage control per AUTHENTICATED IDENTITY. It is NOT the technical ANBIMA limiter:

| | Identity usage control (this task) | ANBIMA technical limiter (TASK-015) |
|---|---|---|
| Protects | the AIE from one user's excessive use | the external ANBIMA API from exceeding its documented rate |
| Keyed by | authenticated subject + operation | nothing (global to the process) |
| Unit | HTTP requests per window | outbound ANBIMA requests per second (default 14/s) |
| Answer | HTTP 429 to the caller | the request waits its turn |

    user -> authorization -> identity usage control -> validation -> resolveAsset(s) -> providers -> ANBIMA limiter

It does not replace `MAX_BATCH_SIZE` (100), the batch concurrency limit (default 3, max 10) or the ANBIMA limiter.

## Order of execution

1. correlation id established;
2. authorization evaluated (TASK-017/020/021); a denial returns here (401 / 403 / 500);
3. the subject is now known: the usage controller is checked;
4. rate limited => 429 and stop; controller failure => fail closed and stop;
5. content type / body / validation;
6. resolution.

Consequences, all tested: unauthenticated and forbidden callers never reach the controller, so they create no limiter state
and consume nobody's quota; a limited request reads no body, calls no resolver and makes no network request. There is no
anonymous quota and no IP-based key.

## Contract (`aie-usage.ts`, generic)

    interface AieUsageContext    { subject: string; operation: AieOperation }        // and nothing else
    type AieUsageDecision        = { allowed: true } | { allowed: false; reason: "rate-limit" | "quota"; retryAfterSeconds: number }
    interface AieUsageController { check(context): Promise<AieUsageDecision> }

The module reads no environment, uses no network, storage or timers, and knows nothing about ANBIMA, billing, providers,
assets or tokens. The context has no field for an asset, instrument code, payload, IP or token: keys are the fixed
operation literal plus the subject. Usage control logic lives in none of the authorizer, the engine, the pipeline, the
ANBIMA client or `route.ts`; `aie-audited-request.ts` connects it.

The `quota` reason exists so a future quota decision (a product-defined usage plan) can be expressed without reshaping the
contract. Nothing implements quotas today and nothing calls Stripe or any billing system; a `quota` answer is treated like
a rate limit (429) until the product defines distinct semantics.

## Policy and limits chosen

| Operation | Limit | Window |
|---|---|---|
| `resolve-asset` (single) | 30 requests | 60 s per subject |
| `resolve-assets` (batch) | 5 requests | 60 s per subject |

Exported as `AIE_MAX_SINGLE_REQUESTS_PER_MINUTE`, `AIE_MAX_BATCH_REQUESTS_PER_MINUTE`, `AIE_USAGE_WINDOW_MS` and the frozen
`AIE_DEFAULT_USAGE_POLICY`. They are constants in code: no environment variable and no `NEXT_PUBLIC_*` setting exists, and
the client cannot influence limits, windows, counters or the retry hint (a test sends limit-like fields and headers).

Why these numbers: 30/min is one request every two seconds on average, generous for interactive use, and each single call
is one lookup against an already cached ANBIMA feed. Batch is the heavy operation (up to 100 assets per request), so 5/min.
They are starting values, cheap to change in one place, and are conservative because the store is per process (below).

Single and batch are SEPARATE buckets: a burst of single requests does not consume the batch bucket and vice versa.

One HTTP batch request consumes ONE batch slot, whatever number of assets it carries (a batch of 1, 50 and 100 assets each
cost one slot). Charging per asset was deliberately not done: `MAX_BATCH_SIZE`, the concurrency limit and the ANBIMA limiter
already bound the work of a single batch.

## Algorithm

Sliding-window log per `(operation, subject)`: a bucket keeps the timestamps of the requests accepted in the last
`windowMs`; a request is allowed while fewer than `limit` remain. A denied request is NOT recorded, so hammering does not
extend the block. The retry hint is the time until the oldest accepted request leaves the window, rounded up to whole
seconds (minimum 1, never more than one window, even if the clock jumps). Time comes from an injectable clock: there are
no timers, no sleeping and no busy-wait, and the tests never wait.

## Memory safety and cleanup

- a bucket holds at most `limit` timestamps; expired timestamps are purged on every check of that bucket;
- a sweep removes every bucket whose newest request is older than its window. It runs at most once per `sweepIntervalMs`
  (default: the shortest window), piggybacking on traffic. There is no background timer, so an idle process keeps its last
  buckets until the next request, but the count is bounded;
- a hard cap `DEFAULT_MAX_TRACKED_KEYS` (50,000 keys) guards against key growth: at the cap a sweep runs first; if it frees
  nothing, a NEW key is denied as rate-limited (fail closed, retry hint one window) while existing keys keep working.

## HTTP behavior

Rate limited:

    429
    Retry-After: <whole seconds>
    Cache-Control: no-store
    X-Correlation-Id: <id>
    { "ok": false, "error": { "code": "AIE_RATE_LIMITED", "message": "Too many asset resolution requests." } }

The body and headers never contain the subject, a counter, the policy, a token or the payload (no `X-RateLimit-*` headers).
The retry hint from any controller is normalized to whole seconds in [1, 86400] (60 when absent or not a finite number).

## Failure policy: fail closed

If the usage controller throws, rejects, or answers anything that is not a well-formed decision, the request is DENIED, never
allowed:

    500
    { "ok": false, "error": { "code": "AIE_USAGE_CONTROL_ERROR", "message": "Unable to check usage limits." } }

Nothing is resolved and nothing about the failure (error text, subject) reaches the response or the audit. The reasoning: this is an
abuse control, and a future distributed backend must not silently fail open.

## Audit integration (TASK-022)

Two execution-stage outcomes were added, without a new stage or a new field: `rate-limited` (status 429) and
`usage-control-error` (status 500). A rate-limited request therefore produces: the authorization event `authorized`, then an
execution event `rate-limited` with the subject, operation, timestamp and correlation id, and nothing else (no counters,
policy or payload). Auth denials keep their own events and never produce a usage event.

## In-memory limitation (read this before relying on it)

The controller is IN MEMORY and PER PROCESS:

- it is NOT globally consistent: with several server instances each has its own counters, so a user can perform up to
  N x the limit across N instances (and a serverless deployment may create many short-lived instances);
- it is NOT durable: a restart or redeploy resets every counter;
- it is a first version that limits a single process's view of a user, not production-global enforcement.

Global enforcement needs shared storage (for example a distributed store with atomic counters), reached through the same
`AieUsageController` contract; only `getAieUsageController()` would change. The ANBIMA limiter has the same
per-process limitation (TASK-015).

## Files

`aie-usage.ts` (contract, policy constants, decision interpretation), `in-memory-usage-controller.ts`,
`create-server-usage-controller.ts` (`getAieUsageController()`, memoized, constants only), `aie-http.ts` (429 and
usage-error responses), `aie-audited-request.ts` (the wiring), `aie-audit.ts` (two outcomes), `request-authorization.ts`
(`usage` option seam), and test helpers `fake-aie-usage-controller.ts` (an allow-all controller exists ONLY there: there is no
unlimited production controller).

Existing route tests that are not about limits now inject an allow-all controller through a hoisted `vi.mock` of the factory
(as they already do for the authorizer), because the real default controller is per process and those files send many requests
for one subject.

## Out of scope

Redis or database counters, durable billing quotas, monthly usage plans, anonymous or IP limiting, CAPTCHA, distributed
global enforcement, a UI usage meter, charging batches per asset, `X-RateLimit-*` headers.