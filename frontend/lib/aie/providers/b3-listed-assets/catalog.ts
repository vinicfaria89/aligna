import type { CandidateAssetType } from "../../contracts";

export interface B3ListedAssetEntry {
  /** Exact ticker, already normalized (trim + uppercase). Unique lookup key. */
  ticker: string;

  assetType: CandidateAssetType;

  /** Stable canonical id for `identity` evidence -- never the ticker alone. */
  canonicalAssetId: string;

  legalName: string;

  /** Stable id for `issuer` evidence. */
  issuerEntityId: string;

  issuerName: string;
}

/**
 * TASK-051B: local, explicit, controlled catalog -- NOT a promise of full B3
 * coverage. It covers exactly the listed-asset fixtures from the TASK-051A
 * diagnostic (lib/aie/diagnostics/portfolio-resolution-quality.fixtures.ts)
 * that fit a `primary` evidence source today: stocks, FIIs, ETFs and the one
 * BDR in that battery. Nothing about Tesouro Direto (no CandidateAssetType
 * fits it yet) or generic fixed income (no ticker/official code to key on)
 * belongs here.
 *
 * Every entry is public, low-churn data (which company/manager a ticker
 * refers to on the B3) -- never a quote, a price or anything needing live
 * updates. Growing this catalog is a deliberate product decision each time,
 * not something to expand silently inside this file.
 */
export const B3_LISTED_ASSETS: readonly B3ListedAssetEntry[] = [
  {
    ticker: "PETR4",
    assetType: "stock",
    canonicalAssetId: "b3:PETR4",
    legalName: "Petróleo Brasileiro S.A. - Petrobras",
    issuerEntityId: "company.petrobras",
    issuerName: "Petróleo Brasileiro S.A. - Petrobras",
  },
  {
    ticker: "VALE3",
    assetType: "stock",
    canonicalAssetId: "b3:VALE3",
    legalName: "Vale S.A.",
    issuerEntityId: "company.vale",
    issuerName: "Vale S.A.",
  },
  {
    ticker: "ITUB4",
    assetType: "stock",
    canonicalAssetId: "b3:ITUB4",
    legalName: "Itaú Unibanco Holding S.A.",
    issuerEntityId: "company.itau-unibanco",
    issuerName: "Itaú Unibanco Holding S.A.",
  },
  {
    ticker: "HGLG11",
    assetType: "fii",
    canonicalAssetId: "b3:HGLG11",
    legalName: "CSHG Logística Fundo de Investimento Imobiliário",
    issuerEntityId: "fund.cshg-logistica",
    issuerName: "CSHG (Credit Suisse Hedging-Griffo)",
  },
  {
    ticker: "KNRI11",
    assetType: "fii",
    canonicalAssetId: "b3:KNRI11",
    legalName: "Kinea Renda Imobiliária Fundo de Investimento Imobiliário",
    issuerEntityId: "fund.kinea-renda-imobiliaria",
    issuerName: "Kinea Investimentos",
  },
  {
    ticker: "BOVA11",
    assetType: "etf",
    canonicalAssetId: "b3:BOVA11",
    legalName: "iShares Ibovespa Fundo de Índice",
    issuerEntityId: "fund.ishares-bova11",
    issuerName: "BlackRock",
  },
  {
    ticker: "IVVB11",
    assetType: "etf",
    canonicalAssetId: "b3:IVVB11",
    legalName: "iShares S&P 500 Fundo de Índice",
    issuerEntityId: "fund.ishares-ivvb11",
    issuerName: "BlackRock",
  },
  {
    ticker: "AAPL34",
    assetType: "international",
    canonicalAssetId: "b3:AAPL34",
    legalName: "Apple Inc. (BDR)",
    issuerEntityId: "company.apple",
    issuerName: "Apple Inc.",
  },
];
