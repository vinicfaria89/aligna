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

/**
 * TASK-021, offline integration:
 *
 *   real route handler -> real PlanejadorRequestAuthorizer -> fake /auth/me
 *     -> real resolveAssets -> real server AIE -> fake ANBIMA
 *
 * Only the global fetch is replaced, so no real network is possible.
 */

const PLANEJADOR_URL =
  "http://localhost:8000";

const IDENTITY_URL = `${PLANEJADOR_URL}/api/v1/auth/me`;

const USER_ID =
  "3f2b1c9e-8a4d-4e6f-9b0a-1c2d3e4f5a6b";

const BEARER =
  "sentinel-entitlement-bearer";

const CLIENT_ID =
  "sentinel-ent-id";

const CLIENT_SECRET =
  "sentinel-ent-secret";

const ANBIMA_TOKEN =
  "sentinel-ent-anbima-token";

const SINGLE_URL =
  "http://localhost:3100/api/aie/resolve-asset";

const BATCH_URL =
  "http://localhost:3100/api/aie/resolve-assets";

interface FetchCall {
  url: string;

  init: unknown;
}

function stubFetch(
  identityBody: Record<
    string,
    unknown
  >,
): FetchCall[] {
  const calls: FetchCall[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (
        url: string,
        init: unknown,
      ) => {
        calls.push({
          url,
          init,
        });

        if (url === IDENTITY_URL) {
          return new Response(
            JSON.stringify(
              identityBody,
            ),
            {
              status: 200,
            },
          );
        }

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
            createAnbimaDebentureRecord(
              {
                codigo_ativo:
                  "ABCD11",

                emissor:
                  "Petrobras",
              },
            ),
            createAnbimaDebentureRecord(
              {
                codigo_ativo:
                  "EFGH22",

                emissor: "Vale",
              },
            ),
          ]),
          {
            status: 200,
          },
        );
      },
    ),
  );

  return calls;
}

function identity(
  role: string,
  entitlements?: unknown,
): Record<string, unknown> {
  return {
    id: USER_ID,

    role,

    is_active: true,

    ...(entitlements === undefined
      ? {}
      : { entitlements }),
  };
}

function debenture(
  id: string,
  instrumentCode: string,
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

const BATCH_BODY = {
  assets: [
    debenture("A", "ABCD11"),
    debenture("B", "EFGH22"),
  ],
};

function anbimaCalls(
  calls: FetchCall[],
): FetchCall[] {
  return calls.filter(
    (call) =>
      call.url !== IDENTITY_URL,
  );
}

async function loadRoutes() {
  vi.resetModules();

  return {
    single: (
      await import(
        "../../../app/api/aie/resolve-asset/route"
      )
    ).POST,

    batch: (
      await import(
        "../../../app/api/aie/resolve-assets/route"
      )
    ).POST,
  };
}

describe(
  "batch entitlement through the real routes (offline)",
  () => {
    beforeEach(() => {
      vi.resetModules();

      vi.stubEnv(
        "PLANEJADOR_AUTH_BASE_URL",
        PLANEJADOR_URL,
      );

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
      "A) aie_batch true: the batch reaches the real resolution and answers 200, in order, without leaking",
      async () => {
        for (const role of [
          "cliente",
          "assessor",
          "administrador",
        ]) {
          const calls = stubFetch(
            identity(role, {
              aie_batch: true,
            }),
          );

          const { batch } =
            await loadRoutes();

          const response =
            await batch(
              post(
                BATCH_URL,
                BATCH_BODY,
              ),
            );

          expect(
            response.status,
          ).toBe(200);

          const text =
            await response.text();

          const body = JSON.parse(
            text,
          ) as {
            ok: boolean;

            result: {
              items: Array<{
                index: number;

                candidateAssetId: string;

                ok: boolean;
              }>;
            };
          };

          expect(body.ok).toBe(true);

          expect(
            body.result.items.map(
              (item) => [
                item.index,
                item.candidateAssetId,
                item.ok,
              ],
            ),
          ).toEqual([
            [0, "A", true],
            [1, "B", true],
          ]);

          // One identity check, then ONE token and ONE feed request.
          expect(
            calls.filter(
              (call) =>
                call.url ===
                IDENTITY_URL,
            ),
          ).toHaveLength(1);

          expect(
            anbimaCalls(calls),
          ).toHaveLength(2);

          // The entitlement, the bearer and the subject stay out of the
          // response and out of every ANBIMA request.
          for (const leaked of [
            "aie_batch",
            "entitlement",
            BEARER,
            USER_ID,
            CLIENT_SECRET,
            ANBIMA_TOKEN,
          ]) {
            expect(text).not.toContain(
              leaked,
            );
          }

          for (const call of anbimaCalls(
            calls,
          )) {
            const outbound =
              JSON.stringify(call);

            for (const leaked of [
              "aie_batch",
              "entitlement",
              BEARER,
              USER_ID,
            ]) {
              expect(
                outbound,
              ).not.toContain(leaked);
            }
          }

          vi.unstubAllGlobals();
        }
      },
    );

    it(
      "B) aie_batch false: 403 and the resolution never executes",
      async () => {
        const calls = stubFetch(
          identity("cliente", {
            aie_batch: false,
          }),
        );

        const { batch } =
          await loadRoutes();

        const response = await batch(
          post(BATCH_URL, BATCH_BODY),
        );

        expect(
          response.status,
        ).toBe(403);

        expect(
          await response.json(),
        ).toEqual({
          ok: false,

          error: {
            code: "AIE_FORBIDDEN",

            message:
              "You are not allowed to perform this operation.",
          },
        });

        // Only the identity check happened: no ANBIMA token, no feed.
        expect(calls).toHaveLength(1);

        expect(
          anbimaCalls(calls),
        ).toHaveLength(0);
      },
    );

    it(
      "C) legacy answer without entitlements: batch 403, single asset still 200",
      async () => {
        const calls = stubFetch(
          identity("cliente"),
        );

        const { single, batch } =
          await loadRoutes();

        const batchResponse =
          await batch(
            post(
              BATCH_URL,
              BATCH_BODY,
            ),
          );

        expect(
          batchResponse.status,
        ).toBe(403);

        expect(
          anbimaCalls(calls),
        ).toHaveLength(0);

        const singleResponse =
          await single(
            post(
              SINGLE_URL,
              debenture(
                "A",
                "ABCD11",
              ),
            ),
          );

        expect(
          singleResponse.status,
        ).toBe(200);

        expect(
          anbimaCalls(calls).length,
        ).toBeGreaterThan(0);
      },
    );

    it(
      "single asset does not depend on the entitlement",
      async () => {
        const calls = stubFetch(
          identity("assessor", {
            aie_batch: false,
          }),
        );

        const { single } =
          await loadRoutes();

        const response =
          await single(
            post(
              SINGLE_URL,
              debenture(
                "A",
                "ABCD11",
              ),
            ),
          );

        expect(
          response.status,
        ).toBe(200);

        expect(
          anbimaCalls(calls).length,
        ).toBeGreaterThan(0);
      },
    );

    it(
      "a malformed entitlement answers 500 AIE_AUTHORIZATION_ERROR on both routes and reaches nothing",
      async () => {
        for (const entitlements of [
          { aie_batch: "true" },
          { aie_batch: 1 },
          { aie_batch: null },
          null,
          [],
          "premium",
        ]) {
          const calls = stubFetch(
            identity(
              "cliente",
              entitlements,
            ),
          );

          const { single, batch } =
            await loadRoutes();

          const responses = [
            await single(
              post(
                SINGLE_URL,
                debenture(
                  "A",
                  "ABCD11",
                ),
              ),
            ),
            await batch(
              post(
                BATCH_URL,
                BATCH_BODY,
              ),
            ),
          ];

          for (const response of responses) {
            expect(
              response.status,
            ).toBe(500);

            const text =
              await response.text();

            expect(
              JSON.parse(text),
            ).toEqual({
              ok: false,

              error: {
                code: "AIE_AUTHORIZATION_ERROR",

                message:
                  "Unable to authorize request.",
              },
            });

            expect(text).not.toContain(
              "premium",
            );
          }

          expect(
            anbimaCalls(calls),
          ).toHaveLength(0);

          vi.unstubAllGlobals();
        }
      },
    );

    it(
      "existing behavior is unchanged: 401 from the Planejador stays 401 and a bad role stays 403",
      async () => {
        vi.stubGlobal(
          "fetch",
          vi.fn(async (url: string) =>
            url === IDENTITY_URL
              ? new Response("{}", {
                  status: 401,
                })
              : new Response("[]", {
                  status: 200,
                }),
          ),
        );

        const routes =
          await loadRoutes();

        expect(
          (
            await routes.batch(
              post(
                BATCH_URL,
                BATCH_BODY,
              ),
            )
          ).status,
        ).toBe(401);

        vi.unstubAllGlobals();

        stubFetch(
          identity("superuser", {
            aie_batch: true,
          }),
        );

        const other =
          await loadRoutes();

        expect(
          (
            await other.batch(
              post(
                BATCH_URL,
                BATCH_BODY,
              ),
            )
          ).status,
        ).toBe(403);
      },
    );
  },
);
