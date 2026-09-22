# TASK-012 - Structured portfolio adapter

## Objective

The first adapter from external structured data to the ingestion contract. It performs NO asset resolution.

    structured external data (JSON-compatible)
      -> parseStructuredPortfolio                       lib/aie/ingestion/adapters/structured-portfolio-adapter.ts
      -> PortfolioAssetInput[]
      -> ingestPortfolioCandidates (TASK-011)
      -> CandidateAsset[]

## Public API

    parseStructuredPortfolio(input: unknown): PortfolioAssetInput[]
    parseStructuredPortfolioJson(json: string): PortfolioAssetInput[]     // no file I/O
    ingestStructuredPortfolio(input: unknown): CandidateAsset[]           // parse -> ingestPortfolioCandidates
    StructuredPortfolioAdapterError                                        // safe, typed failure

`ingestStructuredPortfolio` may throw `StructuredPortfolioAdapterError` (shape) or `PortfolioIngestionError`
(canonical rules such as a negative amount).

## Supported input

    {
      "assets": [
        {
          "id": "...", "rawName": "...", "assetType": "debenture",
          "instrumentCode": "ABCD11", "ticker": "...", "isin": "...", "cnpj": "...",
          "issuerName": "...", "fundName": "...", "maturityDate": "...", "currency": "BRL",
          "amount": 1000,
          "source": { "fileId": "...", "fileName": "...", "section": "...", "row": 1, "institution": "..." }
        }
      ]
    }

Only `rawName` is required. No bank-specific fields exist. An empty `assets` array is valid: an empty
portfolio is a legitimate statement and yields no candidates.

## Adapter vs ingestion

| Adapter (shape) | Ingestion (canonical rules) |
| --- | --- |
| root/`assets`/item/`source` are the right kind of value | rawName trim + whitespace collapse |
| unknown and forbidden fields rejected | ticker/isin/instrumentCode/currency uppercase, cnpj digits |
| strings are strings, numbers are finite numbers | blank optional strings become undefined |
| `assetType` is a known type (via the ingestion's `isCandidateAssetType`) | id derivation, amount >= 0, limits, control characters |
| passes values through UNCHANGED | the only place where values are normalized |

The adapter never trims, uppercases, defaults or rewrites anything, so normalization has a single source of
truth. The only change to the ingestion module is exporting `isCandidateAssetType`, so the valid-type list is
not duplicated.

## Validation and errors

- Input is untrusted. Unknown fields are rejected at the root, in every asset and in `source`.
- Nothing is coerced: an amount given as a string (including "R$ 1.000,00") is a `type` error.
- A non-finite number (NaN, Infinity, or a JSON value such as 1e999) is `invalid_value`.
- Issues are `{ path, code }` with codes `required`, `type`, `invalid_value`, `unknown_field`,
  `forbidden_field`, `invalid_json`. Paths use known field names and a numeric index (`assets[3].amount`).
  They never echo submitted values or unknown key names; malformed JSON text is never included in errors.
- Asset-scoped failures carry `index`.

## Privacy exclusions

These fields are rejected with the dedicated `forbidden_field` code (case-insensitive, ignoring `_` and `-`),
at the asset level and in `source`: `customerName`, `cpf`, `accountNumber`, `totalWealth`, `portfolioBalance`,
`password`, `token`, `access_token`/`accessToken`, `clientSecret`/`client_secret`. They are never added to
domain contracts. Provider/runtime configuration fields (`provider`, `environment`, `url`, ...) are rejected
as unknown fields.

## Fail-fast

Aligned with the ingestion layer: the first invalid asset throws with its index and no partial result is
returned. No partial-success semantics.

## No resolution, no providers

The adapter is pure and deterministic: no network, no process environment, no `resolveAsset`, no
`getServerAie`, no providers, no AI classification, no logging. Tests assert this by scanning its imports and
code. It never infers a ticker from "Petrobras PN" or an ISIN from `rawName`.

## Future adapters

CSV, Excel, PDF/OCR and brokerage/bank-specific adapters, locale-aware money parsing, and file I/O. They
should produce `PortfolioAssetInput[]` (or this structured payload) and reuse the ingestion layer.
