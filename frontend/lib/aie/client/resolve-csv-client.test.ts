import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  RESOLVE_CSV_PATH,
  submitPortfolioCsv,
  toItemViews,
} from "./resolve-csv-client";

import type {
  SubmitPortfolioCsvInput,
} from "./resolve-csv-client";

/** TASK-025: the browser client maps the server's answer to explicit outcomes. */
const TOKEN =
  "sentinel-client-bearer-token";

const FILE_ID = "f0123456789abcdef";

const CSV_TEXT =
  "rawName\nSENTINEL-CSV-CONTENT\n";

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(
    JSON.stringify(body),
    {
      status,

      headers: {
        "x-correlation-id": "corr-77",

        ...headers,
      },
    },
  );
}

function run(
  respond: () => Response | Promise<Response>,
  overrides: Partial<SubmitPortfolioCsvInput> = {},
) {
  const calls: Array<{
    url: string;

    init: Parameters<
      NonNullable<
        SubmitPortfolioCsvInput["fetchImpl"]
      >
    >[1];
  }> = [];

  const promise = submitPortfolioCsv({
    csvText: CSV_TEXT,

    fileId: FILE_ID,

    getSession: async () => ({
      status: "ok" as const,

      accessToken: TOKEN,
    }),

    fetchImpl: async (url, init) => {
      calls.push({ url, init });

      return respond();
    },

    ...overrides,
  });

  return { promise, calls };
}

function item(
  index: number,
  status: string,
  extra: Record<string, unknown> = {},
) {
  return {
    index,

    candidateAssetId: `id-${index}`,

    ok: true,

    result: {
      status,

      investigation: {
        evidence: [],

        searches: [],

        unresolvedFields: [],

        candidateAsset: {
          rawName: "echoed",
        },
      },

      verifiedAsset: null,

      ...extra,
    },
  };
}

describe("submitPortfolioCsv", () => {
  describe("the request", () => {
    it("POSTs the raw CSV as text/csv with the bearer, credentials omitted and no caching", async () => {
      const { promise, calls } = run(
        () =>
          json({
            ok: true,

            result: { items: [] },
          }),
      );

      await promise;

      expect(calls).toHaveLength(1);

      const [call] = calls;

      expect(call?.init.method).toBe(
        "POST",
      );

      expect(
        call?.init.headers,
      ).toEqual({
        "Content-Type":
          "text/csv; charset=utf-8",

        Authorization: `Bearer ${TOKEN}`,
      });

      expect(call?.init.body).toBe(
        CSV_TEXT,
      );

      expect(
        call?.init.credentials,
      ).toBe("omit");

      expect(call?.init.cache).toBe(
        "no-store",
      );
    });

    it("keeps the token and the CSV out of the URL: only the opaque upload id is in it", async () => {
      const { promise, calls } = run(
        () =>
          json({
            ok: true,

            result: { items: [] },
          }),
      );

      await promise;

      expect(calls[0]?.url).toBe(
        `${RESOLVE_CSV_PATH}?fileId=${FILE_ID}`,
      );

      for (const leaked of [
        TOKEN,
        "SENTINEL-CSV-CONTENT",
        "rawName",
        "Bearer",
      ]) {
        expect(calls[0]?.url).not.toContain(
          leaked,
        );
      }
    });

    it("sends nothing when there is no stored session", async () => {
      const clearSession = vi.fn();

      const { promise, calls } = run(
        () => json({}),
        {
          getSession: async () => ({
            status: "none",
          }),

          clearSession,
        },
      );

      expect(await promise).toEqual({
        kind: "unauthenticated",

        reason: "no-session",
      });

      expect(calls).toHaveLength(0);

      // The session layer already did its own cleanup; the client never adds one.
      expect(clearSession).not.toHaveBeenCalled();
    });

    it("sends nothing when the refresh was refused (expired session)", async () => {
      const clearSession = vi.fn();

      const { promise, calls } = run(
        () => json({}),
        {
          getSession: async () => ({
            status: "expired",
          }),

          clearSession,
        },
      );

      expect(await promise).toEqual({
        kind: "unauthenticated",

        reason: "expired",
      });

      expect(calls).toHaveLength(0);

      expect(clearSession).not.toHaveBeenCalled();
    });

    it("sends nothing, and keeps the session, when the identity service is unavailable", async () => {
      const clearSession = vi.fn();

      for (const getSession of [
        async () => ({
          status: "unavailable" as const,
        }),
        async () => ({
          status: "ok" as const,

          accessToken: "",
        }),
        async (): Promise<never> => {
          throw new Error(
            "storage blocked",
          );
        },
      ]) {
        const { promise, calls } = run(
          () => json({}),
          { getSession, clearSession },
        );

        expect(await promise).toEqual({
          kind: "session-unavailable",
        });

        expect(calls).toHaveLength(0);
      }

      expect(clearSession).not.toHaveBeenCalled();
    });

    it("asks the session once per submission and sends the token it returned", async () => {
      const getSession = vi.fn(
        async () => ({
          status: "ok" as const,

          accessToken: "fresh-token-2",
        }),
      );

      const { promise, calls } = run(
        () =>
          json({
            ok: true,

            result: { items: [] },
          }),
        { getSession },
      );

      await promise;

      expect(getSession).toHaveBeenCalledTimes(
        1,
      );

      expect(calls).toHaveLength(1);

      expect(
        calls[0]?.init.headers
          .Authorization,
      ).toBe("Bearer fresh-token-2");
    });

    it("refuses an upload id that is not the opaque format, without sending", async () => {
      const { promise, calls } = run(
        () => json({}),
        {
          fileId: "bad id/../?x=1",
        },
      );

      expect(await promise).toMatchObject({
        kind: "validation-error",
      });

      expect(calls).toHaveLength(0);
    });
  });

  describe("status mapping", () => {
    it("200 with items: success, order kept, correlation id read from the header", async () => {
      const { promise } = run(() =>
        json({
          ok: true,

          result: {
            items: [
              item(0, "verified", {
                verifiedAsset: {
                  canonicalAssetId:
                    "ABCD11",

                  assetType: "debenture",

                  currency: "BRL",
                },
              }),
              item(
                1,
                "needs-more-evidence",
              ),
            ],
          },
        }),
      );

      const outcome = await promise;

      expect(outcome.kind).toBe(
        "success",
      );

      if (outcome.kind !== "success") {
        return;
      }

      expect(
        outcome.items.map(
          (view) => [
            view.index,
            view.status,
          ],
        ),
      ).toEqual([
        [0, "verified"],
        [1, "needs-more-evidence"],
      ]);

      expect(
        outcome.correlationId,
      ).toBe("corr-77");
    });

    it("400: validation error with safe issues only", async () => {
      const { promise } = run(() =>
        json(
          {
            ok: false,

            error: {
              code: "INVALID_PORTFOLIO_CSV",

              message:
                "Invalid portfolio CSV.",

              issues: [
                {
                  path: "row[3].amount",

                  code: "invalid_value",
                },
                {
                  path: 5,

                  code: "x",
                },
                "junk",
              ],
            },
          },
          400,
        ),
      );

      expect(await promise).toEqual({
        kind: "validation-error",

        issues: [
          {
            path: "row[3].amount",

            code: "invalid_value",
          },
        ],

        correlationId: "corr-77",
      });
    });

    it("400 with an unreadable body is still a validation error", async () => {
      const { promise } = run(
        () =>
          new Response("<html>", {
            status: 400,
          }),
      );

      expect(await promise).toEqual({
        kind: "validation-error",

        issues: [],
      });
    });

    const simple: Array<
      [number, string]
    > = [
      [401, "unauthenticated"],
      [403, "forbidden"],
      [413, "too-large"],
      [415, "unsupported-media"],
      [500, "server-error"],
      [502, "server-error"],
      [503, "server-error"],
      [418, "server-error"],
    ];

    for (const [status, kind] of simple) {
      it(`${status} maps to ${kind} with the correlation id`, async () => {
        const { promise } = run(() =>
          json({}, status),
        );

        expect(
          await promise,
        ).toMatchObject({
          kind,

          correlationId: "corr-77",
        });
      });
    }

    it("401 from the server is a rejected session: the session is cleared once, and there is no retry", async () => {
      const clearSession = vi.fn();

      const getSession = vi.fn(
        async () => ({
          status: "ok" as const,

          accessToken: TOKEN,
        }),
      );

      const { promise, calls } = run(
        () => json({}, 401),
        { clearSession, getSession },
      );

      expect(
        await promise,
      ).toMatchObject({
        kind: "unauthenticated",

        reason: "rejected",

        correlationId: "corr-77",
      });

      expect(clearSession).toHaveBeenCalledTimes(
        1,
      );

      // The token was issued a moment ago: asking for another one would repeat
      // the same refresh. One session call, one request, no loop.
      expect(getSession).toHaveBeenCalledTimes(
        1,
      );

      expect(calls).toHaveLength(1);
    });

    it("a 401 still ends as unauthenticated when clearing the session throws", async () => {
      const { promise } = run(
        () => json({}, 401),
        {
          clearSession: () => {
            throw new Error("storage blocked");
          },
        },
      );

      expect(
        await promise,
      ).toMatchObject({
        kind: "unauthenticated",

        reason: "rejected",
      });
    });

    it("only a 401 touches the session: 400, 403, 413, 415, 429 and 5xx neither clear it nor ask for another token", async () => {
      for (const status of [
        400, 403, 413, 415, 418, 429,
        500, 502, 503,
      ]) {
        const clearSession = vi.fn();

        const getSession = vi.fn(
          async () => ({
            status: "ok" as const,

            accessToken: TOKEN,
          }),
        );

        const { promise, calls } = run(
          () => json({}, status),
          { clearSession, getSession },
        );

        await promise;

        expect(clearSession).not.toHaveBeenCalled();

        expect(getSession).toHaveBeenCalledTimes(
          1,
        );

        expect(calls).toHaveLength(1);
      }
    });

    it("a network failure neither clears the session nor retries", async () => {
      const clearSession = vi.fn();

      const getSession = vi.fn(
        async () => ({
          status: "ok" as const,

          accessToken: TOKEN,
        }),
      );

      let attempts = 0;

      const promise = submitPortfolioCsv({
        csvText: CSV_TEXT,

        fileId: FILE_ID,

        getSession,

        clearSession,

        fetchImpl: async () => {
          attempts += 1;

          throw new TypeError(
            "Failed to fetch",
          );
        },
      });

      expect(await promise).toEqual({
        kind: "network-error",
      });

      expect(attempts).toBe(1);

      expect(clearSession).not.toHaveBeenCalled();
    });

    it("no outcome carries the token, the CSV or the Authorization header", async () => {
      const statuses = [
        200, 400, 401, 403, 413, 415, 429,
        500,
      ];

      for (const status of statuses) {
        const { promise } = run(() =>
          json(
            status === 200
              ? {
                  ok: true,

                  result: { items: [] },
                }
              : {},
            status,
          ),
        );

        const text = JSON.stringify(
          await promise,
        );

        for (const leaked of [
          TOKEN,
          "Bearer",
          "Authorization",
          "SENTINEL-CSV-CONTENT",
        ]) {
          expect(text).not.toContain(
            leaked,
          );
        }
      }
    });

    it("429 reads Retry-After in whole seconds and ignores anything else", async () => {
      const seconds = run(() =>
        json({}, 429, {
          "retry-after": "12",
        }),
      );

      expect(
        await seconds.promise,
      ).toMatchObject({
        kind: "rate-limited",

        retryAfterSeconds: 12,
      });

      for (const bad of [
        "soon",
        "-3",
        "1.5",
        "Wed, 21 Oct 2026 07:28:00 GMT",
      ]) {
        const { promise } = run(() =>
          json({}, 429, {
            "retry-after": bad,
          }),
        );

        const outcome = await promise;

        expect(outcome.kind).toBe(
          "rate-limited",
        );

        expect(
          "retryAfterSeconds" in
            outcome,
        ).toBe(false);
      }
    });

    it("a 200 that is not a valid batch answer is a server error, never a success", async () => {
      for (const body of [
        {},
        { ok: true },
        { ok: true, result: {} },
        {
          ok: true,

          result: { items: "nope" },
        },
        {
          ok: true,

          result: {
            items: [{ nothing: true }],
          },
        },
      ]) {
        const { promise } = run(() =>
          json(body),
        );

        expect(
          (await promise).kind,
        ).toBe("server-error");
      }

      const notJson = run(
        () =>
          new Response("plain text", {
            status: 200,
          }),
      );

      expect(
        (await notJson.promise).kind,
      ).toBe("server-error");
    });

    it("a network failure is its own outcome and carries no error text", async () => {
      const { promise } = run(() => {
        throw new Error(
          `connect ECONNREFUSED ${TOKEN}`,
        );
      });

      const outcome = await promise;

      expect(outcome).toEqual({
        kind: "network-error",
      });

      expect(
        JSON.stringify(outcome),
      ).not.toContain(TOKEN);
    });

    it("never puts the token, the CSV or a raw body into any outcome", async () => {
      const bodies = [
        json(
          {
            ok: false,

            error: {
              message: `leak ${TOKEN}`,
            },
          },
          500,
        ),
        json({}, 403),
        json({}, 401),
      ];

      for (const response of bodies) {
        const { promise } = run(
          () => response,
        );

        const text = JSON.stringify(
          await promise,
        );

        for (const leaked of [
          TOKEN,
          "SENTINEL-CSV-CONTENT",
          "leak",
        ]) {
          expect(text).not.toContain(
            leaked,
          );
        }
      }
    });
  });

  describe("toItemViews keeps only safe display fields", () => {
    it("copies status, unresolved fields, sources and the verified summary, and drops evidence values, metadata, errors and the echoed candidate", () => {
      const views = toItemViews([
        {
          index: 0,

          candidateAssetId: "d1",

          ok: true,

          result: {
            status:
              "needs-more-evidence",

            verifiedAsset: null,

            investigation: {
              unresolvedFields: [
                "issuer",
                42,
              ],

              evidence: [
                {
                  source: "ANBIMA",

                  value:
                    "SECRET-EVIDENCE-VALUE",

                  metadata: {
                    codigo_ativo:
                      "SECRET-METADATA",
                  },
                },
                { source: "ANBIMA" },
                { source: 7 },
              ],

              searches: [
                {
                  providerId: "ANBIMA",

                  status: "success",
                },
                {
                  providerId: "CVM",

                  status: "failed",

                  error:
                    "SECRET-PROVIDER-ERROR",
                },
              ],

              candidateAsset: {
                rawName:
                  "SECRET-RAW-NAME",
              },
            },
          },
        },
        {
          index: 1,

          candidateAssetId: "d2",

          ok: false,

          error: {
            code: "AIE_INTERNAL_ERROR",

            message: "SECRET-MESSAGE",
          },
        },
      ]);

      expect(views).toEqual([
        {
          index: 0,

          candidateAssetId: "d1",

          kind: "resolved",

          status:
            "needs-more-evidence",

          unresolvedFields: ["issuer"],

          sources: ["ANBIMA"],

          failedSources: ["CVM"],
        },
        {
          index: 1,

          candidateAssetId: "d2",

          kind: "item-error",

          unresolvedFields: [],

          sources: [],

          failedSources: [],

          itemErrorCode:
            "AIE_INTERNAL_ERROR",
        },
      ]);

      const text = JSON.stringify(views);

      for (const leaked of [
        "SECRET",
        "codigo_ativo",
      ]) {
        expect(text).not.toContain(
          leaked,
        );
      }
    });

    it("rejects malformed items as a whole", () => {
      for (const bad of [
        null,
        {},
        [null],
        [{ index: "0" }],
        [
          {
            index: 0,

            candidateAssetId: "a",

            ok: true,

            result: {},
          },
        ],
      ]) {
        expect(toItemViews(bad)).toBeNull();
      }
    });
  });
});

void vi;
