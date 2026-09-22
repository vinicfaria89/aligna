// @vitest-environment jsdom
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  downloadCsvFile,
  resultExportFileName,
  snapshotItemsToResultCsv,
} from "./portfolio-snapshot-export";

import type { SnapshotItem } from "./portfolio-snapshot-mapping";

/** TASK-040: SnapshotItem -> CSV text, and the browser download trigger. */

function item(
  overrides: Partial<SnapshotItem> = {},
): SnapshotItem {
  return {
    lineNumber: 2,

    rawName: "DEB PETROBRAS SERIE 1",

    assetType: "debenture",

    ticker: undefined,

    code: "ABCD11",

    amount: 98765.43,

    currency: "BRL",

    status: "needs-more-evidence",

    pendingFields: ["identity", "issuer"],

    sources: ["anbima"],

    ...overrides,
  };
}

describe("snapshotItemsToResultCsv", () => {
  it("the header row has the exact expected columns", () => {
    const csv = snapshotItemsToResultCsv(
      [],
    );

    expect(csv).toBe(
      "linha,ativo,tipo,ticker_ou_codigo,valor,moeda,situacao,campos_pendentes,fontes,codigo_verificado,tipo_verificado,moeda_verificada",
    );
  });

  it("a full item's row has linha, ativo, tipo, ticker/código, valor, moeda and situação", () => {
    const csv = snapshotItemsToResultCsv(
      [item()],
    );

    const [, dataLine] = csv.split(
      "\r\n",
    );

    expect(dataLine).toBe(
      "2,DEB PETROBRAS SERIE 1,debenture,ABCD11,98765.43,BRL,Precisa de mais evidências,identity; issuer,anbima,,,",
    );
  });

  it("ticker takes priority over code when both are present", () => {
    const csv = snapshotItemsToResultCsv(
      [
        item({
          ticker: "PETR4",

          code: "PETR4-CODE",
        }),
      ],
    );

    expect(csv).toContain(
      ",PETR4,",
    );

    expect(csv).not.toContain(
      "PETR4-CODE",
    );
  });

  it("missing fields become empty cells, not the word undefined or null", () => {
    const csv = snapshotItemsToResultCsv(
      [
        {
          lineNumber: 3,

          rawName: "Ativo Sem Extras",

          status: "verified",

          pendingFields: [],

          sources: [],
        },
      ],
    );

    const [, dataLine] = csv.split(
      "\r\n",
    );

    expect(dataLine).toBe(
      "3,Ativo Sem Extras,,,,,Verificado,,,,,",
    );

    expect(csv).not.toContain(
      "undefined",
    );

    expect(csv).not.toContain(
      "null",
    );
  });

  it("every status label matches what the screen already shows", () => {
    const labels: Record<
      SnapshotItem["status"],
      string
    > = {
      verified: "Verificado",

      "needs-more-evidence":
        "Precisa de mais evidências",

      "needs-user":
        "Precisa da sua confirmação",

      conflict:
        "Evidências em conflito",

      blocked: "Bloqueado",

      "item-error":
        "Erro ao resolver",
    };

    for (const [status, label] of Object.entries(
      labels,
    ) as Array<
      [SnapshotItem["status"], string]
    >) {
      const csv = snapshotItemsToResultCsv(
        [
          item({
            status,

            pendingFields: [],

            sources: [],
          }),
        ],
      );

      expect(csv).toContain(label);
    }
  });

  it("escapes values with commas, quotes and newlines the same way the rest of the app does", () => {
    const csv = snapshotItemsToResultCsv(
      [
        item({
          rawName:
            'Ativo, com vírgula e "aspas"\ne quebra de linha',

          pendingFields: [],

          sources: [],
        }),
      ],
    );

    expect(csv).toContain(
      '"Ativo, com vírgula e ""aspas""\ne quebra de linha"',
    );
  });

  it("pendingFields and sources are joined with '; ', predictably and in order", () => {
    const csv = snapshotItemsToResultCsv(
      [
        item({
          pendingFields: [
            "identity",

            "issuer",

            "maturityDate",
          ],

          sources: ["anbima", "cvm"],
        }),
      ],
    );

    expect(csv).toContain(
      "identity; issuer; maturityDate",
    );

    expect(csv).toContain(
      "anbima; cvm",
    );
  });

  it("includes the verified asset's code, type and currency only when present", () => {
    const csv = snapshotItemsToResultCsv(
      [
        item({
          status: "verified",

          pendingFields: [],

          sources: ["anbima"],

          verifiedAsset: {
            code: "ABCD11",

            type: "debenture",

            currency: "BRL",
          },
        }),
      ],
    );

    const [, dataLine] = csv.split(
      "\r\n",
    );

    expect(dataLine.endsWith(
      "ABCD11,debenture,BRL",
    )).toBe(true);
  });

  it("never includes a token, correlation id, fileId, an internal portfolio: id, provider evidence or a file name -- SnapshotItem never carries any of them", () => {
    const csv = snapshotItemsToResultCsv(
      [
        item({
          rawName: "Ativo Normal",
        }),
        // A malformed/hostile object cast into the type: even then, only the
        // named fields are ever read.
        {
          lineNumber: 4,

          rawName: "Ativo Hostil",

          status: "verified",

          pendingFields: [],

          sources: [],

          // The `as SnapshotItem` cast below deliberately bypasses excess-property
          // checking so these fields (none part of SnapshotItem) type-check anyway
          // -- the point of the test is that the export function ignores them.
          token: "SENTINEL-TOKEN",

          correlationId: "corr-SENTINEL",

          fileId: "SENTINEL-FILE-ID",

          id: "portfolio:SENTINEL:2",

          fileName: "minha-carteira-secreta.xlsx",

          evidence: [
            { value: "SECRET-EVIDENCE" },
          ],
        } as SnapshotItem,
      ],
    );

    for (const forbidden of [
      "SENTINEL-TOKEN",
      "corr-SENTINEL",
      "SENTINEL-FILE-ID",
      "portfolio:SENTINEL",
      "minha-carteira-secreta",
      "SECRET-EVIDENCE",
      "Bearer",
    ]) {
      expect(csv).not.toContain(
        forbidden,
      );
    }
  });

  it("never touches console or storage", () => {
    const spies = (
      [
        "log",
        "info",
        "warn",
        "error",
        "debug",
      ] as const
    ).map((method) => {
      const original =
        console[method];

      console[method] = () => {
        throw new Error(
          `console.${method} was called`,
        );
      };

      return () => {
        console[method] = original;
      };
    });

    try {
      snapshotItemsToResultCsv([
        item(),
      ]);

      expect(
        window.localStorage.length,
      ).toBe(0);

      expect(
        window.sessionStorage
          .length,
      ).toBe(0);
    } finally {
      spies.forEach((restore) =>
        restore(),
      );
    }
  });
});

describe("resultExportFileName", () => {
  it("formats as resultado-carteira-YYYY-MM-DD.csv, with no portfolio data in it", () => {
    expect(
      resultExportFileName(
        new Date(2026, 8, 22),
      ),
    ).toBe(
      "resultado-carteira-2026-09-22.csv",
    );
  });

  it("pads single-digit months and days", () => {
    expect(
      resultExportFileName(
        new Date(2026, 0, 5),
      ),
    ).toBe(
      "resultado-carteira-2026-01-05.csv",
    );
  });
});

describe("downloadCsvFile", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a Blob, an anchor with the right filename, clicks it once, and revokes the object URL", () => {
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue(
        "blob:sentinel-url",
      );

    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(
        () => undefined,
      );

    const clickSpy = vi.spyOn(
      HTMLAnchorElement.prototype,
      "click",
    ).mockImplementation(
      () => undefined,
    );

    downloadCsvFile(
      "resultado-carteira-2026-09-22.csv",
      "linha,ativo\r\n1,Exemplo",
    );

    expect(
      createObjectURL,
    ).toHaveBeenCalledTimes(1);

    const [blob] =
      createObjectURL.mock.calls[0] as [
        Blob,
      ];

    expect(blob.type).toBe(
      "text/csv;charset=utf-8",
    );

    expect(
      clickSpy,
    ).toHaveBeenCalledTimes(1);

    expect(
      revokeObjectURL,
    ).toHaveBeenCalledWith(
      "blob:sentinel-url",
    );

    expect(
      document.querySelectorAll(
        "a[download]",
      ),
    ).toHaveLength(0);
  });

  it("uses the exact filename given, and never fetches or stores anything", async () => {
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue(
        "blob:sentinel-url-2",
      );

    vi.spyOn(
      URL,
      "revokeObjectURL",
    ).mockImplementation(
      () => undefined,
    );

    let downloadAttr: string | null =
      null;

    vi.spyOn(
      HTMLAnchorElement.prototype,
      "click",
    ).mockImplementation(
      function (
        this: HTMLAnchorElement,
      ) {
        downloadAttr =
          this.download;
      },
    );

    const fetchSpy = vi.fn();

    vi.stubGlobal(
      "fetch",
      fetchSpy,
    );

    downloadCsvFile(
      "resultado-carteira-2026-09-22.csv",
      "linha,ativo\r\n1,Exemplo",
    );

    expect(downloadAttr).toBe(
      "resultado-carteira-2026-09-22.csv",
    );

    expect(
      fetchSpy,
    ).not.toHaveBeenCalled();

    expect(
      window.localStorage.length,
    ).toBe(0);

    expect(
      window.sessionStorage.length,
    ).toBe(0);

    expect(createObjectURL).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
