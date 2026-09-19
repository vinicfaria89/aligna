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

import {
  isForbiddenFieldName,
} from "./structured-portfolio-adapter";

/**
 * CSV portfolio adapter (TASK-013).
 *
 *   CSV text -> parsePortfolioCsv -> PortfolioAssetInput[]
 *     -> ingestPortfolioCandidates -> CandidateAsset[]
 *
 * Responsibility: STRUCTURAL parsing of a generic, header-based CSV and the
 * strictly typed conversion of the two numeric columns. Canonical normalization
 * (rawName, ticker, isin, instrumentCode, cnpj, currency, blank handling, id
 * generation, amount range rules) belongs ONLY to the ingestion layer: string
 * cells are passed through untouched.
 *
 * Parser: an explicit RFC 4180 style state machine (no dependency, never a naive
 * split). Comma delimiter; quoted fields; commas, quotes ("") and line breaks
 * inside quotes; LF and CRLF record separators; optional UTF-8 BOM. A quote may
 * only open a field and must be closed; a stray quote, text after a closing quote,
 * a lone CR outside quotes or an unterminated quote is a `malformed_csv` error.
 *
 * Canonical headers (exact, case-sensitive; surrounding spaces are trimmed):
 *   id rawName assetType ticker isin cnpj instrumentCode issuerName fundName
 *   maturityDate currency amount fileId fileName section row institution
 * `rawName` is required. Unknown, duplicate and empty headers are rejected, and
 * so are sensitive customer/secret headers (same policy as the structured
 * adapter). Nothing is renamed or fuzzy matched.
 *
 * Cells:
 * - an empty cell ("") omits the field (so ingestion sees it as absent);
 * - `amount`: only a strict canonical decimal (digits, optional leading "-",
 *   optional "." fraction). Locale formats (R$ 1.000,00 / 1.000,00), exponents,
 *   signs like "+", spaces, NaN/Infinity and values that would lose double
 *   precision (more than 15 significant digits) are rejected. A whitespace-only
 *   amount cell counts as empty. The range rule (>= 0) belongs to ingestion;
 * - `row`: only a non-negative integer of plain digits;
 * - `assetType`: exact allowed value (via the ingestion layer's predicate).
 *
 * Row numbering: CSV records are numbered from 1 (the header is row 1, the first
 * data row is row 2, like a spreadsheet); blank lines are skipped but counted.
 * Every data row must have exactly as many cells as the header.
 *
 * FAIL-FAST: header issues are reported together; otherwise the first invalid
 * data row throws and no partial result is returned. Issues carry only a safe
 * location (header[i], row[n], row[n].column) and a stable code: never cell
 * contents, header names or row contents.
 *
 * Pure and deterministic: no I/O, no network, no process environment, no
 * providers, no resolution, no AI.
 */

export type PortfolioCsvIssueCode =
  | "required"
  | "invalid_value"
  | "unknown_field"
  | "forbidden_field"
  | "duplicate_header"
  | "empty_header"
  | "extra_columns"
  | "missing_columns"
  | "malformed_csv";

export interface PortfolioCsvIssue {
  path: string;

  code: PortfolioCsvIssueCode;
}

export class PortfolioCsvAdapterError extends Error {
  readonly issues: PortfolioCsvIssue[];

  /** CSV row number (the header is row 1) for row scoped failures. */
  readonly row?: number;

  constructor(
    issues: PortfolioCsvIssue[],
    row?: number,
  ) {
    super(
      row === undefined
        ? "Invalid portfolio CSV."
        : `Invalid portfolio CSV at row ${row}.`,
    );

    this.name =
      "PortfolioCsvAdapterError";

    this.issues = issues;

    this.row = row;
  }
}

export const CSV_CANONICAL_HEADERS = [
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
  "fileId",
  "fileName",
  "section",
  "row",
  "institution",
] as const;

type CanonicalHeader =
  (typeof CSV_CANONICAL_HEADERS)[number];

const CANONICAL: ReadonlySet<string> =
  new Set(CSV_CANONICAL_HEADERS);

const DECIMAL = /^-?\d+(\.\d+)?$/;

const NON_NEGATIVE_INTEGER = /^\d+$/;

const MAX_SIGNIFICANT_DIGITS = 15;

const MAX_ISSUES = 20;

interface CsvRecord {
  cells: string[];

  /** 1-based record number (the header is 1). */
  row: number;
}

function malformed(
  row: number,
): PortfolioCsvAdapterError {
  return new PortfolioCsvAdapterError(
    [
      {
        path: `row[${row}]`,

        code: "malformed_csv",
      },
    ],
    row,
  );
}

/**
 * RFC 4180 style tokenizer. Blank lines produce no record but still advance the
 * row counter.
 */
function tokenize(
  input: string,
): CsvRecord[] {
  // A UTF-8 BOM (U+FEFF) at the very start is not data.
  const text =
    input.charCodeAt(0) === 0xfeff
      ? input.slice(1)
      : input;

  const records: CsvRecord[] = [];

  let cells: string[] = [];

  let field = "";

  let inQuotes = false;

  let afterQuote = false;

  let row = 1;

  const endField = (): void => {
    cells.push(field);

    field = "";

    afterQuote = false;
  };

  const endRecord = (): void => {
    endField();

    const blank =
      cells.length === 1 &&
      cells[0] === "";

    if (!blank) {
      records.push({
        cells,
        row,
      });
    }

    cells = [];

    row += 1;
  };

  for (
    let i = 0;
    i < text.length;
    i += 1
  ) {
    const char = text[i]!;

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';

          i += 1;
        } else {
          inQuotes = false;

          afterQuote = true;
        }
      } else {
        field += char;
      }

      continue;
    }

    const lineBreak =
      char === "\n" ||
      (char === "\r" &&
        text[i + 1] === "\n");

    if (afterQuote) {
      if (char === ",") {
        endField();
      } else if (lineBreak) {
        if (char === "\r") {
          i += 1;
        }

        endRecord();
      } else {
        // Text after a closing quote.
        throw malformed(row);
      }

      continue;
    }

    if (char === '"') {
      if (field.length !== 0) {
        // A quote inside an unquoted field.
        throw malformed(row);
      }

      inQuotes = true;
    } else if (char === ",") {
      endField();
    } else if (lineBreak) {
      if (char === "\r") {
        i += 1;
      }

      endRecord();
    } else if (char === "\r") {
      // A lone CR outside quotes.
      throw malformed(row);
    } else {
      field += char;
    }
  }

  if (inQuotes) {
    throw malformed(row);
  }

  if (
    field.length > 0 ||
    cells.length > 0 ||
    afterQuote
  ) {
    endRecord();
  }

  return records;
}

class Issues {
  readonly list: PortfolioCsvIssue[] =
    [];

  add(
    path: string,
    code: PortfolioCsvIssueCode,
  ): void {
    if (this.list.length < MAX_ISSUES) {
      this.list.push({
        path,
        code,
      });
    }
  }
}

function readHeaders(
  record: CsvRecord | undefined,
): CanonicalHeader[] {
  if (record === undefined) {
    throw new PortfolioCsvAdapterError(
      [
        {
          path: "header",

          code: "required",
        },
      ],
    );
  }

  const issues = new Issues();

  const seen = new Set<string>();

  const headers: CanonicalHeader[] = [];

  record.cells.forEach(
    (cell, index) => {
      const path = `header[${index + 1}]`;

      const name = cell.trim();

      if (name.length === 0) {
        issues.add(
          path,
          "empty_header",
        );

        return;
      }

      // Header names are user controlled: only the position is reported.
      if (isForbiddenFieldName(name)) {
        issues.add(
          path,
          "forbidden_field",
        );

        return;
      }

      if (!CANONICAL.has(name)) {
        issues.add(
          path,
          "unknown_field",
        );

        return;
      }

      if (seen.has(name)) {
        issues.add(
          path,
          "duplicate_header",
        );

        return;
      }

      seen.add(name);

      headers.push(
        name as CanonicalHeader,
      );
    },
  );

  if (!seen.has("rawName")) {
    issues.add(
      "header",
      "required",
    );
  }

  if (issues.list.length > 0) {
    throw new PortfolioCsvAdapterError(
      issues.list,
      record.row,
    );
  }

  return headers;
}

function parseAmount(
  text: string,
): number | undefined | null {
  if (text.trim().length === 0) {
    return undefined;
  }

  if (!DECIMAL.test(text)) {
    return null;
  }

  const digits = text
    .replace("-", "")
    .replace(".", "")
    .replace(/^0+/, "");

  if (
    digits.length >
    MAX_SIGNIFICANT_DIGITS
  ) {
    // Would silently lose double precision.
    return null;
  }

  const value = Number(text);

  return Number.isFinite(value)
    ? value
    : null;
}

function parseRowNumber(
  text: string,
): number | undefined | null {
  if (text.trim().length === 0) {
    return undefined;
  }

  if (!NON_NEGATIVE_INTEGER.test(text)) {
    return null;
  }

  const value = Number(text);

  return Number.isSafeInteger(value)
    ? value
    : null;
}

function mapRow(
  headers: readonly CanonicalHeader[],
  record: CsvRecord,
): PortfolioAssetInput {
  const path = `row[${record.row}]`;

  const issues = new Issues();

  if (
    record.cells.length >
    headers.length
  ) {
    issues.add(path, "extra_columns");
  } else if (
    record.cells.length <
    headers.length
  ) {
    issues.add(
      path,
      "missing_columns",
    );
  }

  if (issues.list.length > 0) {
    throw new PortfolioCsvAdapterError(
      issues.list,
      record.row,
    );
  }

  const cells: Partial<
    Record<CanonicalHeader, string>
  > = {};

  headers.forEach((header, index) => {
    cells[header] =
      record.cells[index];
  });

  const asset: PortfolioAssetInput = {
    // rawName is always passed (even empty) so ingestion reports it.
    rawName: cells.rawName ?? "",
  };

  // String cells pass through untouched; an empty cell omits the field.
  for (const key of [
    "id",
    "ticker",
    "isin",
    "cnpj",
    "instrumentCode",
    "issuerName",
    "fundName",
    "maturityDate",
    "currency",
  ] as const) {
    const value = cells[key];

    if (value !== undefined && value !== "") {
      asset[key] = value;
    }
  }

  const assetType = cells.assetType;

  if (
    assetType !== undefined &&
    assetType !== ""
  ) {
    if (isCandidateAssetType(assetType)) {
      asset.assetType = assetType;
    } else {
      issues.add(
        `${path}.assetType`,
        "invalid_value",
      );
    }
  }

  if (cells.amount !== undefined) {
    const amount = parseAmount(
      cells.amount,
    );

    if (amount === null) {
      issues.add(
        `${path}.amount`,
        "invalid_value",
      );
    } else if (amount !== undefined) {
      asset.amount = amount;
    }
  }

  const source: NonNullable<
    PortfolioAssetInput["source"]
  > = {};

  for (const key of [
    "fileId",
    "fileName",
    "section",
    "institution",
  ] as const) {
    const value = cells[key];

    if (value !== undefined && value !== "") {
      source[key] = value;
    }
  }

  if (cells.row !== undefined) {
    const rowNumber = parseRowNumber(
      cells.row,
    );

    if (rowNumber === null) {
      issues.add(
        `${path}.row`,
        "invalid_value",
      );
    } else if (rowNumber !== undefined) {
      source.row = rowNumber;
    }
  }

  if (issues.list.length > 0) {
    throw new PortfolioCsvAdapterError(
      issues.list,
      record.row,
    );
  }

  if (Object.keys(source).length > 0) {
    asset.source = source;
  }

  return asset;
}

/**
 * Parses CSV text into PortfolioAssetInput[] (row order preserved). A header
 * with no data rows is a valid empty portfolio. Throws PortfolioCsvAdapterError.
 * Performs no normalization.
 */
export function parsePortfolioCsv(
  csv: string,
): PortfolioAssetInput[] {
  if (typeof csv !== "string") {
    throw new PortfolioCsvAdapterError(
      [
        {
          path: "$",

          code: "invalid_value",
        },
      ],
    );
  }

  const [headerRecord, ...dataRecords] =
    tokenize(csv);

  const headers =
    readHeaders(headerRecord);

  return dataRecords.map((record) =>
    mapRow(headers, record),
  );
}

/**
 * parsePortfolioCsv -> ingestPortfolioCandidates. The ingestion layer stays the
 * single source of normalization. A PortfolioIngestionError `index` N refers to
 * the (N+1)th data row, i.e. CSV row N+2.
 */
export function ingestPortfolioCsv(
  csv: string,
): CandidateAsset[] {
  return ingestPortfolioCandidates(
    parsePortfolioCsv(csv),
  );
}
