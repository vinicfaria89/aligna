import type {
  AssetEvidence,
  SearchExecution,
} from "../contracts";

import type {
  ResolutionPlan,
} from "../planner/resolution-plan";

import type {
  EvidenceProviderRegistry,
  ProviderQuery,
} from "../providers";

export interface ProviderExecutionInput {
  plan: ResolutionPlan;

  query: ProviderQuery;

  existingEvidence?: AssetEvidence[];

  now?: () => string;

  /**
   * Stopping rule owned by the coordinating flow (AssetResolutionEngine).
   *
   * It is consulted after each provider search that was accepted into the
   * evidence chain. When it returns true, later providers are not executed.
   *
   * The pipeline never decides evidence sufficiency itself: that authority
   * stays with VerificationPolicy, which the coordinator wraps in this callback.
   */
  shouldStop?: (
    evidence: AssetEvidence[],
  ) => boolean;
}

export interface ProviderExecutionResult {
  evidence: AssetEvidence[];

  searches: SearchExecution[];
}

export class ProviderExecutionPipeline {
  constructor(
    private readonly providers:
      EvidenceProviderRegistry,
  ) {}

  async execute(
    input: ProviderExecutionInput,
  ): Promise<ProviderExecutionResult> {
    const evidence: AssetEvidence[] = [
      ...(input.existingEvidence ?? []),
    ];

    const searches: SearchExecution[] =
      [];

    const now =
      input.now ??
      (() =>
        new Date().toISOString());

    for (
      const step
      of input.plan.steps
    ) {
      /*
       * USER is not an EvidenceProvider.
       *
       * Reaching USER means automatic
       * provider execution has ended.
       */
      if (step.source === "USER") {
        break;
      }

      const provider =
        this.providers.get(
          step.source,
        );

      /*
       * A plan may contain a source whose
       * provider has not been registered yet.
       */
      if (!provider) {
        continue;
      }

      if (
        !provider.supports(
          input.query,
        )
      ) {
        continue;
      }

      const startedAt = now();

      let accepted = false;

      try {
        const result =
          await provider.search(
            input.query,
          );

        const finishedAt = now();

        if (result.error) {
          /*
           * Evidence returned together with an
           * explicit provider error is not
           * accepted into the evidence chain.
           */
          searches.push({
            providerId:
              provider.id,

            startedAt,

            finishedAt,

            status:
              "failed",

            evidenceIds:
              [],

            error:
              `${result.error.code}: ${result.error.message}`,
          });
        } else {
          evidence.push(
            ...result.evidence,
          );

          searches.push({
            providerId:
              provider.id,

            startedAt,

            finishedAt,

            status:
              result.found
                ? "success"
                : "not-found",

            evidenceIds:
              result.evidence.map(
                (item) =>
                  item.id,
              ),
          });

          accepted = true;
        }
      } catch (error) {
        const finishedAt = now();

        searches.push({
          providerId:
            provider.id,

          startedAt,

          finishedAt,

          status:
            "failed",

          evidenceIds:
            [],

          error:
            error instanceof Error
              ? error.message
              : String(error),
        });
      }

      /*
       * Evaluated outside the provider try/catch:
       * a failing stopping rule is a coordinator
       * bug, not a provider failure.
       */
      if (
        accepted &&
        input.shouldStop?.([
          ...evidence,
        ])
      ) {
        break;
      }
    }

    return {
      evidence,
      searches,
    };
  }
}
