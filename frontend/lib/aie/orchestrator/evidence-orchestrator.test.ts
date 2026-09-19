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
  VerificationPolicy,
} from "../policy";

import {
  EvidenceOrchestrator,
} from "./evidence-orchestrator";

function createCandidate(): CandidateAsset {
  return {
    id: "cand-1",

    rawName:
      "Petrobras PN quase PETR4",

    source: {
      fileName:
        "extrato.pdf",
    },

    hints: {
      assetType:
        "stock",

      currency:
        "BRL",

      amount:
        1000,
    },
  };
}

function createEvidence(
  overrides:
    Partial<AssetEvidence> &
    Pick<
      AssetEvidence,
      "id" | "field"
    >,
): AssetEvidence {
  return {
    assetId:
      "cand-1",

    source:
      "CVM",

    strength:
      "primary",

    value:
      overrides.field,

    collectedAt:
      "2026-09-18T00:00:00.000Z",

    ...overrides,
  };
}

function createOrchestrator():
  EvidenceOrchestrator {
  return new EvidenceOrchestrator(
    new VerificationPolicy(),
  );
}

describe(
  "EvidenceOrchestrator",
  () => {
    it(
      "never verifies an asset from registry evidence alone",
      () => {
        const orchestrator =
          createOrchestrator();

        const result =
          orchestrator.evaluate({
            candidateAsset:
              createCandidate(),

            evidence: [
              createEvidence({
                id:
                  "registry-identity",

                field:
                  "identity",

                source:
                  "REGISTRY",

                strength:
                  "supporting",

                value:
                  "company.petrobras",
              }),
            ],

            now:
              "2026-09-18T12:00:00.000Z",
          });

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
          "identity",
          "issuer",
        ]);
      },
    );

    it(
      "keeps the case as needs-more-evidence when evidence is absent",
      () => {
        const orchestrator =
          createOrchestrator();

        const result =
          orchestrator.evaluate({
            candidateAsset:
              createCandidate(),

            evidence: [],

            now:
              "2026-09-18T12:00:00.000Z",
          });

        expect(
          result.investigation
            .status,
        ).toBe(
          "needs-more-evidence",
        );

        expect(
          result.investigation
            .unresolvedFields,
        ).toEqual([
          "identity",
          "issuer",
        ]);

        expect(
          result.verifiedAsset,
        ).toBeNull();
      },
    );

    it(
      "verifies only when primary identity and issuer evidence are present",
      () => {
        const orchestrator =
          createOrchestrator();

        const now =
          "2026-09-18T12:00:00.000Z";

        const result =
          orchestrator.evaluate({
            candidateAsset:
              createCandidate(),

            evidence: [
              createEvidence({
                id:
                  "e-identity",

                field:
                  "identity",

                value:
                  "PETR4",
              }),

              createEvidence({
                id:
                  "e-issuer",

                field:
                  "issuer",

                source:
                  "ANBIMA",

                value:
                  "Petrobras",
              }),
            ],

            now,
          });

        expect(
          result.investigation
            .status,
        ).toBe(
          "verified",
        );

        expect(
          result.verifiedAsset,
        ).not.toBeNull();

        expect(
          result.verifiedAsset
            ?.canonicalAssetId,
        ).toBe(
          "PETR4",
        );

        expect(
          result.verifiedAsset
            ?.issuerEntityId,
        ).toBe(
          "Petrobras",
        );

        expect(
          result.verifiedAsset
            ?.verification
            .policyVersion,
        ).toBe(
          "1.0.0",
        );

        expect(
          result.verifiedAsset
            ?.verification
            .verifiedAt,
        ).toBe(
          now,
        );
      },
    );

    it(
      "does not verify weak fuzzy-like evidence",
      () => {
        const orchestrator =
          createOrchestrator();

        const result =
          orchestrator.evaluate({
            candidateAsset:
              createCandidate(),

            evidence: [
              createEvidence({
                id:
                  "e-weak",

                field:
                  "ticker",

                strength:
                  "weak",

                value:
                  "Petrobras PN quase PETR4",
              }),
            ],
          });

        expect(
          result.investigation
            .status,
        ).toBe(
          "needs-more-evidence",
        );

        expect(
          result.verifiedAsset,
        ).toBeNull();
      },
    );

    it(
      "preserves provider search history in the investigation",
      () => {
        const orchestrator =
          createOrchestrator();

        const searches:
          SearchExecution[] = [
            {
              providerId:
                "REGISTRY",

              startedAt:
                "2026-09-18T12:00:00.000Z",

              finishedAt:
                "2026-09-18T12:00:01.000Z",

              status:
                "success",

              evidenceIds: [
                "registry-identity",
              ],
            },
          ];

        const result =
          orchestrator.evaluate({
            candidateAsset:
              createCandidate(),

            evidence: [
              createEvidence({
                id:
                  "registry-identity",

                field:
                  "identity",

                source:
                  "REGISTRY",

                strength:
                  "supporting",

                value:
                  "company.petrobras",
              }),
            ],

            searches,

            now:
              "2026-09-18T12:00:02.000Z",
          });

        expect(
          result.investigation
            .searches,
        ).toEqual(
          searches,
        );
      },
    );
  },
);