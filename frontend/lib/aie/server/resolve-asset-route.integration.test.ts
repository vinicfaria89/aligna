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

/**
 * Offline integration of the Route Handler with the REAL server composition
 * (route -> HTTP mapping -> resolveAsset -> getServerAie -> engine). Only the
 * global fetch is replaced by a fake, so no real network request is possible.
 */

const CLIENT_ID =
  "sentinel-route-id";

const CLIENT_SECRET =
  "sentinel-route-secret";

const ACCESS_TOKEN =
  "sentinel-route-token";

const CUSTOMER_MARKER =
  "sentinel-customer-institution-name";

const FILE_MARKER =
  "sentinel-customer-file-name.pdf";

interface FetchCall {
  url: string;

  init: unknown;
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

function request(): Request {
  return new Request(
    "http://localhost/api/aie/resolve-asset",
    {
      method: "POST",

      headers: {
        "content-type":
          "application/json",
      },

      body: JSON.stringify({
        id: "asset-1",

        rawName: "DEB PETROBRAS",

        source: {
          institution:
            CUSTOMER_MARKER,

          fileName: FILE_MARKER,
        },

        hints: {
          assetType: "debenture",

          instrumentCode: "ABCD11",

          amount: 98765.43,
        },
      }),
    },
  );
}

async function loadRoute() {
  vi.resetModules();

  return import(
    "../../../app/api/aie/resolve-asset/route"
  );
}

describe(
  "POST /api/aie/resolve-asset (real server composition, offline)",
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
      "returns 200 needs-more-evidence when ANBIMA is disabled and contacts nothing",
      async () => {
        stubAnbimaEnv({});

        const calls = stubFetch();

        const { POST } =
          await loadRoute();

        const response =
          await POST(request());

        expect(
          response.status,
        ).toBe(200);

        const body =
          await response.json();

        expect(
          body.result.status,
        ).toBe(
          "needs-more-evidence",
        );

        expect(calls).toHaveLength(0);
      },
    );

    it(
      "returns 200 with the ANBIMA evidence chain and never exposes credentials or tokens",
      async () => {
        stubAnbimaEnv({
          id: CLIENT_ID,

          secret: CLIENT_SECRET,
        });

        const calls = stubFetch();

        const { POST } =
          await loadRoute();

        const response =
          await POST(request());

        expect(
          response.status,
        ).toBe(200);

        const text =
          await response.text();

        const body =
          JSON.parse(text);

        expect(
          body.result.investigation
            .evidence.map(
              (item: {
                field: string;

                strength: string;
              }) => [
                item.field,
                item.strength,
              ],
            ),
        ).toEqual([
          [
            "identity",
            "primary",
          ],
          [
            "issuer",
            "supporting",
          ],
        ]);

        expect(
          body.result.verifiedAsset,
        ).toBeNull();

        expect(
          body.result.investigation
            .unresolvedFields,
        ).toEqual([
          "issuer",
        ]);

        for (const secret of [
          CLIENT_ID,
          CLIENT_SECRET,
          ACCESS_TOKEN,
          btoa(
            `${CLIENT_ID}:${CLIENT_SECRET}`,
          ),
          "Authorization",
          "access_token",
        ]) {
          expect(
            text,
          ).not.toContain(secret);
        }

        expect(calls).toHaveLength(2);
      },
    );

    it(
      "sends nothing about the customer to ANBIMA",
      async () => {
        stubAnbimaEnv({
          id: CLIENT_ID,

          secret: CLIENT_SECRET,
        });

        const calls = stubFetch();

        const { POST } =
          await loadRoute();

        await POST(request());

        const outbound =
          JSON.stringify(calls);

        for (const customerData of [
          CUSTOMER_MARKER,
          FILE_MARKER,
          "98765.43",
          "DEB PETROBRAS",
        ]) {
          expect(
            outbound,
          ).not.toContain(
            customerData,
          );
        }
      },
    );

    it(
      "returns 200 when the ANBIMA feed fails, recording the failure in the InvestigationCase",
      async () => {
        stubAnbimaEnv({
          id: CLIENT_ID,

          secret: CLIENT_SECRET,
        });

        stubFetch(500);

        const { POST } =
          await loadRoute();

        const response =
          await POST(request());

        expect(
          response.status,
        ).toBe(200);

        const text =
          await response.text();

        const body =
          JSON.parse(text);

        expect(
          body.result.investigation
            .searches[0].status,
        ).toBe("failed");

        expect(
          text,
        ).not.toContain(
          CLIENT_SECRET,
        );

        expect(
          text,
        ).not.toContain(
          ACCESS_TOKEN,
        );
      },
    );

    it(
      "returns 503 with a safe body for incomplete credentials",
      async () => {
        stubAnbimaEnv({
          id: CLIENT_ID,
        });

        stubFetch();

        const { POST } =
          await loadRoute();

        const response =
          await POST(request());

        expect(
          response.status,
        ).toBe(503);

        const text =
          await response.text();

        expect(
          JSON.parse(text),
        ).toEqual({
          ok: false,

          error: {
            code:
              "AIE_CONFIGURATION_UNAVAILABLE",

            message:
              "Asset resolution is temporarily unavailable.",
          },
        });

        expect(
          text,
        ).not.toContain(CLIENT_ID);

        expect(
          text,
        ).not.toContain("ANBIMA_");
      },
    );

    it(
      "returns 503 with a safe body for an invalid environment",
      async () => {
        stubAnbimaEnv({
          id: CLIENT_ID,

          secret: CLIENT_SECRET,

          environment: "staging",
        });

        stubFetch();

        const { POST } =
          await loadRoute();

        const response =
          await POST(request());

        expect(
          response.status,
        ).toBe(503);

        const text =
          await response.text();

        expect(
          text,
        ).not.toContain(
          CLIENT_SECRET,
        );

        expect(
          text,
        ).not.toContain("staging");
      },
    );
  },
);
