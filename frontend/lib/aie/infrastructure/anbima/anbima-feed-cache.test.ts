import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  ANBIMA_DEFAULT_FEED_CACHE_TTL_MS,
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
  FakeAnbimaClock,
} from "./fake-anbima-clock";

import {
  createAnbimaDebentureRecord,
} from "./fake-anbima-debenture-feed-client";

/**
 * TASK-015: feed cache and outbound rate limiting, fully offline. The global
 * fetch is replaced by a function that throws, time only moves through a fake
 * clock, and nothing ever sleeps for real.
 */

// Obviously fake, non-secret fixtures.
const CLIENT_ID = "cache-client-id";

const CLIENT_SECRET =
  "cache-client-secret";

const ACCESS_TOKEN =
  "cache-access-token";

const TTL_MS = 60_000;

interface RecordedCall {
  url: string;

  init: AnbimaFetchInit;

  /** Fake-clock time at which the request reached fetch. */
  at: number;
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

function tokenResponse(
  expiresIn = 3600,
  accessToken = ACCESS_TOKEN,
): AnbimaFetchResponse {
  return jsonResponse(200, {
    access_token: accessToken,

    token_type: "Bearer",

    expires_in: expiresIn,
  });
}

function feedResponse(
  ...codes: string[]
): AnbimaFetchResponse {
  return jsonResponse(
    200,
    codes.map((code) =>
      createAnbimaDebentureRecord({
        codigo_ativo: code,
      }),
    ),
  );
}

interface Harness {
  client: AnbimaHttpClient;

  clock: FakeAnbimaClock;

  calls: RecordedCall[];

  tokenCalls: () => RecordedCall[];

  feedCalls: () => RecordedCall[];
}

function createHarness(
  scripted: {
    token?: Scripted[];

    feed?: Scripted[];
  },
  overrides: Partial<AnbimaHttpClientConfig> = {},
): Harness {
  const clock =
    new FakeAnbimaClock();

  const calls: RecordedCall[] =
    [];

  const tokenQueue = [
    ...(scripted.token ?? []),
  ];

  const feedQueue = [
    ...(scripted.feed ?? []),
  ];

  const isTokenCall = (
    call: RecordedCall,
  ): boolean =>
    call.url.endsWith(
      "/oauth/access-token",
    );

  const fake: AnbimaFetch =
    async (url, init) => {
      calls.push({
        url,
        init,
        at: clock.now(),
      });

      const next = (
        url.endsWith(
          "/oauth/access-token",
        )
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

      now: clock.now,

      setTimer: clock.setTimer,

      feedCacheTtlMs: TTL_MS,

      ...overrides,
    });

  return {
    client,

    clock,

    calls,

    tokenCalls: () =>
      calls.filter(isTokenCall),

    feedCalls: () =>
      calls.filter(
        (call) =>
          !isTokenCall(call),
      ),
  };
}

describe("AnbimaHttpClient feed cache", () => {
  beforeEach(() => {
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

  it("defaults the feed TTL to 5 minutes", () => {
    expect(
      ANBIMA_DEFAULT_FEED_CACHE_TTL_MS,
    ).toBe(300_000);
  });

  it("performs one token and one feed request for the first lookup", async () => {
    const h = createHarness({
      token: [tokenResponse()],

      feed: [
        feedResponse("ABCD11"),
      ],
    });

    const record =
      await h.client.findSecondaryMarketDebentureByCode(
        "ABCD11",
      );

    expect(
      record?.codigo_ativo,
    ).toBe("ABCD11");

    expect(
      h.tokenCalls(),
    ).toHaveLength(1);

    expect(
      h.feedCalls(),
    ).toHaveLength(1);
  });

  it("reuses the cached feed within the TTL, including for different codes", async () => {
    const h = createHarness({
      token: [tokenResponse()],

      feed: [
        feedResponse(
          "ABCD11",
          "XYZ123",
          "TEST99",
        ),
      ],
    });

    const codes = [
      "ABCD11",
      "XYZ123",
      "TEST99",
      "ABCD11",
    ];

    const found: Array<
      string | undefined
    > = [];

    for (const code of codes) {
      await h.clock.advance(1000);

      found.push(
        (
          await h.client.findSecondaryMarketDebentureByCode(
            code,
          )
        )?.codigo_ativo,
      );
    }

    await h.clock.flush();

    expect(found).toEqual(codes);

    expect(
      h.tokenCalls(),
    ).toHaveLength(1);

    expect(
      h.feedCalls(),
    ).toHaveLength(1);
  });

  it("does not request a new token for a cache hit, even after the token expired", async () => {
    // Token lifetime 60 s => refresh at 30 s; the feed TTL is 60 s.
    const h = createHarness({
      token: [tokenResponse(60)],

      feed: [
        feedResponse("ABCD11"),
      ],
    });

    await h.client.findSecondaryMarketDebentureByCode(
      "ABCD11",
    );

    await h.clock.advance(45_000);

    const record =
      await h.client.findSecondaryMarketDebentureByCode(
        "ABCD11",
      );

    expect(
      record?.codigo_ativo,
    ).toBe("ABCD11");

    expect(
      h.tokenCalls(),
    ).toHaveLength(1);

    expect(
      h.feedCalls(),
    ).toHaveLength(1);
  });

  it("refreshes the feed once after the TTL without coupling it to the token expiry", async () => {
    const h = createHarness({
      token: [tokenResponse(3600)],

      feed: [
        feedResponse("ABCD11"),

        feedResponse("ABCD11"),
      ],
    });

    await h.client.findSecondaryMarketDebentureByCode(
      "ABCD11",
    );

    await h.clock.advance(
      TTL_MS - 1,
    );

    await h.client.findSecondaryMarketDebentureByCode(
      "ABCD11",
    );

    expect(
      h.feedCalls(),
    ).toHaveLength(1);

    await h.clock.advance(1);

    await h.client.findSecondaryMarketDebentureByCode(
      "ABCD11",
    );

    await h.client.findSecondaryMarketDebentureByCode(
      "ABCD11",
    );

    expect(
      h.feedCalls(),
    ).toHaveLength(2);

    // The token (3600 s) is still valid, so it was reused.
    expect(
      h.tokenCalls(),
    ).toHaveLength(1);
  });

  it("replaces the old feed with the new one on refresh", async () => {
    const h = createHarness({
      token: [tokenResponse()],

      feed: [
        feedResponse("OLD111"),

        feedResponse("NEW222"),
      ],
    });

    expect(
      (
        await h.client.findSecondaryMarketDebentureByCode(
          "OLD111",
        )
      )?.codigo_ativo,
    ).toBe("OLD111");

    await h.clock.advance(TTL_MS);

    expect(
      await h.client.findSecondaryMarketDebentureByCode(
        "OLD111",
      ),
    ).toBeNull();

    expect(
      (
        await h.client.findSecondaryMarketDebentureByCode(
          "NEW222",
        )
      )?.codigo_ativo,
    ).toBe("NEW222");
  });

  it("does not reuse anything when the TTL is 0", async () => {
    const h = createHarness(
      {
        token: [tokenResponse()],

        feed: [
          feedResponse("ABCD11"),

          feedResponse("ABCD11"),
        ],
      },
      {
        feedCacheTtlMs: 0,
      },
    );

    await h.client.findSecondaryMarketDebentureByCode(
      "ABCD11",
    );

    await h.client.findSecondaryMarketDebentureByCode(
      "ABCD11",
    );

    expect(
      h.feedCalls(),
    ).toHaveLength(2);
  });

  it("does not cache a failed feed request and can retry", async () => {
    const h = createHarness({
      token: [tokenResponse()],

      feed: [
        jsonResponse(500, {}),

        feedResponse("ABCD11"),
      ],
    });

    await expect(
      h.client.findSecondaryMarketDebentureByCode(
        "ABCD11",
      ),
    ).rejects.toMatchObject({
      code: "FEED_REQUEST_FAILED",

      status: 500,
    });

    const record =
      await h.client.findSecondaryMarketDebentureByCode(
        "ABCD11",
      );

    expect(
      record?.codigo_ativo,
    ).toBe("ABCD11");

    expect(
      h.feedCalls(),
    ).toHaveLength(2);
  });

  it("does not cache a network failure and can retry", async () => {
    const h = createHarness({
      token: [tokenResponse()],

      feed: [
        new Error("socket hang up"),

        feedResponse("ABCD11"),
      ],
    });

    await expect(
      h.client.findSecondaryMarketDebentureByCode(
        "ABCD11",
      ),
    ).rejects.toMatchObject({
      code: "FEED_REQUEST_FAILED",
    });

    await expect(
      h.client.findSecondaryMarketDebentureByCode(
        "ABCD11",
      ),
    ).resolves.toMatchObject({
      codigo_ativo: "ABCD11",
    });
  });

  it("does not cache a malformed feed and can retry", async () => {
    const h = createHarness({
      token: [tokenResponse()],

      feed: [
        jsonResponse(200, {
          not: "an array",
        }),

        jsonResponse(200, [
          {
            codigo_ativo: "ABCD11",
          },
        ]),

        feedResponse("ABCD11"),
      ],
    });

    for (let i = 0; i < 2; i += 1) {
      await expect(
        h.client.findSecondaryMarketDebentureByCode(
          "ABCD11",
        ),
      ).rejects.toMatchObject({
        code: "FEED_RESPONSE_INVALID",
      });
    }

    await expect(
      h.client.findSecondaryMarketDebentureByCode(
        "ABCD11",
      ),
    ).resolves.toMatchObject({
      codigo_ativo: "ABCD11",
    });

    expect(
      h.feedCalls(),
    ).toHaveLength(3);
  });

  it("never caches a 401 and keeps the retry-once behavior", async () => {
    const h = createHarness({
      token: [
        tokenResponse(3600, "token-1"),

        tokenResponse(3600, "token-2"),

        tokenResponse(3600, "token-3"),
      ],

      feed: [
        jsonResponse(401, {}),

        feedResponse("ABCD11"),
      ],
    });

    const record =
      await h.client.findSecondaryMarketDebentureByCode(
        "ABCD11",
      );

    expect(
      record?.codigo_ativo,
    ).toBe("ABCD11");

    expect(
      h.tokenCalls(),
    ).toHaveLength(2);

    expect(
      h.feedCalls().map(
        (call) =>
          call.init.headers
            .access_token,
      ),
    ).toEqual(["token-1", "token-2"]);

    // Cached now: no further request.
    await h.client.findSecondaryMarketDebentureByCode(
      "ABCD11",
    );

    expect(h.calls).toHaveLength(4);
  });

  it("does not cache anything after a second 401 and can retry later", async () => {
    const h = createHarness({
      token: [
        tokenResponse(),

        tokenResponse(),

        tokenResponse(),
      ],

      feed: [
        jsonResponse(401, {}),

        jsonResponse(401, {}),

        feedResponse("ABCD11"),
      ],
    });

    await expect(
      h.client.findSecondaryMarketDebentureByCode(
        "ABCD11",
      ),
    ).rejects.toMatchObject({
      code: "FEED_REQUEST_FAILED",

      status: 401,
    });

    await expect(
      h.client.findSecondaryMarketDebentureByCode(
        "ABCD11",
      ),
    ).resolves.toMatchObject({
      codigo_ativo: "ABCD11",
    });
  });

  it("shares one request among concurrent lookups on an empty cache", async () => {
    const h = createHarness({
      token: [tokenResponse()],

      feed: [
        feedResponse(
          "ABCD11",
          "XYZ123",
          "TEST99",
        ),
      ],
    });

    const results =
      await Promise.all([
        h.client.findSecondaryMarketDebentureByCode(
          "ABCD11",
        ),

        h.client.findSecondaryMarketDebentureByCode(
          "XYZ123",
        ),

        h.client.findSecondaryMarketDebentureByCode(
          "TEST99",
        ),

        h.client.findSecondaryMarketDebentureByCode(
          "NOPE00",
        ),
      ]);

    expect(
      results.map(
        (record) =>
          record?.codigo_ativo ??
          null,
      ),
    ).toEqual([
      "ABCD11",
      "XYZ123",
      "TEST99",
      null,
    ]);

    expect(
      h.tokenCalls(),
    ).toHaveLength(1);

    expect(
      h.feedCalls(),
    ).toHaveLength(1);
  });

  it("shares one refresh among concurrent lookups on an expired cache", async () => {
    const h = createHarness({
      token: [tokenResponse()],

      feed: [
        feedResponse("ABCD11"),

        feedResponse("ABCD11"),
      ],
    });

    await h.client.findSecondaryMarketDebentureByCode(
      "ABCD11",
    );

    await h.clock.advance(TTL_MS);

    await Promise.all([
      h.client.findSecondaryMarketDebentureByCode(
        "ABCD11",
      ),

      h.client.findSecondaryMarketDebentureByCode(
        "ABCD11",
      ),

      h.client.findSecondaryMarketDebentureByCode(
        "ABCD11",
      ),
    ]);

    expect(
      h.feedCalls(),
    ).toHaveLength(2);
  });

  it("shares a failure among concurrent lookups, then clears the in-flight slot", async () => {
    const h = createHarness({
      token: [tokenResponse()],

      feed: [
        jsonResponse(503, {}),

        feedResponse("ABCD11"),
      ],
    });

    const settled =
      await Promise.allSettled([
        h.client.findSecondaryMarketDebentureByCode(
          "ABCD11",
        ),

        h.client.findSecondaryMarketDebentureByCode(
          "ABCD11",
        ),
      ]);

    expect(
      settled.map(
        (item) => item.status,
      ),
    ).toEqual([
      "rejected",
      "rejected",
    ]);

    expect(
      h.feedCalls(),
    ).toHaveLength(1);

    // The failed in-flight request was cleared: a new lookup starts a new one.
    await expect(
      h.client.findSecondaryMarketDebentureByCode(
        "ABCD11",
      ),
    ).resolves.not.toBeNull();

    expect(
      h.feedCalls(),
    ).toHaveLength(2);
  });

  it("clears the in-flight slot after a success", async () => {
    const h = createHarness({
      token: [tokenResponse()],

      feed: [
        feedResponse("ABCD11"),

        feedResponse("ABCD11"),
      ],
    });

    await Promise.all([
      h.client.findSecondaryMarketDebentureByCode(
        "ABCD11",
      ),

      h.client.findSecondaryMarketDebentureByCode(
        "ABCD11",
      ),
    ]);

    await h.clock.advance(TTL_MS);

    await h.client.findSecondaryMarketDebentureByCode(
      "ABCD11",
    );

    expect(
      h.feedCalls(),
    ).toHaveLength(2);
  });

  it("keeps matching exact (trim + uppercase) and never fuzzy on the cached feed", async () => {
    const h = createHarness({
      token: [tokenResponse()],

      feed: [
        feedResponse("ABCD11"),
      ],
    });

    expect(
      (
        await h.client.findSecondaryMarketDebentureByCode(
          "  abcd11 ",
        )
      )?.codigo_ativo,
    ).toBe("ABCD11");

    for (const near of [
      "ABCD1",
      "ABCD111",
      "BCD11",
      "ABCD12",
      "ABC",
    ]) {
      expect(
        await h.client.findSecondaryMarketDebentureByCode(
          near,
        ),
      ).toBeNull();
    }

    expect(
      await h.client.findSecondaryMarketDebentureByCode(
        "   ",
      ),
    ).toBeNull();

    expect(
      h.feedCalls(),
    ).toHaveLength(1);
  });

  it("requests the latest feed only, without a data parameter or code filter", async () => {
    const h = createHarness({
      token: [tokenResponse()],

      feed: [
        feedResponse("ABCD11"),
      ],
    });

    await h.client.findSecondaryMarketDebentureByCode(
      "ABCD11",
    );

    const [feedCall] =
      h.feedCalls();

    expect(feedCall?.url).toBe(
      "https://api.anbima.com.br/feed/precos-indices/v1/debentures/mercado-secundario",
    );
  });

  it("does not hand out a mutable cache", async () => {
    const h = createHarness({
      token: [tokenResponse()],

      feed: [
        feedResponse("ABCD11"),
      ],
    });

    const first =
      await h.client.findSecondaryMarketDebentureByCode(
        "ABCD11",
      );

    expect(
      Object.isFrozen(first),
    ).toBe(true);

    const second =
      await h.client.findSecondaryMarketDebentureByCode(
        "ABCD11",
      );

    expect(second).toBe(first);
  });

  it("rejects an invalid feed TTL and an invalid rate limit configuration", () => {
    for (const feedCacheTtlMs of [
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(() =>
        createHarness(
          {},
          {
            feedCacheTtlMs,
          },
        ),
      ).toThrowError(
        expect.objectContaining({
          code: "INVALID_CONFIGURATION",
        }),
      );
    }

    for (const rateLimit of [
      {
        maxRequests: 0,
      },
      {
        maxRequests: 1.5,
      },
      {
        intervalMs: 0,
      },
      {
        intervalMs: -1,
      },
    ]) {
      expect(() =>
        createHarness(
          {},
          {
            rateLimit,
          },
        ),
      ).toThrowError(
        expect.objectContaining({
          code: "INVALID_CONFIGURATION",
        }),
      );
    }
  });

  it("never touches the real network", async () => {
    const h = createHarness({
      token: [tokenResponse()],

      feed: [
        feedResponse("ABCD11"),
      ],
    });

    await h.client.findSecondaryMarketDebentureByCode(
      "ABCD11",
    );

    expect(
      globalThis.fetch,
    ).not.toHaveBeenCalled();
  });
});

describe("AnbimaHttpClient outbound rate limiting", () => {
  beforeEach(() => {
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

  it("sends the token request and the feed request through the same limiter", async () => {
    const h = createHarness(
      {
        token: [tokenResponse()],

        feed: [
          feedResponse("ABCD11"),
        ],
      },
      {
        rateLimit: {
          maxRequests: 1,

          intervalMs: 1000,
        },
      },
    );

    const lookup =
      h.client.findSecondaryMarketDebentureByCode(
        "ABCD11",
      );

    await h.clock.flush();

    // The token used the only slot; the feed request has to wait.
    expect(
      h.tokenCalls(),
    ).toHaveLength(1);

    expect(
      h.feedCalls(),
    ).toHaveLength(0);

    await h.clock.advance(999);

    expect(
      h.feedCalls(),
    ).toHaveLength(0);

    await h.clock.advance(1);

    expect(
      h.feedCalls(),
    ).toHaveLength(1);

    await expect(
      lookup,
    ).resolves.toMatchObject({
      codigo_ativo: "ABCD11",
    });
  });

  it("limits the requests per interval and queues the rest", async () => {
    // Token and feed are two requests; a third lookup path (401 retry) later.
    const h = createHarness(
      {
        token: [
          tokenResponse(),

          tokenResponse(),
        ],

        feed: [
          jsonResponse(401, {}),

          feedResponse("ABCD11"),
        ],
      },
      {
        rateLimit: {
          maxRequests: 2,

          intervalMs: 1000,
        },
      },
    );

    const lookup =
      h.client.findSecondaryMarketDebentureByCode(
        "ABCD11",
      );

    await h.clock.flush();

    // token + feed (401) used the two slots of this window.
    expect(h.calls).toHaveLength(2);

    await h.clock.advance(999);

    expect(h.calls).toHaveLength(2);

    await h.clock.advance(1);

    // The 401 retry passed through the limiter too: new token + new feed.
    expect(h.calls).toHaveLength(4);

    await expect(
      lookup,
    ).resolves.toMatchObject({
      codigo_ativo: "ABCD11",
    });
  });

  it("still fails on a second 401 after waiting for the limiter", async () => {
    const h = createHarness(
      {
        token: [
          tokenResponse(),

          tokenResponse(),
        ],

        feed: [
          jsonResponse(401, {}),

          jsonResponse(401, {}),
        ],
      },
      {
        rateLimit: {
          maxRequests: 2,

          intervalMs: 1000,
        },
      },
    );

    const outcome = expect(
      h.client.findSecondaryMarketDebentureByCode(
        "ABCD11",
      ),
    ).rejects.toMatchObject({
      code: "FEED_REQUEST_FAILED",

      status: 401,
    });

    await h.clock.advance(1000);

    await outcome;

    expect(h.calls).toHaveLength(4);
  });

  it("serves cache hits without consulting the limiter", async () => {
    const h = createHarness(
      {
        token: [tokenResponse()],

        feed: [
          feedResponse("ABCD11"),
        ],
      },
      {
        rateLimit: {
          maxRequests: 2,

          intervalMs: 1000,
        },
      },
    );

    await h.client.findSecondaryMarketDebentureByCode(
      "ABCD11",
    );

    // The window is full (token + feed). Cache hits must not wait for it.
    for (let i = 0; i < 20; i += 1) {
      await expect(
        h.client.findSecondaryMarketDebentureByCode(
          "ABCD11",
        ),
      ).resolves.not.toBeNull();
    }

    expect(h.calls).toHaveLength(2);

    expect(
      h.clock.pendingTimers,
    ).toBe(0);
  });

  it("does not block the limiter forever after a failed request", async () => {
    const h = createHarness(
      {
        token: [tokenResponse()],

        feed: [
          new Error("boom"),

          feedResponse("ABCD11"),
        ],
      },
      {
        rateLimit: {
          maxRequests: 1,

          intervalMs: 1000,
        },
      },
    );

    const first = expect(
      h.client.findSecondaryMarketDebentureByCode(
        "ABCD11",
      ),
    ).rejects.toMatchObject({
      code: "FEED_REQUEST_FAILED",
    });

    await h.clock.advance(1000);

    await first;

    const second =
      h.client.findSecondaryMarketDebentureByCode(
        "ABCD11",
      );

    await h.clock.advance(1000);

    await expect(
      second,
    ).resolves.toMatchObject({
      codigo_ativo: "ABCD11",
    });
  });

  it("makes simultaneous lookups share one token request and one feed request while limited", async () => {
    const h = createHarness(
      {
        token: [tokenResponse()],

        feed: [
          feedResponse(
            "ABCD11",
            "XYZ123",
          ),
        ],
      },
      {
        rateLimit: {
          maxRequests: 1,

          intervalMs: 500,
        },
      },
    );

    const all = Promise.all([
      h.client.findSecondaryMarketDebentureByCode(
        "ABCD11",
      ),

      h.client.findSecondaryMarketDebentureByCode(
        "XYZ123",
      ),

      h.client.findSecondaryMarketDebentureByCode(
        "ABCD11",
      ),
    ]);

    await h.clock.advance(500);

    const records = await all;

    expect(
      records.map(
        (record) =>
          record?.codigo_ativo,
      ),
    ).toEqual([
      "ABCD11",
      "XYZ123",
      "ABCD11",
    ]);

    expect(
      h.tokenCalls(),
    ).toHaveLength(1);

    expect(
      h.feedCalls(),
    ).toHaveLength(1);
  });

  it("stays within the default 14 requests per second under sequential uncached lookups", async () => {
    const lookups = 20;

    const h = createHarness(
      {
        token: [tokenResponse()],

        feed: Array.from(
          { length: lookups },
          () =>
            feedResponse("ABCD11"),
        ),
      },
      {
        feedCacheTtlMs: 0,
      },
    );

    const run = (async () => {
      for (
        let i = 0;
        i < lookups;
        i += 1
      ) {
        await h.client.findSecondaryMarketDebentureByCode(
          "ABCD11",
        );
      }
    })();

    await h.clock.advance(5000);

    await run;

    // 1 token + 20 feed requests.
    expect(h.calls).toHaveLength(
      lookups + 1,
    );

    for (const call of h.calls) {
      const inWindow =
        h.calls.filter(
          (other) =>
            other.at >= call.at &&
            other.at <
              call.at + 1000,
        );

      expect(
        inWindow.length,
      ).toBeLessThanOrEqual(14);
    }

    // The limiter really delayed the overflow instead of just counting.
    const first = h.calls[0]?.at ?? 0;

    const last =
      h.calls[h.calls.length - 1]
        ?.at ?? 0;

    expect(
      last - first,
    ).toBeGreaterThanOrEqual(1000);
  });
});

describe("AnbimaHttpClient error safety with cache and rate limiting", () => {
  it("never leaks secrets, tokens or the Basic payload in any error", async () => {
    const basic = btoa(
      `${CLIENT_ID}:${CLIENT_SECRET}`,
    );

    const leaky = new Error(
      `${CLIENT_SECRET} ${ACCESS_TOKEN} Basic ${basic}`,
    );

    const scenarios: Array<{
      scripted: {
        token?: Scripted[];

        feed?: Scripted[];
      };

      overrides?: Partial<AnbimaHttpClientConfig>;
    }> = [
      {
        scripted: {
          token: [leaky],
        },
      },
      {
        scripted: {
          token: [tokenResponse()],

          feed: [leaky],
        },
      },
      {
        scripted: {
          token: [tokenResponse()],

          feed: [
            jsonResponse(500, {
              secret:
                CLIENT_SECRET,
            }),
          ],
        },
      },
      {
        scripted: {
          token: [tokenResponse()],

          feed: [
            jsonResponse(200, {
              access_token:
                ACCESS_TOKEN,
            }),
          ],
        },
      },
    ];

    for (const scenario of scenarios) {
      const h = createHarness(
        scenario.scripted,
        scenario.overrides,
      );

      let caught: unknown;

      try {
        await h.client.findSecondaryMarketDebentureByCode(
          "ABCD11",
        );
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(
        AnbimaHttpError,
      );

      const text = JSON.stringify([
        (caught as Error).message,

        (caught as Error).stack,

        (caught as { cause?: unknown })
          .cause,
      ]);

      for (const secret of [
        CLIENT_SECRET,
        ACCESS_TOKEN,
        basic,
      ]) {
        expect(text).not.toContain(
          secret,
        );
      }
    }
  });

  it("uses fixed configuration messages that carry no credential", () => {
    let message = "";

    try {
      createHarness(
        {},
        {
          rateLimit: {
            maxRequests: 0,
          },
        },
      );
    } catch (error) {
      message = (error as Error)
        .message;
    }

    expect(message).not.toBe("");

    for (const secret of [
      CLIENT_ID,
      CLIENT_SECRET,
    ]) {
      expect(message).not.toContain(
        secret,
      );
    }
  });
});
