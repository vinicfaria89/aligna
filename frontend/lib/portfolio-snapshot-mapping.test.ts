import {
  describe,
  expect,
  it,
} from "vitest";

import type { PreviewRow } from "./aie/client/portfolio-csv-preview";
import type { ResolvedItemView } from "./aie/client/resolve-csv-client";
import {
  parseSavedSnapshot,
  parseSnapshotHistoryEntry,
  parseSnapshotHistoryList,
  SNAPSHOT_LIMITS,
  SNAPSHOT_STATUSES,
  toDisplayRows,
  toSnapshotItems,
} from "./portfolio-snapshot-mapping";

/**
 * TASK-029B: what the screen sends to the Planejador's saved-result endpoint, and how
 * it reads the answer. Pure functions: no network, no storage.
 */

const CONTRACT_KEYS = [
  "lineNumber",
  "rawName",
  "assetType",
  "ticker",
  "code",
  "amount",
  "currency",
  "status",
  "pendingFields",
  "sources",
  "verifiedAsset",
];

function row(overrides: Partial<PreviewRow> = {}): PreviewRow {
  return {
    row: 2,

    // Internal candidate id: must never leave the browser.
    candidateId: "portfolio:f0123456789abcdef:2",

    rawName: "DEB PETROBRAS SERIE 1",

    assetType: "debenture",

    instrumentCode: "ABCD11",

    amount: 98765.43,

    currency: "BRL",

    ...overrides,
  };
}

function item(overrides: Partial<ResolvedItemView> = {}): ResolvedItemView {
  return {
    index: 0,

    candidateAssetId: "portfolio:f0123456789abcdef:2",

    kind: "resolved",

    status: "needs-more-evidence",

    unresolvedFields: ["identity", "issuer"],

    sources: ["anbima"],

    failedSources: ["SENTINEL-FAILED-PROVIDER"],

    ...overrides,
  };
}

describe("toSnapshotItems: what is sent", () => {
  it("maps unresolvedFields to pendingFields and instrumentCode to code", () => {
    const [saved] = toSnapshotItems([item()], [row()]);

    expect(saved).toEqual({
      lineNumber: 2,
      rawName: "DEB PETROBRAS SERIE 1",
      assetType: "debenture",
      code: "ABCD11",
      amount: 98765.43,
      currency: "BRL",
      status: "needs-more-evidence",
      pendingFields: ["identity", "issuer"],
      sources: ["anbima"],
    });
  });

  it("maps canonicalAssetId to verifiedAsset.code (with the type and the currency)", () => {
    const [saved] = toSnapshotItems(
      [
        item({
          status: "verified",
          unresolvedFields: [],
          verifiedAsset: {
            canonicalAssetId: "ABCD11",
            assetType: "debenture",
            currency: "BRL",
            amount: 555,
          },
        }),
      ],
      [row()],
    );

    expect(saved?.status).toBe("verified");

    expect(saved?.verifiedAsset).toEqual({
      code: "ABCD11",
      type: "debenture",
      currency: "BRL",
    });

    // Only code/type/currency: the verified amount is not part of the contract.
    expect(Object.keys(saved?.verifiedAsset ?? {}).sort()).toEqual([
      "code",
      "currency",
      "type",
    ]);
  });

  it("preserves an item that could not be resolved as status item-error", () => {
    const [saved] = toSnapshotItems(
      [
        item({
          kind: "item-error",
          status: undefined,
          unresolvedFields: [],
          sources: [],
          itemErrorCode: "AIE_INTERNAL_ERROR",
        }),
      ],
      [row()],
    );

    expect(saved?.status).toBe("item-error");

    expect(JSON.stringify(saved)).not.toContain("AIE_INTERNAL_ERROR");
  });

  it("sends ticker and code separately, and leaves out what the row does not have", () => {
    const [saved] = toSnapshotItems(
      [item({ unresolvedFields: [], sources: [] })],
      [
        row({
          ticker: "PETR4",
          instrumentCode: undefined,
          amount: undefined,
          currency: undefined,
          assetType: undefined,
        }),
      ],
    );

    expect(saved).toEqual({
      lineNumber: 2,
      rawName: "DEB PETROBRAS SERIE 1",
      ticker: "PETR4",
      status: "needs-more-evidence",
      pendingFields: [],
      sources: [],
    });
  });

  it("contains ONLY contract keys, and none of the internal or sensitive values", () => {
    const payload = toSnapshotItems(
      [
        item({
          status: "verified",
          verifiedAsset: {
            canonicalAssetId: "ABCD11",
            assetType: "debenture",
            currency: "BRL",
          },
        }),
      ],
      [row()],
    );

    for (const saved of payload) {
      for (const key of Object.keys(saved)) {
        expect(CONTRACT_KEYS).toContain(key);
      }
    }

    const text = JSON.stringify(payload);

    for (const forbidden of [
      "portfolio:",
      "f0123456789abcdef",
      "candidateAssetId",
      "candidateId",
      "index",
      "failedSources",
      "SENTINEL-FAILED-PROVIDER",
      "fileId",
      "fileName",
      "evidence",
      "metadata",
      "token",
      "Bearer",
      "correlation",
      "csv",
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("replaces control characters with a space and trims, like the Planejador expects", () => {
    const [saved] = toSnapshotItems(
      [item()],
      [row({ rawName: "  CDB\nBanco\tX\x00Y  " })],
    );

    expect(saved?.rawName).toBe("CDB Banco X Y");
  });

  it("cuts texts to the Planejador's limits", () => {
    const [saved] = toSnapshotItems(
      [item({ sources: ["s".repeat(200)] })],
      [
        row({
          rawName: "N".repeat(400),
          assetType: "A".repeat(100),
          ticker: "T".repeat(50),
          instrumentCode: "C".repeat(100),
          currency: "BRLBRLBRLBRL",
        }),
      ],
    );

    expect(saved?.rawName).toHaveLength(SNAPSHOT_LIMITS.rawName);
    expect(saved?.assetType).toHaveLength(SNAPSHOT_LIMITS.assetType);
    expect(saved?.ticker).toHaveLength(SNAPSHOT_LIMITS.ticker);
    expect(saved?.code).toHaveLength(SNAPSHOT_LIMITS.code);
    expect(saved?.currency).toHaveLength(SNAPSHOT_LIMITS.currency);
    expect(saved?.sources[0]).toHaveLength(SNAPSHOT_LIMITS.listEntry);
  });

  it("caps and de-duplicates the lists (at most 20 entries)", () => {
    const [saved] = toSnapshotItems(
      [
        item({
          unresolvedFields: [
            ...Array.from({ length: 30 }, (_, i) => `f${i}`),
            "f0",
          ],
          sources: ["a", "a", "b"],
        }),
      ],
      [row()],
    );

    expect(saved?.pendingFields).toHaveLength(SNAPSHOT_LIMITS.listLength);
    expect(saved?.sources).toEqual(["a", "b"]);
  });

  it("leaves out an item it cannot show again instead of sending it invalid", () => {
    const items = [
      item({ index: 0 }), // fine
      item({ index: 7 }), // no matching row
      item({ index: 1, status: "inventado" as never }), // unknown status
      item({ index: 2 }), // empty name after cleaning
      item({ index: 3 }), // invalid line number
    ];

    const rows = [
      row({ row: 2 }),
      row({ row: 4 }),
      row({ row: 5, rawName: " \n\t " }),
      row({ row: 0 }),
    ];

    const saved = toSnapshotItems(items, rows);

    expect(saved.map((s) => s.lineNumber)).toEqual([2]);
  });

  it("drops a non-finite or absurd amount and keeps the rest of the item", () => {
    for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, 1e16]) {
      const [saved] = toSnapshotItems([item()], [row({ amount })]);

      expect(saved).toBeDefined();
      expect(saved).not.toHaveProperty("amount");
    }
  });

  it("only sends a verified asset that has all three fields", () => {
    const [saved] = toSnapshotItems(
      [
        item({
          status: "verified",
          verifiedAsset: {
            canonicalAssetId: "ABCD11",
            assetType: "",
            currency: "BRL",
          },
        }),
      ],
      [row()],
    );

    expect(saved).not.toHaveProperty("verifiedAsset");
  });

  it("never sends more than 100 items, and an empty result means nothing to save", () => {
    const many = Array.from({ length: 130 }, (_, index) =>
      item({ index }),
    );

    const rows = Array.from({ length: 130 }, (_, i) =>
      row({ row: i + 2, rawName: `ATIVO ${i}` }),
    );

    expect(toSnapshotItems(many, rows)).toHaveLength(SNAPSHOT_LIMITS.items);

    expect(toSnapshotItems([], [])).toEqual([]);
  });

  it("accepts every status of the contract", () => {
    for (const status of SNAPSHOT_STATUSES.filter((s) => s !== "item-error")) {
      const [saved] = toSnapshotItems([item({ status })], [row()]);

      expect(saved?.status).toBe(status);
    }
  });
});

describe("parseSavedSnapshot: what is read back", () => {
  const good = {
    items: [
      {
        lineNumber: 2,
        rawName: "DEB PETROBRAS SERIE 1",
        assetType: "debenture",
        code: "ABCD11",
        amount: 98765.43,
        currency: "BRL",
        status: "verified",
        pendingFields: [],
        sources: ["anbima"],
        verifiedAsset: { code: "ABCD11", type: "debenture", currency: "BRL" },
      },
      {
        lineNumber: 3,
        rawName: "Petrobras PN",
        status: "needs-more-evidence",
        pendingFields: ["issuer"],
        sources: [],
      },
    ],
    updatedAt: "2026-09-21T14:32:00+00:00",
  };

  it("reads a valid answer", () => {
    const snapshot = parseSavedSnapshot(good);

    expect(snapshot?.updatedAt).toBe("2026-09-21T14:32:00+00:00");
    expect(snapshot?.items).toHaveLength(2);
    expect(snapshot?.items[0]?.verifiedAsset?.code).toBe("ABCD11");
    expect(snapshot?.items[1]?.pendingFields).toEqual(["issuer"]);
  });

  it("keeps only contract fields (anything extra is dropped)", () => {
    const snapshot = parseSavedSnapshot({
      ...good,
      user_id: "SENTINEL-USER",
      items: [
        {
          ...good.items[0],
          id: "SENTINEL-ID",
          evidence: [{ value: "SENTINEL-EVIDENCE" }],
          candidateAssetId: "portfolio:x:2",
        },
      ],
    });

    const text = JSON.stringify(snapshot);

    for (const leaked of ["SENTINEL", "portfolio:", "user_id", "evidence"]) {
      expect(text).not.toContain(leaked);
    }
  });

  it("refuses anything malformed as a whole (never a half result)", () => {
    const bad: unknown[] = [
      null,
      "text",
      [],
      {},
      { items: [], updatedAt: "2026-09-21T00:00:00Z" },
      { items: "x", updatedAt: "2026-09-21T00:00:00Z" },
      { items: good.items },
      { items: good.items, updatedAt: 5 },
      { ...good, items: [{ ...good.items[0], status: "inventado" }] },
      { ...good, items: [{ ...good.items[0], lineNumber: "2" }] },
      { ...good, items: [{ ...good.items[0], lineNumber: 2.5 }] },
      { ...good, items: [{ ...good.items[0], rawName: "" }] },
      { ...good, items: [{ ...good.items[0], rawName: 5 }] },
      { ...good, items: [good.items[0], null] },
      {
        ...good,
        items: Array.from({ length: 101 }, () => good.items[0]),
      },
    ];

    for (const body of bad) {
      expect(parseSavedSnapshot(body)).toBeNull();
    }
  });

  it("drops a malformed optional field instead of failing the whole answer", () => {
    const snapshot = parseSavedSnapshot({
      ...good,
      items: [
        {
          ...good.items[0],
          amount: "1000",
          verifiedAsset: { code: "X" },
          pendingFields: "not-a-list",
        },
      ],
    });

    const [saved] = snapshot?.items ?? [];

    expect(saved).not.toHaveProperty("amount");
    expect(saved).not.toHaveProperty("verifiedAsset");
    expect(saved?.pendingFields).toEqual([]);
  });
});

describe("parseSnapshotHistoryEntry / parseSnapshotHistoryList (TASK-048B)", () => {
  const goodEntry = {
    id: "11111111-1111-1111-1111-111111111111",
    createdAt: "2026-09-21T14:32:00+00:00",
    updatedAt: "2026-09-21T14:32:00+00:00",
    items: [
      {
        lineNumber: 2,
        rawName: "DEB PETROBRAS SERIE 1",
        status: "verified",
        pendingFields: [],
        sources: ["anbima"],
        verifiedAsset: { code: "ABCD11", type: "debenture", currency: "BRL" },
      },
    ],
  };

  it("reads a valid entry, with id and createdAt", () => {
    const entry = parseSnapshotHistoryEntry(goodEntry);

    expect(entry?.id).toBe(goodEntry.id);
    expect(entry?.createdAt).toBe(goodEntry.createdAt);
    expect(entry?.updatedAt).toBe(goodEntry.updatedAt);
    expect(entry?.items).toHaveLength(1);
  });

  it("refuses an entry with no id, an empty id, no createdAt, or malformed items", () => {
    for (const bad of [
      { ...goodEntry, id: undefined },
      { ...goodEntry, id: "" },
      { ...goodEntry, id: 5 },
      { ...goodEntry, createdAt: undefined },
      { ...goodEntry, items: "x" },
      { ...goodEntry, items: [{ ...goodEntry.items[0], status: "inventado" }] },
      null,
      "text",
      {},
    ]) {
      expect(parseSnapshotHistoryEntry(bad)).toBeNull();
    }
  });

  it("keeps only contract fields (anything extra is dropped)", () => {
    const entry = parseSnapshotHistoryEntry({
      ...goodEntry,
      user_id: "SENTINEL-USER",
      correlationId: "SENTINEL-CORRELATION",
    });

    const text = JSON.stringify(entry);

    for (const leaked of ["SENTINEL"]) {
      expect(text).not.toContain(leaked);
    }
  });

  it("lists every valid entry, most-recent-first order preserved as given", () => {
    const second = { ...goodEntry, id: "22222222-2222-2222-2222-222222222222", createdAt: "2026-09-20T10:00:00+00:00" };

    const list = parseSnapshotHistoryList([goodEntry, second]);

    expect(list?.map((e) => e.id)).toEqual([goodEntry.id, second.id]);
  });

  it("an empty array is a valid (empty) list", () => {
    expect(parseSnapshotHistoryList([])).toEqual([]);
  });

  it("refuses anything that is not an array, or with one malformed entry (all-or-nothing)", () => {
    for (const bad of [null, "text", {}, [goodEntry, { ...goodEntry, id: "" }]]) {
      expect(parseSnapshotHistoryList(bad)).toBeNull();
    }
  });
});

describe("toDisplayRows: the saved result as the results table expects it", () => {
  it("builds rows with the saved line, name, status, pending fields and verified asset", () => {
    const rows = toDisplayRows({
      updatedAt: "2026-09-21T14:32:00Z",
      items: [
        {
          lineNumber: 2,
          rawName: "DEB",
          status: "verified",
          pendingFields: [],
          sources: ["anbima"],
          verifiedAsset: { code: "ABCD11", type: "debenture", currency: "BRL" },
        },
        {
          lineNumber: 5,
          rawName: "Petrobras PN",
          status: "needs-more-evidence",
          pendingFields: ["issuer"],
          sources: [],
        },
        {
          lineNumber: 6,
          rawName: "BROKEN",
          status: "item-error",
          pendingFields: [],
          sources: [],
        },
      ],
    });

    expect(rows.map((r) => [r.line, r.name])).toEqual([
      [2, "DEB"],
      [5, "Petrobras PN"],
      [6, "BROKEN"],
    ]);

    expect(rows[0]?.item.kind).toBe("resolved");
    expect(rows[0]?.item.status).toBe("verified");
    expect(rows[0]?.item.verifiedAsset?.canonicalAssetId).toBe("ABCD11");
    expect(rows[1]?.item.unresolvedFields).toEqual(["issuer"]);
    expect(rows[2]?.item.kind).toBe("item-error");

    expect(new Set(rows.map((r) => r.key)).size).toBe(3);
  });

  it("carries the saved type, ticker/code, amount and currency, and only when they exist (TASK-030)", () => {
    const rows = toDisplayRows({
      updatedAt: "2026-09-21T14:32:00Z",
      items: [
        {
          lineNumber: 2,
          rawName: "FULL",
          assetType: "debenture",
          code: "ABCD11",
          amount: 98765.43,
          currency: "BRL",
          status: "needs-more-evidence",
          pendingFields: [],
          sources: [],
        },
        {
          lineNumber: 3,
          rawName: "TICKER WINS",
          ticker: "PETR4",
          code: "OTHER-CODE",
          status: "needs-more-evidence",
          pendingFields: [],
          sources: [],
        },
        {
          lineNumber: 4,
          rawName: "NOTHING EXTRA",
          status: "needs-more-evidence",
          pendingFields: [],
          sources: [],
        },
      ],
    });

    expect(rows[0]).toMatchObject({
      assetType: "debenture",
      code: "ABCD11",
      amount: 98765.43,
      currency: "BRL",
    });

    // The same rule as the preview: the ticker, else the instrument code.
    expect(rows[1]?.code).toBe("PETR4");

    // Absent fields are absent (no empty strings, no placeholders).
    for (const key of ["assetType", "code", "amount", "currency"]) {
      expect(rows[2]).not.toHaveProperty(key);
    }
  });

  it("invents no internal ids", () => {
    const rows = toDisplayRows({
      updatedAt: "2026-09-21T14:32:00Z",
      items: [
        {
          lineNumber: 2,
          rawName: "DEB",
          status: "verified",
          pendingFields: [],
          sources: [],
        },
      ],
    });

    expect(JSON.stringify(rows)).not.toContain("portfolio:");
  });
});
