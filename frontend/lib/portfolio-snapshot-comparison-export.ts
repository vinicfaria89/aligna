import { csvDocument } from "./csv-format";
import type {
  ComparedSnapshotItem,
  ComparedSnapshotItemChange,
  PortfolioSnapshotComparison,
} from "./portfolio-snapshot-comparison";
import type { SnapshotItem } from "./portfolio-snapshot-mapping";

/**
 * TASK-053C: CSV export of a `PortfolioSnapshotComparison` (TASK-053A's pure
 * `comparePortfolioSnapshots`). Pure -- no I/O, no DOM, no network -- reusing
 * the SAME RFC4180-style escaping as the existing snapshot export
 * (`lib/csv-format.ts`, already shared by the individual-result export and
 * the .xlsx adapter) and the same download trigger
 * (`downloadCsvFile`, `lib/portfolio-snapshot-export.ts`) -- nothing about
 * quoting or the browser download mechanism is reinvented here.
 *
 * --- Columns ---------------------------------------------------------------------------------
 *
 *   row_type,section,key,name,code,status_before,status_after,
 *   value_before,value_after,absolute_change,percentage_change,
 *   value_changed,status_changed
 *
 * `row_type` is `summary` or `item`. A `summary` row's `key`/`name`/`code`
 * are always empty; `section` names the metric (`total`, `counts_added`,
 * `counts_removed`, `counts_kept`, `counts_changed_value`,
 * `counts_changed_status`) and `value_after` holds that metric's number
 * (`value_before`/`absolute_change`/`percentage_change` are used only by the
 * `total` summary row, matching `PortfolioSnapshotComparison.totals`).
 *
 * An `item` row's `section` is exactly one of `added`, `removed`, `kept` --
 * never more than one row per asset (`key`), so a spreadsheet pivot/sum never
 * double-counts:
 *   - `added`:   value_before=0, value_after=item's value, status_after set,
 *                status_before empty, value_changed/status_changed empty
 *                (not a "kept" comparison, so those flags do not apply).
 *   - `removed`: value_after=0, value_before=item's value, status_before set,
 *                status_after empty, value_changed/status_changed empty.
 *   - `kept`:    value_before/value_after/status_before/status_after/
 *                absolute_change/percentage_change/value_changed/
 *                status_changed all taken directly from the comparison's own
 *                `ComparedSnapshotItemChange` -- never recomputed here.
 *
 * `percentage_change` is a raw number (e.g. `50`, never `"50.0%"`) and an
 * EMPTY CELL when the comparison's `percentageChange` is `null` (a base
 * value of 0) -- never `Infinity`/`NaN`/the literal string "null". Amounts
 * are raw numbers, never currency-formatted (no "R$", no thousands
 * separator) -- a data export, not a display string, same convention as
 * `lib/portfolio-snapshot-export.ts`.
 *
 * Row order is deterministic: the `total` summary, then the four count
 * summaries (added, removed, kept, changed-value, changed-status, in that
 * fixed order), then `added` items, then `removed` items, then `kept` items
 * -- each group already in the comparison's own deterministic key order
 * (TASK-053A sorts `added`/`removed`/`kept` by key ascending).
 */

const COLUMNS = [
  "row_type",
  "section",
  "key",
  "name",
  "code",
  "status_before",
  "status_after",
  "value_before",
  "value_after",
  "absolute_change",
  "percentage_change",
  "value_changed",
  "status_changed",
] as const;

function num(value: number): string {
  // Raw number, never currency-formatted, never locale thousands separators.
  return String(value);
}

function maybeNum(value: number | null): string {
  return value === null ? "" : String(value);
}

function bool(value: boolean): string {
  return value ? "true" : "false";
}

/** Best available code/ticker for an item -- same priority the comparison
 * itself uses for identity (see portfolio-snapshot-comparison.ts), so the
 * exported `code` column matches what the app actually matched on. */
function bestCode(item: SnapshotItem): string {
  return item.ticker || item.code || item.verifiedAsset?.code || "";
}

function summaryRow(section: string, values: Partial<Record<(typeof COLUMNS)[number], string>>): string[] {
  const record: Record<string, string> = {
    row_type: "summary",
    section,
    key: "",
    name: "",
    code: "",
    status_before: "",
    status_after: "",
    value_before: "",
    value_after: "",
    absolute_change: "",
    percentage_change: "",
    value_changed: "",
    status_changed: "",
    ...values,
  };
  return COLUMNS.map((column) => record[column]);
}

function addedRow(entry: ComparedSnapshotItem): string[] {
  return summaryRow("added", {
    row_type: "item",
    section: "added",
    key: entry.key,
    name: entry.item.rawName,
    code: bestCode(entry.item),
    status_after: entry.status,
    value_before: num(0),
    value_after: num(entry.value),
    absolute_change: num(entry.value - 0),
  });
}

function removedRow(entry: ComparedSnapshotItem): string[] {
  return summaryRow("removed", {
    row_type: "item",
    section: "removed",
    key: entry.key,
    name: entry.item.rawName,
    code: bestCode(entry.item),
    status_before: entry.status,
    value_before: num(entry.value),
    value_after: num(0),
    absolute_change: num(0 - entry.value),
  });
}

function keptRow(entry: ComparedSnapshotItemChange): string[] {
  // Same asset in both snapshots: the target's name/code is shown as the
  // current one (falling back to base's when the target side lacks it),
  // matching "the best name/code available" -- never a separate row per side.
  const name = entry.target.rawName || entry.base.rawName;
  const code = bestCode(entry.target) || bestCode(entry.base);

  return summaryRow("kept", {
    row_type: "item",
    section: "kept",
    key: entry.key,
    name,
    code,
    status_before: entry.baseStatus,
    status_after: entry.targetStatus,
    value_before: num(entry.baseValue),
    value_after: num(entry.targetValue),
    absolute_change: num(entry.absoluteChange),
    percentage_change: maybeNum(entry.percentageChange),
    value_changed: bool(entry.valueChanged),
    status_changed: bool(entry.statusChanged),
  });
}

/** The exported CSV's text (UTF-8, RFC4180-escaped, header row first).
 * Pure: takes only the already-computed comparison, touches nothing else. */
export function buildPortfolioSnapshotComparisonCsv(
  comparison: PortfolioSnapshotComparison,
): string {
  const { totals, counts, added, removed, kept } = comparison;

  const rows: string[][] = [
    [...COLUMNS],
    summaryRow("total", {
      value_before: num(totals.baseValue),
      value_after: num(totals.targetValue),
      absolute_change: num(totals.absoluteChange),
      percentage_change: maybeNum(totals.percentageChange),
    }),
    summaryRow("counts_added", { value_after: num(counts.added) }),
    summaryRow("counts_removed", { value_after: num(counts.removed) }),
    summaryRow("counts_kept", { value_after: num(counts.kept) }),
    summaryRow("counts_changed_value", { value_after: num(counts.changedValue) }),
    summaryRow("counts_changed_status", { value_after: num(counts.changedStatus) }),
    ...added.map(addedRow),
    ...removed.map(removedRow),
    ...kept.map(keptRow),
  ];

  return csvDocument(rows);
}

/** `comparacao-carteira-YYYY-MM-DD-HH-mm__base-<8 chars>__alvo-<8 chars>.csv`.
 * Deterministic and readable; only a truncated (never full) id from each
 * snapshot goes into the name -- no portfolio data, no account identifier. */
export function comparisonExportFileName(
  baseId: string,
  targetId: string,
  now: Date = new Date(),
): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");

  const shortBase = baseId.slice(0, 8);
  const shortTarget = targetId.slice(0, 8);

  return `comparacao-carteira-${y}-${m}-${d}-${hh}-${mm}__base-${shortBase}__alvo-${shortTarget}.csv`;
}
