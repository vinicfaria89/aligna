import { describe, expect, it } from "vitest";

import { groupPortfolioSnapshotComparisonByAssetType } from "./portfolio-snapshot-comparison-by-asset-type";
import { comparePortfolioSnapshots, type PortfolioSnapshotComparison } from "./portfolio-snapshot-comparison";
import type { SnapshotItem } from "./portfolio-snapshot-mapping";

/**
 * TASK-056A: pure grouping of an already-computed `PortfolioSnapshotComparison`
 * by asset type. Each test builds the comparison via `comparePortfolioSnapshots`
 * (real, unmocked -- the task explicitly allows this "if it simplifies in a
 * controlled way") from minimal `SnapshotItem` fixtures, so every fixture is a
 * genuine, coherent comparison rather than a hand-assembled fake shape.
 */

function item(overrides: Partial<SnapshotItem> = {}): SnapshotItem {
  return {
    lineNumber: 1,
    rawName: "PETR4",
    status: "verified",
    pendingFields: [],
    sources: [],
    ...overrides,
  };
}

function groupFor(comparison: PortfolioSnapshotComparison, assetType: string) {
  return groupPortfolioSnapshotComparisonByAssetType(comparison).groups.find((g) => g.assetType === assetType);
}

describe("groupPortfolioSnapshotComparisonByAssetType", () => {
  it("1. an empty comparison produces groups: [], preserved totals, zeroed counts", () => {
    const comparison = comparePortfolioSnapshots([], []);
    const result = groupPortfolioSnapshotComparisonByAssetType(comparison);

    expect(result.groups).toEqual([]);
    expect(result.totals).toEqual(comparison.totals);
    expect(result.counts).toEqual({ ...comparison.counts, groups: 0 });
  });

  it("2. groups added items by assetType", () => {
    const target = [
      item({ ticker: "HGLG11", assetType: "fii", amount: 3000 }),
      item({ ticker: "PETR4", assetType: "stock", amount: 1000 }),
    ];
    const comparison = comparePortfolioSnapshots([], target);
    const result = groupPortfolioSnapshotComparisonByAssetType(comparison);

    expect(groupFor(comparison, "fii")?.added).toHaveLength(1);
    expect(groupFor(comparison, "stock")?.added).toHaveLength(1);
    expect(result.groups.every((g) => g.removed.length === 0 && g.kept.length === 0)).toBe(true);
  });

  it("3. groups removed items by assetType", () => {
    const base = [
      item({ ticker: "HGLG11", assetType: "fii", amount: 3000 }),
      item({ ticker: "PETR4", assetType: "stock", amount: 1000 }),
    ];
    const comparison = comparePortfolioSnapshots(base, []);

    expect(groupFor(comparison, "fii")?.removed).toHaveLength(1);
    expect(groupFor(comparison, "stock")?.removed).toHaveLength(1);
  });

  it("4. groups kept items by assetType", () => {
    const base = [item({ ticker: "PETR4", assetType: "stock", amount: 1000 })];
    const target = [item({ ticker: "PETR4", assetType: "stock", amount: 1500 })];
    const comparison = comparePortfolioSnapshots(base, target);

    expect(groupFor(comparison, "stock")?.kept).toHaveLength(1);
  });

  it("5. a kept item prefers target.assetType over base.assetType", () => {
    const base = [item({ ticker: "PETR4", assetType: "unknown-legacy", amount: 1000 })];
    const target = [item({ ticker: "PETR4", assetType: "stock", amount: 1500 })];
    const comparison = comparePortfolioSnapshots(base, target);

    expect(groupFor(comparison, "stock")?.kept).toHaveLength(1);
    expect(groupFor(comparison, "unknown-legacy")).toBeUndefined();
  });

  it("6. a kept item falls back to base.assetType when target.assetType is absent", () => {
    const base = [item({ ticker: "PETR4", assetType: "stock", amount: 1000 })];
    const target = [item({ ticker: "PETR4", amount: 1500 })]; // no assetType, no verifiedAsset
    const comparison = comparePortfolioSnapshots(base, target);

    expect(groupFor(comparison, "stock")?.kept).toHaveLength(1);
  });

  it("7. uses verifiedAsset.type as a fallback when item.assetType is absent", () => {
    const target = [
      item({
        ticker: "HGLG11",
        amount: 3000,
        verifiedAsset: { code: "b3:HGLG11", type: "fii", currency: "BRL" },
      }),
    ];
    const comparison = comparePortfolioSnapshots([], target);

    expect(groupFor(comparison, "fii")?.added).toHaveLength(1);
  });

  it("8. a missing/null/whitespace-only assetType becomes unknown", () => {
    const target = [
      item({ ticker: "AAA1", amount: 100 }), // no assetType at all
      item({ ticker: "BBB1", assetType: "   ", amount: 200 }),
    ];
    const comparison = comparePortfolioSnapshots([], target);
    const unknown = groupFor(comparison, "unknown");

    expect(unknown?.added).toHaveLength(2);
  });

  it("9. assetType is normalized with trim + lowercase", () => {
    const target = [item({ ticker: "PETR4", assetType: "  Stock  ", amount: 1000 })];
    const comparison = comparePortfolioSnapshots([], target);

    expect(groupFor(comparison, "stock")?.added).toHaveLength(1);
    expect(groupFor(comparison, "  Stock  ")).toBeUndefined();
  });

  it("10. known asset types get their curated labels", () => {
    const target = [
      item({ ticker: "PETR4", assetType: "stock", amount: 1 }),
      item({ ticker: "HGLG11", assetType: "fii", amount: 1 }),
      item({ ticker: "BOVA11", assetType: "etf", amount: 1 }),
      item({ ticker: "AAPL34", assetType: "international", amount: 1 }),
    ];
    const comparison = comparePortfolioSnapshots([], target);
    const result = groupPortfolioSnapshotComparisonByAssetType(comparison);

    const label = (assetType: string) => result.groups.find((g) => g.assetType === assetType)?.label;
    expect(label("stock")).toBe("Ações");
    expect(label("fii")).toBe("FIIs");
    expect(label("etf")).toBe("ETFs");
    expect(label("international")).toBe("BDRs e internacionais");
  });

  it("11. an unknown-to-the-map type is not discarded and gets a humanized label", () => {
    const target = [item({ ticker: "XXX1", assetType: "real-estate", amount: 100 })];
    const comparison = comparePortfolioSnapshots([], target);
    const result = groupPortfolioSnapshotComparisonByAssetType(comparison);
    const group = result.groups.find((g) => g.assetType === "real-estate");

    expect(group).toBeDefined();
    expect(group?.label).toBe("Real Estate");
  });

  it("12. known asset types follow the fixed curated order", () => {
    const target = [
      item({ ticker: "A", assetType: "etf", amount: 1 }),
      item({ ticker: "B", assetType: "stock", amount: 1 }),
      item({ ticker: "C", assetType: "international", amount: 1 }),
      item({ ticker: "D", assetType: "fii", amount: 1 }),
    ];
    const comparison = comparePortfolioSnapshots([], target);
    const result = groupPortfolioSnapshotComparisonByAssetType(comparison);

    expect(result.groups.map((g) => g.assetType)).toEqual(["stock", "fii", "etf", "international"]);
    expect(result.groups.map((g) => g.order)).toEqual([0, 1, 2, 3]);
  });

  it("13. unknown-to-the-map types come after every curated type, in alphabetical order", () => {
    const target = [
      item({ ticker: "A", assetType: "zzz-type", amount: 1 }),
      item({ ticker: "B", assetType: "stock", amount: 1 }),
      item({ ticker: "C", assetType: "aaa-type", amount: 1 }),
    ];
    const comparison = comparePortfolioSnapshots([], target);
    const result = groupPortfolioSnapshotComparisonByAssetType(comparison);

    expect(result.groups.map((g) => g.assetType)).toEqual(["stock", "aaa-type", "zzz-type"]);
  });

  it("14. per-group totals combine added/removed/kept correctly", () => {
    const base = [
      item({ ticker: "PETR4", assetType: "stock", amount: 1000 }),
      item({ ticker: "VALE3", assetType: "stock", amount: 500 }),
    ];
    const target = [
      item({ ticker: "PETR4", assetType: "stock", amount: 1200 }), // kept, +200
      item({ ticker: "ITUB4", assetType: "stock", amount: 300 }), // added
      // VALE3 removed
    ];
    const comparison = comparePortfolioSnapshots(base, target);
    const group = groupFor(comparison, "stock")!;

    // base: PETR4 1000 (kept) + VALE3 500 (removed) = 1500
    // target: PETR4 1200 (kept) + ITUB4 300 (added) = 1500
    expect(group.totals.baseValue).toBe(1500);
    expect(group.totals.targetValue).toBe(1500);
    expect(group.totals.absoluteChange).toBe(0);
  });

  it("15. percentageChange is null when the group's baseValue is 0", () => {
    const target = [item({ ticker: "PETR4", assetType: "stock", amount: 1000 })];
    const comparison = comparePortfolioSnapshots([], target);
    const group = groupFor(comparison, "stock")!;

    expect(group.totals.baseValue).toBe(0);
    expect(group.totals.percentageChange).toBeNull();
  });

  it("16. per-group counts reflect added/removed/kept/changedValue/changedStatus", () => {
    const base = [
      item({ ticker: "PETR4", assetType: "stock", amount: 1000, status: "needs-more-evidence" }),
      item({ ticker: "VALE3", assetType: "stock", amount: 500 }),
    ];
    const target = [
      item({ ticker: "PETR4", assetType: "stock", amount: 1500, status: "verified" }), // value + status changed
      item({ ticker: "ITUB4", assetType: "stock", amount: 300 }), // added
    ];
    const comparison = comparePortfolioSnapshots(base, target);
    const group = groupFor(comparison, "stock")!;

    expect(group.counts).toEqual({ added: 1, removed: 1, kept: 1, changedValue: 1, changedStatus: 1 });
  });

  it("17. top-level totals equal comparison.totals exactly", () => {
    const base = [item({ ticker: "PETR4", assetType: "stock", amount: 1000 })];
    const target = [item({ ticker: "PETR4", assetType: "stock", amount: 1500 })];
    const comparison = comparePortfolioSnapshots(base, target);
    const result = groupPortfolioSnapshotComparisonByAssetType(comparison);

    expect(result.totals).toEqual(comparison.totals);
  });

  it("18. top-level counts equal comparison.counts (plus groups)", () => {
    const base = [item({ ticker: "PETR4", assetType: "stock", amount: 1000 })];
    const target = [item({ ticker: "HGLG11", assetType: "fii", amount: 500 })];
    const comparison = comparePortfolioSnapshots(base, target);
    const result = groupPortfolioSnapshotComparisonByAssetType(comparison);

    expect(result.counts).toEqual({ ...comparison.counts, groups: result.groups.length });
  });

  it("19. keeps a zero-value item instead of dropping it", () => {
    const target = [item({ ticker: "AAA1", assetType: "stock", amount: 0 })];
    const comparison = comparePortfolioSnapshots([], target);
    const group = groupFor(comparison, "stock")!;

    expect(group.added).toHaveLength(1);
    expect(group.totals.targetValue).toBe(0);
  });

  it("20. never mutates the input comparison, its arrays, or its items", () => {
    const base = [item({ ticker: "PETR4", assetType: "stock", amount: 1000 })];
    const target = [item({ ticker: "PETR4", assetType: "stock", amount: 1500 })];
    const comparison = comparePortfolioSnapshots(base, target);
    const snapshot = JSON.parse(JSON.stringify(comparison));

    groupPortfolioSnapshotComparisonByAssetType(comparison);

    expect(comparison).toEqual(snapshot);
  });

  it("21. preserves the comparison's own item order within each group's added/removed/kept", () => {
    const target = [
      item({ ticker: "ZZZ1", assetType: "stock", amount: 1 }),
      item({ ticker: "AAA1", assetType: "stock", amount: 1 }),
      item({ ticker: "MMM1", assetType: "stock", amount: 1 }),
    ];
    const comparison = comparePortfolioSnapshots([], target);
    const group = groupFor(comparison, "stock")!;

    // comparePortfolioSnapshots sorts `added` by key ascending -- the group
    // must preserve that exact order, not the fixture's insertion order.
    expect(group.added.map((entry) => entry.key)).toEqual(comparison.added.map((entry) => entry.key));
  });

  it("22. a mix of stocks/FIIs/ETFs/BDRs produces the expected groups", () => {
    const target = [
      item({ ticker: "PETR4", assetType: "stock", amount: 1000 }),
      item({ ticker: "HGLG11", assetType: "fii", amount: 2000 }),
      item({ ticker: "BOVA11", assetType: "etf", amount: 3000 }),
      item({ ticker: "AAPL34", assetType: "international", amount: 4000 }),
    ];
    const comparison = comparePortfolioSnapshots([], target);
    const result = groupPortfolioSnapshotComparisonByAssetType(comparison);

    expect(result.groups).toHaveLength(4);
    expect(result.groups.map((g) => g.assetType)).toEqual(["stock", "fii", "etf", "international"]);
  });

  it("23. a status-only change (no value change) shows up in changedStatus, not changedValue", () => {
    const base = [item({ ticker: "PETR4", assetType: "stock", amount: 1000, status: "needs-more-evidence" })];
    const target = [item({ ticker: "PETR4", assetType: "stock", amount: 1000, status: "verified" })];
    const comparison = comparePortfolioSnapshots(base, target);
    const group = groupFor(comparison, "stock")!;

    expect(group.counts.changedStatus).toBe(1);
    expect(group.counts.changedValue).toBe(0);
  });

  it("24. a value-only change (no status change) shows up in changedValue, not changedStatus", () => {
    const base = [item({ ticker: "PETR4", assetType: "stock", amount: 1000, status: "verified" })];
    const target = [item({ ticker: "PETR4", assetType: "stock", amount: 1500, status: "verified" })];
    const comparison = comparePortfolioSnapshots(base, target);
    const group = groupFor(comparison, "stock")!;

    expect(group.counts.changedValue).toBe(1);
    expect(group.counts.changedStatus).toBe(0);
  });

  it("25. a group with no items at all never appears", () => {
    const target = [item({ ticker: "PETR4", assetType: "stock", amount: 1000 })];
    const comparison = comparePortfolioSnapshots([], target);
    const result = groupPortfolioSnapshotComparisonByAssetType(comparison);

    expect(result.groups.find((g) => g.assetType === "fii")).toBeUndefined();
    expect(result.groups.find((g) => g.assetType === "etf")).toBeUndefined();
  });

  it("26. works with minimal, coherent fixtures independent of any UI", () => {
    const result = groupPortfolioSnapshotComparisonByAssetType(comparePortfolioSnapshots([], []));

    expect(() => result).not.toThrow();
    expect(result.groups).toEqual([]);
  });
});
