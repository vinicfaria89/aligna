// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import PortfolioCsvResolver from "./PortfolioCsvResolver";

import type { SubmitPortfolioCsvInput } from "@/lib/aie/client/resolve-csv-client";
import {
  PORTFOLIO_SNAPSHOT_URL,
  PORTFOLIO_SNAPSHOTS_URL,
  type SnapshotFetch,
} from "@/lib/portfolio-snapshot-api";
import type { SessionAccess } from "@/lib/session";

vi.mock("@/lib/session", () => ({
  acquireAccessToken: async () => ({ status: "none" }),
  clearSession: () => undefined,
}));

/**
 * TASK-048B: the history list on /carteira -- listing, opening, exporting and
 * deleting a specific saved snapshot. The saved-result client is the REAL one,
 * on a fake fetch and a fake session, exactly like PortfolioCsvResolver.snapshot.test.tsx
 * (TASK-029B/048A), so the real routing/parsing between the singular ("latest",
 * compat) and plural ("history") endpoints is exercised end to end.
 */

const TOKEN = "sentinel-history-token";

const ENTRY_RECENT = {
  id: "11111111-1111-1111-1111-111111111111",
  createdAt: "2026-09-23T14:32:00+00:00",
  updatedAt: "2026-09-23T14:32:00+00:00",
  items: [
    {
      lineNumber: 2,
      rawName: "RECENT ALPHA",
      status: "verified",
      pendingFields: [],
      sources: ["anbima"],
      verifiedAsset: { code: "ABCD11", type: "debenture", currency: "BRL" },
    },
  ],
};

const ENTRY_OLDER = {
  id: "22222222-2222-2222-2222-222222222222",
  createdAt: "2026-09-20T10:00:00+00:00",
  updatedAt: "2026-09-20T10:00:00+00:00",
  items: [
    {
      lineNumber: 2,
      rawName: "OLDER BETA",
      status: "needs-more-evidence",
      pendingFields: ["issuer"],
      sources: [],
    },
    {
      lineNumber: 3,
      rawName: "OLDER GAMMA",
      status: "needs-more-evidence",
      pendingFields: [],
      sources: [],
    },
  ],
};

const NEW_SAVE_BODY = {
  items: [
    {
      lineNumber: 2,
      rawName: "NEW SAVE",
      status: "needs-more-evidence",
      pendingFields: ["identity"],
      sources: [],
    },
  ],
  updatedAt: "2026-09-24T09:00:00+00:00",
};

const CSV_TEXT = [
  "rawName,assetType,instrumentCode,ticker,amount,currency",
  "DEB PETROBRAS SERIE 1,debenture,ABCD11,,98765.43,BRL",
].join("\n");

/** Mirrors the component's own `savedAtText` exactly (same Date parsing +
 * toLocaleDateString/toLocaleTimeString) so assertions never hardcode a time
 * that only matches in one timezone -- the test runner's local zone can be
 * anything. */
function expectedAt(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString("pt-BR");
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return `${day} às ${time}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function aieOk(): Response {
  return json({
    ok: true,
    result: {
      items: [
        {
          index: 0,
          candidateAssetId: "portfolio:SENTINEL-ID:2",
          ok: true,
          result: {
            status: "needs-more-evidence",
            verifiedAsset: null,
            investigation: { evidence: [], searches: [], unresolvedFields: ["identity"] },
          },
        },
      ],
    },
  });
}

interface Answers {
  get?: () => Response | Promise<Response>;
  put?: () => Response | Promise<Response>;
  del?: () => Response | Promise<Response>;
  list?: () => Response | Promise<Response>;
  getById?: () => Response | Promise<Response>;
  delById?: () => Response | Promise<Response>;
  aie?: () => Response | Promise<Response>;
}

function setup(
  answers: Answers = {},
  session: SessionAccess = { status: "ok", accessToken: TOKEN },
) {
  const snapshotFetch = vi.fn<SnapshotFetch>(async (url, init) => {
    if (url === PORTFOLIO_SNAPSHOTS_URL) {
      return (answers.list ?? (() => json([ENTRY_RECENT, ENTRY_OLDER])))();
    }

    if (url.startsWith(`${PORTFOLIO_SNAPSHOTS_URL}/`)) {
      if (init.method === "GET") {
        return (answers.getById ?? (() => json(ENTRY_RECENT)))();
      }

      return (answers.delById ?? (() => new Response(null, { status: 204 })))();
    }

    if (url === PORTFOLIO_SNAPSHOT_URL) {
      if (init.method === "GET") {
        return (answers.get ?? (() => json({}, 404)))();
      }

      if (init.method === "PUT") {
        return (answers.put ?? (() => json(NEW_SAVE_BODY)))();
      }

      return (answers.del ?? (() => new Response(null, { status: 204 })))();
    }

    throw new Error(`unexpected url in test: ${url}`);
  });

  const aieFetch = vi.fn<NonNullable<SubmitPortfolioCsvInput["fetchImpl"]>>(
    async () => (answers.aie ?? aieOk)(),
  );

  const getSession = vi.fn(async (): Promise<SessionAccess> => session);

  const clearSession = vi.fn();

  const user = userEvent.setup();

  render(
    <PortfolioCsvResolver
      getSession={getSession}
      clearSession={clearSession}
      fetchImpl={aieFetch}
      snapshotFetchImpl={snapshotFetch}
    />,
  );

  return { user, snapshotFetch, aieFetch, getSession, clearSession };
}

type Rig = ReturnType<typeof setup>;

function historyMethods(rig: Rig, urlPrefix: string): string[] {
  return rig.snapshotFetch.mock.calls
    .filter((call) => call[0] === urlPrefix || call[0].startsWith(`${urlPrefix}/`))
    .map((call) => call[1].method);
}

async function historySection() {
  return screen.findByRole("region", { name: "Histórico de resultados salvos" });
}

async function opened(rig: Rig) {
  await waitFor(() => expect(rig.snapshotFetch).toHaveBeenCalled());
  await historySection();
}

function csv(content = CSV_TEXT, name = "carteira.csv") {
  return new File([content], name, { type: "text/csv", lastModified: 1_700_000_000_000 });
}

afterEach(() => {
  cleanup();
});

describe("loading the history on open", () => {
  it("shows every entry, most recent first, with date/time and item count", async () => {
    setup();

    const section = await historySection();

    const items = within(section).getAllByRole("listitem");

    expect(items).toHaveLength(2);

    expect(items[0]).toHaveTextContent(expectedAt(ENTRY_RECENT.createdAt));
    expect(items[0]).toHaveTextContent("1 ativo");
    expect(items[0]).toHaveTextContent("Mais recente");

    expect(items[1]).toHaveTextContent(expectedAt(ENTRY_OLDER.createdAt));
    expect(items[1]).toHaveTextContent("2 ativos");
    expect(items[1]).not.toHaveTextContent("Mais recente");
  });

  it("shows a discreet empty state when there is nothing saved yet", async () => {
    setup({ list: () => json([]) });

    const section = await historySection();

    expect(section).toHaveTextContent("Nenhum resultado salvo ainda.");

    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("a failure to load history shows a discreet note and never blocks upload/resolution", async () => {
    const rig = setup({ list: () => json({}, 500) });

    const section = await historySection();

    expect(section).toHaveTextContent(/não foi possível carregar o histórico/i);

    expect(screen.queryByRole("alert")).toBeNull();

    // The rest of the page still works.
    await rig.user.upload(screen.getByLabelText("Arquivo CSV ou Excel da carteira"), csv());

    await screen.findByRole("table", { name: /prévia/i });
  });

  it("an expired session on open is silent for the history too: no note, no entries", async () => {
    const rig = setup({}, { status: "expired" });

    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(rig.snapshotFetch).not.toHaveBeenCalled();

    expect(screen.queryByRole("region", { name: "Histórico de resultados salvos" })).toBeNull();

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("abrir a specific entry", () => {
  it("replaces the displayed result, without touching the upload or calling the AIE resolver", async () => {
    const rig = setup();

    const section = await historySection();

    await rig.user.click(
      within(section).getByRole("button", { name: /abrir resultado salvo de 20\/09\/2026/i }),
    );

    const card = await screen.findByRole("region", { name: "Resultado salvo" });

    expect(card).toHaveTextContent("OLDER BETA");
    expect(card).toHaveTextContent("OLDER GAMMA");
    expect(card).toHaveTextContent("Este é um resultado aberto do seu histórico.");

    expect(screen.queryByText(/arquivo selecionado/i)).toBeNull();
    expect(rig.aieFetch).not.toHaveBeenCalled();
  });

  it("opening does not call the network, and does not change the history list", async () => {
    const rig = setup();

    const section = await historySection();

    const callsBefore = rig.snapshotFetch.mock.calls.length;

    await rig.user.click(
      within(section).getByRole("button", { name: /abrir resultado salvo de 20\/09\/2026/i }),
    );

    await screen.findByRole("region", { name: "Resultado salvo" });

    expect(rig.snapshotFetch.mock.calls.length).toBe(callsBefore);

    expect(within(await historySection()).getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("exportar CSV from the list", () => {
  it("exports without any network call and without changing the displayed result", async () => {
    const rig = setup();

    const section = await historySection();

    const callsBefore = rig.snapshotFetch.mock.calls.length;

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const createObjectURL = vi.fn(() => "blob:sentinel");
    const revokeObjectURL = vi.fn();

    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });

    await rig.user.click(
      within(section).getByRole("button", { name: /exportar csv de 20\/09\/2026/i }),
    );

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    expect(rig.snapshotFetch.mock.calls.length).toBe(callsBefore);

    expect(screen.queryByRole("region", { name: "Resultado salvo" })).toBeNull();

    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it("the exported CSV contains that entry's items, in the documented shape", async () => {
    setup();

    const section = await historySection();

    let capturedBlob: Blob | null = null;

    const createObjectURL = vi.fn((blob: Blob) => {
      capturedBlob = blob;
      return "blob:sentinel";
    });

    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    await userEvent.setup().click(
      within(section).getByRole("button", { name: /exportar csv de 20\/09\/2026/i }),
    );

    expect(capturedBlob).not.toBeNull();

    const text = await (capturedBlob as unknown as Blob).text();

    expect(text).toContain("OLDER BETA");
    expect(text).toContain("OLDER GAMMA");
    expect(text).not.toContain("RECENT ALPHA");

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});

describe("apagar a specific entry", () => {
  it("asks for confirmation, then DELETEs that id and removes it from the list", async () => {
    const rig = setup();

    const section = await historySection();

    await rig.user.click(
      within(section).getByRole("button", { name: /apagar resultado salvo de 20\/09\/2026/i }),
    );

    await screen.findByText(`Apagar este resultado salvo de ${expectedAt(ENTRY_OLDER.createdAt)}?`);

    await rig.user.click(screen.getByRole("button", { name: "Sim, apagar" }));

    await waitFor(() =>
      expect(within(section).getAllByRole("listitem")).toHaveLength(1),
    );

    // The history list itself never shows asset names (see privacy tests) --
    // only date/count/actions. Confirm by date instead.
    expect(section).not.toHaveTextContent(expectedAt(ENTRY_OLDER.createdAt));
    expect(section).toHaveTextContent(expectedAt(ENTRY_RECENT.createdAt));

    const del = rig.snapshotFetch.mock.calls.find(
      (call) => call[1].method === "DELETE" && call[0] === `${PORTFOLIO_SNAPSHOTS_URL}/${ENTRY_OLDER.id}`,
    );

    expect(del).toBeDefined();
  });

  it("a failure keeps the entry in the list", async () => {
    const rig = setup({ delById: () => json({}, 500) });

    const section = await historySection();

    await rig.user.click(
      within(section).getByRole("button", { name: /apagar resultado salvo de 20\/09\/2026/i }),
    );

    await rig.user.click(screen.getByRole("button", { name: "Sim, apagar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/não foi possível apagar este resultado/i);

    expect(within(section).getAllByRole("listitem")).toHaveLength(2);
    expect(section).toHaveTextContent(expectedAt(ENTRY_OLDER.createdAt));
  });

  it("deleting the entry that is currently displayed clears the displayed result", async () => {
    const rig = setup();

    const section = await historySection();

    await rig.user.click(
      within(section).getByRole("button", { name: /abrir resultado salvo de 20\/09\/2026/i }),
    );

    await screen.findByText("OLDER BETA");

    await rig.user.click(
      within(section).getByRole("button", { name: /apagar resultado salvo de 20\/09\/2026/i }),
    );

    await rig.user.click(screen.getByRole("button", { name: "Sim, apagar" }));

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Resultado salvo" })).toBeNull(),
    );
  });

  it("a 401 ends the session once and offers the safe sign-in", async () => {
    const rig = setup({ delById: () => json({}, 401) });

    const section = await historySection();

    await rig.user.click(
      within(section).getByRole("button", { name: /apagar resultado salvo de 20\/09\/2026/i }),
    );

    await rig.user.click(screen.getByRole("button", { name: "Sim, apagar" }));

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(/sua sessão expirou/i);

    expect(rig.clearSession).toHaveBeenCalledTimes(1);

    expect(within(section).getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("apagar resultado salvo (the main button) picks the right endpoint", () => {
  it("uses the old singular endpoint when the displayed result is the plain latest (no id)", async () => {
    const rig = setup({ get: () => json(NEW_SAVE_BODY) });

    await screen.findByRole("region", { name: "Resultado salvo" });

    await rig.user.click(screen.getByRole("button", { name: "Apagar resultado salvo" }));
    await rig.user.click(screen.getByRole("button", { name: "Sim, apagar" }));

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Resultado salvo" })).toBeNull(),
    );

    expect(historyMethods(rig, PORTFOLIO_SNAPSHOTS_URL)).not.toContain("DELETE");

    const del = rig.snapshotFetch.mock.calls.find(
      (call) => call[1].method === "DELETE",
    );

    expect(del?.[0]).toBe(PORTFOLIO_SNAPSHOT_URL);
  });

  it("uses the new by-id endpoint when the displayed result was opened from the history", async () => {
    const rig = setup();

    const section = await historySection();

    await rig.user.click(
      within(section).getByRole("button", { name: /abrir resultado salvo de 20\/09\/2026/i }),
    );

    await screen.findByText("OLDER BETA");

    await rig.user.click(screen.getByRole("button", { name: "Apagar resultado salvo" }));
    await rig.user.click(screen.getByRole("button", { name: "Sim, apagar" }));

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Resultado salvo" })).toBeNull(),
    );

    const del = rig.snapshotFetch.mock.calls.find(
      (call) => call[1].method === "DELETE",
    );

    expect(del?.[0]).toBe(`${PORTFOLIO_SNAPSHOTS_URL}/${ENTRY_OLDER.id}`);
  });
});

describe("saving refreshes the history", () => {
  it("a new PUT re-reads the history list and the new entry shows up", async () => {
    let listCallCount = 0;

    const newEntryCreatedAt = "2026-09-24T09:00:00+00:00";

    const rig = setup({
      list: () => {
        listCallCount += 1;

        return listCallCount === 1
          ? json([ENTRY_RECENT])
          : json([
              { ...NEW_SAVE_BODY, id: "33333333-3333-3333-3333-333333333333", createdAt: newEntryCreatedAt },
              ENTRY_RECENT,
            ]);
      },
    });

    await opened(rig);

    await rig.user.upload(screen.getByLabelText("Arquivo CSV ou Excel da carteira"), csv());

    await screen.findByRole("table", { name: /prévia/i });

    await rig.user.click(screen.getByRole("button", { name: /resolver carteira/i }));

    await screen.findByRole("table", { name: "Resultado da resolução de cada ativo" });

    await rig.user.click(screen.getByRole("button", { name: "Salvar resultado" }));

    await screen.findByText("Este resultado está salvo na sua conta.");

    await waitFor(() => expect(listCallCount).toBe(2));

    const section = await historySection();

    expect(within(section).getAllByRole("listitem")).toHaveLength(2);
    expect(section).toHaveTextContent(expectedAt(newEntryCreatedAt));
  });
});

describe("Limpar never touches the history", () => {
  it("clearing the screen leaves the history list exactly as it was", async () => {
    const rig = setup();

    await opened(rig);

    await rig.user.upload(screen.getByLabelText("Arquivo CSV ou Excel da carteira"), csv());

    await screen.findByRole("table", { name: /prévia/i });

    await rig.user.click(screen.getByRole("button", { name: "Limpar" }));

    const section = await historySection();

    expect(within(section).getAllByRole("listitem")).toHaveLength(2);

    // No PUT/DELETE against either endpoint was ever sent.
    expect(rig.snapshotFetch.mock.calls.some((call) => call[1].method !== "GET")).toBe(false);
  });

  it("a new upload never auto-saves: no PUT to either endpoint", async () => {
    const rig = setup();

    await opened(rig);

    await rig.user.upload(screen.getByLabelText("Arquivo CSV ou Excel da carteira"), csv());

    await screen.findByRole("table", { name: /prévia/i });

    expect(rig.snapshotFetch.mock.calls.some((call) => call[1].method === "PUT")).toBe(false);
  });
});

describe("privacy", () => {
  it("the history never shows a file name, a token, an internal id or provider evidence", async () => {
    setup();

    await historySection();

    const html = document.body.innerHTML;

    for (const forbidden of [
      TOKEN,
      "Bearer",
      "portfolio:",
      "carteira.csv",
      "correlationId",
      "evidence",
      "fileId",
    ]) {
      expect(html).not.toContain(forbidden);
    }

    // The Planejador-issued ids ARE allowed to exist in the DOM only as React keys
    // (not rendered as visible text) -- confirm they are not shown to the user.
    expect(screen.queryByText(ENTRY_RECENT.id)).toBeNull();
    expect(screen.queryByText(ENTRY_OLDER.id)).toBeNull();
  });

  it("writes to no storage and prints nothing to the console through open + apagar", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );

    const rig = setup();

    const section = await historySection();

    await rig.user.click(
      within(section).getByRole("button", { name: /apagar resultado salvo de 20\/09\/2026/i }),
    );
    await rig.user.click(screen.getByRole("button", { name: "Sim, apagar" }));

    await waitFor(() => expect(within(section).getAllByRole("listitem")).toHaveLength(1));

    expect(setItem).not.toHaveBeenCalled();

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});

describe("layout", () => {
  it("the list wraps its per-item actions (no fixed-width overflow) for narrow screens", async () => {
    setup();

    const section = await historySection();

    for (const group of within(section).getAllByRole("listitem")) {
      const actionsRow = group.querySelector(".flex-wrap");

      expect(actionsRow).not.toBeNull();
    }
  });

  it("every item's action buttons have their own distinguishable accessible name", async () => {
    setup();

    const section = await historySection();

    expect(
      within(section).getByRole("button", {
        name: `Abrir resultado salvo de ${expectedAt(ENTRY_RECENT.createdAt)}`,
      }),
    ).toBeInTheDocument();

    expect(
      within(section).getByRole("button", {
        name: `Abrir resultado salvo de ${expectedAt(ENTRY_OLDER.createdAt)}`,
      }),
    ).toBeInTheDocument();
  });
});
