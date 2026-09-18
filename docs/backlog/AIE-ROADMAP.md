# AIE Roadmap

## Vision

Build a deterministic Asset Intelligence Engine capable of transforming ambiguous user-provided assets into verified financial assets supported by evidence.

---

# Epic 1 — Foundation ✅

Status: Completed

- Contracts
- Provider Registry
- Entity Registry
- Verification Policy
- Evidence Orchestrator
- Resolution Planner

---

# Epic 2 — Asset Resolution Engine

Status: Planned

Goal:

Coordinate the complete resolution workflow.

Deliverables:

- AssetResolutionEngine
- ResolutionResult
- ResolutionState
- Investigation lifecycle
- Planner integration
- Policy integration
- Registry integration

---

# Epic 3 — Evidence Providers

Status: Planned

Providers

- Registry
- ANBIMA
- CVM
- B3
- BACEN

Future

- Bloomberg
- Morningstar
- Internal APIs

---

# Epic 4 — User Clarification

Status: Planned

Goal

When evidence is insufficient:

Generate deterministic clarification questions.

Examples

- Which issuer?
- Which maturity?
- Which ticker?
- Which index?
- Which series?

---

# Epic 5 — Portfolio Integration

Status: Planned

Goal

Integrate AIE into the Aligna portfolio workflow.

Includes

- onboarding
- portfolio import
- reconciliation
- monitoring

---

# Epic 6 — AI Assistance

Status: Planned

Goal

Use LLMs only after deterministic resolution fails.

Rules

- LLM never verifies assets.
- LLM only proposes hypotheses.
- Every hypothesis requires evidence.
- Human remains in control.