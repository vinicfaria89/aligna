import {
  PortfolioCsvAdapterError,
  ingestPortfolioCsv,
} from "../ingestion/adapters/portfolio-csv-adapter";

import {
  PortfolioIngestionError,
} from "../ingestion/portfolio-candidate-ingestion";

import {
  handleAieRequest,
} from "./aie-audited-request";

import {
  errorResponse,
  unsupportedCsvMediaType,
} from "./aie-http";

import type {
  HttpIssue,
} from "./aie-http";

import {
  readBoundedBytes,
} from "./bounded-body";

import type {
  AieHttpOptions,
} from "./request-authorization";

import {
  MAX_BATCH_SIZE,
} from "./resolve-assets";

import {
  resolveBatchToResponse,
} from "./resolve-assets-http";

/**
 * HTTP mapping for POST /api/aie/resolve-csv (TASK-024).
 *
 *   raw CSV body -> ingestPortfolioCsv (parsePortfolioCsv -> ingestPortfolioCandidates)
 *     -> CandidateAsset[] -> the SAME batch resolution and response as resolve-assets
 *
 * Nothing here parses, normalizes or resolves anything itself: parsing and the
 * privacy rules belong to the CSV adapter, normalization to the ingestion layer,
 * resolution to the batch service, and authorization/usage/audit to the shared
 * orchestration. This layer only guards the transport (media type, byte limit,
 * UTF-8) and maps failures to safe HTTP responses. It reads no environment and
 * knows nothing about providers, ANBIMA, tokens or the verification policy.
 *
 * Authorization/usage: the operation is the fixed literal "resolve-assets". CSV
 * upload is only another TRANSPORT of the same paid batch capability, so it
 * reuses that operation's authorization (authenticated + allowed role +
 * entitlements.aie_batch === true) and its BATCH usage bucket: one HTTP request
 * consumes one batch slot whatever the number of rows. No new entitlement, no new
 * bucket, and the operation is never derived from the request. (Consequence: the
 * audit records operation "resolve-assets" for both transports; the transport is
 * not distinguished, on purpose, to keep the audit minimal.)
 *
 * Order (authorization and usage control run BEFORE the body is touched):
 *   correlation id -> authorization -> usage control -> media type -> byte limit
 *   -> UTF-8 decoding -> CSV parsing -> ingestion -> batch-size limit -> resolution
 *
 * Status mapping:
 *   200 the batch ran (BatchResolutionResult; a header-only CSV gives items []);
 *       partial item failures are inside `items`, never an HTTP error
 *   400 INVALID_PORTFOLIO_CSV: malformed or invalid CSV (structure, headers,
 *       forbidden/unknown fields, cells, ingestion rules), invalid UTF-8, or more
 *       candidates than MAX_BATCH_SIZE (never truncated)
 *   413 PAYLOAD_TOO_LARGE: more than MAX_CSV_BODY_BYTES
 *   415 UNSUPPORTED_MEDIA_TYPE: not text/csv
 *   401 / 403 / 429 / 500 from authorization, usage control and internal errors
 *
 * Error issues are `{ path, code }` with structural locations such as `header[3]`,
 * `row[4]`, `row[4].amount` or `rows`: never a cell value, a header name, a row or
 * the CSV. A PortfolioIngestionError `index` N is reported as row N+2 (the CSV
 * numbering of TASK-013: header is row 1); with blank lines in the file this is the
 * data-row ordinal + 1 rather than the physical line.
 *
 * Not implemented: multipart/form-data, file names (a filename header is never
 * read or trusted; only a `fileName` COLUMN, if present, is data), Excel, PDF.
 */

/**
 * 512 KiB. A batch holds at most MAX_BATCH_SIZE (100) rows and one row is well
 * under 4 KiB even at every field's maximum length, so a valid CSV fits with a
 * wide margin, and the request stays bounded in memory. Bytes, not characters.
 */
export const MAX_CSV_BODY_BYTES =
  512 * 1024;

/** text/csv, optionally with `charset=utf-8`. Any other parameter or type is refused. */
const CSV_CONTENT_TYPE =
  /^\s*text\/csv\s*(?:;\s*charset\s*=\s*(?:"utf-8"|utf-8)\s*)?$/i;

function hasCsvContentType(
  request: Request,
): boolean {
  return CSV_CONTENT_TYPE.test(
    request.headers.get(
      "content-type",
    ) ?? "",
  );
}

function invalidCsv(
  issues: HttpIssue[],
): Response {
  return errorResponse(
    400,
    "INVALID_PORTFOLIO_CSV",
    "Invalid portfolio CSV.",
    issues,
  );
}

function payloadTooLarge(): Response {
  return errorResponse(
    413,
    "PAYLOAD_TOO_LARGE",
    "Request payload is too large.",
  );
}

/**
 * POST /api/aie/resolve-csv entry point. Authorization, usage control and
 * auditing wrap the execution (see aie-audited-request.ts).
 */
export async function handleResolveCsvRequest(
  request: Request,
  options: AieHttpOptions = {},
): Promise<Response> {
  return handleAieRequest(
    request,
    "resolve-assets",
    options,
    () => executeResolveCsv(request),
  );
}

async function executeResolveCsv(
  request: Request,
): Promise<Response> {
  if (!hasCsvContentType(request)) {
    return unsupportedCsvMediaType();
  }

  const body = await readBoundedBytes(
    request,
    MAX_CSV_BODY_BYTES,
  );

  if (!body.ok) {
    return body.reason === "too_large"
      ? payloadTooLarge()
      : invalidCsv([
          {
            path: "$",

            code: "invalid_value",
          },
        ]);
  }

  let text: string;

  try {
    // Fatal: invalid UTF-8 is refused, never silently replaced. The BOM is kept
    // so the CSV adapter (which owns BOM handling) sees the text as sent.
    text = new TextDecoder("utf-8", {
      fatal: true,

      ignoreBOM: true,
    }).decode(body.bytes);
  } catch {
    return invalidCsv([
      {
        path: "$",

        code: "invalid_value",
      },
    ]);
  }

  let candidates: ReturnType<
    typeof ingestPortfolioCsv
  >;

  try {
    candidates =
      ingestPortfolioCsv(text);
  } catch (error) {
    if (
      error instanceof
      PortfolioCsvAdapterError
    ) {
      return invalidCsv(
        error.issues.map((issue) => ({
          path: issue.path,

          code: issue.code,
        })),
      );
    }

    if (
      error instanceof
      PortfolioIngestionError
    ) {
      const row =
        error.index === undefined
          ? undefined
          : error.index + 2;

      return invalidCsv(
        error.issues.map((issue) => ({
          path:
            row === undefined
              ? issue.path
              : issue.path === "$"
                ? `row[${row}]`
                : `row[${row}].${issue.path}`,

          code: issue.code,
        })),
      );
    }

    return errorResponse(
      500,
      "AIE_INTERNAL_ERROR",
      "Unable to process portfolio CSV.",
    );
  }

  // Same limit as the JSON batch, applied before any resolution work.
  if (candidates.length > MAX_BATCH_SIZE) {
    return invalidCsv([
      {
        path: "rows",

        code: "too_long",
      },
    ]);
  }

  return resolveBatchToResponse(
    candidates,
    {},
  );
}
