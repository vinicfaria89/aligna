import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/**
 * Configuration and composition of the audit sink (TASK-037): unset or invalid
 * configuration stays the safe TASK-022 no-op (auditing is best-effort and its
 * absence must never affect the AIE), a valid pair of variables selects the
 * Planejador-backed sink, and the environment is read in exactly the two
 * modules that legitimately need it (this one and create-server-authorizer.ts,
 * pinned together in create-server-authorizer.test.ts).
 */

const BASE_URL_VAR = "PLANEJADOR_AUTH_BASE_URL";

const SECRET_VAR = "AIE_AUDIT_SHARED_SECRET";

const VALID_BASE_URL =
  "https://planejador.example.test";

const VALID_SECRET =
  "sentinel-shared-secret-value";

async function load() {
  vi.resetModules();

  return import(
    "./create-server-audit-sink"
  );
}

function stubAuditFetch(
  ok = true,
) {
  const fetchSpy = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          status: "recorded",
        }),
        { status: ok ? 201 : 401 },
      ),
  );

  vi.stubGlobal("fetch", fetchSpy);

  return fetchSpy;
}

const EVENT = {
  correlationId: "c",

  timestamp: "2026-09-22T00:00:00.000Z",

  operation: "resolve-assets" as const,

  stage: "authorization" as const,

  outcome: "authorized" as const,

  decision: "allow" as const,
};

describe("createServerAuditSink", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();

    vi.unstubAllGlobals();

    vi.resetModules();
  });

  it("is the no-op sink when both variables are unset, and never touches the network", async () => {
    vi.stubEnv(BASE_URL_VAR, undefined);

    vi.stubEnv(SECRET_VAR, undefined);

    const fetchSpy = stubAuditFetch();

    const { createServerAuditSink } =
      await load();

    await expect(
      createServerAuditSink().write(
        EVENT,
      ),
    ).resolves.toBeUndefined();

    expect(
      fetchSpy,
    ).not.toHaveBeenCalled();
  });

  it("is the no-op sink when only the base URL is set", async () => {
    vi.stubEnv(
      BASE_URL_VAR,
      VALID_BASE_URL,
    );

    vi.stubEnv(SECRET_VAR, undefined);

    const fetchSpy = stubAuditFetch();

    const { createServerAuditSink } =
      await load();

    await createServerAuditSink().write(
      EVENT,
    );

    expect(
      fetchSpy,
    ).not.toHaveBeenCalled();
  });

  it("is the no-op sink when only the secret is set", async () => {
    vi.stubEnv(BASE_URL_VAR, undefined);

    vi.stubEnv(
      SECRET_VAR,
      VALID_SECRET,
    );

    const fetchSpy = stubAuditFetch();

    const { createServerAuditSink } =
      await load();

    await createServerAuditSink().write(
      EVENT,
    );

    expect(
      fetchSpy,
    ).not.toHaveBeenCalled();
  });

  it("is the no-op sink for every invalid base URL, even with a valid secret (fail safe, no throw)", async () => {
    vi.stubEnv(
      SECRET_VAR,
      VALID_SECRET,
    );

    const fetchSpy = stubAuditFetch();

    const { createServerAuditSink } =
      await load();

    for (const value of [
      "",
      "   ",
      "garbage",
      "http://example.com",
      "ftp://planejador.example.test",
      "https://user:pw@planejador.example.test",
    ]) {
      vi.stubEnv(BASE_URL_VAR, value);

      await expect(
        createServerAuditSink().write(
          EVENT,
        ),
      ).resolves.toBeUndefined();
    }

    expect(
      fetchSpy,
    ).not.toHaveBeenCalled();
  });

  it("is the no-op sink for an empty secret, even with a valid base URL", async () => {
    vi.stubEnv(
      BASE_URL_VAR,
      VALID_BASE_URL,
    );

    vi.stubEnv(SECRET_VAR, "");

    const fetchSpy = stubAuditFetch();

    const { createServerAuditSink } =
      await load();

    await createServerAuditSink().write(
      EVENT,
    );

    expect(
      fetchSpy,
    ).not.toHaveBeenCalled();
  });

  it("selects the Planejador-backed sink when both variables are set", async () => {
    vi.stubEnv(
      BASE_URL_VAR,
      VALID_BASE_URL,
    );

    vi.stubEnv(
      SECRET_VAR,
      VALID_SECRET,
    );

    const fetchSpy = stubAuditFetch();

    const { createServerAuditSink } =
      await load();

    await createServerAuditSink().write(
      EVENT,
    );

    expect(
      fetchSpy,
    ).toHaveBeenCalledTimes(1);

    const [url, init] = fetchSpy.mock
      .calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];

    expect(url).toBe(
      `${VALID_BASE_URL}/api/v1/aie-audit-events`,
    );

    expect(
      init.headers["X-Aie-Audit-Secret"],
    ).toBe(VALID_SECRET);
  });

  it("accepts an injected fetch for tests without touching the global one", async () => {
    vi.stubEnv(
      BASE_URL_VAR,
      VALID_BASE_URL,
    );

    vi.stubEnv(
      SECRET_VAR,
      VALID_SECRET,
    );

    const globalFetch =
      stubAuditFetch();

    const injected = vi.fn(
      async () =>
        new Response("{}", {
          status: 201,
        }),
    );

    const { createServerAuditSink } =
      await load();

    await createServerAuditSink({
      fetch: injected,
    }).write(EVENT);

    expect(
      injected,
    ).toHaveBeenCalledTimes(1);

    expect(
      globalFetch,
    ).not.toHaveBeenCalled();
  });

  it("getAieAuditSink is memoized and the choice is made once", async () => {
    vi.stubEnv(BASE_URL_VAR, undefined);

    vi.stubEnv(SECRET_VAR, undefined);

    const { getAieAuditSink } =
      await load();

    const first = getAieAuditSink();

    // Changing the environment afterwards does not change the choice.
    vi.stubEnv(
      BASE_URL_VAR,
      VALID_BASE_URL,
    );

    vi.stubEnv(
      SECRET_VAR,
      VALID_SECRET,
    );

    expect(getAieAuditSink()).toBe(
      first,
    );

    const fetchSpy = stubAuditFetch();

    await first.write(EVENT);

    expect(
      fetchSpy,
    ).not.toHaveBeenCalled();
  });

  it("importing the composition performs no network request", async () => {
    vi.stubEnv(
      BASE_URL_VAR,
      VALID_BASE_URL,
    );

    vi.stubEnv(
      SECRET_VAR,
      VALID_SECRET,
    );

    const fetchSpy = stubAuditFetch();

    await load();

    expect(
      fetchSpy,
    ).not.toHaveBeenCalled();
  });
});
