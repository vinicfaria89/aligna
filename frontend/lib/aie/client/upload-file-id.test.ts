import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CSV_UPLOAD_FILE_ID_PATTERN,
} from "../ingestion/portfolio-csv-limits";

import {
  deriveUploadFileId,
} from "./upload-file-id";

/** TASK-025: the deterministic, opaque upload id. */
const FILE = {
  name: "carteira.csv",

  size: 1234,

  lastModified: 1_700_000_000_000,
};

describe("deriveUploadFileId", () => {
  it("is deterministic: the same file gives the same id, with no randomness or clock", () => {
    const ids = new Set(
      Array.from({ length: 20 }, () =>
        deriveUploadFileId({ ...FILE }),
      ),
    );

    expect(ids.size).toBe(1);
  });

  it("changes when the name, size or modification time changes", () => {
    const base = deriveUploadFileId(FILE);

    for (const other of [
      { ...FILE, name: "outra.csv" },
      { ...FILE, size: 1235 },
      { ...FILE, lastModified: 1 },
    ]) {
      expect(
        deriveUploadFileId(other),
      ).not.toBe(base);
    }
  });

  it("always matches the accepted upload id format (safe for a URL and for ids)", () => {
    for (const name of [
      "carteira.csv",
      "Minha Carteira (final) — versão 2.csv",
      "日本語.csv",
      "a/b\\c?d=e&f.csv",
      "",
    ]) {
      const id = deriveUploadFileId({
        name,

        size: 0,

        lastModified: 0,
      });

      expect(id).toMatch(
        CSV_UPLOAD_FILE_ID_PATTERN,
      );

      expect(id).toHaveLength(17);

      expect(id.startsWith("f")).toBe(
        true,
      );
    }
  });

  it("never contains the file name, size or timestamp in clear text", () => {
    const id = deriveUploadFileId({
      name: "secret-portfolio.csv",

      size: 987654,

      lastModified: 1_700_000_000_123,
    });

    for (const leaked of [
      "secret",
      "portfolio",
      "987654",
      "1700000000123",
      ".csv",
    ]) {
      expect(id).not.toContain(leaked);
    }
  });
});
