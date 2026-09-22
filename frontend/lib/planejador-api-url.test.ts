import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

/**
 * TASK-033: `PLANEJADOR_API_URL` is resolved once at module load, so each case
 * needs a fresh import after setting the environment it should see. `NODE_ENV` is
 * read-only on Node's `process.env` in some runtimes; `vi.stubEnv` handles that
 * safely and `vi.unstubAllEnvs` restores the real values (in particular `test`,
 * see `describe("what the rest of the suite runs under")` below) after each case.
 */

async function loadWithEnv(nodeEnv: string, url: string | undefined) {
  vi.stubEnv("NODE_ENV", nodeEnv);

  if (url === undefined) {
    vi.stubEnv("NEXT_PUBLIC_PLANEJADOR_API_URL", "");
    delete process.env.NEXT_PUBLIC_PLANEJADOR_API_URL;
  } else {
    vi.stubEnv("NEXT_PUBLIC_PLANEJADOR_API_URL", url);
  }

  vi.resetModules();

  return import("./planejador-api-url");
}

describe("PLANEJADOR_API_URL", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("development (next dev) without the variable: falls back to localhost, for local ergonomics", async () => {
    const mod = await loadWithEnv("development", undefined);

    expect(mod.PLANEJADOR_API_URL).toBe("http://localhost:8000");
  });

  it("development with the variable set: uses it, not the fallback", async () => {
    const mod = await loadWithEnv(
      "development",
      "https://dev.example.com",
    );

    expect(mod.PLANEJADOR_API_URL).toBe("https://dev.example.com");
  });

  it("test (the suite's own NODE_ENV) without the variable: falls back too, existing tests are unaffected", async () => {
    const mod = await loadWithEnv("test", undefined);

    expect(mod.PLANEJADOR_API_URL).toBe("http://localhost:8000");
  });

  it("production (next build) without the variable: throws instead of shipping the localhost fallback", async () => {
    await expect(
      loadWithEnv("production", undefined),
    ).rejects.toThrow(/NEXT_PUBLIC_PLANEJADOR_API_URL/);
  });

  it("the production error names the variable and explains the risk, without a stack trace nobody can act on", async () => {
    await expect(loadWithEnv("production", undefined)).rejects.toThrow(
      /obrigatória em builds de produção/,
    );
  });

  it("production with the variable set: passes, and uses exactly that value", async () => {
    const mod = await loadWithEnv(
      "production",
      "https://planejador.example.com",
    );

    expect(mod.PLANEJADOR_API_URL).toBe(
      "https://planejador.example.com",
    );
  });

  it("production with an empty string is treated as absent (still throws)", async () => {
    await expect(loadWithEnv("production", "")).rejects.toThrow(
      /NEXT_PUBLIC_PLANEJADOR_API_URL/,
    );
  });
});

describe("lib/api.ts and lib/portfolio-snapshot-api.ts share this one source", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("no file computes its own NEXT_PUBLIC_PLANEJADOR_API_URL fallback anymore", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    for (const file of ["lib/api.ts", "lib/portfolio-snapshot-api.ts"]) {
      const source = readFileSync(
        join(process.cwd(), file),
        "utf8",
      );

      expect(source).not.toContain(
        "NEXT_PUBLIC_PLANEJADOR_API_URL",
      );

      expect(source).toContain(
        'from "./planejador-api-url"',
      );
    }
  });

  it("lib/portfolio-snapshot-api.ts's PORTFOLIO_SNAPSHOT_URL is built from the shared constant", async () => {
    await loadWithEnv(
      "development",
      "https://shared.example.com",
    );

    const { PORTFOLIO_SNAPSHOT_URL } = await import(
      "./portfolio-snapshot-api"
    );

    expect(PORTFOLIO_SNAPSHOT_URL).toBe(
      "https://shared.example.com/api/v1/portfolio-snapshot",
    );
  });

  it("a production build with the variable missing fails when either client module is imported", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.NEXT_PUBLIC_PLANEJADOR_API_URL;
    vi.resetModules();

    await expect(import("./api")).rejects.toThrow(
      /NEXT_PUBLIC_PLANEJADOR_API_URL/,
    );

    vi.resetModules();

    await expect(
      import("./portfolio-snapshot-api"),
    ).rejects.toThrow(/NEXT_PUBLIC_PLANEJADOR_API_URL/);
  });
});
