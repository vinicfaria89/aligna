import {
  readFileSync,
} from "node:fs";

import {
  fileURLToPath,
} from "node:url";

import {
  describe,
  expect,
  it,
} from "vitest";

import {
  AIE_DEFAULT_USAGE_POLICY,
  AIE_MAX_BATCH_REQUESTS_PER_MINUTE,
  AIE_MAX_SINGLE_REQUESTS_PER_MINUTE,
  AIE_USAGE_WINDOW_MS,
} from "./aie-usage";

import type {
  AieUsageDecision,
} from "./aie-usage";

import {
  AieUsageControlError,
  createInMemoryUsageController,
  DEFAULT_MAX_TRACKED_KEYS,
} from "./in-memory-usage-controller";

import type {
  InMemoryUsageControllerOptions,
} from "./in-memory-usage-controller";

/**
 * TASK-023: the in-memory sliding-window controller, on a fake clock (no timers,
 * no sleeping).
 */

const SMALL = {
  "resolve-asset": {
    limit: 3,

    windowMs: 10_000,
  },

  "resolve-assets": {
    limit: 2,

    windowMs: 10_000,
  },
} as const;

function setup(
  options: InMemoryUsageControllerOptions = {},
) {
  let now = 1_000_000;

  const controller =
    createInMemoryUsageController({
      policy: SMALL,

      now: () => now,

      ...options,
    });

  return {
    controller,

    advance: (ms: number) => {
      now += ms;
    },

    now: () => now,
  };
}

const SINGLE = "resolve-asset" as const;

const BATCH = "resolve-assets" as const;

function source(
  file: string,
): string {
  return readFileSync(
    fileURLToPath(
      new URL(file, import.meta.url),
    ),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function denied(
  decision: AieUsageDecision,
): { retryAfterSeconds: number } {
  expect(decision.allowed).toBe(false);

  if (decision.allowed) {
    throw new Error("expected a denial");
  }

  expect(decision.reason).toBe(
    "rate-limit",
  );

  return decision;
}

describe("InMemoryUsageController", () => {
  describe("defaults", () => {
    it("30 single requests and 5 batch requests per minute", () => {
      expect(
        AIE_MAX_SINGLE_REQUESTS_PER_MINUTE,
      ).toBe(30);

      expect(
        AIE_MAX_BATCH_REQUESTS_PER_MINUTE,
      ).toBe(5);

      expect(
        AIE_USAGE_WINDOW_MS,
      ).toBe(60_000);

      expect(
        AIE_DEFAULT_USAGE_POLICY,
      ).toEqual({
        "resolve-asset": {
          limit: 30,

          windowMs: 60_000,
        },

        "resolve-assets": {
          limit: 5,

          windowMs: 60_000,
        },
      });

      expect(
        Object.isFrozen(
          AIE_DEFAULT_USAGE_POLICY,
        ),
      ).toBe(true);
    });

    it("uses the default policy when none is given", async () => {
      const controller =
        createInMemoryUsageController({
          now: () => 1,
        });

      for (let i = 0; i < 30; i += 1) {
        expect(
          (
            await controller.check({
              subject: "u",

              operation: SINGLE,
            })
          ).allowed,
        ).toBe(true);
      }

      expect(
        (
          await controller.check({
            subject: "u",

            operation: SINGLE,
          })
        ).allowed,
      ).toBe(false);
    });
  });

  describe("sliding window", () => {
    it("allows requests up to the limit, then denies", async () => {
      const { controller } = setup();

      for (let i = 0; i < 3; i += 1) {
        expect(
          await controller.check({
            subject: "u1",

            operation: SINGLE,
          }),
        ).toEqual({
          allowed: true,
        });
      }

      denied(
        await controller.check({
          subject: "u1",

          operation: SINGLE,
        }),
      );
    });

    it("the retry hint is the time until the oldest request leaves the window (whole seconds, >= 1)", async () => {
      const { controller, advance } =
        setup();

      await controller.check({
        subject: "u1",

        operation: SINGLE,
      });

      advance(4_000);

      await controller.check({
        subject: "u1",

        operation: SINGLE,
      });

      await controller.check({
        subject: "u1",

        operation: SINGLE,
      });

      // The oldest hit was 4 s ago in a 10 s window: 6 s to wait.
      expect(
        denied(
          await controller.check({
            subject: "u1",

            operation: SINGLE,
          }),
        ).retryAfterSeconds,
      ).toBe(6);

      advance(5_500);

      // 500 ms left: rounded up to one whole second.
      expect(
        denied(
          await controller.check({
            subject: "u1",

            operation: SINGLE,
          }),
        ).retryAfterSeconds,
      ).toBe(1);
    });

    it("allows again exactly when the window has passed", async () => {
      const { controller, advance } =
        setup();

      for (let i = 0; i < 3; i += 1) {
        await controller.check({
          subject: "u1",

          operation: SINGLE,
        });
      }

      advance(9_999);

      expect(
        (
          await controller.check({
            subject: "u1",

            operation: SINGLE,
          })
        ).allowed,
      ).toBe(false);

      advance(1);

      expect(
        (
          await controller.check({
            subject: "u1",

            operation: SINGLE,
          })
        ).allowed,
      ).toBe(true);
    });

    it("slides: each request frees its own slot one window after it was accepted", async () => {
      const { controller, advance } =
        setup();

      await controller.check({
        subject: "u1",

        operation: SINGLE,
      });

      advance(6_000);

      await controller.check({
        subject: "u1",

        operation: SINGLE,
      });

      await controller.check({
        subject: "u1",

        operation: SINGLE,
      });

      advance(4_000);

      // The first request (t=0) left the window; the two at t=6 s remain.
      expect(
        (
          await controller.check({
            subject: "u1",

            operation: SINGLE,
          })
        ).allowed,
      ).toBe(true);

      expect(
        (
          await controller.check({
            subject: "u1",

            operation: SINGLE,
          })
        ).allowed,
      ).toBe(false);
    });

    it("a denied request is not recorded: hammering does not extend the block", async () => {
      const { controller, advance } =
        setup();

      for (let i = 0; i < 3; i += 1) {
        await controller.check({
          subject: "u1",

          operation: SINGLE,
        });
      }

      for (let i = 0; i < 50; i += 1) {
        advance(100);

        await controller.check({
          subject: "u1",

          operation: SINGLE,
        });
      }

      // 5 s of hammering later, the block still ends at the original 10 s.
      advance(5_000);

      expect(
        (
          await controller.check({
            subject: "u1",

            operation: SINGLE,
          })
        ).allowed,
      ).toBe(true);
    });

    it("clamps the retry hint to one window when the clock jumps backwards", async () => {
      const { controller, advance } =
        setup();

      for (let i = 0; i < 3; i += 1) {
        await controller.check({
          subject: "u1",

          operation: SINGLE,
        });
      }

      advance(-1_000_000);

      expect(
        denied(
          await controller.check({
            subject: "u1",

            operation: SINGLE,
          }),
        ).retryAfterSeconds,
      ).toBeLessThanOrEqual(10);
    });
  });

  describe("buckets", () => {
    it("single and batch are separate buckets", async () => {
      const { controller } = setup();

      // Exhaust the single bucket.
      for (let i = 0; i < 3; i += 1) {
        await controller.check({
          subject: "u1",

          operation: SINGLE,
        });
      }

      denied(
        await controller.check({
          subject: "u1",

          operation: SINGLE,
        }),
      );

      // The batch bucket is untouched.
      expect(
        (
          await controller.check({
            subject: "u1",

            operation: BATCH,
          })
        ).allowed,
      ).toBe(true);

      // And vice versa.
      await controller.check({
        subject: "u1",

        operation: BATCH,
      });

      denied(
        await controller.check({
          subject: "u1",

          operation: BATCH,
        }),
      );

      expect(
        (
          await controller.check({
            subject: "u2",

            operation: SINGLE,
          })
        ).allowed,
      ).toBe(true);
    });

    it("two subjects have independent limits", async () => {
      const { controller } = setup();

      for (let i = 0; i < 3; i += 1) {
        await controller.check({
          subject: "alice",

          operation: SINGLE,
        });
      }

      denied(
        await controller.check({
          subject: "alice",

          operation: SINGLE,
        }),
      );

      for (let i = 0; i < 3; i += 1) {
        expect(
          (
            await controller.check({
              subject: "bob",

              operation: SINGLE,
            })
          ).allowed,
        ).toBe(true);
      }
    });

    it("the same subject shares one limit across any number of requests", async () => {
      const { controller } = setup();

      const results = [];

      for (let i = 0; i < 5; i += 1) {
        results.push(
          (
            await controller.check({
              subject: "same",

              operation: SINGLE,
            })
          ).allowed,
        );
      }

      expect(results).toEqual([
        true,
        true,
        true,
        false,
        false,
      ]);
    });

    it("tracks only (operation, subject) keys", async () => {
      const { controller } = setup();

      await controller.check({
        subject: "a",

        operation: SINGLE,
      });

      await controller.check({
        subject: "a",

        operation: SINGLE,
      });

      expect(
        controller.trackedKeys,
      ).toBe(1);

      await controller.check({
        subject: "a",

        operation: BATCH,
      });

      await controller.check({
        subject: "b",

        operation: SINGLE,
      });

      expect(
        controller.trackedKeys,
      ).toBe(3);
    });

    it("a subject that looks like another operation prefix cannot collide", async () => {
      const { controller } = setup();

      await controller.check({
        subject: "x",

        operation: SINGLE,
      });

      // "resolve-assets|x" and "resolve-asset|s|x" never share a key.
      await controller.check({
        subject: "s|x",

        operation: "resolve-asset",
      });

      expect(
        controller.trackedKeys,
      ).toBe(2);
    });
  });

  describe("memory cleanup", () => {
    it("removes expired subject state (sweep on traffic after the interval)", async () => {
      const { controller, advance } =
        setup();

      for (const subject of [
        "a",
        "b",
        "c",
        "d",
      ]) {
        await controller.check({
          subject,

          operation: SINGLE,
        });
      }

      expect(
        controller.trackedKeys,
      ).toBe(4);

      advance(10_000);

      // Any later request triggers the sweep: all four expired keys go.
      await controller.check({
        subject: "fresh",

        operation: SINGLE,
      });

      expect(
        controller.trackedKeys,
      ).toBe(1);
    });

    it("inactive subjects eventually disappear while active ones stay", async () => {
      const { controller, advance } =
        setup();

      await controller.check({
        subject: "inactive",

        operation: SINGLE,
      });

      await controller.check({
        subject: "active",

        operation: SINGLE,
      });

      for (let i = 0; i < 6; i += 1) {
        advance(2_000);

        await controller.check({
          subject: "active",

          operation: SINGLE,
        });
      }

      // "inactive" has been silent for 12 s > window: gone. "active" remains.
      expect(
        controller.trackedKeys,
      ).toBe(1);
    });

    it("a bucket never holds more than the limit", async () => {
      const { controller } = setup();

      for (let i = 0; i < 1000; i += 1) {
        await controller.check({
          subject: "spammer",

          operation: SINGLE,
        });
      }

      expect(
        controller.trackedKeys,
      ).toBe(1);
    });

    it("does not sweep on every request: only once per interval", async () => {
      const { controller, advance } =
        setup({
          sweepIntervalMs: 60_000,
        });

      await controller.check({
        subject: "old",

        operation: SINGLE,
      });

      advance(20_000);

      await controller.check({
        subject: "new",

        operation: SINGLE,
      });

      // "old" is expired but the sweep interval has not elapsed yet.
      expect(
        controller.trackedKeys,
      ).toBe(2);

      advance(60_000);

      await controller.check({
        subject: "newer",

        operation: SINGLE,
      });

      expect(
        controller.trackedKeys,
      ).toBe(1);
    });

    it("capacity guard: at the key cap a NEW key is denied (fail closed), existing keys keep working, and freed space admits new keys", async () => {
      const { controller, advance } =
        setup({
          maxTrackedKeys: 2,

          sweepIntervalMs: 1_000_000,
        });

      await controller.check({
        subject: "a",

        operation: SINGLE,
      });

      await controller.check({
        subject: "b",

        operation: SINGLE,
      });

      const overflow =
        await controller.check({
          subject: "c",

          operation: SINGLE,
        });

      expect(
        denied(overflow)
          .retryAfterSeconds,
      ).toBe(10);

      expect(
        controller.trackedKeys,
      ).toBe(2);

      // An existing key is unaffected.
      expect(
        (
          await controller.check({
            subject: "a",

            operation: SINGLE,
          })
        ).allowed,
      ).toBe(true);

      // Once the old keys expire, the on-demand sweep frees room.
      advance(10_000);

      expect(
        (
          await controller.check({
            subject: "c",

            operation: SINGLE,
          })
        ).allowed,
      ).toBe(true);
    });

    it("the default key cap is large but finite", () => {
      expect(
        DEFAULT_MAX_TRACKED_KEYS,
      ).toBe(50_000);
    });
  });

  describe("failure and configuration", () => {
    it("an unusable subject or operation throws a safe error (fail closed)", async () => {
      const { controller } = setup();

      for (const subject of [
        "",
        "x".repeat(257),
        undefined,
        null,
        42,
      ]) {
        await expect(
          controller.check({
            subject: subject as never,

            operation: SINGLE,
          }),
        ).rejects.toBeInstanceOf(
          AieUsageControlError,
        );
      }

      await expect(
        controller.check({
          subject: "u",

          operation:
            "something-else" as never,
        }),
      ).rejects.toBeInstanceOf(
        AieUsageControlError,
      );

      const error = await controller
        .check({
          subject: "secret-subject",

          operation:
            "something-else" as never,
        })
        .catch((e: Error) => e);

      expect(
        (error as Error).message,
      ).not.toContain(
        "secret-subject",
      );
    });

    it("rejects an invalid policy or options", () => {
      for (const limit of [
        0,
        -1,
        1.5,
        Number.NaN,
      ]) {
        expect(() =>
          createInMemoryUsageController({
            policy: {
              ...SMALL,

              "resolve-asset": {
                limit,

                windowMs: 1000,
              },
            },
          }),
        ).toThrow(RangeError);
      }

      for (const windowMs of [
        0,
        -5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
      ]) {
        expect(() =>
          createInMemoryUsageController({
            policy: {
              ...SMALL,

              "resolve-assets": {
                limit: 1,

                windowMs,
              },
            },
          }),
        ).toThrow(RangeError);
      }

      for (const maxTrackedKeys of [
        0,
        -1,
        1.5,
      ]) {
        expect(() =>
          createInMemoryUsageController({
            maxTrackedKeys,
          }),
        ).toThrow(RangeError);
      }

      for (const sweepIntervalMs of [
        0,
        -1,
        Number.NaN,
      ]) {
        expect(() =>
          createInMemoryUsageController({
            sweepIntervalMs,
          }),
        ).toThrow(RangeError);
      }
    });
  });

  describe("static guards (generic usage modules)", () => {
    const files = [
      "./aie-usage.ts",
      "./in-memory-usage-controller.ts",
      "./create-server-usage-controller.ts",
    ];

    it("read no environment, use no network, console, filesystem or timers", () => {
      for (const file of files) {
        const code = source(file);

        for (const forbidden of [
          "process.env",
          "fetch(",
          "console.",
          "node:fs",
          "setTimeout",
          "setInterval",
          "XMLHttpRequest",
        ]) {
          expect(
            code,
          ).not.toContain(forbidden);
        }
      }
    });

    it("know nothing about ANBIMA, billing, providers, assets or tokens", () => {
      for (const file of files) {
        const code =
          source(file).toLowerCase();

        for (const forbidden of [
          "anbima",
          "stripe",
          "subscription",
          "billing",
          "premium",
          "/providers/",
          "/infrastructure/",
          "/resolution/",
          "/contracts",
          "candidateasset",
          "rawname",
          "instrumentcode",
          "providerquery",
          ".headers",
          "bearer",
          "access_token",
          "hints",
        ]) {
          expect(
            code,
          ).not.toContain(forbidden);
        }
      }
    });

    it("the context carries only the subject and the operation", () => {
      const code = readFileSync(
        fileURLToPath(
          new URL(
            "./aie-usage.ts",
            import.meta.url,
          ),
        ),
        "utf8",
      );

      const match =
        /export interface AieUsageContext \{([\s\S]*?)\n\}/.exec(
          code,
        );

      const fields = (
        (match?.[1] ?? "")
          .split("\n")
          .map((line) => line.trim())
          .filter((line) =>
            /^[a-zA-Z]+\??:/.test(line),
          )
          .map(
            (line) =>
              line.split(":")[0],
          )
      );

      expect(fields).toEqual([
        "subject",
        "operation",
      ]);
    });

    it("the module imports only its own contract and a type", () => {
      const code = readFileSync(
        fileURLToPath(
          new URL(
            "./in-memory-usage-controller.ts",
            import.meta.url,
          ),
        ),
        "utf8",
      );

      expect(
        [
          ...code.matchAll(
            /from\s*["']([^"']+)["']/g,
          ),
        ].map((match) => match[1]),
      ).toEqual([
        "./aie-usage",
        "./aie-usage",
      ]);
    });
  });
});
