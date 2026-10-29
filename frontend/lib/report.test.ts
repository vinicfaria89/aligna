import { describe, expect, it } from "vitest";

import { buildReport, computeScore } from "./report";
import type { ExtractedAsset } from "./types";

function asset(overrides: Partial<ExtractedAsset> = {}): ExtractedAsset {
  return {
    id: "asset-1",
    name: "Investimento",
    category: "cdb",
    value: 100,
    institution: "",
    liquidity: "diaria",
    indexer: "CDI",
    confidence: "ok",
    ...overrides,
  };
}

describe("buildReport institution concentration", () => {
  it("does not combine assets with missing institutions into a fictitious institution", () => {
    const report = buildReport(
      [asset({ value: 200 }), asset({ id: "asset-2", value: 200 })],
      "moderado",
    );

    expect(report.topConcentration).toBeNull();
    expect(report.alerts.some((alert) => alert.title.includes("instituição"))).toBe(false);
  });

  it("describes the recorded institution without claiming it is the issuer", () => {
    const assets = [
      asset({ institution: "Banco A", value: 200 }),
      asset({ id: "asset-2", institution: "", value: 200 }),
    ];
    const report = buildReport(assets, "moderado");
    const alert = report.alerts.find((item) => item.title.includes("instituição"));
    const score = computeScore(assets, "moderado", report, 0, 0);

    expect(report.topConcentration).toEqual({ label: "Banco A", pct: 50 });
    expect(alert?.body).toContain("não confirma o emissor");
    expect(score.criteria.find((item) => item.label === "Concentração")?.detail)
      .toContain("não confirma o emissor");
  });
});
