import {
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";

import {
  join,
  relative,
} from "node:path";

import {
  fileURLToPath,
} from "node:url";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  CandidateAsset,
} from "../contracts";

import type {
  AnbimaFetch,
  AnbimaFetchInit,
  AnbimaFetchResponse,
} from "../infrastructure/anbima/anbima-http-client";

import {
  createAnbimaDebentureRecord,
} from "../infrastructure/anbima/fake-anbima-debenture-feed-client";

import type {
  EvidenceProvider,
} from "../providers";

import {
  AnbimaDebentureProvider,
} from "../providers";

import {
  AnbimaConfigurationError,
  createAnbimaDebentureProviderFromEnv,
  resolveAnbimaRuntimeConfig,
} from "./anbima-runtime";

import {
  createAie,
} from "./create-aie";

import {
  createAieFromEnv,
} from "./create-aie-from-env";

// Obviously fake, non-secret fixtures.
const CLIENT_ID =
  "sentinel-client-id-123";

const CLIENT_SECRET =
  "sentinel-client-secret-456";

const PRODUCTION_ENV = {
  ANBIMA_CLIENT_ID: CLIENT_ID,

  ANBIMA_CLIENT_SECRET:
    CLIENT_SECRET,
};

const SANDBOX_ENV = {
  ...PRODUCTION_ENV,

  ANBIMA_ENVIRONMENT: "sandbox",
};

interface RecordedCall {
  url: string;

  init: AnbimaFetchInit;
}

function jsonResponse(
  status: number,
  body: unknown,
): AnbimaFetchResponse {
  return {
    ok:
      status >= 200 &&
      status < 300,

    status,

    json: async () => body,
  };
}

function createFakeFetch(): {
  fetchImpl: AnbimaFetch;

  calls: RecordedCall[];
} {
  const calls: RecordedCall[] =
    [];

  const fetchImpl: AnbimaFetch =
    async (url, init) => {
      calls.push({
        url,
        init,
      });

      if (
        url.endsWith(
          "/oauth/access-token",
        )
      ) {
        return jsonResponse(200, {
          access_token:
            "fake-access-token",

          token_type: "Bearer",

          expires_in: 3600,
        });
      }

      return jsonResponse(200, [
        createAnbimaDebentureRecord({
          codigo_ativo: "ABCD11",

          emissor: "Petrobras",
        }),
      ]);
    };

  return {
    fetchImpl,
    calls,
  };
}

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

function collectSourceFiles(
  directory: string,
): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(
    directory,
  )) {
    const path = join(
      directory,
      entry,
    );

    if (
      statSync(path).isDirectory()
    ) {
      files.push(
        ...collectSourceFiles(path),
      );
    } else if (
      path.endsWith(".ts") &&
      !path.endsWith(".test.ts")
    ) {
      files.push(path);
    }
  }

  return files;
}

describe(
  "ANBIMA runtime configuration",
  () => {
    let globalFetch: ReturnType<
      typeof vi.fn
    >;

    beforeEach(() => {
      // Guard: nothing here may reach the real network.
      globalFetch = vi.fn(() => {
        throw new Error(
          "real network call attempted",
        );
      });

      vi.stubGlobal(
        "fetch",
        globalFetch,
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();

      vi.restoreAllMocks();
    });

    describe(
      "disabled and invalid configuration",
      () => {
        it(
          "is disabled safely when no credentials are present",
          () => {
            for (const env of [
              {},
              {
                ANBIMA_CLIENT_ID: "",

                ANBIMA_CLIENT_SECRET:
                  "   ",
              },
              {
                ANBIMA_ENVIRONMENT:
                  "sandbox",
              },
            ]) {
              expect(
                resolveAnbimaRuntimeConfig(
                  env,
                ),
              ).toBeNull();

              expect(
                createAnbimaDebentureProviderFromEnv(
                  env,
                ),
              ).toBeNull();
            }
          },
        );

        it(
          "throws when only the client id is present",
          () => {
            const attempt = () =>
              createAnbimaDebentureProviderFromEnv(
                {
                  ANBIMA_CLIENT_ID:
                    CLIENT_ID,
                },
              );

            expect(
              attempt,
            ).toThrow(
              AnbimaConfigurationError,
            );

            expect(
              attempt,
            ).toThrow(
              /ANBIMA_CLIENT_SECRET is missing/,
            );

            expect(
              attempt,
            ).toThrow(
              expect.objectContaining({
                code:
                  "INCOMPLETE_CREDENTIALS",
              }),
            );
          },
        );

        it(
          "throws when only the client secret is present",
          () => {
            const attempt = () =>
              createAnbimaDebentureProviderFromEnv(
                {
                  ANBIMA_CLIENT_SECRET:
                    CLIENT_SECRET,
                },
              );

            expect(
              attempt,
            ).toThrow(
              AnbimaConfigurationError,
            );

            expect(
              attempt,
            ).toThrow(
              /ANBIMA_CLIENT_ID is missing/,
            );
          },
        );

        it(
          "treats a blank credential as missing",
          () => {
            expect(
              () =>
                createAnbimaDebentureProviderFromEnv(
                  {
                    ANBIMA_CLIENT_ID:
                      CLIENT_ID,

                    ANBIMA_CLIENT_SECRET:
                      "   ",
                  },
                ),
            ).toThrow(
              /ANBIMA_CLIENT_SECRET is missing/,
            );
          },
        );

        it(
          "throws a clear error for an invalid environment",
          () => {
            const attempt = () =>
              createAnbimaDebentureProviderFromEnv(
                {
                  ...PRODUCTION_ENV,

                  ANBIMA_ENVIRONMENT:
                    "staging",
                },
              );

            expect(
              attempt,
            ).toThrow(
              AnbimaConfigurationError,
            );

            expect(
              attempt,
            ).toThrow(
              /ANBIMA_ENVIRONMENT must be "production" or "sandbox"/,
            );

            expect(
              attempt,
            ).toThrow(
              expect.objectContaining({
                code:
                  "INVALID_ENVIRONMENT",
              }),
            );
          },
        );

        it(
          "validates ANBIMA_ENVIRONMENT even when credentials are absent",
          () => {
            expect(
              () =>
                createAnbimaDebentureProviderFromEnv(
                  {
                    ANBIMA_ENVIRONMENT:
                      "prod",
                  },
                ),
            ).toThrow(
              AnbimaConfigurationError,
            );
          },
        );
      },
    );

    describe(
      "valid configuration",
      () => {
        it(
          "creates the provider for production, which is the default",
          () => {
            const provider =
              createAnbimaDebentureProviderFromEnv(
                PRODUCTION_ENV,
              );

            expect(
              provider,
            ).toBeInstanceOf(
              AnbimaDebentureProvider,
            );

            expect(
              provider?.id,
            ).toBe("ANBIMA");

            expect(
              resolveAnbimaRuntimeConfig(
                PRODUCTION_ENV,
              )?.environment,
            ).toBe("production");

            expect(
              resolveAnbimaRuntimeConfig(
                {
                  ...PRODUCTION_ENV,

                  ANBIMA_ENVIRONMENT:
                    "  ",
                },
              )?.environment,
            ).toBe("production");

            expect(
              resolveAnbimaRuntimeConfig(
                {
                  ...PRODUCTION_ENV,

                  ANBIMA_ENVIRONMENT:
                    "production",
                },
              )?.environment,
            ).toBe("production");
          },
        );

        it(
          "creates the provider for sandbox",
          () => {
            const provider =
              createAnbimaDebentureProviderFromEnv(
                SANDBOX_ENV,
              );

            expect(
              provider,
            ).toBeInstanceOf(
              AnbimaDebentureProvider,
            );

            expect(
              resolveAnbimaRuntimeConfig(
                SANDBOX_ENV,
              )?.environment,
            ).toBe("sandbox");

            expect(
              resolveAnbimaRuntimeConfig(
                {
                  ...PRODUCTION_ENV,

                  ANBIMA_ENVIRONMENT:
                    " Sandbox ",
                },
              )?.environment,
            ).toBe("sandbox");
          },
        );

        it(
          "does not perform any request while being created",
          () => {
            const fake =
              createFakeFetch();

            createAnbimaDebentureProviderFromEnv(
              PRODUCTION_ENV,
              {
                fetchImpl:
                  fake.fetchImpl,
              },
            );

            expect(
              fake.calls,
            ).toHaveLength(0);

            expect(
              globalFetch,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          "uses the injected fetch (production base URL)",
          async () => {
            const fake =
              createFakeFetch();

            const provider =
              createAnbimaDebentureProviderFromEnv(
                PRODUCTION_ENV,
                {
                  fetchImpl:
                    fake.fetchImpl,
                },
              );

            const result =
              await provider!.search({
                assetId: "asset-1",

                assetType:
                  "debenture",

                instrumentCode:
                  "ABCD11",
              });

            expect(
              result.found,
            ).toBe(true);

            expect(
              result.error,
            ).toBeUndefined();

            expect(
              fake.calls.map(
                (call) => call.url,
              ),
            ).toEqual([
              "https://api.anbima.com.br/oauth/access-token",

              "https://api.anbima.com.br/feed/precos-indices/v1/debentures/mercado-secundario",
            ]);

            expect(
              fake.calls[1]?.init
                .headers.client_id,
            ).toBe(CLIENT_ID);

            expect(
              globalFetch,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          "uses the injected fetch (sandbox base URL)",
          async () => {
            const fake =
              createFakeFetch();

            const provider =
              createAnbimaDebentureProviderFromEnv(
                SANDBOX_ENV,
                {
                  fetchImpl:
                    fake.fetchImpl,
                },
              );

            await provider!.search({
              assetId: "asset-1",

              assetType:
                "debenture",

              instrumentCode:
                "ABCD11",
            });

            expect(
              fake.calls[1]?.url,
            ).toBe(
              "https://api-sandbox.anbima.com.br/feed/precos-indices/v1/debentures/mercado-secundario",
            );

            expect(
              globalFetch,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          "passes the injected clock to the HTTP client",
          async () => {
            const fake =
              createFakeFetch();

            let nowMs = 1_000_000;

            const provider =
              createAnbimaDebentureProviderFromEnv(
                PRODUCTION_ENV,
                {
                  fetchImpl:
                    fake.fetchImpl,

                  now: () => nowMs,
                },
              );

            const query = {
              assetId: "asset-1",

              assetType:
                "debenture" as const,

              instrumentCode:
                "ABCD11",
            };

            await provider!.search(
              query,
            );

            nowMs += 3_600_000;

            await provider!.search(
              query,
            );

            expect(
              fake.calls.filter(
                (call) =>
                  call.url.endsWith(
                    "/oauth/access-token",
                  ),
              ),
            ).toHaveLength(2);
          },
        );
      },
    );

    describe(
      "secrets",
      () => {
        it(
          "never includes credential values in configuration errors",
          () => {
            const scenarios = [
              {
                ANBIMA_CLIENT_ID:
                  CLIENT_ID,
              },
              {
                ANBIMA_CLIENT_SECRET:
                  CLIENT_SECRET,
              },
              {
                ...PRODUCTION_ENV,

                ANBIMA_ENVIRONMENT:
                  "staging",
              },
              {
                ...PRODUCTION_ENV,

                ANBIMA_ENVIRONMENT:
                  CLIENT_SECRET,
              },
            ];

            for (const env of scenarios) {
              let caught: unknown;

              try {
                createAnbimaDebentureProviderFromEnv(
                  env,
                );
              } catch (error) {
                caught = error;
              }

              expect(
                caught,
              ).toBeInstanceOf(
                AnbimaConfigurationError,
              );

              const message = (
                caught as AnbimaConfigurationError
              ).message;

              expect(
                message,
              ).not.toContain(
                CLIENT_ID,
              );

              expect(
                message,
              ).not.toContain(
                CLIENT_SECRET,
              );
            }
          },
        );

        it(
          "never logs anything while configuring or searching",
          async () => {
            const spies = [
              vi.spyOn(
                console,
                "log",
              ),
              vi.spyOn(
                console,
                "info",
              ),
              vi.spyOn(
                console,
                "warn",
              ),
              vi.spyOn(
                console,
                "error",
              ),
              vi.spyOn(
                console,
                "debug",
              ),
            ];

            const fake =
              createFakeFetch();

            const provider =
              createAnbimaDebentureProviderFromEnv(
                PRODUCTION_ENV,
                {
                  fetchImpl:
                    fake.fetchImpl,
                },
              );

            await provider!.search({
              assetId: "asset-1",

              assetType:
                "debenture",

              instrumentCode:
                "ABCD11",
            });

            try {
              createAnbimaDebentureProviderFromEnv(
                {
                  ANBIMA_CLIENT_ID:
                    CLIENT_ID,
                },
              );
            } catch {
              // expected
            }

            for (const spy of spies) {
              expect(
                spy,
              ).not.toHaveBeenCalled();
            }
          },
        );

        it(
          "only the server boundary reads the process environment in AIE sources",
          () => {
            const root =
              fileURLToPath(
                new URL(
                  "..",
                  import.meta.url,
                ),
              );

            const offenders =
              collectSourceFiles(root)
                .filter((file) =>
                  readFileSync(
                    file,
                    "utf8",
                  ).includes(
                    "process.env",
                  ),
                )
                .map((file) =>
                  relative(
                    root,
                    file,
                  ).replace(
                    /\\/g,
                    "/",
                  ),
                )
                // The three server composition boundaries: ANBIMA (TASK-008),
                // the request authorizer (TASK-020) and the audit sink
                // (TASK-037, shares the authorizer's Planejador base URL plus
                // its own shared-secret variable). Nothing else reads it.
                .filter(
                  (file) =>
                    file !==
                      "server/create-server-aie.ts" &&
                    file !==
                      "server/create-server-authorizer.ts" &&
                    file !==
                      "server/create-server-audit-sink.ts",
                );

            expect(
              offenders,
            ).toEqual([]);
          },
        );
      },
    );

    describe(
      "createAie composition",
      () => {
        it(
          "createAie() still works without ANBIMA credentials",
          async () => {
            const result =
              await createAie()
                .resolve({
                  candidateAsset:
                    createCandidate(),

                  now: "2026-09-19T12:00:00.000Z",
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
              result.investigation
                .searches,
            ).toEqual([]);

            expect(
              globalFetch,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          "createAieFromEnv() without credentials registers no ANBIMA provider",
          async () => {
            const result =
              await createAieFromEnv(
                {},
              ).resolve({
                candidateAsset:
                  createCandidate(),

                now: "2026-09-19T12:00:00.000Z",
              });

            expect(
              result.investigation
                .searches,
            ).toEqual([]);

            expect(
              globalFetch,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          "createAieFromEnv() with valid credentials registers ANBIMA and keeps the issuer unresolved",
          async () => {
            const fake =
              createFakeFetch();

            const result =
              await createAieFromEnv(
                PRODUCTION_ENV,
                {
                  fetchImpl:
                    fake.fetchImpl,
                },
              ).resolve({
                candidateAsset:
                  createCandidate(),

                now: "2026-09-19T12:00:00.000Z",
              });

            expect(
              result.investigation
                .searches.map(
                  (search) =>
                    search.providerId,
                ),
            ).toEqual([
              "ANBIMA",
            ]);

            expect(
              result.investigation
                .evidence.map(
                  (item) => [
                    item.field,
                    item.strength,
                  ],
                ),
            ).toEqual([
              [
                "identity",
                "primary",
              ],
              [
                "issuer",
                "supporting",
              ],
            ]);

            expect(
              result.status,
            ).toBe(
              "needs-more-evidence",
            );

            expect(
              result.verifiedAsset,
            ).toBeNull();

            expect(
              result.investigation
                .unresolvedFields,
            ).toEqual([
              "issuer",
            ]);

            expect(
              globalFetch,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          "createAieFromEnv() rejects incomplete credentials instead of building a broken engine",
          () => {
            expect(
              () =>
                createAieFromEnv({
                  ANBIMA_CLIENT_ID:
                    CLIENT_ID,
                }),
            ).toThrow(
              AnbimaConfigurationError,
            );
          },
        );

        it(
          "createAie() registers explicitly supplied providers only",
          async () => {
            const calls: string[] =
              [];

            const custom: EvidenceProvider =
              {
                id: "REGISTRY",

                version: "1.0.0",

                supports: () => true,

                async search() {
                  calls.push(
                    "REGISTRY",
                  );

                  return {
                    providerId:
                      "REGISTRY",

                    searched: true,

                    found: false,

                    evidence: [],
                  };
                },
              };

            const result =
              await createAie({
                providers: [
                  custom,
                ],
              }).resolve({
                candidateAsset:
                  createCandidate(),

                now: "2026-09-19T12:00:00.000Z",
              });

            expect(
              calls,
            ).toEqual([
              "REGISTRY",
            ]);

            expect(
              result.investigation
                .searches.map(
                  (search) =>
                    search.providerId,
                ),
            ).toEqual([
              "REGISTRY",
            ]);
          },
        );
      },
    );
  },
);
