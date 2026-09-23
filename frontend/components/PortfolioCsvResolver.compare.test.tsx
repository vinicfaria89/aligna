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
});
