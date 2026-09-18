import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  AssetEvidence,
  CandidateAsset,
} from "../contracts";

import type {
  EvidenceProvider,
  ProviderQuery,
  ProviderResult,
} from "../providers";

import {
  EvidenceProviderRegistry,
} from "../providers";

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
      assetType: "stock",
      currency: "BRL",
      amount: 1000,
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
    assetId: "cand-1",
    source: "CVM",
    strength: "primary",
    value: overrides.field,
    collectedAt:
      "2026-09-18T00:00:00.000Z",
    ...overrides,
  };
}

function createMockProvider(): EvidenceProvider {
  return {
    id: "MOCK",
    version: "1.0.0",

    supports(
      _query: ProviderQuery,
    ) {
      return true;
    },

    search: vi.fn(
      async (
        _query: ProviderQuery,
      ): Promise<ProviderResult> => {
        return {
          providerId: "MOCK",
          searched: true,
          found: true,
          evidence: [
            createEvidence({
              id: "from-provider",
              field: "identity",
              value: "PETR4",
            }),
            createEvidence({
              id: "from-provider-issuer",
              field: "issuer",
              value:
                "Petrobras",
            }),
          ],
        };
      },
    ),
  };
}

describe(
  "EvidenceOrchestrator",
  () => {
    it(
      "never verifies an asset from the registry alone",
      async () => {
        const registry =
          new EvidenceProviderRegistry();
        const provider =
          createMockProvider();

        registry.register(
          provider,
        );

        const orchestrator =
          new EvidenceOrchestrator(
            registry,
            new VerificationPolicy(),
          );

        const result =
          orchestrator.evaluate(
            {
              candidateAsset:
                createCandidate(),
              now: "2026-09-18T12:00:00.000Z",
            },
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
            .searches,
        ).toEqual([]);
        expect(
          provider.search,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "keeps the case as needs-more-evidence when evidence is absent",
      () => {
        const orchestrator =
          new EvidenceOrchestrator(
            new EvidenceProviderRegistry(),
            new VerificationPolicy(),
          );

        const result =
          orchestrator.evaluate(
            {
              candidateAsset:
                createCandidate(),
              evidence: [],
              now: "2026-09-18T12:00:00.000Z",
            },
          );

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
          new EvidenceOrchestrator(
            new EvidenceProviderRegistry(),
            new VerificationPolicy(),
          );

        const now =
          "2026-09-18T12:00:00.000Z";

        const result =
          orchestrator.evaluate(
            {
              candidateAsset:
                createCandidate(),
              evidence: [
                createEvidence({
                  id: "e-identity",
                  field:
                    "identity",
                  value:
                    "PETR4",
                }),
                createEvidence({
                  id: "e-issuer",
                  field:
                    "issuer",
                  source:
                    "ANBIMA",
                  value:
                    "Petrobras",
                }),
              ],
              now,
            },
          );

        expect(
          result.investigation
            .status,
        ).toBe("verified");
        expect(
          result.verifiedAsset,
        ).not.toBeNull();
        expect(
          result.verifiedAsset
            ?.canonicalAssetId,
        ).toBe("PETR4");
        expect(
          result.verifiedAsset
            ?.issuerEntityId,
        ).toBe("Petrobras");
        expect(
          result.verifiedAsset
            ?.verification
            .policyVersion,
        ).toBe("1.0.0");
        expect(
          result.verifiedAsset
            ?.verification
            .verifiedAt,
        ).toBe(now);
      },
    );

    it(
      "does not verify by fuzzy matching the candidate name",
      () => {
        const orchestrator =
          new EvidenceOrchestrator(
            new EvidenceProviderRegistry(),
            new VerificationPolicy(),
          );

        const result =
          orchestrator.evaluate(
            {
              candidateAsset:
                createCandidate(),
              evidence: [
                createEvidence({
                  id: "e-weak",
                  field:
                    "ticker",
                  strength:
                    "weak",
                  value:
                    "Petrobras PN quase PETR4",
                }),
              ],
            },
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
      },
    );
  },
);
