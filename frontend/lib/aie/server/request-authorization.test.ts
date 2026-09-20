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
  CandidateAsset,
} from "../contracts";

// Imported by relative path: the project has no Vitest alias for "@/".
import * as singleRoute from "../../../app/api/aie/resolve-asset/route";

import * as batchRoute from "../../../app/api/aie/resolve-assets/route";

import {
  createDenyAllAuthorizer,
  getAieRequestAuthorizer,
  requireAuthorization,
} from "./request-authorization";

import type {
  AieAuthorizationResult,
  AieRequestAuthorizer,
} from "./request-authorization";

import {
  handleResolveAssetRequest,
} from "./resolve-asset-http";

import {
  handleResolveAssetsRequest,
  MAX_BATCH_BODY_BYTES,
} from "./resolve-assets-http";

const resolveAsset = vi.hoisted(
  () => vi.fn(),
);

const resolveAssets = vi.hoisted(
  () => vi.fn(),
);

const getServerAie = vi.hoisted(
  () => vi.fn(),
);

vi.mock(
  "./resolve-asset",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("./resolve-asset")
      >();

    return {
      ...actual,

      resolveAsset: (
        ...args: unknown[]
      ) => resolveAsset(...args),
    };
  },
);

vi.mock(
  "./resolve-assets",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("./resolve-assets")
      >();

    return {
      ...actual,

      resolveAssets: (
        ...args: unknown[]
      ) => resolveAssets(...args),
    };
  },
);

vi.mock(
  "./create-server-aie",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("./create-server-aie")
      >();

    return {
      ...actual,

      getServerAie: (
        ...args: unknown[]
      ) => getServerAie(...args),
    };
  },
);

const SECRET =
  "sentinel-auth-secret-value";

const SUBJECT =
  "sentinel-principal-subject";

const SINGLE_URL =
  "http://localhost/api/aie/resolve-asset";

const BATCH_URL =
  "http://localhost/api/aie/resolve-assets";

const FRONTEND_ROOT = fileURLToPath(
  new URL(
    "../../..",
    import.meta.url,
  ),
);

interface ErrorBody {
  ok: boolean;

  error?: {
    code: string;

    message: string;
  };
}

function asset(): CandidateAsset {
  return {
    id: "asset-1",

    rawName: "DEB PETROBRAS",

    source: {},

    hints: {
      assetType: "debenture",

      instrumentCode: "ABCD11",
    },
  };
}

function post(
  url: string,
  body: unknown,
  headers: Record<
    string,
    string
  > = {
    "content-type":
      "application/json",
  },
): Request {
  return new Request(url, {
    method: "POST",

    headers,

    body:
      typeof body === "string"
        ? body
        : JSON.stringify(body),
  });
}

function allow(
  seen?: Request[],
): AieRequestAuthorizer {
  return {
    authorize: async (request) => {
      seen?.push(request);

      return {
        authorized: true,

        principal: {
          subject: SUBJECT,

          roles: ["analyst"],
        },
      };
    },
  };
}

function deny(
  reason: "unauthenticated" | "forbidden",
  extra: Record<
    string,
    unknown
  > = {},
): AieRequestAuthorizer {
  return {
    authorize: async () =>
      ({
        authorized: false,

        reason,

        ...extra,
      }) as AieAuthorizationResult,
  };
}

function code(
  path: string,
): string {
  return readFileSync(
    join(FRONTEND_ROOT, path),
    "utf8",
  )
    .replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    )
    .replace(/^\s*\/\/.*$/gm, "");
}

function imports(
  source: string,
): string[] {
  return [
    ...source.matchAll(
      /from\s*["']([^"']+)["']/g,
    ),
  ].map((match) =>
    match[1] as string,
  );
}

function listSources(
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
        ...listSources(path),
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

async function readError(
  response: Response,
): Promise<ErrorBody> {
  return (await response.json()) as ErrorBody;
}

const HANDLERS = [
  {
    name: "resolve-asset",

    url: SINGLE_URL,

    handle: handleResolveAssetRequest,

    route: singleRoute,

    valid: (): unknown => asset(),

    spy: resolveAsset,
  },
  {
    name: "resolve-assets",

    url: BATCH_URL,

    handle: handleResolveAssetsRequest,

    route: batchRoute,

    valid: (): unknown => ({
      assets: [asset()],
    }),

    spy: resolveAssets,
  },
] as const;

describe("AIE request authorization boundary", () => {
  let fetchSpy: ReturnType<
    typeof vi.fn
  >;

  beforeEach(() => {
    resolveAsset.mockReset();

    resolveAssets.mockReset();

    getServerAie.mockReset();

    resolveAsset.mockResolvedValue({
      status: "needs-more-evidence",
    });

    resolveAssets.mockResolvedValue({
      items: [],
    });

    fetchSpy = vi.fn(() => {
      throw new Error(
        "real network call attempted",
      );
    });

    vi.stubGlobal(
      "fetch",
      fetchSpy,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("default (production) authorizer", () => {
    it("denies an unauthenticated request", async () => {
      for (const authorizer of [
        getAieRequestAuthorizer(),
        createDenyAllAuthorizer(),
      ]) {
        expect(
          await authorizer.authorize(
            post(
              SINGLE_URL,
              asset(),
            ),
            {
              operation:
                "resolve-asset",
            },
          ),
        ).toEqual({
          authorized: false,

          reason: "unauthenticated",
        });
      }
    });

    it("denies even when the request looks trusted (headers, cookies, origin, ip)", async () => {
      const authorizer =
        getAieRequestAuthorizer();

      const result =
        await authorizer.authorize(
          post(
            "http://localhost:3000/api/aie/resolve-asset",
            asset(),
            {
              "content-type":
                "application/json",

              authorization:
                "Bearer anything",

              "x-api-key": "anything",

              cookie:
                "session=admin; role=admin",

              origin:
                "http://localhost:3000",

              referer:
                "http://localhost:3000/",

              "user-agent":
                "internal-service",

              "x-forwarded-for":
                "127.0.0.1",
            },
          ),
          {
            operation:
              "resolve-asset",
          },
        );

      expect(result).toEqual({
        authorized: false,

        reason: "unauthenticated",
      });
    });

    for (const target of HANDLERS) {
      it(`the actual ${target.name} route answers 401 by default`, async () => {
        const response =
          await target.route.POST(
            post(
              target.url,
              target.valid(),
            ),
          );

        expect(
          response.status,
        ).toBe(401);

        expect(
          await readError(response),
        ).toEqual({
          ok: false,

          error: {
            code: "AIE_UNAUTHENTICATED",

            message:
              "Authentication is required.",
          },
        });

        expect(
          target.spy,
        ).not.toHaveBeenCalled();
      });
    }
  });

  describe("injected authorizer", () => {
    it("permits the resolve-asset flow", async () => {
      const response =
        await handleResolveAssetRequest(
          post(SINGLE_URL, asset()),
          {
            authorizer: allow(),
          },
        );

      expect(
        response.status,
      ).toBe(200);

      expect(
        resolveAsset,
      ).toHaveBeenCalledTimes(1);
    });

    it("permits the resolve-assets flow", async () => {
      const response =
        await handleResolveAssetsRequest(
          post(BATCH_URL, {
            assets: [asset()],
          }),
          {
            authorizer: allow(),
          },
        );

      expect(
        response.status,
      ).toBe(200);

      expect(
        resolveAssets,
      ).toHaveBeenCalledTimes(1);
    });

    it("hands the authorizer a body-less copy, so it cannot consume the payload", async () => {
      const seen: Request[] = [];

      const authorizer: AieRequestAuthorizer =
        {
          authorize: async (
            request,
          ) => {
            seen.push(request);

            // Trying to read the payload yields nothing.
            expect(
              await request.text(),
            ).toBe("");

            return {
              authorized: true,

              principal: {
                subject: SUBJECT,
              },
            };
          },
        };

      const response =
        await handleResolveAssetRequest(
          post(
            SINGLE_URL,
            asset(),
            {
              "content-type":
                "application/json",

              "x-test": "kept",
            },
          ),
          { authorizer },
        );

      expect(
        response.status,
      ).toBe(200);

      expect(
        seen[0]?.headers.get(
          "x-test",
        ),
      ).toBe("kept");

      expect(
        seen[0]?.method,
      ).toBe("POST");

      // The real payload was still parsed afterwards.
      expect(
        resolveAsset,
      ).toHaveBeenCalledWith(
        asset(),
      );
    });
  });

  describe("denial happens before any work", () => {
    for (const target of HANDLERS) {
      it(`${target.name}: 401 before body validation (malformed JSON, bad content type)`, async () => {
        for (const request of [
          post(target.url, "{not json"),
          post(
            target.url,
            "not json either",
            {
              "content-type":
                "text/plain",
            },
          ),
          post(
            target.url,
            {},
            {},
          ),
        ]) {
          const response =
            await handleResolveAssetLike(
              target.handle,
              request,
              deny("unauthenticated"),
            );

          expect(
            response.status,
          ).toBe(401);
        }
      });

      it(`${target.name}: 401 before an oversized body is read`, async () => {
        const declared = post(
          target.url,
          {},
          {
            "content-type":
              "application/json",

            "content-length": String(
              MAX_BATCH_BODY_BYTES * 4,
            ),
          },
        );

        const streamed = post(
          target.url,
          "x".repeat(
            MAX_BATCH_BODY_BYTES + 1,
          ),
        );

        for (const request of [
          declared,
          streamed,
        ]) {
          const response =
            await handleResolveAssetLike(
              target.handle,
              request,
              deny("unauthenticated"),
            );

          expect(
            response.status,
          ).toBe(401);

          // Not 413/400: the body was never touched.
          expect(
            request.bodyUsed,
          ).toBe(false);
        }
      });

      it(`${target.name}: a denied request never reaches the use case, the server AIE or the network`, async () => {
        for (const authorizer of [
          deny("unauthenticated"),
          deny("forbidden"),
        ]) {
          await handleResolveAssetLike(
            target.handle,
            post(
              target.url,
              target.valid(),
            ),
            authorizer,
          );
        }

        expect(
          resolveAsset,
        ).not.toHaveBeenCalled();

        expect(
          resolveAssets,
        ).not.toHaveBeenCalled();

        expect(
          getServerAie,
        ).not.toHaveBeenCalled();

        expect(
          fetchSpy,
        ).not.toHaveBeenCalled();
      });

      it(`${target.name}: a failing or malformed authorizer fails closed`, async () => {
        const broken: AieRequestAuthorizer[] =
          [
            {
              authorize: async () => {
                throw new Error(
                  `boom ${SECRET}`,
                );
              },
            },
            {
              authorize: async () =>
                null as never,
            },
            {
              authorize: async () =>
                ({
                  authorized:
                    "yes",
                }) as never,
            },
            {
              authorize: async () =>
                ({
                  authorized: true,

                  principal: {
                    subject: "  ",
                  },
                }) as never,
            },
            {
              authorize: async () =>
                ({
                  authorized: false,

                  reason: "whatever",
                }) as never,
            },
          ];

        for (const authorizer of broken) {
          const response =
            await handleResolveAssetLike(
              target.handle,
              post(
                target.url,
                target.valid(),
              ),
              authorizer,
            );

          expect(
            response.status,
          ).toBe(500);

          const body =
            await readError(
              response,
            );

          expect(
            body.error?.code,
          ).toBe(
            "AIE_AUTHORIZATION_ERROR",
          );

          expect(
            JSON.stringify(body),
          ).not.toContain(SECRET);
        }

        expect(
          resolveAsset,
        ).not.toHaveBeenCalled();

        expect(
          resolveAssets,
        ).not.toHaveBeenCalled();
      });
    }
  });

  describe("401 / 403 semantics", () => {
    for (const target of HANDLERS) {
      it(`${target.name}: forbidden maps to 403`, async () => {
        const response =
          await handleResolveAssetLike(
            target.handle,
            post(
              target.url,
              target.valid(),
            ),
            deny("forbidden"),
          );

        expect(
          response.status,
        ).toBe(403);

        expect(
          await readError(response),
        ).toEqual({
          ok: false,

          error: {
            code: "AIE_FORBIDDEN",

            message:
              "You are not allowed to perform this operation.",
          },
        });
      });

      it(`${target.name}: 401 and 403 leak no reason detail, claims, secrets or principal`, async () => {
        const extra = {
          detail: SECRET,

          claims: {
            sub: SUBJECT,

            role: "admin",
          },

          principal: {
            subject: SUBJECT,
          },

          stack: `Error: ${SECRET}`,
        };

        for (const authorizer of [
          deny("unauthenticated", extra),
          deny("forbidden", extra),
        ]) {
          const response =
            await handleResolveAssetLike(
              target.handle,
              post(
                target.url,
                target.valid(),
              ),
              authorizer,
            );

          const text =
            await response.text();

          for (const leaked of [
            SECRET,
            SUBJECT,
            "claims",
            "stack",
            "detail",
            "admin",
          ]) {
            expect(
              text,
            ).not.toContain(leaked);
          }
        }
      });

      it(`${target.name}: every authorization response is Cache-Control: no-store JSON`, async () => {
        const responses =
          await Promise.all([
            handleResolveAssetLike(
              target.handle,
              post(
                target.url,
                target.valid(),
              ),
              deny("unauthenticated"),
            ),
            handleResolveAssetLike(
              target.handle,
              post(
                target.url,
                target.valid(),
              ),
              deny("forbidden"),
            ),
            handleResolveAssetLike(
              target.handle,
              post(
                target.url,
                target.valid(),
              ),
              {
                authorize: async () => {
                  throw new Error(
                    "boom",
                  );
                },
              },
            ),
          ]);

        expect(
          responses.map(
            (response) =>
              response.status,
          ),
        ).toEqual([401, 403, 500]);

        for (const response of responses) {
          expect(
            response.headers.get(
              "cache-control",
            ),
          ).toBe("no-store");

          expect(
            response.headers.get(
              "content-type",
            ),
          ).toContain(
            "application/json",
          );

          expect(
            response.headers.get(
              "access-control-allow-origin",
            ),
          ).toBeNull();
        }
      });
    }
  });

  describe("authorization cannot come from the request", () => {
    it("ignores identity fields in the payload and untrusted request metadata", async () => {
      const forged = {
        userId: "admin",

        role: "admin",

        isAdmin: true,

        apiKey: "anything",

        authToken: "anything",

        permission: "aie:resolve",
      };

      const headers = {
        "content-type":
          "application/json",

        authorization:
          "Bearer anything",

        "x-api-key": "anything",

        "x-user-id": "admin",

        cookie: "session=admin",

        origin:
          "http://localhost:3000",

        referer:
          "http://localhost:3000/",

        "user-agent":
          "internal-service",

        "x-forwarded-for":
          "127.0.0.1",
      };

      const bodies = [
        {
          url: SINGLE_URL,

          body: {
            ...asset(),

            ...forged,
          },

          route: singleRoute,
        },
        {
          url: BATCH_URL,

          body: {
            assets: [asset()],

            ...forged,

            options: {
              ...forged,
            },
          },

          route: batchRoute,
        },
      ];

      for (const item of bodies) {
        const response =
          await item.route.POST(
            post(
              item.url,
              item.body,
              headers,
            ),
          );

        expect(
          response.status,
        ).toBe(401);
      }

      expect(
        resolveAsset,
      ).not.toHaveBeenCalled();

      expect(
        resolveAssets,
      ).not.toHaveBeenCalled();
    });

    it("keeps forged identity fields rejected as unknown fields once authorized", async () => {
      const single =
        await handleResolveAssetRequest(
          post(SINGLE_URL, {
            ...asset(),

            role: "admin",
          }),
          {
            authorizer: allow(),
          },
        );

      const batch =
        await handleResolveAssetsRequest(
          post(BATCH_URL, {
            assets: [asset()],

            isAdmin: true,
          }),
          {
            authorizer: allow(),
          },
        );

      expect(
        single.status,
      ).toBe(400);

      expect(batch.status).toBe(
        400,
      );
    });
  });

  describe("principal privacy", () => {
    it("does not add the principal to what reaches the use cases", async () => {
      await handleResolveAssetRequest(
        post(SINGLE_URL, asset()),
        {
          authorizer: allow(),
        },
      );

      await handleResolveAssetsRequest(
        post(BATCH_URL, {
          assets: [asset()],

          options: {
            concurrency: 2,
          },
        }),
        {
          authorizer: allow(),
        },
      );

      expect(
        resolveAsset.mock.calls,
      ).toEqual([[asset()]]);

      expect(
        resolveAssets.mock.calls,
      ).toEqual([
        [
          [asset()],
          {
            concurrency: 2,
          },
        ],
      ]);

      expect(
        JSON.stringify([
          resolveAsset.mock.calls,
          resolveAssets.mock.calls,
        ]),
      ).not.toContain(SUBJECT);
    });

    it("does not serialize the principal into a successful response", async () => {
      const responses = [
        await handleResolveAssetRequest(
          post(SINGLE_URL, asset()),
          {
            authorizer: allow(),
          },
        ),
        await handleResolveAssetsRequest(
          post(BATCH_URL, {
            assets: [asset()],
          }),
          {
            authorizer: allow(),
          },
        ),
      ];

      for (const response of responses) {
        const text =
          await response.text();

        expect(text).not.toContain(
          SUBJECT,
        );

        expect(text).not.toContain(
          "analyst",
        );
      }
    });

    it("keeps the principal inside the authorization module (handlers never see it)", () => {
      for (const file of [
        "lib/aie/server/resolve-asset-http.ts",
        "lib/aie/server/resolve-assets-http.ts",
        "lib/aie/server/resolve-asset.ts",
        "lib/aie/server/resolve-assets.ts",
      ]) {
        expect(
          code(file).toLowerCase(),
        ).not.toContain(
          "principal",
        );
      }
    });

    it("requireAuthorization returns only a denial response or null", async () => {
      expect(
        await requireAuthorization(
          post(SINGLE_URL, asset()),
          allow(),
          "resolve-asset",
        ),
      ).toBeNull();

      const denied =
        await requireAuthorization(
          post(SINGLE_URL, asset()),
          deny("forbidden"),
          "resolve-asset",
        );

      expect(denied?.status).toBe(
        403,
      );
    });
  });

  describe("module boundaries", () => {
    it("both route files stay tiny and import only their HTTP mapping", () => {
      expect(
        imports(
          code(
            "app/api/aie/resolve-asset/route.ts",
          ),
        ),
      ).toEqual([
        "../../../../lib/aie/server/resolve-asset-http",
      ]);

      expect(
        imports(
          code(
            "app/api/aie/resolve-assets/route.ts",
          ),
        ),
      ).toEqual([
        "../../../../lib/aie/server/resolve-assets-http",
      ]);
    });

    it("route files have no provider-specific code and read no environment", () => {
      for (const file of [
        "app/api/aie/resolve-asset/route.ts",
        "app/api/aie/resolve-assets/route.ts",
      ]) {
        const source = code(file);

        for (const forbidden of [
          "process.env",
          "AnbimaHttpClient",
          "AnbimaDebentureProvider",
          "createAieFromEnv",
          "VerificationPolicy",
          "ProviderExecutionPipeline",
          "ANBIMA",
        ]) {
          expect(
            source,
          ).not.toContain(forbidden);
        }
      }
    });

    it("the authorization module reads no environment, logs nothing and imports only the HTTP helpers and the authorizer composition", () => {
      const source = code(
        "lib/aie/server/request-authorization.ts",
      );

      expect(source).not.toContain(
        "process.env",
      );

      expect(source).not.toMatch(
        /console\./,
      );

      expect(
        imports(source),
      ).toEqual([
        "./aie-http",
        "./create-server-authorizer",
        "./deny-all-authorizer",
      ]);
    });

    it("the authorization module is not exported from the browser-safe barrel", () => {
      const barrel = code(
        "lib/aie/index.ts",
      );

      expect(
        barrel,
      ).not.toContain(
        "request-authorization",
      );

      expect(barrel).not.toContain(
        "server",
      );
    });

    it("introduces no NEXT_PUBLIC authentication configuration", () => {
      const files = [
        ...["app", "components", "lib"].flatMap(
          (directory) =>
            listSources(
              join(
                FRONTEND_ROOT,
                directory,
              ),
            ),
        ),
        join(
          FRONTEND_ROOT,
          ".env.example",
        ),
      ].filter(existsSync);

      const offenders = files.filter(
        (file) =>
          /NEXT_PUBLIC_\w*(AUTH|API_?KEY|JWT|TOKEN|SECRET|SESSION|PASSWORD)/i.test(
            readFileSync(
              file,
              "utf8",
            ),
          ),
      );

      expect(offenders).toEqual([]);
    });

    it("adds no identity field to the AIE domain contracts", () => {
      const contracts = listSources(
        join(
          FRONTEND_ROOT,
          "lib/aie/contracts",
        ),
      )
        .map((file) =>
          readFileSync(
            file,
            "utf8",
          ).toLowerCase(),
        )
        .join("\n");

      for (const forbidden of [
        "userid",
        "isadmin",
        "apikey",
        "authtoken",
        "principal",
      ]) {
        expect(
          contracts,
        ).not.toContain(forbidden);
      }
    });
  });
});

/** Both handlers share the same (request, { authorizer }) call shape. */
function handleResolveAssetLike(
  handle: (
    request: Request,
    options?: {
      authorizer?: AieRequestAuthorizer;
    },
  ) => Promise<Response>,
  request: Request,
  authorizer: AieRequestAuthorizer,
): Promise<Response> {
  return handle(request, {
    authorizer,
  });
}
