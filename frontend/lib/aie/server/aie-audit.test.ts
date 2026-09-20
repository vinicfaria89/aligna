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
  vi,
} from "vitest";

import {
  AUDIT_WRITE_TIMEOUT_MS,
  CORRELATION_ID_HEADER,
  createAuditRecorder,
  createCorrelationId,
  createNoopAuditSink,
  executionOutcomeForStatus,
  toSafeSubject,
} from "./aie-audit";

import {
  getAieAuditSink,
} from "./create-server-audit-sink";

import {
  createFakeAuditSink,
} from "./fake-aie-audit-sink";

/**
 * Unit tests of the audit contract (TASK-022): event shape, injected clock and
 * correlation id, subject handling, sink-failure semantics.
 */

const FIXED = new Date(
  "2026-09-20T12:34:56.789Z",
);

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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

function recorderWith(
  sink = createFakeAuditSink(),
  options: Parameters<
    typeof createAuditRecorder
  >[2] = {},
) {
  return {
    sink,

    recorder: createAuditRecorder(
      "resolve-asset",
      sink,
      {
        now: () => FIXED,

        generateCorrelationId: () =>
          "corr-1",

        ...options,
      },
    ),
  };
}

describe("audit contract", () => {
  describe("event shape", () => {
    it("an authorization event has exactly the approved fields", async () => {
      const { sink, recorder } =
        recorderWith();

      await recorder.authorization(
        "authorized",
        {
          subject: "user-1",
        },
      );

      expect(sink.events).toEqual([
        {
          correlationId: "corr-1",

          timestamp:
            "2026-09-20T12:34:56.789Z",

          operation: "resolve-asset",

          stage: "authorization",

          outcome: "authorized",

          decision: "allow",

          subject: "user-1",
        },
      ]);
    });

    it("an execution event has exactly the approved fields", async () => {
      const { sink, recorder } =
        recorderWith();

      await recorder.execution(
        "completed",
        {
          subject: "user-1",

          status: 200,
        },
      );

      expect(sink.events).toEqual([
        {
          correlationId: "corr-1",

          timestamp:
            "2026-09-20T12:34:56.789Z",

          operation: "resolve-asset",

          stage: "execution",

          outcome: "completed",

          status: 200,

          subject: "user-1",
        },
      ]);
    });

    it("denials are decision deny, with the HTTP status, and no subject key when unknown", async () => {
      const { sink, recorder } =
        recorderWith();

      for (const outcome of [
        "unauthenticated",
        "forbidden",
        "authorization-error",
      ] as const) {
        await recorder.authorization(
          outcome,
          {
            status: 401,
          },
        );
      }

      expect(
        sink.events.map((event) => [
          "decision" in event
            ? event.decision
            : null,
          event.outcome,
          "subject" in event,
        ]),
      ).toEqual([
        ["deny", "unauthenticated", false],
        ["deny", "forbidden", false],
        [
          "deny",
          "authorization-error",
          false,
        ],
      ]);
    });

    it("timestamps come from the injected clock as UTC ISO-8601", async () => {
      const { sink, recorder } =
        recorderWith();

      await recorder.authorization(
        "authorized",
      );

      const [event] = sink.events;

      expect(event?.timestamp).toBe(
        "2026-09-20T12:34:56.789Z",
      );

      expect(
        event?.timestamp,
      ).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    });

    it("the default clock is real UTC ISO-8601", async () => {
      const sink =
        createFakeAuditSink();

      const recorder =
        createAuditRecorder(
          "resolve-assets",
          sink,
        );

      await recorder.authorization(
        "authorized",
      );

      expect(
        sink.events[0]?.timestamp,
      ).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );

      expect(
        sink.events[0]?.operation,
      ).toBe("resolve-assets");
    });

    it("the sink receives a frozen copy that cannot alter what the recorder holds", async () => {
      const seen: unknown[] = [];

      const sink = {
        write: async (event: object) => {
          seen.push(event);

          expect(
            Object.isFrozen(event),
          ).toBe(true);

          expect(() => {
            "use strict";

            (
              event as {
                outcome: string;
              }
            ).outcome = "tampered";
          }).toThrow();
        },
      };

      const recorder =
        createAuditRecorder(
          "resolve-asset",
          sink,
          {
            now: () => FIXED,

            generateCorrelationId: () =>
              "corr-1",
          },
        );

      await recorder.authorization(
        "authorized",
        {
          subject: "user-1",
        },
      );

      expect(seen).toHaveLength(1);

      expect(
        (
          seen[0] as {
            outcome: string;
          }
        ).outcome,
      ).toBe("authorized");
    });
  });

  describe("correlation id", () => {
    it("is a server-generated random UUID by default, unique per call", () => {
      const ids = new Set(
        Array.from({ length: 50 }, () =>
          createCorrelationId(),
        ),
      );

      expect(ids.size).toBe(50);

      for (const id of ids) {
        expect(id).toMatch(UUID);
      }
    });

    it("the header name is X-Correlation-Id", () => {
      expect(
        CORRELATION_ID_HEADER,
      ).toBe("X-Correlation-Id");
    });

    it("the recorder uses one id for all of its events", async () => {
      const sink =
        createFakeAuditSink();

      const recorder =
        createAuditRecorder(
          "resolve-asset",
          sink,
        );

      await recorder.authorization(
        "authorized",
      );

      await recorder.execution(
        "completed",
        {
          status: 200,
        },
      );

      expect(
        new Set(
          sink.events.map(
            (event) =>
              event.correlationId,
          ),
        ).size,
      ).toBe(1);

      expect(
        recorder.correlationId,
      ).toBe(
        sink.events[0]?.correlationId,
      );
    });

    it("does not use Math.random and encodes nothing about the request", () => {
      const code = source(
        "./aie-audit.ts",
      );

      expect(code).not.toContain(
        "Math.random",
      );

      expect(code).toContain(
        "randomUUID",
      );
    });
  });

  describe("subject", () => {
    it("keeps a plain identifier and drops anything unsafe", () => {
      expect(
        toSafeSubject(
          "3f2b1c9e-8a4d-4e6f-9b0a-1c2d3e4f5a6b",
        ),
      ).toBe(
        "3f2b1c9e-8a4d-4e6f-9b0a-1c2d3e4f5a6b",
      );

      for (const value of [
        "",
        " ",
        "has space",
        "line\nbreak",
        "<script>",
        "a".repeat(129),
        42,
        null,
        undefined,
        {},
        [],
      ]) {
        expect(
          toSafeSubject(value),
        ).toBeUndefined();
      }
    });

    it("an unsafe subject is dropped from the event", async () => {
      const { sink, recorder } =
        recorderWith();

      await recorder.authorization(
        "forbidden",
        {
          subject:
            "Bearer abc def\nsecret",
        },
      );

      expect(
        "subject" in
          (sink.events[0] as object),
      ).toBe(false);
    });
  });

  describe("execution outcomes", () => {
    it("maps the HTTP status of an authorized request", () => {
      expect(
        executionOutcomeForStatus(200),
      ).toBe("completed");

      for (const status of [
        400, 413, 415,
      ]) {
        expect(
          executionOutcomeForStatus(
            status,
          ),
        ).toBe("validation-error");
      }

      expect(
        executionOutcomeForStatus(503),
      ).toBe("configuration-error");

      for (const status of [500, 502]) {
        expect(
          executionOutcomeForStatus(
            status,
          ),
        ).toBe("internal-error");
      }
    });
  });

  describe("sink failure policy (best effort, never changes a decision)", () => {
    it("a sink that throws synchronously is swallowed", async () => {
      const sink = createFakeAuditSink(
        () => "throw",
      );

      const failures: unknown[] = [];

      const { recorder } =
        recorderWith(sink, {
          onSinkFailure: (failure) =>
            failures.push(failure),
        });

      await expect(
        recorder.authorization(
          "authorized",
          {
            subject: "user-1",
          },
        ),
      ).resolves.toBeUndefined();

      // Only the stage is reported: never the error, the event or the subject.
      expect(failures).toEqual([
        {
          stage: "authorization",
        },
      ]);

      expect(
        JSON.stringify(failures),
      ).not.toContain(
        "sentinel-sink-secret",
      );
    });

    it("a sink that rejects is swallowed, on both stages", async () => {
      const sink = createFakeAuditSink(
        () => "reject",
      );

      const failures: unknown[] = [];

      const { recorder } =
        recorderWith(sink, {
          onSinkFailure: (failure) =>
            failures.push(failure),
        });

      await recorder.authorization(
        "authorized",
      );

      await recorder.execution(
        "completed",
        {
          status: 200,
        },
      );

      expect(failures).toEqual([
        {
          stage: "authorization",
        },
        {
          stage: "execution",
        },
      ]);
    });

    it("a sink that hangs is abandoned after the bounded wait", async () => {
      const sink = createFakeAuditSink(
        () => "hang",
      );

      const failures: unknown[] = [];

      const { recorder } =
        recorderWith(sink, {
          writeTimeoutMs: 20,

          onSinkFailure: (failure) =>
            failures.push(failure),
        });

      const started = Date.now();

      await recorder.execution(
        "completed",
        {
          status: 200,
        },
      );

      expect(
        Date.now() - started,
      ).toBeLessThan(1000);

      expect(failures).toEqual([
        {
          stage: "execution",
        },
      ]);
    });

    it("a late rejection of an abandoned write is not an unhandled rejection", async () => {
      let rejectLate: (
        error: Error,
      ) => void = () => undefined;

      const sink = {
        write: () =>
          new Promise<void>(
            (_resolve, reject) => {
              rejectLate = reject;
            },
          ),
      };

      const recorder =
        createAuditRecorder(
          "resolve-asset",
          sink,
          {
            writeTimeoutMs: 10,
          },
        );

      await recorder.authorization(
        "authorized",
      );

      rejectLate(
        new Error("late sentinel"),
      );

      await new Promise((resolve) =>
        setTimeout(resolve, 20),
      );
    });

    it("a failing failure hook does not affect the caller", async () => {
      const sink = createFakeAuditSink(
        () => "throw",
      );

      const { recorder } =
        recorderWith(sink, {
          onSinkFailure: () => {
            throw new Error(
              "hook exploded",
            );
          },
        });

      await expect(
        recorder.authorization(
          "authorized",
        ),
      ).resolves.toBeUndefined();
    });

    it("the default bounded wait is one second", () => {
      expect(
        AUDIT_WRITE_TIMEOUT_MS,
      ).toBe(1000);
    });
  });

  describe("sinks", () => {
    it("the no-op sink accepts events and stores nothing", async () => {
      await expect(
        createNoopAuditSink().write({
          correlationId: "c",

          timestamp:
            "2026-09-20T00:00:00.000Z",

          operation: "resolve-asset",

          stage: "execution",

          outcome: "completed",

          status: 200,
        }),
      ).resolves.toBeUndefined();
    });

    it("the production sink is the no-op one (no durable storage yet)", async () => {
      const sink = getAieAuditSink();

      expect(getAieAuditSink()).toBe(
        sink,
      );

      const write = vi.fn();

      // It returns nothing observable and never throws.
      await expect(
        sink.write({
          correlationId: "c",

          timestamp:
            "2026-09-20T00:00:00.000Z",

          operation: "resolve-assets",

          stage: "authorization",

          outcome: "unauthenticated",

          decision: "deny",

          status: 401,
        }),
      ).resolves.toBeUndefined();

      expect(write).not.toHaveBeenCalled();
    });
  });

  describe("static guards (audit production code)", () => {
    const files = [
      "./aie-audit.ts",
      "./create-server-audit-sink.ts",
      "./aie-audited-request.ts",
    ];

    it("the generic audit modules read no environment, use no network, console or filesystem", () => {
      for (const file of files) {
        const code = source(file);

        for (const forbidden of [
          "process.env",
          "fetch(",
          "console.",
          "node:fs",
          "XMLHttpRequest",
        ]) {
          expect(
            code,
          ).not.toContain(forbidden);
        }
      }
    });

    it("the audit contract imports nothing but a type from the authorization module", () => {
      const imports = [
        ...readFileSync(
          fileURLToPath(
            new URL(
              "./aie-audit.ts",
              import.meta.url,
            ),
          ),
          "utf8",
        ).matchAll(
          /^import[^;]*?from\s*["']([^"']+)["']/gm,
        ),
      ].map((match) => match[1]);

      expect(imports).toEqual([
        "./request-authorization",
      ]);

      expect(
        /^import type/m.test(
          readFileSync(
            fileURLToPath(
              new URL(
                "./aie-audit.ts",
                import.meta.url,
              ),
            ),
            "utf8",
          ),
        ),
      ).toBe(true);
    });

    it("no audit code touches tokens, credentials, headers or asset values", () => {
      for (const file of files) {
        const code = source(file);

        for (const forbidden of [
          "clientSecret",
          "access_token",
          "rawName",
          "instrumentCode",
          "candidateAsset",
          "CandidateAsset",
          "hints",
          "amount",
          ".headers.get(",
          "principal",
          "roles",
          "portfolio",
        ]) {
          expect(
            code,
          ).not.toContain(forbidden);
        }
      }
    });

    it("the audit modules import no provider, ANBIMA or domain code", () => {
      for (const file of files) {
        const code = source(file);

        for (const forbidden of [
          "/providers/",
          "/infrastructure/",
          "/resolution/",
          "/contracts",
          "anbima",
        ]) {
          expect(
            code.toLowerCase(),
          ).not.toContain(
            forbidden.toLowerCase(),
          );
        }
      }
    });

    it("the audit contract types carry no field beyond the approved ones", () => {
      const code = readFileSync(
        fileURLToPath(
          new URL(
            "./aie-audit.ts",
            import.meta.url,
          ),
        ),
        "utf8",
      );

      const block = (
        name: string,
      ): string[] => {
        const match = new RegExp(
          `interface ${name}[^{]*\\{([\\s\\S]*?)\\n\\}`,
        ).exec(code);

        return (
          (match?.[1] ?? "")
            .split("\n")
            .map((line) => line.trim())
            .filter(
              (line) =>
                /^[a-zA-Z]+\??:/.test(
                  line,
                ),
            )
            .map(
              (line) =>
                line.split(":")[0] as string,
            )
        );
      };

      expect(
        block("AieAuditEventBase"),
      ).toEqual([
        "correlationId",
        "timestamp",
        "operation",
        "subject?",
      ]);

      expect(
        block(
          "AieAuthorizationAuditEvent",
        ),
      ).toEqual([
        "stage",
        "outcome",
        "decision",
        "status?",
      ]);

      expect(
        block("AieExecutionAuditEvent"),
      ).toEqual([
        "stage",
        "outcome",
        "status",
      ]);
    });
  });
});
