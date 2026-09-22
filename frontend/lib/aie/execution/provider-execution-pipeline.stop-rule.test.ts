import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  AssetEvidence,
} from "../contracts";

import type {
  ResolutionPlan,
  ResolutionSource,
  ResolutionStep,
} from "../planner/resolution-plan";

import type {
  EvidenceProvider,
  ProviderQuery,
  ProviderResult,
} from "../providers";

import {
  EvidenceProviderRegistry,
} from "../providers";

import {
  ProviderExecutionPipeline,
} from "./provider-execution-pipeline";

const NOW =
  "2026-09-19T12:00:00.000Z";

const query: ProviderQuery = {
  assetId: "asset-1",

  instrumentCode: "ABCD11",

  assetType: "debenture",
};

function createEvidence(
  id: string,
): AssetEvidence {
  return {
    id,

    assetId: "asset-1",

    source: "ANBIMA",

    strength: "primary",

    field: "identity",

    value: id,

    collectedAt: NOW,
  };
}

function createPlan(
  ...sources: ResolutionSource[]
): ResolutionPlan {
  return {
    assetType: "debenture",

    unresolvedFields: [
      "identity",
      "issuer",
    ],

    steps: sources.map(
      (
        source,
        index,
      ): ResolutionStep => ({
        source,

        order: index + 1,

        fields: [
          "identity",
          "issuer",
        ],
      }),
    ),
  };
}

interface ProviderSpy {
  provider: EvidenceProvider;

  calls: ProviderQuery[];
}

function createSpy(
  id: string,

  options: {
    result?: Partial<ProviderResult>;

    supports?: boolean;

    throws?: Error;
  } = {},
): ProviderSpy {
  const calls: ProviderQuery[] =
    [];

  const provider: EvidenceProvider =
    {
      id,

      version: "1.0.0",

      supports: () =>
        options.supports ?? true,

      async search(
        received: ProviderQuery,
      ): Promise<ProviderResult> {
        calls.push(received);

        if (options.throws) {
          throw options.throws;
        }

        return {
          providerId: id,

          searched: true,

          found: false,

          evidence: [],

          ...options.result,
        };
      },
    };

  return {
    provider,
    calls,
  };
}

function createPipeline(
  ...spies: ProviderSpy[]
): ProviderExecutionPipeline {
  const registry =
    new EvidenceProviderRegistry();

  for (const spy of spies) {
    registry.register(
      spy.provider,
    );
  }

  return new ProviderExecutionPipeline(
    registry,
  );
}

describe(
  "ProviderExecutionPipeline stopping rule and ordering",
  () => {
    it(
      "follows plan order, not registration order",
      async () => {
        const anbima =
          createSpy("ANBIMA");

        const registry =
          createSpy("REGISTRY");

        const result =
          await createPipeline(
            anbima,
            registry,
          ).execute({
            plan: createPlan(
              "REGISTRY",
              "ANBIMA",
            ),

            query,

            now: () => NOW,
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
      },
    );

    it(
      "stops later providers when shouldStop returns true",
      async () => {
        const registry =
          createSpy("REGISTRY", {
            result: {
              found: true,

              evidence: [
                createEvidence(
                  "registry",
                ),
              ],
            },
          });

        const anbima =
          createSpy("ANBIMA");

        const result =
          await createPipeline(
            registry,
            anbima,
          ).execute({
            plan: createPlan(
              "REGISTRY",
              "ANBIMA",
            ),

            query,

            now: () => NOW,

            shouldStop: () => true,
          });

        expect(
          anbima.calls,
        ).toHaveLength(0);

        expect(
          result.searches.map(
            (search) =>
              search.providerId,
          ),
        ).toEqual([
          "REGISTRY",
        ]);
      },
    );

    it(
      "continues when shouldStop returns false",
      async () => {
        const registry =
          createSpy("REGISTRY");

        const anbima =
          createSpy("ANBIMA");

        const result =
          await createPipeline(
            registry,
            anbima,
          ).execute({
            plan: createPlan(
              "REGISTRY",
              "ANBIMA",
            ),

            query,

            now: () => NOW,

            shouldStop: () => false,
          });

        expect(
          anbima.calls,
        ).toHaveLength(1);

        expect(
          result.searches,
        ).toHaveLength(2);
      },
    );

    it(
      "passes the accumulated evidence, including existing evidence, to shouldStop",
      async () => {
        const seen: string[][] =
          [];

        const registry =
          createSpy("REGISTRY", {
            result: {
              found: true,

              evidence: [
                createEvidence(
                  "registry",
                ),
              ],
            },
          });

        const anbima =
          createSpy("ANBIMA", {
            result: {
              found: true,

              evidence: [
                createEvidence(
                  "anbima",
                ),
              ],
            },
          });

        const result =
          await createPipeline(
            registry,
            anbima,
          ).execute({
            plan: createPlan(
              "REGISTRY",
              "ANBIMA",
            ),

            query,

            existingEvidence: [
              createEvidence(
                "existing",
              ),
            ],

            now: () => NOW,

            shouldStop: (
              evidence,
            ) => {
              seen.push(
                evidence.map(
                  (item) =>
                    item.id,
                ),
              );

              return false;
            },
          });

        expect(seen).toEqual([
          [
            "existing",
            "registry",
          ],
          [
            "existing",
            "registry",
            "anbima",
          ],
        ]);

        expect(
          result.evidence.map(
            (item) =>
              item.id,
          ),
        ).toEqual([
          "existing",
          "registry",
          "anbima",
        ]);
      },
    );

    it(
      "does not consult shouldStop after a failed provider",
      async () => {
        const failing =
          createSpy("REGISTRY", {
            result: {
              found: true,

              evidence: [
                createEvidence(
                  "must-not-be-accepted",
                ),
              ],

              error: {
                code: "REGISTRY_ERROR",

                message: "failed",
              },
            },
          });

        const throwing =
          createSpy("ANBIMA", {
            throws: new Error(
              "unavailable",
            ),
          });

        const notFound =
          createSpy("CVM");

        let checks = 0;

        const result =
          await createPipeline(
            failing,
            throwing,
            notFound,
          ).execute({
            plan: createPlan(
              "REGISTRY",
              "ANBIMA",
              "CVM",
            ),

            query,

            now: () => NOW,

            shouldStop: () => {
              checks += 1;

              return false;
            },
          });

        expect(
          result.searches.map(
            (search) =>
              search.status,
          ),
        ).toEqual([
          "failed",
          "failed",
          "not-found",
        ]);

        expect(
          result.evidence,
        ).toEqual([]);

        expect(checks).toBe(1);
      },
    );

    it(
      "skips unregistered providers and providers that do not support the query",
      async () => {
        const unsupported =
          createSpy("REGISTRY", {
            supports: false,
          });

        const supported =
          createSpy("ANBIMA");

        const result =
          await createPipeline(
            unsupported,
            supported,
          ).execute({
            plan: createPlan(
              "REGISTRY",
              "ANBIMA",
              "CVM",
              "B3",
            ),

            query,

            now: () => NOW,
          });

        expect(
          unsupported.calls,
        ).toHaveLength(0);

        expect(
          supported.calls,
        ).toHaveLength(1);

        expect(
          result.searches.map(
            (search) =>
              search.providerId,
          ),
        ).toEqual([
          "ANBIMA",
        ]);
      },
    );

    it(
      "executes nothing after USER, even when USER comes first",
      async () => {
        const registry =
          createSpy("REGISTRY");

        const result =
          await createPipeline(
            registry,
          ).execute({
            plan: createPlan(
              "USER",
              "REGISTRY",
            ),

            query,

            now: () => NOW,
          });

        expect(
          registry.calls,
        ).toHaveLength(0);

        expect(
          result.searches,
        ).toEqual([]);
      },
    );

    it(
      "returns only evidence and searches and never fabricates a verified asset",
      async () => {
        const registry =
          createSpy("REGISTRY");

        const result =
          await createPipeline(
            registry,
          ).execute({
            plan: createPlan(
              "REGISTRY",
            ),

            query,

            now: () => NOW,
          });

        expect(
          Object.keys(result)
            .sort(),
        ).toEqual([
          "evidence",
          "searches",
        ]);

        expect(
          result.evidence,
        ).toEqual([]);
      },
    );
  },
);
