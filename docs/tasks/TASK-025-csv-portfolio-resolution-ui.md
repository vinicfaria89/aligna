# TASK-025 - CSV portfolio resolution UI

Status: implemented. The first user-facing AIE workflow.

    choose a CSV -> local preview (same adapter as the server) -> send the raw CSV to POST /api/aie/resolve-csv
      -> show the server's BatchResolutionResult -> unresolved / error states shown clearly

The UI reproduces NO AIE logic. It reads a file, previews it, asks the server to resolve, and renders the answer. It never
verifies an asset, calls a provider or ANBIMA, knows a credential, recreates the verification policy, changes evidence
strength or infers a ticker/ISIN/instrument code from a name. The server stays authoritative even when the preview says the
file is fine.

## Location

- Page: `app/carteira/page.tsx` (`/carteira`, a server page that only frames the component; Portuguese copy like the rest of
  the app; existing Tailwind tokens and the `card` / `btn-primary` / `btn-ghost` / `input` classes; no new component library).
- Component: `components/PortfolioCsvResolver.tsx` (`"use client"`): file selection, validation summary, preview table, resolve
  action, results table.
- Browser-safe logic under `lib/aie/client/`: `portfolio-csv-preview.ts`, `resolve-csv-client.ts`, `upload-file-id.ts`,
  `csv-issue-messages.ts`. Shared constants in `lib/aie/ingestion/portfolio-csv-limits.ts`.

## File constraints

`accept=".csv,text/csv"` (a convenience, never trusted: the server decides). The client checks that a file exists, that its size is
at most 512 KiB (the server limit, imported from the shared constants so they cannot drift), that its text can be read, and that the
text is not empty. Everything else is left to the local preview and, above all, to the server.

## Preview (no second parser)

The preview calls the SAME browser-safe `ingestPortfolioCsv` (CSV adapter + ingestion) the server calls, with the same option, so
it shows exactly the candidates and ids the server will derive. It shows only useful fields (row, name, type, ticker/code, amount
and currency) and a local status. Failures are reported as located, value-free messages (`Cabeçalho, coluna 2: coluna não
permitida ...`, `Linha 4, campo amount: valor inválido.`); the messages are built from the location's shape and the stable code, so a
cell or header a user typed is never echoed. More than 100 rows or more than 512 KiB is refused locally. A header-only file shows a
notice and nothing is sent. `Petrobras PN` stays without a ticker: nothing is inferred.

## Row identity (the key decision)

Ingestion needs an `id` or `fileId` + `row` for every row and never uses randomness. Rather than editing the CSV text in the
browser, the boundary was made to receive UPLOAD PROVENANCE explicitly:

- The CSV adapter gained an optional `defaultFileId` (`PortfolioCsvOptions`). For a row with no `id` it fills `source.fileId`
  (unless the row's own `fileId` column is set) and `source.row` = its CSV row number (unless its own `row` column is set); ingestion
  then derives its usual `portfolio:<fileId>:<row>`. A row that states its own `id` is untouched. Without the option nothing changed.
- `POST /api/aie/resolve-csv` accepts ONE optional query parameter, `fileId` (`[A-Za-z0-9._-]{1,64}`), passed to that option. Any other
  query parameter, a repeated or malformed `fileId` is a 400 (`query` / `query.fileId`, never echoed); the check runs after
  authorization and before the body is read. The request body is still the untouched raw CSV.
- The browser derives `fileId` deterministically from the file's name, size and last-modified time (`f` + 16 hex characters from two
  FNV-1a passes; no randomness, no clock). It is an OPAQUE label of the upload: it identifies a candidate ROW inside this source, NOT a
  financial asset, is not a content hash and has no cryptographic or identity semantics. The name is folded into the hash and never
  sent as such. Selecting the same file again yields the same ids.
- The preview and the server run the same code, and a test proves they derive exactly the same candidates and ids.

This is a small, documented extension of the TASK-024 contract (an optional query parameter), not a hidden change.

## Authentication

The request uses the app's existing mechanism: `getValidAccessToken()` from `lib/session.ts` (which owns the localStorage tokens and the
refresh). The component does not read, store or display the token, and adds no second auth client. The token goes only in the
`Authorization: Bearer` header of the request; the CSV goes only in the body; the URL carries only the opaque `fileId`. The request is
`credentials: "omit"` and `cache: "no-store"`. With no usable session nothing is sent and the user is told to sign in (link to the existing
login on `/evolucao`).

## Server status handling (explicit states)

States: `idle`, `reading`, `invalid-local-file`, `ready` (file selected), `submitting`, `success`, `server-validation-error`,
`unauthenticated`, `forbidden`, `too-large`, `unsupported-media`, `rate-limited`, `server-error`, `network-error`.

| Server | UI |
|---|---|
| 200 | results table |
| 400 | "O servidor recusou este CSV" + safe, located issues |
| 401 (or no session) | "Entre na sua conta para continuar" + link |
| 403 | neutral: "Sua conta não tem acesso à resolução de carteiras em lote." (no guess about billing or Premium) |
| 413 | file too large (512 KB) |
| 415 | application problem, not the user's file |
| 429 | wait message; with `Retry-After`: "Tente novamente em cerca de N segundos" |
| 500 / unexpected | generic message + "Referência para suporte: <X-Correlation-Id>" |
| fetch failure | "Não foi possível conectar ao servidor" |

A server 4xx/5xx is never turned into a success; no raw response, exception text or stack is shown. A 200 whose body is not a valid batch
answer is treated as a server error.

## Results

One entry per item, in the server's order, with the CSV line number, the asset as sent, a status badge and details. The internal row
identifier (`portfolio:<fileId>:<row>`) is NOT shown: the user never has to know about `fileId` or `row`, and the success view shows no
technical reference either (the support reference appears only on a server error). The missing-field label for `identity` reads
"identificação do ativo". On desktop the entries are a table; below the `md` breakpoint the same markup becomes stacked cards (a label
per value), so no column is cut off or needs horizontal scrolling:

- verified: canonical code, type, currency, amount and evidence sources returned by the server;
- `needs-more-evidence` (and `needs-user`, `conflict`, `blocked`): shown as UNRESOLVED with its own colour and copy ("Precisa de mais
  evidências"), never as an error, with what is still missing ("Falta confirmar: emissor, vencimento"), the sources consulted and the
  providers whose lookup failed (the fact, never the error text);
- item-level error (`ok: false`): a separate "Erro ao resolver" badge with a fixed message.

A summary counts verified / pending / errors. No confidence numbers are invented and there is no evidence inspector. Evidence values and
metadata, provider error text and the echoed candidate are dropped when the answer is read into a view (tested), so they cannot be rendered.

## Privacy and persistence

The file, its text and the preview live only in component memory: never localStorage, sessionStorage, the URL, analytics or the console
(tested); they disappear on reload or "Limpar". Choosing another file clears the previous results. Nothing is persisted.

## Accessibility

A labelled file input, explicit button names, a busy/disabled submit with `aria-busy` while pending (a second click cannot start another
request), `role="status"` for progress and summaries, `role="alert"` for errors, real tables with captions and `scope="col"` headers,
full keyboard use. There is no drag-and-drop, so file selection does not depend on it.

## Tests

- `components/PortfolioCsvResolver.test.tsx` (33, jsdom): initial state, selection and preview, size and content checks, no inference, header-only,
  file replacement, request shape (text/csv, bearer, opaque id only in the URL), default session use, no-session, duplicate-submit guard, ordered
  results, verified / unresolved / item-error rendering, all status mappings, retry after a failure, reset, no token in the DOM, no storage
  writes, no console output, and the two user flows (a two-asset success and a 403 denial with no result table).
- `lib/aie/client/*.test.ts` (43): upload id, preview (same adapter, ids, limits, safe issues), the fetch client (status mapping, Retry-After,
  malformed answers, nothing sensitive in outcomes, only safe view fields kept), the static browser-boundary guards and the issue messages.
- Server side: `portfolio-csv-adapter.provenance.test.ts` and `resolve-csv-provenance.test.ts` (the `fileId` query and preview/server parity).
- Static guards: the component and its whole import graph reach nothing under `lib/aie/server`, providers, policy, infrastructure or
  resolution (only the pure planner TYPE contract that the result types refer to); no `process.env`, no ANBIMA, no verification policy.
- Test infrastructure: `vitest.config.mts` (React plugin and the `@` alias); the existing server tests still run in the default node
  environment, and only the component test opts into jsdom with a docblock. No real network is used anywhere.

## Visual review (real browser)

Done against the real dev server with a local stand-in for the Planejador identity API (no real data, no secret), before the commit:

- Valid CSV (3 assets, no `id`, `fileId` or `row` column): file name and size shown, aligned preview, clear "Resolver carteira" button, a
  submitting state that does not shift the layout, and results with derived ids working end to end (provenance removed the friction).
- Pending assets (`needs-more-evidence`): amber "Precisa de mais evidências" badge with "Falta confirmar: ...", clearly not an error and
  no "almost verified" wording.
- 403: neutral copy, no claim about Premium or billing, previous results not visible. 429: wait message with the Retry-After seconds.
  500: generic message with a readable support reference (correlation id), no technical detail.
- Desktop and mobile (390px): no page-level horizontal overflow. The first mobile pass showed the "Detalhes" column cut off inside a
  scrolling table, which led to the stacked-card layout above; re-checked at 390px afterwards.
- Fixes made from the review: removed the leaked internal row identifier and the success "Referência" line, renamed the `identity`
  label, and made the results responsive.

## Not implemented (future)

Excel, PDF/OCR, drag-and-drop, multipart upload, persistence of the portfolio or results, background jobs and progress, editing of positions,
an evidence inspector, a navigation entry (the page is reachable at `/carteira`), a paywall/upsell flow for batch access, and a countdown for the
429 wait.

## Limitations

- The preview row number for a row with its own `id` and no `row` column assumes no blank lines; rows without an id use the physical row.
- Ingestion errors from the server are numbered like the preview (data index + 2).
- The upload id changes if the same file is saved again (its modification time changes); that only changes the row labels.
- A cold first run of the whole suite once failed to start a jsdom worker (transient); the rerun passed (57 files, 1011 tests).
