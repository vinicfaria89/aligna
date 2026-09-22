// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  render,
  screen,
  waitFor,
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

import EvolucaoPage from "./page";

/**
 * TASK-027: the sign-in page's post-login return. Router, session and API are
 * faked at their boundaries; nothing real is contacted.
 */

const router = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
}));

const query = vi.hoisted(() => ({
  params: new URLSearchParams(),
}));

const api = vi.hoisted(() => ({
  login: vi.fn(),
  getScoreHistory: vi.fn(),
}));

const session = vi.hoisted(() => ({
  getValidAccessToken: vi.fn(),
  saveSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => router,

  useSearchParams: () => query.params,
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/api")
  >()),

  login: (...args: unknown[]) =>
    api.login(...args),

  getScoreHistory: (...args: unknown[]) =>
    api.getScoreHistory(...args),
}));

vi.mock("@/lib/session", () => ({
  getValidAccessToken: () =>
    session.getValidAccessToken(),

  saveSession: (...args: unknown[]) =>
    session.saveSession(...args),
}));

vi.mock("@/components/ScoreHistoryChart", () => ({
  default: () => null,
}));

vi.mock(
  "@/components/PatrimonioHistoryChart",
  () => ({
    default: () => null,
  }),
);

const TOKENS = {
  access_token: "sentinel-login-access",

  refresh_token: "sentinel-login-refresh",

  token_type: "bearer",
};

function visit(search: string) {
  query.params = new URLSearchParams(search);
}

async function signIn(
  user: ReturnType<typeof userEvent.setup>,
) {
  render(<EvolucaoPage />);

  await user.type(
    await screen.findByLabelText("E-mail"),
    "pessoa@example.com",
  );

  await user.type(
    screen.getByLabelText("Senha"),
    "senha-de-teste",
  );

  await user.click(
    screen.getByRole("button", {
      name: "Entrar",
    }),
  );
}

describe("/evolucao post-login return", () => {
  beforeEach(() => {
    router.replace.mockReset();

    router.push.mockReset();

    api.login.mockReset();

    api.getScoreHistory.mockReset();

    session.getValidAccessToken.mockReset();

    session.saveSession.mockReset();

    // No session by default: the login form shows.
    session.getValidAccessToken.mockResolvedValue(
      null,
    );

    session.saveSession.mockReturnValue(true);

    api.login.mockResolvedValue(TOKENS);

    api.getScoreHistory.mockResolvedValue([]);

    visit("");

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
  });

  it("without voltar: a successful login keeps today's behavior (session saved, history loaded, no navigation)", async () => {
    const user = userEvent.setup();

    // After the login the stored session is usable.
    session.getValidAccessToken
      .mockResolvedValueOnce(null)
      .mockResolvedValue("access-after-login");

    await signIn(user);

    await screen.findByText(
      /ainda não há nenhum diagnóstico/i,
    );

    expect(
      session.saveSession,
    ).toHaveBeenCalledTimes(1);

    expect(
      api.getScoreHistory,
    ).toHaveBeenCalledTimes(1);

    expect(router.replace).not.toHaveBeenCalled();

    expect(router.push).not.toHaveBeenCalled();
  });

  it("safe voltar + successful login: navigates to /carteira with replace, after the session was saved", async () => {
    visit("voltar=/carteira");

    const user = userEvent.setup();

    await signIn(user);

    await waitFor(() =>
      expect(
        router.replace,
      ).toHaveBeenCalledTimes(1),
    );

    expect(router.replace).toHaveBeenCalledWith(
      "/carteira",
    );

    expect(router.push).not.toHaveBeenCalled();

    // Persisted first, navigated second.
    expect(
      session.saveSession.mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      router.replace.mock
        .invocationCallOrder[0]!,
    );

    // The history is not loaded: the user is leaving.
    expect(
      api.getScoreHistory,
    ).not.toHaveBeenCalled();
  });

  it("stores the credentials exactly as the login returned them, and puts none in the destination", async () => {
    visit("voltar=/carteira");

    const user = userEvent.setup();

    await signIn(user);

    await waitFor(() =>
      expect(
        router.replace,
      ).toHaveBeenCalled(),
    );

    expect(
      session.saveSession,
    ).toHaveBeenCalledWith(TOKENS);

    for (const call of [
      ...router.replace.mock.calls,
      ...router.push.mock.calls,
    ]) {
      expect(JSON.stringify(call)).not.toMatch(
        /sentinel-login|pessoa@example|senha-de-teste|Bearer/,
      );
    }
  });

  const unsafe: Array<[string, string]> = [
    ["absolute https URL", "voltar=https://evil.example"],
    ["absolute http URL", "voltar=http://evil.example"],
    ["protocol-relative URL", "voltar=//evil.example"],
    ["protocol-relative, encoded", "voltar=%2F%2Fevil.example"],
    ["javascript URL", "voltar=javascript:alert(1)"],
    ["data URL", "voltar=data:text/html,x"],
    ["another internal route", "voltar=/evolucao"],
    ["path with query", "voltar=/carteira%3Fx%3D1"],
    ["path with fragment", "voltar=/carteira%23f"],
    ["trailing slash", "voltar=/carteira/"],
    ["upper case", "voltar=/CARTEIRA"],
    ["no leading slash", "voltar=carteira"],
    ["traversal", "voltar=../carteira"],
    ["double-encoded letter", "voltar=/%2563arteira"],
    ["empty", "voltar="],
    ["repeated parameter, first unsafe", "voltar=https://evil.example&voltar=/carteira"],
    ["unrelated parameter only", "next=/carteira"],
  ];

  for (const [name, search] of unsafe) {
    it(`invalid voltar (${name}) + successful login: never navigates, default behavior`, async () => {
      visit(search);

      const user = userEvent.setup();

      session.getValidAccessToken
        .mockResolvedValueOnce(null)
        .mockResolvedValue("access-after-login");

      await signIn(user);

      await screen.findByText(
        /ainda não há nenhum diagnóstico/i,
      );

      expect(
        router.replace,
      ).not.toHaveBeenCalled();

      expect(router.push).not.toHaveBeenCalled();

      expect(
        api.getScoreHistory,
      ).toHaveBeenCalledTimes(1);
    });
  }

  it("a failed login stays on the page, shows the existing error and never navigates", async () => {
    visit("voltar=/carteira");

    const { ApiError } = await import(
      "@/lib/api"
    );

    api.login.mockRejectedValue(
      new ApiError(401, "E-mail ou senha incorretos"),
    );

    const user = userEvent.setup();

    await signIn(user);

    expect(
      await screen.findByText(
        "E-mail ou senha incorretos",
      ),
    ).toBeInTheDocument();

    expect(router.replace).not.toHaveBeenCalled();

    expect(router.push).not.toHaveBeenCalled();

    expect(
      session.saveSession,
    ).not.toHaveBeenCalled();

    expect(
      screen.getByRole("button", {
        name: "Entrar",
      }),
    ).toBeInTheDocument();
  });

  it("a network failure during login shows the generic message and never navigates", async () => {
    visit("voltar=/carteira");

    api.login.mockRejectedValue(
      new TypeError("Failed to fetch sentinel-net"),
    );

    const user = userEvent.setup();

    await signIn(user);

    expect(
      await screen.findByText(
        /não conseguimos entrar agora/i,
      ),
    ).toBeInTheDocument();

    expect(
      document.body.textContent,
    ).not.toContain("sentinel-net");

    expect(router.replace).not.toHaveBeenCalled();
  });

  it("a failed login keeps the page (and its voltar) so a natural retry still returns", async () => {
    visit("voltar=/carteira");

    const { ApiError } = await import(
      "@/lib/api"
    );

    api.login
      .mockRejectedValueOnce(
        new ApiError(401, "E-mail ou senha incorretos"),
      )
      .mockResolvedValueOnce(TOKENS);

    const user = userEvent.setup();

    await signIn(user);

    await screen.findByText(
      "E-mail ou senha incorretos",
    );

    await user.click(
      screen.getByRole("button", {
        name: "Entrar",
      }),
    );

    await waitFor(() =>
      expect(
        router.replace,
      ).toHaveBeenCalledWith("/carteira"),
    );
  });

  it("if the session could not be stored, it does not navigate (the destination would not find it)", async () => {
    visit("voltar=/carteira");

    session.saveSession.mockReturnValue(false);

    const user = userEvent.setup();

    await signIn(user);

    await waitFor(() =>
      expect(
        session.saveSession,
      ).toHaveBeenCalledTimes(1),
    );

    expect(router.replace).not.toHaveBeenCalled();
  });

  it("an already authenticated visit with a safe voltar does NOT redirect because of the query alone", async () => {
    visit("voltar=/carteira");

    session.getValidAccessToken.mockResolvedValue(
      "valid-access",
    );

    render(<EvolucaoPage />);

    await screen.findByText(
      /ainda não há nenhum diagnóstico/i,
    );

    await new Promise((resolve) =>
      setTimeout(resolve, 30),
    );

    expect(router.replace).not.toHaveBeenCalled();

    expect(router.push).not.toHaveBeenCalled();

    expect(api.login).not.toHaveBeenCalled();

    expect(
      session.saveSession,
    ).not.toHaveBeenCalled();
  });

  it("a session check on load (which may refresh silently) never navigates, even when it yields no session", async () => {
    visit("voltar=/carteira");

    render(<EvolucaoPage />);

    await screen.findByLabelText("E-mail");

    expect(router.replace).not.toHaveBeenCalled();

    expect(router.push).not.toHaveBeenCalled();

    // Only the on-load check ran: no login happened.
    expect(api.login).not.toHaveBeenCalled();
  });

  it("makes no request of its own and no real network call", async () => {
    visit("voltar=/carteira");

    const user = userEvent.setup();

    await signIn(user);

    await waitFor(() =>
      expect(
        router.replace,
      ).toHaveBeenCalled(),
    );

    expect(
      globalThis.fetch,
    ).not.toHaveBeenCalled();
  });
});

/**
 * TASK-028: the sign-in form is programmatically labelled. The tests above already
 * find the fields through getByLabelText; these make the association explicit.
 */
describe("/evolucao sign-in form accessibility", () => {
  beforeEach(() => {
    router.replace.mockReset();

    api.login.mockReset();

    api.getScoreHistory.mockReset();

    session.getValidAccessToken.mockReset();

    session.saveSession.mockReset();

    session.getValidAccessToken.mockResolvedValue(
      null,
    );

    session.saveSession.mockReturnValue(true);

    api.login.mockResolvedValue(TOKENS);

    visit("");
  });

  afterEach(() => {
    cleanup();
  });

  it("the e-mail and password fields are found by their visible labels", async () => {
    render(<EvolucaoPage />);

    const email =
      await screen.findByLabelText("E-mail");

    const password =
      screen.getByLabelText("Senha");

    expect(email).toHaveAttribute(
      "type",
      "email",
    );

    expect(password).toHaveAttribute(
      "type",
      "password",
    );
  });

  it("each label references its own input id, and the ids are distinct", async () => {
    render(<EvolucaoPage />);

    const email =
      await screen.findByLabelText("E-mail");

    const password =
      screen.getByLabelText("Senha");

    expect(email.id).not.toBe("");

    expect(password.id).not.toBe("");

    expect(email.id).not.toBe(password.id);

    const labels = [
      ...document.querySelectorAll("label"),
    ];

    expect(
      labels.map((label) => [
        label.textContent,
        label.getAttribute("for"),
      ]),
    ).toEqual([
      ["E-mail", email.id],
      ["Senha", password.id],
    ]);
  });

  it("clicking a label focuses its field", async () => {
    const user = userEvent.setup();

    render(<EvolucaoPage />);

    const email =
      await screen.findByLabelText("E-mail");

    await user.click(
      screen.getByText("Senha"),
    );

    expect(
      screen.getByLabelText("Senha"),
    ).toHaveFocus();

    await user.click(screen.getByText("E-mail"));

    expect(email).toHaveFocus();
  });

  it("keeps the input types and offers the standard autocomplete hints", async () => {
    render(<EvolucaoPage />);

    expect(
      await screen.findByLabelText("E-mail"),
    ).toHaveAttribute("autocomplete", "email");

    expect(
      screen.getByLabelText("Senha"),
    ).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
  });

  it("the submit button has an accessible name and stays disabled until both fields are filled", async () => {
    const user = userEvent.setup();

    render(<EvolucaoPage />);

    const button = await screen.findByRole(
      "button",
      { name: "Entrar" },
    );

    expect(button).toBeDisabled();

    await user.type(
      screen.getByLabelText("E-mail"),
      "pessoa@example.com",
    );

    expect(button).toBeDisabled();

    await user.type(
      screen.getByLabelText("Senha"),
      "senha-de-teste",
    );

    expect(button).toBeEnabled();
  });

  it("while signing in the button says so and is busy and disabled", async () => {
    const user = userEvent.setup();

    let release: (tokens: typeof TOKENS) => void =
      () => undefined;

    api.login.mockReturnValue(
      new Promise<typeof TOKENS>((resolve) => {
        release = resolve;
      }),
    );

    render(<EvolucaoPage />);

    await user.type(
      await screen.findByLabelText("E-mail"),
      "pessoa@example.com",
    );

    await user.type(
      screen.getByLabelText("Senha"),
      "senha-de-teste",
    );

    await user.click(
      screen.getByRole("button", {
        name: "Entrar",
      }),
    );

    const busy = await screen.findByRole(
      "button",
      { name: "Entrando..." },
    );

    expect(busy).toBeDisabled();

    expect(busy).toHaveAttribute(
      "aria-busy",
      "true",
    );

    release(TOKENS);

    // Back to the ready form (no stored session in this fake), button usable again.
    expect(
      await screen.findByRole("button", {
        name: "Entrar",
      }),
    ).toHaveAttribute("aria-busy", "false");
  });

  it("a failed login is announced as an alert, with the existing message", async () => {
    const user = userEvent.setup();

    const { ApiError } = await import(
      "@/lib/api"
    );

    api.login.mockRejectedValue(
      new ApiError(401, "E-mail ou senha incorretos"),
    );

    render(<EvolucaoPage />);

    await user.type(
      await screen.findByLabelText("E-mail"),
      "pessoa@example.com",
    );

    await user.type(
      screen.getByLabelText("Senha"),
      "errada",
    );

    await user.click(
      screen.getByRole("button", {
        name: "Entrar",
      }),
    );

    expect(
      await screen.findByRole("alert"),
    ).toHaveTextContent(
      "E-mail ou senha incorretos",
    );
  });

  it("the submit button has a visible keyboard focus ring", async () => {
    render(<EvolucaoPage />);

    expect(
      await screen.findByRole("button", {
        name: "Entrar",
      }),
    ).toHaveClass(
      "focus-visible:ring-2",
      "focus-visible:ring-aligna-mid",
      "focus-visible:ring-offset-2",
    );
  });

  it("the loading state is a polite status", () => {
    session.getValidAccessToken.mockReturnValue(
      new Promise(() => undefined),
    );

    render(<EvolucaoPage />);

    expect(
      screen.getByRole("status"),
    ).toHaveTextContent(/carregando/i);
  });

  it("stays a thin UI over the existing calls: only the known modules are imported", async () => {
    const { readFileSync } = await import(
      "node:fs"
    );

    const { join } = await import(
      "node:path"
    );

    const source = readFileSync(
      join(process.cwd(), "app/evolucao/page.tsx"),
      "utf8",
    );

    const specifiers = [
      ...source.matchAll(
        /from\s*["']([^"']+)["']/g,
      ),
    ]
      .map((match) => match[1])
      .sort();

    expect(specifiers).toEqual(
      [
        "@/components/PatrimonioHistoryChart",
        "@/components/ScoreHistoryChart",
        "@/lib/api",
        "@/lib/navigation/safe-return-path",
        "@/lib/session",
        "@/lib/types",
        "@/lib/ui/focus-ring",
        "lucide-react",
        "next/navigation",
        "react",
      ].sort(),
    );
  });
});