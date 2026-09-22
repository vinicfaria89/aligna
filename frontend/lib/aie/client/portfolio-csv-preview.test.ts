import {
  describe,
  expect,
  it,
} from "vitest";

import {
  ingestPortfolioCsv,
} from "../ingestion/adapters/portfolio-csv-adapter";

import {
  MAX_CSV_UPLOAD_BYTES,
  MAX_PORTFOLIO_ROWS,
} from "../ingestion/portfolio-csv-limits";

import {
  buildPortfolioCsvPreview,
  csvByteLength,
} from "./portfolio-csv-preview";

/** TASK-025: the local preview uses the SAME adapter and provenance as the server. */
const FILE_ID = "f0123456789abcdef";

function csv(...lines: string[]): string {
  return lines.join("\n");
}

describe("buildPortfolioCsvPreview", () => {
  it("previews exactly the candidates the shared adapter produces (no second parser)", () => {
    const text = csv(
      "rawName,assetType,instrumentCode,amount,currency",
      "DEB ALPHA,debenture,ABCD11,1000.5,brl",
      "DEB BETA,debenture,EFGH22,20,BRL",
    );

    const preview =
      buildPortfolioCsvPreview(
        text,
        FILE_ID,
      );

    expect(preview.ok).toBe(true);

    if (!preview.ok) return;

    const candidates = ingestPortfolioCsv(
      text,
      {
        defaultFileId: FILE_ID,
      },
    );

    expect(
      preview.rows.map((row) => [
        row.candidateId,
        row.rawName,
        row.instrumentCode,
        row.amount,
        row.currency,
      ]),
    ).toEqual(
      candidates.map((candidate) => [
        candidate.id,
        candidate.rawName,
        candidate.hints.instrumentCode,
        candidate.hints.amount,
        candidate.hints.currency,
      ]),
    );

    // Ingestion normalization (currency upper case) shows through.
    expect(preview.rows[0]?.currency).toBe(
      "BRL",
    );
  });

  it("derives deterministic row ids portfolio:<fileId>:<row> for rows without an id (header is row 1)", () => {
    const preview =
      buildPortfolioCsvPreview(
        csv("rawName", "A", "B", "C"),
        FILE_ID,
      );

    expect(preview.ok).toBe(true);

    if (!preview.ok) return;

    expect(
      preview.rows.map((row) => [
        row.row,
        row.candidateId,
      ]),
    ).toEqual([
      [2, `portfolio:${FILE_ID}:2`],
      [3, `portfolio:${FILE_ID}:3`],
      [4, `portfolio:${FILE_ID}:4`],
    ]);

    // Same input, same ids.
    expect(
      buildPortfolioCsvPreview(
        csv("rawName", "A", "B", "C"),
        FILE_ID,
      ),
    ).toEqual(preview);
  });

  it("keeps an explicit id untouched", () => {
    const preview =
      buildPortfolioCsvPreview(
        csv("id,rawName", "mine-1,A"),
        FILE_ID,
      );

    expect(preview.ok).toBe(true);

    if (!preview.ok) return;

    expect(
      preview.rows[0]?.candidateId,
    ).toBe("mine-1");
  });

  it("does NOT infer a ticker from the name: Petrobras PN never becomes PETR4", () => {
    const preview =
      buildPortfolioCsvPreview(
        csv(
          "rawName,assetType",
          "Petrobras PN,stock",
        ),
        FILE_ID,
      );

    expect(preview.ok).toBe(true);

    if (!preview.ok) return;

    expect(preview.rows[0]?.ticker).toBeUndefined();

    expect(
      preview.rows[0]?.instrumentCode,
    ).toBeUndefined();

    expect(
      JSON.stringify(preview),
    ).not.toContain("PETR4");
  });

  it("treats a header-only CSV as a valid empty preview", () => {
    for (const text of [
      "rawName",
      "rawName\n",
      "rawName,assetType\r\n",
    ]) {
      expect(
        buildPortfolioCsvPreview(
          text,
          FILE_ID,
        ),
      ).toEqual({
        ok: true,

        rows: [],
      });
    }
  });

  it("reports safe issues for an invalid CSV (positions and codes only, never values)", () => {
    const cases: Array<
      [string, string, string]
    > = [
      [
        csv("rawName", '"open'),
        "malformed_csv",
        "row[2]",
      ],
      [
        csv("rawName,cpf", "A,123"),
        "forbidden_field",
        "header[2]",
      ],
      [
        csv("rawName,color", "A,b"),
        "unknown_field",
        "header[2]",
      ],
      [
        csv("assetType", "stock"),
        "required",
        "header",
      ],
      [
        csv("rawName,amount", 'A,"R$ 1,00"'),
        "invalid_value",
        "row[2].amount",
      ],
      [
        csv("id,rawName,amount", "a,A,-1"),
        "invalid_value",
        "row[2].amount",
      ],
    ];

    for (const [text, code, path] of cases) {
      const preview =
        buildPortfolioCsvPreview(
          text,
          FILE_ID,
        );

      expect(preview.ok).toBe(false);

      if (preview.ok) continue;

      expect(preview.reason).toBe(
        "invalid-csv",
      );

      expect(
        preview.issues,
      ).toEqual(
        expect.arrayContaining([
          { path, code },
        ]),
      );
    }

    const echoed = buildPortfolioCsvPreview(
      csv("rawName,secretColumnZ", "SECRET-CELL,x"),
      FILE_ID,
    );

    expect(
      JSON.stringify(echoed),
    ).not.toContain("SECRET-CELL");

    expect(
      JSON.stringify(echoed),
    ).not.toContain("secretColumnZ");
  });

  it("rejects more than MAX_PORTFOLIO_ROWS rows and a CSV over the byte limit", () => {
    const rows = Array.from(
      { length: MAX_PORTFOLIO_ROWS + 1 },
      (_, i) => `DEB ${i}`,
    );

    expect(
      buildPortfolioCsvPreview(
        csv("rawName", ...rows),
        FILE_ID,
      ),
    ).toEqual({
      ok: false,

      reason: "too-many-rows",

      issues: [
        {
          path: "rows",

          code: "too_long",
        },
      ],
    });

    const huge = `rawName\n${"é".repeat(
      MAX_CSV_UPLOAD_BYTES / 2,
    )}`;

    expect(
      buildPortfolioCsvPreview(
        huge,
        FILE_ID,
      ),
    ).toMatchObject({
      ok: false,

      reason: "too-large",
    });

    expect(csvByteLength("é")).toBe(2);
  });

  it("accepts exactly MAX_PORTFOLIO_ROWS rows", () => {
    const rows = Array.from(
      { length: MAX_PORTFOLIO_ROWS },
      (_, i) => `DEB ${i}`,
    );

    const preview =
      buildPortfolioCsvPreview(
        csv("rawName", ...rows),
        FILE_ID,
      );

    expect(preview.ok).toBe(true);

    if (preview.ok) {
      expect(preview.rows).toHaveLength(
        MAX_PORTFOLIO_ROWS,
      );
    }
  });
});
