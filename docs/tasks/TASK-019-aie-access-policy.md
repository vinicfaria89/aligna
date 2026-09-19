# TASK-019 - AIE Access Policy

Status:

- [x] Drafted (options, context and consequences written)
- [ ] **Pending Product Decision** (Decisions 1-5 below are blank on purpose)
- [ ] Approved (name, date)

This task writes NO code. It turns the open product questions from TASK-018 into an explicit, versioned decision, so the
authorizer (TASK-020) is not built on assumptions. Fill in the `Decision:` and `Rationale:` fields, tick the options,
then change the status. Nothing below is decided yet; the "Engineering notes" only state what each option costs and are
not a recommendation to pick it.

## Context (facts, from TASK-017 and TASK-018)

- The AIE routes `POST /api/aie/resolve-asset` and `POST /api/aie/resolve-assets` are fail-closed today: every request
  gets 401 until a real `AieRequestAuthorizer` is provided (TASK-017).
- Identity already exists in the Planejador backend (users, roles `cliente` / `assessor` / `administrador`, JWT, Stripe
  Premium subscriptions). `GET /api/v1/auth/me` (Planejador commit `3fb6443`) returns `{ id, role, is_active }` for a
  valid access token; it does NOT return subscription status.
- Public registration exists (`POST /auth/register`, `POST /intake/aligna`) and always creates a `cliente`. Being
  authenticated is therefore a low bar: anyone can obtain a valid `cliente` identity for free.
- The Aligna funnel uploads and extracts statements BEFORE an account exists (the account is created at the end).
- Each AIE call can trigger ANBIMA traffic (documented limit 15 requests/s per credential). The feed cache and limiter
  are per process (TASK-015); a batch of debentures costs one feed request thanks to the cache.
- No UI calls the AIE routes yet.

## Decision 1 - Anonymous access

Can an unauthenticated user use the AIE?

Options:

- [ ] No (authentication required for every AIE route)
- [ ] Yes, single asset only (`resolve-asset`)
- [ ] Yes, batch allowed (`resolve-assets`)

Decision:

...

Rationale:

...

Engineering notes:

- "No" keeps the design simple: `authorize()` = validate the bearer through `/auth/me`. But the current funnel resolves
  assets before the person has an account, so the AIE could only be used after signup/login (a product/UX consequence).
- Any "Yes" means the boundary needs an anonymous path. Today `AieAuthorizationResult` has only authorized-with-principal
  or denied, so an anonymous grant needs an explicit contract decision (for example a distinct, non-forgeable anonymous
  principal) and CANNOT be inferred from missing credentials by accident. Anonymous identity is weak: the only handles
  are network-level (IP behind a proxy is easy to spoof or share), so limits (Decision 4) become mandatory.
- Anonymous batch multiplies exposure (up to 100 assets per request); anonymous single asset is the smaller surface.

---

## Decision 2 - Roles

Which authenticated roles may use the AIE?

Allowed roles:

- [ ] cliente
- [ ] assessor
- [ ] administrador

Different roles per route (single vs batch)?

- [ ] No, same roles for both routes
- [ ] Yes (describe below)

Decision:

...

Rationale:

...

Engineering notes:

- `cliente` is the self-registered consumer role; allowing it means anyone can use the AIE after a free signup.
- An advisor (`assessor`) working on behalf of a client is a different requirement (whose portfolio is it?). This policy
  only decides who may CALL the AIE; acting on behalf of someone is out of scope and not modelled.
- Roles come from the Planejador (source of truth) via `/auth/me`; the role list lives in Aligna as an explicit constant
  (TASK-021), not in the identity system.

---

## Decision 3 - Premium

Is a Premium subscription required?

Options:

- [ ] No (any allowed authenticated role)
- [ ] Yes (all AIE routes)
- [ ] Only for batch

Decision:

...

Rationale:

...

Engineering notes:

- Subscription state lives only in the Planejador (`subscriptions`, active or past_due). `/auth/me` does not expose it
  today. "Yes" or "Only for batch" requires a small Planejador change (a subscription flag in the introspection
  response, or a dedicated check) before the Aligna side can enforce it, and a decision on `past_due` (grace or block).
- "Only for batch" means the authorizer (or the route) must know which route it is authorizing; today the authorizer
  receives only the request.
- Note the diagnosis funnel is intentionally free ("the initial diagnosis is the bait"); Premium gating the AIE would
  interact with that.

---

## Decision 4 - Anonymous limits

Only applies if Decision 1 allows anonymous access. Otherwise write "Not applicable".

Maximum requests (per what window, per what identifier):

...

Maximum batch size for anonymous callers (the service maximum is 100):

...

Rate policy (per IP / per session / global anonymous budget, and what happens when exceeded):

...

CAPTCHA or other human check?

...

Also for authenticated callers (needed later by TASK-023):

- Per-identity quota (requests per minute/day):

...

- Maximum batch size for authenticated callers:

...

Rationale:

...

Engineering notes:

- Current limits are per process only: concurrency (default 3, max 10) bounds simultaneous work, and the ANBIMA limiter
  (default 14/s) is per instance, so a global 15/s across instances is not guaranteed (TASK-015).
- Quotas per identity need shared state (a store visible to every instance); that is TASK-023, not a tweak of the
  existing limiter.
- A CAPTCHA implies a third-party dependency and a UI step; state it explicitly if wanted.

---

## Decision 5 - Auditing

Is an audit trail required?

- [ ] No
- [ ] Yes

If yes, retention period and where it is stored:

...

Store (safe metadata only):

- subject (authenticated user id, or the anonymous marker)
- endpoint / action
- timestamp
- decision (allowed / 401 / 403 / authorizer error) and HTTP status
- request correlation id
- batch item COUNT (not the items)

Never store:

- CandidateAsset values or any part of a portfolio
- CPF, account numbers, institution names tied to a person
- bearer/refresh tokens, passwords
- ANBIMA credentials or tokens

Decision:

...

Rationale:

...

Engineering notes:

- Audit logging is a separate task (TASK-022); the authorization boundary already isolates the principal so the log can
  be added at the HTTP layer without touching the AIE domain.
- LGPD: the user id is a personal-data identifier; retention and access to the log need an owner.

---

## Consequences

Once decided, the work is sequenced as follows (each item is a separate task; none is started by this one):

| Task | Depends on | What it does |
|---|---|---|
| TASK-020 | Decision 1 (and 2 for the role field) | `PlanejadorRequestAuthorizer` calling `GET /api/v1/auth/me`: strict bearer parsing, injected fetch, timeout, fail closed (throw on timeout/5xx, TASK-017 maps it to 500), server-only configuration in one module, unconfigured keeps deny-all. If anonymous access is allowed, also defines the anonymous path in the authorization contract. |
| TASK-021 | Decisions 2 and 3 | Authorization policy: explicit allowed-roles constant, Premium rule (plus any Planejador change to expose subscription status), per-route rules if they differ (single vs batch). Produces 403 `AIE_FORBIDDEN`. |
| TASK-022 | Decision 5 | Structured audit of the AIE routes (safe metadata only, correlation id), allow and deny both. |
| TASK-023 | Decision 4 | Rate limit and quotas per identity (shared state across instances), anonymous budget if any, replacing the "per process only" gap. |
| TASK-024 | Decisions 1-4 | CSV upload endpoint reusing the whole ingestion + resolution pipeline behind the same authorization, size and quota rules. |

Affected areas per decision:

- Route guards: Decision 1 (anonymous path), Decision 3 (per-route policy needs the route identity).
- Request authorizer: Decisions 1 and 2.
- UI behavior: Decision 1 (login before the AIE step, or an anonymous flow), Decision 3 (paywall/upsell states), and the
  client must attach the existing access token (`getValidAccessToken()`) to AIE calls.
- Quotas and abuse: Decision 4.
- Backend (Planejador) follow-ups if needed: subscription status in the introspection response (Decision 3);
  the non-UUID `sub` hardening (tracked separately); rate limiting on `/auth/me` because it is a token-validity oracle.

## Out of scope

Any code, any dependency, login/signup UI, cookie/BFF sessions, CSRF, replacing the Planejador identity, acting on
behalf of a client (advisor delegation).
