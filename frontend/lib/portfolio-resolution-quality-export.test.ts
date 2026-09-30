import { describe, expect, it } from "vitest";

import {
  buildPortfolioResolutionQualityCsv,
  resolutionQualityExportFileName,
} from "./portfolio-resolution-quality-export";

import type { SnapshotItem } from "./portfolio-snapshot-mapping";

function item(overrides: Partial<SnapshotItem> = {}): SnapshotItem {
  return {
    lineNumber: 2,
    rawName: "Ativo Teste",
    status: "verified",
    pendingFields: [],
    sources: [],
    ...overrides,
  };
}

/** Splits the CSV's records the same way `csvDocument` joins them (CRLF).
 * Good enough for these tests: none of the fixtures below embed a raw CRLF
 * inside a field except the dedicated escaping test, which checks the raw
 * text directly instead of splitting it. */
function lines(csv: string): string[] {
  return csv.split("\r\n");
}

const RICH_ITEMS: SnapshotItem[] = [
  {
    lineNumber: 2,
    rawName: "PETR4",
    ticker: "PETR4",
    assetType: "stock",
    amount: 1000,
    currency: "BRL",
    status: "verified",
    pendingFields: [],
    sources: ["B3"],
    verifiedAsset: { code: "b3:PETR4", type: "stock", currency: "BRL" },
  },
  {
    lineNumber: 3,
    rawName: "Tesouro Selic",
    amount: 200,
    currency: "BRL",
    status: "needs-more-evidence",
    pendingFields: ["identity"],
    sources: [],
  },
  {
    lineNumber: 4,
    rawName: "CDB Banco XP",
    amount: 300,
    currency: "BRL",
    status: "needs-more-evidence",
    pendingFields: ["identity", "issuer"],
    sources: [],
  },
  {
    lineNumber: 5,
    rawName: "Ativo com Erro",
    amount: 400,
    currency: "BRL",
    status: "item-error",
    pendingFields: [],
    sources: [],
  },
];

describe("buildPortfolioResolutionQualityCsv", () => {
  it("1. header row matches the exact specified column order", () => {
    const csv = buildPortfolioResolutionQualityCsv([]);

    expect(lines(csv)[0]).toBe(
      "row_type,section,key,name,status,asset_type,source,explanation_title,suggestion",
    );
  });

  it("2. empty portfolio: totals are all zero and verification_rate is empty", () => {
    const csv = buildPortfolioResolutionQualityCsv([]);

    expect(csv).toContain("summary,totals,items,0,,,,,");
    expect(csv).toContain("summary,totals,verified,0,,,,,");
    expect(csv).toContain("summary,totals,verification_rate,,,,,,");
  });

  it("3. empty portfolio: byStatus still emits all 6 known statuses", () => {
    const csv = buildPortfolioResolutionQualityCsv([]);
    const byStatusLines = lines(csv).filter((l) => l.startsWith("summary,by_status,"));

    expect(byStatusLines).toHaveLength(6);
  });

  it("4. empty portfolio: no improvement rows and no item rows", () => {
    const csv = buildPortfolioResolutionQualityCsv([]);

    expect(lines(csv).some((l) => l.startsWith("improvement,"))).toBe(false);
    expect(lines(csv).some((l) => l.startsWith("item,"))).toBe(false);
  });

  it("5. only verified items: pending total is zero and no improvement rows", () => {
    const items = [
      item({ lineNumber: 2, rawName: "PETR4", assetType: "stock", status: "verified" }),
      item({ lineNumber: 3, rawName: "VALE3", assetType: "stock", status: "verified" }),
    ];
    const csv = buildPortfolioResolutionQualityCsv(items);

    expect(csv).toContain("summary,totals,pending,0,,,,,");
    expect(lines(csv).some((l) => l.startsWith("improvement,"))).toBe(false);
  });

  it("6. only verified items: item rows show status verified", () => {
    const items = [item({ lineNumber: 2, rawName: "PETR4", assetType: "stock", status: "verified" })];
    const csv = buildPortfolioResolutionQualityCsv(items);

    expect(csv).toContain("item,item,2,PETR4,verified,stock,,Ativo verificado,");
  });

  it("7. mixed status: totals reflect the exact counts", () => {
    const csv = buildPortfolioResolutionQualityCsv(RICH_ITEMS);

    expect(csv).toContain("summary,totals,items,4,,,,,");
    expect(csv).toContain("summary,totals,verified,1,,,,,");
    expect(csv).toContain("summary,totals,pending,2,,,,,");
    expect(csv).toContain("summary,totals,errors,1,,,,,");
  });

  it("8. mixed status: one item row per input item, same count", () => {
    const csv = buildPortfolioResolutionQualityCsv(RICH_ITEMS);
    const itemLines = lines(csv).filter((l) => l.startsWith("item,item,"));

    expect(itemLines).toHaveLength(RICH_ITEMS.length);
  });

  it("9. multiple suggestions: more than one improvement row, high priority before medium", () => {
    const items = [
      item({ lineNumber: 2, rawName: "Ativo Sem Tipo", status: "verified" }), // unknown assetType -> high
      item({
        lineNumber: 3,
        rawName: "Ação Pendente",
        assetType: "stock",
        status: "needs-more-evidence",
      }), // high
      item({ lineNumber: 4, rawName: "Ativo Bloqueado", assetType: "stock", status: "blocked" }), // medium
    ];
    const csv = buildPortfolioResolutionQualityCsv(items);
    const improvementLines = lines(csv).filter((l) => l.startsWith("improvement,"));

    expect(improvementLines.length).toBeGreaterThanOrEqual(2);
    const priorities = improvementLines.map((l) => l.split(",")[4]);
    const firstMediumIndex = priorities.indexOf("medium");
    const lastHighIndex = priorities.lastIndexOf("high");
    expect(firstMediumIndex === -1 || lastHighIndex < firstMediumIndex).toBe(true);
  });

  it("10. absence of suggestions: fully verified portfolio has zero improvement rows", () => {
    const items = [item({ assetType: "stock", status: "verified" })];
    const csv = buildPortfolioResolutionQualityCsv(items);

    expect(lines(csv).filter((l) => l.startsWith("improvement,"))).toHaveLength(0);
  });

  it("11. improvement row carries id, priority, title and description in the right columns", () => {
    const items = [item({ rawName: "CDB X", assetType: "stock", status: "blocked" })];
    const csv = buildPortfolioResolutionQualityCsv(items);
    const row = lines(csv).find((l) => l.startsWith("improvement,"));

    expect(row).toBeDefined();
    const cells = row!.split(",");
    expect(cells[0]).toBe("improvement");
    expect(cells[2]).toBe("complete-required-data");
    expect(cells[4]).toBe("medium");
    expect(cells[7]).toBe("Complete os dados obrigatórios");
    expect(cells[8]).toBe("Alguns ativos não puderam avançar na resolução por falta de dados obrigatórios.");
  });

  it("12. filename: default format for a given date", () => {
    const name = resolutionQualityExportFileName(new Date(2026, 8, 30));

    expect(name).toBe("qualidade-resolucao-2026-09-30.csv");
  });

  it("13. filename: zero-pads single-digit month and day", () => {
    const name = resolutionQualityExportFileName(new Date(2026, 0, 5));

    expect(name).toBe("qualidade-resolucao-2026-01-05.csv");
  });

  it("14. filename: returns a plausible name when called with no argument", () => {
    const name = resolutionQualityExportFileName();

    expect(name).toMatch(/^qualidade-resolucao-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it("15. special characters: a comma in rawName is quoted per RFC 4180", () => {
    const items = [item({ rawName: "Ativo, com vírgula", status: "verified" })];
    const csv = buildPortfolioResolutionQualityCsv(items);

    expect(csv).toContain('"Ativo, com vírgula"');
  });

  it("16. special characters: a quote in rawName is escaped by doubling", () => {
    const items = [item({ rawName: 'Ativo "entre aspas"', status: "verified" })];
    const csv = buildPortfolioResolutionQualityCsv(items);

    expect(csv).toContain('"Ativo ""entre aspas"""');
  });

  it("17. row order is stable: summary rows, then improvement rows, then item rows", () => {
    const csv = buildPortfolioResolutionQualityCsv(RICH_ITEMS);
    const rowTypes = lines(csv)
      .slice(1)
      .map((l) => l.split(",")[0]);

    const firstImprovement = rowTypes.indexOf("improvement");
    const firstItem = rowTypes.indexOf("item");
    const lastSummary = rowTypes.lastIndexOf("summary");

    expect(lastSummary).toBeLessThan(firstImprovement === -1 ? Infinity : firstImprovement);
    expect((firstImprovement === -1 ? lastSummary : firstImprovement)).toBeLessThan(firstItem);
  });

  it("18. determinism: same input always yields the same output", () => {
    const first = buildPortfolioResolutionQualityCsv(RICH_ITEMS);
    const second = buildPortfolioResolutionQualityCsv(RICH_ITEMS.map((i) => ({ ...i })));

    expect(first).toBe(second);
  });

  it("19. never mutates the input array or its items", () => {
    const items = RICH_ITEMS.map((i) => ({ ...i }));
    const snapshotBefore = JSON.parse(JSON.stringify(items));

    buildPortfolioResolutionQualityCsv(items);

    expect(items).toEqual(snapshotBefore);
  });

  it("20. UX hint applied: 'Tesouro Selic' (no year) shows the treasury suggestion", () => {
    const csv = buildPortfolioResolutionQualityCsv(RICH_ITEMS);

    expect(csv).toContain(
      "item,item,3,Tesouro Selic,needs-more-evidence,,,São necessárias mais evidências,Informe o vencimento do título do Tesouro.",
    );
  });

  it("21. UX hint not applied when the year is present", () => {
    const items = [item({ rawName: "Tesouro Selic 2036", status: "needs-more-evidence" })];
    const csv = buildPortfolioResolutionQualityCsv(items);

    expect(csv).toContain("Forneça um nome mais específico para o ativo.");
    expect(csv).not.toContain("Informe o vencimento do título do Tesouro.");
  });

  it("22. CDB hint applied via the same merge PortfolioCsvResolver.tsx uses", () => {
    const csv = buildPortfolioResolutionQualityCsv(RICH_ITEMS);

    expect(csv).toContain(
      "item,item,4,CDB Banco XP,needs-more-evidence,,,São necessárias mais evidências,Informe o emissor e o produto específico.",
    );
  });

  it("23. asset_type column prioritizes item.assetType over verifiedAsset.type", () => {
    const items = [
      item({
        rawName: "Ativo",
        assetType: "stock",
        status: "verified",
        verifiedAsset: { code: "x", type: "fii", currency: "BRL" },
      }),
    ];
    const csv = buildPortfolioResolutionQualityCsv(items);

    expect(csv).toContain(",stock,");
    expect(csv).not.toContain(",fii,");
  });

  it("24. asset_type column is empty when no type is known", () => {
    const items = [item({ rawName: "Ativo Sem Tipo", status: "needs-more-evidence" })];
    const csv = buildPortfolioResolutionQualityCsv(items);
    const row = lines(csv).find((l) => l.startsWith("item,item,"));

    expect(row!.split(",")[5]).toBe("");
  });

  it("25. source column joins multiple sources with '; '", () => {
    const items = [
      item({
        rawName: "Ativo Multi Fonte",
        status: "verified",
        assetType: "stock",
        sources: ["B3", "TESOURO"],
      }),
    ];
    const csv = buildPortfolioResolutionQualityCsv(items);

    expect(csv).toContain("B3; TESOURO");
  });

  it("26. lineNumber is preserved as the item row's key", () => {
    const items = [item({ lineNumber: 42, rawName: "Ativo", status: "verified" })];
    const csv = buildPortfolioResolutionQualityCsv(items);
    const row = lines(csv).find((l) => l.startsWith("item,item,"));

    expect(row!.split(",")[2]).toBe("42");
  });

  it("27. by_status summary rows include the real per-status count", () => {
    const csv = buildPortfolioResolutionQualityCsv(RICH_ITEMS);

    expect(csv).toContain("summary,by_status,verified,Verificado (1),verified,,,,");
  });

  it("28. by_asset_type summary rows reflect the types present", () => {
    const csv = buildPortfolioResolutionQualityCsv(RICH_ITEMS);

    expect(lines(csv).some((l) => l.startsWith("summary,by_asset_type,stock,"))).toBe(true);
  });

  it("29. by_source summary rows reflect the sources present", () => {
    const csv = buildPortfolioResolutionQualityCsv(RICH_ITEMS);

    expect(lines(csv).some((l) => l.startsWith("summary,by_source,B3,"))).toBe(true);
  });

  it("30. pending_reasons summary rows are present when there are pendencies", () => {
    const csv = buildPortfolioResolutionQualityCsv(RICH_ITEMS);

    expect(lines(csv).some((l) => l.startsWith("summary,pending_reasons,"))).toBe(true);
  });

  it("31. errors summary rows are present for item-error entries", () => {
    const csv = buildPortfolioResolutionQualityCsv(RICH_ITEMS);

    expect(lines(csv).some((l) => l.startsWith("summary,errors,") && l.includes("Ativo com Erro"))).toBe(
      true,
    );
  });

  it("32. an item-error row shows the item-error explanation title", () => {
    const csv = buildPortfolioResolutionQualityCsv(RICH_ITEMS);

    expect(csv).toContain("item,item,5,Ativo com Erro,item-error,,,Erro ao processar o ativo,");
  });

  it("33. full row-count coverage: header + summary + improvement + item rows add up", () => {
    const csv = buildPortfolioResolutionQualityCsv(RICH_ITEMS);
    const all = lines(csv);

    const summaryCount = all.filter((l) => l.startsWith("summary,")).length;
    const improvementCount = all.filter((l) => l.startsWith("improvement,")).length;
    const itemCount = all.filter((l) => l.startsWith("item,")).length;

    expect(all).toHaveLength(1 + summaryCount + improvementCount + itemCount);
    expect(itemCount).toBe(RICH_ITEMS.length);
  });

  it("34. output is a plain string, never a Promise (no network/DOM involved)", () => {
    const result = buildPortfolioResolutionQualityCsv(RICH_ITEMS);

    expect(typeof result).toBe("string");
    expect(result).not.toBeInstanceOf(Promise);
  });
});
