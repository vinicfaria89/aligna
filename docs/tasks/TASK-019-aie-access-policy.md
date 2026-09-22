# TASK-019 - AIE Access Policy

Status:

- [x] Drafted (options, context and consequences written)
- [x] Product decisions recorded (MVP policy, conservative)
- [x] **Approved** (decisions given by the product owner in chat on 2026-09-19; re-open to change any of them)

This task writes NO code. It records the explicit access policy that the authorizer (TASK-020) and the policy task
(TASK-021) implement, so nothing is built on assumptions. Legal/LGPD review of the retention period is still recommended
(see Decision 5).

## Policy summary

| # | Decision | Outcome |
|---|---|---|
| 1 | Anonymous access | **A - not allowed.** Every AIE route requires authentication. |
| 2 | Roles | `cliente`, `assessor` and `administrador` may all use the AIE. |
| 3 | Premium | **C - Premium only for batch.** Single-asset resolution: any authenticated allowed role. Batch: requires Premium. |
| 4 | Anonymous limits | Not applicable (no anonymous access in this version). |
| 5 | Auditing | Required. 90 days initial retention. Safe metadata only. |
| 6 | Planejador `/auth/me` unavailable | **A - fail closed.** No local JWT verification, no cache of "allowed". |

## Context (facts, from TASK-017 and TASK-018)

- The AIE routes `POST /api/aie/resolve-asset` and `POST /api/aie/resolve-assets` are fail-closed today: every request
  gets 401 until a real `AieRequestAuthorizer` is provided (TASK-017).
- Identity already exists in the Planejador backend (users, roles `cliente` / `assessor` / `administrador`, JWT, Stripe
  Premium subscriptions). `GET /api/v1/auth/me` (Planejador commit `3fb6443`) returns `{ id, role, is_active }` for a
  valid access token; it does NOT return subscription/entitlement information yet.
- Public registration exists and always creates a `cliente`: being authenticated is a low bar, which is why the roles
  decision is deliberately paired with the Premium gate on the heavier operation.
- Each AIE call can trigger ANBIMA traffic (documented limit 15 requests/s per credential). The feed cache and limiter
  are per process (TASK-015).
- No UI calls the AIE routes yet.

## Decision 1 - Anonymous access

Can an unauthenticated user use the AIE?

Options:

- [x] No (authentication required for every AIE route)
- [ ] Yes, single asset only (`resolve-asset`)
- [ ] Yes, batch allowed (`resolve-assets`)

Decision:

No anonymous access in this version.

Rationale:

The AIE can trigger external sources and processes financial data; starting authenticated reduces abuse and avoids
creating a second, weaker identity policy (an anonymous principal) now. If the commercial funnel later needs a
demonstration without an account, it is treated as its own flow with its own limits, not as a relaxation of this policy.

Consequence: the authorization contract needs no anonymous path; missing or invalid credentials are simply
`unauthenticated`.

---

## Decision 2 - Roles

Which authenticated roles may use the AIE?

Allowed roles:

- [x] cliente
- [x] assessor
- [x] administrador

Different roles per route (single vs batch)?

- [x] No, same roles for both routes
- [ ] Yes (describe below)

Decision:

All three authenticated roles may use the AIE.

Rationale:

Role differences belong to product permissions, not to basic identity. Acting on behalf of a client (advisor delegation)
is a different requirement and is not modelled here.

Consequence: the allowed-roles list is an explicit constant in Aligna. A role value the Aligna does not recognize is
`forbidden` (never silently allowed).

---

## Decision 3 - Premium

Is a Premium subscription required?

Options:

- [ ] No (any allowed authenticated role)
- [ ] Yes (all AIE routes)
- [x] Only for batch

Decision:

Premium is required only for `resolve-assets` (batch). `resolve-asset` (single) is available to any authenticated user
with an allowed role.

Rationale:

Batch consumes more resources and has higher operational value; the single asset keeps the free diagnosis usable.

Consequences (intentional):

- The Aligna must know whether the user is entitled to batch. It must not query Stripe or know what a subscription,
  plan, price or `past_due` is. The Planejador stays the product authority and exposes a stable entitlement in
  `/auth/me`, for example:

      {
        "id": "...",
        "role": "cliente",
        "is_active": true,
        "entitlements": { "aie_batch": true }
      }

  The Planejador decides how `aie_batch` is derived from its subscription rules (including what to do with `past_due`).
- The authorizer must know which operation is being authorized (single vs batch): see TASK-020/TASK-021.
- Until the entitlement exists and is enforced (TASK-021), the batch route must stay denied (see TASK-020).

---

## Decision 4 - Anonymous limits

Not applicable: there is no anonymous access in this version.

Deferred to TASK-023 (authenticated callers): per-identity quota and a maximum batch size below the service maximum
(100), if wanted. Until then only the existing limits apply (service batch maximum 100, concurrency default 3 / max 10,
per-process ANBIMA limiter). CAPTCHA: not applicable.

---

## Decision 5 - Auditing

Is an audit trail required?

- [ ] No
- [x] Yes

Retention: 90 days (initial operational policy).

Store (safe metadata only):

- [x] subject (authenticated user id)
- [x] endpoint / operation
- [x] timestamp
- [x] decision (allow / deny) with the outcome status
- [x] request correlation id

Never store:

- [x] tokens (bearer or refresh) or passwords
- [x] ANBIMA credentials or tokens
- [x] full portfolio
- [x] raw CandidateAsset (or any part of an asset's values)
- [x] CPF / account numbers

Decision:

Audit is mandatory for the AIE routes, for both allowed and denied requests, with the fields above and nothing else.

Rationale:

Security accountability without keeping financial payloads. The 90 days are an initial OPERATIONAL policy, not a claim
of regulatory obligation; it can be revised with legal/LGPD. The user id is a personal-data identifier, so the log needs
an owner and restricted access.

Implementation: TASK-022 (batch item count is allowed as metadata; the items are not).

---

## Decision 6 - Planejador `/auth/me` unavailable

If the Planejador cannot answer the introspection request (timeout, network error, 5xx, malformed answer), what does the
AIE do?

Options:

- [x] A) Fail closed: deny access (the authorizer throws and TASK-017 answers 500 `AIE_AUTHORIZATION_ERROR`; no request is
  processed)
- [ ] B) Allow using local information or a cache

Decision:

Fail closed.

Rationale:

The Aligna does not authorize the AIE when it cannot ask the identity authority. It uses no local JWT verification (that
would need the shared HS256 secret, rejected in TASK-018) and NO cache of "allowed" answers, because a cache could keep
honoring a user after deactivation or a role/entitlement change. Consequently the AIE is unavailable while the Planejador
is down; that is accepted.

Clarification: this also rules out a short-lived "allowed" cache as an optimization for now. If load on `/auth/me` ever
justifies one, it is a new decision, and it must never serve answers during an outage.

---

## Consequences

Work is sequenced as follows (each item is a separate task):

| Task | Depends on | What it does |
|---|---|---|
| TASK-020 | Decisions 1, 2, 6 | `PlanejadorRequestAuthorizer` calling `GET /api/v1/auth/me`: authentication required, the three roles accepted for single asset, fail closed on any Planejador failure, no cache. Batch stays denied until TASK-021 (see `TASK-020-planejador-request-authorizer.md`). |
| TASK-021 | Decision 3 | Premium-only-for-batch: Planejador exposes `entitlements.aie_batch` in `/auth/me` (separate backend change), Aligna enforces it per operation. |
| TASK-022 | Decision 5 | Structured audit of the AIE routes (safe metadata, correlation id, 90 days). |
| TASK-023 | Decision 4 (deferred part) | Rate limit and quotas per identity (shared state across instances). |
| TASK-024 | Decisions 1-3 | CSV upload endpoint reusing the whole ingestion + resolution pipeline behind the same authorization, size and quota rules (batch semantics, so Premium). |

Affected areas:

- Request authorizer: it must receive the operation (single vs batch).
- UI behavior: login before the AIE step; a paywall/upsell state for batch; the client attaches the existing access token
  (`getValidAccessToken()`).
- Backend (Planejador): `entitlements.aie_batch` in `/auth/me` (TASK-021); rate limiting on `/auth/me` (token-validity
  oracle); the non-UUID `sub` hardening (tracked separately).

## Out of scope

Any code, any dependency, login/signup UI, cookie/BFF sessions, CSRF, replacing the Planejador identity, acting on
behalf of a client (advisor delegation), anonymous or demo access.
