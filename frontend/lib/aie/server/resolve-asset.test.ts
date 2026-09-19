import {
  readFileSync,
} from "node:fs";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  AnbimaConfigurationError,
} from "../application/anbima-runtime";

import type {
  CandidateAsset,
  ResolutionResult,
} from "../contracts";

import type {
  AssetResolutionEngine,
} from "../resolution/asset-resolution-engine";

const getServerAie = vi.hoisted(
  () => vi.fn(),
);

function readCode(): string {
  const source = readFileSync(
    new URL(
      "./resolve-asset.ts",
      import.meta.url,
    ),
    "utf8",
  );

  // Comments may mention the architecture; only executable code counts.
  return source
    .replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    )
    .replace(/^\s*\/\/.*$/gm, "");
}

vi.mock(
  "./create-server-aie",
  () => ({
    getServerAie: () =>
      getServerAie(),
  }),
);

const NOW =
  "2026-09-19T12:00:00.000Z";

const SECRET =
  "sentinel-use-case-secret";

function createCandidate(): CandidateAsset {
  return {
    id: "asset-1",

    rawName: "DEB PETROBRAS",

    source: {},

    hints: {
      assetType: "debenture",

      instrumentCode: "ABCD11",
    },
  };
}

function createResult(
  overrides: Partial<ResolutionResult> = {},
): ResolutionResult {
  const candidateAsset =
    createCandidate();

  return {
    status:
      "needs-more-evidence",

    investigation: {
      id: "investigation:asset-1",

      candidateAsset,

      status:
        "needs-more-evidence",

      evidence: [],

      searches: [],

      unresolvedFields: [
        "identity",
        "issuer",
      ],

      createdAt: NOW,

      updatedAt: NOW,
    },

    verifiedAsset: null,

    plan: {
      assetType: "debenture",

      unresolvedFields: [
        "identity",
        "issuer",
      ],

      steps: [],
    },

    nextAction:
      "search-provider",

    ...overrides,
  };
}

function createFakeEngine(
  resolve: AssetResolutionEngine["resolve"],
): AssetResolutionEngine {
  return {
    resolve,
  } as unknown as AssetResolutionEngine;
}

describe(
  "resolveAsset",
  () => {
    beforeEach(() => {
      getServerAie.mockReset();

      // Guard: nothing here may reach the real network.
      vi.stubGlobal(
        "fetch",
        vi.fn(() => {
          throw new Error(
            "real network call attempted",
          );
        }),
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it(
      "delegates to the server AIE engine",
      async () => {
        const resolve = vi.fn(
          async () => createResult(),
        );

        getServerAie.mockReturnValue(
          createFakeEngine(resolve),
        );

        const { resolveAsset } =
          await import(
            "./resolve-asset"
          );

        await resolveAsset(
          createCandidate(),
        );

        expect(
          getServerAie,
        ).toHaveBeenCalledTimes(1);

        expect(
          resolve,
        ).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "forwards the CandidateAsset unchanged and nothing else",
      async () => {
        const resolve = vi.fn(
          async (_input: unknown) =>
            createResult(),
        );

        getServerAie.mockReturnValue(
          createFakeEngine(resolve),
        );

        const candidate =
          createCandidate();

        const snapshot =
          structuredClone(candidate);

        const { resolveAsset } =
          await import(
            "./resolve-asset"
          );

        await resolveAsset(candidate);

        const input = resolve.mock
          .calls[0]?.[0] as {
          candidateAsset: CandidateAsset;
        };

        expect(
          Object.keys(input),
        ).toEqual([
          "candidateAsset",
        ]);

        expect(
          input.candidateAsset,
        ).toBe(candidate);

        expect(
          candidate,
        ).toEqual(snapshot);
      },
    );

    it(
      "returns the ResolutionResult unchanged",
      async () => {
        const result =
          createResult();

        getServerAie.mockReturnValue(
          createFakeEngine(
            async () => result,
          ),
        );

        const { resolveAsset } =
          await import(
            "./resolve-asset"
          );

        await expect(
          resolveAsset(
            createCandidate(),
          ),
        ).resolves.toBe(result);
      },
    );

    it(
      "keeps an unresolved asset as a normal successful return value",
      async () => {
        getServerAie.mockReturnValue(
          createFakeEngine(
            async () =>
              createResult(),
          ),
        );

        const { resolveAsset } =
          await import(
            "./resolve-asset"
          );

        const result =
          await resolveAsset(
            createCandidate(),
          );

        expect(
          result.status,
        ).toBe(
          "needs-more-evidence",
        );

        expect(
          result.verifiedAsset,
        ).toBeNull();
      },
    );

    it(
      "does not convert provider failures recorded in the InvestigationCase into thrown errors",
      async () => {
        const base =
          createResult();

        const failed =
          createResult({
            investigation: {
              ...base.investigation,

              searches: [
                {
                  providerId:
                    "ANBIMA",

                  startedAt: NOW,

                  finishedAt: NOW,

                  status: "failed",

                  evidenceIds: [],

                  error:
                    "ANBIMA_SEARCH_FAILED: unavailable",
                },
              ],
            },
          });

        getServerAie.mockReturnValue(
          createFakeEngine(
            async () => failed,
          ),
        );

        const { resolveAsset } =
          await import(
            "./resolve-asset"
          );

        const result =
          await resolveAsset(
            createCandidate(),
          );

        expect(
          result.investigation
            .searches[0]?.status,
        ).toBe("failed");
      },
    );

    it(
      "fails with a safe configuration error when the server AIE cannot be created",
      async () => {
        getServerAie.mockImplementation(
          () => {
            throw new AnbimaConfigurationError(
              "INCOMPLETE_CREDENTIALS",
              "ANBIMA credentials are incomplete: ANBIMA_CLIENT_SECRET is missing.",
            );
          },
        );

        const {
          AieServerError,
          resolveAsset,
        } = await import(
          "./resolve-asset"
        );

        const attempt =
          resolveAsset(
            createCandidate(),
          );

        await expect(
          attempt,
        ).rejects.toBeInstanceOf(
          AieServerError,
        );

        await expect(
          attempt,
        ).rejects.toMatchObject({
          kind: "configuration",

          message:
            "The AIE server configuration is invalid.",
        });
      },
    );

    it(
      "wraps unexpected failures with a fixed safe message and no secret",
      async () => {
        getServerAie.mockReturnValue(
          createFakeEngine(
            async () => {
              throw new Error(
                `boom ${SECRET}`,
              );
            },
          ),
        );

        const {
          AieServerError,
          resolveAsset,
        } = await import(
          "./resolve-asset"
        );

        let caught: unknown;

        try {
          await resolveAsset(
            createCandidate(),
          );
        } catch (error) {
          caught = error;
        }

        expect(
          caught,
        ).toBeInstanceOf(
          AieServerError,
        );

        const error =
          caught as InstanceType<
            typeof AieServerError
          >;

        expect(
          error.kind,
        ).toBe("unexpected");

        expect(
          error.message,
        ).not.toContain(SECRET);

        expect(
          JSON.stringify(error),
        ).not.toContain(SECRET);

        expect(
          (error as Error & {
            cause?: unknown;
          }).cause,
        ).toBeUndefined();
      },
    );

    it(
      "classifies a non-configuration failure to obtain the engine as unexpected",
      async () => {
        getServerAie.mockImplementation(
          () => {
            throw new Error(
              `unrelated ${SECRET}`,
            );
          },
        );

        const { resolveAsset } =
          await import(
            "./resolve-asset"
          );

        let caught: unknown;

        try {
          await resolveAsset(
            createCandidate(),
          );
        } catch (error) {
          caught = error;
        }

        expect(
          caught,
        ).toMatchObject({
          name: "AieServerError",

          kind: "unexpected",
        });

        expect(
          (caught as Error).message,
        ).not.toContain(SECRET);
      },
    );

    it(
      "makes no network call merely by importing the module",
      async () => {
        vi.resetModules();

        const globalFetch = vi.fn();

        vi.stubGlobal(
          "fetch",
          globalFetch,
        );

        await import(
          "./resolve-asset"
        );

        expect(
          globalFetch,
        ).not.toHaveBeenCalled();

        expect(
          getServerAie,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "does not read the process environment itself",
      () => {
        expect(
          readCode(),
        ).not.toContain(
          "process.env",
        );
      },
    );

    it(
      "contains no provider-specific logic",
      () => {
        const source = readCode();

        for (const forbidden of [
          "VerificationPolicy",
          "ResolutionPlanner",
          "ProviderExecutionPipeline",
          "EvidenceOrchestrator",
          "AnbimaHttpClient",
          "AnbimaDebentureProvider",
          "createAieFromEnv",
        ]) {
          expect(
            source,
          ).not.toContain(forbidden);
        }
      },
    );
  },
);
