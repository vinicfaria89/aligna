import type { CandidateAssetType } from "./candidate-asset";

export interface VerifiedAsset {
  id: string;

  candidateAssetId: string;

  canonicalAssetId: string;

  assetType: CandidateAssetType;

  issuerEntityId?: string;

  institutionEntityId?: string;

  fundEntityId?: string;

  currency: string;

  amount?: number;

  verification: {
    investigationId: string;

    evidenceIds: string[];

    verifiedAt: string;

    policyVersion: string;
  };
}