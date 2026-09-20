import {
  describe,
  expect,
  it,
} from "vitest";

import {
  ingestPortfolioCsv,
  parsePortfolioCsv,
  PortfolioCsvAdapterError,
} from "./portfolio-csv-adapter";

import {
  PortfolioIngestionError,
} from "../portfolio-candidate-ingestion";

/**
 * TASK-025: the optional upload provenance of the CSV adapter. Existing behavior
 * without the option is covered (unchanged) by portfolio-csv-adapter.test.ts.
 */

const FILE_ID = "f0123456789abcdef";

function csv(...lines: string[]): string {
  return lines.join("\n");
}

describe("CSV adapter: default upload provenance", () => {
  it("without the option a row with no id is still rejected (unchanged contract)", () => {
    expect(() =>
      ingestPortfolioCsv(
        csv("rawName", "DEB"),
      ),
    ).toThrow(PortfolioIngestionError);
  });

  it("fills fileId and row for rows without an id, so ingestion derives portfolio:<fileId>:<row>", () => {
    const candidates = ingestPortfolioCsv(
      csv("rawName,ticker", "A,AAA1", "B,BBB2"),
      {
        defaultFileId: FILE_ID,
      },
    );

    expect(
      candidates.map((candidate) => [
        candidate.id,
        candidate.source,
      ]),
    ).toEqual([
      [
        `portfolio:${FILE_ID}:2`,
        {
          fileId: FILE_ID,

          row: 2,
        },
      ],
      [
        `portfolio:${FILE_ID}:3`,
        {
          fileId: FILE_ID,

          row: 3,
        },
      ],
    ]);
  });

  it("is deterministic: the same CSV and id always give the same candidates", () => {
    const text = csv(
      "rawName",
      "A",
      "B",
    );

    expect(
      ingestPortfolioCsv(text, {
        defaultFileId: FILE_ID,
      }),
    ).toEqual(
      ingestPortfolioCsv(text, {
        defaultFileId: FILE_ID,
      }),
    );
  });

  it("numbers rows physically (blank lines are counted), like the rest of the adapter", () => {
    const candidates = ingestPortfolioCsv(
      "rawName\nA\n\nB\n",
      {
        defaultFileId: FILE_ID,
      },
    );

    expect(
      candidates.map(
        (candidate) => candidate.id,
      ),
    ).toEqual([
      `portfolio:${FILE_ID}:2`,
      `portfolio:${FILE_ID}:4`,
    ]);
  });

  it("leaves a row with an explicit id exactly as it is (no provenance added)", () => {
    const [candidate] =
      ingestPortfolioCsv(
        csv("id,rawName", "mine,A"),
        {
          defaultFileId: FILE_ID,
        },
      );

    expect(candidate?.id).toBe("mine");

    expect(candidate?.source).toEqual({});
  });

  it("never overrides the row's own fileId or row columns", () => {
    const candidates = ingestPortfolioCsv(
      csv(
        "rawName,fileId,row",
        "A,ownfile,7",
        "B,ownfile,",
        "C,,9",
      ),
      {
        defaultFileId: FILE_ID,
      },
    );

    expect(
      candidates.map(
        (candidate) => candidate.id,
      ),
    ).toEqual([
      "portfolio:ownfile:7",
      // Only the missing part is filled: the physical row.
      "portfolio:ownfile:3",
      `portfolio:${FILE_ID}:9`,
    ]);
  });

  it("does not change the parsed inputs of rows that state their own identity", () => {
    const inputs = parsePortfolioCsv(
      csv("id,rawName", "mine,A"),
      {
        defaultFileId: FILE_ID,
      },
    );

    expect(inputs).toEqual([
      {
        id: "mine",

        rawName: "A",
      },
    ]);
  });

  it("changes nothing else about the parse: errors, privacy and headers behave as before", () => {
    const options = {
      defaultFileId: FILE_ID,
    };

    expect(() =>
      parsePortfolioCsv(
        csv("rawName,cpf", "A,1"),
        options,
      ),
    ).toThrow(PortfolioCsvAdapterError);

    expect(() =>
      parsePortfolioCsv(
        csv("rawName", '"open'),
        options,
      ),
    ).toThrow(PortfolioCsvAdapterError);

    expect(
      parsePortfolioCsv(
        "rawName\n",
        options,
      ),
    ).toEqual([]);
  });

  it("a fileId that ingestion cannot accept is reported as an ingestion error, not swallowed", () => {
    expect(() =>
      ingestPortfolioCsv(
        csv("rawName", "A"),
        {
          defaultFileId: "x".repeat(300),
        },
      ),
    ).toThrow(PortfolioIngestionError);
  });
});
