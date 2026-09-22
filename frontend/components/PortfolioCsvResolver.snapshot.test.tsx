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
import type { SnapshotFetch } from "@/lib/portfolio-snapshot-api";
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
}

function setup(
  answers: Answers = {},
  sessions: SessionAccess[] | null = null,
) {
  const snapshotFetch = vi.fn<SnapshotFetch>(async (_url, init) => {
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

function methods(rig: Rig): string[] {
  return rig.snapshotFetch.mock.calls.map((call) => call[1].method);
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
  await rig.user.upload(screen.getByLabelText("Arquivo CSV da carteira"), file);

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
    const rig = setup({}, [{ status: "none" }]);

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

    expect(screen.getByLabelText("Arquivo CSV da carteira")).toBeEnabled();
  });

  it("with a saved result it shows it, with its date, using the same results table", async () => {
    const rig = setup({ get: () => json(SAVED_BODY) });

    const card = await screen.findByRole("region", { name: "Resultado salvo" });

    expect(rig.snapshotFetch.mock.calls[0]![1].headers.Authorization).toBe(
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
    const rig = setup({}, [{ status: "expired" }]);

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

    expect(screen.getByLabelText("Arquivo CSV da carteira")).toBeEnabled();
  });

  it("a failure on open (500) shows a discreet note and the page keeps working", async () => {
    const rig = setup({ get: () => json({}, 500) });

    expect(
      await screen.findByRole("status"),
    ).toHaveTextContent(/não foi possível verificar se há um resultado salvo/i);

    expect(screen.queryByRole("alert")).toBeNull();

    expect(rig.clearSession).not.toHaveBeenCalled();

    expect(screen.getByLabelText("Arquivo CSV da carteira")).toBeEnabled();

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

    await rig.user.upload(screen.getByLabelText("Arquivo CSV da carteira"), csv());

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

    const put = rig.snapshotFetch.mock.calls[1]!;

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

    const put = rig.snapshotFetch.mock.calls[1]!;

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
      { status: "ok", accessToken: TOKEN }, // open
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
      { status: "ok", accessToken: TOKEN },
      { status: "ok", accessToken: TOKEN },
      { status: "none" },
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

    const del = rig.snapshotFetch.mock.calls[1]!;

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

  it("a 401 while resolving does not remove the saved result already shown", async () => {
    const rig = setup({ get: () => json(SAVED_BODY), aie: () => json({}, 401) });

    await screen.findByRole("region", { name: "Resultado salvo" });

    await choose(rig);

    await rig.user.click(screen.getByRole("button", { name: /resolver carteira/i }));

    await screen.findByText("Sua sessão expirou.");

    expect(savedCard()).toHaveTextContent("SAVED ALPHA");
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
