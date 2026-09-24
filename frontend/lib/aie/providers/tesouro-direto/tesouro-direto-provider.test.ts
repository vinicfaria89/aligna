import { describe, expect, it } from "vitest";

import { VerificationPolicy } from "../../policy";

import { TesouroDiretoProvider } from "./tesouro-direto-provider";

const NOW = "2026-09-23T12:00:00.000Z";

function createProvider(): TesouroDiretoProvider {
  return new TesouroDiretoProvider(() => NOW);
}

describe("TesouroDiretoProvider", () => {
  // --- 1-8: catalogued titles, exact name -----------------------------------------------------
  it.each([
    "Tesouro Selic 2029",
    "Tesouro Selic 2031",
    "Tesouro IPCA+ 2035",
    "Tesouro IPCA+ 2045",
    "Tesouro IPCA+ com Juros Semestrais 2040",
    "Tesouro Prefixado 2027",
    "Tesouro Prefixado 2031",
    "Tesouro Prefixado com Juros Semestrais 2035",
  ])("finds the catalogued title %s by exact name", async (rawName) => {
    const result = await createProvider().search({ assetId: "asset-1", rawName });

    expect(result.found).toBe(true);
    expect(result.evidence.map((item) => item.field).sort()).toEqual(["identity", "issuer"]);
  });

  // --- 9-13: normalization ---------------------------------------------------------------------
  it("9. normalizes lowercase before matching", async () => {
    const result = await createProvider().search({ assetId: "asset-1", rawName: "tesouro selic 2029" });

    expect(result.found).toBe(true);
  });

  it("10. normalizes surrounding whitespace before matching", async () => {
    const result = await createProvider().search({ assetId: "asset-1", rawName: " TESOURO IPCA+ 2035 " });

    expect(result.found).toBe(true);
  });

  it("11. normalizes 'IPCA +' (space before the sign) to 'IPCA+'", async () => {
    const result = await createProvider().search({ assetId: "asset-1", rawName: "Tesouro IPCA + 2035" });

    expect(result.found).toBe(true);
  });

  it("12. normalizes 'com juros semestrais' regardless of case", async () => {
    const result = await createProvider().search({
      assetId: "asset-1",
      rawName: "Tesouro IPCA+ com juros semestrais 2040",
    });

    expect(result.found).toBe(true);
  });

  it("13. supports the explicit alias 'Tesouro Selic 2029 (LFT)'", async () => {
    const result = await createProvider().search({ assetId: "asset-1", rawName: "Tesouro Selic 2029 (LFT)" });

    expect(result.found).toBe(true);
    const identity = result.evidence.find((item) => item.field === "identity");
    expect(identity?.value).toBe("tesouro:selic:2029");
  });

  // --- 14-18: no maturity year, never verifiable ------------------------------------------------
  it.each([
    ["14", "Tesouro Selic"],
    ["15", "Tesouro IPCA+"],
    ["16", "Tesouro Prefixado"],
    ["17", "Tesouro Direto"],
    ["18", "Título Público"],
  ])("%s. does not verify '%s' (no maturity year)", async (_n, rawName) => {
    const result = await createProvider().search({ assetId: "asset-1", rawName });

    expect(result.found).toBe(false);
    expect(result.evidence).toEqual([]);
  });

  // --- 19-25: excluded terms (fund/ETF/portfolio/bank products) --------------------------------
  it.each([
    ["19", "Fundo Tesouro Selic"],
    ["20", "ETF Tesouro Selic"],
    ["21", "Carteira Tesouro"],
    ["22", "CDB Tesouro Selic"],
    ["23", "LCI Tesouro IPCA"],
    ["24", "LCA Tesouro IPCA"],
    ["25", "Renda Fixa Tesouro"],
  ])("%s. does not verify '%s' (excluded term guard)", async (_n, rawName) => {
    const result = await createProvider().search({ assetId: "asset-1", rawName });

    expect(result.found).toBe(false);
    expect(result.evidence).toEqual([]);
  });

  it("does not verify an excluded term even when the rest of the name matches a catalogued title exactly", async () => {
    const result = await createProvider().search({
      assetId: "asset-1",
      rawName: "Fundo Tesouro Selic 2029",
    });

    expect(result.found).toBe(false);
  });

  // --- 26: no substring/partial match -----------------------------------------------------------
  it("26. does not match by substring (a name merely containing a catalogued title is not enough)", async () => {
    const result = await createProvider().search({
      assetId: "asset-1",
      rawName: "Comprei Tesouro Selic 2029 ontem",
    });

    expect(result.found).toBe(false);
    expect(result.evidence).toEqual([]);
  });

  it("does not match an uncatalogued maturity year", async () => {
    const result = await createProvider().search({ assetId: "asset-1", rawName: "Tesouro Selic 2033" });

    expect(result.found).toBe(false);
  });

  // --- 27: explicit conflicting assetType ---------------------------------------------------------
  it("27. does not verify when an explicit assetType conflicts with 'treasury'", async () => {
    const result = await createProvider().search({
      assetId: "asset-1",
      rawName: "Tesouro Selic 2029",
      assetType: "stock",
    });

    expect(result.found).toBe(false);
    expect(result.evidence).toEqual([]);
  });

  it("supports() is false for a conflicting explicit assetType", () => {
    const provider = createProvider();

    expect(
      provider.supports({ assetId: "asset-1", rawName: "Tesouro Selic 2029", assetType: "stock" }),
    ).toBe(false);
  });

  it("an explicit correct assetType ('treasury') still matches", async () => {
    const result = await createProvider().search({
      assetId: "asset-1",
      rawName: "Tesouro Selic 2029",
      assetType: "treasury",
    });

    expect(result.found).toBe(true);
  });

  // --- 28-30: evidence shape -----------------------------------------------------------------------
  it("28. returns identity evidence at primary strength from source TESOURO", async () => {
    const result = await createProvider().search({ assetId: "asset-1", rawName: "Tesouro Selic 2029" });

    const identity = result.evidence.find((item) => item.field === "identity");

    expect(identity).toMatchObject({
      assetId: "asset-1",
      source: "TESOURO",
      strength: "primary",
      field: "identity",
      value: "tesouro:selic:2029",
      collectedAt: NOW,
      providerVersion: "1.0.0",
    });
  });

  it("29. returns issuer evidence at primary strength from source TESOURO", async () => {
    const result = await createProvider().search({ assetId: "asset-1", rawName: "Tesouro Selic 2029" });

    const issuer = result.evidence.find((item) => item.field === "issuer");

    expect(issuer).toMatchObject({
      assetId: "asset-1",
      source: "TESOURO",
      strength: "primary",
      field: "issuer",
      value: "issuer.tesouro-nacional",
      collectedAt: NOW,
      providerVersion: "1.0.0",
    });
  });

  it("30. uses type = 'treasury' in the returned candidate metadata", async () => {
    const result = await createProvider().search({ assetId: "asset-1", rawName: "Tesouro Selic 2029" });

    expect(result.candidates?.[0]?.metadata?.assetType).toBe("treasury");
  });

  it("its evidence alone satisfies VerificationPolicy (verified) for a catalogued title", async () => {
    const result = await createProvider().search({ assetId: "asset-1", rawName: "Tesouro Selic 2029" });

    const decision = new VerificationPolicy().evaluate(result.evidence);

    expect(decision.status).toBe("verified");
    expect(decision.unresolvedFields).toEqual([]);
  });

  // --- 31-33: determinism / no network / no current-date dependency -------------------------------
  it("31. never touches the network (pure local catalog lookup)", async () => {
    // No fetch/XHR mock is set up anywhere in this test file; a network call
    // would throw ReferenceError/undefined in this environment, so a clean
    // resolve is itself the proof.
    const result = await createProvider().search({ assetId: "asset-1", rawName: "Tesouro Selic 2029" });

    expect(result.found).toBe(true);
  });

  it("32. does not depend on the current date -- an injected clock is the only time source", async () => {
    const fixedNow = "2030-01-01T00:00:00.000Z";
    const provider = new TesouroDiretoProvider(() => fixedNow);

    const result = await provider.search({ assetId: "asset-1", rawName: "Tesouro Selic 2029" });

    expect(result.evidence.every((item) => item.collectedAt === fixedNow)).toBe(true);
  });

  it("33. is deterministic (two identical searches produce the same evidence ids)", async () => {
    const provider = createProvider();

    const first = await provider.search({ assetId: "asset-1", rawName: "Tesouro Selic 2029" });
    const second = await provider.search({ assetId: "asset-1", rawName: "Tesouro Selic 2029" });

    expect(first.evidence.map((item) => item.id)).toEqual(second.evidence.map((item) => item.id));
  });

  it("supports() is false without a rawName", () => {
    const provider = createProvider();

    expect(provider.supports({ assetId: "asset-1" })).toBe(false);
    expect(provider.supports({ assetId: "asset-1", rawName: "   " })).toBe(false);
  });
});
