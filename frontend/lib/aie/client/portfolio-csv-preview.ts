import {
  PortfolioCsvAdapterError,
  ingestPortfolioCsv,
} from "../ingestion/adapters/portfolio-csv-adapter";

import {
  PortfolioIngestionError,
} from "../ingestion/portfolio-candidate-ingestion";

import {
  MAX_CSV_UPLOAD_BYTES,
  MAX_PORTFOLIO_ROWS,
} from "../ingestion/portfolio-csv-limits";

import type {
  SafeIssue,
} from "./csv-issue-messages";

/**
 * Local CSV preview (TASK-025).
 *
 * It runs the SAME browser-safe adapter and ingestion the server runs (no second
 * parser, no second normalization), with the same upload provenance option, so
 * the preview shows exactly the candidates and row ids the server will derive.
 * It is a convenience only: the server stays authoritative and may still answer
 * 400/401/403/413/429 for a CSV that previews fine.
 *
 * It verifies nothing, calls nothing, and infers nothing: `Petrobras PN` never
 * becomes `PETR4`; only what the CSV states explicitly is shown.
 *
 * Browser-safe and pure: no I/O, no network, no environment, no storage.
 */

export interface PreviewRow {
  /** CSV row number (the header is row 1, the first data row is row 2). */
  row: number;

  /** Deterministic candidate id (`portfolio:<fileId>:<row>` or the CSV's own id). */
  candidateId: string;

  rawName: string;

  assetType?: string;

  ticker?: string;

  instrumentCode?: string;

  amount?: number;

  currency?: string;
}

export type PortfolioCsvPreviewFailure =
  | "too-large"
  | "invalid-csv"
  | "too-many-rows";

export type PortfolioCsvPreview =
  | {
      ok: true;

      rows: PreviewRow[];
    }
  | {
      ok: false;

      reason: PortfolioCsvPreviewFailure;

      issues: SafeIssue[];
    };

/** UTF-8 size of the text that would be sent (bytes, not characters). */
export function csvByteLength(
  text: string,
): number {
  return new TextEncoder().encode(text)
    .byteLength;
}

export function buildPortfolioCsvPreview(
  text: string,
  fileId: string,
): PortfolioCsvPreview {
  if (
    csvByteLength(text) >
    MAX_CSV_UPLOAD_BYTES
  ) {
    return {
      ok: false,

      reason: "too-large",

      issues: [],
    };
  }

  let candidates: ReturnType<
    typeof ingestPortfolioCsv
  >;

  try {
    candidates = ingestPortfolioCsv(
      text,
      {
        defaultFileId: fileId,
      },
    );
  } catch (error) {
    if (
      error instanceof
      PortfolioCsvAdapterError
    ) {
      return {
        ok: false,

        reason: "invalid-csv",

        issues: error.issues.map(
          (issue) => ({
            path: issue.path,

            code: issue.code,
          }),
        ),
      };
    }

    if (
      error instanceof
      PortfolioIngestionError
    ) {
      const row =
        error.index === undefined
          ? undefined
          : error.index + 2;

      return {
        ok: false,

        reason: "invalid-csv",

        issues: error.issues.map(
          (issue) => ({
            path:
              row === undefined
                ? issue.path
                : issue.path === "$"
                  ? `row[${row}]`
                  : `row[${row}].${issue.path}`,

            code: issue.code,
          }),
        ),
      };
    }

    return {
      ok: false,

      reason: "invalid-csv",

      issues: [
        {
          path: "$",

          code: "invalid_value",
        },
      ],
    };
  }

  if (
    candidates.length >
    MAX_PORTFOLIO_ROWS
  ) {
    return {
      ok: false,

      reason: "too-many-rows",

      issues: [
        {
          path: "rows",

          code: "too_long",
        },
      ],
    };
  }

  return {
    ok: true,

    rows: candidates.map(
      (candidate, index) => ({
        row:
          candidate.source.row ??
          index + 2,

        candidateId: candidate.id,

        rawName: candidate.rawName,

        ...(candidate.hints
          .assetType !== undefined
          ? {
              assetType:
                candidate.hints
                  .assetType,
            }
          : {}),

        ...(candidate.hints.ticker !==
        undefined
          ? {
              ticker:
                candidate.hints
                  .ticker,
            }
          : {}),

        ...(candidate.hints
          .instrumentCode !==
        undefined
          ? {
              instrumentCode:
                candidate.hints
                  .instrumentCode,
            }
          : {}),

        ...(candidate.hints.amount !==
        undefined
          ? {
              amount:
                candidate.hints
                  .amount,
            }
          : {}),

        ...(candidate.hints
          .currency !== undefined
          ? {
              currency:
                candidate.hints
                  .currency,
            }
          : {}),
      }),
    ),
  };
}
