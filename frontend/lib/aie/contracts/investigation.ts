import type { AssetEvidence } from "./evidence";
import type { CandidateAsset } from "./candidate-asset";

export type InvestigationStatus =
  | "open"
  | "searching"
  | "verified"
  | "needs-more-evidence"
  | "needs-user"
  | "blocked";

export type SearchExecutionStatus =
  | "success"
  | "not-found"
  | "failed";

export interface SearchExecution {
  providerId: string;

  startedAt: string;
  finishedAt: string;

  status: SearchExecutionStatus;

  evidenceIds: string[];

  error?: string;
}

export interface InvestigationCase {
  id: string;

  candidateAsset: CandidateAsset;

  status: InvestigationStatus;

  evidence: AssetEvidence[];

  searches: SearchExecution[];

  unresolvedFields: string[];

  createdAt: string;

  updatedAt: string;
}
