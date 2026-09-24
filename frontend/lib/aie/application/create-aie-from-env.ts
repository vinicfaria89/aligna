import type {
  EvidenceProvider,
} from "../providers";

import {
  B3ListedAssetProvider,
} from "../providers/b3-listed-assets/b3-listed-asset-provider";

import {
  TesouroDiretoProvider,
} from "../providers/tesouro-direto/tesouro-direto-provider";

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
 * `B3ListedAssetProvider` (TASK-051B) is always registered: it is a small,
 * local, static catalog (lib/aie/providers/b3-listed-assets/catalog.ts) --
 * no credentials, no network, no environment dependency.
 *
 * `TesouroDiretoProvider` (TASK-058B) is always registered for the same
 * reason: a small, local, static catalog
 * (lib/aie/providers/tesouro-direto/catalog.ts), no credentials, no
 * network, no environment dependency.
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
      new B3ListedAssetProvider(),
      new TesouroDiretoProvider(),
    ],
  });
}
