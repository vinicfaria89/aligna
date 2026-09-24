import type {
    CandidateAssetType,
    EvidenceField,
  } from "../contracts";
  
  export type ResolutionSource =
    | "REGISTRY"
    | "ANBIMA"
    | "CVM"
    | "B3"
    | "BACEN"
    // TASK-058B: TesouroDiretoProvider's id (lib/aie/providers/tesouro-direto).
    | "TESOURO"
    | "USER";
  
  export interface ResolutionStep {
    source: ResolutionSource;
  
    order: number;
  
    fields: EvidenceField[];
  }
  
  export interface ResolutionPlan {
    assetType: CandidateAssetType;
  
    unresolvedFields:
      EvidenceField[];
  
    steps:
      ResolutionStep[];
  }