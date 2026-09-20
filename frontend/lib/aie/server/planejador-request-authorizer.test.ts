import {
  describe,
  expect,
  it,
} from "vitest";

import {
  AIE_ALLOWED_ROLES,
  MAX_BEARER_TOKEN_LENGTH,
  MAX_INTROSPECTION_BODY_BYTES,
  parsePlanejadorBaseUrl,
  PLANEJADOR_IDENTITY_PATH,
  PLANEJADOR_TIMEOUT_MS,
  PlanejadorAuthorizationError,
  PlanejadorRequestAuthorizer,
} from "./planejador-request-authorizer";

import type {
  PlanejadorFetch,
} from "./planejador-request-authorizer";

import type {
  AieAuthorizationResult,
  AieOperation,
} from "./request-authorization";

/**
 * Offline tests of the Planejador-backed authorizer (TASK-020). The identity
 * service is a fake fetch: no real network is possible.
 */

const BASE_URL =
  "https://planejador.example.test";

const USER_ID =
  "3f2b1c9e-8a4d-4e6f-9b0a-1c2d3e4f5a6b";

// Obviously fake, non-secret token used to prove it never leaks.
const TOKEN =
  "sentinel-bearer-token.abc-123_XYZ";

interface Call {
  url: string;

  init: Parameters<PlanejadorFetch>[1];
}

function identity(
  overrides: Record<
    string,
    unknown
  > = {},
): Record<string, unknown> {
  return {
    id: USER_ID,

    role: "cliente",

    is_active: true,

    ...overrides,
  };
}

function json(
  body: unknown,
  status = 200,
): Response {
  return new Response(
    typeof body === "string"
      ? body
      : JSON.stringify(body),
    {
      status,

      headers: {
        "content-type":
          "application/json",
      },
    },
  );
}

function setup(
  responder: (
    call: Call,
  ) => Response | Promise<Response>,
  options: {
    baseUrl?: string;

    timeoutMs?: number;
  } = {},
) {
  const calls: Call[] = [];

  const fetchFake: PlanejadorFetch =
    async (url, init) => {
      const call = {
        url,
        init,
      };

      calls.push(call);

      return responder(call);
    };

  const authorizer =
    new PlanejadorRequestAuthorizer({
      baseUrl:
        options.baseUrl ?? BASE_URL,

      fetch: fetchFake,

      ...(options.timeoutMs
        ? {
            timeoutMs:
              options.timeoutMs,
          }
        : {}),
    });

  return {
    authorizer,

    calls,
  };
}

function request(
  headers: Record<string, string> = {
    authorization: `Bearer ${TOKEN}`,
  },
  url = "http://aligna.local/api/aie/resolve-asset",
): Request {
  return new Request(url, {
    method: "POST",

    headers,
  });
}

const SINGLE = {
  operation: "resolve-asset",
} as const;

const BATCH = {
  operation: "resolve-assets",
} as const;

async function thrown(
  promise: Promise<unknown>,
): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return undefined;
}

describe("PlanejadorRequestAuthorizer", () => {
  describe("policy constants", () => {
    it("accepts exactly the three approved roles and a short default timeout", () => {
      expect(
        [...AIE_ALLOWED_ROLES].sort(),
      ).toEqual([
        "administrador",
        "assessor",
        "cliente",
      ]);

      expect(
        PLANEJADOR_TIMEOUT_MS,
      ).toBe(3000);

      expect(
        PLANEJADOR_IDENTITY_PATH,
      ).toBe("/api/v1/auth/me");
    });
  });

  describe("Authorization header parsing (no call to the identity service)", () => {
    const tab = String.fromCharCode(9);

    const invalid: Array<
      [string, Record<string, string>]
    > = [
      ["missing", {}],
      [
        "wrong scheme",
        {
          authorization:
            "Basic abc123",
        },
      ],
      [
        "scheme only",
        {
          authorization: "Bearer",
        },
      ],
      [
        "scheme and empty token",
        {
          authorization: "Bearer ",
        },
      ],
      [
        "two tokens",
        {
          authorization:
            "Bearer aaa bbb",
        },
      ],
      [
        "comma separated values",
        {
          authorization:
            "Bearer aaa, Bearer bbb",
        },
      ],
      [
        "tab inside the token",
        {
          authorization: `Bearer aa${tab}bb`,
        },
      ],
      [
        "forbidden characters",
        {
          authorization:
            "Bearer abc!def",
        },
      ],
      [
        "no space after the scheme",
        {
          authorization:
            "Bearerabc",
        },
      ],
      [
        "oversized token",
        {
          authorization: `Bearer ${"a".repeat(
            MAX_BEARER_TOKEN_LENGTH +
              1,
          )}`,
        },
      ],
    ];

    for (const [name, headers] of invalid) {
      it(`${name}: unauthenticated and nothing is requested`, async () => {
        const { authorizer, calls } =
          setup(() =>
            json(identity()),
          );

        expect(
          await authorizer.authorize(
            request(headers),
            SINGLE,
          ),
        ).toEqual({
          authorized: false,

          reason: "unauthenticated",
        });

        expect(calls).toHaveLength(0);
      });
    }

    it("rejects two Authorization header values (duplicate header)", async () => {
      const { authorizer, calls } =
        setup(() =>
          json(identity()),
        );

      const headers = new Headers();

      headers.append(
        "authorization",
        "Bearer aaa",
      );

      headers.append(
        "authorization",
        "Bearer bbb",
      );

      const result =
        await authorizer.authorize(
          new Request(
            "http://aligna.local/x",
            {
              method: "POST",

              headers,
            },
          ),
          SINGLE,
        );

      expect(result).toEqual({
        authorized: false,

        reason: "unauthenticated",
      });

      expect(calls).toHaveLength(0);
    });

    it("accepts a case-insensitive scheme and a token at the maximum length", async () => {
      const { authorizer, calls } =
        setup(() =>
          json(identity()),
        );

      for (const header of [
        `bearer ${TOKEN}`,
        `BEARER ${TOKEN}`,
        `Bearer ${"a".repeat(
          MAX_BEARER_TOKEN_LENGTH,
        )}`,
      ]) {
        const result =
          await authorizer.authorize(
            request({
              authorization: header,
            }),
            SINGLE,
          );

        expect(
          result.authorized,
        ).toBe(true);
      }

      expect(calls).toHaveLength(3);
    });
  });

  describe("authorized (single asset)", () => {
    for (const role of [
      "cliente",
      "assessor",
      "administrador",
    ]) {
      it(`${role}: authorized with the principal built from id and role`, async () => {
        const { authorizer } =
          setup(() =>
            json(identity({ role })),
          );

        expect(
          await authorizer.authorize(
            request(),
            SINGLE,
          ),
        ).toEqual({
          authorized: true,

          principal: {
            subject: USER_ID,

            roles: [role],
          },
        });
      });
    }

    it("never copies unknown fields of the answer into the principal", async () => {
      const { authorizer } = setup(
        () =>
          json(
            identity({
              email: "someone@example.test",

              password_hash: "hash-value",

              full_name: "Someone",

              entitlements: {
                aie_batch: true,
              },
            }),
          ),
      );

      const result =
        await authorizer.authorize(
          request(),
          SINGLE,
        );

      expect(result).toEqual({
        authorized: true,

        principal: {
          subject: USER_ID,

          roles: ["cliente"],
        },
      });

      const text =
        JSON.stringify(result);

      for (const leaked of [
        "someone",
        "hash-value",
        "entitlements",
        "aie_batch",
      ]) {
        expect(text).not.toContain(
          leaked,
        );
      }
    });
  });

  describe("denials", () => {
    it("an inactive user is unauthenticated for both operations", async () => {
      const { authorizer } =
        setup(() =>
          json(
            identity({
              is_active: false,
            }),
          ),
        );

      for (const context of [
        SINGLE,
        BATCH,
      ]) {
        expect(
          await authorizer.authorize(
            request(),
            context,
          ),
        ).toEqual({
          authorized: false,

          reason: "unauthenticated",
        });
      }
    });

    it("an unknown role is forbidden", async () => {
      for (const role of [
        "superuser",
        "ADMINISTRADOR",
        "root",
        "cliente ",
      ]) {
        const { authorizer } =
          setup(() =>
            json(identity({ role })),
          );

        expect(
          await authorizer.authorize(
            request(),
            SINGLE,
          ),
        ).toEqual({
          authorized: false,

          reason: "forbidden",
        });
      }
    });

    it("batch is forbidden for every allowed role when the answer carries no entitlements (legacy Planejador)", async () => {
      for (const role of [
        "cliente",
        "assessor",
        "administrador",
      ]) {
        const { authorizer } =
          setup(() =>
            json(identity({ role })),
          );

        expect(
          await authorizer.authorize(
            request(),
            BATCH,
          ),
        ).toEqual({
          authorized: false,

          reason: "forbidden",
        });
      }
    });

    it("batch is authorized when entitlements.aie_batch is exactly true (see the batch entitlement tests)", async () => {
      const { authorizer } = setup(
        () =>
          json(
            identity({
              entitlements: {
                aie_batch: true,
              },
            }),
          ),
      );

      expect(
        (
          await authorizer.authorize(
            request(),
            BATCH,
          )
        ).authorized,
      ).toBe(true);
    });

    it("an unauthenticated caller is not told 'forbidden' on batch: 401 from the identity service stays unauthenticated", async () => {
      const { authorizer } = setup(
        () => json({}, 401),
      );

      expect(
        await authorizer.authorize(
          request(),
          BATCH,
        ),
      ).toEqual({
        authorized: false,

        reason: "unauthenticated",
      });
    });

    it("maps 401 to unauthenticated and 403 to forbidden", async () => {
      const unauthenticated = setup(
        () =>
          json(
            {
              detail: "invalid",
            },
            401,
          ),
      );

      const forbidden = setup(() =>
        json(
          {
            detail: "no",
          },
          403,
        ),
      );

      expect(
        await unauthenticated.authorizer.authorize(
          request(),
          SINGLE,
        ),
      ).toEqual({
        authorized: false,

        reason: "unauthenticated",
      });

      expect(
        await forbidden.authorizer.authorize(
          request(),
          SINGLE,
        ),
      ).toEqual({
        authorized: false,

        reason: "forbidden",
      });
    });
  });

  describe("fail closed: any identity service failure throws", () => {
    const failures: Array<
      [string, () => Response]
    > = [
      ["HTTP 500", () => json({}, 500)],
      ["HTTP 502", () => json({}, 502)],
      ["HTTP 503", () => json({}, 503)],
      ["HTTP 429", () => json({}, 429)],
      ["HTTP 400", () => json({}, 400)],
      ["HTTP 404", () => json({}, 404)],
      [
        "HTTP 204",
        () =>
          new Response(null, {
            status: 204,
          }),
      ],
      [
        "redirect 302",
        () =>
          new Response(null, {
            status: 302,

            headers: {
              location:
                "https://evil.example.test/",
            },
          }),
      ],
      [
        "redirect 301",
        () =>
          new Response(null, {
            status: 301,

            headers: {
              location:
                "https://evil.example.test/",
            },
          }),
      ],
      [
        "malformed JSON",
        () => json("{not json", 200),
      ],
      [
        "empty body",
        () => json("", 200),
      ],
      ["array body", () => json([], 200)],
      ["null body", () => json("null", 200)],
      [
        "string body",
        () => json('"text"', 200),
      ],
      [
        "missing id",
        () =>
          json({
            role: "cliente",

            is_active: true,
          }),
      ],
      [
        "missing role",
        () =>
          json({
            id: USER_ID,

            is_active: true,
          }),
      ],
      [
        "missing is_active",
        () =>
          json({
            id: USER_ID,

            role: "cliente",
          }),
      ],
      [
        "id that is not a UUID",
        () =>
          json(
            identity({
              id: "not-a-uuid",
            }),
          ),
      ],
      [
        "numeric id",
        () =>
          json(identity({ id: 42 })),
      ],
      [
        "role that is not a string",
        () =>
          json(identity({ role: 7 })),
      ],
      [
        "empty role",
        () =>
          json(identity({ role: "" })),
      ],
      [
        "is_active as a string",
        () =>
          json(
            identity({
              is_active: "true",
            }),
          ),
      ],
      [
        "declared oversized body",
        () =>
          new Response(
            JSON.stringify(identity()),
            {
              status: 200,

              headers: {
                "content-length": String(
                  MAX_INTROSPECTION_BODY_BYTES +
                    1,
                ),
              },
            },
          ),
      ],
      [
        "streamed oversized body",
        () =>
          json(
            identity({
              padding: "x".repeat(
                MAX_INTROSPECTION_BODY_BYTES,
              ),
            }),
          ),
      ],
    ];

    for (const [name, respond] of failures) {
      it(`${name} throws a safe error`, async () => {
        const { authorizer } =
          setup(respond);

        const error = await thrown(
          authorizer.authorize(
            request(),
            SINGLE,
          ),
        );

        expect(error).toBeInstanceOf(
          PlanejadorAuthorizationError,
        );

        const text = `${
          (error as Error).message
        } ${(error as Error).stack ?? ""}`;

        expect(text).not.toContain(
          TOKEN,
        );

        expect(text).not.toContain(
          BASE_URL,
        );

        expect(
          (error as { cause?: unknown })
            .cause,
        ).toBeUndefined();
      });
    }

    it("a network error throws a safe error without leaking the token", async () => {
      const { authorizer } = setup(
        () => {
          throw new Error(
            `connect ECONNREFUSED Bearer ${TOKEN}`,
          );
        },
      );

      const error = await thrown(
        authorizer.authorize(
          request(),
          SINGLE,
        ),
      );

      expect(error).toBeInstanceOf(
        PlanejadorAuthorizationError,
      );

      expect(
        (error as Error).message,
      ).not.toContain(TOKEN);

      expect(
        (error as { cause?: unknown })
          .cause,
      ).toBeUndefined();
    });

    it("times out and throws when the identity service hangs", async () => {
      const { authorizer, calls } =
        setup(
          ({ init }) =>
            new Promise<Response>(
              (_resolve, reject) => {
                init.signal.addEventListener(
                  "abort",
                  () =>
                    reject(
                      new Error(
                        "aborted",
                      ),
                    ),
                );
              },
            ),
          {
            timeoutMs: 30,
          },
        );

      const error = await thrown(
        authorizer.authorize(
          request(),
          SINGLE,
        ),
      );

      expect(error).toBeInstanceOf(
        PlanejadorAuthorizationError,
      );

      expect(calls).toHaveLength(1);
    });

    it("throws for a failure on the batch operation too", async () => {
      const { authorizer } = setup(
        () => json({}, 503),
      );

      expect(
        await thrown(
          authorizer.authorize(
            request(),
            BATCH,
          ),
        ),
      ).toBeInstanceOf(
        PlanejadorAuthorizationError,
      );
    });
  });

  describe("the outbound request", () => {
    it("is a single GET to the fixed URL with only the bearer forwarded", async () => {
      const { authorizer, calls } =
        setup(() => json(identity()));

      await authorizer.authorize(
        request({
          authorization: `Bearer ${TOKEN}`,

          cookie: "session=other",

          origin:
            "https://evil.example.test",

          "x-forwarded-host":
            "evil.example.test",

          "x-api-key": "other",

          "content-type":
            "application/json",
        }),
        SINGLE,
      );

      expect(calls).toHaveLength(1);

      const [call] = calls as [Call];

      expect(call.url).toBe(
        "https://planejador.example.test/api/v1/auth/me",
      );

      expect(call.init.method).toBe(
        "GET",
      );

      expect(
        call.init.headers,
      ).toEqual({
        Authorization: `Bearer ${TOKEN}`,

        Accept: "application/json",
      });

      expect(call.init.redirect).toBe(
        "manual",
      );

      expect(call.init.cache).toBe(
        "no-store",
      );

      expect(
        call.init.signal,
      ).toBeInstanceOf(AbortSignal);

      expect(
        "body" in call.init,
      ).toBe(false);
    });

    it("cannot be redirected by the incoming request (URL, host, query)", async () => {
      const { authorizer, calls } =
        setup(() => json(identity()));

      await authorizer.authorize(
        request(
          {
            authorization: `Bearer ${TOKEN}`,
          },
          "https://evil.example.test/api/v1/auth/me?url=https://evil.example.test&base=x",
        ),
        SINGLE,
      );

      expect(calls[0]?.url).toBe(
        "https://planejador.example.test/api/v1/auth/me",
      );
    });

    it("supports a base URL with a path prefix and a trailing slash", async () => {
      const { authorizer, calls } =
        setup(() => json(identity()), {
          baseUrl:
            "https://gateway.example.test/planejador/",
        });

      await authorizer.authorize(
        request(),
        SINGLE,
      );

      expect(calls[0]?.url).toBe(
        "https://gateway.example.test/planejador/api/v1/auth/me",
      );
    });

    it("does not cache: every request asks the identity service again", async () => {
      let active = true;

      const { authorizer, calls } =
        setup(() =>
          json(
            identity({
              is_active: active,
            }),
          ),
        );

      expect(
        (
          await authorizer.authorize(
            request(),
            SINGLE,
          )
        ).authorized,
      ).toBe(true);

      // The user is deactivated between two requests with the same token.
      active = false;

      expect(
        await authorizer.authorize(
          request(),
          SINGLE,
        ),
      ).toEqual({
        authorized: false,

        reason: "unauthenticated",
      });

      expect(calls).toHaveLength(2);
    });

    it("does not share answers between different tokens", async () => {
      const { authorizer, calls } =
        setup(({ init }) =>
          json(
            identity({
              id:
                init.headers
                  .Authorization ===
                "Bearer first"
                  ? USER_ID
                  : "11111111-2222-4333-8444-555555555555",
            }),
          ),
        );

      const first =
        await authorizer.authorize(
          request({
            authorization:
              "Bearer first",
          }),
          SINGLE,
        );

      const second =
        await authorizer.authorize(
          request({
            authorization:
              "Bearer second",
          }),
          SINGLE,
        );

      const subjects = [
        first,
        second,
      ].map((result) =>
        result.authorized
          ? result.principal.subject
          : null,
      );

      expect(subjects).toEqual([
        USER_ID,
        "11111111-2222-4333-8444-555555555555",
      ]);

      expect(calls).toHaveLength(2);
    });
  });

  describe("token safety", () => {
    it("the bearer never appears in any authorization result", async () => {
      const scenarios: Array<
        [
          Response,
          AieOperation,
        ]
      > = [
        [json(identity()), "resolve-asset"],
        [json(identity()), "resolve-assets"],
        [
          json(
            identity({
              is_active: false,
            }),
          ),
          "resolve-asset",
        ],
        [
          json(
            identity({
              role: "other",
            }),
          ),
          "resolve-asset",
        ],
        [json({}, 401), "resolve-asset"],
        [json({}, 403), "resolve-asset"],
      ];

      for (const [
        response,
        operation,
      ] of scenarios) {
        const { authorizer } = setup(
          () => response.clone(),
        );

        const result: AieAuthorizationResult =
          await authorizer.authorize(
            request(),
            { operation },
          );

        expect(
          JSON.stringify(result),
        ).not.toContain(TOKEN);
      }
    });
  });

  describe("configuration", () => {
    it("rejects an invalid base URL or timeout", () => {
      for (const baseUrl of [
        "",
        "not a url",
        "http://example.com",
        "https://user:pw@a.test",
      ]) {
        expect(
          () =>
            new PlanejadorRequestAuthorizer(
              { baseUrl },
            ),
        ).toThrow(RangeError);
      }

      for (const timeoutMs of [
        0,
        -1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
      ]) {
        expect(
          () =>
            new PlanejadorRequestAuthorizer(
              {
                baseUrl: BASE_URL,

                timeoutMs,
              },
            ),
        ).toThrow(RangeError);
      }
    });

    it("parsePlanejadorBaseUrl accepts https and loopback http and normalizes the trailing slash", () => {
      const valid: Array<
        [string, string]
      > = [
        [
          "https://a.test",
          "https://a.test",
        ],
        [
          "https://a.test/",
          "https://a.test",
        ],
        [
          "  https://a.test/planejador/  ",
          "https://a.test/planejador",
        ],
        [
          "http://localhost:8000",
          "http://localhost:8000",
        ],
        [
          "http://127.0.0.1:8000/",
          "http://127.0.0.1:8000",
        ],
        [
          "http://[::1]:8000",
          "http://[::1]:8000",
        ],
      ];

      for (const [input, expected] of valid) {
        expect(
          parsePlanejadorBaseUrl(
            input,
          ),
        ).toBe(expected);
      }
    });

    it("parsePlanejadorBaseUrl rejects everything else", () => {
      for (const input of [
        "",
        "   ",
        "not a url",
        "//a.test",
        "ftp://a.test",
        "http://example.com",
        "http://10.0.0.5:8000",
        "https://user:pw@a.test",
        "https://user@a.test",
        "https://a.test?x=1",
        "https://a.test/?",
        "https://a.test#frag",
        "https://a.test/#",
      ]) {
        expect(
          parsePlanejadorBaseUrl(
            input,
          ),
        ).toBeNull();
      }
    });
  });
});


/**
 * TASK-021: batch requires `entitlements.aie_batch === true`, decided by the
 * Planejador. The Aligna reads only that boolean.
 */
describe("PlanejadorRequestAuthorizer batch entitlement", () => {
  const ROLES = [
    "cliente",
    "assessor",
    "administrador",
  ];

  function withEntitlements(
    entitlements: unknown,
    role = "cliente",
  ): Response {
    return json(
      identity({
        role,

        entitlements,
      }),
    );
  }

  const FORBIDDEN: AieAuthorizationResult =
    {
      authorized: false,

      reason: "forbidden",
    };

  describe("single asset ignores the entitlement", () => {
    it("legacy answer without entitlements: authorized", async () => {
      const { authorizer } = setup(
        () => json(identity()),
      );

      expect(
        (
          await authorizer.authorize(
            request(),
            SINGLE,
          )
        ).authorized,
      ).toBe(true);
    });

    it("aie_batch false, missing, or an empty container: still authorized", async () => {
      for (const entitlements of [
        { aie_batch: false },
        {},
      ]) {
        const { authorizer } = setup(
          () =>
            withEntitlements(
              entitlements,
            ),
        );

        expect(
          (
            await authorizer.authorize(
              request(),
              SINGLE,
            )
          ).authorized,
        ).toBe(true);
      }
    });
  });

  describe("batch", () => {
    for (const role of ROLES) {
      it(`${role} with aie_batch true: authorized, principal without any entitlement`, async () => {
        const { authorizer } = setup(
          () =>
            withEntitlements(
              { aie_batch: true },
              role,
            ),
        );

        const result =
          await authorizer.authorize(
            request(),
            BATCH,
          );

        expect(result).toEqual({
          authorized: true,

          principal: {
            subject: USER_ID,

            roles: [role],
          },
        });

        const text =
          JSON.stringify(result);

        for (const leaked of [
          "aie_batch",
          "entitlement",
          "premium",
        ]) {
          expect(text).not.toContain(
            leaked,
          );
        }
      });

      it(`${role} with aie_batch false: forbidden`, async () => {
        const { authorizer } = setup(
          () =>
            withEntitlements(
              { aie_batch: false },
              role,
            ),
        );

        expect(
          await authorizer.authorize(
            request(),
            BATCH,
          ),
        ).toEqual(FORBIDDEN);
      });
    }

    it("legacy answer without entitlements: forbidden (not a server error)", async () => {
      const { authorizer } = setup(
        () => json(identity()),
      );

      expect(
        await authorizer.authorize(
          request(),
          BATCH,
        ),
      ).toEqual(FORBIDDEN);
    });

    it("entitlements {} or aie_batch missing: forbidden", async () => {
      for (const entitlements of [
        {},
        { other_flag: true },
      ]) {
        const { authorizer } = setup(
          () =>
            withEntitlements(
              entitlements,
            ),
        );

        expect(
          await authorizer.authorize(
            request(),
            BATCH,
          ),
        ).toEqual(FORBIDDEN);
      }
    });

    it("an inactive or unknown-role user is denied before the entitlement matters", async () => {
      const inactive = setup(() =>
        json(
          identity({
            is_active: false,

            entitlements: {
              aie_batch: true,
            },
          }),
        ),
      );

      const unknownRole = setup(() =>
        json(
          identity({
            role: "superuser",

            entitlements: {
              aie_batch: true,
            },
          }),
        ),
      );

      expect(
        await inactive.authorizer.authorize(
          request(),
          BATCH,
        ),
      ).toEqual({
        authorized: false,

        reason: "unauthenticated",
      });

      expect(
        await unknownRole.authorizer.authorize(
          request(),
          BATCH,
        ),
      ).toEqual(FORBIDDEN);
    });

    it("an operation that is not one of the two literals is denied", async () => {
      const { authorizer } = setup(
        () =>
          withEntitlements({
            aie_batch: true,
          }),
      );

      expect(
        await authorizer.authorize(
          request(),
          {
            operation:
              "something-else" as never,
          },
        ),
      ).toEqual(FORBIDDEN);
    });

    it("does not cache the entitlement: it is read on every request", async () => {
      let entitled = true;

      const { authorizer, calls } =
        setup(() =>
          withEntitlements({
            aie_batch: entitled,
          }),
        );

      expect(
        (
          await authorizer.authorize(
            request(),
            BATCH,
          )
        ).authorized,
      ).toBe(true);

      entitled = false;

      expect(
        await authorizer.authorize(
          request(),
          BATCH,
        ),
      ).toEqual(FORBIDDEN);

      expect(calls).toHaveLength(2);
    });
  });

  describe("malformed entitlement data fails closed (throws)", () => {
    const badValues: Array<
      [string, unknown]
    > = [
      ["string", "true"],
      ["number 1", 1],
      ["number 0", 0],
      ["null", null],
      ["empty object", {}],
      ["empty array", []],
      ["array with a boolean", [true]],
    ];

    for (const [name, value] of badValues) {
      for (const context of [
        SINGLE,
        BATCH,
      ]) {
        it(`aie_batch as ${name} on ${context.operation}`, async () => {
          const { authorizer } =
            setup(() =>
              withEntitlements({
                aie_batch: value,
              }),
            );

          const error = await thrown(
            authorizer.authorize(
              request(),
              context,
            ),
          );

          expect(
            error,
          ).toBeInstanceOf(
            PlanejadorAuthorizationError,
          );

          const text = `${
            (error as Error).message
          } ${(error as Error).stack ?? ""}`;

          expect(text).not.toContain(
            "true",
          );

          expect(text).not.toContain(
            TOKEN,
          );
        });
      }
    }

    const badContainers: Array<
      [string, unknown]
    > = [
      ["null", null],
      ["array", []],
      ["string", "premium"],
      ["number", 1],
      ["boolean", true],
    ];

    for (const [
      name,
      value,
    ] of badContainers) {
      it(`entitlements as ${name} is an infrastructure error (not forbidden)`, async () => {
        const { authorizer } = setup(
          () => withEntitlements(value),
        );

        for (const context of [
          SINGLE,
          BATCH,
        ]) {
          expect(
            await thrown(
              authorizer.authorize(
                request(),
                context,
              ),
            ),
          ).toBeInstanceOf(
            PlanejadorAuthorizationError,
          );
        }
      });
    }
  });

  describe("no billing logic in the Aligna", () => {
    it("the authorizer source never mentions billing, plans, prices or subscription status", async () => {
      const { readFileSync } =
        await import("node:fs");

      const { fileURLToPath } =
        await import("node:url");

      const source = readFileSync(
        fileURLToPath(
          new URL(
            "./planejador-request-authorizer.ts",
            import.meta.url,
          ),
        ),
        "utf8",
      )
        .replace(
          /\/\*[\s\S]*?\*\//g,
          "",
        )
        .replace(/^\s*\/\/.*$/gm, "");

      expect(source).not.toMatch(
        /stripe|subscription|past_due|\bplan\b|\bprice\b|billing|premium/i,
      );

      // The only entitlement it reads.
      expect(
        source.match(/aie_batch/g),
      ).toHaveLength(2);
    });
  });
});

describe("batch entitlement stays inside the authorizer (static)", () => {
  it("aie_batch and entitlements are referenced by no other production source", async () => {
    const fs = await import("node:fs");

    const path = await import("node:path");

    const { fileURLToPath } =
      await import("node:url");

    const root = fileURLToPath(
      new URL(
        "../../..",
        import.meta.url,
      ),
    );

    const collect = (
      directory: string,
    ): string[] =>
      fs
        .readdirSync(directory)
        .flatMap((entry) => {
          if (
            entry === "node_modules" ||
            entry === ".next"
          ) {
            return [];
          }

          const full = path.join(
            directory,
            entry,
          );

          if (
            fs
              .statSync(full)
              .isDirectory()
          ) {
            return collect(full);
          }

          return /\.(ts|tsx)$/.test(
            full,
          ) &&
            !/\.test\.(ts|tsx)$/.test(
              full,
            )
            ? [full]
            : [];
        });

    const offenders = ["app", "components", "lib"]
      .flatMap((directory) =>
        collect(
          path.join(root, directory),
        ),
      )
      .filter((file) =>
        /aie_batch|entitlement/i.test(
          fs.readFileSync(
            file,
            "utf8",
          ),
        ),
      )
      .map((file) =>
        path
          .relative(root, file)
          .replace(/\\/g, "/"),
      );

    // Mentions in comments are fine; nothing else may even name it. Only the
    // authorizer reads it (the request-authorization module documents the
    // principal without it).
    expect(
      offenders.filter(
        (file) =>
          file !==
          "lib/aie/server/planejador-request-authorizer.ts",
      ),
    ).toEqual([]);
  });

  it("AieRequestPrincipal is still just subject and roles", async () => {
    const { readFileSync } =
      await import("node:fs");

    const { fileURLToPath } =
      await import("node:url");

    const source = readFileSync(
      fileURLToPath(
        new URL(
          "./request-authorization.ts",
          import.meta.url,
        ),
      ),
      "utf8",
    );

    const block =
      /export interface AieRequestPrincipal \{([\s\S]*?)\n\}/.exec(
        source,
      );

    expect(block).not.toBeNull();

    const fields = (
      (block as RegExpExecArray)[1] as string
    )
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    expect(fields).toEqual([
      "subject: string;",
      "roles?: string[];",
    ]);
  });
});