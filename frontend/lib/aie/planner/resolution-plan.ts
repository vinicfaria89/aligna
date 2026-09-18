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