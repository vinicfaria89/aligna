import { PLANEJADOR_API_URL } from "./planejador-api-url";
import { ExtractedAsset, PerfilData, RiskProfile, ScoreSnapshot, UploadedFile } from "./types";

// URL do backend do Planejador Financeiro -- é ele quem de fato recebe o
// intake (ver POST /api/v1/intake/aligna, já construído e testado do lado
// de lá). O Aligna não tem banco de dados próprio: é um funil sem estado
// persistente até este último passo. A resolução (incl. a checagem de
// ambiente de produção) vive em lib/planejador-api-url.ts (TASK-033).

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface IntakeTokens {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export async function submitIntake(perfil: PerfilData, riskProfile: RiskProfile, assets: ExtractedAsset[]): Promise<IntakeTokens> {
  const res = await fetch(`${PLANEJADOR_API_URL}/api/v1/intake/aligna`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: perfil.email,
      password: perfil.password,
      full_name: perfil.full_name,
      birth_date: perfil.birth_date,
      risk_profile: riskProfile,
      assets: assets.map((a) => ({
        name: a.name,
        category: a.category,
        value: a.value,
        institution: a.institution || null,
        liquidity: a.liquidity,
        indexer: a.indexer || null,
        maturity_date: a.maturity_date || null,
      })),
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, body.detail ?? "Erro ao continuar no Planejador Financeiro");
  }

  return res.json();
}

/**
 * Pede uma sessão de Checkout da Stripe pro backend (POST
 * /api/v1/billing/checkout, ver mapeamento de billing) e devolve a URL pra
 * onde redirecionar o navegador. Lança ApiError quando o backend recusa --
 * o caso mais comum antes de a conta Stripe existir de verdade é 502
 * (STRIPE_SECRET_KEY vazia), que quem chama deve tratar caindo pro contato
 * manual em vez de mostrar um erro cru pro usuário.
 */
export async function createCheckoutSession(accessToken: string): Promise<string> {
  const res = await fetch(`${PLANEJADOR_API_URL}/api/v1/billing/checkout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, body.detail ?? "Não foi possível iniciar a assinatura agora");
  }

  const { checkout_url } = await res.json();
  return checkout_url;
}

/**
 * Lê os extratos enviados via IA (POST /api/v1/extraction/statement) e
 * devolve os ativos encontrados -- substitui o antigo mockExtractAssets.
 * Nunca inventa dado: extrato sem ativo identificável volta como lista
 * vazia, não como erro.
 */
export async function extractStatements(files: UploadedFile[]): Promise<ExtractedAsset[]> {
  const formData = new FormData();
  for (const f of files) formData.append("files", f.file, f.file.name);
  formData.append("institution_hints", JSON.stringify(files.map((f) => f.institutionGuess || "")));

  const res = await fetch(`${PLANEJADOR_API_URL}/api/v1/extraction/statement`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, body.detail ?? "Não conseguimos ler os extratos agora");
  }

  const extracted: Omit<ExtractedAsset, "id">[] = await res.json();
  return extracted.map((asset, i) => ({ ...asset, id: `extracted-${i}-${Date.now()}` }));
}

/**
 * Login pra quem já tem conta (voltando pra ver "Minha evolução"). O Aligna
 * não guarda sessão em servidor nenhum -- quem chama isso decide onde
 * persistir os tokens (localStorage, ver lib/session.ts).
 */
export async function login(email: string, password: string): Promise<IntakeTokens> {
  const res = await fetch(`${PLANEJADOR_API_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, body.detail ?? "Não conseguimos entrar com esse e-mail e senha");
  }

  return res.json();
}

/** access_token dura só 30 min -- usa o refresh_token (7 dias) pra renovar
 * sem pedir senha de novo toda vez que a pessoa volta. */
export async function refreshTokens(refreshToken: string): Promise<IntakeTokens> {
  const res = await fetch(`${PLANEJADOR_API_URL}/api/v1/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!res.ok) throw new ApiError(res.status, "Sessão expirada");
  return res.json();
}

/** Grava o diagnóstico atual como um ponto no histórico -- sempre grátis,
 * só exige estar logado. Chamado depois de todo diagnóstico concluído. */
export async function saveScoreSnapshot(
  accessToken: string,
  payload: { score_total: number; breakdown: Record<string, number>; patrimonio_total: number; risk_profile: string }
): Promise<void> {
  const res = await fetch(`${PLANEJADOR_API_URL}/api/v1/score-history`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, body.detail ?? "Não conseguimos salvar esse diagnóstico no seu histórico");
  }
}

/** Lista o histórico completo -- exige assinatura ativa (402 se não tiver). */
export async function getScoreHistory(accessToken: string): Promise<ScoreSnapshot[]> {
  const res = await fetch(`${PLANEJADOR_API_URL}/api/v1/score-history`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, body.detail ?? "Não conseguimos carregar seu histórico agora");
  }
  return res.json();
}
