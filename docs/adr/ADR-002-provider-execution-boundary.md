# ADR-002 — Provider Execution Boundary

## Status

Accepted

## Context

The AIE resolves ambiguous financial assets by collecting evidence from multiple sources.

The current architecture already separates:

- planning;
- evidence providers;
- verification policy;
- orchestration;
- asset resolution.

As additional providers are introduced, execution responsibility must remain explicit to avoid duplicated logic and hidden coupling.

## Decision

Provider execution will be handled exclusively by a dedicated ProviderExecutionPipeline.

The AssetResolutionEngine coordinates the use case but does not directly implement provider-specific execution logic.

The EvidenceOrchestrator does not execute providers.

## Responsibilities

### AssetResolutionEngine

Responsible for:

- receiving a CandidateAsset;
- evaluating current evidence;
- requesting a ResolutionPlan;
- invoking ProviderExecutionPipeline;
- invoking VerificationPolicy;
- invoking EvidenceOrchestrator;
- returning ResolutionResult.

It must not:

- know provider API details;
- implement matching;
- execute provider-specific logic.

### ResolutionPlanner

Responsible only for producing an ordered ResolutionPlan.

It must not:

- execute providers;
- create evidence;
- verify assets.

### ProviderExecutionPipeline

Responsible for:

- executing providers in plan order;
- checking provider availability;
- checking provider supports(query);
- collecting AssetEvidence;
- recording SearchExecution;
- preserving execution order;
- stopping when instructed by the coordinating resolution flow.

It must not:

- create VerifiedAsset;
- fabricate evidence;
- independently decide final verification.

### EvidenceProvider

Responsible only for querying a single knowledge source and returning ProviderResult.

Examples:

- RegistryProvider
- ANBIMAProvider
- CVMProvider
- B3Provider
- BACENProvider

A provider never determines final verification.

### VerificationPolicy

Responsible only for evaluating evidence requirements.

It determines whether required evidence exists for verification.

### EvidenceOrchestrator

Responsible for producing the InvestigationCase and VerifiedAsset after policy approval.

It must not:

- search providers;
- own provider execution;
- infer missing evidence.

## Execution Result

Provider execution must preserve both evidence and search history.

Conceptually:

ProviderExecutionResult

- evidence
- searches

Each SearchExecution should identify:

- provider;
- execution status;
- timestamps;
- evidence produced;
- error information when applicable.

## Source Order

The initial resolution strategy remains:

Registry
→ official sources
→ customer clarification

Registry evidence remains supporting evidence only unless a future ADR explicitly changes this policy.

## Resolution States

The supported final resolution states are:

- verified
- needs-more-evidence
- needs-user
- conflict
- blocked

No additional states should be introduced without architectural review.

## Stopping Rule

The resolution flow may stop executing additional providers when the VerificationPolicy determines that the required evidence has been satisfied.

The ProviderExecutionPipeline itself must not redefine verification rules.

## Consequences

Advantages:

- provider execution has a single owner;
- easier provider testing;
- easier audit trail;
- easier future retry, timeout and caching strategies;
- prevents AssetResolutionEngine from becoming a God Object;
- EvidenceOrchestrator remains independent of infrastructure.

Trade-offs:

- introduces one additional architectural component;
- requires a small refactor of the current AssetResolutionEngine and EvidenceOrchestrator.

## Constraints

This ADR must be followed before integrating external providers such as:

- ANBIMA
- CVM
- B3
- BACEN

External provider integration must not begin until ProviderExecutionPipeline is implemented and tested.
