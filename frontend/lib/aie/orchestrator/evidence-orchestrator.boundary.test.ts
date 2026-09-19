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
  VerificationPolicy,
} from "../policy";

import {
  EvidenceOrchestrator,
} from "./evidence-orchestrator";

const candidate: CandidateAsset = {
  id: "asset-1",

  rawName: "DEB PETROBRAS",

  source: {},

  hints: {
    assetType: "debenture",

    instrumentCode: "ABCD11",
  },
};

function evidence(
  overrides: Partial<AssetEvidence> &
    Pick<
      AssetEvidence,
      "id" | "field"
    >,
): AssetEvidence {
  return {
    assetId: "asset-1",

    source: "ANBIMA",

    strength: "primary",

    value: overrides.id,

    collectedAt:
      "2026-09-19T12:00:00.000Z",

    ...overrides,
  };
}

describe(
  "EvidenceOrchestrator boundary",
  () => {
    it(
      "depends only on VerificationPolicy",
      () => {
        expect(
          EvidenceOrchestrator.length,
        ).toBe(1);

        const orchestrator =
          new EvidenceOrchestrator(
            new VerificationPolicy(),
          );

        expect(
          Object.keys(
            orchestrator,
          ),
        ).toEqual([
          "policy",
        ]);
      },
    );

    it(
      "does not expose provider execution",
      () => {
        const orchestrator =
          new EvidenceOrchestrator(
            new VerificationPolicy(),
          ) as unknown as Record<
            string,
            unknown
          >;

        expect(
          orchestrator.search,
        ).toBeUndefined();

        expect(
          orchestrator.execute,
        ).toBeUndefined();
      },
    );

    it(
      "records no searches when none are supplied",
      () => {
        const result =
          new EvidenceOrchestrator(
            new VerificationPolicy(),
          ).evaluate({
            candidateAsset:
              candidate,
          });

        expect(
          result.investigation
            .searches,
        ).toEqual([]);
      },
    );

    it(
      "keeps issuer unresolved when only supporting issuer evidence exists",
      () => {
        const result =
          new EvidenceOrchestrator(
            new VerificationPolicy(),
          ).evaluate({
            candidateAsset:
              candidate,

            evidence: [
              evidence({
                id: "identity",

                field: "identity",

                value: "ABCD11",
              }),

              evidence({
                id: "issuer-name",

                field: "issuer",

                strength:
                  "supporting",

                value: "Petrobras",
              }),
            ],

            now:
              "2026-09-19T12:00:00.000Z",
          });

        expect(
          result.verifiedAsset,
        ).toBeNull();

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
          "issuer",
        ]);
      },
    );
  },
);
