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
 * Volatilidade anual (desvio-padrão do retorno) por categoria de ativo --
 * estimativas de mercado de longo prazo pro contexto brasileiro, mesmo
 * espírito ilustrativo de CATEGORY_REAL_RETURN. Usada só pra traduzir risco
 * em uma faixa de valores em reais (padrão Nitrogen/Riskalyze: "há X% de
 * chance de sua carteira ficar entre R$A e R$B em 6 meses" em vez de só um
 * percentual abstrato). A média ponderada por ativo, sem matriz de
 * correlação entre eles, SUPERESTIMA o risco real de uma carteira
 * diversificada (ignora o benefício de diversificação) -- erra pro lado
 * conservador de propósito, nunca promete mais segurança do que a estimativa
 * suporta.
 */
const CATEGORY_VOLATILITY: Record<AssetCategory, number> = {
  conta_corrente: 0,
  poupanca: 0.01,
  tesouro: 0.08,
  cdb: 0.02,
  lci: 0.02,
  lca: 0.02,
  debenture: 0.08,
  cri: 0.08,
  cra: 0.08,
  fundos: 0.1,
  etf: 0.15,
  acoes: 0.28,
  bdr: 0.22,
  previdencia_pgbl: 0.08,
  previdencia_vgbl: 0.08,
  fii: 0.18,
  criptoativos: 0.65,
  participacoes: 0.3,
  imoveis: 0.1,
  veiculos: 0.05,
  empresas: 0.35,
  obras_de_arte: 0.15,
  ouro: 0.15,
  joias: 0.1,
  bens_diversos: 0.1,
  outros: 0.1,
};

// Z-score de uma distribuição normal pro intervalo central de 90% (5º ao
// 95º percentil) -- mesma janela de confiança que a Nitrogen usa pra
// calcular a faixa de resultado da carteira em 6 meses.
const Z_90 = 1.645;

export interface RiskRange {
  volatility: number;
  lowPct: number;
  highPct: number;
  lowValue: number;
  highValue: number;
}

/**
 * Faixa de resultado da carteira em 6 meses, com 90% de confiança (padrão
 * Nitrogen/Riskalyze) -- estimativa ilustrativa, não garantia nem
 * recomendação de alocação (Resolução CVM 19/2021). Retorna null sem
 * patrimônio pra calcular.
 */
export function buildRiskRange(assets: ExtractedAsset[], blendedRate: number): RiskRange | null {
  const totalValue = assets.reduce((sum, a) => sum + a.value, 0);
  if (totalValue <= 0) return null;

  const annualVolatility = assets.reduce(
    (sum, a) => sum + (CATEGORY_VOLATILITY[a.category] ?? 0.1) * (a.value / totalValue),
    0
  );

  const sixMonthReturn = Math.pow(1 + blendedRate, 0.5) - 1;
  const sixMonthVolatility = annualVolatility * Math.sqrt(0.5);

  const lowPct = Math.max(sixMonthReturn - Z_90 * sixMonthVolatility, -1);
  const highPct = sixMonthReturn + Z_90 * sixMonthVolatility;

  return {
    volatility: annualVolatility,
    lowPct,
    highPct,
    lowValue: totalValue * (1 + lowPct),
    highValue: totalValue * (1 + highPct),
  };
}

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

// Valor futuro de uma série de aportes mensais (anuidade ordinária),
// compondo à taxa mensal equivalente à taxa real anual informada -- mesma
// conversão anual->mensal usada no motor do Planejador Financeiro (Termos e
// Conceitos do relatório completo: taxa mensal efetiva, nunca a taxa anual
// dividida por 12).
function contributionFutureValue(monthlyContribution: number, annualRate: number, months: number): number {
  if (monthlyContribution <= 0 || months <= 0) return 0;
  const monthlyRate = Math.pow(1 + annualRate, 1 / 12) - 1;
  if (Math.abs(monthlyRate) < 1e-9) return monthlyContribution * months;
  return monthlyContribution * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate);
}

/**
 * Projeta o patrimônio total em juros compostos reais, comparando a taxa
 * média ponderada da alocação atual do cliente com a taxa de referência do
 * perfil declarado -- 100% client-side, sem custo de API. `monthlyContribution`
 * é o "e se" interativo (padrão Wealthfront Path): aplicado igualmente às
 * duas linhas, pra a diferença entre elas continuar refletindo só a
 * alocação, nunca o aporte. Retorna null sem patrimônio pra projetar.
 */
export function buildProjection(
  assets: ExtractedAsset[],
  riskProfile: RiskProfile,
  horizonYears = 20,
  monthlyContribution = 0
): Projection | null {
  const totalValue = assets.reduce((sum, a) => sum + a.value, 0);
  if (totalValue <= 0) return null;

  const blendedRate = assets.reduce(
    (sum, a) => sum + (CATEGORY_REAL_RETURN[a.category] ?? 0) * (a.value / totalValue),
    0
  );
  const profileRate = PROFILE_REAL_RETURN[riskProfile];

  const points: ProjectionPoint[] = [];
  for (let y = 0; y <= horizonYears; y++) {
    const months = y * 12;
    points.push({
      year: y,
      atual: totalValue * Math.pow(1 + blendedRate, y) + contributionFutureValue(monthlyContribution, blendedRate, months),
      referencia:
        totalValue * Math.pow(1 + profileRate, y) + contributionFutureValue(monthlyContribution, profileRate, months),
    });
  }

  const last = points[points.length - 1];
  return { points, blendedRate, profileRate, horizonYears, gapAtHorizon: last.referencia - last.atual };
}
