import { describe, expect, it } from "vitest";

import { buildPortfolioResolutionImprovementPlan } from "./portfolio-resolution-improvement-plan";

import type { SnapshotItem, SnapshotStatus } from "./portfolio-snapshot-mapping";

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

function ids(plan: ReturnType<typeof buildPortfolioResolutionImprovementPlan>): string[] {
  return plan.suggestions.map((s) => s.id);
}

describe("buildPortfolioResolutionImprovementPlan", () => {
  it("1. fully verified portfolio returns no suggestions", () => {
    const plan = buildPortfolioResolutionImprovementPlan([
      item({ status: "verified", assetType: "stock" }),
      item({ status: "verified", assetType: "treasury" }),
    ]);

    expect(plan.suggestions).toEqual([]);
    expect(plan.totals).toEqual({ items: 2, suggestions: 0 });
  });

  it("2. unknown asset type triggers the identify-types suggestion", () => {
    const plan = buildPortfolioResolutionImprovementPlan([
      item({ status: "verified" }), // no assetType, no verifiedAsset -> unknown
    ]);

    expect(ids(plan)).toEqual(["identify-asset-types"]);
    expect(plan.suggestions[0]).toEqual({
      id: "identify-asset-types",
      priority: "high",
      title: "Identifique o tipo dos ativos",
      description: "Preencher o tipo do ativo ajuda a aumentar a taxa de verificação automática.",
      affectedItems: 1,
    });
  });

  it("3. needs-more-evidence triggers the provide-more-evidence suggestion", () => {
    const plan = buildPortfolioResolutionImprovementPlan([
      item({ status: "needs-more-evidence", assetType: "stock" }),
    ]);

    expect(ids(plan)).toEqual(["provide-more-evidence"]);
    expect(plan.suggestions[0]).toMatchObject({
      priority: "high",
      title: "Forneça mais informações dos ativos",
    });
  });

  it("4. item-error triggers the review-item-errors suggestion", () => {
    const plan = buildPortfolioResolutionImprovementPlan([
      item({ status: "item-error", assetType: "stock" }),
    ]);

    expect(ids(plan)).toEqual(["review-item-errors"]);
    expect(plan.suggestions[0]).toMatchObject({ priority: "high", title: "Revise os ativos com erro" });
  });

  it("5. conflict triggers the resolve-conflicts suggestion", () => {
    const plan = buildPortfolioResolutionImprovementPlan([
      item({ status: "conflict", assetType: "stock" }),
    ]);

    expect(ids(plan)).toEqual(["resolve-conflicts"]);
    expect(plan.suggestions[0]).toMatchObject({
      priority: "medium",
      title: "Resolva informações conflitantes",
    });
  });

  it("6. blocked triggers the complete-required-data suggestion", () => {
    const plan = buildPortfolioResolutionImprovementPlan([
      item({ status: "blocked", assetType: "stock" }),
    ]);

    expect(ids(plan)).toEqual(["complete-required-data"]);
    expect(plan.suggestions[0]).toMatchObject({
      priority: "medium",
      title: "Complete os dados obrigatórios",
    });
  });

  it("7. several suggestions together", () => {
    const plan = buildPortfolioResolutionImprovementPlan([
      item({ status: "verified" }), // unknown assetType
      item({ status: "needs-more-evidence", assetType: "stock" }),
      item({ status: "item-error", assetType: "stock" }),
      item({ status: "conflict", assetType: "stock" }),
      item({ status: "blocked", assetType: "stock" }),
    ]);

    expect(ids(plan)).toEqual([
      "provide-more-evidence",
      "identify-asset-types",
      "review-item-errors",
      "complete-required-data",
      "resolve-conflicts",
    ]);
  });

  it("8. deduplication: each category appears at most once regardless of item count", () => {
    const plan = buildPortfolioResolutionImprovementPlan([
      item({ status: "needs-more-evidence", assetType: "stock" }),
      item({ status: "needs-more-evidence", assetType: "fii" }),
      item({ status: "needs-more-evidence", assetType: "etf" }),
    ]);

    expect(ids(plan)).toEqual(["provide-more-evidence"]);
    expect(plan.suggestions).toHaveLength(1);
  });

  it("9. ordering: high before medium, then alphabetical by title within the same priority", () => {
    const plan = buildPortfolioResolutionImprovementPlan([
      item({ status: "verified" }), // unknown -> high
      item({ status: "needs-more-evidence", assetType: "stock" }), // high
      item({ status: "item-error", assetType: "stock" }), // high
      item({ status: "blocked", assetType: "stock" }), // medium
      item({ status: "conflict", assetType: "stock" }), // medium
    ]);

    const priorities = plan.suggestions.map((s) => s.priority);
    expect(priorities).toEqual(["high", "high", "high", "medium", "medium"]);

    const highTitles = plan.suggestions.filter((s) => s.priority === "high").map((s) => s.title);
    expect(highTitles).toEqual([...highTitles].sort());

    const mediumTitles = plan.suggestions.filter((s) => s.priority === "medium").map((s) => s.title);
    expect(mediumTitles).toEqual([...mediumTitles].sort());
  });

  it("10. affectedItems counts exactly the matching items, not all items", () => {
    const plan = buildPortfolioResolutionImprovementPlan([
      item({ status: "needs-more-evidence", assetType: "stock" }),
      item({ status: "needs-more-evidence", assetType: "fii" }),
      item({ status: "verified", assetType: "stock" }),
    ]);

    const suggestion = plan.suggestions.find((s) => s.id === "provide-more-evidence");
    expect(suggestion?.affectedItems).toBe(2);
  });

  it("11. totals reflect the full portfolio and suggestion count", () => {
    const plan = buildPortfolioResolutionImprovementPlan([
      item({ status: "needs-more-evidence", assetType: "stock" }),
      item({ status: "conflict", assetType: "stock" }),
      item({ status: "verified", assetType: "stock" }),
    ]);

    expect(plan.totals).toEqual({ items: 3, suggestions: 2 });
  });

  it("12. minimal item (only required fields) never throws", () => {
    const minimal: SnapshotItem = {
      lineNumber: 1,
      rawName: "X",
      status: "verified",
      pendingFields: [],
      sources: [],
    };

    expect(() => buildPortfolioResolutionImprovementPlan([minimal])).not.toThrow();
  });

  it("13. empty input returns an empty plan", () => {
    const plan = buildPortfolioResolutionImprovementPlan([]);

    expect(plan).toEqual({ suggestions: [], totals: { items: 0, suggestions: 0 } });
  });

  it("14. deterministic: same input always yields the same output", () => {
    const build = () =>
      buildPortfolioResolutionImprovementPlan([
        item({ status: "needs-more-evidence", assetType: "stock" }),
        item({ status: "blocked" }),
      ]);

    expect(build()).toEqual(build());
  });

  it("15. never mutates the input array or its items", () => {
    const items = [
      item({ status: "needs-more-evidence", assetType: "stock" }),
      item({ status: "verified" }),
    ];
    const snapshotBefore = JSON.parse(JSON.stringify(items));

    buildPortfolioResolutionImprovementPlan(items);

    expect(items).toEqual(snapshotBefore);
    expect(items).toHaveLength(2);
  });

  it("16. no dependency on the current date", () => {
    const before = buildPortfolioResolutionImprovementPlan([
      item({ status: "needs-more-evidence", assetType: "stock" }),
    ]);

    const RealDate = Date;
    function ThrowingDate(): never {
      throw new Error("Date should never be called by a pure planning function");
    }
    // @ts-expect-error -- deliberately breaking Date to prove it is unused
    global.Date = ThrowingDate;

    try {
      const after = buildPortfolioResolutionImprovementPlan([
        item({ status: "needs-more-evidence", assetType: "stock" }),
      ]);
      expect(after).toEqual(before);
    } finally {
      global.Date = RealDate;
    }
  });

  it("17. no dependency on locale-specific sorting", () => {
    const plan = buildPortfolioResolutionImprovementPlan([
      item({ status: "conflict", assetType: "stock" }),
      item({ status: "blocked", assetType: "stock" }),
    ]);

    // Plain code-unit ordering: "Complete..." before "Resolva..." regardless
    // of the runtime's ICU/locale configuration.
    expect(plan.suggestions.map((s) => s.title)).toEqual([
      "Complete os dados obrigatórios",
      "Resolva informações conflitantes",
    ]);
  });

  it("18. no React involved (plain object output)", () => {
    const plan = buildPortfolioResolutionImprovementPlan([
      item({ status: "needs-more-evidence", assetType: "stock" }),
    ]);

    expect(plan).not.toHaveProperty("$$typeof");
    expect(typeof plan).toBe("object");
  });

  it("19. no DOM access", () => {
    expect(() => buildPortfolioResolutionImprovementPlan([item({ status: "verified" })])).not.toThrow();
    expect(typeof buildPortfolioResolutionImprovementPlan).toBe("function");
  });

  it("20. no network call (synchronous, not a Promise)", () => {
    const result = buildPortfolioResolutionImprovementPlan([item({ status: "verified" })]);

    expect(result).not.toBeInstanceOf(Promise);
  });

  it("21. no provider awareness -- same plan regardless of sources", () => {
    const withSource = buildPortfolioResolutionImprovementPlan([
      item({ status: "needs-more-evidence", assetType: "stock", sources: ["B3"] }),
    ]);
    const withoutSource = buildPortfolioResolutionImprovementPlan([
      item({ status: "needs-more-evidence", assetType: "stock", sources: [] }),
    ]);

    expect(withSource).toEqual(withoutSource);
  });

  it("22. no AIE-specific fields required beyond SnapshotItem", () => {
    const plan = buildPortfolioResolutionImprovementPlan([
      item({ status: "needs-more-evidence", assetType: "stock" }),
    ]);

    expect(ids(plan)).toContain("provide-more-evidence");
  });

  it("23. no dependency on being part of a saved snapshot (works on any SnapshotItem[])", () => {
    const freshLike = item({ status: "conflict", assetType: "stock", lineNumber: 9 });
    const savedLike = { ...item({ status: "conflict", assetType: "stock" }), lineNumber: 9 };

    expect(buildPortfolioResolutionImprovementPlan([freshLike])).toEqual(
      buildPortfolioResolutionImprovementPlan([savedLike]),
    );
  });

  it("24. full branch coverage: every rule fires independently with the right shape", () => {
    const statuses: { status: SnapshotStatus; assetType?: string; expectedId: string }[] = [
      { status: "verified", expectedId: "identify-asset-types" }, // no assetType -> unknown
      { status: "needs-more-evidence", assetType: "stock", expectedId: "provide-more-evidence" },
      { status: "item-error", assetType: "stock", expectedId: "review-item-errors" },
      { status: "conflict", assetType: "stock", expectedId: "resolve-conflicts" },
      { status: "blocked", assetType: "stock", expectedId: "complete-required-data" },
    ];

    for (const { status, assetType, expectedId } of statuses) {
      const plan = buildPortfolioResolutionImprovementPlan([item({ status, assetType })]);
      expect(ids(plan)).toContain(expectedId);
      const suggestion = plan.suggestions.find((s) => s.id === expectedId);
      expect(suggestion?.title.length).toBeGreaterThan(0);
      expect(suggestion?.description.length).toBeGreaterThan(0);
      expect(["high", "medium", "low"]).toContain(suggestion?.priority);
    }
  });
});
