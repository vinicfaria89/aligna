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
 * TASK-064A: second expansion wave, same rule. Of the 29 tickers requested,
 * 3 (HGLG11, IVVB11, AAPL34) were already catalogued from the original 8 --
 * deliberately NOT duplicated (this catalog is a `ticker -> entry` map in
 * ./infer-asset-type.ts; a duplicate key would either be silently harmless
 * or, worse, silently mask a data mismatch), so only 26 genuinely new
 * entries were added (35 -> 61).
 *
 * TASK-064B: third expansion wave, same rule. Of the 29 tickers requested,
 * 1 (BOVA11) was already catalogued from the original 8 -- not duplicated,
 * for the same reason; 28 genuinely new entries were added (61 -> 89), plus
 * 4 more stocks (JBSS3, PRIO3, SUZB3, NTCO3) requested afterward to round
 * the wave out to 93 (89 -> 93).
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

  // --- TASK-064A: ações (segunda onda) -----------------------------------------------------
  {
    ticker: "ALOS3",
    assetType: "stock",
    canonicalAssetId: "b3:ALOS3",
    legalName: "Allos S.A.",
    issuerEntityId: "company.allos",
    issuerName: "Allos S.A.",
  },
  {
    ticker: "ARZZ3",
    assetType: "stock",
    canonicalAssetId: "b3:ARZZ3",
    legalName: "Arezzo Indústria e Comércio S.A.",
    issuerEntityId: "company.arezzo",
    issuerName: "Arezzo Indústria e Comércio S.A.",
  },
  {
    ticker: "ASAI3",
    assetType: "stock",
    canonicalAssetId: "b3:ASAI3",
    legalName: "Sendas Distribuidora S.A.",
    issuerEntityId: "company.assai",
    issuerName: "Sendas Distribuidora S.A.",
  },
  {
    ticker: "CSAN3",
    assetType: "stock",
    canonicalAssetId: "b3:CSAN3",
    legalName: "Cosan S.A.",
    issuerEntityId: "company.cosan",
    issuerName: "Cosan S.A.",
  },
  {
    ticker: "CYRE3",
    assetType: "stock",
    canonicalAssetId: "b3:CYRE3",
    legalName: "Cyrela Brazil Realty S.A. Empreendimentos e Participações",
    issuerEntityId: "company.cyrela",
    issuerName: "Cyrela Brazil Realty S.A. Empreendimentos e Participações",
  },
  {
    ticker: "EGIE3",
    assetType: "stock",
    canonicalAssetId: "b3:EGIE3",
    legalName: "Engie Brasil Energia S.A.",
    issuerEntityId: "company.engie-brasil",
    issuerName: "Engie Brasil Energia S.A.",
  },
  {
    ticker: "EZTC3",
    assetType: "stock",
    canonicalAssetId: "b3:EZTC3",
    legalName: "EZTEC Empreendimentos e Participações S.A.",
    issuerEntityId: "company.eztec",
    issuerName: "EZTEC Empreendimentos e Participações S.A.",
  },
  {
    ticker: "FLRY3",
    assetType: "stock",
    canonicalAssetId: "b3:FLRY3",
    legalName: "Fleury S.A.",
    issuerEntityId: "company.fleury",
    issuerName: "Fleury S.A.",
  },
  {
    ticker: "HAPV3",
    assetType: "stock",
    canonicalAssetId: "b3:HAPV3",
    legalName: "Hapvida Participações e Investimentos S.A.",
    issuerEntityId: "company.hapvida",
    issuerName: "Hapvida Participações e Investimentos S.A.",
  },
  {
    ticker: "KLBN11",
    assetType: "stock",
    canonicalAssetId: "b3:KLBN11",
    legalName: "Klabin S.A.",
    issuerEntityId: "company.klabin",
    issuerName: "Klabin S.A.",
  },
  {
    ticker: "MRFG3",
    assetType: "stock",
    canonicalAssetId: "b3:MRFG3",
    legalName: "Marfrig Global Foods S.A.",
    issuerEntityId: "company.marfrig",
    issuerName: "Marfrig Global Foods S.A.",
  },
  {
    ticker: "POMO4",
    assetType: "stock",
    canonicalAssetId: "b3:POMO4",
    legalName: "Marcopolo S.A.",
    issuerEntityId: "company.marcopolo",
    issuerName: "Marcopolo S.A.",
  },
  {
    ticker: "SLCE3",
    assetType: "stock",
    canonicalAssetId: "b3:SLCE3",
    legalName: "SLC Agrícola S.A.",
    issuerEntityId: "company.slc-agricola",
    issuerName: "SLC Agrícola S.A.",
  },
  {
    ticker: "TAEE11",
    assetType: "stock",
    canonicalAssetId: "b3:TAEE11",
    legalName: "Transmissora Aliança de Energia Elétrica S.A.",
    issuerEntityId: "company.taesa",
    issuerName: "Transmissora Aliança de Energia Elétrica S.A.",
  },
  {
    ticker: "TIMS3",
    assetType: "stock",
    canonicalAssetId: "b3:TIMS3",
    legalName: "TIM S.A.",
    issuerEntityId: "company.tim",
    issuerName: "TIM S.A.",
  },
  {
    ticker: "UGPA3",
    assetType: "stock",
    canonicalAssetId: "b3:UGPA3",
    legalName: "Ultrapar Participações S.A.",
    issuerEntityId: "company.ultrapar",
    issuerName: "Ultrapar Participações S.A.",
  },

  // --- TASK-064A: FIIs (segunda onda) ------------------------------------------------------
  // HGLG11 já está catalogado desde a base original -- não duplicado aqui.
  {
    ticker: "RBRR11",
    assetType: "fii",
    canonicalAssetId: "b3:RBRR11",
    legalName: "RBR Rendimento High Grade Fundo de Investimento Imobiliário",
    issuerEntityId: "fund.rbr-rendimento-high-grade",
    issuerName: "RBR Asset Management",
  },
  {
    ticker: "BRCO11",
    assetType: "fii",
    canonicalAssetId: "b3:BRCO11",
    legalName: "Bresco Logística Fundo de Investimento Imobiliário",
    issuerEntityId: "fund.bresco-logistica",
    issuerName: "Bresco",
  },
  {
    ticker: "VGIR11",
    assetType: "fii",
    canonicalAssetId: "b3:VGIR11",
    legalName: "Valora RE III Fundo de Investimento Imobiliário",
    issuerEntityId: "fund.valora-re-iii",
    issuerName: "Valora Investimentos",
  },
  {
    ticker: "TRXF11",
    assetType: "fii",
    canonicalAssetId: "b3:TRXF11",
    legalName: "TRX Real Estate Fundo de Investimento Imobiliário",
    issuerEntityId: "fund.trx-real-estate",
    issuerName: "TRX Investimentos",
  },
  {
    ticker: "PVBI11",
    assetType: "fii",
    canonicalAssetId: "b3:PVBI11",
    legalName: "VBI Prime Properties Fundo de Investimento Imobiliário",
    issuerEntityId: "fund.vbi-prime-properties",
    issuerName: "VBI Real Estate",
  },

  // --- TASK-064A: ETFs (segunda onda) ------------------------------------------------------
  // IVVB11 já está catalogado desde a base original -- não duplicado aqui.
  {
    ticker: "BOVV11",
    assetType: "etf",
    canonicalAssetId: "b3:BOVV11",
    legalName: "It Now IBOVESPA Fundo de Índice",
    issuerEntityId: "fund.it-now-ibovespa",
    issuerName: "Itaú Asset Management",
  },
  {
    ticker: "XFIX11",
    assetType: "etf",
    canonicalAssetId: "b3:XFIX11",
    legalName: "Trend IFIX Fundo de Índice",
    issuerEntityId: "fund.trend-ifix",
    issuerName: "Trend DTVM",
  },

  // --- TASK-064A: BDRs / internacional (segunda onda) --------------------------------------
  // AAPL34 já está catalogado desde a base original -- não duplicado aqui.
  {
    ticker: "META34",
    assetType: "international",
    canonicalAssetId: "b3:META34",
    legalName: "Meta Platforms, Inc. (BDR)",
    issuerEntityId: "company.meta-platforms",
    issuerName: "Meta Platforms, Inc.",
  },
  {
    ticker: "NVDC34",
    assetType: "international",
    canonicalAssetId: "b3:NVDC34",
    legalName: "NVIDIA Corporation (BDR)",
    issuerEntityId: "company.nvidia",
    issuerName: "NVIDIA Corporation",
  },
  {
    ticker: "MELI34",
    assetType: "international",
    canonicalAssetId: "b3:MELI34",
    legalName: "MercadoLibre, Inc. (BDR)",
    issuerEntityId: "company.mercadolibre",
    issuerName: "MercadoLibre, Inc.",
  },

  // --- TASK-064B: ações (terceira onda) ----------------------------------------------------
  {
    ticker: "AURE3",
    assetType: "stock",
    canonicalAssetId: "b3:AURE3",
    legalName: "Auren Energia S.A.",
    issuerEntityId: "company.auren-energia",
    issuerName: "Auren Energia S.A.",
  },
  {
    ticker: "BRAP4",
    assetType: "stock",
    canonicalAssetId: "b3:BRAP4",
    legalName: "Bradespar S.A.",
    issuerEntityId: "company.bradespar",
    issuerName: "Bradespar S.A.",
  },
  {
    ticker: "CCRO3",
    assetType: "stock",
    canonicalAssetId: "b3:CCRO3",
    legalName: "CCR S.A.",
    issuerEntityId: "company.ccr",
    issuerName: "CCR S.A.",
  },
  {
    ticker: "CPLE6",
    assetType: "stock",
    canonicalAssetId: "b3:CPLE6",
    legalName: "Companhia Paranaense de Energia - Copel",
    issuerEntityId: "company.copel",
    issuerName: "Companhia Paranaense de Energia - Copel",
  },
  {
    ticker: "CSNA3",
    assetType: "stock",
    canonicalAssetId: "b3:CSNA3",
    legalName: "Companhia Siderúrgica Nacional",
    issuerEntityId: "company.csn",
    issuerName: "Companhia Siderúrgica Nacional",
  },
  {
    ticker: "CXSE3",
    assetType: "stock",
    canonicalAssetId: "b3:CXSE3",
    legalName: "Caixa Seguridade Participações S.A.",
    issuerEntityId: "company.caixa-seguridade",
    issuerName: "Caixa Seguridade Participações S.A.",
  },
  {
    ticker: "DIRR3",
    assetType: "stock",
    canonicalAssetId: "b3:DIRR3",
    legalName: "Direcional Engenharia S.A.",
    issuerEntityId: "company.direcional",
    issuerName: "Direcional Engenharia S.A.",
  },
  {
    ticker: "GMAT3",
    assetType: "stock",
    canonicalAssetId: "b3:GMAT3",
    legalName: "Grupo Mateus S.A.",
    issuerEntityId: "company.grupo-mateus",
    issuerName: "Grupo Mateus S.A.",
  },
  {
    ticker: "GOAU4",
    assetType: "stock",
    canonicalAssetId: "b3:GOAU4",
    legalName: "Metalúrgica Gerdau S.A.",
    issuerEntityId: "company.metalurgica-gerdau",
    issuerName: "Metalúrgica Gerdau S.A.",
  },
  {
    ticker: "MULT3",
    assetType: "stock",
    canonicalAssetId: "b3:MULT3",
    legalName: "Multiplan Empreendimentos Imobiliários S.A.",
    issuerEntityId: "company.multiplan",
    issuerName: "Multiplan Empreendimentos Imobiliários S.A.",
  },
  {
    ticker: "RADL3",
    assetType: "stock",
    canonicalAssetId: "b3:RADL3",
    legalName: "Raia Drogasil S.A.",
    issuerEntityId: "company.raia-drogasil",
    issuerName: "Raia Drogasil S.A.",
  },
  {
    ticker: "SBSP3",
    assetType: "stock",
    canonicalAssetId: "b3:SBSP3",
    legalName: "Companhia de Saneamento Básico do Estado de São Paulo - Sabesp",
    issuerEntityId: "company.sabesp",
    issuerName: "Companhia de Saneamento Básico do Estado de São Paulo - Sabesp",
  },
  {
    ticker: "TOTS3",
    assetType: "stock",
    canonicalAssetId: "b3:TOTS3",
    legalName: "Totvs S.A.",
    issuerEntityId: "company.totvs",
    issuerName: "Totvs S.A.",
  },
  {
    ticker: "USIM5",
    assetType: "stock",
    canonicalAssetId: "b3:USIM5",
    legalName: "Usinas Siderúrgicas de Minas Gerais S.A. - Usiminas",
    issuerEntityId: "company.usiminas",
    issuerName: "Usinas Siderúrgicas de Minas Gerais S.A. - Usiminas",
  },
  {
    ticker: "VALE5",
    assetType: "stock",
    canonicalAssetId: "b3:VALE5",
    legalName: "Vale S.A.",
    issuerEntityId: "company.vale",
    issuerName: "Vale S.A.",
  },
  {
    ticker: "YDUQ3",
    assetType: "stock",
    canonicalAssetId: "b3:YDUQ3",
    legalName: "Yduqs Participações S.A.",
    issuerEntityId: "company.yduqs",
    issuerName: "Yduqs Participações S.A.",
  },

  // --- TASK-064B: FIIs (terceira onda) -----------------------------------------------------
  {
    ticker: "KNSC11",
    assetType: "fii",
    canonicalAssetId: "b3:KNSC11",
    legalName: "Kinea Securities Fundo de Investimento Imobiliário",
    issuerEntityId: "fund.kinea-securities",
    issuerName: "Kinea Investimentos",
  },
  {
    ticker: "HGCR11",
    assetType: "fii",
    canonicalAssetId: "b3:HGCR11",
    legalName: "CSHG Recebíveis Imobiliários Fundo de Investimento Imobiliário",
    issuerEntityId: "fund.cshg-recebiveis-imobiliarios",
    issuerName: "CSHG (Credit Suisse Hedging-Griffo)",
  },
  {
    ticker: "MCCI11",
    assetType: "fii",
    canonicalAssetId: "b3:MCCI11",
    legalName: "Mauá Capital Recebíveis Imobiliários Fundo de Investimento Imobiliário",
    issuerEntityId: "fund.maua-capital-recebiveis-imobiliarios",
    issuerName: "Mauá Capital",
  },
  {
    ticker: "JSRE11",
    assetType: "fii",
    canonicalAssetId: "b3:JSRE11",
    legalName: "JS Real Estate Multigestão Fundo de Investimento Imobiliário",
    issuerEntityId: "fund.js-real-estate-multigestao",
    issuerName: "JS Real Estate",
  },
  {
    ticker: "RZTR11",
    assetType: "fii",
    canonicalAssetId: "b3:RZTR11",
    legalName: "Riza Terrax Fundo de Investimento Imobiliário",
    issuerEntityId: "fund.riza-terrax",
    issuerName: "Riza Asset Management",
  },
  {
    ticker: "LVBI11",
    assetType: "fii",
    canonicalAssetId: "b3:LVBI11",
    legalName: "VBI Logístico Fundo de Investimento Imobiliário",
    issuerEntityId: "fund.vbi-logistico",
    issuerName: "VBI Real Estate",
  },

  // --- TASK-064B: ETFs (terceira onda) -----------------------------------------------------
  // BOVA11 já está catalogado desde a base original -- não duplicado aqui.
  {
    ticker: "GOVE11",
    assetType: "etf",
    canonicalAssetId: "b3:GOVE11",
    legalName: "It Now IGCT Fundo de Índice",
    issuerEntityId: "fund.it-now-igct",
    issuerName: "Itaú Asset Management",
  },
  {
    ticker: "ECOO11",
    assetType: "etf",
    canonicalAssetId: "b3:ECOO11",
    legalName: "It Now ISE Fundo de Índice",
    issuerEntityId: "fund.it-now-ise",
    issuerName: "Itaú Asset Management",
  },

  // --- TASK-064B: BDRs / internacional (terceira onda) -------------------------------------
  {
    ticker: "GOOG34",
    assetType: "international",
    canonicalAssetId: "b3:GOOG34",
    legalName: "Alphabet Inc. (BDR)",
    issuerEntityId: "company.alphabet",
    issuerName: "Alphabet Inc.",
  },
  {
    ticker: "ADBE34",
    assetType: "international",
    canonicalAssetId: "b3:ADBE34",
    legalName: "Adobe Inc. (BDR)",
    issuerEntityId: "company.adobe",
    issuerName: "Adobe Inc.",
  },
  {
    ticker: "ORCL34",
    assetType: "international",
    canonicalAssetId: "b3:ORCL34",
    legalName: "Oracle Corporation (BDR)",
    issuerEntityId: "company.oracle",
    issuerName: "Oracle Corporation",
  },
  {
    ticker: "AMD34",
    assetType: "international",
    canonicalAssetId: "b3:AMD34",
    legalName: "Advanced Micro Devices, Inc. (BDR)",
    issuerEntityId: "company.amd",
    issuerName: "Advanced Micro Devices, Inc.",
  },

  // --- TASK-064B: ações (terceira onda, complemento a 93) -----------------------------------
  {
    ticker: "JBSS3",
    assetType: "stock",
    canonicalAssetId: "b3:JBSS3",
    legalName: "JBS S.A.",
    issuerEntityId: "company.jbs",
    issuerName: "JBS S.A.",
  },
  {
    ticker: "PRIO3",
    assetType: "stock",
    canonicalAssetId: "b3:PRIO3",
    legalName: "PetroRio S.A.",
    issuerEntityId: "company.petrorio",
    issuerName: "PetroRio S.A.",
  },
  {
    ticker: "SUZB3",
    assetType: "stock",
    canonicalAssetId: "b3:SUZB3",
    legalName: "Suzano S.A.",
    issuerEntityId: "company.suzano",
    issuerName: "Suzano S.A.",
  },
  {
    ticker: "NTCO3",
    assetType: "stock",
    canonicalAssetId: "b3:NTCO3",
    legalName: "Natura &Co Holding S.A.",
    issuerEntityId: "company.natura-co",
    issuerName: "Natura &Co Holding S.A.",
  },
];
