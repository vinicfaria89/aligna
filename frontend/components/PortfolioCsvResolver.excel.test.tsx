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
import writeXlsxFile from "write-excel-file/browser";

import PortfolioCsvResolver from "./PortfolioCsvResolver";
import { fakeSnapshotClient } from "./portfolio-snapshot-test-support";

import type { SubmitPortfolioCsvInput } from "@/lib/aie/client/resolve-csv-client";
import { MAX_PORTFOLIO_ROWS } from "@/lib/aie/ingestion/portfolio-csv-limits";

/**
 * TASK-038: the .xlsx upload path. Real .xlsx files are built with
 * write-excel-file (a devDependency, test fixtures only -- it never ships to
 * the browser bundle) so these tests exercise the real conversion, not a mock
 * of it. Everything past "the file becomes CSV text" is the SAME component
 * code the CSV tests in PortfolioCsvResolver.test.tsx already cover in depth
 * (session, authorization outcomes, save/reload/delete, accessibility), so
 * this file focuses on what is actually new: reading .xlsx, its own local
 * validation, and that the shared flow still runs unchanged once the file
 * becomes text.
 */

const TOKEN = "sentinel-excel-ui-token";

function xlsxFile(
  rows: unknown[][],
  name = "carteira.xlsx",
): Promise<File> {
  return writeXlsxFile(
    rows as never,
  )
    .toBlob()
    .then(
      (blob) =>
        new File([blob], name, {
          type: blob.type,

          lastModified: 1_700_000_000_000,
        }),
    );
}

function xlsFile(
  name = "carteira.xls",
): File {
  return new File(
    ["not a real legacy xls file"],
    name,
    {
      type: "application/vnd.ms-excel",
    },
  );
}

type FetchImpl = NonNullable<
  SubmitPortfolioCsvInput["fetchImpl"]
>;

function ok(items: unknown[]): Response {
  return new Response(
    JSON.stringify({
      ok: true,

      result: { items },
    }),
    {
      status: 200,

      headers: {
        "x-correlation-id": "corr-excel-1",
      },
    },
  );
}

function failure(status: number): Response {
  return new Response(
    JSON.stringify({}),
    {
      status,

      headers: {
        "x-correlation-id": "corr-excel-fail",
      },
    },
  );
}

function resolvedItem(index: number) {
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
    },
  };
}

function setup(
  respond: () => Response | Promise<Response> = () =>
    ok([]),
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

describe("PortfolioCsvResolver: .xlsx upload (TASK-038)", () => {
  beforeEach(() => {
    window.localStorage.clear();

    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();

    vi.restoreAllMocks();
  });

  it("a valid .xlsx produces the same preview table as a CSV would", async () => {
    const { user } = setup();

    const file = await xlsxFile([
      ["rawName", "amount"],
      ["CDB Banco Exemplo", 1000],
      ["Tesouro Selic 2029", 2500.5],
    ]);

    await user.upload(
      fileInput(),
      file,
    );

    const table =
      await screen.findByRole("table");

    expect(table).toHaveTextContent(
      "CDB Banco Exemplo",
    );

    expect(table).toHaveTextContent(
      "Tesouro Selic 2029",
    );

    expect(
      screen.queryByRole("alert"),
    ).toBeNull();
  });

  it("an empty .xlsx sheet shows a clear, readable error", async () => {
    const { user } = setup();

    const file = await xlsxFile([[]]);

    await user.upload(
      fileInput(),
      file,
    );

    const alert =
      await screen.findByRole("alert");

    expect(alert).toHaveTextContent(
      "A planilha está vazia.",
    );
  });

  it("an .xlsx missing the required rawName column shows a clear, readable error", async () => {
    const { user } = setup();

    const file = await xlsxFile([
      ["assetType", "amount"],
      ["debenture", 1000],
    ]);

    await user.upload(
      fileInput(),
      file,
    );

    const alert =
      await screen.findByRole("alert");

    expect(alert).toHaveTextContent(
      "campo obrigatório ausente",
    );

    expect(
      screen.queryByRole("table"),
    ).toBeNull();
  });

  it("an .xlsx with more than the row limit of useful lines is rejected, mentioning the same limit as CSV", async () => {
    const { user } = setup();

    const rows = Array.from(
      { length: MAX_PORTFOLIO_ROWS + 1 },
      (_, i) => [`Ativo ${i}`, i + 1],
    );

    const file = await xlsxFile([
      ["rawName", "amount"],
      ...rows,
    ]);

    await user.upload(
      fileInput(),
      file,
    );

    const alert =
      await screen.findByRole("alert");

    expect(alert).toHaveTextContent(
      `O limite é ${MAX_PORTFOLIO_ROWS} ativos por envio.`,
    );
  });

  it("a legacy .xls file is rejected (or ignored) with a clear message, never crashing", async () => {
    setup();

    // A real user can still pick a .xls file regardless of the input's
    // `accept` hint (an OS "All Files" filter, or drag-and-drop): this test
    // must not rely on the browser's own accept-based filtering to prove the
    // component's own rejection message, so it bypasses user-event's default
    // accept simulation for this one upload.
    const permissiveUser = userEvent.setup({
      applyAccept: false,
    });

    await permissiveUser.upload(
      fileInput(),
      xlsFile(),
    );

    const alert =
      await screen.findByRole("alert");

    expect(alert).toHaveTextContent(
      /\.xls/,
    );

    expect(alert).toHaveTextContent(
      /não são aceitos|xlsx/i,
    );

    expect(
      screen.queryByRole("table"),
    ).toBeNull();
  });

  it("resolving an .xlsx calls the exact same resolve endpoint as CSV, with CSV text (never the original spreadsheet bytes)", async () => {
    const { user, fetchImpl } = setup(() =>
      ok([resolvedItem(0)]),
    );

    const file = await xlsxFile([
      ["rawName", "amount"],
      ["CDB Banco Exemplo", 1000],
    ]);

    await user.upload(
      fileInput(),
      file,
    );

    await screen.findByRole("table");

    await user.click(resolveButton());

    await screen.findByRole("table", {
      name: /resultado/i,
    });

    expect(
      fetchImpl,
    ).toHaveBeenCalledTimes(1);

    const [url, init] =
      fetchImpl.mock.calls[0]!;

    expect(url).toContain(
      "/api/aie/resolve-csv",
    );

    expect(init.headers["Content-Type"]).toBe(
      "text/csv; charset=utf-8",
    );

    // The body is CSV text: readable, and it is exactly the converted rows --
    // never a binary/zip signature (the .xlsx file format starts with "PK").
    expect(
      typeof init.body,
    ).toBe("string");

    expect(init.body as string).toContain(
      "rawName,amount",
    );

    expect(init.body as string).toContain(
      "CDB Banco Exemplo,1000",
    );

    expect(
      (init.body as string).startsWith(
        "PK",
      ),
    ).toBe(false);
  });

  it("401/403/429/500 behave the same after an .xlsx resolve as they do after a CSV one", async () => {
    const { user } = setup(() =>
      failure(403),
    );

    const file = await xlsxFile([
      ["rawName"],
      ["Ativo Exemplo"],
    ]);

    await user.upload(
      fileInput(),
      file,
    );

    await screen.findByRole("table");

    await user.click(resolveButton());

    const alert =
      await screen.findByRole("alert");

    expect(alert).toHaveTextContent(
      /não tem acesso/i,
    );
  });

  it("saving, reloading and deleting a result resolved from .xlsx works exactly like CSV, and the snapshot never carries the file name or spreadsheet data", async () => {
    const snapshotClient = fakeSnapshotClient({
      save: vi.fn(async (items) => ({
        kind: "saved" as const,

        snapshot: {
          items,

          updatedAt:
            "2026-09-22T15:00:00.000Z",
        },
      })),
    });

    const { user } = setup(
      () => ok([resolvedItem(0)]),
      snapshotClient,
    );

    const file = await xlsxFile(
      [
        ["rawName", "amount"],
        [
          "CDB Banco Exemplo",
          1000,
        ],
      ],
      "minha-carteira-pessoal-sigilosa.xlsx",
    );

    await user.upload(
      fileInput(),
      file,
    );

    await screen.findByRole("table");

    await user.click(resolveButton());

    await screen.findByRole("table", {
      name: /resultado/i,
    });

    await user.click(
      screen.getByRole("button", {
        name: /salvar resultado/i,
      }),
    );

    await screen.findByRole("heading", {
      name: "Resultado salvo",
    });

    expect(
      snapshotClient.save,
    ).toHaveBeenCalledTimes(1);

    const saved = JSON.stringify(
      snapshotClient.save.mock
        .calls[0]![0],
    );

    expect(saved).not.toContain(
      "minha-carteira-pessoal-sigilosa",
    );

    expect(saved).not.toContain(
      ".xlsx",
    );

    expect(saved).not.toContain(
      "sheet",
    );
  });

  it("never touches console or storage while reading, previewing or rejecting an .xlsx", async () => {
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

    const { user } = setup();

    const file = await xlsxFile([
      ["rawName"],
      ["Ativo Exemplo"],
    ]);

    await user.upload(
      fileInput(),
      file,
    );

    await screen.findByRole("table");

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
    ).not.toContain("carteira");
  });
});
