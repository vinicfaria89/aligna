import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createAnbimaDebentureRecord,
} from "../infrastructure/anbima/fake-anbima-debenture-feed-client";

import {
  AIE_MAX_BATCH_REQUESTS_PER_MINUTE,
} from "./aie-usage";

/**
 * TASK-024, offline end-to-end integration:
 *
 *   CSV -> real route -> real authorization (fake Planejador /auth/me)
 *     -> real usage control -> real CSV adapter -> real ingestion
 *     -> real resolveAssets -> real AIE -> fake ANBIMA
 *
 * Only the global fetch is replaced, so no real network request is possible.
 */

const PLANEJADOR_URL =
  "http://localhost:8000";

const IDENTITY_URL = `${PLANEJADOR_URL}/api/v1/auth/me`;

const USER_ID =
  "3f2b1c9e-8a4d-4e6f-9b0a-1c2d3e4f5a6b";

const BEARER =
  "sentinel-csv-int-bearer";

const CLIENT_ID =
  "sentinel-csv-int-id";

const CLIENT_SECRET =
  "sentinel-csv-int-secret";

const ANBIMA_TOKEN =
  "sentinel-csv-int-anbima-token";

const URL_ =
  "http://localhost:3100/api/aie/resolve-csv";

const CSV = [
  "id,rawName,assetType,instrumentCode,amount",
  "d1,DEB PETROBRAS SERIE UNICA,debenture,ABCD11,98765.43",
  "d2,DEB VALE SERIE UNICA,debenture,EFGH22,12345.67",
].join("\n");

interface Call {
  url: string;

  body?: unknown;
}

function stubFetch(
  identity: Record<string, unknown>,
): Call[] {
  const calls: Call[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (
        url: string,
        init?: unknown,
      ) => {
        calls.push({
          url,

          body: init,
        });

        if (url === IDENTITY_URL) {
          return new Response(
            JSON.stringify(identity),
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

function who(
  entitlements?: unknown,
  role = "cliente",
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

function csvRequest(
  body: string,
  authorization: string | null = `Bearer ${BEARER}`,
): Request {
  const headers: Record<
    string,
    string
  > = {
    "content-type":
      "text/csv; charset=utf-8",
  };

  if (authorization !== null) {
    headers.authorization =
      authorization;
  }

  return new Request(URL_, {
    method: "POST",

    headers,

    body,
  });
}

function anbimaCalls(
  calls: Call[],
): Call[] {
  return calls.filter(
    (call) => call.url !== IDENTITY_URL,
  );
}

async function loadRoute() {
  vi.resetModules();

  return (
    await import(
      "../../../app/api/aie/resolve-csv/route"
    )
  ).POST;
}

describe(
  "POST /api/aie/resolve-csv (real composition, offline)",
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
      "resolves a two-debenture CSV end to end: order kept, one token, one cached feed, ANBIMA issuer only supporting, nothing leaked",
      async () => {
        const calls = stubFetch(
          who({ aie_batch: true }),
        );

        const post =
          await loadRoute();

        const response = await post(
          csvRequest(CSV),
        );

        expect(response.status).toBe(
          200,
        );

        expect(
          response.headers.get(
            "x-correlation-id",
          ),
        ).toMatch(/^[0-9a-f-]{36}$/);

        expect(
          response.headers.get(
            "cache-control",
          ),
        ).toBe("no-store");

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

              result: {
                status: string;

                verifiedAsset: unknown;

                investigation: {
                  searches: Array<{
                    providerId: string;
                  }>;

                  evidence: Array<{
                    field: string;

                    strength: string;

                    value: string;
                  }>;
                };
              };
            }>;
          };
        };

        expect(body.ok).toBe(true);

        const items =
          body.result.items;

        // CSV order preserved.
        expect(
          items.map((item) => [
            item.index,
            item.candidateAssetId,
            item.ok,
          ]),
        ).toEqual([
          [0, "d1", true],
          [1, "d2", true],
        ]);

        for (const item of items) {
          expect(
            item.result.investigation
              .searches.map(
                (search) =>
                  search.providerId,
              ),
          ).toEqual(["ANBIMA"]);

          // ANBIMA never verifies alone: the textual issuer is supporting.
          expect(
            item.result.status,
          ).toBe("needs-more-evidence");

          expect(
            item.result.verifiedAsset,
          ).toBeNull();

          expect(
            item.result.investigation.evidence.map(
              (evidence) => [
                evidence.field,
                evidence.strength,
              ],
            ),
          ).toEqual([
            ["identity", "primary"],
            ["issuer", "supporting"],
          ]);
        }

        expect(
          items.map(
            (item) =>
              item.result.investigation
                .evidence[0]?.value,
          ),
        ).toEqual(["ABCD11", "EFGH22"]);

        // One identity check, then ONE ANBIMA token and ONE feed request.
        expect(
          calls.filter(
            (call) =>
              call.url ===
              IDENTITY_URL,
          ),
        ).toHaveLength(1);

        expect(
          anbimaCalls(calls).filter(
            (call) =>
              call.url.endsWith(
                "/oauth/access-token",
              ),
          ),
        ).toHaveLength(1);

        expect(
          anbimaCalls(calls).filter(
            (call) =>
              !call.url.endsWith(
                "/oauth/access-token",
              ),
          ),
        ).toHaveLength(1);

        // The customer's CSV values never travel to ANBIMA.
        const outbound = JSON.stringify(
          anbimaCalls(calls),
        );

        for (const leaked of [
          "98765.43",
          "12345.67",
          "DEB PETROBRAS",
          "DEB VALE",
          BEARER,
          USER_ID,
        ]) {
          expect(outbound).not.toContain(
            leaked,
          );
        }

        // And no credential or token reaches the response.
        for (const secret of [
          BEARER,
          CLIENT_ID,
          CLIENT_SECRET,
          ANBIMA_TOKEN,
          btoa(
            `${CLIENT_ID}:${CLIENT_SECRET}`,
          ),
          USER_ID,
          "aie_batch",
        ]) {
          expect(text).not.toContain(
            secret,
          );
        }
      },
    );

    it(
      "a header-only CSV answers 200 with no items and no ANBIMA traffic",
      async () => {
        const calls = stubFetch(
          who({ aie_batch: true }),
        );

        const post =
          await loadRoute();

        const response = await post(
          csvRequest("id,rawName\n"),
        );

        expect(response.status).toBe(
          200,
        );

        expect(
          (
            (await response.json()) as {
              result: {
                items: unknown[];
              };
            }
          ).result.items,
        ).toEqual([]);

        expect(
          anbimaCalls(calls),
        ).toHaveLength(0);
      },
    );

    it(
      "an invalid CSV answers 400 after authentication and makes no ANBIMA request",
      async () => {
        const calls = stubFetch(
          who({ aie_batch: true }),
        );

        const post =
          await loadRoute();

        const response = await post(
          csvRequest(
            "id,rawName,cpf\nd1,DEB,12345678909\n",
          ),
        );

        expect(response.status).toBe(
          400,
        );

        const text =
          await response.text();

        expect(
          JSON.parse(text).error.code,
        ).toBe("INVALID_PORTFOLIO_CSV");

        expect(text).not.toContain(
          "12345678909",
        );

        expect(
          anbimaCalls(calls),
        ).toHaveLength(0);
      },
    );

    it(
      "batch entitlement false: 403, the CSV body is never read, and no ANBIMA traffic",
      async () => {
        for (const identity of [
          who({ aie_batch: false }),
          who({}),
          who(),
        ]) {
          const calls =
            stubFetch(identity);

          const post =
            await loadRoute();

          const request =
            csvRequest(CSV);

          const response =
            await post(request);

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
            request.bodyUsed,
          ).toBe(false);

          expect(
            calls,
          ).toHaveLength(1);

          expect(
            anbimaCalls(calls),
          ).toHaveLength(0);

          vi.unstubAllGlobals();
        }
      },
    );

    it(
      "a malformed entitlement fails closed with 500 before the body is read",
      async () => {
        for (const entitlements of [
          { aie_batch: "true" },
          null,
          [],
        ]) {
          const calls = stubFetch(
            who(entitlements),
          );

          const post =
            await loadRoute();

          const request =
            csvRequest(CSV);

          const response =
            await post(request);

          expect(
            response.status,
          ).toBe(500);

          expect(
            (
              (await response.json()) as {
                error: {
                  code: string;
                };
              }
            ).error.code,
          ).toBe(
            "AIE_AUTHORIZATION_ERROR",
          );

          expect(
            request.bodyUsed,
          ).toBe(false);

          expect(
            anbimaCalls(calls),
          ).toHaveLength(0);

          vi.unstubAllGlobals();
        }
      },
    );

    it(
      "no bearer: 401 without any network request and without reading the body",
      async () => {
        const calls = stubFetch(
          who({ aie_batch: true }),
        );

        const post =
          await loadRoute();

        const request = csvRequest(
          CSV,
          null,
        );

        const response =
          await post(request);

        expect(response.status).toBe(
          401,
        );

        expect(
          request.bodyUsed,
        ).toBe(false);

        expect(calls).toHaveLength(0);
      },
    );

    it(
      "rate limit: five CSV requests per minute, the sixth is 429, its body unread and no more ANBIMA traffic",
      async () => {
        const calls = stubFetch(
          who({ aie_batch: true }),
        );

        const post =
          await loadRoute();

        const limit =
          AIE_MAX_BATCH_REQUESTS_PER_MINUTE;

        for (
          let i = 0;
          i < limit;
          i += 1
        ) {
          expect(
            (
              await post(
                csvRequest(CSV),
              )
            ).status,
          ).toBe(200);
        }

        const anbimaBefore =
          anbimaCalls(calls).length;

        const request =
          csvRequest(CSV);

        const limited =
          await post(request);

        expect(limited.status).toBe(
          429,
        );

        expect(
          limited.headers.get(
            "retry-after",
          ),
        ).toMatch(/^\d+$/);

        expect(
          request.bodyUsed,
        ).toBe(false);

        expect(
          anbimaCalls(calls).length,
        ).toBe(anbimaBefore);

        const text =
          await limited.text();

        for (const leaked of [
          USER_ID,
          BEARER,
          ANBIMA_TOKEN,
          "d1",
        ]) {
          expect(text).not.toContain(
            leaked,
          );
        }
      },
    );
  },
);
