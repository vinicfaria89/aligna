import {
  readFileSync,
} from "node:fs";

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

// Imported by relative path: the project has no Vitest alias for "@/".
import * as csvRoute from "../../../app/api/aie/resolve-csv/route";

import * as batchRoute from "../../../app/api/aie/resolve-assets/route";

import type {
  AieAuditEvent,
} from "./aie-audit";

import type {
  AieUsageController,
} from "./aie-usage";

import {
  createFakeAuditSink,
} from "./fake-aie-audit-sink";

import {
  recordUsage,
  createScriptedUsageController,
} from "./fake-aie-usage-controller";

import {
  createInMemoryUsageController,
} from "./in-memory-usage-controller";

import type {
  AieAuthorizationResult,
  AieRequestAuthorizer,
} from "./request-authorization";

import {
  MAX_BATCH_SIZE,
} from "./resolve-assets";

import {
  handleResolveCsvRequest,
  MAX_CSV_BODY_BYTES,
} from "./resolve-csv-http";

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

/**
 * TASK-024: POST /api/aie/resolve-csv through the real handler with the real CSV
 * adapter and ingestion; the authorizer, usage controller, audit sink and clock
 * are injected and the batch service is replaced by a spy. Nothing touches the
 * network.
 */

const SUBJECT =
  "3f2b1c9e-8a4d-4e6f-9b0a-1c2d3e4f5a6b";

const BEARER =
  "sentinel-csv-bearer-token";

const RAW_NAME =
  "SENTINEL-CSV-RAW-NAME";

const INSTRUMENT =
  "SENTINELCSV99";

const AMOUNT = "987654.32";

const URL_ =
  "http://localhost/api/aie/resolve-csv";

const FIXED = new Date(
  "2026-09-20T22:00:00.000Z",
);

const FRONTEND_ROOT = fileURLToPath(
  new URL("../../..", import.meta.url),
);

function csv(
  ...lines: string[]
): string {
  return lines.join("\n");
}

// Every row needs an `id` (or `fileId` + `row`): ingestion derives no other id.
const GOOD = csv(
  "id,rawName,assetType,instrumentCode,amount",
  `asset-1,${RAW_NAME},debenture,${INSTRUMENT},${AMOUNT}`,
);

function post(
  body: string | Uint8Array,
  headers: Record<string, string> = {
    "content-type": "text/csv",

    authorization: `Bearer ${BEARER}`,
  },
): Request {
  return new Request(URL_, {
    method: "POST",

    headers,

    body,
  });
}

function allow(): AieRequestAuthorizer {
  return {
    authorize: async () => ({
      authorized: true,

      principal: {
        subject: SUBJECT,

        roles: ["cliente"],
      },
    }),
  };
}

function deny(
  result: AieAuthorizationResult,
): AieRequestAuthorizer {
  return {
    authorize: async () => result,
  };
}

function allowAll(): AieUsageController {
  return {
    check: async () => ({
      allowed: true,
    }),
  };
}

function options(
  extra: {
    authorizer?: AieRequestAuthorizer;

    usage?: AieUsageController;

    sink?: ReturnType<
      typeof createFakeAuditSink
    >;
  } = {},
) {
  return {
    authorizer:
      extra.authorizer ?? allow(),

    usage: extra.usage ?? allowAll(),

    audit: {
      sink:
        extra.sink ??
        createFakeAuditSink(),

      now: () => FIXED,

      generateCorrelationId: () =>
        "corr-csv-1",
    },
  };
}

async function call(
  body: string | Uint8Array,
  extra: Parameters<
    typeof options
  >[0] = {},
  headers?: Record<string, string>,
) {
  const request = post(body, headers);

  const response =
    await handleResolveCsvRequest(
      request,
      options(extra),
    );

  return { request, response };
}

async function errorOf(
  response: Response,
): Promise<{
  ok: boolean;

  error: {
    code: string;

    message: string;

    issues?: Array<{
      path: string;

      code: string;
    }>;
  };
}> {
  return response.json();
}

function candidatesOfCall(
  index = 0,
): CandidateAsset[] {
  return resolveAssets.mock.calls[
    index
  ]?.[0] as CandidateAsset[];
}

function source(
  path: string,
): string {
  return readFileSync(
    fileURLToPath(
      new URL(path, import.meta.url),
    ),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function limits(
  batch: number,
  single = 30,
) {
  return createInMemoryUsageController({
    policy: {
      "resolve-asset": {
        limit: single,

        windowMs: 60_000,
      },

      "resolve-assets": {
        limit: batch,

        windowMs: 60_000,
      },
    },

    now: () => 7_000_000,
  });
}

describe("POST /api/aie/resolve-csv", () => {
  beforeEach(() => {
    resolveAssets.mockReset();

    resolveAssets.mockImplementation(
      async (
        assets: CandidateAsset[],
      ) => ({
        items: assets.map(
          (candidate, index) => ({
            index,

            candidateAssetId:
              candidate.id,

            ok: true,

            result: {
              status:
                "needs-more-evidence",
            },
          }),
        ),
      }),
    );

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

  describe("successful resolution", () => {
    it("answers 200 for a valid minimal CSV and resolves its candidates", async () => {
      const { response } = await call(
        csv("id,rawName", "a1,DEB ALPHA"),
      );

      expect(response.status).toBe(200);

      const body = (await response.json()) as {
        ok: boolean;

        result: {
          items: unknown[];
        };
      };

      expect(body.ok).toBe(true);

      expect(
        body.result.items,
      ).toHaveLength(1);

      expect(
        resolveAssets,
      ).toHaveBeenCalledTimes(1);

      expect(
        candidatesOfCall()[0]?.rawName,
      ).toBe("DEB ALPHA");

      // Default batch options: nothing the client controls.
      expect(
        resolveAssets.mock.calls[0]?.[1],
      ).toEqual({});
    });

    it("preserves the CSV row order", async () => {
      const { response } = await call(
        csv(
          "id,rawName,instrumentCode",
          "r1,ZZZ,CODE3",
          "r2,AAA,CODE1",
          "r3,MMM,CODE2",
        ),
      );

      expect(response.status).toBe(200);

      expect(
        candidatesOfCall().map(
          (candidate) =>
            candidate.rawName,
        ),
      ).toEqual(["ZZZ", "AAA", "MMM"]);

      const body = (await response.json()) as {
        result: {
          items: Array<{
            index: number;
          }>;
        };
      };

      expect(
        body.result.items.map(
          (item) => item.index,
        ),
      ).toEqual([0, 1, 2]);
    });

    it("answers 200 with items [] for a header-only CSV and calls no provider", async () => {
      for (const body of [
        "rawName",
        "rawName\n",
        "rawName,assetType\r\n",
      ]) {
        resolveAssets.mockClear();

        const { response } =
          await call(body);

        expect(response.status).toBe(
          200,
        );

        expect(
          (
            (await response.json()) as {
              result: {
                items: unknown[];
              };
            }
          ).result.items,
        ).toEqual([]);

        expect(
          candidatesOfCall(),
        ).toEqual([]);
      }

      expect(
        globalThis.fetch,
      ).not.toHaveBeenCalled();
    });

    it("supports quoted commas, quotes and line breaks inside quotes", async () => {
      const { response } = await call(
        csv(
          "id,rawName,issuerName",
          'q1,"DEB, ALPHA ""SERIES A""","Vale, S.A."',
        ),
      );

      expect(response.status).toBe(200);

      expect(
        candidatesOfCall()[0]?.rawName,
      ).toBe('DEB, ALPHA "SERIES A"');

      expect(
        candidatesOfCall()[0]?.hints
          .issuerName,
      ).toBe("Vale, S.A.");
    });

    it("supports CRLF line endings", async () => {
      const { response } = await call(
        "id,rawName,instrumentCode\r\nc1,DEB A,CODE1\r\nc2,DEB B,CODE2\r\n",
      );

      expect(response.status).toBe(200);

      expect(
        candidatesOfCall().map(
          (candidate) =>
            candidate.rawName,
        ),
      ).toEqual(["DEB A", "DEB B"]);
    });

    it("supports a UTF-8 BOM and UTF-8 text", async () => {
      const bytes =
        new TextEncoder().encode(
          "id,rawName\nb1,DEBENTURE AÇÃO ÚNICA\n",
        );

      const withBom = new Uint8Array(
        bytes.length + 3,
      );

      withBom.set(
        [0xef, 0xbb, 0xbf],
        0,
      );

      withBom.set(bytes, 3);

      const { response } =
        await call(withBom);

      expect(response.status).toBe(200);

      expect(
        candidatesOfCall()[0]?.rawName,
      ).toBe("DEBENTURE AÇÃO ÚNICA");
    });

    it("keeps a per-item failure inside items (still HTTP 200)", async () => {
      resolveAssets.mockResolvedValue({
        items: [
          {
            index: 0,

            candidateAssetId: "x",

            ok: false,

            error: {
              code: "AIE_INTERNAL_ERROR",

              message:
                "Unable to resolve asset.",
            },
          },
        ],
      });

      const { response } = await call(
        csv("id,rawName", "p1,DEB A"),
      );

      expect(response.status).toBe(200);
    });
  });

  describe("CSV errors are 400 INVALID_PORTFOLIO_CSV", () => {
    const cases: Array<
      [string, string, string, string]
    > = [
      [
        "an unterminated quote",
        csv("rawName", '"open'),
        "malformed_csv",
        "row[2]",
      ],
      [
        "a stray quote in an unquoted field",
        csv("rawName", 'DE"B'),
        "malformed_csv",
        "row[2]",
      ],
      [
        "an unknown header",
        csv("rawName,color", "DEB,blue"),
        "unknown_field",
        "header[2]",
      ],
      [
        "a sensitive header (cpf)",
        csv("rawName,cpf", "DEB,123.456.789-09"),
        "forbidden_field",
        "header[2]",
      ],
      [
        "a sensitive header (customerName)",
        csv(
          "rawName,customerName",
          "DEB,Joao da Silva",
        ),
        "forbidden_field",
        "header[2]",
      ],
      [
        "a missing rawName header",
        csv("assetType", "debenture"),
        "required",
        "header",
      ],
      [
        "an invalid amount",
        csv(
          "id,rawName,amount",
          'a,DEB,"R$ 1.000,00"',
        ),
        "invalid_value",
        "row[2].amount",
      ],
      [
        "a negative amount (ingestion rule)",
        csv("id,rawName,amount", "a,DEB,-5"),
        "invalid_value",
        "row[2].amount",
      ],
      [
        "extra columns in a row",
        csv("rawName", "DEB,extra"),
        "extra_columns",
        "row[2]",
      ],
      [
        "missing columns in a row",
        csv("rawName,assetType", "DEB"),
        "missing_columns",
        "row[2]",
      ],
      [
        "an invalid assetType",
        csv("rawName,assetType", "DEB,bond"),
        "invalid_value",
        "row[2].assetType",
      ],
      [
        "an empty rawName",
        csv("id,rawName,assetType", "a,,debenture"),
        "empty",
        "row[2].rawName",
      ],
      [
        "a duplicate header",
        csv("rawName,rawName", "A,B"),
        "duplicate_header",
        "header[2]",
      ],
      [
        "an empty body (no header)",
        "",
        "required",
        "header",
      ],
    ];

    for (const [
      name,
      body,
      code,
      path,
    ] of cases) {
      it(`${name}`, async () => {
        const { response } =
          await call(body);

        expect(response.status).toBe(
          400,
        );

        const payload =
          await errorOf(response);

        expect(payload.error.code).toBe(
          "INVALID_PORTFOLIO_CSV",
        );

        expect(
          payload.error.message,
        ).toBe("Invalid portfolio CSV.");

        expect(
          payload.error.issues,
        ).toEqual(
          expect.arrayContaining([
            {
              path,

              code,
            },
          ]),
        );

        // A parse/ingestion failure never reaches resolution or the network.
        expect(
          resolveAssets,
        ).not.toHaveBeenCalled();

        expect(
          globalThis.fetch,
        ).not.toHaveBeenCalled();
      });
    }

    it("reports the row of an ingestion failure (data row N is CSV row N+1)", async () => {
      const { response } = await call(
        csv(
          "id,rawName,amount",
          "a,OK,1",
          "b,OK2,2",
          "c,BAD,-1",
        ),
      );

      expect(
        (await errorOf(response)).error
          .issues,
      ).toEqual([
        {
          path: "row[4].amount",

          code: "invalid_value",
        },
      ]);
    });

    it("never echoes cells, header names or the CSV in the error", async () => {
      const { response } = await call(
        csv(
          `rawName,secretColumnName${RAW_NAME}`,
          `${RAW_NAME},value-${INSTRUMENT}`,
        ),
      );

      expect(response.status).toBe(400);

      const text =
        await response.text();

      for (const leaked of [
        RAW_NAME,
        INSTRUMENT,
        "secretColumnName",
        "value-",
      ]) {
        expect(text).not.toContain(
          leaked,
        );
      }
    });

    it("rejects invalid UTF-8 instead of replacing it", async () => {
      const { response } = await call(
        new Uint8Array([
          ...new TextEncoder().encode(
            "rawName\n",
          ),
          0xff,
          0xfe,
          0x41,
        ]),
      );

      expect(response.status).toBe(400);

      expect(
        (await errorOf(response)).error
          .issues,
      ).toEqual([
        {
          path: "$",

          code: "invalid_value",
        },
      ]);
    });

    it("rejects MORE than MAX_BATCH_SIZE candidates before any resolution (never truncates)", async () => {
      const rows = Array.from(
        { length: MAX_BATCH_SIZE + 1 },
        (_, i) => `i${i},DEB ${i}`,
      );

      const { response } = await call(
        csv("id,rawName", ...rows),
      );

      expect(response.status).toBe(400);

      expect(
        await errorOf(response),
      ).toMatchObject({
        error: {
          code: "INVALID_PORTFOLIO_CSV",

          issues: [
            {
              path: "rows",

              code: "too_long",
            },
          ],
        },
      });

      expect(
        resolveAssets,
      ).not.toHaveBeenCalled();
    });

    it("accepts exactly MAX_BATCH_SIZE candidates", async () => {
      const rows = Array.from(
        { length: MAX_BATCH_SIZE },
        (_, i) => `i${i},DEB ${i}`,
      );

      const { response } = await call(
        csv("id,rawName", ...rows),
      );

      expect(response.status).toBe(200);

      expect(
        candidatesOfCall(),
      ).toHaveLength(MAX_BATCH_SIZE);
    });
  });

  describe("media type and size", () => {
    it("accepts text/csv with an optional utf-8 charset", async () => {
      for (const contentType of [
        "text/csv",
        "text/csv; charset=utf-8",
        "TEXT/CSV;charset=UTF-8",
        'text/csv; charset="utf-8"',
        "text/csv ; charset = utf-8 ",
      ]) {
        const { response } = await call(
          csv("id,rawName", "m1,DEB"),
          {},
          {
            "content-type":
              contentType,

            authorization: `Bearer ${BEARER}`,
          },
        );

        expect(response.status).toBe(
          200,
        );
      }
    });

    it("answers 415 for any other media type, including JSON", async () => {
      for (const contentType of [
        "application/json",
        "text/plain",
        "application/csv",
        "text/csv; charset=latin1",
        "text/csv; header=present",
        "text/csv; charset=utf-8; x=1",
        "multipart/form-data; boundary=x",
        "text/csvx",
        "",
      ]) {
        const headers: Record<
          string,
          string
        > = {
          authorization: `Bearer ${BEARER}`,
        };

        if (contentType !== "") {
          headers["content-type"] =
            contentType;
        }

        const { response } = await call(
          csv("rawName", "DEB"),
          {},
          headers,
        );

        expect(response.status).toBe(
          415,
        );

        expect(
          await errorOf(response),
        ).toEqual({
          ok: false,

          error: {
            code: "UNSUPPORTED_MEDIA_TYPE",

            message:
              "Content-Type must be text/csv.",
          },
        });
      }

      expect(
        resolveAssets,
      ).not.toHaveBeenCalled();
    });

    it("answers 413 for a declared oversized body without reading it", async () => {
      const request = post(GOOD, {
        "content-type": "text/csv",

        authorization: `Bearer ${BEARER}`,

        "content-length": String(
          MAX_CSV_BODY_BYTES + 1,
        ),
      });

      const response =
        await handleResolveCsvRequest(
          request,
          options(),
        );

      expect(response.status).toBe(413);

      expect(
        (await errorOf(response)).error
          .code,
      ).toBe("PAYLOAD_TOO_LARGE");

      expect(
        request.bodyUsed,
      ).toBe(false);

      expect(
        resolveAssets,
      ).not.toHaveBeenCalled();
    });

    it("answers 413 for an oversized streamed body, counting bytes not characters", async () => {
      for (const body of [
        "a".repeat(
          MAX_CSV_BODY_BYTES + 1,
        ),
        "é".repeat(
          MAX_CSV_BODY_BYTES / 2 + 1,
        ),
      ]) {
        const { response } =
          await call(body);

        expect(response.status).toBe(
          413,
        );
      }

      expect(
        resolveAssets,
      ).not.toHaveBeenCalled();
    });

    it("accepts a body exactly at the byte limit as far as size goes", async () => {
      // A single valid row padded to the limit would be rejected as a CSV, not as
      // too large: the size guard must not fire at the boundary.
      const filler = "a".repeat(
        MAX_CSV_BODY_BYTES -
          "rawName\n".length,
      );

      const { response } = await call(
        `rawName\n${filler}`,
      );

      expect(response.status).not.toBe(
        413,
      );
    });

    it("the limit is 512 KiB and fits the largest valid batch", () => {
      expect(MAX_CSV_BODY_BYTES).toBe(
        512 * 1024,
      );

      const row = [
        "x".repeat(128),
        "x".repeat(256),
        "x".repeat(32),
        "x".repeat(32),
        "x".repeat(32),
        "x".repeat(64),
        "x".repeat(256),
        "x".repeat(256),
        "x".repeat(32),
        "x".repeat(8),
        "1234567890.12345",
        "x".repeat(256),
        "x".repeat(256),
        "x".repeat(256),
        "12345",
        "x".repeat(256),
      ].join(",");

      expect(
        (row.length + 1) *
          MAX_BATCH_SIZE,
      ).toBeLessThan(
        MAX_CSV_BODY_BYTES,
      );
    });
  });

  describe("authorization and usage run BEFORE the body is touched", () => {
    it("401 unauthenticated: the body is never read and no usage is consumed", async () => {
      const usage = recordUsage(
        limits(5),
      );

      const { request, response } =
        await call(
          GOOD,
          {
            authorizer: deny({
              authorized: false,

              reason:
                "unauthenticated",
            }),

            usage,
          },
        );

      expect(response.status).toBe(401);

      expect(
        request.bodyUsed,
      ).toBe(false);

      expect(
        usage.calls,
      ).toHaveLength(0);

      expect(
        resolveAssets,
      ).not.toHaveBeenCalled();
    });

    it("403 forbidden (no batch entitlement): the body is never read and no usage is consumed", async () => {
      const usage = recordUsage(
        limits(5),
      );

      const { request, response } =
        await call(
          GOOD,
          {
            authorizer: deny({
              authorized: false,

              reason: "forbidden",

              subject: SUBJECT,
            }),

            usage,
          },
        );

      expect(response.status).toBe(403);

      expect(
        request.bodyUsed,
      ).toBe(false);

      expect(
        usage.calls,
      ).toHaveLength(0);
    });

    it("500 authorizer failure: the body is never read and no usage is consumed", async () => {
      const usage = recordUsage(
        limits(5),
      );

      const { request, response } =
        await call(
          GOOD,
          {
            authorizer: {
              authorize:
                async () => {
                  throw new Error(
                    "boom",
                  );
                },
            },

            usage,
          },
        );

      expect(response.status).toBe(500);

      expect(
        (await errorOf(response)).error
          .code,
      ).toBe("AIE_AUTHORIZATION_ERROR");

      expect(
        request.bodyUsed,
      ).toBe(false);

      expect(
        usage.calls,
      ).toHaveLength(0);
    });

    it("429 rate limited: the body is never read and nothing is resolved or requested", async () => {
      const usage = limits(1);

      await call(GOOD, { usage });

      resolveAssets.mockClear();

      const { request, response } =
        await call(GOOD, { usage });

      expect(response.status).toBe(429);

      expect(
        response.headers.get(
          "retry-after",
        ),
      ).toMatch(/^\d+$/);

      expect(
        request.bodyUsed,
      ).toBe(false);

      expect(
        resolveAssets,
      ).not.toHaveBeenCalled();

      expect(
        globalThis.fetch,
      ).not.toHaveBeenCalled();
    });

    it("a usage-control failure fails closed before the body is read", async () => {
      const { request, response } =
        await call(GOOD, {
          usage:
            createScriptedUsageController(
              () => {
                throw new Error(
                  "limiter down",
                );
              },
            ),
        });

      expect(response.status).toBe(500);

      expect(
        (await errorOf(response)).error
          .code,
      ).toBe("AIE_USAGE_CONTROL_ERROR");

      expect(
        request.bodyUsed,
      ).toBe(false);
    });

    it("an authorized request with the batch entitlement reaches the resolver", async () => {
      const { response } =
        await call(GOOD);

      expect(response.status).toBe(200);

      expect(
        resolveAssets,
      ).toHaveBeenCalledTimes(1);
    });

    it("the CSV cannot grant itself access through role, userId, isAdmin, apiKey, entitlement or premium columns", async () => {
      const body = csv(
        "rawName,role,userId,isAdmin,apiKey,entitlement,premium",
        "DEB,administrador,admin,true,anything,aie_batch,true",
      );

      // Not authenticated: still 401, whatever the CSV says.
      const denied = await call(body, {
        authorizer: deny({
          authorized: false,

          reason: "unauthenticated",
        }),
      });

      expect(denied.response.status).toBe(
        401,
      );

      expect(
        denied.request.bodyUsed,
      ).toBe(false);

      // Not entitled: still 403.
      const forbidden = await call(body, {
        authorizer: deny({
          authorized: false,

          reason: "forbidden",

          subject: SUBJECT,
        }),
      });

      expect(
        forbidden.response.status,
      ).toBe(403);

      // Even when authorized, those columns are rejected as data.
      const authorized =
        await call(body);

      expect(
        authorized.response.status,
      ).toBe(400);

      expect(
        resolveAssets,
      ).not.toHaveBeenCalled();
    });
  });

  describe("usage semantics", () => {
    it("one CSV request consumes exactly one batch slot", async () => {
      const usage = recordUsage(
        limits(2),
      );

      expect(
        (await call(GOOD, { usage }))
          .response.status,
      ).toBe(200);

      expect(
        (await call(GOOD, { usage }))
          .response.status,
      ).toBe(200);

      expect(
        (await call(GOOD, { usage }))
          .response.status,
      ).toBe(429);

      expect(usage.calls).toEqual([
        {
          subject: SUBJECT,

          operation: "resolve-assets",
        },
        {
          subject: SUBJECT,

          operation: "resolve-assets",
        },
        {
          subject: SUBJECT,

          operation: "resolve-assets",
        },
      ]);
    });

    it("100 rows still consume ONE batch slot", async () => {
      const usage = limits(1);

      const rows = Array.from(
        { length: MAX_BATCH_SIZE },
        (_, i) => `u${i},DEB ${i}`,
      );

      expect(
        (
          await call(
            csv("id,rawName", ...rows),
            { usage },
          )
        ).response.status,
      ).toBe(200);

      expect(
        (
          await call(
            csv("id,rawName", "z,DEB"),
            { usage },
          )
        ).response.status,
      ).toBe(429);
    });

    it("uses the batch bucket, never the single bucket", async () => {
      const usage = limits(1, 30);

      await call(GOOD, { usage });

      // The batch bucket is exhausted; the single bucket was not touched.
      const single = await usage.check({
        subject: SUBJECT,

        operation: "resolve-asset",
      });

      expect(single.allowed).toBe(true);
    });

    it("shares the batch bucket with the JSON batch route", async () => {
      const usage = limits(1);

      await call(GOOD, { usage });

      expect(
        (
          await call(GOOD, { usage })
        ).response.status,
      ).toBe(429);
    });
  });

  describe("response headers", () => {
    it("every kind of response has X-Correlation-Id and no-store", async () => {
      const responses = [
        (await call(GOOD)).response,
        (
          await call("rawName,color\nA,b")
        ).response,
        (
          await call(
            GOOD,
            {},
            {
              "content-type":
                "application/json",

              authorization: `Bearer ${BEARER}`,
            },
          )
        ).response,
        (
          await call("a".repeat(
            MAX_CSV_BODY_BYTES + 1,
          ))
        ).response,
        (
          await call(GOOD, {
            authorizer: deny({
              authorized: false,

              reason:
                "unauthenticated",
            }),
          })
        ).response,
        (
          await call(GOOD, {
            authorizer: deny({
              authorized: false,

              reason: "forbidden",

              subject: SUBJECT,
            }),
          })
        ).response,
        (
          await call(GOOD, {
            usage: limits(0 + 1),
          })
        ).response,
      ];

      expect(
        responses.map(
          (response) =>
            response.status,
        ),
      ).toEqual([
        200, 400, 415, 413, 401, 403, 200,
      ]);

      const limited = await call(GOOD, {
        usage: (() => {
          const usage = limits(1);

          void usage.check({
            subject: SUBJECT,

            operation:
              "resolve-assets",
          });

          return usage;
        })(),
      });

      responses.push(limited.response);

      for (const response of responses) {
        expect(
          response.headers.get(
            "x-correlation-id",
          ),
        ).toBe("corr-csv-1");

        expect(
          response.headers.get(
            "cache-control",
          ),
        ).toBe("no-store");
      }
    });
  });

  describe("audit and privacy", () => {
    it("audits the batch operation with safe metadata only", async () => {
      const sink =
        createFakeAuditSink();

      await call(GOOD, { sink });

      expect(
        sink.events.map(
          (event: AieAuditEvent) => [
            event.stage,
            event.outcome,
            event.operation,
            event.subject,
          ],
        ),
      ).toEqual([
        [
          "authorization",
          "authorized",
          "resolve-assets",
          SUBJECT,
        ],
        [
          "execution",
          "completed",
          "resolve-assets",
          SUBJECT,
        ],
      ]);
    });

    it("no CSV data, row content, name, code, amount or token enters any audit event", async () => {
      const sink =
        createFakeAuditSink();

      const bodies = [
        GOOD,
        csv("rawName,cpf", `${RAW_NAME},1`),
        csv(
          "id,rawName,amount",
          `a,${RAW_NAME},"R$ ${AMOUNT}"`,
        ),
      ];

      for (const body of bodies) {
        await call(body, { sink });
      }

      await call(
        GOOD,
        {
          sink,

          usage: {
            check: async () => ({
              allowed: false,

              reason: "rate-limit",

              retryAfterSeconds: 9,
            }),
          },
        },
      );

      expect(
        sink.events.length,
      ).toBeGreaterThan(3);

      const text = JSON.stringify(
        sink.events,
      );

      for (const leaked of [
        RAW_NAME,
        INSTRUMENT,
        AMOUNT,
        "debenture",
        "rawName",
        "instrumentCode",
        "amount",
        "cpf",
        BEARER,
        ".csv",
        "fileName",
      ]) {
        expect(text).not.toContain(
          leaked,
        );
      }
    });

    it("the response never contains the bearer or a credential", async () => {
      const { response } =
        await call(GOOD);

      const text =
        await response.text();

      for (const leaked of [
        BEARER,
        "Authorization",
        "access_token",
        "client_secret",
        "clientSecret",
      ]) {
        expect(text).not.toContain(
          leaked,
        );
      }
    });

    it("never reads or invents a file name from HTTP headers", async () => {
      const { response } = await call(
        csv("id,rawName", "f1,DEB"),
        {},
        {
          "content-type": "text/csv",

          authorization: `Bearer ${BEARER}`,

          "content-disposition":
            'attachment; filename="secret-portfolio-name.csv"',

          "x-filename":
            "secret-portfolio-name.csv",
        },
      );

      expect(response.status).toBe(200);

      expect(
        JSON.stringify(
          candidatesOfCall(),
        ),
      ).not.toContain(
        "secret-portfolio-name",
      );

      expect(
        candidatesOfCall()[0]?.source
          .fileName,
      ).toBeUndefined();
    });
  });

  describe("module boundary", () => {
    it("the route exports only POST plus the runtime configuration", () => {
      expect(
        Object.keys(csvRoute).sort(),
      ).toEqual([
        "POST",
        "dynamic",
        "runtime",
      ]);

      expect(csvRoute.runtime).toBe(
        "nodejs",
      );

      expect(csvRoute.dynamic).toBe(
        "force-dynamic",
      );
    });

    it("route.ts imports only the CSV HTTP mapping, reads no environment and names no provider", () => {
      const code = source(
        "../../../app/api/aie/resolve-csv/route.ts",
      );

      expect(
        [
          ...code.matchAll(
            /from\s*["']([^"']+)["']/g,
          ),
        ].map((match) => match[1]),
      ).toEqual([
        "../../../../lib/aie/server/resolve-csv-http",
      ]);

      for (const forbidden of [
        "process.env",
        "AnbimaHttpClient",
        "AnbimaDebentureProvider",
        "createAieFromEnv",
        "VerificationPolicy",
        "ProviderExecutionPipeline",
        "ANBIMA",
      ]) {
        expect(code).not.toContain(
          forbidden,
        );
      }
    });

    it("the HTTP mapping reads no environment, logs nothing, has no CORS and no provider code", () => {
      const code = source(
        "./resolve-csv-http.ts",
      );

      for (const forbidden of [
        "process.env",
        "console.",
        "Anbima",
        "VerificationPolicy",
        "ProviderExecutionPipeline",
        "createAieFromEnv",
        "split(",
      ]) {
        expect(code).not.toContain(
          forbidden,
        );
      }

      expect(
        code.toLowerCase(),
      ).not.toContain("access-control");
    });

    it("the HTTP mapping imports only the CSV adapter, ingestion, the shared HTTP helpers and the batch response", () => {
      const imports = [
        ...readFileSync(
          fileURLToPath(
            new URL(
              "./resolve-csv-http.ts",
              import.meta.url,
            ),
          ),
          "utf8",
        ).matchAll(
          /from\s*["']([^"']+)["']/g,
        ),
      ]
        .map((match) => match[1])
        .sort();

      expect(imports).toEqual([
        "../ingestion/adapters/portfolio-csv-adapter",
        "../ingestion/portfolio-candidate-ingestion",
        "../ingestion/portfolio-csv-limits",
        "./aie-audited-request",
        "./aie-http",
        "./aie-http",
        "./bounded-body",
        "./request-authorization",
        "./resolve-assets",
        "./resolve-assets-http",
      ]);
    });

    it("has no CSV parser of its own (it reuses the adapter)", () => {
      const code = source(
        "./resolve-csv-http.ts",
      );

      expect(code).not.toContain(
        "parsePortfolioCsv",
      );

      expect(code).toContain(
        "ingestPortfolioCsv",
      );
    });

    it("importing the route performs no network request", async () => {
      vi.resetModules();

      const fetchSpy = vi.fn();

      vi.stubGlobal("fetch", fetchSpy);

      await import(
        "../../../app/api/aie/resolve-csv/route"
      );

      expect(
        fetchSpy,
      ).not.toHaveBeenCalled();
    });

    it("leaves the JSON batch route untouched", () => {
      expect(
        Object.keys(batchRoute).sort(),
      ).toEqual([
        "POST",
        "dynamic",
        "runtime",
      ]);
    });

    it("no operation literal was added: the CSV route reuses resolve-assets", () => {
      const code = readFileSync(
        fileURLToPath(
          new URL(
            "./request-authorization.ts",
            import.meta.url,
          ),
        ),
        "utf8",
      );

      expect(code).toContain(
        '| "resolve-assets";',
      );

      expect(code).not.toContain(
        "resolve-csv",
      );

      // Sanity: the frontend root exists for the relative imports above.
      expect(FRONTEND_ROOT).toContain(
        "frontend",
      );
    });
  });
});
