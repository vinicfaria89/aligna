import type {
  EvidenceProvider,
} from "../providers";

import {
  createAnbimaDebentureProviderFromEnv,
} from "./anbima-runtime";

import type {
  AnbimaRuntimeOptions,
  EnvLike,
} from "./anbima-runtime";

import {
  createAie,
} from "./create-aie";

export interface CreateAieFromEnvOptions
  extends AnbimaRuntimeOptions {
  /** Additional providers registered next to the configured ones. */
  providers?: readonly EvidenceProvider[];
}

/**
 * Runtime composition: registers ANBIMA only when the injected environment
 * explicitly provides valid credentials. Without them the engine is created
 * with no ANBIMA provider and never contacts ANBIMA.
 *
 * The caller (application boundary) supplies the environment object; nothing
 * under lib/aie reads the process environment directly.
 */
export function createAieFromEnv(
  env: EnvLike,
  options: CreateAieFromEnvOptions = {},
) {
  const anbima =
    createAnbimaDebentureProviderFromEnv(
      env,
      options,
    );

  return createAie({
    providers: [
      ...(options.providers ?? []),
      ...(anbima ? [anbima] : []),
    ],
  });
}
