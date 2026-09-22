import { csvDocument } from "./csv-format";
import type { SnapshotItem } from "./portfolio-snapshot-mapping";

/**
 * CSV export of the portfolio result shown on screen (TASK-040).
 *
 * Takes `SnapshotItem[]` -- the SAME normalized, already-privacy-filtered shape
 * `toSnapshotItems()` builds for "Salvar resultado" (a fresh resolution) and
 * `SavedSnapshot.items` already is (a loaded snapshot). One function serves
 * both: a fresh result and a saved result converge on this one type before
 * export ever sees them, so this module never touches a token, a correlation
 * id, an internal `portfolio:*` id, provider evidence, the original file name
 * or anything from the .csv/.xlsx upload -- `SnapshotItem` was never given
 * any of that in the first place (see portfolio-snapshot-mapping.ts).
 *
 * Pure: no I/O, no console, no storage. The browser-side download trigger
 * (Blob + object URL + a synthetic click) lives in `downloadCsvFile` below,
 * the one part of this module that touches the DOM.
 */

const COLUMNS = [
  "linha",
  "ativo",
  "tipo",
  "ticker_ou_codigo",
  "valor",
  "moeda",
  "situacao",
  "campos_pendentes",
  "fontes",
  "codigo_verificado",
  "tipo_verificado",
  "moeda_verificada",
] as const;

/** Mirrors the labels already shown on screen (PortfolioCsvResolver.tsx's
 * STATUS_TEXT / "Erro ao resolver" for item-error) -- kept here, not imported
 * from the component, so this module stays a plain function with no React or
 * DOM dependency until `downloadCsvFile` is actually called. */
const STATUS_LABEL: Record<
  SnapshotItem["status"],
  string
> = {
  verified: "Verificado",
  "needs-more-evidence": "Precisa de mais evidências",
  "needs-user": "Precisa da sua confirmação",
  conflict: "Evidências em conflito",
  blocked: "Bloqueado",
  "item-error": "Erro ao resolver",
};

function text(value: string | undefined): string {
  return value ?? "";
}

function amountText(value: number | undefined): string {
  // A plain decimal, never locale-formatted (no thousands separator, no
  // currency symbol): this is a data export, not a display string, and a
  // plain number round-trips through any spreadsheet tool without ambiguity.
  return value === undefined ? "" : String(value);
}

function joined(values: readonly string[]): string {
  return values.join("; ");
}

function row(item: SnapshotItem): string[] {
  return [
    String(item.lineNumber),
    item.rawName,
    text(item.assetType),
    text(item.ticker ?? item.code),
    amountText(item.amount),
    text(item.currency),
    STATUS_LABEL[item.status],
    joined(item.pendingFields),
    joined(item.sources),
    text(item.verifiedAsset?.code),
    text(item.verifiedAsset?.type),
    text(item.verifiedAsset?.currency),
  ];
}

/** The exported CSV's text, UTF-8, with a header row. Empty input still
 * produces a header-only document (never called from the UI in that case --
 * the export button only shows with at least one item -- but staying total
 * keeps this function simple to test). */
export function snapshotItemsToResultCsv(
  items: readonly SnapshotItem[],
): string {
  return csvDocument([
    [...COLUMNS],
    ...items.map(row),
  ]);
}

/** `resultado-carteira-YYYY-MM-DD.csv`, from the given date (defaults to
 * now). No portfolio data, account identifier or file name goes into the
 * name -- only today's date. */
export function resultExportFileName(
  now: Date = new Date(),
): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");

  return `resultado-carteira-${y}-${m}-${d}.csv`;
}

/**
 * Triggers a browser download of `csvText` as `filename`. The only part of
 * this module that touches the DOM; kept as one small, injectable function so
 * a test can supply a fake `doc` and observe the Blob/anchor without a real
 * browser download happening. Nothing is stored (no localStorage/
 * sessionStorage) and nothing is logged.
 */
export function downloadCsvFile(
  filename: string,
  csvText: string,
  doc: Document = document,
): void {
  const blob = new Blob([csvText], {
    type: "text/csv;charset=utf-8",
  });

  const url = URL.createObjectURL(blob);

  try {
    const anchor = doc.createElement("a");

    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";

    doc.body.appendChild(anchor);

    anchor.click();

    doc.body.removeChild(anchor);
  } finally {
    URL.revokeObjectURL(url);
  }
}
