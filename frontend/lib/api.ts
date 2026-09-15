import { ExtractedAsset, PerfilData, RiskProfile } from "./types";

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
