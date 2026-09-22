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
 * Offline integration of the batch service with the REAL server composition
 * (resolveAssets -> acquireServerAie -> getServerAie -> engine). Only the global
 * fetch is replaced by a fake, so no real network request is possible.
 */

const CLIENT_ID =
  "sentinel-batch-id";

const CLIENT_SECRET =
  "sentinel-batch-secret";

const ACCESS_TOKEN =
  "sentinel-batch-token";

interface FetchCall {
  url: string;
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
    vi.fn(async (url: string) => {
      calls.push({
        url,
      });

      const isToken = url.endsWith(
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
    }),
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

async function load() {
  vi.resetModules();

  return import("./resolve-assets");
}

describe(
  "resolveAssets (real server composition, offline)",
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
      "resolves several assets in order, sharing one token, without verifying the issuer or leaking credentials",
      async () => {
        stubAnbimaEnv({
          id: CLIENT_ID,

          secret: CLIENT_SECRET,
        });

        const calls = stubFetch();

        const { resolveAssets } =
          await load();

        const batch =
          await resolveAssets([
            debenture("A", "ABCD11"),
            stock("B"),
            debenture("C", "EFGH22"),
          ]);

        expect(
          batch.items.map(
            (item) => [
              item.index,
              item.candidateAssetId,
              item.ok,
            ],
          ),
        ).toEqual([
          [0, "A", true],
          [1, "B", true],
          [2, "C", true],
        ]);

        const searches = batch.items.map(
          (item) =>
            item.ok
              ? item.result
                  .investigation
                  .searches.map(
                    (search) =>
                      search.providerId,
                  )
              : null,
        );

        expect(searches).toEqual([
          ["ANBIMA"],
          [],
          ["ANBIMA"],
        ]);

        for (const item of batch.items) {
          expect(item.ok).toBe(true);

          if (item.ok) {
            expect(
              item.result.status,
            ).toBe(
              "needs-more-evidence",
            );

            expect(
              item.result
                .verifiedAsset,
            ).toBeNull();
          }
        }

        const [first, , third] =
          batch.items;

        expect(
          first?.ok &&
            first.result
              .investigation
              .evidence.map(
                (evidence) => [
                  evidence.field,
                  evidence.strength,
                  evidence.value,
                ],
              ),
        ).toEqual([
          [
            "identity",
            "primary",
            "ABCD11",
          ],
          [
            "issuer",
            "supporting",
            "Petrobras",
          ],
        ]);

        expect(
          third?.ok &&
            third.result
              .investigation
              .evidence[0]?.value,
        ).toBe("EFGH22");

        // One shared token request and, since TASK-015, ONE feed request for
        // the whole batch (the feed is cached; each code is matched locally).
        expect(
          calls.filter((call) =>
            call.url.endsWith(
              "/oauth/access-token",
            ),
          ),
        ).toHaveLength(1);

        expect(
          calls.filter(
            (call) =>
              !call.url.endsWith(
                "/oauth/access-token",
              ),
          ),
        ).toHaveLength(1);

        const serialized =
          JSON.stringify(batch);

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
      "returns normal unresolved results and contacts nothing when ANBIMA is disabled",
      async () => {
        stubAnbimaEnv({});

        const calls = stubFetch();

        const { resolveAssets } =
          await load();

        const batch =
          await resolveAssets([
            debenture("A", "ABCD11"),
            stock("B"),
          ]);

        expect(
          batch.items.map(
            (item) =>
              item.ok &&
              item.result.status,
          ),
        ).toEqual([
          "needs-more-evidence",
          "needs-more-evidence",
        ]);

        expect(calls).toHaveLength(0);
      },
    );

    it(
      "keeps a provider failure inside the InvestigationCase as a normal item result",
      async () => {
        stubAnbimaEnv({
          id: CLIENT_ID,

          secret: CLIENT_SECRET,
        });

        stubFetch(500);

        const { resolveAssets } =
          await load();

        const batch =
          await resolveAssets([
            debenture("A", "ABCD11"),
            stock("B"),
          ]);

        expect(
          batch.items.map(
            (item) => item.ok,
          ),
        ).toEqual([true, true]);

        const [first] = batch.items;

        expect(
          first?.ok &&
            first.result
              .investigation
              .searches[0]?.status,
        ).toBe("failed");

        expect(
          JSON.stringify(batch),
        ).not.toContain(
          CLIENT_SECRET,
        );
      },
    );

    it(
      "reports incomplete credentials on every item without network access or leaks",
      async () => {
        stubAnbimaEnv({
          id: CLIENT_ID,
        });

        const calls = stubFetch();

        const { resolveAssets } =
          await load();

        const batch =
          await resolveAssets([
            debenture("A", "ABCD11"),
            stock("B"),
            debenture("C", "EFGH22"),
          ]);

        expect(
          batch.items.map(
            (item) => [
              item.candidateAssetId,
              !item.ok &&
                item.error.code,
            ],
          ),
        ).toEqual([
          [
            "A",
            "AIE_CONFIGURATION_UNAVAILABLE",
          ],
          [
            "B",
            "AIE_CONFIGURATION_UNAVAILABLE",
          ],
          [
            "C",
            "AIE_CONFIGURATION_UNAVAILABLE",
          ],
        ]);

        expect(calls).toHaveLength(0);

        const serialized =
          JSON.stringify(batch);

        expect(
          serialized,
        ).not.toContain(CLIENT_ID);

        expect(
          serialized,
        ).not.toContain("ANBIMA_");
      },
    );
  },
);
