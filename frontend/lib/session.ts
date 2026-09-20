import { ApiError, IntakeTokens, refreshTokens } from "./api";

const STORAGE_KEY = "aligna_session";

/**
 * Sessão do lado do cliente -- o Aligna não tem servidor de sessão próprio,
 * então "estar logado" aqui é só ter um refresh_token válido guardado no
 * navegador. Funciona bem o bastante pro "volta quando quiser" do produto;
 * não tenta ser mais robusto que isso (sem múltiplos dispositivos, sem
 * logout remoto).
 */
export function saveSession(tokens: IntakeTokens): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  } catch {
    // localStorage pode falhar (aba anônima, storage bloqueado) -- login
    // ainda funciona pra esta visita, só não persiste pra próxima.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ver saveSession
  }
}

function readStoredTokens(): IntakeTokens | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as IntakeTokens) : null;
  } catch {
    return null;
  }
}

/** Resultado de pedir um access_token à sessão salva:
 * - ok: token recém-emitido pelo refresh_token;
 * - none: não há sessão salva;
 * - expired: o Planejador recusou o refresh_token (a sessão local foi apagada);
 * - unavailable: não foi possível falar com o Planejador agora (falha de rede,
 *   5xx, limite de taxa) -- a sessão salva continua intacta. */
export type SessionAccess =
  | { status: "ok"; accessToken: string }
  | { status: "none" }
  | { status: "expired" }
  | { status: "unavailable" };

// Só uma recusa definitiva do refresh_token (4xx) encerra a sessão. Falha de
// rede, 5xx, timeout (408) e limite de taxa (429) são transitórios: apagar o
// refresh_token de 7 dias por causa de um soluço do backend deslogaria quem
// não fez nada de errado.
function isDefinitiveRejection(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status >= 400 &&
    err.status < 500 &&
    err.status !== 408 &&
    err.status !== 429
  );
}

/** Pede um access_token novo com o refresh_token salvo. O access_token não é
 * inspecionado (nada de decodificar JWT no navegador): a cada chamada o
 * refresh_token é trocado por um par novo, então o token devolvido acabou de
 * ser emitido. Não há coalescência de chamadas simultâneas -- o refresh do
 * Planejador é stateless (sem rotação), então chamadas paralelas são só
 * redundantes, não incorretas. */
export async function acquireAccessToken(): Promise<SessionAccess> {
  const stored = readStoredTokens();
  if (!stored) return { status: "none" };

  if (typeof stored.refresh_token !== "string" || stored.refresh_token === "") {
    clearSession();
    return { status: "none" };
  }

  try {
    const fresh = await refreshTokens(stored.refresh_token);
    saveSession(fresh);
    return { status: "ok", accessToken: fresh.access_token };
  } catch (err) {
    if (isDefinitiveRejection(err)) {
      clearSession();
      return { status: "expired" };
    }
    return { status: "unavailable" };
  }
}

/** Devolve um access_token utilizável, renovando via refresh_token se
 * preciso -- ou null se não há sessão salva, o refresh também expirou ou o
 * Planejador está indisponível (neste último caso a sessão é preservada). */
export async function getValidAccessToken(): Promise<string | null> {
  const access = await acquireAccessToken();
  return access.status === "ok" ? access.accessToken : null;
}
