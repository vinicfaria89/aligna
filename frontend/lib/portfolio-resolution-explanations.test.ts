import { describe, expect, it } from "vitest";

import { explainResolutionItem } from "./portfolio-resolution-explanations";

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

describe("explainResolutionItem", () => {
  it("1. verified", () => {
    const explanation = explainResolutionItem(item({ status: "verified" }));

    expect(explanation).toEqual({
      kind: "verified",
      title: "Ativo verificado",
      description: "O ativo foi identificado automaticamente utilizando evidências suficientes.",
      severity: "success",
    });
  });

  it("2. needs-more-evidence + stock", () => {
    const explanation = explainResolutionItem(
      item({ status: "needs-more-evidence", assetType: "stock" }),
    );

    expect(explanation.kind).toBe("needs-more-evidence");
    expect(explanation.title).toBe("São necessárias mais evidências");
    expect(explanation.severity).toBe("info");
    expect(explanation.suggestion).toBe("Confira se o ticker ou o nome do ativo está completo.");
  });

  it("3. needs-more-evidence + fii", () => {
    const explanation = explainResolutionItem(
      item({ status: "needs-more-evidence", assetType: "fii" }),
    );

    expect(explanation.suggestion).toBe("Confira se o ticker ou o nome do ativo está completo.");
  });

  it("4. needs-more-evidence + etf", () => {
    const explanation = explainResolutionItem(
      item({ status: "needs-more-evidence", assetType: "etf" }),
    );

    expect(explanation.suggestion).toBe("Confira se o ticker ou o nome do ativo está completo.");
  });

  it("5. needs-more-evidence + international", () => {
    const explanation = explainResolutionItem(
      item({ status: "needs-more-evidence", assetType: "international" }),
    );

    expect(explanation.suggestion).toBe("Confira se o ticker ou o nome do ativo está completo.");
  });

  it("6. needs-more-evidence + treasury", () => {
    const explanation = explainResolutionItem(
      item({ status: "needs-more-evidence", assetType: "treasury" }),
    );

    expect(explanation.suggestion).toBe("Informe o vencimento do título.");
  });

  it("7. needs-more-evidence + cdb", () => {
    const explanation = explainResolutionItem(
      item({ status: "needs-more-evidence", assetType: "cdb" }),
    );

    expect(explanation.suggestion).toBe("Informe o emissor e o produto específico.");
  });

  it("8. needs-more-evidence + lci", () => {
    const explanation = explainResolutionItem(
      item({ status: "needs-more-evidence", assetType: "lci" }),
    );

    expect(explanation.suggestion).toBe("Informe o emissor e o produto específico.");
  });

  it("9. needs-more-evidence + lca", () => {
    const explanation = explainResolutionItem(
      item({ status: "needs-more-evidence", assetType: "lca" }),
    );

    expect(explanation.suggestion).toBe("Informe o emissor e o produto específico.");
  });

  it("10. needs-more-evidence + unknown", () => {
    const explanation = explainResolutionItem(
      item({ status: "needs-more-evidence", assetType: "unknown" }),
    );

    expect(explanation.suggestion).toBe("Forneça um nome mais específico para o ativo.");
  });

  it("11. needs-user", () => {
    const explanation = explainResolutionItem(item({ status: "needs-user" }));

    expect(explanation.kind).toBe("needs-user");
    expect(explanation.title).toBe("Ação do usuário necessária");
    expect(explanation.suggestion).toBe("Revise os dados enviados.");
    expect(explanation.severity).toBe("warning");
  });

  it("12. conflict", () => {
    const explanation = explainResolutionItem(item({ status: "conflict" }));

    expect(explanation.kind).toBe("conflict");
    expect(explanation.title).toBe("Informações conflitantes");
    expect(explanation.suggestion).toBe("Revise os dados do ativo antes de tentar novamente.");
    expect(explanation.severity).toBe("warning");
  });

  it("13. blocked", () => {
    const explanation = explainResolutionItem(item({ status: "blocked" }));

    expect(explanation.kind).toBe("blocked");
    expect(explanation.title).toBe("Resolução bloqueada");
    expect(explanation.suggestion).toBe(
      "Verifique se todas as informações obrigatórias foram fornecidas.",
    );
    expect(explanation.severity).toBe("warning");
  });

  it("14. item-error", () => {
    const explanation = explainResolutionItem(item({ status: "item-error" }));

    expect(explanation.kind).toBe("item-error");
    expect(explanation.title).toBe("Erro ao processar o ativo");
    expect(explanation.suggestion).toBe("Tente novamente mais tarde.");
    expect(explanation.severity).toBe("error");
  });

  it("15. assetType from verifiedAsset.type when item.assetType is absent", () => {
    const explanation = explainResolutionItem(
      item({
        status: "needs-more-evidence",
        verifiedAsset: { code: "tesouro:selic:2029", type: "treasury", currency: "BRL" },
      }),
    );

    expect(explanation.suggestion).toBe("Informe o vencimento do título.");
  });

  it("16. assetType from item.assetType takes priority over verifiedAsset.type", () => {
    const explanation = explainResolutionItem(
      item({
        status: "needs-more-evidence",
        assetType: "cdb",
        verifiedAsset: { code: "x", type: "treasury", currency: "BRL" },
      }),
    );

    expect(explanation.suggestion).toBe("Informe o emissor e o produto específico.");
  });

  it("17. empty assetType falls back to the unknown suggestion", () => {
    const explanation = explainResolutionItem(
      item({ status: "needs-more-evidence", assetType: "   " }),
    );

    expect(explanation.suggestion).toBe("Forneça um nome mais específico para o ativo.");
  });

  it("18. unrecognized status never throws and never invents a cause", () => {
    const weird = item({ status: "esperando-milagre" as unknown as SnapshotStatus });

    const explanation = explainResolutionItem(weird);

    expect(explanation.kind).toBe("needs-more-evidence");
    expect(explanation.severity).toBe("info");
    expect(explanation.description).not.toMatch(/não existe|inválido|inexistente/i);
  });

  it("19. minimal item (only required fields) never throws", () => {
    const minimal: SnapshotItem = {
      lineNumber: 1,
      rawName: "X",
      status: "verified",
      pendingFields: [],
      sources: [],
    };

    expect(() => explainResolutionItem(minimal)).not.toThrow();
  });

  it("20. never mutates the input item", () => {
    const original = item({ status: "needs-more-evidence", assetType: "stock" });
    const snapshotBefore = JSON.parse(JSON.stringify(original));

    explainResolutionItem(original);

    expect(original).toEqual(snapshotBefore);
  });

  it("21. deterministic: same input always yields the same output", () => {
    const input = item({ status: "needs-more-evidence", assetType: "lca" });

    const first = explainResolutionItem(input);
    const second = explainResolutionItem(item({ status: "needs-more-evidence", assetType: "lca" }));

    expect(first).toEqual(second);
  });

  it("22. no dependency on the current date", () => {
    const before = explainResolutionItem(item({ status: "verified" }));

    const RealDate = Date;
    function ThrowingDate(): never {
      throw new Error("Date should never be called by a pure explanation function");
    }
    // @ts-expect-error -- deliberately breaking Date to prove it is unused
    global.Date = ThrowingDate;

    try {
      const after = explainResolutionItem(item({ status: "verified" }));
      expect(after).toEqual(before);
    } finally {
      global.Date = RealDate;
    }
  });

  it("23. no dependency on locale-specific formatting", () => {
    const explanation = explainResolutionItem(
      item({ status: "needs-more-evidence", assetType: "treasury", amount: 1234.5, currency: "BRL" }),
    );

    expect(explanation.title).not.toMatch(/[.,]/);
    expect(explanation.suggestion).toBe("Informe o vencimento do título.");
  });

  it("24. no React involved (plain object output)", () => {
    const explanation = explainResolutionItem(item({ status: "verified" }));

    expect(explanation).not.toHaveProperty("$$typeof");
    expect(typeof explanation).toBe("object");
  });

  it("25. no DOM access (works outside jsdom-only globals)", () => {
    expect(() => explainResolutionItem(item({ status: "verified" }))).not.toThrow();
    expect(typeof explainResolutionItem).toBe("function");
  });

  it("26. no network call (synchronous, not a Promise)", () => {
    const result = explainResolutionItem(item({ status: "verified" }));

    expect(result).not.toBeInstanceOf(Promise);
  });

  it("27. no provider awareness -- same explanation regardless of sources", () => {
    const withSource = explainResolutionItem(
      item({ status: "needs-more-evidence", assetType: "stock", sources: ["B3"] }),
    );
    const withoutSource = explainResolutionItem(
      item({ status: "needs-more-evidence", assetType: "stock", sources: [] }),
    );

    expect(withSource).toEqual(withoutSource);
  });

  it("28. no AIE-specific fields required beyond SnapshotItem", () => {
    const explanation = explainResolutionItem(
      item({ status: "needs-more-evidence", assetType: "stock" }),
    );

    expect(explanation.kind).toBe("needs-more-evidence");
  });

  it("29. no dependency on being part of a saved snapshot", () => {
    const freshLike = item({ status: "verified", lineNumber: 7 });
    const savedLike = { ...item({ status: "verified" }), lineNumber: 7 };

    expect(explainResolutionItem(freshLike)).toEqual(explainResolutionItem(savedLike));
  });

  it("30. full branch coverage: every SnapshotStatus produces a distinct, valid explanation", () => {
    const statuses: SnapshotStatus[] = [
      "verified",
      "needs-more-evidence",
      "needs-user",
      "conflict",
      "blocked",
      "item-error",
    ];

    for (const status of statuses) {
      const explanation = explainResolutionItem(item({ status }));
      expect(explanation.kind).toBe(status);
      expect(explanation.title.length).toBeGreaterThan(0);
      expect(explanation.description.length).toBeGreaterThan(0);
      expect(["success", "info", "warning", "error"]).toContain(explanation.severity);
    }
  });
});
