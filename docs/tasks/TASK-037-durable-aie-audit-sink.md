# TASK-037 - Durable AIE audit sink (Planejador-backed)

Status: implemented. Closes the gap TASK-022 documented and left open: "No audit record is stored anywhere yet." Policy
source: `TASK-019-aie-access-policy.md`, Decision 5 (audit required). Cross-repo: this file covers the Aligna side; the
Planejador side is `docs/aie-audit-events.md` in that repository.

## Why this task exists

Picking up TASK-019/020 to actually turn on the AIE (setting `PLANEJADOR_AUTH_BASE_URL` in Vercel) was about to happen
with no durable audit trail: TASK-022 built the audit CONTRACT and the emission points, but its sink was, and had to
stay, a no-op -- "The repository has no established audit storage or structured logging mechanism and none was
invented," and console logging was explicitly ruled out ("deliberately none"). The approved policy requires auditing;
shipping real AIE access without it would contradict that policy. This task closes exactly that gap, nothing else.

## What changed

- **`lib/aie/server/planejador-audit-sink.ts`** (new): `createPlanejadorAuditSink({ baseUrl, secret, fetch? })` builds
  an `AieAuditSink` whose `write(event)` does `POST <baseUrl>/api/v1/aie-audit-events` with the event as JSON and a
  fixed `X-Aie-Audit-Secret` header. It reads no environment itself (the composition module does that) and never reads
  the response body -- a non-2xx answer throws a fixed-message error for the existing swallow-and-continue policy in
  `aie-audit.ts` to catch; the secret never appears in that error.
- **`lib/aie/server/create-server-audit-sink.ts`** (rewritten): was `NOOP_SINK` unconditionally; now reads two
  server-side-only variables -- `PLANEJADOR_AUTH_BASE_URL` (the same one `create-server-authorizer.ts` uses; the audit
  endpoint lives on the same Planejador) and `AIE_AUDIT_SHARED_SECRET` (new) -- and returns the Planejador-backed sink
  only when BOTH are present and the base URL is valid (`parsePlanejadorBaseUrl`, reused from the authorizer module).
  Missing or invalid configuration returns the TASK-022 no-op sink, same as before. Memoized per process, same shape as
  `getServerAuthorizer()`.
- **`.env.example`**: documents `AIE_AUDIT_SHARED_SECRET` as an empty server-side placeholder, right after
  `PLANEJADOR_AUTH_BASE_URL`.

## Fail SAFE, not fail closed (deliberately the opposite of the request authorizer)

`create-server-authorizer.ts` fails CLOSED: unset/invalid configuration means deny-all, because an authorization gap is
a security hole. `create-server-audit-sink.ts` fails SAFE (open) in the opposite sense: unset/invalid configuration
means "no audit event is stored," never "the AIE stops working." This was already the TASK-022 policy ("audit
unavailability does NOT make the AIE unavailable") and does not change here -- this task only replaces WHAT the sink
does when it is configured, not the swallow-on-failure behavior at the call site (`aie-audit.ts`'s `createAuditRecorder`
already races every `write` against a bounded 1 s timeout and swallows a throw, a rejection or a late answer; this sink
adds nothing on top of that).

## Authentication: a new, narrow, dedicated secret

The Aligna-to-Planejador call is server-to-server, not a user request, so it cannot use the caller's Bearer token (that
token authenticates a USER to the Planejador, not the Aligna server to the Planejador) and must not reuse the JWT
HS256 signing secret (sharing that was explicitly rejected in TASK-018, precisely to avoid a second thing that can mint
valid tokens). `AIE_AUDIT_SHARED_SECRET` is a new secret with exactly one purpose -- write access to
`POST /api/v1/aie-audit-events` -- easy to rotate independently of anything else, and it exists identically configured
on both sides (an env var here, `Settings.AIE_AUDIT_SHARED_SECRET` there, compared with `hmac.compare_digest`, never a
plain `==`, on the Planejador side).

## What is audited (unchanged from TASK-022)

Same contract, same fields, same prohibitions: correlation id, UTC timestamp, the fixed operation literal, stage,
outcome, decision (authorization stage only), HTTP status, and an optional subject (the Planejador's own user id) --
never a token, header, `CandidateAsset` value, CPF, account number, role or entitlement. This task does not touch
`aie-audit.ts`, `aie-audited-request.ts`, `request-authorization.ts` or either route's HTTP handler.

## Tests

- `lib/aie/server/planejador-audit-sink.test.ts` (new): the request shape (method, URL, headers, body, `cache:
  "no-store"`), a non-2xx answer throws without reading the body, the secret never leaks into a thrown error, the
  default fetch is used when none is injected.
- `lib/aie/server/create-server-audit-sink.test.ts` (new, mirrors `create-server-authorizer.test.ts`): no-op when
  either variable is unset or the base URL is invalid, never touches the network in that case; selects the
  Planejador-backed sink only when both are valid; accepts an injected fetch; `getAieAuditSink()` is memoized (a later
  environment change does not change an already-chosen sink); importing the module performs no network request on its
  own.
- `lib/aie/server/create-server-authorizer.test.ts` (updated): the static guard that pinned "only
  create-server-authorizer.ts reads `PLANEJADOR_AUTH_BASE_URL`" now expects both that file and
  `create-server-audit-sink.ts` (sorted); the "never in the browser barrel" guard now also checks
  `create-server-audit-sink`/`planejador-audit-sink`.
- `lib/aie/server/aie-audit.test.ts` (updated): `create-server-audit-sink.ts` removed from the generic "reads no
  environment, no network" static-guard file list (it is now the one audit module allowed to do both, exactly like
  `create-server-authorizer.ts` is the one authorizer module allowed to); the no-op production-sink test renamed to say
  "when the durable-sink env vars are unset" instead of implying it is always the case.

## Validation

- `npx tsc --noEmit`: sem erros.
- `npx vitest run lib/aie/server/create-server-audit-sink lib/aie/server/planejador-audit-sink lib/aie/server/create-server-authorizer lib/aie/server/aie-audit`: 101 passed, 6 files.
- `npx vitest run` (suíte completa): ver relatório da task.

## Out of scope (still open)

- **90-day retention/deletion job** (TASK-019's retention target): explicitly deferred by product decision when this
  task was scoped. `received_at` (the Planejador's own clock, not the Aligna-supplied `timestamp`) is the field the
  eventual purge job must key off -- already indexed on the Planejador side for that.
- Turning the AIE actually ON in production (setting `PLANEJADOR_AUTH_BASE_URL` in Vercel) -- that is the next step
  after this one lands, not part of it.
- A dashboard, alerting, or any read/query path over the audit events -- nothing reads this table yet; it is
  write-only from the Aligna's perspective.
- LGPD/legal review of the retention period, and of `subject` as a personal-data identifier needing an owner and
  restricted access -- unchanged from TASK-022's own caveat.
