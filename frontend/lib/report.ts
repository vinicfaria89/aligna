import { macroClass } from "./labels";
import { ExtractedAsset, RiskProfile } from "./types";

export type RiskCapacity = "baixa" | "media" | "alta";

// Modelo dos "3 números" da Nitrogen/Riskalyze -- tolerância declarada
// (RiskProfile, já calculado a partir de toleranceAnswer) e capacidade
// financeira de arcar com risco (horizonAnswer, coletado no PerfilStep mas
// até agora nunca usado em lugar nenhum) são coisas DIFERENTES: tolerância é
// conforto emocional, capacidade é o que o horizonte de tempo permite
// absorver sem precisar vender na baixa. Mesma escala 0/1/2 de
// riskProfileFromAnswers, só que sobre a resposta de horizonte.
export function riskCapacityFromAnswers(horizonAnswer: number | null): RiskCapacity {
  if (horizonAnswer === 2) return "alta";
  if (horizonAnswer === 0) return "baixa";
  return "media";
}

export const RISK_CAPACITY_LABELS: Record<RiskCapacity, string> = { baixa: "Baixa", media: "Média", alta: "Alta" };

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

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Motor de análise, rodando 100% no navegador sobre os ativos confirmados
 * pelo usuário. Nada aqui recomenda comprar/vender/manter -- só descreve a
 * carteira (concentração, classes) e compara com o perfil declarado, no
 * mesmo espírito informativo desenhado para o relatório (Resolução CVM
 * 19/2021: orientação individualizada exige consultor registrado).
 */
export function buildReport(assets: ExtractedAsset[], riskProfile: RiskProfile, horizonAnswer: number | null = null): AdequacyReport {
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

  // Empower's "Investment Checkup" sinaliza caixa parado ("cash drag") como
  // um dos achados mais acionáveis do relatório deles -- conta corrente e
  // poupança rendem perto de zero, bem abaixo da inflação.
  const caixaOcioso = assets
    .filter((a) => a.category === "conta_corrente" || a.category === "poupanca")
    .reduce((sum, a) => sum + a.value, 0);
  const caixaOciosoPct = totalValue > 0 ? (caixaOcioso / totalValue) * 100 : 0;
  if (caixaOciosoPct >= 15) {
    alerts.push({
      severity: caixaOciosoPct >= 30 ? "alto" : "medio",
      title: "Dinheiro parado em conta corrente ou poupança",
      body: `${caixaOciosoPct.toFixed(1)}% do patrimônio (${formatBRL(caixaOcioso)}) está em conta corrente ou poupança, rendendo bem abaixo da inflação — vale avaliar se você precisa mesmo de tanta liquidez imediata.`,
    });
  }

  // Tolerância (o que a pessoa disse aguentar emocionalmente) x capacidade
  // (o que o horizonte de tempo realmente permite absorver) -- quando
  // divergem bastante, é um achado tão relevante quanto concentração, mas
  // que nenhum critério do Score cobre sozinho.
  const riskCapacity = riskCapacityFromAnswers(horizonAnswer);
  if (riskProfile === "arrojado" && riskCapacity === "baixa") {
    alerts.push({
      severity: "alto",
      title: "Tolerância declarada acima da sua capacidade financeira",
      body: `Você disse tolerar risco alto, mas seu horizonte é curto (menos de 1 ano) — perdas de curto prazo têm menos tempo pra se recuperar do que sua tolerância sugere.`,
    });
  } else if (riskProfile === "conservador" && riskCapacity === "alta") {
    alerts.push({
      severity: "info",
      title: "Sua capacidade financeira é maior que sua tolerância declarada",
      body: `Seu horizonte é longo (mais de 3 anos), o que te daria margem pra tolerar mais oscilação do que você disse preferir — não é um erro, só uma folga que você tem e talvez não esteja usando.`,
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

export interface AlignaScore {
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

// Sucessão/governança vêm de respostas do questionário (PerfilStep), não dos
// ativos -- índice 0 é a melhor resposta, 2 a pior (mesma convenção das
// opções de cada pergunta).
function answerScore(answer: number | null): number {
  if (answer === null) return 50; // não deveria chegar aqui (PerfilStep exige resposta), mas nunca quebra o cálculo
  return clamp(100 - answer * 50, 0, 100);
}

/**
 * Score Aligna v1 -- decisão do Conselho de cortar de 10 critérios (documento
 * estratégico original) para 4 na v0: concentração, diversificação, liquidez
 * e aderência ao perfil, calculados a partir dos ativos. A v1 soma um 5º,
 * "Sucessão e governança", vindo das duas novas perguntas do PerfilStep --
 * não dá pra calcular a partir do extrato, é a única dimensão qualitativa do
 * Score. Nunca aponta pra um ativo específico -- só descreve a carteira e a
 * organização do patrimônio como um todo.
 */
export function computeScore(
  assets: ExtractedAsset[],
  riskProfile: RiskProfile,
  report: AdequacyReport,
  sucessaoAnswer: number | null,
  governancaAnswer: number | null
): AlignaScore {
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

  const sucessaoScore = answerScore(sucessaoAnswer);
  const governancaScore = answerScore(governancaAnswer);
  const sucessaoGovernancaScore = (sucessaoScore + governancaScore) / 2;

  const criteria: ScoreCriterion[] = [
    {
      label: "Concentração",
      score: Math.round(concentracaoScore),
      weight: 0.25,
      detail: `Maior concentração: ${concPct.toFixed(1)}% num único emissor.`,
    },
    {
      label: "Diversificação",
      score: Math.round(diversificacaoScore),
      weight: 0.2,
      detail: `${report.byClass.length} classe(s) de ativo identificada(s).`,
    },
    {
      label: "Liquidez",
      score: Math.round(liquidezScore),
      weight: 0.2,
      detail: `${liquidPct.toFixed(1)}% do patrimônio resgatável em até 30 dias.`,
    },
    {
      label: "Aderência ao perfil",
      score: Math.round(aderenciaScore),
      weight: 0.15,
      detail: `${variavelPct.toFixed(1)}% em renda variável — perfil ${riskProfile} costuma ficar entre ${min}% e ${max}%.`,
    },
    {
      label: "Sucessão e governança",
      score: Math.round(sucessaoGovernancaScore),
      weight: 0.2,
      detail:
        sucessaoScore < 100 || governancaScore < 100
          ? "Sua família ou sua carteira têm pontos de organização/documentação a melhorar."
          : "Patrimônio documentado e carteira com política de investimento definida.",
    },
  ];

  const totalScore = criteria.reduce((sum, c) => sum + c.score * c.weight, 0);
  return { total: Math.round(totalScore), criteria };
}

export interface Benchmark {
  nome: string;
  valor: string;
  fonte: string;
  // Taxa nominal em decimal (ex.: 0.14 = 14% a.a.) -- usada pra converter em
  // taxa real (equação de Fisher) e comparar direto com a projeção de
  // patrimônio, que já roda em termos reais (ver lib/projection.ts).
  nominal: number;
}

// Referência estática por enquanto -- próximo passo natural é buscar isso
// ao vivo na API do BACEN (SGS 432/12/433), como já mapeamos: ver a
// conversa sobre fontes oficiais. Marcado aqui pra não virar um "dado real"
// escondido atrás de uma UI que parece ao vivo.
export const STATIC_BENCHMARKS: Benchmark[] = [
  { nome: "Selic (meta)", valor: "14,00% a.a.", fonte: "BACEN — SGS 432", nominal: 0.14 },
  { nome: "CDI", valor: "13,90% a.a.", fonte: "BACEN — SGS 12", nominal: 0.139 },
  { nome: "IPCA (12 meses)", valor: "4,22%", fonte: "IBGE / BACEN — SGS 433", nominal: 0.0422 },
];

// Equação de Fisher exata (não a aproximação "nominal - inflação") -- mesma
// convenção usada no motor do Planejador Financeiro (ver Termos e Conceitos
// do relatório completo).
export function realRate(nominal: number, ipca: number): number {
  return (1 + nominal) / (1 + ipca) - 1;
}
