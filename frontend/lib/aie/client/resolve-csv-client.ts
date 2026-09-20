import type {
  ResolutionStatus,
} from "../contracts";

import {
  CSV_UPLOAD_FILE_ID_PATTERN,
} from "../ingestion/portfolio-csv-limits";

import type {
  SafeIssue,
} from "./csv-issue-messages";

/**
 * Browser client for POST /api/aie/resolve-csv (TASK-025).
 *
 * It sends the raw CSV as `text/csv` with the caller's bearer token and maps the
 * server's answer to an explicit outcome. It contains NO resolution logic: it
 * never verifies anything, never changes evidence, never calls a provider and
 * knows nothing about ANBIMA, credentials or the verification policy. The server
 * stays authoritative; a 4xx/5xx is reported as such, never turned into a
 * success.
 *
 * Authentication: the token comes from an injected `getAccessToken` (in the app,
 * the existing `getValidAccessToken` of lib/session.ts, which owns storage and
 * refresh). The token goes ONLY in the Authorization header: never in the URL,
 * the CSV, an outcome or a message. The CSV goes only in the request body; the
 * URL carries only the opaque upload id.
 *
 * Browser-safe: no environment, no storage, no logging.
 */

export const RESOLVE_CSV_PATH =
  "/api/aie/resolve-csv";

/** A safe, display-oriented view of one BatchResolutionItem. */
export interface ResolvedItemView {
  /** 0-based position in the submitted rows. */
  index: number;

  candidateAssetId: string;

  /** `resolved`: the engine answered (verified or not). `item-error`: a safe item failure. */
  kind: "resolved" | "item-error";

  status?: ResolutionStatus;

  /** Evidence fields the engine still needs (raw field names). */
  unresolvedFields: string[];

  /** Evidence sources that contributed (for example ANBIMA). */
  sources: string[];

  /** Providers whose lookup failed (the fact, never the error text). */
  failedSources: string[];

  verifiedAsset?: {
    canonicalAssetId: string;

    assetType: string;

    currency: string;

    amount?: number;
  };

  itemErrorCode?: string;
}

export type ResolveCsvOutcome =
  | {
      kind: "success";

      items: ResolvedItemView[];

      correlationId?: string;
    }
  | {
      kind: "validation-error";

      issues: SafeIssue[];

      correlationId?: string;
    }
  | {
      kind: "unauthenticated";

      /** `no-session`: no request was made because there is no usable token. */
      reason: "no-session" | "rejected";

      correlationId?: string;
    }
  | {
      kind: "forbidden";

      correlationId?: string;
    }
  | {
      kind: "too-large";

      correlationId?: string;
    }
  | {
      kind: "unsupported-media";

      correlationId?: string;
    }
  | {
      kind: "rate-limited";

      retryAfterSeconds?: number;

      correlationId?: string;
    }
  | {
      kind: "server-error";

      correlationId?: string;
    }
  | {
      kind: "network-error";
    };

export interface SubmitPortfolioCsvInput {
  csvText: string;

  /** The opaque upload id (see deriveUploadFileId). */
  fileId: string;

  getAccessToken: () => Promise<
    string | null
  >;

  /** Test seam. Defaults to the global fetch. */
  fetchImpl?: (
    url: string,
    init: {
      method: "POST";

      headers: Record<string, string>;

      body: string;

      cache: "no-store";

      credentials: "omit";
    },
  ) => Promise<Response>;
}

function asObject(
  value: unknown,
): Record<string, unknown> | null {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
    ? (value as Record<
        string,
        unknown
      >)
    : null;
}

function strings(
  value: unknown,
): string[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === "string",
      )
    : [];
}

function unique(
  values: string[],
): string[] {
  return [...new Set(values)];
}

/**
 * Reads the server's items defensively into safe views. Only known scalar fields
 * are copied: evidence values and metadata (which can carry provider records),
 * provider error text, the echoed candidate and everything else are dropped.
 */
export function toItemViews(
  items: unknown,
): ResolvedItemView[] | null {
  if (!Array.isArray(items)) {
    return null;
  }

  const views: ResolvedItemView[] = [];

  for (const raw of items) {
    const item = asObject(raw);

    if (
      !item ||
      typeof item.index !== "number" ||
      typeof item.candidateAssetId !==
        "string"
    ) {
      return null;
    }

    if (item.ok === false) {
      const error = asObject(
        item.error,
      );

      views.push({
        index: item.index,

        candidateAssetId:
          item.candidateAssetId,

        kind: "item-error",

        unresolvedFields: [],

        sources: [],

        failedSources: [],

        ...(typeof error?.code ===
        "string"
          ? {
              itemErrorCode:
                error.code,
            }
          : {}),
      });

      continue;
    }

    const result = asObject(
      item.result,
    );

    const investigation = asObject(
      result?.investigation,
    );

    if (
      !result ||
      typeof result.status !==
        "string"
    ) {
      return null;
    }

    const evidence = Array.isArray(
      investigation?.evidence,
    )
      ? (
          investigation?.evidence as unknown[]
        )
      : [];

    const searches = Array.isArray(
      investigation?.searches,
    )
      ? (
          investigation?.searches as unknown[]
        )
      : [];

    const verified = asObject(
      result.verifiedAsset,
    );

    views.push({
      index: item.index,

      candidateAssetId:
        item.candidateAssetId,

      kind: "resolved",

      status:
        result.status as ResolutionStatus,

      unresolvedFields: strings(
        investigation?.unresolvedFields,
      ),

      sources: unique(
        evidence
          .map(
            (entry) =>
              asObject(entry)?.source,
          )
          .filter(
            (
              source,
            ): source is string =>
              typeof source ===
              "string",
          ),
      ),

      failedSources: unique(
        searches
          .map(asObject)
          .filter(
            (search) =>
              search?.status ===
                "failed" &&
              typeof search
                .providerId ===
                "string",
          )
          .map(
            (search) =>
              search?.providerId as string,
          ),
      ),

      ...(verified &&
      typeof verified.canonicalAssetId ===
        "string" &&
      typeof verified.assetType ===
        "string" &&
      typeof verified.currency ===
        "string"
        ? {
            verifiedAsset: {
              canonicalAssetId:
                verified.canonicalAssetId,

              assetType:
                verified.assetType,

              currency:
                verified.currency,

              ...(typeof verified.amount ===
              "number"
                ? {
                    amount:
                      verified.amount,
                  }
                : {}),
            },
          }
        : {}),
    });
  }

  return views;
}

function safeIssues(
  value: unknown,
): SafeIssue[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(asObject)
    .filter(
      (
        issue,
      ): issue is Record<
        string,
        unknown
      > =>
        issue !== null &&
        typeof issue.path ===
          "string" &&
        typeof issue.code === "string",
    )
    .map((issue) => ({
      path: issue.path as string,

      code: issue.code as string,
    }));
}

function readRetryAfter(
  response: Response,
): number | undefined {
  const header =
    response.headers.get(
      "retry-after",
    );

  if (
    header === null ||
    !/^\d{1,6}$/.test(header.trim())
  ) {
    return undefined;
  }

  const seconds = Number(header);

  return seconds >= 0
    ? seconds
    : undefined;
}

export async function submitPortfolioCsv(
  input: SubmitPortfolioCsvInput,
): Promise<ResolveCsvOutcome> {
  let token: string | null;

  try {
    token =
      await input.getAccessToken();
  } catch {
    token = null;
  }

  if (!token) {
    // No usable session: nothing is sent.
    return {
      kind: "unauthenticated",

      reason: "no-session",
    };
  }

  // Defense in depth: the id is derived locally, but never trust it into a URL.
  if (
    !CSV_UPLOAD_FILE_ID_PATTERN.test(
      input.fileId,
    )
  ) {
    return {
      kind: "validation-error",

      issues: [
        {
          path: "query.fileId",

          code: "invalid_value",
        },
      ],
    };
  }

  const doFetch =
    input.fetchImpl ??
    ((url, init) =>
      globalThis.fetch(url, init));

  let response: Response;

  try {
    response = await doFetch(
      `${RESOLVE_CSV_PATH}?fileId=${encodeURIComponent(
        input.fileId,
      )}`,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "text/csv; charset=utf-8",

          Authorization: `Bearer ${token}`,
        },

        body: input.csvText,

        cache: "no-store",

        // Bearer token only: no cookies travel with this request.
        credentials: "omit",
      },
    );
  } catch {
    return { kind: "network-error" };
  }

  const correlationId =
    response.headers.get(
      "x-correlation-id",
    ) ?? undefined;

  const withId = correlationId
    ? { correlationId }
    : {};

  switch (response.status) {
    case 200: {
      let body: unknown;

      try {
        body = await response.json();
      } catch {
        return {
          kind: "server-error",

          ...withId,
        };
      }

      const items = toItemViews(
        asObject(
          asObject(body)?.result,
        )?.items,
      );

      return items
        ? {
            kind: "success",

            items,

            ...withId,
          }
        : {
            kind: "server-error",

            ...withId,
          };
    }

    case 400: {
      let issues: SafeIssue[] = [];

      try {
        issues = safeIssues(
          asObject(
            asObject(
              await response.json(),
            )?.error,
          )?.issues,
        );
      } catch {
        // No readable detail: still a validation error.
      }

      return {
        kind: "validation-error",

        issues,

        ...withId,
      };
    }

    case 401:
      return {
        kind: "unauthenticated",

        reason: "rejected",

        ...withId,
      };

    case 403:
      return {
        kind: "forbidden",

        ...withId,
      };

    case 413:
      return {
        kind: "too-large",

        ...withId,
      };

    case 415:
      return {
        kind: "unsupported-media",

        ...withId,
      };

    case 429: {
      const retry =
        readRetryAfter(response);

      return {
        kind: "rate-limited",

        ...(retry !== undefined
          ? {
              retryAfterSeconds:
                retry,
            }
          : {}),

        ...withId,
      };
    }

    default:
      // 500 and anything unexpected: never shown raw.
      return {
        kind: "server-error",

        ...withId,
      };
  }
}
