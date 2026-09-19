# TASK-011 - Portfolio candidate ingestion contract

## Objective

Create the boundary that turns portfolio/extract rows into `CandidateAsset` values.

    portfolio/document data
      -> ingestPortfolioCandidate(s)      lib/aie/ingestion/portfolio-candidate-ingestion.ts
      -> CandidateAsset[]
      -> resolveAsset(candidate)          (a later step: NOT called here)

Rule: ingestion may extract and normalize hints, but it never turns a hypothesis into an identity.
A `CandidateAsset` stays unresolved input.

## Public API

    ingestPortfolioCandidate(input: PortfolioAssetInput): CandidateAsset
    ingestPortfolioCandidates(inputs: readonly PortfolioAssetInput[]): CandidateAsset[]
    PortfolioIngestionError            // typed failure: fixed message + safe issues (+ batch index)

The single-item function is the source of truth; the batch function only maps over it.
The module is pure (no I/O, no randomness) and imports only domain contracts and the registry's pure
normalization, so it is safe for browser and server code. It is not exported from the root `lib/aie` barrel yet.

## Input contract

`PortfolioAssetInput` is a small, format-neutral row (no bank/CSV coupling):

    id?  rawName  assetType?  ticker?  isin?  cnpj?  instrumentCode?
    issuerName?  fundName?  maturityDate?  currency?  amount?  source?

`source` reuses `CandidateAssetSource` (`fileId`, `fileName`, `section`, `row`, `institution`).
Unknown fields, at the top level and in `source`, are rejected. Customer fields such as `customerName`,
`cpf`, `accountNumber`, `totalWealth` or `portfolioBalance` therefore cannot enter a `CandidateAsset`.

## Output

`CandidateAsset { id, rawName, source, hints }` and nothing else (no verification/resolution fields).
Absent hints are omitted; blank optional strings become undefined.

## ID strategy

Deterministic, never random:

1. an explicit `id` (trimmed) wins;
2. otherwise `portfolio:<source.fileId>:<source.row>` when both are present;
3. otherwise the input is rejected (`id` required): a deterministic id cannot be guaranteed.

## Conservative normalization

- `rawName`: trim and collapse repeated whitespace only. Case and wording are untouched.
- `ticker`, `isin`, `instrumentCode`, `currency`: trim + uppercase.
- `cnpj`: the registry's own convention (`normalizeIdentifierValue("cnpj", ...)`, digits only). A non-blank
  value without digits is rejected rather than silently dropped.
- `issuerName`, `fundName`, `maturityDate`: trimmed only, never rewritten; no date parsing, inference or
  timezone handling.
- `assetType`: preserved only when explicit and valid; never classified from `rawName`, and never defaulted
  (the planner already treats a missing type as `unknown`).
- `amount`: must be a finite number >= 0 (kept identical to the server validation, which also rejects
  negatives); preserved exactly with no rounding. Formatted text such as "R$ 1.000,00" is rejected as a
  wrong type: locale-aware money parsing belongs to a future adapter.
- Strings must be free of control characters and within the same limits as the server validation
  (a test keeps `INGESTION_LIMITS` equal to the server limits and checks that ingested candidates pass the
  server validation).

## No identity inference

Never: infer `PETR4` from "Petrobras PN", extract an ISIN, `instrumentCode` or CNPJ from `rawName`, invent
an issuer, fuzzy-match names, create a `VerifiedAsset`, or call any provider, the execution pipeline, the
policy or the network. Tests assert each of these and that the module imports nothing but domain
contracts and the registry normalization.

## Provenance

`source` metadata is preserved exactly (only blank values are dropped) and is never sent to providers:
`ProviderQuery` remains instrument-focused.

## Errors

`PortfolioIngestionError`: fixed message; `issues` are `{ path, code }` pairs (`required`, `type`, `empty`,
`too_long`, `invalid_value`, `unknown_field`) that never echo submitted values or unknown key names.

## Batch policy: FAIL-FAST

Order is preserved. The first invalid item throws a `PortfolioIngestionError` whose `index` is that item's
position (message: "Invalid portfolio asset at index N."), and no partial result is returned. Per-item
error reporting can be added later if a real adapter needs partial success.

## Out of scope / future adapters

CSV, Excel, PDF/OCR, brokerage- or bank-specific parsers, monetary/locale text parsing, AI asset
classification, batch resolution, UI upload. They will produce `PortfolioAssetInput` and consume this contract.
