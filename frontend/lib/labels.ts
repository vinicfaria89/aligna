import { AssetCategory, Liquidity } from "./types";

export const CATEGORY_LABELS: Record<AssetCategory, string> = {
  conta_corrente: "Conta corrente",
  poupanca: "Poupança",
  tesouro: "Tesouro Direto",
  cdb: "CDB",
  lci: "LCI",
  lca: "LCA",
  debenture: "Debênture",
  cri: "CRI",
  cra: "CRA",
  fundos: "Fundo de investimento",
  etf: "ETF",
  acoes: "Ações",
  bdr: "BDR",
  previdencia_pgbl: "Previdência PGBL",
  previdencia_vgbl: "Previdência VGBL",
  fii: "FII",
  criptoativos: "Criptoativos",
  participacoes: "Participações",
  imoveis: "Imóveis",
  veiculos: "Veículos",
  empresas: "Empresas",
  obras_de_arte: "Obras de arte",
  ouro: "Ouro",
  joias: "Joias",
  bens_diversos: "Bens diversos",
  outros: "Outros",
};

export const LIQUIDITY_LABELS: Record<Liquidity, string> = {
  diaria: "Diária",
  ate_30_dias: "Até 30 dias",
  ate_1_ano: "Até 1 ano",
  no_vencimento: "No vencimento",
  baixa: "Baixa",
};

// Classe "macro" usada só na apresentação do relatório (agrupa as categorias
// finas do backend em algo que cabe numa legenda de gráfico).
export function macroClass(category: AssetCategory): string {
  switch (category) {
    case "tesouro":
      return "Renda fixa pública";
    case "cdb":
    case "lci":
    case "lca":
    case "debenture":
    case "cri":
    case "cra":
      return "Renda fixa privada";
    case "acoes":
    case "bdr":
    case "etf":
    case "fii":
      return "Renda variável";
    case "fundos":
    case "previdencia_pgbl":
    case "previdencia_vgbl":
      return "Fundos";
    default:
      return "Outros";
  }
}
