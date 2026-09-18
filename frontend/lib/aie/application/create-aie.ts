import {
    EvidenceProviderRegistry,
  } from "../providers";
  
  import {
    VerificationPolicy,
  } from "../policy";
  
  import {
    ResolutionPlanner,
  } from "../planner/resolution-planner";
  
  import {
    EvidenceOrchestrator,
  } from "../orchestrator/evidence-orchestrator";
  
  import {
    AssetResolutionEngine,
  } from "../resolution/asset-resolution-engine";
  
  export function createAie() {
    const providerRegistry =
      new EvidenceProviderRegistry();
  
    const verificationPolicy =
      new VerificationPolicy();
  
    const resolutionPlanner =
      new ResolutionPlanner();
  
    const orchestrator =
      new EvidenceOrchestrator(
        providerRegistry,
        verificationPolicy,
      );
  
    return new AssetResolutionEngine(
      verificationPolicy,
      resolutionPlanner,
      orchestrator,
    );
  }