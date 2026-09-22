import type {
  AssetEvidence,
  EvidenceField,
} from "../contracts";

export const VERIFICATION_POLICY_VERSION =
  "1.0.0";

export type VerificationDecisionStatus =
  | "verified"
  | "needs-more-evidence";

export interface VerificationDecision {
  status: VerificationDecisionStatus;

  unresolvedFields: EvidenceField[];

  evidenceIds: string[];

  policyVersion: string;
}

const REQUIRED_FIELDS: EvidenceField[] =
  [
    "identity",
    "issuer",
  ];

function isQualifyingPrimary(
  evidence: AssetEvidence,
  field: EvidenceField,
): boolean {
  return (
    evidence.strength ===
      "primary" &&
    evidence.field === field &&
    evidence.source !==
      "REGISTRY"
  );
}

export class VerificationPolicy {
  readonly version =
    VERIFICATION_POLICY_VERSION;

  evaluate(
    evidence: AssetEvidence[],
  ): VerificationDecision {
    const unresolvedFields =
      REQUIRED_FIELDS.filter(
        (field) =>
          !evidence.some(
            (item) =>
              isQualifyingPrimary(
                item,
                field,
              ),
          ),
      );

    const evidenceIds = evidence
      .filter((item) =>
        REQUIRED_FIELDS.some(
          (field) =>
            isQualifyingPrimary(
              item,
              field,
            ),
        ),
      )
      .map((item) => item.id);

    if (
      unresolvedFields.length >
      0
    ) {
      return {
        status:
          "needs-more-evidence",
        unresolvedFields,
        evidenceIds,
        policyVersion:
          this.version,
      };
    }

    return {
      status: "verified",
      unresolvedFields: [],
      evidenceIds,
      policyVersion:
        this.version,
    };
  }
}
