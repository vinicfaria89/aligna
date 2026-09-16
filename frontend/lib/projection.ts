import { AssetCategory, ExtractedAsset, RiskProfile } from "./types";

/**
 * Retorno real (acima do IPCA) de longo prazo por categoria de ativo --
 * estimativas de mercado de longo prazo, não garantia nem recomendação
 * individualizada (CVM 19/2021). Usadas só pra estimar a taxa média
 * ponderada da alocação ATUAL do cliente, em contraste com a taxa de
 * referência do perfil (ver PROFILE_REAL_RETURN).
 */
const CATEGORY_REAL_RETURN: Record<AssetCategory, number> = {
  conta_corrente: 0,
  poupanca: 0.005,
  tesouro: 0.06,
  cdb: 0.065,
  lci: 0.06,
  lca: 0.06,
  debenture: 0.07,
  cri: 0.07,
  cra: 0.07,
  fundos: 0.055,
  etf: 0.07,
  acoes: 0.09,
  bdr: 0.08,
  previdencia_pgbl: 0.05,
  previdencia_vgbl: 0.05,
  fii: 0.06,
  criptoativos: 0.09,
  participacoes: 0.08,
  imoveis: 0.02,
  veiculos: -0.03,
  empresas: 0.08,
  obras_de_arte: 0.01,
  ouro: 0.01,
  joias: 0,
  bens_diversos: 0,
  outros: 0.02,
};

/**
 * Retorno real esperado por perfil -- mesma referência usada no motor do
 * Planejador Financeiro (ver backend/app/core/config.py DEFAULT_RETURN_*).
 * Representa a taxa de uma alocação bem distribuída pro perfil declarado,
 * não a carteira específica do cliente.
 */
const PROFILE_REAL_RETURN: Record<RiskProfile, number> = {
  conservador: 0.03,
  moderado: 0.0569,
  arrojado: 0.08,
};

export interface ProjectionPoint {
  year: number;
  atual: number;
  referencia: number;
}

export interface Projection {
  points: ProjectionPoint[];
  blendedRate: number;
  profileRate: number;
  horizonYears: number;
  gapAtHorizon: number;
}

/**
 * Projeta o patrimônio total em juros compostos reais, comparando a taxa
 * média ponderada da alocação atual do cliente com a taxa de referência do
 * perfil declarado -- 100% client-side, sem custo de API. Retorna null sem
 * patrimônio pra projetar.
 */
export function buildProjection(assets: ExtractedAsset[], riskProfile: RiskProfile, horizonYears = 20): Projection | null {
  const totalValue = assets.reduce((sum, a) => sum + a.value, 0);
  if (totalValue <= 0) return null;

  const blendedRate = assets.reduce(
    (sum, a) => sum + (CATEGORY_REAL_RETURN[a.category] ?? 0) * (a.value / totalValue),
    0
  );
  const profileRate = PROFILE_REAL_RETURN[riskProfile];

  const points: ProjectionPoint[] = [];
  for (let y = 0; y <= horizonYears; y++) {
    points.push({
      year: y,
      atual: totalValue * Math.pow(1 + blendedRate, y),
      referencia: totalValue * Math.pow(1 + profileRate, y),
    });
  }

  const last = points[points.length - 1];
  return { points, blendedRate, profileRate, horizonYears, gapAtHorizon: last.referencia - last.atual };
}
