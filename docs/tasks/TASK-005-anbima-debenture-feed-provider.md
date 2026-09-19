# TASK-005 — ANBIMA Debenture Feed Provider

## Objective

Implement the first official AIE evidence provider using the ANBIMA Feed for debentures.

Initial source:

ANBIMA Feed

Preços e Índices

Debêntures

Mercado Secundário

## Architectural Boundary

The implementation must preserve the separation between:

- HTTP/authentication infrastructure;

- ANBIMA response parsing;

- EvidenceProvider behavior;

- VerificationPolicy.

ANBIMAProvider must never create VerifiedAsset directly.

## Official Endpoint

Production:

GET /feed/precos-indices/v1/debentures/mercado-secundario

The API may return fields including:

- codigo_ativo

- emissor

- data_referencia

- data_vencimento

- percentual_taxa

- grupo

## Initial Identification Strategy

The first implementation will support deterministic lookup by:

1. exact debenture code, when available;

2. no fuzzy verification;

3. no issuer-name-only verification.

Issuer text may support investigation but must not independently establish instrument identity.

## Evidence Rules

When an exact official instrument code is found:

- source = ANBIMA

- strength = primary

- identity evidence may be produced

- issuer evidence may be produced from the same official record

All evidence must preserve:

- provider version

- source reference

- collection timestamp

- official response metadata

## Authentication

Credentials must never be committed.

Production credentials will be provided using environment variables.

No secret may appear in:

- source code

- tests

- fixtures

- logs

- git history

## Testing

Tests must use fake/mocked ANBIMA responses.

Unit tests must not call the real ANBIMA API.

## Out of Scope

- ANBIMA Input / Títulos Privados

- CRI/CRA

- funds

- production credentials

- caching

- retry infrastructure

- fuzzy matching

## Acceptance Criteria

- ANBIMA HTTP boundary is isolated.

- ANBIMA debenture provider implements EvidenceProvider.

- Exact instrument-code match produces official evidence.

- Unknown instruments produce found = false.

- Network/auth failures produce ProviderError.

- No fuzzy matching.

- No secrets are committed.

- TypeScript passes.

- All AIE tests pass.

## Amendment 001 (see ADR-003)

The Evidence Rules above are superseded for the issuer field:

- identity evidence from an exact official instrument code: strength = primary;
- issuer evidence from the textual emissor: strength = supporting.

The provider looks up by instrumentCode (not ticker) through
AnbimaDebentureFeedClient.findSecondaryMarketDebentureByCode(instrumentCode).
A textual issuer name is not a canonical issuer identity, so an ANBIMA record
alone never produces a VerifiedAsset.
