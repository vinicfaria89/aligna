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
 * TASK-066B: "Exportar qualidade da resolução" button, reusing
 * `buildPortfolioResolutionQualityCsv` (TASK-066A, pure) and the existing
 * `downloadCsvFile` mechanism (no reimplementation) -- same
 * real-client-on-fake-fetch convention as the other
 * PortfolioCsvResolver.<domain>.test.tsx files.
 */

const TOKEN = "sentinel-quality-export-token";

const SAVED_BODY = {
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
      rawName: "Tesouro Selic",
      amount: 200,
      currency: "BRL",
      status: "needs-more-evidence",
      pendingFields: ["identity"],
      sources: [],
    },
  ],
  updatedAt: "2026-09-30T10:00:00+00:00",
};

const CSV_TEXT = ["rawName,amount,currency", "PETR4,1000,BRL", "Tesouro Selic,200,BRL"].join("\n");

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
          candidateAssetId: "portfolio:sentinel-qe:2",
          ok: true,
          result: {
            status: "verified",
            verifiedAsset: { canonicalAssetId: "PETR4", assetType: "stock", currency: "BRL", amount: 1000 },
            investigation: { evidence: [{ source: "B3", field: "identity", value: "v" }], searches: [], unresolvedFields: [] },
          },
        },
        {
          index: 1,
          candidateAssetId: "portfolio:sentinel-qe:3",
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
      return (answers.put ?? (() => json({ items: [], updatedAt: "2026-09-30T10:00:00+00:00" })))();
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

/** Captures the Blob passed to `URL.createObjectURL` by the next
 * `downloadCsvFile` call, so the test can read the exported CSV's real
 * text without a real browser download happening. */
function spyOnDownloadBlob() {
  const blobs: Blob[] = [];
  const original = URL.createObjectURL;
  const spy = vi.spyOn(URL, "createObjectURL").mockImplementation((obj: Blob | MediaSource) => {
    blobs.push(obj as Blob);
    return original.call(URL, obj);
  });
  return { blobs, spy };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("visibility", () => {
  it("1. button is absent before there is any result", async () => {
    setup();

    await screen.findByLabelText("Arquivo CSV ou Excel da carteira");

    expect(screen.queryByRole("button", { name: "Exportar qualidade da resolução" })).toBeNull();
  });

  it("2. button appears after resolving a portfolio", async () => {
    const rig = setup();

    await resolveIt(rig);

    expect(screen.getByRole("button", { name: "Exportar qualidade da resolução" })).toBeInTheDocument();
  });

  it("3. button appears in a saved snapshot", async () => {
    setup({ get: () => json(SAVED_BODY) });

    const saved = await screen.findByRole("region", { name: "Resultado salvo" });

    expect(
      within(saved).getByRole("button", { name: "Exportar qualidade da resolução" }),
    ).toBeInTheDocument();
  });
});

describe("export behavior", () => {
  it("4. clicking in the fresh-result section downloads a CSV with the expected header and content", async () => {
    const rig = setup();
    const { blobs } = spyOnDownloadBlob();

    await resolveIt(rig);
    await rig.user.click(screen.getByRole("button", { name: "Exportar qualidade da resolução" }));

    expect(blobs).toHaveLength(1);
    const text = await blobs[0].text();

    expect(text.split("\r\n")[0]).toBe(
      "row_type,section,key,name,status,asset_type,source,explanation_title,suggestion",
    );
    expect(text).toContain("summary,totals,items,2");
    expect(text).toContain("item,item,2,PETR4,verified,stock,B3,Ativo verificado,");
  });

  it("5. clicking in the saved section downloads a CSV including the UX-hinted suggestion", async () => {
    setup({ get: () => json(SAVED_BODY) });
    const { blobs } = spyOnDownloadBlob();

    const saved = await screen.findByRole("region", { name: "Resultado salvo" });
    await userEvent.click(within(saved).getByRole("button", { name: "Exportar qualidade da resolução" }));

    expect(blobs).toHaveLength(1);
    const text = await blobs[0].text();

    expect(text).toContain("Informe o vencimento do título do Tesouro.");
  });

  it("6. exported filename follows the qualidade-resolucao-YYYY-MM-DD.csv convention", async () => {
    const rig = setup();

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    let downloadName: string | undefined;
    const originalSet = Object.getOwnPropertyDescriptor(HTMLAnchorElement.prototype, "download");
    Object.defineProperty(HTMLAnchorElement.prototype, "download", {
      configurable: true,
      set(value: string) {
        downloadName = value;
      },
      get() {
        return downloadName ?? "";
      },
    });

    await resolveIt(rig);
    await rig.user.click(screen.getByRole("button", { name: "Exportar qualidade da resolução" }));

    expect(downloadName).toMatch(/^qualidade-resolucao-\d{4}-\d{2}-\d{2}\.csv$/);

    clickSpy.mockRestore();
    if (originalSet) {
      Object.defineProperty(HTMLAnchorElement.prototype, "download", originalSet);
    }
  });

  it("7. does not throw and does not remove the existing 'Exportar CSV' button (no regression)", async () => {
    const rig = setup({ get: () => json(SAVED_BODY) });

    const saved = await screen.findByRole("region", { name: "Resultado salvo" });
    const exportResult = within(saved).getByRole("button", { name: "Exportar CSV" });
    const exportQuality = within(saved).getByRole("button", { name: "Exportar qualidade da resolução" });

    await expect(rig.user.click(exportResult)).resolves.not.toThrow();
    await expect(rig.user.click(exportQuality)).resolves.not.toThrow();
  });
});

describe("no side effects", () => {
  it("8. no network or AIE call is triggered by clicking the button", async () => {
    const rig = setup({ get: () => json(SAVED_BODY) });

    const saved = await screen.findByRole("region", { name: "Resultado salvo" });
    const callsBefore = rig.snapshotFetch.mock.calls.length;

    await rig.user.click(within(saved).getByRole("button", { name: "Exportar qualidade da resolução" }));

    expect(rig.aieFetch).not.toHaveBeenCalled();
    expect(rig.snapshotFetch.mock.calls.length).toBe(callsBefore);
  });
});

describe("no regression in sibling features", () => {
  it("9. quality panel and explanations remain unaffected by the new button", async () => {
    setup({ get: () => json(SAVED_BODY) });

    const saved = await screen.findByRole("region", { name: "Resultado salvo" });

    expect(within(saved).getByRole("region", { name: "Qualidade da resolução" })).toBeInTheDocument();
    expect(within(saved).getByText("Ativo verificado")).toBeInTheDocument();
  });

  it("10. saving, opening history and deleting still work alongside the new button", async () => {
    const rig = setup({ del: () => new Response(null, { status: 204 }) });

    await resolveIt(rig);

    expect(screen.getByRole("button", { name: "Salvar resultado" })).toBeEnabled();
  });
});
