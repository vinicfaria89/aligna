# AIE Architecture

## 1. Purpose

The Aligna Intelligence Engine (AIE) transforms uncertain financial information into verified, explainable and auditable knowledge before financial analysis.

The AIE does not perform investment analysis directly.

Its responsibility is to establish what the asset is, what evidence supports that identity, and whether the available information is sufficient for downstream analysis.

---

## 2. Core Principle

The AIE follows a Zero Assumption Policy.

If evidence is insufficient:

- do not guess;
- do not infer identity as fact;
- do not fabricate identifiers;
- do not create VerifiedAsset.

The system must instead return an explicit unresolved state.

---

## 3. High-Level Flow

Document / Portfolio Input

→ Parser

→ CandidateAsset

→ AssetResolutionEngine

→ VerificationPolicy

→ ResolutionPlanner

→ ProviderExecutionPipeline

→ EvidenceProviders

→ AssetEvidence

→ VerificationPolicy

→ EvidenceOrchestrator

→ InvestigationCase

→ VerifiedAsset

→ Knowledge Graph

→ Method Core

→ Check-up

---

## 4. Domain Objects

### CandidateAsset

Represents an asset candidate extracted from a customer document or portfolio source.

It may contain hints such as:

- asset type;
- ticker;
- ISIN;
- CNPJ;
- issuer name;
- fund name;
- maturity;
- currency;
- amount.

A CandidateAsset is not verified.

---

### AssetEvidence

Represents a piece of evidence about an asset.

Evidence includes:

- source;
- field;
- strength;
- value;
- timestamp;
- provider version;
- source reference;
- metadata.

Evidence must always preserve provenance.

---

### InvestigationCase

Represents the complete investigation state for a CandidateAsset.

It contains:

- candidate asset;
- evidence;
- search executions;
- unresolved fields;
- investigation status;
- timestamps.

---

### VerifiedAsset

Represents an asset whose required identity evidence has satisfied the VerificationPolicy.

Only VerifiedAsset may be consumed by downstream analytical components that depend on verified identity.

---

## 5. Resolution States

Supported resolution states:

- verified
- needs-more-evidence
- needs-user
- conflict
- blocked

### verified

All required evidence for the intended verification policy is present.

### needs-more-evidence

Additional automatic knowledge sources remain available.

### needs-user

Applicable automatic sources have been exhausted and additional customer information is required.

### conflict

Relevant evidence sources disagree in a blocking way.

### blocked

Resolution cannot continue safely.

---

## 6. Components

### AssetResolutionEngine

Role:

Coordinate the complete asset resolution use case.

Responsibilities:

- receive CandidateAsset;
- evaluate current evidence;
- request ResolutionPlan;
- invoke ProviderExecutionPipeline;
- re-evaluate evidence;
- invoke EvidenceOrchestrator;
- return ResolutionResult.

Must not:

- implement provider-specific search logic;
- perform fuzzy matching;
- fabricate evidence;
- bypass VerificationPolicy.

---

### VerificationPolicy

Role:

Determine whether evidence requirements are satisfied.

Responsibilities:

- evaluate evidence;
- identify unresolved fields;
- approve or deny verification.

Must remain deterministic and infrastructure-independent.

Registry evidence alone does not verify an asset.

---

### ResolutionPlanner

Role:

Determine which evidence sources should be consulted and in which order.

Responsibilities:

- inspect asset type;
- inspect unresolved fields;
- create ordered ResolutionPlan.

Must not:

- execute providers;
- create evidence;
- verify assets.

---

### ProviderExecutionPipeline

Role:

Execute evidence providers according to the ResolutionPlan.

Responsibilities:

- preserve plan order;
- locate registered providers;
- evaluate provider supports(query);
- execute provider searches;
- collect evidence;
- record SearchExecution;
- expose provider failures without fabricating evidence.

The pipeline must not independently determine final verification.

---

### EvidenceProvider

Role:

Represent one source of knowledge.

Examples:

- RegistryProvider
- ANBIMAProvider
- CVMProvider
- B3Provider
- BACENProvider

Provider responsibilities:

- receive ProviderQuery;
- query one source;
- return ProviderResult;
- preserve provenance.

A provider never creates VerifiedAsset.

---

### EvidenceProviderRegistry

Role:

Hold the available EvidenceProvider implementations.

Responsibilities:

- register providers;
- retrieve provider by ID;
- prevent duplicate provider registration;
- expose available providers.

---

### EntityRegistry

Role:

Provide deterministic internal knowledge lookup.

Supported lookup strategies:

- exact identifier;
- exact normalized alias.

Fuzzy matching is forbidden for verification.

Registry is supportive knowledge, not an official authority.

---

### EvidenceOrchestrator

Role:

Build the investigation output after evidence collection and policy evaluation.

Responsibilities:

- produce InvestigationCase;
- preserve evidence;
- preserve search history;
- create VerifiedAsset only after policy approval.

Must not:

- execute providers;
- decide provider order;
- own external integrations.

---

## 7. Evidence Sources

Initial knowledge sources:

### Registry

Fast internal deterministic lookup.

Evidence strength:

supporting

---

### ANBIMA

Primary source for selected investment fund and private-credit data.

Integration must preserve official identifiers and source references.

---

### CVM

Primary regulatory source for funds, companies, offerings and regulated entities where applicable.

---

### B3

Primary market infrastructure source for instruments, tickers and market identifiers where applicable.

---

### BACEN

Primary source for regulated financial institutions and institutional identity where applicable.

---

### Customer

Customer clarification is the final resolution source.

Typical requested information may include:

- ticker;
- ISIN;
- CNPJ;
- series;
- issue number;
- full product name;
- redacted screenshot.

Customer information should be externally verified whenever possible.

---

## 8. Source Ordering

General principle:

Registry

→ applicable official sources

→ customer clarification

Exact provider order depends on asset type.

Examples:

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

---

## 9. Provider Execution

Provider execution must produce:

- collected evidence;
- search execution history.

Conceptually:

ProviderExecutionResult

- evidence
- searches

Each SearchExecution records:

- provider;
- startedAt;
- finishedAt;
- result status;
- evidence IDs;
- error information when applicable.

---

## 10. Stopping Rule

The resolution flow may stop provider execution when VerificationPolicy determines that the required evidence has been satisfied.

ProviderExecutionPipeline must never redefine verification requirements.

VerificationPolicy remains the authority for evidence sufficiency.

---

## 11. Client Clarification

Customer clarification is used only after applicable automatic sources have been exhausted.

The system should ask for the minimum information necessary.

Example:

Instead of:

"Which asset is this?"

Prefer:

"We identified this as a debenture, but could not confirm the specific issue. Can you provide the ISIN, B3 code, series, or a redacted screenshot of the investment details?"

The user must be allowed to answer:

"I don't know."

---

## 12. Privacy

Provider queries must minimize customer data.

Do not send external providers information such as:

- customer name;
- CPF;
- account number;
- balance;
- total wealth;
- unrelated portfolio positions.

Prefer instrument identifiers only.

---

## 13. AI Boundary

AI is not evidence.

AI may:

- normalize text;
- classify candidates;
- identify possible search strategies;
- summarize evidence;
- generate hypotheses.

AI may not independently verify:

- identity;
- issuer;
- ISIN;
- ticker;
- institution.

Any AI hypothesis must be verified through evidence.

---

## 14. Dependency Direction

Preferred dependency direction:

application

→ resolution

→ planner / policy / execution / orchestrator

→ providers

→ registry / infrastructure

Domain contracts must not depend on external provider implementations.

External APIs must not leak into Method Core.

---

## 15. Integration with Method Core

The AIE answers:

"What asset is this, and what facts are verified?"

The Method Core answers:

"What do these verified facts mean for the portfolio?"

These responsibilities must remain separate.

Method Core must not consume:

- raw OCR;
- raw statements;
- unresolved CandidateAsset;
- AI hypotheses.

---

## 16. Initial Version Boundary

AIE v1 focuses on:

- deterministic asset resolution;
- evidence provenance;
- internal registry;
- official Brazilian sources;
- customer clarification;
- VerifiedAsset generation.

Out of scope for the first version:

- machine-learning-based identity verification;
- fuzzy verification;
- autonomous AI verification;
- distributed cache;
- provider parallelization;
- advanced retry infrastructure.

These features may be evaluated later through separate ADRs.

---

## 17. Architectural Invariants

1. CandidateAsset is not VerifiedAsset.
2. Evidence must preserve provenance.
3. Registry alone cannot verify identity.
4. AI cannot verify identity.
5. Fuzzy matching cannot produce verification.
6. VerificationPolicy owns evidence sufficiency.
7. ProviderExecutionPipeline owns provider execution.
8. EvidenceOrchestrator does not execute providers.
9. Customer clarification is a last-resort source.
10. Method Core consumes verified knowledge only.

---

## 18. Next Implementation Order

1. ProviderExecutionPipeline
2. EvidenceOrchestrator boundary refactor
3. AssetResolutionEngine integration
4. createAie composition update
5. Golden scenario: DEB PETROBRAS
6. ANBIMAProvider
7. CVMProvider
8. B3Provider
9. BACENProvider
10. User Clarification workflow
11. Portfolio ingestion integration

