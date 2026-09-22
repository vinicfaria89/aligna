import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  AnbimaConfigurationError,
} from "../application/anbima-runtime";

import type {
  CandidateAsset,
} from "../contracts";

import type {
  AnbimaFetch,
  AnbimaFetchInit,
  AnbimaFetchResponse,
} from "../infrastructure/anbima/anbima-http-client";

import {
  createAnbimaDebentureRecord,
} from "../infrastructure/anbima/fake-anbima-debenture-feed-client";

import {
  createServerAie,
} from "./create-server-aie";

// Obviously fake, non-secret sentinels.
const CLIENT_ID =
  "sentinel-server-client-id";

const CLIENT_SECRET =
  "sentinel-server-client-secret";

const NOW =
  "2026-09-19T12:00:00.000Z";

interface RecordedCall {
  url: string;

  init: AnbimaFetchInit;
}

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

function createFakeFetch(): {
  fetchImpl: AnbimaFetch;

  calls: RecordedCall[];
} {
  const calls: RecordedCall[] =
    [];

  const fetchImpl: AnbimaFetch =
    async (url, init) => {
      calls.push({
        url,
        init,
      });

      if (
        url.endsWith(
          "/oauth/access-token",
        )
      ) {
        return jsonResponse(200, {
          access_token:
            "fake-access-token",

          token_type: "Bearer",

          expires_in: 3600,
        });
      }

      return jsonResponse(200, [
        createAnbimaDebentureRecord({
          codigo_ativo: "ABCD11",

          emissor: "Petrobras",
        }),
      ]);
    };

  return {
    fetchImpl,
    calls,
  };
}

function createCandidate(): CandidateAsset {
  return {
    id: "asset-1",

    rawName: "DEB PETROBRAS",

    source: {},

    hints: {
      assetType: "debenture",

      instrumentCode: "ABCD11",
    },
  };
}

/**
 * Sets the three ANBIMA variables explicitly (removing any that are not
 * given), so the tests never depend on the developer machine environment.
 */
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

describe(
  "createServerAie",
  () => {
    let globalFetch: ReturnType<
      typeof vi.fn
    >;

    beforeEach(() => {
      // Guard: nothing here may reach the real network.
      globalFetch = vi.fn(() => {
        throw new Error(
          "real network call attempted",
        );
      });

      vi.stubGlobal(
        "fetch",
        globalFetch,
      );
    });

    afterEach(() => {
      vi.unstubAllEnvs();

      vi.unstubAllGlobals();

      vi.resetModules();
    });

    it(
      "works with no ANBIMA credentials (ANBIMA disabled)",
      async () => {
        stubAnbimaEnv({});

        const result =
          await createServerAie()
            .resolve({
              candidateAsset:
                createCandidate(),

              now: NOW,
            });

        expect(
          result.status,
        ).toBe(
          "needs-more-evidence",
        );

        expect(
          result.investigation
            .searches,
        ).toEqual([]);

        expect(
          globalFetch,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "forwards the production configuration",
      async () => {
        stubAnbimaEnv({
          id: CLIENT_ID,

          secret: CLIENT_SECRET,
        });

        const fake =
          createFakeFetch();

        const result =
          await createServerAie({
            fetchImpl:
              fake.fetchImpl,
          }).resolve({
            candidateAsset:
              createCandidate(),

            now: NOW,
          });

        expect(
          fake.calls.map(
            (call) => call.url,
          ),
        ).toEqual([
          "https://api.anbima.com.br/oauth/access-token",

          "https://api.anbima.com.br/feed/precos-indices/v1/debentures/mercado-secundario",
        ]);

        expect(
          fake.calls[0]?.init
            .headers.Authorization,
        ).toBe(
          `Basic ${btoa(
            `${CLIENT_ID}:${CLIENT_SECRET}`,
          )}`,
        );

        expect(
          fake.calls[1]?.init
            .headers.client_id,
        ).toBe(CLIENT_ID);

        expect(
          result.investigation
            .searches.map(
              (search) =>
                search.providerId,
            ),
        ).toEqual([
          "ANBIMA",
        ]);

        expect(
          result.verifiedAsset,
        ).toBeNull();

        expect(
          result.investigation
            .unresolvedFields,
        ).toEqual([
          "issuer",
        ]);

        expect(
          globalFetch,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "forwards the sandbox configuration",
      async () => {
        stubAnbimaEnv({
          id: CLIENT_ID,

          secret: CLIENT_SECRET,

          environment: "sandbox",
        });

        const fake =
          createFakeFetch();

        await createServerAie({
          fetchImpl:
            fake.fetchImpl,
        }).resolve({
          candidateAsset:
            createCandidate(),

          now: NOW,
        });

        expect(
          fake.calls[1]?.url,
        ).toBe(
          "https://api-sandbox.anbima.com.br/feed/precos-indices/v1/debentures/mercado-secundario",
        );
      },
    );

    it(
      "fails fast on incomplete credentials",
      () => {
        stubAnbimaEnv({
          id: CLIENT_ID,
        });

        expect(
          () => createServerAie(),
        ).toThrow(
          AnbimaConfigurationError,
        );

        stubAnbimaEnv({
          secret: CLIENT_SECRET,
        });

        expect(
          () => createServerAie(),
        ).toThrow(
          AnbimaConfigurationError,
        );
      },
    );

    it(
      "fails fast on an invalid environment",
      () => {
        stubAnbimaEnv({
          id: CLIENT_ID,

          secret: CLIENT_SECRET,

          environment: "staging",
        });

        expect(
          () => createServerAie(),
        ).toThrow(
          /ANBIMA_ENVIRONMENT must be "production" or "sandbox"/,
        );
      },
    );

    it(
      "never includes credential values in thrown error messages",
      () => {
        const scenarios = [
          {
            id: CLIENT_ID,
          },
          {
            secret: CLIENT_SECRET,
          },
          {
            id: CLIENT_ID,

            secret: CLIENT_SECRET,

            environment: "staging",
          },
          {
            id: CLIENT_ID,

            secret: CLIENT_SECRET,

            environment:
              CLIENT_SECRET,
          },
        ];

        for (const scenario of scenarios) {
          stubAnbimaEnv(scenario);

          let caught: unknown;

          try {
            createServerAie();
          } catch (error) {
            caught = error;
          }

          expect(
            caught,
          ).toBeInstanceOf(
            AnbimaConfigurationError,
          );

          const message = (
            caught as AnbimaConfigurationError
          ).message;

          expect(
            message,
          ).not.toContain(CLIENT_ID);

          expect(
            message,
          ).not.toContain(
            CLIENT_SECRET,
          );
        }
      },
    );

    it(
      "performs no network call merely by constructing the server AIE",
      () => {
        stubAnbimaEnv({
          id: CLIENT_ID,

          secret: CLIENT_SECRET,
        });

        const fake =
          createFakeFetch();

        createServerAie({
          fetchImpl:
            fake.fetchImpl,
        });

        expect(
          fake.calls,
        ).toHaveLength(0);

        expect(
          globalFetch,
        ).not.toHaveBeenCalled();
      },
    );
  },
);

describe(
  "getServerAie",
  () => {
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
      vi.unstubAllEnvs();

      vi.unstubAllGlobals();

      vi.resetModules();
    });

    it(
      "returns the same engine on every call",
      async () => {
        stubAnbimaEnv({});

        vi.resetModules();

        const module = await import(
          "./create-server-aie"
        );

        expect(
          module.getServerAie(),
        ).toBe(module.getServerAie());
      },
    );

    it(
      "does not cache a failed configuration",
      async () => {
        vi.resetModules();

        const module = await import(
          "./create-server-aie"
        );

        stubAnbimaEnv({
          id: CLIENT_ID,
        });

        expect(
          () =>
            module.getServerAie(),
        ).toThrow();

        stubAnbimaEnv({
          id: CLIENT_ID,

          secret: CLIENT_SECRET,
        });

        expect(
          () =>
            module.getServerAie(),
        ).not.toThrow();
      },
    );

    it(
      "refuses to load in a browser-like environment",
      async () => {
        vi.resetModules();

        vi.stubGlobal("window", {});

        await expect(
          import(
            "./create-server-aie"
          ),
        ).rejects.toThrow(
          /must not be loaded in the browser/,
        );
      },
    );
  },
);
