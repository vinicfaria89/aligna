import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  AssetEvidence,
  CandidateAsset,
} from "../contracts";

import {
  ProviderExecutionPipeline,
} from "../execution/provider-execution-pipeline";

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
  EvidenceProviderRegistry,
  RegistryProvider,
} from "../providers";

import {
  EntityRegistryLoader,
} from "../registry";

import {
  AssetResolutionEngine,
} from "./asset-resolution-engine";

function createCandidate():
  CandidateAsset {
  return {
    id:
      "asset-1",

    rawName:
      "DEB PETROBRAS",

    source: {},

    hints: {
      assetType:
        "debenture",

      currency:
        "BRL",

      amount:
        1000,
    },
  };
}

function createEngine():
  AssetResolutionEngine {
  const entityRegistry =
    new EntityRegistryLoader()
      .load([
        {
          id:
            "company.petrobras",

          kind:
            "company",

          legalName:
            "Petróleo Brasileiro S.A. - Petrobras",

          aliases: [
            "DEB PETROBRAS",
          ],

          identifiers: [
            {
              kind:
                "ticker",

              value:
                "PETR4",
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

  const policy =
    new VerificationPolicy();

  const planner =
    new ResolutionPlanner();

  const pipeline =
    new ProviderExecutionPipeline(
      providers,
    );

  const orchestrator =
    new EvidenceOrchestrator(
      policy,
    );

  return new AssetResolutionEngine(
    policy,
    planner,
    pipeline,
    orchestrator,
  );
}

describe(
  "AssetResolutionEngine",
  () => {
    it(
      "executes RegistryProvider but does not verify from registry evidence alone",
      async () => {
        const engine =
          createEngine();

        const result =
          await engine.resolve({
            candidateAsset:
              createCandidate(),

            evidence: [],

            now:
              "2026-09-19T12:00:00.000Z",
          });

        expect(
          result.status,
        ).toBe(
          "needs-more-evidence",
        );

        expect(
          result.verifiedAsset,
        ).toBeNull();

        expect(
          result.nextAction,
        ).toBe(
          "search-provider",
        );

        expect(
          result.investigation
            .evidence,
        ).toHaveLength(1);

        expect(
          result.investigation
            .evidence[0],
        ).toMatchObject({
          source:
            "REGISTRY",

          strength:
            "supporting",

          field:
            "identity",

          value:
            "company.petrobras",
        });

        expect(
          result.investigation
            .searches,
        ).toHaveLength(1);

        expect(
          result.investigation
            .searches[0],
        ).toMatchObject({
          providerId:
            "REGISTRY",

          status:
            "success",
        });

        expect(
          result.investigation
            .unresolvedFields,
        ).toEqual([
          "identity",
          "issuer",
        ]);
      },
    );

    it(
      "returns verified without executing providers when qualifying evidence already exists",
      async () => {
        const engine =
          createEngine();

        const evidence:
          AssetEvidence[] = [
            {
              id:
                "evidence-identity",

              assetId:
                "asset-1",

              source:
                "ANBIMA",

              strength:
                "primary",

              field:
                "identity",

              value:
                "instrument.petrobond",

              collectedAt:
                "2026-09-19T12:00:00.000Z",
            },

            {
              id:
                "evidence-issuer",

              assetId:
                "asset-1",

              source:
                "CVM",

              strength:
                "primary",

              field:
                "issuer",

              value:
                "company.petrobras",

              collectedAt:
                "2026-09-19T12:00:00.000Z",
            },
          ];

        const result =
          await engine.resolve({
            candidateAsset:
              createCandidate(),

            evidence,

            now:
              "2026-09-19T12:00:00.000Z",
          });

        expect(
          result.status,
        ).toBe(
          "verified",
        );

        expect(
          result.nextAction,
        ).toBe(
          "finish",
        );

        expect(
          result.verifiedAsset
            ?.canonicalAssetId,
        ).toBe(
          "instrument.petrobond",
        );

        expect(
          result.verifiedAsset
            ?.issuerEntityId,
        ).toBe(
          "company.petrobras",
        );

        expect(
          result.investigation
            .searches,
        ).toEqual([]);
      },
    );
  },
);