import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  CandidateAsset,
} from "../contracts";

import type {
  ProviderQuery,
} from "./evidence-provider";

describe(
  "instrumentCode contract",
  () => {
    it(
      "CandidateAsset hints support instrumentCode distinct from ticker",
      () => {
        const candidate: CandidateAsset = {
          id: "asset-1",

          rawName: "DEB PETROBRAS",

          source: {},

          hints: {
            assetType: "debenture",

            ticker: "PETR4",

            instrumentCode: "ABCD11",
          },
        };

        expect(
          candidate.hints.instrumentCode,
        ).toBe("ABCD11");

        expect(
          candidate.hints.ticker,
        ).toBe("PETR4");

        expect(
          candidate.hints.instrumentCode,
        ).not.toBe(
          candidate.hints.ticker,
        );
      },
    );

    it(
      "ProviderQuery supports instrumentCode distinct from ticker",
      () => {
        const query: ProviderQuery = {
          assetId: "asset-1",

          ticker: "PETR4",

          instrumentCode: "ABCD11",

          assetType: "debenture",
        };

        expect(
          query.instrumentCode,
        ).toBe("ABCD11");

        expect(
          query.instrumentCode,
        ).not.toBe(query.ticker);
      },
    );
  },
);
