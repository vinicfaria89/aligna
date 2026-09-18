export type EvidenceSource =
  | "CVM"
  | "ANBIMA"
  | "B3"
  | "BACEN"
  | "RECEITA"
  | "ISSUER"
  | "DOCUMENT"
  | "REGISTRY"
  | "USER";

export type EvidenceStrength =
  | "primary"
  | "supporting"
  | "weak";

export type EvidenceField =
  | "identity"
  | "assetType"
  | "issuer"
  | "institution"
  | "ticker"
  | "isin"
  | "cnpj"
  | "fund"
  | "currency"
  | "maturity"
  | "economicGroup";

export interface AssetEvidence {
  id: string;

  assetId: string;

  source: EvidenceSource;

  strength: EvidenceStrength;

  field: EvidenceField;

  value: string;

  sourceReference?: string;

  collectedAt: string;

  providerVersion?: string;

  metadata?: Record<string, unknown>;
}