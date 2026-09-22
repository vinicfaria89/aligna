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
  createScriptedUsageController,
  recordUsage,
} from "./fake-aie-usage-controller";

import {
  createInMemoryUsageController,
} from "./in-memory-usage-controller";

import type {
  AieAuthorizationResult,
  AieRequestAuthorizer,
} from "./request-authorization";

import {
  handleResolveAssetRequest,
} from "./resolve-asset-http";

import {
  handleResolveAssetsRequest,
} from "./resolve-assets-http";

const resolveAsset = vi.hoisted(
  () => vi.fn(),
);

const resolveAssets = vi.hoisted(
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
 * TASK-023 through the real handlers: the usage control runs after the
 * authorization decision and before any body work or resolution. The controller,
 * authorizer, audit sink and clock are all injected; nothing touches the network.
 */

const SUBJECT_A =
  "3f2b1c9e-8a4d-4e6f-9b0a-1c2d3e4f5a6b";

const SUBJECT_B =
  "11111111-2222-4333-8444-555555555555";

const BEARER =
  "sentinel-usage-bearer-token";

const RAW_NAME =
  "SENTINEL-USAGE-RAW-NAME";

const INSTRUMENT =
  "SENTINELUSAGE99";

const SECRET =
  "sentinel-usage-controller-secret";

const SINGLE_URL =
  "http://localhost/api/aie/resolve-asset";

const BATCH_URL =
  "http://localhost/api/aie/resolve-assets";

const FIXED = new Date(
  "2026-09-20T20:00:00.000Z",
);

function asset(): CandidateAsset {
  return {
    id: "asset-1",

    rawName: RAW_NAME,

    source: {},

    hints: {
      assetType: "debenture",

      instrumentCode: INSTRUMENT,

      amount: 555.55,
    },
  };
}

function post(
  url: string,
  body: unknown,
): Request {
  return new Request(url, {
    method: "POST",

    headers: {
      "content-type":
        "application/json",

      authorization: `Bearer ${BEARER}`,
    },

    body: JSON.stringify(body),
  });
}

function as(
  subject: string,
): AieRequestAuthorizer {
  return {
    authorize: async () => ({
      authorized: true,

      principal: {
        subject,

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

function resolution(): ResolutionResult {
  return {
    status: "needs-more-evidence",

    investigation: {
      id: "investigation:asset-1",

      candidateAsset: asset(),

      status: "needs-more-evidence",

      evidence: [],

      searches: [],

      unresolvedFields: ["identity"],

      createdAt:
        "2026-09-20T20:00:00.000Z",

      updatedAt:
        "2026-09-20T20:00:00.000Z",
    },

    verifiedAsset: null,

    plan: {
      assetType: "debenture",

      unresolvedFields: ["identity"],

      steps: [],
    },

    nextAction: "search-provider",
  };
}

function limits(
  single: number,
  batch: number,
  windowMs = 60_000,
) {
  let now = 5_000_000;

  const controller =
    createInMemoryUsageController({
      policy: {
        "resolve-asset": {
          limit: single,

          windowMs,
        },

        "resolve-assets": {
          limit: batch,

          windowMs,
        },
      },

      now: () => now,
    });

  return {
    controller,

    advance: (ms: number) => {
      now += ms;
    },
  };
}

function batchBody(
  count: number,
): unknown {
  return {
    assets: Array.from(
      { length: count },
      () => asset(),
    ),
  };
}

async function callSingle(
  usage: AieUsageController,
  subject = SUBJECT_A,
  audit = createFakeAuditSink(),
) {
  return handleResolveAssetRequest(
    post(SINGLE_URL, asset()),
    {
      authorizer: as(subject),

      usage,

      audit: {
        sink: audit,

        now: () => FIXED,

        generateCorrelationId: () =>
          "corr-usage-1",
      },
    },
  );
}

async function callBatch(
  usage: AieUsageController,
  count = 1,
  subject = SUBJECT_A,
  audit = createFakeAuditSink(),
) {
  return handleResolveAssetsRequest(
    post(BATCH_URL, batchBody(count)),
    {
      authorizer: as(subject),

      usage,

      audit: {
        sink: audit,

        now: () => FIXED,

        generateCorrelationId: () =>
          "corr-usage-1",
      },
    },
  );
}

describe("usage control through the handlers", () => {
  beforeEach(() => {
    resolveAsset.mockReset();

    resolveAssets.mockReset();

    resolveAsset.mockResolvedValue(
      resolution(),
    );

    resolveAssets.mockResolvedValue({
      items: [],
    });

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

  describe("rate limiting per identity", () => {
    it("allows single requests up to the limit, then answers 429", async () => {
      const { controller } = limits(
        3,
        2,
      );

      for (let i = 0; i < 3; i += 1) {
        expect(
          (await callSingle(controller))
            .status,
        ).toBe(200);
      }

      const limited =
        await callSingle(controller);

      expect(limited.status).toBe(429);

      expect(
        resolveAsset,
      ).toHaveBeenCalledTimes(3);
    });

    it("429 has the fixed body, Retry-After, no-store and the correlation id", async () => {
      const { controller } = limits(
        1,
        1,
        30_000,
      );

      await callSingle(controller);

      const limited =
        await callSingle(controller);

      expect(limited.status).toBe(429);

      expect(
        limited.headers.get(
          "retry-after",
        ),
      ).toBe("30");

      expect(
        limited.headers.get(
          "cache-control",
        ),
      ).toBe("no-store");

      expect(
        limited.headers.get(
          "x-correlation-id",
        ),
      ).toBe("corr-usage-1");

      expect(
        limited.headers.get(
          "content-type",
        ),
      ).toContain("application/json");

      expect(
        await limited.json(),
      ).toEqual({
        ok: false,

        error: {
          code: "AIE_RATE_LIMITED",

          message:
            "Too many asset resolution requests.",
        },
      });
    });

    it("the limit is released after the window", async () => {
      const { controller, advance } =
        limits(1, 1, 10_000);

      await callSingle(controller);

      expect(
        (await callSingle(controller))
          .status,
      ).toBe(429);

      advance(10_000);

      expect(
        (await callSingle(controller))
          .status,
      ).toBe(200);
    });

    it("the batch route has its own limit, with the same 429 semantics", async () => {
      const { controller } = limits(
        5,
        2,
      );

      expect(
        (await callBatch(controller))
          .status,
      ).toBe(200);

      expect(
        (await callBatch(controller))
          .status,
      ).toBe(200);

      const limited =
        await callBatch(controller);

      expect(limited.status).toBe(429);

      expect(
        limited.headers.get(
          "retry-after",
        ),
      ).toMatch(/^\d+$/);

      expect(
        resolveAssets,
      ).toHaveBeenCalledTimes(2);
    });

    it("single and batch buckets do not consume each other", async () => {
      const { controller } = limits(
        2,
        1,
      );

      expect(
        (await callBatch(controller))
          .status,
      ).toBe(200);

      expect(
        (await callBatch(controller))
          .status,
      ).toBe(429);

      // Batch exhausted, single untouched.
      expect(
        (await callSingle(controller))
          .status,
      ).toBe(200);

      expect(
        (await callSingle(controller))
          .status,
      ).toBe(200);

      expect(
        (await callSingle(controller))
          .status,
      ).toBe(429);
    });

    it("two subjects are independent and the same subject shares one limit", async () => {
      const { controller } = limits(
        2,
        1,
      );

      await callSingle(controller, SUBJECT_A);

      await callSingle(controller, SUBJECT_A);

      expect(
        (
          await callSingle(
            controller,
            SUBJECT_A,
          )
        ).status,
      ).toBe(429);

      expect(
        (
          await callSingle(
            controller,
            SUBJECT_B,
          )
        ).status,
      ).toBe(200);
    });

    it("one batch request consumes ONE slot no matter how many assets it carries", async () => {
      const { controller } = limits(
        5,
        3,
      );

      const recorded =
        recordUsage(controller);

      for (const count of [1, 50, 100]) {
        expect(
          (
            await callBatch(
              recorded,
              count,
            )
          ).status,
        ).toBe(200);
      }

      // Three slots used by 151 assets: the fourth request is the one denied.
      expect(
        (
          await callBatch(recorded, 100)
        ).status,
      ).toBe(429);

      expect(
        recorded.calls,
      ).toHaveLength(4);
    });

    it("a quota denial from a controller is answered as the same 429", async () => {
      const usage =
        createScriptedUsageController({
          allowed: false,

          reason: "quota",

          retryAfterSeconds: 120,
        });

      const response =
        await callSingle(usage);

      expect(response.status).toBe(429);

      expect(
        response.headers.get(
          "retry-after",
        ),
      ).toBe("120");

      expect(
        resolveAsset,
      ).not.toHaveBeenCalled();
    });

    it("normalizes a strange retry hint from a controller", async () => {
      for (const [hint, expected] of [
        [0, "1"],
        [3.2, "4"],
        [10 ** 9, "86400"],
        [undefined, "60"],
      ] as const) {
        const response =
          await callSingle(
            createScriptedUsageController(
              {
                allowed: false,

                reason: "rate-limit",

                retryAfterSeconds:
                  hint,
              },
            ),
          );

        expect(
          response.headers.get(
            "retry-after",
          ),
        ).toBe(expected);
      }
    });
  });

  describe("order of execution", () => {
    it("an unauthenticated request never reaches the usage control (no limiter entry)", async () => {
      const { controller } = limits(
        1,
        1,
      );

      const recorded =
        recordUsage(controller);

      const response =
        await handleResolveAssetRequest(
          post(SINGLE_URL, asset()),
          {
            authorizer: deny({
              authorized: false,

              reason:
                "unauthenticated",
            }),

            usage: recorded,
          },
        );

      expect(response.status).toBe(401);

      expect(
        recorded.calls,
      ).toHaveLength(0);

      expect(
        controller.trackedKeys,
      ).toBe(0);
    });

    it("a forbidden request never reaches the usage control and consumes nobody's quota", async () => {
      const { controller } = limits(
        1,
        1,
      );

      const recorded =
        recordUsage(controller);

      for (const call of [
        () =>
          handleResolveAssetRequest(
            post(SINGLE_URL, asset()),
            {
              authorizer: deny({
                authorized: false,

                reason: "forbidden",

                subject: SUBJECT_A,
              }),

              usage: recorded,
            },
          ),
        () =>
          handleResolveAssetsRequest(
            post(
              BATCH_URL,
              batchBody(1),
            ),
            {
              authorizer: deny({
                authorized: false,

                reason: "forbidden",

                subject: SUBJECT_A,
              }),

              usage: recorded,
            },
          ),
      ]) {
        expect(
          (await call()).status,
        ).toBe(403);
      }

      expect(
        recorded.calls,
      ).toHaveLength(0);

      expect(
        controller.trackedKeys,
      ).toBe(0);

      // The same subject, once allowed, still has its full quota.
      expect(
        (await callSingle(controller))
          .status,
      ).toBe(200);
    });

    it("an authorizer failure never reaches the usage control", async () => {
      const recorded = recordUsage(
        limits(1, 1).controller,
      );

      const response =
        await handleResolveAssetRequest(
          post(SINGLE_URL, asset()),
          {
            authorizer: {
              authorize:
                async () => {
                  throw new Error(
                    "boom",
                  );
                },
            },

            usage: recorded,
          },
        );

      expect(response.status).toBe(500);

      expect(
        recorded.calls,
      ).toHaveLength(0);
    });

    it("a rate-limited request does no body work and never calls the resolvers or the network", async () => {
      const { controller } = limits(
        1,
        1,
      );

      await callSingle(controller);

      await callBatch(controller);

      resolveAsset.mockClear();

      resolveAssets.mockClear();

      // Oversized and malformed bodies are never read once the caller is limited.
      const single =
        await handleResolveAssetRequest(
          post(SINGLE_URL, "{not json"),
          {
            authorizer: as(SUBJECT_A),

            usage: controller,
          },
        );

      const batch =
        await handleResolveAssetsRequest(
          post(BATCH_URL, "{not json"),
          {
            authorizer: as(SUBJECT_A),

            usage: controller,
          },
        );

      expect(single.status).toBe(429);

      expect(batch.status).toBe(429);

      expect(
        resolveAsset,
      ).not.toHaveBeenCalled();

      expect(
        resolveAssets,
      ).not.toHaveBeenCalled();

      expect(
        globalThis.fetch,
      ).not.toHaveBeenCalled();
    });

    it("the controller sees only the subject and the operation literal", async () => {
      const recorded = recordUsage(
        limits(5, 5).controller,
      );

      await callSingle(recorded);

      await callBatch(recorded, 3);

      expect(recorded.calls).toEqual([
        {
          subject: SUBJECT_A,

          operation: "resolve-asset",
        },
        {
          subject: SUBJECT_A,

          operation: "resolve-assets",
        },
      ]);

      const text = JSON.stringify(
        recorded.calls,
      );

      for (const leaked of [
        RAW_NAME,
        INSTRUMENT,
        "555.55",
        BEARER,
        "asset-1",
        "hints",
        "candidate",
      ]) {
        expect(text).not.toContain(
          leaked,
        );
      }
    });
  });

  describe("the 429 response is safe", () => {
    it("exposes no subject, counter, policy or token, and no secret", async () => {
      const { controller } = limits(
        1,
        1,
      );

      await callSingle(controller);

      const limited =
        await callSingle(controller);

      const text = JSON.stringify({
        body: await limited.text(),

        headers: Object.fromEntries(
          limited.headers,
        ),
      });

      for (const leaked of [
        SUBJECT_A,
        BEARER,
        RAW_NAME,
        INSTRUMENT,
        SECRET,
        "limit",
        "window",
        "count",
        "remaining",
        "policy",
        "subject",
        "x-ratelimit",
        "X-RateLimit",
      ]) {
        expect(text).not.toContain(
          leaked,
        );
      }
    });

    it("the client cannot change limits, windows or counters through the request", async () => {
      const { controller } = limits(
        1,
        1,
      );

      await callSingle(controller);

      const response =
        await handleResolveAssetRequest(
          new Request(SINGLE_URL, {
            method: "POST",

            headers: {
              "content-type":
                "application/json",

              authorization: `Bearer ${BEARER}`,

              "x-rate-limit": "1000000",

              "x-ratelimit-limit":
                "1000000",

              "retry-after": "0",
            },

            body: JSON.stringify({
              ...asset(),

              rateLimit: 100000,

              limit: 100000,
            }),
          }),
          {
            authorizer: as(SUBJECT_A),

            usage: controller,
          },
        );

      // Still limited: nothing in the request influences the limiter.
      expect(response.status).toBe(429);
    });
  });

  describe("fail closed when the usage control fails", () => {
    const failures: Array<
      [string, () => AieUsageController]
    > = [
      [
        "throws",
        () =>
          createScriptedUsageController(
            () => {
              throw new Error(
                `limiter exploded ${SECRET} ${SUBJECT_A}`,
              );
            },
          ),
      ],
      [
        "answers undefined",
        () =>
          createScriptedUsageController(
            undefined,
          ),
      ],
      [
        "answers a string",
        () =>
          createScriptedUsageController(
            "allowed",
          ),
      ],
      [
        "answers allowed as a string",
        () =>
          createScriptedUsageController(
            { allowed: "true" },
          ),
      ],
      [
        "answers a denial without a valid reason",
        () =>
          createScriptedUsageController(
            {
              allowed: false,

              reason: "other",
            },
          ),
      ],
      [
        "rejects",
        () => ({
          check: () =>
            Promise.reject(
              new Error(SECRET),
            ),
        }),
      ],
    ];

    for (const [name, make] of failures) {
      it(`a limiter that ${name}: 500 AIE_USAGE_CONTROL_ERROR, nothing resolved, nothing leaked`, async () => {
        for (const run of [
          () =>
            callSingle(make()),
          () =>
            callBatch(make()),
        ]) {
          const response = await run();

          expect(
            response.status,
          ).toBe(500);

          expect(
            response.headers.get(
              "x-correlation-id",
            ),
          ).toBe("corr-usage-1");

          expect(
            response.headers.get(
              "cache-control",
            ),
          ).toBe("no-store");

          const text =
            await response.text();

          expect(
            JSON.parse(text),
          ).toEqual({
            ok: false,

            error: {
              code: "AIE_USAGE_CONTROL_ERROR",

              message:
                "Unable to check usage limits.",
            },
          });

          for (const leaked of [
            SECRET,
            SUBJECT_A,
            "exploded",
          ]) {
            expect(text).not.toContain(
              leaked,
            );
          }
        }

        expect(
          resolveAsset,
        ).not.toHaveBeenCalled();

        expect(
          resolveAssets,
        ).not.toHaveBeenCalled();
      });
    }
  });

  describe("audit integration", () => {
    function summary(
      events: AieAuditEvent[],
    ) {
      return events.map((event) => [
        event.stage,
        event.outcome,
        "status" in event
          ? event.status
          : undefined,
        event.subject,
      ]);
    }

    it("a rate-limited request is audited as authorized, then execution rate-limited (429) with the subject", async () => {
      const { controller } = limits(
        1,
        1,
      );

      await callSingle(controller);

      const audit =
        createFakeAuditSink();

      const response =
        await callSingle(
          controller,
          SUBJECT_A,
          audit,
        );

      expect(response.status).toBe(429);

      expect(
        summary(audit.events),
      ).toEqual([
        [
          "authorization",
          "authorized",
          undefined,
          SUBJECT_A,
        ],
        [
          "execution",
          "rate-limited",
          429,
          SUBJECT_A,
        ],
      ]);

      expect(audit.events[1]).toEqual({
        correlationId: "corr-usage-1",

        timestamp:
          "2026-09-20T20:00:00.000Z",

        operation: "resolve-asset",

        stage: "execution",

        outcome: "rate-limited",

        status: 429,

        subject: SUBJECT_A,
      });
    });

    it("the audit rate-limit event has no payload, counters or policy", async () => {
      const { controller } = limits(
        1,
        1,
      );

      await callBatch(controller);

      const audit =
        createFakeAuditSink();

      await callBatch(
        controller,
        40,
        SUBJECT_A,
        audit,
      );

      const text = JSON.stringify(
        audit.events,
      );

      for (const leaked of [
        RAW_NAME,
        INSTRUMENT,
        "555.55",
        BEARER,
        "40",
        "window",
        "count",
        "retry",
        "remaining",
        "policy",
      ]) {
        expect(text).not.toContain(
          leaked,
        );
      }
    });

    it("a limiter failure is audited as usage-control-error (500) without the error", async () => {
      const audit =
        createFakeAuditSink();

      const response =
        await callSingle(
          createScriptedUsageController(
            () => {
              throw new Error(
                `secret ${SECRET}`,
              );
            },
          ),
          SUBJECT_A,
          audit,
        );

      expect(response.status).toBe(500);

      expect(
        summary(audit.events),
      ).toEqual([
        [
          "authorization",
          "authorized",
          undefined,
          SUBJECT_A,
        ],
        [
          "execution",
          "usage-control-error",
          500,
          SUBJECT_A,
        ],
      ]);

      expect(
        JSON.stringify(audit.events),
      ).not.toContain(SECRET);
    });

    it("an allowed request still gets authorization + completed", async () => {
      const audit =
        createFakeAuditSink();

      await callSingle(
        limits(3, 3).controller,
        SUBJECT_A,
        audit,
      );

      expect(
        summary(audit.events),
      ).toEqual([
        [
          "authorization",
          "authorized",
          undefined,
          SUBJECT_A,
        ],
        [
          "execution",
          "completed",
          200,
          SUBJECT_A,
        ],
      ]);
    });
  });

  describe("existing behavior is unchanged", () => {
    it("401 and 403 keep their semantics with a very strict controller in place", async () => {
      const strict =
        createScriptedUsageController(
          {
            allowed: false,

            reason: "rate-limit",

            retryAfterSeconds: 5,
          },
        );

      const unauthenticated =
        await handleResolveAssetRequest(
          post(SINGLE_URL, asset()),
          {
            authorizer: deny({
              authorized: false,

              reason:
                "unauthenticated",
            }),

            usage: strict,
          },
        );

      const forbidden =
        await handleResolveAssetsRequest(
          post(
            BATCH_URL,
            batchBody(1),
          ),
          {
            authorizer: deny({
              authorized: false,

              reason: "forbidden",

              subject: SUBJECT_A,
            }),

            usage: strict,
          },
        );

      expect(
        unauthenticated.status,
      ).toBe(401);

      expect(forbidden.status).toBe(403);
    });
  });
});
