import type {
  AieUsageContext,
  AieUsageController,
  AieUsageDecision,
} from "./aie-usage";

/**
 * Test helpers for the usage control (TASK-023). NOT for production: an
 * allow-everything controller is a bypass, so it lives only here.
 */

/** A controller that always allows. Route tests that are not about limits use it. */
export function createAllowAllUsageController(): AieUsageController {
  return {
    check: async () => ({
      allowed: true,
    }),
  };
}

export interface RecordingUsageController
  extends AieUsageController {
  readonly calls: AieUsageContext[];
}

/** Wraps a controller and records every context it was asked about. */
export function recordUsage(
  inner: AieUsageController,
): RecordingUsageController {
  const calls: AieUsageContext[] = [];

  return {
    calls,

    async check(context) {
      calls.push({ ...context });

      return inner.check(context);
    },
  };
}

/** A controller that answers with a fixed (possibly malformed) value or throws. */
export function createScriptedUsageController(
  answer:
    | AieUsageDecision
    | unknown
    | (() => never),
): AieUsageController {
  return {
    check: async () => {
      if (typeof answer === "function") {
        return (
          answer as () => never
        )();
      }

      return answer as AieUsageDecision;
    },
  };
}
