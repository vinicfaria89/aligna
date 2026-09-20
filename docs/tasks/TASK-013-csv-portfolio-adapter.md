# TASK-013 - CSV portfolio adapter

## Objective

A deterministic CSV adapter that converts a generic, header-based portfolio CSV into `PortfolioAssetInput[]` and
then `CandidateAsset[]`. It performs NO asset resolution.

    CSV text
      -> parsePortfolioCsv                       lib/aie/ingestion/adapters/portfolio-csv-adapter.ts
      -> PortfolioAssetInput[]
      -> ingestPortfolioCandidates (TASK-011)
      -> CandidateAsset[]

## Public API

    parsePortfolioCsv(csv: string): PortfolioAssetInput[]
    ingestPortfolioCsv(csv: string): CandidateAsset[]      // parse -> ingestPortfolioCandidates
    PortfolioCsvAdapterError                                // safe, typed failure
    CSV_CANONICAL_HEADERS

`ingestPortfolioCsv` may throw `PortfolioCsvAdapterError` (structure) or `PortfolioIngestionError` (canonical
rules). A `PortfolioIngestionError.index` N refers to the (N+1)th data row, i.e. CSV row N+2.

## Parser choice

The project has no CSV dependency, so no dependency was added. The adapter contains a small explicit RFC 4180 style
state machine (not a `split(",")`). A test forbids `split(",")` in the adapter.

## Canonical headers

Exact, case-sensitive names; surrounding spaces are trimmed; any column order:

    id rawName assetType ticker isin cnpj instrumentCode issuerName fundName
    maturityDate currency amount fileId fileName section row institution

`rawName` is required; everything else is optional. There are no bank-specific headers.

Rejected headers (fail-fast, all header problems reported together, positions only):

- unknown (`unknown_field`), including case/spelling variants: nothing is renamed or fuzzy matched;
- duplicate (`duplicate_header`), empty (`empty_header`);
- sensitive customer/secret names (`forbidden_field`): `customerName`, `cpf`, `accountNumber`, `totalWealth`,
  `portfolioBalance`, `password`, `token`, `access_token`, `clientSecret` (case-insensitive, ignoring `_`/`-`).
  The list is the same one used by the structured adapter (shared `isForbiddenFieldName`);
- a missing `rawName` header (`required`).

## CSV syntax

- UTF-8 text; comma delimiter only; a leading BOM (U+FEFF) is ignored.
- Quoted fields; commas, doubled quotes (`""`) and line breaks are allowed inside quotes.
- Record separators: LF and CRLF. A trailing newline is optional; blank lines are skipped (but counted).
- Malformed CSV (`malformed_csv`): an unterminated quote, a quote inside an unquoted field, text after a closing
  quote, or a lone CR outside quotes.
- Every data row must have exactly as many cells as the header (`extra_columns` / `missing_columns`).
- A header with no data rows is a valid empty portfolio.
- Excel workbooks are not supported.

## Cell parsing

- String cells pass through untouched (no trim, case or collapse): normalization belongs only to ingestion.
- An empty cell omits the field. `rawName` is always passed on (even empty) so ingestion rejects an empty name.
- `assetType`: must be exactly an allowed value (via the ingestion layer's `isCandidateAssetType`).
- `amount`: only a strict canonical decimal: digits, optional leading `-`, optional `.` fraction.
  Rejected: `R$ 1.000,00`, `1.000,00`, `1,5`, exponents (`1e3`), `+5`, `.5`, `5.`, hex, inner or surrounding
  spaces, `NaN`, `Infinity`, and any value with more than 15 significant digits (it would silently lose double
  precision). A whitespace-only amount cell counts as empty. The `>= 0` rule belongs to ingestion, so `-5` parses
  and is then rejected by ingestion.
- `row`: only plain digits (a non-negative safe integer); `-1`, `1.5`, `1e2`, `+3` are rejected.
- Nothing is silently coerced. Locale-aware money parsing belongs to a future adapter.

## Errors and fail-fast

- Row numbers are CSV record numbers: the header is row 1 and the first data row is row 2 (spreadsheet style).
- Issues are `{ path, code }` with paths such as `header[7]`, `row[4]`, `row[4].amount`; they never contain cell
  values, header names or row contents. `error.row` carries the failing row.
- Fail-fast: the first invalid data row throws (all issues of that row are listed); no partial result.

## Privacy, no resolution

Sensitive headers are rejected and never added to domain contracts. The adapter is pure: no network, no process
environment, no `resolveAsset`, no providers, no AI, no logging, no inference (`Petrobras PN` never becomes a
ticker; an ISIN-looking name never fills `isin`). Tests scan its imports and code.

## Limitations / future

- No size limit on the CSV text or row count yet (callers such as a future upload route must enforce it).
- A single-column CSV cannot express an empty row (it looks like a blank line and is skipped).
- Decimal amounts use IEEE double precision (at most 15 significant digits accepted).
- Excel, PDF/OCR, brokerage/bank-specific adapters, locale-aware numbers, other delimiters and file I/O are future work.

## Update (TASK-025)

`parsePortfolioCsv(csv, options?)` and `ingestPortfolioCsv(csv, options?)` accept an optional `defaultFileId`: for a row with no `id` it fills
`source.fileId` and `source.row` (the CSV row number) when the row does not state them, so ingestion derives `portfolio:<fileId>:<row>`. Rows
that state their own `id`, `fileId` or `row` are untouched, and without the option nothing changes. See `TASK-025-csv-portfolio-resolution-ui.md`.