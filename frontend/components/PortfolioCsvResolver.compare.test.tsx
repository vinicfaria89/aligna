// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

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
 * TASK-053B: comparing two saved snapshots on /carteira. Same real-client-on-
 * fake-fetch convention as PortfolioCsvResolver.history.test.tsx -- exercises
 * the real snapshot client's routing/parsing, with `comparePortfolioSnapshots`
 * (TASK-053A) doing the actual comparison, unmocked.
 */

const TOKEN = "sentinel-compare-token";

const ENTRY_NEWEST = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  createdAt: "2026-09-23T14:32:00+00:00",
  updatedAt: "2026-09-23T14:32:00+00:00",
  items: [
    {
      lineNumber: 2,
      rawName: "PETR4",
      ticker: "PETR4",
      amount: 1500,
      currency: "BRL",
      status: "verified",
      pendingFields: [],
      sources: ["B3"],
      verifiedAsset: { code: "b3:PETR4", type: "stock", currency: "BRL" },
    },
    {
      lineNumber: 3,
      rawName: "HGLG11",
      ticker: "HGLG11",
      amount: 3000,
      currency: "BRL",
      status: "verified",
      pendingFields: [],
      sources: ["B3"],
      verifiedAsset: { code: "b3:HGLG11", type: "fii", currency: "BRL" },
    },
  ],
};

const ENTRY_MIDDLE = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  createdAt: "2026-09-21T10:00:00+00:00",
  updatedAt: "2026-09-21T10:00:00+00:00",
  items: [
    {
      lineNumber: 2,
      rawName: "PETR4",
      ticker: "PETR4",
      amount: 1000,
      currency: "BRL",
      status: "needs-more-evidence",
      pendingFields: ["identity", "issuer"],
      sources: [],
    },
    {
      lineNumber: 3,
      rawName: "BOVA11",
      ticker: "BOVA11",
      amount: 2000,
      currency: "BRL",
      status: "verified",
      pendingFields: [],
      sources: ["B3"],
      verifiedAsset: { code: "b3:BOVA11", type: "etf", currency: "BRL" },
    },
  ],
};

const ENTRY_OLDEST = {
  id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  createdAt: "2026-09-18T09:00:00+00:00",
  updatedAt: "2026-09-18T09:00:00+00:00",
  items: [
    {
      lineNumber: 2,
      rawName: "VALE3",
      ticker: "VALE3",
      amount: 500,
      currency: "BRL",
      status: "verified",
      pendingFields: [],
      sources: ["B3"],
      verifiedAsset: { code: "b3:VALE3", type: "stock", currency: "BRL" },
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
      return (answers.list ?? (() => json([ENTRY_NEWEST, ENTRY_MIDDLE, ENTRY_OLDEST])))();
    }

    if (url.startsWith(`${PORTFOLIO_SNAPSHOTS_URL}/`)) {
      if (init.method === "GET") {
        return (answers.getById ?? (() => json(ENTRY_NEWEST)))();
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

  const aieFetch = vi.fn<NonNullable<SubmitPortfolioCsvInput["fetchImpl"]>>(async () =>
    json({ ok: false }, 500),
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

async function compareSection() {
  return screen.findByRole("region", { name: "Comparar resultados salvos" });
}

function csv(content = CSV_TEXT, name = "carteira.csv") {
  return new File([content], name, { type: "text/csv", lastModified: 1_700_000_000_000 });
}

afterEach(() => {
  cleanup();
});

describe("visibility by number of saved snapshots", () => {
  it("1. shows no comparison section when there are no saved snapshots", async () => {
    setup({ list: () => json([]) });

    await screen.findByRole("region", { name: "Histórico de resultados salvos" });

    expect(screen.queryByRole("region", { name: "Comparar resultados salvos" })).toBeNull();
  });

  it("2. with 1 snapshot, shows guidance to save at least two", async () => {
    setup({ list: () => json([ENTRY_NEWEST]) });

    const section = await compareSection();

    expect(section).toHaveTextContent("Salve pelo menos dois resultados para comparar.");
    expect(within(section).queryByRole("combobox")).toBeNull();
  });

  it("3. with 2+ snapshots, shows the comparison controls (base/target selects)", async () => {
    setup();

    const section = await compareSection();

    expect(within(section).getByLabelText("Base")).toBeInTheDocument();
    expect(within(section).getByLabelText("Alvo")).toBeInTheDocument();
  });
});

describe("default selection and comparison result", () => {
  it("4. pre-selects base = second most recent, target = most recent", async () => {
    setup();

    const section = await compareSection();

    const base = within(section).getByLabelText("Base") as HTMLSelectElement;
    const target = within(section).getByLabelText("Alvo") as HTMLSelectElement;

    await waitFor(() => expect(base.value).toBe(ENTRY_MIDDLE.id));
    expect(target.value).toBe(ENTRY_NEWEST.id);
  });

  it("5. shows totals: initial/final value, absolute and percentage change", async () => {
    setup();

    const section = await compareSection();

    // Base (MIDDLE): PETR4 1000 + BOVA11 2000 = 3000. Target (NEWEST): PETR4 1500 + HGLG11 3000 = 4500.
    // Totals are not tagged to a single currency (a snapshot can mix them --
    // see the module's documented multi-currency limitation), so they render
    // as plain numbers, not "R$ ...".
    await waitFor(() => expect(section).toHaveTextContent("3.000"));
    expect(section).toHaveTextContent("4.500");
    expect(section).toHaveTextContent("1.500");
    expect(section).toHaveTextContent("50.0%");
  });

  it("6. shows counts: added, removed, kept, changed value, changed status", async () => {
    setup();

    const section = await compareSection();

    await waitFor(() => expect(section).toHaveTextContent("Adicionados: 1"));
    expect(section).toHaveTextContent("Removidos: 1");
    expect(section).toHaveTextContent("Mantidos: 1");
    expect(section).toHaveTextContent("Alteraram valor: 1");
    expect(section).toHaveTextContent("Alteraram status: 1");
  });

  it("7. shows the added list", async () => {
    setup();

    const section = await compareSection();

    await waitFor(() => expect(section).toHaveTextContent("Adicionados"));
    expect(section).toHaveTextContent("b3:HGLG11");
  });

  it("8. shows the removed list", async () => {
    setup();

    const section = await compareSection();

    await waitFor(() => expect(section).toHaveTextContent("Removidos"));
    expect(section).toHaveTextContent("BOVA11");
  });

  it("9. shows the value-change list", async () => {
    setup();

    const section = await compareSection();

    await waitFor(() => expect(section).toHaveTextContent("Alteraram valor"));
    expect(section).toHaveTextContent(/R\$ 1\.000,00.*R\$ 1\.500,00/s);
  });

  it("10. shows the status-change list", async () => {
    setup({
      list: () =>
        json([
          ENTRY_NEWEST,
          {
            ...ENTRY_MIDDLE,
            items: [
              { ...ENTRY_MIDDLE.items[0] }, // PETR4, needs-more-evidence in base
            ],
          },
        ]),
    });

    const section = await compareSection();

    await waitFor(() => expect(section).toHaveTextContent("Alteraram status"));
    expect(section).toHaveTextContent("Precisa de mais evidências");
    expect(section).toHaveTextContent("Verificado");
  });
});

describe("changing the selection", () => {
  it("11. changing a select recalculates the comparison", async () => {
    const rig = setup();

    const section = await compareSection();
    const base = within(section).getByLabelText("Base") as HTMLSelectElement;

    await waitFor(() => expect(base.value).toBe(ENTRY_MIDDLE.id));

    await rig.user.selectOptions(base, ENTRY_OLDEST.id);

    // Base becomes OLDEST (VALE3 500) vs target NEWEST (PETR4 1500 + HGLG11 3000 = 4500).
    // Totals render as plain numbers (see test 5's note on currency).
    await waitFor(() => expect(section).toHaveTextContent("Valor inicial500"));
  });

  it("12. selecting the same snapshot in both fields shows guidance, not a comparison", async () => {
    const rig = setup();

    const section = await compareSection();
    const base = within(section).getByLabelText("Base") as HTMLSelectElement;
    const target = within(section).getByLabelText("Alvo") as HTMLSelectElement;

    await waitFor(() => expect(target.value).toBe(ENTRY_NEWEST.id));

    await rig.user.selectOptions(base, ENTRY_NEWEST.id);

    expect(section).toHaveTextContent("Selecione dois resultados diferentes.");
  });
});

describe("comparison never touches the network/AIE/other snapshot operations", () => {
  it("13/14/15. selecting/recalculating a comparison calls no extra fetch, no AIE, no save/delete", async () => {
    const rig = setup();

    await compareSection();

    await waitFor(() => expect(rig.snapshotFetch).toHaveBeenCalled());

    const callsAfterLoad = rig.snapshotFetch.mock.calls.length;

    const section = await compareSection();
    const base = within(section).getByLabelText("Base");

    await rig.user.selectOptions(base, ENTRY_OLDEST.id);

    expect(rig.snapshotFetch.mock.calls.length).toBe(callsAfterLoad);
    expect(rig.aieFetch).not.toHaveBeenCalled();
  });
});

describe("other history actions keep working", () => {
  it("16. abrir a history entry still works with the comparison section present", async () => {
    const rig = setup();

    await compareSection();
    const historySection = await screen.findByRole("region", {
      name: "Histórico de resultados salvos",
    });

    await rig.user.click(
      within(historySection).getByRole("button", {
        name: new RegExp(`abrir resultado salvo de ${expectedAt(ENTRY_MIDDLE.createdAt)}`, "i"),
      }),
    );

    const card = await screen.findByRole("region", { name: "Resultado salvo" });
    expect(card).toHaveTextContent("PETR4");
  });

  it("17. exportar CSV of a history entry still works with the comparison section present", async () => {
    const rig = setup();

    await compareSection();
    const historySection = await screen.findByRole("region", {
      name: "Histórico de resultados salvos",
    });

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await rig.user.click(
      within(historySection).getByRole("button", {
        name: new RegExp(`exportar csv de ${expectedAt(ENTRY_NEWEST.createdAt)}`, "i"),
      }),
    );

    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it("18. deleting a snapshot selected for comparison clears/recomputes the comparison and never breaks the page", async () => {
    const rig = setup({ delById: () => new Response(null, { status: 204 }) });

    const section = await compareSection();
    const target = within(section).getByLabelText("Alvo") as HTMLSelectElement;

    await waitFor(() => expect(target.value).toBe(ENTRY_NEWEST.id));

    const historySection = await screen.findByRole("region", {
      name: "Histórico de resultados salvos",
    });

    await rig.user.click(
      within(historySection).getByRole("button", {
        name: new RegExp(`apagar resultado salvo de ${expectedAt(ENTRY_NEWEST.createdAt)}`, "i"),
      }),
    );

    await rig.user.click(within(historySection).getByRole("button", { name: "Sim, apagar" }));

    // Only ENTRY_MIDDLE and ENTRY_OLDEST remain: the section must recompute
    // (still >= 2 entries) without throwing, and never keep the deleted id selected.
    await waitFor(() => {
      const refreshedSection = screen.getByRole("region", { name: "Comparar resultados salvos" });
      const refreshedTarget = within(refreshedSection).getByLabelText("Alvo") as HTMLSelectElement;
      expect(refreshedTarget.value).not.toBe(ENTRY_NEWEST.id);
    });
  });

  it("19. a history-load failure does not break the comparison section rendering", async () => {
    setup({ list: () => json({}, 500) });

    const historySection = await screen.findByRole("region", {
      name: "Histórico de resultados salvos",
    });

    expect(historySection).toHaveTextContent(/não foi possível carregar o histórico/i);
    expect(screen.queryByRole("region", { name: "Comparar resultados salvos" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    // Rest of the page still works.
    const rig = { user: userEvent.setup() };
    await rig.user.upload(screen.getByLabelText("Arquivo CSV ou Excel da carteira"), csv());
    await screen.findByRole("table", { name: /prévia/i });
  });
});

describe("accessibility", () => {
  it("21. base/target selects have accessible labels", async () => {
    setup();

    const section = await compareSection();

    expect(within(section).getByLabelText("Base").tagName).toBe("SELECT");
    expect(within(section).getByLabelText("Alvo").tagName).toBe("SELECT");
  });

  it("33. heading hierarchy is coherent: h3 for Resumo/Diferenças, h4 per difference section", async () => {
    setup();

    const section = await compareSection();

    await waitFor(() => expect(within(section).getByRole("heading", { level: 3, name: "Resumo" })).toBeInTheDocument());
    expect(within(section).getByRole("heading", { level: 3, name: "Diferenças" })).toBeInTheDocument();
    expect(within(section).getByRole("heading", { level: 4, name: "Adicionados" })).toBeInTheDocument();
    expect(within(section).getByRole("heading", { level: 4, name: "Removidos" })).toBeInTheDocument();
    expect(within(section).getByRole("heading", { level: 4, name: "Alteraram valor" })).toBeInTheDocument();
    expect(within(section).getByRole("heading", { level: 4, name: "Alteraram status" })).toBeInTheDocument();
  });
});

describe("TASK-055: empty states and visual polish", () => {
  it("35. shows empty-state messages for Adicionados/Removidos/Alteraram status when the only difference is a value change", async () => {
    const baseItem = {
      lineNumber: 2,
      rawName: "PETR4",
      ticker: "PETR4",
      amount: 1000,
      currency: "BRL",
      status: "verified" as const,
      pendingFields: [],
      sources: ["B3"],
      verifiedAsset: { code: "b3:PETR4", type: "stock", currency: "BRL" },
    };
    const targetItem = { ...baseItem, amount: 1500 };
    const entryA = {
      id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      createdAt: "2026-09-10T09:00:00+00:00",
      updatedAt: "2026-09-10T09:00:00+00:00",
      items: [baseItem],
    };
    const entryB = {
      id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
      createdAt: "2026-09-11T09:00:00+00:00",
      updatedAt: "2026-09-11T09:00:00+00:00",
      items: [targetItem],
    };

    setup({ list: () => json([entryB, entryA]) });

    const section = await compareSection();

    await waitFor(() => expect(section).toHaveTextContent("Adicionados: 0"));
    expect(section).toHaveTextContent("Removidos: 0");
    expect(section).toHaveTextContent("Nenhum ativo adicionado.");
    expect(section).toHaveTextContent("Nenhum ativo removido.");
    expect(section).toHaveTextContent("Nenhuma alteração de status encontrada.");
    // The one real difference (value change) still shows normally.
    expect(section).toHaveTextContent(/R\$ 1\.000,00.*R\$ 1\.500,00/s);
  });

  it("36. shows a friendly banner when two compared snapshots have no relevant differences at all", async () => {
    const item = {
      lineNumber: 2,
      rawName: "PETR4",
      ticker: "PETR4",
      amount: 1000,
      currency: "BRL",
      status: "verified" as const,
      pendingFields: [],
      sources: ["B3"],
      verifiedAsset: { code: "b3:PETR4", type: "stock", currency: "BRL" },
    };
    const entryA = {
      id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
      createdAt: "2026-09-10T09:00:00+00:00",
      updatedAt: "2026-09-10T09:00:00+00:00",
      items: [item],
    };
    const entryB = {
      id: "11111111-1111-1111-1111-111111111111",
      createdAt: "2026-09-11T09:00:00+00:00",
      updatedAt: "2026-09-11T09:00:00+00:00",
      items: [item],
    };

    setup({ list: () => json([entryB, entryA]) });

    const section = await compareSection();

    await waitFor(() =>
      expect(section).toHaveTextContent("Nenhuma diferença relevante entre esses dois resultados"),
    );
  });

  it("37. a very long asset name is shown in full in a difference row, not truncated away", async () => {
    const longName = "Fundo de Investimento Imobiliário Muito Longo Para Testar Quebra de Linha Corretamente";
    const otherItem = {
      lineNumber: 2,
      rawName: "VALE3",
      amount: 100,
      currency: "BRL",
      status: "verified" as const,
      pendingFields: [],
      sources: ["B3"],
    };
    const entryA = {
      id: "22222222-2222-2222-2222-222222222222",
      createdAt: "2026-09-10T09:00:00+00:00",
      updatedAt: "2026-09-10T09:00:00+00:00",
      items: [otherItem],
    };
    const entryB = {
      id: "33333333-3333-3333-3333-333333333333",
      createdAt: "2026-09-11T09:00:00+00:00",
      updatedAt: "2026-09-11T09:00:00+00:00",
      items: [
        {
          lineNumber: 2,
          rawName: longName,
          amount: 500,
          currency: "BRL",
          status: "verified" as const,
          pendingFields: [],
          sources: ["B3"],
        },
      ],
    };

    setup({ list: () => json([entryB, entryA]) });

    const section = await compareSection();

    await waitFor(() => expect(section).toHaveTextContent(longName));
  });
});

/**
 * TASK-053C: "Exportar comparação CSV" button. Captures the Blob passed to
 * `URL.createObjectURL` (jsdom's Blob supports `.text()`) rather than mocking
 * `downloadCsvFile` itself -- this exercises the REAL CSV built by
 * `buildPortfolioSnapshotComparisonCsv` from the component's own state, the
 * same way test 17 above exercises the real per-entry export with a real
 * anchor click.
 */
function spyOnDownload() {
  const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const blobs: Blob[] = [];
  const anchors: HTMLAnchorElement[] = [];
  const createObjectURLSpy = vi
    .spyOn(URL, "createObjectURL")
    .mockImplementation((obj: Blob | MediaSource) => {
      blobs.push(obj as Blob);
      return `blob:mock-${blobs.length}`;
    });
  const revokeObjectURLSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  const originalCreateElement = document.createElement.bind(document);
  const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const el = originalCreateElement(tag);
    if (tag === "a") {
      anchors.push(el as HTMLAnchorElement);
    }
    return el;
  });

  return {
    clickSpy,
    createObjectURLSpy,
    revokeObjectURLSpy,
    createElementSpy,
    blobs,
    anchors,
    lastAnchor: () => anchors[anchors.length - 1],
    lastCsvText: async () => blobs[blobs.length - 1].text(),
    restore: () => {
      clickSpy.mockRestore();
      createObjectURLSpy.mockRestore();
      revokeObjectURLSpy.mockRestore();
      createElementSpy.mockRestore();
    },
  };
}

function exportButton(section: HTMLElement) {
  return within(section).queryByRole("button", { name: "Exportar comparação CSV" });
}

describe("Exportar comparação CSV", () => {
  it("22. hidden when there are fewer than 2 saved snapshots", async () => {
    setup({ list: () => json([ENTRY_NEWEST]) });

    const section = await compareSection();

    expect(exportButton(section)).toBeNull();
  });

  it("23. hidden when the same snapshot is selected as base and target", async () => {
    const rig = setup();

    const section = await compareSection();
    const base = within(section).getByLabelText("Base") as HTMLSelectElement;
    const target = within(section).getByLabelText("Alvo") as HTMLSelectElement;

    await waitFor(() => expect(target.value).toBe(ENTRY_NEWEST.id));

    await rig.user.selectOptions(base, ENTRY_NEWEST.id);

    expect(section).toHaveTextContent("Selecione dois resultados diferentes.");
    expect(exportButton(section)).toBeNull();
  });

  it("24. appears once a valid comparison is shown", async () => {
    setup();

    const section = await compareSection();

    await waitFor(() => expect(exportButton(section)).not.toBeNull());
  });

  it("25. clicking it triggers a CSV download via the shared downloadCsvFile anchor-click mechanism", async () => {
    const rig = setup();
    const dl = spyOnDownload();

    const section = await compareSection();
    await waitFor(() => expect(exportButton(section)).not.toBeNull());

    await rig.user.click(exportButton(section)!);

    expect(dl.clickSpy).toHaveBeenCalledTimes(1);
    expect(dl.lastAnchor().download).toMatch(
      /^comparacao-carteira-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}__base-[0-9a-f]{8}__alvo-[0-9a-f]{8}\.csv$/,
    );

    dl.restore();
  });

  it("26. exported CSV filename embeds the short base/target snapshot ids", async () => {
    const rig = setup();
    const dl = spyOnDownload();

    const section = await compareSection();
    await waitFor(() => expect(exportButton(section)).not.toBeNull());

    await rig.user.click(exportButton(section)!);

    expect(dl.lastAnchor().download).toContain(`base-${ENTRY_MIDDLE.id.slice(0, 8)}`);
    expect(dl.lastAnchor().download).toContain(`alvo-${ENTRY_NEWEST.id.slice(0, 8)}`);

    dl.restore();
  });

  it("27. exported CSV content matches the comparison currently on screen", async () => {
    const rig = setup();
    const dl = spyOnDownload();

    const section = await compareSection();
    await waitFor(() => expect(exportButton(section)).not.toBeNull());

    await rig.user.click(exportButton(section)!);

    const csvText = await dl.lastCsvText();
    // Base (MIDDLE): PETR4 1000 + BOVA11 2000 = 3000. Target (NEWEST): PETR4 1500 + HGLG11 3000 = 4500.
    expect(csvText).toContain("summary,total");
    expect(csvText).toContain("3000");
    expect(csvText).toContain("4500");
    expect(csvText).toContain("HGLG11"); // added
    expect(csvText).toContain("BOVA11"); // removed
    expect(csvText).toContain("PETR4"); // kept

    dl.restore();
  });

  it("28. changing base/target changes the exported CSV content", async () => {
    const rig = setup();
    const dl = spyOnDownload();

    const section = await compareSection();
    const base = within(section).getByLabelText("Base") as HTMLSelectElement;

    await waitFor(() => expect(exportButton(section)).not.toBeNull());
    await rig.user.click(exportButton(section)!);
    const firstCsv = await dl.lastCsvText();

    await rig.user.selectOptions(base, ENTRY_OLDEST.id);
    await waitFor(() => expect(exportButton(section)).not.toBeNull());
    await rig.user.click(exportButton(section)!);
    const secondCsv = await dl.lastCsvText();

    expect(secondCsv).not.toBe(firstCsv);
    expect(secondCsv).toContain("VALE3");

    dl.restore();
  });

  it("29/30/31. clicking export calls no extra snapshot fetch, no AIE fetch, no save/delete", async () => {
    const rig = setup();
    const dl = spyOnDownload();

    const section = await compareSection();
    await waitFor(() => expect(exportButton(section)).not.toBeNull());
    await waitFor(() => expect(rig.snapshotFetch).toHaveBeenCalled());

    const callsBeforeExport = rig.snapshotFetch.mock.calls.length;

    await rig.user.click(exportButton(section)!);

    expect(rig.snapshotFetch.mock.calls.length).toBe(callsBeforeExport);
    expect(rig.aieFetch).not.toHaveBeenCalled();

    dl.restore();
  });

  it("32. does not regress the individual saved-result CSV export button", async () => {
    const rig = setup();

    await compareSection();
    const historySection = await screen.findByRole("region", {
      name: "Histórico de resultados salvos",
    });

    const dl = spyOnDownload();

    await rig.user.click(
      within(historySection).getByRole("button", {
        name: new RegExp(`exportar csv de ${expectedAt(ENTRY_NEWEST.createdAt)}`, "i"),
      }),
    );

    expect(dl.clickSpy).toHaveBeenCalledTimes(1);
    expect(dl.lastAnchor().download).toMatch(/^resultado-carteira-\d{4}-\d{2}-\d{2}\.csv$/);

    dl.restore();
  });
});

/**
 * TASK-056B: "Por tipo de ativo" section, consuming
 * `groupPortfolioSnapshotComparisonByAssetType` (TASK-056A, pure) as-is. The
 * default fixture (ENTRY_MIDDLE base / ENTRY_NEWEST target) already carries
 * three distinct real asset types across its three items -- no need for a
 * separate fixture for most of these: PETR4 is `stock` (kept, value AND
 * status changed), HGLG11 is `fii` (added -- so its group's baseValue is 0,
 * covering the null-percentage case for free), BOVA11 is `etf` (removed).
 */
function assetTypeSection(section: HTMLElement) {
  const heading = within(section).getByRole("heading", { level: 3, name: "Por tipo de ativo" });
  // The heading's parent block is the section's own container (see
  // PortfolioSnapshotComparison.tsx: a `<div>` wrapping the heading+intro
  // text and the groups list/empty-state) -- scoping queries to it lets
  // tests assert what does NOT appear (e.g. an empty group) without false
  // positives from the rest of the comparison card.
  return heading.closest("div")!.parentElement as HTMLElement;
}

describe("TASK-056B: comparação por tipo de ativo", () => {
  it("38. shows the 'Por tipo de ativo' section with its intro text in a valid comparison", async () => {
    setup();

    const section = await compareSection();

    await waitFor(() =>
      expect(within(section).getByRole("heading", { level: 3, name: "Por tipo de ativo" })).toBeInTheDocument(),
    );
    expect(section).toHaveTextContent("Veja como cada classe da carteira mudou entre os dois resultados.");
  });

  it("39. does not show the asset-type section when there is no valid comparison", async () => {
    const rig = setup();

    const section = await compareSection();
    const base = within(section).getByLabelText("Base") as HTMLSelectElement;
    const target = within(section).getByLabelText("Alvo") as HTMLSelectElement;

    await waitFor(() => expect(target.value).toBe(ENTRY_NEWEST.id));
    await rig.user.selectOptions(base, ENTRY_NEWEST.id);

    expect(within(section).queryByRole("heading", { level: 3, name: "Por tipo de ativo" })).toBeNull();
  });

  it("40. renders the Ações, FIIs and ETFs groups with their labels", async () => {
    setup();

    const section = await compareSection();
    const group = await waitFor(() => assetTypeSection(section));

    expect(group).toHaveTextContent("Ações");
    expect(group).toHaveTextContent("FIIs");
    expect(group).toHaveTextContent("ETFs");
  });

  it("41. shows valor inicial, valor final, variação absoluta e percentual for a group (Ações)", async () => {
    setup();

    const section = await compareSection();
    const group = await waitFor(() => assetTypeSection(section));

    // PETR4 (stock): base 1000, target 1500.
    expect(group).toHaveTextContent("Valor inicial");
    expect(group).toHaveTextContent("1.000");
    expect(group).toHaveTextContent("Valor final");
    expect(group).toHaveTextContent("1.500");
    expect(group).toHaveTextContent("+500");
    expect(group).toHaveTextContent("50.0%");
  });

  it("42. shows added/removed/kept/changedValue/changedStatus counts per group", async () => {
    setup();

    const section = await compareSection();
    const group = await waitFor(() => assetTypeSection(section));

    // Ações (stock): PETR4 kept, value AND status changed.
    expect(group).toHaveTextContent("Mantidos: 1");
    expect(group).toHaveTextContent("Alteraram valor: 1");
    expect(group).toHaveTextContent("Alteraram status: 1");
    // FIIs: HGLG11 added.
    expect(group).toHaveTextContent("Adicionados: 1");
    // ETFs: BOVA11 removed.
    expect(group).toHaveTextContent("Removidos: 1");
  });

  it("43. does not render a group with no items at all", async () => {
    setup();

    const section = await compareSection();
    const group = await waitFor(() => assetTypeSection(section));

    expect(group).not.toHaveTextContent("Debêntures");
    expect(group).not.toHaveTextContent("Criptoativos");
    expect(group).not.toHaveTextContent("CDBs");
  });

  it("44. an unknown/custom asset type is not discarded and shows a stable, humanized label", async () => {
    const base = {
      id: "44444444-4444-4444-4444-444444444444",
      createdAt: "2026-09-10T09:00:00+00:00",
      updatedAt: "2026-09-10T09:00:00+00:00",
      items: [
        {
          lineNumber: 2,
          rawName: "VALE3",
          assetType: "stock",
          amount: 100,
          currency: "BRL",
          status: "verified" as const,
          pendingFields: [],
          sources: ["B3"],
        },
      ],
    };
    const target = {
      id: "55555555-5555-5555-5555-555555555555",
      createdAt: "2026-09-11T09:00:00+00:00",
      updatedAt: "2026-09-11T09:00:00+00:00",
      items: [
        {
          lineNumber: 2,
          rawName: "SEM TIPO LTDA",
          amount: 250,
          currency: "BRL",
          status: "verified" as const,
          pendingFields: [],
          sources: [],
          // No assetType, no verifiedAsset -- must group as "unknown".
        },
      ],
    };

    setup({ list: () => json([target, base]) });

    const section = await compareSection();
    const group = await waitFor(() => assetTypeSection(section));

    expect(group).toHaveTextContent("Sem tipo definido");
  });

  it("45. a group with baseValue 0 shows a friendly percentage ('—'), never Infinity/NaN", async () => {
    setup();

    const section = await compareSection();
    const group = await waitFor(() => assetTypeSection(section));

    // FIIs: only HGLG11 added -- baseValue is 0 for that group.
    expect(group).not.toHaveTextContent("Infinity");
    expect(group).not.toHaveTextContent("NaN");
    expect(group.textContent).toContain("—");
  });

  it("46. changing the base/target selection updates the asset-type groups", async () => {
    const rig = setup();

    const section = await compareSection();
    const base = within(section).getByLabelText("Base") as HTMLSelectElement;

    await waitFor(async () => {
      const group = assetTypeSection(section);
      expect(group).toHaveTextContent("ETFs");
    });

    // OLDEST only has VALE3 (stock); NEWEST only has PETR4 (stock) + HGLG11
    // (fii) -- switching base to OLDEST means no snapshot in the comparison
    // has an `etf` item anymore, so that group must disappear.
    await rig.user.selectOptions(base, ENTRY_OLDEST.id);

    await waitFor(() => {
      const group = assetTypeSection(section);
      expect(group).not.toHaveTextContent("ETFs");
    });
  });

  it("47. deleting the selected snapshot clears/recomputes the asset-type section without crashing", async () => {
    const rig = setup({ delById: () => new Response(null, { status: 204 }) });

    const section = await compareSection();
    const target = within(section).getByLabelText("Alvo") as HTMLSelectElement;

    await waitFor(() => expect(target.value).toBe(ENTRY_NEWEST.id));

    const historySection = await screen.findByRole("region", {
      name: "Histórico de resultados salvos",
    });

    await rig.user.click(
      within(historySection).getByRole("button", {
        name: new RegExp(`apagar resultado salvo de ${expectedAt(ENTRY_NEWEST.createdAt)}`, "i"),
      }),
    );
    await rig.user.click(within(historySection).getByRole("button", { name: "Sim, apagar" }));

    // Only MIDDLE and OLDEST remain (still >= 2 entries): the section must
    // recompute without throwing, whatever the new default pairing is.
    await waitFor(() => {
      const refreshedSection = screen.getByRole("region", { name: "Comparar resultados salvos" });
      expect(refreshedSection).toBeInTheDocument();
    });
  });

  it("48. exporting the comparison CSV still works and does not gain asset-type columns/content", async () => {
    const rig = setup();
    const dl = spyOnDownload();

    const section = await compareSection();
    await waitFor(() => expect(exportButton(section)).not.toBeNull());

    await rig.user.click(exportButton(section)!);

    expect(dl.clickSpy).toHaveBeenCalledTimes(1);
    const csvText = await dl.lastCsvText();

    expect(csvText.split("\r\n")[0]).toBe(
      "row_type,section,key,name,code,status_before,status_after,value_before,value_after,absolute_change,percentage_change,value_changed,status_changed",
    );
    expect(csvText).not.toContain("Por tipo de ativo");
    expect(csvText).not.toContain("assetType");

    dl.restore();
  });

  it("49. heading hierarchy stays coherent with the new section: h3 'Por tipo de ativo' alongside 'Resumo' and 'Diferenças'", async () => {
    setup();

    const section = await compareSection();

    await waitFor(() => expect(within(section).getByRole("heading", { level: 3, name: "Resumo" })).toBeInTheDocument());
    expect(within(section).getByRole("heading", { level: 3, name: "Por tipo de ativo" })).toBeInTheDocument();
    expect(within(section).getByRole("heading", { level: 3, name: "Diferenças" })).toBeInTheDocument();
  });

  it("50. a long/unusual asset-type label is shown in full inside its group card, not truncated", async () => {
    const longTypeLabel = "tipo-muito-longo-para-testar-quebra-de-linha-no-card-do-grupo";
    const base = {
      id: "66666666-6666-6666-6666-666666666666",
      createdAt: "2026-09-10T09:00:00+00:00",
      updatedAt: "2026-09-10T09:00:00+00:00",
      items: [
        {
          lineNumber: 2,
          rawName: "VALE3",
          assetType: "stock",
          amount: 100,
          currency: "BRL",
          status: "verified" as const,
          pendingFields: [],
          sources: ["B3"],
        },
      ],
    };
    const target = {
      id: "77777777-7777-7777-7777-777777777777",
      createdAt: "2026-09-11T09:00:00+00:00",
      updatedAt: "2026-09-11T09:00:00+00:00",
      items: [
        {
          lineNumber: 2,
          rawName: "ATIVO ESTRANHO",
          assetType: longTypeLabel,
          amount: 100,
          currency: "BRL",
          status: "verified" as const,
          pendingFields: [],
          sources: [],
        },
      ],
    };

    setup({ list: () => json([target, base]) });

    const section = await compareSection();
    const group = await waitFor(() => assetTypeSection(section));

    // Humanized: hyphens become spaces, first letter of each word capitalized.
    expect(group.textContent).toMatch(/Tipo Muito Longo Para Testar Quebra De Linha No Card Do Grupo/);
  });
});
