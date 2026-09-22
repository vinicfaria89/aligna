import type {
  AieAuditEvent,
  AieAuditSink,
} from "./aie-audit";

/**
 * SERVER-ONLY audit sink backed by the Planejador (TASK-037).
 *
 *   AieAuditEvent -> POST <planejador>/api/v1/aie-audit-events
 *     (X-Aie-Audit-Secret: server-to-server shared secret, never the caller's
 *     Bearer token and never the JWT signing secret -- that sharing was
 *     rejected in TASK-018)
 *
 * This module knows nothing about WHY the write may fail and does not decide
 * what happens when it does: the caller (`createAuditRecorder` in
 * `aie-audit.ts`) already races every `write` against a bounded timeout and
 * swallows a throw, a rejection or a late answer, so a denied/allowed AIE
 * decision is never affected by the Planejador being slow, down or rejecting
 * the write. This sink only turns one event into one HTTP request and turns a
 * non-2xx answer into a throw for that same swallowing to catch.
 *
 * The response body is never read: nothing here needs it, and reading it would
 * only add latency to a best-effort write.
 */

export const AIE_AUDIT_EVENTS_PATH =
  "/api/v1/aie-audit-events";

export type PlanejadorAuditFetch = (
  url: string,
  init: {
    method: "POST";

    headers: Record<string, string>;

    body: string;

    cache: "no-store";
  },
) => Promise<Response>;

export interface PlanejadorAuditSinkConfig {
  /** Already-validated base URL (see parsePlanejadorBaseUrl). */
  baseUrl: string;

  /** The server-to-server shared secret, sent as-is in a fixed header. */
  secret: string;

  /** Test seam. Defaults to the global fetch. */
  fetch?: PlanejadorAuditFetch;
}

export function createPlanejadorAuditSink(
  config: PlanejadorAuditSinkConfig,
): AieAuditSink {
  const url = `${config.baseUrl}${AIE_AUDIT_EVENTS_PATH}`;

  const doFetch =
    config.fetch ??
    ((requestUrl, init) =>
      globalThis.fetch(
        requestUrl,
        init,
      ));

  return {
    async write(
      event: AieAuditEvent,
    ): Promise<void> {
      const response = await doFetch(
        url,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "X-Aie-Audit-Secret":
              config.secret,
          },

          body: JSON.stringify(
            event,
          ),

          cache: "no-store",
        },
      );

      // The answer is never used: release the connection without reading it.
      void response.body
        ?.cancel()
        .catch(() => undefined);

      if (!response.ok) {
        throw new Error(
          "The audit sink rejected the event.",
        );
      }
    },
  };
}
