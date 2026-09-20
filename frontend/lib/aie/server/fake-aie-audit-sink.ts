import type {
  AieAuditEvent,
  AieAuditSink,
} from "./aie-audit";

/**
 * In-memory audit sink for tests (TASK-022). It records the structured events
 * exactly as the audit boundary emitted them, so tests assert on data and never
 * on log output. NOT for production: it is unbounded and stores nothing durably.
 */
export type FakeAuditSinkBehavior =
  | "ok"
  | "throw"
  | "reject"
  | "hang";

export interface FakeAuditSink
  extends AieAuditSink {
  readonly events: AieAuditEvent[];
}

export function createFakeAuditSink(
  behavior: (
    event: AieAuditEvent,
  ) => FakeAuditSinkBehavior = () =>
    "ok",
): FakeAuditSink {
  const events: AieAuditEvent[] = [];

  return {
    events,

    write(event) {
      events.push(event);

      switch (behavior(event)) {
        case "throw":
          throw new Error(
            "sink exploded synchronously sentinel-sink-secret",
          );

        case "reject":
          return Promise.reject(
            new Error(
              "sink rejected sentinel-sink-secret",
            ),
          );

        case "hang":
          return new Promise<void>(
            () => undefined,
          );

        default:
          return Promise.resolve();
      }
    },
  };
}
