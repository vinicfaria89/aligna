import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  AssetEvidence,
  CandidateAsset,
  SearchExecution,
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

import type {
  EvidenceProvider,
  ProviderQuery,
  ProviderResult,
} from "../providers";

import {
  AnbimaDebentureProvider,
  EvidenceProviderRegistry,
} from "../providers";

import {
  AssetResolutionEngine,
} from "./asset-resolution-engine";

const NOW =
  "2026-09-19T12:00:00.000Z";

function createCandidate(): CandidateAsset {
  return {
    id: "asset-1",

    rawName: "DEB PETROBRAS",

    source: {
      fileName: "extrato.pdf",
    },

    hints: {
      assetType: "debenture",

      ticker: "PETR4",

      isin: "BRPETRDBS000",

      cnpj: "33.000.167/0001-01",

      instrumentCode: "ABCD11",

      currency: "BRL",

      amount: 12345.67,
    },
  };
}

function createEvidence(
  overrides: Partial<AssetEvidence> &
    Pick<
      AssetEvidence,
      "id" | "field"
    >,
): AssetEvidence {
  return {
    assetId: "asset-1",

    source: "CVM",

    strength: "primary",

    value: overrides.id,

    collectedAt: NOW,

    ...overrides,
  };
}

interface ProviderSpy {
  provider: EvidenceProvider;

  calls: ProviderQuery[];
}

function createSpy(
  id: string,

  result: Partial<ProviderResult> =
    {},
): ProviderSpy {
  const calls: ProviderQuery[] =
    [];

  const provider: EvidenceProvider =
    {
      id,

      version: "1.0.0",

      supports: () => true,

      async search(
        received: ProviderQuery,
      ): Promise<ProviderResult> {
        calls.push(received);

        return {
          providerId: id,

          searched: true,

          found: false,

          evidence: [],

          ...result,
        };
      },
    };

  return {
    provider,
    calls,
  };
}

function createEngine(
  providers: EvidenceProvider[],
): AssetResolutionEngine {
  const registry =
    new EvidenceProviderRegistry();

  for (const provider of providers) {
    registry.register(provider);
  }

  const policy =
    new VerificationPolicy();

  return new AssetResolutionEngine(
    policy,

    new ResolutionPlanner(),

    new ProviderExecutionPipeline(
      registry,
    ),

    new EvidenceOrchestrator(
      policy,
    ),
  );
}

describe(
  "AssetResolutionEngine coordination",
  () => {
    it(
      "resolve() is asynchronous",
      async () => {
        const promise =
          createEngine([])
            .resolve({
              candidateAsset:
                createCandidate(),

              now: NOW,
            });

        expect(
          promise,
        ).toBeInstanceOf(Promise);

        await promise;
      },
    );

    it(
      "builds the provider query from instrument identifiers only",
      async () => {
        const registry =
          createSpy("REGISTRY");

        await createEngine([
          registry.provider,
        ]).resolve({
          candidateAsset:
            createCandidate(),

          now: NOW,
        });

        expect(
          registry.calls,
        ).toEqual([
          {
            assetId: "asset-1",

            rawName:
              "DEB PETROBRAS",

            ticker: "PETR4",

            isin: "BRPETRDBS000",

            cnpj:
              "33.000.167/0001-01",

            instrumentCode:
              "ABCD11",

            assetType:
              "debenture",
          },
        ]);
      },
    );

    it(
      "stops executing later providers once VerificationPolicy is satisfied",
      async () => {
        const registry =
          createSpy("REGISTRY");

        const anbima =
          createSpy("ANBIMA", {
            found: true,

            evidence: [
              createEvidence({
                id: "identity",

                field: "identity",

                source: "ANBIMA",

                value: "ABCD11",
              }),
            ],
          });

        const cvm =
          createSpy("CVM", {
            found: true,

            evidence: [
              createEvidence({
                id: "issuer",

                field: "issuer",

                value:
                  "company.petrobras",
              }),
            ],
          });

        const b3 =
          createSpy("B3");

        const result =
          await createEngine([
            registry.provider,
            anbima.provider,
            cvm.provider,
            b3.provider,
          ]).resolve({
            candidateAsset:
              createCandidate(),

            now: NOW,
          });

        expect(
          result.status,
        ).toBe("verified");

        expect(
          result.verifiedAsset
            ?.canonicalAssetId,
        ).toBe("ABCD11");

        expect(
          result.verifiedAsset
            ?.issuerEntityId,
        ).toBe(
          "company.petrobras",
        );

        expect(
          result.investigation
            .searches.map(
              (search) =>
                search.providerId,
            ),
        ).toEqual([
          "REGISTRY",
          "ANBIMA",
          "CVM",
        ]);

        expect(
          b3.calls,
        ).toHaveLength(0);
      },
    );

    it(
      "does not execute providers when supplied evidence already verifies",
      async () => {
        const registry =
          createSpy("REGISTRY");

        const result =
          await createEngine([
            registry.provider,
          ]).resolve({
            candidateAsset:
              createCandidate(),

            evidence: [
              createEvidence({
                id: "identity",

                field: "identity",

                source: "ANBIMA",
              }),

              createEvidence({
                id: "issuer",

                field: "issuer",
              }),
            ],

            now: NOW,
          });

        expect(
          result.status,
        ).toBe("verified");

        expect(
          registry.calls,
        ).toHaveLength(0);

        expect(
          result.investigation
            .searches,
        ).toEqual([]);
      },
    );

    it(
      "preserves previously supplied searches before the new ones",
      async () => {
        const previous: SearchExecution =
          {
            providerId: "PREVIOUS",

            startedAt: NOW,

            finishedAt: NOW,

            status: "success",

            evidenceIds: [],
          };

        const registry =
          createSpy("REGISTRY");

        const result =
          await createEngine([
            registry.provider,
          ]).resolve({
            candidateAsset:
              createCandidate(),

            searches: [
              previous,
            ],

            now: NOW,
          });

        expect(
          result.status,
        ).toBe(
          "needs-more-evidence",
        );

        expect(
          result.investigation
            .searches.map(
              (search) =>
                search.providerId,
            ),
        ).toEqual([
          "PREVIOUS",
          "REGISTRY",
        ]);
      },
    );

    it(
      "ANBIMA alone leaves the issuer unresolved and never verifies",
      async () => {
        const client =
          new FakeAnbimaDebentureFeedClient([
            createAnbimaDebentureRecord(),
          ]);

        const result =
          await createEngine([
            new AnbimaDebentureProvider(
              client,
              () => NOW,
            ),
          ]).resolve({
            candidateAsset:
              createCandidate(),

            now: NOW,
          });

        expect(
          client.requestedCodes,
        ).toEqual([
          "ABCD11",
        ]);

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
          result.verifiedAsset,
        ).toBeNull();

        expect(
          result.investigation
            .evidence.map(
              (item) => [
                item.field,
                item.strength,
              ],
            ),
        ).toEqual([
          [
            "identity",
            "primary",
          ],
          [
            "issuer",
            "supporting",
          ],
        ]);

        expect(
          result.investigation
            .unresolvedFields,
        ).toEqual([
          "issuer",
        ]);
      },
    );

    it(
      "ANBIMA identity plus an independently supplied primary issuer verifies, without using the textual emissor",
      async () => {
        const result =
          await createEngine([
            new AnbimaDebentureProvider(
              new FakeAnbimaDebentureFeedClient([
                createAnbimaDebentureRecord(),
              ]),
              () => NOW,
            ),
          ]).resolve({
            candidateAsset:
              createCandidate(),

            evidence: [
              createEvidence({
                id: "cvm-issuer",

                field: "issuer",

                value:
                  "company.petrobras",
              }),
            ],

            now: NOW,
          });

        expect(
          result.status,
        ).toBe("verified");

        expect(
          result.verifiedAsset
            ?.canonicalAssetId,
        ).toBe("ABCD11");

        expect(
          result.verifiedAsset
            ?.issuerEntityId,
        ).toBe(
          "company.petrobras",
        );
      },
    );
  },
);
