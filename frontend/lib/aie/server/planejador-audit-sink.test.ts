import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  AIE_AUDIT_EVENTS_PATH,
  createPlanejadorAuditSink,
} from "./planejador-audit-sink";

import type {
  PlanejadorAuditFetch,
} from "./planejador-audit-sink";

/** TASK-037: the audit sink's own HTTP mapping, isolated from its composition. */

const BASE_URL =
  "https://planejador.example.test";

const SECRET = "sentinel-secret";

const EVENT = {
  correlationId: "corr-1",

  timestamp: "2026-09-22T00:00:00.000Z",

  operation: "resolve-assets" as const,

  stage: "execution" as const,

  outcome: "completed" as const,

  status: 200,

  subject: "user-1",
};

function okFetch() {
  return vi.fn<PlanejadorAuditFetch>(
    async () =>
      new Response(
        JSON.stringify({
          status: "recorded",
        }),
        { status: 201 },
      ),
  );
}

describe("createPlanejadorAuditSink", () => {
  it("POSTs the event as JSON to the fixed audit path under the base URL", async () => {
    const fetchImpl = okFetch();

    await createPlanejadorAuditSink({
      baseUrl: BASE_URL,

      secret: SECRET,

      fetch: fetchImpl,
    }).write(EVENT);

    expect(
      fetchImpl,
    ).toHaveBeenCalledTimes(1);

    const [url, init] =
      fetchImpl.mock.calls[0]!;

    expect(url).toBe(
      `${BASE_URL}${AIE_AUDIT_EVENTS_PATH}`,
    );

    expect(init.method).toBe("POST");

    expect(
      init.headers["Content-Type"],
    ).toBe("application/json");

    expect(
      init.headers[
        "X-Aie-Audit-Secret"
      ],
    ).toBe(SECRET);

    expect(init.cache).toBe(
      "no-store",
    );

    expect(
      JSON.parse(init.body),
    ).toEqual(EVENT);
  });

  it("throws a fixed-message error on a non-2xx answer, without reading the body", async () => {
    const bodyGet = vi.fn();

    const fetchImpl = vi.fn(
      async () => {
        const response = new Response(
          JSON.stringify({
            detail: "sentinel-should-never-be-read",
          }),
          { status: 401 },
        );

        Object.defineProperty(
          response,
          "json",
          {
            value: () => {
              bodyGet();

              return Promise.resolve(
                {},
              );
            },
          },
        );

        return response;
      },
    );

    const sink = createPlanejadorAuditSink({
      baseUrl: BASE_URL,

      secret: SECRET,

      fetch: fetchImpl,
    });

    await expect(
      sink.write(EVENT),
    ).rejects.toThrow(
      "The audit sink rejected the event.",
    );

    expect(bodyGet).not.toHaveBeenCalled();
  });

  it("resolves without reading the body on a 2xx answer", async () => {
    const fetchImpl = okFetch();

    await expect(
      createPlanejadorAuditSink({
        baseUrl: BASE_URL,

        secret: SECRET,

        fetch: fetchImpl,
      }).write(EVENT),
    ).resolves.toBeUndefined();
  });

  it("never puts the secret in the thrown error", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("{}", {
          status: 500,
        }),
    );

    const sink = createPlanejadorAuditSink({
      baseUrl: BASE_URL,

      secret: "SENTINEL-SECRET-VALUE",

      fetch: fetchImpl,
    });

    const error = await sink
      .write(EVENT)
      .catch((err) => err);

    expect(String(error)).not.toContain(
      "SENTINEL-SECRET-VALUE",
    );
  });

  it("defaults to the global fetch when none is injected", async () => {
    const fetchSpy = okFetch();

    vi.stubGlobal("fetch", fetchSpy);

    try {
      await createPlanejadorAuditSink({
        baseUrl: BASE_URL,

        secret: SECRET,
      }).write(EVENT);

      expect(
        fetchSpy,
      ).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
