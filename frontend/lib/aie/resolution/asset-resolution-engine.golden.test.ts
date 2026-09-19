import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  CandidateAsset,
} from "../contracts";

import {
  ProviderExecutionPipeline,
} from "../execution/provider-execution-pipeline";

import {
  createAnbimaDebentureRecord,
  FakeAnbimaDebentureFeedClient,
} from "../infrastructure/anbima/fake-anbima-debenture-feed-client";

import {
  EvidenceOrchestrator,
} from "../orchestrator/evidence-orchestrator";

import {
  ResolutionPlanner,
} from "../planner/resolution-planner";

import {
  VerificationPolicy,
} from "../policy";

import {
  AnbimaDebentureProvider,
  EvidenceProviderRegistry,
  RegistryProvider,
} from "../providers";

import {
  EntityRegistryLoader,
} from "../registry";

import {
  AssetResolutionEngine,
} from "./asset-resolution-engine";

const NOW =
  "2026-09-19T12:00:00.000Z";

function createGoldenEngine(
  anbimaClient: FakeAnbimaDebentureFeedClient,
): AssetResolutionEngine {
  const entityRegistry =
    new EntityRegistryLoader()
      .load([
        {
          id: "instrument.deb-petrobras-abcd11",

          kind: "instrument",

          legalName:
            "Petrobras Debenture ABCD11",

          aliases: [
            "DEB PETROBRAS",
          ],

          identifiers: [
            {
              kind: "instrumentCode",

              value: "ABCD11",
            },
          ],
        },
      ]);

  const providers =
    new EvidenceProviderRegistry();

  providers.register(
    new RegistryProvider(
      entityRegistry,
    ),
  );

  providers.register(
    new AnbimaDebentureProvider(
      anbimaClient,
      () => NOW,
    ),
  );

  const policy =
    new VerificationPolicy();

  return new AssetResolutionEngine(
    policy,

    new ResolutionPlanner(),

    new ProviderExecutionPipeline(
      providers,
    ),

    new EvidenceOrchestrator(
      policy,
    ),
  );
}

describe(
  "AssetResolutionEngine golden flow: Registry -> ANBIMA -> Policy",
  () => {
    it(
      "keeps the debenture as needs-more-evidence because ANBIMA emissor is only supporting issuer evidence",
      async () => {
        const candidate: CandidateAsset =
          {
            id: "asset-golden-1",

            rawName:
              "DEB PETROBRAS",

            source: {},

            hints: {
              assetType:
                "debenture",

              instrumentCode:
                "ABCD11",
            },
          };

        const anbimaClient =
          new FakeAnbimaDebentureFeedClient([
            createAnbimaDebentureRecord({
              codigo_ativo:
                "ABCD11",

              emissor:
                "Petrobras",
            }),
          ]);

        const result =
          await createGoldenEngine(
            anbimaClient,
          ).resolve({
            candidateAsset:
              candidate,

            now: NOW,
          });

        const searches =
          result.investigation
            .searches;

        const evidence =
          result.investigation
            .evidence;

        // Execution order: REGISTRY -> ANBIMA.
        expect(
          searches.map(
            (search) =>
              search.providerId,
          ),
        ).toEqual([
          "REGISTRY",
          "ANBIMA",
        ]);

        expect(
          searches.map(
            (search) =>
              search.status,
          ),
        ).toEqual([
          "success",
          "success",
        ]);

        // The fake ANBIMA client is the only external boundary.
        expect(
          anbimaClient.requestedCodes,
        ).toEqual([
          "ABCD11",
        ]);

        // Evidence chain, in execution order.
        expect(
          evidence.map(
            (item) => [
              item.source,
              item.field,
              item.strength,
              item.value,
            ],
          ),
        ).toEqual([
          [
            "REGISTRY",
            "identity",
            "supporting",
            "instrument.deb-petrobras-abcd11",
          ],
          [
            "ANBIMA",
            "identity",
            "primary",
            "ABCD11",
          ],
          [
            "ANBIMA",
            "issuer",
            "supporting",
            "Petrobras",
          ],
        ]);

        // Every search points at the evidence it produced.
        expect(
          searches.map(
            (search) =>
              search.evidenceIds,
          ),
        ).toEqual([
          [
            evidence[0]?.id,
          ],
          [
            evidence[1]?.id,
            evidence[2]?.id,
          ],
        ]);

        // Registry evidence never upgrades verification.
        expect(
          evidence
            .filter(
              (item) =>
                item.source ===
                "REGISTRY",
            )
            .every(
              (item) =>
                item.strength ===
                "supporting",
            ),
        ).toBe(true);

        // No primary issuer evidence exists anywhere in the chain.
        expect(
          evidence.some(
            (item) =>
              item.field ===
                "issuer" &&
              item.strength ===
                "primary",
          ),
        ).toBe(false);

        // Final resolution.
        expect(
          result.status,
        ).toBe(
          "needs-more-evidence",
        );

        expect(
          result.nextAction,
        ).toBe(
          "search-provider",
        );

        expect(
          result.investigation
            .status,
        ).toBe(
          "needs-more-evidence",
        );

        expect(
          result.verifiedAsset,
        ).toBeNull();

        expect(
          result.investigation
            .unresolvedFields,
        ).toEqual([
          "issuer",
        ]);

        expect(
          result.plan
            .unresolvedFields,
        ).toEqual([
          "issuer",
        ]);
      },
    );

    it(
      "does not fuzzy match: an unknown instrumentCode with a misspelled name resolves nothing",
      async () => {
        const anbimaClient =
          new FakeAnbimaDebentureFeedClient([
            createAnbimaDebentureRecord({
              codigo_ativo:
                "ABCD11",

              emissor:
                "Petrobras",
            }),
          ]);

        const result =
          await createGoldenEngine(
            anbimaClient,
          ).resolve({
            candidateAsset: {
              id: "asset-golden-2",

              rawName:
                "DEB PETROBRA",

              source: {},

              hints: {
                assetType:
                  "debenture",

                instrumentCode:
                  "ZZZZ99",
              },
            },

            now: NOW,
          });

        expect(
          result.investigation
            .searches.map(
              (search) => [
                search.providerId,
                search.status,
              ],
            ),
        ).toEqual([
          [
            "REGISTRY",
            "not-found",
          ],
          [
            "ANBIMA",
            "not-found",
          ],
        ]);

        expect(
          result.investigation
            .evidence,
        ).toEqual([]);

        expect(
          result.verifiedAsset,
        ).toBeNull();

        expect(
          result.investigation
            .unresolvedFields,
        ).toEqual([
          "identity",
          "issuer",
        ]);
      },
    );
  },
);
