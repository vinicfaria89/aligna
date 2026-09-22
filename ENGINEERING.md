# Aligna Engineering Guide

## Principles

- Correctness over speed.
- Explicit evidence over inference.
- Small, reviewable changes.
- Strict TypeScript.
- Tests required for new behavior.
- No silent architecture changes.
- No fuzzy identity resolution producing verified assets.
- Registry is supportive knowledge, not official authority.
- AI output is never conclusive evidence.

## Development Flow

1. Work on a feature branch.
2. Read existing architecture and tests.
3. Make the smallest coherent change.
4. Run:

   - npx tsc --noEmit
   - npm test -- --run lib/aie

5. Review the diff.
6. Commit only after tests pass.

## Commit Style

Examples:

feat(aie): add entity registry loader

test(aie): add registry conflict coverage

docs(aie): document evidence policy

## Pull Request Rules

Every PR should state:

- problem solved
- files changed
- tests added or updated
- architectural impact
- known limitations

## AIE Invariants

- CandidateAsset is not a VerifiedAsset.
- Evidence must include provenance.
- VerifiedAsset requires policy approval.
- Registry alone must not verify an asset.
- Missing critical evidence blocks dependent analysis.
- Client clarification is a last-resort source.
