import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  ProviderQuery,
} from "./evidence-provider";

import {
  EntityRegistryLoader,
} from "../registry";

import {
  RegistryProvider,
} from "./registry-provider";

function createProvider(): RegistryProvider {
  const registry =
    new EntityRegistryLoader()
      .load([
        {
          id: "instrument.by-code",
          kind: "instrument",
          legalName: "By Code",
          aliases: [],
          identifiers: [
            {
              kind: "instrumentCode",
              value: "ABCD11",
            },
          ],
        },
        {
          id: "instrument.by-isin",
          kind: "instrument",
          legalName: "By ISIN",
          aliases: [],
          identifiers: [
            {
              kind: "isin",
              value: "BRISIN000001",
            },
          ],
        },
        {
          id: "company.by-cnpj",
          kind: "company",
          legalName: "By CNPJ",
          aliases: [],
          identifiers: [
            {
              kind: "cnpj",
              value: "00.000.000/0001-91",
            },
          ],
        },
        {
          id: "company.by-ticker",
          kind: "company",
          legalName: "By Ticker",
          aliases: [],
          identifiers: [
            {
              kind: "ticker",
              value: "TICK4",
            },
          ],
        },
        {
          id: "company.by-alias",
          kind: "company",
          legalName: "By Alias",
          aliases: [
            "ONLY ALIAS",
          ],
          identifiers: [],
        },
      ]);

  return new RegistryProvider(
    registry,
  );
}

describe(
  "RegistryProvider instrumentCode lookup",
  () => {
    it(
      "supports a query that has only an instrumentCode",
      () => {
        const provider =
          createProvider();

        expect(
          provider.supports({
            assetId: "asset-1",

            instrumentCode: "ABCD11",
          }),
        ).toBe(true);

        expect(
          provider.supports({
            assetId: "asset-1",
          }),
        ).toBe(false);
      },
    );

    it(
      "resolves an exact instrumentCode as supporting evidence",
      async () => {
        const result =
          await createProvider()
            .search({
              assetId: "asset-1",

              instrumentCode:
                " abcd11 ",
            });

        expect(
          result.found,
        ).toBe(true);

        expect(
          result.evidence,
        ).toHaveLength(1);

        expect(
          result.evidence[0],
        ).toMatchObject({
          source: "REGISTRY",

          strength: "supporting",

          field: "identity",

          value: "instrument.by-code",
        });
      },
    );

    it(
      "applies the deterministic priority instrumentCode > isin > cnpj > ticker > alias",
      async () => {
        const provider =
          createProvider();

        const full: ProviderQuery = {
          assetId: "asset-1",

          instrumentCode: "ABCD11",

          isin: "BRISIN000001",

          cnpj: "00000000000191",

          ticker: "TICK4",

          rawName: "ONLY ALIAS",
        };

        const steps: Array<
          [string, ProviderQuery]
        > = [
          [
            "instrument.by-code",
            full,
          ],
          [
            "instrument.by-isin",
            {
              ...full,
              instrumentCode:
                undefined,
            },
          ],
          [
            "company.by-cnpj",
            {
              ...full,
              instrumentCode:
                undefined,
              isin: undefined,
            },
          ],
          [
            "company.by-ticker",
            {
              ...full,
              instrumentCode:
                undefined,
              isin: undefined,
              cnpj: undefined,
            },
          ],
          [
            "company.by-alias",
            {
              ...full,
              instrumentCode:
                undefined,
              isin: undefined,
              cnpj: undefined,
              ticker: undefined,
            },
          ],
        ];

        for (const [
          expectedId,
          query,
        ] of steps) {
          const result =
            await provider.search(
              query,
            );

          expect(
            result.evidence[0]
              ?.value,
          ).toBe(expectedId);
        }
      },
    );

    it(
      "falls back to the next identifier when the instrumentCode is unknown",
      async () => {
        const result =
          await createProvider()
            .search({
              assetId: "asset-1",

              instrumentCode:
                "UNKNOWN",

              isin: "BRISIN000001",
            });

        expect(
          result.evidence[0]
            ?.value,
        ).toBe(
          "instrument.by-isin",
        );
      },
    );

    it(
      "does not fuzzy match instrumentCode",
      async () => {
        const provider =
          createProvider();

        for (const code of [
          "ABCD1",
          "ABCD111",
          "ABC",
        ]) {
          const result =
            await provider.search({
              assetId: "asset-1",

              instrumentCode: code,
            });

          expect(
            result.found,
          ).toBe(false);

          expect(
            result.evidence,
          ).toEqual([]);
        }
      },
    );

    it(
      "does not mix ticker and instrumentCode identifier namespaces",
      async () => {
        const provider =
          createProvider();

        const asTicker =
          await provider.search({
            assetId: "asset-1",

            ticker: "ABCD11",
          });

        const asCode =
          await provider.search({
            assetId: "asset-1",

            instrumentCode:
              "TICK4",
          });

        expect(
          asTicker.found,
        ).toBe(false);

        expect(
          asCode.found,
        ).toBe(false);
      },
    );
  },
);
