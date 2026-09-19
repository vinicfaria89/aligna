import type {
  CandidateAsset,
} from "../../contracts";

import {
  ingestPortfolioCandidates,
  isCandidateAssetType,
} from "../portfolio-candidate-ingestion";

import type {
  PortfolioAssetInput,
} from "../portfolio-candidate-ingestion";

/**
 * Structured portfolio adapter (TASK-012).
 *
 *   untrusted structured data -> parseStructuredPortfolio -> PortfolioAssetInput[]
 *     -> ingestPortfolioCandidates -> CandidateAsset[]
 *
 * Responsibility: validate the SHAPE of an external structured payload and map
 * it to PortfolioAssetInput[]. Canonical normalization (rawName, identifiers,
 * cnpj, currency, amount rules, id generation, blank handling) belongs ONLY to
 * the ingestion layer: the adapter passes validated raw values through
 * unchanged and never trims, uppercases or defaults anything.
 *
 * Pure and deterministic: no I/O, no network, no process environment, no
 * providers, no resolution, no AI. Nothing is coerced: a string is never
 * turned into a number. Nothing is logged.
 *
 * Supported input (JSON-compatible):
 *   { "assets": [ { id?, rawName, assetType?, ticker?, isin?, cnpj?,
 *                   instrumentCode?, issuerName?, fundName?, maturityDate?,
 *                   currency?, amount?, source?: { fileId?, fileName?,
 *                   section?, row?, institution? } } ] }
 *
 * Policies:
 * - unknown fields are rejected at the root, in every asset and in `source`;
 * - a fixed list of sensitive customer/secret field names is rejected with a
 *   dedicated code so it is never silently ignored;
 * - an empty `assets` array is VALID (an empty portfolio is a legitimate
 *   statement) and yields no candidates;
 * - FAIL-FAST, like the ingestion layer: the first invalid asset throws with
 *   its index and no partial result is returned;
 * - issues carry only a safe path (known field names and a numeric index) and
 *   a stable code. They never echo submitted values or unknown key names.
 */

export type StructuredPortfolioIssueCode =
  | "required"
  | "type"
  | "invalid_value"
  | "unknown_field"
  | "forbidden_field"
  | "invalid_json";

export interface StructuredPortfolioIssue {
  path: string;

  code: StructuredPortfolioIssueCode;
}

export class StructuredPortfolioAdapterError extends Error {
  readonly issues: StructuredPortfolioIssue[];

  /** Index of the failing asset, when the failure is asset scoped. */
  readonly index?: number;

  constructor(
    issues: StructuredPortfolioIssue[],
    index?: number,
  ) {
    super(
      index === undefined
        ? "Invalid structured portfolio."
        : `Invalid structured portfolio asset at index ${index}.`,
    );

    this.name =
      "StructuredPortfolioAdapterError";

    this.issues = issues;

    this.index = index;
  }
}

const ROOT_FIELDS = ["assets"] as const;

const ASSET_STRING_FIELDS = [
  "id",
  "rawName",
  "ticker",
  "isin",
  "cnpj",
  "instrumentCode",
  "issuerName",
  "fundName",
  "maturityDate",
  "currency",
] as const;

const ASSET_FIELDS: readonly string[] = [
  ...ASSET_STRING_FIELDS,
  "assetType",
  "amount",
  "source",
];

const SOURCE_STRING_FIELDS = [
  "fileId",
  "fileName",
  "section",
  "institution",
] as const;

const SOURCE_FIELDS: readonly string[] = [
  ...SOURCE_STRING_FIELDS,
  "row",
];

/**
 * Customer data and secrets that must never enter the pipeline. Matched
 * case-insensitively, ignoring "_" and "-". Provider/runtime configuration
 * fields (provider, environment, url, ...) are not listed: they are simply
 * unknown fields.
 */
const FORBIDDEN_KEYS: ReadonlySet<string> =
  new Set([
    "customername",
    "cpf",
    "accountnumber",
    "totalwealth",
    "portfoliobalance",
    "password",
    "token",
    "accesstoken",
    "clientsecret",
  ]);

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

function isForbiddenKey(
  key: string,
): boolean {
  return FORBIDDEN_KEYS.has(
    key
      .toLowerCase()
      .replace(/[_-]/g, ""),
  );
}

class Issues {
  readonly list: StructuredPortfolioIssue[] =
    [];

  add(
    path: string,
    code: StructuredPortfolioIssueCode,
  ): void {
    if (this.list.length < 20) {
      this.list.push({
        path,
        code,
      });
    }
  }
}

/** Reports (at most once each) forbidden and unknown keys of an object. */
function checkKeys(
  source: PlainObject,
  allowed: readonly string[],
  path: string,
  issues: Issues,
): void {
  let forbidden = false;

  let unknown = false;

  for (const key of Object.keys(
    source,
  )) {
    if (allowed.includes(key)) {
      continue;
    }

    // Key names are user controlled: only the parent path is ever reported.
    if (isForbiddenKey(key)) {
      forbidden = true;
    } else {
      unknown = true;
    }
  }

  if (forbidden) {
    issues.add(
      path,
      "forbidden_field",
    );
  }

  if (unknown) {
    issues.add(
      path,
      "unknown_field",
    );
  }
}

function scalarString(
  source: PlainObject,
  key: string,
  path: string,
  issues: Issues,
): string | undefined {
  const value = source[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    issues.add(path, "type");

    return undefined;
  }

  // Passed through untouched: blank/trim handling belongs to ingestion.
  return value;
}

function scalarNumber(
  source: PlainObject,
  key: string,
  path: string,
  issues: Issues,
): number | undefined {
  const value = source[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number") {
    // Strings are never coerced into numbers.
    issues.add(path, "type");

    return undefined;
  }

  // A JSON number is always finite (1e999 parses to Infinity, NaN cannot be
  // written); range rules such as "not negative" belong to ingestion.
  if (!Number.isFinite(value)) {
    issues.add(
      path,
      "invalid_value",
    );

    return undefined;
  }

  return value;
}

function mapSource(
  raw: unknown,
  path: string,
  issues: Issues,
): PortfolioAssetInput["source"] {
  if (raw === undefined) {
    return undefined;
  }

  if (!isPlainObject(raw)) {
    issues.add(path, "type");

    return undefined;
  }

  checkKeys(
    raw,
    SOURCE_FIELDS,
    path,
    issues,
  );

  const source: NonNullable<
    PortfolioAssetInput["source"]
  > = {};

  for (const key of SOURCE_STRING_FIELDS) {
    const value = scalarString(
      raw,
      key,
      `${path}.${key}`,
      issues,
    );

    if (value !== undefined) {
      source[key] = value;
    }
  }

  const row = scalarNumber(
    raw,
    "row",
    `${path}.row`,
    issues,
  );

  if (row !== undefined) {
    source.row = row;
  }

  return source;
}

function mapAsset(
  raw: unknown,
  path: string,
  issues: Issues,
): PortfolioAssetInput | undefined {
  if (!isPlainObject(raw)) {
    issues.add(path, "type");

    return undefined;
  }

  checkKeys(
    raw,
    ASSET_FIELDS,
    path,
    issues,
  );

  const strings: Partial<
    Record<
      (typeof ASSET_STRING_FIELDS)[number],
      string
    >
  > = {};

  for (const key of ASSET_STRING_FIELDS) {
    const value = scalarString(
      raw,
      key,
      `${path}.${key}`,
      issues,
    );

    if (value !== undefined) {
      strings[key] = value;
    }
  }

  if (raw.rawName === undefined) {
    issues.add(
      `${path}.rawName`,
      "required",
    );
  }

  const assetTypeRaw = raw.assetType;

  let assetType:
    | PortfolioAssetInput["assetType"]
    | undefined;

  if (assetTypeRaw !== undefined) {
    if (
      typeof assetTypeRaw !== "string"
    ) {
      issues.add(
        `${path}.assetType`,
        "type",
      );
    } else if (
      !isCandidateAssetType(
        assetTypeRaw,
      )
    ) {
      issues.add(
        `${path}.assetType`,
        "invalid_value",
      );
    } else {
      assetType = assetTypeRaw;
    }
  }

  const amount = scalarNumber(
    raw,
    "amount",
    `${path}.amount`,
    issues,
  );

  const source = mapSource(
    raw.source,
    `${path}.source`,
    issues,
  );

  if (
    issues.list.length > 0 ||
    strings.rawName === undefined
  ) {
    return undefined;
  }

  const asset: PortfolioAssetInput = {
    rawName: strings.rawName,
  };

  if (strings.id !== undefined) {
    asset.id = strings.id;
  }

  if (assetType !== undefined) {
    asset.assetType = assetType;
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
    const value = strings[key];

    if (value !== undefined) {
      asset[key] = value;
    }
  }

  if (amount !== undefined) {
    asset.amount = amount;
  }

  if (source !== undefined) {
    asset.source = source;
  }

  return asset;
}

/**
 * Validates an untrusted structured payload and maps it to PortfolioAssetInput[]
 * (order preserved). Throws StructuredPortfolioAdapterError on the first invalid
 * asset. Performs no normalization.
 */
export function parseStructuredPortfolio(
  input: unknown,
): PortfolioAssetInput[] {
  const rootIssues = new Issues();

  if (!isPlainObject(input)) {
    rootIssues.add("$", "type");

    throw new StructuredPortfolioAdapterError(
      rootIssues.list,
    );
  }

  checkKeys(
    input,
    ROOT_FIELDS,
    "$",
    rootIssues,
  );

  const assets = input.assets;

  if (assets === undefined) {
    rootIssues.add(
      "assets",
      "required",
    );
  } else if (!Array.isArray(assets)) {
    rootIssues.add("assets", "type");
  }

  if (
    rootIssues.list.length > 0 ||
    !Array.isArray(assets)
  ) {
    throw new StructuredPortfolioAdapterError(
      rootIssues.list,
    );
  }

  return assets.map(
    (
      raw: unknown,
      index: number,
    ): PortfolioAssetInput => {
      const issues = new Issues();

      const asset = mapAsset(
        raw,
        `assets[${index}]`,
        issues,
      );

      if (
        issues.list.length > 0 ||
        asset === undefined
      ) {
        throw new StructuredPortfolioAdapterError(
          issues.list,
          index,
        );
      }

      return asset;
    },
  );
}

/**
 * Optional JSON-string entrypoint. Malformed JSON produces a safe adapter
 * error; the raw JSON text is never included in the error. No file I/O.
 */
export function parseStructuredPortfolioJson(
  json: string,
): PortfolioAssetInput[] {
  if (typeof json !== "string") {
    throw new StructuredPortfolioAdapterError(
      [
        {
          path: "$",

          code: "type",
        },
      ],
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    throw new StructuredPortfolioAdapterError(
      [
        {
          path: "$",

          code: "invalid_json",
        },
      ],
    );
  }

  return parseStructuredPortfolio(
    parsed,
  );
}

/**
 * parseStructuredPortfolio -> ingestPortfolioCandidates. The ingestion layer
 * remains the single source of normalization; it may throw
 * PortfolioIngestionError for canonical-rule violations.
 */
export function ingestStructuredPortfolio(
  input: unknown,
): CandidateAsset[] {
  return ingestPortfolioCandidates(
    parseStructuredPortfolio(input),
  );
}
