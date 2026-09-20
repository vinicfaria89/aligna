import type {
  ValidationIssue,
} from "./candidate-asset-validation";

/**
 * SERVER-ONLY HTTP helpers shared by the AIE Route Handler mappings
 * (resolve-asset-http.ts and resolve-assets-http.ts). They only build safe
 * JSON responses: fixed codes and messages, optional {path, code} issues, never
 * echoed values. Every response is `Cache-Control: no-store`.
 *
 * No CORS headers are ever set here: the routes stay same-origin by default.
 */

export const JSON_HEADERS = {
  "Content-Type":
    "application/json; charset=utf-8",

  "Cache-Control": "no-store",
} as const;

export interface HttpErrorBody {
  ok: false;

  error: {
    code: string;

    message: string;

    issues?: ValidationIssue[];
  };
}

export function jsonResponse(
  status: number,
  payload: unknown,
): Response {
  return new Response(
    JSON.stringify(payload),
    {
      status,

      headers: JSON_HEADERS,
    },
  );
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  issues?: ValidationIssue[],
): Response {
  const body: HttpErrorBody = {
    ok: false,

    error: {
      code,

      message,

      ...(issues ? { issues } : {}),
    },
  };

  return jsonResponse(
    status,
    body,
  );
}

/**
 * Requiring JSON forces browsers through a CORS preflight for cross-site
 * requests, so a foreign page cannot trigger external work with a plain
 * form/text POST.
 */
export function hasJsonContentType(
  request: Request,
): boolean {
  return /^application\/json\b/i.test(
    request.headers.get(
      "content-type",
    ) ?? "",
  );
}

export function unsupportedMediaType(): Response {
  return errorResponse(
    415,
    "UNSUPPORTED_MEDIA_TYPE",
    "Content-Type must be application/json.",
  );
}

/**
 * 429 for a usage denial (TASK-023). Fixed body: no counter, no subject, no
 * policy detail. `Retry-After` is whole seconds.
 */
export function rateLimited(
  retryAfterSeconds: number,
): Response {
  return new Response(
    JSON.stringify({
      ok: false,

      error: {
        code: "AIE_RATE_LIMITED",

        message:
          "Too many asset resolution requests.",
      },
    }),
    {
      status: 429,

      headers: {
        ...JSON_HEADERS,

        "Retry-After": String(
          retryAfterSeconds,
        ),
      },
    },
  );
}

/** Fail-closed answer when the usage controller itself fails. */
export function usageControlFailure(): Response {
  return errorResponse(
    500,
    "AIE_USAGE_CONTROL_ERROR",
    "Unable to check usage limits.",
  );
}
