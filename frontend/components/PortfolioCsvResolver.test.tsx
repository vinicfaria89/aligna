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
import { MAX_CSV_UPLOAD_BYTES } from "@/lib/aie/ingestion/portfolio-csv-limits";

// The component's DEFAULT auth is the app's existing session module.
const sessionAccess = vi.hoisted(() => vi.fn());

const sessionClear = vi.hoisted(() => vi.fn());

vi.mock("@/lib/session", () => ({
  acquireAccessToken: () => sessionAccess(),
  clearSession: () => sessionClear(),
}));

/**
 * TASK-025: the CSV portfolio resolution UI, driven like a user would. The
 * network is a stubbed fetch (never real) and the session is a stub; the
 * server's answers are canned.
 */

const TOKEN = "sentinel-ui-bearer-token";

const CSV_SENTINEL = "SENTINEL-UI-CSV-CONTENT";

const GOOD_CSV = [
  "id,rawName,assetType,instrumentCode,amount",
  "d1,DEB ALPHA SENTINEL-UI-CSV-CONTENT,debenture,ABCD11,1000.5",
  "d2,DEB BETA,debenture,EFGH22,20",
].join("\n");

function csvFile(
  content = GOOD_CSV,
  name = "carteira.csv",
): File {
  return new File([content], name, {
    type: "text/csv",

    lastModified: 1_700_000_000_000,
  });
}

function resolved(
  index: number,
  status: string,
  extra: {
    unresolved?: string[];
    sources?: string[];
    verified?: {
      canonicalAssetId: string;
      assetType: string;
      currency: string;
    };
    searches?: Array<{
      providerId: string;
      status: string;
    }>;
  } = {},
) {
  return {
    index,

    candidateAssetId: `portfolio-id-${index}`,

    ok: true,

    result: {
      status,

      verifiedAsset:
        extra.verified ?? null,

      investigation: {
        evidence: (
          extra.sources ?? []
        ).map((source) => ({
          source,

          field: "identity",

          value: "SECRET-EVIDENCE",

          metadata: {
            secret: "SECRET-METADATA",
          },
        })),

        searches:
          extra.searches ?? [],

        unresolvedFields:
          extra.unresolved ?? [],
      },
    },
  };
}

function itemError(index: number) {
  return {
    index,

    candidateAssetId: `portfolio-id-${index}`,

    ok: false,

    error: {
      code: "AIE_INTERNAL_ERROR",

      message: "Unable to resolve asset.",
    },
  };
}

function ok(
  items: unknown[],
  correlationId = "corr-ok-1",
): Response {
  return new Response(
    JSON.stringify({
      ok: true,

      result: { items },
    }),
    {
      status: 200,

      headers: {
        "x-correlation-id":
          correlationId,
      },
    },
  );
}

function failure(
  status: number,
  body: unknown = {},
  headers: Record<string, string> = {},
): Response {
  return new Response(
    JSON.stringify(body),
    {
      status,

      headers: {
        "x-correlation-id":
          "corr-fail-1",

        ...headers,
      },
    },
  );
}

type FetchImpl = NonNullable<
  SubmitPortfolioCsvInput["fetchImpl"]
>;

function setup(
  respond: () => Response | Promise<Response> = () =>
    ok([]),
  getAccessToken: () => Promise<string | null> = async () =>
    TOKEN,
  session?: SubmitPortfolioCsvInput["getSession"],
) {
  const fetchImpl = vi.fn<FetchImpl>(
    async () => respond(),
  );

  const clearSession = vi.fn();

  const getSession = vi.fn<
    SubmitPortfolioCsvInput["getSession"]
  >(
    session ??
      (async () => {
        const token = await getAccessToken();

        return token
          ? {
              status: "ok" as const,

              accessToken: token,
            }
          : { status: "none" as const };
      }),
  );

  const user = userEvent.setup();

  const view = render(
    <PortfolioCsvResolver
      getSession={getSession}
      clearSession={clearSession}
      fetchImpl={fetchImpl}
    />,
  );

  return {
    fetchImpl,
    user,
    view,
    getSession,
    clearSession,
  };
}

function fileInput(): HTMLInputElement {
  return screen.getByLabelText(
    "Arquivo CSV da carteira",
  );
}

async function choose(
  user: ReturnType<typeof userEvent.setup>,
  file: File = csvFile(),
) {
  await user.upload(fileInput(), file);
}

function resolveButton(): HTMLElement {
  return screen.getByRole("button", {
    name: /resolver carteira|resolvendo/i,
  });
}

async function submit(
  user: ReturnType<typeof userEvent.setup>,
) {
  await user.click(resolveButton());
}

describe("PortfolioCsvResolver", () => {
  beforeEach(() => {
    sessionAccess.mockReset();

    sessionClear.mockReset();

    sessionAccess.mockResolvedValue({
      status: "ok",

      accessToken: TOKEN,
    });

    window.localStorage.clear();

    window.sessionStorage.clear();

    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error(
          "real network call attempted",
        );
      }),
    );
  });

  afterEach(() => {
    cleanup();

    vi.unstubAllGlobals();

    vi.restoreAllMocks();
  });

  describe("selecting and previewing a file", () => {
    it("starts idle: a labelled file input, nothing to send, nothing to clear", () => {
      setup();

      expect(fileInput()).toBeEnabled();

      expect(
        fileInput(),
      ).toHaveAttribute(
        "accept",
        ".csv,text/csv",
      );

      expect(resolveButton()).toBeDisabled();

      expect(
        screen.getByRole("button", {
          name: "Limpar",
        }),
      ).toBeDisabled();

      expect(
        screen.queryByRole("table"),
      ).toBeNull();

      expect(
        screen.queryByRole("alert"),
      ).toBeNull();
    });

    it("shows the file name and a local preview in the CSV row order", async () => {
      const { user } = setup();

      await choose(user);

      expect(
        await screen.findByText(
          "carteira.csv",
        ),
      ).toBeInTheDocument();

      const table = screen.getByRole(
        "table",
        {
          name: /prévia/i,
        },
      );

      const rows = within(table).getAllByRole(
        "row",
      );

      // header + 2 data rows, in the file's order
      expect(rows).toHaveLength(3);

      expect(
        within(rows[1]!).getByText(
          /DEB ALPHA/,
        ),
      ).toBeInTheDocument();

      expect(
        within(rows[2]!).getByText(
          "DEB BETA",
        ),
      ).toBeInTheDocument();

      expect(
        within(rows[1]!).getByText(
          "ABCD11",
        ),
      ).toBeInTheDocument();

      expect(
        resolveButton(),
      ).toBeEnabled();
    });

    it("uses table semantics: captions and column headers", async () => {
      const { user } = setup();

      await choose(user);

      await screen.findByRole("table", {
        name: /prévia/i,
      });

      expect(
        screen.getAllByRole(
          "columnheader",
        ).length,
      ).toBeGreaterThanOrEqual(6);
    });

    it("rejects a file over the size limit before reading or sending", async () => {
      const { user, fetchImpl } =
        setup();

      await choose(
        user,
        csvFile(
          "x".repeat(
            MAX_CSV_UPLOAD_BYTES + 1,
          ),
          "big.csv",
        ),
      );

      const alert =
        await screen.findByRole("alert");

      expect(alert).toHaveTextContent(
        /grande demais/i,
      );

      expect(alert).toHaveTextContent(
        "512 KB",
      );

      expect(
        resolveButton(),
      ).toBeDisabled();

      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("reports an invalid CSV locally with safe, located messages (no cell values)", async () => {
      const { user, fetchImpl } =
        setup();

      await choose(
        user,
        csvFile(
          "rawName,cpf\nSECRET-CELL-VALUE,123\n",
        ),
      );

      const alert =
        await screen.findByRole("alert");

      expect(alert).toHaveTextContent(
        /cabeçalho, coluna 2/i,
      );

      expect(alert).toHaveTextContent(
        /não permitida/i,
      );

      expect(
        document.body.innerHTML,
      ).not.toContain("SECRET-CELL-VALUE");

      expect(
        resolveButton(),
      ).toBeDisabled();

      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("says so for an empty file", async () => {
      const { user } = setup();

      await choose(
        user,
        csvFile("   \n", "vazio.csv"),
      );

      expect(
        await screen.findByRole("alert"),
      ).toHaveTextContent(/vazio/i);
    });

    it("does not infer a ticker from the name: Petrobras PN stays without PETR4", async () => {
      const { user } = setup();

      await choose(
        user,
        csvFile(
          "id,rawName,assetType\np1,Petrobras PN,stock\n",
        ),
      );

      const table = await screen.findByRole(
        "table",
        {
          name: /prévia/i,
        },
      );

      expect(
        within(table).getByText(
          "Petrobras PN",
        ),
      ).toBeInTheDocument();

      expect(
        document.body.textContent,
      ).not.toContain("PETR4");
    });

    it("handles a header-only CSV: a clear notice, nothing to send", async () => {
      const { user, fetchImpl } =
        setup();

      await choose(
        user,
        csvFile("id,rawName\n", "so-cabecalho.csv"),
      );

      expect(
        await screen.findByText(
          /só o cabeçalho/i,
        ),
      ).toBeInTheDocument();

      expect(
        screen.queryByRole("table"),
      ).toBeNull();

      expect(
        resolveButton(),
      ).toBeDisabled();

      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("lets the file be replaced after selection (and drops the old one)", async () => {
      const { user } = setup();

      await choose(user);

      await screen.findByText(
        "carteira.csv",
      );

      await choose(
        user,
        csvFile(
          "id,rawName\nz1,OUTRO ATIVO\n",
          "outra.csv",
        ),
      );

      expect(
        await screen.findByText(
          "outra.csv",
        ),
      ).toBeInTheDocument();

      expect(
        screen.queryByText("carteira.csv"),
      ).toBeNull();

      expect(
        screen.getByText("OUTRO ATIVO"),
      ).toBeInTheDocument();

      expect(
        screen.queryByText(/DEB ALPHA/),
      ).toBeNull();
    });
  });

  describe("sending to the server", () => {
    it("POSTs raw text/csv with the session bearer, only the opaque id in the URL", async () => {
      const { user, fetchImpl } =
        setup();

      await choose(user);

      await screen.findByRole("table");

      await submit(user);

      await waitFor(() =>
        expect(
          fetchImpl,
        ).toHaveBeenCalledTimes(1),
      );

      const [url, init] =
        fetchImpl.mock.calls[0]!;

      expect(url).toMatch(
        /^\/api\/aie\/resolve-csv\?fileId=f[0-9a-f]{16}$/,
      );

      expect(
        init.headers["Content-Type"],
      ).toBe("text/csv; charset=utf-8");

      expect(
        init.headers.Authorization,
      ).toBe(`Bearer ${TOKEN}`);

      expect(init.body).toBe(GOOD_CSV);

      expect(init.method).toBe("POST");

      // Neither the token nor the CSV is in the URL.
      expect(url).not.toContain(TOKEN);

      expect(url).not.toContain(
        CSV_SENTINEL,
      );

      expect(url).not.toContain("rawName");
    });

    it("uses the app's existing session by default (lib/session)", async () => {
      const fetchImpl = vi.fn<FetchImpl>(
        async () => ok([]),
      );

      const user = userEvent.setup();

      render(
        <PortfolioCsvResolver
          fetchImpl={fetchImpl}
        />,
      );

      await choose(user);

      await screen.findByRole("table");

      await submit(user);

      await waitFor(() =>
        expect(
          fetchImpl,
        ).toHaveBeenCalledTimes(1),
      );

      expect(
        sessionAccess,
      ).toHaveBeenCalledTimes(1);

      expect(
        fetchImpl.mock.calls[0]![1]
          .headers.Authorization,
      ).toBe(`Bearer ${TOKEN}`);
    });

    it("without a session it asks the user to sign in and sends nothing", async () => {
      const { user, fetchImpl } =
        setup(
          () => ok([]),
          async () => null,
        );

      await choose(user);

      await screen.findByRole("table");

      await submit(user);

      const alert =
        await screen.findByRole("alert");

      expect(alert).toHaveTextContent(
        /entre na sua conta/i,
      );

      expect(
        within(alert).getByRole("link", {
          name: "Entrar",
        }),
      ).toHaveAttribute(
        "href",
        "/evolucao",
      );

      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("prevents a duplicate submit while a request is pending", async () => {
      let release: (
        response: Response,
      ) => void = () => undefined;

      const { user, fetchImpl } = setup(
        () =>
          new Promise<Response>(
            (resolve) => {
              release = resolve;
            },
          ),
      );

      await choose(user);

      await screen.findByRole("table");

      await submit(user);

      await waitFor(() =>
        expect(
          resolveButton(),
        ).toBeDisabled(),
      );

      expect(
        resolveButton(),
      ).toHaveAttribute(
        "aria-busy",
        "true",
      );

      expect(
        screen.getAllByRole("status")
          .length,
      ).toBeGreaterThan(0);

      // Extra clicks and the file input are inert while pending.
      await user.click(resolveButton());

      await user.click(resolveButton());

      expect(fileInput()).toBeDisabled();

      expect(fetchImpl).toHaveBeenCalledTimes(
        1,
      );

      release(ok([]));

      await waitFor(() =>
        expect(
          resolveButton(),
        ).toBeEnabled(),
      );

      expect(fetchImpl).toHaveBeenCalledTimes(
        1,
      );
    });
  });

  describe("results", () => {
    it("renders several results in the original order", async () => {
      const { user } = setup(() =>
        ok([
          resolved(0, "needs-more-evidence", {
            unresolved: ["issuer"],

            sources: ["ANBIMA"],
          }),
          resolved(1, "verified", {
            verified: {
              canonicalAssetId:
                "EFGH22",

              assetType: "debenture",

              currency: "BRL",
            },

            sources: ["ANBIMA", "CVM"],
          }),
        ]),
      );

      await choose(user);

      await screen.findByRole("table");

      await submit(user);

      const table =
        await screen.findByRole("table", {
          name: /resultado/i,
        });

      const rows =
        within(table).getAllByRole("row");

      expect(rows).toHaveLength(3);

      expect(
        within(rows[1]!).getByText(
          /DEB ALPHA/,
        ),
      ).toBeInTheDocument();

      expect(
        within(rows[2]!).getByText(
          "DEB BETA",
        ),
      ).toBeInTheDocument();

      // The line numbers follow the CSV (header is row 1).
      expect(
        within(rows[1]!)
          .getAllByRole("cell")[0],
      ).toHaveTextContent("2");

      expect(
        within(rows[2]!)
          .getAllByRole("cell")[0],
      ).toHaveTextContent("3");

      expect(
        screen.getByText(
          /1 verificados · 1 com pendências · 0 com erro/,
        ),
      ).toBeInTheDocument();
    });

    it("shows a verified item as verified with its canonical code and sources", async () => {
      const { user } = setup(() =>
        ok([
          resolved(0, "verified", {
            verified: {
              canonicalAssetId:
                "ABCD11",

              assetType: "debenture",

              currency: "BRL",
            },

            sources: ["ANBIMA"],
          }),
          resolved(1, "verified", {
            verified: {
              canonicalAssetId:
                "EFGH22",

              assetType: "debenture",

              currency: "BRL",
            },
          }),
        ]),
      );

      await choose(user);

      await screen.findByRole("table");

      await submit(user);

      const table =
        await screen.findByRole("table", {
          name: /resultado/i,
        });

      expect(
        within(table).getAllByText(
          "Verificado",
        ),
      ).toHaveLength(2);

      expect(
        within(table).getByText("ABCD11"),
      ).toBeInTheDocument();

      expect(
        within(table).getByText(
          /Fontes: ANBIMA/,
        ),
      ).toBeInTheDocument();
    });

    it("shows needs-more-evidence as UNRESOLVED, not as an error, with what is missing", async () => {
      const { user } = setup(() =>
        ok([
          resolved(0, "needs-more-evidence", {
            unresolved: ["issuer", "maturity"],

            sources: ["ANBIMA"],

            searches: [
              {
                providerId: "CVM",

                status: "failed",
              },
            ],
          }),
          resolved(1, "needs-more-evidence"),
        ]),
      );

      await choose(user);

      await screen.findByRole("table");

      await submit(user);

      const table =
        await screen.findByRole("table", {
          name: /resultado/i,
        });

      expect(
        within(table).getAllByText(
          "Precisa de mais evidências",
        ),
      ).toHaveLength(2);

      expect(
        within(table).getByText(
          /Falta confirmar: emissor, vencimento/,
        ),
      ).toBeInTheDocument();

      expect(
        within(table).getByText(
          /Fontes consultadas: ANBIMA/,
        ),
      ).toBeInTheDocument();

      expect(
        within(table).getByText(
          /Falha ao consultar: CVM/,
        ),
      ).toBeInTheDocument();

      // Not an error: no error badge, no alert.
      expect(
        within(table).queryByText(
          "Erro ao resolver",
        ),
      ).toBeNull();

      expect(
        screen.queryByRole("alert"),
      ).toBeNull();
    });

    it("shows a per-item error separately from the other items (still a successful request)", async () => {
      const { user } = setup(() =>
        ok([
          resolved(0, "verified", {
            verified: {
              canonicalAssetId:
                "ABCD11",

              assetType: "debenture",

              currency: "BRL",
            },
          }),
          itemError(1),
        ]),
      );

      await choose(user);

      await screen.findByRole("table");

      await submit(user);

      const table =
        await screen.findByRole("table", {
          name: /resultado/i,
        });

      expect(
        within(table).getByText(
          "Erro ao resolver",
        ),
      ).toBeInTheDocument();

      expect(
        within(table).getByText(
          "Não foi possível resolver este ativo.",
        ),
      ).toBeInTheDocument();

      expect(
        within(table).getByText(
          "Verificado",
        ),
      ).toBeInTheDocument();

      expect(
        screen.getByText(
          /1 verificados · 0 com pendências · 1 com erro/,
        ),
      ).toBeInTheDocument();
    });

    it("never renders evidence values, metadata, the token or the correlation id inside the table", async () => {
      const { user } = setup(() =>
        ok([
          resolved(0, "needs-more-evidence", {
            sources: ["ANBIMA"],
          }),
          resolved(1, "needs-more-evidence"),
        ]),
      );

      await choose(user);

      await screen.findByRole("table");

      await submit(user);

      await screen.findByRole("table", {
        name: /resultado/i,
      });

      const html =
        document.body.innerHTML;

      for (const leaked of [
        "SECRET-EVIDENCE",
        "SECRET-METADATA",
        TOKEN,
      ]) {
        expect(html).not.toContain(
          leaked,
        );
      }
    });

    it("full flow: an authenticated user chooses a two-asset CSV, sees the preview, and gets the rows in order", async () => {
      const { user, fetchImpl } = setup(
        () =>
          ok([
            resolved(0, "needs-more-evidence", {
              unresolved: ["issuer"],

              sources: ["ANBIMA"],
            }),
            resolved(1, "needs-more-evidence", {
              unresolved: ["issuer"],

              sources: ["ANBIMA"],
            }),
          ]),
      );

      await choose(user);

      await screen.findByRole("table", {
        name: /prévia/i,
      });

      await submit(user);

      const table =
        await screen.findByRole("table", {
          name: /resultado/i,
        });

      const rows =
        within(table).getAllByRole("row");

      expect(
        rows.map((row) => row.textContent),
      ).toEqual([
        expect.stringContaining("Situação"),
        expect.stringContaining(
          "DEB ALPHA",
        ),
        expect.stringContaining(
          "DEB BETA",
        ),
      ]);

      expect(fetchImpl).toHaveBeenCalledTimes(
        1,
      );
    });
  });

  describe("the server stays authoritative", () => {
    it("400 shows safe validation feedback, not a success, even though the preview said valid", async () => {
      const { user } = setup(() =>
        failure(
          400,
          {
            ok: false,

            error: {
              code: "INVALID_PORTFOLIO_CSV",

              message:
                "Invalid portfolio CSV.",

              issues: [
                {
                  path: "row[3].amount",

                  code: "invalid_value",
                },
              ],
            },
          },
        ),
      );

      await choose(user);

      await screen.findByRole("table", {
        name: /prévia/i,
      });

      await submit(user);

      const alert =
        await screen.findByRole("alert");

      expect(alert).toHaveTextContent(
        /o servidor recusou este csv/i,
      );

      expect(alert).toHaveTextContent(
        /linha 3, campo amount: valor inválido/i,
      );

      expect(
        screen.queryByRole("table", {
          name: /resultado/i,
        }),
      ).toBeNull();
    });

    it("401 says the session expired and asks the user to sign in again", async () => {
      const { user } = setup(() =>
        failure(401),
      );

      await choose(user);

      await screen.findByRole("table");

      await submit(user);

      expect(
        await screen.findByRole("alert"),
      ).toHaveTextContent(
        /sua sessão expirou.*entre novamente/i,
      );

      expect(
        screen.queryByRole("table", {
          name: /resultado/i,
        }),
      ).toBeNull();
    });

    it("403 shows a neutral access message and NO result table, without guessing why", async () => {
      const { user } = setup(() =>
        failure(403),
      );

      await choose(user);

      await screen.findByRole("table");

      await submit(user);

      const alert =
        await screen.findByRole("alert");

      expect(alert).toHaveTextContent(
        "Sua conta não tem acesso à resolução de carteiras em lote.",
      );

      for (const guessed of [
        /premium/i,
        /assinatura/i,
        /stripe/i,
        /pagamento/i,
        /plano/i,
      ]) {
        expect(
          alert.textContent,
        ).not.toMatch(guessed);
      }

      expect(
        screen.queryByRole("table", {
          name: /resultado/i,
        }),
      ).toBeNull();
    });

    it("413 says the file is too large", async () => {
      const { user } = setup(() =>
        failure(413),
      );

      await choose(user);

      await screen.findByRole("table");

      await submit(user);

      expect(
        await screen.findByRole("alert"),
      ).toHaveTextContent(
        /arquivo grande demais/i,
      );
    });

    it("415 is reported as an application problem, not the user's file", async () => {
      const { user } = setup(() =>
        failure(415),
      );

      await choose(user);

      await screen.findByRole("table");

      await submit(user);

      expect(
        await screen.findByRole("alert"),
      ).toHaveTextContent(
        /problema no aplicativo/i,
      );
    });

    it("429 shows the Retry-After wait", async () => {
      const { user } = setup(() =>
        failure(
          429,
          {},
          { "retry-after": "12" },
        ),
      );

      await choose(user);

      await screen.findByRole("table");

      await submit(user);

      expect(
        await screen.findByRole("alert"),
      ).toHaveTextContent(
        /tente novamente em cerca de 12 segundos/i,
      );
    });

    it("429 without Retry-After still gives useful guidance", async () => {
      const { user } = setup(() =>
        failure(429),
      );

      await choose(user);

      await screen.findByRole("table");

      await submit(user);

      expect(
        await screen.findByRole("alert"),
      ).toHaveTextContent(
        /aguarde um pouco/i,
      );
    });

    it("500 gives a generic message and a support reference, never the raw response", async () => {
      const { user } = setup(() =>
        failure(500, {
          ok: false,

          error: {
            code: "AIE_INTERNAL_ERROR",

            message:
              "STACKTRACE-SENTINEL at Object.<anonymous>",
          },
        }),
      );

      await choose(user);

      await screen.findByRole("table");

      await submit(user);

      const alert =
        await screen.findByRole("alert");

      expect(alert).toHaveTextContent(
        /não conseguimos resolver a carteira agora/i,
      );

      expect(alert).toHaveTextContent(
        "Referência para suporte: corr-fail-1",
      );

      expect(
        document.body.innerHTML,
      ).not.toContain("STACKTRACE-SENTINEL");

      expect(
        document.body.innerHTML,
      ).not.toContain("AIE_INTERNAL_ERROR");
    });

    it("a network failure shows its own message and never the underlying error", async () => {
      const fetchImpl = vi.fn<FetchImpl>(
        async () => {
          throw new Error(
            `ECONNREFUSED ${TOKEN}`,
          );
        },
      );

      const user = userEvent.setup();

      render(
        <PortfolioCsvResolver
          getSession={async () => ({
            status: "ok",

            accessToken: TOKEN,
          })}
          fetchImpl={fetchImpl}
        />,
      );

      await choose(user);

      await screen.findByRole("table");

      await submit(user);

      expect(
        await screen.findByRole("alert"),
      ).toHaveTextContent(
        /não foi possível conectar/i,
      );

      expect(
        document.body.innerHTML,
      ).not.toContain("ECONNREFUSED");

      expect(
        document.body.innerHTML,
      ).not.toContain(TOKEN);
    });

    it("keeps the selected file after a failure so the user can retry", async () => {
      let attempt = 0;

      const { user, fetchImpl } = setup(
        () => {
          attempt += 1;

          return attempt === 1
            ? failure(500)
            : ok([
                resolved(
                  0,
                  "needs-more-evidence",
                ),
                resolved(
                  1,
                  "needs-more-evidence",
                ),
              ]);
        },
      );

      await choose(user);

      await screen.findByRole("table");

      await submit(user);

      await screen.findByRole("alert");

      expect(
        screen.getByText("carteira.csv"),
      ).toBeInTheDocument();

      await submit(user);

      await screen.findByRole("table", {
        name: /resultado/i,
      });

      expect(fetchImpl).toHaveBeenCalledTimes(
        2,
      );

      expect(
        screen.queryByRole("alert"),
      ).toBeNull();
    });
  });

  describe("reset and privacy", () => {
    it("Limpar clears the file, the preview and the results", async () => {
      const { user } = setup(() =>
        ok([
          resolved(0, "needs-more-evidence"),
          resolved(1, "needs-more-evidence"),
        ]),
      );

      await choose(user);

      await screen.findByRole("table");

      await submit(user);

      await screen.findByRole("table", {
        name: /resultado/i,
      });

      await user.click(
        screen.getByRole("button", {
          name: "Limpar",
        }),
      );

      expect(
        screen.queryByRole("table"),
      ).toBeNull();

      expect(
        screen.queryByText("carteira.csv"),
      ).toBeNull();

      expect(
        resolveButton(),
      ).toBeDisabled();

      expect(
        screen.getByRole("button", {
          name: "Limpar",
        }),
      ).toBeDisabled();
    });

    it("clears stale results when another file is chosen", async () => {
      const { user } = setup(() =>
        ok([
          resolved(0, "needs-more-evidence"),
          resolved(1, "needs-more-evidence"),
        ]),
      );

      await choose(user);

      await screen.findByRole("table");

      await submit(user);

      await screen.findByRole("table", {
        name: /resultado/i,
      });

      await choose(
        user,
        csvFile(
          "id,rawName\nn1,NOVO ATIVO\n",
          "novo.csv",
        ),
      );

      await screen.findByText("novo.csv");

      expect(
        screen.queryByRole("table", {
          name: /resultado/i,
        }),
      ).toBeNull();
    });

    it("never shows the token in the DOM and never writes the CSV to browser storage", async () => {
      const setItem = vi.spyOn(
        Storage.prototype,
        "setItem",
      );

      const { user } = setup(() =>
        ok([
          resolved(0, "needs-more-evidence"),
          resolved(1, "needs-more-evidence"),
        ]),
      );

      await choose(user);

      await screen.findByRole("table");

      await submit(user);

      await screen.findByRole("table", {
        name: /resultado/i,
      });

      expect(
        document.body.innerHTML,
      ).not.toContain(TOKEN);

      expect(setItem).not.toHaveBeenCalled();

      expect(
        window.localStorage.length,
      ).toBe(0);

      expect(
        window.sessionStorage.length,
      ).toBe(0);

      expect(
        JSON.stringify({
          ...window.localStorage,
          ...window.sessionStorage,
        }),
      ).not.toContain(CSV_SENTINEL);
    });

    it("does not log anything to the console", async () => {
      const spies = (
        ["log", "info", "warn", "error", "debug"] as const
      ).map((method) =>
        vi
          .spyOn(console, method)
          .mockImplementation(
            () => undefined,
          ),
      );

      const { user } = setup(() =>
        failure(500),
      );

      await choose(user);

      await screen.findByRole("table");

      await submit(user);

      await screen.findByRole("alert");

      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    });
  });

  /**
   * TASK-026: the real session flow. The session module (lib/session) is faked
   * at its boundary: `getSession` stands for acquireAccessToken (which refreshes
   * before every call) and `clearSession` for the existing clearSession.
   */
  describe("session flow (TASK-026)", () => {
    const okSession = async () => ({
      status: "ok" as const,

      accessToken: TOKEN,
    });

    async function prepared(
      respond: () => Response | Promise<Response>,
      session: SubmitPortfolioCsvInput["getSession"] = okSession,
    ) {
      const rig = setup(
        respond,
        async () => TOKEN,
        session,
      );

      await choose(rig.user);

      await screen.findByRole("table");

      return rig;
    }

    it("a direct visit with no session shows the ready screen and calls neither the session nor the endpoint", () => {
      const { fetchImpl, getSession, clearSession } =
        setup(
          () => ok([]),
          async () => null,
        );

      expect(fileInput()).toBeEnabled();

      expect(
        screen.queryByRole("alert"),
      ).toBeNull();

      expect(getSession).not.toHaveBeenCalled();

      expect(clearSession).not.toHaveBeenCalled();

      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("no session: an authentication-required state with an action to the existing sign-in, and nothing is sent", async () => {
      const { user, fetchImpl, clearSession } =
        await prepared(
          () => ok([]),
          async () => ({ status: "none" }),
        );

      await submit(user);

      const alert =
        await screen.findByRole("alert");

      expect(alert).toHaveTextContent(
        /entre na sua conta para continuar/i,
      );

      expect(alert).not.toHaveTextContent(
        /sua sessão expirou/i,
      );

      expect(
        within(alert).getByRole("link", {
          name: "Entrar",
        }),
      ).toHaveAttribute("href", "/evolucao");

      expect(fetchImpl).not.toHaveBeenCalled();

      expect(clearSession).not.toHaveBeenCalled();
    });

    it("a valid session submits exactly once, with the token only in the Authorization header", async () => {
      const { user, fetchImpl, getSession } =
        await prepared(() =>
          ok([
            resolved(0, "needs-more-evidence"),
            resolved(1, "needs-more-evidence"),
          ]),
        );

      await submit(user);

      await screen.findByRole("table", {
        name: /resultado/i,
      });

      expect(getSession).toHaveBeenCalledTimes(1);

      expect(fetchImpl).toHaveBeenCalledTimes(1);

      const [url, init] = fetchImpl.mock.calls[0]!;

      expect(init.headers.Authorization).toBe(
        `Bearer ${TOKEN}`,
      );

      expect(url).not.toContain(TOKEN);

      expect(init.body).not.toContain(TOKEN);

      expect(
        document.body.innerHTML,
      ).not.toContain(TOKEN);
    });

    it("uses the token the session just issued, never a stale one", async () => {
      const sessions = [
        {
          status: "ok" as const,

          accessToken: "refreshed-token-B",
        },
      ];

      const { user, fetchImpl } = await prepared(
        () => ok([]),
        async () => sessions[0]!,
      );

      await submit(user);

      await waitFor(() =>
        expect(fetchImpl).toHaveBeenCalledTimes(1),
      );

      expect(
        fetchImpl.mock.calls[0]![1].headers
          .Authorization,
      ).toBe("Bearer refreshed-token-B");

      expect(
        JSON.stringify(fetchImpl.mock.calls),
      ).not.toContain(TOKEN);
    });

    it("an expired session (refresh refused) asks to sign in again, sends nothing and shows no token", async () => {
      const { user, fetchImpl } = await prepared(
        () => ok([]),
        async () => ({ status: "expired" }),
      );

      await submit(user);

      const alert =
        await screen.findByRole("alert");

      expect(alert).toHaveTextContent(
        /sua sessão expirou/i,
      );

      expect(alert).toHaveTextContent(
        /entre novamente/i,
      );

      expect(
        within(alert).getByRole("link", {
          name: "Entrar",
        }),
      ).toHaveAttribute("href", "/evolucao");

      expect(fetchImpl).not.toHaveBeenCalled();

      expect(
        document.body.innerHTML,
      ).not.toContain(TOKEN);
    });

    it("an unavailable identity service is not a logout: the session is kept, nothing is sent, the file stays", async () => {
      const { user, fetchImpl, clearSession } =
        await prepared(
          () => ok([]),
          async () => ({ status: "unavailable" }),
        );

      await submit(user);

      const alert =
        await screen.findByRole("alert");

      expect(alert).toHaveTextContent(
        /não foi possível verificar sua sessão/i,
      );

      expect(alert).toHaveTextContent(
        /continua conectada/i,
      );

      expect(
        within(alert).queryByRole("link"),
      ).toBeNull();

      expect(fetchImpl).not.toHaveBeenCalled();

      expect(clearSession).not.toHaveBeenCalled();

      expect(
        screen.getByText("carteira.csv"),
      ).toBeInTheDocument();
    });

    it("a 401 ends the session ONCE, asks to sign in again, keeps no result and never retries", async () => {
      const { user, fetchImpl, getSession, clearSession } =
        await prepared(() => failure(401));

      await submit(user);

      const alert =
        await screen.findByRole("alert");

      expect(alert).toHaveTextContent(
        /sua sessão expirou/i,
      );

      expect(
        within(alert).getByRole("link", {
          name: "Entrar",
        }),
      ).toHaveAttribute("href", "/evolucao");

      expect(clearSession).toHaveBeenCalledTimes(1);

      // One session lookup, one request: no refresh-and-retry, no loop.
      expect(getSession).toHaveBeenCalledTimes(1);

      expect(fetchImpl).toHaveBeenCalledTimes(1);

      expect(
        screen.queryByRole("table", {
          name: /resultado/i,
        }),
      ).toBeNull();

      // Nothing happens on its own afterwards.
      await new Promise((resolve) =>
        setTimeout(resolve, 30),
      );

      expect(getSession).toHaveBeenCalledTimes(1);

      expect(fetchImpl).toHaveBeenCalledTimes(1);

      expect(clearSession).toHaveBeenCalledTimes(1);
    });

    it("a 401 after a good result removes the old result and does not resubmit by itself", async () => {
      let attempt = 0;

      const { user, fetchImpl, clearSession } =
        await prepared(() => {
          attempt += 1;

          return attempt === 1
            ? ok([
                resolved(0, "needs-more-evidence"),
                resolved(1, "needs-more-evidence"),
              ])
            : failure(401);
        });

      await submit(user);

      await screen.findByRole("table", {
        name: /resultado/i,
      });

      await submit(user);

      await screen.findByRole("alert");

      expect(
        screen.queryByRole("table", {
          name: /resultado/i,
        }),
      ).toBeNull();

      expect(
        screen.queryByText(/precisa de mais evidências/i),
      ).toBeNull();

      expect(fetchImpl).toHaveBeenCalledTimes(2);

      expect(clearSession).toHaveBeenCalledTimes(1);
    });

    it("the user can submit again after a 401 (explicit action), and it asks the session again", async () => {
      let attempt = 0;

      const { user, fetchImpl, getSession } =
        await prepared(() => {
          attempt += 1;

          return attempt === 1
            ? failure(401)
            : ok([
                resolved(0, "needs-more-evidence"),
                resolved(1, "needs-more-evidence"),
              ]);
        });

      await submit(user);

      await screen.findByRole("alert");

      await submit(user);

      await screen.findByRole("table", {
        name: /resultado/i,
      });

      expect(getSession).toHaveBeenCalledTimes(2);

      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("403 is NOT an expired login: the session is kept, no refresh, no retry, no Premium claim", async () => {
      const { user, fetchImpl, getSession, clearSession } =
        await prepared(() => failure(403));

      await submit(user);

      const alert =
        await screen.findByRole("alert");

      expect(alert).toHaveTextContent(
        /não tem acesso/i,
      );

      expect(alert).not.toHaveTextContent(
        /premium|assin|plano|sessão expirou|entre na sua conta/i,
      );

      expect(
        within(alert).queryByRole("link"),
      ).toBeNull();

      expect(clearSession).not.toHaveBeenCalled();

      expect(getSession).toHaveBeenCalledTimes(1);

      expect(fetchImpl).toHaveBeenCalledTimes(1);

      expect(
        screen.queryByRole("table", {
          name: /resultado/i,
        }),
      ).toBeNull();
    });

    it("429 keeps the session, refreshes nothing and shows the wait", async () => {
      const { user, fetchImpl, getSession, clearSession } =
        await prepared(() =>
          failure(429, {}, { "retry-after": "9" }),
        );

      await submit(user);

      expect(
        await screen.findByRole("alert"),
      ).toHaveTextContent(/cerca de 9 segundos/i);

      expect(clearSession).not.toHaveBeenCalled();

      expect(getSession).toHaveBeenCalledTimes(1);

      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("500 keeps the session and keeps the readable support reference", async () => {
      const { user, fetchImpl, getSession, clearSession } =
        await prepared(() =>
          failure(500, {}, {
            "x-correlation-id": "corr-500-readable",
          }),
        );

      await submit(user);

      const alert =
        await screen.findByRole("alert");

      expect(alert).toHaveTextContent(
        "Referência para suporte: corr-500-readable",
      );

      expect(alert).not.toHaveTextContent(
        /sessão|entre na sua conta/i,
      );

      expect(clearSession).not.toHaveBeenCalled();

      expect(getSession).toHaveBeenCalledTimes(1);

      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("no error state ever shows the token", async () => {
      for (const status of [
        400, 401, 403, 413, 415, 429, 500,
      ]) {
        const { user, view } = await prepared(() =>
          failure(status),
        );

        await submit(user);

        await screen.findByRole("alert");

        expect(
          document.body.innerHTML,
        ).not.toContain(TOKEN);

        expect(
          document.body.textContent,
        ).not.toMatch(/bearer|authorization/i);

        view.unmount();

        cleanup();
      }
    });

    it("a malformed CSV never asks the session for anything", async () => {
      const { user, getSession, clearSession, fetchImpl } =
        setup(() => ok([]));

      await choose(
        user,
        csvFile("rawName,cpf\nX,123\n"),
      );

      await screen.findByRole("alert");

      expect(getSession).not.toHaveBeenCalled();

      expect(clearSession).not.toHaveBeenCalled();

      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("replacing or clearing the file does not touch the session", async () => {
      const { user, getSession, clearSession, fetchImpl } =
        await prepared(() => ok([]));

      await choose(
        user,
        csvFile(
          "id,rawName\nz1,OTHER ASSET\n",
          "outra.csv",
        ),
      );

      await screen.findByText("outra.csv");

      await user.click(
        screen.getByRole("button", {
          name: "Limpar",
        }),
      );

      expect(getSession).not.toHaveBeenCalled();

      expect(clearSession).not.toHaveBeenCalled();

      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("a double click asks the session and the server once", async () => {
      let release: (response: Response) => void =
        () => undefined;

      const { user, fetchImpl, getSession } =
        await prepared(
          () =>
            new Promise<Response>((resolve) => {
              release = resolve;
            }),
        );

      await submit(user);

      await waitFor(() =>
        expect(resolveButton()).toBeDisabled(),
      );

      await user.click(resolveButton());

      expect(getSession).toHaveBeenCalledTimes(1);

      release(
        ok([
          resolved(0, "needs-more-evidence"),
          resolved(1, "needs-more-evidence"),
        ]),
      );

      await screen.findByRole("table", {
        name: /resultado/i,
      });

      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });
});
