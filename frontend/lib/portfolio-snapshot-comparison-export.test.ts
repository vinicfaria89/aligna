import { describe, expect, it } from "vitest";

import {
  buildPortfolioSnapshotComparisonCsv,
  comparisonExportFileName,
} from "./portfolio-snapshot-comparison-export";
import { comparePortfolioSnapshots } from "./portfolio-snapshot-comparison";
import type { SnapshotItem } from "./portfolio-snapshot-mapping";

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

function rows(csv: string): string[][] {
  return csv
    .split("\r\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split(","));
}

function findRow(csv: string, rowType: string, section: string): string[] | undefined {
  return rows(csv).find((cells) => cells[0] === rowType && cells[1] === section);
}

describe("buildPortfolioSnapshotComparisonCsv", () => {
  it("1. exports the expected header", () => {
    const csv = buildPortfolioSnapshotComparisonCsv(comparePortfolioSnapshots([], []));
    const header = rows(csv)[0];

    expect(header).toEqual([
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
    ]);
  });

  it("2. includes a summary row with the totals", () => {
    const base = [item({ ticker: "PETR4", amount: 1000 })];
    const target = [item({ ticker: "PETR4", amount: 1500 })];
    const csv = buildPortfolioSnapshotComparisonCsv(comparePortfolioSnapshots(base, target));

    const total = findRow(csv, "summary", "total");

    expect(total).toBeDefined();
    expect(total?.[7]).toBe("1000"); // value_before
    expect(total?.[8]).toBe("1500"); // value_after
    expect(total?.[9]).toBe("500"); // absolute_change
    expect(total?.[10]).toBe("50"); // percentage_change
  });

  it("3. includes count summaries", () => {
    const base = [item({ ticker: "PETR4", amount: 1000 })];
    const target = [item({ ticker: "VALE3", amount: 500 })];
    const csv = buildPortfolioSnapshotComparisonCsv(comparePortfolioSnapshots(base, target));

    expect(findRow(csv, "summary", "counts_added")?.[8]).toBe("1");
    expect(findRow(csv, "summary", "counts_removed")?.[8]).toBe("1");
    expect(findRow(csv, "summary", "counts_kept")?.[8]).toBe("0");
    expect(findRow(csv, "summary", "counts_changed_value")?.[8]).toBe("0");
    expect(findRow(csv, "summary", "counts_changed_status")?.[8]).toBe("0");
  });

  it("4. exports an added item", () => {
    const target = [item({ ticker: "HGLG11", rawName: "HGLG11", amount: 3000, status: "verified" })];
    const csv = buildPortfolioSnapshotComparisonCsv(comparePortfolioSnapshots([], target));

    const row = findRow(csv, "item", "added");

    expect(row).toBeDefined();
    expect(row?.[3]).toBe("HGLG11"); // name
    expect(row?.[4]).toBe("HGLG11"); // code (ticker)
    expect(row?.[6]).toBe("verified"); // status_after
    expect(row?.[7]).toBe("0"); // value_before
    expect(row?.[8]).toBe("3000"); // value_after
  });

  it("5. exports a removed item", () => {
    const base = [item({ ticker: "BOVA11", rawName: "BOVA11", amount: 2000, status: "verified" })];
    const csv = buildPortfolioSnapshotComparisonCsv(comparePortfolioSnapshots(base, []));

    const row = findRow(csv, "item", "removed");

    expect(row).toBeDefined();
    expect(row?.[5]).toBe("verified"); // status_before
    expect(row?.[7]).toBe("2000"); // value_before
    expect(row?.[8]).toBe("0"); // value_after
  });

  it("6. exports a kept item without change", () => {
    const base = [item({ ticker: "PETR4", amount: 1000, status: "verified" })];
    const target = [item({ ticker: "PETR4", amount: 1000, status: "verified" })];
    const csv = buildPortfolioSnapshotComparisonCsv(comparePortfolioSnapshots(base, target));

    const row = findRow(csv, "item", "kept");

    expect(row).toBeDefined();
    expect(row?.[11]).toBe("false"); // value_changed
    expect(row?.[12]).toBe("false"); // status_changed
  });

  it("7. exports a kept item with value changed", () => {
    const base = [item({ ticker: "PETR4", amount: 1000 })];
    const target = [item({ ticker: "PETR4", amount: 1500 })];
    const csv = buildPortfolioSnapshotComparisonCsv(comparePortfolioSnapshots(base, target));

    const row = findRow(csv, "item", "kept");

    expect(row?.[7]).toBe("1000"); // value_before
    expect(row?.[8]).toBe("1500"); // value_after
    expect(row?.[9]).toBe("500"); // absolute_change
    expect(row?.[11]).toBe("true"); // value_changed
  });

  it("8. exports a kept item with status changed", () => {
    const base = [item({ ticker: "PETR4", amount: 1000, status: "needs-more-evidence" })];
    const target = [item({ ticker: "PETR4", amount: 1000, status: "verified" })];
    const csv = buildPortfolioSnapshotComparisonCsv(comparePortfolioSnapshots(base, target));

    const row = findRow(csv, "item", "kept");

    expect(row?.[5]).toBe("needs-more-evidence"); // status_before
    expect(row?.[6]).toBe("verified"); // status_after
    expect(row?.[12]).toBe("true"); // status_changed
  });

  it("9. percentageChange = null becomes an empty cell", () => {
    const base = [item({ ticker: "PETR4", amount: 0 })];
    const target = [item({ ticker: "PETR4", amount: 500 })];
    const csv = buildPortfolioSnapshotComparisonCsv(comparePortfolioSnapshots(base, target));

    const row = findRow(csv, "item", "kept");

    expect(row?.[10]).toBe(""); // percentage_change
  });

  it("10. numeric values are raw, never currency-formatted", () => {
    const base = [item({ ticker: "PETR4", amount: 1234.5 })];
    const target = [item({ ticker: "PETR4", amount: 2000 })];
    const csv = buildPortfolioSnapshotComparisonCsv(comparePortfolioSnapshots(base, target));

    expect(csv).not.toContain("R$");
    expect(csv).toContain("1234.5");
  });

  it("11. escapes commas in names", () => {
    const target = [item({ ticker: "ABCD11", rawName: "Fundo, Imobiliário" })];
    const csv = buildPortfolioSnapshotComparisonCsv(comparePortfolioSnapshots([], target));

    expect(csv).toContain('"Fundo, Imobiliário"');
  });

  it("12. escapes quotes in names", () => {
    const target = [item({ ticker: "ABCD11", rawName: 'Fundo "Especial"' })];
    const csv = buildPortfolioSnapshotComparisonCsv(comparePortfolioSnapshots([], target));

    expect(csv).toContain('"Fundo ""Especial"""');
  });

  it("13. escapes line breaks in names", () => {
    const target = [item({ ticker: "ABCD11", rawName: "Fundo\nMultiline" })];
    const csv = buildPortfolioSnapshotComparisonCsv(comparePortfolioSnapshots([], target));

    expect(csv).toContain('"Fundo\nMultiline"');
  });

  it("14. never duplicates a kept item across multiple rows", () => {
    const base = [item({ ticker: "PETR4", amount: 1000 })];
    const target = [item({ ticker: "PETR4", amount: 1500 })];
    const csv = buildPortfolioSnapshotComparisonCsv(comparePortfolioSnapshots(base, target));

    const itemRows = rows(csv).filter((cells) => cells[0] === "item" && cells[2] === "ticker:PETR4");

    expect(itemRows).toHaveLength(1);
  });

  it("15. deterministic row order: summary rows first, then added, removed, kept", () => {
    const base = [item({ ticker: "AAAA3", amount: 100 }), item({ ticker: "BBBB3", amount: 200 })];
    const target = [item({ ticker: "CCCC3", amount: 300 }), item({ ticker: "BBBB3", amount: 250 })];
    const csv = buildPortfolioSnapshotComparisonCsv(comparePortfolioSnapshots(base, target));

    const rowTypesAndSections = rows(csv)
      .slice(1)
      .map((cells) => `${cells[0]}:${cells[1]}`);

    expect(rowTypesAndSections).toEqual([
      "summary:total",
      "summary:counts_added",
      "summary:counts_removed",
      "summary:counts_kept",
      "summary:counts_changed_value",
      "summary:counts_changed_status",
      "item:added", // CCCC3
      "item:removed", // AAAA3
      "item:kept", // BBBB3
    ]);
  });

  it("16. an empty/empty comparison still produces a valid CSV (header + summary rows only)", () => {
    const csv = buildPortfolioSnapshotComparisonCsv(comparePortfolioSnapshots([], []));

    expect(() => rows(csv)).not.toThrow();
    expect(rows(csv).length).toBeGreaterThan(0);
    expect(rows(csv).some((cells) => cells[0] === "item")).toBe(false);
  });
});

describe("comparisonExportFileName", () => {
  it("is deterministic and includes short base/target ids", () => {
    const name = comparisonExportFileName(
      "aaaaaaaa-1111-1111-1111-111111111111",
      "bbbbbbbb-2222-2222-2222-222222222222",
      new Date(2026, 8, 23, 14, 35),
    );

    expect(name).toBe("comparacao-carteira-2026-09-23-14-35__base-aaaaaaaa__alvo-bbbbbbbb.csv");
  });
});
