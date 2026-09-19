# TASK-018 - Authentication integration assessment and plan

Status: analysis only. No production code, no dependency, no test was added or changed.

## 0. Summary

- Aligna already HAS an identity system, but it lives outside this repository: the Planejador Financeiro backend
  (FastAPI) owns users, passwords, roles and JWT issuance. The Aligna Next.js app is a client of it and keeps no
  server-side session.
- The question is therefore not "which identity platform" (the repository answers that) but "how does an Aligna server
  route verify a Planejador identity, and which of those identities may use the AIE". The first has a recommended shape
  below; the second is a product decision the repository cannot answer (section 8).
- The `AieRequestAuthorizer` boundary from TASK-017 is the right seam. Nothing in the AIE domain has to change.

Sources inspected: `aligna/` (package.json, next.config.js, .env.example, app/, components/, lib/api.ts, lib/session.ts,
docs/) and, read-only, the sibling repository `CLAUDE/Planejador Financeiro` (backend `app/core/security.py`,
`app/core/config.py`, `app/api/v1/{auth,deps,intake,extraction,billing,score_history}.py`, `app/models/{user,subscription,client}.py`,
`app/main.py`, tests names, `docker-compose.prod.yml`, `nginx/nginx.conf`). No `.env` file was opened: secret values were
not inspected.

## 1. Current repository findings

### Aligna (this repository)

| Area | Finding |
|---|---|
| Framework | Next.js 15.5.9 App Router, React 19; dependencies are only next/react/lucide; no auth, session, ORM, database or identity package. |
| Middleware | None (`middleware.ts` does not exist). |
| Server routes | Only `POST /api/aie/resolve-asset` and `/api/aie/resolve-assets` (TASK-010/016), fail-closed since TASK-017. No page or component calls them yet. |
| Persistence | None. `lib/api.ts` states that Aligna "has no database of its own: a funnel without persistent state". |
| Identity | Delegated to the Planejador backend: `lib/api.ts` calls `POST /api/v1/intake/aligna` (creates the account and returns tokens), `/auth/login`, `/auth/refresh`. Base URL from `NEXT_PUBLIC_PLANEJADOR_API_URL` (public). |
| Session | `lib/session.ts`: `{access_token, refresh_token, token_type}` in browser `localStorage` (`aligna_session`); the refresh token is exchanged on every `getValidAccessToken()`. The browser sends `Authorization: Bearer <access>` explicitly to the backend. Nothing is a cookie, so a Next.js server route sees no credential unless the client adds the header. |
| Env | `.env.example`: `NEXT_PUBLIC_PLANEJADOR_API_URL`, `NEXT_PUBLIC_SITE_URL`, `ANBIMA_*`. No auth variable. |
| Deployment | Nothing in the repo: no Dockerfile, compose, CI workflow, vercel/netlify config or README. Dev port 3100. The backend's `FRONTEND_URL` and CORS list name `:3100` as a separate origin from the Planejador UI (`:3000`). |
| Funnel order | Statement upload and extraction (`ExtratosStep`, `extractStatements`) happen BEFORE any account exists; the account is created at the end (`submitIntake`). |

### Planejador Financeiro backend (identity provider in practice)

| Area | Finding |
|---|---|
| Users | `users` table (UUID id, unique email, bcrypt hash, `full_name`, `role`, `is_active`). Roles: `administrador`, `assessor`, `cliente`. |
| Registration | `POST /auth/register` is PUBLIC and always creates a `cliente`; `POST /intake/aligna` also creates accounts publicly. `assessor`/`administrador` can only be created by an administrator (`POST /auth/users`). So "authenticated" is a low bar: anyone can obtain a valid `cliente` identity. |
| Tokens | Stateless JWT, HS256 with a single symmetric `SECRET_KEY` (default value in code is `change-me-in-production`; the real value was not inspected). Access token: `sub` = user UUID, `type: "access"`, `role`, `iat`, `exp` (30 min). Refresh token: `sub`, `type: "refresh"` (7 days). |
| Verification | `get_current_user` decodes the token, requires `type == "access"`, loads the user and requires `is_active`. So the backend checks `is_active` on every request; a JWT-only check elsewhere would not. |
| Refresh | No rotation, no server-side revocation list, no logout endpoint. |
| Introspection | There is NO `/auth/me`, `/whoami` or introspection endpoint. |
| Authorization helpers | `require_roles(...)`, `require_active_subscription` (Stripe-backed `subscriptions`, status active/past_due), `get_client_or_404` (owner/advisor rule). |
| Tenancy | No organization/tenant model. The only relations are `Client.owner_user_id` (self-service, "autonomo") and `Client.advisor_id` (managed by a GCB advisor, "acompanhado"). |
| CORS | Explicit origin list plus a GitHub Codespaces regex, `allow_credentials=True`, all methods/headers. |
| Deployment hints | `docker-compose.prod.yml` + `nginx.conf` behind a TLS guide: nginx routes `/api/` to the backend and everything else to the Planejador frontend. **Any Aligna deployment behind that same nginx/host would have its `/api/aie/*` routes captured by the backend, never reaching Next.js.** Whether Aligna is deployed there is UNKNOWN. |
| Observation | `POST /extraction/statement` has no authentication dependency (anonymous, and it calls an external AI API). It is outside this task, but it shows the funnel already exposes anonymous cost-bearing endpoints, which matters for the AIE decision in section 8. |

## 2. Existing auth status

A real authentication system exists and is in use (registration, login, refresh, roles, active flag, subscriptions).
What does not exist on the Aligna side: server-side verification of that identity, any session persistence, middleware,
protected server routes, a cookie session, an audit log, per-user rate limiting. The AIE routes are currently denied
for everybody by design (TASK-017).

## 3. Known product requirements (derivable from the repository)

- B2C consumer login exists (`cliente`, created by the funnel or `/auth/register`, "Minha evolução" via `/auth/login`).
- Advisor (`assessor`) and administrator logins exist in the Planejador domain (GCB "acompanhado" mode).
- One paid plan (Premium), enforced in the backend from Stripe webhooks; not enforced anywhere in Aligna's server.
- Aligna intends "no account until the person decides to continue" (IntroStep/RelatorioStep copy).
- The AIE is planned for onboarding/portfolio import/reconciliation (`docs/backlog/AIE-ROADMAP.md`, Epic 5).

## 4. Unknown product requirements (not answered by the repository)

1. May anonymous funnel users call the AIE (diagnosis happens before account creation), or only logged-in users?
2. Which roles may use the AIE: `cliente`, `assessor`, `administrador`? Is a Premium subscription required?
3. Is there an organization/tenant concept beyond owner/advisor, now or planned?
4. Where and how is Aligna deployed (host/origin relative to the API, platform, TLS, reverse proxy)?
5. Is the current localStorage token model an accepted risk, or should Aligna move to an httpOnly cookie session?
6. Regulatory/audit obligations (retention of access logs, LGPD constraints on identifiers)?
7. Expected AIE volume per user and the acceptable ANBIMA cost/abuse envelope.
8. Is replacing the Planejador identity with an external IdP (Auth.js, Clerk, Supabase, corporate SSO) on the roadmap?

Nothing below assumes an answer to these.

## 5. Relevant authentication options

Only options that fit this repository are compared. An external IdP (Auth.js/Clerk/Supabase/corporate OIDC) is listed
last and NOT evaluated in depth: the repository has no signal for it, and adopting one would create a second user store
next to `users` (or force a migration of users, roles, subscriptions and the advisor/client relations). Revisit only if
question 8 is answered yes.

Common goal for A-C: the Aligna server route receives the existing Planejador access token in
`Authorization: Bearer ...` and an `AieRequestAuthorizer` turns it into an `AieAuthorizationResult`.

### A. Local JWT verification in Aligna with the shared HS256 secret

- Fit: no network hop, no backend change, can be done with `node:crypto` (no new dependency required).
- Costs/risks: the backend's signing secret must be copied into Aligna's server environment, so a leak from Aligna lets
  an attacker forge tokens for ANY role, including `administrador`, for the whole Planejador system (the blast radius
  grows). Verification would not see `is_active` (a deactivated user keeps AIE access until token expiry, up to 30 min),
  nor role changes. The secret's default value in code makes weak deployments plausible. Must reject `type != "access"`,
  enforce `exp`, and pin the algorithm.
- Verdict: works technically, worst security posture of the three. Not recommended.

### B. Token introspection against the Planejador backend (recommended)

- Shape: the Aligna authorizer sends the bearer token, server to server, to a new backend endpoint (for example
  `GET /api/v1/auth/me`, backed by the existing `get_current_user`) that returns `{id, role}` (and optionally
  `is_active`/subscription status) or 401.
- Fit: no shared secret; the backend remains the single authority (active flag, role, later subscription); no crypto in
  Aligna; the URL is a fixed server-side configuration value, never derived from the request.
- Costs/risks: needs a small backend change in a different repository (endpoint + tests); adds a network call and a
  runtime dependency on the backend for every AIE request (mitigate with a timeout, fail closed, and an optional very
  short in-memory cache keyed by a hash of the token, accepting staleness of a few seconds); the introspection endpoint
  becomes a token-validity oracle, so it needs the same rate limiting as login.
- Verdict: best fit for the current architecture. Recommended.

### C. Asymmetric JWTs (RS256/EdDSA) with a published verification key

- Shape: the backend signs with a private key and exposes a public key/JWKS; Aligna verifies locally.
- Fit: no shared signing secret and no per-request hop; standard for multiple resource servers.
- Costs/risks: larger backend change (key generation, rotation, `kid`, JWKS endpoint, migration of existing HS256
  tokens), still no `is_active`/revocation without extra claims or a denylist, and requires a JWT verification
  implementation in Aligna (library or careful hand-rolled code).
- Verdict: a sound later hardening if several services will verify Planejador tokens. Not needed now.

### D. Server-side session cookie (BFF) instead of localStorage

This is orthogonal to A-C: it changes HOW the credential reaches the AIE route (httpOnly cookie instead of a header the
page JavaScript attaches), not how it is verified. It removes token exposure to XSS and lets server routes read the
credential automatically, but it changes the existing session design, needs a server-side login proxy and CSRF
protection (section 9), and depends on question 5. Not required for the first authorizer.

### Comparison

| Criterion | A local HS256 | B introspection | C asymmetric JWT | D cookie session |
|---|---|---|---|---|
| Next 15 App Router fit | good | good | good | needs route handlers for login/logout |
| Server-side verification | yes | yes | yes | yes |
| Implements `AieRequestAuthorizer` | yes | yes | yes | yes |
| Secret handling | shares signing secret | none shared | public key only | session secret in Aligna |
| Browser/server boundary | header token | header token | header token | httpOnly cookie |
| Middleware compatible | yes (edge crypto) | needs fetch, Node runtime fine | yes | yes |
| Sees `is_active`/role changes | no | yes | no | depends |
| User persistence required in Aligna | none | none | none | session store or signed cookie |
| Role/organization support | role claim only | role from source of truth | role claim only | as above |
| Operational complexity | low | low-medium (backend change, availability) | medium-high | medium-high |
| Vendor dependency | none | none (own backend) | none | none |

## 6. Trade-offs in one paragraph

B trades one small backend endpoint and a per-request dependency for a materially safer boundary than A and a much
smaller change than C. A is fastest but multiplies the impact of a secret leak. C is the right end state only if more
verifiers appear. D is a session-hardening decision that can follow independently. An external IdP is a strategic
change, not an integration detail.

## 7. Recommended integration shape with `AieRequestAuthorizer`

    HTTP request (Authorization: Bearer <Planejador access token>)
      -> requireAuthorization (TASK-017, unchanged)
      -> PlanejadorAuthorizer.authorize(request)            [new, server-only, lib/aie/server]
           1. parse header strictly (single "Bearer" scheme, bounded length, no logging)
           2. introspect at the fixed server-side URL (injected fetch, timeout)
           3. map the answer:
                valid identity + allowed role -> { authorized: true,  principal: { subject: <user id>, roles: [<role>] } }
                valid identity, role not allowed -> { authorized: false, reason: "forbidden" }
                missing/invalid/expired token or 401 -> { authorized: false, reason: "unauthenticated" }
                timeout, network error, 5xx, malformed answer -> throw (TASK-017 turns it into 500 AIE_AUTHORIZATION_ERROR)
      -> validation -> resolveAsset / resolveAssets (unchanged)

Properties to keep:

- Authentication (who is the caller: the Planejador backend) and authorization (may this caller use the AIE: a small
  policy inside the authorizer, for example an allowed-roles list) stay separate. Business permissions are not put in
  the identity system's configuration.
- The AIE domain, providers and HTTP handlers still know nothing about the vendor, token format, cookie format or
  user store; the principal never leaves the authorization module (TASK-017).
- Unconfigured means denied: if the server-side auth configuration is absent, `getAieRequestAuthorizer()` keeps
  returning the deny-all authorizer.
- Configuration is read in ONE composition module (same rule as `create-server-aie.ts` for ANBIMA), with a server-only
  variable name (never `NEXT_PUBLIC_*`), and the static guard test is extended accordingly.
- The bearer token is never forwarded to ANBIMA or any provider, never logged, never stored.

### Principal contract review

`AieRequestPrincipal { subject: string; roles?: string[] }` is sufficient for the next phase: `subject` = the user UUID,
`roles` = `[role]` from the identity source. Do not add `organizationId`, `tenantId` or `advisorId`: the repository has no
tenant concept and no AIE requirement uses them (question 3). If an advisor-on-behalf-of-client requirement appears, it
is a new authorization requirement to design, not a field to add now.

## 8. Questions that require product-owner confirmation

Blocking for the AIE authorizer policy (decide before TASK-019 code):

1. Anonymous funnel use: must the AIE work before the person has an account? If yes, "authenticated-only" contradicts the
   funnel and a different control is needed for that path (for example a server-side call from the funnel backend with
   its own abuse limits, or a short-lived anonymous grant). This is the biggest open point.
2. Allowed roles for the AIE (`cliente`, `assessor`, `administrador`) and whether Premium is required.
3. Expected volume and abuse tolerance (drives per-subject rate limiting, since public registration makes any
   `cliente` identity cheap to obtain and each AIE call can trigger ANBIMA traffic).

Not blocking but needed soon:

4. Aligna deployment topology (origin relative to the API; nginx path collision on `/api/`).
5. Acceptance of localStorage tokens, or a move to an httpOnly cookie session.
6. Audit/regulatory retention requirements.
7. Whether an external IdP is on the roadmap.

## 9. Security considerations

- Registration is public, so authentication alone does not protect the ANBIMA quota or cost: role policy and per-subject
  rate limiting are required follow-ups (the current ANBIMA limiter is per process and per instance, TASK-015).
- Token type: only `access` tokens may be accepted; a refresh token presented as a bearer must be rejected (the backend
  already does this, and its tests cover it).
- Failure semantics: an unreachable or misbehaving identity backend must never authorize (fail closed, TASK-017's 500).
  Distinguish "the backend says no" (401/403) from "we could not ask" (throw).
- SSRF: the introspection URL comes only from server configuration; the request can influence nothing but the bearer
  value. Enforce timeouts and a response size bound.
- Shared secret (option A) would put a signing key that can mint `administrador` tokens into a second deployment.
- Stateless refresh tokens are not revocable and not rotated; a stolen refresh token lasts 7 days. Out of scope here but
  worth a backend follow-up.
- Header parsing: exactly one `Authorization` value, scheme `Bearer`, bounded length; never echo it in errors.
- Middleware: Next.js middleware is not needed for the first authorizer (verification happens in the route handlers
  through the existing boundary); adding it later must not become a second, divergent decision point.
- CSRF / same-origin, by credential style:
  - Bearer header attached by page JavaScript (today): browsers do not attach it automatically to cross-site requests,
    so classic CSRF does not apply; the JSON content type requirement already forces a preflight. The cost is XSS
    exposure of a token in localStorage.
  - httpOnly cookie session (option D): CSRF protection becomes mandatory for the POST routes: `SameSite=Lax` or
    `Strict`, `Secure`, an Origin/Host check (reject a mismatching `Origin`), and preferably a CSRF token; CORS must stay
    closed.
  - Bearer-token API for non-browser callers: no CSRF concern; CORS must remain closed unless a specific origin is
    deliberately allowed.
  - Same-origin browser usage (the current AIE stance) works with either style.
- Audit (not implemented): log only safe metadata per AIE request: authenticated subject identifier (the user UUID),
  route/action, timestamp, decision (allow / 401 / 403 / authorizer error), HTTP status, batch item COUNT, and a request
  correlation id. Never log: ANBIMA client id/secret/token, the user's bearer or refresh token, passwords, raw
  `CandidateAsset` values, portfolio contents, CPF or account numbers. Denials should be logged with the same fields
  and no token fragments.

## 10. Proposed sequence for TASK-019 (after the product answers)

Scope recommendation: TASK-019 = "Planejador-backed authorizer (option B)", limited to authentication verification and a
minimal role policy. It depends on answers 1-2 above; if answer 1 is "yes, anonymous must work", split that out as its
own design task first.

1. Backend task (Planejador repository, separate PR): add `GET /api/v1/auth/me` reusing `get_current_user`, returning
   only `{id, role}` (and `is_active`, optionally subscription status if question 2 requires Premium); 401 for invalid,
   expired, refresh or inactive; tests next to `test_auth_api.py`; same rate-limit posture as login.
2. Aligna: `PlanejadorRequestAuthorizer implements AieRequestAuthorizer` under `lib/aie/server/`, with an injected fetch,
   timeout, strict bearer parsing, strict response validation and the mapping in section 7. No new dependency.
3. Aligna: a server-only configuration reader (single composition module) exposing the introspection URL; unconfigured
   keeps `createDenyAllAuthorizer()`; `getAieRequestAuthorizer()` returns the Planejador authorizer only when configured.
   Extend the static guards (no `NEXT_PUBLIC_` variant, single env reader, no token in logs).
4. Role policy: an explicit allowed-roles constant (from question 2), unit-tested; `forbidden` otherwise.
5. Offline tests with a fake fetch: valid token, expired/invalid/refresh token, inactive user, forbidden role, timeout,
   5xx, malformed body, missing/duplicate/oversized header, unconfigured deny, no token in any response or outbound AIE
   call, denial before any AIE work, existing TASK-017 tests untouched.
6. Explicitly NOT in TASK-019: login UI, cookie/BFF session, token refresh handling in AIE calls (the client already has
   `getValidAccessToken()`), audit logging, per-subject rate limiting, CSRF, an external IdP.

Likely follow-ups: TASK-020 audit logging; TASK-021 per-subject rate limiting and quotas; later, cookie session (D) and
asymmetric tokens (C) if the answers call for them.

## 11. Result of this task

No production code changed; validation (`npx tsc --noEmit`, `npm test -- --run lib/aie`) confirms no regression.
