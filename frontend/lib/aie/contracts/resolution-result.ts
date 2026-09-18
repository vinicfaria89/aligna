import type {
    InvestigationCase,
  } from "./investigation";
  
  import type {
    VerifiedAsset,
  } from "./verified-asset";
  
  import type {
    ResolutionPlan,
  } from "../planner/resolution-plan";
  
  export type ResolutionStatus =
    | "verified"
    | "needs-more-evidence"
    | "needs-user"
    | "conflict"
    | "blocked";
  
  export type ResolutionNextAction =
    | "search-provider"
    | "ask-user"
    | "finish";
  
  export interface ResolutionResult {
    status: ResolutionStatus;
  
    investigation: InvestigationCase;
  
    verifiedAsset: VerifiedAsset | null;
  
    plan: ResolutionPlan;
  
    nextAction: ResolutionNextAction;
  }
