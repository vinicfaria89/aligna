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
  ingestPortfolioCandidate,
  ingestPortfolioCandidates,
  PortfolioIngestionError,
} from "../portfolio-candidate-ingestion";

import {
  ingestStructuredPortfolio,
  parseStructuredPortfolio,
  parseStructuredPortfolioJson,
  StructuredPortfolioAdapterError,
} from "./structured-portfolio-adapter";

function asset(
  overrides: Record<
    string,
    unknown
  > = {},
): Record<string, unknown> {
  return {
    id: "row-1",

    rawName: "DEB PETROBRAS",

    ...overrides,
  };
}

function payload(
  ...assets: Array<
    Record<string, unknown>
  >
): Record<string, unknown> {
  return {
    assets,
  };
}

function adapterError(
  input: unknown,
): StructuredPortfolioAdapterError {
  try {
    parseStructuredPortfolio(input);
  } catch (error) {
    expect(
      error,
    ).toBeInstanceOf(
      StructuredPortfolioAdapterError,
    );

    return error as StructuredPortfolioAdapterError;
  }

  throw new Error(
    "expected the adapter to fail",
  );
}

function issuesOf(
  input: unknown,
): Array<[string, string]> {
  return adapterError(
    input,
  ).issues.map((issue) => [
    issue.path,
    issue.code,
  ]);
}

const FULL_ASSET = {
  id: "row-7",

  rawName: "  DEB   PETROBRAS ",

  assetType: "debenture",

  ticker: " petr4 ",

  isin: " brpetrdbs000 ",

  cnpj: "33.000.167/0001-01",

  instrumentCode: " abcd11 ",

  issuerName: " Petrobras ",

  fundName: "Fundo X",

  maturityDate: "2030-01-15",

  currency: " brl ",

  amount: 1234.56,

  source: {
    fileId: "file-1",

    fileName: "extrato.json",

    section: "renda fixa",

    row: 3,

    institution: "Corretora X",
  },
};

describe(
  "structured portfolio adapter",
  () => {
    beforeEach(() => {
      // Guard: the adapter must never reach the network.
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
      "parseStructuredPortfolio: valid input",
      () => {
        it(
          "parses a valid structured payload",
          () => {
            const result =
              parseStructuredPortfolio(
                payload(FULL_ASSET),
              );

            expect(
              result,
            ).toHaveLength(1);

            expect(
              result[0]?.rawName,
            ).toBe(
              "  DEB   PETROBRAS ",
            );

            expect(
              result[0]?.assetType,
            ).toBe("debenture");

            expect(
              result[0]?.source,
            ).toEqual(
              FULL_ASSET.source,
            );
          },
        );

        it(
          "passes raw values through untouched (normalization is not duplicated in the adapter)",
          () => {
            const [parsed] =
              parseStructuredPortfolio(
                payload(FULL_ASSET),
              );

            expect(parsed).toEqual(
              FULL_ASSET,
            );

            expect(
              parsed?.ticker,
            ).toBe(" petr4 ");

            expect(
              parsed?.cnpj,
            ).toBe(
              "33.000.167/0001-01",
            );

            expect(
              parsed?.currency,
            ).toBe(" brl ");
          },
        );

        it(
          "leaves blank optional strings to the ingestion layer",
          () => {
            const [parsed] =
              parseStructuredPortfolio(
                payload(
                  asset({
                    ticker: "",

                    isin: "   ",

                    cnpj: " ",

                    instrumentCode: "",
                  }),
                ),
              );

            expect(
              parsed?.ticker,
            ).toBe("");

            expect(
              parsed?.isin,
            ).toBe("   ");

            const [candidate] =
              ingestStructuredPortfolio(
                payload(
                  asset({
                    ticker: "",

                    isin: "   ",

                    cnpj: " ",

                    instrumentCode: "",
                  }),
                ),
              );

            expect(
              candidate?.hints,
            ).toEqual({});
          },
        );

        it(
          "omits absent fields instead of writing undefined values",
          () => {
            const [parsed] =
              parseStructuredPortfolio(
                payload(asset()),
              );

            expect(
              Object.keys(
                parsed ?? {},
              ).sort(),
            ).toEqual([
              "id",
              "rawName",
            ]);
          },
        );

        it(
          "preserves asset order",
          () => {
            const result =
              parseStructuredPortfolio(
                payload(
                  asset({
                    id: "c",
                  }),
                  asset({
                    id: "a",
                  }),
                  asset({
                    id: "b",
                  }),
                ),
              );

            expect(
              result.map(
                (item) => item.id,
              ),
            ).toEqual([
              "c",
              "a",
              "b",
            ]);
          },
        );

        it(
          "accepts an empty assets array and yields no candidates",
          () => {
            expect(
              parseStructuredPortfolio({
                assets: [],
              }),
            ).toEqual([]);

            expect(
              ingestStructuredPortfolio({
                assets: [],
              }),
            ).toEqual([]);
          },
        );

        it(
          "does not mutate the input",
          () => {
            const input = payload(
              structuredClone(
                FULL_ASSET,
              ),
            );

            const snapshot =
              structuredClone(input);

            parseStructuredPortfolio(
              input,
            );

            expect(input).toEqual(
              snapshot,
            );
          },
        );
      },
    );

    describe(
      "ingestStructuredPortfolio: flows through the ingestion layer",
      () => {
        it(
          "equals parse + ingestPortfolioCandidates (single source of normalization)",
          () => {
            const input = payload(
              FULL_ASSET,
              asset({
                id: "row-2",

                rawName: "Second",
              }),
            );

            expect(
              ingestStructuredPortfolio(
                input,
              ),
            ).toEqual(
              ingestPortfolioCandidates(
                parseStructuredPortfolio(
                  input,
                ),
              ),
            );
          },
        );

        it(
          "produces CandidateAssets using the existing normalization rules",
          () => {
            const [candidate] =
              ingestStructuredPortfolio(
                payload(FULL_ASSET),
              );

            expect(candidate).toEqual({
              id: "row-7",

              rawName:
                "DEB PETROBRAS",

              source: {
                fileId: "file-1",

                fileName:
                  "extrato.json",

                section:
                  "renda fixa",

                row: 3,

                institution:
                  "Corretora X",
              },

              hints: {
                assetType:
                  "debenture",

                ticker: "PETR4",

                isin: "BRPETRDBS000",

                cnpj: "33000167000101",

                instrumentCode:
                  "ABCD11",

                issuerName:
                  "Petrobras",

                fundName: "Fundo X",

                maturityDate:
                  "2030-01-15",

                currency: "BRL",

                amount: 1234.56,
              },
            });

            expect(candidate).toEqual(
              ingestPortfolioCandidate(
                FULL_ASSET as never,
              ),
            );
          },
        );

        it(
          "preserves an explicit id",
          () => {
            expect(
              ingestStructuredPortfolio(
                payload(
                  asset({
                    id: "explicit-id",
                  }),
                ),
              )[0]?.id,
            ).toBe("explicit-id");
          },
        );

        it(
          "derives a deterministic id from source.fileId + source.row",
          () => {
            const input = payload({
              rawName: "X",

              source: {
                fileId: "file-9",

                row: 4,
              },
            });

            const first =
              ingestStructuredPortfolio(
                input,
              );

            const second =
              ingestStructuredPortfolio(
                structuredClone(input),
              );

            expect(
              first[0]?.id,
            ).toBe(
              "portfolio:file-9:4",
            );

            expect(first).toEqual(
              second,
            );
          },
        );

        it(
          "lets the ingestion layer enforce its own rules (not duplicated in the adapter)",
          () => {
            // A negative amount is a canonical rule: the adapter accepts the
            // shape, the ingestion layer rejects the value.
            const input = payload(
              asset({
                amount: -5,
              }),
            );

            expect(
              parseStructuredPortfolio(
                input,
              )[0]?.amount,
            ).toBe(-5);

            expect(() =>
              ingestStructuredPortfolio(
                input,
              ),
            ).toThrow(
              PortfolioIngestionError,
            );
          },
        );
      },
    );

    describe(
      "root validation",
      () => {
        it.each([
          ["null", null],
          ["undefined", undefined],
          ["an array", []],
          ["a string", "assets"],
          ["a number", 5],
        ])(
          "rejects an invalid root: %s",
          (_label, input) => {
            expect(
              issuesOf(input),
            ).toEqual([["$", "type"]]);
          },
        );

        it(
          "rejects a missing assets field",
          () => {
            expect(
              issuesOf({}),
            ).toEqual([
              ["assets", "required"],
            ]);
          },
        );

        it.each([
          ["an object", {}],
          ["a string", "x"],
          ["null", null],
          ["a number", 3],
        ])(
          "rejects non-array assets: %s",
          (_label, assets) => {
            expect(
              issuesOf({
                assets,
              }),
            ).toEqual([
              ["assets", "type"],
            ]);
          },
        );

        it(
          "rejects unknown top-level fields",
          () => {
            expect(
              issuesOf({
                assets: [],

                extra: 1,
              }),
            ).toEqual([
              ["$", "unknown_field"],
            ]);
          },
        );
      },
    );

    describe(
      "asset validation (fail-fast, with item index)",
      () => {
        it(
          "rejects an invalid item with its index and returns no partial result",
          () => {
            const error =
              adapterError(
                payload(
                  asset({
                    id: "ok",
                  }),
                  asset({
                    id: "bad",

                    ticker: 5,
                  }),
                  asset({
                    id: "also-bad",

                    ticker: 6,
                  }),
                ),
              );

            expect(
              error.index,
            ).toBe(1);

            expect(
              error.message,
            ).toBe(
              "Invalid structured portfolio asset at index 1.",
            );

            expect(
              error.issues,
            ).toEqual([
              {
                path: "assets[1].ticker",

                code: "type",
              },
            ]);
          },
        );

        it.each([
          ["null", null],
          ["a string", "x"],
          ["an array", []],
          ["a number", 4],
        ])(
          "rejects a non-object asset item: %s",
          (_label, item) => {
            const error =
              adapterError({
                assets: [
                  asset(),
                  item,
                ],
              });

            expect(
              error.index,
            ).toBe(1);

            expect(
              error.issues,
            ).toEqual([
              {
                path: "assets[1]",

                code: "type",
              },
            ]);
          },
        );

        it(
          "rejects a missing rawName and wrong-typed rawName/id",
          () => {
            expect(
              issuesOf({
                assets: [
                  {
                    id: "a",
                  },
                ],
              }),
            ).toEqual([
              [
                "assets[0].rawName",
                "required",
              ],
            ]);

            expect(
              issuesOf(
                payload(
                  asset({
                    rawName: 5,
                  }),
                ),
              ),
            ).toEqual([
              [
                "assets[0].rawName",
                "type",
              ],
            ]);

            expect(
              issuesOf(
                payload(
                  asset({
                    id: 5,
                  }),
                ),
              ),
            ).toEqual([
              [
                "assets[0].id",
                "type",
              ],
            ]);
          },
        );

        it(
          "rejects unknown asset fields",
          () => {
            expect(
              issuesOf(
                payload(
                  asset({
                    bankSpecificField:
                      "x",
                  }),
                ),
              ),
            ).toEqual([
              [
                "assets[0]",
                "unknown_field",
              ],
            ]);
          },
        );

        it(
          "rejects sensitive customer and secret fields with a dedicated code",
          () => {
            for (const key of [
              "customerName",
              "cpf",
              "accountNumber",
              "totalWealth",
              "portfolioBalance",
              "password",
              "token",
              "access_token",
              "accessToken",
              "clientSecret",
              "client_secret",
              "CPF",
            ]) {
              expect(
                issuesOf(
                  payload(
                    asset({
                      [key]: "x",
                    }),
                  ),
                ),
              ).toEqual([
                [
                  "assets[0]",
                  "forbidden_field",
                ],
              ]);
            }
          },
        );

        it(
          "rejects provider/runtime configuration fields",
          () => {
            for (const key of [
              "provider",
              "environment",
              "url",
              "ANBIMA_CLIENT_ID",
              "config",
            ]) {
              const issues = issuesOf(
                payload(
                  asset({
                    [key]: "x",
                  }),
                ),
              );

              expect(
                issues.length,
              ).toBeGreaterThan(0);

              expect(
                issues.every(
                  ([, code]) =>
                    code ===
                      "unknown_field" ||
                    code ===
                      "forbidden_field",
                ),
              ).toBe(true);
            }
          },
        );

        it(
          "rejects sensitive fields inside source too",
          () => {
            expect(
              issuesOf(
                payload(
                  asset({
                    source: {
                      customerName:
                        "x",
                    },
                  }),
                ),
              ),
            ).toEqual([
              [
                "assets[0].source",
                "forbidden_field",
              ],
            ]);
          },
        );

        it(
          "rejects an invalid assetType",
          () => {
            expect(
              issuesOf(
                payload(
                  asset({
                    assetType:
                      "bond",
                  }),
                ),
              ),
            ).toEqual([
              [
                "assets[0].assetType",
                "invalid_value",
              ],
            ]);

            expect(
              issuesOf(
                payload(
                  asset({
                    assetType: 3,
                  }),
                ),
              ),
            ).toEqual([
              [
                "assets[0].assetType",
                "type",
              ],
            ]);

            expect(
              issuesOf(
                payload(
                  asset({
                    assetType:
                      "__proto__",
                  }),
                ),
              ),
            ).toEqual([
              [
                "assets[0].assetType",
                "invalid_value",
              ],
            ]);
          },
        );

        it(
          "rejects an amount given as a string (never coerced)",
          () => {
            expect(
              issuesOf(
                payload(
                  asset({
                    amount: "1000",
                  }),
                ),
              ),
            ).toEqual([
              [
                "assets[0].amount",
                "type",
              ],
            ]);

            expect(
              issuesOf(
                payload(
                  asset({
                    amount:
                      "R$ 1.000,00",
                  }),
                ),
              ),
            ).toEqual([
              [
                "assets[0].amount",
                "type",
              ],
            ]);
          },
        );

        it(
          "rejects NaN and Infinity amounts (constructible in direct JS input)",
          () => {
            for (const amount of [
              Number.NaN,
              Number.POSITIVE_INFINITY,
              Number.NEGATIVE_INFINITY,
            ]) {
              expect(
                issuesOf(
                  payload(
                    asset({
                      amount,
                    }),
                  ),
                ),
              ).toEqual([
                [
                  "assets[0].amount",
                  "invalid_value",
                ],
              ]);
            }
          },
        );

        it(
          "rejects nested objects and arrays where scalars are expected",
          () => {
            for (const field of [
              "ticker",
              "isin",
              "cnpj",
              "instrumentCode",
              "issuerName",
              "fundName",
              "maturityDate",
              "currency",
            ]) {
              for (const bad of [
                {},
                [],
                ["x"],
                null,
              ]) {
                expect(
                  issuesOf(
                    payload(
                      asset({
                        [field]: bad,
                      }),
                    ),
                  ),
                ).toEqual([
                  [
                    `assets[0].${field}`,
                    "type",
                  ],
                ]);
              }
            }
          },
        );

        it(
          "rejects a malformed source",
          () => {
            for (const source of [
              "x",
              [],
              5,
              null,
            ]) {
              expect(
                issuesOf(
                  payload(
                    asset({
                      source,
                    }),
                  ),
                ),
              ).toEqual([
                [
                  "assets[0].source",
                  "type",
                ],
              ]);
            }

            expect(
              issuesOf(
                payload(
                  asset({
                    source: {
                      fileName: 7,

                      row: "3",

                      section: {},
                    },
                  }),
                ),
              ),
            ).toEqual([
              [
                "assets[0].source.fileName",
                "type",
              ],
              [
                "assets[0].source.section",
                "type",
              ],
              [
                "assets[0].source.row",
                "type",
              ],
            ]);

            expect(
              issuesOf(
                payload(
                  asset({
                    source: {
                      extra: 1,
                    },
                  }),
                ),
              ),
            ).toEqual([
              [
                "assets[0].source",
                "unknown_field",
              ],
            ]);
          },
        );

        it(
          "rejects a non-finite source.row",
          () => {
            expect(
              issuesOf(
                payload(
                  asset({
                    source: {
                      row: Number.NaN,
                    },
                  }),
                ),
              ),
            ).toEqual([
              [
                "assets[0].source.row",
                "invalid_value",
              ],
            ]);
          },
        );
      },
    );

    describe(
      "safe errors",
      () => {
        it(
          "never echoes submitted values or unknown key names",
          () => {
            const value =
              "SENTINEL_VALUE_321";

            const key =
              "SENTINEL_KEY_654";

            const errors = [
              adapterError(
                payload(
                  asset({
                    id: value,

                    rawName: 5,

                    ticker: value,

                    amount: value,

                    assetType: value,

                    source: {
                      row: value,

                      [key]: value,
                    },

                    [key]: value,
                  }),
                ),
              ),
              adapterError({
                assets: value,

                [key]: value,
              }),
            ];

            for (const error of errors) {
              const text =
                JSON.stringify({
                  message:
                    error.message,

                  issues: error.issues,
                });

              expect(
                text,
              ).not.toContain(value);

              expect(
                text,
              ).not.toContain(key);
            }
          },
        );

        it(
          "does not echo the name of a forbidden field",
          () => {
            const error =
              adapterError(
                payload(
                  asset({
                    clientSecret:
                      "x",
                  }),
                ),
              );

            expect(
              JSON.stringify(
                error.issues,
              ),
            ).not.toContain(
              "clientSecret",
            );
          },
        );

        it(
          "does not serialize arbitrary unknown keys (the error carries only issues and index)",
          () => {
            const error =
              adapterError(
                payload(
                  asset({
                    SENTINEL_KEY_9:
                      "x",
                  }),
                ),
              );

            expect(
              JSON.stringify(error),
            ).not.toContain(
              "SENTINEL_KEY_9",
            );

            expect(
              Object.keys(error)
                .filter(
                  (key) =>
                    key !== "name",
                )
                .sort(),
            ).toEqual([
              "index",
              "issues",
            ]);
          },
        );
      },
    );

    describe(
      "parseStructuredPortfolioJson",
      () => {
        it(
          "parses a valid JSON string",
          () => {
            expect(
              parseStructuredPortfolioJson(
                JSON.stringify(
                  payload(asset()),
                ),
              ),
            ).toEqual([
              {
                id: "row-1",

                rawName:
                  "DEB PETROBRAS",
              },
            ]);
          },
        );

        it(
          "rejects malformed JSON safely without echoing the text",
          () => {
            const secret =
              "SENTINEL_RAW_JSON_777";

            let caught: unknown;

            try {
              parseStructuredPortfolioJson(
                `{"assets": [${secret}`,
              );
            } catch (error) {
              caught = error;
            }

            expect(
              caught,
            ).toBeInstanceOf(
              StructuredPortfolioAdapterError,
            );

            const error =
              caught as StructuredPortfolioAdapterError;

            expect(
              error.issues,
            ).toEqual([
              {
                path: "$",

                code: "invalid_json",
              },
            ]);

            expect(
              error.message,
            ).not.toContain(secret);
          },
        );

        it(
          "rejects a non-string input and validates the parsed shape",
          () => {
            expect(() =>
              parseStructuredPortfolioJson(
                5 as unknown as string,
              ),
            ).toThrow(
              StructuredPortfolioAdapterError,
            );

            expect(() =>
              parseStructuredPortfolioJson(
                "[]",
              ),
            ).toThrow(
              StructuredPortfolioAdapterError,
            );
          },
        );

        it(
          "rejects a JSON amount that overflows to Infinity",
          () => {
            expect(
              issuesOf(
                JSON.parse(
                  '{"assets":[{"id":"a","rawName":"b","amount":1e999}]}',
                ),
              ),
            ).toEqual([
              [
                "assets[0].amount",
                "invalid_value",
              ],
            ]);
          },
        );
      },
    );

    describe(
      "no inference (a CandidateAsset stays unresolved input)",
      () => {
        it(
          "does not turn 'Petrobras PN' into a ticker",
          () => {
            const [candidate] =
              ingestStructuredPortfolio(
                payload(
                  asset({
                    rawName:
                      "Petrobras PN",
                  }),
                ),
              );

            expect(
              candidate?.hints.ticker,
            ).toBeUndefined();

            expect(
              candidate?.hints,
            ).toEqual({});
          },
        );

        it(
          "does not populate isin from an ISIN-looking rawName",
          () => {
            const [candidate] =
              ingestStructuredPortfolio(
                payload(
                  asset({
                    rawName:
                      "DEB PETROBRAS BRPETRDBS000",
                  }),
                ),
              );

            expect(
              candidate?.hints.isin,
            ).toBeUndefined();
          },
        );

        it(
          "does not infer assetType, instrumentCode, cnpj or issuerName from rawName",
          () => {
            const [candidate] =
              ingestStructuredPortfolio(
                payload(
                  asset({
                    rawName:
                      "CDB ABCD11 Petrobras 33.000.167/0001-01",
                  }),
                ),
              );

            expect(
              candidate?.hints,
            ).toEqual({});
          },
        );

        it(
          "performs no fuzzy handling of names",
          () => {
            expect(
              parseStructuredPortfolio(
                payload(
                  asset({
                    rawName:
                      "PETROB",
                  }),
                ),
              )[0]?.rawName,
            ).toBe("PETROB");
          },
        );
      },
    );

    describe(
      "purity",
      () => {
        function code(): string {
          return readFileSync(
            new URL(
              "./structured-portfolio-adapter.ts",
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
          "makes no network request",
          () => {
            const globalFetch =
              vi.fn();

            vi.stubGlobal(
              "fetch",
              globalFetch,
            );

            ingestStructuredPortfolio(
              payload(FULL_ASSET),
            );

            expect(
              globalFetch,
            ).not.toHaveBeenCalled();

            expect(
              code(),
            ).not.toContain("fetch");
          },
        );

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
          "imports only domain contracts and the ingestion layer (no providers, no server code)",
          () => {
            const imports =
              Array.from(
                code().matchAll(
                  /from\s*["']([^"']+)["']/g,
                ),
                (match) => match[1],
              ).sort();

            expect(imports).toEqual([
              "../../contracts",
              "../portfolio-candidate-ingestion",
              "../portfolio-candidate-ingestion",
            ]);

            for (const forbidden of [
              "resolveAsset",
              "getServerAie",
              "createAie",
              "Provider",
              "console.",
              "Math.random",
            ]) {
              expect(
                code(),
              ).not.toContain(
                forbidden,
              );
            }
          },
        );

        it(
          "does not reimplement ingestion normalization",
          () => {
            for (const forbidden of [
              ".trim(",
              ".toUpperCase(",
              "normalizeIdentifierValue",
              "portfolio:",
            ]) {
              expect(
                code(),
              ).not.toContain(
                forbidden,
              );
            }
          },
        );
      },
    );
  },
);
