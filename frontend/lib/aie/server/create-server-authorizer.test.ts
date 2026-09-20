import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";

import {
  join,
} from "node:path";

import {
  fileURLToPath,
} from "node:url";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  AieRequestAuthorizer,
} from "./request-authorization";

/**
 * Configuration and composition of the request authorizer (TASK-020): unset or
 * invalid configuration stays deny-all (fail closed), a valid one selects the
 * Planejador authorizer, and the environment is read in exactly one module.
 */

const ENV_NAME =
  "PLANEJADOR_AUTH_BASE_URL";

const USER_ID =
  "3f2b1c9e-8a4d-4e6f-9b0a-1c2d3e4f5a6b";

const FRONTEND_ROOT = fileURLToPath(
  new URL(
    "../../..",
    import.meta.url,
  ),
);

function request(): Request {
  return new Request(
    "http://aligna.local/api/aie/resolve-asset",
    {
      method: "POST",

      headers: {
        authorization:
          "Bearer some-token",
      },
    },
  );
}

async function load() {
  vi.resetModules();

  return import(
    "./create-server-authorizer"
  );
}

function stubIdentityFetch() {
  const fetchSpy = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          id: USER_ID,

          role: "cliente",

          is_active: true,
        }),
        {
          status: 200,
        },
      ),
  );

  vi.stubGlobal(
    "fetch",
    fetchSpy,
  );

  return fetchSpy;
}

async function denies(
  authorizer: AieRequestAuthorizer,
): Promise<boolean> {
  const result =
    await authorizer.authorize(
      request(),
      {
        operation: "resolve-asset",
      },
    );

  return (
    !result.authorized &&
    result.reason ===
      "unauthenticated"
  );
}

function listProduction(
  directory: string,
): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  const files: string[] = [];

  for (const entry of readdirSync(
    directory,
  )) {
    if (
      entry === "node_modules" ||
      entry === ".next"
    ) {
      continue;
    }

    const path = join(
      directory,
      entry,
    );

    if (
      statSync(path).isDirectory()
    ) {
      files.push(
        ...listProduction(path),
      );
    } else if (
      /\.(ts|tsx)$/.test(path) &&
      !/\.test\.(ts|tsx)$/.test(path)
    ) {
      files.push(path);
    }
  }

  return files;
}

function stripComments(
  source: string,
): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("createServerAuthorizer", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();

    vi.unstubAllGlobals();

    vi.resetModules();
  });

  it("is deny-all when the variable is unset, and never calls the network", async () => {
    vi.stubEnv(ENV_NAME, undefined);

    const fetchSpy =
      stubIdentityFetch();

    const { createServerAuthorizer } =
      await load();

    expect(
      await denies(
        createServerAuthorizer(),
      ),
    ).toBe(true);

    expect(
      fetchSpy,
    ).not.toHaveBeenCalled();
  });

  it("stays deny-all for every invalid value (fail closed, no throw)", async () => {
    const fetchSpy =
      stubIdentityFetch();

    const { createServerAuthorizer } =
      await load();

    for (const value of [
      "",
      "   ",
      "garbage",
      "http://example.com",
      "http://10.0.0.5:8000",
      "ftp://planejador.example.test",
      "https://user:pw@planejador.example.test",
      "https://planejador.example.test?x=1",
      "https://planejador.example.test#frag",
    ]) {
      vi.stubEnv(ENV_NAME, value);

      expect(
        await denies(
          createServerAuthorizer(),
        ),
      ).toBe(true);
    }

    expect(
      fetchSpy,
    ).not.toHaveBeenCalled();
  });

  it("selects the Planejador authorizer for a valid https or loopback http URL", async () => {
    const { createServerAuthorizer } =
      await load();

    for (const value of [
      "https://planejador.example.test",
      "https://planejador.example.test/",
      "http://localhost:8000",
      "http://127.0.0.1:8000",
    ]) {
      vi.stubEnv(ENV_NAME, value);

      const fetchSpy =
        stubIdentityFetch();

      const result =
        await createServerAuthorizer().authorize(
          request(),
          {
            operation:
              "resolve-asset",
          },
        );

      expect(result).toEqual({
        authorized: true,

        principal: {
          subject: USER_ID,

          roles: ["cliente"],
        },
      });

      expect(
        fetchSpy,
      ).toHaveBeenCalledTimes(1);

      const [url] = fetchSpy.mock
        .calls[0] as unknown as [
        string,
      ];

      expect(
        url.endsWith(
          "/api/v1/auth/me",
        ),
      ).toBe(true);
    }
  });

  it("accepts injected options for tests without touching the global fetch", async () => {
    vi.stubEnv(
      ENV_NAME,
      "https://planejador.example.test",
    );

    const globalFetch =
      stubIdentityFetch();

    const injected = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: USER_ID,

            role: "assessor",

            is_active: true,
          }),
          {
            status: 200,
          },
        ),
    );

    const { createServerAuthorizer } =
      await load();

    const result =
      await createServerAuthorizer({
        fetch: injected,

        timeoutMs: 500,
      }).authorize(request(), {
        operation: "resolve-asset",
      });

    expect(
      result.authorized,
    ).toBe(true);

    expect(
      injected,
    ).toHaveBeenCalledTimes(1);

    expect(
      globalFetch,
    ).not.toHaveBeenCalled();
  });

  it("getServerAuthorizer is memoized and the choice is made once", async () => {
    vi.stubEnv(ENV_NAME, undefined);

    const { getServerAuthorizer } =
      await load();

    const first =
      getServerAuthorizer();

    // Changing the environment afterwards does not change the choice.
    vi.stubEnv(
      ENV_NAME,
      "https://planejador.example.test",
    );

    expect(
      getServerAuthorizer(),
    ).toBe(first);

    expect(
      await denies(first),
    ).toBe(true);
  });

  it("importing the composition performs no network request", async () => {
    vi.stubEnv(
      ENV_NAME,
      "https://planejador.example.test",
    );

    const fetchSpy =
      stubIdentityFetch();

    await load();

    expect(
      fetchSpy,
    ).not.toHaveBeenCalled();
  });
});

describe("authorizer configuration guards (static)", () => {
  const production = [
    "app",
    "components",
    "lib",
  ].flatMap((directory) =>
    listProduction(
      join(FRONTEND_ROOT, directory),
    ),
  );

  function posix(
    file: string,
  ): string {
    return file
      .slice(FRONTEND_ROOT.length)
      .replace(/\\/g, "/")
      .replace(/^\//, "");
  }

  it("only create-server-authorizer.ts reads the environment for the identity integration", () => {
    const readers = production
      .filter((file) => {
        const source = stripComments(
          readFileSync(file, "utf8"),
        );

        return source.includes(
          ENV_NAME,
        );
      })
      .map(posix);

    expect(readers).toEqual([
      "lib/aie/server/create-server-authorizer.ts",
    ]);
  });

  it("the authorizer and the HTTP layer read no environment and log nothing", () => {
    for (const file of [
      "lib/aie/server/planejador-request-authorizer.ts",
      "lib/aie/server/request-authorization.ts",
      "lib/aie/server/deny-all-authorizer.ts",
      "lib/aie/server/resolve-asset-http.ts",
      "lib/aie/server/resolve-assets-http.ts",
    ]) {
      const source = stripComments(
        readFileSync(
          join(FRONTEND_ROOT, file),
          "utf8",
        ),
      );

      expect(source).not.toContain(
        "process.env",
      );

      expect(source).not.toMatch(
        /console\./,
      );
    }
  });

  it("introduces no public-prefix variant of the identity variable", () => {
    const candidates = [
      ...production,
      join(
        FRONTEND_ROOT,
        ".env.example",
      ),
    ].filter(existsSync);

    const offenders = candidates
      .filter((file) =>
        new RegExp(
          `NEXT_PUBLIC_\\w*(${["PLANEJADOR_AUTH", "AUTH_BASE"].join("|")})`,
        ).test(
          readFileSync(file, "utf8"),
        ),
      )
      .map(posix);

    expect(offenders).toEqual([]);
  });

  it(".env.example documents the variable as an empty server-side placeholder", () => {
    const lines = readFileSync(
      join(
        FRONTEND_ROOT,
        ".env.example",
      ),
      "utf8",
    )
      .split(/\r?\n/)
      .filter((line) =>
        line.startsWith(`${ENV_NAME}=`),
      );

    expect(lines).toEqual([
      `${ENV_NAME}=`,
    ]);
  });

  it("the token and the identity URL are never referenced by the AIE domain, providers or ANBIMA client", () => {
    for (const file of production.filter(
      (path) =>
        /lib\/aie\/(providers|infrastructure|resolution|application|contracts|ingestion)\//.test(
          path.replace(/\\/g, "/"),
        ),
    )) {
      const source = readFileSync(
        file,
        "utf8",
      );

      expect(source).not.toContain(
        ENV_NAME,
      );

      expect(source).not.toContain(
        "request-authorization",
      );

      expect(source).not.toContain(
        "planejador-request-authorizer",
      );
    }
  });

  it("the composition and the authorizer are server-only modules (never in the browser barrel)", () => {
    const barrel = readFileSync(
      join(
        FRONTEND_ROOT,
        "lib/aie/index.ts",
      ),
      "utf8",
    );

    for (const name of [
      "create-server-authorizer",
      "planejador-request-authorizer",
      "deny-all-authorizer",
      "server",
    ]) {
      expect(barrel).not.toContain(
        name,
      );
    }
  });
});
