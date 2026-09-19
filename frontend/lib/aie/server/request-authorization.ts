import {
  errorResponse,
} from "./aie-http";

/**
 * SERVER-ONLY authorization boundary for the AIE HTTP routes (TASK-017).
 *
 *   route -> handler -> requireAuthorization -> (authorized) validation -> use case
 *
 * The application has no identity system yet, so this module defines a small
 * pluggable contract and ships ONE production implementation: deny everything.
 * A future real authentication system implements AieRequestAuthorizer and is
 * returned by getAieRequestAuthorizer(); routes and business logic do not change.
 *
 * Deliberately absent: API keys, JWTs, tokens, passwords, fake users, roles read
 * from the payload, trust inferred from localhost / Origin / Referer /
 * User-Agent / IP / cookies. Nothing here reads the process environment, and
 * nothing is configurable from the browser.
 *
 * Privacy: the principal is request-level metadata. It never leaves this
 * module: requireAuthorization() returns only a denial Response (or null when
 * authorized), so the principal cannot reach CandidateAsset, ProviderQuery,
 * AssetEvidence, ANBIMA calls or ResolutionResult.
 */

export interface AieRequestPrincipal {
  subject: string;

  roles?: string[];
}

export type AieAuthorizationDenialReason =
  | "unauthenticated"
  | "forbidden";

export type AieAuthorizationResult =
  | {
      authorized: true;

      principal: AieRequestPrincipal;
    }
  | {
      authorized: false;

      reason: AieAuthorizationDenialReason;
    };

export interface AieRequestAuthorizer {
  /**
   * Decides from request metadata (headers, cookies owned by a real identity
   * system). It receives a body-less copy of the request, so it cannot consume
   * the payload, which is only read after authorization succeeded.
   */
  authorize(
    request: Request,
  ): Promise<AieAuthorizationResult>;
}

/** Options accepted by the AIE HTTP handlers (an injection seam for tests). */
export interface AieHttpOptions {
  authorizer?: AieRequestAuthorizer;
}

const DENY_ALL_AUTHORIZER: AieRequestAuthorizer =
  {
    authorize: async () => ({
      authorized: false,

      reason: "unauthenticated",
    }),
  };

/** The fail-closed production policy: no request is ever authorized. */
export function createDenyAllAuthorizer(): AieRequestAuthorizer {
  return DENY_ALL_AUTHORIZER;
}

/**
 * The authorizer used by the real routes. Until a real identity provider is
 * integrated it denies every request. Replace the returned implementation
 * here (and only here) when that system exists.
 */
export function getAieRequestAuthorizer(): AieRequestAuthorizer {
  return DENY_ALL_AUTHORIZER;
}

function unauthenticated(): Response {
  return errorResponse(
    401,
    "AIE_UNAUTHENTICATED",
    "Authentication is required.",
  );
}

function forbidden(): Response {
  return errorResponse(
    403,
    "AIE_FORBIDDEN",
    "You are not allowed to perform this operation.",
  );
}

function authorizationFailure(): Response {
  return errorResponse(
    500,
    "AIE_AUTHORIZATION_ERROR",
    "Unable to authorize request.",
  );
}

function isValidPrincipal(
  principal: unknown,
): boolean {
  return (
    typeof principal === "object" &&
    principal !== null &&
    typeof (
      principal as {
        subject?: unknown;
      }
    ).subject === "string" &&
    (
      principal as {
        subject: string;
      }
    ).subject.trim().length > 0
  );
}

/**
 * Runs the authorizer and returns:
 * - null when the request is authorized (the caller may continue);
 * - a safe 401/403 Response when it is denied;
 * - a safe 500 Response when the authorizer itself fails or answers something
 *   that is not a valid result (fail closed: the request is NOT processed).
 *
 * Responses carry fixed codes and messages only: never the reason detail,
 * claims, session internals, stacks or the principal.
 */
export async function requireAuthorization(
  request: Request,
  authorizer: AieRequestAuthorizer,
): Promise<Response | null> {
  let result: unknown;

  try {
    // Body-less copy: the authorizer can read headers but never the payload.
    result =
      await authorizer.authorize(
        new Request(request.url, {
          method: request.method,

          headers: request.headers,
        }),
      );
  } catch {
    return authorizationFailure();
  }

  if (
    typeof result !== "object" ||
    result === null
  ) {
    return authorizationFailure();
  }

  const decision = result as {
    authorized?: unknown;

    principal?: unknown;

    reason?: unknown;
  };

  if (decision.authorized === true) {
    return isValidPrincipal(
      decision.principal,
    )
      ? null
      : authorizationFailure();
  }

  if (decision.authorized === false) {
    if (
      decision.reason === "forbidden"
    ) {
      return forbidden();
    }

    if (
      decision.reason ===
      "unauthenticated"
    ) {
      return unauthenticated();
    }
  }

  return authorizationFailure();
}
