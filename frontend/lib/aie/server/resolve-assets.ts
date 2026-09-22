import {
  MAX_PORTFOLIO_ROWS,
} from "../ingestion/portfolio-csv-limits";

import type {
  CandidateAsset,
  ResolutionResult,
} from "../contracts";

import {
  acquireServerAie,
  AieServerError,
  resolveAssetWithEngine,
} from "./resolve-asset";

/**
 * SERVER-ONLY batch resolution service (TASK-014).
 *
 *   CandidateAsset[] -> resolveAssets -> bounded concurrency
 *     -> resolveAssetWithEngine(engine, candidate) -> per-item outcome
 *
 * It reuses the single-asset use case and contains no resolution logic: it
 * does not build plans, evaluate the policy, call providers or touch ANBIMA.
 * It knows nothing about the process environment or any external source.
 *
 * Guarantees:
 * - the input order is always preserved in `items` (execution may interleave);
 * - no item is ever lost: every input position yields exactly one outcome;
 * - BOUNDED concurrency through a small worker pool over a shared index (at
 *   most `concurrency` workers, never one promise per input item);
 * - the server engine is obtained ONCE per batch, so an invalid configuration
 *   is attempted once (not N times) and reported on every item;
 * - PER-ITEM failure policy: one failing asset never fails the batch. This is
 *   intentionally different from the ingestion adapters, which are fail-fast
 *   because their input is structurally invalid as a whole, whereas here each
 *   asset is an independent lookup against external sources;
 * - a normal unresolved result and provider failures already recorded inside an
 *   InvestigationCase are NOT item errors: they are `ok: true` results;
 * - item errors are safe: fixed code + message, never the original exception,
 *   stack, secrets or configuration.
 *
 * Concurrency limit is NOT a rate limit: it bounds simultaneous work, not
 * requests per second. Rate limiting/caching belong to the external
 * infrastructure (a later task), not to this generic service.
 *
 * Not implemented (future): deduplication, caching, retries, persistence,
 * queues/background jobs, cancellation. The same candidate listed twice is
 * resolved twice and keeps both positions.
 */

export const DEFAULT_BATCH_CONCURRENCY = 3;

export const MAX_BATCH_CONCURRENCY = 10;

/**
 * Defensive limit: each lookup may trigger an external request, and a batch
 * is resolved in one HTTP request/response. Larger inputs are rejected, never
 * silently truncated; split them into several batches.
 */
export const MAX_BATCH_SIZE =
  MAX_PORTFOLIO_ROWS;

export interface ResolveAssetsOptions {
  /** Integer in [1, MAX_BATCH_CONCURRENCY]. Default DEFAULT_BATCH_CONCURRENCY. */
  concurrency?: number;
}

export type BatchResolutionItemErrorCode =
  | "AIE_CONFIGURATION_UNAVAILABLE"
  | "AIE_INTERNAL_ERROR";

export interface BatchResolutionItemError {
  code: BatchResolutionItemErrorCode;

  message: string;
}

interface BatchResolutionItemBase {
  /** Position in the input array. */
  index: number;

  candidateAssetId: string;
}

export type BatchResolutionItem =
  | (BatchResolutionItemBase & {
      ok: true;

      result: ResolutionResult;
    })
  | (BatchResolutionItemBase & {
      ok: false;

      error: BatchResolutionItemError;
    });

export interface BatchResolutionResult {
  items: BatchResolutionItem[];
}

export type BatchResolutionErrorCode =
  | "INVALID_INPUT"
  | "INVALID_CONCURRENCY"
  | "BATCH_TOO_LARGE";

/** Thrown for an invalid batch request itself (never for an item failure). */
export class BatchResolutionError extends Error {
  readonly code: BatchResolutionErrorCode;

  constructor(
    code: BatchResolutionErrorCode,
  ) {
    super(
      code === "INVALID_INPUT"
        ? "Candidate assets must be an array."
        : code === "INVALID_CONCURRENCY"
          ? `Concurrency must be an integer between 1 and ${MAX_BATCH_CONCURRENCY}.`
          : `A batch may contain at most ${MAX_BATCH_SIZE} candidate assets.`,
    );

    this.name =
      "BatchResolutionError";

    this.code = code;
  }
}

export type AssetResolver = (
  candidateAsset: CandidateAsset,
) => Promise<ResolutionResult>;

const CONFIGURATION_ERROR: BatchResolutionItemError =
  {
    code:
      "AIE_CONFIGURATION_UNAVAILABLE",

    message:
      "Asset resolution is temporarily unavailable.",
  };

const INTERNAL_ERROR: BatchResolutionItemError =
  {
    code: "AIE_INTERNAL_ERROR",

    message:
      "Unable to resolve asset.",
  };

function toItemError(
  error: unknown,
): BatchResolutionItemError {
  // Fresh copies: callers can never mutate the shared constants.
  return error instanceof
    AieServerError &&
    error.kind === "configuration"
    ? { ...CONFIGURATION_ERROR }
    : { ...INTERNAL_ERROR };
}

function idOf(
  candidateAsset: unknown,
): string {
  if (
    typeof candidateAsset ===
      "object" &&
    candidateAsset !== null &&
    typeof (
      candidateAsset as {
        id?: unknown;
      }
    ).id === "string"
  ) {
    return (
      candidateAsset as {
        id: string;
      }
    ).id;
  }

  return "";
}

function validate(
  candidateAssets: unknown,
  options: ResolveAssetsOptions,
): {
  candidates: readonly CandidateAsset[];

  concurrency: number;
} {
  if (!Array.isArray(candidateAssets)) {
    throw new BatchResolutionError(
      "INVALID_INPUT",
    );
  }

  // Only `undefined` selects the default: null or any other value is rejected.
  const concurrency: unknown =
    options.concurrency === undefined
      ? DEFAULT_BATCH_CONCURRENCY
      : options.concurrency;

  if (
    typeof concurrency !== "number" ||
    !Number.isInteger(concurrency) ||
    concurrency < 1 ||
    concurrency > MAX_BATCH_CONCURRENCY
  ) {
    throw new BatchResolutionError(
      "INVALID_CONCURRENCY",
    );
  }

  if (
    candidateAssets.length >
    MAX_BATCH_SIZE
  ) {
    throw new BatchResolutionError(
      "BATCH_TOO_LARGE",
    );
  }

  return {
    candidates:
      candidateAssets as CandidateAsset[],

    concurrency,
  };
}

/**
 * Generic bounded-concurrency batch runner over an injectable resolver.
 * Kept separate so it can be tested with a fake resolver.
 */
export async function resolveAssetsWithResolver(
  candidateAssets: readonly CandidateAsset[],
  resolver: AssetResolver,
  options: ResolveAssetsOptions = {},
): Promise<BatchResolutionResult> {
  const { candidates, concurrency } =
    validate(
      candidateAssets,
      options,
    );

  const items: BatchResolutionItem[] =
    new Array(candidates.length);

  let next = 0;

  const runItem = async (
    index: number,
  ): Promise<BatchResolutionItem> => {
    const candidateAsset =
      candidates[index] as CandidateAsset;

    const base = {
      index,

      candidateAssetId:
        idOf(candidateAsset),
    };

    try {
      return {
        ...base,

        ok: true,

        result: await resolver(
          candidateAsset,
        ),
      };
    } catch (error) {
      return {
        ...base,

        ok: false,

        error: toItemError(error),
      };
    }
  };

  /*
   * Worker pool: each worker repeatedly claims the next unclaimed index. The
   * claim is synchronous, so no index is ever processed twice. At most
   * `concurrency` workers exist; items are started lazily as workers free up.
   */
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;

      if (index >= candidates.length) {
        return;
      }

      next += 1;

      items[index] =
        await runItem(index);
    }
  };

  await Promise.all(
    Array.from(
      {
        length: Math.min(
          concurrency,
          candidates.length,
        ),
      },
      worker,
    ),
  );

  return {
    items,
  };
}

/**
 * Resolves many candidates through the server AIE. An empty batch returns
 * `{ items: [] }` immediately, without obtaining the engine.
 */
export async function resolveAssets(
  candidateAssets: readonly CandidateAsset[],
  options: ResolveAssetsOptions = {},
): Promise<BatchResolutionResult> {
  const { candidates } = validate(
    candidateAssets,
    options,
  );

  if (candidates.length === 0) {
    return {
      items: [],
    };
  }

  let engine: ReturnType<
    typeof acquireServerAie
  >;

  try {
    engine = acquireServerAie();
  } catch (error) {
    // One initialization attempt for the whole batch: every item reports it.
    const itemError =
      toItemError(error);

    return {
      items: candidates.map(
        (candidate, index) => ({
          index,

          candidateAssetId:
            idOf(candidate),

          ok: false as const,

          error: { ...itemError },
        }),
      ),
    };
  }

  return resolveAssetsWithResolver(
    candidates,
    (candidateAsset) =>
      resolveAssetWithEngine(
        engine,
        candidateAsset,
      ),
    options,
  );
}
