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

import type {
  AieRequestAuthorizer,
} from "./request-authorization";

/**
 * Offline integration of the authorization boundary with the REAL server
 * composition (handler -> use case -> getServerAie -> engine -> ANBIMA client).
 * Only the global fetch is replaced by a fake: no real network is possible.
 */

const CLIENT_ID =
  "sentinel-auth-int-id";

const CLIENT_SECRET =
  "sentinel-auth-int-secret";

const ACCESS_TOKEN =
  "sentinel-auth-int-token";

const SUBJECT =
  "sentinel-principal-subject";

const ROLE =
  "sentinel-principal-role";

const allowAuthorizer: AieRequestAuthorizer =
  {
    authorize: async () => ({
      authorized: true,

      principal: {
        subject: SUBJECT,

        roles: [ROLE],
      },
    }),
  };

const forbiddenAuthorizer: AieRequestAuthorizer =
  {
    authorize: async () => ({
      authorized: false,

      reason: "forbidden",
    }),
  };

interface FetchCall {
  url: string;

  init: unknown;
}

function stubFetch(): FetchCall[] {
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

        const isToken =
          url.endsWith(
            "/oauth/access-token",
          );

        const body = isToken
          ? {
              access_token:
                ACCESS_TOKEN,

              token_type: "Bearer",

              expires_in: 3600,
            }
          : [
              createAnbimaDebentureRecord(
                {
                  codigo_ativo:
                    "ABCD11",

                  emissor:
                    "Petrobras",
                },
              ),
            ];

        return {
          ok: true,

          status: 200,

          json: async () => body,
        };
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
): Request {
  return new Request(url, {
    method: "POST",

    headers: {
      "content-type":
        "application/json",
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

const SINGLE_URL =
  "http://localhost/api/aie/resolve-asset";

const BATCH_URL =
  "http://localhost/api/aie/resolve-assets";

describe(
  "authorization boundary (real server composition, offline)",
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
      vi.useRealTimers();

      vi.unstubAllEnvs();

      vi.unstubAllGlobals();

      vi.resetModules();
    });

    it(
      "never lets the principal reach ANBIMA calls, provider work or the responses",
      async () => {
        const calls = stubFetch();

        const { single, batch } =
          await load();

        const responses = [
          await single(
            post(
              SINGLE_URL,
              debenture(),
            ),
            {
              authorizer:
                allowAuthorizer,
            },
          ),
          await batch(
            post(BATCH_URL, {
              assets: [debenture()],
            }),
            {
              authorizer:
                allowAuthorizer,
            },
          ),
        ];

        expect(
          responses.map(
            (response) =>
              response.status,
          ),
        ).toEqual([200, 200]);

        // The provider was really queried (one token, one cached feed)...
        expect(
          calls.length,
        ).toBeGreaterThan(0);

        // ...and nothing about the principal travelled with it.
        const outbound =
          JSON.stringify(calls);

        const texts =
          await Promise.all(
            responses.map(
              (response) =>
                response.text(),
            ),
          );

        for (const secretLike of [
          SUBJECT,
          ROLE,
        ]) {
          expect(
            outbound,
          ).not.toContain(
            secretLike,
          );

          for (const text of texts) {
            expect(
              text,
            ).not.toContain(
              secretLike,
            );
          }
        }
      },
    );

    it(
      "returns the same resolution result regardless of who is authorized",
      async () => {
        stubFetch();

        // Fixed clock: investigations and evidence carry generation timestamps.
        vi.useFakeTimers({
          toFake: ["Date"],
        });

        vi.setSystemTime(
          new Date(
            "2026-09-19T12:00:00.000Z",
          ),
        );

        const { single } =
          await load();

        const asOne =
          await single(
            post(
              SINGLE_URL,
              debenture(),
            ),
            {
              authorizer: {
                authorize:
                  async () => ({
                    authorized:
                      true,

                    principal: {
                      subject:
                        "user-one",
                    },
                  }),
              },
            },
          );

        const asTwo =
          await single(
            post(
              SINGLE_URL,
              debenture(),
            ),
            {
              authorizer: {
                authorize:
                  async () => ({
                    authorized:
                      true,

                    principal: {
                      subject:
                        "user-two",

                      roles: [
                        "admin",
                      ],
                    },
                  }),
              },
            },
          );

        expect(
          JSON.parse(
            await asOne.text(),
          ),
        ).toEqual(
          JSON.parse(
            await asTwo.text(),
          ),
        );
      },
    );

    it(
      "creates no server AIE and makes no request when access is denied, even with ANBIMA configured",
      async () => {
        const calls = stubFetch();

        const { single, batch } =
          await load();

        for (const authorizer of [
          undefined,
          forbiddenAuthorizer,
        ]) {
          const responses = [
            await single(
              post(
                SINGLE_URL,
                debenture(),
              ),
              { authorizer },
            ),
            await batch(
              post(BATCH_URL, {
                assets: [
                  debenture(),
                ],
              }),
              { authorizer },
            ),
          ];

          expect(
            responses.map(
              (response) =>
                response.status,
            ),
          ).toEqual(
            authorizer
              ? [403, 403]
              : [401, 401],
          );
        }

        expect(calls).toHaveLength(
          0,
        );
      },
    );
  },
);
