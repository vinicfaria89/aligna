import {
  describe,
  expect,
  it,
} from "vitest";

import {
  EntityRegistryLoader,
} from "./entity-registry-loader";

describe(
  "EntityRegistry instrumentCode identifiers",
  () => {
    it(
      "resolves an exact instrumentCode after normalization",
      () => {
        const registry =
          new EntityRegistryLoader()
            .load([
              {
                id: "instrument.demo",
                kind: "instrument",
                legalName: "Demo Debenture",
                aliases: [],
                identifiers: [
                  {
                    kind: "instrumentCode",
                    value: "abcd11",
                  },
                ],
              },
            ]);

        expect(
          registry.findByIdentifier(
            "instrumentCode",
            "  ABCD11 ",
          )?.id,
        ).toBe(
          "instrument.demo",
        );
      },
    );

    it(
      "does not match a partial or extended instrumentCode",
      () => {
        const registry =
          new EntityRegistryLoader()
            .load([
              {
                id: "instrument.demo",
                kind: "instrument",
                legalName: "Demo Debenture",
                aliases: [],
                identifiers: [
                  {
                    kind: "instrumentCode",
                    value: "ABCD11",
                  },
                ],
              },
            ]);

        expect(
          registry.findByIdentifier(
            "instrumentCode",
            "ABCD1",
          ),
        ).toBeNull();

        expect(
          registry.findByIdentifier(
            "instrumentCode",
            "ABCD111",
          ),
        ).toBeNull();
      },
    );

    it(
      "rejects the same instrumentCode on different entities",
      () => {
        expect(
          () =>
            new EntityRegistryLoader()
              .load([
                {
                  id: "a",
                  kind: "instrument",
                  legalName: "A",
                  aliases: [],
                  identifiers: [
                    {
                      kind: "instrumentCode",
                      value: "ABCD11",
                    },
                  ],
                },
                {
                  id: "b",
                  kind: "instrument",
                  legalName: "B",
                  aliases: [],
                  identifiers: [
                    {
                      kind: "instrumentCode",
                      value: "abcd11",
                    },
                  ],
                },
              ]),
        ).toThrow(
          /instrumentCode:ABCD11/,
        );
      },
    );

    it(
      "keeps identifier kinds in separate namespaces",
      () => {
        const registry =
          new EntityRegistryLoader()
            .load([
              {
                id: "company.ticker-owner",
                kind: "company",
                legalName: "Ticker Owner",
                aliases: [],
                identifiers: [
                  {
                    kind: "ticker",
                    value: "ABCD11",
                  },
                ],
              },
              {
                id: "instrument.code-owner",
                kind: "instrument",
                legalName: "Code Owner",
                aliases: [],
                identifiers: [
                  {
                    kind: "instrumentCode",
                    value: "ABCD11",
                  },
                ],
              },
            ]);

        expect(
          registry.findByIdentifier(
            "ticker",
            "ABCD11",
          )?.id,
        ).toBe(
          "company.ticker-owner",
        );

        expect(
          registry.findByIdentifier(
            "instrumentCode",
            "ABCD11",
          )?.id,
        ).toBe(
          "instrument.code-owner",
        );
      },
    );

    it(
      "rejects an empty instrumentCode identifier",
      () => {
        expect(
          () =>
            new EntityRegistryLoader()
              .load([
                {
                  id: "instrument.empty",
                  kind: "instrument",
                  legalName: "Empty",
                  aliases: [],
                  identifiers: [
                    {
                      kind: "instrumentCode",
                      value: "   ",
                    },
                  ],
                },
              ]),
        ).toThrow(
          /empty instrumentCode identifier/,
        );
      },
    );
  },
);
