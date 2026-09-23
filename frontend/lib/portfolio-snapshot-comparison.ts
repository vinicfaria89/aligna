import type { SnapshotItem, SnapshotStatus } from "./portfolio-snapshot-mapping";

/**
 * TASK-053A: pure comparison between two portfolio snapshots' items
 * (`SnapshotItem[]`, lib/portfolio-snapshot-mapping.ts). No UI, no
 * component, no network, no storage, no current date -- just data in, data
 * out. Meant to be the one place TASK-053B's UI (and TASK-053C's CSV
 * export) both build on, so the "what changed between two snapshots" rule
 * lives in exactly one, well-tested spot.
 *
 * `base` is the older/reference snapshot, `target` the newer/final one --
 * "what changed from base to target".
 *
 * --- Identity: what counts as "the same asset" -------------------------------------------
 *
 * Each item gets a single stable key, taken from the first field that is
 * present (trimmed to non-empty), in this priority order:
 *
 *   1. `verifiedAsset.code`  -- the canonical code from a real verification
 *      (e.g. the B3ListedAssetProvider's `canonicalAssetId`, TASK-051B).
 *   2. `ticker`               -- the raw ticker the user's CSV carried.
 *   3. `code`                 -- the raw instrument code (e.g. ANBIMA's).
 *   4. `rawName`              -- last resort: the free-text name.
 *
 * Every tier is normalized the same way (trim + uppercase), so `petr4`,
 * `PETR4` and `  PETR4  ` are the same asset. The key is PREFIXED by which
 * tier produced it (`code:`, `ticker:`, `code-raw:`, `name:`) so a ticker
 * "ABC" can never accidentally collide with a differently-sourced rawName
 * "ABC" for an unrelated item -- a deliberately conservative choice: this
 * function never merges two items on a guess, only within a single field.
 * An item's own amount/value is never part of its identity.
 *
 * --- Duplicates within one snapshot ------------------------------------------------------
 *
 * Two items in the SAME snapshot that produce the same key are grouped
 * (never left to collide unpredictably against the other snapshot):
 *   - their `amount` (missing/invalid treated as 0, see below) is SUMMED;
 *   - their status is merged to the single WORST one, by this fixed order
 *     (worst first): `item-error`, `blocked`, `conflict`, `needs-user`,
 *     `needs-more-evidence`, `verified` -- so a duplicate that regressed
 *     to "needs-more-evidence" is never hidden behind a "verified" sibling;
 *   - the FIRST occurrence (input order) is kept as the group's
 *     `representative` item for display (`ComparedSnapshotItem.item` /
 *     `ComparedSnapshotItemChange.base`/`target`) -- itself untouched, never
 *     mutated, never a synthetic merged object.
 *
 * --- Values --------------------------------------------------------------------------------
 *
 * Only `item.amount` is used. Missing, `null`/`undefined`, `NaN` or any
 * non-finite number counts as 0 -- never thrown, never `Infinity`. Values
 * are never rounded here (the raw floating-point difference/ratio is
 * returned; rounding for display belongs to the UI layer, TASK-053B).
 * `percentageChange` is a PERCENTAGE (e.g. `12.5` means +12.5%), and is
 * `null` -- never `Infinity`/`NaN` -- whenever the base value is 0.
 *
 * LIMITATION (deliberately out of scope for this task): `currency` is
 * preserved on each item but never inspected or converted. Totals and
 * per-item value changes are a naive sum/diff of `amount` regardless of
 * `currency` -- comparing a BRL snapshot against a mixed-currency one will
 * not convert anything. A future task can address multi-currency totals;
 * this one never throws or produces nonsense on it, it just doesn't try.
 *
 * --- Ordering --------------------------------------------------------------------------------
 *
 * `added`, `removed` and `kept` are each sorted by the item's key, ascending
 * (plain string comparison) -- deterministic and independent of input
 * order, so tests (and any future UI list) don't depend on incidental
 * array order.
 *
 * Never mutates `base`, `target`, or any item inside them.
 */

export interface ComparedSnapshotItem {
  key: string;
  item: SnapshotItem;
  value: number;
  status: SnapshotStatus;
}

export interface ComparedSnapshotItemChange {
  key: string;
  base: SnapshotItem;
  target: SnapshotItem;
  baseValue: number;
  targetValue: number;
  /**
   * The AGGREGATED status behind `baseValue`/`targetValue` (see the module
   * docstring on duplicates): the worst status among same-key items in that
   * snapshot. Only equal to `base.status`/`target.status` when there was no
   * duplicate to merge -- read this field, not `base.status`, whenever
   * duplicates are a possibility.
   */
  baseStatus: SnapshotStatus;
  targetStatus: SnapshotStatus;
  absoluteChange: number;
  percentageChange: number | null;
  valueChanged: boolean;
  statusChanged: boolean;
}

export interface PortfolioSnapshotComparisonTotals {
  baseValue: number;
  targetValue: number;
  absoluteChange: number;
  percentageChange: number | null;
}

export interface PortfolioSnapshotComparisonCounts {
  baseItems: number;
  targetItems: number;
  added: number;
  removed: number;
  kept: number;
  changedValue: number;
  changedStatus: number;
}

export interface PortfolioSnapshotComparison {
  added: ComparedSnapshotItem[];
  removed: ComparedSnapshotItem[];
  kept: ComparedSnapshotItemChange[];
  totals: PortfolioSnapshotComparisonTotals;
  counts: PortfolioSnapshotComparisonCounts;
}

// Worst-first: a duplicate group's merged status is whichever of these
// comes first for the items it contains.
const STATUS_MERGE_PRIORITY: readonly SnapshotStatus[] = [
  "item-error",
  "blocked",
  "conflict",
  "needs-user",
  "needs-more-evidence",
  "verified",
];

function worseStatus(a: SnapshotStatus, b: SnapshotStatus): SnapshotStatus {
  const rankA = STATUS_MERGE_PRIORITY.indexOf(a);
  const rankB = STATUS_MERGE_PRIORITY.indexOf(b);
  return rankA <= rankB ? a : b;
}

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalize(value: string): string {
  return value.trim().toUpperCase();
}

/** The stable identity key for one item -- see the module docstring. */
function itemKey(item: SnapshotItem): string {
  const verifiedCode = nonEmpty(item.verifiedAsset?.code);
  if (verifiedCode !== undefined) {
    return `code:${normalize(verifiedCode)}`;
  }

  const ticker = nonEmpty(item.ticker);
  if (ticker !== undefined) {
    return `ticker:${normalize(ticker)}`;
  }

  const code = nonEmpty(item.code);
  if (code !== undefined) {
    return `code-raw:${normalize(code)}`;
  }

  return `name:${normalize(item.rawName)}`;
}

/** Missing/invalid/non-finite counts as 0 -- never thrown, never Infinity/NaN. */
function safeValue(item: SnapshotItem): number {
  return typeof item.amount === "number" && Number.isFinite(item.amount) ? item.amount : 0;
}

interface AggregatedItem {
  key: string;
  representative: SnapshotItem;
  value: number;
  status: SnapshotStatus;
}

/** Groups same-key items within one snapshot (see module docstring on duplicates). */
function aggregate(items: readonly SnapshotItem[]): Map<string, AggregatedItem> {
  const byKey = new Map<string, AggregatedItem>();

  for (const item of items) {
    const key = itemKey(item);
    const value = safeValue(item);
    const existing = byKey.get(key);

    if (existing === undefined) {
      byKey.set(key, { key, representative: item, value, status: item.status });
    } else {
      existing.value += value;
      existing.status = worseStatus(existing.status, item.status);
    }
  }

  return byKey;
}

function sum(items: readonly SnapshotItem[]): number {
  return items.reduce((total, item) => total + safeValue(item), 0);
}

function percentageChange(baseValue: number, targetValue: number): number | null {
  if (baseValue === 0) {
    return null;
  }
  return ((targetValue - baseValue) / baseValue) * 100;
}

function byKeyAscending<T extends { key: string }>(a: T, b: T): number {
  if (a.key < b.key) return -1;
  if (a.key > b.key) return 1;
  return 0;
}

export function comparePortfolioSnapshots(
  base: readonly SnapshotItem[],
  target: readonly SnapshotItem[],
): PortfolioSnapshotComparison {
  const baseByKey = aggregate(base);
  const targetByKey = aggregate(target);

  const allKeys = new Set<string>([...baseByKey.keys(), ...targetByKey.keys()]);

  const added: ComparedSnapshotItem[] = [];
  const removed: ComparedSnapshotItem[] = [];
  const kept: ComparedSnapshotItemChange[] = [];

  for (const key of allKeys) {
    const baseGroup = baseByKey.get(key);
    const targetGroup = targetByKey.get(key);

    if (baseGroup !== undefined && targetGroup === undefined) {
      removed.push({
        key,
        item: baseGroup.representative,
        value: baseGroup.value,
        status: baseGroup.status,
      });
      continue;
    }

    if (baseGroup === undefined && targetGroup !== undefined) {
      added.push({
        key,
        item: targetGroup.representative,
        value: targetGroup.value,
        status: targetGroup.status,
      });
      continue;
    }

    if (baseGroup !== undefined && targetGroup !== undefined) {
      const absoluteChange = targetGroup.value - baseGroup.value;

      kept.push({
        key,
        base: baseGroup.representative,
        target: targetGroup.representative,
        baseValue: baseGroup.value,
        targetValue: targetGroup.value,
        baseStatus: baseGroup.status,
        targetStatus: targetGroup.status,
        absoluteChange,
        percentageChange: percentageChange(baseGroup.value, targetGroup.value),
        valueChanged: absoluteChange !== 0,
        statusChanged: baseGroup.status !== targetGroup.status,
      });
    }
  }

  added.sort(byKeyAscending);
  removed.sort(byKeyAscending);
  kept.sort(byKeyAscending);

  const totalBaseValue = sum(base);
  const totalTargetValue = sum(target);

  return {
    added,
    removed,
    kept,
    totals: {
      baseValue: totalBaseValue,
      targetValue: totalTargetValue,
      absoluteChange: totalTargetValue - totalBaseValue,
      percentageChange: percentageChange(totalBaseValue, totalTargetValue),
    },
    counts: {
      baseItems: base.length,
      targetItems: target.length,
      added: added.length,
      removed: removed.length,
      kept: kept.length,
      changedValue: kept.filter((entry) => entry.valueChanged).length,
      changedStatus: kept.filter((entry) => entry.statusChanged).length,
    },
  };
}
