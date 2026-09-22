import { PLANEJADOR_API_URL } from "./planejador-api-url";
import {
  parseSavedSnapshot,
  type SavedSnapshot,
  type SnapshotItem,
} from "./portfolio-snapshot-mapping";
import type { SessionAccess } from "./session";

/**
 * Browser client for the Planejador's saved-result endpoints (TASK-029A):
 * GET / PUT / DELETE `/api/v1/portfolio-snapshot`. Saving is always an explicit user
 * action; nothing here runs on its own except the read on page open.
 *
 * The bearer comes from the app's existing session (`getSession`, in the app
 * `acquireAccessToken` of lib/session.ts, which refreshes before every call) and goes
 * ONLY in the Authorization header. No `credentials` option is set (a cross-origin
 * request carries no cookies), nothing is written to browser storage or the console,
 * and an outcome never carries the token, a response body or an error text.
 *
 * A 401 ends the session through the injected `clearSession` (the existing rule of
 * TASK-026) and is never retried. 404 on a read is the normal "nothing saved".
 */


export const PORTFOLIO_SNAPSHOT_URL = `${PLANEJADOR_API_URL}/api/v1/portfolio-snapshot`;

export type SnapshotFetch = (
  url: string,
  init: {
    method: "GET" | "PUT" | "DELETE";
    headers: Record<string, string>;
    body?: string;
    cache: "no-store";
  },
) => Promise<Response>;

/** Why nothing was done for lack of a usable session. */
export type SnapshotSessionFailure =
  | { kind: "no-session" }
  | { kind: "unauthenticated" }
  | { kind: "unavailable" };

export type LoadSnapshotOutcome =
  | { kind: "found"; snapshot: SavedSnapshot }
  | { kind: "none" }
  | SnapshotSessionFailure;

export type SaveSnapshotOutcome =
  | { kind: "saved"; snapshot: SavedSnapshot }
  /** The Planejador refused the content (422): nothing was saved. */
  | { kind: "rejected" }
  /** Network failure, 5xx or any other unexpected answer: nothing was saved. */
  | { kind: "failed" }
  | SnapshotSessionFailure;

export type DeleteSnapshotOutcome =
  | { kind: "deleted" }
  | { kind: "failed" }
  | SnapshotSessionFailure;

export interface PortfolioSnapshotClient {
  load(): Promise<LoadSnapshotOutcome>;
  save(items: SnapshotItem[]): Promise<SaveSnapshotOutcome>;
  remove(): Promise<DeleteSnapshotOutcome>;
}

export interface PortfolioSnapshotClientOptions {
  getSession: () => Promise<SessionAccess>;
  clearSession?: () => void;
  /** Test seam. Defaults to the global fetch. */
  fetchImpl?: SnapshotFetch;
}

type Reply =
  | { kind: "response"; response: Response }
  | { kind: "network-error" }
  | SnapshotSessionFailure;

export function createPortfolioSnapshotClient(
  options: PortfolioSnapshotClientOptions,
): PortfolioSnapshotClient {
  const doFetch: SnapshotFetch =
    options.fetchImpl ?? ((url, init) => globalThis.fetch(url, init));

  async function call(
    method: "GET" | "PUT" | "DELETE",
    body?: unknown,
  ): Promise<Reply> {
    let session: SessionAccess;

    try {
      session = await options.getSession();
    } catch {
      return { kind: "unavailable" };
    }

    if (session.status === "none") {
      return { kind: "no-session" };
    }

    if (session.status === "expired") {
      return { kind: "unauthenticated" };
    }

    if (session.status !== "ok" || !session.accessToken) {
      return { kind: "unavailable" };
    }

    try {
      const response = await doFetch(PORTFOLIO_SNAPSHOT_URL, {
        method,
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        cache: "no-store",
      });

      return { kind: "response", response };
    } catch {
      return { kind: "network-error" };
    }
  }

  /** A 401 ends the session (best effort) and asks for a new sign-in. */
  function unauthenticated(): SnapshotSessionFailure {
    try {
      options.clearSession?.();
    } catch {
      // Clearing is best effort; the outcome is the same.
    }

    return { kind: "unauthenticated" };
  }

  return {
    async load() {
      const reply = await call("GET");

      if (reply.kind === "network-error") {
        return { kind: "unavailable" };
      }

      if (reply.kind !== "response") {
        return reply;
      }

      const { response } = reply;

      if (response.status === 404) {
        return { kind: "none" };
      }

      if (response.status === 401) {
        return unauthenticated();
      }

      if (response.status !== 200) {
        return { kind: "unavailable" };
      }

      let snapshot: SavedSnapshot | null = null;

      try {
        snapshot = parseSavedSnapshot(await response.json());
      } catch {
        snapshot = null;
      }

      return snapshot ? { kind: "found", snapshot } : { kind: "unavailable" };
    },

    async save(items) {
      const reply = await call("PUT", { items });

      if (reply.kind === "network-error") {
        return { kind: "failed" };
      }

      if (reply.kind !== "response") {
        return reply;
      }

      const { response } = reply;

      if (response.status === 401) {
        return unauthenticated();
      }

      if (response.status === 422) {
        return { kind: "rejected" };
      }

      if (response.status !== 200) {
        return { kind: "failed" };
      }

      let snapshot: SavedSnapshot | null = null;

      try {
        snapshot = parseSavedSnapshot(await response.json());
      } catch {
        snapshot = null;
      }

      // The save itself succeeded; an unreadable echo is reported as a failure so the
      // screen never claims a state it cannot show.
      return snapshot ? { kind: "saved", snapshot } : { kind: "failed" };
    },

    async remove() {
      const reply = await call("DELETE");

      if (reply.kind === "network-error") {
        return { kind: "failed" };
      }

      if (reply.kind !== "response") {
        return reply;
      }

      const { response } = reply;

      if (response.status === 401) {
        return unauthenticated();
      }

      return response.ok ? { kind: "deleted" } : { kind: "failed" };
    },
  };
}
