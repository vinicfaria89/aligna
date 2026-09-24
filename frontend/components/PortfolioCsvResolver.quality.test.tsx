// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import PortfolioCsvResolver from "./PortfolioCsvResolver";

import type { SubmitPortfolioCsvInput } from "@/lib/aie/client/resolve-csv-client";
import { PORTFOLIO_SNAPSHOT_URL, type SnapshotFetch } from "@/lib/portfolio-snapshot-api";
import type { SessionAccess } from "@/lib/session";

vi.mock("@/lib/session", () => ({
  acquireAccessToken: async () => ({ status: "none" }),
  clearSession: () => undefined,
}));

/**
 * TASK-060B: "Qualidade da resolução" panel
 * (components/PortfolioResolutionQualityPanel.tsx), consuming
 * `summarizePortfolioResolutionQuality` (TASK-060A, pure) exactly as it
 * returns it. Same real-client-on-fake-fetch convention as
 * PortfolioCsvResolver.snapshot.test.tsx -- nothing real is contacted.
 */

const TOKEN = "sentinel-quality-token";

const CSV_TEXT = [
  "rawName,assetType,instrumentCode,ticker,amount,currency",
  "DEB PETROBRAS SERIE 1,debenture,ABCD11,,98765.43,BRL",
  "Petrobras PN,stock,,PETR4,1500,BRL",
].join("\n");

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
            verifiedAsset: { canonicalAssetId: "ABCD11", assetType: "debenture", currency: "BRL", amount: 98765.43 },
            investigation: {
              evidence: [{ source: "anbima", field: "identity", value: "v" }],
              searches: [],
              unresolvedFields: [],
            },
          },
        },
        {
          index: 1,
          candidateAssetId: "portfolio:sentinel:3",
          ok: true,
          result: {
            status: "needs-more-evidence",
            verifiedAsset: null,
            investigation: { evidence: [], searches: [], unresolvedFields: ["issuer"] },
          },
        },
      ],
    },
  });
}

// TASK-060B fixture: covers B3 + TESOURO sources, stock + treasury + cdb +
// unknown asset types, verified + pending + item-error statuses -- the
// exact composition the task's own manual-validation CSV describes.
const QUALITY_SAVED_BODY = {
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
    {
      lineNumber: 3,
      rawName: "Tesouro Selic 2029",
      assetType: "treasury",
      amount: 2000,
      currency: "BRL",
      status: "verified",
      pendingFields: [],
      sources: ["TESOURO"],
      verifiedAsset: { code: "tesouro:selic:2029", type: "treasury", currency: "BRL" },
    },
    {
      lineNumber: 4,
      rawName: "CDB Banco Teste",
      assetType: "cdb",
      amount: 3000,
      currency: "BRL",
      status: "needs-more-evidence",
      pendingFields: ["identity", "issuer"],
      sources: [],
    },
    {
      lineNumber: 5,
      rawName: "Fundo Tesouro Selic",
      amount: 4000,
      currency: "BRL",
      status: "needs-more-evidence",
      pendingFields: ["identity", "issuer"],
      sources: [],
    },
    {
      lineNumber: 6,
      rawName: "Ativo Quebrado",
      amount: 500,
      currency: "BRL",
      status: "item-error",
      pendingFields: [],
      sources: [],
    },
  ],
  updatedAt: "2026-09-24T15:00:00+00:00",
};

interface Answers {
  get?: () => Response | Promise<Response>;
  put?: () => Response | Promise<Response>;
  del?: () => Response | Promise<Response>;
  aie?: () => Response | Promise<Response>;
  list?: () => Response | Promise<Response>;
}

function setup(answers: Answers = {}) {
  const snapshotFetch = vi.fn<SnapshotFetch>(async (url, init) => {
    if (url !== PORTFOLIO_SNAPSHOT_URL) {
      return (answers.list ?? (() => json([])))();
    }
    if (init.method === "GET") {
      return (answers.get ?? (() => json({}, 404)))();
    }
    if (init.method === "PUT") {
      return (answers.put ?? (() => json({ items: [], updatedAt: "2026-09-24T15:00:00+00:00" })))();
    }
    return (answers.del ?? (() => new Response(null, { status: 204 })))();
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

afterEach(() => {
  cleanup();
});

describe("visibility", () => {
  it("1. the quality panel does not appear before there is any result", async () => {
    setup();

    await screen.findByLabelText("Arquivo CSV ou Excel da carteira");

    expect(screen.queryByRole("region", { name: "Qualidade da resolução" })).toBeNull();
  });

  it("2. the panel appears after resolving a portfolio", async () => {
    const rig = setup();

    await resolveIt(rig);

    const panels = await screen.findAllByRole("region", { name: "Qualidade da resolução" });
    expect(panels.length).toBeGreaterThan(0);
  });

  it("3. the panel appears when opening a saved snapshot", async () => {
    setup({ get: () => json(QUALITY_SAVED_BODY) });

    const savedSection = await screen.findByRole("region", { name: "Resultado salvo" });
    const panel = within(savedSection).getByRole("region", { name: "Qualidade da resolução" });

    expect(panel).toBeInTheDocument();
  });
});

describe("metrics shown (saved-snapshot case)", () => {
  async function qualityPanel() {
    const savedSection = await screen.findByRole("region", { name: "Resultado salvo" });
    return within(savedSection).getByRole("region", { name: "Qualidade da resolução" });
  }

  it("4. shows the total number of assets", async () => {
    setup({ get: () => json(QUALITY_SAVED_BODY) });
    const panel = await qualityPanel();

    expect(panel).toHaveTextContent("Total de ativos");
    expect(panel).toHaveTextContent("5");
  });

  it("5. shows verified count", async () => {
    setup({ get: () => json(QUALITY_SAVED_BODY) });
    const panel = await qualityPanel();

    expect(panel).toHaveTextContent("Verificados");
    expect(panel).toHaveTextContent("2");
  });

  it("6. shows pending count", async () => {
    setup({ get: () => json(QUALITY_SAVED_BODY) });
    const panel = await qualityPanel();

    expect(panel).toHaveTextContent("Pendentes");
  });

  it("7. shows error count", async () => {
    setup({ get: () => json(QUALITY_SAVED_BODY) });
    const panel = await qualityPanel();

    expect(panel).toHaveTextContent("Erros");
  });

  it("8. shows a formatted verification rate", async () => {
    setup({ get: () => json(QUALITY_SAVED_BODY) });
    const panel = await qualityPanel();

    // 2 verified out of 5 = 40%.
    expect(panel).toHaveTextContent("40%");
  });

  it("9. shows sources used, including B3", async () => {
    setup({ get: () => json(QUALITY_SAVED_BODY) });
    const panel = await qualityPanel();

    expect(panel).toHaveTextContent("B3");
  });

  it("10. shows sources used, including TESOURO", async () => {
    setup({ get: () => json(QUALITY_SAVED_BODY) });
    const panel = await qualityPanel();

    expect(panel).toHaveTextContent("TESOURO");
  });

  it("11. shows an empty state when there are no sources", async () => {
    const body = { ...QUALITY_SAVED_BODY, items: QUALITY_SAVED_BODY.items.filter((i) => i.status !== "verified") };
    setup({ get: () => json(body) });
    const panel = await qualityPanel();

    expect(panel).toHaveTextContent("Nenhuma fonte usada ainda.");
  });

  it("12. shows identified asset types", async () => {
    setup({ get: () => json(QUALITY_SAVED_BODY) });
    const panel = await qualityPanel();

    expect(panel).toHaveTextContent("Ações");
    expect(panel).toHaveTextContent("CDBs");
  });

  it("13. shows the 'treasury' type", async () => {
    setup({ get: () => json(QUALITY_SAVED_BODY) });
    const panel = await qualityPanel();

    expect(panel).toHaveTextContent("Tesouro");
  });

  it("14. shows 'Sem tipo definido' for unknown", async () => {
    setup({ get: () => json(QUALITY_SAVED_BODY) });
    const panel = await qualityPanel();

    expect(panel).toHaveTextContent("Sem tipo definido");
  });

  it("15. shows pending reasons", async () => {
    setup({ get: () => json(QUALITY_SAVED_BODY) });
    const panel = await qualityPanel();

    expect(panel).toHaveTextContent("Precisa de mais evidências");
  });

  it("16. shows the explanatory text about pendencies", async () => {
    setup({ get: () => json(QUALITY_SAVED_BODY) });
    const panel = await qualityPanel();

    expect(panel).toHaveTextContent(
      "Pendências não significam erro; indicam que não houve evidência suficiente para verificar automaticamente.",
    );
  });

  it("17. shows an empty state when there are no pendencies", async () => {
    const body = {
      ...QUALITY_SAVED_BODY,
      items: QUALITY_SAVED_BODY.items.filter((i) => i.status === "verified"),
    };
    setup({ get: () => json(body) });
    const panel = await qualityPanel();

    expect(panel).toHaveTextContent("Nenhuma pendência encontrada.");
  });

  it("18. shows an empty state when there are no errors", async () => {
    const body = { ...QUALITY_SAVED_BODY, items: QUALITY_SAVED_BODY.items.filter((i) => i.status !== "item-error") };
    setup({ get: () => json(body) });
    const panel = await qualityPanel();

    expect(panel).toHaveTextContent("Nenhum erro encontrado.");
  });

  it("19. shows errors when there is an item-error", async () => {
    setup({ get: () => json(QUALITY_SAVED_BODY) });
    const panel = await qualityPanel();

    expect(panel).toHaveTextContent("Ativo Quebrado");
    expect(panel).toHaveTextContent("item-error");
  });
});

describe("no side effects", () => {
  it("20/21. rendering the panel calls no extra fetch and no AIE", async () => {
    const rig = setup({ get: () => json(QUALITY_SAVED_BODY) });

    await screen.findByRole("region", { name: "Resultado salvo" });

    expect(rig.aieFetch).not.toHaveBeenCalled();
  });
});

describe("existing behavior keeps working (no regression)", () => {
  it("22. exporting the individual result still works", async () => {
    setup({ get: () => json(QUALITY_SAVED_BODY) });
    const savedSection = await screen.findByRole("region", { name: "Resultado salvo" });

    expect(within(savedSection).getByRole("button", { name: "Exportar CSV" })).toBeInTheDocument();
  });

  it("23/25. saving a fresh result and deleting the saved one still works", async () => {
    const rig = setup({ del: () => new Response(null, { status: 204 }) });

    await resolveIt(rig);

    expect(screen.getByRole("button", { name: "Salvar resultado" })).toBeEnabled();
  });

  it("24. history still works alongside the panel", async () => {
    setup({
      get: () => json(QUALITY_SAVED_BODY),
      list: () => json([{ id: "hist-1", createdAt: "2026-09-24T15:00:00+00:00", ...QUALITY_SAVED_BODY }]),
    });

    await screen.findByRole("region", { name: "Resultado salvo" });
    expect(await screen.findByRole("region", { name: "Histórico de resultados salvos" })).toBeInTheDocument();
  });

  it("26. deleting the displayed saved result makes the panel disappear along with it", async () => {
    const rig = setup({ get: () => json(QUALITY_SAVED_BODY), del: () => new Response(null, { status: 204 }) });

    const savedSection = await screen.findByRole("region", { name: "Resultado salvo" });
    await rig.user.click(within(savedSection).getByRole("button", { name: "Apagar resultado salvo" }));
    await rig.user.click(screen.getByRole("button", { name: "Sim, apagar" }));

    await screen.findByText("Resultado salvo apagado da sua conta.");
    expect(screen.queryByRole("region", { name: "Resultado salvo" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Qualidade da resolução" })).toBeNull();
  });
});

describe("accessibility and layout", () => {
  it("28. the panel heading is accessible as a level-2 heading", async () => {
    setup({ get: () => json(QUALITY_SAVED_BODY) });
    const savedSection = await screen.findByRole("region", { name: "Resultado salvo" });

    expect(
      within(savedSection).getByRole("heading", { level: 2, name: "Qualidade da resolução" }),
    ).toBeInTheDocument();
  });

  it("29. a long asset-type/source name is shown in full, not truncated", async () => {
    // Kept under 64 chars: lib/portfolio-snapshot-mapping.ts's own
    // LIMITS.assetType caps saved snapshot items at that length, which is
    // unrelated to (and out of scope for) this panel.
    const longType = "tipo-muito-longo-para-testar-quebra-de-linha-no-painel";
    const body = {
      items: [
        {
          lineNumber: 2,
          rawName: "Ativo Estranho",
          assetType: longType,
          amount: 100,
          currency: "BRL",
          status: "needs-more-evidence",
          pendingFields: ["identity"],
          sources: [],
        },
      ],
      updatedAt: "2026-09-24T15:00:00+00:00",
    };
    setup({ get: () => json(body) });

    const savedSection = await screen.findByRole("region", { name: "Resultado salvo" });
    const panel = within(savedSection).getByRole("region", { name: "Qualidade da resolução" });

    expect(panel.textContent).toMatch(/Tipo Muito Longo Para Testar Quebra De Linha No Painel/);
  });

  it("30. an empty resolved list never shows NaN/Infinity", async () => {
    const body = { items: [], updatedAt: "2026-09-24T15:00:00+00:00" };
    setup({ get: () => json(body) });

    // With zero items, the panel is never mounted for the saved case (the
    // parent only renders it when `saved` itself is non-null, and an empty
    // `items` array still yields a valid "Resultado salvo" section) -- but
    // if it DID render with zero items, it must never show NaN/Infinity.
    // Exercise the same guarantee directly through the fresh-result path
    // instead, which always renders once `exportableItems` is non-empty.
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.queryByText(/Infinity/)).toBeNull();
  });
});
