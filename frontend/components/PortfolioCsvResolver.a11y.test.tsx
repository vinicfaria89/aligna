// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import { readFileSync } from "node:fs";

import { join } from "node:path";

import {
  cleanup,
  render,
  screen,
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
import { fakeSnapshotClient } from "./portfolio-snapshot-test-support";

import type { SubmitPortfolioCsvInput } from "@/lib/aie/client/resolve-csv-client";

vi.mock("@/lib/session", () => ({
  acquireAccessToken: async () => ({
    status: "none",
  }),

  clearSession: () => undefined,
}));

/**
 * TASK-028: accessibility and mobile polish of /carteira. jsdom applies no
 * stylesheet, so the tests check the DOM contract (semantics, labels, ids not
 * shown, classes that carry the responsive/target-size behavior); the rendered
 * layout was verified in a real browser (see the task document).
 */

const TOKEN = "sentinel-a11y-token";

const CSV = [
  "id,rawName,assetType,instrumentCode,ticker,amount,currency,fileName,institution",
  "hidden-row-id,DEB PETROBRAS SERIE 1,debenture,ABCD11,,98765.43,BRL,SENTINEL-HIDDEN-FILE.csv,SENTINEL-HIDDEN-BANK",
  "second-hidden-id,Petrobras PN,stock,,PETR4,1500,BRL,,",
  "third-hidden-id,CDB Banco Exemplo 2027,cdb,,,,,,",
].join("\n");

type FetchImpl = NonNullable<
  SubmitPortfolioCsvInput["fetchImpl"]
>;

function response(
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response("{}", {
    status,

    headers: {
      "x-correlation-id": "corr-a11y",

      ...headers,
    },
  });
}

async function chooseFile(
  content = CSV,
  name = "carteira.csv",
) {
  const user = userEvent.setup();

  const fetchImpl = vi.fn<FetchImpl>(
    async () => response(200),
  );

  const view = render(
    <PortfolioCsvResolver
      snapshotClient={fakeSnapshotClient()}
      getSession={async () => ({
        status: "ok",

        accessToken: TOKEN,
      })}
      clearSession={() => undefined}
      fetchImpl={fetchImpl}
    />,
  );

  await user.upload(
    screen.getByLabelText(
      "Arquivo CSV da carteira",
    ),
    new File([content], name, {
      type: "text/csv",

      lastModified: 1_700_000_000_000,
    }),
  );

  return { user, view, fetchImpl };
}

async function preview() {
  return screen.findByRole("table", {
    name: /prévia/i,
  });
}

describe("CSV preview: semantic table on desktop, stacked cards on mobile", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps a real table with a caption, header cells scoped to their columns and body rows", async () => {
    await chooseFile();

    const table = await preview();

    expect(table.tagName).toBe("TABLE");

    expect(
      table.querySelector("caption"),
    ).toHaveTextContent(
      "Prévia das linhas do arquivo CSV",
    );

    expect(
      table.querySelector("thead"),
    ).not.toBeNull();

    expect(
      table.querySelector("tbody"),
    ).not.toBeNull();

    const headers = [
      ...table.querySelectorAll("th"),
    ];

    expect(
      headers.map((th) => th.textContent),
    ).toEqual([
      "Linha",
      "Ativo",
      "Tipo",
      "Ticker / código",
      "Valor",
      "Situação local",
    ]);

    for (const th of headers) {
      expect(th).toHaveAttribute(
        "scope",
        "col",
      );
    }
  });

  it("column headers are accessible to assistive technology", async () => {
    await chooseFile();

    const table = await preview();

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
      "Situação local",
    ]);

    // header row + one row per CSV line
    expect(
      within(table).getAllByRole("row"),
    ).toHaveLength(4);
  });

  it("one markup serves both layouts: the table is a block of cards below md and a table from md", async () => {
    await chooseFile();

    const table = await preview();

    expect(table).toHaveClass(
      "block",
      "md:table",
    );

    // Visually hidden below md, a real header row from md (not-sr-only undoes the
    // sr-only positioning; without it the header stays invisible on desktop).
    expect(
      table.querySelector("thead"),
    ).toHaveClass(
      "sr-only",
      "md:not-sr-only",
      "md:table-header-group",
    );

    expect(
      table.querySelector("tbody"),
    ).toHaveClass(
      "block",
      "md:table-row-group",
    );

    const bodyRows = within(table)
      .getAllByRole("row")
      .slice(1);

    for (const row of bodyRows) {
      // a bordered card on mobile, a table row from md
      expect(row).toHaveClass(
        "block",
        "rounded-lg",
        "border",
        "md:table-row",
        "md:border-0",
      );

      for (const cell of within(
        row,
      ).getAllByRole("cell")) {
        expect(cell).toHaveClass(
          "block",
          "md:table-cell",
        );
      }
    }
  });

  it("no horizontal-scroll wrapper is left around the preview", async () => {
    await chooseFile();

    const table = await preview();

    expect(
      table.closest(".overflow-x-auto"),
    ).toBeNull();

    expect(
      document.querySelector(".overflow-x-auto"),
    ).toBeNull();
  });

  it("the same rows, in the same order, are in the card view", async () => {
    await chooseFile();

    const rows = within(await preview())
      .getAllByRole("row")
      .slice(1);

    expect(rows).toHaveLength(3);

    expect(rows[0]).toHaveTextContent(
      "DEB PETROBRAS SERIE 1",
    );

    expect(rows[1]).toHaveTextContent(
      "Petrobras PN",
    );

    expect(rows[2]).toHaveTextContent(
      "CDB Banco Exemplo 2027",
    );
  });

  it("each card carries a label per value, hidden from assistive technology and from md up", async () => {
    await chooseFile();

    const [first] = within(await preview())
      .getAllByRole("row")
      .slice(1);

    const labels = [
      ...first!.querySelectorAll(
        "span[aria-hidden=true]",
      ),
    ];

    expect(
      labels.map((label) => label.textContent),
    ).toEqual([
      "Linha",
      "Ativo",
      "Tipo",
      "Ticker / código",
      "Valor",
      "Situação local",
    ]);

    for (const label of labels) {
      expect(label).toHaveClass("md:hidden");
    }
  });

  it("a card shows the row, the name, the type, the code, the amount with currency and the local status", async () => {
    await chooseFile();

    const [first] = within(await preview())
      .getAllByRole("row")
      .slice(1);

    const cells = within(
      first!,
    ).getAllByRole("cell");

    expect(cells).toHaveLength(6);

    expect(cells[0]).toHaveTextContent("Linha2");

    expect(cells[1]).toHaveTextContent(
      "AtivoDEB PETROBRAS SERIE 1",
    );

    expect(cells[2]).toHaveTextContent(
      "Tipodebenture",
    );

    expect(cells[3]).toHaveTextContent(
      "Ticker / códigoABCD11",
    );

    // Currency-formatted, pt-BR (a non-breaking space follows the symbol).
    expect(cells[4]?.textContent).toMatch(
      /^ValorR\$\s98\.765,43$/,
    );

    expect(cells[5]).toHaveTextContent(
      "Situação localFormato válido",
    );
  });

  it("shows a ticker when there is one, a dash when there is no code, and no amount as a dash", async () => {
    await chooseFile();

    const rows = within(await preview())
      .getAllByRole("row")
      .slice(1);

    expect(
      within(rows[1]!).getAllByRole("cell")[3],
    ).toHaveTextContent("Ticker / códigoPETR4");

    expect(
      within(rows[2]!).getAllByRole("cell")[3],
    ).toHaveTextContent("Ticker / código—");

    expect(
      within(rows[2]!).getAllByRole("cell")[4],
    ).toHaveTextContent("Valor—");
  });

  it("the local status is text, not colour alone", async () => {
    await chooseFile();

    for (const row of within(await preview())
      .getAllByRole("row")
      .slice(1)) {
      expect(
        within(row).getAllByRole("cell")[5],
      ).toHaveTextContent("Formato válido");
    }
  });

  it("never renders internal ids, hidden CSV columns or the token", async () => {
    await chooseFile();

    await preview();

    const text = document.body.innerHTML;

    for (const hidden of [
      "hidden-row-id",
      "second-hidden-id",
      "third-hidden-id",
      "portfolio:",
      "SENTINEL-HIDDEN-FILE",
      "SENTINEL-HIDDEN-BANK",
      TOKEN,
      "Bearer",
    ]) {
      expect(text).not.toContain(hidden);
    }
  });

  it("ids derived from the upload (rows without an id) are not shown either", async () => {
    await chooseFile(
      "rawName,assetType\nNO ID ASSET,debenture\n",
    );

    await preview();

    expect(
      document.body.innerHTML,
    ).not.toContain("portfolio:");
  });
});

describe("keyboard focus", () => {
  afterEach(() => {
    cleanup();
  });

  it("the action buttons have a visible focus ring, and the file input keeps its own", async () => {
    await chooseFile();

    for (const name of [
      /resolver carteira/i,
      "Limpar",
    ]) {
      expect(
        screen.getByRole("button", { name }),
      ).toHaveClass(
        "focus-visible:ring-2",
        "focus-visible:ring-aligna-mid",
        "focus-visible:ring-offset-2",
      );
    }

    expect(
      screen.getByLabelText(
        "Arquivo CSV da carteira",
      ),
    ).toHaveClass("input");
  });
});

describe("regressions around the preview", () => {
  afterEach(() => {
    cleanup();
  });

  it("an invalid CSV still shows the local error and no preview", async () => {
    await chooseFile("rawName,cpf\nX,123\n");

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent(
      /não conseguimos usar este arquivo/i,
    );

    expect(screen.queryByRole("table")).toBeNull();
  });

  it("replacing the file replaces the preview", async () => {
    const { user } = await chooseFile();

    await preview();

    await user.upload(
      screen.getByLabelText(
        "Arquivo CSV da carteira",
      ),
      new File(
        ["id,rawName\nz,ONLY ONE ASSET\n"],
        "outra.csv",
        { type: "text/csv" },
      ),
    );

    const rows = within(await preview())
      .getAllByRole("row")
      .slice(1);

    expect(rows).toHaveLength(1);

    expect(rows[0]).toHaveTextContent(
      "ONLY ONE ASSET",
    );
  });

  it("Limpar removes the preview and the file", async () => {
    const { user } = await chooseFile();

    await preview();

    await user.click(
      screen.getByRole("button", {
        name: "Limpar",
      }),
    );

    expect(screen.queryByRole("table")).toBeNull();

    expect(
      screen.getByLabelText(
        "Arquivo CSV da carteira",
      ),
    ).toHaveValue("");
  });

  it("results keep their own stacked-card markup unchanged, and 'precisa de mais evidências' stays a pending state with text", async () => {
    const user = userEvent.setup();

    const body = {
      ok: true,

      result: {
        items: [0, 1, 2].map((index) => ({
          index,

          candidateAssetId: `id-${index}`,

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
        })),
      },
    };

    render(
      <PortfolioCsvResolver
        snapshotClient={fakeSnapshotClient()}
        getSession={async () => ({
          status: "ok",

          accessToken: TOKEN,
        })}
        clearSession={() => undefined}
        fetchImpl={async () =>
          new Response(JSON.stringify(body), {
            status: 200,
          })
        }
      />,
    );

    await user.upload(
      screen.getByLabelText(
        "Arquivo CSV da carteira",
      ),
      new File([CSV], "carteira.csv", {
        type: "text/csv",
      }),
    );

    await preview();

    await user.click(
      screen.getByRole("button", {
        name: /resolver carteira/i,
      }),
    );

    const results = await screen.findByRole(
      "table",
      { name: /resultado/i },
    );

    expect(results).toHaveClass(
      "block",
      "md:table",
    );

    // Same header fix as the preview: visible from md (it was hidden on desktop before).
    expect(
      results.querySelector("thead"),
    ).toHaveClass(
      "sr-only",
      "md:not-sr-only",
      "md:table-header-group",
    );

    const rows = within(results)
      .getAllByRole("row")
      .slice(1);

    expect(rows).toHaveLength(3);

    for (const row of rows) {
      expect(row).toHaveClass(
        "block",
        "rounded-lg",
        "md:table-row",
      );

      // a text signal, not only an amber colour
      expect(row).toHaveTextContent(
        "Precisa de mais evidências",
      );

      expect(row).toHaveTextContent(
        "Falta confirmar: emissor",
      );
    }

    expect(
      screen.queryByRole("alert"),
    ).toBeNull();
  });
});

describe("the sign-in action from /carteira", () => {
  afterEach(() => {
    cleanup();
  });

  async function unauthenticated(
    session: SubmitPortfolioCsvInput["getSession"],
    respond: () => Response = () =>
      response(200),
  ) {
    const user = userEvent.setup();

    render(
      <PortfolioCsvResolver
        snapshotClient={fakeSnapshotClient()}
        getSession={session}
        clearSession={() => undefined}
        fetchImpl={async () => respond()}
      />,
    );

    await user.upload(
      screen.getByLabelText(
        "Arquivo CSV da carteira",
      ),
      new File([CSV], "carteira.csv", {
        type: "text/csv",
      }),
    );

    await preview();

    await user.click(
      screen.getByRole("button", {
        name: /resolver carteira/i,
      }),
    );

    return screen.findByRole("alert");
  }

  const LOGIN = "/evolucao?voltar=/carteira";

  for (const [name, session, respond] of [
    [
      "no session",
      async () => ({ status: "none" as const }),
      undefined,
    ],
    [
      "expired session",
      async () => ({
        status: "expired" as const,
      }),
      undefined,
    ],
    [
      "a 401 from the server",
      async () => ({
        status: "ok" as const,

        accessToken: TOKEN,
      }),
      () => response(401),
    ],
  ] as Array<
    [
      string,
      SubmitPortfolioCsvInput["getSession"],
      (() => Response) | undefined,
    ]
  >) {
    it(`${name}: "Entrar" is a real link with the safe return href and an accessible name`, async () => {
      const alert = await unauthenticated(
        session,
        respond,
      );

      const link = within(alert).getByRole(
        "link",
        { name: "Entrar" },
      );

      expect(link.tagName).toBe("A");

      expect(link).toHaveAttribute(
        "href",
        LOGIN,
      );
    });
  }

  it("is styled as a button-link with a target of at least 44px and a visible keyboard focus ring", async () => {
    const alert = await unauthenticated(
      async () => ({ status: "none" }),
    );

    const link = within(alert).getByRole(
      "link",
      { name: "Entrar" },
    );

    // .btn-primary = inline-flex, rounded-full, py-3 (48px with its 20px line height is 44px+)
    expect(link).toHaveClass(
      "btn-primary",
      "min-h-[44px]",
      "justify-center",
      "focus-visible:ring-2",
      "focus-visible:ring-aligna-mid",
      "focus-visible:ring-offset-2",
    );
  });

  it("is reachable and activatable with the keyboard like any link (no tabindex override, no click handler)", async () => {
    const user = userEvent.setup();

    const alert = await unauthenticated(
      async () => ({ status: "none" }),
    );

    const link = within(alert).getByRole(
      "link",
      { name: "Entrar" },
    );

    expect(link).not.toHaveAttribute(
      "tabindex",
    );

    expect(link).not.toHaveAttribute("role");

    expect(link).not.toHaveAttribute(
      "onclick",
    );

    link.focus();

    expect(link).toHaveFocus();

    // Tab order follows the reading order: the link comes after the buttons.
    const clear = screen.getByRole("button", {
      name: "Limpar",
    });

    expect(
      clear.compareDocumentPosition(link) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await user.tab({ shift: true });

    expect(link).not.toHaveFocus();
  });

  it("keeps the explanation before the action and the wording about choosing the file again", async () => {
    const alert = await unauthenticated(
      async () => ({ status: "expired" }),
    );

    expect(alert).toHaveTextContent(
      "Sua sessão expirou.",
    );

    expect(alert).toHaveTextContent(
      /você volta a esta página e escolhe o arquivo de novo/i,
    );

    const link = within(alert).getByRole(
      "link",
      { name: "Entrar" },
    );

    // The link follows the paragraph, it is not buried in it.
    expect(
      link.parentElement?.tagName,
    ).toBe("DIV");
  });

  for (const [name, status] of [
    ["403", 403],
    ["429", 429],
    ["500", 500],
  ] as Array<[string, number]>) {
    it(`${name} still shows no login link`, async () => {
      const alert = await unauthenticated(
        async () => ({
          status: "ok" as const,

          accessToken: TOKEN,
        }),
        () => response(status),
      );

      expect(
        within(alert).queryByRole("link"),
      ).toBeNull();

      expect(
        document.querySelector(
          'a[href*="voltar"]',
        ),
      ).toBeNull();
    });
  }
});

describe("scope of the polish (static)", () => {
  it("the touched UI files import nothing from the server side, providers, policy or the session internals", () => {
    for (const file of [
      "components/PortfolioCsvResolver.tsx",
      "app/carteira/page.tsx",
      "app/evolucao/page.tsx",
    ]) {
      const source = readFileSync(
        join(process.cwd(), file),
        "utf8",
      );

      for (const specifier of [
        ...source.matchAll(
          /from\s*["']([^"']+)["']/g,
        ),
      ].map((match) => match[1] as string)) {
        expect(specifier).not.toMatch(
          /lib\/aie\/(server|providers|policy|orchestrator|infrastructure|resolution|application)/,
        );

        expect(specifier).not.toMatch(
          /request-authorization|planejador-request-authorizer|getServerAie/,
        );
      }
    }
  });

  it("the component still reaches the session only through its two existing calls", () => {
    const source = readFileSync(
      join(
        process.cwd(),
        "components/PortfolioCsvResolver.tsx",
      ),
      "utf8",
    );

    expect(
      source.match(
        /import \{[^}]*\} from "@\/lib\/session";/g,
      ),
    ).toEqual([
      'import { acquireAccessToken, clearSession } from "@/lib/session";',
    ]);
  });
});
