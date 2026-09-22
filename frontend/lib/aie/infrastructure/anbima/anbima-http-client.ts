import type {
  AnbimaDebentureFeedClient,
  AnbimaDebentureMarketRecord,
} from "./anbima-debenture-types";

import {
  AnbimaRateLimiter,
} from "./anbima-rate-limiter";

import type {
  AnbimaTimerScheduler,
} from "./anbima-rate-limiter";

/**
 * ANBIMA HTTP client: OAuth2 client-credentials authentication, the HTTP call
 * and defensive parsing of the debenture secondary-market feed.
 *
 * Boundary (see TASK-006 / ADR-002 / ADR-003):
 *
 *   AnbimaDebentureProvider -> AnbimaDebentureFeedClient -> AnbimaHttpClient
 *
 * The provider knows nothing about OAuth, fetch, URLs, tokens, retries or rate
 * limits. This client knows nothing about evidence: it never produces
 * AssetEvidence and never interprets the textual issuer.
 *
 * Official ANBIMA facts preserved here:
 *
 * - Token: POST https://api.anbima.com.br/oauth/access-token
 *   Authorization: Basic base64(client_id:client_secret), JSON body
 *   {"grant_type":"client_credentials"}; response has access_token,
 *   token_type and expires_in (the official example shows 3600).
 * - Feed calls send the headers client_id and access_token.
 * - Base URLs: production https://api.anbima.com.br,
 *   sandbox https://api-sandbox.anbima.com.br.
 * - Endpoint: GET /feed/precos-indices/v1/debentures/mercado-secundario.
 *   The only documented query parameter is data=YYYY-MM-DD (optional); when it
 *   is omitted ANBIMA returns the most recent available reference date. This
 *   client never sends it.
 * - There is NO documented server-side filter by codigo_ativo, so the feed is
 *   fetched and the exact code match is done locally.
 * - Production rate limit: up to 15 requests per second. Since TASK-015 every
 *   outbound request (token and feed, including the 401 retry) passes through
 *   one ANBIMA-local sliding-window limiter (default 14 per second).
 *
 * Feed cache (TASK-015): the parsed latest feed is kept in memory as a single
 * entry with a TTL (default 5 minutes). Lookups within the TTL cost no HTTP
 * request; concurrent misses share one in-flight request; a failed or
 * malformed response is never cached. The token cache is independent of the
 * feed cache. Both caches and the limiter are per process (no persistence, no
 * cross-instance coordination): with several server instances the global
 * 15 req/s limit is NOT guaranteed.
 *
 * Not verified against the official documentation: which token URL applies to
 * the sandbox environment. The token URL therefore defaults to the production
 * one for both environments and can be overridden with `tokenUrl`.
 */

export type AnbimaEnvironment =
  | "production"
  | "sandbox";

export const ANBIMA_PRODUCTION_BASE_URL =
  "https://api.anbima.com.br";

export const ANBIMA_SANDBOX_BASE_URL =
  "https://api-sandbox.anbima.com.br";

export const ANBIMA_TOKEN_URL =
  "https://api.anbima.com.br/oauth/access-token";

export const ANBIMA_DEBENTURES_SECONDARY_MARKET_PATH =
  "/feed/precos-indices/v1/debentures/mercado-secundario";

/** Default lifetime of the cached feed: 5 minutes. */
export const ANBIMA_DEFAULT_FEED_CACHE_TTL_MS =
  5 * 60 * 1000;

/** Minimal fetch surface used by this client (the global fetch satisfies it). */
export interface AnbimaFetchInit {
  method: string;

  headers: Record<string, string>;

  body?: string;
}

export interface AnbimaFetchResponse {
  ok: boolean;

  status: number;

  json(): Promise<unknown>;
}

export type AnbimaFetch = (
  url: string,
  init: AnbimaFetchInit,
) => Promise<AnbimaFetchResponse>;

export interface AnbimaHttpClientConfig {
  clientId: string;

  clientSecret: string;

  environment: AnbimaEnvironment;

  /** Test seam. Defaults to the global fetch. */
  fetch?: AnbimaFetch;

  /** Test seam: current time in epoch milliseconds. */
  now?: () => number;

  /** Overrides the OAuth token URL (see the note above about the sandbox). */
  tokenUrl?: string;

  /**
   * Lifetime of the cached feed in milliseconds (finite, >= 0). 0 disables
   * reuse. Default ANBIMA_DEFAULT_FEED_CACHE_TTL_MS. Independent of the token
   * lifetime.
   */
  feedCacheTtlMs?: number;

  /** Outbound rate limit shared by token and feed requests. */
  rateLimit?: {
    /** Integer >= 1. Default 14 (documented ANBIMA limit is 15). */
    maxRequests?: number;

    /** Window in milliseconds (> 0). Default 1000. */
    intervalMs?: number;
  };

  /** Test seam for the rate limiter's waiting. Defaults to setTimeout. */
  setTimer?: AnbimaTimerScheduler;
}

export type AnbimaHttpErrorCode =
  | "INVALID_CONFIGURATION"
  | "TOKEN_REQUEST_FAILED"
  | "TOKEN_RESPONSE_INVALID"
  | "FEED_REQUEST_FAILED"
  | "FEED_RESPONSE_INVALID";

/**
 * Error messages never contain credentials, tokens, headers or response
 * bodies. They carry only the error code, an HTTP status and field names.
 */
export class AnbimaHttpError extends Error {
  readonly code: AnbimaHttpErrorCode;

  readonly status?: number;

  constructor(
    code: AnbimaHttpErrorCode,
    message: string,
    status?: number,
  ) {
    super(message);

    this.name = "AnbimaHttpError";
    this.code = code;
    this.status = status;
  }
}

interface CachedToken {
  accessToken: string;

  /** Epoch ms after which the token must be refreshed. */
  refreshAtMs: number;
}

interface CachedFeed {
  records: readonly AnbimaDebentureMarketRecord[];

  /** Epoch ms from which the feed must be fetched again. */
  expiresAtMs: number;
}

const MAX_REFRESH_MARGIN_MS = 30_000;

function normalizeCode(
  value: string,
): string {
  return value
    .trim()
    .toUpperCase();
}

function toBase64(
  value: string,
): string {
  if (typeof Buffer !== "undefined") {
    return Buffer
      .from(value, "utf8")
      .toString("base64");
  }

  return btoa(value);
}

function isObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function invalidFeed(
  detail: string,
): AnbimaHttpError {
  return new AnbimaHttpError(
    "FEED_RESPONSE_INVALID",
    `ANBIMA feed response is invalid: ${detail}.`,
  );
}

function readRequiredString(
  source: Record<string, unknown>,
  field: string,
  index: number,
): string {
  const value = source[field];

  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw invalidFeed(
      `record ${index} field "${field}" must be a non-empty string`,
    );
  }

  return value;
}

function readNullableString(
  source: Record<string, unknown>,
  field: string,
  index: number,
): string | null {
  const value = source[field];

  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  if (typeof value !== "string") {
    throw invalidFeed(
      `record ${index} field "${field}" must be a string or null`,
    );
  }

  return value;
}

function readNullableNumber(
  source: Record<string, unknown>,
  field: string,
  index: number,
): number | null {
  const value = source[field];

  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  if (
    typeof value !== "number" ||
    !Number.isFinite(value)
  ) {
    throw invalidFeed(
      `record ${index} field "${field}" must be a number or null`,
    );
  }

  return value;
}

/**
 * The single place where the feed response shape is normalized.
 *
 * ANBIMA documents the record fields but not a response envelope, so only a
 * direct JSON array of records is accepted. Any other shape, and any record
 * that violates the documented field types, is rejected loudly instead of
 * being silently tolerated.
 */
function parseFeed(
  body: unknown,
): AnbimaDebentureMarketRecord[] {
  if (!Array.isArray(body)) {
    throw invalidFeed(
      "expected a JSON array of records",
    );
  }

  return body.map(
    (
      item: unknown,
      index: number,
    ): AnbimaDebentureMarketRecord => {
      if (!isObject(item)) {
        throw invalidFeed(
          `record ${index} must be an object`,
        );
      }

      return {
        grupo:
          readNullableString(item, "grupo", index),

        codigo_ativo:
          readRequiredString(item, "codigo_ativo", index),

        data_referencia:
          readRequiredString(item, "data_referencia", index),

        data_vencimento:
          readRequiredString(item, "data_vencimento", index),

        percentual_taxa:
          readNullableString(item, "percentual_taxa", index),

        taxa_compra:
          readNullableNumber(item, "taxa_compra", index),

        taxa_venda:
          readNullableNumber(item, "taxa_venda", index),

        taxa_indicativa:
          readNullableNumber(item, "taxa_indicativa", index),

        desvio_padrao:
          readNullableNumber(item, "desvio_padrao", index),

        val_min_intervalo:
          readNullableNumber(item, "val_min_intervalo", index),

        val_max_intervalo:
          readNullableNumber(item, "val_max_intervalo", index),

        pu:
          readNullableNumber(item, "pu", index),

        percent_vne:
          readNullableNumber(item, "percent_vne", index),

        percent_pu_par:
          readNullableNumber(item, "percent_pu_par", index),

        duration:
          readNullableNumber(item, "duration", index),

        percent_reune:
          readNullableString(item, "percent_reune", index),

        emissor:
          readRequiredString(item, "emissor", index),

        referencia_ntnb:
          readNullableString(item, "referencia_ntnb", index),

        data_finalizado:
          readNullableString(item, "data_finalizado", index),

        pu_retificado:
          readNullableNumber(item, "pu_retificado", index),

        percent_pu_par_retificado:
          readNullableNumber(item, "percent_pu_par_retificado", index),

        duration_retificada:
          readNullableNumber(item, "duration_retificada", index),

        data_finalizado_retificado:
          readNullableString(item, "data_finalizado_retificado", index),
      };
    },
  );
}

/**
 * Exact, normalized (trim + uppercase) match of codigo_ativo. No fuzzy matching.
 *
 * If the feed lists the same code more than once with different issuers the
 * identity would be ambiguous, so the response is rejected instead of guessing.
 */
function findExactRecord(
  records: readonly AnbimaDebentureMarketRecord[],
  code: string,
): AnbimaDebentureMarketRecord | null {
  const matches = records.filter(
    (record) =>
      normalizeCode(
        record.codigo_ativo,
      ) === code,
  );

  const first = matches[0];

  if (!first) {
    return null;
  }

  const issuer =
    normalizeCode(first.emissor);

  const ambiguous = matches.some(
    (record) =>
      normalizeCode(record.emissor) !==
      issuer,
  );

  if (ambiguous) {
    throw invalidFeed(
      "the requested code appears with different issuers",
    );
  }

  return first;
}

export class AnbimaHttpClient
  implements AnbimaDebentureFeedClient
{
  readonly #clientId: string;

  readonly #clientSecret: string;

  readonly #baseUrl: string;

  readonly #tokenUrl: string;

  readonly #fetch: AnbimaFetch;

  readonly #now: () => number;

  #cachedToken: CachedToken | null = null;

  #tokenRequest: Promise<CachedToken> | null =
    null;

  readonly #limiter: AnbimaRateLimiter;

  readonly #feedCacheTtlMs: number;

  /** At most one cached feed (the latest one); no per-code map. */
  #cachedFeed: CachedFeed | null = null;

  /** At most one feed load in flight; concurrent callers share it. */
  #feedRequest: Promise<
    readonly AnbimaDebentureMarketRecord[]
  > | null = null;

  constructor(
    config: AnbimaHttpClientConfig,
  ) {
    if (
      !config.clientId?.trim() ||
      !config.clientSecret?.trim()
    ) {
      throw new AnbimaHttpError(
        "INVALID_CONFIGURATION",
        "ANBIMA clientId and clientSecret are required.",
      );
    }

    if (
      config.environment !==
        "production" &&
      config.environment !==
        "sandbox"
    ) {
      throw new AnbimaHttpError(
        "INVALID_CONFIGURATION",
        'ANBIMA environment must be "production" or "sandbox".',
      );
    }

    this.#clientId =
      config.clientId;

    this.#clientSecret =
      config.clientSecret;

    this.#baseUrl =
      config.environment ===
      "sandbox"
        ? ANBIMA_SANDBOX_BASE_URL
        : ANBIMA_PRODUCTION_BASE_URL;

    this.#tokenUrl =
      config.tokenUrl ??
      ANBIMA_TOKEN_URL;

    this.#fetch =
      config.fetch ??
      ((url, init) =>
        globalThis.fetch(
          url,
          init,
        ));

    this.#now =
      config.now ??
      (() => Date.now());

    const ttl =
      config.feedCacheTtlMs ??
      ANBIMA_DEFAULT_FEED_CACHE_TTL_MS;

    if (
      typeof ttl !== "number" ||
      !Number.isFinite(ttl) ||
      ttl < 0
    ) {
      throw new AnbimaHttpError(
        "INVALID_CONFIGURATION",
        "ANBIMA feedCacheTtlMs must be a finite number >= 0.",
      );
    }

    this.#feedCacheTtlMs = ttl;

    try {
      this.#limiter =
        new AnbimaRateLimiter({
          maxRequests:
            config.rateLimit
              ?.maxRequests,

          intervalMs:
            config.rateLimit
              ?.intervalMs,

          now: this.#now,

          setTimer:
            config.setTimer,
        });
    } catch {
      throw new AnbimaHttpError(
        "INVALID_CONFIGURATION",
        "ANBIMA rateLimit must have an integer maxRequests >= 1 and an intervalMs > 0.",
      );
    }
  }

  async findSecondaryMarketDebentureByCode(
    instrumentCode: string,
  ): Promise<AnbimaDebentureMarketRecord | null> {
    const code =
      normalizeCode(
        instrumentCode,
      );

    if (!code) {
      return null;
    }

    const records =
      await this.getSecondaryMarketDebentureFeed();

    // The lookup stays exact and local; the cache holds the whole feed.
    return findExactRecord(
      records,
      code,
    );
  }

  /**
   * Returns the parsed latest feed: from the cache while it is fresh,
   * otherwise from ONE shared HTTP load (auth + rate limit + request + parse).
   * Not part of the public contract.
   */
  private getSecondaryMarketDebentureFeed(): Promise<
    readonly AnbimaDebentureMarketRecord[]
  > {
    const cached =
      this.#cachedFeed;

    if (
      cached &&
      this.#now() <
        cached.expiresAtMs
    ) {
      return Promise.resolve(
        cached.records,
      );
    }

    /*
     * Concurrent misses/expiries share one in-flight load. The slot is
     * cleared on success AND on failure, so a failure is never cached and the
     * next call can retry.
     */
    if (!this.#feedRequest) {
      this.#feedRequest =
        this.loadSecondaryMarketFeed().finally(
          () => {
            this.#feedRequest =
              null;
          },
        );
    }

    return this.#feedRequest;
  }

  private async loadSecondaryMarketFeed(): Promise<
    readonly AnbimaDebentureMarketRecord[]
  > {
    let attempt =
      await this.requestFeed();

    /*
     * A 401 means the cached token is no longer accepted: invalidate it and
     * retry exactly once with a fresh token. A second 401 is a hard failure.
     */
    if (
      attempt.response.status === 401
    ) {
      this.invalidateToken(
        attempt.token,
      );

      attempt =
        await this.requestFeed();
    }

    const { response } =
      attempt;

    if (!response.ok) {
      throw new AnbimaHttpError(
        "FEED_REQUEST_FAILED",
        `ANBIMA feed request failed with HTTP ${response.status}.`,
        response.status,
      );
    }

    let body: unknown;

    try {
      body =
        await response.json();
    } catch {
      throw invalidFeed(
        "body is not valid JSON",
      );
    }

    const records =
      Object.freeze(
        parseFeed(body).map(
          (record) =>
            Object.freeze(record),
        ),
      );

    // Only a successfully parsed feed is cached (never a 401/failure).
    this.#cachedFeed = {
      records,

      expiresAtMs:
        this.#now() +
        this.#feedCacheTtlMs,
    };

    return records;
  }

  private async requestFeed(): Promise<{
    response: AnbimaFetchResponse;
    token: CachedToken;
  }> {
    const token =
      await this.getAccessToken();

    const response =
      await this.send(
        "FEED_REQUEST_FAILED",
        `${this.#baseUrl}${ANBIMA_DEBENTURES_SECONDARY_MARKET_PATH}`,
        {
          method: "GET",

          headers: {
            client_id:
              this.#clientId,

            access_token:
              token.accessToken,

            "Content-Type":
              "application/json",
          },
        },
      );

    return {
      response,
      token,
    };
  }

  private async getAccessToken(): Promise<CachedToken> {
    const current =
      this.#cachedToken;

    if (
      current &&
      this.#now() <
        current.refreshAtMs
    ) {
      return current;
    }

    /*
     * Concurrent callers share one in-flight token request instead of
     * hitting the token endpoint several times.
     */
    if (!this.#tokenRequest) {
      this.#tokenRequest =
        this.requestToken().finally(
          () => {
            this.#tokenRequest =
              null;
          },
        );
    }

    return this.#tokenRequest;
  }

  private invalidateToken(
    used: CachedToken,
  ): void {
    if (
      this.#cachedToken === used
    ) {
      this.#cachedToken = null;
    }
  }

  private async requestToken(): Promise<CachedToken> {
    const response =
      await this.send(
        "TOKEN_REQUEST_FAILED",
        this.#tokenUrl,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            Authorization: `Basic ${toBase64(
              `${this.#clientId}:${this.#clientSecret}`,
            )}`,
          },

          body: JSON.stringify({
            grant_type:
              "client_credentials",
          }),
        },
      );

    if (!response.ok) {
      throw new AnbimaHttpError(
        "TOKEN_REQUEST_FAILED",
        `ANBIMA token request failed with HTTP ${response.status}.`,
        response.status,
      );
    }

    let body: unknown;

    try {
      body =
        await response.json();
    } catch {
      throw this.invalidToken(
        "body is not valid JSON",
      );
    }

    if (!isObject(body)) {
      throw this.invalidToken(
        "expected a JSON object",
      );
    }

    const accessToken =
      body.access_token;

    const tokenType =
      body.token_type;

    const expiresIn =
      body.expires_in;

    if (
      typeof accessToken !==
        "string" ||
      accessToken.trim().length ===
        0
    ) {
      throw this.invalidToken(
        'field "access_token" must be a non-empty string',
      );
    }

    if (
      typeof tokenType !==
        "string" ||
      tokenType.trim().length === 0
    ) {
      throw this.invalidToken(
        'field "token_type" must be a non-empty string',
      );
    }

    if (
      typeof expiresIn !==
        "number" ||
      !Number.isFinite(expiresIn) ||
      expiresIn <= 0
    ) {
      throw this.invalidToken(
        'field "expires_in" must be a positive number',
      );
    }

    const expiresInMs =
      expiresIn * 1000;

    const margin = Math.min(
      MAX_REFRESH_MARGIN_MS,
      expiresInMs / 2,
    );

    const token: CachedToken = {
      accessToken,

      refreshAtMs:
        this.#now() +
        expiresInMs -
        margin,
    };

    this.#cachedToken = token;

    return token;
  }

  private invalidToken(
    detail: string,
  ): AnbimaHttpError {
    return new AnbimaHttpError(
      "TOKEN_RESPONSE_INVALID",
      `ANBIMA token response is invalid: ${detail}.`,
    );
  }

  /**
   * The only place that calls fetch, and therefore the only place that
   * consults the rate limiter: token requests, feed requests and the 401 retry
   * all share it. A transport failure is reported without the original error
   * message or cause, which could echo request headers.
   */
  private async send(
    failureCode:
      | "TOKEN_REQUEST_FAILED"
      | "FEED_REQUEST_FAILED",
    url: string,
    init: AnbimaFetchInit,
  ): Promise<AnbimaFetchResponse> {
    await this.#limiter.acquire();

    try {
      return await this.#fetch(
        url,
        init,
      );
    } catch {
      throw new AnbimaHttpError(
        failureCode,
        failureCode ===
          "TOKEN_REQUEST_FAILED"
          ? "ANBIMA token request failed: network error."
          : "ANBIMA feed request failed: network error.",
      );
    }
  }
}
