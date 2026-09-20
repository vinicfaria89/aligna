# TASK-027 - Safe post-login return flow

Status: implemented. It removes the last friction of the `/carteira` flow (TASK-026 left the return to the user) without adding a general
redirect facility.

    /carteira  (no session / expired / 401)
      -> /evolucao?voltar=/carteira
      -> a login that SUCCEEDS on that page
      -> router.replace("/carteira")        (only if "/carteira" is exactly the allow-listed value)

## Allow-list policy

`lib/navigation/safe-return-path.ts` (browser-safe, no environment, no storage):

- `ALLOWED_POST_LOGIN_RETURN_PATHS = ["/carteira"]`. Nothing else is allowed in this task.
- `getSafePostLoginReturnPath(value)` returns the allow-listed literal when `value` is EXACTLY equal to an entry, otherwise `null`.
- `loginHrefReturningTo(path)` builds `/evolucao?voltar=<path>`; its parameter type only admits allow-listed routes.

Exact-match rule, on purpose: the value is compared whole and as-is. There is no `new URL`, no `startsWith`/`includes`/regex, no decoding,
no `trim`, no lower-casing and no normalization (a static test forbids all of them in the file). So absolute URLs, `//host`, `/\host`,
`javascript:`, `data:`, traversal (`../carteira`, `/foo/../carteira`), query or fragment suffixes, a trailing slash, other casing,
percent-encoded or double-encoded lookalikes, Unicode lookalikes, whitespace, control characters, empty, `null` and `undefined` are rejected
simply because they are not equal to `/carteira`. Anything rejected means the existing default behavior.

One thing to know about the framework: `useSearchParams()` returns the value already percent-decoded once, so `?voltar=/%63arteira` reaches
the helper as `/carteira` and is accepted, and `?voltar=%2Fcarteira` too. That is the same allow-listed destination, not a bypass; a
double-encoded spelling (`/%2563arteira`) reaches the helper as `/%63arteira` and is rejected. The helper itself rejects every encoded string.

## When the redirect happens

Only in `handleLogin` of `app/evolucao/page.tsx`, after `loginRequest` succeeded and `saveSession(tokens)` reported that the session was stored:

    const saved = saveSession(tokens);
    const returnTo = getSafePostLoginReturnPath(searchParams?.get("voltar"));
    if (saved && returnTo) { router.replace(returnTo); return; }
    await loadHistory();      // unchanged default

- Without `voltar`, or with an invalid one, the flow is exactly what it was: history is loaded on the same page.
- `saveSession` now returns a boolean (true when localStorage accepted the write). If storage is blocked the page does NOT navigate, because
  `/carteira` would not find the session; it falls back to the default flow. Existing callers ignore the return value.
- The parameter is read with the App Router hook `useSearchParams()`; the page is now a thin `Suspense` wrapper around the previous component
  (required for a statically rendered page that reads the query; `next build` verified `/evolucao` is still static).

## Already-authenticated visit

`/evolucao?voltar=/carteira` with a valid session loads the history as always and does NOT redirect: the parameter is a post-login
destination, not a navigation command. The redirect code lives only inside the login handler, so it cannot fire on load, after
`getValidAccessToken()`, `acquireAccessToken()` or any silent refresh (static tests assert that the session layer never imports
`next/navigation`, mentions `voltar` or the helper, or navigates).

## Login failure

A failed login (wrong password, network error) stays on `/evolucao`, shows the existing message, saves nothing and never navigates. The URL
keeps its `voltar`, so a natural retry still returns to `/carteira` (tested). The existing error handling was not changed.

## /carteira side

The "Entrar" link of the no-session and expired/401 states is `loginHrefReturningTo("/carteira")` = `/evolucao?voltar=/carteira`. Its only
content is that route: no token, file name, CSV, row/candidate id or correlation id (tested with sentinels for all three states). 403, 429, 5xx,
400, 413, 415 and "session unavailable" show no login link at all and never touch the session. The message now says the user comes back to the
page and chooses the file again.

## Why the CSV is not restored

The file, its text, its preview and its result exist only in component memory (TASK-025). After the redirect the page mounts fresh: no file, no
preview, no result, no session call and no request until the user chooses a file and presses "Resolver carteira" (tested; storage stays empty).
Persisting a portfolio to survive a login would need a storage decision (what, where, for how long, who can read it) that is out of scope, and an
automatic resubmission would spend a batch quota slot the user did not ask for.

## push versus replace

`router.replace`. The login form is an intermediate step; with `push`, the Back button from `/carteira` would return to a login form the user has
already completed. With `replace`, the history reads `/carteira` (before) then `/carteira` (after login), so Back goes to the page the user was on.
A plain `window.location` was not needed and is not used.

## Open-redirect test coverage

- `lib/navigation/safe-return-path.test.ts` (49): the exact match; 40 rejected inputs (absolute http/https, `//host`, `/\host`, `javascript:` also
  mixed case, `data:`, query/fragment/nested-redirect suffixes, trailing slash, upper and mixed case, no leading slash, `../` and `/foo/../`,
  `/carteira/../admin`, other routes, sub-routes, percent-encoded and double-encoded, fullwidth and Cyrillic lookalikes, leading/trailing
  whitespace, newline, tab, NUL, zero-width space, empty, whitespace only, `null`, `undefined`); the "returns only an allow-listed literal"
  invariant; the source guard (no URL parsing, matching, decoding, trimming, storage, environment); the link builder; and static checks that only
  `app/evolucao/page.tsx` uses the helper, that the session layer never navigates, and that the page's only navigation call is
  `router.replace(returnTo)` with the helper's result and no `window.location`.
- `app/evolucao/page.test.tsx` (27): default login unchanged; safe return with `replace` (never `push`), after the session was saved, without loading
  the history and with the credentials stored exactly as received and none in the destination; 17 invalid or malicious query strings never navigate
  and keep the default flow; failed login and network failure never navigate; a retry after a failure still returns; blocked storage does not
  navigate; an already-authenticated visit and the load-time session check never navigate; no real network.
- `components/PortfolioCsvResolver.return.test.tsx` (15): the link for no-session, expired and 401; 403/429/500/502/400/413/415/unavailable show none;
  nothing but the route in the link; a fresh mount restores and sends nothing and stores nothing.
- `lib/session.test.ts`: `saveSession` reports whether it stored.
- Existing expectations of the sign-in href in `PortfolioCsvResolver.test.tsx` were updated to the new link.

## Manual verification (local mock of the Planejador, no external request)

- A: `/carteira` with no session -> "Entrar" (href `/evolucao?voltar=/carteira`) -> the URL becomes that; wrong password: stays, existing message, no session
  stored; correct password -> lands on `/carteira`, session stored, no file, no table, no alert, and the mock saw no history request and no resolution.
- B: wrong password: no redirect (above).
- C: `/evolucao?voltar=https://example.com` + valid login: stays on the origin, history loaded (the default flow).
- D: `/evolucao?voltar=//example.com`: same.
- E: already authenticated on `/evolucao?voltar=/carteira`: silent refresh and history load, no redirect.
- F: 390 px: the `/carteira` message with its link and the `/evolucao` form fit with no horizontal overflow.

The embedded browser was driven through the DOM (scripted form input), with two screenshots at 390 px.

## Limitations

- The inline "Entrar" link is a text link (about 18 px tall), like the app's other inline links; it is usable at 390 px but not a large touch target.
- The `/evolucao` form labels are not tied to their inputs (`htmlFor`); pre-existing, not changed here (the tests select the fields by role/type).
- Only `/carteira` can be a return target; any new destination is an explicit one-line addition to the allow-list plus tests.
- The return is not offered after "Sua conta continua conectada" or any 403/429/5xx by design.

## Not implemented

A general redirect framework, arbitrary internal paths, logout return, OAuth callback state, a new login system, middleware, portfolio or CSV persistence,
automatic resubmission, role/Premium UI.
