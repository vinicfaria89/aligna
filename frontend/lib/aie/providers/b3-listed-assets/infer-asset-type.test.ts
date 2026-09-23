import { describe, expect, it } from "vitest";

import { findListedB3CatalogEntry, inferListedB3AssetTypeFromTicker } from "./infer-asset-type";

describe("inferListedB3AssetTypeFromTicker", () => {
  it.each([
    ["PETR4", "stock"],
    ["VALE3", "stock"],
    ["ITUB4", "stock"],
    ["HGLG11", "fii"],
    ["KNRI11", "fii"],
    ["BOVA11", "etf"],
    ["IVVB11", "etf"],
    ["AAPL34", "international"],
  ] as const)("infers %s as %s", (ticker, expected) => {
    expect(inferListedB3AssetTypeFromTicker(ticker)).toBe(expected);
  });

  // TASK-052: representative sample of the expanded catalog.
  it.each([
    ["WEGE3", "stock"],
    ["BBAS3", "stock"],
    ["MXRF11", "fii"],
    ["XPML11", "fii"],
    ["SMAL11", "etf"],
    ["HASH11", "etf"],
    ["MSFT34", "international"],
  ] as const)("TASK-052: infers %s as %s from rawName/ticker alone", (ticker, expected) => {
    expect(inferListedB3AssetTypeFromTicker(ticker)).toBe(expected);
  });

  it("normalizes lowercase before matching", () => {
    expect(inferListedB3AssetTypeFromTicker("petr4")).toBe("stock");
  });

  it("normalizes surrounding whitespace before matching", () => {
    expect(inferListedB3AssetTypeFromTicker("  PETR4  ")).toBe("stock");
  });

  it("does not match an internal space (no whitespace collapsing beyond ingestion's own)", () => {
    expect(inferListedB3AssetTypeFromTicker("PETR 4")).toBeUndefined();
  });

  it.each(["ZZZZ99", "XPTO4", "ABCD11", "PETR", "PETR44"])(
    "does not infer an uncatalogued ticker (%s), even though it looks like a B3 ticker",
    (ticker) => {
      expect(inferListedB3AssetTypeFromTicker(ticker)).toBeUndefined();
    },
  );

  it("returns undefined for undefined/blank input", () => {
    expect(inferListedB3AssetTypeFromTicker(undefined)).toBeUndefined();
    expect(inferListedB3AssetTypeFromTicker("   ")).toBeUndefined();
    expect(inferListedB3AssetTypeFromTicker("")).toBeUndefined();
  });
});

describe("findListedB3CatalogEntry", () => {
  it("matches by hints.ticker when present", () => {
    const entry = findListedB3CatalogEntry({ rawName: "Qualquer coisa", hints: { ticker: "PETR4" } });

    expect(entry?.ticker).toBe("PETR4");
    expect(entry?.assetType).toBe("stock");
  });

  it("falls back to rawName when hints.ticker is absent (basic CSV, no ticker column)", () => {
    const entry = findListedB3CatalogEntry({ rawName: "PETR4", hints: {} });

    expect(entry?.ticker).toBe("PETR4");
    expect(entry?.assetType).toBe("stock");
  });

  it("prefers an explicit ticker over rawName when both are present and differ", () => {
    const entry = findListedB3CatalogEntry({ rawName: "algo qualquer", hints: { ticker: "HGLG11" } });

    expect(entry?.ticker).toBe("HGLG11");
  });

  it("does not match rawName as a substring ('MEUPETR4FUNDO' never matches 'PETR4')", () => {
    expect(findListedB3CatalogEntry({ rawName: "MEUPETR4FUNDO", hints: {} })).toBeUndefined();
  });

  it("does not match a generic rawName with no ticker information", () => {
    expect(
      findListedB3CatalogEntry({ rawName: "Investimento em Renda Fixa", hints: {} }),
    ).toBeUndefined();
    expect(findListedB3CatalogEntry({ rawName: "CDB Banco Teste", hints: {} })).toBeUndefined();
    expect(findListedB3CatalogEntry({ rawName: "Tesouro Selic", hints: {} })).toBeUndefined();
  });
});
