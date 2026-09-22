import {
    describe,
    expect,
    it,
  } from "vitest";
  
  import type {
    EvidenceProvider,
    ProviderQuery,
    ProviderResult,
  } from "../providers";
  
  import {
    EvidenceProviderRegistry,
  } from "../providers";
  
  import type {
    ResolutionPlan,
  } from "../planner/resolution-plan";
  
  import {
    ProviderExecutionPipeline,
  } from "./provider-execution-pipeline";
  
  function createPlan(): ResolutionPlan {
    return {
      assetType: "debenture",
      unresolvedFields: [
        "identity",
        "issuer",
      ],
      steps: [
        {
          source: "REGISTRY",
          order: 1,
          fields: [
            "identity",
            "issuer",
          ],
        },
        {
          source: "ANBIMA",
          order: 2,
          fields: [
            "identity",
            "issuer",
          ],
        },
        {
          source: "USER",
          order: 3,
          fields: [
            "identity",
            "issuer",
          ],
        },
      ],
    };
  }
  
  function createProvider(
    id: string,
    result: ProviderResult,
  ): EvidenceProvider {
    return {
      id,
      version: "1.0.0",
  
      supports(
        _query: ProviderQuery,
      ): boolean {
        return true;
      },
  
      async search(
        _query: ProviderQuery,
      ): Promise<ProviderResult> {
        return result;
      },
    };
  }
  
  describe(
    "ProviderExecutionPipeline",
    () => {
      it(
        "executes registered providers in plan order",
        async () => {
          const registry =
            new EvidenceProviderRegistry();
  
          registry.register(
            createProvider(
              "REGISTRY",
              {
                providerId:
                  "REGISTRY",
                searched:
                  true,
                found:
                  true,
                evidence: [
                  {
                    id:
                      "evidence-registry",
  
                    assetId:
                      "asset-1",
  
                    source:
                      "REGISTRY",
  
                    strength:
                      "supporting",
  
                    field:
                      "identity",
  
                    value:
                      "company.petrobras",
  
                    collectedAt:
                      "2026-09-19T12:00:00.000Z",
                  },
                ],
              },
            ),
          );
  
          registry.register(
            createProvider(
              "ANBIMA",
              {
                providerId:
                  "ANBIMA",
                searched:
                  true,
                found:
                  false,
                evidence: [],
              },
            ),
          );
  
          const pipeline =
            new ProviderExecutionPipeline(
              registry,
            );
  
          const timestamps = [
            "2026-09-19T12:00:00.000Z",
            "2026-09-19T12:00:01.000Z",
            "2026-09-19T12:00:02.000Z",
            "2026-09-19T12:00:03.000Z",
          ];
  
          let timestampIndex = 0;
  
          const result =
            await pipeline.execute({
              plan:
                createPlan(),
  
              query: {
                assetId:
                  "asset-1",
  
                rawName:
                  "DEB PETROBRAS",
  
                assetType:
                  "debenture",
              },
  
              now: () =>
                timestamps[
                  timestampIndex++
                ],
            });
  
          expect(
            result.searches.map(
              (search) =>
                search.providerId,
            ),
          ).toEqual([
            "REGISTRY",
            "ANBIMA",
          ]);
  
          expect(
            result.searches.map(
              (search) =>
                search.status,
            ),
          ).toEqual([
            "success",
            "not-found",
          ]);
  
          expect(
            result.evidence,
          ).toHaveLength(1);
  
          expect(
            result.evidence[0]
              ?.id,
          ).toBe(
            "evidence-registry",
          );
        },
      );
  
      it(
        "stops automatic execution before USER",
        async () => {
          const registry =
            new EvidenceProviderRegistry();
  
          registry.register(
            createProvider(
              "REGISTRY",
              {
                providerId:
                  "REGISTRY",
                searched:
                  true,
                found:
                  false,
                evidence: [],
              },
            ),
          );
  
          const pipeline =
            new ProviderExecutionPipeline(
              registry,
            );
  
          const result =
            await pipeline.execute({
              plan: {
                assetType:
                  "unknown",
  
                unresolvedFields: [
                  "identity",
                ],
  
                steps: [
                  {
                    source:
                      "REGISTRY",
  
                    order:
                      1,
  
                    fields: [
                      "identity",
                    ],
                  },
                  {
                    source:
                      "USER",
  
                    order:
                      2,
  
                    fields: [
                      "identity",
                    ],
                  },
                ],
              },
  
              query: {
                assetId:
                  "asset-2",
  
                rawName:
                  "Unknown Asset",
              },
  
              now: () =>
                "2026-09-19T12:00:00.000Z",
            });
  
          expect(
            result.searches,
          ).toHaveLength(1);
  
          expect(
            result.searches[0]
              ?.providerId,
          ).toBe(
            "REGISTRY",
          );
        },
      );
  
      it(
        "records provider errors without accepting evidence",
        async () => {
          const registry =
            new EvidenceProviderRegistry();
  
          registry.register(
            createProvider(
              "REGISTRY",
              {
                providerId:
                  "REGISTRY",
  
                searched:
                  true,
  
                found:
                  true,
  
                evidence: [
                  {
                    id:
                      "should-not-be-used",
  
                    assetId:
                      "asset-3",
  
                    source:
                      "REGISTRY",
  
                    strength:
                      "supporting",
  
                    field:
                      "identity",
  
                    value:
                      "invalid",
  
                    collectedAt:
                      "2026-09-19T12:00:00.000Z",
                  },
                ],
  
                error: {
                  code:
                    "REGISTRY_ERROR",
  
                  message:
                    "Registry lookup failed.",
                },
              },
            ),
          );
  
          const pipeline =
            new ProviderExecutionPipeline(
              registry,
            );
  
          const result =
            await pipeline.execute({
              plan: {
                assetType:
                  "unknown",
  
                unresolvedFields: [
                  "identity",
                ],
  
                steps: [
                  {
                    source:
                      "REGISTRY",
  
                    order:
                      1,
  
                    fields: [
                      "identity",
                    ],
                  },
                ],
              },
  
              query: {
                assetId:
                  "asset-3",
  
                rawName:
                  "Unknown Asset",
              },
  
              now: () =>
                "2026-09-19T12:00:00.000Z",
            });
  
          expect(
            result.evidence,
          ).toEqual([]);
  
          expect(
            result.searches[0],
          ).toMatchObject({
            providerId:
              "REGISTRY",
  
            status:
              "failed",
  
            evidenceIds:
              [],
  
            error:
              "REGISTRY_ERROR: Registry lookup failed.",
          });
        },
      );
  
      it(
        "records thrown provider failures and continues safely",
        async () => {
          const registry =
            new EvidenceProviderRegistry();
  
          const failingProvider:
            EvidenceProvider = {
              id:
                "REGISTRY",
  
              version:
                "1.0.0",
  
              supports() {
                return true;
              },
  
              async search() {
                throw new Error(
                  "Provider unavailable",
                );
              },
            };
  
          registry.register(
            failingProvider,
          );
  
          const pipeline =
            new ProviderExecutionPipeline(
              registry,
            );
  
          const result =
            await pipeline.execute({
              plan: {
                assetType:
                  "unknown",
  
                unresolvedFields: [
                  "identity",
                ],
  
                steps: [
                  {
                    source:
                      "REGISTRY",
  
                    order:
                      1,
  
                    fields: [
                      "identity",
                    ],
                  },
                ],
              },
  
              query: {
                assetId:
                  "asset-4",
              },
  
              now: () =>
                "2026-09-19T12:00:00.000Z",
            });
  
          expect(
            result.evidence,
          ).toEqual([]);
  
          expect(
            result.searches[0],
          ).toMatchObject({
            providerId:
              "REGISTRY",
  
            status:
              "failed",
  
            error:
              "Provider unavailable",
          });
        },
      );
    },
  );