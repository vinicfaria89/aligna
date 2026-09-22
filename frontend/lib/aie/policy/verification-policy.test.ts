import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  AssetEvidence,
} from "../contracts";

import {
  VerificationPolicy,
} from "./verification-policy";

function createEvidence(
  overrides: Partial<AssetEvidence> &
    Pick<
      AssetEvidence,
      "id" | "field"
    >,
): AssetEvidence {
  return {
    assetId: "asset-1",
    source: "CVM",
    strength: "primary",
    value: overrides.field,
    collectedAt:
      "2026-09-18T00:00:00.000Z",
    ...overrides,
  };
}

describe(
  "VerificationPolicy",
  () => {
    const policy =
      new VerificationPolicy();

    it(
      "keeps the case as needs-more-evidence when evidence is absent",
      () => {
        const decision =
          policy.evaluate([]);

        expect(
          decision.status,
        ).toBe(
          "needs-more-evidence",
        );
        expect(
          decision.unresolvedFields,
        ).toEqual([
          "identity",
          "issuer",
        ]);
      },
    );

    it(
      "does not verify from registry evidence alone",
      () => {
        const decision =
          policy.evaluate([
            createEvidence({
              id: "e-identity",
              field: "identity",
              source: "REGISTRY",
              value: "PETR4",
            }),
            createEvidence({
              id: "e-issuer",
              field: "issuer",
              source: "REGISTRY",
              value:
                "Petrobras",
            }),
          ]);

        expect(
          decision.status,
        ).toBe(
          "needs-more-evidence",
        );
        expect(
          decision.evidenceIds,
        ).toEqual([]);
      },
    );

    it(
      "requires primary evidence for both identity and issuer",
      () => {
        const identityOnly =
          policy.evaluate([
            createEvidence({
              id: "e-identity",
              field: "identity",
              value: "PETR4",
            }),
          ]);

        const issuerOnly =
          policy.evaluate([
            createEvidence({
              id: "e-issuer",
              field: "issuer",
              value:
                "Petrobras",
            }),
          ]);

        const supportingBoth =
          policy.evaluate([
            createEvidence({
              id: "e-identity",
              field: "identity",
              strength:
                "supporting",
              value: "PETR4",
            }),
            createEvidence({
              id: "e-issuer",
              field: "issuer",
              strength: "weak",
              value:
                "Petrobras",
            }),
          ]);

        expect(
          identityOnly.status,
        ).toBe(
          "needs-more-evidence",
        );
        expect(
          identityOnly.unresolvedFields,
        ).toEqual(["issuer"]);

        expect(
          issuerOnly.status,
        ).toBe(
          "needs-more-evidence",
        );
        expect(
          issuerOnly.unresolvedFields,
        ).toEqual(["identity"]);

        expect(
          supportingBoth.status,
        ).toBe(
          "needs-more-evidence",
        );
      },
    );

    it(
      "verifies only with primary identity and issuer evidence",
      () => {
        const decision =
          policy.evaluate([
            createEvidence({
              id: "e-identity",
              field: "identity",
              value: "PETR4",
            }),
            createEvidence({
              id: "e-issuer",
              field: "issuer",
              source: "ANBIMA",
              value:
                "Petrobras",
            }),
          ]);

        expect(
          decision.status,
        ).toBe("verified");
        expect(
          decision.unresolvedFields,
        ).toEqual([]);
        expect(
          decision.evidenceIds,
        ).toEqual([
          "e-identity",
          "e-issuer",
        ]);
      },
    );

    it(
      "does not use fuzzy matching on names or nearby fields",
      () => {
        const decision =
          policy.evaluate([
            createEvidence({
              id: "e-ticker",
              field: "ticker",
              value:
                "PETR4 similar",
            }),
            createEvidence({
              id: "e-name",
              field: "fund",
              value:
                "Petrobras PN",
            }),
          ]);

        expect(
          decision.status,
        ).toBe(
          "needs-more-evidence",
        );
        expect(
          decision.unresolvedFields,
        ).toEqual([
          "identity",
          "issuer",
        ]);
      },
    );
  },
);
