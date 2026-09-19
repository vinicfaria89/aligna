import {
  readFileSync,
} from "node:fs";

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
  ResolutionResult,
} from "../contracts";

import {
  AieServerError,
} from "./resolve-asset";

import type {
  AssetResolver,
} from "./resolve-assets";

import {
  BatchResolutionError,
  DEFAULT_BATCH_CONCURRENCY,
  MAX_BATCH_CONCURRENCY,
  MAX_BATCH_SIZE,
  resolveAssets,
  resolveAssetsWithResolver,
} from "./resolve-assets";

const getServerAie = vi.hoisted(
  () => vi.fn(),
);

vi.mock(
  "./create-server-aie",
  () => ({
    getServerAie: () =>
      getServerAie(),
  }),
);

const NOW =
  "2026-09-19T12:00:00.000Z";

const SECRET =
  "sentinel-batch-secret-value";

function candidate(
  id: string,
): CandidateAsset {
  return {
    id,

    rawName: `Asset ${id}`,

    source: {},

    hints: {
      assetType: "debenture",

      instrumentCode: `CODE-${id}`,
    },
  };
}

function candidates(
  count: number,
): CandidateAsset[] {
  return Array.from(
    { length: count },
    (_, index) =>
      candidate(`asset-${index}`),
  );
}

function resultFor(
  asset: CandidateAsset,
  status: ResolutionResult["status"] =
    "needs-more-evidence",
): ResolutionResult {
  return {
    status,

    investigation: {
      id: `investigation:${asset.id}`,

      candidateAsset: asset,

      status:
        status === "verified"
          ? "verified"
          : "needs-more-evidence",

      evidence: [],

      searches: [],

      unresolvedFields:
        status === "verified"
          ? []
          : ["identity", "issuer"],

      createdAt: NOW,

      updatedAt: NOW,
    },

    verifiedAsset: null,

    plan: {
      assetType: "debenture",

      unresolvedFields: [],

      steps: [],
    },

    nextAction:
      status === "verified"
        ? "finish"
        : "search-provider",
  };
}

interface Deferred<T> {
  promise: Promise<T>;

  resolve(value: T): void;

  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;

  let reject!: (
    error: unknown,
  ) => void;

  const promise = new Promise<T>(
    (res, rej) => {
      resolve = res;

      reject = rej;
    },
  );

  return {
    promise,
    resolve,
    reject,
  };
}

/** Lets pending microtasks and already-scheduled workers run. */
async function flush(): Promise<void> {
  await new Promise((resolve) =>
    setTimeout(resolve, 0),
  );
}

/** A resolver whose completions the test controls, tracking concurrency. */
function controlledResolver() {
  const started: string[] = [];

  const pending = new Map<
    string,
    Deferred<ResolutionResult>
  >();

  const state = {
    active: 0,

    maxActive: 0,
  };

  const resolver: AssetResolver =
    async (asset) => {
      started.push(asset.id);

      state.active += 1;

      state.maxActive = Math.max(
        state.maxActive,
        state.active,
      );

      const gate =
        deferred<ResolutionResult>();

      pending.set(asset.id, gate);

      try {
        return await gate.promise;
      } finally {
        state.active -= 1;
      }
    };

  return {
    resolver,

    started,

    pending,

    state,

    finish(
      asset: CandidateAsset,
      status?: ResolutionResult["status"],
    ) {
      pending
        .get(asset.id)!
        .resolve(
          resultFor(asset, status),
        );
    },
  };
}

/** A resolver that finishes after a macrotask, tracking concurrency. */
function tickingResolver() {
  const state = {
    active: 0,

    maxActive: 0,

    calls: 0,
  };

  const order: string[] = [];

  const resolver: AssetResolver =
    async (asset) => {
      order.push(asset.id);

      state.calls += 1;

      state.active += 1;

      state.maxActive = Math.max(
        state.maxActive,
        state.active,
      );

      await flush();

      state.active -= 1;

      return resultFor(asset);
    };

  return {
    resolver,
    state,
    order,
  };
}

describe(
  "resolveAssetsWithResolver",
  () => {
    beforeEach(() => {
      // Guard: nothing here may reach the real network.
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

    describe(
      "basics",
      () => {
        it(
          "returns empty items for an empty batch and never calls the resolver",
          async () => {
            const resolver = vi.fn();

            await expect(
              resolveAssetsWithResolver(
                [],
                resolver,
              ),
            ).resolves.toEqual({
              items: [],
            });

            expect(
              resolver,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          "delegates a single candidate exactly once, unchanged",
          async () => {
            const asset =
              candidate("a");

            const expected =
              resultFor(asset);

            const resolver = vi.fn(
              async (
                _asset: CandidateAsset,
              ) => expected,
            );

            const batch =
              await resolveAssetsWithResolver(
                [asset],
                resolver,
              );

            expect(
              resolver,
            ).toHaveBeenCalledTimes(1);

            expect(
              resolver.mock
                .calls[0]?.[0],
            ).toBe(asset);

            expect(
              batch.items,
            ).toHaveLength(1);

            expect(
              batch.items[0],
            ).toMatchObject({
              index: 0,

              candidateAssetId: "a",

              ok: true,
            });

            expect(
              batch.items[0],
            ).toHaveProperty(
              "result",
              expected,
            );
          },
        );

        it(
          "includes the original candidateAssetId and index in every item",
          async () => {
            const batch =
              await resolveAssetsWithResolver(
                [
                  candidate("x"),
                  candidate("y"),
                ],
                async (asset) =>
                  resultFor(asset),
              );

            expect(
              batch.items.map(
                (item) => [
                  item.index,
                  item.candidateAssetId,
                ],
              ),
            ).toEqual([
              [0, "x"],
              [1, "y"],
            ]);
          },
        );

        it(
          "preserves duplicate CandidateAsset values and resolves each occurrence",
          async () => {
            const asset =
              candidate("dup");

            const resolver = vi.fn(
              async (
                item: CandidateAsset,
              ) => resultFor(item),
            );

            const batch =
              await resolveAssetsWithResolver(
                [
                  asset,
                  candidate("other"),
                  asset,
                ],
                resolver,
              );

            expect(
              resolver,
            ).toHaveBeenCalledTimes(3);

            expect(
              batch.items.map(
                (item) => [
                  item.index,
                  item.candidateAssetId,
                ],
              ),
            ).toEqual([
              [0, "dup"],
              [1, "other"],
              [2, "dup"],
            ]);
          },
        );

        it(
          "never loses an item, even for malformed entries",
          async () => {
            const batch =
              await resolveAssetsWithResolver(
                [
                  candidate("a"),
                  null as unknown as CandidateAsset,
                  candidate("c"),
                ],
                async (asset) => {
                  if (!asset) {
                    throw new Error(
                      "bad candidate",
                    );
                  }

                  return resultFor(
                    asset,
                  );
                },
              );

            expect(
              batch.items.map(
                (item) => [
                  item.index,
                  item.ok,
                  item.candidateAssetId,
                ],
              ),
            ).toEqual([
              [0, true, "a"],
              [1, false, ""],
              [2, true, "c"],
            ]);
          },
        );
      },
    );

    describe(
      "ordering",
      () => {
        it(
          "preserves input order even when completion order differs",
          async () => {
            const [a, b, c] = [
              candidate("A"),
              candidate("B"),
              candidate("C"),
            ] as [
              CandidateAsset,
              CandidateAsset,
              CandidateAsset,
            ];

            const controlled =
              controlledResolver();

            const running =
              resolveAssetsWithResolver(
                [a, b, c],
                controlled.resolver,
                {
                  concurrency: 3,
                },
              );

            await flush();

            expect(
              controlled.started,
            ).toEqual(["A", "B", "C"]);

            controlled.finish(b);

            controlled.finish(c);

            controlled.finish(a);

            const batch =
              await running;

            expect(
              batch.items.map(
                (item) =>
                  item.candidateAssetId,
              ),
            ).toEqual([
              "A",
              "B",
              "C",
            ]);

            expect(
              batch.items.every(
                (item) => item.ok,
              ),
            ).toBe(true);
          },
        );

        it(
          "maps each result to its own position",
          async () => {
            const assets = candidates(6);

            const batch =
              await resolveAssetsWithResolver(
                assets,
                async (asset) => {
                  // Later items finish first.
                  await new Promise(
                    (resolve) =>
                      setTimeout(
                        resolve,
                        10 -
                          Number(
                            asset.id.split(
                              "-",
                            )[1],
                          ),
                      ),
                  );

                  return resultFor(
                    asset,
                  );
                },
                {
                  concurrency: 6,
                },
              );

            for (const item of batch.items) {
              expect(
                item.ok &&
                  item.result
                    .investigation
                    .candidateAsset.id,
              ).toBe(
                item.candidateAssetId,
              );
            }

            expect(
              batch.items.map(
                (item) =>
                  item.candidateAssetId,
              ),
            ).toEqual(
              assets.map(
                (asset) => asset.id,
              ),
            );
          },
        );
      },
    );

    describe(
      "bounded concurrency",
      () => {
        it(
          "runs more than one item at a time when concurrency > 1",
          async () => {
            const controlled =
              controlledResolver();

            const assets = candidates(
              3,
            );

            const running =
              resolveAssetsWithResolver(
                assets,
                controlled.resolver,
                {
                  concurrency: 2,
                },
              );

            await flush();

            expect(
              controlled.state.active,
            ).toBe(2);

            expect(
              controlled.started,
            ).toEqual([
              "asset-0",
              "asset-1",
            ]);

            controlled.finish(
              assets[0]!,
            );

            await flush();

            expect(
              controlled.started,
            ).toEqual([
              "asset-0",
              "asset-1",
              "asset-2",
            ]);

            controlled.finish(
              assets[1]!,
            );

            controlled.finish(
              assets[2]!,
            );

            await running;

            expect(
              controlled.state
                .maxActive,
            ).toBe(2);
          },
        );

        it(
          "never exceeds the configured concurrency",
          async () => {
            const ticking =
              tickingResolver();

            const batch =
              await resolveAssetsWithResolver(
                candidates(20),
                ticking.resolver,
                {
                  concurrency: 4,
                },
              );

            expect(
              batch.items,
            ).toHaveLength(20);

            expect(
              ticking.state.calls,
            ).toBe(20);

            expect(
              ticking.state.maxActive,
            ).toBe(4);
          },
        );

        it(
          "executes serially with concurrency 1, in input order",
          async () => {
            const ticking =
              tickingResolver();

            const assets =
              candidates(6);

            await resolveAssetsWithResolver(
              assets,
              ticking.resolver,
              {
                concurrency: 1,
              },
            );

            expect(
              ticking.state.maxActive,
            ).toBe(1);

            expect(
              ticking.order,
            ).toEqual(
              assets.map(
                (asset) => asset.id,
              ),
            );
          },
        );

        it(
          "uses the documented default concurrency",
          async () => {
            expect(
              DEFAULT_BATCH_CONCURRENCY,
            ).toBe(3);

            const ticking =
              tickingResolver();

            await resolveAssetsWithResolver(
              candidates(10),
              ticking.resolver,
            );

            expect(
              ticking.state.maxActive,
            ).toBe(
              DEFAULT_BATCH_CONCURRENCY,
            );
          },
        );

        it(
          "accepts the maximum concurrency",
          async () => {
            const ticking =
              tickingResolver();

            await resolveAssetsWithResolver(
              candidates(30),
              ticking.resolver,
              {
                concurrency:
                  MAX_BATCH_CONCURRENCY,
              },
            );

            expect(
              ticking.state.maxActive,
            ).toBe(
              MAX_BATCH_CONCURRENCY,
            );
          },
        );

        it(
          "starts items lazily instead of launching one promise per input item",
          async () => {
            const controlled =
              controlledResolver();

            const running =
              resolveAssetsWithResolver(
                candidates(100),
                controlled.resolver,
                {
                  concurrency: 3,
                },
              );

            await flush();

            expect(
              controlled.started,
            ).toHaveLength(3);

            for (
              let i = 0;
              i < 100;
              i += 1
            ) {
              // Finish whatever is running so the pool advances.
              for (const [
                id,
                gate,
              ] of controlled.pending) {
                gate.resolve(
                  resultFor(
                    candidate(id),
                  ),
                );

                controlled.pending.delete(
                  id,
                );
              }

              await flush();

              if (
                controlled.started
                  .length >= 100
              ) {
                break;
              }
            }

            for (const gate of controlled.pending.values()) {
              gate.resolve(
                resultFor(
                  candidate("x"),
                ),
              );
            }

            const batch =
              await running;

            expect(
              batch.items,
            ).toHaveLength(100);

            expect(
              controlled.state
                .maxActive,
            ).toBeLessThanOrEqual(3);
          },
        );

        it.each([
          ["0", 0],
          ["a negative number", -1],
          ["a fractional number", 1.5],
          ["above the maximum", 11],
          ["NaN", Number.NaN],
          ["Infinity", Number.POSITIVE_INFINITY],
          ["a string", "3"],
          ["null", null],
        ])(
          "rejects an invalid concurrency: %s",
          async (_label, value) => {
            const resolver = vi.fn();

            await expect(
              resolveAssetsWithResolver(
                [candidate("a")],
                resolver,
                {
                  concurrency:
                    value as number,
                },
              ),
            ).rejects.toMatchObject({
              name: "BatchResolutionError",

              code: "INVALID_CONCURRENCY",
            });

            expect(
              resolver,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          "documents the maximum concurrency and batch size",
          () => {
            expect(
              MAX_BATCH_CONCURRENCY,
            ).toBe(10);

            expect(
              MAX_BATCH_SIZE,
            ).toBe(100);
          },
        );
      },
    );

    describe(
      "input limits",
      () => {
        it(
          "accepts exactly the maximum batch size",
          async () => {
            const batch =
              await resolveAssetsWithResolver(
                candidates(
                  MAX_BATCH_SIZE,
                ),
                async (asset) =>
                  resultFor(asset),
              );

            expect(
              batch.items,
            ).toHaveLength(
              MAX_BATCH_SIZE,
            );
          },
        );

        it(
          "rejects a larger batch without truncating or resolving anything",
          async () => {
            const resolver = vi.fn();

            await expect(
              resolveAssetsWithResolver(
                candidates(
                  MAX_BATCH_SIZE + 1,
                ),
                resolver,
              ),
            ).rejects.toMatchObject({
              code: "BATCH_TOO_LARGE",
            });

            expect(
              resolver,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          "rejects a non-array input",
          async () => {
            for (const input of [
              undefined,
              null,
              "x",
              {},
              5,
            ]) {
              await expect(
                resolveAssetsWithResolver(
                  input as unknown as CandidateAsset[],
                  vi.fn(),
                ),
              ).rejects.toMatchObject({
                code: "INVALID_INPUT",
              });
            }
          },
        );

        it(
          "uses fixed, safe error messages",
          () => {
            for (const code of [
              "INVALID_INPUT",
              "INVALID_CONCURRENCY",
              "BATCH_TOO_LARGE",
            ] as const) {
              expect(
                new BatchResolutionError(
                  code,
                ).message,
              ).not.toContain(SECRET);
            }
          },
        );
      },
    );

    describe(
      "results are preserved unchanged",
      () => {
        it(
          "keeps a verified result exactly as returned",
          async () => {
            const asset =
              candidate("v");

            const verified =
              resultFor(
                asset,
                "verified",
              );

            const batch =
              await resolveAssetsWithResolver(
                [asset],
                async () => verified,
              );

            const [item] =
              batch.items;

            expect(
              item?.ok &&
                item.result,
            ).toBe(verified);
          },
        );

        it(
          "keeps a needs-more-evidence result exactly as returned",
          async () => {
            const asset =
              candidate("n");

            const unresolved =
              resultFor(asset);

            const batch =
              await resolveAssetsWithResolver(
                [asset],
                async () => unresolved,
              );

            const [item] =
              batch.items;

            expect(
              item?.ok &&
                item.result,
            ).toBe(unresolved);
          },
        );

        it(
          "keeps a provider failure recorded inside the InvestigationCase as a normal result",
          async () => {
            const asset =
              candidate("p");

            const base =
              resultFor(asset);

            const withFailure: ResolutionResult =
              {
                ...base,

                investigation: {
                  ...base.investigation,

                  searches: [
                    {
                      providerId:
                        "ANBIMA",

                      startedAt: NOW,

                      finishedAt: NOW,

                      status:
                        "failed",

                      evidenceIds:
                        [],

                      error:
                        "ANBIMA_SEARCH_FAILED: unavailable",
                    },
                  ],
                },
              };

            const batch =
              await resolveAssetsWithResolver(
                [asset],
                async () =>
                  withFailure,
              );

            const [item] =
              batch.items;

            expect(item?.ok).toBe(true);

            expect(
              item?.ok &&
                item.result
                  .investigation
                  .searches[0]?.status,
            ).toBe("failed");
          },
        );
      },
    );

    describe(
      "per-item failure policy",
      () => {
        it(
          "turns one rejection into an item error and still runs later items",
          async () => {
            const assets = candidates(
              4,
            );

            const started: string[] =
              [];

            const batch =
              await resolveAssetsWithResolver(
                assets,
                async (asset) => {
                  started.push(
                    asset.id,
                  );

                  if (
                    asset.id ===
                    "asset-1"
                  ) {
                    throw new Error(
                      `boom ${SECRET}`,
                    );
                  }

                  return resultFor(
                    asset,
                  );
                },
                {
                  concurrency: 1,
                },
              );

            expect(
              started,
            ).toEqual([
              "asset-0",
              "asset-1",
              "asset-2",
              "asset-3",
            ]);

            expect(
              batch.items.map(
                (item) => item.ok,
              ),
            ).toEqual([
              true,
              false,
              true,
              true,
            ]);
          },
        );

        it(
          "does not reject the batch when several items fail",
          async () => {
            const batch =
              await resolveAssetsWithResolver(
                candidates(5),
                async (asset) => {
                  if (
                    Number(
                      asset.id.split(
                        "-",
                      )[1],
                    ) %
                      2 ===
                    0
                  ) {
                    throw new Error(
                      "fail",
                    );
                  }

                  return resultFor(
                    asset,
                  );
                },
              );

            expect(
              batch.items.map(
                (item) => item.ok,
              ),
            ).toEqual([
              false,
              true,
              false,
              true,
              false,
            ]);
          },
        );

        it(
          "produces a safe item error without the original exception text",
          async () => {
            const batch =
              await resolveAssetsWithResolver(
                [candidate("a")],
                async () => {
                  throw new Error(
                    `boom ${SECRET}`,
                  );
                },
              );

            const [item] =
              batch.items;

            expect(item?.ok).toBe(
              false,
            );

            const error =
              item && !item.ok
                ? item.error
                : undefined;

            expect(
              error,
            ).toEqual({
              code: "AIE_INTERNAL_ERROR",

              message:
                "Unable to resolve asset.",
            });

            expect(
              Object.keys(
                error ?? {},
              ).sort(),
            ).toEqual([
              "code",
              "message",
            ]);
          },
        );

        it(
          "maps a configuration AieServerError to the configuration code",
          async () => {
            const batch =
              await resolveAssetsWithResolver(
                [
                  candidate("a"),
                  candidate("b"),
                ],
                async (asset) => {
                  if (
                    asset.id === "a"
                  ) {
                    throw new AieServerError(
                      "configuration",
                    );
                  }

                  throw new AieServerError(
                    "unexpected",
                  );
                },
              );

            expect(
              batch.items.map(
                (item) =>
                  !item.ok &&
                  item.error.code,
              ),
            ).toEqual([
              "AIE_CONFIGURATION_UNAVAILABLE",
              "AIE_INTERNAL_ERROR",
            ]);
          },
        );

        it(
          "never leaks a secret into the serialized batch result",
          async () => {
            const batch =
              await resolveAssetsWithResolver(
                candidates(3),
                async (asset) => {
                  if (
                    asset.id ===
                    "asset-1"
                  ) {
                    throw new Error(
                      `boom ${SECRET}`,
                    );
                  }

                  return resultFor(
                    asset,
                  );
                },
              );

            expect(
              JSON.stringify(batch),
            ).not.toContain(SECRET);
          },
        );

        it(
          "does not let callers mutate shared error constants",
          async () => {
            const failing: AssetResolver =
              async () => {
                throw new Error("x");
              };

            const first =
              await resolveAssetsWithResolver(
                [candidate("a")],
                failing,
              );

            const item =
              first.items[0];

            if (item && !item.ok) {
              item.error.message =
                "mutated";
            }

            const second =
              await resolveAssetsWithResolver(
                [candidate("a")],
                failing,
              );

            const again =
              second.items[0];

            expect(
              again && !again.ok
                ? again.error.message
                : "",
            ).toBe(
              "Unable to resolve asset.",
            );
          },
        );
      },
    );
  },
);

describe(
  "resolveAssets (server engine reused once per batch)",
  () => {
    beforeEach(() => {
      getServerAie.mockReset();

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

    function fakeEngine(
      resolve: (input: {
        candidateAsset: CandidateAsset;
      }) => Promise<ResolutionResult>,
    ) {
      const spy = vi.fn(resolve);

      return {
        engine: {
          resolve: spy,
        },

        spy,
      };
    }

    it(
      "returns empty items for an empty batch without obtaining the engine",
      async () => {
        await expect(
          resolveAssets([]),
        ).resolves.toEqual({
          items: [],
        });

        expect(
          getServerAie,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "obtains the server engine once and delegates each candidate to it",
      async () => {
        const { engine, spy } =
          fakeEngine(
            async ({
              candidateAsset,
            }) =>
              resultFor(
                candidateAsset,
              ),
          );

        getServerAie.mockReturnValue(
          engine,
        );

        const assets = candidates(5);

        const batch =
          await resolveAssets(
            assets,
          );

        expect(
          getServerAie,
        ).toHaveBeenCalledTimes(1);

        expect(spy).toHaveBeenCalledTimes(
          5,
        );

        expect(
          spy.mock.calls.map(
            ([input]) =>
              input.candidateAsset,
          ),
        ).toEqual(assets);

        expect(
          spy.mock.calls.every(
            ([input]) =>
              Object.keys(input)
                .length === 1,
          ),
        ).toBe(true);

        expect(
          batch.items.map(
            (item) =>
              item.candidateAssetId,
          ),
        ).toEqual(
          assets.map(
            (asset) => asset.id,
          ),
        );
      },
    );

    it(
      "attempts an invalid configuration once and reports it on every item",
      async () => {
        getServerAie.mockImplementation(
          () => {
            throw new AnbimaConfigurationError(
              "INCOMPLETE_CREDENTIALS",
              `ANBIMA credentials are incomplete: ${SECRET}`,
            );
          },
        );

        const assets = candidates(4);

        const batch =
          await resolveAssets(
            assets,
          );

        expect(
          getServerAie,
        ).toHaveBeenCalledTimes(1);

        expect(
          batch.items,
        ).toHaveLength(4);

        expect(
          batch.items.map(
            (item) => [
              item.index,
              item.candidateAssetId,
              !item.ok &&
                item.error.code,
            ],
          ),
        ).toEqual(
          assets.map(
            (asset, index) => [
              index,
              asset.id,
              "AIE_CONFIGURATION_UNAVAILABLE",
            ],
          ),
        );

        expect(
          JSON.stringify(batch),
        ).not.toContain(SECRET);
      },
    );

    it(
      "reports a non-configuration failure to obtain the engine as an internal error on every item",
      async () => {
        getServerAie.mockImplementation(
          () => {
            throw new Error(
              `unrelated ${SECRET}`,
            );
          },
        );

        const batch =
          await resolveAssets(
            candidates(2),
          );

        expect(
          getServerAie,
        ).toHaveBeenCalledTimes(1);

        expect(
          batch.items.map(
            (item) =>
              !item.ok &&
              item.error.code,
          ),
        ).toEqual([
          "AIE_INTERNAL_ERROR",
          "AIE_INTERNAL_ERROR",
        ]);

        expect(
          JSON.stringify(batch),
        ).not.toContain(SECRET);
      },
    );

    it(
      "keeps resolving the other items when one engine call rejects",
      async () => {
        const { engine } =
          fakeEngine(
            async ({
              candidateAsset,
            }) => {
              if (
                candidateAsset.id ===
                "asset-1"
              ) {
                throw new Error(
                  `boom ${SECRET}`,
                );
              }

              return resultFor(
                candidateAsset,
              );
            },
          );

        getServerAie.mockReturnValue(
          engine,
        );

        const batch =
          await resolveAssets(
            candidates(3),
          );

        expect(
          batch.items.map(
            (item) => item.ok,
          ),
        ).toEqual([
          true,
          false,
          true,
        ]);

        expect(
          JSON.stringify(batch),
        ).not.toContain(SECRET);
      },
    );

    it(
      "validates the request before touching the engine",
      async () => {
        await expect(
          resolveAssets(
            candidates(2),
            {
              concurrency: 0,
            },
          ),
        ).rejects.toMatchObject({
          code: "INVALID_CONCURRENCY",
        });

        await expect(
          resolveAssets(
            candidates(
              MAX_BATCH_SIZE + 1,
            ),
          ),
        ).rejects.toMatchObject({
          code: "BATCH_TOO_LARGE",
        });

        expect(
          getServerAie,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "honors the concurrency option through the public API",
      async () => {
        let active = 0;

        let maxActive = 0;

        const { engine } =
          fakeEngine(
            async ({
              candidateAsset,
            }) => {
              active += 1;

              maxActive = Math.max(
                maxActive,
                active,
              );

              await flush();

              active -= 1;

              return resultFor(
                candidateAsset,
              );
            },
          );

        getServerAie.mockReturnValue(
          engine,
        );

        await resolveAssets(
          candidates(12),
          {
            concurrency: 2,
          },
        );

        expect(maxActive).toBe(2);
      },
    );
  },
);

describe(
  "batch module boundary",
  () => {
    function code(): string {
      return readFileSync(
        new URL(
          "./resolve-assets.ts",
          import.meta.url,
        ),
        "utf8",
      )
        .replace(
          /\/\*[\s\S]*?\*\//g,
          "",
        )
        .replace(
          /^\s*\/\/.*$/gm,
          "",
        );
    }

    it(
      "does not access the process environment",
      () => {
        expect(
          code(),
        ).not.toContain(
          "process.env",
        );
      },
    );

    it(
      "does not call fetch",
      () => {
        expect(
          code(),
        ).not.toContain("fetch");
      },
    );

    it(
      "imports only domain contracts and the single-asset use case",
      () => {
        const imports = Array.from(
          code().matchAll(
            /from\s*["']([^"']+)["']/g,
          ),
          (match) => match[1],
        ).sort();

        expect(imports).toEqual([
          "../contracts",
          "./resolve-asset",
        ]);
      },
    );

    it(
      "has no provider, policy, pipeline or environment knowledge",
      () => {
        for (const forbidden of [
          "VerificationPolicy",
          "ProviderExecutionPipeline",
          "EvidenceOrchestrator",
          "ResolutionPlanner",
          "AnbimaHttpClient",
          "AnbimaDebentureProvider",
          "createAieFromEnv",
          "getServerAie",
          "Provider",
          "ANBIMA",
          "console.",
        ]) {
          expect(
            code(),
          ).not.toContain(forbidden);
        }
      },
    );

    it(
      "does not run an unbounded Promise.all over the input items",
      () => {
        const source = code();

        expect(
          source.match(
            /Promise\.all\(/g,
          ) ?? [],
        ).toHaveLength(1);

        expect(
          source,
        ).not.toMatch(
          /Promise\.all\(\s*(candidates|candidateAssets)/,
        );

        expect(
          source,
        ).not.toContain(
          "Promise.allSettled",
        );

        expect(
          source,
        ).not.toMatch(
          /(candidates|candidateAssets)\s*\.map\(\s*async/,
        );
      },
    );

    it(
      "does not add cancellation, retries, caching or deduplication",
      () => {
        for (const forbidden of [
          "AbortController",
          "retry",
          "cache",
          "new Set",
          "new Map",
        ]) {
          expect(
            code(),
          ).not.toContain(forbidden);
        }
      },
    );
  },
);
