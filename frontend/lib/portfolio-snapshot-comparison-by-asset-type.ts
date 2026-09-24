import type {
  ComparedSnapshotItem,
  ComparedSnapshotItemChange,
  PortfolioSnapshotComparison,
  PortfolioSnapshotComparisonCounts,
  PortfolioSnapshotComparisonTotals,
} from "./portfolio-snapshot-comparison";
import type { SnapshotItem } from "./portfolio-snapshot-mapping";

/**
 * TASK-056A: groups an ALREADY-COMPUTED `PortfolioSnapshotComparison`
 * (TASK-053A) by asset type/class. Pure -- no React, no DOM, no network, no
 * storage, no current date -- data in, data out, same as the comparison it
 * builds on. This is deliberately just the data shape: no UI reads it yet
 * (that is TASK-056B). It never re-derives what changed -- `added`/
 * `removed`/`kept` entries are the SAME objects `comparePortfolioSnapshots`
 * already produced, only redistributed into per-type buckets; identity,
 * duplicate-aggregation, value and status-change rules all stay exactly
 * where TASK-053A defined them.
 *
 * --- Where the asset type comes from --------------------------------------------------------
 *
 * Never inferred, never looked up (no AIE call, no regex guess, no B3
 * catalog lookup) -- only read from fields the snapshot/comparison already
 * carries:
 *
 *   - `added`/`removed` item: `item.assetType`, falling back to
 *     `item.verifiedAsset?.type` (the verified asset's OWN field is called
 *     `type`, not `assetType` -- see `SnapshotVerifiedAsset` in
 *     portfolio-snapshot-mapping.ts; the task prompt's suggested
 *     `verifiedAsset.assetType` doesn't exist on the real type).
 *   - `kept` entry: prefers the TARGET side (`target.assetType`, then
 *     `target.verifiedAsset?.type`), then falls back to the BASE side
 *     (`base.assetType`, then `base.verifiedAsset?.type`) -- an asset that
 *     went from unverified to verified between snapshots should group by
 *     its now-known type, but an item that somehow lost its type on the
 *     target side still groups sanely by what it used to be.
 *
 * Whatever is picked is normalized with `trim().toLowerCase()`; missing,
 * empty or whitespace-only becomes `"unknown"` -- never a crash, never a
 * silently-dropped item (an unrecognized/empty type still gets its own
 * group, never discarded).
 *
 * --- Ordering ----------------------------------------------------------------------------------
 *
 * Groups are sorted by a fixed, curated order for the asset types this
 * project actually produces (`lib/aie/contracts/candidate-asset.ts`'s
 * `CandidateAssetType`, plus `"unknown"`); any OTHER string (a type this
 * function has never heard of) sorts after every curated type, in its own
 * alphabetical order among itself -- so a truly unknown-to-this-map type is
 * still fully deterministic, never dependent on `Map` iteration order.
 * `order` on each group is its FINAL 0-based position in that sorted list
 * (not a lookup-table index), so a future UI can sort by it directly.
 *
 * Items WITHIN a group keep the exact order `comparison.added`/`removed`/
 * `kept` already had (TASK-053A sorts each by key ascending) -- grouping
 * never reorders an individual list, only redistributes entries across
 * groups.
 *
 * --- Totals and counts --------------------------------------------------------------------------
 *
 * Per-group totals follow the same base/target/absoluteChange/
 * percentageChange shape as the overall comparison: an added item counts 0
 * on the base side, a removed item counts 0 on the target side, a kept
 * item's own `baseValue`/`targetValue` count on both sides.
 * `percentageChange` is `null` whenever the group's `baseValue` is 0 --
 * never `Infinity`/`NaN`, same rule as TASK-053A.
 *
 * The TOP-LEVEL `totals`/`counts` are never independently recomputed --
 * they ARE `comparison.totals`/`comparison.counts` (plus `counts.groups`,
 * the number of non-empty groups) -- so this function can never disagree
 * with the comparison it was given.
 *
 * A group is never created unless at least one item lands in it, so a
 * "completely empty" group never appears; a group WITH items is never
 * filtered out even if its totals happen to net to zero (e.g. one added +
 * one removed of the same value).
 *
 * Never mutates `comparison` or anything inside it.
 */

export interface PortfolioSnapshotComparisonAssetTypeGroup {
  assetType: string;
  label: string;
  order: number;
  added: ComparedSnapshotItem[];
  removed: ComparedSnapshotItem[];
  kept: ComparedSnapshotItemChange[];
  totals: PortfolioSnapshotComparisonTotals;
  counts: {
    added: number;
    removed: number;
    kept: number;
    changedValue: number;
    changedStatus: number;
  };
}

export interface PortfolioSnapshotComparisonByAssetType {
  groups: PortfolioSnapshotComparisonAssetTypeGroup[];
  totals: PortfolioSnapshotComparisonTotals;
  counts: PortfolioSnapshotComparisonCounts & { groups: number };
}

// Curated order for the asset types this project's AIE resolver actually
// produces (`CandidateAssetType`, lib/aie/contracts/candidate-asset.ts),
// plus "unknown". Anything not in this list sorts after all of it.
const KNOWN_ASSET_TYPE_ORDER: readonly string[] = [
  "stock",
  "fii",
  "etf",
  "international",
  "debenture",
  "cdb",
  "lci",
  "lca",
  "cri",
  "cra",
  "coe",
  "fund",
  "crypto",
  "unknown",
];

const ASSET_TYPE_LABELS: Readonly<Record<string, string>> = {
  stock: "Ações",
  fii: "FIIs",
  etf: "ETFs",
  international: "BDRs e internacionais",
  debenture: "Debêntures",
  cdb: "CDBs",
  lci: "LCIs",
  lca: "LCAs",
  cri: "CRIs",
  cra: "CRAs",
  coe: "COEs",
  fund: "Fundos",
  crypto: "Criptoativos",
  unknown: "Sem tipo definido",
};

/** Missing/empty/whitespace-only becomes "unknown"; everything else is
 * trim()+toLowerCase() so "Stock", " stock " and "stock" group together. */
function normalizeAssetType(value: string | undefined): string {
  if (typeof value !== "string") {
    return "unknown";
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : "unknown";
}

function addedOrRemovedAssetType(item: SnapshotItem): string {
  return normalizeAssetType(item.assetType ?? item.verifiedAsset?.type);
}

function keptAssetType(entry: ComparedSnapshotItemChange): string {
  return normalizeAssetType(
    entry.target.assetType ?? entry.target.verifiedAsset?.type ?? entry.base.assetType ?? entry.base.verifiedAsset?.type,
  );
}

/** A curated type's position in `KNOWN_ASSET_TYPE_ORDER`, or -- for anything
 * not in that list -- a shared bucket past the end of it, broken by plain
 * alphabetical order so unrecognized types are still fully deterministic. */
function compareAssetTypeForSort(a: string, b: string): number {
  const rankA = KNOWN_ASSET_TYPE_ORDER.indexOf(a);
  const rankB = KNOWN_ASSET_TYPE_ORDER.indexOf(b);
  const bucketA = rankA === -1 ? KNOWN_ASSET_TYPE_ORDER.length : rankA;
  const bucketB = rankB === -1 ? KNOWN_ASSET_TYPE_ORDER.length : rankB;

  if (bucketA !== bucketB) {
    return bucketA - bucketB;
  }
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/** A minimal, deterministic label for a type this module has no curated
 * label for: capitalizes each hyphen/underscore/space-separated word, never
 * inventing meaning it doesn't have (e.g. "real-estate" -> "Real Estate"). */
function humanizeUnknownAssetType(assetType: string): string {
  return assetType
    .split(/[-_\s]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function labelForAssetType(assetType: string): string {
  return ASSET_TYPE_LABELS[assetType] ?? humanizeUnknownAssetType(assetType);
}

interface MutableAssetTypeGroup {
  assetType: string;
  added: ComparedSnapshotItem[];
  removed: ComparedSnapshotItem[];
  kept: ComparedSnapshotItemChange[];
}

function buildGroup(group: MutableAssetTypeGroup, order: number): PortfolioSnapshotComparisonAssetTypeGroup {
  const baseValue =
    group.removed.reduce((total, entry) => total + entry.value, 0) +
    group.kept.reduce((total, entry) => total + entry.baseValue, 0);
  const targetValue =
    group.added.reduce((total, entry) => total + entry.value, 0) +
    group.kept.reduce((total, entry) => total + entry.targetValue, 0);
  const absoluteChange = targetValue - baseValue;

  return {
    assetType: group.assetType,
    label: labelForAssetType(group.assetType),
    order,
    added: group.added,
    removed: group.removed,
    kept: group.kept,
    totals: {
      baseValue,
      targetValue,
      absoluteChange,
      percentageChange: baseValue === 0 ? null : (absoluteChange / baseValue) * 100,
    },
    counts: {
      added: group.added.length,
      removed: group.removed.length,
      kept: group.kept.length,
      changedValue: group.kept.filter((entry) => entry.valueChanged).length,
      changedStatus: group.kept.filter((entry) => entry.statusChanged).length,
    },
  };
}

export function groupPortfolioSnapshotComparisonByAssetType(
  comparison: PortfolioSnapshotComparison,
): PortfolioSnapshotComparisonByAssetType {
  const byAssetType = new Map<string, MutableAssetTypeGroup>();

  function groupFor(assetType: string): MutableAssetTypeGroup {
    const existing = byAssetType.get(assetType);
    if (existing !== undefined) {
      return existing;
    }
    const created: MutableAssetTypeGroup = { assetType, added: [], removed: [], kept: [] };
    byAssetType.set(assetType, created);
    return created;
  }

  // Iterating the comparison's own (already key-ascending-sorted, TASK-053A)
  // arrays and pushing preserves that exact order inside each group.
  for (const entry of comparison.added) {
    groupFor(addedOrRemovedAssetType(entry.item)).added.push(entry);
  }
  for (const entry of comparison.removed) {
    groupFor(addedOrRemovedAssetType(entry.item)).removed.push(entry);
  }
  for (const entry of comparison.kept) {
    groupFor(keptAssetType(entry)).kept.push(entry);
  }

  const groups = [...byAssetType.values()]
    .sort((a, b) => compareAssetTypeForSort(a.assetType, b.assetType))
    .map((group, index) => buildGroup(group, index));

  return {
    groups,
    totals: comparison.totals,
    counts: { ...comparison.counts, groups: groups.length },
  };
}
