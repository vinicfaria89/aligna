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
 * Offline integration of the batch Route Handler with the REAL server
 * composition (route -> HTTP mapping -> resolveAssets -> getServerAie ->
 * engine). Only the global fetch is replaced by a fake, so no real network
 * request is possible.
 */

// Authorization is covered by request-authorization.test.ts. The rest of the
// chain (route, mapping, use case, composition) stays real.
vi.mock(
  "./request-authorization",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("./request-authorization")
      >();

    return {
      ...actual,

      getAieRequestAuthorizer: () => ({
        authorize: async () => ({
          authorized: true as const,

          principal: {
            subject: "test-subject",
          },
        }),
      }),
    };
  },
);

const CLIENT_ID =
  "sentinel-batch-api-id";

const CLIENT_SECRET =
  "sentinel-batch-api-secret";

const ACCESS_TOKEN =
  "sentinel-batch-api-token";

const URL_ =
  "http://localhost/api/aie/resolve-assets";

interface FetchCall {
  url: string;

  init: unknown;
}

interface BatchBody {
  ok: boolean;

  result?: {
    items: Array<{
      index: number;

      candidateAssetId: string;

      ok: boolean;

      result?: {
        status: string;

        verifiedAsset: unknown;

        investigation: {
          searches: Array<{
            providerId: string;

            status: string;
          }>;

          evidence: Array<{
            field: string;

            strength: string;

            value: string;
          }>;
        };
      };

      error?: {
        code: string;
      };
    }>;
  };

  error?: {
    code: string;
  };
}

function stubAnbimaEnv(values: {
  id?: string;

  secret?: string;

  environment?: string;
}): void {
  vi.stubEnv(
    "ANBIMA_CLIENT_ID",
    values.id,
  );

  vi.stubEnv(
    "ANBIMA_CLIENT_SECRET",
    values.secret,
  );

  vi.stubEnv(
    "ANBIMA_ENVIRONMENT",
    values.environment,
  );
}

function stubFetch(
  feedStatus = 200,
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

        const isToken =
          url.endsWith(
            "/oauth/access-token",
          );

        const status = isToken
          ? 200
          : feedStatus;

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
              createAnbimaDebentureRecord(
                {
                  codigo_ativo:
                    "EFGH22",

                  emissor: "Vale",
                },
              ),
            ];

        return {
          ok:
            status >= 200 &&
            status < 300,

          status,

          json: async () => body,
        };
      },
    ),
  );

  return calls;
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

function stock(
  id: string,
): CandidateAsset {
  return {
    id,

    rawName: `STOCK ${id}`,

    source: {},

    hints: {
      assetType: "stock",

      ticker: "PETR4",
    },
  };
}

function post(
  body: unknown,
): Request {
  return new Request(URL_, {
    method: "POST",

    headers: {
      "content-type":
        "application/json",
    },

    body: JSON.stringify(body),
  });
}

async function loadRoute() {
  vi.resetModules();

  return import(
    "../../../app/api/aie/resolve-assets/route"
  );
}

function tokenCalls(
  calls: FetchCall[],
): FetchCall[] {
  return calls.filter((call) =>
    call.url.endsWith(
      "/oauth/access-token",
    ),
  );
}

function feedCalls(
  calls: FetchCall[],
): FetchCall[] {
  return calls.filter(
    (call) =>
      !call.url.endsWith(
        "/oauth/access-token",
      ),
  );
}

const SECRETS = [
  CLIENT_ID,
  CLIENT_SECRET,
  ACCESS_TOKEN,
  btoa(
    `${CLIENT_ID}:${CLIENT_SECRET}`,
  ),
];

describe(
  "POST /api/aie/resolve-assets (real server composition, offline)",
  () => {
    beforeEach(() => {
      vi.resetModules();
    });

    afterEach(() => {
      vi.unstubAllEnvs();

      vi.unstubAllGlobals();

      vi.resetModules();
    });

    it(
      "resolves a batch in order, reusing the token and the feed, without leaking credentials",
      async () => {
        stubAnbimaEnv({
          id: CLIENT_ID,

          secret: CLIENT_SECRET,
        });

        const calls = stubFetch();

        const { POST } =
          await loadRoute();

        const response =
          await POST(
            post({
              assets: [
                debenture(
                  "A",
                  "ABCD11",
                ),
                stock("B"),
                debenture(
                  "C",
                  "EFGH22",
                ),
                debenture(
                  "D",
                  "ABCD11",
                ),
              ],

              options: {
                concurrency: 2,
              },
            }),
          );

        expect(
          response.status,
        ).toBe(200);

        expect(
          response.headers.get(
            "cache-control",
          ),
        ).toBe("no-store");

        const text =
          await response.text();

        const body = JSON.parse(
          text,
        ) as BatchBody;

        expect(body.ok).toBe(true);

        const items =
          body.result?.items ?? [];

        expect(
          items.map((item) => [
            item.index,
            item.candidateAssetId,
            item.ok,
          ]),
        ).toEqual([
          [0, "A", true],
          [1, "B", true],
          [2, "C", true],
          [3, "D", true],
        ]);

        expect(
          items.map((item) =>
            item.result?.investigation.searches.map(
              (search) =>
                search.providerId,
            ),
          ),
        ).toEqual([
          ["ANBIMA"],
          [],
          ["ANBIMA"],
          ["ANBIMA"],
        ]);

        // ANBIMA alone never verifies (issuer is only supporting evidence).
        for (const item of items) {
          expect(
            item.result?.status,
          ).toBe(
            "needs-more-evidence",
          );

          expect(
            item.result
              ?.verifiedAsset,
          ).toBeNull();
        }

        expect(
          items[2]?.result
            ?.investigation
            .evidence[0]?.value,
        ).toBe("EFGH22");

        // One token and one feed request for the whole batch.
        expect(
          tokenCalls(calls),
        ).toHaveLength(1);

        expect(
          feedCalls(calls),
        ).toHaveLength(1);

        for (const secret of SECRETS) {
          expect(text).not.toContain(
            secret,
          );
        }
      },
    );

    it(
      "keeps reusing token and feed across requests handled by the same server",
      async () => {
        stubAnbimaEnv({
          id: CLIENT_ID,

          secret: CLIENT_SECRET,
        });

        const calls = stubFetch();

        const { POST } =
          await loadRoute();

        for (const code of [
          "ABCD11",
          "EFGH22",
        ]) {
          const response =
            await POST(
              post({
                assets: [
                  debenture(
                    "A",
                    code,
                  ),
                ],
              }),
            );

          expect(
            response.status,
          ).toBe(200);
        }

        expect(
          tokenCalls(calls),
        ).toHaveLength(1);

        expect(
          feedCalls(calls),
        ).toHaveLength(1);
      },
    );

    it(
      "returns 200 with normal unresolved results and contacts nothing when ANBIMA is disabled",
      async () => {
        stubAnbimaEnv({});

        const calls = stubFetch();

        const { POST } =
          await loadRoute();

        const response =
          await POST(
            post({
              assets: [
                debenture(
                  "A",
                  "ABCD11",
                ),
                stock("B"),
              ],
            }),
          );

        expect(
          response.status,
        ).toBe(200);

        const body =
          (await response.json()) as BatchBody;

        expect(
          body.result?.items.map(
            (item) =>
              item.result?.status,
          ),
        ).toEqual([
          "needs-more-evidence",
          "needs-more-evidence",
        ]);

        expect(calls).toHaveLength(0);
      },
    );

    it(
      "keeps a provider failure inside the InvestigationCase (HTTP 200)",
      async () => {
        stubAnbimaEnv({
          id: CLIENT_ID,

          secret: CLIENT_SECRET,
        });

        stubFetch(500);

        const { POST } =
          await loadRoute();

        const response =
          await POST(
            post({
              assets: [
                debenture(
                  "A",
                  "ABCD11",
                ),
                stock("B"),
              ],
            }),
          );

        expect(
          response.status,
        ).toBe(200);

        const text =
          await response.text();

        const body = JSON.parse(
          text,
        ) as BatchBody;

        expect(
          body.result?.items[0]
            ?.result?.investigation
            .searches[0]?.status,
        ).toBe("failed");

        expect(
          body.result?.items.map(
            (item) => item.ok,
          ),
        ).toEqual([true, true]);

        for (const secret of SECRETS) {
          expect(text).not.toContain(
            secret,
          );
        }
      },
    );

    it(
      "reports incomplete credentials per item with HTTP 200, no network and no leak",
      async () => {
        stubAnbimaEnv({
          id: CLIENT_ID,
        });

        const calls = stubFetch();

        const { POST } =
          await loadRoute();

        const response =
          await POST(
            post({
              assets: [
                debenture(
                  "A",
                  "ABCD11",
                ),
                stock("B"),
              ],
            }),
          );

        expect(
          response.status,
        ).toBe(200);

        const text =
          await response.text();

        const body = JSON.parse(
          text,
        ) as BatchBody;

        expect(
          body.result?.items.map(
            (item) => [
              item.ok,
              item.error?.code,
            ],
          ),
        ).toEqual([
          [
            false,
            "AIE_CONFIGURATION_UNAVAILABLE",
          ],
          [
            false,
            "AIE_CONFIGURATION_UNAVAILABLE",
          ],
        ]);

        expect(calls).toHaveLength(0);

        expect(text).not.toContain(
          CLIENT_ID,
        );

        expect(text).not.toContain(
          "ANBIMA_",
        );
      },
    );

    it(
      "rejects an invalid request without touching the engine or the network",
      async () => {
        stubAnbimaEnv({
          id: CLIENT_ID,

          secret: CLIENT_SECRET,
        });

        const calls = stubFetch();

        const { POST } =
          await loadRoute();

        const response =
          await POST(
            post({
              assets: [
                debenture(
                  "A",
                  "ABCD11",
                ),
                {
                  id: "B",
                },
              ],
            }),
          );

        expect(
          response.status,
        ).toBe(400);

        expect(calls).toHaveLength(0);
      },
    );
  },
);
