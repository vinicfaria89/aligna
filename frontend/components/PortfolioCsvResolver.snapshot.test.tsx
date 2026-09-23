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
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import PortfolioCsvResolver from "./PortfolioCsvResolver";

import type { SubmitPortfolioCsvInput } from "@/lib/aie/client/resolve-csv-client";
import {
  PORTFOLIO_SNAPSHOT_URL,
  type SnapshotFetch,
} from "@/lib/portfolio-snapshot-api";
import type { SessionAccess } from "@/lib/session";

vi.mock("@/lib/session", () => ({
  acquireAccessToken: async () => ({
    status: "none",
  }),

  clearSession: () => undefined,
}));

/**
 * TASK-029B: loading, saving and deleting the last resolution result. The saved-result
 * client is the REAL one, on a fake fetch and a fake session: nothing real is contacted.
 * The resolution itself (POST /api/aie/resolve-csv) has its own fake fetch.
 */

const TOKEN = "sentinel-flow-token";

const FILE_NAME = "SENTINEL-FLOW-FILE.csv";

const CSV_TEXT = [
  "rawName,assetType,instrumentCode,ticker,amount,currency",
  "DEB PETROBRAS SERIE 1,debenture,ABCD11,,98765.43,BRL",
  "Petrobras PN,stock,,PETR4,1500,BRL",
].join("\n");

const SAVED_BODY = {
  items: [
    {
      lineNumber: 2,
      rawName: "SAVED ALPHA",
      status: "verified",
      pendingFields: [],
      sources: ["anbima"],
      verifiedAsset: { code: "ABCD11", type: "debenture", currency: "BRL" },
    },
    {
      lineNumber: 3,
      rawName: "SAVED BETA",
      status: "needs-more-evidence",
      pendingFields: ["issuer"],
      sources: [],
    },
  ],
  updatedAt: "2026-09-21T14:32:00+00:00",
};

const NEW_BODY = {
  items: [
    {
      lineNumber: 2,
      rawName: "NEW ALPHA",
      status: "needs-more-evidence",
      pendingFields: ["identity"],
      sources: [],
    },
  ],
  updatedAt: "2026-09-22T09:05:00+00:00",
};

const LOGIN_RETURN = "/evolucao?voltar=/carteira";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "x-correlation-id": "sentinel-corr-flow" },
  });
}

/** The answer of POST /api/aie/resolve-csv for the two CSV rows. */
function aieOk(): Response {
  return json({
    ok: true,

    result: {
      items: [
        {
          index: 0,
          candidateAssetId: "portfolio:SENTINEL-UPLOAD-ID:2",
          ok: true,
          result: {
            status: "verified",
            verifiedAsset: {
              canonicalAssetId: "ABCD11",
              assetType: "debenture",
              currency: "BRL",
              amount: 98765.43,
            },
            investigation: {
              evidence: [
                {
                  source: "anbima",
                  field: "identity",
                  value: "SECRET-EVIDENCE",
                  metadata: { secret: "SECRET-METADATA" },
                },
              ],
              searches: [{ providerId: "SENTINEL-PROVIDER", status: "failed" }],
              unresolvedFields: [],
            },
          },
        },
        {
          index: 1,
          candidateAssetId: "portfolio:SENTINEL-UPLOAD-ID:3",
          ok: true,
          result: {
            status: "needs-more-evidence",
            verifiedAsset: null,
            investigation: {
              evidence: [],
              searches: [],
              unresolvedFields: ["issuer"],
            },
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
  /** GET /api/v1/portfolio-snapshots (plural, TASK-048B): the history list. */
  list?: () => Response | Promise<Response>;
}

function setup(
  answers: Answers = {},
  sessions: SessionAccess[] | null = null,
) {
  const snapshotFetch = vi.fn<SnapshotFetch>(async (url, init) => {
    // TASK-048B: the history list lives at a DIFFERENT (plural) URL, read
    // once on mount alongside the singular "latest" endpoint below. Routed
    // by URL, not just method, so it never collides with the singular GET.
    if (url !== PORTFOLIO_SNAPSHOT_URL) {
      return (answers.list ?? (() => json([])))();
    }

    if (init.method === "GET") {
      return (answers.get ?? (() => json({}, 404)))();
    }

    if (init.method === "PUT") {
      return (answers.put ?? (() => json(NEW_BODY)))();
    }

    return (answers.del ?? (() => new Response(null, { status: 204 })))();
  });

  const aieFetch = vi.fn<NonNullable<SubmitPortfolioCsvInput["fetchImpl"]>>(
    async () => (answers.aie ?? aieOk)(),
  );

  const queue = sessions ? [...sessions] : null;

  const getSession = vi.fn(async (): Promise<SessionAccess> => {
    if (queue && queue.length > 0) {
      return queue.shift() as SessionAccess;
    }

    return { status: "ok", accessToken: TOKEN };
  });

  const clearSession = vi.fn();

  const user = userEvent.setup();

  const view = render(
    <PortfolioCsvResolver
      getSession={getSession}
      clearSession={clearSession}
      fetchImpl={aieFetch}
      snapshotFetchImpl={snapshotFetch}
    />,
  );

  return { user, view, snapshotFetch, aieFetch, getSession, clearSession };
}

type Rig = ReturnType<typeof setup>;

/** Only the singular "latest" endpoint's calls (TASK-048B: the history-list
 * call to the plural endpoint happens in parallel on every open, but is
 * unrelated to what these existing assertions are about). */
function methods(rig: Rig): string[] {
  return rig.snapshotFetch.mock.calls
    .filter((call) => call[0] === PORTFOLIO_SNAPSHOT_URL)
    .map((call) => call[1].method);
}

/** Calls to the singular "latest" endpoint only, in order -- use this instead
 * of a raw `mock.calls[n]` index whenever a test needs a specific one of
 * them, since the parallel history-list call (a different URL) also lands
 * in `mock.calls` and would otherwise shift the index. */
function singularCalls(rig: Rig) {
  return rig.snapshotFetch.mock.calls.filter(
    (call) => call[0] === PORTFOLIO_SNAPSHOT_URL,
  );
}

function bodyOf(rig: Rig, method: string): Record<string, unknown> {
  const call = rig.snapshotFetch.mock.calls.find(
    (entry) => entry[1].method === method,
  );

  return JSON.parse(call?.[1].body as string);
}

async function opened(rig: Rig) {
  await waitFor(() =>
    expect(rig.snapshotFetch.mock.calls.length + rig.getSession.mock.calls.length).toBeGreaterThan(0),
  );

  // let the load settle
  await new Promise((resolve) => setTimeout(resolve, 20));
}

function csv(content = CSV_TEXT, name = FILE_NAME) {
  return new File([content], name, {
    type: "text/csv",
    lastModified: 1_700_000_000_000,
  });
}

async function choose(rig: Rig, file: File = csv()) {
  await rig.user.upload(screen.getByLabelText("Arquivo CSV ou Excel da carteira"), file);

  await screen.findByRole("table", { name: /prévia/i });
}

async function resolveIt(rig: Rig, file: File = csv()) {
  await choose(rig, file);

  await rig.user.click(screen.getByRole("button", { name: /resolver carteira/i }));

  await screen.findByRole("table", { name: "Resultado da resolução de cada ativo" });
}

function saveButton() {
  return screen.queryByRole("button", { name: "Salvar resultado" });
}

function savedCard() {
  return screen.queryByRole("region", { name: "Resultado salvo" });
}

describe("reading the saved result when the page opens", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("without a session it asks the Planejador for nothing and shows no saved result", async () => {
    // TASK-048B: the mount effect makes two calls (load + list); both see
    // the same session state.
    const rig = setup({}, [{ status: "none" }, { status: "none" }]);

    await opened(rig);

    expect(rig.snapshotFetch).not.toHaveBeenCalled();

    expect(savedCard()).toBeNull();

    expect(screen.queryByRole("alert")).toBeNull();

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("with a session and nothing saved (404) it shows no error and no saved result", async () => {
    const rig = setup();

    await opened(rig);

    expect(methods(rig)).toEqual(["GET"]);

    expect(savedCard()).toBeNull();

    expect(screen.queryByRole("alert")).toBeNull();

    expect(screen.queryByRole("status")).toBeNull();

    expect(screen.getByLabelText("Arquivo CSV ou Excel da carteira")).toBeEnabled();
  });

  it("with a saved result it shows it, with its date, using the same results table", async () => {
    const rig = setup({ get: () => json(SAVED_BODY) });

    const card = await screen.findByRole("region", { name: "Resultado salvo" });

    expect(singularCalls(rig)[0]![1].headers.Authorization).toBe(
      `Bearer ${TOKEN}`,
    );

    expect(card).toHaveTextContent(
      /Resultado salvo em \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}\./,
    );

    const table = within(card).getByRole("table", {
      name: "Resultado salvo de cada ativo",
    });

    const rows = within(table).getAllByRole("row").slice(1);

    expect(rows).toHaveLength(2);

    expect(rows[0]).toHaveTextContent("SAVED ALPHA");
    expect(rows[0]).toHaveTextContent("Verificado");
    expect(rows[0]).toHaveTextContent("ABCD11");
    expect(rows[1]).toHaveTextContent("SAVED BETA");
    expect(rows[1]).toHaveTextContent("Precisa de mais evidências");
    expect(rows[1]).toHaveTextContent("Falta confirmar: emissor");

    expect(
      within(card).getByRole("button", { name: "Apagar resultado salvo" }),
    ).toBeInTheDocument();
  });

  it("the saved result reuses the semantic table on desktop and the cards on mobile", async () => {
    setup({ get: () => json(SAVED_BODY) });

    const table = await screen.findByRole("table", {
      name: "Resultado salvo de cada ativo",
    });

    expect(table).toHaveClass("block", "md:table");

    expect(table.querySelector("thead")).toHaveClass(
      "sr-only",
      "md:not-sr-only",
      "md:table-header-group",
    );

    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Linha", "Ativo", "Situação", "Detalhes"]);

    for (const row of within(table).getAllByRole("row").slice(1)) {
      expect(row).toHaveClass("block", "rounded-lg", "md:table-row");
    }

    expect(document.querySelector(".overflow-x-auto")).toBeNull();
  });

  it("an expired session on open is silent: no alert, no saved result", async () => {
    const rig = setup({}, [{ status: "expired" }, { status: "expired" }]);

    await opened(rig);

    expect(rig.snapshotFetch).not.toHaveBeenCalled();

    expect(screen.queryByRole("alert")).toBeNull();

    expect(screen.queryByRole("status")).toBeNull();

    expect(savedCard()).toBeNull();
  });

  it("a 401 on open ends the session once and stays silent", async () => {
    const rig = setup({ get: () => json({}, 401) });

    await opened(rig);

    expect(rig.clearSession).toHaveBeenCalledTimes(1);

    expect(screen.queryByRole("alert")).toBeNull();

    expect(screen.queryByRole("status")).toBeNull();

    expect(savedCard()).toBeNull();

    expect(screen.getByLabelText("Arquivo CSV ou Excel da carteira")).toBeEnabled();
  });

  it("a failure on open (500) shows a discreet note and the page keeps working", async () => {
    const rig = setup({ get: () => json({}, 500) });

    expect(
      await screen.findByRole("status"),
    ).toHaveTextContent(/não foi possível verificar se há um resultado salvo/i);

    expect(screen.queryByRole("alert")).toBeNull();

    expect(rig.clearSession).not.toHaveBeenCalled();

    expect(screen.getByLabelText("Arquivo CSV ou Excel da carteira")).toBeEnabled();

    // and the normal flow still works
    await resolveIt(rig);
  });

  it("a network failure on open is the same discreet note", async () => {
    const rig = setup({
      get: () => {
        throw new TypeError("Failed to fetch");
      },
    });

    await screen.findByRole("status");

    expect(rig.clearSession).not.toHaveBeenCalled();
  });

  it("reads the saved result once per page open, not on every render", async () => {
    const rig = setup();

    await opened(rig);

    await rig.user.upload(screen.getByLabelText("Arquivo CSV ou Excel da carteira"), csv());

    await screen.findByRole("table", { name: /prévia/i });

    expect(methods(rig)).toEqual(["GET"]);
  });
});

describe("the save button", () => {
  afterEach(() => {
    cleanup();
  });

  it("is not there before a resolution", async () => {
    const rig = setup();

    await opened(rig);

    expect(saveButton()).toBeNull();

    await choose(rig);

    expect(saveButton()).toBeNull();
  });

  it("is not there when the resolution failed", async () => {
    const rig = setup({ aie: () => json({}, 500) });

    await opened(rig);

    await choose(rig);

    await rig.user.click(screen.getByRole("button", { name: /resolver carteira/i }));

    await screen.findByRole("alert");

    expect(saveButton()).toBeNull();
  });

  it("appears after a successful resolution, with the privacy hint", async () => {
    const rig = setup();

    await opened(rig);

    await resolveIt(rig);

    expect(saveButton()).toBeEnabled();

    expect(
      screen.getByText("Guarda só o resultado na sua conta, nunca o arquivo."),
    ).toBeInTheDocument();
  });

  it("is not there when there is nothing re-displayable to save", async () => {
    const rig = setup({
      aie: () =>
        json({
          ok: true,
          result: {
            items: [
              {
                index: 9,
                candidateAssetId: "x",
                ok: true,
                result: {
                  status: "needs-more-evidence",
                  verifiedAsset: null,
                  investigation: { evidence: [], searches: [], unresolvedFields: [] },
                },
              },
            ],
          },
        }),
    });

    await opened(rig);

    await resolveIt(rig);

    expect(saveButton()).toBeNull();
  });

  it("nothing is saved without the click: resolving, choosing and clearing never PUT", async () => {
    const rig = setup();

    await opened(rig);

    await resolveIt(rig);

    await rig.user.click(screen.getByRole("button", { name: "Limpar" }));

    await resolveIt(rig);

    expect(methods(rig)).toEqual(["GET"]);
  });
});

describe("saving", () => {
  afterEach(() => {
    cleanup();
  });

  it("sends a PUT with only the re-displayable result, and shows the answer as saved", async () => {
    const rig = setup();

    await opened(rig);

    await resolveIt(rig);

    await rig.user.click(saveButton()!);

    expect(await screen.findByText("Este resultado está salvo na sua conta.")).toBeInTheDocument();

    expect(methods(rig)).toEqual(["GET", "PUT"]);

    const put = singularCalls(rig)[1]!;

    expect(put[1].headers.Authorization).toBe(`Bearer ${TOKEN}`);

    expect(put[1]).not.toHaveProperty("credentials");

    expect(bodyOf(rig, "PUT")).toEqual({
      items: [
        {
          lineNumber: 2,
          rawName: "DEB PETROBRAS SERIE 1",
          assetType: "debenture",
          code: "ABCD11",
          amount: 98765.43,
          currency: "BRL",
          status: "verified",
          pendingFields: [],
          sources: ["anbima"],
          verifiedAsset: { code: "ABCD11", type: "debenture", currency: "BRL" },
        },
        {
          lineNumber: 3,
          rawName: "Petrobras PN",
          assetType: "stock",
          ticker: "PETR4",
          amount: 1500,
          currency: "BRL",
          status: "needs-more-evidence",
          pendingFields: ["issuer"],
          sources: [],
        },
      ],
    });

    // the saved card now shows what the Planejador returned, and the button is gone
    const card = await screen.findByRole("region", { name: "Resultado salvo" });

    expect(card).toHaveTextContent("NEW ALPHA");

    expect(saveButton()).toBeNull();
  });

  it("never sends the file, its name, the upload id, the token in the body, evidence or ids", async () => {
    const rig = setup();

    await opened(rig);

    await resolveIt(rig);

    await rig.user.click(saveButton()!);

    await screen.findByText("Este resultado está salvo na sua conta.");

    const put = singularCalls(rig)[1]!;

    const wire = `${put[0]} ${JSON.stringify(put[1])}`;

    const sentBody = put[1].body as string;

    for (const forbidden of [
      FILE_NAME,
      "SENTINEL-UPLOAD-ID",
      "portfolio:",
      "SECRET-EVIDENCE",
      "SECRET-METADATA",
      "SENTINEL-PROVIDER",
      "sentinel-corr-flow",
      "fileId",
      "csv",
      '"evidence"',
      "candidateAssetId",
    ]) {
      expect(sentBody).not.toContain(forbidden);
    }

    // The CSV text itself is not in the request at all.
    expect(wire).not.toContain("rawName,assetType,instrumentCode");

    // The token only in the header.
    expect(sentBody).not.toContain(TOKEN);

    expect(put[0]).not.toContain(TOKEN);
  });

  it("shows a busy state while saving and does not send twice", async () => {
    let release: (response: Response) => void = () => undefined;

    const rig = setup({
      put: () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    });

    await opened(rig);

    await resolveIt(rig);

    await rig.user.click(saveButton()!);

    const busy = await screen.findByRole("button", { name: "Salvando..." });

    expect(busy).toBeDisabled();

    expect(busy).toHaveAttribute("aria-busy", "true");

    await rig.user.click(busy);

    release(json(NEW_BODY));

    await screen.findByText("Este resultado está salvo na sua conta.");

    expect(methods(rig).filter((method) => method === "PUT")).toHaveLength(1);
  });

  it("a failure keeps the result on screen, says it was not saved and allows another try", async () => {
    let attempt = 0;

    const rig = setup({
      put: () => {
        attempt += 1;

        return attempt === 1 ? json({}, 500) : json(NEW_BODY);
      },
    });

    await opened(rig);

    await resolveIt(rig);

    await rig.user.click(saveButton()!);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /não foi possível salvar o resultado agora.*continua na tela/i,
    );

    expect(
      screen.getByRole("table", { name: "Resultado da resolução de cada ativo" }),
    ).toBeInTheDocument();

    expect(savedCard()).toBeNull();

    expect(rig.clearSession).not.toHaveBeenCalled();

    await rig.user.click(saveButton()!);

    await screen.findByText("Este resultado está salvo na sua conta.");

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a network failure is the same: nothing lost, told it was not saved", async () => {
    const rig = setup({
      put: () => {
        throw new TypeError("Failed to fetch");
      },
    });

    await opened(rig);

    await resolveIt(rig);

    await rig.user.click(saveButton()!);

    expect(await screen.findByRole("alert")).toHaveTextContent(/não foi possível salvar/i);

    expect(
      screen.getByRole("table", { name: "Resultado da resolução de cada ativo" }),
    ).toBeInTheDocument();
  });

  it("a 422 says the server refused the content and keeps the result", async () => {
    const rig = setup({ put: () => json({ detail: [] }, 422) });

    await opened(rig);

    await resolveIt(rig);

    await rig.user.click(saveButton()!);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /o servidor recusou o conteúdo/i,
    );

    expect(
      screen.getByRole("table", { name: "Resultado da resolução de cada ativo" }),
    ).toBeInTheDocument();
  });

  it("a 401 keeps the result, says the session expired, ends the session once and offers the safe sign-in", async () => {
    const rig = setup({ put: () => json({}, 401) });

    await opened(rig);

    await resolveIt(rig);

    await rig.user.click(saveButton()!);

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(/sua sessão expirou, então o resultado não foi salvo/i);

    expect(alert).toHaveTextContent(/o resultado continua na tela/i);

    expect(within(alert).getByRole("link", { name: "Entrar" })).toHaveAttribute(
      "href",
      LOGIN_RETURN,
    );

    expect(rig.clearSession).toHaveBeenCalledTimes(1);

    expect(methods(rig).filter((method) => method === "PUT")).toHaveLength(1);

    expect(
      screen.getByRole("table", { name: "Resultado da resolução de cada ativo" }),
    ).toBeInTheDocument();
  });

  it("an expired session at save time sends nothing and keeps the result", async () => {
    const rig = setup({}, [
      { status: "ok", accessToken: TOKEN }, // open (load)
      { status: "ok", accessToken: TOKEN }, // open (list, TASK-048B)
      { status: "ok", accessToken: TOKEN }, // resolve
      { status: "expired" }, // save
    ]);

    await opened(rig);

    await resolveIt(rig);

    await rig.user.click(saveButton()!);

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(/sua sessão expirou/i);

    expect(within(alert).getByRole("link", { name: "Entrar" })).toHaveAttribute(
      "href",
      LOGIN_RETURN,
    );

    expect(methods(rig)).toEqual(["GET"]);

    expect(
      screen.getByRole("table", { name: "Resultado da resolução de cada ativo" }),
    ).toBeInTheDocument();
  });

  it("with no session at save time it asks to sign in and sends nothing", async () => {
    const rig = setup({}, [
      { status: "ok", accessToken: TOKEN }, // open (load)
      { status: "ok", accessToken: TOKEN }, // open (list, TASK-048B)
      { status: "ok", accessToken: TOKEN }, // resolve
      { status: "none" }, // save
    ]);

    await opened(rig);

    await resolveIt(rig);

    await rig.user.click(saveButton()!);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /entre na sua conta para salvar o resultado/i,
    );

    expect(methods(rig)).toEqual(["GET"]);
  });

  it("saving replaces the saved result shown, it does not add a second one", async () => {
    const rig = setup({ get: () => json(SAVED_BODY) });

    await screen.findByRole("region", { name: "Resultado salvo" });

    await resolveIt(rig);

    await rig.user.click(saveButton()!);

    await screen.findByText("Este resultado está salvo na sua conta.");

    expect(screen.getAllByRole("region", { name: "Resultado salvo" })).toHaveLength(1);

    const card = screen.getByRole("region", { name: "Resultado salvo" });

    expect(card).toHaveTextContent("NEW ALPHA");

    expect(card).not.toHaveTextContent("SAVED ALPHA");
  });
});

describe("deleting the saved result", () => {
  afterEach(() => {
    cleanup();
  });

  it("asks for confirmation first and does not call DELETE until confirmed", async () => {
    const rig = setup({ get: () => json(SAVED_BODY) });

    await screen.findByRole("region", { name: "Resultado salvo" });

    await rig.user.click(screen.getByRole("button", { name: "Apagar resultado salvo" }));

    const group = screen.getByRole("group", {
      name: "Apagar o resultado salvo da sua conta?",
    });

    expect(group).toHaveTextContent(/isso não pode ser desfeito/i);

    expect(within(group).getByRole("button", { name: "Cancelar" })).toHaveFocus();

    expect(methods(rig)).toEqual(["GET"]);
  });

  it("Cancelar closes the question and keeps the saved result, with no DELETE", async () => {
    const rig = setup({ get: () => json(SAVED_BODY) });

    await screen.findByRole("region", { name: "Resultado salvo" });

    await rig.user.click(screen.getByRole("button", { name: "Apagar resultado salvo" }));

    await rig.user.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.queryByRole("group")).toBeNull();

    expect(savedCard()).not.toBeNull();

    expect(screen.getByRole("button", { name: "Apagar resultado salvo" })).toBeInTheDocument();

    expect(methods(rig)).toEqual(["GET"]);
  });

  it("confirming sends one DELETE with the bearer, removes the saved state and says so", async () => {
    const rig = setup({ get: () => json(SAVED_BODY) });

    await screen.findByRole("region", { name: "Resultado salvo" });

    await rig.user.click(screen.getByRole("button", { name: "Apagar resultado salvo" }));

    await rig.user.click(screen.getByRole("button", { name: "Sim, apagar" }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Resultado salvo apagado da sua conta.",
    );

    expect(methods(rig)).toEqual(["GET", "DELETE"]);

    const del = singularCalls(rig)[1]!;

    expect(del[1].headers.Authorization).toBe(`Bearer ${TOKEN}`);

    expect(del[1]).not.toHaveProperty("body");

    expect(del[1]).not.toHaveProperty("credentials");

    expect(savedCard()).toBeNull();

    expect(screen.queryByRole("button", { name: "Apagar resultado salvo" })).toBeNull();
  });

  it("the delete button only exists while there is a saved result", async () => {
    const rig = setup();

    await opened(rig);

    expect(screen.queryByRole("button", { name: "Apagar resultado salvo" })).toBeNull();

    await resolveIt(rig);

    expect(screen.queryByRole("button", { name: "Apagar resultado salvo" })).toBeNull();

    await rig.user.click(saveButton()!);

    await screen.findByRole("region", { name: "Resultado salvo" });

    expect(
      screen.getByRole("button", { name: "Apagar resultado salvo" }),
    ).toBeInTheDocument();
  });

  it("keeps the result on screen after deleting the saved one, and offers to save it again", async () => {
    const rig = setup();

    await opened(rig);

    await resolveIt(rig);

    await rig.user.click(saveButton()!);

    await screen.findByText("Este resultado está salvo na sua conta.");

    await rig.user.click(screen.getByRole("button", { name: "Apagar resultado salvo" }));

    await rig.user.click(screen.getByRole("button", { name: "Sim, apagar" }));

    await waitFor(() => expect(savedCard()).toBeNull());

    expect(
      screen.getByRole("table", { name: "Resultado da resolução de cada ativo" }),
    ).toBeInTheDocument();

    expect(screen.queryByText("Este resultado está salvo na sua conta.")).toBeNull();

    expect(saveButton()).toBeEnabled();
  });

  it("a failure keeps the saved result and says it is still there", async () => {
    const rig = setup({ get: () => json(SAVED_BODY), del: () => json({}, 500) });

    await screen.findByRole("region", { name: "Resultado salvo" });

    await rig.user.click(screen.getByRole("button", { name: "Apagar resultado salvo" }));

    await rig.user.click(screen.getByRole("button", { name: "Sim, apagar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /não foi possível apagar o resultado salvo agora.*continua na sua conta/i,
    );

    expect(savedCard()).not.toBeNull();

    expect(rig.clearSession).not.toHaveBeenCalled();
  });

  it("a 401 keeps the saved result, ends the session once and offers the safe sign-in", async () => {
    const rig = setup({ get: () => json(SAVED_BODY), del: () => json({}, 401) });

    await screen.findByRole("region", { name: "Resultado salvo" });

    await rig.user.click(screen.getByRole("button", { name: "Apagar resultado salvo" }));

    await rig.user.click(screen.getByRole("button", { name: "Sim, apagar" }));

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(/o resultado salvo não foi apagado/i);

    expect(within(alert).getByRole("link", { name: "Entrar" })).toHaveAttribute(
      "href",
      LOGIN_RETURN,
    );

    expect(rig.clearSession).toHaveBeenCalledTimes(1);

    expect(savedCard()).not.toBeNull();
  });

  it("does not delete twice on a double click", async () => {
    let release: (response: Response) => void = () => undefined;

    const rig = setup({
      get: () => json(SAVED_BODY),
      del: () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    });

    await screen.findByRole("region", { name: "Resultado salvo" });

    await rig.user.click(screen.getByRole("button", { name: "Apagar resultado salvo" }));

    await rig.user.click(screen.getByRole("button", { name: "Sim, apagar" }));

    const busy = await screen.findByRole("button", { name: "Apagando..." });

    expect(busy).toBeDisabled();

    await rig.user.click(busy);

    release(new Response(null, { status: 204 }));

    await waitFor(() => expect(savedCard()).toBeNull());

    expect(methods(rig).filter((method) => method === "DELETE")).toHaveLength(1);
  });
});

describe("Limpar and a new upload never touch the saved result", () => {
  afterEach(() => {
    cleanup();
  });

  it("Limpar clears the screen only: no DELETE, no PUT, the saved result stays", async () => {
    const rig = setup({ get: () => json(SAVED_BODY) });

    await screen.findByRole("region", { name: "Resultado salvo" });

    await resolveIt(rig);

    await rig.user.click(screen.getByRole("button", { name: "Limpar" }));

    expect(screen.queryByRole("table", { name: "Resultado da resolução de cada ativo" })).toBeNull();

    expect(saveButton()).toBeNull();

    expect(savedCard()).not.toBeNull();

    expect(methods(rig)).toEqual(["GET"]);
  });

  it("a new upload neither deletes nor replaces it, and does not save by itself", async () => {
    const rig = setup({ get: () => json(SAVED_BODY) });

    await screen.findByRole("region", { name: "Resultado salvo" });

    await resolveIt(rig);

    await choose(rig, csv("rawName\nOUTRO ATIVO\n", "outra.csv"));

    expect(screen.queryByRole("table", { name: "Resultado da resolução de cada ativo" })).toBeNull();

    expect(savedCard()).toHaveTextContent("SAVED ALPHA");

    expect(methods(rig)).toEqual(["GET"]);
  });

  it("after a new resolution the user can save it, and only then is the saved result replaced", async () => {
    const rig = setup({ get: () => json(SAVED_BODY) });

    await screen.findByRole("region", { name: "Resultado salvo" });

    await resolveIt(rig);

    expect(savedCard()).toHaveTextContent("SAVED ALPHA");

    await rig.user.click(saveButton()!);

    await screen.findByText("Este resultado está salvo na sua conta.");

    expect(savedCard()).toHaveTextContent("NEW ALPHA");

    expect(methods(rig)).toEqual(["GET", "PUT"]);
  });

  it("the save button comes back for the next resolution", async () => {
    const rig = setup();

    await opened(rig);

    await resolveIt(rig);

    await rig.user.click(saveButton()!);

    await screen.findByText("Este resultado está salvo na sua conta.");

    await resolveIt(rig, csv(CSV_TEXT, "segunda.csv"));

    expect(saveButton()).toBeEnabled();

    expect(screen.queryByText("Este resultado está salvo na sua conta.")).toBeNull();
  });

  it("a 401 while resolving does not remove the saved result already shown, and does not end the session (TASK-036)", async () => {
    const rig = setup({ get: () => json(SAVED_BODY), aie: () => json({}, 401) });

    await screen.findByRole("region", { name: "Resultado salvo" });

    await choose(rig);

    await rig.user.click(screen.getByRole("button", { name: /resolver carteira/i }));

    await screen.findByText("Resolução de carteiras ainda não está liberada.");

    expect(screen.queryByText("Sua sessão expirou.")).toBeNull();

    expect(savedCard()).toHaveTextContent("SAVED ALPHA");

    expect(rig.clearSession).not.toHaveBeenCalled();
  });
});

describe("privacy text, accessibility and storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("says the file is never kept, saving is optional, only the result is kept and it can be deleted", async () => {
    const rig = setup();

    await opened(rig);

    const text = document.getElementById("csv-privacy")?.textContent ?? "";

    expect(text).toMatch(/O arquivo original nunca é guardado/);
    expect(text).toMatch(/Salvar o resultado é opcional/);
    expect(text).toMatch(/guardamos só o resultado/);
    expect(text).toMatch(/na sua conta/);
    expect(text).toMatch(/apagá-lo quando quiser/);
  });

  it("the saved result is a labelled region, and the states use status and alert roles", async () => {
    setup({ get: () => json(SAVED_BODY) });

    const card = await screen.findByRole("region", { name: "Resultado salvo" });

    expect(within(card).getByRole("heading", { level: 2, name: "Resultado salvo" })).toBeInTheDocument();

    for (const name of ["Apagar resultado salvo"]) {
      const button = within(card).getByRole("button", { name });

      expect(button).toHaveClass("focus-visible:ring-2", "focus-visible:ring-aligna-mid");
    }
  });

  it("the save controls keep the focus ring and an accessible name", async () => {
    const rig = setup();

    await opened(rig);

    await resolveIt(rig);

    expect(saveButton()).toHaveClass(
      "focus-visible:ring-2",
      "focus-visible:ring-aligna-mid",
      "focus-visible:ring-offset-2",
    );
  });

  it("writes nothing to browser storage and prints nothing to the console through a whole flow", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );

    const rig = setup({ get: () => json(SAVED_BODY) });

    await screen.findByRole("region", { name: "Resultado salvo" });

    await resolveIt(rig);

    await rig.user.click(saveButton()!);

    await screen.findByText("Este resultado está salvo na sua conta.");

    await rig.user.click(screen.getByRole("button", { name: "Apagar resultado salvo" }));

    await rig.user.click(screen.getByRole("button", { name: "Sim, apagar" }));

    await waitFor(() => expect(savedCard()).toBeNull());

    expect(setItem).not.toHaveBeenCalled();

    expect(window.localStorage.length).toBe(0);

    expect(window.sessionStorage.length).toBe(0);

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it("no token or file name is anywhere in the page", async () => {
    const rig = setup({ get: () => json(SAVED_BODY) });

    await screen.findByRole("region", { name: "Resultado salvo" });

    await resolveIt(rig);

    await rig.user.click(saveButton()!);

    await screen.findByText("Este resultado está salvo na sua conta.");

    const html = document.body.innerHTML;

    expect(html).not.toContain(TOKEN);
    expect(html).not.toContain("Bearer");
    expect(html).not.toContain("portfolio:");
    expect(html).not.toContain("SENTINEL-UPLOAD-ID");
    expect(html).not.toContain("SECRET-EVIDENCE");
  });
});

/**
 * TASK-030: the saved result shows what was saved (type, ticker/code, amount with its
 * currency), on the same responsive markup: a semantic table from `md`, stacked cards
 * below it. A value the row does not have is simply not shown (no placeholder).
 */
describe("the saved result shows type, ticker/code and amount", () => {
  const FULL_BODY = {
    items: [
      {
        lineNumber: 2,
        rawName: "DEB PETROBRAS SERIE 1",
        assetType: "debenture",
        code: "ABCD11",
        amount: 98765.43,
        currency: "BRL",
        status: "verified",
        pendingFields: [],
        sources: ["anbima"],
        verifiedAsset: { code: "ABCD11", type: "debenture", currency: "BRL" },
      },
      {
        lineNumber: 3,
        rawName: "Petrobras PN",
        assetType: "stock",
        ticker: "PETR4",
        code: "SHOULD-NOT-WIN",
        amount: 1500,
        currency: "BRL",
        status: "needs-more-evidence",
        pendingFields: ["issuer"],
        sources: [],
      },
      {
        lineNumber: 4,
        rawName: "CDB Banco Exemplo 2027",
        status: "needs-more-evidence",
        pendingFields: [],
        sources: [],
      },
      {
        lineNumber: 5,
        rawName: "Sem moeda",
        assetType: "fundos",
        amount: 1234.5,
        status: "needs-user",
        pendingFields: [],
        sources: [],
      },
    ],
    updatedAt: "2026-09-21T14:32:00+00:00",
  };

  afterEach(() => {
    cleanup();
  });

  async function savedTable(body: unknown = FULL_BODY) {
    setup({ get: () => json(body) });

    const table = await screen.findByRole("table", {
      name: "Resultado salvo de cada ativo",
    });

    return {
      table,
      rows: within(table).getAllByRole("row").slice(1),
    };
  }

  function labelsOf(row: HTMLElement): string[] {
    return [...row.querySelectorAll("span[aria-hidden=true]")].map(
      (label) => label.textContent ?? "",
    );
  }

  it("adds the Tipo, Ticker / código and Valor columns, keeping the semantic table", async () => {
    const { table } = await savedTable();

    expect(table.tagName).toBe("TABLE");

    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual([
      "Linha",
      "Ativo",
      "Tipo",
      "Ticker / código",
      "Valor",
      "Situação",
      "Detalhes",
    ]);

    for (const th of table.querySelectorAll("th")) {
      expect(th).toHaveAttribute("scope", "col");
    }

    expect(table.querySelector("caption")).toHaveTextContent(
      "Resultado salvo de cada ativo",
    );
  });

  it("shows the value with its currency when there is one", async () => {
    const { rows } = await savedTable();

    const cells = within(rows[0]!).getAllByRole("cell");

    // Currency-formatted, pt-BR (a non-breaking space follows the symbol).
    expect(cells[4]?.textContent).toMatch(/^ValorR\$\s98\.765,43$/);

    expect(within(rows[1]!).getAllByRole("cell")[4]?.textContent).toMatch(
      /^ValorR\$\s1\.500,00$/,
    );
  });

  it("shows a plain number when the amount has no currency", async () => {
    const { rows } = await savedTable();

    expect(within(rows[3]!).getAllByRole("cell")[4]).toHaveTextContent(
      "Valor1.234,5",
    );
  });

  it("shows the type when there is one", async () => {
    const { rows } = await savedTable();

    expect(within(rows[0]!).getAllByRole("cell")[2]).toHaveTextContent("Tipodebenture");
    expect(within(rows[1]!).getAllByRole("cell")[2]).toHaveTextContent("Tipostock");
    expect(within(rows[3]!).getAllByRole("cell")[2]).toHaveTextContent("Tipofundos");
  });

  it("shows the ticker, else the code", async () => {
    const { rows } = await savedTable();

    expect(within(rows[0]!).getAllByRole("cell")[3]).toHaveTextContent(
      "Ticker / códigoABCD11",
    );

    const second = within(rows[1]!).getAllByRole("cell")[3];

    expect(second).toHaveTextContent("Ticker / códigoPETR4");

    expect(second).not.toHaveTextContent("SHOULD-NOT-WIN");
  });

  it("a row without those values shows nothing for them: no placeholder, and no labels in its card", async () => {
    const { rows } = await savedTable();

    const bare = rows[2]!;

    // No dash, no "sem valor" placeholder, none of the extra labels in the card.
    expect(bare.textContent).not.toContain("—");
    expect(bare.textContent).not.toMatch(/Tipo|Valor|Ticker|sem (valor|tipo|c[oó]digo)/i);

    expect(labelsOf(bare)).toEqual(["Linha", "Ativo"]);

    // The empty cells exist for the table but are hidden in the card layout.
    const empty = within(bare)
      .getAllByRole("cell", { hidden: true })
      .filter((cell) => cell.textContent === "");

    expect(empty).toHaveLength(3);

    for (const cell of empty) {
      expect(cell).toHaveClass("hidden", "md:table-cell");
    }

    // The rest of the row is intact.
    expect(bare).toHaveTextContent("CDB Banco Exemplo 2027");
    expect(bare).toHaveTextContent("Precisa de mais evidências");
  });

  it("a card carries a label for each value it has, hidden from assistive technology and from md up", async () => {
    const { rows } = await savedTable();

    expect(labelsOf(rows[0]!)).toEqual([
      "Linha",
      "Ativo",
      "Tipo",
      "Ticker / código",
      "Valor",
    ]);

    for (const label of rows[0]!.querySelectorAll("span[aria-hidden=true]")) {
      expect(label).toHaveClass("md:hidden");
    }
  });

  it("keeps the responsive markup: cards below md, table from md, no horizontal scroll wrapper", async () => {
    const { table, rows } = await savedTable();

    expect(table).toHaveClass("block", "md:table");

    expect(table.querySelector("thead")).toHaveClass(
      "sr-only",
      "md:not-sr-only",
      "md:table-header-group",
    );

    for (const row of rows) {
      expect(row).toHaveClass("block", "rounded-lg", "md:table-row");
    }

    for (const cell of within(rows[0]!).getAllByRole("cell")) {
      expect(cell).toHaveClass("block", "md:table-cell");
    }

    expect(document.querySelector(".overflow-x-auto")).toBeNull();
  });

  it("a column that no row has is not shown", async () => {
    const { table } = await savedTable({
      items: [
        {
          lineNumber: 2,
          rawName: "SO VALOR",
          amount: 10,
          currency: "BRL",
          status: "needs-more-evidence",
          pendingFields: [],
          sources: [],
        },
      ],
      updatedAt: "2026-09-21T14:32:00+00:00",
    });

    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Linha", "Ativo", "Valor", "Situação", "Detalhes"]);
  });

  it("a saved result with none of them keeps the four columns it always had", async () => {
    const { table } = await savedTable(SAVED_BODY);

    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Linha", "Ativo", "Situação", "Detalhes"]);
  });

  it("keeps the date, the counts and the delete button around it", async () => {
    setup({ get: () => json(FULL_BODY) });

    const card = await screen.findByRole("region", { name: "Resultado salvo" });

    expect(card).toHaveTextContent(/Resultado salvo em \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}\./);

    expect(card).toHaveTextContent("1 verificados · 3 com pendências · 0 com erro.");

    expect(
      within(card).getByRole("button", { name: "Apagar resultado salvo" }),
    ).toBeInTheDocument();
  });

  it("after saving, the card shows the extras of what the server returned", async () => {
    const rig = setup({ put: () => json(FULL_BODY) });

    await opened(rig);

    await resolveIt(rig);

    await rig.user.click(saveButton()!);

    const table = await screen.findByRole("table", {
      name: "Resultado salvo de cada ativo",
    });

    expect(within(table).getAllByRole("columnheader")).toHaveLength(7);

    expect(table).toHaveTextContent("debenture");
    expect(table).toHaveTextContent("PETR4");
  });

  it("the fresh result table is unchanged: it does not gain the extra columns", async () => {
    const rig = setup();

    await opened(rig);

    await resolveIt(rig);

    const fresh = screen.getByRole("table", {
      name: "Resultado da resolução de cada ativo",
    });

    expect(
      within(fresh)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["Linha", "Ativo", "Situação", "Detalhes"]);
  });

  it("Limpar, a new upload and the save still behave as before around the richer card", async () => {
    const rig = setup({ get: () => json(FULL_BODY) });

    await screen.findByRole("region", { name: "Resultado salvo" });

    await resolveIt(rig);

    await rig.user.click(screen.getByRole("button", { name: "Limpar" }));

    await choose(rig, csv("rawName\nOUTRO\n", "outra.csv"));

    expect(savedCard()).toHaveTextContent("DEB PETROBRAS SERIE 1");

    expect(methods(rig)).toEqual(["GET"]);
  });
});
