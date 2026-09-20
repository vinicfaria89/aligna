import {
  CORRELATION_ID_HEADER,
  createAuditRecorder,
  executionOutcomeForStatus,
} from "./aie-audit";

import {
  errorResponse,
} from "./aie-http";

import {
  getAieAuditSink,
} from "./create-server-audit-sink";

import {
  evaluateAuthorization,
  getAieRequestAuthorizer,
} from "./request-authorization";

import type {
  AieHttpOptions,
  AieOperation,
} from "./request-authorization";

/**
 * SERVER-ONLY orchestration shared by both AIE routes (TASK-022):
 *
 *   evaluateAuthorization -> [audit: authorization event]
 *     -> (authorized) execute() -> [audit: execution event]
 *     -> response + X-Correlation-Id
 *
 * It is the only place that connects the authorizer to the audit sink: the
 * authorizer knows nothing about auditing, and the sink never sees a request,
 * a token, a principal or a result. Authorization always runs first, before the
 * body is read or anything is validated; a denied request never reaches
 * `execute`.
 *
 * Every response, including denials and failures, carries X-Correlation-Id (a
 * server-generated id; an incoming correlation header is ignored) and keeps its
 * own headers, such as Cache-Control: no-store.
 */

function withCorrelationId(
  response: Response,
  correlationId: string,
): Response {
  const headers = new Headers(
    response.headers,
  );

  headers.set(
    CORRELATION_ID_HEADER,
    correlationId,
  );

  return new Response(response.body, {
    status: response.status,

    statusText: response.statusText,

    headers,
  });
}

export async function handleAieRequest(
  request: Request,
  operation: AieOperation,
  options: AieHttpOptions,
  execute: () => Promise<Response>,
): Promise<Response> {
  const audit = createAuditRecorder(
    operation,
    options.audit?.sink ??
      getAieAuditSink(),
    options.audit,
  );

  const authorization =
    await evaluateAuthorization(
      request,
      options.authorizer ??
        getAieRequestAuthorizer(),
      operation,
    );

  if (authorization.status !== "authorized") {
    await audit.authorization(
      authorization.status,
      {
        subject:
          authorization.subject,

        status:
          authorization.response.status,
      },
    );

    return withCorrelationId(
      authorization.response,
      audit.correlationId,
    );
  }

  await audit.authorization(
    "authorized",
    {
      subject: authorization.subject,
    },
  );

  let response: Response;

  try {
    response = await execute();
  } catch {
    // The handlers map their own failures; this is a last-resort guard.
    response = errorResponse(
      500,
      "AIE_INTERNAL_ERROR",
      "Unable to process request.",
    );
  }

  await audit.execution(
    executionOutcomeForStatus(
      response.status,
    ),
    {
      subject: authorization.subject,

      status: response.status,
    },
  );

  return withCorrelationId(
    response,
    audit.correlationId,
  );
}
