// @vitest-environment jsdom
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { ApiError } from "./api";

import {
  acquireAccessToken,
  clearSession,
  getValidAccessToken,
  saveSession,
} from "./session";

const refreshTokens = vi.hoisted(() => vi.fn());

vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),

  refreshTokens: (...args: unknown[]) => refreshTokens(...args),
}));

/**
 * TASK-026: token lifecycle semantics of lib/session.ts. Offline: the refresh call
 * is a stub and the storage is the jsdom localStorage; no Planejador is contacted.
 */

const KEY = "aligna_session";

const STORED = {
  access_token: "old-access-token",

  refresh_token: "stored-refresh-token",

  token_type: "bearer",
};

const FRESH = {
  access_token: "fresh-access-token",

  refresh_token: "fresh-refresh-token",

  token_type: "bearer",
};

function stored(): unknown {
  const raw = window.localStorage.getItem(KEY);

  return raw ? JSON.parse(raw) : null;
}

describe("session token lifecycle", () => {
  beforeEach(() => {
    refreshTokens.mockReset();

    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("acquireAccessToken", () => {
    it("with nothing stored: none, and the identity service is not contacted", async () => {
      expect(await acquireAccessToken()).toEqual({
        status: "none",
      });

      expect(refreshTokens).not.toHaveBeenCalled();
    });

    it("exchanges the stored refresh token and returns the token it just issued", async () => {
      saveSession(STORED);

      refreshTokens.mockResolvedValue(FRESH);

      expect(await acquireAccessToken()).toEqual({
        status: "ok",

        accessToken: "fresh-access-token",
      });

      expect(refreshTokens).toHaveBeenCalledTimes(1);

      expect(refreshTokens).toHaveBeenCalledWith(
        "stored-refresh-token",
      );
    });

    it("stores the new pair, so the stale access token is never reused", async () => {
      saveSession(STORED);

      refreshTokens.mockResolvedValue(FRESH);

      await acquireAccessToken();

      expect(stored()).toEqual(FRESH);

      expect(
        window.localStorage.getItem(KEY),
      ).not.toContain("old-access-token");
    });

    it("a refresh token the server refuses (4xx) ends the session: expired, storage cleared", async () => {
      for (const status of [400, 401, 403, 404, 422]) {
        saveSession(STORED);

        refreshTokens.mockReset();

        refreshTokens.mockRejectedValue(
          new ApiError(status, "Sessão expirada"),
        );

        expect(await acquireAccessToken()).toEqual({
          status: "expired",
        });

        expect(stored()).toBeNull();
      }
    });

    it("a transient failure keeps the session: unavailable, storage untouched", async () => {
      const failures: unknown[] = [
        new TypeError("Failed to fetch"),
        new ApiError(500, "Sessão expirada"),
        new ApiError(502, "Sessão expirada"),
        new ApiError(503, "Sessão expirada"),
        new ApiError(408, "Sessão expirada"),
        new ApiError(429, "Sessão expirada"),
        new SyntaxError("Unexpected token <"),
      ];

      for (const failure of failures) {
        saveSession(STORED);

        refreshTokens.mockReset();

        refreshTokens.mockRejectedValue(failure);

        expect(await acquireAccessToken()).toEqual({
          status: "unavailable",
        });

        expect(stored()).toEqual(STORED);
      }
    });

    it("a stored value without a usable refresh token is cleared and reported as no session, without contacting the server", async () => {
      for (const bad of [
        { access_token: "a" },
        { refresh_token: "" },
        { refresh_token: 5 },
        {},
      ]) {
        window.localStorage.setItem(
          KEY,
          JSON.stringify(bad),
        );

        expect(await acquireAccessToken()).toEqual({
          status: "none",
        });

        expect(stored()).toBeNull();
      }

      expect(refreshTokens).not.toHaveBeenCalled();
    });

    it("unreadable storage is no session", async () => {
      window.localStorage.setItem(KEY, "{not json");

      expect(await acquireAccessToken()).toEqual({
        status: "none",
      });

      expect(refreshTokens).not.toHaveBeenCalled();
    });

    it("storage that throws is no session and does not throw", async () => {
      vi.spyOn(
        Storage.prototype,
        "getItem",
      ).mockImplementation(() => {
        throw new Error("blocked");
      });

      expect(await acquireAccessToken()).toEqual({
        status: "none",
      });
    });

    it("a refresh that succeeds while saving fails still returns the token (login works for this visit)", async () => {
      saveSession(STORED);

      refreshTokens.mockResolvedValue(FRESH);

      vi.spyOn(
        Storage.prototype,
        "setItem",
      ).mockImplementation(() => {
        throw new Error("quota");
      });

      expect(await acquireAccessToken()).toEqual({
        status: "ok",

        accessToken: "fresh-access-token",
      });
    });

    it("never inspects the token: an opaque, non-JWT value is passed through unchanged", async () => {
      saveSession(STORED);

      refreshTokens.mockResolvedValue({
        ...FRESH,

        access_token: "not.a-jwt at all ✓",
      });

      expect(await acquireAccessToken()).toEqual({
        status: "ok",

        accessToken: "not.a-jwt at all ✓",
      });
    });

    it("every call exchanges the refresh token (no local validity check); concurrent calls are not coalesced, and that is harmless because the refresh is stateless", async () => {
      saveSession(STORED);

      refreshTokens.mockResolvedValue(FRESH);

      await Promise.all([
        acquireAccessToken(),
        acquireAccessToken(),
      ]);

      expect(refreshTokens).toHaveBeenCalledTimes(2);
    });
  });

  describe("getValidAccessToken (existing contract)", () => {
    it("returns the fresh token, or null for no session, expired or unavailable", async () => {
      expect(await getValidAccessToken()).toBeNull();

      saveSession(STORED);

      refreshTokens.mockResolvedValue(FRESH);

      expect(await getValidAccessToken()).toBe(
        "fresh-access-token",
      );

      refreshTokens.mockRejectedValue(
        new ApiError(401, "Sessão expirada"),
      );

      expect(await getValidAccessToken()).toBeNull();

      expect(stored()).toBeNull();
    });

    it("a backend outage returns null but no longer wipes a valid session", async () => {
      saveSession(STORED);

      refreshTokens.mockRejectedValue(
        new ApiError(503, "Sessão expirada"),
      );

      expect(await getValidAccessToken()).toBeNull();

      expect(stored()).toEqual(STORED);
    });
  });

  describe("saveSession", () => {
    it("reports whether the session was actually stored (TASK-027 navigates only when it was)", () => {
      expect(saveSession(STORED)).toBe(true);

      expect(stored()).toEqual(STORED);

      vi.spyOn(
        Storage.prototype,
        "setItem",
      ).mockImplementation(() => {
        throw new Error("quota");
      });

      expect(saveSession(FRESH)).toBe(false);
    });
  });

  describe("clearSession", () => {
    it("removes the stored session and tolerates blocked storage", () => {
      saveSession(STORED);

      clearSession();

      expect(stored()).toBeNull();

      vi.spyOn(
        Storage.prototype,
        "removeItem",
      ).mockImplementation(() => {
        throw new Error("blocked");
      });

      expect(() => clearSession()).not.toThrow();
    });
  });
});
