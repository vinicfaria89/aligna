import {
  describe,
  expect,
  it,
} from "vitest";

import {
  ANBIMA_DEFAULT_MAX_REQUESTS,
  ANBIMA_DEFAULT_RATE_INTERVAL_MS,
  AnbimaRateLimiter,
} from "./anbima-rate-limiter";

import {
  FakeAnbimaClock,
} from "./fake-anbima-clock";

function createLimiter(
  maxRequests: number,
  intervalMs: number,
) {
  const clock =
    new FakeAnbimaClock();

  const limiter =
    new AnbimaRateLimiter({
      maxRequests,

      intervalMs,

      now: clock.now,

      setTimer: clock.setTimer,
    });

  return {
    clock,

    limiter,
  };
}

/** Starts an acquire and records the moment it was granted. */
function track(
  limiter: AnbimaRateLimiter,
  clock: FakeAnbimaClock,
  label: string,
  granted: Array<{
    label: string;

    at: number;
  }>,
): void {
  void limiter
    .acquire()
    .then(() => {
      granted.push({
        label,

        at: clock.now(),
      });
    });
}

describe("AnbimaRateLimiter", () => {
  it("defaults to at most 15 requests per second, conservatively 14", () => {
    expect(
      ANBIMA_DEFAULT_MAX_REQUESTS,
    ).toBeLessThanOrEqual(15);

    expect(
      ANBIMA_DEFAULT_MAX_REQUESTS,
    ).toBe(14);

    expect(
      ANBIMA_DEFAULT_RATE_INTERVAL_MS,
    ).toBe(1000);
  });

  it("grants up to maxRequests immediately without arming any timer", async () => {
    const { clock, limiter } =
      createLimiter(3, 1000);

    const granted: Array<{
      label: string;

      at: number;
    }> = [];

    for (const label of [
      "a",
      "b",
      "c",
    ]) {
      track(
        limiter,
        clock,
        label,
        granted,
      );
    }

    await clock.flush();

    expect(
      granted.map(
        (item) => item.label,
      ),
    ).toEqual(["a", "b", "c"]);

    expect(
      clock.pendingTimers,
    ).toBe(0);
  });

  it("queues requests beyond the limit until the window frees up", async () => {
    const { clock, limiter } =
      createLimiter(2, 1000);

    const granted: Array<{
      label: string;

      at: number;
    }> = [];

    for (const label of [
      "a",
      "b",
      "c",
    ]) {
      track(
        limiter,
        clock,
        label,
        granted,
      );
    }

    await clock.flush();

    expect(
      granted.map(
        (item) => item.label,
      ),
    ).toEqual(["a", "b"]);

    await clock.advance(999);

    expect(granted).toHaveLength(2);

    await clock.advance(1);

    expect(
      granted.map(
        (item) => item.label,
      ),
    ).toEqual(["a", "b", "c"]);
  });

  it("serves waiting callers in FIFO order", async () => {
    const { clock, limiter } =
      createLimiter(1, 100);

    const granted: Array<{
      label: string;

      at: number;
    }> = [];

    for (const label of [
      "first",
      "second",
      "third",
      "fourth",
    ]) {
      track(
        limiter,
        clock,
        label,
        granted,
      );
    }

    await clock.advance(1000);

    expect(
      granted.map(
        (item) => item.label,
      ),
    ).toEqual([
      "first",
      "second",
      "third",
      "fourth",
    ]);

    // One grant per interval: never two inside the same 100 ms window.
    expect(
      granted.map(
        (item) => item.at,
      ),
    ).toEqual([
      1_000_000,
      1_000_100,
      1_000_200,
      1_000_300,
    ]);
  });

  it("is a sliding window: a grant frees its slot exactly one interval after it was issued", async () => {
    const { clock, limiter } =
      createLimiter(2, 1000);

    const granted: Array<{
      label: string;

      at: number;
    }> = [];

    track(
      limiter,
      clock,
      "a",
      granted,
    );

    await clock.advance(600);

    track(
      limiter,
      clock,
      "b",
      granted,
    );

    track(
      limiter,
      clock,
      "c",
      granted,
    );

    await clock.advance(400);

    // "a" left the window at t=1000, so "c" is granted then, not at 1600.
    expect(
      granted.map(
        (item) => [
          item.label,
          item.at - 1_000_000,
        ],
      ),
    ).toEqual([
      ["a", 0],
      ["b", 600],
      ["c", 1000],
    ]);
  });

  it("never grants more than maxRequests inside any window", async () => {
    const { clock, limiter } =
      createLimiter(3, 1000);

    const granted: Array<{
      label: string;

      at: number;
    }> = [];

    for (let i = 0; i < 10; i += 1) {
      track(
        limiter,
        clock,
        String(i),
        granted,
      );
    }

    await clock.advance(5000);

    expect(granted).toHaveLength(10);

    for (const grant of granted) {
      const inWindow =
        granted.filter(
          (other) =>
            other.at >= grant.at &&
            other.at <
              grant.at + 1000,
        );

      expect(
        inWindow.length,
      ).toBeLessThanOrEqual(3);
    }
  });

  it("arms a single timer no matter how many callers are waiting", async () => {
    const { clock, limiter } =
      createLimiter(1, 1000);

    const granted: Array<{
      label: string;

      at: number;
    }> = [];

    for (let i = 0; i < 5; i += 1) {
      track(
        limiter,
        clock,
        String(i),
        granted,
      );
    }

    await clock.flush();

    expect(
      clock.pendingTimers,
    ).toBe(1);
  });

  it("keeps working after a caller abandons its request (acquire never rejects)", async () => {
    const { clock, limiter } =
      createLimiter(1, 100);

    await limiter.acquire();

    // The consumer of this grant fails; the limiter is not involved.
    await Promise.reject(
      new Error("request failed"),
    ).catch(() => undefined);

    let granted = false;

    void limiter
      .acquire()
      .then(() => {
        granted = true;
      });

    await clock.advance(100);

    expect(granted).toBe(true);
  });

  it("rejects invalid configuration", () => {
    for (const maxRequests of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(
        () =>
          new AnbimaRateLimiter({
            maxRequests,
          }),
      ).toThrow(RangeError);
    }

    for (const intervalMs of [
      0,
      -5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(
        () =>
          new AnbimaRateLimiter({
            intervalMs,
          }),
      ).toThrow(RangeError);
    }
  });
});
