# TASK-030 - Show type, ticker/code and amount in the saved result

Status: implemented. Display only: the persistence, the Planejador contract, `lib/aie`, `lib/session`, `lib/api.ts`, `app/` and authentication are untouched.
TASK-029B saved these values but the saved card showed only line, name, status and details.

## What changed

- `lib/portfolio-snapshot-mapping.ts`: `SavedDisplayRow` (a display shape, not the persisted one) gained optional `assetType`, `code`, `amount`, `currency`. `code` follows the
  preview's rule: the ticker, else the instrument code. A field the saved item does not have is absent from the row (no empty string, no placeholder).
- `components/PortfolioCsvResolver.tsx`: `ResultsTable` (shared by the fresh and the saved result) shows the extra columns only when some row has the value:
  **Tipo**, **Ticker / código** and **Valor**, between "Ativo" and "Situação". The amount is formatted with the existing `formatAmount` (pt-BR currency when there is a
  currency, a plain number when there is none).
- A fresh result gives no extras, so its table keeps its four columns exactly as before (tested).

## Responsive behavior (one markup)

- From `md`: the same semantic table (`table`/`thead`/`tbody`/`th scope="col"`/`td`), now up to seven columns. A row without a value has an empty cell (blank, no dash).
- Below `md`: stacked cards. Each value has its label (Tipo, Ticker / código, Valor; aria-hidden, `md:hidden`); a row without a value has NO line for it (its cell is `hidden` below `md`),
  so the card shows only what exists.
- No horizontal scroll wrapper, no page overflow.

## Unchanged (tested)

The date "Resultado salvo em ...", the counts, "Apagar resultado salvo" and its confirmation, "Salvar resultado", "Limpar" (no DELETE, no PUT), a new upload (no automatic save),
and the TASK-029B privacy text.

## Tests

- `lib/portfolio-snapshot-mapping.test.ts` (+1): the display row carries type, ticker-else-code, amount and currency, and omits what is absent.
- `components/PortfolioCsvResolver.snapshot.test.tsx` (+14): the seven headers and the semantic table, value with currency, plain number without currency, type, ticker before code,
  a bare row shows nothing (no dash, no labels, three hidden cells), labels only for present values, the responsive classes and no scroll wrapper, a column no row has is not shown,
  a saved result without extras keeps four columns, date/counts/delete button intact, the card after saving shows the server's extras, the fresh table is unchanged, and Limpar/new upload
  do not touch the saved result.

## Manual verification (local mock of the Planejador; no external request)

A snapshot with four items (complete, ticker plus amount, bare, amount without currency and a very long name) opened in a fresh browser tab:

- Desktop 1100 px: the seven columns fit inside the card, header visible, blank cells for the bare row, "R$ 98.765,43" and "1.234,5", no overflow.
- 390 px: stacked cards (49..342 px in a 390 px viewport), labels only for the values a row has, the bare row shows three fewer lines, `scrollWidth` = 390, no scroll wrapper.
- The tab's console had only React's DevTools notice: no error on a clean open of `/carteira` (this also settles the stale `FOCUS_RING is not defined` message from a hot-reload of TASK-028).

## Limitations

- The saved card shows the values as saved by the client (TASK-029A's integrity note); they can be stale, hence the date.
- A fresh result still shows only line, name, status and details (its extras are in the preview above it).
