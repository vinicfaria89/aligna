# TASK-002 — Registry Provider

## Objective

Implement the first concrete AIE evidence provider using the local EntityRegistry.

The RegistryProvider receives a ProviderQuery and searches the EntityRegistry using deterministic exact matching.

It must produce supporting AssetEvidence when a Registry entity is found.

## Required Behavior

1. Search by identifier first when available:
   - ISIN
   - CNPJ
   - ticker

2. If no identifier matches, search by exact normalized alias.

3. Do not use fuzzy matching.

4. Registry evidence must always use:
   - source = REGISTRY
   - strength = supporting

5. RegistryProvider must never create VerifiedAsset.

6. RegistryProvider must never fabricate missing data.

7. If no entity matches:
   - searched = true
   - found = false
   - evidence = []

8. If an entity matches:
   - searched = true
   - found = true
   - return identity evidence with provenance metadata.

## Out of Scope

- External APIs
- ANBIMA
- CVM
- B3
- BACEN
- Customer clarification
- Persistence

## Acceptance Criteria

- RegistryProvider implements EvidenceProvider.
- Exact identifier resolution works.
- Exact alias resolution works.
- Fuzzy alias resolution does not occur.
- Evidence strength is supporting.
- TypeScript passes.
- AIE tests pass.