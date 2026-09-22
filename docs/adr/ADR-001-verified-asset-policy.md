# ADR-001 — Verified Asset Policy

## Status

Accepted

---

## Context

Financial analysis is only reliable when the identity of an asset is known with sufficient certainty.

Customers frequently provide incomplete information.

Registry entries, OCR, AI extraction and document parsing may generate hypotheses but not verified identities.

---

## Decision

The system shall never create a VerifiedAsset unless the required evidence defined by the Verification Policy is satisfied.

Registry matches alone are insufficient.

AI-generated hypotheses are insufficient.

Customer clarification is used only when official or internal sources cannot resolve the identity.

---

## Consequences

### Advantages

- Auditable results.
- Explainable decisions.
- Lower risk of incorrect analysis.
- Consistent behavior across providers.

### Trade-offs

- Some portfolios will require user interaction.
- Resolution may take longer.
- Coverage increases progressively as new knowledge sources are added.
