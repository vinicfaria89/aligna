import type {
  AssetEvidence,
  CandidateAsset,
  ResolutionResult,
  SearchExecution,
} from "../contracts";

import {
  ProviderExecutionPipeline,
} from "../execution/provider-execution-pipeline";

import {
  EvidenceOrchestrator,
} from "../orchestrator/evidence-orchestrator";

import {
  ResolutionPlanner,
} from "../planner/resolution-planner";

import {
  VerificationPolicy,
} from "../policy";

import type {
  ProviderQuery,
} from "../providers";

export interface AssetResolutionInput {
  candidateAsset: CandidateAsset;

  evidence?: AssetEvidence[];

  searches?: SearchExecution[];

  now?: string;
}

function buildProviderQuery(
  candidate:
    CandidateAsset,
): ProviderQuery {
  return {
    assetId:
      candidate.id,

    rawName:
      candidate.rawName,

    ticker:
      candidate.hints.ticker,

    isin:
      candidate.hints.isin,

    cnpj:
      candidate.hints.cnpj,

    instrumentCode:
      candidate.hints.instrumentCode,

    assetType:
      candidate.hints.assetType,
  };
}

export class AssetResolutionEngine {
  constructor(
    private readonly policy:
      VerificationPolicy,

    private readonly planner:
      ResolutionPlanner,

    private readonly pipeline:
      ProviderExecutionPipeline,

    private readonly orchestrator:
      EvidenceOrchestrator,
  ) {}

  async resolve(
    input: AssetResolutionInput,
  ): Promise<ResolutionResult> {
    const candidate =
      input.candidateAsset;

    const existingEvidence = [
      ...(input.evidence ?? []),
    ];

    const existingSearches = [
      ...(input.searches ?? []),
    ];

    const initialDecision =
      this.policy.evaluate(
        existingEvidence,
      );

    const initialPlan =
      this.planner.build(
        candidate,
        initialDecision,
      );

    let evidence =
      existingEvidence;

    let searches =
      existingSearches;

    /*
     * If supplied evidence already satisfies
     * the policy, there is no reason to call
     * additional providers.
     */
    if (
      initialDecision.status !==
      "verified"
    ) {
      const execution =
        await this.pipeline.execute({
          plan:
            initialPlan,

          query:
            buildProviderQuery(
              candidate,
            ),

          existingEvidence,

          now:
            input.now
              ? () => input.now!
              : undefined,

          shouldStop: (
            currentEvidence,
          ) =>
            this.policy.evaluate(
              currentEvidence,
            ).status === "verified",
        });

      evidence =
        execution.evidence;

      searches = [
        ...existingSearches,
        ...execution.searches,
      ];
    }

    const finalDecision =
      this.policy.evaluate(
        evidence,
      );

    const finalPlan =
      this.planner.build(
        candidate,
        finalDecision,
      );

    const result =
      this.orchestrator.evaluate({
        candidateAsset:
          candidate,

        evidence,

        searches,

        now:
          input.now,
      });

    if (
      result.verifiedAsset
    ) {
      return {
        status:
          "verified",

        investigation:
          result.investigation,

        verifiedAsset:
          result.verifiedAsset,

        plan:
          finalPlan,

        nextAction:
          "finish",
      };
    }

    return {
      status:
        "needs-more-evidence",

      investigation:
        result.investigation,

      verifiedAsset:
        null,

      plan:
        finalPlan,

      nextAction:
        "search-provider",
    };
  }
}