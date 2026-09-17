export type RiskProfile = "conservador" | "moderado" | "arrojado";

export type AssetCategory =
  | "conta_corrente"
  | "poupanca"
  | "tesouro"
  | "cdb"
  | "lci"
  | "lca"
  | "debenture"
  | "cri"
  | "cra"
  | "fundos"
  | "etf"
  | "acoes"
  | "bdr"
  | "previdencia_pgbl"
  | "previdencia_vgbl"
  | "fii"
  | "criptoativos"
  | "participacoes"
  | "imoveis"
  | "veiculos"
  | "empresas"
  | "obras_de_arte"
  | "ouro"
  | "joias"
  | "bens_diversos"
  | "outros";

export type Liquidity = "diaria" | "ate_30_dias" | "ate_1_ano" | "no_vencimento" | "baixa";

export interface UploadedFile {
  id: string;
  file: File;
  institutionGuess: string;
  status: "pronto" | "processando";
}

export interface ExtractedAsset {
  id: string;
  name: string;
  category: AssetCategory;
  value: number;
  institution: string;
  liquidity: Liquidity;
  indexer: string;
  maturity_date?: string;
  confidence: "ok" | "verificar";
}

export interface PerfilData {
  full_name: string;
  email: string;
  password: string;
  birth_date: string;
  toleranceAnswer: number | null;
  horizonAnswer: number | null;
  sucessaoAnswer: number | null;
  governancaAnswer: number | null;
}

export interface ScoreSnapshot {
  id: string;
  score_total: number;
  breakdown: Record<string, number>;
  patrimonio_total: number;
  risk_profile: string;
  created_at: string;
}

export function riskProfileFromAnswers(toleranceAnswer: number | null): RiskProfile {
  if (toleranceAnswer === 2) return "arrojado";
  if (toleranceAnswer === 0) return "conservador";
  return "moderado";
}
