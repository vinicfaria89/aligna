export type CandidateAssetType =
  | "stock"
  | "etf"
  | "fii"
  | "fund"
  | "debenture"
  | "cri"
  | "cra"
  | "cdb"
  | "lci"
  | "lca"
  | "coe"
  | "crypto"
  | "international"
  | "unknown";

export interface CandidateAssetSource {
  fileId?: string;
  fileName?: string;
  section?: string;
  row?: number;
  institution?: string;
}

export interface CandidateAssetHints {
  assetType?: CandidateAssetType;

  ticker?: string;
  isin?: string;
  cnpj?: string;

  issuerName?: string;
  fundName?: string;

  maturityDate?: string;
  currency?: string;

  amount?: number;
}

export interface CandidateAsset {
  id: string;

  rawName: string;

  source: CandidateAssetSource;

  hints: CandidateAssetHints;
}

