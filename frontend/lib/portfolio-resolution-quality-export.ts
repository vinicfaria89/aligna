import { csvDocument } from "./csv-format";
import { explainResolutionItem } from "./portfolio-resolution-explanations";
import { buildPortfolioResolutionImprovementPlan } from "./portfolio-resolution-improvement-plan";
import type {
  PortfolioResolutionQualitySummary,
  ResolutionErrorMetric,
} from "./portfolio-resolution-quality-metrics";
import { summarizePortfolioResolutionQuality } from "./portfolio-resolution-quality-metrics";
import { detectPortfolioResolutionUxHint } from "./portfolio-resolution-ux-hints";
import type { SnapshotItem } from "./portfolio-snapshot-mapping";

/**
 * TASK-066A: pure CSV export of the resolution-quality diagnostic --
 * `summarizePortfolioResolutionQuality` (TASK-060A) + `buildPortfolioResolutionImprovementPlan`
 * (TASK-062A) +, per item, `explainResolutionItem` (TASK-061A) and
 * `detectPortfolioResolutionUxHint` (TASK-065A), composed exactly the way
 * `PortfolioCsvResolver.tsx`'s `withUxHint` already does (TASK-065B) -- the
 * suggestion column reflects what the UI actually shows, not a
 * re-derivation. No new decision logic lives here: this module only reads
 * fields those pure helpers already computed and formats them as CSV rows.
 * No UI, no DOM, no download trigger, no button -- that is TASK-066B.
 */

const COLUMNS = [
  "row_type",
  "section",
  "key",
  "name",
  "status",
  "asset_type",
  "source",
  "explanation_title",
  "suggestion",
] as const;

type Row = readonly [string, string, string, string, string, string, string, string, string];

function text(value: string | undefined | null): string {
  return value ?? "";
}

/** Same priority as TASK-056A/060A/061A/062A: `item.assetType` first,
 * `verifiedAsset.type` as fallback, empty last -- no new rule, and never
 * the literal string "unknown" (this is a data export, not the UI). */
function extractAssetType(item: SnapshotItem): string {
  const raw = item.assetType ?? item.verifiedAsset?.type;
  return typeof raw === "string" ? raw.trim() : "";
}

function summaryRows(summary: PortfolioResolutionQualitySummary): Row[] {
  const { totals, byStatus, byAssetType, bySource, pendingReasons, errors } = summary;

  const rows: Row[] = [
    ["summary", "totals", "items", String(totals.items), "", "", "", "", ""],
    ["summary", "totals", "verified", String(totals.verified), "", "", "", "", ""],
    ["summary", "totals", "pending", String(totals.pending), "", "", "", "", ""],
    ["summary", "totals", "errors", String(totals.errors), "", "", "", "", ""],
    ["summary", "totals", "blocked", String(totals.blocked), "", "", "", "", ""],
    ["summary", "totals", "conflicts", String(totals.conflicts), "", "", "", "", ""],
    ["summary", "totals", "needs_user", String(totals.needsUser), "", "", "", "", ""],
    [
      "summary",
      "totals",
      "needs_more_evidence",
      String(totals.needsMoreEvidence),
      "",
      "",
      "",
      "",
      "",
    ],
    [
      "summary",
      "totals",
      "verification_rate",
      totals.verificationRate === null ? "" : String(totals.verificationRate),
      "",
      "",
      "",
      "",
      "",
    ],
  ];

  for (const s of byStatus) {
    rows.push(["summary", "by_status", s.status, `${s.label} (${s.count})`, s.status, "", "", "", ""]);
  }

  for (const a of byAssetType) {
    rows.push([
      "summary",
      "by_asset_type",
      a.assetType,
      `${a.label} (${a.count})`,
      "",
      a.assetType,
      "",
      "",
      "",
    ]);
  }

  for (const src of bySource) {
    rows.push([
      "summary",
      "by_source",
      src.source,
      `${src.source} (${src.count})`,
      "",
      "",
      src.source,
      "",
      "",
    ]);
  }

  for (const r of pendingReasons) {
    rows.push(["summary", "pending_reasons", r.reason, `${r.label} (${r.count})`, "", "", "", "", ""]);
  }

  for (const e of errors as readonly ResolutionErrorMetric[]) {
    rows.push(["summary", "errors", e.key, e.name, e.status, "", "", "", text(e.message)]);
  }

  return rows;
}

function improvementRows(items: readonly SnapshotItem[]): Row[] {
  const plan = buildPortfolioResolutionImprovementPlan(items);

  return plan.suggestions.map(
    (s): Row => [
      "improvement",
      "suggestion",
      s.id,
      `${s.affectedItems} ativo(s) afetado(s)`,
      s.priority,
      "",
      "",
      s.title,
      s.description,
    ],
  );
}

/** Same merge `PortfolioCsvResolver.tsx`'s `withUxHint` does (TASK-065B):
 * the UX hint replaces only the displayed suggestion, never the title. */
function displayedSuggestion(item: SnapshotItem, explanationSuggestion: string | undefined): string {
  const hint = detectPortfolioResolutionUxHint(item);

  return hint ? hint.suggestion : (explanationSuggestion ?? "");
}

function itemRows(items: readonly SnapshotItem[]): Row[] {
  return items.map((item): Row => {
    const explanation = explainResolutionItem(item);

    return [
      "item",
      "item",
      String(item.lineNumber),
      item.rawName,
      item.status,
      extractAssetType(item),
      item.sources.join("; "),
      explanation.title,
      displayedSuggestion(item, explanation.suggestion),
    ];
  });
}

/** The exported CSV's text, UTF-8, with a header row -- summary rows first,
 * then improvement-plan rows, then one row per item, all in the stable
 * order the underlying pure helpers already produce. Deterministic: same
 * input always yields the same output; `items` is never mutated. */
export function buildPortfolioResolutionQualityCsv(items: readonly SnapshotItem[]): string {
  const summary = summarizePortfolioResolutionQuality(items);

  return csvDocument([
    [...COLUMNS],
    ...summaryRows(summary),
    ...improvementRows(items),
    ...itemRows(items),
  ]);
}

/** `qualidade-resolucao-YYYY-MM-DD.csv`, from the given date (defaults to
 * now). No portfolio data or account identifier goes into the name -- only
 * today's date, the same convention as `resultExportFileName`
 * (portfolio-snapshot-export.ts). */
export function resolutionQualityExportFileName(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");

  return `qualidade-resolucao-${y}-${m}-${d}.csv`;
}
