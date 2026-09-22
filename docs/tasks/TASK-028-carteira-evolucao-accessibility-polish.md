# TASK-028 - Carteira and Evolucao UX / accessibility polish

Status: implemented. UI only: `lib/aie`, `lib/session`, authorization, rate limits, API routes, authentication semantics, refresh behavior,
CSV parsing and the server contracts are untouched (static tests pin the import lists of the touched UI files).

## What was fixed

1. `/evolucao` form labels were not tied to their inputs.
2. The "Entrar" action from `/carteira` was an 18 px inline text link.
3. The CSV preview scrolled horizontally at 390 px.
4. (Found during the visual check) the table header was invisible on desktop, in the preview I had just changed and, already since TASK-025,
   in the results table: see "Header visibility defect".
5. (Found during the visual check) buttons had no visible keyboard focus: the default outline is white on the app's light background.

## /evolucao form

- `E-mail` label `htmlFor="login-email"` -> `<input id="login-email" type="email" autoComplete="email">`.
- `Senha` label `htmlFor="login-password"` -> `<input id="login-password" type="password" autoComplete="current-password">`.
- Text, types, classes, `value`/`onChange`, the disabled rule (both fields required), and `handleLogin` are unchanged. The `autocomplete` hints are new
  (WCAG 1.3.5; they only let the browser/password manager fill the right field).
- A failed login is announced: the existing error paragraph now has `role="alert"` (same text). The loading line is `role="status"`; the submit button has
  `aria-busy` while signing in and keeps its "Entrando..." text; decorative icons are `aria-hidden`.
- No `<form>` element was introduced: Enter in a field does not submit (unchanged behavior, see limitations).

Accessible selectors used by the tests: `getByLabelText("E-mail")`, `getByLabelText("Senha")`, `getByRole("button", { name: "Entrar" })`, `getByRole("alert")`.
The evolucao tests from TASK-027 were moved from `getByRole("textbox")` / `input[type=password]` to these label queries, which is the direct proof of the association;
the new tests also assert that each `<label for>` equals its input id, that the ids differ, and that clicking a label focuses its field.

## "Entrar" from /carteira

Still a real `<a>` with `href="/evolucao?voltar=/carteira"` (no tabindex, no role, no click handler). It now follows the explanation paragraph on its own line and is styled with the
app's `.btn-primary` (inline-flex, rounded-full, `py-3`) plus `min-h-[44px] justify-center`. Measured in the browser: 44 px high, 89 px wide, at 390 px and on desktop, for the no-session and the
expired-session states (same link for a 401). 403, 429, 5xx and the other states still show no login link.

## Focus

`lib/ui/focus-ring.ts` exports `FOCUS_RING` (`focus-visible:` outline-none + 2 px `aria-mid` ring with a 2 px offset), applied per element to: the "Entrar" link, "Resolver carteira", "Limpar" (`/carteira`)
and the `/evolucao` submit button. Inputs keep the app's own `.input:focus` ring (border + 1 px ring); nothing global changed, so the wizard buttons look as before. Verified with a real
keyboard: Tab order in `/evolucao` is e-mail -> senha -> Entrar, with the ring drawn on the button (2 px white offset + 2 px green).

## CSV preview: desktop table, mobile cards

Decision: the preview uses the same responsive strategy as the results, in ONE markup (no duplicate DOM, so no doubled text for assistive technology and no drift):

- from `md`: a semantic `table` / `thead` / `tbody` / `th scope="col"` / `td` with the caption "Prévia das linhas do arquivo CSV", exactly the columns and look as before;
- below `md`: `table` and `tbody` become blocks and every row a bordered card; each value has a label (`CardLabel`, `aria-hidden`, `md:hidden`) so the card reads without headers;
  the header row is visually hidden but stays for assistive technology;
- explicit ARIA roles (`table`, `row`, `columnheader`, `cell`) keep table semantics while the layout is not a CSS table;
- the `overflow-x-auto` wrapper is gone.

Cards show: line, asset name (`rawName`), asset type, ticker or instrument code, amount with currency (pt-BR formatted), and the local status "Formato válido" (text, not only colour). Display rows are derived once
(`previewDisplay`) from the existing `PreviewRow`s; no parsing or normalization was added. Not shown, by test: candidate ids, `portfolio:*` ids, hidden CSV columns (file name, institution), the token.

Results: the markup is unchanged apart from the header fix below; "Precisa de mais evidências" stays a pending state with its own text and colour, never an error, and no confidence figures.

## Header visibility defect (found and fixed)

`thead` had `sr-only md:table-header-group`. `sr-only` sets `position: absolute` and clips the element; `md:table-header-group` only changes `display`, so on desktop the header stayed invisible (computed
`position: absolute`). The results table has had this since TASK-025 (its desktop header row was never visible) and my first version of the new preview copied it. Fixed with `md:not-sr-only` on both
(`sr-only md:not-sr-only md:table-header-group`); measured after the fix: `position: static`, `display: table-header-group`, header cells laid out in both tables. Tests now assert the class trio for both tables.

## Tests (offline)

- `components/PortfolioCsvResolver.a11y.test.tsx` (new): semantic table and scoped headers, column headers by role, the one-markup responsive classes, no scroll wrapper, same rows in order,
  label per value, the six card values (incl. formatted amount), ticker/dash rules, status as text, no internal ids/hidden columns/token/`portfolio:` anywhere, action-button focus classes, invalid CSV,
  file replacement, reset, results cards and the pending state, the enlarged link for no-session / expired / 401 (real `<a>`, href, name, classes, keyboard semantics, order), 403/429/500 without link,
  static import guard.
- `app/evolucao/page.test.tsx`: label association, ids, label click focus, autocomplete, submit-button name/disabled rule, busy state, alert on failure, loading status, focus classes, import list; the
  TASK-027 return-flow tests are unchanged apart from the selectors.
- The TASK-025/026/027 component tests and the server tests are unchanged and green.
- jsdom applies no CSS: the tests check the DOM contract and classes; the rendered layout was checked in a browser.

## Manual checks (local mock of the Planejador, no external request)

- A `/evolucao` desktop: label click focuses the field, Tab order e-mail -> senha -> Entrar, visible focus.
- B `/evolucao` 390 px: labels and fields fit (fields 261 px wide), button 44 px, no horizontal overflow.
- C/D `/carteira` 390 px no session and expired session: same "Entrar" button-link, 44 px, safe href, no overflow.
- E desktop preview: real table with its header row visible (after the fix).
- F 390 px preview: stacked cards, no horizontal scroll, all six values readable, page scrollWidth = 390.
- G 390 px results: unchanged stacked cards.
The embedded browser's screenshots were flaky (timeouts); DOM measurements and screenshots of A, B, C, F, G and the desktop view were used.

## Remaining accessibility limitations

- `/evolucao` is not a `<form>`: Enter does not submit and password managers may offer less help; changing it alters submit behavior, so it was left.
- The "Entrar" link inside an `alert` region is announced with the alert; there is no focus move to it.
- Colours were not audited for contrast (amber text on amber background in the pending badge, muted grey text); this was not a full WCAG audit.
- The wizard (`/`) and its fixed 272 px Stepper are not mobile-friendly and were not touched.
- Focus rings were added only to the two pages of this task; other pages keep the browser default outline.
- Screen-reader behavior was not tested with a real screen reader; semantics were checked through roles and the DOM.
