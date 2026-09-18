import type {
  AssetEvidence,
  CandidateAsset,
  ResolutionResult,
} from "../contracts";

import {
  EvidenceOrchestrator,
} from "../orchestrator/evidence-orchestrator";

import {
  ResolutionPlanner,
} from "../planner/resolution-planner";

import {
  VerificationPolicy,
} from "../policy";

export interface AssetResolutionInput {
  candidateAsset: CandidateAsset;

  evidence?: AssetEvidence[];

  now?: string;
}

export class AssetResolutionEngine {
  constructor(
    private readonly policy: VerificationPolicy,
    private readonly planner: ResolutionPlanner,
    private readonly orchestrator: EvidenceOrchestrator,
  ) {}

  resolve(
    input: AssetResolutionInput,
  ): ResolutionResult {
    const evidence =
      input.evidence ?? [];

    const decision =
      this.policy.evaluate(
        evidence,
      );

    const plan =
      this.planner.build(
        input.candidateAsset,
        decision,
      );

    const result =
      this.orchestrator.evaluate({
        candidateAsset:
          input.candidateAsset,

        evidence,

        now: input.now,
      });

    if (result.verifiedAsset) {
      return {
        status: "verified",

        investigation:
          result.investigation,

        verifiedAsset:
          result.verifiedAsset,

        plan,

        nextAction:
          "finish",
      };
    }

    return {
      status:
        "needs-more-evidence",

      investigation:
        result.investigation,

      verifiedAsset: null,

      plan,

      nextAction:
        "search-provider",
    };
  }
}