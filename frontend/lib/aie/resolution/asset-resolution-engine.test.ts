import {
    describe,
    expect,
    it,
  } from "vitest";
  
  import type {
    AssetEvidence,
    CandidateAsset,
  } from "../contracts";
  
  import {
    EvidenceOrchestrator,
  } from "../orchestrator/evidence-orchestrator";
  
  import {
    ResolutionPlanner,
  } from "../planner/resolution-planner";
  
  import {
    VerificationPolicy,
  } from "../policy";
  
  import {
    EvidenceProviderRegistry,
  } from "../providers";
  
  import {
    AssetResolutionEngine,
  } from "./asset-resolution-engine";
  
  function createCandidate(): CandidateAsset {
    return {
      id: "asset-1",
      rawName: "DEB PETROBRAS",
      source: {},
      hints: {
        assetType: "debenture",
        currency: "BRL",
        amount: 1000,
      },
    };
  }
  
  function createEngine(): AssetResolutionEngine {
    const providers =
      new EvidenceProviderRegistry();
  
    const policy =
      new VerificationPolicy();
  
    const planner =
      new ResolutionPlanner();
  
    const orchestrator =
      new EvidenceOrchestrator(
        providers,
        policy,
      );
  
    return new AssetResolutionEngine(
      policy,
      planner,
      orchestrator,
    );
  }
  
  describe(
    "AssetResolutionEngine",
    () => {
      it(
        "returns needs-more-evidence when required primary evidence is missing",
        () => {
          const engine =
            createEngine();
  
          const result =
            engine.resolve({
              candidateAsset:
                createCandidate(),
  
              evidence: [],
  
              now:
                "2026-09-18T17:30:00.000Z",
            });
  
          expect(
            result.status,
          ).toBe(
            "needs-more-evidence",
          );
  
          expect(
            result.verifiedAsset,
          ).toBeNull();
  
          expect(
            result.nextAction,
          ).toBe(
            "search-provider",
          );
  
          expect(
            result.plan.steps.map(
              (step) =>
                step.source,
            ),
          ).toEqual([
            "REGISTRY",
            "ANBIMA",
            "CVM",
            "B3",
            "USER",
          ]);
        },
      );
  
      it(
        "returns verified when qualifying primary evidence is present",
        () => {
          const engine =
            createEngine();
  
          const evidence:
            AssetEvidence[] = [
              {
                id:
                  "evidence-identity",
  
                assetId:
                  "asset-1",
  
                source:
                  "ANBIMA",
  
                strength:
                  "primary",
  
                field:
                  "identity",
  
                value:
                  "instrument.petrobond",
  
                collectedAt:
                  "2026-09-18T17:30:00.000Z",
              },
  
              {
                id:
                  "evidence-issuer",
  
                assetId:
                  "asset-1",
  
                source:
                  "CVM",
  
                strength:
                  "primary",
  
                field:
                  "issuer",
  
                value:
                  "company.petrobras",
  
                collectedAt:
                  "2026-09-18T17:30:00.000Z",
              },
            ];
  
          const result =
            engine.resolve({
              candidateAsset:
                createCandidate(),
  
              evidence,
  
              now:
                "2026-09-18T17:30:00.000Z",
            });
  
          expect(
            result.status,
          ).toBe(
            "verified",
          );
  
          expect(
            result.nextAction,
          ).toBe(
            "finish",
          );
  
          expect(
            result.verifiedAsset,
          ).not.toBeNull();
  
          expect(
            result.verifiedAsset
              ?.canonicalAssetId,
          ).toBe(
            "instrument.petrobond",
          );
  
          expect(
            result.verifiedAsset
              ?.issuerEntityId,
          ).toBe(
            "company.petrobras",
          );
        },
      );
    },
  );