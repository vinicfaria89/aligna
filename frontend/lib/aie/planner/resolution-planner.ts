import type {
    CandidateAsset,
    CandidateAssetType,
    EvidenceField,
  } from "../contracts";
  
  import type {
    VerificationDecision,
  } from "../policy";
  
  import type {
    ResolutionPlan,
    ResolutionSource,
  } from "./resolution-plan";
  
  const SEARCH_PLANS: Record<
    CandidateAssetType,
    ResolutionSource[]
  > = {
    debenture: [
      "REGISTRY",
      "ANBIMA",
      "CVM",
      "B3",
      "USER",
    ],
  
    cri: [
      "REGISTRY",
      "ANBIMA",
      "CVM",
      "B3",
      "USER",
    ],
  
    cra: [
      "REGISTRY",
      "ANBIMA",
      "CVM",
      "B3",
      "USER",
    ],
  
    fii: [
      "REGISTRY",
      "CVM",
      "B3",
      "ANBIMA",
      "USER",
    ],
  
    fund: [
      "REGISTRY",
      "CVM",
      "B3",
      "ANBIMA",
      "USER",
    ],
  
    lca: [
      "REGISTRY",
      "BACEN",
      "USER",
    ],
  
    lci: [
      "REGISTRY",
      "BACEN",
      "USER",
    ],
  
    cdb: [
      "REGISTRY",
      "BACEN",
      "USER",
    ],
  
    stock: [
      "REGISTRY",
      "B3",
      "CVM",
      "USER",
    ],
  
    etf: [
      "REGISTRY",
      "B3",
      "CVM",
      "USER",
    ],
  
    coe: [
      "REGISTRY",
      "B3",
      "CVM",
      "USER",
    ],
  
    crypto: [
      "REGISTRY",
      "USER",
    ],
  
    // TASK-051B: BDRs (ex.: AAPL34) sao cobertos pelo catalogo local de
    // ativos B3/listados (lib/aie/providers/b3-listed-assets/catalog.ts) --
    // sem "B3" aqui, o plano nunca chegaria a tentar esse provider para
    // "international", mesmo com o ticker no catalogo.
    international: [
      "REGISTRY",
      "B3",
      "USER",
    ],
  
    unknown: [
      "REGISTRY",
      "USER",
    ],
  };
  
  export class ResolutionPlanner {
    build(
      candidateAsset: CandidateAsset,
      decision: VerificationDecision,
    ): ResolutionPlan {
      const assetType =
        candidateAsset.hints.assetType ??
        "unknown";
  
      const sources =
        SEARCH_PLANS[assetType];
  
      const unresolvedFields =
        decision.unresolvedFields;
  
      return {
        assetType,
        unresolvedFields,
  
        steps: sources.map(
          (source, index) => ({
            source,
            order: index + 1,
            fields:
              unresolvedFields as EvidenceField[],
          }),
        ),
      };
    }
  }
 