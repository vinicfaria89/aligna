import type {
  AieOperation,
} from "./request-authorization";

/**
 * SERVER-ONLY usage-control contract for the AIE HTTP routes (TASK-023).
 *
 * It controls how often an AUTHENTICATED IDENTITY may use the AIE. It is NOT the
 * technical ANBIMA limiter (14 requests/second per process, TASK-015): that one
 * protects an external source, this one limits a user.
 *
 *   authorized (subject known) -> usage controller -> validation -> resolution
 *
 * Generic on purpose: no environment, no network, no storage, no ANBIMA, billing
 * or domain code. The context carries ONLY the authenticated subject and the
 * fixed operation literal: never an asset, an instrument code, a payload, an IP,
 * a token or an account. Clients cannot influence limits, windows, counters or
 * the retry hint.
 *
 * Only short-window request rate limiting exists today. The `quota` denial reason
 * keeps the contract able to express a future quota decision (for example a
 * product-defined usage plan) without reshaping it; nothing calls a billing
 * system.
 */

export interface AieUsageContext {
  /** The authenticated subject identifier. */
  subject: string;

  /** Fixed literal chosen by the route. */
  operation: AieOperation;
}

export type AieUsageDenialReason =
  | "rate-limit"
  | "quota";

export type AieUsageDecision =
  | {
      allowed: true;
    }
  | {
      allowed: false;

      reason: AieUsageDenialReason;

      /** Whole seconds until a retry can succeed (>= 1). */
      retryAfterSeconds: number;
    };

export interface AieUsageController {
  check(
    context: AieUsageContext,
  ): Promise<AieUsageDecision>;
}

export interface AieOperationUsagePolicy {
  /** Integer >= 1: requests allowed per window. */
  limit: number;

  /** Finite > 0: window length in milliseconds. */
  windowMs: number;
}

export type AieUsagePolicy = Record<
  AieOperation,
  AieOperationUsagePolicy
>;

export const AIE_USAGE_WINDOW_MS =
  60_000;

/**
 * Single asset: 30 requests per minute per subject (one every two seconds on
 * average): generous for interactive use, since each call is one lookup against
 * an already cached feed.
 */
export const AIE_MAX_SINGLE_REQUESTS_PER_MINUTE = 30;

/**
 * Batch: 5 requests per minute per subject. One HTTP batch consumes ONE slot no
 * matter how many assets it carries (MAX_BATCH_SIZE, concurrency and the ANBIMA
 * limiter bound the work of a single batch); the heavy operation is the scarce one.
 */
export const AIE_MAX_BATCH_REQUESTS_PER_MINUTE = 5;

/** Separate buckets: single and batch never consume each other's slots. */
export const AIE_DEFAULT_USAGE_POLICY: AieUsagePolicy =
  Object.freeze({
    "resolve-asset": Object.freeze({
      limit:
        AIE_MAX_SINGLE_REQUESTS_PER_MINUTE,

      windowMs: AIE_USAGE_WINDOW_MS,
    }),

    "resolve-assets": Object.freeze({
      limit: AIE_MAX_BATCH_REQUESTS_PER_MINUTE,

      windowMs: AIE_USAGE_WINDOW_MS,
    }),
  });

const DEFAULT_RETRY_AFTER_SECONDS = 60;

const MAX_RETRY_AFTER_SECONDS = 86_400;

export type AieUsageInterpretation =
  | {
      kind: "allowed";
    }
  | {
      kind: "limited";

      retryAfterSeconds: number;
    }
  | {
      kind: "invalid";
    };

/**
 * Reads whatever a controller answered. Only a well-formed decision is honored;
 * anything else is `invalid` and the caller fails closed (a malfunctioning
 * limiter must never turn into "allowed"). The retry hint is normalized to a
 * whole number of seconds in [1, 86400].
 */
export function interpretUsageDecision(
  decision: unknown,
): AieUsageInterpretation {
  if (
    typeof decision !== "object" ||
    decision === null
  ) {
    return { kind: "invalid" };
  }

  const value = decision as {
    allowed?: unknown;

    reason?: unknown;

    retryAfterSeconds?: unknown;
  };

  if (value.allowed === true) {
    return { kind: "allowed" };
  }

  if (
    value.allowed === false &&
    (value.reason === "rate-limit" ||
      value.reason === "quota")
  ) {
    const retry =
      value.retryAfterSeconds;

    return {
      kind: "limited",

      retryAfterSeconds:
        typeof retry === "number" &&
        Number.isFinite(retry)
          ? Math.min(
              MAX_RETRY_AFTER_SECONDS,
              Math.max(
                1,
                Math.ceil(retry),
              ),
            )
          : DEFAULT_RETRY_AFTER_SECONDS,
    };
  }

  return { kind: "invalid" };
}
