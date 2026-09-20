import type {
  AieOperation,
} from "./request-authorization";

/**
 * SERVER-ONLY structured audit contract for the AIE HTTP routes (TASK-022).
 *
 * Generic on purpose: no environment, no network, no console, no storage, no
 * provider or domain imports. It defines WHAT is audited and HOW it is handed
 * to an injected sink; where the events go is a separate concern (today a
 * no-op, see create-server-audit-sink.ts).
 *
 * Event model (two stages per request, kept simple and deterministic):
 *
 *   1. authorization  exactly one event, before any parsing or provider work:
 *        authorized | unauthenticated | forbidden | authorization-error
 *        (decision: allow, or deny; an authorizer failure is a deny, fail closed)
 *   2. execution      one event, only when the request was authorized:
 *        completed | validation-error | configuration-error | internal-error
 *        | rate-limited | usage-control-error (TASK-023: authorized, then the
 *          usage control denied it or failed; the request did not execute)
 *
 * What an event may contain (TASK-019, Decision 5): correlation id, UTC
 * timestamp, the fixed operation literal, the outcome, the allow/deny
 * decision, the HTTP status and, once authentication succeeded, the subject
 * identifier. NOTHING else: no tokens, no Authorization header, no ANBIMA
 * credentials, no CandidateAsset or portfolio values (rawName, instrumentCode,
 * amounts, CPF, accounts), no roles, no entitlement, no upstream answers, no
 * error messages or stacks, no batch sizes.
 *
 * Sink failure policy: auditing is BEST EFFORT and NEVER changes a decision. A
 * sink that throws, rejects or hangs (bounded wait) is swallowed without
 * leaking anything; a denied request stays denied and an allowed one continues.
 * Audit unavailability does not make the AIE unavailable (a documented choice:
 * TASK-019 requires auditing but defines no storage-failure semantics). The
 * optional onSinkFailure hook receives only the stage, never the error.
 */

export type AieAuditDecision =
  | "allow"
  | "deny";

export type AieAuthorizationAuditOutcome =
  | "authorized"
  | "unauthenticated"
  | "forbidden"
  | "authorization-error";

export type AieExecutionAuditOutcome =
  | "completed"
  | "validation-error"
  | "configuration-error"
  | "internal-error"
  // TASK-023: the request was authorized but not executed because of usage
  // control (429), or the usage controller itself failed (500, fail closed).
  | "rate-limited"
  | "usage-control-error";

interface AieAuditEventBase {
  /** Server-generated random id, also returned as X-Correlation-Id. */
  correlationId: string;

  /** UTC ISO-8601. */
  timestamp: string;

  /** Fixed literal chosen by the route, never read from the request. */
  operation: AieOperation;

  /** Present only after authentication succeeded. */
  subject?: string;
}

export interface AieAuthorizationAuditEvent
  extends AieAuditEventBase {
  stage: "authorization";

  outcome: AieAuthorizationAuditOutcome;

  decision: AieAuditDecision;

  /** HTTP status of a denial; absent when the request is authorized. */
  status?: number;
}

export interface AieExecutionAuditEvent
  extends AieAuditEventBase {
  stage: "execution";

  outcome: AieExecutionAuditOutcome;

  status: number;
}

export type AieAuditEvent =
  | AieAuthorizationAuditEvent
  | AieExecutionAuditEvent;

export interface AieAuditSink {
  write(
    event: AieAuditEvent,
  ): Promise<void>;
}

export type AieAuditStage =
  | "authorization"
  | "execution";

export interface AieAuditOptions {
  /** Defaults to the server sink (a no-op today). */
  sink?: AieAuditSink;

  /** Test seam. Defaults to the current time. */
  now?: () => Date;

  /** Test seam. Defaults to a random UUID. Never derived from the request. */
  generateCorrelationId?: () => string;

  /** Upper bound of a sink write, in ms. Default AUDIT_WRITE_TIMEOUT_MS. */
  writeTimeoutMs?: number;

  /** Receives only the stage of a failed write: never the error. */
  onSinkFailure?: (failure: {
    stage: AieAuditStage;
  }) => void;
}

export const CORRELATION_ID_HEADER =
  "X-Correlation-Id";

export const AUDIT_WRITE_TIMEOUT_MS = 1000;

/** The no-op sink: the safe default until durable storage exists. */
export function createNoopAuditSink(): AieAuditSink {
  return {
    write: async () => undefined,
  };
}

/**
 * Always server-generated (random UUID). An incoming correlation header is
 * deliberately NOT trusted or reused. The id carries no subject, token, asset,
 * account or financial data.
 */
export function createCorrelationId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Accepts only a plain identifier: a non-empty string of bounded length
 * without control characters or whitespace. Anything else is dropped so a
 * misbehaving authorizer cannot inject arbitrary text into the audit trail.
 */
export function toSafeSubject(
  value: unknown,
): string | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    !/^[A-Za-z0-9._:@-]+$/.test(value)
  ) {
    return undefined;
  }

  return value;
}

export interface AieAuditRecorder {
  readonly correlationId: string;

  authorization(
    outcome: AieAuthorizationAuditOutcome,
    details?: {
      subject?: string;

      status?: number;
    },
  ): Promise<void>;

  execution(
    outcome: AieExecutionAuditOutcome,
    details: {
      subject?: string;

      status: number;
    },
  ): Promise<void>;
}

/**
 * `sink` is the already-resolved sink (the caller supplies the injected one or
 * the server default), so this module never composes anything itself.
 */
export function createAuditRecorder(
  operation: AieOperation,
  sink: AieAuditSink,
  options: AieAuditOptions = {},
): AieAuditRecorder {
  const generate =
    options.generateCorrelationId ??
    createCorrelationId;

  const now =
    options.now ??
    (() => new Date());

  const timeoutMs =
    options.writeTimeoutMs ??
    AUDIT_WRITE_TIMEOUT_MS;

  const correlationId = generate();

  async function emit(
    event: AieAuditEvent,
  ): Promise<void> {
    const failure = (): void => {
      try {
        options.onSinkFailure?.({
          stage: event.stage,
        });
      } catch {
        // A failing hook must not affect the request either.
      }
    };

    let timer:
      | ReturnType<typeof setTimeout>
      | undefined;

    try {
      // The sink gets a frozen copy: it can neither alter the event that other
      // code holds nor reach any request or resolution object (none is passed).
      const write =
        sink.write(
          Object.freeze({ ...event }),
        );

      const timeout =
        new Promise<"timeout">(
          (resolve) => {
            timer = setTimeout(
              () => resolve("timeout"),
              timeoutMs,
            );
          },
        );

      const winner =
        await Promise.race([
          write.then(
            () => "written" as const,
          ),
          timeout,
        ]);

      if (winner === "timeout") {
        // Swallow a late rejection of the abandoned write.
        write.catch(() => undefined);

        failure();
      }
    } catch {
      failure();
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  const base = () => ({
    correlationId,

    timestamp: now().toISOString(),

    operation,
  });

  return {
    correlationId,

    authorization: (
      outcome,
      details = {},
    ) => {
      const subject = toSafeSubject(
        details.subject,
      );

      return emit({
        ...base(),

        stage: "authorization",

        outcome,

        decision:
          outcome === "authorized"
            ? "allow"
            : "deny",

        ...(subject !== undefined
          ? { subject }
          : {}),

        ...(details.status !==
        undefined
          ? { status: details.status }
          : {}),
      });
    },

    execution: (outcome, details) => {
      const subject = toSafeSubject(
        details.subject,
      );

      return emit({
        ...base(),

        stage: "execution",

        outcome,

        status: details.status,

        ...(subject !== undefined
          ? { subject }
          : {}),
      });
    },
  };
}

/** Maps the HTTP status of an executed (authorized) request to an outcome. */
export function executionOutcomeForStatus(
  status: number,
): AieExecutionAuditOutcome {
  if (status >= 200 && status < 300) {
    return "completed";
  }

  if (status === 429) {
    return "rate-limited";
  }

  if (status === 503) {
    return "configuration-error";
  }

  if (status >= 400 && status < 500) {
    return "validation-error";
  }

  return "internal-error";
}
