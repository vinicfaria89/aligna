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

import type {
  CandidateAsset,
  ResolutionResult,
} from "../contracts";

// Imported by relative path: the project has no Vitest alias for "@/".
import * as routeModule from "../../../app/api/aie/resolve-assets/route";

import * as singleRouteModule from "../../../app/api/aie/resolve-asset/route";

import {
  MAX_BATCH_BODY_BYTES,
  validateBatchRequest,
} from "./resolve-assets-http";

import {
  BatchResolutionError,
  MAX_BATCH_CONCURRENCY,
  MAX_BATCH_SIZE,
} from "./resolve-assets";

import type {
  BatchResolutionItem,
  BatchResolutionResult,
} from "./resolve-assets";

const resolveAssets = vi.hoisted(
  () => vi.fn(),
);

vi.mock(
  "./resolve-assets",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("./resolve-assets")
      >();

    return {
      ...actual,

      resolveAssets: (
        ...args: unknown[]
      ) => resolveAssets(...args),
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
  "sentinel-batch-route-secret";

const URL_ =
  "http://localhost/api/aie/resolve-assets";

interface Body {
  ok: boolean;

  result?: BatchResolutionResult;

  error?: {
    code: string;

    message: string;

    issues?: Array<{
      path: string;

      code: string;
    }>;
  };
}

function asset(
  id: string,
  instrumentCode = "ABCD11",
): CandidateAsset {
  return {
    id,

    rawName: `DEB ${id}`,

    source: {},

    hints: {
      assetType: "debenture",

      instrumentCode,
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

function resultFor(
  candidateAsset: CandidateAsset,
): ResolutionResult {
  return {
    status:
      "needs-more-evidence",

    investigation: {
      id: `investigation:${candidateAsset.id}`,

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

function okItems(
  assets: readonly CandidateAsset[],
): BatchResolutionResult {
  return {
    items: assets.map(
      (candidate, index) => ({
        index,

        candidateAssetId:
          candidate.id,

        ok: true as const,

        result:
          resultFor(candidate),
      }),
    ),
  };
}

async function json(
  response: Response,
): Promise<Body> {
  return (await response.json()) as Body;
}

function code(
  relativePath: string,
): string {
  return readFileSync(
    new URL(
      relativePath,
      import.meta.url,
    ),
    "utf8",
  )
    .replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    )
    .replace(/^\s*\/\/.*$/gm, "");
}

function imports(
  source: string,
): string[] {
  return [
    ...source.matchAll(
      /from\s*["']([^"']+)["']/g,
    ),
  ].map((match) =>
    match[1] as string,
  );
}

describe("POST /api/aie/resolve-assets", () => {
  beforeEach(() => {
    resolveAssets.mockReset();

    resolveAssets.mockImplementation(
      async (
        assets: CandidateAsset[],
      ) => okItems(assets),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("success semantics", () => {
    it("resolves a valid empty batch with items []", async () => {
      const response =
        await POST(
          post({
            assets: [],
          }),
        );

      expect(
        response.status,
      ).toBe(200);

      expect(
        await json(response),
      ).toEqual({
        ok: true,

        result: {
          items: [],
        },
      });

      expect(
        resolveAssets,
      ).toHaveBeenCalledWith([], {});
    });

    it("resolves one valid asset", async () => {
      const response =
        await POST(
          post({
            assets: [asset("A")],
          }),
        );

      const body =
        await json(response);

      expect(
        response.status,
      ).toBe(200);

      expect(body.ok).toBe(true);

      expect(
        body.result?.items,
      ).toHaveLength(1);
    });

    it("resolves several valid assets with one service call", async () => {
      const assets = [
        asset("A"),
        asset("B", "EFGH22"),
        asset("C", "IJKL33"),
      ];

      const response =
        await POST(
          post({ assets }),
        );

      expect(
        response.status,
      ).toBe(200);

      expect(
        resolveAssets,
      ).toHaveBeenCalledTimes(1);

      expect(
        resolveAssets,
      ).toHaveBeenCalledWith(
        assets,
        {},
      );
    });

    it("preserves the order returned by the service", async () => {
      const response =
        await POST(
          post({
            assets: [
              asset("Z"),
              asset("A"),
              asset("M"),
            ],
          }),
        );

      const body =
        await json(response);

      expect(
        body.result?.items.map(
          (item) => [
            item.index,
            item.candidateAssetId,
          ],
        ),
      ).toEqual([
        [0, "Z"],
        [1, "A"],
        [2, "M"],
      ]);
    });

    it("answers 200 for unresolved items", async () => {
      const response =
        await POST(
          post({
            assets: [
              asset("A"),
              asset("B"),
            ],
          }),
        );

      expect(
        response.status,
      ).toBe(200);

      const body =
        await json(response);

      for (const item of body.result
        ?.items ?? []) {
        expect(
          item.ok &&
            item.result.status,
        ).toBe(
          "needs-more-evidence",
        );
      }
    });

    it("answers 200 for an item-level internal error", async () => {
      resolveAssets.mockResolvedValue(
        {
          items: [
            {
              index: 0,

              candidateAssetId: "A",

              ok: false,

              error: {
                code: "AIE_INTERNAL_ERROR",

                message:
                  "Unable to resolve asset.",
              },
            },
          ],
        },
      );

      const response =
        await POST(
          post({
            assets: [asset("A")],
          }),
        );

      expect(
        response.status,
      ).toBe(200);

      const body =
        await json(response);

      expect(body.ok).toBe(true);

      expect(
        body.result?.items[0],
      ).toMatchObject({
        ok: false,

        error: {
          code: "AIE_INTERNAL_ERROR",
        },
      });
    });

    it("answers 200 for a configuration failure reported per item (no route-level 503)", async () => {
      resolveAssets.mockResolvedValue(
        {
          items: ["A", "B"].map(
            (id, index) => ({
              index,

              candidateAssetId: id,

              ok: false,

              error: {
                code: "AIE_CONFIGURATION_UNAVAILABLE",

                message:
                  "Asset resolution is temporarily unavailable.",
              },
            }),
          ),
        },
      );

      const response =
        await POST(
          post({
            assets: [
              asset("A"),
              asset("B"),
            ],
          }),
        );

      expect(
        response.status,
      ).toBe(200);
    });

    it("answers 200 for a mix of success and failure", async () => {
      const assets = [
        asset("A"),
        asset("B"),
        asset("C"),
      ];

      const items: BatchResolutionItem[] =
        [
          {
            index: 0,

            candidateAssetId: "A",

            ok: true,

            result: resultFor(
              assets[0] as CandidateAsset,
            ),
          },
          {
            index: 1,

            candidateAssetId: "B",

            ok: false,

            error: {
              code: "AIE_INTERNAL_ERROR",

              message:
                "Unable to resolve asset.",
            },
          },
          {
            index: 2,

            candidateAssetId: "C",

            ok: true,

            result: resultFor(
              assets[2] as CandidateAsset,
            ),
          },
        ];

      resolveAssets.mockResolvedValue(
        { items },
      );

      const response =
        await POST(
          post({ assets }),
        );

      const body =
        await json(response);

      expect(
        response.status,
      ).toBe(200);

      expect(
        body.result?.items.map(
          (item) => item.ok,
        ),
      ).toEqual([
        true,
        false,
        true,
      ]);
    });
  });

  describe("request validation", () => {
    it("rejects malformed JSON with 400", async () => {
      const response =
        await POST(
          post("{not json"),
        );

      expect(
        response.status,
      ).toBe(400);

      expect(
        await json(response),
      ).toEqual({
        ok: false,

        error: {
          code: "INVALID_ASSET_BATCH",

          message:
            "Invalid asset batch.",

          issues: [
            {
              path: "$",

              code: "invalid_json",
            },
          ],
        },
      });

      expect(
        resolveAssets,
      ).not.toHaveBeenCalled();
    });

    it("rejects a non-object root with 400", async () => {
      for (const root of [
        [],
        [asset("A")],
        "text",
        42,
        null,
        true,
      ]) {
        // Serialized explicitly: post() sends a bare string as is.
        const response =
          await POST(
            post(
              JSON.stringify(root),
            ),
          );

        expect(
          response.status,
        ).toBe(400);

        expect(
          (await json(response))
            .error?.issues,
        ).toEqual([
          {
            path: "$",

            code: "type",
          },
        ]);
      }

      expect(
        resolveAssets,
      ).not.toHaveBeenCalled();
    });

    it("rejects a missing assets field with 400", async () => {
      const response =
        await POST(post({}));

      expect(
        response.status,
      ).toBe(400);

      expect(
        (await json(response)).error
          ?.issues,
      ).toEqual([
        {
          path: "assets",

          code: "required",
        },
      ]);
    });

    it("rejects assets that is not an array with 400", async () => {
      for (const assets of [
        {},
        "A",
        7,
        null,
        asset("A"),
      ]) {
        const response =
          await POST(
            post({ assets }),
          );

        expect(
          response.status,
        ).toBe(400);

        expect(
          (await json(response))
            .error?.issues,
        ).toEqual([
          {
            path: "assets",

            code: "type",
          },
        ]);
      }
    });

    it("reports an invalid CandidateAsset with its safe array index and field path", async () => {
      const response =
        await POST(
          post({
            assets: [
              asset("A"),
              asset("B"),
              {
                id: "C",

                source: {},

                hints: {
                  ticker: 12,
                },
              },
              "not an object",
            ],
          }),
        );

      expect(
        response.status,
      ).toBe(400);

      const body =
        await json(response);

      expect(
        body.error?.issues,
      ).toEqual([
        {
          path: "assets[2].rawName",

          code: "required",
        },
        {
          path: "assets[2].hints.ticker",

          code: "type",
        },
        {
          path: "assets[3]",

          code: "type",
        },
      ]);

      expect(
        resolveAssets,
      ).not.toHaveBeenCalled();
    });

    it("never echoes submitted values or unknown key names", async () => {
      const response =
        await POST(
          post({
            assets: [
              {
                ...asset("A"),

                [`sentinel-key-${SECRET}`]:
                  SECRET,
              },
            ],

            [`root-key-${SECRET}`]:
              SECRET,
          }),
        );

      expect(
        response.status,
      ).toBe(400);

      expect(
        JSON.stringify(
          await json(response),
        ),
      ).not.toContain(SECRET);
    });

    it("rejects an unknown top-level field with 400", async () => {
      const response =
        await POST(
          post({
            assets: [asset("A")],

            extra: true,
          }),
        );

      expect(
        response.status,
      ).toBe(400);

      expect(
        (await json(response)).error
          ?.issues,
      ).toEqual([
        {
          path: "$",

          code: "unknown_field",
        },
      ]);

      expect(
        resolveAssets,
      ).not.toHaveBeenCalled();
    });

    it("rejects sensitive customer fields inside an asset with 400", async () => {
      for (const field of [
        "customerName",
        "cpf",
        "accountNumber",
        "totalWealth",
        "portfolioBalance",
        "password",
        "token",
        "access_token",
        "clientSecret",
      ]) {
        const response =
          await POST(
            post({
              assets: [
                {
                  ...asset("A"),

                  [field]: SECRET,
                },
              ],
            }),
          );

        expect(
          response.status,
        ).toBe(400);

        const text =
          JSON.stringify(
            await json(response),
          );

        expect(text).toContain(
          "assets[0]",
        );

        expect(text).not.toContain(
          field,
        );

        expect(text).not.toContain(
          SECRET,
        );
      }

      expect(
        resolveAssets,
      ).not.toHaveBeenCalled();
    });

    it("accepts exactly MAX_BATCH_SIZE assets and rejects one more, using the service limit", async () => {
      const at = Array.from(
        {
          length: MAX_BATCH_SIZE,
        },
        (_, i) => asset(`A${i}`),
      );

      const accepted =
        await POST(
          post({ assets: at }),
        );

      expect(
        accepted.status,
      ).toBe(200);

      resolveAssets.mockClear();

      const rejected =
        await POST(
          post({
            assets: [
              ...at,
              asset("EXTRA"),
            ],
          }),
        );

      expect(
        rejected.status,
      ).toBe(400);

      expect(
        (await json(rejected)).error
          ?.issues,
      ).toEqual([
        {
          path: "assets",

          code: "too_long",
        },
      ]);

      expect(
        resolveAssets,
      ).not.toHaveBeenCalled();
    });
  });

  describe("body size and media type", () => {
    it("rejects a declared oversized body with 413 before reading it", async () => {
      const response =
        await POST(
          post(
            {
              assets: [],
            },
            {
              "content-type":
                "application/json",

              "content-length": String(
                MAX_BATCH_BODY_BYTES +
                  1,
              ),
            },
          ),
        );

      expect(
        response.status,
      ).toBe(413);

      expect(
        await json(response),
      ).toEqual({
        ok: false,

        error: {
          code: "PAYLOAD_TOO_LARGE",

          message:
            "Request payload is too large.",
        },
      });

      expect(
        resolveAssets,
      ).not.toHaveBeenCalled();
    });

    it("rejects an oversized streamed body with 413", async () => {
      const response =
        await POST(
          post(
            "x".repeat(
              MAX_BATCH_BODY_BYTES +
                1,
            ),
          ),
        );

      expect(
        response.status,
      ).toBe(413);

      expect(
        resolveAssets,
      ).not.toHaveBeenCalled();
    });

    it("measures bytes, not characters", async () => {
      const response =
        await POST(
          post(
            "é".repeat(
              MAX_BATCH_BODY_BYTES / 2 +
                1,
            ),
          ),
        );

      expect(
        response.status,
      ).toBe(413);
    });

    it("keeps the body limit bounded and above what MAX_BATCH_SIZE assets need", () => {
      expect(
        MAX_BATCH_BODY_BYTES,
      ).toBe(512 * 1024);

      expect(
        JSON.stringify({
          assets: Array.from(
            {
              length: MAX_BATCH_SIZE,
            },
            (_, i) =>
              asset(`A${i}`),
          ),
        }).length,
      ).toBeLessThan(
        MAX_BATCH_BODY_BYTES,
      );
    });

    it("rejects a wrong or missing Content-Type with 415", async () => {
      for (const headers of [
        {
          "content-type":
            "text/plain",
        },
        {
          "content-type":
            "application/x-www-form-urlencoded",
        },
        {},
      ] as Array<
        Record<string, string>
      >) {
        const response =
          await POST(
            post(
              {
                assets: [],
              },
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
      }

      expect(
        resolveAssets,
      ).not.toHaveBeenCalled();
    });

    it("accepts a JSON Content-Type with a charset", async () => {
      const response =
        await POST(
          post(
            {
              assets: [],
            },
            {
              "content-type":
                "application/json; charset=utf-8",
            },
          ),
        );

      expect(
        response.status,
      ).toBe(200);
    });
  });

  describe("concurrency option", () => {
    it("passes a valid concurrency to the service", async () => {
      await POST(
        post({
          assets: [asset("A")],

          options: {
            concurrency: 2,
          },
        }),
      );

      expect(
        resolveAssets,
      ).toHaveBeenCalledWith(
        [asset("A")],
        {
          concurrency: 2,
        },
      );
    });

    it("accepts the service maximum and minimum", async () => {
      for (const concurrency of [
        1,
        MAX_BATCH_CONCURRENCY,
      ]) {
        const response =
          await POST(
            post({
              assets: [asset("A")],

              options: {
                concurrency,
              },
            }),
          );

        expect(
          response.status,
        ).toBe(200);
      }
    });

    it("rejects invalid concurrency with 400", async () => {
      for (const concurrency of [
        0,
        -1,
        1.5,
        MAX_BATCH_CONCURRENCY + 1,
        "3",
        null,
        true,
        [],
      ]) {
        const response =
          await POST(
            post({
              assets: [asset("A")],

              options: {
                concurrency,
              },
            }),
          );

        expect(
          response.status,
        ).toBe(400);

        expect(
          (await json(response))
            .error?.issues?.[0]?.path,
        ).toBe(
          "options.concurrency",
        );
      }

      expect(
        resolveAssets,
      ).not.toHaveBeenCalled();
    });

    it("rejects a non-object options with 400", async () => {
      for (const options of [
        7,
        "x",
        null,
        [],
      ]) {
        const response =
          await POST(
            post({
              assets: [],

              options,
            }),
          );

        expect(
          response.status,
        ).toBe(400);

        expect(
          (await json(response))
            .error?.issues,
        ).toEqual([
          {
            path: "options",

            code: "type",
          },
        ]);
      }
    });

    it("does not let the client set rate limit, cache, provider or environment configuration", async () => {
      for (const forbidden of [
        {
          rateLimit: {
            maxRequests: 1000,
          },
        },
        {
          feedCacheTtlMs: 1,
        },
        {
          provider: "ANBIMA",
        },
        {
          url: "https://evil.example",
        },
        {
          environment: "sandbox",
        },
        {
          maxBatchSize: 10_000,
        },
      ]) {
        for (const body of [
          {
            assets: [asset("A")],

            ...forbidden,
          },
          {
            assets: [asset("A")],

            options: {
              concurrency: 2,

              ...forbidden,
            },
          },
        ]) {
          const response =
            await POST(post(body));

          expect(
            response.status,
          ).toBe(400);

          expect(
            (await json(response))
              .error?.issues?.[0]
              ?.code,
          ).toBe("unknown_field");
        }
      }

      expect(
        resolveAssets,
      ).not.toHaveBeenCalled();
    });
  });

  describe("errors and headers", () => {
    it("maps an unexpected exception to a generic 500 without leaking it", async () => {
      resolveAssets.mockRejectedValue(
        new Error(
          `boom ${SECRET}`,
        ),
      );

      const response =
        await POST(
          post({
            assets: [asset("A")],
          }),
        );

      expect(
        response.status,
      ).toBe(500);

      const body =
        await json(response);

      expect(body).toEqual({
        ok: false,

        error: {
          code: "AIE_INTERNAL_ERROR",

          message:
            "Unable to resolve assets.",
        },
      });

      expect(
        JSON.stringify(body),
      ).not.toContain(SECRET);
    });

    it("maps a BatchResolutionError from the service to a 400 (defense in depth)", async () => {
      resolveAssets.mockRejectedValue(
        new BatchResolutionError(
          "BATCH_TOO_LARGE",
        ),
      );

      const response =
        await POST(
          post({
            assets: [asset("A")],
          }),
        );

      expect(
        response.status,
      ).toBe(400);

      expect(
        (await json(response)).error
          ?.code,
      ).toBe("INVALID_ASSET_BATCH");
    });

    it("sends Cache-Control: no-store and JSON on every kind of response", async () => {
      resolveAssets.mockRejectedValueOnce(
        new Error("boom"),
      );

      const responses =
        await Promise.all([
          POST(
            post({
              assets: [asset("A")],
            }),
          ),
          POST(
            post({
              assets: [asset("A")],
            }),
          ),
          POST(post("{")),
          POST(
            post(
              {},
              {
                "content-type":
                  "text/plain",
              },
            ),
          ),
          POST(
            post(
              "x".repeat(
                MAX_BATCH_BODY_BYTES +
                  1,
              ),
            ),
          ),
        ]);

      expect(
        responses.map(
          (response) =>
            response.status,
        ).sort(),
      ).toEqual([
        200, 400, 413, 415, 500,
      ]);

      for (const response of responses) {
        expect(
          response.headers.get(
            "cache-control",
          ),
        ).toBe("no-store");

        expect(
          response.headers.get(
            "content-type",
          ),
        ).toContain(
          "application/json",
        );
      }
    });

    it("never sets CORS headers", async () => {
      const response =
        await POST(
          post({
            assets: [],
          }),
        );

      for (const name of [
        "access-control-allow-origin",
        "access-control-allow-credentials",
        "access-control-allow-headers",
        "access-control-allow-methods",
      ]) {
        expect(
          response.headers.get(
            name,
          ),
        ).toBeNull();
      }
    });

    it("keeps the secret sentinel out of a serialized success response", async () => {
      const response =
        await POST(
          post({
            assets: [asset("A")],
          }),
        );

      expect(
        JSON.stringify(
          await json(response),
        ),
      ).not.toContain(SECRET);
    });
  });

  describe("validateBatchRequest", () => {
    it("returns fresh validated assets and normalized options", () => {
      const input = {
        assets: [asset("A")],

        options: {
          concurrency: 4,
        },
      };

      const validation =
        validateBatchRequest(input);

      expect(validation).toEqual({
        ok: true,

        assets: [asset("A")],

        options: {
          concurrency: 4,
        },
      });

      if (validation.ok) {
        expect(
          validation.assets[0],
        ).not.toBe(input.assets[0]);
      }
    });

    it("caps the number of reported issues", () => {
      const validation =
        validateBatchRequest({
          assets: Array.from(
            { length: 50 },
            () => ({}),
          ),
        });

      expect(validation.ok).toBe(
        false,
      );

      if (!validation.ok) {
        expect(
          validation.issues.length,
        ).toBeLessThanOrEqual(20);
      }
    });
  });

  describe("route module boundary", () => {
    it("exports only POST plus the runtime configuration", () => {
      expect(
        Object.keys(routeModule).sort(),
      ).toEqual([
        "POST",
        "dynamic",
        "runtime",
      ]);

      expect(
        routeModule.runtime,
      ).toBe("nodejs");

      expect(
        routeModule.dynamic,
      ).toBe("force-dynamic");
    });

    it("route.ts imports only the batch HTTP mapping", () => {
      expect(
        imports(
          code(
            "../../../app/api/aie/resolve-assets/route.ts",
          ),
        ),
      ).toEqual([
        "../../../../lib/aie/server/resolve-assets-http",
      ]);
    });

    it("route.ts reads no environment and has no provider-specific code", () => {
      const source = code(
        "../../../app/api/aie/resolve-assets/route.ts",
      );

      for (const forbidden of [
        "process.env",
        "AnbimaHttpClient",
        "AnbimaDebentureProvider",
        "createAieFromEnv",
        "VerificationPolicy",
        "ProviderExecutionPipeline",
        "RateLimiter",
        "ANBIMA",
      ]) {
        expect(
          source,
        ).not.toContain(forbidden);
      }
    });

    it("the HTTP mapping imports only the batch service, the validator and the shared helpers", () => {
      expect(
        imports(
          code(
            "./resolve-assets-http.ts",
          ),
        ).sort(),
      ).toEqual([
        "../contracts",
        "./aie-audited-request",
        "./aie-http",
        "./candidate-asset-validation",
        "./candidate-asset-validation",
        "./request-authorization",
        "./resolve-assets",
      ]);
    });

    it("no HTTP module reads the environment, logs or introduces wildcard CORS", () => {
      for (const file of [
        "../../../app/api/aie/resolve-assets/route.ts",
        "./resolve-assets-http.ts",
        "./aie-http.ts",
      ]) {
        const source = code(file);

        expect(source).not.toContain(
          "process.env",
        );

        expect(source).not.toMatch(
          /console\./,
        );

        expect(
          source.toLowerCase(),
        ).not.toContain(
          "access-control",
        );
      }
    });

    it("importing the route performs no network request", async () => {
      vi.resetModules();

      const fetchSpy = vi.fn();

      vi.stubGlobal(
        "fetch",
        fetchSpy,
      );

      await import(
        "../../../app/api/aie/resolve-assets/route"
      );

      expect(
        fetchSpy,
      ).not.toHaveBeenCalled();
    });

    it("leaves the single-asset route untouched", () => {
      expect(
        Object.keys(
          singleRouteModule,
        ).sort(),
      ).toEqual([
        "POST",
        "dynamic",
        "runtime",
      ]);
    });
  });
});
