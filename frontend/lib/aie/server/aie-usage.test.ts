import {
  describe,
  expect,
  it,
} from "vitest";

import {
  interpretUsageDecision,
} from "./aie-usage";

/** TASK-023: how a controller's answer is read (only a well-formed decision is honored). */
describe("interpretUsageDecision", () => {
  it("honors allowed: true", () => {
    expect(
      interpretUsageDecision({
        allowed: true,
      }),
    ).toEqual({ kind: "allowed" });
  });

  it("reads a rate-limit and a quota denial as limited", () => {
    for (const reason of [
      "rate-limit",
      "quota",
    ]) {
      expect(
        interpretUsageDecision({
          allowed: false,

          reason,

          retryAfterSeconds: 12,
        }),
      ).toEqual({
        kind: "limited",

        retryAfterSeconds: 12,
      });
    }
  });

  it("normalizes the retry hint to whole seconds within [1, 86400], defaulting to 60", () => {
    const retry = (value: unknown) =>
      interpretUsageDecision({
        allowed: false,

        reason: "rate-limit",

        retryAfterSeconds: value,
      });

    expect(retry(0.2)).toEqual({
      kind: "limited",

      retryAfterSeconds: 1,
    });

    expect(retry(-5)).toEqual({
      kind: "limited",

      retryAfterSeconds: 1,
    });

    expect(retry(7.1)).toEqual({
      kind: "limited",

      retryAfterSeconds: 8,
    });

    expect(retry(10 ** 9)).toEqual({
      kind: "limited",

      retryAfterSeconds: 86_400,
    });

    for (const bad of [
      undefined,
      null,
      "30",
      Number.NaN,
      Number.POSITIVE_INFINITY,
      {},
    ]) {
      expect(retry(bad)).toEqual({
        kind: "limited",

        retryAfterSeconds: 60,
      });
    }
  });

  it("anything else is invalid, so the caller fails closed", () => {
    for (const bad of [
      undefined,
      null,
      "allowed",
      true,
      1,
      [],
      {},
      { allowed: "true" },
      { allowed: 1 },
      { allowed: false },
      {
        allowed: false,

        reason: "other",
      },
      {
        allowed: false,

        reason: "RATE-LIMIT",
      },
    ]) {
      expect(
        interpretUsageDecision(bad),
      ).toEqual({ kind: "invalid" });
    }
  });
});
