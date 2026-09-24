import { describe, expect, it } from "vitest";

import type { CandidateAsset } from "../contracts";
import { createAie } from "../application/create-aie";
import { B3ListedAssetProvider } from "../providers/b3-listed-assets/b3-listed-asset-provider";
import { TesouroDiretoProvider } from "../providers/tesouro-direto/tesouro-direto-provider";

/**
 * TASK-058B integration coverage: the REAL AssetResolutionEngine, real
 * ResolutionPlanner and real VerificationPolicy -- unmodified -- now reach
 * "verified" for the narrow, explicit Tesouro Direto catalog once
 * TesouroDiretoProvider is registered, exactly like production wiring
 * (lib/aie/application/create-aie-from-env.ts).
 */

const NOW = "2026-09-23T12:00:00.000Z";

function candidate(overrides: Partial<CandidateAsset> & { id: string; rawName: string }): CandidateAsset {
  return {
    source: {},
    hints: {},
    ...overrides,
  };
}

describe("AssetResolutionEngine + TesouroDiretoProvider (TASK-058B)", () => {
  const engine = createAie({ providers: [new B3ListedAssetProvider(), new TesouroDiretoProvider()] });

  // 1-3: resolves from rawName alone, no ticker, no explicit assetType (the
  // inference step -- withInferredAssetType -- fills "treasury" from the
  // catalog before the plan/pipeline ever run).
  it.each([
    "Tesouro Selic 2029",
    "Tesouro IPCA+ 2035",
    "Tesouro Prefixado 2031",
  ])("resolves '%s' as verified from rawName alone, via catalog inference", async (rawName) => {
    const result = await engine.resolve({
      candidateAsset: candidate({
        id: `asset-${rawName}`,
        rawName,
        hints: { currency: "BRL", amount: 8000 },
      }),
      now: NOW,
    });

    expect(result.status).toBe("verified");
    expect(result.nextAction).toBe("finish");
    expect(result.verifiedAsset?.assetType).toBe("treasury");
    expect(result.verifiedAsset?.issuerEntityId).toBe("issuer.tesouro-nacional");
  });

  it("resolves an explicit assetType = 'treasury' the same way", async () => {
    const result = await engine.resolve({
      candidateAsset: candidate({
        id: "asset-explicit-treasury",
        rawName: "Tesouro Selic 2031",
        hints: { assetType: "treasury", currency: "BRL", amount: 8000 },
      }),
      now: NOW,
    });

    expect(result.status).toBe("verified");
    expect(result.verifiedAsset?.assetType).toBe("treasury");
  });

  // 4-5: no maturity year, stays pending.
  it.each(["Tesouro Selic", "Tesouro IPCA+"])(
    "'%s' (no maturity year) continues pending",
    async (rawName) => {
      const result = await engine.resolve({
        candidateAsset: candidate({
          id: `asset-sem-vencimento-${rawName}`,
          rawName,
          hints: { issuerName: "Tesouro Nacional", currency: "BRL", amount: 8000 },
        }),
        now: NOW,
      });

      expect(result.status).toBe("needs-more-evidence");
      expect(result.verifiedAsset).toBeNull();
    },
  );

  // 6-7: excluded-term negatives stay pending.
  it.each(["Fundo Tesouro Selic", "CDB Tesouro Selic"])(
    "'%s' (excluded term) continues pending, never a false positive",
    async (rawName) => {
      const result = await engine.resolve({
        candidateAsset: candidate({
          id: `asset-negativo-${rawName}`,
          rawName,
          hints: { currency: "BRL", amount: 5000 },
        }),
        now: NOW,
      });

      expect(result.status).toBe("needs-more-evidence");
      expect(result.verifiedAsset).toBeNull();
    },
  );

  // 8: explicit conflicting assetType is never silently overridden.
  it("an explicit assetType that conflicts with 'treasury' is never overridden and never verifies", async () => {
    const result = await engine.resolve({
      candidateAsset: candidate({
        id: "asset-conflito-tesouro",
        rawName: "Tesouro Selic 2029",
        hints: { assetType: "stock", currency: "BRL", amount: 8000 },
      }),
      now: NOW,
    });

    expect(result.status).toBe("needs-more-evidence");
    expect(result.verifiedAsset).toBeNull();
    expect(result.investigation.candidateAsset.hints.assetType).toBe("stock");
  });

  // 9: B3-catalogued assets keep resolving with TesouroDiretoProvider also registered.
  it.each([
    ["PETR4", "stock"],
    ["HGLG11", "fii"],
    ["BOVA11", "etf"],
    ["AAPL34", "international"],
  ] as const)("B3-catalogued asset %s keeps resolving as verified (no regression)", async (ticker, expectedAssetType) => {
    const result = await engine.resolve({
      candidateAsset: candidate({
        id: `asset-b3-${ticker}`,
        rawName: ticker,
        hints: { ticker, currency: "BRL", amount: 1000 },
      }),
      now: NOW,
    });

    expect(result.status).toBe("verified");
    expect(result.verifiedAsset?.assetType).toBe(expectedAssetType);
  });

  // 10: CDB/LCI/LCA generic fixed income unchanged.
  it.each([
    ["CDB Banco Teste", "cdb"],
    ["LCI Banco Teste", "lci"],
    ["LCA Banco Teste", "lca"],
  ] as const)("generic fixed income (%s) still does not resolve as verified (no regression)", async (rawName, assetType) => {
    const result = await engine.resolve({
      candidateAsset: candidate({
        id: `asset-${assetType}`,
        rawName,
        hints: { assetType, issuerName: "Banco Teste", currency: "BRL", amount: 1000 },
      }),
      now: NOW,
    });

    expect(result.status).toBe("needs-more-evidence");
    expect(result.verifiedAsset).toBeNull();
  });

  // 11: VerificationPolicy stays intact -- Tesouro's evidence alone reaches
  // "verified" through the SAME unmodified rule B3 already relies on
  // (non-REGISTRY primary evidence for both identity and issuer).
  it("VerificationPolicy is not modified: Tesouro reaches 'verified' through the same non-REGISTRY-primary rule as B3", async () => {
    const tesouroResult = await engine.resolve({
      candidateAsset: candidate({
        id: "asset-policy-tesouro",
        rawName: "Tesouro Selic 2029",
        hints: { currency: "BRL", amount: 8000 },
      }),
      now: NOW,
    });
    const b3Result = await engine.resolve({
      candidateAsset: candidate({
        id: "asset-policy-b3",
        rawName: "PETR4",
        hints: { ticker: "PETR4", currency: "BRL", amount: 1000 },
      }),
      now: NOW,
    });

    expect(tesouroResult.status).toBe("verified");
    expect(b3Result.status).toBe("verified");
    expect(tesouroResult.verifiedAsset?.verification.policyVersion).toBe(
      b3Result.verifiedAsset?.verification.policyVersion,
    );
  });

  it("supports the whitelisted alias 'Tesouro Selic 2029 (LFT)' end to end", async () => {
    const result = await engine.resolve({
      candidateAsset: candidate({
        id: "asset-lft-alias",
        rawName: "Tesouro Selic 2029 (LFT)",
        hints: { currency: "BRL", amount: 8000 },
      }),
      now: NOW,
    });

    expect(result.status).toBe("verified");
    expect(result.verifiedAsset?.canonicalAssetId).toBe("tesouro:selic:2029");
  });

  it("never infers 'treasury' for an uncatalogued maturity year", async () => {
    const result = await engine.resolve({
      candidateAsset: candidate({
        id: "asset-ano-nao-catalogado",
        rawName: "Tesouro Selic 2033",
        hints: { currency: "BRL", amount: 8000 },
      }),
      now: NOW,
    });

    expect(result.status).toBe("needs-more-evidence");
    expect(result.verifiedAsset).toBeNull();
    expect(result.investigation.candidateAsset.hints.assetType).toBeUndefined();
  });
});
