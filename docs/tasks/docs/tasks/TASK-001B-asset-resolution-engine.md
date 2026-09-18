# TASK-001B — Asset Resolution Engine

## Objective

Implement the first end-to-end asset resolution engine using the existing AIE components.

The engine coordinates:

CandidateAsset
→ ResolutionPlanner
→ Evidence Sources
→ VerificationPolicy
→ EvidenceOrchestrator
→ resolution result

## Rules

- Never bypass VerificationPolicy.
- Registry evidence alone cannot verify an asset.
- Official evidence should be exhausted before NEEDS_USER.
- Preserve the complete evidence chain.
- Do not modify CandidateAsset.
- Do not fabricate missing data.
- No fuzzy-only verification.

## First Golden Scenario

Input:

DEB PETROBRAS

Expected initial behavior:

Registry match may be found.

Registry evidence is supporting only.

Without official primary identity and issuer evidence:

result = NEEDS_MORE_EVIDENCE

The result must not be VERIFIED.

## Acceptance Criteria

- AssetResolutionEngine exists.
- It uses ResolutionPlanner.
- It reuses EvidenceOrchestrator.
- It reuses VerificationPolicy.
- Registry-only scenario remains unresolved.
- Tests cover the golden scenario.
- TypeScript passes.
- AIE tests pass.