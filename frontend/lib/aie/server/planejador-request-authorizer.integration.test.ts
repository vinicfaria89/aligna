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
 * Offline integration of the Planejador authorizer through the REAL routes:
 * route -> handler -> requireAuthorization -> getAieRequestAuthorizer ->
 * PlanejadorRequestAuthorizer -> (fake) identity service, and on success the
 * real use case, server AIE and (fake) ANBIMA. Only the global fetch is
 * replaced, so no real network request is possible.
 */

const PLANEJADOR_URL =
  "http://localhost:8000";

const IDENTITY_URL = `${PLANEJADOR_URL}/api/v1/auth/me`;

const USER_ID =
  "3f2b1c9e-8a4d-4e6f-9b0a-1c2d3e4f5a6b";

const BEARER =
  "sentinel-integration-bearer-token";

const CLIENT_ID =
  "sentinel-auth20-id";

const CLIENT_SECRET =
  "sentinel-auth20-secret";

const ANBIMA_TOKEN =
  "sentinel-auth20-anbima-token";

const SINGLE_URL =
  "http://localhost:3100/api/aie/resolve-asset";

const BATCH_URL =
  "http://localhost:3100/api/aie/resolve-assets";

interface FetchCall {
  url: string;

  init: {
    headers?: Record<string, string>;
  };
}

type IdentityAnswer =
  | {
      status: number;

      body?: unknown;
    }
  | Error;

function stubFetch(
  identity: IdentityAnswer,
): FetchCall[] {
  const calls: FetchCall[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (
        url: string,
        init: FetchCall["init"],
      ) => {
        calls.push({
          url,
          init,
        });

        if (url === IDENTITY_URL) {
          if (identity instanceof Error) {
            throw identity;
          }

          return new Response(
            identity.body === undefined
              ? null
              : JSON.stringify(
                  identity.body,
                ),
            {
              status:
                identity.status,
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

function identityBody(
  role = "cliente",
  extra: Record<string, unknown> = {},
): { status: number; body: unknown } {
  return {
    status: 200,

    body: {
      id: USER_ID,

      role,

      is_active: true,

      ...extra,
    },
  };
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
  authorization: string | null = `Bearer ${BEARER}`,
): Request {
  const headers: Record<
    string,
    string
  > = {
    "content-type":
      "application/json",
  };

  if (authorization !== null) {
    headers.authorization =
      authorization;
  }

  return new Request(url, {
    method: "POST",

    headers,

    body: JSON.stringify(body),
  });
}

function identityCalls(
  calls: FetchCall[],
): FetchCall[] {
  return calls.filter(
    (call) =>
      call.url === IDENTITY_URL,
  );
}

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

const SECRETS = [
  BEARER,
  CLIENT_ID,
  CLIENT_SECRET,
  ANBIMA_TOKEN,
  btoa(
    `${CLIENT_ID}:${CLIENT_SECRET}`,
  ),
];

describe(
  "Planejador authorizer through the real routes (offline)",
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
      "authorizes a single asset end to end without leaking the bearer or the principal",
      async () => {
        const calls = stubFetch(
          identityBody("assessor", {
            email: "someone@example.test",
          }),
        );

        const { single } =
          await loadRoutes();

        const response =
          await single(
            post(
              SINGLE_URL,
              debenture(),
            ),
          );

        expect(
          response.status,
        ).toBe(200);

        const text =
          await response.text();

        // One identity check, then the real resolution (token + feed).
        expect(
          identityCalls(calls),
        ).toHaveLength(1);

        expect(
          anbimaCalls(calls).length,
        ).toBeGreaterThan(0);

        // The bearer only travels to the identity service.
        expect(
          identityCalls(calls)[0]?.init
            .headers?.Authorization,
        ).toBe(`Bearer ${BEARER}`);

        for (const call of anbimaCalls(
          calls,
        )) {
          const outbound =
            JSON.stringify(call);

          expect(outbound).not.toContain(
            BEARER,
          );

          expect(outbound).not.toContain(
            USER_ID,
          );
        }

        for (const secret of SECRETS) {
          expect(text).not.toContain(
            secret,
          );
        }

        expect(text).not.toContain(
          USER_ID,
        );

        expect(text).not.toContain(
          "someone@example.test",
        );
      },
    );

    it(
      "answers 403 on the batch route for an authenticated allowed role whose answer has no entitlements (legacy Planejador), with no resolution work",
      async () => {
        for (const role of [
          "cliente",
          "assessor",
          "administrador",
        ]) {
          const calls = stubFetch(
            identityBody(role),
          );

          const { batch } =
            await loadRoutes();

          const response =
            await batch(
              post(BATCH_URL, {
                assets: [debenture()],
              }),
            );

          expect(
            response.status,
          ).toBe(403);

          expect(
            (
              (await response.json()) as {
                error: {
                  code: string;
                };
              }
            ).error.code,
          ).toBe("AIE_FORBIDDEN");

          expect(
            identityCalls(calls),
          ).toHaveLength(1);

          expect(
            anbimaCalls(calls),
          ).toHaveLength(0);
        }
      },
    );

    it(
      "answers 401 without any network call when there is no usable bearer",
      async () => {
        const calls = stubFetch(
          identityBody(),
        );

        const { single, batch } =
          await loadRoutes();

        for (const authorization of [
          null,
          "Basic abc",
          "Bearer",
          "Bearer a b",
        ]) {
          const responses = [
            await single(
              post(
                SINGLE_URL,
                debenture(),
                authorization,
              ),
            ),
            await batch(
              post(
                BATCH_URL,
                {
                  assets: [
                    debenture(),
                  ],
                },
                authorization,
              ),
            ),
          ];

          expect(
            responses.map(
              (response) =>
                response.status,
            ),
          ).toEqual([401, 401]);
        }

        expect(calls).toHaveLength(0);
      },
    );

    it(
      "answers 401 when the Planejador rejects the token, with no resolution work",
      async () => {
        const calls = stubFetch({
          status: 401,

          body: {
            detail: "Credenciais invalidas",
          },
        });

        const { single, batch } =
          await loadRoutes();

        const responses = [
          await single(
            post(
              SINGLE_URL,
              debenture(),
            ),
          ),
          await batch(
            post(BATCH_URL, {
              assets: [debenture()],
            }),
          ),
        ];

        expect(
          responses.map(
            (response) =>
              response.status,
          ),
        ).toEqual([401, 401]);

        expect(
          anbimaCalls(calls),
        ).toHaveLength(0);
      },
    );

    it(
      "fails closed with 500 when the Planejador is unavailable, without leaking anything",
      async () => {
        for (const identity of [
          {
            status: 503,
          },
          {
            status: 500,

            body: {
              detail: `boom ${BEARER}`,
            },
          },
          new Error(
            `ECONNREFUSED ${BEARER}`,
          ),
        ] as IdentityAnswer[]) {
          const calls =
            stubFetch(identity);

          const { single, batch } =
            await loadRoutes();

          for (const run of [
            () =>
              single(
                post(
                  SINGLE_URL,
                  debenture(),
                ),
              ),
            () =>
              batch(
                post(BATCH_URL, {
                  assets: [
                    debenture(),
                  ],
                }),
              ),
          ]) {
            const response =
              await run();

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
              BEARER,
            );
          }

          expect(
            anbimaCalls(calls),
          ).toHaveLength(0);
        }
      },
    );

    it(
      "stays deny-all (401) for a valid bearer when the identity URL is not configured",
      async () => {
        vi.stubEnv(
          "PLANEJADOR_AUTH_BASE_URL",
          undefined,
        );

        const calls = stubFetch(
          identityBody(),
        );

        const { single, batch } =
          await loadRoutes();

        const responses = [
          await single(
            post(
              SINGLE_URL,
              debenture(),
            ),
          ),
          await batch(
            post(BATCH_URL, {
              assets: [debenture()],
            }),
          ),
        ];

        expect(
          responses.map(
            (response) =>
              response.status,
          ),
        ).toEqual([401, 401]);

        expect(calls).toHaveLength(0);
      },
    );

    it(
      "asks the Planejador again on every request (no cache) and reflects a deactivation immediately",
      async () => {
        let answer: IdentityAnswer =
          identityBody();

        const calls: FetchCall[] = [];

        vi.stubGlobal(
          "fetch",
          vi.fn(
            async (
              url: string,
              init: FetchCall["init"],
            ) => {
              calls.push({
                url,
                init,
              });

              if (
                url === IDENTITY_URL
              ) {
                const current =
                  answer as {
                    status: number;

                    body?: unknown;
                  };

                return new Response(
                  JSON.stringify(
                    current.body ?? {},
                  ),
                  {
                    status:
                      current.status,
                  },
                );
              }

              return new Response(
                url.endsWith(
                  "/oauth/access-token",
                )
                  ? JSON.stringify({
                      access_token:
                        ANBIMA_TOKEN,

                      token_type:
                        "Bearer",

                      expires_in: 3600,
                    })
                  : JSON.stringify([
                      createAnbimaDebentureRecord(
                        {
                          codigo_ativo:
                            "ABCD11",
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

        const { single } =
          await loadRoutes();

        const first = await single(
          post(
            SINGLE_URL,
            debenture(),
          ),
        );

        expect(first.status).toBe(
          200,
        );

        answer = {
          status: 200,

          body: {
            id: USER_ID,

            role: "cliente",

            is_active: false,
          },
        };

        const second = await single(
          post(
            SINGLE_URL,
            debenture(),
          ),
        );

        expect(second.status).toBe(
          401,
        );

        expect(
          identityCalls(calls),
        ).toHaveLength(2);
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