import { describe, expect, it } from "vitest";

import { comparePortfolioSnapshots } from "./portfolio-snapshot-comparison";
import type { SnapshotItem, SnapshotStatus } from "./portfolio-snapshot-mapping";

/**
 * TASK-053A: comparePortfolioSnapshots is pure -- no UI, no network, no
 * storage, no current date. These tests exercise the function in
 * isolation, exactly as TASK-053B's UI will call it.
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

describe("comparePortfolioSnapshots", () => {
  it("1. empty vs empty: nothing added/removed/kept, totals and percentageChange are 0/null", () => {
    const result = comparePortfolioSnapshots([], []);

    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.kept).toEqual([]);
    expect(result.totals).toEqual({
      baseValue: 0,
      targetValue: 0,
      absoluteChange: 0,
      percentageChange: null,
    });
    expect(result.counts).toEqual({
      baseItems: 0,
      targetItems: 0,
      added: 0,
      removed: 0,
      kept: 0,
      changedValue: 0,
      changedStatus: 0,
    });
  });

  it("2. empty base, target with items: everything is added; base total 0; totals.percentageChange is null", () => {
    const target = [item({ ticker: "PETR4", amount: 1000 }), item({ ticker: "VALE3", amount: 500 })];

    const result = comparePortfolioSnapshots([], target);

    expect(result.added).toHaveLength(2);
    expect(result.removed).toEqual([]);
    expect(result.kept).toEqual([]);
    expect(result.totals.baseValue).toBe(0);
    expect(result.totals.targetValue).toBe(1500);
    expect(result.totals.percentageChange).toBeNull();
  });

  it("3. base with items, empty target: everything is removed", () => {
    const base = [item({ ticker: "PETR4", amount: 1000 })];

    const result = comparePortfolioSnapshots(base, []);

    expect(result.removed).toHaveLength(1);
    expect(result.added).toEqual([]);
    expect(result.kept).toEqual([]);
    expect(result.totals.targetValue).toBe(0);
    expect(result.totals.percentageChange).toBe(-100);
  });

  it("4. same asset in both, unchanged: appears in kept, valueChanged=false, statusChanged=false", () => {
    const base = [item({ ticker: "PETR4", amount: 1000, status: "verified" })];
    const target = [item({ ticker: "PETR4", amount: 1000, status: "verified" })];

    const result = comparePortfolioSnapshots(base, target);

    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].valueChanged).toBe(false);
    expect(result.kept[0].statusChanged).toBe(false);
    expect(result.kept[0].absoluteChange).toBe(0);
    expect(result.kept[0].percentageChange).toBe(0);
  });

  it("5. same asset, value changed: absoluteChange and percentageChange are correct", () => {
    const base = [item({ ticker: "PETR4", amount: 1000 })];
    const target = [item({ ticker: "PETR4", amount: 1200 })];

    const result = comparePortfolioSnapshots(base, target);

    expect(result.kept[0].absoluteChange).toBe(200);
    expect(result.kept[0].percentageChange).toBe(20);
    expect(result.kept[0].valueChanged).toBe(true);
  });

  it("6. same asset, status changed: statusChanged=true", () => {
    const base = [item({ ticker: "PETR4", amount: 1000, status: "needs-more-evidence" })];
    const target = [item({ ticker: "PETR4", amount: 1000, status: "verified" })];

    const result = comparePortfolioSnapshots(base, target);

    expect(result.kept[0].statusChanged).toBe(true);
    expect(result.kept[0].base.status).toBe("needs-more-evidence");
    expect(result.kept[0].target.status).toBe("verified");
  });

  it("7. one asset added and one removed in the same comparison", () => {
    const base = [item({ ticker: "PETR4", amount: 1000 })];
    const target = [item({ ticker: "VALE3", amount: 500 })];

    const result = comparePortfolioSnapshots(base, target);

    expect(result.removed).toHaveLength(1);
    expect(result.removed[0].key).toBe("ticker:PETR4");
    expect(result.added).toHaveLength(1);
    expect(result.added[0].key).toBe("ticker:VALE3");
    expect(result.kept).toEqual([]);
  });

  it("8. duplicates in the same snapshot: values aggregated, comparison stays stable", () => {
    const base = [
      item({ ticker: "PETR4", amount: 100, status: "verified" }),
      item({ ticker: "PETR4", amount: 50, status: "needs-more-evidence" }),
    ];
    const target = [item({ ticker: "PETR4", amount: 300, status: "verified" })];

    const result = comparePortfolioSnapshots(base, target);

    expect(result.kept).toHaveLength(1);
    // Aggregated base value: 100 + 50 = 150.
    expect(result.kept[0].baseValue).toBe(150);
    // `base` is the group's FIRST occurrence, kept as-is (never mutated) --
    // the aggregated worst status ("needs-more-evidence") only affects
    // `statusChanged`, not this representative item's own `.status`.
    expect(result.kept[0].base.status).toBe("verified");
    expect(result.kept[0].targetValue).toBe(300);
    // Aggregated base status is "needs-more-evidence" (worst of verified +
    // needs-more-evidence), which differs from target's aggregated "verified".
    expect(result.kept[0].baseStatus).toBe("needs-more-evidence");
    expect(result.kept[0].targetStatus).toBe("verified");
    expect(result.kept[0].statusChanged).toBe(true);
  });

  it("9. base value 0 (kept item and totals): percentageChange is null, not Infinity", () => {
    const base = [item({ ticker: "PETR4", amount: 0 })];
    const target = [item({ ticker: "PETR4", amount: 500 })];

    const result = comparePortfolioSnapshots(base, target);

    expect(result.kept[0].percentageChange).toBeNull();
    expect(result.kept[0].absoluteChange).toBe(500);
    expect(result.totals.percentageChange).toBeNull();
  });

  it("10. missing/invalid amount treated as 0", () => {
    const base = [
      item({ ticker: "PETR4", amount: undefined }),
      item({ ticker: "VALE3", amount: Number.NaN }),
      item({ ticker: "ITUB4", amount: Number.POSITIVE_INFINITY }),
    ];

    const result = comparePortfolioSnapshots(base, []);

    expect(result.totals.baseValue).toBe(0);
    for (const entry of result.removed) {
      expect(entry.value).toBe(0);
    }
  });

  it("11. ticker case-insensitive: 'petr4' and 'PETR4' are the same asset", () => {
    const base = [item({ ticker: "petr4", amount: 100 })];
    const target = [item({ ticker: "PETR4", amount: 150 })];

    const result = comparePortfolioSnapshots(base, target);

    expect(result.kept).toHaveLength(1);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  it("12. surrounding whitespace ignored: ' PETR4 ' and 'PETR4' are the same asset", () => {
    const base = [item({ ticker: " PETR4 ", amount: 100 })];
    const target = [item({ ticker: "PETR4", amount: 150 })];

    const result = comparePortfolioSnapshots(base, target);

    expect(result.kept).toHaveLength(1);
  });

  it("13. items without ticker/code fall back to normalized rawName", () => {
    const base = [item({ rawName: "Fundo Imobiliário Shopping", ticker: undefined, amount: 100 })];
    const target = [item({ rawName: "fundo imobiliário shopping", ticker: undefined, amount: 120 })];

    const result = comparePortfolioSnapshots(base, target);

    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].key).toBe(`name:${"Fundo Imobiliário Shopping".toUpperCase()}`);
  });

  it("14. same name but different codes must NOT collide", () => {
    const base = [item({ rawName: "Fundo XYZ", ticker: "AAAA11", amount: 100 })];
    const target = [item({ rawName: "Fundo XYZ", ticker: "BBBB11", amount: 100 })];

    const result = comparePortfolioSnapshots(base, target);

    expect(result.kept).toEqual([]);
    expect(result.removed).toHaveLength(1);
    expect(result.added).toHaveLength(1);
  });

  it("15. different currencies: no conversion, still produces a numeric (documented limitation), never throws", () => {
    const base = [item({ ticker: "PETR4", amount: 100, currency: "BRL" })];
    const target = [item({ ticker: "PETR4", amount: 100, currency: "USD" })];

    const result = comparePortfolioSnapshots(base, target);

    expect(() => comparePortfolioSnapshots(base, target)).not.toThrow();
    expect(result.kept[0].absoluteChange).toBe(0);
    expect(result.kept[0].base.currency).toBe("BRL");
    expect(result.kept[0].target.currency).toBe("USD");
  });

  it("16. deterministic ordering: added/removed/kept are sorted by key ascending regardless of input order", () => {
    const target = [
      item({ ticker: "ZZZZ99", amount: 1 }),
      item({ ticker: "AAAA11", amount: 1 }),
      item({ ticker: "MMMM11", amount: 1 }),
    ];

    const result1 = comparePortfolioSnapshots([], target);
    const result2 = comparePortfolioSnapshots([], [...target].reverse());

    const keys1 = result1.added.map((entry) => entry.key);
    const keys2 = result2.added.map((entry) => entry.key);

    expect(keys1).toEqual(["ticker:AAAA11", "ticker:MMMM11", "ticker:ZZZZ99"]);
    expect(keys2).toEqual(keys1);
  });

  it("17. extra/unknown fields on SnapshotItem-like objects do not affect comparison", () => {
    const base = [{ ...item({ ticker: "PETR4", amount: 100 }), extra: "ignored" } as SnapshotItem];
    const target = [item({ ticker: "PETR4", amount: 100 })];

    const result = comparePortfolioSnapshots(base, target);

    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].valueChanged).toBe(false);
  });

  it("18. never mutates the input arrays or items", () => {
    const base = [item({ ticker: "PETR4", amount: 100 })];
    const target = [item({ ticker: "VALE3", amount: 200 })];

    const baseSnapshot = JSON.parse(JSON.stringify(base));
    const targetSnapshot = JSON.parse(JSON.stringify(target));

    comparePortfolioSnapshots(base, target);

    expect(base).toEqual(baseSnapshot);
    expect(target).toEqual(targetSnapshot);
  });

  it("identity priority: ticker wins over code, which wins over verifiedAsset.code, which wins over rawName", () => {
    const withTicker = item({
      rawName: "Ação X",
      ticker: "XYZW3",
      code: "OLDCODE",
      verifiedAsset: { code: "b3:XYZW3", type: "stock", currency: "BRL" },
    });

    const sameTickerDifferentEverythingElse = item({
      rawName: "Nome diferente",
      ticker: "XYZW3",
      code: "SOMETHING-ELSE",
    });

    const result = comparePortfolioSnapshots([withTicker], [sameTickerDifferentEverythingElse]);

    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].key).toBe("ticker:XYZW3");
  });

  it("without a ticker, code (raw instrument code) wins over verifiedAsset.code", () => {
    const withCode = item({ ticker: undefined, code: "ABCD11", verifiedAsset: undefined });
    const sameCode = item({
      ticker: undefined,
      code: "ABCD11",
      verifiedAsset: { code: "anbima:ABCD11", type: "debenture", currency: "BRL" },
    });

    const result = comparePortfolioSnapshots([withCode], [sameCode]);

    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].key).toBe("code-raw:ABCD11");
  });

  it("without a ticker or a raw code, falls back to verifiedAsset.code", () => {
    const withVerifiedCodeOnly = item({
      ticker: undefined,
      code: undefined,
      verifiedAsset: { code: "b3:XYZW3", type: "stock", currency: "BRL" },
    });
    const sameVerifiedCodeOnly = item({
      ticker: undefined,
      code: undefined,
      rawName: "Nome completamente diferente",
      verifiedAsset: { code: "b3:XYZW3", type: "stock", currency: "BRL" },
    });

    const result = comparePortfolioSnapshots([withVerifiedCodeOnly], [sameVerifiedCodeOnly]);

    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].key).toBe("code:B3:XYZW3");
  });

  it("BUG FIX (found while building TASK-053B): an item keeps the same identity when it gains a verifiedAsset between snapshots (needs-more-evidence -> verified) -- the flagship statusChanged case", () => {
    const beforeVerification = item({
      ticker: "PETR4",
      amount: 1000,
      status: "needs-more-evidence",
      verifiedAsset: undefined,
    });
    const afterVerification = item({
      ticker: "PETR4",
      amount: 1000,
      status: "verified",
      verifiedAsset: { code: "b3:PETR4", type: "stock", currency: "BRL" },
    });

    const result = comparePortfolioSnapshots([beforeVerification], [afterVerification]);

    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].statusChanged).toBe(true);
    expect(result.kept[0].baseStatus).toBe("needs-more-evidence");
    expect(result.kept[0].targetStatus).toBe("verified");
  });

  it("does not collide a ticker-derived key with a rawName-derived key sharing the same text", () => {
    const withTicker = item({ ticker: "SHOP11", rawName: "Nome A" });
    const withNameOnly = item({ rawName: "SHOP11", ticker: undefined });

    const result = comparePortfolioSnapshots([withTicker], [withNameOnly]);

    // "ticker:SHOP11" != "name:SHOP11": treated as different assets, on purpose.
    expect(result.kept).toEqual([]);
    expect(result.removed).toHaveLength(1);
    expect(result.added).toHaveLength(1);
  });

  it.each<SnapshotStatus>([
    "verified",
    "needs-more-evidence",
    "needs-user",
    "conflict",
    "blocked",
    "item-error",
  ])("duplicate merge keeps the worse of two equal statuses stable (%s)", (status) => {
    const base = [
      item({ ticker: "DUP11", amount: 10, status }),
      item({ ticker: "DUP11", amount: 10, status }),
    ];

    const result = comparePortfolioSnapshots(base, []);

    expect(result.removed[0].status).toBe(status);
    expect(result.removed[0].value).toBe(20);
  });
});
