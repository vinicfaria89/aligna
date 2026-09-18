import type {
  AssetEvidence,
  CandidateAssetType,
} from "../contracts";

export interface ProviderQuery {
  assetId: string;

  rawName?: string;

  ticker?: string;
  isin?: string;
  cnpj?: string;

  assetType?: CandidateAssetType;
}

export interface ProviderCandidate {
  id: string;
  label: string;

  metadata?: Record<string, unknown>;
}

export interface ProviderError {
  code: string;
  message: string;
}

export interface ProviderResult {
  providerId: string;

  searched: boolean;

  found: boolean;

  evidence: AssetEvidence[];

  candidates?: ProviderCandidate[];

  error?: ProviderError;
}

export interface EvidenceProvider {
  readonly id: string;

  readonly version: string;

  supports(
    query: ProviderQuery,
  ): boolean;

  search(
    query: ProviderQuery,
  ): Promise<ProviderResult>;
}