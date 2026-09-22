/**
 * The one place that knows how to escape a CSV field (RFC 4180 style), shared
 * by every module that PRODUCES CSV text in this app -- today the .xlsx-to-CSV
 * conversion (lib/aie/client/portfolio-excel-adapter.ts, TASK-038) and the
 * portfolio result export (lib/portfolio-snapshot-export.ts, TASK-040). A
 * single implementation means the two can never drift on quoting rules.
 *
 * Matches exactly what lib/aie/ingestion/adapters/portfolio-csv-adapter.ts's
 * tokenizer expects on the way back in: a field is quoted only when it
 * contains a comma, a quote or a line break, and an internal quote is escaped
 * by doubling it.
 *
 * Pure: no I/O, no environment, no knowledge of what the field means.
 */
export function escapeCsvField(value: string): string {
  return /[",\r\n]/.test(value)
    ? `"${value.replace(/"/g, '""')}"`
    : value;
}

/** One CSV record: each cell escaped, joined with commas. */
export function csvRow(cells: readonly string[]): string {
  return cells.map(escapeCsvField).join(",");
}

/** A full CSV document: `rows` (each already a list of raw, unescaped cell
 * values) joined with CRLF, the record separator portfolio-csv-adapter.ts's
 * tokenizer accepts. */
export function csvDocument(
  rows: readonly (readonly string[])[],
): string {
  return rows.map(csvRow).join("\r\n");
}
