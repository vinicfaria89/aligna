import type {
  AssetEvidence,
  CandidateAsset,
  InvestigationCase,
  VerifiedAsset,
} from "../contracts";

import type {
  EvidenceProviderRegistry,
} from "../providers";

import {
  VerificationPolicy,
} from "../policy";

export interface OrchestratorInput {
  candidateAsset: CandidateAsset;

  evidence?: AssetEvidence[];

  now?: string;
}

export interface OrchestratorResult {
  investigation: InvestigationCase;

  verifiedAsset: VerifiedAsset | null;
}

function findQualifyingValue(
  evidence: AssetEvidence[],
  field: "identity" | "issuer",
): string | undefined {
  return evidence.find(
    (item) =>
      item.strength ===
        "primary" &&
      item.field === field &&
      item.source !==
        "REGISTRY",
  )?.value;
}

export class EvidenceOrchestrator {
  constructor(
    private readonly registry: EvidenceProviderRegistry,
    private readonly policy: VerificationPolicy,
  ) {}

  evaluate(
    input: OrchestratorInput,
  ): OrchestratorResult {
    // Providers in the registry are never searched here.
    // Verification depends only on supplied primary evidence.
    this.registry.list();

    const now =
      input.now ??
      new Date().toISOString();

    const evidence =
      input.evidence ?? [];

    const decision =
      this.policy.evaluate(
        evidence,
      );

    const investigation: InvestigationCase =
      {
        id: `investigation:${input.candidateAsset.id}`,
        candidateAsset:
          input.candidateAsset,
        status: decision.status,
        evidence,
        searches: [],
        unresolvedFields:
          decision.unresolvedFields,
        createdAt: now,
        updatedAt: now,
      };

    if (
      decision.status !==
      "verified"
    ) {
      return {
        investigation,
        verifiedAsset: null,
      };
    }

    const canonicalAssetId =
      findQualifyingValue(
        evidence,
        "identity",
      );

    const issuerEntityId =
      findQualifyingValue(
        evidence,
        "issuer",
      );

    if (
      !canonicalAssetId ||
      !issuerEntityId
    ) {
      return {
        investigation: {
          ...investigation,
          status:
            "needs-more-evidence",
        },
        verifiedAsset: null,
      };
    }

    const verifiedAsset: VerifiedAsset =
      {
        id: `verified:${input.candidateAsset.id}`,
        candidateAssetId:
          input.candidateAsset.id,
        canonicalAssetId,
        assetType:
          input.candidateAsset
            .hints.assetType ??
          "unknown",
        issuerEntityId,
        currency:
          input.candidateAsset
            .hints.currency ??
          "BRL",
        amount:
          input.candidateAsset
            .hints.amount,
        verification: {
          investigationId:
            investigation.id,
          evidenceIds:
            decision.evidenceIds,
          verifiedAt: now,
          policyVersion:
            decision.policyVersion,
        },
      };

    return {
      investigation,
      verifiedAsset,
    };
  }
}
