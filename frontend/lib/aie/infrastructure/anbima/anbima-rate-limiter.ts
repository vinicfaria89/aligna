/**
 * ANBIMA-local outbound rate limiter (TASK-015).
 *
 * Sliding window with a FIFO queue: at most `maxRequests` grants are issued in
 * any window of `intervalMs`. A caller that finds no capacity waits, in
 * arrival order, until the oldest grant leaves the window. There is no
 * busy-wait: a single timer is armed for the exact moment capacity returns.
 *
 * Deliberately NOT a project-wide framework: it lives next to the ANBIMA
 * client and knows nothing about ANBIMA URLs, tokens or feeds.
 *
 * Limitation: the state is in memory, so it only controls ONE process. With
 * several server instances each has its own limiter and a global limit is NOT
 * guaranteed (a distributed limiter is future work).
 *
 * `acquire()` never rejects, so a failed request can never block the queue:
 * the slot is simply consumed by the attempt that was made.
 */

/**
 * ANBIMA documents up to 15 requests per second in production. The default is
 * one below that to leave a safety margin for clock and network jitter between
 * this process and the ANBIMA gateway.
 */
export const ANBIMA_DEFAULT_MAX_REQUESTS = 14;

export const ANBIMA_DEFAULT_RATE_INTERVAL_MS = 1000;

export type AnbimaTimerScheduler = (
  callback: () => void,
  delayMs: number,
) => unknown;

export interface AnbimaRateLimiterOptions {
  /** Integer >= 1. Default ANBIMA_DEFAULT_MAX_REQUESTS. */
  maxRequests?: number;

  /** Finite number > 0, in milliseconds. Default 1000. */
  intervalMs?: number;

  /** Test seam: current time in epoch milliseconds. */
  now?: () => number;

  /** Test seam: defaults to the global setTimeout. */
  setTimer?: AnbimaTimerScheduler;
}

export class AnbimaRateLimiter {
  readonly #maxRequests: number;

  readonly #intervalMs: number;

  readonly #now: () => number;

  readonly #setTimer: AnbimaTimerScheduler;

  /** Timestamps of the grants still inside the window, oldest first. */
  #grants: number[] = [];

  #waiters: Array<() => void> = [];

  #timerArmed = false;

  constructor(
    options: AnbimaRateLimiterOptions = {},
  ) {
    const maxRequests =
      options.maxRequests ??
      ANBIMA_DEFAULT_MAX_REQUESTS;

    const intervalMs =
      options.intervalMs ??
      ANBIMA_DEFAULT_RATE_INTERVAL_MS;

    if (
      !Number.isInteger(maxRequests) ||
      maxRequests < 1
    ) {
      throw new RangeError(
        "maxRequests must be an integer >= 1.",
      );
    }

    if (
      typeof intervalMs !== "number" ||
      !Number.isFinite(intervalMs) ||
      intervalMs <= 0
    ) {
      throw new RangeError(
        "intervalMs must be a finite number > 0.",
      );
    }

    this.#maxRequests = maxRequests;

    this.#intervalMs = intervalMs;

    this.#now =
      options.now ??
      (() => Date.now());

    this.#setTimer =
      options.setTimer ??
      ((callback, delayMs) =>
        globalThis.setTimeout(
          callback,
          delayMs,
        ));
  }

  /** Resolves when the caller may perform one outbound request. */
  acquire(): Promise<void> {
    return new Promise<void>(
      (resolve) => {
        this.#waiters.push(resolve);

        this.drain();
      },
    );
  }

  private drain(): void {
    const now = this.#now();

    while (
      this.#grants.length > 0 &&
      (this.#grants[0] as number) +
        this.#intervalMs <=
        now
    ) {
      this.#grants.shift();
    }

    while (
      this.#waiters.length > 0 &&
      this.#grants.length <
        this.#maxRequests
    ) {
      this.#grants.push(now);

      (
        this.#waiters.shift() as () => void
      )();
    }

    if (
      this.#waiters.length === 0 ||
      this.#timerArmed
    ) {
      return;
    }

    const oldest =
      this.#grants[0] as number;

    const delayMs = Math.max(
      1,
      Math.ceil(
        oldest +
          this.#intervalMs -
          now,
      ),
    );

    this.#timerArmed = true;

    this.#setTimer(() => {
      this.#timerArmed = false;

      this.drain();
    }, delayMs);
  }
}
