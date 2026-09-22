import {
  AIE_DEFAULT_USAGE_POLICY,
} from "./aie-usage";

import type {
  AieUsageContext,
  AieUsageController,
  AieUsageDecision,
  AieUsagePolicy,
} from "./aie-usage";

/**
 * SERVER-ONLY in-memory usage controller (TASK-023): the first, per-process
 * implementation of AieUsageController.
 *
 * LIMITATIONS (do not mistake this for production-global enforcement):
 * - it is per PROCESS: with several server instances each one has its own
 *   counters, so a user can use up to N x the limit across N instances;
 * - it is NOT durable: a restart resets every counter;
 * - it does not coordinate anything with the identity system or billing.
 * A global limit needs a shared store (future work).
 *
 * Algorithm: SLIDING WINDOW LOG per (operation, subject). A bucket keeps the
 * timestamps of the requests accepted in the last `windowMs`; a request is
 * allowed while fewer than `limit` remain. A denied request is NOT recorded, so
 * hammering does not extend the block; the retry hint is the time until the
 * oldest accepted request leaves the window. Time comes from an injectable
 * clock: no timers, no sleeping, no busy-wait.
 *
 * Memory safety (bounded, no timers):
 * - a bucket holds at most `limit` timestamps;
 * - expired timestamps are purged on every check of that bucket;
 * - a sweep removes every bucket whose newest request is older than its window;
 *   it runs at most once per `sweepIntervalMs`, piggybacking on traffic, so
 *   identity keys do not live forever;
 * - a hard cap (`maxTrackedKeys`) guards against key growth: when it is reached
 *   and a sweep frees nothing, a NEW key is denied as rate-limited (fail
 *   closed) instead of growing the map.
 *
 * Keys are the fixed operation literal plus the authenticated subject, nothing
 * else: no asset, payload, instrument code, IP or token ever reaches this module
 * (the context type has no such field).
 */

export const DEFAULT_MAX_TRACKED_KEYS =
  50_000;

const MAX_SUBJECT_LENGTH = 256;

export interface InMemoryUsageControllerOptions {
  /** Defaults to AIE_DEFAULT_USAGE_POLICY. */
  policy?: AieUsagePolicy;

  /** Test seam: current time in epoch milliseconds. */
  now?: () => number;

  /** Hard cap on tracked (operation, subject) keys. */
  maxTrackedKeys?: number;

  /** Minimum time between sweeps. Defaults to the shortest window. */
  sweepIntervalMs?: number;
}

interface Bucket {
  windowMs: number;

  /** Accepted request times, oldest first. */
  hits: number[];
}

/** Fixed-message failure: carries no subject, key or state. */
export class AieUsageControlError extends Error {
  constructor() {
    super(
      "The usage control could not evaluate the request.",
    );

    this.name = "AieUsageControlError";
  }
}

function validatePolicy(
  policy: AieUsagePolicy,
): void {
  for (const operation of [
    "resolve-asset",
    "resolve-assets",
  ] as const) {
    const entry = policy[operation];

    if (
      !entry ||
      !Number.isInteger(entry.limit) ||
      entry.limit < 1 ||
      typeof entry.windowMs !==
        "number" ||
      !Number.isFinite(
        entry.windowMs,
      ) ||
      entry.windowMs <= 0
    ) {
      throw new RangeError(
        "Invalid usage policy.",
      );
    }
  }
}

export class InMemoryUsageController
  implements AieUsageController
{
  readonly #policy: AieUsagePolicy;

  readonly #now: () => number;

  readonly #maxTrackedKeys: number;

  readonly #sweepIntervalMs: number;

  readonly #buckets = new Map<
    string,
    Bucket
  >();

  #lastSweepAt: number;

  constructor(
    options: InMemoryUsageControllerOptions = {},
  ) {
    const policy =
      options.policy ??
      AIE_DEFAULT_USAGE_POLICY;

    validatePolicy(policy);

    const maxTrackedKeys =
      options.maxTrackedKeys ??
      DEFAULT_MAX_TRACKED_KEYS;

    if (
      !Number.isInteger(
        maxTrackedKeys,
      ) ||
      maxTrackedKeys < 1
    ) {
      throw new RangeError(
        "Invalid maxTrackedKeys.",
      );
    }

    const sweepIntervalMs =
      options.sweepIntervalMs ??
      Math.min(
        policy["resolve-asset"]
          .windowMs,
        policy["resolve-assets"]
          .windowMs,
      );

    if (
      typeof sweepIntervalMs !==
        "number" ||
      !Number.isFinite(
        sweepIntervalMs,
      ) ||
      sweepIntervalMs <= 0
    ) {
      throw new RangeError(
        "Invalid sweepIntervalMs.",
      );
    }

    this.#policy = policy;

    this.#now =
      options.now ??
      (() => Date.now());

    this.#maxTrackedKeys =
      maxTrackedKeys;

    this.#sweepIntervalMs =
      sweepIntervalMs;

    this.#lastSweepAt = this.#now();
  }

  /** Number of tracked (operation, subject) keys. For tests and monitoring. */
  get trackedKeys(): number {
    return this.#buckets.size;
  }

  async check(
    context: AieUsageContext,
  ): Promise<AieUsageDecision> {
    const { subject, operation } =
      context;

    const policy =
      this.#policy[operation];

    if (
      !policy ||
      typeof subject !== "string" ||
      subject.length === 0 ||
      subject.length > MAX_SUBJECT_LENGTH
    ) {
      // Unknown operation or unusable subject: never guess (fail closed).
      throw new AieUsageControlError();
    }

    const now = this.#now();

    this.sweepIfDue(now);

    // The operation literal has no "|", so the key is unambiguous.
    const key = `${operation}|${subject}`;

    let bucket =
      this.#buckets.get(key);

    if (!bucket) {
      if (
        this.#buckets.size >=
        this.#maxTrackedKeys
      ) {
        this.sweep(now);

        if (
          this.#buckets.size >=
          this.#maxTrackedKeys
        ) {
          return {
            allowed: false,

            reason: "rate-limit",

            retryAfterSeconds:
              Math.max(
                1,
                Math.ceil(
                  policy.windowMs /
                    1000,
                ),
              ),
          };
        }
      }

      bucket = {
        windowMs: policy.windowMs,

        hits: [],
      };

      this.#buckets.set(key, bucket);
    }

    const { hits } = bucket;

    const cutoff =
      now - policy.windowMs;

    while (
      hits.length > 0 &&
      (hits[0] as number) <= cutoff
    ) {
      hits.shift();
    }

    if (hits.length >= policy.limit) {
      const oldest =
        hits[0] as number;

      const retryMs =
        oldest + policy.windowMs - now;

      return {
        allowed: false,

        reason: "rate-limit",

        // Never longer than one window (guards against a clock that jumped).
        retryAfterSeconds: Math.min(
          Math.ceil(
            policy.windowMs / 1000,
          ),
          Math.max(
            1,
            Math.ceil(retryMs / 1000),
          ),
        ),
      };
    }

    hits.push(now);

    return { allowed: true };
  }

  private sweepIfDue(
    now: number,
  ): void {
    if (
      now - this.#lastSweepAt >=
      this.#sweepIntervalMs
    ) {
      this.sweep(now);
    }
  }

  private sweep(now: number): void {
    for (const [
      key,
      bucket,
    ] of this.#buckets) {
      const newest =
        bucket.hits[
          bucket.hits.length - 1
        ];

      if (
        newest === undefined ||
        newest <= now - bucket.windowMs
      ) {
        this.#buckets.delete(key);
      }
    }

    this.#lastSweepAt = now;
  }
}

export function createInMemoryUsageController(
  options: InMemoryUsageControllerOptions = {},
): InMemoryUsageController {
  return new InMemoryUsageController(
    options,
  );
}
