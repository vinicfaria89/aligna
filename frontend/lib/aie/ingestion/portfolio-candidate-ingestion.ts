import type {
  CandidateAsset,
  CandidateAssetHints,
  CandidateAssetSource,
  CandidateAssetType,
} from "../contracts";

import {
  normalizeIdentifierValue,
} from "../registry/normalize";

/**
 * Portfolio candidate ingestion (TASK-011).
 *
 *   portfolio/extract row -> ingestPortfolioCandidate -> CandidateAsset
 *
 * The ingestion boundary only EXTRACTS and CONSERVATIVELY NORMALIZES what the
 * input explicitly states. It never resolves anything: it does not call
 * providers, the execution pipeline or the verification policy, never creates
 * a VerifiedAsset, never matches names and never infers an identifier, an asset
 * type or an issuer from free text. A CandidateAsset stays unresolved input.
 *
 * Deliberately pure and free of I/O, so it is safe for browser and server code.
 * It imports only domain contracts and the registry's pure normalization (so
 * the CNPJ convention is the one the registry already uses).
 */

export interface PortfolioAssetInput {
  /**
   * Caller-provided deterministic id. When absent, the id is derived from
   * `source.fileId` + `source.row`; when that is impossible the input is
   * rejected. Randomness is never used.
   */
  id?: string;

  rawName: string;

  assetType?: CandidateAssetType;

  ticker?: string;
  isin?: string;
  cnpj?: string;
  instrumentCode?: string;

  issuerName?: string;
  fundName?: string;

  maturityDate?: string;
  currency?: string;

  amount?: number;

  source?: CandidateAssetSource;
}

export type IngestionIssueCode =
  | "required"
  | "type"
  | "empty"
  | "too_long"
  | "invalid_value"
  | "unknown_field";

export interface IngestionIssue {
  path: string;

  code: IngestionIssueCode;
}

/**
 * Typed ingestion failure. The message is fixed and issues carry only a known
 * field path plus a code: submitted values and unknown key names are never
 * echoed.
 */
export class PortfolioIngestionError extends Error {
  readonly issues: IngestionIssue[];

  /** Position of the failing item in a batch (undefined for single items). */
  readonly index?: number;

  constructor(
    issues: IngestionIssue[],
    index?: number,
  ) {
    super(
      index === undefined
        ? "Invalid portfolio asset."
        : `Invalid portfolio asset at index ${index}.`,
    );

    this.name =
      "PortfolioIngestionError";

    this.issues = issues;

    this.index = index;
  }
}

/** Kept equal to the limits of the server validation (a test enforces it). */
export const INGESTION_LIMITS = {
  id: 128,

  rawName: 256,

  sourceText: 256,

  ticker: 32,

  isin: 32,

  cnpj: 32,

  instrumentCode: 64,

  issuerName: 256,

  fundName: 256,

  maturityDate: 32,

  currency: 8,
} as const;

// Compile-time exhaustive: a new CandidateAssetType must be listed here.
const ASSET_TYPES: Record<
  CandidateAssetType,
  true
> = {
  stock: true,
  etf: true,
  fii: true,
  fund: true,
  debenture: true,
  cri: true,
  cra: true,
  cdb: true,
  lci: true,
  lca: true,
  coe: true,
  crypto: true,
  international: true,
  treasury: true,
  unknown: true,
};

/** Single source of truth for valid asset types (also used by adapters). */
export function isCandidateAssetType(
  value: unknown,
): value is CandidateAssetType {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(
      ASSET_TYPES,
      value,
    )
  );
}

const CONTROL_CHARACTERS =
  /[\u0000-\u001f\u007f]/;

type PlainObject = Record<
  string,
  unknown
>;

function isPlainObject(
  value: unknown,
): value is PlainObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

class Issues {
  readonly list: IngestionIssue[] =
    [];

  add(
    path: string,
    code: IngestionIssueCode,
  ): void {
    if (this.list.length < 20) {
      this.list.push({
        path,
        code,
      });
    }
  }
}

function rejectUnknown(
  input: PlainObject,
  allowed: readonly string[],
  path: string,
  issues: Issues,
): void {
  for (const key of Object.keys(
    input,
  )) {
    if (!allowed.includes(key)) {
      // The unknown key name is user controlled: report the parent path only.
      issues.add(
        path,
        "unknown_field",
      );

      return;
    }
  }
}

/**
 * Optional text: undefined when absent or blank after trimming. When
 * `transform` is given it is applied to the trimmed value.
 */
function readOptionalText(
  input: PlainObject,
  key: string,
  path: string,
  maxLength: number,
  issues: Issues,
  transform: (
    value: string,
  ) => string = (value) => value,
): string | undefined {
  const raw = input[key];

  if (raw === undefined) {
    return undefined;
  }

  if (typeof raw !== "string") {
    issues.add(path, "type");

    return undefined;
  }

  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  if (trimmed.length > maxLength) {
    issues.add(path, "too_long");

    return undefined;
  }

  if (
    CONTROL_CHARACTERS.test(trimmed)
  ) {
    issues.add(
      path,
      "invalid_value",
    );

    return undefined;
  }

  const value = transform(trimmed);

  if (value.length === 0) {
    issues.add(
      path,
      "invalid_value",
    );

    return undefined;
  }

  return value;
}

const upper = (value: string): string =>
  value.toUpperCase();

function readSource(
  input: PlainObject,
  issues: Issues,
): CandidateAssetSource {
  const raw = input.source;

  if (raw === undefined) {
    return {};
  }

  if (!isPlainObject(raw)) {
    issues.add("source", "type");

    return {};
  }

  rejectUnknown(
    raw,
    [
      "fileId",
      "fileName",
      "section",
      "row",
      "institution",
    ],
    "source",
    issues,
  );

  const source: CandidateAssetSource =
    {};

  // Provenance is preserved exactly: only blank values are dropped.
  for (const key of [
    "fileId",
    "fileName",
    "section",
    "institution",
  ] as const) {
    const value = raw[key];

    if (value === undefined) {
      continue;
    }

    const path = `source.${key}`;

    if (typeof value !== "string") {
      issues.add(path, "type");
    } else if (
      value.trim().length === 0
    ) {
      continue;
    } else if (
      value.length >
      INGESTION_LIMITS.sourceText
    ) {
      issues.add(path, "too_long");
    } else if (
      CONTROL_CHARACTERS.test(value)
    ) {
      issues.add(
        path,
        "invalid_value",
      );
    } else {
      source[key] = value;
    }
  }

  const row = raw.row;

  if (row !== undefined) {
    if (typeof row !== "number") {
      issues.add("source.row", "type");
    } else if (
      !Number.isSafeInteger(row) ||
      row < 0
    ) {
      issues.add(
        "source.row",
        "invalid_value",
      );
    } else {
      source.row = row;
    }
  }

  return source;
}

function resolveId(
  input: PlainObject,
  source: CandidateAssetSource,
  issues: Issues,
): string | undefined {
  const explicit = input.id;

  let id: string | undefined;

  if (explicit !== undefined) {
    if (typeof explicit !== "string") {
      issues.add("id", "type");

      return undefined;
    }

    id = explicit.trim();

    if (id.length === 0) {
      issues.add("id", "empty");

      return undefined;
    }
  } else if (
    source.fileId !== undefined &&
    source.row !== undefined
  ) {
    id = `portfolio:${source.fileId}:${source.row}`;
  } else {
    // A deterministic id cannot be guaranteed: it must be supplied.
    issues.add("id", "required");

    return undefined;
  }

  if (id.length > INGESTION_LIMITS.id) {
    issues.add("id", "too_long");

    return undefined;
  }

  if (CONTROL_CHARACTERS.test(id)) {
    issues.add("id", "invalid_value");

    return undefined;
  }

  return id;
}

function readRawName(
  input: PlainObject,
  issues: Issues,
): string | undefined {
  const raw = input.rawName;

  if (raw === undefined) {
    issues.add("rawName", "required");

    return undefined;
  }

  if (typeof raw !== "string") {
    issues.add("rawName", "type");

    return undefined;
  }

  // Whitespace only: trim and collapse repeated whitespace. No rewriting.
  const collapsed = raw
    .trim()
    .replace(/\s+/g, " ");

  if (collapsed.length === 0) {
    issues.add("rawName", "empty");

    return undefined;
  }

  if (
    collapsed.length >
    INGESTION_LIMITS.rawName
  ) {
    issues.add(
      "rawName",
      "too_long",
    );

    return undefined;
  }

  if (
    CONTROL_CHARACTERS.test(collapsed)
  ) {
    issues.add(
      "rawName",
      "invalid_value",
    );

    return undefined;
  }

  return collapsed;
}

function readHints(
  input: PlainObject,
  issues: Issues,
): CandidateAssetHints {
  const hints: CandidateAssetHints =
    {};

  const assetType = input.assetType;

  if (assetType !== undefined) {
    if (typeof assetType !== "string") {
      issues.add("assetType", "type");
    } else if (
      !isCandidateAssetType(assetType)
    ) {
      issues.add(
        "assetType",
        "invalid_value",
      );
    } else {
      // Explicit only: never classified from rawName.
      hints.assetType = assetType;
    }
  }

  const ticker = readOptionalText(
    input,
    "ticker",
    "ticker",
    INGESTION_LIMITS.ticker,
    issues,
    upper,
  );

  const isin = readOptionalText(
    input,
    "isin",
    "isin",
    INGESTION_LIMITS.isin,
    issues,
    upper,
  );

  // Same convention as the registry lookup key (digits only).
  const cnpj = readOptionalText(
    input,
    "cnpj",
    "cnpj",
    INGESTION_LIMITS.cnpj,
    issues,
    (value) =>
      normalizeIdentifierValue(
        "cnpj",
        value,
      ),
  );

  const instrumentCode =
    readOptionalText(
      input,
      "instrumentCode",
      "instrumentCode",
      INGESTION_LIMITS.instrumentCode,
      issues,
      upper,
    );

  // Explicit issuer/fund text is preserved (trim only), never rewritten.
  const issuerName = readOptionalText(
    input,
    "issuerName",
    "issuerName",
    INGESTION_LIMITS.issuerName,
    issues,
  );

  const fundName = readOptionalText(
    input,
    "fundName",
    "fundName",
    INGESTION_LIMITS.fundName,
    issues,
  );

  // Explicit input only: no inference, no timezone handling, no reformatting.
  const maturityDate =
    readOptionalText(
      input,
      "maturityDate",
      "maturityDate",
      INGESTION_LIMITS.maturityDate,
      issues,
    );

  const currency = readOptionalText(
    input,
    "currency",
    "currency",
    INGESTION_LIMITS.currency,
    issues,
    upper,
  );

  if (ticker !== undefined) {
    hints.ticker = ticker;
  }

  if (isin !== undefined) {
    hints.isin = isin;
  }

  if (cnpj !== undefined) {
    hints.cnpj = cnpj;
  }

  if (instrumentCode !== undefined) {
    hints.instrumentCode =
      instrumentCode;
  }

  if (issuerName !== undefined) {
    hints.issuerName = issuerName;
  }

  if (fundName !== undefined) {
    hints.fundName = fundName;
  }

  if (maturityDate !== undefined) {
    hints.maturityDate =
      maturityDate;
  }

  if (currency !== undefined) {
    hints.currency = currency;
  }

  const amount = input.amount;

  if (amount !== undefined) {
    if (typeof amount !== "number") {
      // Formatted monetary text (for example "R$ 1.000,00") is not parsed
      // here: that belongs to a future adapter layer.
      issues.add("amount", "type");
    } else if (
      !Number.isFinite(amount) ||
      amount < 0
    ) {
      issues.add(
        "amount",
        "invalid_value",
      );
    } else {
      // Preserved exactly: no rounding.
      hints.amount = amount;
    }
  }

  return hints;
}

/**
 * Single-item ingestion: the source of truth.
 * Throws PortfolioIngestionError for structurally invalid input.
 */
export function ingestPortfolioCandidate(
  input: PortfolioAssetInput,
): CandidateAsset {
  const issues = new Issues();

  const candidate: unknown = input;

  if (!isPlainObject(candidate)) {
    issues.add("$", "type");

    throw new PortfolioIngestionError(
      issues.list,
    );
  }

  rejectUnknown(
    candidate,
    [
      "id",
      "rawName",
      "assetType",
      "ticker",
      "isin",
      "cnpj",
      "instrumentCode",
      "issuerName",
      "fundName",
      "maturityDate",
      "currency",
      "amount",
      "source",
    ],
    "$",
    issues,
  );

  const rawName = readRawName(
    candidate,
    issues,
  );

  const source = readSource(
    candidate,
    issues,
  );

  const id = resolveId(
    candidate,
    source,
    issues,
  );

  const hints = readHints(
    candidate,
    issues,
  );

  if (
    issues.list.length > 0 ||
    rawName === undefined ||
    id === undefined
  ) {
    throw new PortfolioIngestionError(
      issues.list,
    );
  }

  return {
    id,
    rawName,
    source,
    hints,
  };
}

/**
 * Batch ingestion. Order is preserved. FAIL-FAST policy: the first invalid item
 * throws a PortfolioIngestionError carrying its index, and no partial result
 * is returned.
 */
export function ingestPortfolioCandidates(
  inputs: readonly PortfolioAssetInput[],
): CandidateAsset[] {
  if (!Array.isArray(inputs)) {
    throw new PortfolioIngestionError([
      {
        path: "$",

        code: "type",
      },
    ]);
  }

  return inputs.map(
    (input, index) => {
      try {
        return ingestPortfolioCandidate(
          input,
        );
      } catch (error) {
        if (
          error instanceof
          PortfolioIngestionError
        ) {
          throw new PortfolioIngestionError(
            error.issues,
            index,
          );
        }

        throw error;
      }
    },
  );
}
