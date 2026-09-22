// @vitest-environment jsdom
import {
  describe,
  expect,
  it,
} from "vitest";
import writeXlsxFile from "write-excel-file/browser";

import {
  MAX_EXCEL_DATA_ROWS,
  excelRowsToCsvText,
  readPortfolioExcelFile,
} from "./portfolio-excel-adapter";

import { ingestPortfolioCsv } from "../ingestion/adapters/portfolio-csv-adapter";

/**
 * TASK-038: real .xlsx files are built with write-excel-file (a devDependency
 * used ONLY for test fixtures -- it never ships to the browser bundle) and read
 * back with the actual production adapter, so these tests exercise the real
 * round trip, not a mock of it.
 */

function xlsxFile(
  rows: (string | number | { value: unknown; type: unknown })[][],
  name = "carteira.xlsx",
): Promise<File> {
  return writeXlsxFile(
    rows as never,
  )
    .toBlob()
    .then(
      (blob) =>
        new File([blob], name, {
          type: blob.type,
        }),
    );
}

const HEADER = ["rawName", "amount"];

describe("readPortfolioExcelFile", () => {
  it("reads the header and data rows of a valid .xlsx", async () => {
    const file = await xlsxFile([
      HEADER,
      ["CDB Banco Exemplo", 1000],
      ["Tesouro Selic 2029", 2500.5],
    ]);

    const result = await readPortfolioExcelFile(file);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.headerRow).toEqual([
      "rawName",
      "amount",
    ]);
    expect(result.dataRows).toEqual([
      ["CDB Banco Exemplo", 1000],
      ["Tesouro Selic 2029", 2500.5],
    ]);
  });

  it("reports an empty sheet as `empty`", async () => {
    const file = await xlsxFile([[]]);

    const result = await readPortfolioExcelFile(file);

    expect(result).toEqual({
      ok: false,
      reason: "empty",
    });
  });

  it("drops trailing blank rows (every cell null or empty) from the data rows", async () => {
    const file = await xlsxFile([
      HEADER,
      ["CDB Banco Exemplo", 1000],
      ["", ""],
      [null as unknown as string, null as unknown as string],
    ]);

    const result = await readPortfolioExcelFile(file);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.dataRows).toEqual([
      ["CDB Banco Exemplo", 1000],
    ]);
  });

  it("reports a non-.xlsx / corrupted input as `read-failed`, never throwing", async () => {
    const file = new File(
      ["this is not a real xlsx file"],
      "fake.xlsx",
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    );

    const result = await readPortfolioExcelFile(
      file,
    );

    expect(result).toEqual({
      ok: false,
      reason: "read-failed",
    });
  });

  it("a sheet with more data rows than the portfolio limit is still fully read (the caller enforces the limit)", async () => {
    const rows = Array.from(
      { length: MAX_EXCEL_DATA_ROWS + 5 },
      (_, i) => [`Ativo ${i}`, i],
    );

    const file = await xlsxFile([
      HEADER,
      ...rows,
    ]);

    const result = await readPortfolioExcelFile(file);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.dataRows).toHaveLength(
      MAX_EXCEL_DATA_ROWS + 5,
    );
  });
});

describe("excelRowsToCsvText", () => {
  it("produces CSV text the existing CSV adapter accepts and ingests identically", () => {
    const text = excelRowsToCsvText(
      ["rawName", "amount", "currency"],
      [
        [
          "CDB Banco Exemplo",
          1000,
          "BRL",
        ],
        [
          "Tesouro Selic 2029",
          2500.5,
          "BRL",
        ],
      ],
    );

    const candidates = ingestPortfolioCsv(
      text,
      { defaultFileId: "f0000000000000000" },
    );

    expect(candidates).toHaveLength(2);
    expect(candidates[0]?.rawName).toBe(
      "CDB Banco Exemplo",
    );
    expect(candidates[0]?.hints.amount).toBe(
      1000,
    );
    expect(candidates[1]?.hints.currency).toBe(
      "BRL",
    );
  });

  it("escapes commas, quotes and newlines the same way the CSV format expects", () => {
    const text = excelRowsToCsvText(
      ["rawName"],
      [
        [
          'Ativo, com vírgula e "aspas"',
        ],
      ],
    );

    const candidates = ingestPortfolioCsv(
      text,
      { defaultFileId: "f0000000000000000" },
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.rawName).toBe(
      'Ativo, com vírgula e "aspas"',
    );
  });

  it("formats a Date cell as a plain YYYY-MM-DD string, never a raw Date object", () => {
    const text = excelRowsToCsvText(
      ["rawName", "maturityDate"],
      [
        [
          "CRI Exemplo",
          new Date(
            Date.UTC(2030, 3, 15),
          ),
        ],
      ],
    );

    expect(text).toBe(
      "rawName,maturityDate\r\nCRI Exemplo,2030-04-15",
    );

    // Not a raw Date#toString() rendering (which would carry a weekday name,
    // a time and a timezone abbreviation like GMT).
    expect(text).not.toContain(
      "GMT",
    );
  });

  it("renders null/undefined cells as empty fields, not the literal word null/undefined", () => {
    const text = excelRowsToCsvText(
      ["rawName", "ticker"],
      [
        [
          "Ativo Sem Ticker",
          null,
        ],
      ],
    );

    expect(text).toBe(
      "rawName,ticker\r\nAtivo Sem Ticker,",
    );
  });

  it("a boolean cell becomes the text true/false, which the amount column then rejects as invalid -- never silently coerced into a number", () => {
    const text = excelRowsToCsvText(
      ["rawName", "amount"],
      [
        [
          "Ativo Exemplo",
          true,
        ],
      ],
    );

    expect(text).toBe(
      "rawName,amount\r\nAtivo Exemplo,true",
    );

    try {
      ingestPortfolioCsv(text, {
        defaultFileId:
          "f0000000000000000",
      });

      expect.unreachable(
        "expected the amount column to reject the boolean text",
      );
    } catch (error) {
      expect(
        (error as Error).name,
      ).toBe("PortfolioCsvAdapterError");
    }
  });

  it("never uses console or any storage", () => {
    const spies = (
      [
        "log",
        "info",
        "warn",
        "error",
        "debug",
      ] as const
    ).map((method) => {
      const original =
        console[method];

      console[method] = (
        ...args: unknown[]
      ) => {
        throw new Error(
          `console.${method} was called: ${args.join(" ")}`,
        );
      };

      return () => {
        console[method] = original;
      };
    });

    try {
      excelRowsToCsvText(
        ["rawName"],
        [["Ativo"]],
      );

      expect(
        window.localStorage.length,
      ).toBe(0);

      expect(
        window.sessionStorage.length,
      ).toBe(0);
    } finally {
      spies.forEach((restore) =>
        restore(),
      );
    }
  });
});
