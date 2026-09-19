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
 * Offline integration of resolveAsset with the REAL server composition
 * (getServerAie -> createAieFromEnv -> engine). Only the global fetch is
 * replaced by a fake, so no real network request is possible.
 */

const CLIENT_ID =
  "sentinel-integration-id";

const CLIENT_SECRET =
  "sentinel-integration-secret";

const ACCESS_TOKEN =
  "sentinel-integration-token";

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
): ReturnType<typeof vi.fn> {
  const fake = vi.fn(
    async (url: string) => {
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
  );

  vi.stubGlobal("fetch", fake);

  return fake;
}

async function loadUseCase() {
  vi.resetModules();

  return import("./resolve-asset");
}

describe(
  "resolveAsset (real server composition, offline)",
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
      "returns a normal unresolved result and contacts nothing when ANBIMA is disabled",
      async () => {
        stubAnbimaEnv({});

        const fetchFake =
          stubFetch();

        const { resolveAsset } =
          await loadUseCase();

        const result =
          await resolveAsset(
            createCandidate(),
          );

        expect(
          result.status,
        ).toBe(
          "needs-more-evidence",
        );

        expect(
          result.verifiedAsset,
        ).toBeNull();

        expect(
          result.investigation
            .searches,
        ).toEqual([]);

        expect(
          fetchFake,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "resolves through ANBIMA without verifying the issuer and without leaking credentials",
      async () => {
        stubAnbimaEnv({
          id: CLIENT_ID,

          secret: CLIENT_SECRET,
        });

        const fetchFake =
          stubFetch();

        const { resolveAsset } =
          await loadUseCase();

        const result =
          await resolveAsset(
            createCandidate(),
          );

        expect(
          result.investigation
            .searches.map(
              (search) => [
                search.providerId,
                search.status,
              ],
            ),
        ).toEqual([
          [
            "ANBIMA",
            "success",
          ],
        ]);

        expect(
          result.investigation
            .evidence.map(
              (item) => [
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
          result.verifiedAsset,
        ).toBeNull();

        expect(
          result.investigation
            .unresolvedFields,
        ).toEqual([
          "issuer",
        ]);

        expect(
          fetchFake,
        ).toHaveBeenCalledTimes(2);

        const serialized =
          JSON.stringify(result);

        for (const secret of [
          CLIENT_ID,
          CLIENT_SECRET,
          ACCESS_TOKEN,
          btoa(
            `${CLIENT_ID}:${CLIENT_SECRET}`,
          ),
        ]) {
          expect(
            serialized,
          ).not.toContain(secret);
        }
      },
    );

    it(
      "returns provider failures inside the InvestigationCase instead of throwing",
      async () => {
        stubAnbimaEnv({
          id: CLIENT_ID,

          secret: CLIENT_SECRET,
        });

        stubFetch(500);

        const { resolveAsset } =
          await loadUseCase();

        const result =
          await resolveAsset(
            createCandidate(),
          );

        expect(
          result.status,
        ).toBe(
          "needs-more-evidence",
        );

        const [search] =
          result.investigation
            .searches;

        expect(
          search?.providerId,
        ).toBe("ANBIMA");

        expect(
          search?.status,
        ).toBe("failed");

        expect(
          JSON.stringify(result),
        ).not.toContain(
          CLIENT_SECRET,
        );

        expect(
          JSON.stringify(result),
        ).not.toContain(
          ACCESS_TOKEN,
        );
      },
    );

    it(
      "fails with a safe configuration error for incomplete credentials",
      async () => {
        stubAnbimaEnv({
          id: CLIENT_ID,
        });

        stubFetch();

        const {
          AieServerError,
          resolveAsset,
        } = await loadUseCase();

        let caught: unknown;

        try {
          await resolveAsset(
            createCandidate(),
          );
        } catch (error) {
          caught = error;
        }

        expect(
          caught,
        ).toBeInstanceOf(
          AieServerError,
        );

        expect(
          caught,
        ).toMatchObject({
          kind: "configuration",
        });

        const message = (
          caught as Error
        ).message;

        expect(
          message,
        ).not.toContain(CLIENT_ID);

        expect(
          message,
        ).not.toContain(
          "ANBIMA_",
        );
      },
    );

    it(
      "fails with a safe configuration error for an invalid environment",
      async () => {
        stubAnbimaEnv({
          id: CLIENT_ID,

          secret: CLIENT_SECRET,

          environment: "staging",
        });

        stubFetch();

        const { resolveAsset } =
          await loadUseCase();

        let caught: unknown;

        try {
          await resolveAsset(
            createCandidate(),
          );
        } catch (error) {
          caught = error;
        }

        expect(
          caught,
        ).toMatchObject({
          name: "AieServerError",

          kind: "configuration",
        });

        const message = (
          caught as Error
        ).message;

        expect(
          message,
        ).not.toContain(CLIENT_ID);

        expect(
          message,
        ).not.toContain(
          CLIENT_SECRET,
        );
      },
    );
  },
);
