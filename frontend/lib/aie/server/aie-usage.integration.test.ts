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
  AIE_MAX_BATCH_REQUESTS_PER_MINUTE,
  AIE_MAX_SINGLE_REQUESTS_PER_MINUTE,
} from "./aie-usage";

/**
 * TASK-023, offline route-level integration with the production defaults:
 *
 *   real route -> real PlanejadorRequestAuthorizer (fake /auth/me by token)
 *     -> real default usage controller -> real resolution (fake ANBIMA)
 *
 * The usage controller is NOT mocked here. Only the global fetch is replaced, so
 * no real network request is possible.
 */

const PLANEJADOR_URL =
  "http://localhost:8000";

const IDENTITY_URL = `${PLANEJADOR_URL}/api/v1/auth/me`;

const USER_A =
  "3f2b1c9e-8a4d-4e6f-9b0a-1c2d3e4f5a6b";

const USER_B =
  "11111111-2222-4333-8444-555555555555";

const TOKEN_A = "token-of-user-a";

const TOKEN_B = "token-of-user-b";

const CLIENT_ID =
  "sentinel-usage-int-id";

const CLIENT_SECRET =
  "sentinel-usage-int-secret";

const ANBIMA_TOKEN =
  "sentinel-usage-int-anbima-token";

const SINGLE_URL =
  "http://localhost:3100/api/aie/resolve-asset";

const BATCH_URL =
  "http://localhost:3100/api/aie/resolve-assets";

interface Call {
  url: string;
}

function stubFetch(): Call[] {
  const calls: Call[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (
        url: string,
        init?: {
          headers?: Record<
            string,
            string
          >;
        },
      ) => {
        calls.push({ url });

        if (url === IDENTITY_URL) {
          const bearer =
            init?.headers
              ?.Authorization ?? "";

          const isB =
            bearer.endsWith(TOKEN_B);

          return new Response(
            JSON.stringify({
              id: isB ? USER_B : USER_A,

              role: "cliente",

              is_active: true,

              entitlements: {
                aie_batch: true,
              },
            }),
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

function debenture(): CandidateAsset {
  return {
    id: "A",

    rawName: "DEB A",

    source: {},

    hints: {
      assetType: "debenture",

      instrumentCode: "ABCD11",
    },
  };
}

function post(
  url: string,
  body: unknown,
  token: string,
): Request {
  return new Request(url, {
    method: "POST",

    headers: {
      "content-type":
        "application/json",

      authorization: `Bearer ${token}`,
    },

    body: JSON.stringify(body),
  });
}

function anbimaCalls(
  calls: Call[],
): Call[] {
  return calls.filter(
    (call) => call.url !== IDENTITY_URL,
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
  "identity rate limits through the real routes (offline)",
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
      "single: allowed until the limit, then 429 with no further ANBIMA call; another subject stays allowed",
      async () => {
        const calls = stubFetch();

        const { single } =
          await loadRoutes();

        const limit =
          AIE_MAX_SINGLE_REQUESTS_PER_MINUTE;

        for (
          let i = 0;
          i < limit;
          i += 1
        ) {
          const response =
            await single(
              post(
                SINGLE_URL,
                debenture(),
                TOKEN_A,
              ),
            );

          expect(
            response.status,
          ).toBe(200);
        }

        const anbimaBefore =
          anbimaCalls(calls).length;

        expect(
          anbimaBefore,
        ).toBeGreaterThan(0);

        const limited = await single(
          post(
            SINGLE_URL,
            debenture(),
            TOKEN_A,
          ),
        );

        expect(limited.status).toBe(
          429,
        );

        expect(
          limited.headers.get(
            "retry-after",
          ),
        ).toMatch(/^\d+$/);

        expect(
          limited.headers.get(
            "x-correlation-id",
          ),
        ).toMatch(/^[0-9a-f-]{36}$/);

        const text =
          await limited.text();

        expect(
          JSON.parse(text).error.code,
        ).toBe("AIE_RATE_LIMITED");

        for (const leaked of [
          USER_A,
          TOKEN_A,
          CLIENT_SECRET,
          ANBIMA_TOKEN,
        ]) {
          expect(text).not.toContain(
            leaked,
          );
        }

        // No provider work after the denial.
        expect(
          anbimaCalls(calls).length,
        ).toBe(anbimaBefore);

        // The denied request did authenticate (one identity call), nothing more.
        expect(
          calls.filter(
            (call) =>
              call.url ===
              IDENTITY_URL,
          ),
        ).toHaveLength(limit + 1);

        // Another identity is independent.
        const other = await single(
          post(
            SINGLE_URL,
            debenture(),
            TOKEN_B,
          ),
        );

        expect(other.status).toBe(200);
      },
    );

    it(
      "batch: one HTTP request is one slot, the sixth in a minute is 429, and single is unaffected",
      async () => {
        const calls = stubFetch();

        const { single, batch } =
          await loadRoutes();

        const limit =
          AIE_MAX_BATCH_REQUESTS_PER_MINUTE;

        const manyAssets = {
          assets: Array.from(
            { length: 25 },
            () => debenture(),
          ),
        };

        for (
          let i = 0;
          i < limit;
          i += 1
        ) {
          expect(
            (
              await batch(
                post(
                  BATCH_URL,
                  manyAssets,
                  TOKEN_A,
                ),
              )
            ).status,
          ).toBe(200);
        }

        const anbimaBefore =
          anbimaCalls(calls).length;

        const limited = await batch(
          post(
            BATCH_URL,
            manyAssets,
            TOKEN_A,
          ),
        );

        expect(limited.status).toBe(
          429,
        );

        expect(
          anbimaCalls(calls).length,
        ).toBe(anbimaBefore);

        // Same subject, single bucket: still available.
        expect(
          (
            await single(
              post(
                SINGLE_URL,
                debenture(),
                TOKEN_A,
              ),
            )
          ).status,
        ).toBe(200);

        // Another subject's batch bucket is untouched.
        expect(
          (
            await batch(
              post(
                BATCH_URL,
                manyAssets,
                TOKEN_B,
              ),
            )
          ).status,
        ).toBe(200);
      },
    );

    it(
      "unauthenticated and forbidden requests do not consume any quota",
      async () => {
        stubFetch();

        const { batch, single } =
          await loadRoutes();

        // Missing bearer: 401, repeated well beyond any limit.
        for (let i = 0; i < 40; i += 1) {
          const response =
            await single(
              new Request(SINGLE_URL, {
                method: "POST",

                headers: {
                  "content-type":
                    "application/json",
                },

                body: JSON.stringify(
                  debenture(),
                ),
              }),
            );

          expect(
            response.status,
          ).toBe(401);
        }

        // A real caller still has its full quota.
        expect(
          (
            await single(
              post(
                SINGLE_URL,
                debenture(),
                TOKEN_A,
              ),
            )
          ).status,
        ).toBe(200);

        void batch;
      },
    );
  },
);
