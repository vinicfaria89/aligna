import { readSheet } from "read-excel-file/browser";

import { MAX_PORTFOLIO_ROWS } from "../ingestion/portfolio-csv-limits";

/**
 * Excel (.xlsx) adapter for the portfolio upload (TASK-038).
 *
 *   .xlsx File -> readPortfolioExcelWorkbook (read-excel-file) -> raw cell rows
 *     -> excelRowsToCsvText -> CSV text -> the EXISTING CSV pipeline
 *       (buildPortfolioCsvPreview / ingestPortfolioCsv), completely unchanged
 *
 * This module does not parse, normalize or validate a portfolio: it only
 * converts spreadsheet rows into the exact CSV text the existing adapter
 * already accepts, so canonical normalization stays in ONE place
 * (portfolio-csv-adapter.ts / portfolio-candidate-ingestion.ts) and is never
 * duplicated here.
 *
 * Privacy (TASK-038): only the FIRST sheet is ever read. `read-excel-file`
 * exposes computed cell VALUES only -- it has no API surface for formulas,
 * macros, hidden sheets, defined names or file metadata (author, company,
 * etc.), so none of that can leak through this module even by accident. The
 * original file is never written anywhere (no storage, no network, no
 * console) and never leaves the caller's stack: this module takes a `File`
 * and returns plain data.
 *
 * Browser-only: imports the browser build directly (not the universal one),
 * so no Node-only code path is ever bundled or executed here.
 */

/** Raw .xlsx upload size cap (TASK-038).
 *
 * Distinct from MAX_CSV_UPLOAD_BYTES, which bounds the CONVERTED CSV text sent
 * to the server: .xlsx is a compressed zip container, so a small table can
 * still be a few hundred KB once styles/theme XML overhead is included. This
 * only bounds how much is ever read into memory for one upload; the row-count
 * and converted-text-size limits below still apply on top of it.
 */
export const MAX_XLSX_UPLOAD_BYTES = 8 * 1024 * 1024;

export type PortfolioExcelReadFailure = "empty" | "read-failed";

export type PortfolioExcelReadResult =
  | { ok: true; headerRow: unknown[]; dataRows: unknown[][] }
  | { ok: false; reason: PortfolioExcelReadFailure };

function hasContent(row: readonly unknown[]): boolean {
  return row.some((cell) => cell !== null && cell !== undefined && cell !== "");
}

/**
 * Reads only the first sheet of an .xlsx file. A sheet with no rows at all is
 * `"empty"`. Trailing/blank rows (every cell null or "") among the DATA rows
 * are dropped before the caller ever sees them -- a common artifact of
 * spreadsheet software after rows are deleted, never a real portfolio line;
 * the header row is always kept as-is.
 */
export async function readPortfolioExcelFile(
  file: File,
): Promise<PortfolioExcelReadResult> {
  let rows: unknown[][];

  try {
    rows = (await readSheet(file, 1)) as unknown[][];
  } catch {
    return { ok: false, reason: "read-failed" };
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, reason: "empty" };
  }

  const [headerRow, ...rest] = rows;

  return {
    ok: true,
    headerRow: headerRow ?? [],
    dataRows: rest.filter(hasContent),
  };
}

/** Kept equal to the portfolio row limit so the caller can fail fast, before
 * converting a pathological sheet into a large CSV string. */
export const MAX_EXCEL_DATA_ROWS = MAX_PORTFOLIO_ROWS;

function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (value instanceof Date) {
    // A calendar date only: Excel serial dates carry no timezone. `maturityDate`
    // (the only date-shaped column) accepts free text (<=32 chars), so this
    // exact format is a readability choice, not a contract requirement.
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  if (typeof value === "number") {
    // Finite, non-huge portfolio numbers never need exponential notation; a
    // value that would (>= 1e21 or a non-finite value) is left to the existing
    // CSV amount parser to reject with its normal "invalid_value" issue.
    return String(value);
  }

  return "";
}

/** RFC 4180 escaping matching what portfolio-csv-adapter.ts's tokenizer expects. */
function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Converts spreadsheet rows into CSV text for the EXISTING CSV pipeline. Pure:
 * no I/O, no knowledge of portfolio semantics (header names are passed through
 * exactly as given; `portfolio-csv-adapter.ts` alone decides which are known,
 * required or forbidden).
 */
export function excelRowsToCsvText(
  headerRow: readonly unknown[],
  dataRows: readonly (readonly unknown[])[],
): string {
  return [headerRow, ...dataRows]
    .map((row) => row.map((cell) => escapeCsvField(formatCell(cell))).join(","))
    .join("\r\n");
}
