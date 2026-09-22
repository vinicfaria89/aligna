import {
  AnbimaConfigurationError,
} from "../application/anbima-runtime";

import type {
  CandidateAsset,
  ResolutionResult,
} from "../contracts";

import type {
  AssetResolutionEngine,
} from "../resolution/asset-resolution-engine";

import {
  getServerAie,
} from "./create-server-aie";

/**
 * SERVER-ONLY use case: resolve one asset through the AIE.
 *
 *   server consumer -> resolveAsset -> getServerAie() -> AssetResolutionEngine
 *
 * Consumers (future routes, server actions, services) never see providers,
 * ANBIMA, tokens, the process environment, VerificationPolicy or the
 * execution pipeline. Do not import this module from client code, and do not
 * export it from the browser-safe lib/aie barrel.
 *
 * This module contains NO business logic: it does not evaluate the policy,
 * build plans, call providers, transform ANBIMA records, create VerifiedAsset
 * or match anything. It delegates entirely to AssetResolutionEngine.
 *
 * Three outcomes stay distinct:
 * 1. an unresolved asset is a NORMAL return value (status needs-more-evidence);
 * 2. provider/search failures are already recorded inside the returned
 *    InvestigationCase and are returned, never thrown;
 * 3. a failure to obtain or run the engine throws AieServerError, a safe
 *    error with a fixed message (no secret, no environment detail, and the
 *    original error is deliberately not attached).
 */

export type AieServerErrorKind =
  | "configuration"
  | "unexpected";

export class AieServerError extends Error {
  readonly kind: AieServerErrorKind;

  constructor(
    kind: AieServerErrorKind,
  ) {
    super(
      kind === "configuration"
        ? "The AIE server configuration is invalid."
        : "The AIE failed to resolve the asset.",
    );

    this.name = "AieServerError";

    this.kind = kind;
  }
}

/** Delegation helper, kept separate so it can be tested with a fake engine. */
export async function resolveAssetWithEngine(
  engine: Pick<
    AssetResolutionEngine,
    "resolve"
  >,
  candidateAsset: CandidateAsset,
): Promise<ResolutionResult> {
  try {
    return await engine.resolve({
      candidateAsset,
    });
  } catch {
    throw new AieServerError(
      "unexpected",
    );
  }
}

/**
 * Obtains the server engine, mapping any failure to a safe AieServerError
 * (single place for this classification, reused by the batch service).
 */
export function acquireServerAie(): AssetResolutionEngine {
  try {
    return getServerAie();
  } catch (error) {
    throw new AieServerError(
      error instanceof
        AnbimaConfigurationError
        ? "configuration"
        : "unexpected",
    );
  }
}

export async function resolveAsset(
  candidateAsset: CandidateAsset,
): Promise<ResolutionResult> {
  return resolveAssetWithEngine(
    acquireServerAie(),
    candidateAsset,
  );
}
