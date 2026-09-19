# ADR-003 - instrumentCode semantics and ANBIMA evidence strength

## Status

Accepted

## Context

Official sources identify instruments with their own codes (for example the
ANBIMA debenture code). Reusing "ticker" for these codes mixes two different
identifier namespaces and makes exact resolution ambiguous.

The ANBIMA debenture feed exposes a textual "emissor" (issuer name), not a
canonical issuer identifier such as a CNPJ or a registry entity id.

## Decision

1. instrumentCode is a distinct identifier on CandidateAssetHints, ProviderQuery
   and the EntityRegistry (RegistryIdentifierKind).

   - ticker: trading ticker when applicable
   - isin: ISIN
   - cnpj: Brazilian legal entity identifier
   - instrumentCode: official instrument code used by an applicable official source

   Kinds never cross namespaces. Matching is exact after normalization
   (trim, uppercase). No fuzzy matching.

2. RegistryProvider lookup priority is deterministic:
   instrumentCode, isin, cnpj, ticker, exact normalized alias.
   Registry evidence remains supporting evidence only.

3. For an exact ANBIMA debenture record:

   - identity: source ANBIMA, strength primary, value codigo_ativo
   - issuer: source ANBIMA, strength supporting, value emissor

   A textual issuer name is not a canonical issuer identity. An ANBIMA record
   alone therefore never satisfies VerificationPolicy. Canonical issuer evidence
   must come from another reliable resolution step or source.

4. ProviderExecutionPipeline accepts an optional shouldStop callback supplied by
   AssetResolutionEngine, which wraps VerificationPolicy. The pipeline never
   imports or evaluates VerificationPolicy.

## Consequences

- Exact official codes are resolvable without overloading ticker.
- The 100%-certainty principle is preserved: no VerifiedAsset from a name.
- Debentures need a second reliable source for the issuer before verification.
