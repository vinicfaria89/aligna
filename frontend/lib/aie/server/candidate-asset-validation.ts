import type {
  CandidateAsset,
  CandidateAssetHints,
  CandidateAssetSource,
  CandidateAssetType,
} from "../contracts";

/**
 * Deterministic validation of untrusted JSON into a CandidateAsset.
 *
 * Policies:
 * - nothing is coerced: a value of the wrong type is rejected, never converted;
 * - unknown fields are REJECTED (top level, source and hints), so a client can
 *   never smuggle provider, environment, URL or credential fields through;
 * - strings must be non-blank, within a maximum length and free of control
 *   characters; numbers must be finite;
 * - issues carry only a known field path and a code. They never echo the
 *   submitted values, and never echo unknown key names.
 *
 * The returned value is a fresh object built only from known fields.
 */

export type ValidationIssueCode =
  | "required"
  | "type"
  | "empty"
  | "too_long"
  | "invalid_value"
  | "invalid_json"
  | "unknown_field";

export interface ValidationIssue {
  path: string;

  code: ValidationIssueCode;
}

export type CandidateAssetValidation =
  | {
      ok: true;

      value: CandidateAsset;
    }
  | {
      ok: false;

      issues: ValidationIssue[];
    };

export const CANDIDATE_LIMITS = {
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

const MAX_ISSUES = 20;

// Compile-time exhaustive: adding a CandidateAssetType without listing it
// here is a type error.
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

class IssueCollector {
  readonly issues: ValidationIssue[] =
    [];

  add(
    path: string,
    code: ValidationIssueCode,
  ): void {
    if (
      this.issues.length <
      MAX_ISSUES
    ) {
      this.issues.push({
        path,
        code,
      });
    }
  }
}

function rejectUnknownFields(
  source: PlainObject,
  allowed: readonly string[],
  path: string,
  collector: IssueCollector,
): void {
  for (const key of Object.keys(
    source,
  )) {
    if (!allowed.includes(key)) {
      // The unknown key name is user controlled: report the parent path only.
      collector.add(
        path,
        "unknown_field",
      );

      return;
    }
  }
}

function readString(
  source: PlainObject,
  key: string,
  path: string,
  maxLength: number,
  required: boolean,
  collector: IssueCollector,
): string | undefined {
  const value = source[key];

  if (value === undefined) {
    if (required) {
      collector.add(
        path,
        "required",
      );
    }

    return undefined;
  }

  if (typeof value !== "string") {
    collector.add(path, "type");

    return undefined;
  }

  if (value.trim().length === 0) {
    collector.add(path, "empty");

    return undefined;
  }

  if (value.length > maxLength) {
    collector.add(
      path,
      "too_long",
    );

    return undefined;
  }

  if (
    CONTROL_CHARACTERS.test(value)
  ) {
    collector.add(
      path,
      "invalid_value",
    );

    return undefined;
  }

  return value;
}

function readObject(
  source: PlainObject,
  key: string,
  path: string,
  collector: IssueCollector,
): PlainObject | undefined {
  const value = source[key];

  if (value === undefined) {
    collector.add(
      path,
      "required",
    );

    return undefined;
  }

  if (!isPlainObject(value)) {
    collector.add(path, "type");

    return undefined;
  }

  return value;
}

function validateSource(
  raw: PlainObject,
  collector: IssueCollector,
): CandidateAssetSource {
  rejectUnknownFields(
    raw,
    [
      "fileId",
      "fileName",
      "section",
      "row",
      "institution",
    ],
    "source",
    collector,
  );

  const source: CandidateAssetSource =
    {};

  for (const key of [
    "fileId",
    "fileName",
    "section",
    "institution",
  ] as const) {
    const value = readString(
      raw,
      key,
      `source.${key}`,
      CANDIDATE_LIMITS.sourceText,
      false,
      collector,
    );

    if (value !== undefined) {
      source[key] = value;
    }
  }

  const row = raw.row;

  if (row !== undefined) {
    if (typeof row !== "number") {
      collector.add(
        "source.row",
        "type",
      );
    } else if (
      !Number.isSafeInteger(row) ||
      row < 0
    ) {
      collector.add(
        "source.row",
        "invalid_value",
      );
    } else {
      source.row = row;
    }
  }

  return source;
}

function validateHints(
  raw: PlainObject,
  collector: IssueCollector,
): CandidateAssetHints {
  rejectUnknownFields(
    raw,
    [
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
    ],
    "hints",
    collector,
  );

  const hints: CandidateAssetHints =
    {};

  const assetType = raw.assetType;

  if (assetType !== undefined) {
    if (
      typeof assetType !== "string"
    ) {
      collector.add(
        "hints.assetType",
        "type",
      );
    } else if (
      !Object.prototype.hasOwnProperty.call(
        ASSET_TYPES,
        assetType,
      )
    ) {
      collector.add(
        "hints.assetType",
        "invalid_value",
      );
    } else {
      hints.assetType =
        assetType as CandidateAssetType;
    }
  }

  for (const key of [
    "ticker",
    "isin",
    "cnpj",
    "instrumentCode",
    "issuerName",
    "fundName",
    "maturityDate",
    "currency",
  ] as const) {
    const value = readString(
      raw,
      key,
      `hints.${key}`,
      CANDIDATE_LIMITS[key],
      false,
      collector,
    );

    if (value !== undefined) {
      hints[key] = value;
    }
  }

  const amount = raw.amount;

  if (amount !== undefined) {
    if (
      typeof amount !== "number"
    ) {
      collector.add(
        "hints.amount",
        "type",
      );
    } else if (
      !Number.isFinite(amount) ||
      amount < 0
    ) {
      collector.add(
        "hints.amount",
        "invalid_value",
      );
    } else {
      hints.amount = amount;
    }
  }

  return hints;
}

export function validateCandidateAsset(
  input: unknown,
): CandidateAssetValidation {
  const collector =
    new IssueCollector();

  if (!isPlainObject(input)) {
    collector.add("$", "type");

    return {
      ok: false,

      issues: collector.issues,
    };
  }

  rejectUnknownFields(
    input,
    [
      "id",
      "rawName",
      "source",
      "hints",
    ],
    "$",
    collector,
  );

  const id = readString(
    input,
    "id",
    "id",
    CANDIDATE_LIMITS.id,
    true,
    collector,
  );

  const rawName = readString(
    input,
    "rawName",
    "rawName",
    CANDIDATE_LIMITS.rawName,
    true,
    collector,
  );

  const rawSource = readObject(
    input,
    "source",
    "source",
    collector,
  );

  const rawHints = readObject(
    input,
    "hints",
    "hints",
    collector,
  );

  const source = rawSource
    ? validateSource(
        rawSource,
        collector,
      )
    : undefined;

  const hints = rawHints
    ? validateHints(
        rawHints,
        collector,
      )
    : undefined;

  if (
    collector.issues.length > 0 ||
    id === undefined ||
    rawName === undefined ||
    source === undefined ||
    hints === undefined
  ) {
    return {
      ok: false,

      issues: collector.issues,
    };
  }

  return {
    ok: true,

    value: {
      id,
      rawName,
      source,
      hints,
    },
  };
}
