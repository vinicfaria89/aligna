import {
  readFileSync,
} from "node:fs";

import {
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  CandidateAsset,
  ResolutionResult,
} from "../contracts";

// Imported by relative path: the project has no Vitest alias for "@/".
import * as routeModule from "../../../app/api/aie/resolve-asset/route";

import {
  MAX_BODY_BYTES,
} from "./resolve-asset-http";

import {
  AieServerError,
} from "./resolve-asset";

const resolveAsset = vi.hoisted(
  () => vi.fn(),
);

vi.mock(
  "./resolve-asset",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("./resolve-asset")
      >();

    return {
      ...actual,

      resolveAsset: (
        ...args: unknown[]
      ) => resolveAsset(...args),
    };
  },
);

// Authorization is covered by request-authorization.test.ts. These tests exercise
// validation/resolution, so the real route gets an explicit allow authorizer.
vi.mock(
  "./request-authorization",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("./request-authorization")
      >();

    return {
      ...actual,

      getAieRequestAuthorizer: () => ({
        authorize: async () => ({
          authorized: true as const,

          principal: {
            subject: "test-subject",
          },
        }),
      }),
    };
  },
);

const { POST } = routeModule;

const NOW =
  "2026-09-19T12:00:00.000Z";

const SECRET =
  "sentinel-route-secret-value";

const URL_ =
  "http://localhost/api/aie/resolve-asset";

function validBody(): CandidateAsset {
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

function post(
  body: unknown,
  headers: Record<
    string,
    string
  > = {
    "content-type":
      "application/json",
  },
): Request {
  return new Request(URL_, {
    method: "POST",

    headers,

    body:
      typeof body === "string"
        ? body
        : JSON.stringify(body),
  });
}

function unresolved(): ResolutionResult {
  const candidateAsset =
    validBody();

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
  };
}

function verified(): ResolutionResult {
  const base = unresolved();

  return {
    ...base,

    status: "verified",

    investigation: {
      ...base.investigation,

      status: "verified",

      unresolvedFields: [],
    },

    verifiedAsset: {
      id: "verified:asset-1",

      candidateAssetId: "asset-1",

      canonicalAssetId: "ABCD11",

      assetType: "debenture",

      issuerEntityId:
        "company.petrobras",

      currency: "BRL",

      verification: {
        investigationId:
          "investigation:asset-1",

        evidenceIds: [],

        verifiedAt: NOW,

        policyVersion: "1.0.0",
      },
    },

    nextAction: "finish",
  };
}

async function json(
  response: Response,
): Promise<{
  ok: boolean;

  result?: ResolutionResult;

  error?: {
    code: string;

    message: string;

    issues?: unknown;
  };
}> {
  return response.json();
}

describe(
  "POST /api/aie/resolve-asset",
  () => {
    beforeEach(() => {
      resolveAsset.mockReset();

      resolveAsset.mockResolvedValue(
        unresolved(),
      );

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

    describe(
      "successful resolution (always HTTP 200)",
      () => {
        it(
          "returns 200 for a valid CandidateAsset and forwards it to resolveAsset",
          async () => {
            const response =
              await POST(
                post(validBody()),
              );

            expect(
              response.status,
            ).toBe(200);

            expect(
              response.headers.get(
                "cache-control",
              ),
            ).toBe("no-store");

            const body =
              await json(response);

            expect(body.ok).toBe(true);

            expect(
              body.result,
            ).toEqual(unresolved());

            expect(
              resolveAsset,
            ).toHaveBeenCalledTimes(1);

            expect(
              resolveAsset.mock
                .calls[0]?.[0],
            ).toEqual(validBody());
          },
        );

        it(
          "returns 200 for a verified ResolutionResult",
          async () => {
            resolveAsset.mockResolvedValue(
              verified(),
            );

            const response =
              await POST(
                post(validBody()),
              );

            expect(
              response.status,
            ).toBe(200);

            const body =
              await json(response);

            expect(
              body.result?.status,
            ).toBe("verified");
          },
        );

        it(
          "returns 200 for needs-more-evidence (an unresolved asset is not an HTTP error)",
          async () => {
            const response =
              await POST(
                post(validBody()),
              );

            expect(
              response.status,
            ).toBe(200);

            const body =
              await json(response);

            expect(
              body.result?.status,
            ).toBe(
              "needs-more-evidence",
            );

            expect(
              body.result
                ?.verifiedAsset,
            ).toBeNull();
          },
        );

        it(
          "returns 200 when a provider failure is recorded inside the InvestigationCase",
          async () => {
            const base =
              unresolved();

            resolveAsset.mockResolvedValue({
              ...base,

              investigation: {
                ...base.investigation,

                searches: [
                  {
                    providerId:
                      "ANBIMA",

                    startedAt: NOW,

                    finishedAt: NOW,

                    status:
                      "failed",

                    evidenceIds: [],

                    error:
                      "ANBIMA_SEARCH_FAILED: unavailable",
                  },
                ],
              },
            });

            const response =
              await POST(
                post(validBody()),
              );

            expect(
              response.status,
            ).toBe(200);

            const body =
              await json(response);

            expect(
              body.result
                ?.investigation
                .searches[0]?.status,
            ).toBe("failed");
          },
        );
      },
    );

    describe(
      "invalid input (HTTP 400, resolveAsset never called)",
      () => {
        async function expectInvalid(
          request: Request,
        ): Promise<
          Awaited<
            ReturnType<typeof json>
          >
        > {
          const response =
            await POST(request);

          expect(
            response.status,
          ).toBe(400);

          const body =
            await json(response);

          expect(body.ok).toBe(false);

          expect(
            body.error?.code,
          ).toBe(
            "INVALID_CANDIDATE_ASSET",
          );

          expect(
            body.error?.message,
          ).toBe(
            "Invalid candidate asset.",
          );

          expect(
            resolveAsset,
          ).not.toHaveBeenCalled();

          return body;
        }

        it(
          "rejects malformed JSON",
          async () => {
            const body =
              await expectInvalid(
                post("{not json"),
              );

            expect(
              body.error?.issues,
            ).toEqual([
              {
                path: "$",

                code: "invalid_json",
              },
            ]);
          },
        );

        it.each([
          ["an array", "[]"],
          ["a string", '"asset"'],
          ["a number", "42"],
          ["null", "null"],
        ])(
          "rejects a non-object body: %s",
          async (_label, raw) => {
            await expectInvalid(
              post(raw),
            );
          },
        );

        it(
          "rejects a missing id",
          async () => {
            const body: Record<
              string,
              unknown
            > = { ...validBody() };

            delete body.id;

            await expectInvalid(
              post(body),
            );
          },
        );

        it(
          "rejects a missing rawName",
          async () => {
            const body: Record<
              string,
              unknown
            > = { ...validBody() };

            delete body.rawName;

            await expectInvalid(
              post(body),
            );
          },
        );

        it(
          "rejects an invalid assetType",
          async () => {
            await expectInvalid(
              post({
                ...validBody(),

                hints: {
                  assetType: "bond",
                },
              }),
            );
          },
        );

        it(
          "rejects a non-string instrumentCode",
          async () => {
            await expectInvalid(
              post({
                ...validBody(),

                hints: {
                  assetType:
                    "debenture",

                  instrumentCode: 123,
                },
              }),
            );
          },
        );

        it(
          "rejects an overlong rawName",
          async () => {
            await expectInvalid(
              post({
                ...validBody(),

                rawName: "x".repeat(
                  257,
                ),
              }),
            );
          },
        );

        it(
          "rejects a non-finite amount (1e999 parses to Infinity)",
          async () => {
            await expectInvalid(
              post(
                '{"id":"a","rawName":"b","source":{},"hints":{"amount":1e999}}',
              ),
            );
          },
        );

        it(
          "rejects a string or negative amount",
          async () => {
            await expectInvalid(
              post({
                ...validBody(),

                hints: {
                  amount: "10",
                },
              }),
            );

            await expectInvalid(
              post({
                ...validBody(),

                hints: {
                  amount: -5,
                },
              }),
            );
          },
        );

        it(
          "rejects unknown fields and never echoes their names",
          async () => {
            const secretKey =
              "SENTINEL_UNKNOWN_KEY_NAME";

            const response =
              await POST(
                post({
                  ...validBody(),

                  [secretKey]: "x",
                }),
              );

            expect(
              response.status,
            ).toBe(400);

            expect(
              await response.text(),
            ).not.toContain(
              secretKey,
            );
          },
        );

        it(
          "rejects credential and provider configuration sent by the client",
          async () => {
            for (const forbidden of [
              "ANBIMA_CLIENT_SECRET",
              "access_token",
              "provider",
              "environment",
              "url",
            ]) {
              await expectInvalid(
                post({
                  ...validBody(),

                  [forbidden]: SECRET,
                }),
              );

              await expectInvalid(
                post({
                  ...validBody(),

                  hints: {
                    [forbidden]:
                      SECRET,
                  },
                }),
              );
            }
          },
        );

        it(
          "never echoes submitted values in the error response",
          async () => {
            const response =
              await POST(
                post({
                  id: SECRET,

                  rawName: 123,

                  source: {},

                  hints: {
                    amount: SECRET,
                  },
                }),
              );

            expect(
              await response.text(),
            ).not.toContain(SECRET);
          },
        );

        it(
          "rejects an oversized body (declared and actual)",
          async () => {
            const huge = JSON.stringify(
              {
                ...validBody(),

                rawName: "x".repeat(
                  MAX_BODY_BYTES,
                ),
              },
            );

            await expectInvalid(
              post(huge, {
                "content-type":
                  "application/json",

                "content-length":
                  String(
                    MAX_BODY_BYTES +
                      1,
                  ),
              }),
            );

            await expectInvalid(
              post(huge),
            );
          },
        );
      },
    );

    describe(
      "media type (HTTP 415)",
      () => {
        it.each([
          [
            "text/plain",
            {
              "content-type":
                "text/plain",
            },
          ],
          [
            "missing",
            {},
          ],
        ])(
          "rejects Content-Type: %s",
          async (_label, headers) => {
            const response =
              await POST(
                post(
                  validBody(),
                  headers,
                ),
              );

            expect(
              response.status,
            ).toBe(415);

            expect(
              (await json(response))
                .error?.code,
            ).toBe(
              "UNSUPPORTED_MEDIA_TYPE",
            );

            expect(
              resolveAsset,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          "accepts application/json with a charset",
          async () => {
            const response =
              await POST(
                post(validBody(), {
                  "content-type":
                    "application/json; charset=utf-8",
                }),
              );

            expect(
              response.status,
            ).toBe(200);
          },
        );
      },
    );

    describe(
      "server failures (no internals exposed)",
      () => {
        it(
          "maps AieServerError(configuration) to 503",
          async () => {
            resolveAsset.mockRejectedValue(
              new AieServerError(
                "configuration",
              ),
            );

            const response =
              await POST(
                post(validBody()),
              );

            expect(
              response.status,
            ).toBe(503);

            expect(
              await json(response),
            ).toEqual({
              ok: false,

              error: {
                code:
                  "AIE_CONFIGURATION_UNAVAILABLE",

                message:
                  "Asset resolution is temporarily unavailable.",
              },
            });
          },
        );

        it(
          "maps AieServerError(unexpected) to 500",
          async () => {
            resolveAsset.mockRejectedValue(
              new AieServerError(
                "unexpected",
              ),
            );

            const response =
              await POST(
                post(validBody()),
              );

            expect(
              response.status,
            ).toBe(500);

            expect(
              await json(response),
            ).toEqual({
              ok: false,

              error: {
                code:
                  "AIE_INTERNAL_ERROR",

                message:
                  "Unable to resolve asset.",
              },
            });
          },
        );

        it(
          "maps an arbitrary exception to 500 without leaking its message or stack",
          async () => {
            resolveAsset.mockRejectedValue(
              new Error(
                `boom ${SECRET}`,
              ),
            );

            const response =
              await POST(
                post(validBody()),
              );

            expect(
              response.status,
            ).toBe(500);

            const text =
              await response.text();

            expect(
              text,
            ).not.toContain(SECRET);

            expect(
              text,
            ).not.toContain("boom");

            expect(
              text,
            ).not.toContain("at ");
          },
        );

        it(
          "maps a non-Error rejection to 500",
          async () => {
            resolveAsset.mockRejectedValue(
              SECRET,
            );

            const response =
              await POST(
                post(validBody()),
              );

            expect(
              response.status,
            ).toBe(500);

            expect(
              await response.text(),
            ).not.toContain(SECRET);
          },
        );
      },
    );

    describe(
      "route module boundary",
      () => {
        function code(
          path: string,
        ): string {
          return readFileSync(
            new URL(path, import.meta.url),
            "utf8",
          )
            .replace(
              /\/\*[\s\S]*?\*\//g,
              "",
            )
            .replace(
              /^\s*\/\/.*$/gm,
              "",
            );
        }

        function imports(
          source: string,
        ): string[] {
          return Array.from(
            source.matchAll(
              /from\s*["']([^"']+)["']/g,
            ),
            (match) => match[1]!,
          );
        }

        const ROUTE =
          "../../../app/api/aie/resolve-asset/route.ts";

        it(
          "exports only POST plus route config",
          () => {
            expect(
              Object.keys(
                routeModule,
              ).sort(),
            ).toEqual([
              "POST",
              "dynamic",
              "runtime",
            ]);
          },
        );

        it(
          "route.ts does not access the process environment",
          () => {
            expect(
              code(ROUTE),
            ).not.toContain(
              "process.env",
            );
          },
        );

        it(
          "route.ts imports only the HTTP mapping module",
          () => {
            expect(
              imports(code(ROUTE)),
            ).toEqual([
              "../../../../lib/aie/server/resolve-asset-http",
            ]);
          },
        );

        it(
          "route.ts and the HTTP mapping contain no provider/runtime details",
          () => {
            for (const path of [
              ROUTE,
              "./resolve-asset-http.ts",
              "./candidate-asset-validation.ts",
            ]) {
              const source =
                code(path);

              expect(
                source,
              ).not.toContain(
                "process.env",
              );

              for (const forbidden of [
                "createAieFromEnv",
                "AnbimaHttpClient",
                "AnbimaDebentureProvider",
                "VerificationPolicy",
                "ProviderExecutionPipeline",
                "EvidenceOrchestrator",
                "ResolutionPlanner",
                "getServerAie",
                "console.",
              ]) {
                expect(
                  source,
                ).not.toContain(
                  forbidden,
                );
              }
            }
          },
        );

        it(
          "the HTTP mapping imports only the use case, the validator and the shared HTTP helpers",
          () => {
            expect(
              imports(
                code(
                  "./resolve-asset-http.ts",
                ),
              ).sort(),
            ).toEqual([
              "./aie-audited-request",
              "./aie-http",
              "./candidate-asset-validation",
              "./candidate-asset-validation",
              "./request-authorization",
              "./resolve-asset",
            ]);
          },
        );

        it(
          "importing the route performs no network request",
          async () => {
            vi.resetModules();

            const fetchSpy = vi.fn();

            vi.stubGlobal(
              "fetch",
              fetchSpy,
            );

            await import(
              "../../../app/api/aie/resolve-asset/route"
            );

            expect(
              fetchSpy,
            ).not.toHaveBeenCalled();
          },
        );
      },
    );
  },
);


// TASK-023: this file is not about usage limits, so the server usage controller
// is replaced by an allow-all one (limits are covered by aie-usage*.test.ts).
// vitest hoists vi.mock, so its position in the file is irrelevant.
vi.mock(
  "./create-server-usage-controller",
  () => ({
    getAieUsageController: () => ({
      check: async () => ({
        allowed: true as const,
      }),
    }),
  }),
);