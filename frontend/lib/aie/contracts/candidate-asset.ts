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
  // TASK-058B: Tesouro Direto (título público), added on top of the
  // TASK-058A diagnostic's finding that no existing value fit it. Only ever
  // set for the narrow, explicit catalog covered by
  // lib/aie/providers/tesouro-direto/catalog.ts -- see that file and
  // docs/tasks/task-058a-tesouro-direto-diagnostics.md for the criteria.
  | "treasury"
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

  /**
   * Official instrument code used by an applicable official source
   * (for example an ANBIMA debenture code). Not a ticker.
   */
  instrumentCode?: string;

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

