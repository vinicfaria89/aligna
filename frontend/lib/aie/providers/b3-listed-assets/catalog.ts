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
 * coverage. It started with exactly the listed-asset fixtures from the
 * TASK-051A diagnostic (lib/aie/diagnostics/portfolio-resolution-quality.
 * fixtures.ts): stocks, FIIs, ETFs and one BDR. Nothing about Tesouro
 * Direto (no CandidateAssetType fits it yet) or generic fixed income (no
 * ticker/official code to key on) belongs here.
 *
 * TASK-052: expanded to a broader, still curated set of common/liquid B3
 * assets. Every entry stays explicit and hand-verified the same way as the
 * original 8 -- `issuerName` is only ever the company's/manager's legal
 * name as publicly known, never guessed; an asset whose issuer wasn't
 * confidently known was left out rather than filled in approximately (see
 * the TASK-052 report for the exact list considered and excluded).
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

  // --- TASK-052: ações --------------------------------------------------------------------
  {
    ticker: "ABEV3",
    assetType: "stock",
    canonicalAssetId: "b3:ABEV3",
    legalName: "Ambev S.A.",
    issuerEntityId: "company.ambev",
    issuerName: "Ambev S.A.",
  },
  {
    ticker: "B3SA3",
    assetType: "stock",
    canonicalAssetId: "b3:B3SA3",
    legalName: "B3 S.A. - Brasil, Bolsa, Balcão",
    issuerEntityId: "company.b3",
    issuerName: "B3 S.A. - Brasil, Bolsa, Balcão",
  },
  {
    ticker: "BBAS3",
    assetType: "stock",
    canonicalAssetId: "b3:BBAS3",
    legalName: "Banco do Brasil S.A.",
    issuerEntityId: "company.banco-do-brasil",
    issuerName: "Banco do Brasil S.A.",
  },
  {
    ticker: "BBDC4",
    assetType: "stock",
    canonicalAssetId: "b3:BBDC4",
    legalName: "Banco Bradesco S.A.",
    issuerEntityId: "company.bradesco",
    issuerName: "Banco Bradesco S.A.",
  },
  {
    ticker: "BPAC11",
    assetType: "stock",
    canonicalAssetId: "b3:BPAC11",
    legalName: "Banco BTG Pactual S.A.",
    issuerEntityId: "company.btg-pactual",
    issuerName: "Banco BTG Pactual S.A.",
  },
  {
    ticker: "CMIG4",
    assetType: "stock",
    canonicalAssetId: "b3:CMIG4",
    legalName: "Companhia Energética de Minas Gerais - Cemig",
    issuerEntityId: "company.cemig",
    issuerName: "Companhia Energética de Minas Gerais - Cemig",
  },
  {
    ticker: "ELET3",
    assetType: "stock",
    canonicalAssetId: "b3:ELET3",
    legalName: "Centrais Elétricas Brasileiras S.A. - Eletrobras",
    issuerEntityId: "company.eletrobras",
    issuerName: "Centrais Elétricas Brasileiras S.A. - Eletrobras",
  },
  {
    ticker: "EMBR3",
    assetType: "stock",
    canonicalAssetId: "b3:EMBR3",
    legalName: "Embraer S.A.",
    issuerEntityId: "company.embraer",
    issuerName: "Embraer S.A.",
  },
  {
    ticker: "GGBR4",
    assetType: "stock",
    canonicalAssetId: "b3:GGBR4",
    legalName: "Gerdau S.A.",
    issuerEntityId: "company.gerdau",
    issuerName: "Gerdau S.A.",
  },
  {
    ticker: "LREN3",
    assetType: "stock",
    canonicalAssetId: "b3:LREN3",
    legalName: "Lojas Renner S.A.",
    issuerEntityId: "company.lojas-renner",
    issuerName: "Lojas Renner S.A.",
  },
  {
    ticker: "RENT3",
    assetType: "stock",
    canonicalAssetId: "b3:RENT3",
    legalName: "Localiza Rent a Car S.A.",
    issuerEntityId: "company.localiza",
    issuerName: "Localiza Rent a Car S.A.",
  },
  {
    ticker: "WEGE3",
    assetType: "stock",
    canonicalAssetId: "b3:WEGE3",
    legalName: "WEG S.A.",
    issuerEntityId: "company.weg",
    issuerName: "WEG S.A.",
  },

  // --- TASK-052: FIIs -----------------------------------------------------------------------
  {
    ticker: "BTLG11",
    assetType: "fii",
    canonicalAssetId: "b3:BTLG11",
    legalName: "BTG Pactual Logística Fundo de Investimento Imobiliário",
    issuerEntityId: "fund.btg-pactual-logistica",
    issuerName: "BTG Pactual",
  },
  {
    ticker: "MXRF11",
    assetType: "fii",
    canonicalAssetId: "b3:MXRF11",
    legalName: "Maxi Renda Fundo de Investimento Imobiliário",
    issuerEntityId: "fund.maxi-renda",
    issuerName: "XP Asset Management",
  },
  {
    ticker: "XPML11",
    assetType: "fii",
    canonicalAssetId: "b3:XPML11",
    legalName: "XP Malls Fundo de Investimento Imobiliário",
    issuerEntityId: "fund.xp-malls",
    issuerName: "XP Asset Management",
  },
  {
    ticker: "VISC11",
    assetType: "fii",
    canonicalAssetId: "b3:VISC11",
    legalName: "Vinci Shopping Centers Fundo de Investimento Imobiliário",
    issuerEntityId: "fund.vinci-shopping-centers",
    issuerName: "Vinci Partners",
  },
  {
    ticker: "KNCR11",
    assetType: "fii",
    canonicalAssetId: "b3:KNCR11",
    legalName: "Kinea Rendimentos Imobiliários Fundo de Investimento Imobiliário",
    issuerEntityId: "fund.kinea-rendimentos-imobiliarios",
    issuerName: "Kinea Investimentos",
  },
  {
    ticker: "XPLG11",
    assetType: "fii",
    canonicalAssetId: "b3:XPLG11",
    legalName: "XP Log Fundo de Investimento Imobiliário",
    issuerEntityId: "fund.xp-log",
    issuerName: "XP Asset Management",
  },

  // --- TASK-052: ETFs ------------------------------------------------------------------------
  {
    ticker: "SMAL11",
    assetType: "etf",
    canonicalAssetId: "b3:SMAL11",
    legalName: "iShares BM&FBOVESPA Small Cap Fundo de Índice",
    issuerEntityId: "fund.ishares-smal11",
    issuerName: "BlackRock",
  },
  {
    ticker: "HASH11",
    assetType: "etf",
    canonicalAssetId: "b3:HASH11",
    legalName: "Hashdex Nasdaq Crypto Index Fundo de Índice",
    issuerEntityId: "fund.hashdex-nasdaq-crypto-index",
    issuerName: "Hashdex",
  },
  {
    ticker: "GOLD11",
    assetType: "etf",
    canonicalAssetId: "b3:GOLD11",
    legalName: "Trend Ouro Fundo de Índice",
    issuerEntityId: "fund.trend-ouro",
    issuerName: "Trend DTVM",
  },
  {
    ticker: "DIVO11",
    assetType: "etf",
    canonicalAssetId: "b3:DIVO11",
    legalName: "It Now IDIV Fundo de Índice",
    issuerEntityId: "fund.it-now-idiv",
    issuerName: "Itaú Asset Management",
  },

  // --- TASK-052: BDRs / internacional ---------------------------------------------------------
  {
    ticker: "MSFT34",
    assetType: "international",
    canonicalAssetId: "b3:MSFT34",
    legalName: "Microsoft Corporation (BDR)",
    issuerEntityId: "company.microsoft",
    issuerName: "Microsoft Corporation",
  },
  {
    ticker: "GOGL34",
    assetType: "international",
    canonicalAssetId: "b3:GOGL34",
    legalName: "Alphabet Inc. (BDR)",
    issuerEntityId: "company.alphabet",
    issuerName: "Alphabet Inc.",
  },
  {
    ticker: "AMZO34",
    assetType: "international",
    canonicalAssetId: "b3:AMZO34",
    legalName: "Amazon.com, Inc. (BDR)",
    issuerEntityId: "company.amazon",
    issuerName: "Amazon.com, Inc.",
  },
  {
    ticker: "TSLA34",
    assetType: "international",
    canonicalAssetId: "b3:TSLA34",
    legalName: "Tesla, Inc. (BDR)",
    issuerEntityId: "company.tesla",
    issuerName: "Tesla, Inc.",
  },
  {
    ticker: "NFLX34",
    assetType: "international",
    canonicalAssetId: "b3:NFLX34",
    legalName: "Netflix, Inc. (BDR)",
    issuerEntityId: "company.netflix",
    issuerName: "Netflix, Inc.",
  },
];
