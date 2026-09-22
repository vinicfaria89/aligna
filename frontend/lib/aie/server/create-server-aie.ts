import type {
  AnbimaRuntimeOptions,
} from "../application/anbima-runtime";

import {
  createAieFromEnv,
} from "../application/create-aie-from-env";

import type {
  AssetResolutionEngine,
} from "../resolution/asset-resolution-engine";

/**
 * SERVER-ONLY composition boundary for the AIE.
 *
 * This is the ONLY production module under frontend/ that reads the process
 * environment for AIE configuration. Do not import it from a "use client"
 * module, a React component or any code that ships to the browser.
 *
 *   process environment -> createAieFromEnv -> AnbimaHttpClient
 *     -> AnbimaDebentureProvider -> AssetResolutionEngine
 *
 * Variables (server-side only, never prefix them with the public prefix):
 *   ANBIMA_CLIENT_ID
 *   ANBIMA_CLIENT_SECRET
 *   ANBIMA_ENVIRONMENT   "production" (default) or "sandbox"
 *
 * Only these three variables are forwarded, never the whole environment.
 *
 * Behavior (see TASK-007/TASK-008):
 * - no ANBIMA credentials: the engine starts with ANBIMA disabled;
 * - valid credentials: the engine includes AnbimaDebentureProvider;
 * - incomplete credentials or an invalid environment: fails fast with the
 *   safe AnbimaConfigurationError (variable names only, never values).
 *
 * Constructing the engine performs no network request: the OAuth token is
 * acquired lazily on the first ANBIMA search.
 *
 * Defense in depth: the framework only inlines variables with the public
 * prefix into browser bundles, so these values are undefined there; the
 * guard below additionally fails loudly if this module is ever loaded in a
 * browser. A build-time "server-only" import guard is not available because
 * the package is not a dependency of this project (see TASK-008).
 *
 * RegistryProvider/EntityRegistry are a separate concern and are not
 * registered here.
 */
if (typeof window !== "undefined") {
  throw new Error(
    "The AIE server composition boundary must not be loaded in the browser.",
  );
}

export function createServerAie(
  options: AnbimaRuntimeOptions = {},
): AssetResolutionEngine {
  return createAieFromEnv(
    {
      ANBIMA_CLIENT_ID:
        process.env.ANBIMA_CLIENT_ID,

      ANBIMA_CLIENT_SECRET:
        process.env.ANBIMA_CLIENT_SECRET,

      ANBIMA_ENVIRONMENT:
        process.env.ANBIMA_ENVIRONMENT,
    },
    options,
  );
}

let cached: AssetResolutionEngine | null =
  null;

/**
 * Process-wide engine, so the in-memory OAuth token cache is shared between
 * requests. Only successful creations are cached: a configuration error is
 * thrown again on the next call.
 */
export function getServerAie(): AssetResolutionEngine {
  if (!cached) {
    cached = createServerAie();
  }

  return cached;
}
