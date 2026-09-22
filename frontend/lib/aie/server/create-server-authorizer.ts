import {
  createDenyAllAuthorizer,
} from "./deny-all-authorizer";

import {
  parsePlanejadorBaseUrl,
  PlanejadorRequestAuthorizer,
} from "./planejador-request-authorizer";

import type {
  PlanejadorFetch,
} from "./planejador-request-authorizer";

import type {
  AieRequestAuthorizer,
} from "./request-authorization";

/**
 * SERVER-ONLY composition of the AIE request authorizer (TASK-020).
 *
 * This is the ONLY production module that reads the process environment for the
 * identity integration. Variable (server-side only, never use the public
 * prefix on it):
 *
 *   PLANEJADOR_AUTH_BASE_URL   base URL of the Planejador API used for token
 *                              introspection, e.g. https://api.example.com
 *
 * Fail closed: when the variable is unset, empty or not an acceptable URL
 * (https required, http only for a loopback host, no credentials/query/
 * fragment), the authorizer stays deny-all. Nothing is thrown at import time.
 *
 * It is distinct from the browser-facing Planejador URL because the server may
 * need an internal address, and it never reaches the client.
 */
if (typeof window !== "undefined") {
  throw new Error(
    "The AIE authorizer composition must not be loaded in the browser.",
  );
}

export interface ServerAuthorizerOptions {
  fetch?: PlanejadorFetch;

  timeoutMs?: number;
}

export function createServerAuthorizer(
  options: ServerAuthorizerOptions = {},
): AieRequestAuthorizer {
  const configured =
    process.env
      .PLANEJADOR_AUTH_BASE_URL;

  const baseUrl =
    typeof configured === "string"
      ? parsePlanejadorBaseUrl(
          configured,
        )
      : null;

  if (baseUrl === null) {
    return createDenyAllAuthorizer();
  }

  return new PlanejadorRequestAuthorizer(
    {
      baseUrl,

      ...(options.fetch
        ? { fetch: options.fetch }
        : {}),

      ...(options.timeoutMs !==
      undefined
        ? {
            timeoutMs:
              options.timeoutMs,
          }
        : {}),
    },
  );
}

let cached: AieRequestAuthorizer | null =
  null;

/** Process-wide authorizer, chosen once from the environment. */
export function getServerAuthorizer(): AieRequestAuthorizer {
  if (!cached) {
    cached = createServerAuthorizer();
  }

  return cached;
}
