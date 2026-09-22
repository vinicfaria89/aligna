import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { ApiError, login } from "./api";

/**
 * TASK-034: `login()` always throws an `ApiError` whose `.message` is a plain,
 * user-facing string. It used to pass the Planejador's `detail` straight through
 * (`body.detail ?? fallback`); for a 422 whose `detail` is FastAPI's own array of
 * Pydantic validation errors, that array was coerced by `Array.prototype.toString`
 * into the literal text "[object Object]" -- reproduced on the real deployed
 * `/evolucao` login form. Offline: `fetch` is stubbed, nothing real is contacted.
 */

const EMAIL = "pessoa@example.com";

const PASSWORD = "senha-de-teste";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubFetch(respond: () => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => respond()),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("login: readable error messages", () => {
  it("401 with a plain-string detail: the message is exactly that string, unchanged", async () => {
    stubFetch(() => json({ detail: "E-mail ou senha inválidos" }, 401));

    await expect(login(EMAIL, PASSWORD)).rejects.toMatchObject({
      status: 401,
      message: "E-mail ou senha inválidos",
    });
  });

  it("401 rejects with an ApiError (not a plain Error)", async () => {
    stubFetch(() => json({ detail: "E-mail ou senha inválidos" }, 401));

    await expect(login(EMAIL, PASSWORD)).rejects.toBeInstanceOf(
      ApiError,
    );
  });

  it("422 with a plain-string detail: uses that string, same as any other status", async () => {
    stubFetch(() =>
      json({ detail: "Corpo da requisição inválido" }, 422),
    );

    await expect(login(EMAIL, PASSWORD)).rejects.toMatchObject({
      status: 422,
      message: "Corpo da requisição inválido",
    });
  });

  it("422 with FastAPI's array-of-objects detail: a readable generic message, never [object Object]", async () => {
    stubFetch(() =>
      json(
        {
          detail: [
            {
              loc: ["body", "email"],
              msg: "value is not a valid email address",
              type: "value_error",
            },
          ],
        },
        422,
      ),
    );

    const outcome = await login(EMAIL, PASSWORD).catch(
      (err) => err,
    );

    expect(outcome).toBeInstanceOf(ApiError);
    expect(outcome.status).toBe(422);
    expect(outcome.message).not.toContain("[object Object]");
    expect(outcome.message).not.toBe("");
    expect(typeof outcome.message).toBe("string");
    expect(outcome.message).toMatch(/\S/);
  });

  it("422 array detail with several validation errors: still one readable string", async () => {
    stubFetch(() =>
      json(
        {
          detail: [
            { loc: ["body", "email"], msg: "field required", type: "missing" },
            { loc: ["body", "password"], msg: "field required", type: "missing" },
          ],
        },
        422,
      ),
    );

    const outcome = await login(EMAIL, PASSWORD).catch(
      (err) => err,
    );

    expect(outcome.message).not.toContain("[object Object]");
    expect(outcome.message).not.toContain(",");
  });

  it("never echoes the raw Pydantic field/message text from a validation error", async () => {
    stubFetch(() =>
      json(
        {
          detail: [
            {
              loc: ["body", "SENTINEL_FIELD"],
              msg: "SENTINEL_RAW_PYDANTIC_TEXT",
              type: "value_error",
            },
          ],
        },
        422,
      ),
    );

    const outcome = await login(EMAIL, PASSWORD).catch(
      (err) => err,
    );

    expect(outcome.message).not.toContain("SENTINEL_FIELD");
    expect(outcome.message).not.toContain(
      "SENTINEL_RAW_PYDANTIC_TEXT",
    );
  });

  it("an unexpected response body (no detail, detail null, detail a number) falls back to the existing default message", async () => {
    for (const body of [
      {},
      { detail: null },
      { detail: 42 },
      { detail: [] },
      { something: "else" },
    ]) {
      stubFetch(() => json(body, 500));

      await expect(
        login(EMAIL, PASSWORD),
      ).rejects.toMatchObject({
        status: 500,
        message: "Não conseguimos entrar com esse e-mail e senha",
      });
    }
  });

  it("an unparsable body (not JSON) falls back to the status text, not a crash", async () => {
    stubFetch(
      () =>
        new Response("not json", {
          status: 503,
          statusText: "Service Unavailable",
        }),
    );

    const outcome = await login(EMAIL, PASSWORD).catch(
      (err) => err,
    );

    expect(outcome).toBeInstanceOf(ApiError);
    expect(outcome.status).toBe(503);
    expect(typeof outcome.message).toBe("string");
    expect(outcome.message).not.toContain("[object Object]");
  });

  it("a network failure (fetch itself rejects) propagates as-is, not swallowed into an ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const outcome = await login(EMAIL, PASSWORD).catch(
      (err) => err,
    );

    expect(outcome).toBeInstanceOf(TypeError);
    expect(outcome).not.toBeInstanceOf(ApiError);
  });

  it("success (200) is unaffected: returns the tokens, no error thrown", async () => {
    stubFetch(() =>
      json(
        {
          access_token: "a",
          refresh_token: "b",
          token_type: "bearer",
        },
        200,
      ),
    );

    await expect(login(EMAIL, PASSWORD)).resolves.toEqual({
      access_token: "a",
      refresh_token: "b",
      token_type: "bearer",
    });
  });
});
