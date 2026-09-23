import { readFileSync } from "node:fs";

import { join } from "node:path";

import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createPortfolioSnapshotClient,
  PORTFOLIO_SNAPSHOT_URL,
  PORTFOLIO_SNAPSHOTS_URL,
  type SnapshotFetch,
} from "./portfolio-snapshot-api";
import type { SnapshotItem } from "./portfolio-snapshot-mapping";
import type { SessionAccess } from "./session";

/**
 * TASK-029B: the browser client of the Planejador's saved-result endpoints. Offline: a
 * fake fetch, a fake session; nothing real is contacted.
 */

const TOKEN = "sentinel-snapshot-token";

const ITEMS: SnapshotItem[] = [
  {
    lineNumber: 2,
    rawName: "DEB PETROBRAS SERIE 1",
    assetType: "debenture",
    code: "ABCD11",
    amount: 98765.43,
    currency: "BRL",
    status: "needs-more-evidence",
    pendingFields: ["issuer"],
    sources: ["anbima"],
  },
];

const SNAPSHOT_BODY = {
  items: ITEMS,
  updatedAt: "2026-09-21T14:32:00+00:00",
};

const HISTORY_ENTRY = {
  id: "11111111-1111-1111-1111-111111111111",
  items: ITEMS,
  createdAt: "2026-09-21T14:32:00+00:00",
  updatedAt: "2026-09-21T14:32:00+00:00",
};

const ok = async (): Promise<SessionAccess> => ({
  status: "ok",
  accessToken: TOKEN,
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function rig(
  respond: () => Response | Promise<Response> = () => json(SNAPSHOT_BODY),
  getSession: () => Promise<SessionAccess> = ok,
) {
  const calls: Array<{
    url: string;
    init: Parameters<SnapshotFetch>[1];
  }> = [];

  const clearSession = vi.fn();

  const fetchImpl: SnapshotFetch = async (url, init) => {
    calls.push({ url, init });

    return respond();
  };

  const client = createPortfolioSnapshotClient({
    getSession,
    clearSession,
    fetchImpl,
  });

  return { client, calls, clearSession };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the request", () => {
  it("targets /api/v1/portfolio-snapshot on the Planejador base URL", () => {
    expect(PORTFOLIO_SNAPSHOT_URL).toMatch(/\/api\/v1\/portfolio-snapshot$/);
  });

  it("GET, PUT and DELETE send the bearer only in the Authorization header", async () => {
    const { client, calls } = rig(() => new Response(null, { status: 204 }));

    await client.load();
    await client.save(ITEMS);
    await client.remove();

    expect(calls.map((c) => c.init.method)).toEqual(["GET", "PUT", "DELETE"]);

    for (const call of calls) {
      expect(call.url).toBe(PORTFOLIO_SNAPSHOT_URL);

      expect(call.init.headers.Authorization).toBe(`Bearer ${TOKEN}`);

      expect(call.url).not.toContain(TOKEN);

      expect(String(call.init.body ?? "")).not.toContain(TOKEN);

      expect(call.init.cache).toBe("no-store");
    }
  });

  it("sets no `credentials` option, and no other header than Authorization (plus Content-Type on PUT)", async () => {
    const { client, calls } = rig(() => new Response(null, { status: 204 }));

    await client.load();
    await client.save(ITEMS);
    await client.remove();

    for (const call of calls) {
      expect(call.init).not.toHaveProperty("credentials");
    }

    expect(Object.keys(calls[0]!.init.headers)).toEqual(["Authorization"]);
    expect(Object.keys(calls[1]!.init.headers).sort()).toEqual([
      "Authorization",
      "Content-Type",
    ]);
    expect(calls[1]!.init.headers["Content-Type"]).toBe("application/json");
    expect(Object.keys(calls[2]!.init.headers)).toEqual(["Authorization"]);
  });

  it("only PUT has a body, and it is exactly { items }", async () => {
    const { client, calls } = rig(() => json(SNAPSHOT_BODY));

    await client.load();
    await client.save(ITEMS);

    expect(calls[0]!.init).not.toHaveProperty("body");

    expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ items: ITEMS });
  });

  it("asks the session once per call and uses the token it returned", async () => {
    const getSession = vi.fn(async (): Promise<SessionAccess> => ({
      status: "ok",
      accessToken: "fresh-token-2",
    }));

    const { client, calls } = rig(() => json(SNAPSHOT_BODY), getSession);

    await client.load();

    expect(getSession).toHaveBeenCalledTimes(1);

    expect(calls[0]!.init.headers.Authorization).toBe("Bearer fresh-token-2");
  });
});

describe("load", () => {
  it("200 with a valid body: found", async () => {
    const { client } = rig();

    const outcome = await client.load();

    expect(outcome.kind).toBe("found");

    if (outcome.kind === "found") {
      expect(outcome.snapshot.updatedAt).toBe(SNAPSHOT_BODY.updatedAt);
      expect(outcome.snapshot.items[0]?.rawName).toBe("DEB PETROBRAS SERIE 1");
    }
  });

  it("404 is the normal 'nothing saved': none, the session untouched", async () => {
    const { client, clearSession } = rig(() =>
      json({ detail: "Nenhum resultado de carteira salvo" }, 404),
    );

    expect(await client.load()).toEqual({ kind: "none" });

    expect(clearSession).not.toHaveBeenCalled();
  });

  it("401 is handled apart: the session is ended once and the outcome says so", async () => {
    const { client, clearSession, calls } = rig(() => json({}, 401));

    expect(await client.load()).toEqual({ kind: "unauthenticated" });

    expect(clearSession).toHaveBeenCalledTimes(1);

    // No retry.
    expect(calls).toHaveLength(1);
  });

  it("5xx, 403, an unexpected status, a network failure and a bad body: unavailable, session untouched", async () => {
    for (const status of [500, 502, 503, 403, 418]) {
      const { client, clearSession } = rig(() => json({}, status));

      expect(await client.load()).toEqual({ kind: "unavailable" });

      expect(clearSession).not.toHaveBeenCalled();
    }

    const failing = rig(() => {
      throw new TypeError("Failed to fetch");
    });

    expect(await failing.client.load()).toEqual({ kind: "unavailable" });

    expect(failing.clearSession).not.toHaveBeenCalled();

    for (const body of [{}, { items: [] }, { items: "x", updatedAt: "y" }]) {
      const { client } = rig(() => json(body));

      expect(await client.load()).toEqual({ kind: "unavailable" });
    }

    const notJson = rig(() => new Response("<html>", { status: 200 }));

    expect(await notJson.client.load()).toEqual({ kind: "unavailable" });
  });

  it("without a stored session nothing is sent", async () => {
    const { client, calls } = rig(undefined, async () => ({ status: "none" }));

    expect(await client.load()).toEqual({ kind: "no-session" });

    expect(calls).toHaveLength(0);
  });

  it("an expired session sends nothing and is not cleared again by this client", async () => {
    const { client, calls, clearSession } = rig(undefined, async () => ({
      status: "expired",
    }));

    expect(await client.load()).toEqual({ kind: "unauthenticated" });

    expect(calls).toHaveLength(0);

    expect(clearSession).not.toHaveBeenCalled();
  });

  it("an unavailable or throwing session sends nothing", async () => {
    for (const getSession of [
      async (): Promise<SessionAccess> => ({ status: "unavailable" }),
      async (): Promise<SessionAccess> => ({ status: "ok", accessToken: "" }),
      async (): Promise<SessionAccess> => {
        throw new Error("storage blocked");
      },
    ]) {
      const { client, calls } = rig(undefined, getSession);

      expect(await client.load()).toEqual({ kind: "unavailable" });

      expect(calls).toHaveLength(0);
    }
  });
});

describe("save", () => {
  it("200: saved, with the snapshot the Planejador returned", async () => {
    const { client } = rig();

    const outcome = await client.save(ITEMS);

    expect(outcome.kind).toBe("saved");

    if (outcome.kind === "saved") {
      expect(outcome.snapshot.updatedAt).toBe(SNAPSHOT_BODY.updatedAt);
    }
  });

  it("422: rejected (nothing saved), the session untouched", async () => {
    const { client, clearSession } = rig(() => json({ detail: [] }, 422));

    expect(await client.save(ITEMS)).toEqual({ kind: "rejected" });

    expect(clearSession).not.toHaveBeenCalled();
  });

  it("401: the session is ended once, no retry", async () => {
    const { client, clearSession, calls } = rig(() => json({}, 401));

    expect(await client.save(ITEMS)).toEqual({ kind: "unauthenticated" });

    expect(clearSession).toHaveBeenCalledTimes(1);

    expect(calls).toHaveLength(1);
  });

  it("5xx, other statuses, network failure and an unreadable answer: failed, session untouched", async () => {
    for (const status of [500, 503, 403, 404, 418]) {
      const { client, clearSession, calls } = rig(() => json({}, status));

      expect(await client.save(ITEMS)).toEqual({ kind: "failed" });

      expect(clearSession).not.toHaveBeenCalled();

      expect(calls).toHaveLength(1);
    }

    const failing = rig(() => {
      throw new TypeError("Failed to fetch");
    });

    expect(await failing.client.save(ITEMS)).toEqual({ kind: "failed" });

    const garbage = rig(() => json({ nothing: true }));

    expect(await garbage.client.save(ITEMS)).toEqual({ kind: "failed" });
  });

  it("without a session nothing is sent, and an expired one is reported", async () => {
    const none = rig(undefined, async () => ({ status: "none" }));

    expect(await none.client.save(ITEMS)).toEqual({ kind: "no-session" });

    expect(none.calls).toHaveLength(0);

    const expired = rig(undefined, async () => ({ status: "expired" }));

    expect(await expired.client.save(ITEMS)).toEqual({ kind: "unauthenticated" });

    expect(expired.calls).toHaveLength(0);
  });
});

describe("remove", () => {
  it("204: deleted", async () => {
    const { client } = rig(() => new Response(null, { status: 204 }));

    expect(await client.remove()).toEqual({ kind: "deleted" });
  });

  it("401: the session is ended once", async () => {
    const { client, clearSession } = rig(() => json({}, 401));

    expect(await client.remove()).toEqual({ kind: "unauthenticated" });

    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  it("5xx and network failure: failed, session untouched", async () => {
    const { client, clearSession } = rig(() => json({}, 500));

    expect(await client.remove()).toEqual({ kind: "failed" });

    expect(clearSession).not.toHaveBeenCalled();

    const failing = rig(() => {
      throw new TypeError("Failed to fetch");
    });

    expect(await failing.client.remove()).toEqual({ kind: "failed" });
  });

  it("without a session nothing is sent", async () => {
    const { client, calls } = rig(undefined, async () => ({ status: "none" }));

    expect(await client.remove()).toEqual({ kind: "no-session" });

    expect(calls).toHaveLength(0);
  });
});

describe("list", () => {
  it("targets /api/v1/portfolio-snapshots (plural) with GET", async () => {
    const { client, calls } = rig(() => json([]));

    await client.list();

    expect(calls[0]!.url).toBe(PORTFOLIO_SNAPSHOTS_URL);
    expect(calls[0]!.init.method).toBe("GET");
  });

  it("200 with a valid array: found", async () => {
    const { client } = rig(() => json([HISTORY_ENTRY]));

    const outcome = await client.list();

    expect(outcome.kind).toBe("found");

    if (outcome.kind === "found") {
      expect(outcome.snapshots).toHaveLength(1);
      expect(outcome.snapshots[0]?.id).toBe(HISTORY_ENTRY.id);
      expect(outcome.snapshots[0]?.createdAt).toBe(HISTORY_ENTRY.createdAt);
    }
  });

  it("200 with an empty array: found, empty", async () => {
    const { client } = rig(() => json([]));

    expect(await client.list()).toEqual({ kind: "found", snapshots: [] });
  });

  it("401: the session is ended once, no retry", async () => {
    const { client, clearSession, calls } = rig(() => json({}, 401));

    expect(await client.list()).toEqual({ kind: "unauthenticated" });

    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
  });

  it("5xx, network failure and a malformed body: unavailable, session untouched", async () => {
    for (const status of [500, 403]) {
      const { client, clearSession } = rig(() => json({}, status));

      expect(await client.list()).toEqual({ kind: "unavailable" });

      expect(clearSession).not.toHaveBeenCalled();
    }

    const failing = rig(() => {
      throw new TypeError("Failed to fetch");
    });

    expect(await failing.client.list()).toEqual({ kind: "unavailable" });

    const notAnArray = rig(() => json({ notAnArray: true }));

    expect(await notAnArray.client.list()).toEqual({ kind: "unavailable" });

    // One malformed entry makes the whole list unusable (same all-or-nothing
    // rule as `load`).
    const badEntry = rig(() => json([{ ...HISTORY_ENTRY, id: undefined }]));

    expect(await badEntry.client.list()).toEqual({ kind: "unavailable" });
  });

  it("without a session nothing is sent", async () => {
    const { client, calls } = rig(undefined, async () => ({ status: "none" }));

    expect(await client.list()).toEqual({ kind: "no-session" });

    expect(calls).toHaveLength(0);
  });
});

describe("get", () => {
  it("targets /api/v1/portfolio-snapshots/{id} (URI-encoded) with GET", async () => {
    const { client, calls } = rig(() => json(HISTORY_ENTRY));

    await client.get("id with spaces/slash");

    expect(calls[0]!.url).toBe(
      `${PORTFOLIO_SNAPSHOTS_URL}/${encodeURIComponent("id with spaces/slash")}`,
    );
    expect(calls[0]!.init.method).toBe("GET");
  });

  it("200 with a valid body: found", async () => {
    const { client } = rig(() => json(HISTORY_ENTRY));

    const outcome = await client.get(HISTORY_ENTRY.id);

    expect(outcome.kind).toBe("found");

    if (outcome.kind === "found") {
      expect(outcome.snapshot.id).toBe(HISTORY_ENTRY.id);
    }
  });

  it("404: none, the session untouched", async () => {
    const { client, clearSession } = rig(() => json({}, 404));

    expect(await client.get(HISTORY_ENTRY.id)).toEqual({ kind: "none" });

    expect(clearSession).not.toHaveBeenCalled();
  });

  it("401: the session is ended once, no retry", async () => {
    const { client, clearSession, calls } = rig(() => json({}, 401));

    expect(await client.get(HISTORY_ENTRY.id)).toEqual({ kind: "unauthenticated" });

    expect(clearSession).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
  });

  it("5xx, network failure and a malformed body: unavailable", async () => {
    const { client } = rig(() => json({}, 500));

    expect(await client.get(HISTORY_ENTRY.id)).toEqual({ kind: "unavailable" });

    const failing = rig(() => {
      throw new TypeError("Failed to fetch");
    });

    expect(await failing.client.get(HISTORY_ENTRY.id)).toEqual({ kind: "unavailable" });

    const garbage = rig(() => json({ id: HISTORY_ENTRY.id }));

    expect(await garbage.client.get(HISTORY_ENTRY.id)).toEqual({ kind: "unavailable" });
  });

  it("without a session nothing is sent", async () => {
    const { client, calls } = rig(undefined, async () => ({ status: "none" }));

    expect(await client.get(HISTORY_ENTRY.id)).toEqual({ kind: "no-session" });

    expect(calls).toHaveLength(0);
  });
});

describe("removeById", () => {
  it("targets /api/v1/portfolio-snapshots/{id} (URI-encoded) with DELETE", async () => {
    const { client, calls } = rig(() => new Response(null, { status: 204 }));

    await client.removeById("id with spaces/slash");

    expect(calls[0]!.url).toBe(
      `${PORTFOLIO_SNAPSHOTS_URL}/${encodeURIComponent("id with spaces/slash")}`,
    );
    expect(calls[0]!.init.method).toBe("DELETE");
  });

  it("204: deleted", async () => {
    const { client } = rig(() => new Response(null, { status: 204 }));

    expect(await client.removeById(HISTORY_ENTRY.id)).toEqual({ kind: "deleted" });
  });

  it("404: not-found, the session untouched", async () => {
    const { client, clearSession } = rig(() => json({}, 404));

    expect(await client.removeById(HISTORY_ENTRY.id)).toEqual({ kind: "not-found" });

    expect(clearSession).not.toHaveBeenCalled();
  });

  it("401: the session is ended once", async () => {
    const { client, clearSession } = rig(() => json({}, 401));

    expect(await client.removeById(HISTORY_ENTRY.id)).toEqual({ kind: "unauthenticated" });

    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  it("5xx and network failure: failed, session untouched", async () => {
    const { client, clearSession } = rig(() => json({}, 500));

    expect(await client.removeById(HISTORY_ENTRY.id)).toEqual({ kind: "failed" });

    expect(clearSession).not.toHaveBeenCalled();

    const failing = rig(() => {
      throw new TypeError("Failed to fetch");
    });

    expect(await failing.client.removeById(HISTORY_ENTRY.id)).toEqual({ kind: "failed" });
  });

  it("without a session nothing is sent", async () => {
    const { client, calls } = rig(undefined, async () => ({ status: "none" }));

    expect(await client.removeById(HISTORY_ENTRY.id)).toEqual({ kind: "no-session" });

    expect(calls).toHaveLength(0);
  });
});

describe("privacy", () => {
  it("no outcome carries the token, a response body or an error text", async () => {
    const bodies = [
      () => json({ detail: "SECRET-SERVER-DETAIL " + TOKEN }, 500),
      () => json({ detail: "SECRET-SERVER-DETAIL " + TOKEN }, 401),
      () => json({ detail: "SECRET-SERVER-DETAIL " + TOKEN }, 422),
      () => new Response(null, { status: 204 }),
      () => json(SNAPSHOT_BODY),
    ];

    for (const respond of bodies) {
      const { client } = rig(respond);

      for (const outcome of [
        await client.load(),
        await client.save(ITEMS),
        await client.remove(),
        await client.list(),
        await client.get(HISTORY_ENTRY.id),
        await client.removeById(HISTORY_ENTRY.id),
      ]) {
        const text = JSON.stringify(outcome);

        expect(text).not.toContain(TOKEN);
        expect(text).not.toContain("SECRET-SERVER-DETAIL");
        expect(text).not.toContain("Bearer");
      }
    }
  });

  it("writes to no storage and prints nothing to the console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (method) => vi.spyOn(console, method).mockImplementation(() => undefined),
    );

    const { client } = rig(() => json({}, 500));

    await client.load();
    await client.save(ITEMS);
    await client.remove();
    await client.list();
    await client.get(HISTORY_ENTRY.id);
    await client.removeById(HISTORY_ENTRY.id);

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }

    // The test environment has no browser storage: any use would have thrown.
    expect(
      (globalThis as { localStorage?: unknown }).localStorage,
    ).toBeUndefined();
  });

  it("the sources use no storage, console, cookie, credentials option or provider code", () => {
    for (const file of [
      "lib/portfolio-snapshot-api.ts",
      "lib/portfolio-snapshot-mapping.ts",
    ]) {
      const source = readFileSync(join(process.cwd(), file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

      for (const forbidden of [
        "localStorage",
        "sessionStorage",
        "indexedDB",
        "document.cookie",
        "console.",
        "credentials",
        "sendBeacon",
        "lib/aie/server",
        "Anbima",
        "ANBIMA",
        "clientSecret",
      ]) {
        expect(source).not.toContain(forbidden);
      }
    }
  });

  it("does not touch lib/aie: it only reads two of its types", () => {
    for (const file of [
      "lib/portfolio-snapshot-api.ts",
      "lib/portfolio-snapshot-mapping.ts",
    ]) {
      const source = readFileSync(join(process.cwd(), file), "utf8");

      const imports = [...source.matchAll(/from\s*["']([^"']+)["']/g)].map(
        (match) => match[1],
      );

      for (const specifier of imports) {
        if (specifier?.includes("aie")) {
          expect(specifier).toMatch(
            /^\.\/aie\/client\/(portfolio-csv-preview|resolve-csv-client)$/,
          );
        }
      }
    }
  });
});
