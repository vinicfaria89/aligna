import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CANDIDATE_LIMITS,
  validateCandidateAsset,
} from "./candidate-asset-validation";

function valid(): Record<
  string,
  unknown
> {
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

function withHints(
  hints: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...valid(),

    hints,
  };
}

function issuesOf(
  input: unknown,
): Array<[string, string]> {
  const result =
    validateCandidateAsset(input);

  if (result.ok) {
    return [];
  }

  return result.issues.map(
    (issue) => [
      issue.path,
      issue.code,
    ],
  );
}

describe(
  "validateCandidateAsset",
  () => {
    it(
      "accepts a valid CandidateAsset and returns a fresh object",
      () => {
        const input = valid();

        const result =
          validateCandidateAsset(
            input,
          );

        expect(result.ok).toBe(true);

        if (result.ok) {
          expect(
            result.value,
          ).toEqual(input);

          expect(
            result.value,
          ).not.toBe(input);
        }
      },
    );

    it(
      "accepts every documented hint and source field",
      () => {
        const result =
          validateCandidateAsset({
            id: "asset-1",

            rawName: "DEB PETROBRAS",

            source: {
              fileId: "f1",

              fileName: "extrato.pdf",

              section: "renda fixa",

              row: 3,

              institution:
                "Corretora X",
            },

            hints: {
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

              amount: 1234.5,
            },
          });

        expect(result.ok).toBe(true);
      },
    );

    it.each([
      ["null", null],
      ["an array", []],
      ["a string", "asset"],
      ["a number", 42],
    ])(
      "rejects a non-object body: %s",
      (_label, input) => {
        expect(
          issuesOf(input),
        ).toEqual([["$", "type"]]);
      },
    );

    it(
      "rejects missing and empty id/rawName",
      () => {
        expect(
          issuesOf({
            ...valid(),

            id: undefined,
          }),
        ).toEqual([
          ["id", "required"],
        ]);

        expect(
          issuesOf({
            ...valid(),

            id: "  ",
          }),
        ).toEqual([["id", "empty"]]);

        expect(
          issuesOf({
            ...valid(),

            rawName: undefined,
          }),
        ).toEqual([
          ["rawName", "required"],
        ]);

        expect(
          issuesOf({
            ...valid(),

            rawName: "",
          }),
        ).toEqual([
          ["rawName", "empty"],
        ]);
      },
    );

    it(
      "rejects wrong types for id, rawName, source and hints without coercion",
      () => {
        expect(
          issuesOf({
            ...valid(),

            id: 123,
          }),
        ).toEqual([["id", "type"]]);

        expect(
          issuesOf({
            ...valid(),

            source: "x",
          }),
        ).toEqual([
          ["source", "type"],
        ]);

        expect(
          issuesOf({
            ...valid(),

            hints: [],
          }),
        ).toEqual([
          ["hints", "type"],
        ]);
      },
    );

    it(
      "rejects missing source and hints",
      () => {
        expect(
          issuesOf({
            id: "a",

            rawName: "b",
          }),
        ).toEqual([
          ["source", "required"],
          ["hints", "required"],
        ]);
      },
    );

    it(
      "rejects an invalid assetType",
      () => {
        expect(
          issuesOf(
            withHints({
              assetType: "bond",
            }),
          ),
        ).toEqual([
          [
            "hints.assetType",
            "invalid_value",
          ],
        ]);

        expect(
          issuesOf(
            withHints({
              assetType: 5,
            }),
          ),
        ).toEqual([
          ["hints.assetType", "type"],
        ]);

        expect(
          issuesOf(
            withHints({
              assetType:
                "__proto__",
            }),
          ),
        ).toEqual([
          [
            "hints.assetType",
            "invalid_value",
          ],
        ]);
      },
    );

    it.each([
      "ticker",
      "isin",
      "cnpj",
      "instrumentCode",
      "issuerName",
      "fundName",
      "maturityDate",
      "currency",
    ])(
      "rejects a non-string %s",
      (field) => {
        expect(
          issuesOf(
            withHints({
              [field]: 123,
            }),
          ),
        ).toEqual([
          [`hints.${field}`, "type"],
        ]);

        expect(
          issuesOf(
            withHints({
              [field]: null,
            }),
          ),
        ).toEqual([
          [`hints.${field}`, "type"],
        ]);
      },
    );

    it(
      "rejects blank and control-character strings",
      () => {
        expect(
          issuesOf(
            withHints({
              instrumentCode:
                "   ",
            }),
          ),
        ).toEqual([
          [
            "hints.instrumentCode",
            "empty",
          ],
        ]);

        expect(
          issuesOf(
            withHints({
              instrumentCode:
                "ABCD\n11",
            }),
          ),
        ).toEqual([
          [
            "hints.instrumentCode",
            "invalid_value",
          ],
        ]);
      },
    );

    it(
      "rejects overlong strings",
      () => {
        expect(
          issuesOf({
            ...valid(),

            rawName: "x".repeat(
              CANDIDATE_LIMITS.rawName +
                1,
            ),
          }),
        ).toEqual([
          ["rawName", "too_long"],
        ]);

        expect(
          issuesOf({
            ...valid(),

            id: "x".repeat(
              CANDIDATE_LIMITS.id + 1,
            ),
          }),
        ).toEqual([
          ["id", "too_long"],
        ]);

        expect(
          issuesOf(
            withHints({
              instrumentCode:
                "x".repeat(
                  CANDIDATE_LIMITS.instrumentCode +
                    1,
                ),
            }),
          ),
        ).toEqual([
          [
            "hints.instrumentCode",
            "too_long",
          ],
        ]);

        // The limit itself is accepted.
        expect(
          validateCandidateAsset({
            ...valid(),

            rawName: "x".repeat(
              CANDIDATE_LIMITS.rawName,
            ),
          }).ok,
        ).toBe(true);
      },
    );

    it(
      "rejects a non-numeric, non-finite or negative amount",
      () => {
        expect(
          issuesOf(
            withHints({
              amount: "10",
            }),
          ),
        ).toEqual([
          ["hints.amount", "type"],
        ]);

        for (const amount of [
          Number.POSITIVE_INFINITY,
          Number.NaN,
          -1,
        ]) {
          expect(
            issuesOf(
              withHints({
                amount,
              }),
            ),
          ).toEqual([
            [
              "hints.amount",
              "invalid_value",
            ],
          ]);
        }

        expect(
          validateCandidateAsset(
            withHints({
              amount: 0,
            }),
          ).ok,
        ).toBe(true);
      },
    );

    it(
      "rejects invalid source fields",
      () => {
        expect(
          issuesOf({
            ...valid(),

            source: {
              row: 1.5,
            },
          }),
        ).toEqual([
          [
            "source.row",
            "invalid_value",
          ],
        ]);

        expect(
          issuesOf({
            ...valid(),

            source: {
              row: "3",
            },
          }),
        ).toEqual([
          ["source.row", "type"],
        ]);

        expect(
          issuesOf({
            ...valid(),

            source: {
              fileName: 7,
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

    it(
      "rejects unknown fields at every level without echoing their names",
      () => {
        const secretKey =
          "SENTINEL_UNKNOWN_KEY_NAME";

        const result = [
          validateCandidateAsset({
            ...valid(),

            [secretKey]: "x",
          }),

          validateCandidateAsset({
            ...valid(),

            source: {
              [secretKey]: "x",
            },
          }),

          validateCandidateAsset(
            withHints({
              [secretKey]: "x",
            }),
          ),
        ];

        expect(
          result.map((entry) =>
            entry.ok
              ? []
              : entry.issues,
          ),
        ).toEqual([
          [
            {
              path: "$",

              code: "unknown_field",
            },
          ],
          [
            {
              path: "source",

              code: "unknown_field",
            },
          ],
          [
            {
              path: "hints",

              code: "unknown_field",
            },
          ],
        ]);

        expect(
          JSON.stringify(result),
        ).not.toContain(secretKey);
      },
    );

    it(
      "rejects fields a client must never control",
      () => {
        for (const forbidden of [
          "ANBIMA_CLIENT_SECRET",
          "access_token",
          "provider",
          "environment",
          "url",
        ]) {
          expect(
            issuesOf({
              ...valid(),

              [forbidden]: "x",
            }),
          ).toEqual([
            ["$", "unknown_field"],
          ]);

          expect(
            issuesOf(
              withHints({
                [forbidden]: "x",
              }),
            ),
          ).toEqual([
            [
              "hints",
              "unknown_field",
            ],
          ]);
        }
      },
    );

    it(
      "rejects a __proto__ key parsed from JSON",
      () => {
        const parsed = JSON.parse(
          '{"id":"a","rawName":"b","source":{},"hints":{},"__proto__":{"x":1}}',
        );

        expect(
          issuesOf(parsed),
        ).toEqual([
          ["$", "unknown_field"],
        ]);
      },
    );

    it(
      "never echoes submitted values in issues",
      () => {
        const sentinel =
          "SENTINEL_VALUE_987";

        const result =
          validateCandidateAsset({
            id: sentinel,

            rawName: 123,

            source: {},

            hints: {
              assetType: sentinel,

              amount: sentinel,
            },
          });

        expect(
          JSON.stringify(result),
        ).not.toContain(sentinel);
      },
    );

    it(
      "reports every problem, up to a bounded number of issues",
      () => {
        const hints: Record<
          string,
          unknown
        > = {};

        for (const key of [
          "ticker",
          "isin",
          "cnpj",
          "instrumentCode",
          "issuerName",
          "fundName",
          "maturityDate",
          "currency",
          "amount",
          "assetType",
        ]) {
          hints[key] = false;
        }

        const result =
          validateCandidateAsset({
            id: 1,

            rawName: 2,

            source: {
              fileId: 1,

              fileName: 2,

              section: 3,

              institution: 4,

              row: "5",
            },

            hints,
          });

        expect(result.ok).toBe(false);

        if (!result.ok) {
          expect(
            result.issues.length,
          ).toBeLessThanOrEqual(20);

          expect(
            result.issues.length,
          ).toBeGreaterThan(5);
        }
      },
    );
  },
);
