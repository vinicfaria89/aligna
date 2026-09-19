import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  ANBIMA_PRODUCTION_BASE_URL,
  ANBIMA_SANDBOX_BASE_URL,
  ANBIMA_TOKEN_URL,
  AnbimaHttpClient,
  AnbimaHttpError,
} from "./anbima-http-client";

import type {
  AnbimaFetch,
  AnbimaFetchInit,
  AnbimaFetchResponse,
  AnbimaHttpClientConfig,
} from "./anbima-http-client";

import {
  createAnbimaDebentureRecord,
} from "./fake-anbima-debenture-feed-client";

// Obviously fake, non-secret fixtures.
const CLIENT_ID = "test-client-id";

const CLIENT_SECRET =
  "test-client-secret";

const FEED_PATH =
  "/feed/precos-indices/v1/debentures/mercado-secundario";

interface RecordedCall {
  url: string;

  init: AnbimaFetchInit;
}

type Scripted =
  | AnbimaFetchResponse
  | Error;

function jsonResponse(
  status: number,
  body: unknown,
): AnbimaFetchResponse {
  return {
    ok:
      status >= 200 &&
      status < 300,

    status,

    json: async () => body,
  };
}

function tokenBody(
  accessToken: string,
  expiresIn = 3600,
): Record<string, unknown> {
  return {
    access_token: accessToken,

    token_type: "Bearer",

    expires_in: expiresIn,
  };
}

function feedOf(
  ...codes: string[]
): unknown[] {
  return codes.map((code) =>
    createAnbimaDebentureRecord({
      codigo_ativo: code,
    }),
  );
}

interface Harness {
  client: AnbimaHttpClient;

  calls: RecordedCall[];

  tokenCalls: () => RecordedCall[];

  feedCalls: () => RecordedCall[];

  advance: (seconds: number) => void;
}

function createHarness(
  scripted: {
    token?: Scripted[];

    feed?: Scripted[];
  },
  overrides: Partial<AnbimaHttpClientConfig> = {},
): Harness {
  const calls: RecordedCall[] =
    [];

  const tokenQueue = [
    ...(scripted.token ?? []),
  ];

  const feedQueue = [
    ...(scripted.feed ?? []),
  ];

  let nowMs = 1_000_000;

  const fake: AnbimaFetch =
    async (url, init) => {
      calls.push({
        url,
        init,
      });

      const isToken =
        url.endsWith(
          "/oauth/access-token",
        );

      const next = (
        isToken
          ? tokenQueue
          : feedQueue
      ).shift();

      if (!next) {
        throw new Error(
          `unexpected request to ${url}`,
        );
      }

      if (next instanceof Error) {
        throw next;
      }

      return next;
    };

  const client =
    new AnbimaHttpClient({
      clientId: CLIENT_ID,

      clientSecret: CLIENT_SECRET,

      environment: "production",

      fetch: fake,

      now: () => nowMs,

      // Feed reuse is covered by anbima-feed-cache.test.ts; here every lookup
      // must hit the fake so the original TASK-006 behavior stays observable.
      feedCacheTtlMs: 0,

      ...overrides,
    });

  const isTokenCall = (
    call: RecordedCall,
  ): boolean =>
    call.url.endsWith(
      "/oauth/access-token",
    );

  return {
    client,

    calls,

    tokenCalls: () =>
      calls.filter(isTokenCall),

    feedCalls: () =>
      calls.filter(
        (call) =>
          !isTokenCall(call),
      ),

    advance: (seconds) => {
      nowMs += seconds * 1000;
    },
  };
}

describe(
  "AnbimaHttpClient",
  () => {
    beforeEach(() => {
      // Guard: nothing in this suite may reach the real network.
      vi.stubGlobal(
        "fetch",
        () => {
          throw new Error(
            "real network call attempted",
          );
        },
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    describe(
      "token request",
      () => {
        it(
          "POSTs to the production OAuth token URL",
          async () => {
            const harness =
              createHarness({
                token: [
                  jsonResponse(
                    200,
                    tokenBody("t1"),
                  ),
                ],

                feed: [
                  jsonResponse(
                    200,
                    feedOf("ABCD11"),
                  ),
                ],
              });

            await harness.client
              .findSecondaryMarketDebentureByCode(
                "ABCD11",
              );

            const [call] =
              harness.tokenCalls();

            expect(
              call?.url,
            ).toBe(
              "https://api.anbima.com.br/oauth/access-token",
            );

            expect(
              call?.url,
            ).toBe(ANBIMA_TOKEN_URL);

            expect(
              call?.init.method,
            ).toBe("POST");
          },
        );

        it(
          "sends Basic base64(clientId:clientSecret) and a JSON content type",
          async () => {
            const harness =
              createHarness({
                token: [
                  jsonResponse(
                    200,
                    tokenBody("t1"),
                  ),
                ],

                feed: [
                  jsonResponse(
                    200,
                    feedOf("ABCD11"),
                  ),
                ],
              });

            await harness.client
              .findSecondaryMarketDebentureByCode(
                "ABCD11",
              );

            const [call] =
              harness.tokenCalls();

            expect(
              call?.init.headers
                .Authorization,
            ).toBe(
              `Basic ${btoa(
                `${CLIENT_ID}:${CLIENT_SECRET}`,
              )}`,
            );

            expect(
              call?.init.headers[
                "Content-Type"
              ],
            ).toBe(
              "application/json",
            );
          },
        );

        it(
          "sends grant_type=client_credentials as a JSON body",
          async () => {
            const harness =
              createHarness({
                token: [
                  jsonResponse(
                    200,
                    tokenBody("t1"),
                  ),
                ],

                feed: [
                  jsonResponse(
                    200,
                    feedOf("ABCD11"),
                  ),
                ],
              });

            await harness.client
              .findSecondaryMarketDebentureByCode(
                "ABCD11",
              );

            const [call] =
              harness.tokenCalls();

            expect(
              JSON.parse(
                call?.init.body ??
                  "null",
              ),
            ).toEqual({
              grant_type:
                "client_credentials",
            });
          },
        );

        it(
          "acquires the token lazily, not at construction",
          () => {
            const harness =
              createHarness({});

            expect(
              harness.calls,
            ).toHaveLength(0);
          },
        );

        it(
          "shares one in-flight token request between concurrent lookups",
          async () => {
            const harness =
              createHarness({
                token: [
                  jsonResponse(
                    200,
                    tokenBody("t1"),
                  ),
                ],

                feed: [
                  jsonResponse(
                    200,
                    feedOf("ABCD11"),
                  ),
                  jsonResponse(
                    200,
                    feedOf("ABCD11"),
                  ),
                ],
              });

            await Promise.all([
              harness.client
                .findSecondaryMarketDebentureByCode(
                  "ABCD11",
                ),

              harness.client
                .findSecondaryMarketDebentureByCode(
                  "ABCD11",
                ),
            ]);

            expect(
              harness.tokenCalls(),
            ).toHaveLength(1);
          },
        );
      },
    );

    describe(
      "environment",
      () => {
        it(
          "uses the production base URL by default",
          async () => {
            const harness =
              createHarness({
                token: [
                  jsonResponse(
                    200,
                    tokenBody("t1"),
                  ),
                ],

                feed: [
                  jsonResponse(
                    200,
                    feedOf("ABCD11"),
                  ),
                ],
              });

            await harness.client
              .findSecondaryMarketDebentureByCode(
                "ABCD11",
              );

            expect(
              harness.feedCalls()[0]
                ?.url,
            ).toBe(
              `${ANBIMA_PRODUCTION_BASE_URL}${FEED_PATH}`,
            );
          },
        );

        it(
          "uses the sandbox base URL for the feed when configured",
          async () => {
            const harness =
              createHarness(
                {
                  token: [
                    jsonResponse(
                      200,
                      tokenBody("t1"),
                    ),
                  ],

                  feed: [
                    jsonResponse(
                      200,
                      feedOf(
                        "ABCD11",
                      ),
                    ),
                  ],
                },
                {
                  environment:
                    "sandbox",
                },
              );

            await harness.client
              .findSecondaryMarketDebentureByCode(
                "ABCD11",
              );

            expect(
              harness.feedCalls()[0]
                ?.url,
            ).toBe(
              `${ANBIMA_SANDBOX_BASE_URL}${FEED_PATH}`,
            );

            // The sandbox token URL is not confirmed by the docs: the
            // documented production URL stays the default.
            expect(
              harness.tokenCalls()[0]
                ?.url,
            ).toBe(ANBIMA_TOKEN_URL);
          },
        );

        it(
          "allows overriding the token URL",
          async () => {
            const harness =
              createHarness(
                {
                  token: [
                    jsonResponse(
                      200,
                      tokenBody("t1"),
                    ),
                  ],

                  feed: [
                    jsonResponse(
                      200,
                      feedOf(
                        "ABCD11",
                      ),
                    ),
                  ],
                },
                {
                  tokenUrl:
                    "https://example.invalid/oauth/access-token",
                },
              );

            await harness.client
              .findSecondaryMarketDebentureByCode(
                "ABCD11",
              );

            expect(
              harness.tokenCalls()[0]
                ?.url,
            ).toBe(
              "https://example.invalid/oauth/access-token",
            );
          },
        );

        it(
          "never sends the optional data query parameter",
          async () => {
            const harness =
              createHarness({
                token: [
                  jsonResponse(
                    200,
                    tokenBody("t1"),
                  ),
                ],

                feed: [
                  jsonResponse(
                    200,
                    feedOf("ABCD11"),
                  ),
                ],
              });

            await harness.client
              .findSecondaryMarketDebentureByCode(
                "ABCD11",
              );

            expect(
              harness.feedCalls()[0]
                ?.url,
            ).not.toContain("?");
          },
        );
      },
    );

    describe(
      "token caching",
      () => {
        it(
          "reuses the cached token across feed calls",
          async () => {
            const harness =
              createHarness({
                token: [
                  jsonResponse(
                    200,
                    tokenBody("t1"),
                  ),
                ],

                feed: [
                  jsonResponse(
                    200,
                    feedOf("ABCD11"),
                  ),
                  jsonResponse(
                    200,
                    feedOf("ABCD11"),
                  ),
                  jsonResponse(
                    200,
                    feedOf("ABCD11"),
                  ),
                ],
              });

            for (let i = 0; i < 3; i++) {
              await harness.client
                .findSecondaryMarketDebentureByCode(
                  "ABCD11",
                );
            }

            expect(
              harness.tokenCalls(),
            ).toHaveLength(1);

            expect(
              harness.feedCalls(),
            ).toHaveLength(3);
          },
        );

        it(
          "keeps the token while it is still valid",
          async () => {
            const harness =
              createHarness({
                token: [
                  jsonResponse(
                    200,
                    tokenBody(
                      "t1",
                      3600,
                    ),
                  ),
                ],

                feed: [
                  jsonResponse(
                    200,
                    feedOf("ABCD11"),
                  ),
                  jsonResponse(
                    200,
                    feedOf("ABCD11"),
                  ),
                ],
              });

            await harness.client
              .findSecondaryMarketDebentureByCode(
                "ABCD11",
              );

            harness.advance(3000);

            await harness.client
              .findSecondaryMarketDebentureByCode(
                "ABCD11",
              );

            expect(
              harness.tokenCalls(),
            ).toHaveLength(1);
          },
        );

        it(
          "refreshes an expired token according to expires_in",
          async () => {
            const harness =
              createHarness({
                token: [
                  jsonResponse(
                    200,
                    tokenBody(
                      "token-one",
                      3600,
                    ),
                  ),
                  jsonResponse(
                    200,
                    tokenBody(
                      "token-two",
                      3600,
                    ),
                  ),
                ],

                feed: [
                  jsonResponse(
                    200,
                    feedOf("ABCD11"),
                  ),
                  jsonResponse(
                    200,
                    feedOf("ABCD11"),
                  ),
                ],
              });

            await harness.client
              .findSecondaryMarketDebentureByCode(
                "ABCD11",
              );

            harness.advance(3600);

            await harness.client
              .findSecondaryMarketDebentureByCode(
                "ABCD11",
              );

            expect(
              harness.tokenCalls(),
            ).toHaveLength(2);

            const [first, second] =
              harness.feedCalls();

            expect(
              first?.init.headers
                .access_token,
            ).toBe("token-one");

            expect(
              second?.init.headers
                .access_token,
            ).toBe("token-two");
          },
        );
      },
    );

    describe(
      "feed request and local matching",
      () => {
        it(
          "sends the client_id and access_token headers",
          async () => {
            const harness =
              createHarness({
                token: [
                  jsonResponse(
                    200,
                    tokenBody(
                      "token-one",
                    ),
                  ),
                ],

                feed: [
                  jsonResponse(
                    200,
                    feedOf("ABCD11"),
                  ),
                ],
              });

            await harness.client
              .findSecondaryMarketDebentureByCode(
                "ABCD11",
              );

            const [call] =
              harness.feedCalls();

            expect(
              call?.init.method,
            ).toBe("GET");

            expect(
              call?.init.headers,
            ).toEqual({
              client_id: CLIENT_ID,

              access_token:
                "token-one",

              "Content-Type":
                "application/json",
            });
          },
        );

        it(
          "finds the exact codigo_ativo locally after normalization",
          async () => {
            const harness =
              createHarness({
                token: [
                  jsonResponse(
                    200,
                    tokenBody("t1"),
                  ),
                ],

                feed: [
                  jsonResponse(
                    200,
                    feedOf(
                      "OTHR11",
                      "ABCD11",
                    ),
                  ),
                ],
              });

            const record =
              await harness.client
                .findSecondaryMarketDebentureByCode(
                  "  abcd11 ",
                );

            expect(
              record?.codigo_ativo,
            ).toBe("ABCD11");

            expect(
              record?.emissor,
            ).toBe("Petrobras");
          },
        );

        it(
          "returns null for an unknown codigo_ativo",
          async () => {
            const harness =
              createHarness({
                token: [
                  jsonResponse(
                    200,
                    tokenBody("t1"),
                  ),
                ],

                feed: [
                  jsonResponse(
                    200,
                    feedOf("ABCD11"),
                  ),
                ],
              });

            await expect(
              harness.client
                .findSecondaryMarketDebentureByCode(
                  "ZZZZ99",
                ),
            ).resolves.toBeNull();
          },
        );

        it(
          "does not match partial or extended codes",
          async () => {
            const harness =
              createHarness({
                token: [
                  jsonResponse(
                    200,
                    tokenBody("t1"),
                  ),
                ],

                feed: [
                  jsonResponse(
                    200,
                    feedOf("ABCD11"),
                  ),
                  jsonResponse(
                    200,
                    feedOf("ABCD11"),
                  ),
                  jsonResponse(
                    200,
                    feedOf("ABCD11"),
                  ),
                ],
              });

            for (const code of [
              "ABCD1",
              "ABCD111",
              "ABC",
            ]) {
              await expect(
                harness.client
                  .findSecondaryMarketDebentureByCode(
                    code,
                  ),
              ).resolves.toBeNull();
            }
          },
        );

        it(
          "does not call ANBIMA for a blank code",
          async () => {
            const harness =
              createHarness({});

            await expect(
              harness.client
                .findSecondaryMarketDebentureByCode(
                  "   ",
                ),
            ).resolves.toBeNull();

            expect(
              harness.calls,
            ).toHaveLength(0);
          },
        );

        it(
          "accepts a duplicated code when every duplicate has the same issuer",
          async () => {
            const harness =
              createHarness({
                token: [
                  jsonResponse(
                    200,
                    tokenBody("t1"),
                  ),
                ],

                feed: [
                  jsonResponse(
                    200,
                    feedOf(
                      "ABCD11",
                      "ABCD11",
                    ),
                  ),
                ],
              });

            const record =
              await harness.client
                .findSecondaryMarketDebentureByCode(
                  "ABCD11",
                );

            expect(
              record?.codigo_ativo,
            ).toBe("ABCD11");
          },
        );

        it(
          "rejects a code that appears with different issuers instead of guessing",
          async () => {
            const harness =
              createHarness({
                token: [
                  jsonResponse(
                    200,
                    tokenBody("t1"),
                  ),
                ],

                feed: [
                  jsonResponse(200, [
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
                          "ABCD11",

                        emissor:
                          "Vale",
                      },
                    ),
                  ]),
                ],
              });

            await expect(
              harness.client
                .findSecondaryMarketDebentureByCode(
                  "ABCD11",
                ),
            ).rejects.toMatchObject({
              name: "AnbimaHttpError",

              code:
                "FEED_RESPONSE_INVALID",
            });
          },
        );
      },
    );

    describe(
      "failures",
      () => {
        it(
          "throws when the token request returns a non-2xx status",
          async () => {
            const harness =
              createHarness({
                token: [
                  jsonResponse(
                    401,
                    {},
                  ),
                ],
              });

            await expect(
              harness.client
                .findSecondaryMarketDebentureByCode(
                  "ABCD11",
                ),
            ).rejects.toMatchObject({
              name: "AnbimaHttpError",

              code:
                "TOKEN_REQUEST_FAILED",

              status: 401,
            });

            expect(
              harness.feedCalls(),
            ).toHaveLength(0);
          },
        );

        it.each([
          [
            "not an object",
            "oops",
          ],
          [
            "missing access_token",
            {
              token_type: "Bearer",
              expires_in: 3600,
            },
          ],
          [
            "blank access_token",
            {
              access_token: "  ",
              token_type: "Bearer",
              expires_in: 3600,
            },
          ],
          [
            "missing token_type",
            {
              access_token: "t1",
              expires_in: 3600,
            },
          ],
          [
            "missing expires_in",
            {
              access_token: "t1",
              token_type: "Bearer",
            },
          ],
          [
            "non-numeric expires_in",
            {
              access_token: "t1",
              token_type: "Bearer",
              expires_in: "3600",
            },
          ],
          [
            "non-positive expires_in",
            {
              access_token: "t1",
              token_type: "Bearer",
              expires_in: 0,
            },
          ],
        ])(
          "throws on a malformed token response: %s",
          async (_label, body) => {
            const harness =
              createHarness({
                token: [
                  jsonResponse(
                    200,
                    body,
                  ),
                ],
              });

            await expect(
              harness.client
                .findSecondaryMarketDebentureByCode(
                  "ABCD11",
                ),
            ).rejects.toMatchObject({
              name: "AnbimaHttpError",

              code:
                "TOKEN_RESPONSE_INVALID",
            });

            expect(
              harness.feedCalls(),
            ).toHaveLength(0);
          },
        );

        it(
          "throws when the token response body is not JSON",
          async () => {
            const harness =
              createHarness({
                token: [
                  {
                    ok: true,

                    status: 200,

                    json:
                      async () => {
                        throw new Error(
                          "bad json",
                        );
                      },
                  },
                ],
              });

            await expect(
              harness.client
                .findSecondaryMarketDebentureByCode(
                  "ABCD11",
                ),
            ).rejects.toMatchObject({
              code:
                "TOKEN_RESPONSE_INVALID",
            });
          },
        );

        it(
          "throws when the feed request returns a non-2xx status",
          async () => {
            const harness =
              createHarness({
                token: [
                  jsonResponse(
                    200,
                    tokenBody("t1"),
                  ),
                ],

                feed: [
                  jsonResponse(
                    500,
                    {},
                  ),
                ],
              });

            await expect(
              harness.client
                .findSecondaryMarketDebentureByCode(
                  "ABCD11",
                ),
            ).rejects.toMatchObject({
              name: "AnbimaHttpError",

              code:
                "FEED_REQUEST_FAILED",

              status: 500,
            });
          },
        );

        it.each([
          [
            "an unexpected envelope object",
            {
              data: [],
            },
          ],
          [
            "a non-array body",
            "oops",
          ],
          [
            "a non-object record",
            [
              "ABCD11",
            ],
          ],
          [
            "a record without codigo_ativo",
            [
              {
                emissor:
                  "Petrobras",

                data_referencia:
                  "2026-09-18",

                data_vencimento:
                  "2030-01-15",
              },
            ],
          ],
          [
            "a record with a blank emissor",
            [
              {
                ...createAnbimaDebentureRecord(),

                emissor: "  ",
              },
            ],
          ],
          [
            "a numeric field with the wrong type",
            [
              {
                ...createAnbimaDebentureRecord(),

                pu: "1000",
              },
            ],
          ],
          [
            "a string field with the wrong type",
            [
              {
                ...createAnbimaDebentureRecord(),

                grupo: 7,
              },
            ],
          ],
        ])(
          "throws on a malformed feed response: %s",
          async (_label, body) => {
            const harness =
              createHarness({
                token: [
                  jsonResponse(
                    200,
                    tokenBody("t1"),
                  ),
                ],

                feed: [
                  jsonResponse(
                    200,
                    body,
                  ),
                ],
              });

            await expect(
              harness.client
                .findSecondaryMarketDebentureByCode(
                  "ABCD11",
                ),
            ).rejects.toMatchObject({
              name: "AnbimaHttpError",

              code:
                "FEED_RESPONSE_INVALID",
            });
          },
        );

        it(
          "throws when the feed body is not JSON",
          async () => {
            const harness =
              createHarness({
                token: [
                  jsonResponse(
                    200,
                    tokenBody("t1"),
                  ),
                ],

                feed: [
                  {
                    ok: true,

                    status: 200,

                    json:
                      async () => {
                        throw new Error(
                          "bad json",
                        );
                      },
                  },
                ],
              });

            await expect(
              harness.client
                .findSecondaryMarketDebentureByCode(
                  "ABCD11",
                ),
            ).rejects.toMatchObject({
              code:
                "FEED_RESPONSE_INVALID",
            });
          },
        );

        it(
          "treats absent nullable fields as null",
          async () => {
            const harness =
              createHarness({
                token: [
                  jsonResponse(
                    200,
                    tokenBody("t1"),
                  ),
                ],

                feed: [
                  jsonResponse(200, [
                    {
                      codigo_ativo:
                        "ABCD11",

                      emissor:
                        "Petrobras",

                      data_referencia:
                        "2026-09-18",

                      data_vencimento:
                        "2030-01-15",
                    },
                  ]),
                ],
              });

            const record =
              await harness.client
                .findSecondaryMarketDebentureByCode(
                  "ABCD11",
                );

            expect(
              record?.pu,
            ).toBeNull();

            expect(
              record?.grupo,
            ).toBeNull();
          },
        );
      },
    );

    describe(
      "401 handling",
      () => {
        it(
          "invalidates the token and retries the feed exactly once",
          async () => {
            const harness =
              createHarness({
                token: [
                  jsonResponse(
                    200,
                    tokenBody(
                      "stale-token",
                    ),
                  ),
                  jsonResponse(
                    200,
                    tokenBody(
                      "fresh-token",
                    ),
                  ),
                ],

                feed: [
                  jsonResponse(
                    401,
                    {},
                  ),
                  jsonResponse(
                    200,
                    feedOf("ABCD11"),
                  ),
                ],
              });

            const record =
              await harness.client
                .findSecondaryMarketDebentureByCode(
                  "ABCD11",
                );

            expect(
              record?.codigo_ativo,
            ).toBe("ABCD11");

            expect(
              harness.tokenCalls(),
            ).toHaveLength(2);

            const [first, second] =
              harness.feedCalls();

            expect(
              first?.init.headers
                .access_token,
            ).toBe("stale-token");

            expect(
              second?.init.headers
                .access_token,
            ).toBe("fresh-token");
          },
        );

        it(
          "keeps using the refreshed token after a 401 recovery",
          async () => {
            const harness =
              createHarness({
                token: [
                  jsonResponse(
                    200,
                    tokenBody(
                      "stale-token",
                    ),
                  ),
                  jsonResponse(
                    200,
                    tokenBody(
                      "fresh-token",
                    ),
                  ),
                ],

                feed: [
                  jsonResponse(
                    401,
                    {},
                  ),
                  jsonResponse(
                    200,
                    feedOf("ABCD11"),
                  ),
                  jsonResponse(
                    200,
                    feedOf("ABCD11"),
                  ),
                ],
              });

            await harness.client
              .findSecondaryMarketDebentureByCode(
                "ABCD11",
              );

            await harness.client
              .findSecondaryMarketDebentureByCode(
                "ABCD11",
              );

            expect(
              harness.tokenCalls(),
            ).toHaveLength(2);
          },
        );

        it(
          "fails after a second 401 without retrying indefinitely",
          async () => {
            const harness =
              createHarness({
                token: [
                  jsonResponse(
                    200,
                    tokenBody("t1"),
                  ),
                  jsonResponse(
                    200,
                    tokenBody("t2"),
                  ),
                ],

                feed: [
                  jsonResponse(
                    401,
                    {},
                  ),
                  jsonResponse(
                    401,
                    {},
                  ),
                ],
              });

            await expect(
              harness.client
                .findSecondaryMarketDebentureByCode(
                  "ABCD11",
                ),
            ).rejects.toMatchObject({
              name: "AnbimaHttpError",

              code:
                "FEED_REQUEST_FAILED",

              status: 401,
            });

            expect(
              harness.feedCalls(),
            ).toHaveLength(2);

            expect(
              harness.tokenCalls(),
            ).toHaveLength(2);
          },
        );
      },
    );

    describe(
      "secrets",
      () => {
        it(
          "never includes credentials or tokens in thrown error messages",
          async () => {
            const secretToken =
              "secret-access-token-value";

            const basic = btoa(
              `${CLIENT_ID}:${CLIENT_SECRET}`,
            );

            const scenarios: Array<
              () => Harness
            > = [
              () =>
                createHarness({
                  token: [
                    jsonResponse(
                      401,
                      {
                        error:
                          CLIENT_SECRET,
                      },
                    ),
                  ],
                }),

              () =>
                createHarness({
                  token: [
                    jsonResponse(
                      200,
                      {
                        access_token:
                          secretToken,
                      },
                    ),
                  ],
                }),

              () =>
                createHarness({
                  token: [
                    jsonResponse(
                      200,
                      tokenBody(
                        secretToken,
                      ),
                    ),
                  ],

                  feed: [
                    jsonResponse(
                      500,
                      {
                        error:
                          secretToken,
                      },
                    ),
                  ],
                }),

              () =>
                createHarness({
                  token: [
                    jsonResponse(
                      200,
                      tokenBody(
                        secretToken,
                      ),
                    ),
                  ],

                  feed: [
                    jsonResponse(
                      200,
                      {
                        leaked:
                          secretToken,
                      },
                    ),
                  ],
                }),

              () =>
                createHarness({
                  token: [
                    new Error(
                      `transport error with ${CLIENT_SECRET} and ${basic}`,
                    ),
                  ],
                }),

              () =>
                createHarness({
                  token: [
                    jsonResponse(
                      200,
                      tokenBody(
                        secretToken,
                      ),
                    ),
                  ],

                  feed: [
                    new Error(
                      `transport error with ${secretToken}`,
                    ),
                  ],
                }),
            ];

            for (const build of scenarios) {
              const harness =
                build();

              let caught: unknown;

              try {
                await harness.client
                  .findSecondaryMarketDebentureByCode(
                    "ABCD11",
                  );
              } catch (error) {
                caught = error;
              }

              expect(
                caught,
              ).toBeInstanceOf(
                AnbimaHttpError,
              );

              const message =
                (
                  caught as AnbimaHttpError
                ).message;

              for (const secret of [
                CLIENT_SECRET,
                secretToken,
                basic,
              ]) {
                expect(
                  message,
                ).not.toContain(
                  secret,
                );
              }
            }
          },
        );

        it(
          "does not expose the client secret through serialization",
          () => {
            const harness =
              createHarness({});

            expect(
              JSON.stringify(
                harness.client,
              ),
            ).not.toContain(
              CLIENT_SECRET,
            );

            expect(
              Object.keys(
                harness.client,
              ),
            ).toEqual([]);
          },
        );

        it(
          "rejects missing credentials at construction",
          () => {
            expect(
              () =>
                new AnbimaHttpClient({
                  clientId: "",

                  clientSecret:
                    CLIENT_SECRET,

                  environment:
                    "production",
                }),
            ).toThrow(
              AnbimaHttpError,
            );

            expect(
              () =>
                new AnbimaHttpClient({
                  clientId:
                    CLIENT_ID,

                  clientSecret: "  ",

                  environment:
                    "production",
                }),
            ).toThrow(
              AnbimaHttpError,
            );
          },
        );

        it(
          "rejects an unknown environment at construction",
          () => {
            expect(
              () =>
                new AnbimaHttpClient({
                  clientId:
                    CLIENT_ID,

                  clientSecret:
                    CLIENT_SECRET,

                  environment:
                    "staging" as never,
                }),
            ).toThrow(
              AnbimaHttpError,
            );
          },
        );
      },
    );
  },
);
