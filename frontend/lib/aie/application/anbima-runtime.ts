import {
  AnbimaHttpClient,
} from "../infrastructure/anbima/anbima-http-client";

import type {
  AnbimaEnvironment,
  AnbimaFetch,
} from "../infrastructure/anbima/anbima-http-client";

import {
  AnbimaDebentureProvider,
} from "../providers/anbima-debenture-provider";

/**
 * ANBIMA runtime composition.
 *
 * This is the only place that maps external configuration (an injected
 * environment-like object) to the ANBIMA provider. The provider, the HTTP
 * client core, VerificationPolicy and AssetResolutionEngine never read the
 * process environment: the application boundary passes the values in.
 *
 *   env-like object -> resolveAnbimaRuntimeConfig -> AnbimaHttpClient
 *                   -> AnbimaDebentureProvider -> createAie({ providers })
 *
 * Variables:
 *   ANBIMA_CLIENT_ID      OAuth client id
 *   ANBIMA_CLIENT_SECRET  OAuth client secret
 *   ANBIMA_ENVIRONMENT    "production" (default) or "sandbox"
 *
 * Design decision: when neither credential is set, ANBIMA is DISABLED and the
 * factory returns null (never a half-configured provider). Setting only one
 * credential is a configuration error. Blank values count as not set.
 * ANBIMA_ENVIRONMENT is validated whenever it is set, so a typo is never
 * silently treated as production.
 *
 * Error messages contain variable names only, never their values.
 */

export const ANBIMA_ENV_CLIENT_ID =
  "ANBIMA_CLIENT_ID";

export const ANBIMA_ENV_CLIENT_SECRET =
  "ANBIMA_CLIENT_SECRET";

export const ANBIMA_ENV_ENVIRONMENT =
  "ANBIMA_ENVIRONMENT";

export type EnvLike = Record<
  string,
  string | undefined
>;

export type AnbimaConfigurationErrorCode =
  | "INCOMPLETE_CREDENTIALS"
  | "INVALID_ENVIRONMENT";

export class AnbimaConfigurationError extends Error {
  readonly code: AnbimaConfigurationErrorCode;

  constructor(
    code: AnbimaConfigurationErrorCode,
    message: string,
  ) {
    super(message);

    this.name =
      "AnbimaConfigurationError";

    this.code = code;
  }
}

export interface AnbimaRuntimeConfig {
  clientId: string;

  clientSecret: string;

  environment: AnbimaEnvironment;
}

export interface AnbimaRuntimeOptions {
  /** Test seam. Defaults to the global fetch inside AnbimaHttpClient. */
  fetchImpl?: AnbimaFetch;

  /** Test seam: current time in epoch milliseconds. */
  now?: () => number;
}

function readValue(
  env: EnvLike,
  name: string,
): string | undefined {
  const value = env[name]?.trim();

  return value
    ? value
    : undefined;
}

function resolveEnvironment(
  env: EnvLike,
): AnbimaEnvironment {
  const value = readValue(
    env,
    ANBIMA_ENV_ENVIRONMENT,
  )?.toLowerCase();

  if (value === undefined) {
    return "production";
  }

  if (
    value === "production" ||
    value === "sandbox"
  ) {
    return value;
  }

  throw new AnbimaConfigurationError(
    "INVALID_ENVIRONMENT",
    `${ANBIMA_ENV_ENVIRONMENT} must be "production" or "sandbox".`,
  );
}

/**
 * Returns the validated ANBIMA configuration, or null when ANBIMA is disabled
 * (no credentials at all).
 */
export function resolveAnbimaRuntimeConfig(
  env: EnvLike,
): AnbimaRuntimeConfig | null {
  const environment =
    resolveEnvironment(env);

  const clientId = readValue(
    env,
    ANBIMA_ENV_CLIENT_ID,
  );

  const clientSecret = readValue(
    env,
    ANBIMA_ENV_CLIENT_SECRET,
  );

  if (
    clientId === undefined &&
    clientSecret === undefined
  ) {
    return null;
  }

  if (
    clientId === undefined ||
    clientSecret === undefined
  ) {
    const missing =
      clientId === undefined
        ? ANBIMA_ENV_CLIENT_ID
        : ANBIMA_ENV_CLIENT_SECRET;

    throw new AnbimaConfigurationError(
      "INCOMPLETE_CREDENTIALS",
      `ANBIMA credentials are incomplete: ${missing} is missing.`,
    );
  }

  return {
    clientId,
    clientSecret,
    environment,
  };
}

/**
 * Builds the ANBIMA provider from an injected environment-like object.
 *
 * Returns null when ANBIMA is disabled. Never reads the process environment
 * itself and never performs a network request: the token is acquired lazily on
 * the first search.
 */
export function createAnbimaDebentureProviderFromEnv(
  env: EnvLike,
  options: AnbimaRuntimeOptions = {},
): AnbimaDebentureProvider | null {
  const config =
    resolveAnbimaRuntimeConfig(env);

  if (!config) {
    return null;
  }

  const client =
    new AnbimaHttpClient({
      clientId: config.clientId,

      clientSecret:
        config.clientSecret,

      environment:
        config.environment,

      fetch: options.fetchImpl,

      now: options.now,
    });

  return new AnbimaDebentureProvider(
    client,
  );
}
