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
  AieServerError,
  resolveAsset,
} from "./resolve-asset";

/**
 * HTTP mapping for POST /api/aie/resolve-asset (see TASK-010).
 *
 * Responsibilities ONLY: accept the HTTP input, validate it, call
 * resolveAsset(), and map safe results/errors to HTTP responses. Nothing here
 * knows about providers, ANBIMA, tokens, the process environment or the
 * verification policy, and nothing is logged.
 *
 * Status mapping:
 *   200 verified / needs-more-evidence (any normal ResolutionResult, including
 *       provider failures already recorded inside the InvestigationCase)
 *   400 invalid or oversized body, malformed JSON, invalid CandidateAsset
 *   415 Content-Type is not application/json
 *   503 AieServerError kind "configuration"
 *   500 AieServerError kind "unexpected" or any other exception
 *
 * Rate limiting is NOT implemented here (future work).
 */

export const MAX_BODY_BYTES =
  16 * 1024;

function invalidCandidate(
  issues: ValidationIssue[],
): Response {
  return errorResponse(
    400,
    "INVALID_CANDIDATE_ASSET",
    "Invalid candidate asset.",
    issues,
  );
}

async function readBody(
  request: Request,
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
    declared > MAX_BODY_BYTES
  ) {
    return {
      ok: false,

      response: invalidCandidate([
        {
          path: "$",

          code: "too_long",
        },
      ]),
    };
  }

  let text: string;

  try {
    text = await request.text();
  } catch {
    return {
      ok: false,

      response: invalidCandidate([
        {
          path: "$",

          code: "type",
        },
      ]),
    };
  }

  if (
    new TextEncoder().encode(text)
      .byteLength > MAX_BODY_BYTES
  ) {
    return {
      ok: false,

      response: invalidCandidate([
        {
          path: "$",

          code: "too_long",
        },
      ]),
    };
  }

  return {
    ok: true,

    text,
  };
}

export async function handleResolveAssetRequest(
  request: Request,
  options: AieHttpOptions = {},
): Promise<Response> {
  // Authorization first: before the body is read or anything is validated.
  const denied =
    await requireAuthorization(
      request,
      options.authorizer ??
        getAieRequestAuthorizer(),
      "resolve-asset",
    );

  if (denied) {
    return denied;
  }

  if (!hasJsonContentType(request)) {
    return unsupportedMediaType();
  }

  const body =
    await readBody(request);

  if (!body.ok) {
    return body.response;
  }

  let json: unknown;

  try {
    json = JSON.parse(body.text);
  } catch {
    return invalidCandidate([
      {
        path: "$",

        code: "invalid_json",
      },
    ]);
  }

  const validation =
    validateCandidateAsset(json);

  if (!validation.ok) {
    return invalidCandidate(
      validation.issues,
    );
  }

  try {
    const result =
      await resolveAsset(
        validation.value,
      );

    return jsonResponse(200, {
      ok: true,

      result,
    });
  } catch (error) {
    if (
      error instanceof AieServerError &&
      error.kind === "configuration"
    ) {
      return errorResponse(
        503,
        "AIE_CONFIGURATION_UNAVAILABLE",
        "Asset resolution is temporarily unavailable.",
      );
    }

    return errorResponse(
      500,
      "AIE_INTERNAL_ERROR",
      "Unable to resolve asset.",
    );
  }
}
