# TASK-021 - AIE batch entitlement authorization

Status: implemented. Policy source: `TASK-019-aie-access-policy.md` (Decision 3, "Premium only for batch"). Identity and
entitlement source: Planejador `GET /api/v1/auth/me` (Planejador commit `44db93c`, `entitlements.aie_batch`).

## Rule

    resolve-asset   (single)  -> authenticated + active + allowed role                         -> authorized
    resolve-assets  (batch)   -> authenticated + active + allowed role + entitlements.aie_batch === true -> authorized
                                 otherwise                                                     -> forbidden (403 AIE_FORBIDDEN)

- Single asset requires authentication only; the entitlement is ignored for it.
- Batch is authorized ONLY when the answer carries `entitlements.aie_batch` and it is exactly the boolean `true`.
- The roles accepted are unchanged (`cliente`, `assessor`, `administrador`). The order of the checks is: valid answer, then
  `is_active` (false => 401), then role (unknown => 403), then the operation/entitlement (batch without it => 403).

## Answer handling

| Answer from `/auth/me` | Single asset | Batch |
|---|---|---|
| `entitlements: { aie_batch: true }` | authorized | authorized |
| `entitlements: { aie_batch: false }` | authorized | 403 |
| `entitlements: {}` or `aie_batch` absent | authorized | 403 |
| no `entitlements` at all (legacy Planejador) | authorized | 403 |
| `aie_batch` present and not a boolean (`"true"`, `1`, `0`, `null`, `{}`, `[]`) | infrastructure error | infrastructure error |
| `entitlements` present and not an object (`null`, `[]`, string, number, boolean) | infrastructure error | infrastructure error |

- Missing information is "not entitled", never a server error. This keeps rolling deployments safe: the Aligna can be
  deployed before every Planejador instance exposes `entitlements`; single-asset resolution keeps working and batch is
  simply denied.
- Structurally wrong data is a broken upstream contract, so it is NOT interpreted as a permission decision. The authorizer
  throws the existing safe `PlanejadorAuthorizationError` and the route answers `500 AIE_AUTHORIZATION_ERROR` (fail
  closed; nothing is resolved). Values are never coerced, and the error carries no value.
- The malformed check applies to every operation, including single asset: the answer is invalid as a whole.

## Where the entitlement lives

- It is consumed inside `PlanejadorRequestAuthorizer` and nowhere else. `AieRequestPrincipal` is unchanged (`subject`,
  `roles?`); the entitlement is not in the principal, `CandidateAsset`, `ProviderQuery`, `AssetEvidence`,
  `ResolutionResult`, ANBIMA calls, logs or any HTTP success body. Static tests pin that no other production source
  mentions it and that the principal interface is still exactly those two fields.
- The raw `/auth/me` answer is not logged.

## Planejador stays the authority

The Aligna evaluates a single boolean. It does not know Stripe, subscription status, plan, price, `past_due` semantics,
billing rules, or the role exception the Planejador applies (today `assessor` and `administrador` receive
`aie_batch = true` there, `cliente` only with an active subscription). No role bypass exists in the Aligna: an
`administrador` whose answer says `aie_batch: false` gets a 403 on batch. A static test asserts the authorizer source
contains no billing vocabulary and mentions `aie_batch` only where it reads it.

## Changes

- `lib/aie/server/planejador-request-authorizer.ts`: `Identity.batchEntitled`, `parseBatchEntitlement`, and the
  operation check now uses it (any operation other than the two known literals is still denied). The temporary
  "batch is forbidden for everyone" rule from TASK-020 is gone.
- Tests: the two TASK-020 assertions that pinned the temporary deny were replaced (legacy answers still deny batch;
  `aie_batch: true` now authorizes it); new unit tests for the whole matrix above and the static guards; a new offline
  integration file with the real route, the real authorizer, a fake `/auth/me` and the real resolution.
- No change to the HTTP handlers, the AIE domain, providers, the ANBIMA client, `AieRequestPrincipal` or the
  configuration.

## Limitations

- No caching: each request calls `/auth/me` (TASK-019 Decision 6), so the entitlement is as fresh as the Planejador.
- A Planejador that has not been updated denies batch for everyone until it exposes `entitlements`.
- No paywall/upsell UI and no client attaching the bearer yet.
- Audit (TASK-022) and per-identity rate limits and quotas (TASK-023) are still to do.
