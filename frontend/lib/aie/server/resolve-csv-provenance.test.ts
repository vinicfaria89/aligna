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

import {
  buildPortfolioCsvPreview,
} from "../client/portfolio-csv-preview";

import {
  deriveUploadFileId,
} from "../client/upload-file-id";

import {
  MAX_CSV_UPLOAD_BYTES,
  MAX_PORTFOLIO_ROWS,
} from "../ingestion/portfolio-csv-limits";

import type {
  AieRequestAuthorizer,
} from "./request-authorization";

import {
  MAX_BATCH_SIZE,
} from "./resolve-assets";

import {
  handleResolveCsvRequest,
  MAX_CSV_BODY_BYTES,
} from "./resolve-csv-http";

const resolveAssets = vi.hoisted(
  () => vi.fn(),
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

/**
 * TASK-025: the optional `fileId` query of POST /api/aie/resolve-csv (upload
 * provenance), and the guarantee that the browser preview and the server derive
 * the very same row ids.
 */

const FILE_ID = "f0123456789abcdef";

const SUBJECT =
  "3f2b1c9e-8a4d-4e6f-9b0a-1c2d3e4f5a6b";

function allow(): AieRequestAuthorizer {
  return {
    authorize: async () => ({
      authorized: true,

      principal: {
        subject: SUBJECT,
      },
    }),
  };
}

const options = {
  authorizer: allow(),

  usage: {
    check: async () => ({
      allowed: true as const,
    }),
  },

  audit: {
    sink: {
      write: async () => undefined,
    },
  },
};

function request(
  query: string,
  body: string,
): Request {
  return new Request(
    `http://localhost/api/aie/resolve-csv${query}`,
    {
      method: "POST",

      headers: {
        "content-type": "text/csv",

        authorization: "Bearer x",
      },

      body,
    },
  );
}

function candidates(): CandidateAsset[] {
  return resolveAssets.mock
    .calls[0]?.[0] as CandidateAsset[];
}

describe("resolve-csv upload provenance (fileId)", () => {
  beforeEach(() => {
    resolveAssets.mockReset();

    resolveAssets.mockImplementation(
      async (
        assets: CandidateAsset[],
      ) => ({
        items: assets.map(
          (candidate, index) => ({
            index,

            candidateAssetId:
              candidate.id,

            ok: true,

            result: {},
          }),
        ),
      }),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error(
          "real network call attempted",
        );
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("without fileId a CSV whose rows state no id is still a 400 (contract unchanged)", async () => {
    const response =
      await handleResolveCsvRequest(
        request("", "rawName\nDEB\n"),
        options,
      );

    expect(response.status).toBe(400);

    expect(
      resolveAssets,
    ).not.toHaveBeenCalled();
  });

  it("with fileId, rows without an id get portfolio:<fileId>:<row>", async () => {
    const response =
      await handleResolveCsvRequest(
        request(
          `?fileId=${FILE_ID}`,
          "rawName,ticker\nA,AAA1\nB,BBB2\n",
        ),
        options,
      );

    expect(response.status).toBe(200);

    expect(
      candidates().map(
        (candidate) => [
          candidate.id,
          candidate.source,
        ],
      ),
    ).toEqual([
      [
        `portfolio:${FILE_ID}:2`,
        { fileId: FILE_ID, row: 2 },
      ],
      [
        `portfolio:${FILE_ID}:3`,
        { fileId: FILE_ID, row: 3 },
      ],
    ]);
  });

  it("leaves rows that state their own id untouched", async () => {
    const response =
      await handleResolveCsvRequest(
        request(
          `?fileId=${FILE_ID}`,
          "id,rawName\nmine,A\n",
        ),
        options,
      );

    expect(response.status).toBe(200);

    expect(candidates()[0]?.id).toBe(
      "mine",
    );

    expect(
      candidates()[0]?.source,
    ).toEqual({});
  });

  it("the browser preview and the server derive EXACTLY the same candidates and ids", async () => {
    const text = [
      "rawName,assetType,instrumentCode,amount,currency",
      "DEB ALPHA,debenture,ABCD11,1000.5,brl",
      "DEB BETA,debenture,EFGH22,20,BRL",
    ].join("\n");

    const fileId = deriveUploadFileId({
      name: "carteira.csv",

      size: text.length,

      lastModified: 1_700_000_000_000,
    });

    const preview =
      buildPortfolioCsvPreview(
        text,
        fileId,
      );

    expect(preview.ok).toBe(true);

    const response =
      await handleResolveCsvRequest(
        request(
          `?fileId=${fileId}`,
          text,
        ),
        options,
      );

    expect(response.status).toBe(200);

    if (!preview.ok) return;

    expect(
      preview.rows.map((row) => [
        row.candidateId,
        row.rawName,
        row.instrumentCode,
        row.amount,
        row.currency,
      ]),
    ).toEqual(
      candidates().map((candidate) => [
        candidate.id,
        candidate.rawName,
        candidate.hints.instrumentCode,
        candidate.hints.amount,
        candidate.hints.currency,
      ]),
    );
  });

  it("rejects a malformed fileId with a safe 400 and never echoes it", async () => {
    for (const bad of [
      "a b",
      "a/b",
      "a:b",
      "..%2F..",
      "x".repeat(65),
      "%3Cscript%3E",
      "",
    ]) {
      resolveAssets.mockClear();

      const response =
        await handleResolveCsvRequest(
          request(
            `?fileId=${bad}`,
            "rawName\nA\n",
          ),
          options,
        );

      const text =
        await response.text();

      expect(response.status).toBe(400);

      expect(
        JSON.parse(text).error,
      ).toEqual({
        code: "INVALID_PORTFOLIO_CSV",

        message:
          "Invalid portfolio CSV.",

        issues: [
          {
            path: "query.fileId",

            code: "invalid_value",
          },
        ],
      });

      if (bad !== "") {
        expect(text).not.toContain(bad);
      }

      expect(
        resolveAssets,
      ).not.toHaveBeenCalled();
    }
  });

  it("rejects a repeated fileId and any other query parameter (the contract is closed)", async () => {
    const cases: Array<[string, string]> =
      [
        [
          `?fileId=${FILE_ID}&fileId=${FILE_ID}`,
          "query.fileId",
        ],
        [
          `?fileId=${FILE_ID}&role=administrador`,
          "query",
        ],
        [
          "?userId=1",
          "query",
        ],
        [
          `?token=secret-value&fileId=${FILE_ID}`,
          "query",
        ],
      ];

    for (const [query, path] of cases) {
      const response =
        await handleResolveCsvRequest(
          request(
            query,
            "id,rawName\na,A\n",
          ),
          options,
        );

      const text =
        await response.text();

      expect(response.status).toBe(400);

      expect(
        JSON.parse(text).error.issues[0]
          .path,
      ).toBe(path);

      expect(text).not.toContain(
        "secret-value",
      );

      expect(text).not.toContain(
        "administrador",
      );
    }

    expect(
      resolveAssets,
    ).not.toHaveBeenCalled();
  });

  it("validates the query only after authorization: a denied request is not told about its query", async () => {
    const response =
      await handleResolveCsvRequest(
        request("?role=admin", "x"),
        {
          ...options,

          authorizer: {
            authorize: async () => ({
              authorized: false,

              reason:
                "unauthenticated",
            }),
          },
        },
      );

    expect(response.status).toBe(401);
  });

  it("shares its limits with the UI: the byte and row limits come from one browser-safe module", () => {
    expect(MAX_CSV_BODY_BYTES).toBe(
      MAX_CSV_UPLOAD_BYTES,
    );

    expect(MAX_BATCH_SIZE).toBe(
      MAX_PORTFOLIO_ROWS,
    );

    expect(MAX_CSV_UPLOAD_BYTES).toBe(
      512 * 1024,
    );

    expect(MAX_PORTFOLIO_ROWS).toBe(100);
  });
});
