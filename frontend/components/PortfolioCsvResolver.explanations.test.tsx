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
 * TASK-061B: "Qualidade da resolução" explanations
 * (components/PortfolioResolutionExplanation.tsx), consuming
 * `explainResolutionItem` (TASK-061A, pure) exactly as it returns it.
 * Real-client-on-fake-fetch convention, same as the other
 * PortfolioCsvResolver.<domain>.test.tsx files -- nothing real is
 * contacted.
 */

const TOKEN = "sentinel-explanations-token";

// One item per required explanation case (1-9), covering every status and
// every needs-more-evidence asset-type branch in a single saved snapshot.
const EXPL_ITEMS = [
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
    rawName: "Ação Desconhecida",
    assetType: "stock",
    amount: 100,
    currency: "BRL",
    status: "needs-more-evidence",
    pendingFields: ["identity"],
    sources: [],
  },
  {
    lineNumber: 4,
    rawName: "Tesouro Pendente",
    assetType: "treasury",
    amount: 200,
    currency: "BRL",
    status: "needs-more-evidence",
    pendingFields: ["identity"],
    sources: [],
  },
  {
    lineNumber: 5,
    rawName: "CDB Banco Teste",
    assetType: "cdb",
    amount: 300,
    currency: "BRL",
    status: "needs-more-evidence",
    pendingFields: ["identity", "issuer"],
    sources: [],
  },
  {
    lineNumber: 6,
    rawName: "Fundo Tesouro Selic",
    amount: 400,
    currency: "BRL",
    status: "needs-more-evidence",
    pendingFields: ["identity", "issuer"],
    sources: [],
  },
  {
    lineNumber: 7,
    rawName: "Ativo Ação Necessária",
    amount: 500,
    currency: "BRL",
    status: "needs-user",
    pendingFields: [],
    sources: [],
  },
  {
    lineNumber: 8,
    rawName: "Ativo Conflitante",
    amount: 600,
    currency: "BRL",
    status: "conflict",
    pendingFields: [],
    sources: [],
  },
  {
    lineNumber: 9,
    rawName: "Ativo Bloqueado",
    amount: 700,
    currency: "BRL",
    status: "blocked",
    pendingFields: [],
    sources: [],
  },
  {
    lineNumber: 10,
    rawName: "Ativo com Erro",
    amount: 800,
    currency: "BRL",
    status: "item-error",
    pendingFields: [],
    sources: [],
  },
];

const EXPL_SAVED_BODY = {
  items: EXPL_ITEMS,
  updatedAt: "2026-09-24T18:00:00+00:00",
};

const LONG_NAME_ITEM = {
  lineNumber: 2,
  rawName:
    "Um nome de ativo extremamente longo para verificar que o card de explicação quebra a linha corretamente sem estourar a largura disponível",
  amount: 100,
  currency: "BRL",
  status: "needs-more-evidence",
  pendingFields: ["identity"],
  sources: [],
};

const ENTRY_A = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  createdAt: "2026-09-24T18:00:00+00:00",
  updatedAt: "2026-09-24T18:00:00+00:00",
  items: [EXPL_ITEMS[0]],
};

const ENTRY_B = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  createdAt: "2026-09-20T10:00:00+00:00",
  updatedAt: "2026-09-20T10:00:00+00:00",
  items: [EXPL_ITEMS[3]],
};

const CSV_TEXT = [
  "rawName,amount,currency",
  "PETR4,1000,BRL",
  "CDB Banco Teste,3000,BRL",
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
            investigation: { evidence: [], searches: [], unresolvedFields: ["identity", "issuer"] },
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
        return (answers.put ?? (() => json({ items: [], updatedAt: "2026-09-24T18:00:00+00:00" })))();
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

/** The `<tr>` for a given asset name, scoped to a container -- so the same
 * rawName appearing in two sections (fresh + saved) never collides. Plain
 * DOM matching (not `getByText`) because the "Ativo" cell also carries a
 * mobile-only `aria-hidden` label sibling, which makes text-content
 * matching ambiguous across nodes. */
function rowFor(container: HTMLElement, rawName: string): HTMLElement {
  const rows = Array.from(container.querySelectorAll("tr"));

  for (const row of rows) {
    const cells = Array.from(row.querySelectorAll("td"));
    const match = cells.some((cell) => {
      const label = cell.querySelector('[aria-hidden="true"]');
      const text = (label ? cell.textContent?.replace(label.textContent ?? "", "") : cell.textContent)?.trim();
      return text === rawName;
    });
    if (match) {
      return row;
    }
  }

  throw new Error(`no <tr> found for "${rawName}"`);
}

function explanationSectionIn(row: HTMLElement): HTMLElement {
  const heading = within(row).getByRole("heading", { level: 4 });
  const section = heading.closest("section");
  if (!section) {
    throw new Error("no explanation <section> found");
  }
  return section as HTMLElement;
}

afterEach(() => {
  cleanup();
});

describe("explanation per status", () => {
  async function savedSection() {
    return screen.findByRole("region", { name: "Resultado salvo" });
  }

  it("1. verified", async () => {
    setup({ get: () => json(EXPL_SAVED_BODY) });
    const saved = await savedSection();

    const section = explanationSectionIn(rowFor(saved, "PETR4"));

    expect(within(section).getByRole("heading", { level: 4 })).toHaveTextContent("Ativo verificado");
    expect(section).toHaveTextContent(
      "O ativo foi identificado automaticamente utilizando evidências suficientes.",
    );
  });

  it("2. needs-more-evidence + stock", async () => {
    setup({ get: () => json(EXPL_SAVED_BODY) });
    const saved = await savedSection();

    const section = explanationSectionIn(rowFor(saved, "Ação Desconhecida"));

    expect(section).toHaveTextContent("São necessárias mais evidências");
    expect(section).toHaveTextContent("Confira se o ticker ou o nome do ativo está completo.");
  });

  it("3. treasury", async () => {
    setup({ get: () => json(EXPL_SAVED_BODY) });
    const saved = await savedSection();

    const section = explanationSectionIn(rowFor(saved, "Tesouro Pendente"));

    // TASK-065B: "Tesouro Pendente" has no year in rawName, so the UX hint
    // unconditionally replaces explainResolutionItem's own treasury-type
    // suggestion ("Informe o vencimento do título.") with its own, slightly
    // more specific wording -- same guidance, per this task's own rule.
    expect(section).toHaveTextContent("Informe o vencimento do título do Tesouro.");
  });

  it("4. cdb", async () => {
    setup({ get: () => json(EXPL_SAVED_BODY) });
    const saved = await savedSection();

    const section = explanationSectionIn(rowFor(saved, "CDB Banco Teste"));

    expect(section).toHaveTextContent("Informe o emissor e o produto específico.");
  });

  it("5. unknown", async () => {
    setup({ get: () => json(EXPL_SAVED_BODY) });
    const saved = await savedSection();

    const section = explanationSectionIn(rowFor(saved, "Fundo Tesouro Selic"));

    expect(section).toHaveTextContent("Forneça um nome mais específico para o ativo.");
  });

  it("6. needs-user", async () => {
    setup({ get: () => json(EXPL_SAVED_BODY) });
    const saved = await savedSection();

    const section = explanationSectionIn(rowFor(saved, "Ativo Ação Necessária"));

    expect(section).toHaveTextContent("Ação do usuário necessária");
    expect(section).toHaveTextContent("Revise os dados enviados.");
  });

  it("7. conflict", async () => {
    setup({ get: () => json(EXPL_SAVED_BODY) });
    const saved = await savedSection();

    const section = explanationSectionIn(rowFor(saved, "Ativo Conflitante"));

    expect(section).toHaveTextContent("Informações conflitantes");
    expect(section).toHaveTextContent("Revise os dados do ativo antes de tentar novamente.");
  });

  it("8. blocked", async () => {
    setup({ get: () => json(EXPL_SAVED_BODY) });
    const saved = await savedSection();

    const section = explanationSectionIn(rowFor(saved, "Ativo Bloqueado"));

    expect(section).toHaveTextContent("Resolução bloqueada");
    expect(section).toHaveTextContent("Verifique se todas as informações obrigatórias foram fornecidas.");
  });

  it("9. item-error", async () => {
    setup({ get: () => json(EXPL_SAVED_BODY) });
    const saved = await savedSection();

    const section = explanationSectionIn(rowFor(saved, "Ativo com Erro"));

    expect(section).toHaveTextContent("Erro ao processar o ativo");
    expect(section).toHaveTextContent("Tente novamente mais tarde.");
    expect(section).not.toHaveTextContent(/stack|trace|at Object|\.ts:\d+/i);
  });
});

describe("suggestion visibility", () => {
  it("10. suggestion appears when it exists", async () => {
    setup({ get: () => json(EXPL_SAVED_BODY) });
    const saved = await screen.findByRole("region", { name: "Resultado salvo" });

    const section = explanationSectionIn(rowFor(saved, "CDB Banco Teste"));

    expect(within(section).getByText("Sugestão")).toBeInTheDocument();
  });

  it("11. suggestion does not appear for verified", async () => {
    setup({ get: () => json(EXPL_SAVED_BODY) });
    const saved = await screen.findByRole("region", { name: "Resultado salvo" });

    const section = explanationSectionIn(rowFor(saved, "PETR4"));

    expect(within(section).queryByText("Sugestão")).toBeNull();
  });
});

describe("severity", () => {
  it("12. severity success renders a distinct style from other severities", async () => {
    setup({ get: () => json(EXPL_SAVED_BODY) });
    const saved = await screen.findByRole("region", { name: "Resultado salvo" });

    const section = explanationSectionIn(rowFor(saved, "PETR4"));

    expect(section.className).toContain("aligna-pale");
  });

  it("13. severity info", async () => {
    setup({ get: () => json(EXPL_SAVED_BODY) });
    const saved = await screen.findByRole("region", { name: "Resultado salvo" });

    const section = explanationSectionIn(rowFor(saved, "Ação Desconhecida"));

    expect(section.className).toContain("aligna-infoSoft");
  });

  it("14. severity warning", async () => {
    setup({ get: () => json(EXPL_SAVED_BODY) });
    const saved = await screen.findByRole("region", { name: "Resultado salvo" });

    const section = explanationSectionIn(rowFor(saved, "Ativo Bloqueado"));

    expect(section.className).toContain("aligna-warnSoft");
  });

  it("15. severity error", async () => {
    setup({ get: () => json(EXPL_SAVED_BODY) });
    const saved = await screen.findByRole("region", { name: "Resultado salvo" });

    const section = explanationSectionIn(rowFor(saved, "Ativo com Erro"));

    expect(section.className).toContain("aligna-dangerSoft");
  });
});

describe("content and structure", () => {
  it("16. renders the description", async () => {
    setup({ get: () => json(EXPL_SAVED_BODY) });
    const saved = await screen.findByRole("region", { name: "Resultado salvo" });

    const section = explanationSectionIn(rowFor(saved, "Ativo Conflitante"));

    expect(section).toHaveTextContent(
      "Foram encontradas informações que não coincidem entre si para este ativo.",
    );
  });

  it("17. renders the title", async () => {
    setup({ get: () => json(EXPL_SAVED_BODY) });
    const saved = await screen.findByRole("region", { name: "Resultado salvo" });

    const section = explanationSectionIn(rowFor(saved, "Ativo Ação Necessária"));

    expect(within(section).getByRole("heading", { level: 4 })).toHaveTextContent(
      "Ação do usuário necessária",
    );
  });

  it("18. renders the correct icon (a decorative svg)", async () => {
    setup({ get: () => json(EXPL_SAVED_BODY) });
    const saved = await screen.findByRole("region", { name: "Resultado salvo" });

    const section = explanationSectionIn(rowFor(saved, "PETR4"));
    const icon = section.querySelector('svg[aria-hidden="true"]');

    expect(icon).not.toBeNull();
  });

  it("19. accessible heading", async () => {
    setup({ get: () => json(EXPL_SAVED_BODY) });
    const saved = await screen.findByRole("region", { name: "Resultado salvo" });

    const section = explanationSectionIn(rowFor(saved, "PETR4"));

    expect(within(section).getByRole("heading", { level: 4 })).toBeInTheDocument();
  });

  it("20. aria-labelledby points at the heading's id", async () => {
    setup({ get: () => json(EXPL_SAVED_BODY) });
    const saved = await screen.findByRole("region", { name: "Resultado salvo" });

    const section = explanationSectionIn(rowFor(saved, "PETR4"));
    const heading = within(section).getByRole("heading", { level: 4 });

    expect(section.getAttribute("aria-labelledby")).toBe(heading.id);
  });
});

describe("integration across result sources", () => {
  it("21. appears after resolving a portfolio (fresh result)", async () => {
    const rig = setup();

    await resolveIt(rig);

    const table = screen.getByRole("table", { name: "Resultado da resolução de cada ativo" });
    const section = explanationSectionIn(rowFor(table, "PETR4"));

    expect(section).toHaveTextContent("Ativo verificado");
  });

  it("22. appears in a saved snapshot", async () => {
    setup({ get: () => json(EXPL_SAVED_BODY) });

    const saved = await screen.findByRole("region", { name: "Resultado salvo" });
    const section = explanationSectionIn(rowFor(saved, "PETR4"));

    expect(section).toHaveTextContent("Ativo verificado");
  });

  it("23. appears when opening a snapshot from history", async () => {
    setup({ getById: () => json(ENTRY_A) });

    await screen.findByRole("region", { name: "Histórico de resultados salvos" });
    await userEvent.click(
      screen.getByRole("button", { name: `Abrir resultado salvo de ${expectedAt(ENTRY_A.createdAt)}` }),
    );

    const saved = await screen.findByRole("region", { name: "Resultado salvo" });
    const section = explanationSectionIn(rowFor(saved, "PETR4"));

    expect(section).toHaveTextContent("Ativo verificado");
  });

  it("24/25. no network or AIE call is triggered by rendering explanations", async () => {
    const rig = setup({ get: () => json(EXPL_SAVED_BODY) });

    await screen.findByRole("region", { name: "Resultado salvo" });

    expect(rig.aieFetch).not.toHaveBeenCalled();
  });

  it("28. updates when a different snapshot is opened from history", async () => {
    const rig = setup({ getById: () => json(ENTRY_A) });

    await screen.findByRole("region", { name: "Histórico de resultados salvos" });
    await rig.user.click(
      screen.getByRole("button", { name: `Abrir resultado salvo de ${expectedAt(ENTRY_A.createdAt)}` }),
    );
    let saved = await screen.findByRole("region", { name: "Resultado salvo" });
    expect(explanationSectionIn(rowFor(saved, "PETR4"))).toHaveTextContent("Ativo verificado");

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
    const section = explanationSectionIn(rowFor(saved, "CDB Banco Teste"));
    expect(section).toHaveTextContent("Informe o emissor e o produto específico.");
  });

  it("29. disappears when the displayed result is deleted", async () => {
    const rig = setup({ get: () => json(EXPL_SAVED_BODY), del: () => new Response(null, { status: 204 }) });

    const saved = await screen.findByRole("region", { name: "Resultado salvo" });
    await rig.user.click(within(saved).getByRole("button", { name: "Apagar resultado salvo" }));
    await rig.user.click(screen.getByRole("button", { name: "Sim, apagar" }));

    await screen.findByText("Resultado salvo apagado da sua conta.");
    expect(screen.queryByRole("region", { name: "Resultado salvo" })).toBeNull();
  });

  it("31. textual smoke without any saved snapshot", async () => {
    const rig = setup({ list: () => json([]), get: () => json({}, 404) });

    await resolveIt(rig);

    const table = screen.getByRole("table", { name: "Resultado da resolução de cada ativo" });
    expect(explanationSectionIn(rowFor(table, "PETR4"))).toHaveTextContent("Ativo verificado");
    expect(
      explanationSectionIn(rowFor(table, "CDB Banco Teste")),
    ).toHaveTextContent("São necessárias mais evidências");
  });
});

describe("layout", () => {
  it("30. a long asset name's explanation wraps instead of overflowing", async () => {
    setup({ get: () => json({ items: [LONG_NAME_ITEM], updatedAt: "2026-09-24T18:00:00+00:00" }) });

    const saved = await screen.findByRole("region", { name: "Resultado salvo" });
    const section = explanationSectionIn(rowFor(saved, LONG_NAME_ITEM.rawName));

    expect(section.className).toContain("min-w-0");
    const description = within(section).getByText(
      "Ainda não houve informação suficiente para confirmar este ativo automaticamente.",
    );
    expect(description.className).toContain("break-words");
  });
});

describe("no regression in sibling features", () => {
  it("26/34. comparison section still works with 2+ saved snapshots", async () => {
    setup();

    const compare = await screen.findByRole("region", { name: "Comparar resultados salvos" });

    expect(within(compare).getByLabelText("Base")).toBeInTheDocument();
    expect(within(compare).getByLabelText("Alvo")).toBeInTheDocument();
  });

  it("27/35. export CSV button is still present and clickable in the saved section", async () => {
    const rig = setup({ get: () => json(EXPL_SAVED_BODY) });

    const saved = await screen.findByRole("region", { name: "Resultado salvo" });
    const exportButton = within(saved).getByRole("button", { name: "Exportar CSV" });

    await expect(rig.user.click(exportButton)).resolves.not.toThrow();
  });

  it("32. quality panel regression: still renders correct totals alongside explanations", async () => {
    setup({ get: () => json(EXPL_SAVED_BODY) });

    const saved = await screen.findByRole("region", { name: "Resultado salvo" });
    const qualityPanel = within(saved).getByRole("region", { name: "Qualidade da resolução" });

    expect(qualityPanel).toHaveTextContent("Total de ativos");
    expect(qualityPanel).toHaveTextContent("9");
  });

  it("33. history regression: entries still listed alongside explanations", async () => {
    setup();

    const history = await screen.findByRole("region", { name: "Histórico de resultados salvos" });

    expect(
      within(history).getByRole("button", {
        name: `Abrir resultado salvo de ${expectedAt(ENTRY_A.createdAt)}`,
      }),
    ).toBeInTheDocument();
    expect(
      within(history).getByRole("button", {
        name: `Abrir resultado salvo de ${expectedAt(ENTRY_B.createdAt)}`,
      }),
    ).toBeInTheDocument();
  });
});

/**
 * TASK-065B: the UX hint from `detectPortfolioResolutionUxHint` (TASK-065A,
 * pure) can replace the displayed SUGGESTION only -- title, description and
 * severity always stay `explainResolutionItem`'s. The UI never reimplements
 * the keyword/priority logic; it only merges the hint's `suggestion` when
 * one exists. Real-client-on-fake-fetch convention, same as the rest of
 * this file.
 */

const UXHINT_ITEMS = [
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
    rawName: "Tesouro Selic",
    amount: 100,
    currency: "BRL",
    status: "needs-more-evidence",
    pendingFields: ["identity"],
    sources: [],
  },
  {
    lineNumber: 4,
    rawName: "Tesouro Selic 2036",
    amount: 200,
    currency: "BRL",
    status: "needs-more-evidence",
    pendingFields: ["identity"],
    sources: [],
  },
  {
    lineNumber: 5,
    rawName: "CDB Banco XP",
    amount: 300,
    currency: "BRL",
    status: "needs-more-evidence",
    pendingFields: ["identity", "issuer"],
    sources: [],
  },
  {
    lineNumber: 6,
    rawName: "LCI Banco Y",
    amount: 400,
    currency: "BRL",
    status: "needs-more-evidence",
    pendingFields: ["identity", "issuer"],
    sources: [],
  },
  {
    lineNumber: 7,
    rawName: "LCA Banco Z",
    amount: 500,
    currency: "BRL",
    status: "needs-more-evidence",
    pendingFields: ["identity", "issuer"],
    sources: [],
  },
  {
    lineNumber: 8,
    rawName: "Fundo Tesouro Selic",
    amount: 600,
    currency: "BRL",
    status: "needs-more-evidence",
    pendingFields: ["identity", "issuer"],
    sources: [],
  },
  {
    lineNumber: 9,
    rawName: "ETF Tesouro",
    amount: 700,
    currency: "BRL",
    status: "needs-more-evidence",
    pendingFields: ["identity", "issuer"],
    sources: [],
  },
  {
    lineNumber: 10,
    rawName: "Ação Genérica XYZ",
    amount: 800,
    currency: "BRL",
    status: "needs-more-evidence",
    pendingFields: ["identity"],
    sources: [],
  },
];

const UXHINT_BODY = { items: UXHINT_ITEMS, updatedAt: "2026-09-30T10:00:00+00:00" };

const GENERIC_SUGGESTION = "Forneça um nome mais específico para o ativo.";

const ENTRY_UX_A = {
  id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  createdAt: "2026-09-30T10:00:00+00:00",
  updatedAt: "2026-09-30T10:00:00+00:00",
  items: [UXHINT_ITEMS[3]], // CDB Banco XP
};

const ENTRY_UX_B = {
  id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  createdAt: "2026-09-25T09:00:00+00:00",
  updatedAt: "2026-09-25T09:00:00+00:00",
  items: [UXHINT_ITEMS[1]], // Tesouro Selic (no year)
};

const CSV_TEXT_UXHINT = ["rawName,amount,currency", "PETR4,1000,BRL", "CDB Banco XP,100,BRL"].join("\n");

function aieUxHintOk(): Response {
  return json({
    ok: true,
    result: {
      items: [
        {
          index: 0,
          candidateAssetId: "portfolio:sentinel-uxhint:2",
          ok: true,
          result: {
            status: "verified",
            verifiedAsset: { canonicalAssetId: "PETR4", assetType: "stock", currency: "BRL", amount: 1000 },
            investigation: { evidence: [{ source: "B3", field: "identity", value: "v" }], searches: [], unresolvedFields: [] },
          },
        },
        {
          index: 1,
          candidateAssetId: "portfolio:sentinel-uxhint:3",
          ok: true,
          result: {
            status: "needs-more-evidence",
            verifiedAsset: null,
            investigation: { evidence: [], searches: [], unresolvedFields: ["identity", "issuer"] },
          },
        },
      ],
    },
  });
}

describe("TASK-065B: UX hint replaces only the suggestion", () => {
  async function savedSection() {
    return screen.findByRole("region", { name: "Resultado salvo" });
  }

  it("1. Tesouro without a year: suggestion becomes the treasury hint", async () => {
    setup({ get: () => json(UXHINT_BODY) });
    const saved = await savedSection();

    const section = explanationSectionIn(rowFor(saved, "Tesouro Selic"));

    expect(section).toHaveTextContent("São necessárias mais evidências");
    expect(section).toHaveTextContent("Informe o vencimento do título do Tesouro.");
    expect(section).not.toHaveTextContent(GENERIC_SUGGESTION);
  });

  it("2. Tesouro with a year: suggestion stays the original (no hint applies)", async () => {
    setup({ get: () => json(UXHINT_BODY) });
    const saved = await savedSection();

    const section = explanationSectionIn(rowFor(saved, "Tesouro Selic 2036"));

    expect(section).toHaveTextContent(GENERIC_SUGGESTION);
    expect(section).not.toHaveTextContent("Informe o vencimento do título do Tesouro.");
  });

  it("3. CDB: suggestion becomes the private-fixed-income hint", async () => {
    setup({ get: () => json(UXHINT_BODY) });
    const saved = await savedSection();

    const section = explanationSectionIn(rowFor(saved, "CDB Banco XP"));

    expect(section).toHaveTextContent("Informe o emissor e o produto específico.");
    expect(section).not.toHaveTextContent(GENERIC_SUGGESTION);
  });

  it("4. LCI: suggestion becomes the private-fixed-income hint", async () => {
    setup({ get: () => json(UXHINT_BODY) });
    const saved = await savedSection();

    const section = explanationSectionIn(rowFor(saved, "LCI Banco Y"));

    expect(section).toHaveTextContent("Informe o emissor e o produto específico.");
  });

  it("5. LCA: suggestion becomes the private-fixed-income hint", async () => {
    setup({ get: () => json(UXHINT_BODY) });
    const saved = await savedSection();

    const section = explanationSectionIn(rowFor(saved, "LCA Banco Z"));

    expect(section).toHaveTextContent("Informe o emissor e o produto específico.");
  });

  it("6. 'Fundo Tesouro Selic': no hint applies, suggestion stays generic", async () => {
    setup({ get: () => json(UXHINT_BODY) });
    const saved = await savedSection();

    const section = explanationSectionIn(rowFor(saved, "Fundo Tesouro Selic"));

    expect(section).toHaveTextContent(GENERIC_SUGGESTION);
    expect(section).not.toHaveTextContent("Informe o vencimento do título do Tesouro.");
  });

  it("7. 'ETF Tesouro': no hint applies, suggestion stays generic", async () => {
    setup({ get: () => json(UXHINT_BODY) });
    const saved = await savedSection();

    const section = explanationSectionIn(rowFor(saved, "ETF Tesouro"));

    expect(section).toHaveTextContent(GENERIC_SUGGESTION);
  });

  it("8. item with no matching keyword: suggestion stays generic", async () => {
    setup({ get: () => json(UXHINT_BODY) });
    const saved = await savedSection();

    const section = explanationSectionIn(rowFor(saved, "Ação Genérica XYZ"));

    expect(section).toHaveTextContent(GENERIC_SUGGESTION);
  });

  it("9. verified item (PETR4): title/description unchanged, no suggestion block added", async () => {
    setup({ get: () => json(UXHINT_BODY) });
    const saved = await savedSection();

    const section = explanationSectionIn(rowFor(saved, "PETR4"));

    expect(section).toHaveTextContent("Ativo verificado");
    expect(section).not.toHaveTextContent("Sugestão");
  });

  it("10. appears in a saved snapshot", async () => {
    setup({ get: () => json(UXHINT_BODY) });
    const saved = await savedSection();

    expect(explanationSectionIn(rowFor(saved, "CDB Banco XP"))).toHaveTextContent(
      "Informe o emissor e o produto específico.",
    );
  });

  it("11. appears when opening a snapshot from history", async () => {
    setup({ getById: () => json(ENTRY_UX_A), list: () => json([ENTRY_UX_A, ENTRY_UX_B]) });

    await screen.findByRole("region", { name: "Histórico de resultados salvos" });
    await userEvent.click(
      screen.getByRole("button", { name: `Abrir resultado salvo de ${expectedAt(ENTRY_UX_A.createdAt)}` }),
    );

    const saved = await screen.findByRole("region", { name: "Resultado salvo" });
    const section = explanationSectionIn(rowFor(saved, "CDB Banco XP"));

    expect(section).toHaveTextContent("Informe o emissor e o produto específico.");
  });

  it("12. appears for a freshly resolved portfolio", async () => {
    const rig = setup({ aie: aieUxHintOk });

    await rig.user.upload(screen.getByLabelText("Arquivo CSV ou Excel da carteira"), csv(CSV_TEXT_UXHINT));
    await screen.findByRole("table", { name: /prévia/i });
    await rig.user.click(screen.getByRole("button", { name: /resolver carteira/i }));
    const table = await screen.findByRole("table", { name: "Resultado da resolução de cada ativo" });

    const section = explanationSectionIn(rowFor(table, "CDB Banco XP"));
    expect(section).toHaveTextContent("Informe o emissor e o produto específico.");
  });

  it("13. updates when a different snapshot is opened (treasury hint replaces CDB hint)", async () => {
    const rig = setup({ getById: () => json(ENTRY_UX_A), list: () => json([ENTRY_UX_A, ENTRY_UX_B]) });

    await screen.findByRole("region", { name: "Histórico de resultados salvos" });
    await rig.user.click(
      screen.getByRole("button", { name: `Abrir resultado salvo de ${expectedAt(ENTRY_UX_A.createdAt)}` }),
    );
    let saved = await screen.findByRole("region", { name: "Resultado salvo" });
    expect(explanationSectionIn(rowFor(saved, "CDB Banco XP"))).toHaveTextContent(
      "Informe o emissor e o produto específico.",
    );

    rig.snapshotFetch.mockImplementation(async (url, init) => {
      if (url === PORTFOLIO_SNAPSHOTS_URL) return json([ENTRY_UX_A, ENTRY_UX_B]);
      if (url.startsWith(`${PORTFOLIO_SNAPSHOTS_URL}/`) && init.method === "GET") return json(ENTRY_UX_B);
      if (url === PORTFOLIO_SNAPSHOT_URL && init.method === "GET") return json({}, 404);
      return new Response(null, { status: 204 });
    });

    await rig.user.click(
      screen.getByRole("button", { name: `Abrir resultado salvo de ${expectedAt(ENTRY_UX_B.createdAt)}` }),
    );

    saved = await screen.findByRole("region", { name: "Resultado salvo" });
    const section = explanationSectionIn(rowFor(saved, "Tesouro Selic"));
    expect(section).toHaveTextContent("Informe o vencimento do título do Tesouro.");
  });

  it("14. disappears along with the section when the displayed snapshot is deleted", async () => {
    const rig = setup({ get: () => json(UXHINT_BODY), del: () => new Response(null, { status: 204 }) });

    const saved = await screen.findByRole("region", { name: "Resultado salvo" });
    await rig.user.click(within(saved).getByRole("button", { name: "Apagar resultado salvo" }));
    await rig.user.click(screen.getByRole("button", { name: "Sim, apagar" }));

    await screen.findByText("Resultado salvo apagado da sua conta.");
    expect(screen.queryByRole("region", { name: "Resultado salvo" })).toBeNull();
  });

  it("15. no network or AIE call is triggered by rendering a hinted explanation", async () => {
    const rig = setup({ get: () => json(UXHINT_BODY) });

    await screen.findByRole("region", { name: "Resultado salvo" });

    expect(rig.aieFetch).not.toHaveBeenCalled();
  });

  it("16. quality panel regression: unaffected by the UX hint layer", async () => {
    setup({ get: () => json(UXHINT_BODY) });
    const saved = await savedSection();

    const qualityPanel = within(saved).getByRole("region", { name: "Qualidade da resolução" });

    expect(qualityPanel).toHaveTextContent("Total de ativos");
    expect(qualityPanel).toHaveTextContent("9");
  });

  it("17. improvement plan regression: unaffected by the UX hint layer", async () => {
    setup({ get: () => json(UXHINT_BODY) });
    const saved = await savedSection();

    const improvementPanel = within(saved).getByRole("region", { name: "Como melhorar esta resolução" });

    expect(improvementPanel).toHaveTextContent("Forneça mais informações dos ativos");
  });

  it("18. comparison regression: unaffected by the UX hint layer", async () => {
    setup({ list: () => json([ENTRY_UX_A, ENTRY_UX_B]), getById: () => json(ENTRY_UX_A) });

    const compare = await screen.findByRole("region", { name: "Comparar resultados salvos" });

    expect(within(compare).getByLabelText("Base")).toBeInTheDocument();
    expect(within(compare).getByLabelText("Alvo")).toBeInTheDocument();
  });

  it("19. accessibility: heading level 4 is preserved for a hinted explanation", async () => {
    setup({ get: () => json(UXHINT_BODY) });
    const saved = await savedSection();

    const section = explanationSectionIn(rowFor(saved, "CDB Banco XP"));

    expect(within(section).getByRole("heading", { level: 4 })).toBeInTheDocument();
  });

  it("20. accessibility: aria-labelledby still points at the heading's id for a hinted explanation", async () => {
    setup({ get: () => json(UXHINT_BODY) });
    const saved = await savedSection();

    const section = explanationSectionIn(rowFor(saved, "CDB Banco XP"));
    const heading = within(section).getByRole("heading", { level: 4 });

    expect(section.getAttribute("aria-labelledby")).toBe(heading.id);
  });

  it("21. accessibility: icon stays aria-hidden for a hinted explanation", async () => {
    setup({ get: () => json(UXHINT_BODY) });
    const saved = await savedSection();

    const section = explanationSectionIn(rowFor(saved, "CDB Banco XP"));

    expect(section.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it("22. full branch coverage: every hint kind and the null case render the expected suggestion", async () => {
    setup({ get: () => json(UXHINT_BODY) });
    const saved = await savedSection();

    const expectations: [string, string][] = [
      ["Tesouro Selic", "Informe o vencimento do título do Tesouro."],
      ["CDB Banco XP", "Informe o emissor e o produto específico."],
      ["LCI Banco Y", "Informe o emissor e o produto específico."],
      ["LCA Banco Z", "Informe o emissor e o produto específico."],
      ["Ação Genérica XYZ", GENERIC_SUGGESTION],
    ];

    for (const [rawName, expectedSuggestion] of expectations) {
      const section = explanationSectionIn(rowFor(saved, rawName));
      expect(section, rawName).toHaveTextContent(expectedSuggestion);
    }
  });

  it("23. severity is unaffected by the UX hint (still 'info' styling for needs-more-evidence)", async () => {
    setup({ get: () => json(UXHINT_BODY) });
    const saved = await savedSection();

    const section = explanationSectionIn(rowFor(saved, "CDB Banco XP"));

    expect(section.className).toContain("aligna-infoSoft");
  });

  it("24. canonical code/type in the results table is unaffected by the UX hint (verified item)", async () => {
    setup({ get: () => json(UXHINT_BODY) });
    const saved = await savedSection();

    const row = rowFor(saved, "PETR4");
    expect(row).toHaveTextContent("b3:PETR4");
    expect(row).toHaveTextContent("stock");
  });

  it("25. export CSV button still present and clickable alongside hinted explanations", async () => {
    const rig = setup({ get: () => json(UXHINT_BODY) });
    const saved = await savedSection();

    const exportButton = within(saved).getByRole("button", { name: "Exportar CSV" });

    await expect(rig.user.click(exportButton)).resolves.not.toThrow();
  });

  it("26. history still lists both entries alongside hinted explanations", async () => {
    setup({ list: () => json([ENTRY_UX_A, ENTRY_UX_B]), getById: () => json(ENTRY_UX_A) });

    const history = await screen.findByRole("region", { name: "Histórico de resultados salvos" });

    expect(
      within(history).getByRole("button", {
        name: `Abrir resultado salvo de ${expectedAt(ENTRY_UX_A.createdAt)}`,
      }),
    ).toBeInTheDocument();
    expect(
      within(history).getByRole("button", {
        name: `Abrir resultado salvo de ${expectedAt(ENTRY_UX_B.createdAt)}`,
      }),
    ).toBeInTheDocument();
  });
});
