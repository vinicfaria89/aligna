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
import * as singleRoute from "../../../app/api/aie/resolve-asset/route";

import * as batchRoute from "../../../app/api/aie/resolve-assets/route";

import type {
  AieAuditEvent,
  AieAuditOptions,
} from "./aie-audit";

import {
  createFakeAuditSink,
} from "./fake-aie-audit-sink";

import type {
  FakeAuditSink,
} from "./fake-aie-audit-sink";

import type {
  AieAuthorizationResult,
  AieRequestAuthorizer,
} from "./request-authorization";

import {
  handleResolveAssetRequest,
} from "./resolve-asset-http";

import {
  handleResolveAssetsRequest,
  MAX_BATCH_BODY_BYTES,
} from "./resolve-assets-http";

import {
  AieServerError,
} from "./resolve-asset";

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
 * TASK-022: emission points, correlation header and payload privacy of the
 * audited orchestration, exercised through both real handlers with an injected
 * authorizer, sink, clock and correlation id.
 */

const FIXED = new Date(
  "2026-09-20T15:00:00.000Z",
);

const SUBJECT =
  "3f2b1c9e-8a4d-4e6f-9b0a-1c2d3e4f5a6b";

const BEARER =
  "sentinel-audit-bearer-token";

const RAW_NAME =
  "SENTINEL-RAW-NAME-PETROBRAS-DEB";

const INSTRUMENT =
  "SENTINELCODE99";

const AMOUNT = 987654.32;

const CPF = "123.456.789-09";

const SINK_SECRET =
  "sentinel-sink-secret";

const SINGLE_URL =
  "http://localhost/api/aie/resolve-asset";

const BATCH_URL =
  "http://localhost/api/aie/resolve-assets";

function asset(): CandidateAsset {
  return {
    id: "asset-1",

    rawName: RAW_NAME,

    source: {
      institution: `Bank ${CPF}`,
    },

    hints: {
      assetType: "debenture",

      instrumentCode: INSTRUMENT,

      amount: AMOUNT,
    },
  };
}

function post(
  url: string,
  body: unknown,
  headers: Record<
    string,
    string
  > = {
    "content-type":
      "application/json",

    authorization: `Bearer ${BEARER}`,
  },
): Request {
  return new Request(url, {
    method: "POST",

    headers,

    body:
      typeof body === "string"
        ? body
        : JSON.stringify(body),
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

const UNAUTHENTICATED: AieAuthorizationResult =
  {
    authorized: false,

    reason: "unauthenticated",
  };

const FORBIDDEN: AieAuthorizationResult =
  {
    authorized: false,

    reason: "forbidden",

    subject: SUBJECT,
  };

function audit(
  sink: FakeAuditSink,
  extra: Partial<AieAuditOptions> = {},
): AieAuditOptions {
  return {
    sink,

    now: () => FIXED,

    generateCorrelationId: () =>
      "corr-fixed-1",

    ...extra,
  };
}

function resolution(): ResolutionResult {
  const candidateAsset = asset();

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
      ],

      createdAt:
        "2026-09-20T15:00:00.000Z",

      updatedAt:
        "2026-09-20T15:00:00.000Z",
    },

    verifiedAsset: null,

    plan: {
      assetType: "debenture",

      unresolvedFields: [
        "identity",
      ],

      steps: [],
    },

    nextAction: "search-provider",
  };
}

const TARGETS = [
  {
    name: "resolve-asset",

    url: SINGLE_URL,

    handle: handleResolveAssetRequest,

    route: singleRoute,

    valid: (): unknown => asset(),

    spy: resolveAsset,

    operation: "resolve-asset",
  },
  {
    name: "resolve-assets",

    url: BATCH_URL,

    handle: handleResolveAssetsRequest,

    route: batchRoute,

    valid: (): unknown => ({
      assets: [asset()],
    }),

    spy: resolveAssets,

    operation: "resolve-assets",
  },
] as const;

/** Every response must carry the id, JSON headers and no-store. */
function expectCorrelated(
  response: Response,
  id = "corr-fixed-1",
): void {
  expect(
    response.headers.get(
      "x-correlation-id",
    ),
  ).toBe(id);

  expect(
    response.headers.get(
      "cache-control",
    ),
  ).toBe("no-store");

  expect(
    response.headers.get(
      "content-type",
    ),
  ).toContain("application/json");
}

function serialized(
  events: AieAuditEvent[],
): string {
  return JSON.stringify(events);
}

const ALLOWED_KEYS = new Set([
  "correlationId",
  "timestamp",
  "operation",
  "subject",
  "stage",
  "outcome",
  "decision",
  "status",
]);

describe("AIE audit trail through the handlers", () => {
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

  for (const target of TARGETS) {
    describe(target.name, () => {
      it("returns the correlation id on 200 and audits authorization + completion", async () => {
        const sink =
          createFakeAuditSink();

        const response =
          await target.handle(
            post(
              target.url,
              target.valid(),
            ),
            {
              authorizer: allow(),

              audit: audit(sink),
            },
          );

        expect(
          response.status,
        ).toBe(200);

        expectCorrelated(response);

        expect(sink.events).toEqual([
          {
            correlationId:
              "corr-fixed-1",

            timestamp:
              "2026-09-20T15:00:00.000Z",

            operation:
              target.operation,

            stage: "authorization",

            outcome: "authorized",

            decision: "allow",

            subject: SUBJECT,
          },
          {
            correlationId:
              "corr-fixed-1",

            timestamp:
              "2026-09-20T15:00:00.000Z",

            operation:
              target.operation,

            stage: "execution",

            outcome: "completed",

            status: 200,

            subject: SUBJECT,
          },
        ]);
      });

      it("400: correlation id, validation-error, and no payload values in the event", async () => {
        const sink =
          createFakeAuditSink();

        const response =
          await target.handle(
            post(
              target.url,
              `{"rawName":"${RAW_NAME}"`,
            ),
            {
              authorizer: allow(),

              audit: audit(sink),
            },
          );

        expect(
          response.status,
        ).toBe(400);

        expectCorrelated(response);

        expect(
          sink.events.map((event) => [
            event.stage,
            event.outcome,
          ]),
        ).toEqual([
          ["authorization", "authorized"],
          [
            "execution",
            "validation-error",
          ],
        ]);

        expect(
          serialized(sink.events),
        ).not.toContain(RAW_NAME);

        expect(
          target.spy,
        ).not.toHaveBeenCalled();
      });

      it("415: correlation id and validation-error", async () => {
        const sink =
          createFakeAuditSink();

        const response =
          await target.handle(
            post(
              target.url,
              "x",
              {
                "content-type":
                  "text/plain",

                authorization: `Bearer ${BEARER}`,
              },
            ),
            {
              authorizer: allow(),

              audit: audit(sink),
            },
          );

        expect(
          response.status,
        ).toBe(415);

        expectCorrelated(response);

        expect(
          sink.events[1],
        ).toMatchObject({
          outcome: "validation-error",

          status: 415,
        });
      });

      it("401: correlation id, an authorization deny event and NO subject", async () => {
        const sink =
          createFakeAuditSink();

        const response =
          await target.handle(
            post(
              target.url,
              target.valid(),
            ),
            {
              authorizer: deny(
                UNAUTHENTICATED,
              ),

              audit: audit(sink),
            },
          );

        expect(
          response.status,
        ).toBe(401);

        expectCorrelated(response);

        expect(sink.events).toEqual([
          {
            correlationId:
              "corr-fixed-1",

            timestamp:
              "2026-09-20T15:00:00.000Z",

            operation:
              target.operation,

            stage: "authorization",

            outcome:
              "unauthenticated",

            decision: "deny",

            status: 401,
          },
        ]);

        expect(
          "subject" in
            (sink.events[0] as object),
        ).toBe(false);
      });

      it("403: correlation id and a deny event WITH the subject of the identified caller", async () => {
        const sink =
          createFakeAuditSink();

        const response =
          await target.handle(
            post(
              target.url,
              target.valid(),
            ),
            {
              authorizer:
                deny(FORBIDDEN),

              audit: audit(sink),
            },
          );

        expect(
          response.status,
        ).toBe(403);

        expectCorrelated(response);

        expect(sink.events).toEqual([
          {
            correlationId:
              "corr-fixed-1",

            timestamp:
              "2026-09-20T15:00:00.000Z",

            operation:
              target.operation,

            stage: "authorization",

            outcome: "forbidden",

            decision: "deny",

            status: 403,

            subject: SUBJECT,
          },
        ]);
      });

      it("500 from the authorizer: recorded safely as authorization-error, denied, without the error", async () => {
        const sink =
          createFakeAuditSink();

        const response =
          await target.handle(
            post(
              target.url,
              target.valid(),
            ),
            {
              authorizer: {
                authorize:
                  async () => {
                    throw new Error(
                      `boom ${BEARER} ${SUBJECT}`,
                    );
                  },
              },

              audit: audit(sink),
            },
          );

        expect(
          response.status,
        ).toBe(500);

        expectCorrelated(response);

        expect(sink.events).toEqual([
          {
            correlationId:
              "corr-fixed-1",

            timestamp:
              "2026-09-20T15:00:00.000Z",

            operation:
              target.operation,

            stage: "authorization",

            outcome:
              "authorization-error",

            decision: "deny",

            status: 500,
          },
        ]);

        const text =
          serialized(sink.events);

        expect(text).not.toContain(
          BEARER,
        );

        expect(text).not.toContain(
          "boom",
        );

        expect(
          target.spy,
        ).not.toHaveBeenCalled();
      });

      it("500 during execution: internal-error without the exception message", async () => {
        target.spy.mockRejectedValue(
          new Error(
            `exploded ${SINK_SECRET} ${RAW_NAME}`,
          ),
        );

        const sink =
          createFakeAuditSink();

        const response =
          await target.handle(
            post(
              target.url,
              target.valid(),
            ),
            {
              authorizer: allow(),

              audit: audit(sink),
            },
          );

        expect(
          response.status,
        ).toBe(500);

        expectCorrelated(response);

        expect(
          sink.events[1],
        ).toMatchObject({
          stage: "execution",

          outcome: "internal-error",

          status: 500,
        });

        const text =
          serialized(sink.events);

        expect(text).not.toContain(
          "exploded",
        );

        expect(text).not.toContain(
          SINK_SECRET,
        );

        expect(text).not.toContain(
          RAW_NAME,
        );
      });

      it("every audit event has only the approved keys and no sensitive value", async () => {
        const scenarios: Array<
          [
            AieRequestAuthorizer,
            string,
            Record<string, string>?,
          ]
        > = [
          [allow(), "ok"],
          [
            deny(UNAUTHENTICATED),
            "ok",
          ],
          [deny(FORBIDDEN), "ok"],
        ];

        const sink =
          createFakeAuditSink();

        for (const [
          authorizer,
        ] of scenarios) {
          await target.handle(
            post(
              target.url,
              target.valid(),
              {
                "content-type":
                  "application/json",

                authorization: `Bearer ${BEARER}`,

                cookie: `session=${BEARER}`,

                "x-api-key": BEARER,
              },
            ),
            {
              authorizer,

              audit: audit(sink),
            },
          );
        }

        expect(
          sink.events.length,
        ).toBeGreaterThan(0);

        for (const event of sink.events) {
          for (const key of Object.keys(
            event,
          )) {
            expect(
              ALLOWED_KEYS.has(key),
            ).toBe(true);
          }
        }

        const text =
          serialized(sink.events);

        for (const leaked of [
          RAW_NAME,
          INSTRUMENT,
          String(AMOUNT),
          CPF,
          "Bank",
          BEARER,
          "Authorization",
          "Bearer",
          "cookie",
          "x-api-key",
          "candidateAsset",
          "rawName",
          "instrumentCode",
          "amount",
          "hints",
          "principal",
          "roles",
          "cliente",
          "entitlement",
          "aie_batch",
        ]) {
          expect(text).not.toContain(
            leaked,
          );
        }
      });

      it("ignores an incoming correlation header: the id is always server-generated", async () => {
        const sink =
          createFakeAuditSink();

        const response =
          await target.handle(
            post(
              target.url,
              target.valid(),
              {
                "content-type":
                  "application/json",

                authorization: `Bearer ${BEARER}`,

                "x-correlation-id":
                  "attacker-chosen-id",
              },
            ),
            {
              authorizer: allow(),

              audit: audit(sink),
            },
          );

        expect(
          response.headers.get(
            "x-correlation-id",
          ),
        ).toBe("corr-fixed-1");

        expect(
          serialized(sink.events),
        ).not.toContain(
          "attacker-chosen-id",
        );
      });

      it("uses a fresh random UUID per request by default (no injected generator)", async () => {
        const sink =
          createFakeAuditSink();

        const ids = new Set<string>();

        for (let i = 0; i < 5; i += 1) {
          const response =
            await target.handle(
              post(
                target.url,
                target.valid(),
              ),
              {
                authorizer: allow(),

                audit: {
                  sink,

                  now: () => FIXED,
                },
              },
            );

          const id =
            response.headers.get(
              "x-correlation-id",
            ) as string;

          expect(id).toMatch(
            /^[0-9a-f-]{36}$/,
          );

          ids.add(id);
        }

        expect(ids.size).toBe(5);

        // Both events of a request share the id.
        for (
          let i = 0;
          i < sink.events.length;
          i += 2
        ) {
          expect(
            sink.events[i]
              ?.correlationId,
          ).toBe(
            sink.events[i + 1]
              ?.correlationId,
          );
        }
      });

      it("audits authorization BEFORE any parsing or provider work", async () => {
        const order: string[] = [];

        const sink = {
          events: [] as AieAuditEvent[],

          write: async (
            event: AieAuditEvent,
          ) => {
            order.push(
              `audit:${event.stage}`,
            );
          },
        };

        target.spy.mockImplementation(
          async () => {
            order.push("resolve");

            return target.name ===
              "resolve-asset"
              ? resolution()
              : { items: [] };
          },
        );

        await target.handle(
          post(
            target.url,
            target.valid(),
          ),
          {
            authorizer: allow(),

            audit: { sink },
          },
        );

        expect(order).toEqual([
          "audit:authorization",
          "resolve",
          "audit:execution",
        ]);
      });

      it("a denied request never executes and never gets an execution event", async () => {
        const sink =
          createFakeAuditSink();

        for (const result of [
          UNAUTHENTICATED,
          FORBIDDEN,
        ]) {
          await target.handle(
            post(
              target.url,
              target.valid(),
            ),
            {
              authorizer:
                deny(result),

              audit: audit(sink),
            },
          );
        }

        expect(
          sink.events.every(
            (event) =>
              event.stage ===
              "authorization",
          ),
        ).toBe(true);

        expect(
          target.spy,
        ).not.toHaveBeenCalled();
      });

      describe("the audit sink can never change the outcome", () => {
        const behaviors = [
          "throw",
          "reject",
          "hang",
        ] as const;

        for (const behavior of behaviors) {
          it(`sink ${behavior} on the authorization event: an allowed request still completes, a denied one stays denied, nothing leaks`, async () => {
            const failures: unknown[] =
              [];

            const options = (
              sink: FakeAuditSink,
            ): AieAuditOptions =>
              audit(sink, {
                writeTimeoutMs: 20,

                onSinkFailure: (
                  failure,
                ) =>
                  failures.push(
                    failure,
                  ),
              });

            const allowed =
              await target.handle(
                post(
                  target.url,
                  target.valid(),
                ),
                {
                  authorizer: allow(),

                  audit: options(
                    createFakeAuditSink(
                      (event) =>
                        event.stage ===
                        "authorization"
                          ? behavior
                          : "ok",
                    ),
                  ),
                },
              );

            const denied =
              await target.handle(
                post(
                  target.url,
                  target.valid(),
                ),
                {
                  authorizer: deny(
                    FORBIDDEN,
                  ),

                  audit: options(
                    createFakeAuditSink(
                      () => behavior,
                    ),
                  ),
                },
              );

            expect(
              allowed.status,
            ).toBe(200);

            expect(
              denied.status,
            ).toBe(403);

            for (const response of [
              allowed,
              denied,
            ]) {
              const text =
                await response.text();

              expectCorrelated(
                response,
              );

              for (const leaked of [
                SINK_SECRET,
                "exploded",
                SUBJECT,
                "Error:",
              ]) {
                expect(
                  text,
                ).not.toContain(
                  leaked,
                );
              }
            }

            expect(
              failures.length,
            ).toBeGreaterThan(0);

            for (const failure of failures) {
              expect(
                Object.keys(
                  failure as object,
                ),
              ).toEqual(["stage"]);
            }
          });

          it(`sink ${behavior} on the completion event: the response is still delivered unchanged`, async () => {
            const baseline =
              await target.handle(
                post(
                  target.url,
                  target.valid(),
                ),
                {
                  authorizer: allow(),

                  audit: audit(
                    createFakeAuditSink(),
                  ),
                },
              );

            const baselineBody =
              await baseline.text();

            const failing =
              await target.handle(
                post(
                  target.url,
                  target.valid(),
                ),
                {
                  authorizer: allow(),

                  audit: audit(
                    createFakeAuditSink(
                      (event) =>
                        event.stage ===
                        "execution"
                          ? behavior
                          : "ok",
                    ),
                    {
                      writeTimeoutMs: 20,
                    },
                  ),
                },
              );

            expect(
              failing.status,
            ).toBe(200);

            expect(
              await failing.text(),
            ).toBe(baselineBody);
          });
        }
      });

      it("the sink cannot alter the principal or the resolution: results are identical with a mutating sink", async () => {
        const baseline =
          await target.handle(
            post(
              target.url,
              target.valid(),
            ),
            {
              authorizer: allow(),

              audit: audit(
                createFakeAuditSink(),
              ),
            },
          );

        const mutating = {
          write: async (
            event: AieAuditEvent,
          ) => {
            try {
              (
                event as unknown as Record<
                  string,
                  unknown
                >
              ).subject = "tampered";

              (
                event as unknown as Record<
                  string,
                  unknown
                >
              ).extra = {
                token: BEARER,
              };
            } catch {
              // The event is frozen: tampering fails.
            }
          },
        };

        const tampered =
          await target.handle(
            post(
              target.url,
              target.valid(),
            ),
            {
              authorizer: allow(),

              audit: {
                sink: mutating,

                now: () => FIXED,

                generateCorrelationId:
                  () => "corr-fixed-1",
              },
            },
          );

        expect(
          await tampered.text(),
        ).toBe(await baseline.text());

        expect(
          target.spy.mock.calls
            .length,
        ).toBe(2);

        expect(
          JSON.stringify(
            target.spy.mock.calls,
          ),
        ).not.toContain("tampered");
      });
    });
  }

  describe("route-specific outcomes", () => {
    it("single route 503 (configuration) is recorded as configuration-error", async () => {
      resolveAsset.mockRejectedValue(
        new AieServerError(
          "configuration",
        ),
      );

      const sink =
        createFakeAuditSink();

      const response =
        await handleResolveAssetRequest(
          post(
            SINGLE_URL,
            asset(),
          ),
          {
            authorizer: allow(),

            audit: audit(sink),
          },
        );

      expect(response.status).toBe(
        503,
      );

      expectCorrelated(response);

      expect(
        sink.events[1],
      ).toMatchObject({
        outcome:
          "configuration-error",

        status: 503,
      });
    });

    it("batch 413 (payload too large) is recorded as validation-error, before the body is parsed", async () => {
      const sink =
        createFakeAuditSink();

      const response =
        await handleResolveAssetsRequest(
          post(
            BATCH_URL,
            "x".repeat(
              MAX_BATCH_BODY_BYTES + 1,
            ),
          ),
          {
            authorizer: allow(),

            audit: audit(sink),
          },
        );

      expect(response.status).toBe(
        413,
      );

      expectCorrelated(response);

      expect(
        sink.events[1],
      ).toMatchObject({
        outcome: "validation-error",

        status: 413,
      });
    });

    it("a denied oversized request is audited as a denial (401), not as 413", async () => {
      const sink =
        createFakeAuditSink();

      const response =
        await handleResolveAssetsRequest(
          post(
            BATCH_URL,
            "x".repeat(
              MAX_BATCH_BODY_BYTES + 1,
            ),
          ),
          {
            authorizer: deny(
              UNAUTHENTICATED,
            ),

            audit: audit(sink),
          },
        );

      expect(response.status).toBe(
        401,
      );

      expect(sink.events).toHaveLength(
        1,
      );

      expect(
        sink.events[0]?.outcome,
      ).toBe("unauthenticated");
    });

    it("a batch of many assets audits the same minimal metadata as a batch of one (no counts, no items)", async () => {
      const run = async (
        count: number,
      ): Promise<string> => {
        resolveAssets.mockResolvedValue({
          items: [],
        });

        const sink =
          createFakeAuditSink();

        await handleResolveAssetsRequest(
          post(BATCH_URL, {
            assets: Array.from(
              { length: count },
              () => asset(),
            ),
          }),
          {
            authorizer: allow(),

            audit: audit(sink),
          },
        );

        return serialized(
          sink.events,
        );
      };

      expect(await run(7)).toBe(
        await run(1),
      );
    });
  });
  describe("real routes with the production defaults", () => {
    it("the default (deny-all) authorizer answers 401 with a correlation id", async () => {
      for (const target of TARGETS) {
        const response =
          await target.route.POST(
            post(
              target.url,
              target.valid(),
            ),
          );

        expect(
          response.status,
        ).toBe(401);

        expect(
          response.headers.get(
            "x-correlation-id",
          ),
        ).toMatch(
          /^[0-9a-f-]{36}$/,
        );

        expect(
          response.headers.get(
            "cache-control",
          ),
        ).toBe("no-store");
      }
    });
  });
});


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