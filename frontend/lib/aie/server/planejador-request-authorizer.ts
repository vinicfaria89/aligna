import type {
  AieAuthorizationContext,
  AieAuthorizationResult,
  AieRequestAuthorizer,
} from "./request-authorization";

/**
 * SERVER-ONLY authorizer backed by the Planejador identity system (TASK-020).
 *
 *   Bearer token -> GET <planejador>/api/v1/auth/me -> { id, role, is_active }
 *     -> approved policy (TASK-019) -> authorized | unauthenticated | forbidden
 *
 * The Planejador validates the JWT (signature, expiry, access type, active
 * user); the Aligna never sees the signing secret and never verifies a token
 * locally. Nothing is cached: every request asks again, so a deactivated user
 * or a changed role takes effect immediately.
 *
 * Policy implemented here (docs/tasks/TASK-019-aie-access-policy.md):
 * - authentication is mandatory;
 * - cliente, assessor and administrador may use the SINGLE-asset operation;
 *   any other role value is forbidden;
 * - the BATCH operation is forbidden for every authenticated caller until the
 *   Premium entitlement (aie_batch) is enforced (TASK-021);
 * - any Planejador failure (timeout, network, redirect, 5xx, 429, malformed
 *   answer...) THROWS, so the route fails closed with a safe 500 and nothing
 *   is processed.
 *
 * Safety: the token is parsed strictly, sent only to the fixed introspection
 * URL, and never logged, echoed, stored or put in an error. The URL is built
 * only from server configuration: nothing from the incoming request influences
 * it. Extra fields in the answer are ignored and never copied into the
 * principal, which is built only from `id` and `role`.
 */

export const PLANEJADOR_IDENTITY_PATH =
  "/api/v1/auth/me";

export const PLANEJADOR_TIMEOUT_MS = 3000;

/** Upper bounds for untrusted input/output. */
export const MAX_BEARER_TOKEN_LENGTH = 4096;

export const MAX_INTROSPECTION_BODY_BYTES =
  4096;

/** Roles that may use the AIE (TASK-019, Decision 2). */
export const AIE_ALLOWED_ROLES: readonly string[] =
  [
    "cliente",
    "assessor",
    "administrador",
  ];

export type PlanejadorFetch = (
  url: string,
  init: {
    method: "GET";

    headers: Record<string, string>;

    redirect: "manual";

    cache: "no-store";

    signal: AbortSignal;
  },
) => Promise<Response>;

export interface PlanejadorAuthorizerConfig {
  /** Validated base URL (see parsePlanejadorBaseUrl). */
  baseUrl: string;

  /** Test seam. Defaults to the global fetch. */
  fetch?: PlanejadorFetch;

  /** Timeout for the whole introspection (finite, > 0). Default 3000. */
  timeoutMs?: number;
}

/**
 * Fixed-message failure. Carries no token, header, URL, cause or response
 * content; the route turns any thrown error into a safe 500.
 */
export class PlanejadorAuthorizationError extends Error {
  constructor() {
    super(
      "The identity service could not verify the request.",
    );

    this.name =
      "PlanejadorAuthorizationError";
  }
}

const LOOPBACK_HOSTS = [
  "localhost",
  "127.0.0.1",
  "[::1]",
];

/**
 * Validates the configured base URL and returns it normalized (no trailing
 * slash), or null when it is not acceptable: https is required (http only for
 * a loopback host, for local development), and no credentials, query or
 * fragment are allowed.
 */
export function parsePlanejadorBaseUrl(
  value: string,
): string | null {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return null;
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const secure =
    url.protocol === "https:";

  const localHttp =
    url.protocol === "http:" &&
    LOOPBACK_HOSTS.includes(
      url.hostname,
    );

  if (!secure && !localHttp) {
    return null;
  }

  if (
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    trimmed.includes("?") ||
    trimmed.includes("#")
  ) {
    return null;
  }

  return `${url.origin}${url.pathname}`.replace(
    /\/+$/,
    "",
  );
}

const BEARER_PATTERN =
  /^bearer ([A-Za-z0-9\-._~+\/]+=*)$/i;

/**
 * Strict extraction: exactly one Authorization value, scheme Bearer, a single
 * token made only of token characters, bounded length. Returns null for
 * anything else (missing, wrong scheme, several values, whitespace or control
 * characters, oversized).
 */
function extractBearerToken(
  request: Request,
): string | null {
  const header =
    request.headers.get(
      "authorization",
    );

  if (
    header === null ||
    header.length >
      MAX_BEARER_TOKEN_LENGTH + 16
  ) {
    return null;
  }

  const match =
    BEARER_PATTERN.exec(header);

  if (!match) {
    return null;
  }

  const token = match[1] as string;

  return token.length <=
    MAX_BEARER_TOKEN_LENGTH
    ? token
    : null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readBoundedText(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const declared = Number(
    response.headers.get(
      "content-length",
    ),
  );

  if (
    Number.isFinite(declared) &&
    declared > maxBytes
  ) {
    throw new PlanejadorAuthorizationError();
  }

  const stream = response.body;

  if (stream === null) {
    return "";
  }

  const reader = stream.getReader();

  const chunks: Uint8Array[] = [];

  let total = 0;

  for (;;) {
    const { done, value } =
      await reader.read();

    if (done) {
      break;
    }

    total += value.byteLength;

    if (total > maxBytes) {
      await reader
        .cancel()
        .catch(() => undefined);

      throw new PlanejadorAuthorizationError();
    }

    chunks.push(value);
  }

  const bytes = new Uint8Array(
    total,
  );

  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);

    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(
    bytes,
  );
}

interface Identity {
  id: string;

  role: string;

  isActive: boolean;
}

/** Strict validation of the 200 body. Unknown fields are ignored. */
function parseIdentity(
  text: string,
): Identity {
  let body: unknown;

  try {
    body = JSON.parse(text);
  } catch {
    throw new PlanejadorAuthorizationError();
  }

  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body)
  ) {
    throw new PlanejadorAuthorizationError();
  }

  const { id, role, is_active } =
    body as Record<string, unknown>;

  if (
    typeof id !== "string" ||
    !UUID_PATTERN.test(id) ||
    typeof role !== "string" ||
    role.length === 0 ||
    role.length > 64 ||
    typeof is_active !== "boolean"
  ) {
    throw new PlanejadorAuthorizationError();
  }

  return {
    id,

    role,

    isActive: is_active,
  };
}

export class PlanejadorRequestAuthorizer
  implements AieRequestAuthorizer
{
  readonly #url: string;

  readonly #fetch: PlanejadorFetch;

  readonly #timeoutMs: number;

  constructor(
    config: PlanejadorAuthorizerConfig,
  ) {
    const baseUrl =
      parsePlanejadorBaseUrl(
        config.baseUrl,
      );

    if (baseUrl === null) {
      throw new RangeError(
        "Invalid identity service base URL.",
      );
    }

    const timeoutMs =
      config.timeoutMs ??
      PLANEJADOR_TIMEOUT_MS;

    if (
      typeof timeoutMs !== "number" ||
      !Number.isFinite(timeoutMs) ||
      timeoutMs <= 0
    ) {
      throw new RangeError(
        "Invalid identity service timeout.",
      );
    }

    this.#url = `${baseUrl}${PLANEJADOR_IDENTITY_PATH}`;

    this.#timeoutMs = timeoutMs;

    this.#fetch =
      config.fetch ??
      ((url, init) =>
        globalThis.fetch(url, init));
  }

  async authorize(
    request: Request,
    context: AieAuthorizationContext,
  ): Promise<AieAuthorizationResult> {
    const token =
      extractBearerToken(request);

    // No usable credential: no request is made to the identity service.
    if (token === null) {
      return unauthenticated();
    }

    const status =
      await this.introspect(token);

    if (status.kind === "denied") {
      return {
        authorized: false,

        reason: status.reason,
      };
    }

    const { identity } = status;

    if (!identity.isActive) {
      return unauthenticated();
    }

    if (
      !AIE_ALLOWED_ROLES.includes(
        identity.role,
      )
    ) {
      return forbidden();
    }

    // Premium-only batch (TASK-019, Decision 3): nobody holds the entitlement
    // yet, so batch stays forbidden until TASK-021.
    if (
      context.operation !==
      "resolve-asset"
    ) {
      return forbidden();
    }

    return {
      authorized: true,

      principal: {
        subject: identity.id,

        roles: [identity.role],
      },
    };
  }

  private async introspect(
    token: string,
  ): Promise<
    | {
        kind: "denied";

        reason:
          | "unauthenticated"
          | "forbidden";
      }
    | {
        kind: "identity";

        identity: Identity;
      }
  > {
    const controller =
      new AbortController();

    const timer = setTimeout(
      () => controller.abort(),
      this.#timeoutMs,
    );

    try {
      let response: Response;

      try {
        response = await this.#fetch(
          this.#url,
          {
            method: "GET",

            // Only the bearer is forwarded; nothing else from the request.
            headers: {
              Authorization: `Bearer ${token}`,

              Accept:
                "application/json",
            },

            // A redirect is never followed: it is treated as a failure.
            redirect: "manual",

            cache: "no-store",

            signal:
              controller.signal,
          },
        );
      } catch {
        throw new PlanejadorAuthorizationError();
      }

      if (response.status === 401) {
        discard(response);

        return {
          kind: "denied",

          reason: "unauthenticated",
        };
      }

      if (response.status === 403) {
        discard(response);

        return {
          kind: "denied",

          reason: "forbidden",
        };
      }

      if (response.status !== 200) {
        discard(response);

        throw new PlanejadorAuthorizationError();
      }

      let text: string;

      try {
        text = await readBoundedText(
          response,
          MAX_INTROSPECTION_BODY_BYTES,
        );
      } catch {
        throw new PlanejadorAuthorizationError();
      }

      return {
        kind: "identity",

        identity: parseIdentity(text),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function unauthenticated(): AieAuthorizationResult {
  return {
    authorized: false,

    reason: "unauthenticated",
  };
}

function forbidden(): AieAuthorizationResult {
  return {
    authorized: false,

    reason: "forbidden",
  };
}

/**
 * Releases the connection without reading an unbounded body. It never waits
 * for the cancellation: the answer is not used, and a stream that is slow to
 * cancel must not delay the decision.
 */
function discard(
  response: Response,
): void {
  try {
    void response.body
      ?.cancel()
      .catch(() => undefined);
  } catch {
    // Nothing to do: the answer is not used.
  }
}
