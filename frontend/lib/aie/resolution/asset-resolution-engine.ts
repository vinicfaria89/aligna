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

import {
  findListedB3CatalogEntry,
} from "../providers/b3-listed-assets/infer-asset-type";

import {
  findTesouroDiretoCatalogEntry,
} from "../providers/tesouro-direto/infer-asset-type";

export interface AssetResolutionInput {
  candidateAsset: CandidateAsset;

  evidence?: AssetEvidence[];

  searches?: SearchExecution[];

  now?: string;
}

/**
 * TASK-051C: fills `hints.assetType` (and `hints.ticker`, when it was
 * absent) ONLY when the candidate has no `assetType` AND its ticker OR
 * rawName exact-matches `B3ListedAssetProvider`'s own catalog (see
 * lib/aie/providers/b3-listed-assets/infer-asset-type.ts for the "catalog
 * membership only, never appearance" rule). An explicit `assetType` -- right
 * or wrong -- is NEVER overwritten here: a conflicting one is left as is and
 * caught downstream by `B3ListedAssetProvider`'s own guard, not silently
 * fixed. An explicit `hints.ticker` is likewise never overwritten -- it is
 * only filled in when absent, from the SAME catalog entry that supplied the
 * inferred type, so it can never disagree with it. Never mutates the input;
 * returns the same reference when there is nothing to infer.
 *
 * Filling `hints.ticker` too (not just `assetType`) matters for the most
 * basic real CSV: a row with just `rawName` ("PETR4"), no separate `ticker`
 * column at all -- `B3ListedAssetProvider` looks up `hints.ticker`, so
 * inferring the type alone would still leave the provider unable to find
 * anything.
 *
 * Deliberately the earliest point in resolution: everything below (the
 * plan, the provider query, the final `VerifiedAsset.assetType`) reads from
 * this single enriched candidate, so inference and the search plan/result
 * can never disagree with each other.
 *
 * TASK-058B: chains a second, independent lookup against the Tesouro Direto
 * catalog (../providers/tesouro-direto/infer-asset-type.ts) when the B3
 * catalog found nothing -- same "only on exact catalog membership, never
 * overwrite an explicit assetType" guarantee, just a second local catalog.
 * The two catalogs' name spaces never collide (tickers vs. "Tesouro ..."
 * names), so trying B3 first is safe and costs nothing extra for the common
 * case. Unlike the B3 branch, this never fills `hints.ticker` -- a Tesouro
 * Direto title has no ticker to fill.
 */
function withInferredAssetType(
  candidate: CandidateAsset,
): CandidateAsset {
  if (candidate.hints.assetType !== undefined) {
    return candidate;
  }

  const b3Entry = findListedB3CatalogEntry(candidate);

  if (b3Entry) {
    return {
      ...candidate,
      hints: {
        ...candidate.hints,
        assetType: b3Entry.assetType,
        ticker: candidate.hints.ticker ?? b3Entry.ticker,
      },
    };
  }

  const treasuryEntry = findTesouroDiretoCatalogEntry(candidate);

  if (treasuryEntry) {
    return {
      ...candidate,
      hints: {
        ...candidate.hints,
        assetType: treasuryEntry.assetType,
      },
    };
  }

  return candidate;
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
      withInferredAssetType(
        input.candidateAsset,
      );

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