# TASK-020 - PlanejadorRequestAuthorizer

Status: implemented (see "Implementation notes" at the end). The specification below is unchanged except where noted.

Policy source: `TASK-019-aie-access-policy.md` (approved). Identity source: Planejador `GET /api/v1/auth/me`
(`{ id, role, is_active }`, Planejador commit `3fb6443`).

## Objective

Replace the deny-all production authorizer with one that authenticates the caller against the Planejador, without
sharing the JWT signing secret and without any local token verification:

    Bearer received by the Aligna route
      -> requireAuthorization (TASK-017, unchanged flow)
      -> PlanejadorRequestAuthorizer.authorize(request, { operation })
      -> GET <planejador>/api/v1/auth/me   (server to server, Authorization: Bearer <same token>)
      -> { id, role, is_active }
      -> approved policy (TASK-019)
      -> authorized | unauthenticated | forbidden   (or throws => 500 AIE_AUTHORIZATION_ERROR)

## Initial policy implemented here

- Authentication is mandatory (Decision 1).
- `cliente`, `assessor` and `administrador` are accepted for the SINGLE-asset operation (Decision 2). Any other role value
  is `forbidden`.
- Any Planejador failure denies access and is never guessed around: fail closed, no local JWT, no cache (Decision 6).
- The BATCH operation stays denied for everyone until TASK-021 (see next section).

## Required contract change: the authorizer must know the operation

Decision 3 (Premium only for batch) means the authorizer cannot decide from the request alone. Extend the TASK-017
contract minimally and compatibly:

    type AieOperation = "resolve-asset" | "resolve-assets"

    interface AieRequestAuthorizer {
      authorize(request: Request, context: { operation: AieOperation }): Promise<AieAuthorizationResult>
    }

- `requireAuthorization(request, authorizer, operation)` passes the operation; the two handlers pass their own
  operation constant. The operation is a fixed literal chosen by the route, never read from the request.
- `getAieRequestAuthorizer()` keeps returning the deny-all authorizer when the Planejador configuration is absent.
- The principal contract stays `{ subject, roles? }`. Entitlements are added in TASK-021 only when they are needed.
- Existing TASK-017 tests keep their assertions; the injected authorizers just receive the extra argument.

## Batch stays denied until TASK-021 (important)

With only authentication and roles, every logged-in user, including a free `cliente`, would be allowed to use the batch
route, which contradicts Decision 3. Until `entitlements.aie_batch` exists in `/auth/me` and is enforced (TASK-021), the
authorizer answers `forbidden` (403 `AIE_FORBIDDEN`) for `operation === "resolve-assets"` for every authenticated
caller. This is the conservative reading of the policy: nobody holds the entitlement yet, so nobody may use batch.
The caller is still authenticated FIRST (as implemented): an unauthenticated or inactive caller gets 401, never a
403 that would reveal the batch policy to someone who is not even logged in.

## Behavior

Input handling (before any network call):

- Exactly one `Authorization` header value, scheme `Bearer` (case-insensitive scheme), a single token, bounded length
  (for example 4 KiB), no whitespace inside, no control characters. Anything else, or no header: `unauthenticated`, and
  NO request to the Planejador is made.
- The token is never logged, echoed, stored, forwarded to ANBIMA/providers, or included in any error.

Introspection call:

- One `GET` to the fixed URL built from server configuration plus the fixed path `/api/v1/auth/me`. Nothing from the
  incoming request (path, query, host, other headers) influences the URL. Only the bearer is forwarded.
- Injected fetch (global fetch by default), timeout via an abort signal (default 3 s), no redirects followed
  (`redirect: "error"` or manual and rejected), response body read with a size bound (for example 4 KiB).
- No retries, no caching, no in-flight sharing between different tokens.

Mapping of the answer:

| Planejador answer | Result |
|---|---|
| 200 with a valid body, `is_active === true`, role in the allowed set, operation single | `{ authorized: true, principal: { subject: id, roles: [role] } }` |
| 200 valid, `is_active === false` | `unauthenticated` |
| 200 valid, role not in the allowed set | `forbidden` |
| 200 valid, operation batch (until TASK-021) | `forbidden` |
| 401 | `unauthenticated` |
| 403 | `forbidden` |
| 429, other 4xx, 5xx, timeout, network error, redirect, oversized or non-JSON body, body that fails strict validation | throw (fail closed; TASK-017 turns it into 500 `AIE_AUTHORIZATION_ERROR`) |

Strict validation of a 200 body: an object with `id` a non-empty string of bounded length (UUID shape), `role` a string,
`is_active` a boolean. Unknown extra fields are ignored and NEVER copied into the principal. The principal is built
only from `id` and `role`.

## Configuration

- One server-only variable that points to the Planejador API base URL used for introspection (proposed name
  `PLANEJADOR_AUTH_BASE_URL`; NEVER a `NEXT_PUBLIC_*` name). It is distinct from the public browser URL
  (`NEXT_PUBLIC_PLANEJADOR_API_URL`) because the server may need an internal address.
- Read in exactly ONE composition module (same rule as `create-server-aie.ts` for ANBIMA), following the same
  pattern: env parsed and validated once, invalid value => the authorizer stays deny-all (fail closed, never throws at
  import), `http` allowed only for a loopback host, otherwise `https`; the URL must not carry credentials, query or
  fragment.
- Unset or invalid configuration keeps `createDenyAllAuthorizer()`.
- The static guard test that pins "only the AIE boundary reads `process.env` for ANBIMA" is extended to pin the same for
  the new variable; `.env.example` documents it with an empty placeholder and a comment (server-side only).
- `getAieRequestAuthorizer()` is the only place the choice is made; routes and handlers do not change.

## Files (proposed)

- `lib/aie/server/planejador-request-authorizer.ts`: the authorizer class/factory (injected fetch, timeout, base URL).
- `lib/aie/server/create-server-authorizer.ts`: the single env reader and the memoized selection (deny-all vs Planejador).
- `lib/aie/server/request-authorization.ts`: add `AieOperation`, the `context` argument and the operation passing.
- `resolve-asset-http.ts` / `resolve-assets-http.ts`: pass their fixed operation to `requireAuthorization`.
- Tests and this document's follow-up notes; `.env.example` placeholder.

No new dependency. No change to the AIE domain, providers, ANBIMA client, validation or resolution use cases.

## Tests (offline, fake fetch only)

- Header parsing: missing, wrong scheme, empty token, two tokens, duplicate header, oversized, control characters
  => `unauthenticated` and zero fetch calls.
- Success: valid answer for each of the three roles on the single operation => authorized with `subject`/`roles`
  built only from the answer; extra fields in the body are not copied.
- Inactive user; unknown role; batch operation => `is_active` false = unauthenticated, unknown role = forbidden,
  batch = forbidden (for all three roles, with a valid identity).
- 401 => unauthenticated; 403 => forbidden.
- Failures throw and the route answers 500 `AIE_AUTHORIZATION_ERROR` (no processing, no resolveAsset call): timeout, network
  error, 500/502/503, 429, redirect, malformed JSON, non-object, missing/invalid fields, oversized body.
- Outbound request: exact fixed URL, method GET, only the `Authorization` header (and accept/none of the incoming
  headers), no body, abort signal present, redirect not followed; the incoming request's URL/host cannot change it.
- No cache: two consecutive requests with the same token produce two introspection calls; a user that becomes inactive
  between two requests is denied on the second.
- Token/secret safety: the bearer never appears in any response body, error message, thrown error, log or outbound
  AIE/ANBIMA call; a sentinel token is asserted absent everywhere.
- Configuration: unset/invalid/credentialed/http-non-loopback URL => deny-all (401 on the routes); valid => the
  Planejador authorizer is used; the env is read in one module only (static guard); no `NEXT_PUBLIC_` variant.
- Integration through the real routes with a fake fetch: single asset authorized end to end, batch 403, unauthenticated 401,
  Planejador down 500, and NO ANBIMA call in any denied or failed case.
- All existing TASK-017 tests remain green; suite stays fast (no real timers beyond the abort signal, use fake timers).

## Out of scope

Premium/entitlement enforcement (TASK-021, needs the Planejador change first), audit logging (TASK-022), per-identity
rate limiting and quotas (TASK-023), CSV upload (TASK-024), login UI, cookie/BFF sessions, CSRF, caching of introspection
answers, local JWT verification, changes to the Planejador.

## Acceptance

`npx tsc --noEmit` and `npm test -- --run lib/aie` green; no real network; production behavior with the Planejador
variable unset is identical to today (deny-all); no secret or token in any output.

## Implementation notes

Files: `lib/aie/server/planejador-request-authorizer.ts` (authorizer, base URL validation, constants),
`create-server-authorizer.ts` (the single environment reader and memoized choice), `deny-all-authorizer.ts` (the
fail-closed authorizer, in its own module to avoid a runtime import cycle), `request-authorization.ts` (adds
`AieOperation`, `AieAuthorizationContext` and the operation argument; `getAieRequestAuthorizer()` now returns the composed
authorizer), the two HTTP handlers (each passes its fixed operation literal), `.env.example` (empty
`PLANEJADOR_AUTH_BASE_URL` placeholder).

Decisions taken while implementing:

- Authentication happens before the operation check, so `unauthenticated` beats `forbidden` on the batch route.
- A 3xx answer is a failure (`redirect: "manual"`; any status other than 200/401/403 throws), so a redirect is never
  followed and never treated as an identity.
- The timeout covers the whole exchange (request and body read) through an abort controller; the connection of a 401/403
  answer is released without waiting for the stream to cancel.
- Only the fixed error `PlanejadorAuthorizationError` is thrown: no token, URL, status, cause or response content.
- Static guards updated: the two server composition modules (`create-server-aie.ts`, `create-server-authorizer.ts`) are
  the only AIE sources that read `process.env`; only the latter mentions `PLANEJADOR_AUTH_BASE_URL`.

Behavior with the variable unset is unchanged from TASK-017: every AIE request is 401.
## Update (TASK-021)

The temporary rule "batch is forbidden for every authenticated caller" described above was replaced by entitlement
evaluation: batch is authorized only when `/auth/me` returns `entitlements.aie_batch === true`. A legacy answer without
`entitlements` still yields 403 on batch. See `TASK-021-aie-batch-entitlement-authorization.md`.