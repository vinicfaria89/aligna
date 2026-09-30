import { describe, expect, it } from "vitest";

import { detectPortfolioResolutionUxHint } from "./portfolio-resolution-ux-hints";

import type { SnapshotItem } from "./portfolio-snapshot-mapping";

function item(overrides: Partial<SnapshotItem> = {}): SnapshotItem {
  return {
    lineNumber: 2,
    rawName: "Ativo Teste",
    status: "needs-more-evidence",
    pendingFields: [],
    sources: [],
    ...overrides,
  };
}

describe("detectPortfolioResolutionUxHint", () => {
  describe("treasury", () => {
    it("1. 'Tesouro Selic' (no year) returns a treasury hint", () => {
      const hint = detectPortfolioResolutionUxHint(item({ rawName: "Tesouro Selic" }));

      expect(hint).toEqual({
        kind: "treasury",
        suggestion: "Informe o vencimento do título do Tesouro.",
      });
    });

    it("2. 'Tesouro IPCA+' (no year) returns a treasury hint", () => {
      const hint = detectPortfolioResolutionUxHint(item({ rawName: "Tesouro IPCA+" }));

      expect(hint?.kind).toBe("treasury");
    });

    it("3. 'Tesouro Selic 2029' (with year) returns null", () => {
      const hint = detectPortfolioResolutionUxHint(item({ rawName: "Tesouro Selic 2029" }));

      expect(hint).toBeNull();
    });

    it("4. 'Tesouro IPCA+ 2035' (with year) returns null", () => {
      const hint = detectPortfolioResolutionUxHint(item({ rawName: "Tesouro IPCA+ 2035" }));

      expect(hint).toBeNull();
    });
  });

  describe("cdb / lci / lca", () => {
    it("5. 'CDB Banco Teste' returns a cdb hint", () => {
      const hint = detectPortfolioResolutionUxHint(item({ rawName: "CDB Banco Teste" }));

      expect(hint).toEqual({ kind: "cdb", suggestion: "Informe o emissor e o produto específico." });
    });

    it("6. 'CDB XP' returns a cdb hint", () => {
      const hint = detectPortfolioResolutionUxHint(item({ rawName: "CDB XP" }));

      expect(hint?.kind).toBe("cdb");
    });

    it("7. 'LCI Banco Teste' returns an lci hint", () => {
      const hint = detectPortfolioResolutionUxHint(item({ rawName: "LCI Banco Teste" }));

      expect(hint).toEqual({ kind: "lci", suggestion: "Informe o emissor e o produto específico." });
    });

    it("8. 'LCA Banco Teste' returns an lca hint", () => {
      const hint = detectPortfolioResolutionUxHint(item({ rawName: "LCA Banco Teste" }));

      expect(hint).toEqual({ kind: "lca", suggestion: "Informe o emissor e o produto específico." });
    });
  });

  describe("priority when multiple keywords are present", () => {
    it("9. Tesouro wins over CDB", () => {
      const hint = detectPortfolioResolutionUxHint(item({ rawName: "CDB Tesouro Selic" }));

      expect(hint?.kind).toBe("treasury");
    });

    it("10. Tesouro wins over LCI", () => {
      const hint = detectPortfolioResolutionUxHint(item({ rawName: "LCI Tesouro IPCA" }));

      expect(hint?.kind).toBe("treasury");
    });

    it("11. Tesouro wins over LCA", () => {
      const hint = detectPortfolioResolutionUxHint(item({ rawName: "LCA Tesouro Prefixado" }));

      expect(hint?.kind).toBe("treasury");
    });

    it("12. CDB wins over LCI", () => {
      const hint = detectPortfolioResolutionUxHint(item({ rawName: "CDB LCI Produto" }));

      expect(hint?.kind).toBe("cdb");
    });

    it("13. CDB wins over LCA", () => {
      const hint = detectPortfolioResolutionUxHint(item({ rawName: "CDB LCA Produto" }));

      expect(hint?.kind).toBe("cdb");
    });

    it("14. LCI wins over LCA", () => {
      const hint = detectPortfolioResolutionUxHint(item({ rawName: "LCI LCA Produto" }));

      expect(hint?.kind).toBe("lci");
    });
  });

  describe("case insensitivity", () => {
    it("15. lowercase 'cdb' still matches", () => {
      const hint = detectPortfolioResolutionUxHint(item({ rawName: "cdb banco teste" }));

      expect(hint?.kind).toBe("cdb");
    });

    it("16. uppercase 'TESOURO' (no year) still matches", () => {
      const hint = detectPortfolioResolutionUxHint(item({ rawName: "TESOURO SELIC" }));

      expect(hint?.kind).toBe("treasury");
    });

    it("17. mixed case 'Lci' still matches", () => {
      const hint = detectPortfolioResolutionUxHint(item({ rawName: "Lci Banco Teste" }));

      expect(hint?.kind).toBe("lci");
    });
  });

  describe("whitespace tolerance", () => {
    it("18. leading/trailing whitespace around 'CDB' still matches", () => {
      const hint = detectPortfolioResolutionUxHint(item({ rawName: "  CDB  " }));

      expect(hint?.kind).toBe("cdb");
    });

    it("19. multiple internal spaces still matches", () => {
      const hint = detectPortfolioResolutionUxHint(item({ rawName: "CDB    Banco    Teste" }));

      expect(hint?.kind).toBe("cdb");
    });

    it("20. multiple internal spaces around 'Tesouro' (no year) still matches", () => {
      const hint = detectPortfolioResolutionUxHint(item({ rawName: "   Tesouro   Selic   " }));

      expect(hint?.kind).toBe("treasury");
    });
  });

  describe("returns null", () => {
    it("21. 'PETR4' returns null", () => {
      expect(detectPortfolioResolutionUxHint(item({ rawName: "PETR4" }))).toBeNull();
    });

    it("22. 'BOVA11' returns null", () => {
      expect(detectPortfolioResolutionUxHint(item({ rawName: "BOVA11" }))).toBeNull();
    });

    it("23. 'Fundo Tesouro Selic' returns null", () => {
      expect(detectPortfolioResolutionUxHint(item({ rawName: "Fundo Tesouro Selic" }))).toBeNull();
    });

    it("24. 'ETF Tesouro' returns null", () => {
      expect(detectPortfolioResolutionUxHint(item({ rawName: "ETF Tesouro" }))).toBeNull();
    });

    it("25. 'Carteira Tesouro' returns null", () => {
      expect(detectPortfolioResolutionUxHint(item({ rawName: "Carteira Tesouro" }))).toBeNull();
    });
  });

  describe("word-boundary safety (no substring/approximation match)", () => {
    it("26. 'CDBX' never matches 'cdb'", () => {
      expect(detectPortfolioResolutionUxHint(item({ rawName: "CDBX Produto" }))).toBeNull();
    });

    it("27. 'Tesouraria' never matches 'tesouro'", () => {
      expect(detectPortfolioResolutionUxHint(item({ rawName: "Departamento de Tesouraria" }))).toBeNull();
    });
  });

  describe("purity and edge cases", () => {
    it("28. minimal item (only required fields) never throws", () => {
      const minimal: SnapshotItem = {
        lineNumber: 1,
        rawName: "CDB X",
        status: "needs-more-evidence",
        pendingFields: [],
        sources: [],
      };

      expect(() => detectPortfolioResolutionUxHint(minimal)).not.toThrow();
      expect(detectPortfolioResolutionUxHint(minimal)?.kind).toBe("cdb");
    });

    it("29. deterministic: same input always yields the same output", () => {
      const a = detectPortfolioResolutionUxHint(item({ rawName: "Tesouro Selic" }));
      const b = detectPortfolioResolutionUxHint(item({ rawName: "Tesouro Selic" }));

      expect(a).toEqual(b);
    });

    it("30. never mutates the input item", () => {
      const original = item({ rawName: "CDB Banco Teste" });
      const snapshotBefore = JSON.parse(JSON.stringify(original));

      detectPortfolioResolutionUxHint(original);

      expect(original).toEqual(snapshotBefore);
    });

    it("31. full branch coverage: every kind has a non-empty suggestion", () => {
      const cases: { rawName: string; expectedKind: "treasury" | "cdb" | "lci" | "lca" }[] = [
        { rawName: "Tesouro Selic", expectedKind: "treasury" },
        { rawName: "CDB Banco Teste", expectedKind: "cdb" },
        { rawName: "LCI Banco Teste", expectedKind: "lci" },
        { rawName: "LCA Banco Teste", expectedKind: "lca" },
      ];

      for (const { rawName, expectedKind } of cases) {
        const hint = detectPortfolioResolutionUxHint(item({ rawName }));
        expect(hint?.kind, rawName).toBe(expectedKind);
        expect(hint?.suggestion.length, rawName).toBeGreaterThan(0);
      }
    });
  });
});
