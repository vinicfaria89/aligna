// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

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

import type { SubmitPortfolioCsvInput } from "@/lib/aie/client/resolve-csv-client";

vi.mock("@/lib/session", () => ({
  acquireAccessToken: async () => ({
    status: "none",
  }),

  clearSession: () => undefined,
}));

/**
 * TASK-027: the sign-in action offered by /carteira. Only the authentication
 * states (no session, expired) point to the login with the safe return route; 403,
 * 429, 500 and the rest never offer it, and nothing but the route is in the link.
 */

const TOKEN = "sentinel-return-token";

const FILE_NAME = "sentinel-file-name.csv";

const CSV =
  "id,rawName\nsentinel-row-id,SENTINEL-RETURN-CSV\n";

const LOGIN_RETURN = "/evolucao?voltar=/carteira";

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
      "x-correlation-id": "sentinel-corr-id",

      ...headers,
    },
  });
}

async function attempt(
  session: SubmitPortfolioCsvInput["getSession"],
  respond: () => Response = () => response(200),
) {
  const fetchImpl = vi.fn<FetchImpl>(
    async () => respond(),
  );

  const clearSession = vi.fn();

  const user = userEvent.setup();

  render(
    <PortfolioCsvResolver
      getSession={session}
      clearSession={clearSession}
      fetchImpl={fetchImpl}
    />,
  );

  await user.upload(
    screen.getByLabelText(
      "Arquivo CSV da carteira",
    ),
    new File([CSV], FILE_NAME, {
      type: "text/csv",

      lastModified: 1_700_000_000_000,
    }),
  );

  await screen.findByRole("table");

  await user.click(
    screen.getByRole("button", {
      name: /resolver carteira/i,
    }),
  );

  return {
    alert: await screen.findByRole("alert"),

    fetchImpl,

    clearSession,
  };
}

const ok = async () => ({
  status: "ok" as const,

  accessToken: TOKEN,
});

describe("sign-in action from /carteira", () => {
  beforeEach(() => {
    window.localStorage.clear();

    window.sessionStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("no session: the sign-in link returns to /carteira", async () => {
    const { alert, fetchImpl } = await attempt(
      async () => ({ status: "none" }),
    );

    expect(
      within(alert).getByRole("link", {
        name: "Entrar",
      }),
    ).toHaveAttribute("href", LOGIN_RETURN);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("expired session (refresh refused): the same safe link", async () => {
    const { alert } = await attempt(
      async () => ({ status: "expired" }),
    );

    expect(
      within(alert).getByRole("link", {
        name: "Entrar",
      }),
    ).toHaveAttribute("href", LOGIN_RETURN);
  });

  it("a 401 from the server: the same safe link", async () => {
    const { alert } = await attempt(ok, () =>
      response(401),
    );

    expect(
      within(alert).getByRole("link", {
        name: "Entrar",
      }),
    ).toHaveAttribute("href", LOGIN_RETURN);
  });

  it("the copy says the user comes back to the page and picks the file again", async () => {
    const { alert } = await attempt(
      async () => ({ status: "expired" }),
    );

    expect(alert).toHaveTextContent(
      /você volta a esta página e escolhe o arquivo de novo/i,
    );
  });

  for (const [name, status, headers] of [
    ["403", 403, {}],
    ["429", 429, { "retry-after": "7" }],
    ["500", 500, {}],
    ["502", 502, {}],
    ["400", 400, {}],
    ["413", 413, {}],
    ["415", 415, {}],
  ] as Array<
    [string, number, Record<string, string>]
  >) {
    it(`${name} offers no sign-in or return link`, async () => {
      const { alert, clearSession } =
        await attempt(ok, () =>
          response(status, headers),
        );

      expect(
        within(alert).queryByRole("link"),
      ).toBeNull();

      expect(
        document.querySelector(
          'a[href*="voltar"]',
        ),
      ).toBeNull();

      expect(clearSession).not.toHaveBeenCalled();
    });
  }

  it("a session-unavailable state offers no sign-in link either", async () => {
    const { alert } = await attempt(
      async () => ({ status: "unavailable" }),
    );

    expect(
      within(alert).queryByRole("link"),
    ).toBeNull();
  });

  it("nothing but the route is in the link: no token, file name, CSV, id or correlation id", async () => {
    for (const session of [
      async () => ({ status: "none" as const }),
      async () => ({ status: "expired" as const }),
      ok,
    ]) {
      const { alert } = await attempt(
        session,
        () => response(401),
      );

      const href =
        within(alert)
          .getByRole("link", {
            name: "Entrar",
          })
          .getAttribute("href") ?? "";

      expect(href).toBe(LOGIN_RETURN);

      for (const leaked of [
        TOKEN,
        FILE_NAME,
        "sentinel-row-id",
        "SENTINEL-RETURN-CSV",
        "sentinel-corr-id",
        "Bearer",
        "portfolio:",
      ]) {
        expect(href).not.toContain(leaked);
      }

      cleanup();
    }
  });
});

describe("coming back to /carteira", () => {
  afterEach(() => {
    cleanup();
  });

  it("restores nothing and sends nothing: no file, no preview, no result, no session call, no request", () => {
    const fetchImpl = vi.fn<FetchImpl>();

    const getSession = vi.fn<
      SubmitPortfolioCsvInput["getSession"]
    >(ok);

    // Storage as a previous visit would have left it: nothing of the portfolio.
    window.localStorage.clear();

    window.sessionStorage.clear();

    render(
      <PortfolioCsvResolver
        getSession={getSession}
        fetchImpl={fetchImpl}
      />,
    );

    expect(
      screen.getByLabelText(
        "Arquivo CSV da carteira",
      ),
    ).toHaveValue("");

    expect(
      screen.getByRole("button", {
        name: /resolver carteira/i,
      }),
    ).toBeDisabled();

    expect(
      screen.queryByRole("table"),
    ).toBeNull();

    expect(
      screen.queryByRole("alert"),
    ).toBeNull();

    expect(getSession).not.toHaveBeenCalled();

    expect(fetchImpl).not.toHaveBeenCalled();

    expect(window.localStorage.length).toBe(0);

    expect(window.sessionStorage.length).toBe(0);
  });

  it("writes no portfolio data to storage even through a full failed attempt", async () => {
    await attempt(
      async () => ({ status: "expired" }),
    );

    expect(window.localStorage.length).toBe(0);

    expect(window.sessionStorage.length).toBe(0);
  });
});
