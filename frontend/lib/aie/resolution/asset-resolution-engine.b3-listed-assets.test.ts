import { describe, expect, it } from "vitest";

import type { CandidateAsset } from "../contracts";
import { createAie } from "../application/create-aie";
import { B3ListedAssetProvider } from "../providers/b3-listed-assets/b3-listed-asset-provider";
import { RegistryProvider } from "../providers/registry-provider";
import { EvidenceProviderRegistry } from "../providers/provider-registry";
import { EntityRegistryLoader } from "../registry";
import { AnbimaDebentureProvider } from "../providers/anbima-debenture-provider";
import {
  createAnbimaDebentureRecord,
  FakeAnbimaDebentureFeedClient,
} from "../infrastructure/anbima/fake-anbima-debenture-feed-client";

import { AssetResolutionEngine } from "./asset-resolution-engine";
import { ProviderExecutionPipeline } from "../execution/provider-execution-pipeline";
import { EvidenceOrchestrator } from "../orchestrator/evidence-orchestrator";
import { ResolutionPlanner } from "../planner/resolution-planner";
import { VerificationPolicy } from "../policy";

/**
 * TASK-051B integration coverage: the REAL AssetResolutionEngine, real
 * ResolutionPlanner and real VerificationPolicy -- unmodified -- now reach
 * "verified" for the covered B3-listed universe once B3ListedAssetProvider
 * is registered, exactly like production wiring after this task
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

describe("AssetResolutionEngine + B3ListedAssetProvider (TASK-051B)", () => {
  const engine = createAie({ providers: [new B3ListedAssetProvider()] });

  it.each([
    ["PETR4", "stock"],
    ["VALE3", "stock"],
    ["ITUB4", "stock"],
    ["HGLG11", "fii"],
    ["KNRI11", "fii"],
    ["BOVA11", "etf"],
    ["IVVB11", "etf"],
    ["AAPL34", "international"],
  ] as const)("resolves %s as verified", async (ticker, assetType) => {
    const result = await engine.resolve({
      candidateAsset: candidate({
        id: `asset-${ticker}`,
        rawName: ticker,
        hints: { assetType, ticker, currency: "BRL", amount: 1000 },
      }),
      now: NOW,
    });

    expect(result.status).toBe("verified");
    expect(result.nextAction).toBe("finish");
    expect(result.verifiedAsset).not.toBeNull();
    expect(result.verifiedAsset?.issuerEntityId).toBeDefined();
  });

  it("does not resolve an unlisted ticker as verified (no false positive)", async () => {
    const result = await engine.resolve({
      candidateAsset: candidate({
        id: "asset-unknown",
        rawName: "XPTO99",
        hints: { assetType: "stock", ticker: "XPTO99", currency: "BRL", amount: 1000 },
      }),
      now: NOW,
    });

    expect(result.status).toBe("needs-more-evidence");
    expect(result.verifiedAsset).toBeNull();
  });

  it.each([
    ["CDB Banco Teste", "cdb"],
    ["LCI Banco Teste", "lci"],
    ["LCA Banco Teste", "lca"],
  ] as const)("does not resolve generic fixed income (%s) as verified", async (rawName, assetType) => {
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

  it("does not resolve Tesouro Selic as verified (out of scope for TASK-051B)", async () => {
    const result = await engine.resolve({
      candidateAsset: candidate({
        id: "asset-tesouro",
        rawName: "Tesouro Selic",
        hints: { issuerName: "Tesouro Nacional", currency: "BRL", amount: 1000 },
      }),
      now: NOW,
    });

    expect(result.status).toBe("needs-more-evidence");
    expect(result.verifiedAsset).toBeNull();
  });

  it("does not resolve a generic name without a ticker as verified", async () => {
    const result = await engine.resolve({
      candidateAsset: candidate({
        id: "asset-generic",
        rawName: "Investimento em Renda Fixa",
        hints: { currency: "BRL", amount: 1000 },
      }),
      now: NOW,
    });

    expect(result.status).toBe("needs-more-evidence");
    expect(result.verifiedAsset).toBeNull();
  });

  it("a RegistryProvider match alone still never verifies (VerificationPolicy unchanged)", async () => {
    const registry = new EntityRegistryLoader().load([
      {
        id: "company.registry-only",
        kind: "company",
        legalName: "Registry Only Co",
        aliases: ["REGONLY1"],
        identifiers: [{ kind: "ticker", value: "REGONLY1" }],
      },
    ]);

    const registryProviders = new EvidenceProviderRegistry();
    registryProviders.register(new RegistryProvider(registry));

    const registryOnlyEngine = new AssetResolutionEngine(
      new VerificationPolicy(),
      new ResolutionPlanner(),
      new ProviderExecutionPipeline(registryProviders),
      new EvidenceOrchestrator(new VerificationPolicy()),
    );

    const result = await registryOnlyEngine.resolve({
      candidateAsset: candidate({
        id: "asset-registry-only",
        rawName: "REGONLY1",
        hints: { assetType: "stock", ticker: "REGONLY1", currency: "BRL", amount: 1000 },
      }),
      now: NOW,
    });

    expect(result.status).toBe("needs-more-evidence");
    expect(result.verifiedAsset).toBeNull();
  });

  it("ANBIMA/debentures keep working unaffected by the new provider", async () => {
    const providers = new EvidenceProviderRegistry();
    const anbimaClient = new FakeAnbimaDebentureFeedClient([createAnbimaDebentureRecord()]);
    providers.register(new AnbimaDebentureProvider(anbimaClient, () => NOW));
    providers.register(new B3ListedAssetProvider());

    const debentureEngine = new AssetResolutionEngine(
      new VerificationPolicy(),
      new ResolutionPlanner(),
      new ProviderExecutionPipeline(providers),
      new EvidenceOrchestrator(new VerificationPolicy()),
    );

    const result = await debentureEngine.resolve({
      candidateAsset: candidate({
        id: "asset-debenture",
        rawName: "DEB PETROBRAS",
        hints: { assetType: "debenture", instrumentCode: "ABCD11", currency: "BRL", amount: 1000 },
      }),
      now: NOW,
    });

    // Same behaviour as before TASK-051B (see anbima-debenture-provider.test.ts
    // "does not verify issuer identity by itself"): ANBIMA alone only backs
    // `identity` at primary strength, `issuer` stays supporting.
    expect(result.status).toBe("needs-more-evidence");
    expect(result.investigation.unresolvedFields).toEqual(["issuer"]);
  });
});
