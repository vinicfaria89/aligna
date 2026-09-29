// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
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
 * TASK-062B: "Como melhorar esta resolução" panel
 * (components/PortfolioResolutionImprovementPanel.tsx), consuming
 * `buildPortfolioResolutionImprovementPlan` (TASK-062A, pure) exactly as it
 * returns it. Real-client-on-fake-fetch convention, same as the other
 * PortfolioCsvResolver.<domain>.test.tsx files.
 *
 * The pure helper's 5 rules only ever produce "high" or "medium" priority
 * -- "low" is a valid value of the type but no current rule reaches it.
 * The module is mocked as a thin pass-through to the REAL implementation
 * (every normal test below exercises real logic), except for one
 * deliberately-flagged sentinel item that synthesizes a "low" suggestion,
 * so the panel's low-priority visual branch (otherwise dead code today)
 * still has coverage. This never changes or duplicates the helper's real
 * rules.
 */

const LOW_SENTINEL_NAME = "__LOW_PRIORITY_SENTINEL__";

vi.mock("@/lib/portfolio-resolution-improvement-plan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/portfolio-resolution-improvement-plan")>();
  return {
    ...actual,
    buildPortfolioResolutionImprovementPlan: (items: readonly { rawName: string }[]) => {
      if (items.some((i) => i.rawName === LOW_SENTINEL_NAME)) {
        return {
          suggestions: [
            {
              id: "low-priority-example",
              priority: "low" as const,
              title: "Sugestão de baixa prioridade (exemplo)",
              description: "Cenário sintético só para cobrir o estilo visual de baixa prioridade.",
              affectedItems: 1,
            },
          ],
          totals: { items: items.length, suggestions: 1 },
        };
      }
      return actual.buildPortfolioResolutionImprovementPlan(
        items as Parameters<typeof actual.buildPortfolioResolutionImprovementPlan>[0],
      );
    },
  };
});

const TOKEN = "sentinel-improvement-token";

// One item per rule (5 total triggers) plus one neutral verified item.
const MULTI_ITEMS = [
  {
    lineNumber: 2,
    rawName: "PETR4",
    ticker: "PETR4",
    assetType: "stock",
    amount: 1000,
    currency: "BRL",
    status: "verified",
    pendingFields: [],
    sources: ["B3"],
    verifiedAsset: { code: "b3:PETR4", type: "stock", currency: "BRL" },
  },
  {
    lineNumber: 3,
    rawName: "Ativo Sem Tipo",
    amount: 50,
    currency: "BRL",
    status: "verified",
    pendingFields: [],
    sources: [],
  },
  {
    lineNumber: 4,
    rawName: "Ação Pendente",
    assetType: "stock",
    amount: 100,
    currency: "BRL",
    status: "needs-more-evidence",
    pendingFields: ["identity"],
    sources: [],
  },
  {
    lineNumber: 5,
    rawName: "Outra Ação Pendente",
    assetType: "stock",
    amount: 150,
    currency: "BRL",
    status: "needs-more-evidence",
    pendingFields: ["identity"],
    sources: [],
  },
  {
    lineNumber: 6,
    rawName: "Ativo com Erro",
    assetType: "stock",
    amount: 200,
    currency: "BRL",
    status: "item-error",
    pendingFields: [],
    sources: [],
  },
  {
    lineNumber: 7,
    rawName: "Ativo Conflitante",
    assetType: "stock",
    amount: 300,
    currency: "BRL",
    status: "conflict",
    pendingFields: [],
    sources: [],
  },
  {
    lineNumber: 8,
    rawName: "Ativo Bloqueado",
    assetType: "stock",
    amount: 400,
    currency: "BRL",
    status: "blocked",
    pendingFields: [],
    sources: [],
  },
];

const MULTI_BODY = { items: MULTI_ITEMS, updatedAt: "2026-09-29T10:00:00+00:00" };

const ONE_SUGGESTION_BODY = {
  items: [
    {
      lineNumber: 2,
      rawName: "Ação Pendente",
      assetType: "stock",
      amount: 100,
      currency: "BRL",
      status: "needs-more-evidence",
      pendingFields: ["identity"],
      sources: [],
    },
  ],
  updatedAt: "2026-09-29T10:00:00+00:00",
};

const ALL_VERIFIED_BODY = {
  items: [
    {
      lineNumber: 2,
      rawName: "PETR4",
      ticker: "PETR4",
      assetType: "stock",
      amount: 1000,
      currency: "BRL",
      status: "verified",
      pendingFields: [],
      sources: ["B3"],
      verifiedAsset: { code: "b3:PETR4", type: "stock", currency: "BRL" },
    },
  ],
  updatedAt: "2026-09-29T10:00:00+00:00",
};

const LOW_SENTINEL_BODY = {
  items: [
    {
      lineNumber: 2,
      rawName: LOW_SENTINEL_NAME,
      assetType: "stock",
      amount: 100,
      currency: "BRL",
      status: "verified",
      pendingFields: [],
      sources: [],
    },
  ],
  updatedAt: "2026-09-29T10:00:00+00:00",
};

const ENTRY_A = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  createdAt: "2026-09-29T10:00:00+00:00",
  updatedAt: "2026-09-29T10:00:00+00:00",
  items: [ONE_SUGGESTION_BODY.items[0]],
};

const ENTRY_B = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  createdAt: "2026-09-25T09:00:00+00:00",
  updatedAt: "2026-09-25T09:00:00+00:00",
  items: [MULTI_ITEMS[5]], // conflict -> resolve-conflicts
};

const CSV_TEXT = ["rawName,amount,currency", "PETR4,1000,BRL", "Ação Pendente,100,BRL"].join("\n");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function aieOk(): Response {
  return json({
    ok: true,
    result: {
      items: [
        {
          index: 0,
          candidateAssetId: "portfolio:sentinel:2",
          ok: true,
          result: {
            status: "verified",
            verifiedAsset: { canonicalAssetId: "PETR4", assetType: "stock", currency: "BRL", amount: 1000 },
            investigation: { evidence: [{ source: "B3", field: "identity", value: "v" }], searches: [], unresolvedFields: [] },
          },
        },
        {
          index: 1,
          candidateAssetId: "portfolio:sentinel:3",
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

function expectedAt(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString("pt-BR");
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${day} às ${time}`;
}

interface Answers {
  get?: () => Response | Promise<Response>;
  put?: () => Response | Promise<Response>;
  del?: () => Response | Promise<Response>;
  aie?: () => Response | Promise<Response>;
  list?: () => Response | Promise<Response>;
  getById?: () => Response | Promise<Response>;
  delById?: () => Response | Promise<Response>;
}

function setup(answers: Answers = {}) {
  const snapshotFetch = vi.fn<SnapshotFetch>(async (url, init) => {
    if (url === PORTFOLIO_SNAPSHOTS_URL) {
      return (answers.list ?? (() => json([ENTRY_A, ENTRY_B])))();
    }
    if (url.startsWith(`${PORTFOLIO_SNAPSHOTS_URL}/`)) {
      if (init.method === "GET") {
        return (answers.getById ?? (() => json(ENTRY_A)))();
      }
      return (answers.delById ?? (() => new Response(null, { status: 204 })))();
    }
    if (url === PORTFOLIO_SNAPSHOT_URL) {
      if (init.method === "GET") {
        return (answers.get ?? (() => json({}, 404)))();
      }
      if (init.method === "PUT") {
        return (answers.put ?? (() => json({ items: [], updatedAt: "2026-09-29T10:00:00+00:00" })))();
      }
      return (answers.del ?? (() => new Response(null, { status: 204 })))();
    }
    throw new Error(`unexpected url in test: ${url}`);
  });

  const aieFetch = vi.fn<NonNullable<SubmitPortfolioCsvInput["fetchImpl"]>>(async () => (answers.aie ?? aieOk)());

  const getSession = vi.fn(async (): Promise<SessionAccess> => ({ status: "ok", accessToken: TOKEN }));
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

function csv(content = CSV_TEXT, name = "carteira.csv") {
  return new File([content], name, { type: "text/csv", lastModified: 1_700_000_000_000 });
}

async function resolveIt(rig: Rig) {
  await rig.user.upload(screen.getByLabelText("Arquivo CSV ou Excel da carteira"), csv());
  await screen.findByRole("table", { name: /prévia/i });
  await rig.user.click(screen.getByRole("button", { name: /resolver carteira/i }));
  await screen.findByRole("table", { name: "Resultado da resolução de cada ativo" });
}

const PANEL_NAME = "Como melhorar esta resolução";

afterEach(() => {
  cleanup();
});

describe("visibility", () => {
  it("1. hidden before there is any result", async () => {
    setup();

    await screen.findByLabelText("Arquivo CSV ou Excel da carteira");

    expect(screen.queryByRole("region", { name: PANEL_NAME })).toBeNull();
  });

  it("2. hidden when the plan is empty (fully verified portfolio)", async () => {
    setup({ get: () => json(ALL_VERIFIED_BODY) });

    await screen.findByRole("region", { name: "Resultado salvo" });

    expect(screen.queryByRole("region", { name: PANEL_NAME })).toBeNull();
    expect(screen.queryByText(/Nenhuma sugestão/i)).toBeNull();
  });

  it("3. one suggestion", async () => {
    setup({ get: () => json(ONE_SUGGESTION_BODY) });

    const panel = await screen.findByRole("region", { name: PANEL_NAME });

    expect(within(panel).getAllByRole("heading", { level: 3 })).toHaveLength(1);
  });

  it("4. multiple suggestions", async () => {
    setup({ get: () => json(MULTI_BODY) });

    const panel = await screen.findByRole("region", { name: PANEL_NAME });

    expect(within(panel).getAllByRole("heading", { level: 3 })).toHaveLength(5);
  });
});

describe("content and ordering", () => {
  it("5. order matches the helper exactly", async () => {
    setup({ get: () => json(MULTI_BODY) });

    const panel = await screen.findByRole("region", { name: PANEL_NAME });
    const headings = within(panel).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);

    expect(headings).toEqual([
      "Forneça mais informações dos ativos",
      "Identifique o tipo dos ativos",
      "Revise os ativos com erro",
      "Complete os dados obrigatórios",
      "Resolva informações conflitantes",
    ]);
  });

  it("6. badge shows affectedItems", async () => {
    setup({ get: () => json(MULTI_BODY) });

    const panel = await screen.findByRole("region", { name: PANEL_NAME });
    const heading = within(panel).getByText("Forneça mais informações dos ativos");
    const card = heading.closest("li");
    if (!card) throw new Error("no <li> found");

    expect(within(card as HTMLElement).getByText("2 ativos")).toBeInTheDocument();
  });
});

describe("priority styling", () => {
  it("7. high priority uses the danger palette", async () => {
    setup({ get: () => json(ONE_SUGGESTION_BODY) }); // provide-more-evidence -> high

    const panel = await screen.findByRole("region", { name: PANEL_NAME });
    const card = within(panel).getByText("Forneça mais informações dos ativos").closest("li");

    expect((card as HTMLElement).className).toContain("aligna-dangerSoft");
  });

  it("8. medium priority uses the warn palette", async () => {
    setup({ get: () => json(MULTI_BODY) });

    const panel = await screen.findByRole("region", { name: PANEL_NAME });
    const card = within(panel).getByText("Complete os dados obrigatórios").closest("li");

    expect((card as HTMLElement).className).toContain("aligna-warnSoft");
  });

  it("9. low priority uses the info palette (synthetic branch)", async () => {
    setup({ get: () => json(LOW_SENTINEL_BODY) });

    const panel = await screen.findByRole("region", { name: PANEL_NAME });
    const card = within(panel).getByText("Sugestão de baixa prioridade (exemplo)").closest("li");

    expect((card as HTMLElement).className).toContain("aligna-infoSoft");
  });
});

describe("integration across result sources", () => {
  it("10. appears in a saved snapshot", async () => {
    setup({ get: () => json(MULTI_BODY) });

    const saved = await screen.findByRole("region", { name: "Resultado salvo" });

    expect(within(saved).getByRole("region", { name: PANEL_NAME })).toBeInTheDocument();
  });

  it("11. appears when opening a snapshot from history", async () => {
    setup({ getById: () => json(ENTRY_A) });

    await screen.findByRole("region", { name: "Histórico de resultados salvos" });
    await userEvent.click(
      screen.getByRole("button", { name: `Abrir resultado salvo de ${expectedAt(ENTRY_A.createdAt)}` }),
    );

    const saved = await screen.findByRole("region", { name: "Resultado salvo" });
    expect(within(saved).getByRole("region", { name: PANEL_NAME })).toBeInTheDocument();
  });

  it("12. updates when a different snapshot is opened", async () => {
    const rig = setup({ getById: () => json(ENTRY_A) });

    await screen.findByRole("region", { name: "Histórico de resultados salvos" });
    await rig.user.click(
      screen.getByRole("button", { name: `Abrir resultado salvo de ${expectedAt(ENTRY_A.createdAt)}` }),
    );
    let saved = await screen.findByRole("region", { name: "Resultado salvo" });
    let panel = within(saved).getByRole("region", { name: PANEL_NAME });
    expect(within(panel).getByText("Forneça mais informações dos ativos")).toBeInTheDocument();

    rig.snapshotFetch.mockImplementation(async (url, init) => {
      if (url === PORTFOLIO_SNAPSHOTS_URL) return json([ENTRY_A, ENTRY_B]);
      if (url.startsWith(`${PORTFOLIO_SNAPSHOTS_URL}/`) && init.method === "GET") return json(ENTRY_B);
      if (url === PORTFOLIO_SNAPSHOT_URL && init.method === "GET") return json({}, 404);
      return new Response(null, { status: 204 });
    });

    await rig.user.click(
      screen.getByRole("button", { name: `Abrir resultado salvo de ${expectedAt(ENTRY_B.createdAt)}` }),
    );

    saved = await screen.findByRole("region", { name: "Resultado salvo" });
    panel = within(saved).getByRole("region", { name: PANEL_NAME });
    expect(within(panel).getByText("Resolva informações conflitantes")).toBeInTheDocument();
  });

  it("13. disappears when the displayed snapshot is deleted", async () => {
    const rig = setup({ get: () => json(MULTI_BODY), del: () => new Response(null, { status: 204 }) });

    const saved = await screen.findByRole("region", { name: "Resultado salvo" });
    await rig.user.click(within(saved).getByRole("button", { name: "Apagar resultado salvo" }));
    await rig.user.click(screen.getByRole("button", { name: "Sim, apagar" }));

    await screen.findByText("Resultado salvo apagado da sua conta.");
    expect(screen.queryByRole("region", { name: PANEL_NAME })).toBeNull();
  });

  it("14/15. no network or AIE call is triggered by rendering the panel", async () => {
    const rig = setup({ get: () => json(MULTI_BODY) });

    await screen.findByRole("region", { name: PANEL_NAME });

    expect(rig.aieFetch).not.toHaveBeenCalled();
  });
});

describe("accessibility", () => {
  it("16. headings: h2 title and h3 per suggestion", async () => {
    setup({ get: () => json(MULTI_BODY) });

    const panel = await screen.findByRole("region", { name: PANEL_NAME });

    expect(within(panel).getByRole("heading", { level: 2, name: PANEL_NAME })).toBeInTheDocument();
    expect(within(panel).getAllByRole("heading", { level: 3 }).length).toBeGreaterThan(0);
  });

  it("17. aria-labelledby points at the h2's id", async () => {
    setup({ get: () => json(MULTI_BODY) });

    const panel = await screen.findByRole("region", { name: PANEL_NAME });
    const heading = within(panel).getByRole("heading", { level: 2, name: PANEL_NAME });

    expect(panel.getAttribute("aria-labelledby")).toBe(heading.id);
  });

  it("18. icons are aria-hidden", async () => {
    setup({ get: () => json(MULTI_BODY) });

    const panel = await screen.findByRole("region", { name: PANEL_NAME });
    const icons = panel.querySelectorAll('svg[aria-hidden="true"]');

    expect(icons.length).toBeGreaterThan(0);
  });
});

describe("layout", () => {
  it("19. text elements carry break-words so long copy never overflows", async () => {
    setup({ get: () => json(ONE_SUGGESTION_BODY) });

    const panel = await screen.findByRole("region", { name: PANEL_NAME });
    const title = within(panel).getByText("Forneça mais informações dos ativos");
    const description = within(panel).getByText(
      "Alguns ativos precisam de informações adicionais para serem verificados automaticamente.",
    );

    expect(title.className).toContain("break-words");
    expect(description.className).toContain("break-words");
  });

  it("20. structural responsiveness: cards use min-w-0", async () => {
    setup({ get: () => json(ONE_SUGGESTION_BODY) });

    const panel = await screen.findByRole("region", { name: PANEL_NAME });
    const card = within(panel).getByText("Forneça mais informações dos ativos").closest("li");

    expect((card as HTMLElement).className).toContain("min-w-0");
  });
});

describe("no regression in sibling features", () => {
  it("21. quality panel regression", async () => {
    setup({ get: () => json(MULTI_BODY) });

    const saved = await screen.findByRole("region", { name: "Resultado salvo" });
    const qualityPanel = within(saved).getByRole("region", { name: "Qualidade da resolução" });

    expect(qualityPanel).toHaveTextContent("Total de ativos");
  });

  it("22. resolution explanations regression", async () => {
    setup({ get: () => json(MULTI_BODY) });

    const saved = await screen.findByRole("region", { name: "Resultado salvo" });

    expect(within(saved).getAllByText("Ativo verificado").length).toBeGreaterThan(0);
  });

  it("23. comparison regression", async () => {
    setup();

    const compare = await screen.findByRole("region", { name: "Comparar resultados salvos" });

    expect(within(compare).getByLabelText("Base")).toBeInTheDocument();
    expect(within(compare).getByLabelText("Alvo")).toBeInTheDocument();
  });

  it("24. export regression", async () => {
    const rig = setup({ get: () => json(MULTI_BODY) });

    const saved = await screen.findByRole("region", { name: "Resultado salvo" });
    const exportButton = within(saved).getByRole("button", { name: "Exportar CSV" });

    await expect(rig.user.click(exportButton)).resolves.not.toThrow();
  });
});

describe("structural smoke", () => {
  it("25. appears for a freshly resolved portfolio", async () => {
    const rig = setup();

    await resolveIt(rig);

    const table = screen.getByRole("table", { name: "Resultado da resolução de cada ativo" });
    const resultSection = table.closest("section");
    if (!resultSection) throw new Error("no result <section> found");

    const panel = within(resultSection as HTMLElement).getByRole("region", { name: PANEL_NAME });
    expect(within(panel).getAllByRole("heading", { level: 3 }).length).toBeGreaterThan(0);
  });
});
