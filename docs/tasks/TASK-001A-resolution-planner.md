# TASK-001A — Resolution Planner

## Objective

Implement a deterministic planner that decides the next investigation steps required to resolve a CandidateAsset.

The planner must not verify assets.

Its only responsibility is to determine what evidence is still missing and which sources should be consulted next.

## Inputs

- CandidateAsset
- VerificationDecision
- existing AssetEvidence[]

## Output

A ResolutionPlan containing ordered investigation steps.

## Required Behavior

1. The planner must inspect unresolved fields from VerificationDecision.
2. The planner must choose sources according to the CandidateAsset type.
3. Official sources must precede customer clarification.
4. Registry may be consulted early, but Registry evidence remains supporting evidence only.
5. Customer clarification is always the last step.
6. The planner must never create VerifiedAsset.
7. The planner must never fabricate identifiers or entities.
8. The planner must be deterministic for the same input.

## Initial Search Plans

### Debenture

REGISTRY
→ ANBIMA
→ CVM
→ B3
→ USER

### CRI / CRA

REGISTRY
→ ANBIMA
→ CVM
→ B3
→ USER

### FII / Fund

REGISTRY
→ CVM
→ B3
→ ANBIMA
→ USER

### LCA / LCI / CDB

REGISTRY
→ BACEN
→ USER

### Stock / ETF / BDR

REGISTRY
→ B3
→ CVM
→ USER

### Unknown

REGISTRY
→ USER

## Acceptance Criteria

- ResolutionPlanner exists.
- It returns an ordered ResolutionPlan.
- Debenture plan follows REGISTRY → ANBIMA → CVM → B3 → USER.
- USER is always last.
- No fuzzy matching is introduced.
- No external API is called.
- No asset is verified by the planner.
- Vitest coverage exists.
- `npx tsc --noEmit` passes.
- `npm test -- --run lib/aie` passes.

## Out of Scope

- Calling providers
- Creating Evidence
- Creating VerifiedAsset
- UI
- Method Core
