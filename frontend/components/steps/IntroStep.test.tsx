// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  render,
  screen,
} from "@testing-library/react";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import CarteiraPage from "../../app/carteira/page";

import IntroStep from "./IntroStep";

/**
 * TASK-026: how /carteira is reached. The app has NO global navigation (a wizard
 * with a progress Stepper, and /evolucao reached from the start screen), so the
 * entry point follows that existing pattern: a plain link on the start screen.
 */

vi.mock("@/lib/session", () => ({
  acquireAccessToken: async () => ({
    status: "none",
  }),

  clearSession: () => undefined,
}));

afterEach(() => {
  cleanup();
});

describe("reaching /carteira", () => {
  it("the start screen links to Carteira next to the existing account link", () => {
    render(<IntroStep onNext={() => undefined} />);

    const carteira = screen.getByRole("link", {
      name: /resolver carteira por csv/i,
    });

    expect(carteira).toHaveAttribute(
      "href",
      "/carteira",
    );

    // The existing entry stays as it was.
    expect(
      screen.getByRole("link", {
        name: /ver minha evolução/i,
      }),
    ).toHaveAttribute("href", "/evolucao");
  });

  it("the link is keyboard reachable (a real anchor with an href, no custom handler)", () => {
    render(<IntroStep onNext={() => undefined} />);

    const carteira = screen.getByRole("link", {
      name: /resolver carteira por csv/i,
    });

    expect(carteira.tagName).toBe("A");

    expect(carteira).not.toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("the start action is unchanged", () => {
    render(<IntroStep onNext={() => undefined} />);

    expect(
      screen.getByRole("button", {
        name: /começar/i,
      }),
    ).toBeInTheDocument();
  });

  it("/carteira offers a way back to the start", () => {
    render(<CarteiraPage />);

    expect(
      screen.getByRole("link", {
        name: /voltar ao início/i,
      }),
    ).toHaveAttribute("href", "/");

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /resolver carteira/i,
      }),
    ).toBeInTheDocument();
  });

  it("/carteira with no session renders without any request or alert until the user acts", () => {
    const fetchSpy = vi.fn(() => {
      throw new Error("real network call attempted");
    });

    vi.stubGlobal("fetch", fetchSpy);

    render(<CarteiraPage />);

    expect(fetchSpy).not.toHaveBeenCalled();

    expect(screen.queryByRole("alert")).toBeNull();

    expect(
      screen.getByLabelText("Arquivo CSV da carteira"),
    ).toBeEnabled();

    vi.unstubAllGlobals();
  });
});
