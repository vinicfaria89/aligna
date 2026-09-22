/**
 * Deterministic clock + timer for tests (TASK-015). Time only moves through
 * `advance`, timers fire in order when their time is reached, and nothing ever
 * sleeps for real, so rate-limit tests stay instantaneous.
 */
export class FakeAnbimaClock {
  #nowMs: number;

  #nextId = 1;

  #timers: Array<{
    id: number;

    at: number;

    callback: () => void;
  }> = [];

  constructor(startMs = 1_000_000) {
    this.#nowMs = startMs;
  }

  readonly now = (): number =>
    this.#nowMs;

  readonly setTimer = (
    callback: () => void,
    delayMs: number,
  ): number => {
    const id = this.#nextId;

    this.#nextId += 1;

    this.#timers.push({
      id,

      at: this.#nowMs + delayMs,

      callback,
    });

    return id;
  };

  get pendingTimers(): number {
    return this.#timers.length;
  }

  /** Lets already-resolved promises run their continuations. */
  async flush(): Promise<void> {
    await new Promise<void>(
      (resolve) => {
        setImmediate(resolve);
      },
    );
  }

  /** Moves time forward, firing due timers in order. */
  async advance(
    ms: number,
  ): Promise<void> {
    const target = this.#nowMs + ms;

    await this.flush();

    for (;;) {
      const due = this.#timers
        .filter(
          (timer) =>
            timer.at <= target,
        )
        .sort(
          (a, b) =>
            a.at - b.at ||
            a.id - b.id,
        )[0];

      if (!due) {
        break;
      }

      this.#timers =
        this.#timers.filter(
          (timer) =>
            timer.id !== due.id,
        );

      this.#nowMs = Math.max(
        this.#nowMs,
        due.at,
      );

      due.callback();

      await this.flush();
    }

    this.#nowMs = target;

    await this.flush();
  }
}
