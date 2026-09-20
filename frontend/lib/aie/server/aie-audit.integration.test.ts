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

import {
  createAnbimaDebentureRecord,
} from "../infrastructure/anbima/fake-anbima-debenture-feed-client";

import {
  createFakeAuditSink,
} from "./fake-aie-audit-sink";

import {
  PlanejadorRequestAuthorizer,
} from "./planejador-request-authorizer";

import type {
  PlanejadorFetch,
} from "./planejador-request-authorizer";

/**
 * TASK-022, offline integration: the real handlers, the real
 * PlanejadorRequestAuthorizer (fake /auth/me), the real resolution and server
 * AIE (fake ANBIMA), and an in-memory audit sink. No real network is possible.
 */

const USER_ID =
  "3f2b1c9e-8a4d-4e6f-9b0a-1c2d3e4f5a6b";

const BEARER =
  "sentinel-audit-int-bearer";

const CLIENT_ID =
  "sentinel-audit-int-id";

const CLIENT_SECRET =
  "sentinel-audit-int-secret";

const ANBIMA_TOKEN =
  "sentinel-audit-int-anbima-token";

const RAW_NAME =
  "SENTINEL-INT-RAW-NAME";

const INSTRUMENT = "ABCD11";

const AMOUNT = 424242.42;

const SINGLE_URL =
  "http://localhost/api/aie/resolve-asset";

const BATCH_URL =
  "http://localhost/api/aie/resolve-assets";

const FIXED = new Date(
  "2026-09-20T18:00:00.000Z",
);

interface Call {
  url: string;
}

function stubAnbima(): Call[] {
  const calls: Call[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      calls.push({ url });

      if (
        url.endsWith(
          "/oauth/access-token",
        )
      ) {
        return new Response(
          JSON.stringify({
            access_token:
              ANBIMA_TOKEN,

            token_type: "Bearer",

            expires_in: 3600,
          }),
          {
            status: 200,
          },
        );
      }

      return new Response(
        JSON.stringify([
          createAnbimaDebentureRecord({
            codigo_ativo: INSTRUMENT,

            emissor: "Petrobras",
          }),
        ]),
        {
          status: 200,
        },
      );
    }),
  );

  return calls;
}

function authorizer(
  identity:
    | Record<string, unknown>
    | Error
    | number,
): PlanejadorRequestAuthorizer {
  const fetchFake: PlanejadorFetch =
    async () => {
      if (identity instanceof Error) {
        throw identity;
      }

      if (typeof identity === "number") {
        return new Response("{}", {
          status: identity,
        });
      }

      return new Response(
        JSON.stringify(identity),
        {
          status: 200,
        },
      );
    };

  return new PlanejadorRequestAuthorizer(
    {
      baseUrl:
        "https://planejador.example.test",

      fetch: fetchFake,
    },
  );
}

function who(
  role: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: USER_ID,

    role,

    is_active: true,

    ...extra,
  };
}

function candidate(): CandidateAsset {
  return {
    id: "A",

    rawName: RAW_NAME,

    source: {},

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

async function load() {
  vi.resetModules();

  const single = await import(
    "./resolve-asset-http"
  );

  const batch = await import(
    "./resolve-assets-http"
  );

  return {
    single:
      single.handleResolveAssetRequest,

    batch:
      batch.handleResolveAssetsRequest,
  };
}

function auditOptions() {
  const sink = createFakeAuditSink();

  return {
    sink,

    options: {
      sink,

      now: () => FIXED,
    },
  };
}

const SENSITIVE = [
  BEARER,
  CLIENT_ID,
  CLIENT_SECRET,
  ANBIMA_TOKEN,
  RAW_NAME,
  String(AMOUNT),
  "rawName",
  "instrumentCode",
  "candidateAsset",
  "Authorization",
  "principal",
  "roles",
  "entitlement",
  "aie_batch",
  "Petrobras",
];

describe(
  "audit trail with the real authorizer and resolution (offline)",
  () => {
    beforeEach(() => {
      vi.resetModules();

      vi.stubEnv(
        "ANBIMA_CLIENT_ID",
        CLIENT_ID,
      );

      vi.stubEnv(
        "ANBIMA_CLIENT_SECRET",
        CLIENT_SECRET,
      );

      vi.stubEnv(
        "ANBIMA_ENVIRONMENT",
        undefined,
      );
    });

    afterEach(() => {
      vi.unstubAllEnvs();

      vi.unstubAllGlobals();

      vi.resetModules();
    });

    it(
      "audits an authorized batch (entitled) as allow + completed, without any payload or secret",
      async () => {
        const calls = stubAnbima();

        const { single, batch } =
          await load();

        const { sink, options } =
          auditOptions();

        const response = await batch(
          post(BATCH_URL, {
            assets: [candidate()],
          }),
          {
            authorizer: authorizer(
              who("cliente", {
                entitlements: {
                  aie_batch: true,
                },
              }),
            ),

            audit: options,
          },
        );

        expect(
          response.status,
        ).toBe(200);

        expect(
          response.headers.get(
            "x-correlation-id",
          ),
        ).toMatch(/^[0-9a-f-]{36}$/);

        expect(
          sink.events.map((event) => [
            event.stage,
            event.outcome,
            event.operation,
            event.subject,
          ]),
        ).toEqual([
          [
            "authorization",
            "authorized",
            "resolve-assets",
            USER_ID,
          ],
          [
            "execution",
            "completed",
            "resolve-assets",
            USER_ID,
          ],
        ]);

        // The real resolution ran (ANBIMA was really queried).
        expect(
          calls.length,
        ).toBeGreaterThan(0);

        const text = JSON.stringify(
          sink.events,
        );

        for (const leaked of SENSITIVE) {
          expect(text).not.toContain(
            leaked,
          );
        }

        const responseText =
          await response.text();

        // The response is unaffected by auditing (no audit internals in it).
        expect(
          responseText,
        ).not.toContain("corr");

        void single;
      },
    );

    it(
      "audits the legacy batch denial (no entitlements) as deny/forbidden with the subject, and no provider work",
      async () => {
        const calls = stubAnbima();

        const { batch } =
          await load();

        const { sink, options } =
          auditOptions();

        const response = await batch(
          post(BATCH_URL, {
            assets: [candidate()],
          }),
          {
            authorizer: authorizer(
              who("cliente"),
            ),

            audit: options,
          },
        );

        expect(
          response.status,
        ).toBe(403);

        expect(sink.events).toEqual([
          {
            correlationId:
              response.headers.get(
                "x-correlation-id",
              ),

            timestamp:
              "2026-09-20T18:00:00.000Z",

            operation:
              "resolve-assets",

            stage: "authorization",

            outcome: "forbidden",

            decision: "deny",

            status: 403,

            subject: USER_ID,
          },
        ]);

        expect(calls).toHaveLength(0);
      },
    );

    it(
      "audits a batch denial for aie_batch false the same way",
      async () => {
        const calls = stubAnbima();

        const { batch } =
          await load();

        const { sink, options } =
          auditOptions();

        const response = await batch(
          post(BATCH_URL, {
            assets: [candidate()],
          }),
          {
            authorizer: authorizer(
              who("assessor", {
                entitlements: {
                  aie_batch: false,
                },
              }),
            ),

            audit: options,
          },
        );

        expect(
          response.status,
        ).toBe(403);

        expect(
          sink.events,
        ).toHaveLength(1);

        expect(
          sink.events[0],
        ).toMatchObject({
          outcome: "forbidden",

          decision: "deny",

          subject: USER_ID,
        });

        expect(calls).toHaveLength(0);
      },
    );

    it(
      "audits a single asset as allow + completed for a caller without any entitlement",
      async () => {
        stubAnbima();

        const { single } =
          await load();

        const { sink, options } =
          auditOptions();

        const response = await single(
          post(
            SINGLE_URL,
            candidate(),
          ),
          {
            authorizer: authorizer(
              who("cliente"),
            ),

            audit: options,
          },
        );

        expect(
          response.status,
        ).toBe(200);

        expect(
          sink.events.map((event) => [
            event.stage,
            event.outcome,
            event.operation,
          ]),
        ).toEqual([
          [
            "authorization",
            "authorized",
            "resolve-asset",
          ],
          [
            "execution",
            "completed",
            "resolve-asset",
          ],
        ]);

        const text = JSON.stringify(
          sink.events,
        );

        for (const leaked of SENSITIVE) {
          expect(text).not.toContain(
            leaked,
          );
        }
      },
    );

    it(
      "an inactive user is a deny with NO subject, and a Planejador outage is an authorization-error with no subject",
      async () => {
        const calls = stubAnbima();

        const { single } =
          await load();

        const inactive =
          auditOptions();

        const inactiveResponse =
          await single(
            post(
              SINGLE_URL,
              candidate(),
            ),
            {
              authorizer: authorizer(
                who("cliente", {
                  is_active: false,
                }),
              ),

              audit: inactive.options,
            },
          );

        expect(
          inactiveResponse.status,
        ).toBe(401);

        expect(
          inactive.sink.events,
        ).toEqual([
          expect.objectContaining({
            outcome:
              "unauthenticated",

            decision: "deny",
          }),
        ]);

        expect(
          "subject" in
            (inactive.sink
              .events[0] as object),
        ).toBe(false);

        for (const identity of [
          503,
          new Error(
            `down ${BEARER}`,
          ),
          who("cliente", {
            entitlements: {
              aie_batch: "true",
            },
          }),
        ]) {
          const failing =
            auditOptions();

          const response =
            await single(
              post(
                SINGLE_URL,
                candidate(),
              ),
              {
                authorizer:
                  authorizer(
                    identity,
                  ),

                audit:
                  failing.options,
              },
            );

          expect(
            response.status,
          ).toBe(500);

          expect(
            failing.sink.events,
          ).toEqual([
            expect.objectContaining({
              outcome:
                "authorization-error",

              decision: "deny",

              status: 500,
            }),
          ]);

          expect(
            "subject" in
              (failing.sink
                .events[0] as object),
          ).toBe(false);

          expect(
            JSON.stringify(
              failing.sink.events,
            ),
          ).not.toContain(BEARER);
        }

        expect(calls).toHaveLength(0);
      },
    );

    it(
      "the production defaults on the real routes: 401, a correlation id, and a no-op audit that never throws",
      async () => {
        vi.stubEnv(
          "PLANEJADOR_AUTH_BASE_URL",
          undefined,
        );

        const calls = stubAnbima();

        vi.resetModules();

        const single = (
          await import(
            "../../../app/api/aie/resolve-asset/route"
          )
        ).POST;

        const batch = (
          await import(
            "../../../app/api/aie/resolve-assets/route"
          )
        ).POST;

        for (const [run, url, body] of [
          [
            single,
            SINGLE_URL,
            candidate(),
          ],
          [
            batch,
            BATCH_URL,
            { assets: [candidate()] },
          ],
        ] as const) {
          const response = await run(
            post(url, body),
          );

          expect(
            response.status,
          ).toBe(401);

          expect(
            response.headers.get(
              "x-correlation-id",
            ),
          ).toMatch(/^[0-9a-f-]{36}$/);
        }

        expect(calls).toHaveLength(0);
      },
    );
  },
);
