import { macroClass } from "./labels";
import { ExtractedAsset, RiskProfile } from "./types";

export interface ClassSlice {
  label: string;
  value: number;
  pct: number;
}

export interface ReportAlert {
  severity: "alto" | "medio" | "info";
  title: string;
  body: string;
}

export interface AdequacyReport {
  totalValue: number;
  byClass: ClassSlice[];
  topConcentration: { label: string; pct: number } | null;
  alerts: ReportAlert[];
}

/**
 * Motor de análise, rodando 100% no navegador sobre os ativos confirmados
 * pelo usuário. Nada aqui recomenda comprar/vender/manter -- só descreve a
 * carteira (concentração, classes) e compara com o perfil declarado, no
 * mesmo espírito informativo desenhado para o relatório (Resolução CVM
 * 19/2021: orientação individualizada exige consultor registrado).
 */
export function buildReport(assets: ExtractedAsset[], riskProfile: RiskProfile): AdequacyReport {
  const totalValue = assets.reduce((sum, a) => sum + a.value, 0);

  const byClassMap = new Map<string, number>();
  for (const a of assets) {
    const cls = macroClass(a.category);
    byClassMap.set(cls, (byClassMap.get(cls) ?? 0) + a.value);
  }
  const byClass: ClassSlice[] = Array.from(byClassMap.entries())
    .map(([label, value]) => ({ label, value, pct: totalValue > 0 ? (value / totalValue) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);

  const byInstitution = new Map<string, number>();
  for (const a of assets) {
    const key = a.institution || "Instituição não informada";
    byInstitution.set(key, (byInstitution.get(key) ?? 0) + a.value);
  }
  const topInstitution = Array.from(byInstitution.entries()).sort((a, b) => b[1] - a[1])[0];
  const topConcentration =
    topInstitution && totalValue > 0 ? { label: topInstitution[0], pct: (topInstitution[1] / totalValue) * 100 } : null;

  const alerts: ReportAlert[] = [];

  if (topConcentration && topConcentration.pct >= 30) {
    alerts.push({
      severity: "alto",
      title: "Concentração elevada num único emissor",
      body: `${topConcentration.pct.toFixed(1)}% do que você enviou está numa única instituição (${topConcentration.label}) — isso é risco de evento único, independente do seu perfil de risco.`,
    });
  }

  const rendaFixaPrivada = byClass.find((c) => c.label === "Renda fixa privada");
  if (rendaFixaPrivada && rendaFixaPrivada.pct >= 40) {
    alerts.push({
      severity: "medio",
      title: "Concentração alta em renda fixa privada",
      body: `${rendaFixaPrivada.pct.toFixed(1)}% da carteira está em renda fixa privada — vale conferir se isso está diversificado entre emissores diferentes, não só entre produtos diferentes.`,
    });
  }

  const semVerificar = assets.filter((a) => a.confidence === "verificar");
  if (semVerificar.length > 0) {
    alerts.push({
      severity: "info",
      title: "Alguns ativos precisam de conferência",
      body: `${semVerificar.length} ativo(s) foram lidos com menos confiança pela IA — revise os valores antes de considerar o relatório definitivo.`,
    });
  }

  if (alerts.length === 0 && assets.length > 0) {
    alerts.push({
      severity: "info",
      title: "Nenhuma concentração fora do comum encontrada",
      body: "Com os dados enviados, não identificamos concentração acima dos limiares que costumamos sinalizar. Isso não substitui uma análise com um especialista.",
    });
  }

  return { totalValue, byClass, topConcentration, alerts };
}

export interface ScoreCriterion {
  label: string;
  score: number;
  weight: number;
  detail: string;
}

export interface LastroScore {
  total: number;
  criteria: ScoreCriterion[];
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

// Faixa de renda variável (ações, BDR, ETF, FII) considerada esperada para
// cada perfil declarado -- fora da faixa não significa "errado", só reduz o
// score de aderência. Não é recomendação de alocação, é comparação com o que
// o próprio cliente declarou como tolerância.
const RENDA_VARIAVEL_RANGE: Record<RiskProfile, [number, number]> = {
  conservador: [0, 15],
  moderado: [10, 40],
  arrojado: [25, 70],
};

/**
 * Score Lastro v0 -- decisão do Conselho de cortar de 10 critérios (documento
 * estratégico original) para 4: concentração, diversificação, liquidez e
 * aderência ao perfil. São os únicos que dá pra calcular hoje com o que o
 * cliente já enviou, sem pedir mais nenhum dado. Nunca aponta pra um ativo
 * específico -- só descreve a carteira como um todo.
 */
export function computeScore(assets: ExtractedAsset[], riskProfile: RiskProfile, report: AdequacyReport): LastroScore {
  const total = report.totalValue;

  const concPct = report.topConcentration?.pct ?? 0;
  const concentracaoScore = clamp(100 - concPct * 2, 0, 100);

  const hhi = report.byClass.reduce((sum, c) => sum + Math.pow(c.pct / 100, 2), 0);
  const diversificacaoScore = clamp(100 - hhi * 100, 0, 100);

  const liquidValue = assets
    .filter((a) => a.liquidity === "diaria" || a.liquidity === "ate_30_dias")
    .reduce((sum, a) => sum + a.value, 0);
  const liquidPct = total > 0 ? (liquidValue / total) * 100 : 0;
  const liquidezScore = clamp((liquidPct / 15) * 100, 0, 100);

  const variavelPct = report.byClass.find((c) => c.label === "Renda variável")?.pct ?? 0;
  const [min, max] = RENDA_VARIAVEL_RANGE[riskProfile];
  const distFromRange = variavelPct < min ? min - variavelPct : variavelPct > max ? variavelPct - max : 0;
  const aderenciaScore = clamp(100 - distFromRange * 3, 0, 100);

  const criteria: ScoreCriterion[] = [
    {
      label: "Concentração",
      score: Math.round(concentracaoScore),
      weight: 0.3,
      detail: `Maior concentração: ${concPct.toFixed(1)}% num único emissor.`,
    },
    {
      label: "Diversificação",
      score: Math.round(diversificacaoScore),
      weight: 0.25,
      detail: `${report.byClass.length} classe(s) de ativo identificada(s).`,
    },
    {
      label: "Liquidez",
      score: Math.round(liquidezScore),
      weight: 0.25,
      detail: `${liquidPct.toFixed(1)}% do patrimônio resgatável em até 30 dias.`,
    },
    {
      label: "Aderência ao perfil",
      score: Math.round(aderenciaScore),
      weight: 0.2,
      detail: `${variavelPct.toFixed(1)}% em renda variável — perfil ${riskProfile} costuma ficar entre ${min}% e ${max}%.`,
    },
  ];

  const totalScore = criteria.reduce((sum, c) => sum + c.score * c.weight, 0);
  return { total: Math.round(totalScore), criteria };
}

export interface Benchmark {
  nome: string;
  valor: string;
  fonte: string;
}

// Referência estática por enquanto -- próximo passo natural é buscar isso
// ao vivo na API do BACEN (SGS 432/12/433), como já mapeamos: ver a
// conversa sobre fontes oficiais. Marcado aqui pra não virar um "dado real"
// escondido atrás de uma UI que parece ao vivo.
export const STATIC_BENCHMARKS: Benchmark[] = [
  { nome: "Selic (meta)", valor: "14,00% a.a.", fonte: "BACEN — SGS 432" },
  { nome: "CDI", valor: "13,90% a.a.", fonte: "BACEN — SGS 12" },
  { nome: "IPCA (12 meses)", valor: "4,22%", fonte: "IBGE / BACEN — SGS 433" },
];
