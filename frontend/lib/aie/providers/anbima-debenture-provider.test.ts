import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  AnbimaDebentureFeedClient,
  AnbimaDebentureMarketRecord,
} from "../infrastructure/anbima/anbima-debenture-types";

import {
  createAnbimaDebentureRecord,
  FakeAnbimaDebentureFeedClient,
} from "../infrastructure/anbima/fake-anbima-debenture-feed-client";

import {
  VerificationPolicy,
} from "../policy";

import {
  AnbimaDebentureProvider,
} from "./anbima-debenture-provider";

const NOW =
  "2026-09-19T12:00:00.000Z";

function createProvider(
  client: AnbimaDebentureFeedClient,
): AnbimaDebentureProvider {
  return new AnbimaDebentureProvider(
    client,
    () => NOW,
  );
}

describe(
  "AnbimaDebentureProvider",
  () => {
    it(
      "requires a debenture assetType and an instrumentCode",
      () => {
        const provider =
          createProvider(
            new FakeAnbimaDebentureFeedClient(),
          );

        expect(
          provider.supports({
            assetId: "asset-1",

            assetType:
              "debenture",

            instrumentCode:
              "ABCD11",
          }),
        ).toBe(true);

        expect(
          provider.supports({
            assetId: "asset-1",

            assetType:
              "debenture",
          }),
        ).toBe(false);

        expect(
          provider.supports({
            assetId: "asset-1",

            assetType:
              "debenture",

            ticker: "ABCD11",
          }),
        ).toBe(false);

        expect(
          provider.supports({
            assetId: "asset-1",

            assetType:
              "debenture",

            instrumentCode:
              "   ",
          }),
        ).toBe(false);

        expect(
          provider.supports({
            assetId: "asset-1",

            assetType: "stock",

            instrumentCode:
              "ABCD11",
          }),
        ).toBe(false);
      },
    );

    it(
      "does not search when unsupported",
      async () => {
        const client =
          new FakeAnbimaDebentureFeedClient([
            createAnbimaDebentureRecord(),
          ]);

        const result =
          await createProvider(
            client,
          ).search({
            assetId: "asset-1",

            assetType:
              "debenture",

            ticker: "ABCD11",
          });

        expect(result).toEqual({
          providerId: "ANBIMA",

          searched: false,

          found: false,

          evidence: [],
        });

        expect(
          client.requestedCodes,
        ).toEqual([]);
      },
    );

    it(
      "produces primary identity and supporting issuer evidence for an exact instrument code",
      async () => {
        const client =
          new FakeAnbimaDebentureFeedClient([
            createAnbimaDebentureRecord(),
          ]);

        const result =
          await createProvider(
            client,
          ).search({
            assetId: "asset-1",

            assetType:
              "debenture",

            instrumentCode:
              "ABCD11",
          });

        expect(
          result.searched,
        ).toBe(true);

        expect(
          result.found,
        ).toBe(true);

        expect(
          result.evidence,
        ).toHaveLength(2);

        const identity =
          result.evidence.find(
            (item) =>
              item.field ===
              "identity",
          );

        const issuer =
          result.evidence.find(
            (item) =>
              item.field ===
              "issuer",
          );

        expect(
          identity,
        ).toMatchObject({
          assetId: "asset-1",

          source: "ANBIMA",

          strength: "primary",

          value: "ABCD11",

          providerVersion:
            "1.0.0",

          collectedAt: NOW,

          sourceReference:
            "ANBIMA:debentures:mercado-secundario:ABCD11",
        });

        expect(
          issuer,
        ).toMatchObject({
          assetId: "asset-1",

          source: "ANBIMA",

          strength:
            "supporting",

          value: "Petrobras",

          providerVersion:
            "1.0.0",

          collectedAt: NOW,

          sourceReference:
            "ANBIMA:debentures:mercado-secundario:ABCD11",
        });
      },
    );

    it(
      "preserves only fields present in the ANBIMA record as metadata",
      async () => {
        const result =
          await createProvider(
            new FakeAnbimaDebentureFeedClient([
              createAnbimaDebentureRecord(),
            ]),
          ).search({
            assetId: "asset-1",

            assetType:
              "debenture",

            instrumentCode:
              "ABCD11",
          });

        const identity =
          result.evidence.find(
            (item) =>
              item.field ===
              "identity",
          );

        expect(
          identity?.metadata,
        ).toEqual({
          codigo_ativo:
            "ABCD11",

          emissor:
            "Petrobras",

          data_referencia:
            "2026-09-18",

          data_vencimento:
            "2030-01-15",

          grupo: "DI",
        });
      },
    );

    it(
      "normalizes the instrument code before asking the client",
      async () => {
        const client =
          new FakeAnbimaDebentureFeedClient([
            createAnbimaDebentureRecord(),
          ]);

        const result =
          await createProvider(
            client,
          ).search({
            assetId: "asset-1",

            assetType:
              "debenture",

            instrumentCode:
              "  abcd11 ",
          });

        expect(
          client.requestedCodes,
        ).toEqual([
          "ABCD11",
        ]);

        expect(
          result.found,
        ).toBe(true);
      },
    );

    it(
      "returns found = false for an unknown instrument",
      async () => {
        const result =
          await createProvider(
            new FakeAnbimaDebentureFeedClient([
              createAnbimaDebentureRecord(),
            ]),
          ).search({
            assetId: "asset-1",

            assetType:
              "debenture",

            instrumentCode:
              "ZZZZ99",
          });

        expect(result).toEqual({
          providerId: "ANBIMA",

          searched: true,

          found: false,

          evidence: [],
        });
      },
    );

    it(
      "rejects a record whose code differs from the requested code",
      async () => {
        const client: AnbimaDebentureFeedClient =
          {
            async findSecondaryMarketDebentureByCode():
              Promise<AnbimaDebentureMarketRecord | null> {
              return createAnbimaDebentureRecord(
                {
                  codigo_ativo:
                    "OTHR11",
                },
              );
            },
          };

        const result =
          await createProvider(
            client,
          ).search({
            assetId: "asset-1",

            assetType:
              "debenture",

            instrumentCode:
              "ABCD11",
          });

        expect(
          result.found,
        ).toBe(false);

        expect(
          result.evidence,
        ).toEqual([]);
      },
    );

    it(
      "converts client failures into ProviderError",
      async () => {
        const result =
          await createProvider(
            new FakeAnbimaDebentureFeedClient(
              [],
              new Error(
                "ANBIMA unavailable",
              ),
            ),
          ).search({
            assetId: "asset-1",

            assetType:
              "debenture",

            instrumentCode:
              "ABCD11",
          });

        expect(
          result.searched,
        ).toBe(true);

        expect(
          result.found,
        ).toBe(false);

        expect(
          result.evidence,
        ).toEqual([]);

        expect(
          result.error,
        ).toEqual({
          code:
            "ANBIMA_SEARCH_FAILED",

          message:
            "ANBIMA unavailable",
        });
      },
    );

    it(
      "does not verify issuer identity by itself",
      async () => {
        const result =
          await createProvider(
            new FakeAnbimaDebentureFeedClient([
              createAnbimaDebentureRecord(),
            ]),
          ).search({
            assetId: "asset-1",

            assetType:
              "debenture",

            instrumentCode:
              "ABCD11",
          });

        const decision =
          new VerificationPolicy()
            .evaluate(
              result.evidence,
            );

        expect(
          decision.status,
        ).toBe(
          "needs-more-evidence",
        );

        expect(
          decision.unresolvedFields,
        ).toEqual([
          "issuer",
        ]);

        expect(
          result,
        ).not.toHaveProperty(
          "verifiedAsset",
        );
      },
    );
  },
);
