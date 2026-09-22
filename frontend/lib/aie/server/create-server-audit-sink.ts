import {
  createNoopAuditSink,
} from "./aie-audit";

import type {
  AieAuditSink,
} from "./aie-audit";

import {
  createPlanejadorAuditSink,
} from "./planejador-audit-sink";

import type {
  PlanejadorAuditFetch,
} from "./planejador-audit-sink";

import {
  parsePlanejadorBaseUrl,
} from "./planejador-request-authorizer";

/**
 * SERVER-ONLY audit sink composition (TASK-022, durable storage TASK-037).
 *
 * This is the ONLY production module that reads the process environment for
 * audit storage. Two server-side-only variables (never the public prefix):
 *
 *   PLANEJADOR_AUTH_BASE_URL   the same Planejador base URL the authorizer
 *                              uses (create-server-authorizer.ts) -- the audit
 *                              endpoint lives on the same service
 *   AIE_AUDIT_SHARED_SECRET    the server-to-server secret for
 *                              POST /api/v1/aie-audit-events; never the
 *                              caller's Bearer token, never the JWT signing
 *                              secret (that sharing was rejected in TASK-018)
 *
 * Fail SAFE, not fail closed: when either variable is unset, empty or the URL
 * is not acceptable, this returns the no-op sink -- exactly the TASK-022
 * default -- instead of throwing. Auditing is best-effort by policy (see
 * aie-audit.ts): its own unavailability must never make the AIE unavailable,
 * so a missing/broken audit configuration silently drops events rather than
 * failing requests. This is the opposite failure direction of the request
 * authorizer (create-server-authorizer.ts), which fails CLOSED (deny-all) on
 * missing configuration, because an authorization gap is a security issue and
 * an audit gap is not one this module is allowed to turn into an outage.
 *
 * When durable storage changes, replace what is composed here (and only
 * here); routes, authorizers and handlers do not change.
 */
if (typeof window !== "undefined") {
  throw new Error(
    "The AIE audit sink composition must not be loaded in the browser.",
  );
}

export interface ServerAuditSinkOptions {
  fetch?: PlanejadorAuditFetch;
}

export function createServerAuditSink(
  options: ServerAuditSinkOptions = {},
): AieAuditSink {
  const rawBaseUrl =
    process.env
      .PLANEJADOR_AUTH_BASE_URL;

  const secret =
    process.env
      .AIE_AUDIT_SHARED_SECRET;

  const baseUrl =
    typeof rawBaseUrl === "string"
      ? parsePlanejadorBaseUrl(
          rawBaseUrl,
        )
      : null;

  const hasSecret =
    typeof secret === "string" &&
    secret.length > 0;

  if (
    baseUrl === null ||
    !hasSecret
  ) {
    return createNoopAuditSink();
  }

  return createPlanejadorAuditSink(
    {
      baseUrl,

      secret,

      ...(options.fetch
        ? { fetch: options.fetch }
        : {}),
    },
  );
}

let cached: AieAuditSink | null =
  null;

/** Process-wide sink, chosen once from the environment. */
export function getAieAuditSink(): AieAuditSink {
  if (!cached) {
    cached =
      createServerAuditSink();
  }

  return cached;
}
