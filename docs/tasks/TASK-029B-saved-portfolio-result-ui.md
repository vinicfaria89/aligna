# TASK-029B - Saved portfolio result (Aligna UI)

Status: implemented. The Aligna side of the saved-result feature. The storage lives in the Planejador (TASK-029A, commit `00956c7`); this task only
adds the browser client and the screen. `lib/aie`, `lib/session`, `lib/api.ts`, authentication and the server routes are untouched.

    /carteira opens -> (valid session) GET /api/v1/portfolio-snapshot -> "Resultado salvo em ..." card
    resolve a CSV   -> "Salvar resultado" (explicit) -> PUT   -> the saved card shows the new result
    "Apagar resultado salvo" -> confirmation -> DELETE -> the saved state goes away

Privacy promise (kept): the original file is never stored, and nothing is saved unless the user clicks "Salvar resultado". No autosave, no save after a
new upload, no save on sign-in.

## Contract used (Planejador, TASK-029A)

`GET` 200 `{ items, updatedAt }` / 404 nothing saved / 401; `PUT` `{ items }` 200 (creates or replaces) / 422 / 401; `DELETE` 204 (idempotent) / 401.
Items: `lineNumber, rawName, assetType, ticker, code, amount, currency, status, pendingFields, sources, verifiedAsset{code,type,currency}`; 1..100 items; the
backend rejects unknown fields. The browser calls the Planejador directly (`NEXT_PUBLIC_PLANEJADOR_API_URL`, the same base as `lib/api.ts`).

## Files

- `lib/portfolio-snapshot-api.ts` (new): `createPortfolioSnapshotClient({ getSession, clearSession, fetchImpl })` -> `load()`, `save(items)`, `remove()`.
- `lib/portfolio-snapshot-mapping.ts` (new): the contract types, `toSnapshotItems` (screen -> payload), `parseSavedSnapshot` (answer -> safe view), `toDisplayRows`
  (saved -> the results table's row shape).
- `components/PortfolioCsvResolver.tsx`: read on open, the saved card, the save controls, the confirmed delete, the privacy text; the results table was
  extracted (same markup) so a fresh and a saved result share it.
- `components/portfolio-snapshot-test-support.ts` (new, tests only): a fake "nothing saved" client.
- Tests: `lib/portfolio-snapshot-mapping.test.ts`, `lib/portfolio-snapshot-api.test.ts`, `components/PortfolioCsvResolver.snapshot.test.tsx` (new); the existing
  component tests were updated (see "Regression").

## Client

- Token: from the app's session (`acquireAccessToken`, injected as `getSession`, which refreshes before every call). It goes ONLY in `Authorization: Bearer`. No `credentials`
  option is set (a cross-origin request carries no cookies), `cache: "no-store"`, `Content-Type` only on PUT. The token never appears in a URL, a body, an outcome or the DOM.
- Outcomes are explicit and carry no response text:
  - `load`: `found | none (404) | no-session | unauthenticated | unavailable`.
  - `save`: `saved | rejected (422) | failed | no-session | unauthenticated | unavailable`.
  - `remove`: `deleted | failed | no-session | unauthenticated | unavailable`.
- A 401 ends the session through the injected existing `clearSession` (the rule of TASK-026), once, with no retry. 5xx, network failure, 403 and any other status never touch the session.
- A response is read defensively: only contract fields are kept and anything malformed makes the whole answer unusable (never a half result).
- No storage, cookie, console or provider code (a static test checks both new modules).

## Mapping (what is sent)

| Screen | Snapshot |
|---|---|
| `unresolvedFields` | `pendingFields` |
| `PreviewRow.instrumentCode` | `code` (`ticker` stays `ticker`) |
| `verifiedAsset.canonicalAssetId` (+ type, currency) | `verifiedAsset.code` / `.type` / `.currency` |
| kind `item-error` | `status: "item-error"` |
| `sources` | `sources` (the failed providers are NOT sent) |

Never sent: the CSV or its text, the file name, `fileId` (upload id), candidate ids (`portfolio:*`), evidence values and metadata, provider payloads, the institution and other hidden columns,
the correlation id, the token. Before sending, texts are cleaned the way the Planejador validates them (control characters become a space, trimmed, cut to the limits, lists de-duplicated and
capped at 20); an item that cannot be shown again (no matching row, empty name, unknown status) is left out instead of sent invalid; at most 100 items.

## Screen behavior

- **Opening the page.** With a session: one read (a refresh plus a GET). No session, or an expired one: nothing is requested and nothing is shown. 404: no message. 401: the session is ended and the page stays
  silent (the user has not asked for anything yet). 5xx / network: one discreet note ("Não foi possível verificar se há um resultado salvo agora...") and the page keeps working. The effect runs once per open.
- **Saved result.** A "Resultado salvo" card (labelled region) with "Resultado salvo em 21/09/2026 às 21:00." (the Planejador's instant, in the user's time zone; a value without a zone is read as UTC), the counts, and
  the same results table (semantic table from `md`, stacked cards below). It sits above step 1.
- **Save.** "Salvar resultado" appears only after a successful resolution that has re-displayable items, next to "Guarda só o resultado na sua conta, nunca o arquivo." It sends a PUT that REPLACES the previous one;
  while pending it is busy/disabled (no double send). On success: "Este resultado está salvo na sua conta." and the saved card shows what the server returned. On 401: "Sua sessão expirou, então o resultado não foi
  salvo..." with the safe sign-in link (44 px), the session ended once, the result stays on screen. On 500/network/422: an alert saying it was not saved, the result stays and the button allows another try. An expired or absent
  session at save time sends nothing and says so.
- **Delete.** "Apagar resultado salvo" only exists with a saved result. It opens an inline confirmation (`role="group"` named "Apagar o resultado salvo da sua conta?", focus on "Cancelar"); only "Sim, apagar" sends the
  DELETE (busy, no double send). Success: the saved card goes, "Resultado salvo apagado da sua conta.", and a result still on screen becomes savable again. Failure: the saved result stays with an alert; a 401 also offers the sign-in.
- **"Limpar" and a new upload** clear only the screen (file, preview, on-screen result and its save state). They never call PUT or DELETE and the saved card stays. A saved result is replaced only by an explicit save.
- **AIE 401** while resolving still removes the on-screen result (TASK-026) but not the saved card.

## Privacy text (step 1)

"O arquivo original nunca é guardado. Salvar o resultado é opcional: se você escolher salvar, guardamos só o resultado (nomes, tipos, códigos, valores e situação de cada ativo) na sua conta, e você pode apagá-lo
quando quiser." (in addition to the previous "O arquivo é lido só no seu navegador e enviado apenas quando você pedir para resolver.")

## Regression (consciously updated tests)

The page now reads the saved result when it opens, which changes what "a direct visit" does when a session exists. The existing component tests (TASK-025..028) count session and fetch calls for the RESOLUTION, so they now inject a
fake saved-result client that answers "nothing saved" (`portfolio-snapshot-test-support.ts`); this also guarantees none of them touches the network. One TASK-026 test was renamed to say it is about the AIE part; the read on open,
with and without a session, is covered in the new snapshot test file. `/evolucao`, the session helpers, the post-login return and `lib/aie` are unchanged and their tests are unchanged and green.

## Tests (offline)

- Mapping (19): the mappings named above, contract-keys-only and no internal/sensitive values, cleaning and limits, dropping what cannot be shown, parse of valid and malformed answers, display rows.
- Client (25): bearer only in the header on all three calls, no `credentials`, `PUT` body exactly `{ items }`, one session call per request, 404 as "none", 401 handled apart (session ended once, no retry), 422/5xx/network, no session
  / expired / unavailable session sends nothing, outcomes free of token and response text, no storage/console, static source guards, only two `lib/aie` type imports.
- Flow with the real client on a fake fetch (42): read on open (no session, 404, found with date, expired, 401, 500, network, once per open), the save button rules, save (payload, forbidden values, busy, 500, network, 422, 401,
  expired/no session at save, replace), delete (confirmation, cancel, confirm, failure, 401, double click), Limpar and a new upload, privacy text, roles and focus, no storage/console, no token in the DOM.

## Manual verification (local mock of the Planejador with an in-memory snapshot; no external request)

Desktop 1100 px and 390 px: open with a session and nothing saved (refresh + GET 404, no message) -> resolve -> save (the PUT carried only contract keys) -> reload: the saved result came back from the server and
storage held only `aligna_session` -> new upload and "Limpar" made no PUT/DELETE and left the saved card -> save with the server failing (500): alert, result kept, button kept, session kept -> save with 401: sign-in
message, link `/evolucao?voltar=/carteira` 44 px high, session cleared, result kept -> delete: confirmation with focus on "Cancelar", no DELETE until confirmed, then one DELETE, saved card gone, on-screen result kept and
savable again. At 390 px `scrollWidth` = viewport and only the visually hidden header row exceeds the box (as before); the saved and fresh results are stacked cards and the save button is 46 px high.
The embedded browser's 390 px screenshots were cropped on the right by the capture (device pixel ratio), so that width was checked through DOM geometry.

## Limitations

- The client, not the server, decides what a result is: the snapshot is display data (TASK-029A's integrity note); re-resolving is the only way to refresh it, and the saved statuses can be stale (hence the date).
- The saved card shows the same columns as a fresh result (line, name, status, details). The saved amount, type and code are stored but not shown yet. (Update, TASK-030: they are now shown; see `TASK-030-saved-result-display.md`.)
- Signing in from the save/delete messages loses the on-screen result (a page navigation, by design: the file is never kept).
- Opening `/carteira` with a session now costs one refresh and one GET.
- The saved result is one per account and only the last; no history, no export.
- Real Postgres and production access logs were not checked (they belong to the Planejador).

## Not implemented

Excel/PDF/OCR, history, a signed result, autosave, storing the file, changes to `lib/aie`, session or authentication.
