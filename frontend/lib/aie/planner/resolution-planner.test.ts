import {
    describe,
    expect,
    it,
  } from "vitest";
  
  import type {
    CandidateAsset,
    EvidenceField,
  } from "../contracts";
  
  import type {
    VerificationDecision,
  } from "../policy";
  
  import {
    ResolutionPlanner,
  } from "./resolution-planner";
  
  function createCandidate(
    assetType: CandidateAsset["hints"]["assetType"],
  ): CandidateAsset {
    return {
      id: "asset-1",
      rawName: "Example Asset",
      source: {},
      hints: {
        assetType,
      },
    };
  }
  
  function createDecision(
    unresolvedFields: EvidenceField[],
  ): VerificationDecision {
    return {
      status:
        unresolvedFields.length === 0
          ? "verified"
          : "needs-more-evidence",
  
      unresolvedFields,
  
      evidenceIds: [],
  
      policyVersion: "1.0.0",
    };
  }
  
  describe("ResolutionPlanner", () => {
    const planner = new ResolutionPlanner();
  
    it("builds the expected debenture search plan", () => {
      const result = planner.build(
        createCandidate("debenture"),
        createDecision([
          "identity",
          "issuer",
        ]),
      );
  
      expect(
        result.steps.map(
          (step) => step.source,
        ),
      ).toEqual([
        "REGISTRY",
        "ANBIMA",
        "CVM",
        "B3",
        "USER",
      ]);
    });
  
    it("always places USER as the final step", () => {
      const assetTypes: CandidateAsset["hints"]["assetType"][] = [
        "debenture",
        "cri",
        "cra",
        "fii",
        "fund",
        "lca",
        "lci",
        "cdb",
        "stock",
        "etf",
        "coe",
        "crypto",
        "international",
        "unknown",
      ];
  
      for (const assetType of assetTypes) {
        const result = planner.build(
          createCandidate(assetType),
          createDecision([
            "identity",
          ]),
        );
  
        expect(
          result.steps.at(-1)?.source,
        ).toBe("USER");
      }
    });
  
    it("uses REGISTRY then USER for unknown assets", () => {
      const result = planner.build(
        createCandidate("unknown"),
        createDecision([
          "identity",
        ]),
      );
  
      expect(
        result.steps.map(
          (step) => step.source,
        ),
      ).toEqual([
        "REGISTRY",
        "USER",
      ]);
    });
  
    it("preserves unresolved fields in every step", () => {
      const unresolved: EvidenceField[] = [
        "identity",
        "issuer",
      ];
  
      const result = planner.build(
        createCandidate("debenture"),
        createDecision(unresolved),
      );
  
      for (const step of result.steps) {
        expect(step.fields).toEqual(
          unresolved,
        );
      }
    });
  
    it("is deterministic for the same input", () => {
      const candidate =
        createCandidate("debenture");
  
      const decision =
        createDecision([
          "identity",
          "issuer",
        ]);
  
      const first = planner.build(
        candidate,
        decision,
      );
  
      const second = planner.build(
        candidate,
        decision,
      );
  
      expect(second).toEqual(first);
    });
  });
  