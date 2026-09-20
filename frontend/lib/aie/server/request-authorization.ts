import {
  errorResponse,
} from "./aie-http";

import {
  getServerAuthorizer,
} from "./create-server-authorizer";

export {
  createDenyAllAuthorizer,
} from "./deny-all-authorizer";

import type {
  AieAuditOptions,
} from "./aie-audit";

/**
 * SERVER-ONLY authorization boundary for the AIE HTTP routes (TASK-017,
 * extended by TASK-020).
 *
 *   route -> handler -> requireAuthorization -> (authorized) validation -> use case
 *
 * This module defines the small pluggable contract. The production
 * implementation is chosen in create-server-authorizer.ts: the Planejador-backed
 * authorizer when its server-side configuration is valid, otherwise deny
 * everything (fail closed). Routes and business logic do not change.
 *
 * Deliberately absent: API keys, JWTs, tokens, passwords, fake users, roles read
 * from the payload, trust inferred from localhost / Origin / Referer /
 * User-Agent / IP / cookies. Nothing here reads the process environment (that
 * happens in exactly one composition module), and nothing is configurable from
 * the browser.
 *
 * Privacy: the principal is request-level metadata. It never leaves this
 * module: requireAuthorization() returns only a denial Response (or null when
 * authorized), and evaluateAuthorization() (used by the audited orchestration,
 * TASK-022) exposes only the subject identifier, never roles or the principal
 * object, so it cannot reach CandidateAsset, ProviderQuery, AssetEvidence,
 * ANBIMA calls or ResolutionResult.
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

      /**
       * Optional identifier of an authenticated caller that was denied (for
       * example a forbidden role or a missing entitlement). Used only for the
       * audit trail; never set for an unauthenticated caller.
       */
      subject?: string;
    };

/**
 * The operation being authorized. It is a fixed literal chosen by each route
 * (never read from a header, body, query string or anything else the client
 * controls).
 */
export type AieOperation =
  | "resolve-asset"
  | "resolve-assets";

export interface AieAuthorizationContext {
  operation: AieOperation;
}

export interface AieRequestAuthorizer {
  /**
   * Decides from request metadata (headers, cookies owned by a real identity
   * system) and the operation. It receives a body-less copy of the request, so
   * it cannot consume the payload, which is only read after authorization
   * succeeded.
   */
  authorize(
    request: Request,
    context: AieAuthorizationContext,
  ): Promise<AieAuthorizationResult>;
}

/** Options accepted by the AIE HTTP handlers (an injection seam for tests). */
export interface AieHttpOptions {
  authorizer?: AieRequestAuthorizer;

  /** Audit seams (sink, clock, correlation id); defaults are server-side. */
  audit?: AieAuditOptions;
}

/**
 * The authorizer used by the real routes: the Planejador-backed one when
 * PLANEJADOR_AUTH_BASE_URL is valid, otherwise deny-all (see
 * create-server-authorizer.ts). The choice is made there and only there.
 */
export function getAieRequestAuthorizer(): AieRequestAuthorizer {
  return getServerAuthorizer();
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
 * The decision of an authorization, reduced to what the orchestration needs:
 * the outcome, the ready-to-send safe Response of a denial, and the subject
 * identifier (only when the caller is known). Never the principal or roles.
 */
export type AieAuthorizationOutcome =
  | {
      status: "authorized";

      subject: string;
    }
  | {
      status:
        | "unauthenticated"
        | "forbidden"
        | "authorization-error";

      subject?: string;

      response: Response;
    };

/**
 * Runs the authorizer and returns:
 * - `authorized` (the caller may continue);
 * - `unauthenticated` / `forbidden` with a safe 401/403 Response when denied;
 * - `authorization-error` with a safe 500 Response when the authorizer itself
 *   fails or answers something that is not a valid result (fail closed: the
 *   request is NOT processed).
 *
 * Responses carry fixed codes and messages only: never the reason detail,
 * claims, session internals, stacks or the principal.
 */
export async function evaluateAuthorization(
  request: Request,
  authorizer: AieRequestAuthorizer,
  operation: AieOperation,
): Promise<AieAuthorizationOutcome> {
  const failure = (): AieAuthorizationOutcome => ({
    status: "authorization-error",

    response: authorizationFailure(),
  });

  let result: unknown;

  try {
    // Body-less copy: the authorizer can read headers but never the payload.
    result =
      await authorizer.authorize(
        new Request(request.url, {
          method: request.method,

          headers: request.headers,
        }),
        {
          operation,
        },
      );
  } catch {
    return failure();
  }

  if (
    typeof result !== "object" ||
    result === null
  ) {
    return failure();
  }

  const decision = result as {
    authorized?: unknown;

    principal?: unknown;

    reason?: unknown;

    subject?: unknown;
  };

  if (decision.authorized === true) {
    return isValidPrincipal(
      decision.principal,
    )
      ? {
          status: "authorized",

          subject: (
            decision.principal as {
              subject: string;
            }
          ).subject,
        }
      : failure();
  }

  if (decision.authorized === false) {
    if (
      decision.reason === "forbidden"
    ) {
      return {
        status: "forbidden",

        ...(typeof decision.subject ===
        "string"
          ? {
              subject:
                decision.subject,
            }
          : {}),

        response: forbidden(),
      };
    }

    if (
      decision.reason ===
      "unauthenticated"
    ) {
      // An unauthenticated caller has no subject by definition.
      return {
        status: "unauthenticated",

        response: unauthenticated(),
      };
    }
  }

  return failure();
}

/**
 * Authorization without auditing: null when authorized, otherwise the safe
 * denial/failure Response.
 */
export async function requireAuthorization(
  request: Request,
  authorizer: AieRequestAuthorizer,
  operation: AieOperation,
): Promise<Response | null> {
  const outcome =
    await evaluateAuthorization(
      request,
      authorizer,
      operation,
    );

  return outcome.status === "authorized"
    ? null
    : outcome.response;
}