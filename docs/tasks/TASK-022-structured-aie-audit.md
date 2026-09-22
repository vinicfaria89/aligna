# TASK-022 - Structured AIE audit trail

Status: implemented as a CONTRACT plus emission points. **No audit record is stored anywhere yet.** Policy source:
`TASK-019-aie-access-policy.md`, Decision 5 (audit required; 90 days retention target; safe metadata only).

This document does not claim LGPD or compliance-grade auditing. It fixes what is audited, where events are emitted and how
a sink is plugged in; durable storage and retention enforcement are future work.

## Architecture

    route -> handler -> handleAieRequest (aie-audited-request.ts)
               |            1. evaluateAuthorization      -> [authorization event]
               |            2. (authorized) execute()     -> [execution event]
               |            3. response + X-Correlation-Id
               '-- the authorizer knows nothing about auditing; the sink never sees a request, token, principal or result

- `aie-audit.ts`: the generic contract (event types, `AieAuditSink`, recorder, correlation id, clock seams). No
  environment, no network, no console, no filesystem, no provider/domain imports; it imports only a TYPE from the
  authorization module.
- `create-server-audit-sink.ts`: `getAieAuditSink()`. Today it returns a no-op sink (see "Persistence status").
- `aie-audited-request.ts`: the single orchestration shared by both routes. It is the only place that connects the
  authorizer to the sink.
- `request-authorization.ts`: gains `evaluateAuthorization` (outcome + safe response + optional subject). The old
  `requireAuthorization` remains and is built on it. The principal and its roles still never leave the module.
- `resolve-asset-http.ts` / `resolve-assets-http.ts`: their handlers delegate to `handleAieRequest`; the validation and
  resolution code is unchanged.
- `fake-aie-audit-sink.ts`: in-memory sink for tests only (unbounded; never for production).

## Event schema

Two stages per request. Both events of a request share one `correlationId`.

Authorization event (exactly one per request, emitted before any body parsing or provider work):

| Field | Meaning |
|---|---|
| `correlationId` | server-generated random UUID |
| `timestamp` | UTC ISO-8601 (`toISOString()`, injectable clock) |
| `operation` | `"resolve-asset"` or `"resolve-assets"`, a fixed literal chosen by the route |
| `stage` | `"authorization"` |
| `outcome` | `authorized` / `unauthenticated` / `forbidden` / `authorization-error` |
| `decision` | `allow` (authorized) or `deny` (all others; an authorizer failure is a deny, fail closed) |
| `status` | HTTP status of a denial (401 / 403 / 500); absent when authorized |
| `subject` | only when the caller is identified (see below) |

Execution event (only when the request was authorized):

| Field | Meaning |
|---|---|
| `correlationId`, `timestamp`, `operation`, `subject` | as above |
| `stage` | `"execution"` |
| `outcome` | `completed` (2xx) / `validation-error` (4xx: 400, 413, 415) / `configuration-error` (503) / `internal-error` (other) |
| `status` | HTTP status returned |

No other field exists (a test pins the type's fields and the keys of every emitted event). In particular there is no
roles field, no entitlement, no provider names, no batch size or item count: a batch of 7 assets and a batch of 1 produce
identical events.

## Correlation id

Always generated on the server (`crypto.randomUUID()`, never `Math.random`). An incoming `X-Correlation-Id` is ignored, not
trusted and not echoed. The id encodes nothing: no subject, token, asset, account or financial data. It is returned on
EVERY AIE response as `X-Correlation-Id`, including 200, 400, 401, 403, 413, 415, 500 and 503, next to the unchanged
`Cache-Control: no-store` and JSON headers.

## Subject handling

- Unauthenticated callers (missing/invalid credential, inactive user) have NO subject.
- An authorized caller's subject is the identifier from the principal (the Planejador user id).
- An identified but denied caller (forbidden role, missing batch entitlement) carries its subject on the denial:
  `AieAuthorizationResult` gained an optional `subject` on denials, set by `PlanejadorRequestAuthorizer` only for those
  identity-based `forbidden` results. A `403` answered by the identity service itself has no subject.
- A subject is accepted only if it is a plain identifier (bounded, no whitespace or control characters); otherwise it is
  dropped from the event.
- Roles are not recorded (TASK-019 asks for subject, operation, timestamp, allow/deny and correlation id only).

## Prohibited in the audit

Bearer or refresh tokens, the Authorization header, cookies, ANBIMA credentials or tokens, `CandidateAsset` values
(`rawName`, `instrumentCode`, amounts, institution names), portfolio contents, CPF or account numbers, roles, the
`entitlements` or `aie_batch` data, the raw `/auth/me` answer, provider evidence, error messages or stacks, batch sizes.
Enforced by: the closed event type, key-whitelist tests, sentinel tests (bearer, ANBIMA secret and token, raw name,
instrument code, amount, CPF) across every outcome, and static guards over the audit modules (no environment, network,
console, filesystem, provider/domain imports, or references to headers, `rawName`, `instrumentCode`, `hints`, `amount`,
`principal`, `roles`).

## Sink abstraction

    interface AieAuditSink { write(event: AieAuditEvent): Promise<void> }

The sink receives a frozen copy of the event, so it cannot alter what the audit layer holds, and it is passed nothing else:
no request, response, token, principal, roles or resolution result (a test proves results are identical with a
tampering sink). Handlers accept `{ audit: { sink, now, generateCorrelationId, writeTimeoutMs, onSinkFailure } }` as test
seams; production uses `getAieAuditSink()`.

## Sink failure policy (decided here; TASK-019 defined no storage-failure semantics)

Auditing is BEST EFFORT and NEVER changes a decision:

- A sink that throws synchronously, rejects, or hangs (bounded wait, default 1 s) is swallowed; a late rejection of an
  abandoned write is also swallowed.
- A denied request stays denied. An allowed request continues. The response is byte-identical to the one produced with a
  healthy sink (tested for authorization-stage and execution-stage failures, for both routes).
- Nothing about the failure reaches the response or the event: the optional `onSinkFailure` hook receives only
  `{ stage }`, never the error, the event or the subject.
- Consequence: audit unavailability does NOT make the AIE unavailable. If product/compliance later requires
  fail-closed auditing (deny when the record cannot be written), that is a new decision that changes this policy.

## Persistence status and retention

- Production sink: NO-OP. The repository has no established audit storage or structured logging mechanism and none was
  invented. Events are currently dropped after being handed to the no-op sink.
- Retention target from TASK-019: 90 days. It is a POLICY TARGET and is NOT enforced: with no durable storage there is
  nothing to retain or delete. It becomes enforceable only once a durable store and a retention job exist.
- The user id is a personal-data identifier: the eventual store needs an owner, restricted access and a retention/deletion
  mechanism reviewed with legal/LGPD.

## Future durable storage integration

Replace the sink returned by `getAieAuditSink()` (and only that). Routes, handlers, authorizers and the event contract
stay unchanged. Things that will be needed then: the storage choice, an owner and access control, a retention/deletion
job for 90 days, a decision on fail-closed vs best-effort writes, and monitoring of `onSinkFailure`.

## Changes to existing behavior

- Every AIE response now carries `X-Correlation-Id` (new header); bodies, statuses and other headers are unchanged.
- `AieAuthorizationResult` denials may carry an optional `subject` (used only for audit).
- Existing tests were adjusted only where they pinned shapes: the handlers' import lists, `request-authorization.ts`'s
  import list, and the expectations of the Planejador authorizer's identity-based `forbidden` results (now including the
  subject). The static guard that pins "no other code mentions the batch entitlement" now ignores comments.

## Out of scope

Database audit table, external log vendor, SIEM, the 90-day deletion job, dashboards, alerting, per-user quotas and rate
limiting (TASK-023), console logging (deliberately none).

## Update (TASK-023)

The execution stage gained two outcomes, ate-limited (status 429) and usage-control-error (status 500), for requests that were authorized but not executed because of the identity usage control. No new field or stage was added. See TASK-023-aie-identity-rate-limits.md.
