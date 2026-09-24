import { describe, expect, it } from "vitest";

import { summarizePortfolioResolutionQuality } from "./portfolio-resolution-quality-metrics";
import type { SnapshotItem } from "./portfolio-snapshot-mapping";

/**
 * TASK-060A: minimal builders, no diagnostic-fixture dependency -- this
 * helper is tested in complete isolation from the AIE/diagnostics battery,
 * matching the task's own "não depender de fixtures diagnósticas grandes"
 * instruction.
 */
function item(overrides: Partial<SnapshotItem> = {}): SnapshotItem {
  return {
    lineNumber: 1,
    rawName: "Ativo Teste",
    status: "verified",
    pendingFields: [],
    sources: [],
    ...overrides,
  };
}

function findStatus(summary: ReturnType<typeof summarizePortfolioResolutionQuality>, status: string) {
  return summary.byStatus.find((row) => row.status === status);
}

function findAssetType(summary: ReturnType<typeof summarizePortfolioResolutionQuality>, assetType: string) {
  return summary.byAssetType.find((row) => row.assetType === assetType);
}

function findSource(summary: ReturnType<typeof summarizePortfolioResolutionQuality>, source: string) {
  return summary.bySource.find((row) => row.source === source);
}

function findReason(summary: ReturnType<typeof summarizePortfolioResolutionQuality>, reason: string) {
  return summary.pendingReasons.find((row) => row.reason === reason);
}

describe("summarizePortfolioResolutionQuality", () => {
  it("1. an empty list returns zeroed totals and verificationRate = null", () => {
    const summary = summarizePortfolioResolutionQuality([]);

    expect(summary.totals).toEqual({
      items: 0,
      verified: 0,
      pending: 0,
      errors: 0,
      blocked: 0,
      conflicts: 0,
      needsUser: 0,
      needsMoreEvidence: 0,
      verificationRate: null,
    });
    expect(summary.byAssetType).toEqual([]);
    expect(summary.bySource).toEqual([]);
    expect(summary.pendingReasons).toEqual([]);
    expect(summary.errors).toEqual([]);
  });

  it("2. all verified items give verificationRate = 100", () => {
    const summary = summarizePortfolioResolutionQuality([
      item({ status: "verified", ticker: "PETR4" }),
      item({ status: "verified", ticker: "VALE3" }),
    ]);

    expect(summary.totals.verified).toBe(2);
    expect(summary.totals.verificationRate).toBe(100);
  });

  it("3. a mix of verified/pending/errors computes correct totals", () => {
    const summary = summarizePortfolioResolutionQuality([
      item({ status: "verified" }),
      item({ status: "needs-more-evidence" }),
      item({ status: "item-error" }),
    ]);

    expect(summary.totals.items).toBe(3);
    expect(summary.totals.verified).toBe(1);
    expect(summary.totals.pending).toBe(1);
    expect(summary.totals.errors).toBe(1);
  });

  it("4. 'needs-more-evidence' counts as pending", () => {
    const summary = summarizePortfolioResolutionQuality([item({ status: "needs-more-evidence" })]);

    expect(summary.totals.pending).toBe(1);
    expect(summary.totals.needsMoreEvidence).toBe(1);
  });

  it("5. 'needs-user' counts as pending", () => {
    const summary = summarizePortfolioResolutionQuality([item({ status: "needs-user" })]);

    expect(summary.totals.pending).toBe(1);
    expect(summary.totals.needsUser).toBe(1);
  });

  it("6. 'conflict' appears separately AND counts as pending", () => {
    const summary = summarizePortfolioResolutionQuality([item({ status: "conflict" })]);

    expect(summary.totals.pending).toBe(1);
    expect(summary.totals.conflicts).toBe(1);
  });

  it("7. 'blocked' appears separately as blocked", () => {
    const summary = summarizePortfolioResolutionQuality([item({ status: "blocked" })]);

    expect(summary.totals.blocked).toBe(1);
  });

  it("8. 'item-error' counts as an error and appears in errors[]", () => {
    const summary = summarizePortfolioResolutionQuality([item({ status: "item-error", rawName: "Ativo Quebrado" })]);

    expect(summary.totals.errors).toBe(1);
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0].name).toBe("Ativo Quebrado");
    expect(summary.errors[0].status).toBe("item-error");
  });

  it("9. an unknown status never throws and appears in byStatus", () => {
    const weird = item({ status: "totally-unknown-status" as SnapshotItem["status"] });

    expect(() => summarizePortfolioResolutionQuality([weird])).not.toThrow();

    const summary = summarizePortfolioResolutionQuality([weird]);
    expect(findStatus(summary, "totally-unknown-status")?.count).toBe(1);
    // Documented behavior: unrecognized status counts as pending, never as
    // verified or an error.
    expect(summary.totals.pending).toBe(1);
    expect(summary.totals.verified).toBe(0);
    expect(summary.totals.errors).toBe(0);
  });

  it("10. percentages per status are computed correctly", () => {
    const summary = summarizePortfolioResolutionQuality([
      item({ status: "verified" }),
      item({ status: "verified" }),
      item({ status: "needs-more-evidence" }),
      item({ status: "item-error" }),
    ]);

    expect(findStatus(summary, "verified")?.percentage).toBe(50);
    expect(findStatus(summary, "needs-more-evidence")?.percentage).toBe(25);
    expect(findStatus(summary, "item-error")?.percentage).toBe(25);
    expect(findStatus(summary, "blocked")?.percentage).toBe(0);
  });

  it("11. asset type uses item.assetType before verifiedAsset.type", () => {
    const summary = summarizePortfolioResolutionQuality([
      item({
        status: "verified",
        assetType: "stock",
        verifiedAsset: { code: "b3:PETR4", type: "fii", currency: "BRL" },
      }),
    ]);

    expect(findAssetType(summary, "stock")?.count).toBe(1);
    expect(findAssetType(summary, "fii")).toBeUndefined();
  });

  it("12. asset type falls back to verifiedAsset.type when item.assetType is absent", () => {
    const summary = summarizePortfolioResolutionQuality([
      item({ status: "verified", verifiedAsset: { code: "b3:PETR4", type: "stock", currency: "BRL" } }),
    ]);

    expect(findAssetType(summary, "stock")?.count).toBe(1);
  });

  it("13. missing/empty assetType becomes unknown", () => {
    const summary = summarizePortfolioResolutionQuality([
      item({ status: "needs-more-evidence" }),
      item({ status: "needs-more-evidence", assetType: "   " }),
    ]);

    expect(findAssetType(summary, "unknown")?.count).toBe(2);
  });

  it("14. known asset type labels are correct", () => {
    const summary = summarizePortfolioResolutionQuality([
      item({ status: "verified", assetType: "stock" }),
      item({ status: "verified", assetType: "fii" }),
      item({ status: "verified", assetType: "treasury" }),
      item({ status: "verified", assetType: "cdb" }),
    ]);

    expect(findAssetType(summary, "stock")?.label).toBe("Ações");
    expect(findAssetType(summary, "fii")?.label).toBe("FIIs");
    expect(findAssetType(summary, "treasury")?.label).toBe("Tesouro");
    expect(findAssetType(summary, "cdb")?.label).toBe("CDBs");
  });

  it("15. an unknown-to-the-map asset type is kept and humanized stably", () => {
    const summary = summarizePortfolioResolutionQuality([
      item({ status: "needs-more-evidence", assetType: "real-estate" }),
    ]);

    const row = findAssetType(summary, "real-estate");
    expect(row).toBeDefined();
    expect(row?.label).toBe("Real Estate");
  });

  it("16. invalid values count as 0", () => {
    const summary = summarizePortfolioResolutionQuality([
      item({ status: "verified", assetType: "stock", amount: undefined }),
      item({ status: "verified", assetType: "stock", amount: Number.NaN }),
      item({ status: "verified", assetType: "stock", amount: Number.POSITIVE_INFINITY }),
    ]);

    expect(findAssetType(summary, "stock")?.value).toBe(0);
  });

  it("17. multi-currency does not convert and does not throw", () => {
    const summary = summarizePortfolioResolutionQuality([
      item({ status: "verified", assetType: "stock", amount: 1000, currency: "BRL" }),
      item({ status: "verified", assetType: "stock", amount: 100, currency: "USD" }),
    ]);

    expect(findAssetType(summary, "stock")?.value).toBe(1100);
  });

  it("18. sources of verified items are counted", () => {
    const summary = summarizePortfolioResolutionQuality([
      item({ status: "verified", sources: ["B3"] }),
      item({ status: "verified", sources: ["B3"] }),
      item({ status: "verified", sources: ["TESOURO"] }),
    ]);

    expect(findSource(summary, "B3")?.count).toBe(2);
    expect(findSource(summary, "TESOURO")?.count).toBe(1);
  });

  it("19. duplicated sources within the same item are deduplicated", () => {
    const summary = summarizePortfolioResolutionQuality([item({ status: "verified", sources: ["B3", "B3"] })]);

    expect(findSource(summary, "B3")?.count).toBe(1);
  });

  it("20. a missing source on a verified item becomes 'unknown'", () => {
    const summary = summarizePortfolioResolutionQuality([item({ status: "verified", sources: [] })]);

    expect(findSource(summary, "unknown")?.count).toBe(1);
  });

  it("21. assetTypes per source are unique and sorted", () => {
    const summary = summarizePortfolioResolutionQuality([
      item({ status: "verified", assetType: "fii", sources: ["B3"] }),
      item({ status: "verified", assetType: "stock", sources: ["B3"] }),
      item({ status: "verified", assetType: "stock", sources: ["B3"] }),
    ]);

    expect(findSource(summary, "B3")?.assetTypes).toEqual(["fii", "stock"]);
  });

  it("22. pending items are grouped by reason derived from status when no explicit reason exists", () => {
    const summary = summarizePortfolioResolutionQuality([
      item({ status: "needs-more-evidence" }),
      item({ status: "needs-more-evidence" }),
      item({ status: "needs-user" }),
      item({ status: "conflict" }),
      item({ status: "blocked" }),
    ]);

    expect(findReason(summary, "needs_more_evidence")?.count).toBe(2);
    expect(findReason(summary, "needs_user")?.count).toBe(1);
    expect(findReason(summary, "conflict")?.count).toBe(1);
    expect(findReason(summary, "blocked")?.count).toBe(1);
  });

  it("23. status is the explicit signal used for the reason -- deriving it is deterministic and stable across calls", () => {
    const items = [item({ status: "needs-more-evidence" }), item({ status: "conflict" })];

    const first = summarizePortfolioResolutionQuality(items);
    const second = summarizePortfolioResolutionQuality(items);

    expect(first.pendingReasons).toEqual(second.pendingReasons);
  });

  it("24. errors preserve name/key/message when available", () => {
    const summary = summarizePortfolioResolutionQuality([
      item({ status: "item-error", rawName: "Ativo Quebrado", ticker: "QBR1" }),
    ]);

    expect(summary.errors[0]).toEqual({
      key: "QBR1",
      name: "Ativo Quebrado",
      status: "item-error",
    });
  });

  it("25. byStatus ordering is deterministic (known statuses first, in fixed order)", () => {
    const summary = summarizePortfolioResolutionQuality([
      item({ status: "item-error" }),
      item({ status: "blocked" }),
      item({ status: "verified" }),
    ]);

    expect(summary.byStatus.map((row) => row.status)).toEqual([
      "verified",
      "needs-more-evidence",
      "needs-user",
      "conflict",
      "blocked",
      "item-error",
    ]);
  });

  it("26. byAssetType ordering is deterministic (known types first, in fixed order, unknown alphabetical after)", () => {
    const summary = summarizePortfolioResolutionQuality([
      item({ status: "verified", assetType: "etf" }),
      item({ status: "verified", assetType: "stock" }),
      item({ status: "needs-more-evidence", assetType: "zzz-custom" }),
      item({ status: "needs-more-evidence", assetType: "aaa-custom" }),
    ]);

    expect(summary.byAssetType.map((row) => row.assetType)).toEqual([
      "stock",
      "etf",
      "aaa-custom",
      "zzz-custom",
    ]);
  });

  it("27. bySource ordering is deterministic (count desc, then source asc)", () => {
    const summary = summarizePortfolioResolutionQuality([
      item({ status: "verified", sources: ["ZZZ"] }),
      item({ status: "verified", sources: ["AAA"] }),
      item({ status: "verified", sources: ["AAA"] }),
    ]);

    expect(summary.bySource.map((row) => row.source)).toEqual(["AAA", "ZZZ"]);
  });

  it("28. pendingReasons ordering is deterministic (count desc, then label asc)", () => {
    const summary = summarizePortfolioResolutionQuality([
      item({ status: "blocked" }),
      item({ status: "needs-more-evidence" }),
      item({ status: "needs-more-evidence" }),
    ]);

    expect(summary.pendingReasons.map((row) => row.reason)).toEqual(["needs_more_evidence", "blocked"]);
  });

  it("29. never mutates the input array nor its items", () => {
    const items = [item({ status: "verified", sources: ["B3"] })];
    const snapshot = JSON.parse(JSON.stringify(items));

    summarizePortfolioResolutionQuality(items);

    expect(items).toEqual(snapshot);
  });

  it("30. works with minimal, coherent fake data, independent of any UI", () => {
    const summary = summarizePortfolioResolutionQuality([item()]);

    expect(() => summary).not.toThrow();
    expect(summary.totals.items).toBe(1);
  });

  it("31. a verified Tesouro item appears as assetType 'treasury' and source 'TESOURO'", () => {
    const summary = summarizePortfolioResolutionQuality([
      item({
        status: "verified",
        rawName: "Tesouro Selic 2029",
        assetType: "treasury",
        sources: ["TESOURO"],
        verifiedAsset: { code: "tesouro:selic:2029", type: "treasury", currency: "BRL" },
      }),
    ]);

    expect(findAssetType(summary, "treasury")?.verified).toBe(1);
    expect(findSource(summary, "TESOURO")?.count).toBe(1);
  });

  it("32. a verified B3 item appears with source 'B3'", () => {
    const summary = summarizePortfolioResolutionQuality([
      item({
        status: "verified",
        rawName: "PETR4",
        ticker: "PETR4",
        assetType: "stock",
        sources: ["B3"],
        verifiedAsset: { code: "b3:PETR4", type: "stock", currency: "BRL" },
      }),
    ]);

    expect(findSource(summary, "B3")?.count).toBe(1);
  });

  it("33. pending CDB/LCI/LCA never count as verified", () => {
    const summary = summarizePortfolioResolutionQuality([
      item({ status: "needs-more-evidence", rawName: "CDB Banco Teste", assetType: "cdb", issuerName: "Banco Teste" } as Partial<SnapshotItem>),
      item({ status: "needs-more-evidence", rawName: "Fundo Tesouro Selic" }),
    ]);

    expect(summary.totals.verified).toBe(0);
    expect(summary.totals.pending).toBe(2);
  });

  it("34. per-type counts separate verified, pending and errors", () => {
    const summary = summarizePortfolioResolutionQuality([
      item({ status: "verified", assetType: "stock" }),
      item({ status: "needs-more-evidence", assetType: "stock" }),
      item({ status: "item-error", assetType: "stock" }),
    ]);

    const row = findAssetType(summary, "stock");
    expect(row).toEqual({
      assetType: "stock",
      label: "Ações",
      count: 3,
      verified: 1,
      pending: 1,
      errors: 1,
      value: 0,
    });
  });

  it("35. verificationRate never returns NaN/Infinity", () => {
    const empty = summarizePortfolioResolutionQuality([]);
    const withItems = summarizePortfolioResolutionQuality([item({ status: "item-error" })]);

    expect(empty.totals.verificationRate).toBeNull();
    expect(Number.isNaN(withItems.totals.verificationRate)).toBe(false);
    expect(Number.isFinite(withItems.totals.verificationRate)).toBe(true);
    expect(withItems.totals.verificationRate).toBe(0);
  });
});
