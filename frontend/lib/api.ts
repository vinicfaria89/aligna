import { ExtractedAsset, PerfilData, RiskProfile, UploadedFile } from "./types";

// URL do backend do Planejador Financeiro -- é ele quem de fato recebe o
// intake (ver POST /api/v1/intake/lastro, já construído e testado do lado
// de lá). O Lastro não tem banco de dados próprio: é um funil sem estado
// persistente até este último passo.
const PLANEJADOR_API_URL = process.env.NEXT_PUBLIC_PLANEJADOR_API_URL ?? "http://localhost:8000";

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
  const res = await fetch(`${PLANEJADOR_API_URL}/api/v1/intake/lastro`, {
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
