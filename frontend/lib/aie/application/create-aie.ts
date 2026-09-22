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
  EvidenceProvider,
} from "../providers";

import {
  EvidenceProviderRegistry,
} from "../providers";

import {
  AssetResolutionEngine,
} from "../resolution/asset-resolution-engine";

export interface CreateAieOptions {
  /**
   * Providers to register. Nothing is registered implicitly: without options
   * the engine has no providers and no external source is ever contacted.
   */
  providers?: readonly EvidenceProvider[];
}

export function createAie(
  options: CreateAieOptions = {},
) {
  const providers =
    new EvidenceProviderRegistry();

  for (
    const provider
    of options.providers ?? []
  ) {
    providers.register(provider);
  }

  const policy =
    new VerificationPolicy();

  const planner =
    new ResolutionPlanner();

  const pipeline =
    new ProviderExecutionPipeline(
      providers,
    );

  const orchestrator =
    new EvidenceOrchestrator(
      policy,
    );

  return new AssetResolutionEngine(
    policy,
    planner,
    pipeline,
    orchestrator,
  );
}
