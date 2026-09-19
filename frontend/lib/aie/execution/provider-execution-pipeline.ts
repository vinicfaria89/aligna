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
        if (
          step.source === "USER"
        ) {
          break;
        }
  
        const provider =
          this.providers.get(
            step.source,
          );
  
        /*
         * A plan may contain a source whose
         * provider has not been registered yet.
         *
         * Example:
         * ANBIMA may exist in the plan before
         * ANBIMAProvider is implemented.
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
  
        const startedAt =
          now();
  
        try {
          const result =
            await provider.search(
              input.query,
            );
  
          const finishedAt =
            now();
  
          /*
           * Evidence returned together with
           * an explicit provider error is not
           * accepted into the evidence chain.
           */
          if (result.error) {
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
  
            continue;
          }
  
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
        } catch (error) {
          const finishedAt =
            now();
  
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
      }
  
      return {
        evidence,
        searches,
      };
    }
  }