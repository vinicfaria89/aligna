# TASK-004 — Integrate ProviderExecutionPipeline

## Objective

Integrate ProviderExecutionPipeline into the AssetResolutionEngine while preserving the architectural boundaries defined in ADR-002.

## Required Behavior

1. AssetResolutionEngine becomes asynchronous.

2. AssetResolutionEngine coordinates:

   - VerificationPolicy

   - ResolutionPlanner

   - ProviderExecutionPipeline

   - EvidenceOrchestrator

3. AssetResolutionEngine must not execute provider-specific logic directly.

4. ProviderExecutionPipeline executes providers in ResolutionPlan order.

5. ProviderExecutionPipeline returns:

   - collected evidence

   - SearchExecution history

6. AssetResolutionEngine merges:

   - existing evidence

   - newly collected provider evidence

7. EvidenceOrchestrator receives:

   - CandidateAsset

   - complete evidence

   - SearchExecution[]

8. Registry-only evidence must remain insufficient for VERIFIED.

9. Existing tests must remain green.

## Golden Scenario

Input:

DEB PETROBRAS

Expected:

CandidateAsset

→ ResolutionPlanner

→ ProviderExecutionPipeline

→ RegistryProvider

→ supporting identity evidence

→ VerificationPolicy

→ EvidenceOrchestrator

→ NEEDS_MORE_EVIDENCE

The result must not be VERIFIED.

## Acceptance Criteria

- AssetResolutionEngine.resolve() is async.

- ProviderExecutionPipeline is injected into AssetResolutionEngine.

- EvidenceOrchestrator no longer depends on EvidenceProviderRegistry.

- SearchExecution history is preserved in InvestigationCase.

- createAie() composes all dependencies correctly.

- Golden scenario is covered by tests.

- npx tsc --noEmit passes.

- npm test -- --run lib/aie passes.