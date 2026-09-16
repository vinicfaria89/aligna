import { IntakeTokens, refreshTokens } from "./api";

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

/** Devolve um access_token utilizável, renovando via refresh_token se
 * preciso -- ou null se não há sessão salva ou o refresh também expirou. */
export async function getValidAccessToken(): Promise<string | null> {
  const stored = readStoredTokens();
  if (!stored) return null;
  try {
    const fresh = await refreshTokens(stored.refresh_token);
    saveSession(fresh);
    return fresh.access_token;
  } catch {
    clearSession();
    return null;
  }
}
