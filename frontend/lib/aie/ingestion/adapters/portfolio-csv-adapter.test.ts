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
  ingestPortfolioCandidates,
  PortfolioIngestionError,
} from "../portfolio-candidate-ingestion";

import {
  CSV_CANONICAL_HEADERS,
  ingestPortfolioCsv,
  parsePortfolioCsv,
  PortfolioCsvAdapterError,
} from "./portfolio-csv-adapter";

function csv(
  ...lines: string[]
): string {
  return lines.join("\n");
}

function csvError(
  input: unknown,
): PortfolioCsvAdapterError {
  try {
    parsePortfolioCsv(
      input as string,
    );
  } catch (error) {
    expect(
      error,
    ).toBeInstanceOf(
      PortfolioCsvAdapterError,
    );

    return error as PortfolioCsvAdapterError;
  }

  throw new Error(
    "expected the CSV adapter to fail",
  );
}

function issuesOf(
  input: unknown,
): Array<[string, string]> {
  return csvError(
    input,
  ).issues.map((issue) => [
    issue.path,
    issue.code,
  ]);
}

const BOM = String.fromCharCode(
  0xfeff,
);

describe(
  "CSV portfolio adapter",
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
      "syntax",
      () => {
        it(
          "parses a minimal valid CSV",
          () => {
            expect(
              parsePortfolioCsv(
                csv(
                  "rawName",
                  "DEB PETROBRAS",
                ),
              ),
            ).toEqual([
              {
                rawName:
                  "DEB PETROBRAS",
              },
            ]);

            expect(
              ingestPortfolioCsv(
                csv(
                  "id,rawName",
                  "r1,DEB PETROBRAS",
                ),
              ),
            ).toEqual([
              {
                id: "r1",

                rawName:
                  "DEB PETROBRAS",

                source: {},

                hints: {},
              },
            ]);
          },
        );

        it(
          "preserves the order of multiple assets",
          () => {
            const result =
              parsePortfolioCsv(
                csv(
                  "id,rawName",
                  "c,Third",
                  "a,First",
                  "b,Second",
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
          "parses a quoted rawName",
          () => {
            expect(
              parsePortfolioCsv(
                csv(
                  "rawName",
                  '"DEB PETROBRAS"',
                ),
              )[0]?.rawName,
            ).toBe("DEB PETROBRAS");
          },
        );

        it(
          "keeps a comma inside a quoted field",
          () => {
            expect(
              parsePortfolioCsv(
                csv(
                  "rawName,ticker",
                  '"Petrobras, S.A.",PETR4',
                ),
              )[0],
            ).toEqual({
              rawName:
                "Petrobras, S.A.",

              ticker: "PETR4",
            });
          },
        );

        it(
          "unescapes a doubled quote inside a quoted field",
          () => {
            expect(
              parsePortfolioCsv(
                csv(
                  "rawName",
                  '"DEB ""X"" PETROBRAS"',
                ),
              )[0]?.rawName,
            ).toBe(
              'DEB "X" PETROBRAS',
            );
          },
        );

        it(
          "keeps a line break inside a quoted field (ingestion collapses it)",
          () => {
            const input = csv(
              "id,rawName",
              '1,"DEB' + "\n" + 'PETROBRAS"',
            );

            expect(
              parsePortfolioCsv(
                input,
              )[0]?.rawName,
            ).toBe("DEB\nPETROBRAS");

            expect(
              ingestPortfolioCsv(
                input,
              )[0]?.rawName,
            ).toBe("DEB PETROBRAS");
          },
        );

        it(
          "accepts LF line endings",
          () => {
            expect(
              parsePortfolioCsv(
                "id,rawName\na,One\nb,Two\n",
              ).map(
                (item) => item.id,
              ),
            ).toEqual(["a", "b"]);
          },
        );

        it(
          "accepts CRLF line endings",
          () => {
            expect(
              parsePortfolioCsv(
                "id,rawName\r\na,One\r\nb,Two\r\n",
              ).map(
                (item) => item.id,
              ),
            ).toEqual(["a", "b"]);
          },
        );

        it(
          "handles a UTF-8 BOM at the start",
          () => {
            expect(
              parsePortfolioCsv(
                BOM +
                  csv(
                    "rawName",
                    "DEB PETROBRAS",
                  ),
              ),
            ).toEqual([
              {
                rawName:
                  "DEB PETROBRAS",
              },
            ]);
          },
        );

        it(
          "does not require a trailing newline and ignores one",
          () => {
            expect(
              parsePortfolioCsv(
                "rawName\nA",
              ),
            ).toHaveLength(1);

            expect(
              parsePortfolioCsv(
                "rawName\nA\n",
              ),
            ).toHaveLength(1);
          },
        );

        it(
          "skips blank lines",
          () => {
            expect(
              parsePortfolioCsv(
                "rawName\n\nA\n\n\nB\n",
              ).map(
                (item) =>
                  item.rawName,
              ),
            ).toEqual(["A", "B"]);
          },
        );

        it(
          "treats a header-only CSV as an empty portfolio",
          () => {
            expect(
              parsePortfolioCsv(
                "id,rawName\n",
              ),
            ).toEqual([]);

            expect(
              ingestPortfolioCsv(
                "id,rawName",
              ),
            ).toEqual([]);
          },
        );

        it(
          "keeps a trailing empty cell",
          () => {
            expect(
              parsePortfolioCsv(
                csv(
                  "rawName,ticker",
                  "X,",
                ),
              ),
            ).toEqual([
              {
                rawName: "X",
              },
            ]);
          },
        );
      },
    );

    describe(
      "cells and mapping",
      () => {
        it(
          "omits empty optional cells",
          () => {
            const [asset] =
              parsePortfolioCsv(
                csv(
                  CSV_CANONICAL_HEADERS.join(
                    ",",
                  ),
                  [
                    "r1",
                    "X",
                    ...Array<string>(
                      CSV_CANONICAL_HEADERS.length -
                        2,
                    ).fill(""),
                  ].join(","),
                ),
              );

            expect(asset).toEqual({
              id: "r1",

              rawName: "X",
            });
          },
        );

        it(
          "maps every canonical header",
          () => {
            const [asset] =
              parsePortfolioCsv(
                csv(
                  CSV_CANONICAL_HEADERS.join(
                    ",",
                  ),
                  "r1,DEB X,debenture,PETR4,BRPETRDBS000,33.000.167/0001-01,ABCD11,Petrobras,Fundo,2030-01-15,BRL,1234.56,f1,extrato.csv,renda fixa,7,Corretora",
                ),
              );

            expect(asset).toEqual({
              id: "r1",

              rawName: "DEB X",

              assetType:
                "debenture",

              ticker: "PETR4",

              isin: "BRPETRDBS000",

              cnpj: "33.000.167/0001-01",

              instrumentCode:
                "ABCD11",

              issuerName:
                "Petrobras",

              fundName: "Fundo",

              maturityDate:
                "2030-01-15",

              currency: "BRL",

              amount: 1234.56,

              source: {
                fileId: "f1",

                fileName:
                  "extrato.csv",

                section:
                  "renda fixa",

                row: 7,

                institution:
                  "Corretora",
              },
            });
          },
        );

        it(
          "accepts headers in any order and trims spaces around header names",
          () => {
            expect(
              parsePortfolioCsv(
                csv(
                  " ticker , rawName ",
                  "PETR4,X",
                ),
              ),
            ).toEqual([
              {
                rawName: "X",

                ticker: "PETR4",
              },
            ]);
          },
        );

        it(
          "preserves an explicit id",
          () => {
            expect(
              ingestPortfolioCsv(
                csv(
                  "id,rawName",
                  "explicit-id,X",
                ),
              )[0]?.id,
            ).toBe("explicit-id");
          },
        );

        it(
          "still derives the id from fileId + row through ingestion",
          () => {
            const [candidate] =
              ingestPortfolioCsv(
                csv(
                  "rawName,fileId,row",
                  "X,file-9,3",
                ),
              );

            expect(
              candidate?.id,
            ).toBe(
              "portfolio:file-9:3",
            );

            expect(
              candidate?.source,
            ).toEqual({
              fileId: "file-9",

              row: 3,
            });
          },
        );

        it(
          "passes assetType through only when it is an allowed value",
          () => {
            expect(
              parsePortfolioCsv(
                csv(
                  "rawName,assetType",
                  "X,cdb",
                ),
              )[0]?.assetType,
            ).toBe("cdb");

            for (const bad of [
              "bond",
              "DEBENTURE",
              " cdb",
            ]) {
              expect(
                issuesOf(
                  csv(
                    "rawName,assetType",
                    `X,${bad}`,
                  ),
                ),
              ).toEqual([
                [
                  "row[2].assetType",
                  "invalid_value",
                ],
              ]);
            }
          },
        );
      },
    );

    describe(
      "normalization happens only in ingestion",
      () => {
        it(
          "does not normalize ticker, instrumentCode, cnpj, currency or rawName in the adapter",
          () => {
            const [parsed] =
              parsePortfolioCsv(
                csv(
                  "rawName,ticker,instrumentCode,cnpj,currency",
                  "  DEB   X ,  petr4 , abcd11 ,33.000.167/0001-01, brl ",
                ),
              );

            expect(parsed).toEqual({
              rawName:
                "  DEB   X ",

              ticker: "  petr4 ",

              instrumentCode:
                " abcd11 ",

              cnpj: "33.000.167/0001-01",

              currency: " brl ",
            });
          },
        );

        it(
          "normalizes ticker, instrumentCode, cnpj and currency in ingestion",
          () => {
            const [candidate] =
              ingestPortfolioCsv(
                csv(
                  "id,rawName,ticker,instrumentCode,cnpj,currency",
                  "r1,  DEB   X ,  petr4 , abcd11 ,33.000.167/0001-01, brl ",
                ),
              );

            expect(
              candidate?.rawName,
            ).toBe("DEB X");

            expect(
              candidate?.hints,
            ).toEqual({
              ticker: "PETR4",

              instrumentCode:
                "ABCD11",

              cnpj: "33000167000101",

              currency: "BRL",
            });
          },
        );

        it(
          "equals parse + ingestPortfolioCandidates",
          () => {
            const input = csv(
              "id,rawName,ticker,amount",
              "a,One, petr4 ,10",
              "b,Two,,20.5",
            );

            expect(
              ingestPortfolioCsv(
                input,
              ),
            ).toEqual(
              ingestPortfolioCandidates(
                parsePortfolioCsv(
                  input,
                ),
              ),
            );
          },
        );

        it(
          "lets ingestion reject an empty rawName row",
          () => {
            const input = csv(
              "id,rawName",
              "a,One",
              "b,",
            );

            expect(
              parsePortfolioCsv(
                input,
              )[1]?.rawName,
            ).toBe("");

            let caught: unknown;

            try {
              ingestPortfolioCsv(
                input,
              );
            } catch (error) {
              caught = error;
            }

            expect(
              caught,
            ).toBeInstanceOf(
              PortfolioIngestionError,
            );

            expect(
              (
                caught as PortfolioIngestionError
              ).index,
            ).toBe(1);
          },
        );

        it(
          "lets ingestion reject a negative amount",
          () => {
            const input = csv(
              "id,rawName,amount",
              "a,One,-5",
            );

            expect(
              parsePortfolioCsv(
                input,
              )[0]?.amount,
            ).toBe(-5);

            expect(() =>
              ingestPortfolioCsv(
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
      "headers",
      () => {
        it(
          "rejects an unknown header without echoing its name",
          () => {
            const name =
              "SENTINEL_HEADER_NAME";

            const error = csvError(
              csv(
                `rawName,${name}`,
                "X,1",
              ),
            );

            expect(
              error.issues,
            ).toEqual([
              {
                path: "header[2]",

                code: "unknown_field",
              },
            ]);

            expect(
              JSON.stringify(error),
            ).not.toContain(name);
          },
        );

        it(
          "rejects headers that only differ by case or spelling (no fuzzy matching)",
          () => {
            for (const header of [
              "RAWNAME",
              "rawname",
              "raw_name",
              "Raw Name",
              "isinCode",
            ]) {
              expect(
                issuesOf(
                  csv(
                    `rawName,${header}`,
                    "X,1",
                  ),
                ),
              ).toEqual([
                [
                  "header[2]",
                  "unknown_field",
                ],
              ]);
            }
          },
        );

        it(
          "rejects a duplicate header",
          () => {
            expect(
              issuesOf(
                csv(
                  "rawName,ticker,ticker",
                  "X,A,B",
                ),
              ),
            ).toEqual([
              [
                "header[3]",
                "duplicate_header",
              ],
            ]);

            expect(
              issuesOf(
                csv(
                  "rawName, rawName",
                  "X,Y",
                ),
              ),
            ).toEqual([
              [
                "header[2]",
                "duplicate_header",
              ],
            ]);
          },
        );

        it(
          "rejects an empty header name",
          () => {
            expect(
              issuesOf(
                csv(
                  "rawName,,ticker",
                  "X,1,A",
                ),
              ),
            ).toEqual([
              [
                "header[2]",
                "empty_header",
              ],
            ]);

            expect(
              issuesOf(
                csv(
                  "rawName,   ",
                  "X,1",
                ),
              ),
            ).toEqual([
              [
                "header[2]",
                "empty_header",
              ],
            ]);
          },
        );

        it(
          "rejects sensitive customer and secret headers",
          () => {
            for (const header of [
              "customerName",
              "cpf",
              "accountNumber",
              "totalWealth",
              "portfolioBalance",
              "password",
              "token",
              "access_token",
              "clientSecret",
              "CPF",
              "client_secret",
            ]) {
              const error = csvError(
                csv(
                  `rawName,${header}`,
                  "X,secret-value",
                ),
              );

              expect(
                error.issues,
              ).toEqual([
                {
                  path: "header[2]",

                  code: "forbidden_field",
                },
              ]);

              expect(
                JSON.stringify(error),
              ).not.toContain(
                header,
              );
            }
          },
        );

        it(
          "rejects a missing rawName header",
          () => {
            expect(
              issuesOf(
                csv(
                  "id,ticker",
                  "a,PETR4",
                ),
              ),
            ).toEqual([
              [
                "header",
                "required",
              ],
            ]);
          },
        );

        it(
          "rejects empty and whitespace-only CSV (no header)",
          () => {
            expect(
              issuesOf(""),
            ).toEqual([
              [
                "header",
                "required",
              ],
            ]);

            expect(
              issuesOf("\n\n"),
            ).toEqual([
              [
                "header",
                "required",
              ],
            ]);
          },
        );

        it(
          "reports all header problems together",
          () => {
            expect(
              issuesOf(
                csv(
                  ",ticker,ticker,zzz,cpf",
                  "1,2,3,4,5",
                ),
              ),
            ).toEqual([
              [
                "header[1]",
                "empty_header",
              ],
              [
                "header[3]",
                "duplicate_header",
              ],
              [
                "header[4]",
                "unknown_field",
              ],
              [
                "header[5]",
                "forbidden_field",
              ],
              [
                "header",
                "required",
              ],
            ]);
          },
        );
      },
    );

    describe(
      "numeric parsing",
      () => {
        function amountOf(
          cell: string,
        ): number | undefined {
          return parsePortfolioCsv(
            csv(
              "rawName,amount",
              `X,${cell}`,
            ),
          )[0]?.amount;
        }

        it(
          "parses canonical decimal amounts exactly",
          () => {
            expect(
              amountOf("1234.56"),
            ).toBe(1234.56);

            expect(
              amountOf("1000"),
            ).toBe(1000);

            expect(
              amountOf("0"),
            ).toBe(0);

            expect(
              amountOf("0.5"),
            ).toBe(0.5);

            expect(
              amountOf(
                "123456789012345",
              ),
            ).toBe(123456789012345);
          },
        );

        it(
          "treats an empty or whitespace-only amount cell as absent",
          () => {
            expect(
              amountOf(""),
            ).toBeUndefined();

            expect(
              amountOf("   "),
            ).toBeUndefined();
          },
        );

        it.each([
          ["R$ 1.000,00"],
          ["1.000,00"],
          ["1,5"],
          ["R$1000"],
          ["1e3"],
          ["1E3"],
          ["+5"],
          [".5"],
          ["5."],
          ["0x10"],
          [" 10"],
          ["10 "],
          ["1 000"],
          ["--5"],
          ["abc"],
        ])(
          "rejects the non-canonical amount %j",
          (cell) => {
            const value =
              cell.includes(",")
                ? `"${cell}"`
                : cell;

            expect(
              issuesOf(
                csv(
                  "rawName,amount",
                  `X,${value}`,
                ),
              ),
            ).toEqual([
              [
                "row[2].amount",
                "invalid_value",
              ],
            ]);
          },
        );

        it(
          "rejects NaN-like and Infinity-like values",
          () => {
            for (const cell of [
              "NaN",
              "nan",
              "Infinity",
              "-Infinity",
              "inf",
              "1e999",
            ]) {
              expect(
                issuesOf(
                  csv(
                    "rawName,amount",
                    `X,${cell}`,
                  ),
                ),
              ).toEqual([
                [
                  "row[2].amount",
                  "invalid_value",
                ],
              ]);
            }
          },
        );

        it(
          "rejects an amount that would lose double precision",
          () => {
            expect(
              issuesOf(
                csv(
                  "rawName,amount",
                  "X,1234567890123456",
                ),
              ),
            ).toEqual([
              [
                "row[2].amount",
                "invalid_value",
              ],
            ]);

            expect(
              issuesOf(
                csv(
                  "rawName,amount",
                  "X," +
                    "9".repeat(400),
                ),
              ),
            ).toEqual([
              [
                "row[2].amount",
                "invalid_value",
              ],
            ]);
          },
        );

        it(
          "parses row as a non-negative integer",
          () => {
            expect(
              parsePortfolioCsv(
                csv(
                  "rawName,row",
                  "X,12",
                  "Y,0",
                ),
              ).map(
                (item) =>
                  item.source?.row,
              ),
            ).toEqual([12, 0]);

            expect(
              parsePortfolioCsv(
                csv(
                  "rawName,row",
                  "X,",
                ),
              )[0]?.source,
            ).toBeUndefined();
          },
        );

        it.each([
          ["-1"],
          ["1.5"],
          ["1e2"],
          ["abc"],
          ["+3"],
          ["9007199254740993"],
        ])(
          "rejects the invalid row %j",
          (cell) => {
            expect(
              issuesOf(
                csv(
                  "rawName,row",
                  `X,${cell}`,
                ),
              ),
            ).toEqual([
              [
                "row[2].row",
                "invalid_value",
              ],
            ]);
          },
        );
      },
    );

    describe(
      "malformed CSV",
      () => {
        it.each([
          [
            "an unterminated quote",
            'rawName\n"abc',
          ],
          [
            "a quote inside an unquoted field",
            'rawName\nab"c',
          ],
          [
            "text after a closing quote",
            'rawName\n"ab"c',
          ],
          [
            "a lone CR outside quotes",
            "rawName\nab\rcd",
          ],
          [
            "a quote after a partial field",
            'rawName,ticker\nX,a"b"',
          ],
        ])(
          "rejects %s",
          (_label, input) => {
            const error =
              csvError(input);

            expect(
              error.issues.length,
            ).toBe(1);

            expect(
              error.issues[0]?.code,
            ).toBe("malformed_csv");

            expect(
              error.issues[0]?.path,
            ).toBe("row[2]");
          },
        );

        it(
          "does not echo the malformed content",
          () => {
            const error = csvError(
              'rawName\n"SENTINEL_CELL_TEXT',
            );

            expect(
              JSON.stringify(error),
            ).not.toContain(
              "SENTINEL_CELL_TEXT",
            );
          },
        );

        it(
          "rejects extra columns",
          () => {
            expect(
              issuesOf(
                csv(
                  "rawName,ticker",
                  "X,A,B",
                ),
              ),
            ).toEqual([
              [
                "row[2]",
                "extra_columns",
              ],
            ]);
          },
        );

        it(
          "rejects missing columns",
          () => {
            expect(
              issuesOf(
                csv(
                  "rawName,ticker",
                  "X",
                ),
              ),
            ).toEqual([
              [
                "row[2]",
                "missing_columns",
              ],
            ]);
          },
        );

        it(
          "rejects a non-string input",
          () => {
            for (const input of [
              undefined,
              null,
              5,
              {},
            ]) {
              expect(
                issuesOf(input),
              ).toEqual([
                [
                  "$",
                  "invalid_value",
                ],
              ]);
            }
          },
        );
      },
    );

    describe(
      "fail-fast and safe errors",
      () => {
        it(
          "throws at the first invalid row with its row number and no partial result",
          () => {
            const error = csvError(
              csv(
                "rawName,amount",
                "A,1",
                "B,bad",
                "C,alsobad",
              ),
            );

            expect(
              error.row,
            ).toBe(3);

            expect(
              error.message,
            ).toBe(
              "Invalid portfolio CSV at row 3.",
            );

            expect(
              error.issues,
            ).toEqual([
              {
                path: "row[3].amount",

                code: "invalid_value",
              },
            ]);
          },
        );

        it(
          "reports all problems of the failing row",
          () => {
            expect(
              issuesOf(
                csv(
                  "rawName,amount,row,assetType",
                  "A,x,y,z",
                ),
              ),
            ).toEqual([
              [
                "row[2].assetType",
                "invalid_value",
              ],
              [
                "row[2].amount",
                "invalid_value",
              ],
              [
                "row[2].row",
                "invalid_value",
              ],
            ]);
          },
        );

        it(
          "counts blank lines when numbering rows",
          () => {
            expect(
              csvError(
                "rawName,amount\n\nA,bad",
              ).row,
            ).toBe(3);
          },
        );

        it(
          "never echoes cell values or row contents in errors",
          () => {
            const value =
              "SENTINEL_CELL_VALUE_42";

            const error = csvError(
              csv(
                "rawName,amount,assetType",
                `${value},${value},${value}`,
              ),
            );

            expect(
              JSON.stringify({
                message:
                  error.message,

                issues: error.issues,
              }),
            ).not.toContain(value);
          },
        );

        it(
          "does not echo sensitive data placed in a rejected column",
          () => {
            const secret =
              "SENTINEL_SECRET_777";

            const error = csvError(
              csv(
                "rawName,password",
                `X,${secret}`,
              ),
            );

            expect(
              JSON.stringify(error),
            ).not.toContain(secret);
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
              ingestPortfolioCsv(
                csv(
                  "id,rawName",
                  "r1,Petrobras PN",
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
              ingestPortfolioCsv(
                csv(
                  "id,rawName",
                  "r1,DEB PETROBRAS BRPETRDBS000",
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
              ingestPortfolioCsv(
                csv(
                  "id,rawName",
                  "r1,CDB ABCD11 Petrobras 33.000.167/0001-01",
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
              parsePortfolioCsv(
                csv(
                  "rawName",
                  "PETROB",
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
              "./portfolio-csv-adapter.ts",
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

            ingestPortfolioCsv(
              csv(
                "id,rawName",
                "r1,X",
              ),
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
          "imports only domain contracts, the ingestion layer and the shared privacy predicate",
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
              "./structured-portfolio-adapter",
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
              ".toUpperCase(",
              ".toLowerCase(",
              "normalizeIdentifierValue",
              "normalizeAlias",
              "portfolio:",
              '.split(",")',
              ".split(',')",
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
