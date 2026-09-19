# TASK-017 - AIE route authorization boundary

## Objective

Give every AIE HTTP route an explicit, pluggable authorization boundary that runs BEFORE any expensive work:

    route -> handler -> requireAuthorization -> (authorized) content type / body / validation
                                              -> resolveAsset / resolveAssets -> shared server AIE

Routes covered: `POST /api/aie/resolve-asset` and `POST /api/aie/resolve-assets`.

## Fail-closed by default

The application has NO identity system yet. Nothing was invented to fill the gap: no API keys, no custom JWTs, no
bearer tokens, no cookies, no passwords, no fake users, no `NEXT_PUBLIC_*` secrets, no login/signup/session store/RBAC.

The production authorizer (`getAieRequestAuthorizer()`) therefore denies every request with `unauthenticated`. There is
no hidden bypass: trust is never inferred from localhost, `User-Agent`, `Origin`, `Referer`, IP address or cookies. As a
consequence, **both routes answer 401 to every request until a real identity provider is integrated.** That is
intentional; successful flows are exercised in tests through an injected authorizer.

## Contract (`lib/aie/server/request-authorization.ts`, server-only)

    interface AieRequestPrincipal { subject: string; roles?: string[] }

    type AieAuthorizationResult =
      | { authorized: true;  principal: AieRequestPrincipal }
      | { authorized: false; reason: "unauthenticated" | "forbidden" }

    interface AieRequestAuthorizer { authorize(request: Request): Promise<AieAuthorizationResult> }

    getAieRequestAuthorizer()        // the authorizer used by the real routes (deny-all today)
    createDenyAllAuthorizer()        // the fail-closed implementation
    requireAuthorization(request, authorizer): Promise<Response | null>   // null = authorized

Handlers accept `handleResolveAssetRequest(request, { authorizer? })` and `handleResolveAssetsRequest(request,
{ authorizer? })`. When no authorizer is injected they use `getAieRequestAuthorizer()`. The `route.ts` files are
unchanged and tiny: they cannot forget the check, and they cannot be configured from the browser. The module reads no
environment and logs nothing; it is not exported from the browser-safe `lib/aie` barrel.

## HTTP semantics

| Situation | Status | Body |
|---|---|---|
| `unauthenticated` | 401 | `AIE_UNAUTHENTICATED` - "Authentication is required." |
| `forbidden` | 403 | `AIE_FORBIDDEN` - "You are not allowed to perform this operation." |
| authorizer throws / malformed result / empty subject | 500 | `AIE_AUTHORIZATION_ERROR` - "Unable to authorize request." |

The third row is an addition beyond the two documented statuses: an authorizer that fails or answers garbage is treated
as a hard failure, and the request is NOT processed (fail closed). All three are `Cache-Control: no-store` JSON with
fixed codes and messages: no denial reason detail, claims, stack, session internals or principal.

## Ordering: authorization before any work

Authorization is the first thing a handler does: before the Content-Type check (a bad type is a 401, not a 415), before
the body is read (an oversized or malformed body is a 401, not a 413/400; the request body stays unused), before
validation, before `getServerAie`, before any provider or network call. A denied request never invokes `resolveAsset`,
`resolveAssets` or `getServerAie`, and never calls fetch (all asserted).

The authorizer receives a body-less copy of the request (same URL, method and headers), so it can inspect headers/cookies
but cannot consume the payload.

## Authorization cannot come from the request

Identity is derived only from the server authorizer. Fields such as `userId`, `role`, `isAdmin`, `apiKey`, `authToken`,
`permission` in the JSON (root, asset or options), and headers such as `Authorization`, `X-Api-Key`, `Cookie`, `Origin`,
`Referer`, `X-Forwarded-For`, do not authorize anything (tests send all of them to the real routes and get 401). Once a
request is authorized, such payload fields are still rejected as unknown fields by the existing validators. Nothing was
added to `CandidateAsset` or to the batch request shape.

## Principal privacy

The principal is request-level metadata that never leaves `request-authorization.ts`: `requireAuthorization` returns only
a denial `Response` or `null`. The handlers never see it (a test asserts the word does not appear in the handlers or use
cases), so it cannot reach `CandidateAsset`, `ProviderQuery`, `AssetEvidence`, ANBIMA calls (URL, headers, body) or
`ResolutionResult`. The integration test runs the real composition with a sentinel subject/role and asserts they appear
in no outbound call and no response, and that the result is identical for different principals.

## Integrating a real identity system (future)

Implement `AieRequestAuthorizer` (validate the session/credential owned by that system, decide 401/403, return a
principal) and return it from `getAieRequestAuthorizer()`. Routes, handlers, validation and the resolution use cases do
not change. Per-user rate limiting/quotas, RBAC persistence and audit logging depend on that architecture and are out of
scope here.

## Tests

- `request-authorization.test.ts` (33): default deny (including trust-looking requests), actual routes 401, injected
  allow for both flows, body-less copy for the authorizer, denial before body validation and before oversized bodies,
  no use case/server AIE/network on denial, fail-closed on a broken authorizer, 403 mapping, no leaks in 401/403,
  `no-store`, forged payload/headers, principal absent from use case arguments and responses, module boundaries (routes,
  environment, logging, barrel, no `NEXT_PUBLIC_` auth configuration, no identity fields in domain contracts).
- `request-authorization.integration.test.ts` (3): real composition + fake fetch: principal never reaches ANBIMA calls
  or responses, identical results across principals, nothing created or requested on denial even with ANBIMA configured.
- The four existing route test files (`resolve-asset-route*.test.ts`, `resolve-assets-route*.test.ts`) keep all their
  assertions; they now inject an explicit allow authorizer by mocking `getAieRequestAuthorizer`, and their import-list
  guards include the new module.

## Limitations

No real authentication exists, so the routes are unusable in production until one is integrated. No audit log, per-user
rate limit or quota, no CSRF/session handling (owned by the future identity system).
