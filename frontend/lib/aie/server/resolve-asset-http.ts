import type {
  ResolutionResult,
} from "../contracts";

import {
  validateCandidateAsset,
} from "./candidate-asset-validation";

import type {
  ValidationIssue,
} from "./candidate-asset-validation";

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

const JSON_HEADERS = {
  "Content-Type":
    "application/json; charset=utf-8",

  "Cache-Control": "no-store",
} as const;

interface ErrorBody {
  ok: false;

  error: {
    code: string;

    message: string;

    issues?: ValidationIssue[];
  };
}

function respond(
  status: number,
  payload:
    | ErrorBody
    | {
        ok: true;

        result: ResolutionResult;
      },
): Response {
  return new Response(
    JSON.stringify(payload),
    {
      status,

      headers: JSON_HEADERS,
    },
  );
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  issues?: ValidationIssue[],
): Response {
  return respond(status, {
    ok: false,

    error: {
      code,

      message,

      ...(issues ? { issues } : {}),
    },
  });
}

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
): Promise<Response> {
  /*
   * Requiring JSON forces browsers through a CORS preflight for cross-site
   * requests, so a foreign page cannot trigger external work with a plain
   * form/text POST.
   */
  const contentType =
    request.headers.get(
      "content-type",
    ) ?? "";

  if (
    !/^application\/json\b/i.test(
      contentType,
    )
  ) {
    return errorResponse(
      415,
      "UNSUPPORTED_MEDIA_TYPE",
      "Content-Type must be application/json.",
    );
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

    return respond(200, {
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
