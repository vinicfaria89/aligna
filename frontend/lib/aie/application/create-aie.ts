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

import {
  EvidenceProviderRegistry,
} from "../providers";

import {
  AssetResolutionEngine,
} from "../resolution/asset-resolution-engine";

export function createAie() {
  const providers =
    new EvidenceProviderRegistry();

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