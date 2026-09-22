// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import PortfolioCsvResolver from "./PortfolioCsvResolver";
import { fakeSnapshotClient } from "./portfolio-snapshot-test-support";

import type { SubmitPortfolioCsvInput } from "@/lib/aie/client/resolve-csv-client";

/**
 * TASK-040: CSV export of the portfolio result. The export function itself
 * (SnapshotItem[] -> CSV text) is unit-tested in lib/portfolio-snapshot-export.test.ts;
 * this file covers the UI wiring: when the button appears, that clicking it
 * downloads (never fetches, never saves, never touches storage), and that it
 * works for both a freshly resolved result and a loaded saved one.
 */

const TOKEN = "sentinel-export-token";

const CSV_TEXT = [
  "rawName,assetType,instrumentCode,amount,currency",
  "DEB PETROBRAS SERIE 1,debenture,ABCD11,98765.43,BRL",
].join("\n");

function csvFile(
  content = CSV_TEXT,
  name = "carteira.csv",
): File {
  return new File([content], name, {
    type: "text/csv",

    lastModified: 1_700_000_000_000,
  });
}

function ok(items: unknown[]): Response {
  return new Response(
    JSON.stringify({
      ok: true,

      result: { items },
    }),
    {
      status: 200,

      headers: {
        "x-correlation-id": "corr-export-1",
      },
    },
  );
}

function resolvedItem(
  index: number,
  extra: Record<string, unknown> = {},
) {
  return {
    index,

    candidateAssetId: `portfolio-id-${index}`,

    ok: true,

    result: {
      status: "needs-more-evidence",

      verifiedAsset: null,

      investigation: {
        evidence: [],

        searches: [],

        unresolvedFields: ["identity"],
      },

      ...extra,
    },
  };
}

const SAVED_SNAPSHOT = {
  items: [
    {
      lineNumber: 2,

      rawName: "SAVED ALPHA",

      status: "verified" as const,

      pendingFields: [],

      sources: ["anbima"],

      verifiedAsset: {
        code: "ABCD11",

        type: "debenture",

        currency: "BRL",
      },
    },
  ],

  updatedAt: "2026-09-22T15:00:00.000Z",
};

type FetchImpl = NonNullable<
  SubmitPortfolioCsvInput["fetchImpl"]
>;

function setup(
  respond: () => Response | Promise<Response> = () =>
    ok([resolvedItem(0)]),
  snapshotClient = fakeSnapshotClient(),
) {
  const fetchImpl = vi.fn<FetchImpl>(
    async () => respond(),
  );

  const getSession = vi.fn<
    SubmitPortfolioCsvInput["getSession"]
  >(async () => ({
    status: "ok" as const,

    accessToken: TOKEN,
  }));

  const clearSession = vi.fn();

  const user = userEvent.setup();

  render(
    <PortfolioCsvResolver
      snapshotClient={snapshotClient}
      getSession={getSession}
      clearSession={clearSession}
      fetchImpl={fetchImpl}
    />,
  );

  return {
    fetchImpl,
    getSession,
    clearSession,
    user,
    snapshotClient,
  };
}

function fileInput(): HTMLInputElement {
  return screen.getByLabelText(
    "Arquivo CSV ou Excel da carteira",
  );
}

function resolveButton(): HTMLElement {
  return screen.getByRole("button", {
    name: /resolver carteira|resolvendo/i,
  });
}

function exportButtons(): HTMLElement[] {
  return screen.queryAllByRole(
    "button",
    { name: /exportar csv/i },
  );
}

/** Spies the download trigger's DOM/Blob side effects; returns a way to read
 * the exact CSV text that was about to be downloaded. */
function spyOnDownload() {
  const createObjectURL = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValue(
      "blob:sentinel-export-url",
    );

  vi.spyOn(
    URL,
    "revokeObjectURL",
  ).mockImplementation(
    () => undefined,
  );

  let downloadedName: string | null =
    null;

  vi.spyOn(
    HTMLAnchorElement.prototype,
    "click",
  ).mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloadedName = this.download;
  });

  return {
    async text(): Promise<string> {
      const blob = createObjectURL
        .mock.calls.at(-1)?.[0] as
        | Blob
        | undefined;

      return blob
        ? blob.text()
        : "";
    },

    filename(): string | null {
      return downloadedName;
    },

    calls(): number {
      return createObjectURL.mock
        .calls.length;
    },
  };
}

describe("PortfolioCsvResolver: export CSV (TASK-040)", () => {
  beforeEach(() => {
    window.localStorage.clear();

    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();

    vi.restoreAllMocks();
  });

  it("no export button before any file is chosen or any saved result exists", () => {
    setup();

    expect(exportButtons()).toHaveLength(
      0,
    );
  });

  it("the export button appears after a fresh resolution with an exportable result", async () => {
    const { user } = setup(() =>
      ok([resolvedItem(0)]),
    );

    await user.upload(
      fileInput(),
      csvFile(),
    );

    await screen.findByRole("table");

    await user.click(resolveButton());

    await screen.findByRole("table", {
      name: /resultado/i,
    });

    expect(
      exportButtons(),
    ).toHaveLength(1);
  });

  it("the export button appears for a saved result loaded on open, with no file chosen at all", async () => {
    const snapshotClient = fakeSnapshotClient(
      {
        load: vi.fn(async () => ({
          kind: "found" as const,

          snapshot: SAVED_SNAPSHOT,
        })),
      },
    );

    setup(() => ok([]), snapshotClient);

    await screen.findByRole("region", {
      name: "Resultado salvo",
    });

    expect(
      exportButtons(),
    ).toHaveLength(1);
  });

  it("clicking export downloads a CSV with the resolved result's data, calling neither fetch nor save/remove", async () => {
    const snapshotClient = fakeSnapshotClient();

    const { user, fetchImpl } = setup(
      () =>
        ok([
          resolvedItem(0, {
            status: "verified",

            verifiedAsset: {
              canonicalAssetId:
                "ABCD11",

              assetType: "debenture",

              currency: "BRL",

              amount: 98765.43,
            },
          }),
        ]),
      snapshotClient,
    );

    await user.upload(
      fileInput(),
      csvFile(),
    );

    await screen.findByRole("table");

    await user.click(resolveButton());

    await screen.findByRole("table", {
      name: /resultado/i,
    });

    const download = spyOnDownload();

    await user.click(
      screen.getByRole("button", {
        name: /exportar csv/i,
      }),
    );

    expect(download.calls()).toBe(1);

    expect(download.filename()).toMatch(
      /^resultado-carteira-\d{4}-\d{2}-\d{2}\.csv$/,
    );

    const csvOut = await download.text();

    expect(csvOut.split("\r\n")[0]).toBe(
      "linha,ativo,tipo,ticker_ou_codigo,valor,moeda,situacao,campos_pendentes,fontes,codigo_verificado,tipo_verificado,moeda_verificada",
    );

    expect(csvOut).toContain(
      "DEB PETROBRAS SERIE 1",
    );

    expect(csvOut).toContain(
      "ABCD11,debenture,BRL",
    );

    // fetchImpl is called once for the resolution itself; exporting adds no
    // network call, and never touches the saved-result client.
    expect(
      fetchImpl,
    ).toHaveBeenCalledTimes(1);

    expect(
      snapshotClient.save,
    ).not.toHaveBeenCalled();

    expect(
      snapshotClient.remove,
    ).not.toHaveBeenCalled();
  });

  it("clicking export on a saved result downloads its data, calling neither fetch nor save/remove, and never uses console or storage", async () => {
    const snapshotClient = fakeSnapshotClient(
      {
        load: vi.fn(async () => ({
          kind: "found" as const,

          snapshot: SAVED_SNAPSHOT,
        })),
      },
    );

    const { user, fetchImpl } = setup(
      () => ok([]),
      snapshotClient,
    );

    await screen.findByRole("region", {
      name: "Resultado salvo",
    });

    const download = spyOnDownload();

    const spies = (
      [
        "log",
        "info",
        "warn",
        "error",
        "debug",
      ] as const
    ).map((method) =>
      vi
        .spyOn(console, method)
        .mockImplementation(
          () => undefined,
        ),
    );

    await user.click(
      screen.getByRole("button", {
        name: /exportar csv/i,
      }),
    );

    expect(download.calls()).toBe(1);

    const csvOut = await download.text();

    expect(csvOut).toContain(
      "SAVED ALPHA",
    );

    expect(
      fetchImpl,
    ).not.toHaveBeenCalled();

    expect(
      snapshotClient.save,
    ).not.toHaveBeenCalled();

    expect(
      snapshotClient.remove,
    ).not.toHaveBeenCalled();

    for (const spy of spies) {
      expect(
        spy,
      ).not.toHaveBeenCalled();
    }

    expect(
      JSON.stringify({
        ...window.localStorage,

        ...window.sessionStorage,
      }),
    ).not.toContain("SAVED ALPHA");
  });

  it('"Limpar" removes the export button when there is no saved result', async () => {
    const { user } = setup(() =>
      ok([resolvedItem(0)]),
    );

    await user.upload(
      fileInput(),
      csvFile(),
    );

    await screen.findByRole("table");

    await user.click(resolveButton());

    await screen.findByRole("table", {
      name: /resultado/i,
    });

    expect(
      exportButtons(),
    ).toHaveLength(1);

    await user.click(
      screen.getByRole("button", {
        name: /^limpar$/i,
      }),
    );

    expect(
      exportButtons(),
    ).toHaveLength(0);
  });

  it("deleting the saved result removes its export button when nothing else is on screen", async () => {
    const snapshotClient = fakeSnapshotClient(
      {
        load: vi.fn(async () => ({
          kind: "found" as const,

          snapshot: SAVED_SNAPSHOT,
        })),

        remove: vi.fn(async () => ({
          kind: "deleted" as const,
        })),
      },
    );

    const { user } = setup(
      () => ok([]),
      snapshotClient,
    );

    await screen.findByRole("region", {
      name: "Resultado salvo",
    });

    expect(
      exportButtons(),
    ).toHaveLength(1);

    await user.click(
      screen.getByRole("button", {
        name: /apagar resultado salvo/i,
      }),
    );

    await user.click(
      screen.getByRole("button", {
        name: /^sim, apagar$/i,
      }),
    );

    await screen.findByText(
      /resultado salvo apagado/i,
    );

    expect(
      exportButtons(),
    ).toHaveLength(0);
  });

});
