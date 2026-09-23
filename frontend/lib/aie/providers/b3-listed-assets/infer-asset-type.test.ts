import { describe, expect, it } from "vitest";

import { inferListedB3AssetTypeFromTicker } from "./infer-asset-type";

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
