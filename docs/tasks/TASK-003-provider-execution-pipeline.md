# TASK-003 — Provider Execution Pipeline

## Objective

Allow the Asset Resolution Engine to execute registered evidence providers according to the ResolutionPlan.

The first supported execution source is REGISTRY.

## Required Behavior

1. Build a ResolutionPlan for the CandidateAsset.
2. Execute only providers that:
  - are present in the plan;
  - support the ProviderQuery.
3. Preserve provider execution order.
4. Merge newly collected evidence with existing evidence.
5. Re-evaluate VerificationPolicy after evidence collection.
6. Registry evidence remains supporting evidence only.
7. Registry evidence alone must never produce VERIFIED.
8. Provider failures must not fabricate evidence.
9. The engine must preserve all collected evidence in the InvestigationCase.

## Initial Scope

Supported execution:

- REGISTRY

Not yet supported:

- ANBIMA
- CVM
- B3
- BACEN
- USER clarification

## Golden Scenario

Input:

DEB PETROBRAS

Registry:

alias = DEB PETROBRAS

Expected:

CandidateAsset

→ ResolutionPlanner

→ RegistryProvider

→ supporting identity evidence

→ VerificationPolicy

→ NEEDS_MORE_EVIDENCE

The result must not be VERIFIED.

## Acceptance Criteria

- RegistryProvider can be registered in EvidenceProviderRegistry.
- AssetResolutionEngine executes REGISTRY automatically.
- Supporting evidence is added to the InvestigationCase.
- Registry-only resolution remains NEEDS_MORE_EVIDENCE.
- Provider execution order is deterministic.
- Existing tests remain green.
- TypeScript passes.
- All AIE tests pass.

