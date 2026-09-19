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

import type {
  CandidateAsset,
} from "../contracts";

import {
  normalizeIdentifierValue,
} from "../registry/normalize";

import {
  CANDIDATE_LIMITS,
  validateCandidateAsset,
} from "../server/candidate-asset-validation";

import {
  INGESTION_LIMITS,
  ingestPortfolioCandidate,
  ingestPortfolioCandidates,
  PortfolioIngestionError,
} from "./portfolio-candidate-ingestion";

import type {
  PortfolioAssetInput,
} from "./portfolio-candidate-ingestion";

function minimal(
  overrides: Partial<PortfolioAssetInput> = {},
): PortfolioAssetInput {
  return {
    id: "row-1",

    rawName: "DEB PETROBRAS",

    ...overrides,
  };
}

function ingestionError(
  input: unknown,
): PortfolioIngestionError {
  try {
    ingestPortfolioCandidate(
      input as PortfolioAssetInput,
    );
  } catch (error) {
    expect(
      error,
    ).toBeInstanceOf(
      PortfolioIngestionError,
    );

    return error as PortfolioIngestionError;
  }

  throw new Error(
    "expected ingestion to fail",
  );
}

function issuesOf(
  input: unknown,
): Array<[string, string]> {
  return ingestionError(
    input,
  ).issues.map((issue) => [
    issue.path,
    issue.code,
  ]);
}

describe(
  "ingestPortfolioCandidate",
  () => {
    beforeEach(() => {
      // Guard: ingestion must never reach the network.
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
      "output",
      () => {
        it(
          "creates a CandidateAsset from a valid minimal input",
          () => {
            expect(
              ingestPortfolioCandidate(
                minimal(),
              ),
            ).toEqual({
              id: "row-1",

              rawName:
                "DEB PETROBRAS",

              source: {},

              hints: {},
            });
          },
        );

        it(
          "returns nothing but a CandidateAsset (no verification or resolution fields)",
          () => {
            const candidate: CandidateAsset =
              ingestPortfolioCandidate(
                minimal({
                  instrumentCode:
                    "ABCD11",
                }),
              );

            expect(
              Object.keys(candidate)
                .sort(),
            ).toEqual([
              "hints",
              "id",
              "rawName",
              "source",
            ]);
          },
        );

        it(
          "omits absent hints instead of writing undefined values",
          () => {
            const candidate =
              ingestPortfolioCandidate(
                minimal({
                  ticker: "petr4",
                }),
              );

            expect(
              Object.keys(
                candidate.hints,
              ),
            ).toEqual(["ticker"]);
          },
        );

        it(
          "produces candidates accepted by the server validation",
          () => {
            const candidate =
              ingestPortfolioCandidate({
                rawName:
                  "  DEB   PETROBRAS ",

                assetType:
                  "debenture",

                ticker: " petr4 ",

                isin: " brpetrdbs000 ",

                cnpj: "33.000.167/0001-01",

                instrumentCode:
                  " abcd11 ",

                issuerName:
                  " Petrobras ",

                fundName: "Fundo X",

                maturityDate:
                  "2030-01-15",

                currency: " brl ",

                amount: 1234.56,

                source: {
                  fileId: "f1",

                  fileName:
                    "extrato.pdf",

                  section: "renda fixa",

                  row: 7,

                  institution:
                    "Corretora X",
                },
              });

            expect(
              validateCandidateAsset(
                candidate,
              ).ok,
            ).toBe(true);
          },
        );

        it(
          "keeps the ingestion limits equal to the server validation limits",
          () => {
            expect(
              INGESTION_LIMITS,
            ).toEqual(
              CANDIDATE_LIMITS,
            );
          },
        );
      },
    );

    describe(
      "id strategy (deterministic, never random)",
      () => {
        it(
          "uses an explicit id as given (trimmed)",
          () => {
            expect(
              ingestPortfolioCandidate(
                minimal({
                  id: "  my-id ",
                }),
              ).id,
            ).toBe("my-id");
          },
        );

        it(
          "derives the id from fileId + row when no id is supplied",
          () => {
            const input: PortfolioAssetInput =
              {
                rawName:
                  "DEB PETROBRAS",

                source: {
                  fileId: "file-9",

                  row: 4,
                },
              };

            const first =
              ingestPortfolioCandidate(
                input,
              );

            const second =
              ingestPortfolioCandidate(
                structuredClone(input),
              );

            expect(first.id).toBe(
              "portfolio:file-9:4",
            );

            expect(first).toEqual(
              second,
            );

            expect(
              ingestPortfolioCandidate({
                ...input,

                source: {
                  fileId: "file-9",

                  row: 5,
                },
              }).id,
            ).not.toBe(first.id);
          },
        );

        it(
          "prefers the explicit id over the derived one",
          () => {
            expect(
              ingestPortfolioCandidate({
                id: "explicit",

                rawName: "X",

                source: {
                  fileId: "f",

                  row: 1,
                },
              }).id,
            ).toBe("explicit");
          },
        );

        it(
          "rejects input whose id cannot be deterministic",
          () => {
            expect(
              issuesOf({
                rawName: "X",
              }),
            ).toEqual([
              ["id", "required"],
            ]);

            expect(
              issuesOf({
                rawName: "X",

                source: {
                  fileId: "f",
                },
              }),
            ).toEqual([
              ["id", "required"],
            ]);

            expect(
              issuesOf({
                rawName: "X",

                source: {
                  row: 1,
                },
              }),
            ).toEqual([
              ["id", "required"],
            ]);
          },
        );

        it(
          "rejects blank, non-string and overlong ids",
          () => {
            expect(
              issuesOf(
                minimal({
                  id: "   ",
                }),
              ),
            ).toEqual([
              ["id", "empty"],
            ]);

            expect(
              issuesOf({
                ...minimal(),

                id: 7,
              }),
            ).toEqual([
              ["id", "type"],
            ]);

            expect(
              issuesOf(
                minimal({
                  id: "x".repeat(
                    INGESTION_LIMITS.id +
                      1,
                  ),
                }),
              ),
            ).toEqual([
              ["id", "too_long"],
            ]);
          },
        );
      },
    );

    describe(
      "conservative normalization",
      () => {
        it(
          "trims rawName and collapses repeated whitespace",
          () => {
            expect(
              ingestPortfolioCandidate(
                minimal({
                  rawName:
                    "  DEB \t  PETROBRAS\n S.A.  ",
                }),
              ).rawName,
            ).toBe(
              "DEB PETROBRAS S.A.",
            );
          },
        );

        it(
          "does not change the case or wording of rawName",
          () => {
            expect(
              ingestPortfolioCandidate(
                minimal({
                  rawName:
                    "Petrobras PN",
                }),
              ).rawName,
            ).toBe("Petrobras PN");
          },
        );

        it(
          "uppercases ticker, isin, instrumentCode and currency",
          () => {
            const { hints } =
              ingestPortfolioCandidate(
                minimal({
                  ticker: " petr4 ",

                  isin: " brpetrdbs000 ",

                  instrumentCode:
                    " abcd11 ",

                  currency: " brl ",
                }),
              );

            expect(hints).toEqual({
              ticker: "PETR4",

              isin: "BRPETRDBS000",

              instrumentCode:
                "ABCD11",

              currency: "BRL",
            });
          },
        );

        it(
          "normalizes cnpj exactly like the registry (digits only)",
          () => {
            const raw =
              " 33.000.167/0001-01 ";

            const { hints } =
              ingestPortfolioCandidate(
                minimal({
                  cnpj: raw,
                }),
              );

            expect(
              hints.cnpj,
            ).toBe(
              normalizeIdentifierValue(
                "cnpj",
                raw,
              ),
            );

            expect(
              hints.cnpj,
            ).toBe("33000167000101");
          },
        );

        it(
          "rejects a non-blank cnpj without digits instead of silently dropping it",
          () => {
            expect(
              issuesOf(
                minimal({
                  cnpj: "abc",
                }),
              ),
            ).toEqual([
              [
                "cnpj",
                "invalid_value",
              ],
            ]);
          },
        );

        it(
          "preserves issuerName, fundName and maturityDate without rewriting them",
          () => {
            expect(
              ingestPortfolioCandidate(
                minimal({
                  issuerName:
                    "  petroleo  brasileiro ",

                  fundName:
                    " Fundo x ",

                  maturityDate:
                    " 2030-01-15 ",
                }),
              ).hints,
            ).toEqual({
              issuerName:
                "petroleo  brasileiro",

              fundName: "Fundo x",

              maturityDate:
                "2030-01-15",
            });
          },
        );

        it(
          "turns blank optional strings into undefined",
          () => {
            const { hints } =
              ingestPortfolioCandidate(
                minimal({
                  ticker: "",

                  isin: "   ",

                  cnpj: " \t ",

                  instrumentCode: "",

                  issuerName: "  ",

                  fundName: "",

                  maturityDate: " ",

                  currency: "",
                }),
              );

            expect(hints).toEqual({});
          },
        );
      },
    );

    describe(
      "provenance",
      () => {
        it(
          "preserves source metadata exactly",
          () => {
            const source = {
              fileId: "file-1",

              fileName:
                "Extrato Jan (1).pdf",

              section:
                "Renda Fixa  Privada",

              row: 12,

              institution:
                "Corretora X",
            };

            expect(
              ingestPortfolioCandidate(
                minimal({
                  source,
                }),
              ).source,
            ).toEqual(source);
          },
        );

        it(
          "drops only blank source values",
          () => {
            expect(
              ingestPortfolioCandidate(
                minimal({
                  source: {
                    fileName: "  ",

                    section: "S",
                  },
                }),
              ).source,
            ).toEqual({
              section: "S",
            });
          },
        );

        it(
          "rejects an invalid source object, row and source texts",
          () => {
            expect(
              issuesOf({
                ...minimal(),

                source: "x",
              }),
            ).toEqual([
              ["source", "type"],
            ]);

            expect(
              issuesOf({
                ...minimal(),

                source: [],
              }),
            ).toEqual([
              ["source", "type"],
            ]);

            expect(
              issuesOf(
                minimal({
                  source: {
                    row: -1,
                  },
                }),
              ),
            ).toEqual([
              [
                "source.row",
                "invalid_value",
              ],
            ]);

            expect(
              issuesOf({
                ...minimal(),

                source: {
                  row: "3",
                },
              }),
            ).toEqual([
              [
                "source.row",
                "type",
              ],
            ]);

            expect(
              issuesOf({
                ...minimal(),

                source: {
                  fileName: 3,
                },
              }),
            ).toEqual([
              [
                "source.fileName",
                "type",
              ],
            ]);
          },
        );
      },
    );

    describe(
      "assetType",
      () => {
        it(
          "preserves an explicit valid assetType",
          () => {
            expect(
              ingestPortfolioCandidate(
                minimal({
                  assetType: "cdb",
                }),
              ).hints.assetType,
            ).toBe("cdb");
          },
        );

        it(
          "does not guess an assetType from rawName",
          () => {
            for (const rawName of [
              "DEB PETROBRAS",
              "Petrobras PN",
              "CDB Banco X 110% CDI",
              "FII XPTO11",
            ]) {
              expect(
                ingestPortfolioCandidate(
                  minimal({
                    rawName,
                  }),
                ).hints.assetType,
              ).toBeUndefined();
            }
          },
        );

        it(
          "rejects an invalid assetType",
          () => {
            expect(
              issuesOf({
                ...minimal(),

                assetType: "bond",
              }),
            ).toEqual([
              [
                "assetType",
                "invalid_value",
              ],
            ]);

            expect(
              issuesOf({
                ...minimal(),

                assetType: 3,
              }),
            ).toEqual([
              ["assetType", "type"],
            ]);
          },
        );
      },
    );

    describe(
      "amount",
      () => {
        it(
          "preserves the amount exactly, including zero and long decimals",
          () => {
            for (const amount of [
              0,
              1234.5678901234,
              0.1 + 0.2,
              1e15,
            ]) {
              expect(
                ingestPortfolioCandidate(
                  minimal({
                    amount,
                  }),
                ).hints.amount,
              ).toBe(amount);
            }
          },
        );

        it(
          "rejects NaN and Infinity",
          () => {
            for (const amount of [
              Number.NaN,
              Number.POSITIVE_INFINITY,
              Number.NEGATIVE_INFINITY,
            ]) {
              expect(
                issuesOf(
                  minimal({
                    amount,
                  }),
                ),
              ).toEqual([
                [
                  "amount",
                  "invalid_value",
                ],
              ]);
            }
          },
        );

        it(
          "rejects negative amounts and never parses formatted monetary text",
          () => {
            expect(
              issuesOf(
                minimal({
                  amount: -1,
                }),
              ),
            ).toEqual([
              [
                "amount",
                "invalid_value",
              ],
            ]);

            expect(
              issuesOf({
                ...minimal(),

                amount:
                  "R$ 1.000,00",
              }),
            ).toEqual([
              ["amount", "type"],
            ]);
          },
        );
      },
    );

    describe(
      "structural validation",
      () => {
        it.each([
          ["undefined", undefined],
          ["null", null],
          ["an array", []],
          ["a string", "x"],
        ])(
          "rejects a non-object input: %s",
          (_label, input) => {
            expect(
              issuesOf(input),
            ).toEqual([["$", "type"]]);
          },
        );

        it(
          "rejects a missing or blank rawName",
          () => {
            expect(
              issuesOf({
                id: "a",
              }),
            ).toEqual([
              ["rawName", "required"],
            ]);

            expect(
              issuesOf(
                minimal({
                  rawName: "   \n ",
                }),
              ),
            ).toEqual([
              ["rawName", "empty"],
            ]);

            expect(
              issuesOf({
                id: "a",

                rawName: 5,
              }),
            ).toEqual([
              ["rawName", "type"],
            ]);
          },
        );

        it(
          "rejects non-string identifiers",
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
              expect(
                issuesOf({
                  ...minimal(),

                  [field]: 123,
                }),
              ).toEqual([
                [field, "type"],
              ]);

              expect(
                issuesOf({
                  ...minimal(),

                  [field]: null,
                }),
              ).toEqual([
                [field, "type"],
              ]);
            }
          },
        );

        it(
          "rejects overlong values and control characters",
          () => {
            expect(
              issuesOf(
                minimal({
                  rawName: "x".repeat(
                    INGESTION_LIMITS.rawName +
                      1,
                  ),
                }),
              ),
            ).toEqual([
              [
                "rawName",
                "too_long",
              ],
            ]);

            expect(
              issuesOf(
                minimal({
                  instrumentCode:
                    "ABCD 11",
                }),
              ),
            ).toEqual([
              [
                "instrumentCode",
                "invalid_value",
              ],
            ]);
          },
        );

        it(
          "rejects unknown fields, including customer data, without echoing key names",
          () => {
            const sentinel =
              "SENTINEL_CUSTOMER_KEY";

            for (const key of [
              "customerName",
              "cpf",
              "accountNumber",
              "totalWealth",
              "portfolioBalance",
              sentinel,
            ]) {
              const error =
                ingestionError({
                  ...minimal(),

                  [key]: "x",
                });

              expect(
                error.issues,
              ).toEqual([
                {
                  path: "$",

                  code: "unknown_field",
                },
              ]);

              expect(
                JSON.stringify(
                  error.issues,
                ),
              ).not.toContain(key);
            }
          },
        );

        it(
          "never echoes submitted values in errors",
          () => {
            const sentinel =
              "SENTINEL_VALUE_555";

            const error =
              ingestionError({
                id: sentinel,

                rawName: 5,

                assetType: sentinel,

                amount: sentinel,

                source: {
                  row: sentinel,
                },
              });

            expect(
              error.message,
            ).not.toContain(sentinel);

            expect(
              JSON.stringify(
                error.issues,
              ),
            ).not.toContain(sentinel);
          },
        );
      },
    );

    describe(
      "no identity inference (a CandidateAsset stays unresolved input)",
      () => {
        it(
          "does not turn 'Petrobras PN' into PETR4",
          () => {
            const { hints } =
              ingestPortfolioCandidate(
                minimal({
                  rawName:
                    "Petrobras PN",
                }),
              );

            expect(
              hints.ticker,
            ).toBeUndefined();

            expect(hints).toEqual({});
          },
        );

        it(
          "does not extract an ISIN-like string from rawName",
          () => {
            expect(
              ingestPortfolioCandidate(
                minimal({
                  rawName:
                    "DEB PETROBRAS BRPETRDBS000",
                }),
              ).hints.isin,
            ).toBeUndefined();
          },
        );

        it(
          "does not infer instrumentCode, cnpj or issuerName from rawName",
          () => {
            const { hints } =
              ingestPortfolioCandidate(
                minimal({
                  rawName:
                    "ABCD11 Petrobras 33.000.167/0001-01",
                }),
              );

            expect(
              hints.instrumentCode,
            ).toBeUndefined();

            expect(
              hints.cnpj,
            ).toBeUndefined();

            expect(
              hints.issuerName,
            ).toBeUndefined();
          },
        );

        it(
          "performs no fuzzy matching: near-identical names stay distinct and unchanged",
          () => {
            expect(
              ingestPortfolioCandidate(
                minimal({
                  rawName:
                    "PETROB",
                }),
              ).rawName,
            ).toBe("PETROB");

            expect(
              ingestPortfolioCandidate(
                minimal({
                  rawName:
                    "PETROBRAS",
                }),
              ).rawName,
            ).toBe("PETROBRAS");
          },
        );

        it(
          "never calls providers or the network",
          () => {
            const globalFetch = vi.fn();

            vi.stubGlobal(
              "fetch",
              globalFetch,
            );

            ingestPortfolioCandidates([
              minimal({
                instrumentCode:
                  "ABCD11",
              }),
            ]);

            expect(
              globalFetch,
            ).not.toHaveBeenCalled();
          },
        );

        it(
          "imports only domain contracts and the registry normalization",
          () => {
            const source = readFileSync(
              new URL(
                "./portfolio-candidate-ingestion.ts",
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

            const imports =
              Array.from(
                source.matchAll(
                  /from\s*["']([^"']+)["']/g,
                ),
                (match) => match[1],
              ).sort();

            expect(imports).toEqual([
              "../contracts",
              "../registry/normalize",
            ]);

            for (const forbidden of [
              "process.env",
              "fetch(",
              "Math.random",
              "console.",
            ]) {
              expect(
                source,
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

describe(
  "ingestPortfolioCandidates",
  () => {
    it(
      "preserves the input order",
      () => {
        const result =
          ingestPortfolioCandidates([
            minimal({
              id: "c",

              rawName: "Third",
            }),
            minimal({
              id: "a",

              rawName: "First",
            }),
            minimal({
              id: "b",

              rawName: "Second",
            }),
          ]);

        expect(
          result.map(
            (candidate) =>
              candidate.id,
          ),
        ).toEqual(["c", "a", "b"]);
      },
    );

    it(
      "uses the single-item ingestion as the source of truth",
      () => {
        const input = minimal({
          ticker: " petr4 ",

          amount: 10,
        });

        expect(
          ingestPortfolioCandidates([
            input,
          ]),
        ).toEqual([
          ingestPortfolioCandidate(
            input,
          ),
        ]);
      },
    );

    it(
      "returns an empty array for an empty batch",
      () => {
        expect(
          ingestPortfolioCandidates(
            [],
          ),
        ).toEqual([]);
      },
    );

    it(
      "FAIL-FAST: throws at the first invalid item with its index and returns no partial result",
      () => {
        let thrown: unknown;

        try {
          ingestPortfolioCandidates([
            minimal({
              id: "ok",
            }),
            {
              id: "bad-1",

              rawName: "   ",
            },
            {
              id: "bad-2",

              rawName: "",
            },
          ]);
        } catch (error) {
          thrown = error;
        }

        expect(
          thrown,
        ).toBeInstanceOf(
          PortfolioIngestionError,
        );

        const error =
          thrown as PortfolioIngestionError;

        expect(error.index).toBe(1);

        expect(
          error.message,
        ).toBe(
          "Invalid portfolio asset at index 1.",
        );

        expect(
          error.issues,
        ).toEqual([
          {
            path: "rawName",

            code: "empty",
          },
        ]);
      },
    );

    it(
      "rejects a non-array batch",
      () => {
        expect(
          () =>
            ingestPortfolioCandidates(
              "x" as unknown as PortfolioAssetInput[],
            ),
        ).toThrow(
          PortfolioIngestionError,
        );
      },
    );
  },
);
