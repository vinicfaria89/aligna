# TASK-026 - Carteira navigation and real session flow

Status: implemented. No AIE logic was added. It makes `/carteira` reachable from the product and aligns its browser session behavior
with the application's existing Planejador authentication.

    start screen -> /carteira -> lib/session (acquireAccessToken) -> POST /api/aie/resolve-csv
      401 -> existing clearSession -> "Sua sessão expirou" -> existing sign-in (/evolucao)

## Navigation (what was actually found)

There is NO global navigation in the app: no header, sidebar or shared nav component. The only "navigation" is the wizard's progress
`Stepper` (a step indicator, not links) and a text link on the start screen that leads to `/evolucao`. Creating a navigation system was
out of scope, so `/carteira` follows the existing pattern:

- `components/steps/IntroStep.tsx`: a second plain anchor, "Já tenho conta — resolver carteira por CSV" -> `/carteira`, stacked under the
  existing "Já tenho conta — ver minha evolução" link (same classes, same plain `<a>`).
- `app/carteira/page.tsx`: a "← Voltar ao início" link to `/`, so the page is not a dead end.

Consequences, stated plainly: there is no active-link state and no responsive navigation to test because there is no navigation. The
wizard's own layout (a fixed 272 px Stepper next to the content) is not responsive and was not touched. If a real global navigation is
added later, `/carteira` becomes one more entry in it.

## Existing session mechanism (inspected, reused)

- Storage: `localStorage["aligna_session"]` = `{ access_token, refresh_token, token_type }` (`lib/session.ts`). Access token 30 min,
  refresh token 7 days, HS256 JWT, stateless refresh with no rotation and no revocation (TASK-018).
- `refreshTokens()` (`lib/api.ts`) exchanges the refresh token at `POST <planejador>/api/v1/auth/refresh`.
- The existing session helper never inspects the access token (no expiry check, no JWT decoding in the browser). Before this task it
  exchanged the refresh token on EVERY call and treated ANY failure (network error, 5xx, 429 as well as a real rejection) as "expired",
  clearing the session.
- Sign-in lives in `/evolucao` (an inline form calling `login()` then `saveSession()`); there is no separate login page and none was created.

## Change to lib/session.ts (a real defect, fixed narrowly)

`getValidAccessToken()` wiped a valid 7-day session on any transient failure (a Planejador outage or a dropped connection), and its `null`
could not tell "no session" from "expired" from "identity service down". Relevant here because /carteira must not log the user out on a
backend hiccup. Now:

- New `acquireAccessToken(): Promise<SessionAccess>` returns `ok` (token just issued), `none` (nothing stored, or a stored value without a
  usable refresh token, which is cleared), `expired` (the refresh token was refused with a definitive 4xx, other than 408 and 429, and the
  local session was cleared through the existing `clearSession`) or `unavailable` (network failure, 5xx, 408, 429, malformed body: the
  stored session is left untouched).
- `getValidAccessToken()` keeps its `string | null` contract (`/evolucao` is unchanged) by delegating to it; the only behavior difference is
  that a transient failure no longer clears the session.
- No new token store, refresh mechanism, login client, cookie or JWT parsing.

## Token acquisition and refresh

`submitPortfolioCsv` receives `getSession` (in the app, `acquireAccessToken`) and calls it ONCE per submission, right before the request. Since
the helper exchanges the refresh token on every call, the token it returns was issued a moment earlier (the manual run showed exactly one
refresh and one identity check per submit, and the stale stored access token was replaced). Nothing is asked of the session while the user
only chooses, previews, replaces or clears a file, or when the local CSV is invalid. The component never reads storage and never holds the
token: it lives in the client function's local scope and goes only into the `Authorization: Bearer` header.

| Session result | Request sent? | UI |
|---|---|---|
| `ok` | yes, once | normal outcome |
| `none` | no | "Entre na sua conta para continuar." + link to the existing sign-in |
| `expired` | no | "Sua sessão expirou." + link to the existing sign-in |
| `unavailable` | no | "Não foi possível verificar sua sessão agora. Sua conta continua conectada..." (no link, session kept, file kept) |

## 401 recovery (decision)

There is NO refresh-and-retry. The session helper already exchanges the refresh token immediately before every request, so a 401 means the
server refused a token that was issued a moment ago; a second refresh would only repeat the same exchange and the same rejection (for
example an inactive account). Retrying would add a duplicate refresh and a second batch submission for no recovery. Therefore a 401 from
`/api/aie/resolve-csv`:

1. calls the existing `clearSession()` exactly once (best effort; a throwing storage does not change the outcome);
2. removes any previous result from the screen (results only render for a success);
3. shows "Sua sessão expirou. Entre novamente..." with the link to the existing sign-in;
4. never resubmits by itself. The user must act again; a new attempt asks the session again from scratch.

There is no loop: one session lookup and one request per user action (tested).

## 401 versus 403 (kept apart)

- 401 = not authenticated: end the local session, ask to sign in again.
- 403 = authenticated but not allowed the batch capability: neutral "Sua conta não tem acesso à resolução de carteiras em lote.", no
  link, no refresh, no retry, the session is NOT cleared, and the copy does not mention Premium, plans or billing.
- 429 keeps the session and the Retry-After copy, 5xx keeps the session and the "Referência para suporte: <correlation id>" line, validation
  errors and network failures never touch the session (all tested in `resolve-csv-client.test.ts` and the component test).

## After sign-in

(Update, TASK-027: the "Entrar" link now goes to `/evolucao?voltar=/carteira` and a successful login returns to `/carteira` through an exact-match
allow-list; see `TASK-027-safe-post-login-return.md`. The text below describes the state at TASK-026.)

The sign-in form is `/evolucao`, which loads the evolution history after login and has no "return to" parameter. The user comes back to
`/carteira` with the "Voltar" link or the address and chooses the file again (the file is never persisted, by design; the message says so).
No automatic resubmission. A `return` parameter would need an allow-list to avoid an open redirect and a change to `/evolucao`; left out on
purpose.

## Token privacy

The token never appears in a URL (only the opaque `fileId` does), the request body, the DOM, an outcome object, an error message, storage
written by the UI or the console. The client and the component contain no `refresh_token`, `refreshTokens`, `/auth/`, `atob`, `JSON.parse`
or JWT-library reference (static test), and the outcome objects are asserted free of the token and the Authorization header for every
status.

## Client/server boundary

Unchanged and guarded. The only new import is the TYPE `SessionAccess` from `lib/session` (browser-safe; `lib/session` and `lib/api` are already
used by the wizard). Nothing under `lib/aie/server`, providers, policy or infrastructure enters the client graph.

## Tests (all offline)

- `lib/session.test.ts` (new, 14): no session; refresh success; new pair stored and the stale token gone; refused refresh (400/401/403/404/422)
  clears and reports `expired`; transient failures (network, 5xx, 408, 429, bad body) keep the session; unusable stored values; unreadable and
  throwing storage; failure to save still returns the token; opaque tokens are never inspected; concurrent calls are not coalesced (documented);
  the `getValidAccessToken` contract; blocked storage on clear.
- `lib/aie/client/resolve-csv-client.test.ts`: no session / expired / unavailable send nothing; the session is asked once and its token is the one
  sent; 401 clears once with no retry; a throwing clear still ends unauthenticated; only 401 touches the session; a network failure neither clears nor
  retries; no outcome carries the token.
- `components/PortfolioCsvResolver.test.tsx` (session flow block, 16 more): direct visit makes no call; no-session and expired states with the sign-in
  action; one request with the token only in the header; the freshly issued token, never a stale one; unavailable keeps the session and the file;
  401 clears once, no retry, no loop, no stale result, no automatic resubmission, explicit retry works; 403/429/500 do not clear or refresh; no token in
  any error state; malformed CSV, replacing and clearing a file never touch the session; a double click makes one session call and one request.
- `components/steps/IntroStep.test.tsx` (new, 5): the start-screen link, keyboard-reachable anchor, unchanged start action, the way back from `/carteira`,
  `/carteira` makes no request at load.
- `lib/aie/client/client-boundary.test.ts`: the component uses `acquireAccessToken`/`clearSession`; no second auth client or JWT parsing.

## Manual visual verification

Against the real dev server with a local stand-in for the Planejador (no real data, no secret; nothing left the machine), with a scripted CSV
of three assets and no `id`, `fileId` or `row`:

- A authenticated: one refresh, one identity check, one submit; results rendered; the stale stored token replaced.
- B no session: message with the sign-in link, no request to the Planejador at all.
- C refresh refused: "Sua sessão expirou.", storage cleared, the previous result gone, no request sent.
- Real 401 (identity check answers 401): one refresh, one identity check, one request, session cleared, same expired state, no retry.
- Identity service down at refresh (503): "Sua conta continua conectada", session kept.
- D 403: neutral access message, session kept. E 429: "cerca de 48 segundos", session kept (six submissions consumed the batch quota first).
- F 500: generic message and a readable "Referência para suporte: <uuid>", session kept.
- G mobile 390 px and H desktop (1100 px): no horizontal page overflow in any state (scrollWidth equals the viewport), alerts fully readable, no token in the DOM.

Environment note: screenshots from the embedded browser pane were flaky (timeouts and tiled captures); states were confirmed through the DOM
and the stand-in's request log, plus screenshots of A, C, the 500 and the 390 px 401.

## Limitations found (not fixed here)

- The session helper exchanges the refresh token on every call and cannot coalesce concurrent calls. Harmless today (stateless refresh, one
  submission at a time in this UI, separate pages elsewhere) but two tabs or a future rotating refresh token would need a shared refresh.
- The refresh token lives in `localStorage` for 7 days, is not rotated and cannot be revoked (TASK-018); this task did not change that.
- The wizard's fixed-width Stepper layout is not mobile-friendly (pre-existing).
- No "return to" after signing in through `/evolucao`.
- The preview table scrolls horizontally inside its card at 390 px (TASK-025); the results view stacks as cards.
- The batch quota is per process (TASK-023), so the 429 shown here is what one server process reports.

## Not implemented

A global navigation, a login page, cookies/BFF, token migration, paywall, roles/Premium UI, analytics, persistence, PDF/OCR.
