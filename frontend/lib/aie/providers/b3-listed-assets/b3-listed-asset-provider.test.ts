import { describe, expect, it } from "vitest";

import { VerificationPolicy } from "../../policy";

import { B3ListedAssetProvider } from "./b3-listed-asset-provider";

const NOW = "2026-09-23T12:00:00.000Z";

function createProvider(): B3ListedAssetProvider {
  return new B3ListedAssetProvider(undefined, () => NOW);
}

describe("B3ListedAssetProvider", () => {
  it.each(["PETR4", "VALE3", "ITUB4"])(
    "finds the stock %s by exact ticker",
    async (ticker) => {
      const result = await createProvider().search({
        assetId: "asset-1",
        ticker,
      });

      expect(result.found).toBe(true);
      expect(result.evidence.map((item) => item.field).sort()).toEqual([
        "identity",
        "issuer",
      ]);
    },
  );

  it.each(["HGLG11", "KNRI11"])("finds the FII %s by exact ticker", async (ticker) => {
    const result = await createProvider().search({ assetId: "asset-1", ticker });

    expect(result.found).toBe(true);
  });

  // TASK-052: representative sample of the expanded catalog (35 tickers total).
  it.each([
    "ABEV3",
    "B3SA3",
    "BBAS3",
    "BBDC4",
    "BPAC11",
    "CMIG4",
    "ELET3",
    "EMBR3",
    "GGBR4",
    "LREN3",
    "RENT3",
    "WEGE3",
  ])("TASK-052: finds the stock %s by exact ticker", async (ticker) => {
    const result = await createProvider().search({ assetId: "asset-1", ticker });

    expect(result.found).toBe(true);
    expect(result.evidence.map((item) => item.field).sort()).toEqual(["identity", "issuer"]);
  });

  it.each(["BTLG11", "MXRF11", "XPML11", "VISC11", "KNCR11", "XPLG11"])(
    "TASK-052: finds the FII %s by exact ticker",
    async (ticker) => {
      const result = await createProvider().search({ assetId: "asset-1", ticker });

      expect(result.found).toBe(true);
    },
  );

  it.each(["SMAL11", "HASH11", "GOLD11", "DIVO11"])(
    "TASK-052: finds the ETF %s by exact ticker",
    async (ticker) => {
      const result = await createProvider().search({ assetId: "asset-1", ticker });

      expect(result.found).toBe(true);
    },
  );

  it.each(["MSFT34", "GOGL34", "AMZO34", "TSLA34", "NFLX34"])(
    "TASK-052: finds the BDR %s by exact ticker",
    async (ticker) => {
      const result = await createProvider().search({ assetId: "asset-1", ticker });

      expect(result.found).toBe(true);
    },
  );

  it.each(["BOVA11", "IVVB11"])("finds the ETF %s by exact ticker", async (ticker) => {
    const result = await createProvider().search({ assetId: "asset-1", ticker });

    expect(result.found).toBe(true);
  });

  it("finds the BDR AAPL34 by exact ticker", async () => {
    const result = await createProvider().search({ assetId: "asset-1", ticker: "AAPL34" });

    expect(result.found).toBe(true);
  });

  // TASK-064A: second catalog expansion wave (61 tickers total). Representative
  // sample per category -- HGLG11/IVVB11/AAPL34 were requested again but were
  // already catalogued, so they are not duplicated (covered by the tests above).
  it.each([
    "ALOS3",
    "ARZZ3",
    "ASAI3",
    "CSAN3",
    "CYRE3",
    "EGIE3",
    "EZTC3",
    "FLRY3",
    "HAPV3",
    "KLBN11",
    "MRFG3",
    "POMO4",
    "SLCE3",
    "TAEE11",
    "TIMS3",
    "UGPA3",
  ])("TASK-064A: finds the stock %s by exact ticker", async (ticker) => {
    const result = await createProvider().search({ assetId: "asset-1", ticker });

    expect(result.found).toBe(true);
    expect(result.evidence.map((item) => item.field).sort()).toEqual(["identity", "issuer"]);
  });

  it.each(["RBRR11", "BRCO11", "VGIR11", "TRXF11", "PVBI11"])(
    "TASK-064A: finds the FII %s by exact ticker",
    async (ticker) => {
      const result = await createProvider().search({ assetId: "asset-1", ticker });

      expect(result.found).toBe(true);
    },
  );

  it.each(["BOVV11", "XFIX11"])("TASK-064A: finds the ETF %s by exact ticker", async (ticker) => {
    const result = await createProvider().search({ assetId: "asset-1", ticker });

    expect(result.found).toBe(true);
  });

  it.each(["META34", "NVDC34", "MELI34"])(
    "TASK-064A: finds the BDR %s by exact ticker",
    async (ticker) => {
      const result = await createProvider().search({ assetId: "asset-1", ticker });

      expect(result.found).toBe(true);
    },
  );

  it.each(["PETR5", "HGLG12", "META35"])(
    "TASK-064A: does not match the uncatalogued ticker '%s' (no false positive)",
    async (ticker) => {
      const result = await createProvider().search({ assetId: "asset-1", ticker });

      expect(result.found).toBe(false);
      expect(result.evidence).toEqual([]);
    },
  );

  it("normalizes lowercase and surrounding whitespace before matching", async () => {
    const provider = createProvider();

    const lower = await provider.search({ assetId: "asset-1", ticker: "petr4" });
    const spaced = await provider.search({ assetId: "asset-2", ticker: "  PETR4  " });

    expect(lower.found).toBe(true);
    expect(spaced.found).toBe(true);
  });

  it("does not match a partial/prefix ticker (PETR never matches PETR4)", async () => {
    const result = await createProvider().search({ assetId: "asset-1", ticker: "PETR" });

    expect(result.found).toBe(false);
    expect(result.evidence).toEqual([]);
  });

  it("does not match a generic name without a known ticker", async () => {
    const provider = createProvider();

    expect(provider.supports({ assetId: "asset-1", rawName: "Banco Teste" })).toBe(false);

    const result = await provider.search({ assetId: "asset-1", rawName: "Banco Teste" });

    expect(result.searched).toBe(false);
    expect(result.found).toBe(false);
  });

  it("does not match an unlisted ticker", async () => {
    const result = await createProvider().search({ assetId: "asset-1", ticker: "XPTO99" });

    expect(result.searched).toBe(true);
    expect(result.found).toBe(false);
    expect(result.evidence).toEqual([]);
  });

  it("emits identity evidence at primary strength from source B3", async () => {
    const result = await createProvider().search({ assetId: "asset-1", ticker: "PETR4" });

    const identity = result.evidence.find((item) => item.field === "identity");

    expect(identity).toMatchObject({
      assetId: "asset-1",
      source: "B3",
      strength: "primary",
      field: "identity",
      value: "b3:PETR4",
      collectedAt: NOW,
      providerVersion: "1.0.0",
    });
  });

  it("emits issuer evidence at primary strength from source B3", async () => {
    const result = await createProvider().search({ assetId: "asset-1", ticker: "PETR4" });

    const issuer = result.evidence.find((item) => item.field === "issuer");

    expect(issuer).toMatchObject({
      assetId: "asset-1",
      source: "B3",
      strength: "primary",
      field: "issuer",
      value: "company.petrobras",
      collectedAt: NOW,
      providerVersion: "1.0.0",
    });
  });

  it("its evidence alone satisfies VerificationPolicy (verified) for a covered ticker", async () => {
    const result = await createProvider().search({ assetId: "asset-1", ticker: "PETR4" });

    const decision = new VerificationPolicy().evaluate(result.evidence);

    expect(decision.status).toBe("verified");
    expect(decision.unresolvedFields).toEqual([]);
  });

  it("supports() is false without a ticker, even for a covered asset's rawName", () => {
    const provider = createProvider();

    expect(provider.supports({ assetId: "asset-1" })).toBe(false);
    expect(provider.supports({ assetId: "asset-1", ticker: "   " })).toBe(false);
  });
});
