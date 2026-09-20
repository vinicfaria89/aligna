import {
  AIE_DEFAULT_USAGE_POLICY,
} from "./aie-usage";

import type {
  AieUsageController,
} from "./aie-usage";

import {
  createInMemoryUsageController,
} from "./in-memory-usage-controller";

/**
 * SERVER-ONLY usage-control composition (TASK-023).
 *
 * Returns ONE process-wide in-memory controller with the default policy from
 * code constants (no environment, no NEXT_PUBLIC variable, nothing configurable
 * from the browser). It is per process and not durable: with several server
 * instances the limits are per instance and a restart resets them; global
 * enforcement needs a shared store and would replace the controller returned
 * here (and only here).
 *
 * There is deliberately no "allow everything" production controller: an
 * unlimited controller exists only as a test helper.
 */
let cached: AieUsageController | null =
  null;

export function getAieUsageController(): AieUsageController {
  if (!cached) {
    cached =
      createInMemoryUsageController({
        policy:
          AIE_DEFAULT_USAGE_POLICY,
      });
  }

  return cached;
}
