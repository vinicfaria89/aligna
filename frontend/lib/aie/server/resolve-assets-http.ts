import type {
  CandidateAsset,
} from "../contracts";

import {
  errorResponse,
  hasJsonContentType,
  jsonResponse,
  unsupportedMediaType,
} from "./aie-http";

import {
  validateCandidateAsset,
} from "./candidate-asset-validation";

import type {
  ValidationIssue,
} from "./candidate-asset-validation";

import {
  getAieRequestAuthorizer,
  requireAuthorization,
} from "./request-authorization";

import type {
  AieHttpOptions,
} from "./request-authorization";

import {
  BatchResolutionError,
  MAX_BATCH_CONCURRENCY,
  MAX_BATCH_SIZE,
  resolveAssets,
} from "./resolve-assets";

/**
 * HTTP mapping for POST /api/aie/resolve-assets (see TASK-016).
 *
 *   body -> content type / size / JSON -> batch shape -> CandidateAsset[]
 *     -> resolveAssets() -> safe JSON
 *
 * Responsibilities ONLY: accept the HTTP input, validate it, call
 * resolveAssets() and map safe results/errors to HTTP responses. Nothing here
 * knows about providers, ANBIMA, tokens, cache, rate limiting, the process
 * environment or the verification policy, and nothing is logged.
 *
 * Status mapping:
 *   200 the batch ran: every item is either a ResolutionResult (including
 *       unresolved ones and provider failures already recorded inside the
 *       InvestigationCase) or a safe item-level error. A partial failure is
 *       NEVER an HTTP error.
 *   400 malformed JSON, invalid batch shape, invalid CandidateAsset, too many
 *       assets, invalid concurrency
 *   413 body larger than MAX_BATCH_BODY_BYTES
 *   415 Content-Type is not application/json
 *   500 unexpected exception
 *
 * Difference from the single-asset route: there is NO 503 here. When the
 * server AIE cannot be created, resolveAssets() attempts it once and reports a
 * safe AIE_CONFIGURATION_UNAVAILABLE on every item (TASK-014). This layer does
 * not reinterpret that service contract.
 *
 * The client controls only the assets and, optionally, `options.concurrency`
 * (bounded by the service limits). Rate limiting, cache and providers are not
 * client-configurable. Concurrency is not rate limiting.
 *
 * Authentication/authorization: the application has none yet, and none is
 * invented here. It is REQUIRED before this endpoint is publicly exposed.
 */

/**
 * 512 KiB. A batch holds at most MAX_BATCH_SIZE assets and one validated
 * asset is a few KiB at its field limits (well below 4 KiB), so 100 assets fit
 * comfortably while the body stays bounded.
 */
export const MAX_BATCH_BODY_BYTES =
  512 * 1024;

const MAX_ISSUES = 20;

const ROOT_FIELDS = [
  "assets",
  "options",
] as const;

const OPTION_FIELDS = [
  "concurrency",
] as const;

type PlainObject = Record<
  string,
  unknown
>;

function isPlainObject(
  value: unknown,
): value is PlainObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function hasUnknownField(
  source: PlainObject,
  allowed: readonly string[],
): boolean {
  return Object.keys(source).some(
    (key) =>
      !allowed.includes(key),
  );
}

export interface BatchRequestOptions {
  concurrency?: number;
}

export type BatchRequestValidation =
  | {
      ok: true;

      assets: CandidateAsset[];

      options: BatchRequestOptions;
    }
  | {
      ok: false;

      issues: ValidationIssue[];
    };

/**
 * Validates the untrusted batch body. Each asset goes through the existing
 * validateCandidateAsset (no second validator); its issue paths are prefixed
 * with the array position, e.g. "assets[2].hints.ticker". Issues never carry
 * values or unknown key names.
 */
export function validateBatchRequest(
  input: unknown,
): BatchRequestValidation {
  const issues: ValidationIssue[] =
    [];

  const add = (
    path: string,
    code: ValidationIssue["code"],
  ): void => {
    if (issues.length < MAX_ISSUES) {
      issues.push({
        path,
        code,
      });
    }
  };

  if (!isPlainObject(input)) {
    return {
      ok: false,

      issues: [
        {
          path: "$",

          code: "type",
        },
      ],
    };
  }

  if (
    hasUnknownField(
      input,
      ROOT_FIELDS,
    )
  ) {
    // The unknown key name is user controlled: report the parent path only.
    add("$", "unknown_field");
  }

  const rawAssets = input.assets;

  const assets: CandidateAsset[] =
    [];

  if (rawAssets === undefined) {
    add("assets", "required");
  } else if (
    !Array.isArray(rawAssets)
  ) {
    add("assets", "type");
  } else if (
    rawAssets.length > MAX_BATCH_SIZE
  ) {
    add("assets", "too_long");
  } else {
    rawAssets.forEach(
      (raw: unknown, index) => {
        const result =
          validateCandidateAsset(raw);

        if (result.ok) {
          assets.push(result.value);

          return;
        }

        for (const issue of result.issues) {
          add(
            issue.path === "$"
              ? `assets[${index}]`
              : `assets[${index}].${issue.path}`,
            issue.code,
          );
        }
      },
    );
  }

  const options: BatchRequestOptions =
    {};

  const rawOptions = input.options;

  if (rawOptions !== undefined) {
    if (!isPlainObject(rawOptions)) {
      add("options", "type");
    } else {
      if (
        hasUnknownField(
          rawOptions,
          OPTION_FIELDS,
        )
      ) {
        add(
          "options",
          "unknown_field",
        );
      }

      const concurrency =
        rawOptions.concurrency;

      if (concurrency !== undefined) {
        if (
          typeof concurrency !==
          "number"
        ) {
          add(
            "options.concurrency",
            "type",
          );
        } else if (
          !Number.isInteger(
            concurrency,
          ) ||
          concurrency < 1 ||
          concurrency >
            MAX_BATCH_CONCURRENCY
        ) {
          add(
            "options.concurrency",
            "invalid_value",
          );
        } else {
          options.concurrency =
            concurrency;
        }
      }
    }
  }

  if (issues.length > 0) {
    return {
      ok: false,

      issues,
    };
  }

  return {
    ok: true,

    assets,

    options,
  };
}

function invalidBatch(
  issues: ValidationIssue[],
): Response {
  return errorResponse(
    400,
    "INVALID_ASSET_BATCH",
    "Invalid asset batch.",
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
 * Reads the body without ever holding more than the limit (+ one chunk): the
 * stream is cancelled as soon as it exceeds it.
 */
async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<
  | {
      ok: true;

      text: string;
    }
  | {
      ok: false;

      response: Response;
    }
> {
  const declared = Number(
    request.headers.get(
      "content-length",
    ),
  );

  if (
    Number.isFinite(declared) &&
    declared > maxBytes
  ) {
    return {
      ok: false,

      response: payloadTooLarge(),
    };
  }

  const stream = request.body;

  if (stream === null) {
    return {
      ok: true,

      text: "",
    };
  }

  const reader = stream.getReader();

  const chunks: Uint8Array[] = [];

  let total = 0;

  try {
    for (;;) {
      const { done, value } =
        await reader.read();

      if (done) {
        break;
      }

      total += value.byteLength;

      if (total > maxBytes) {
        await reader
          .cancel()
          .catch(() => undefined);

        return {
          ok: false,

          response:
            payloadTooLarge(),
        };
      }

      chunks.push(value);
    }
  } catch {
    return {
      ok: false,

      response: invalidBatch([
        {
          path: "$",

          code: "type",
        },
      ]),
    };
  }

  const bytes = new Uint8Array(
    total,
  );

  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);

    offset += chunk.byteLength;
  }

  return {
    ok: true,

    text: new TextDecoder().decode(
      bytes,
    ),
  };
}

export async function handleResolveAssetsRequest(
  request: Request,
  options: AieHttpOptions = {},
): Promise<Response> {
  // Authorization first: before the (potentially large) body is read.
  const denied =
    await requireAuthorization(
      request,
      options.authorizer ??
        getAieRequestAuthorizer(),
      "resolve-assets",
    );

  if (denied) {
    return denied;
  }

  if (!hasJsonContentType(request)) {
    return unsupportedMediaType();
  }

  const body =
    await readBoundedBody(
      request,
      MAX_BATCH_BODY_BYTES,
    );

  if (!body.ok) {
    return body.response;
  }

  let json: unknown;

  try {
    json = JSON.parse(body.text);
  } catch {
    return invalidBatch([
      {
        path: "$",

        code: "invalid_json",
      },
    ]);
  }

  const validation =
    validateBatchRequest(json);

  if (!validation.ok) {
    return invalidBatch(
      validation.issues,
    );
  }

  try {
    const result =
      await resolveAssets(
        validation.assets,
        validation.options,
      );

    return jsonResponse(200, {
      ok: true,

      result,
    });
  } catch (error) {
    // Defense in depth: the request was validated above with the same limits.
    if (
      error instanceof
      BatchResolutionError
    ) {
      return invalidBatch([
        {
          path:
            error.code ===
            "INVALID_CONCURRENCY"
              ? "options.concurrency"
              : "assets",

          code:
            error.code ===
            "INVALID_INPUT"
              ? "type"
              : error.code ===
                  "BATCH_TOO_LARGE"
                ? "too_long"
                : "invalid_value",
        },
      ]);
    }

    return errorResponse(
      500,
      "AIE_INTERNAL_ERROR",
      "Unable to resolve assets.",
    );
  }
}
