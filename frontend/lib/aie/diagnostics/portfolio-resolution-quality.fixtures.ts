import type { CandidateAssetType } from "../contracts";
import type { PortfolioAssetInput } from "../ingestion/portfolio-candidate-ingestion";
import type { RegistryEntity } from "../registry";

/**
 * Fixtures for TASK-051A (diagnostic only -- never used by production code).
 *
 * Each fixture is a realistic single-row portfolio entry as a user might type
 * it, plus what a fully-populated registry WOULD know about it if one
 * existed. `registryEntity` is deliberately absent for the "ambiguous"
 * category: those rows have nothing an exact-alias/identifier registry
 * lookup could ever match, on purpose (see the diagnostic test for why).
 *
 * `expectedAssetType` is the type a person would reasonably assign; when the
 * current `CandidateAssetType` enum (lib/aie/contracts/candidate-asset.ts)
 * has no fitting value at all (Tesouro Direto), it is left undefined -- that
 * gap is itself a diagnostic finding, not an oversight here.
 */
export type DiagnosticCategory =
  | "stock"
  | "fii"
  | "etf"
  | "international"
  | "fixed-income-generic"
  | "treasury"
  | "ambiguous"
  | "b3-no-assettype"
  | "b3-expanded";

export interface DiagnosticFixture {
  /** Stable id for the report table. Never the raw free-text name. */
  id: string;
  category: DiagnosticCategory;
  description: string;
  input: PortfolioAssetInput;
  expectedAssetType?: CandidateAssetType;
  registryEntity?: RegistryEntity;
}

function stock(ticker: string, legalName: string): DiagnosticFixture {
  return {
    id: ticker,
    category: "stock",
    description: `Ação listada, ticker exato (${ticker})`,
    input: {
      id: `diag:${ticker}`,
      rawName: ticker,
      assetType: "stock",
      ticker,
      currency: "BRL",
      amount: 5000,
    },
    expectedAssetType: "stock",
    registryEntity: {
      id: `company.${ticker.toLowerCase()}`,
      kind: "company",
      legalName,
      aliases: [ticker],
      identifiers: [{ kind: "ticker", value: ticker }],
    },
  };
}

function fii(ticker: string, legalName: string): DiagnosticFixture {
  return {
    id: ticker,
    category: "fii",
    description: `Fundo imobiliário, ticker exato (${ticker})`,
    input: {
      id: `diag:${ticker}`,
      rawName: ticker,
      assetType: "fii",
      ticker,
      currency: "BRL",
      amount: 3000,
    },
    expectedAssetType: "fii",
    registryEntity: {
      id: `fund.${ticker.toLowerCase()}`,
      kind: "fund",
      legalName,
      aliases: [ticker],
      identifiers: [{ kind: "ticker", value: ticker }],
    },
  };
}

function etf(ticker: string, legalName: string): DiagnosticFixture {
  return {
    id: ticker,
    category: "etf",
    description: `ETF, ticker exato (${ticker})`,
    input: {
      id: `diag:${ticker}`,
      rawName: ticker,
      assetType: "etf",
      ticker,
      currency: "BRL",
      amount: 4000,
    },
    expectedAssetType: "etf",
    registryEntity: {
      id: `fund.${ticker.toLowerCase()}`,
      kind: "fund",
      legalName,
      aliases: [ticker],
      identifiers: [{ kind: "ticker", value: ticker }],
    },
  };
}

export const DIAGNOSTIC_FIXTURES: DiagnosticFixture[] = [
  // --- ações -----------------------------------------------------------------------------
  stock("PETR4", "Petróleo Brasileiro S.A. - Petrobras"),
  stock("VALE3", "Vale S.A."),
  stock("ITUB4", "Itaú Unibanco Holding S.A."),

  // --- FIIs --------------------------------------------------------------------------------
  fii("HGLG11", "CSHG Logística Fundo de Investimento Imobiliário"),
  fii("KNRI11", "Kinea Renda Imobiliária Fundo de Investimento Imobiliário"),

  // --- ETFs --------------------------------------------------------------------------------
  etf("BOVA11", "iShares Ibovespa Fundo de Índice"),
  etf("IVVB11", "iShares S&P 500 Fundo de Índice"),

  // --- BDR / internacional -----------------------------------------------------------------
  {
    id: "AAPL34",
    category: "international",
    description: "BDR de ação internacional",
    input: {
      id: "diag:AAPL34",
      rawName: "AAPL34",
      assetType: "international",
      ticker: "AAPL34",
      currency: "BRL",
      amount: 2000,
    },
    expectedAssetType: "international",
    registryEntity: {
      id: "company.apple",
      kind: "company",
      legalName: "Apple Inc.",
      aliases: ["AAPL34"],
      identifiers: [{ kind: "ticker", value: "AAPL34" }],
    },
  },

  // --- renda fixa genérica (dados fictícios de emissor) -------------------------------------
  {
    id: "CDB-GENERICO",
    category: "fixed-income-generic",
    description: "CDB com emissor fictício, sem ticker/código oficial",
    input: {
      id: "diag:cdb-generico",
      rawName: "CDB Banco Teste",
      assetType: "cdb",
      issuerName: "Banco Teste",
      currency: "BRL",
      amount: 10000,
    },
    expectedAssetType: "cdb",
    registryEntity: {
      id: "instrument.cdb-banco-teste",
      kind: "instrument",
      legalName: "CDB Banco Teste",
      aliases: ["CDB Banco Teste"],
      identifiers: [],
    },
  },
  {
    id: "LCI-GENERICO",
    category: "fixed-income-generic",
    description: "LCI com emissor fictício, sem ticker/código oficial",
    input: {
      id: "diag:lci-generico",
      rawName: "LCI Banco Teste",
      assetType: "lci",
      issuerName: "Banco Teste",
      currency: "BRL",
      amount: 10000,
    },
    expectedAssetType: "lci",
    registryEntity: {
      id: "instrument.lci-banco-teste",
      kind: "instrument",
      legalName: "LCI Banco Teste",
      aliases: ["LCI Banco Teste"],
      identifiers: [],
    },
  },
  {
    id: "LCA-GENERICO",
    category: "fixed-income-generic",
    description: "LCA com emissor fictício, sem ticker/código oficial",
    input: {
      id: "diag:lca-generico",
      rawName: "LCA Banco Teste",
      assetType: "lca",
      issuerName: "Banco Teste",
      currency: "BRL",
      amount: 10000,
    },
    expectedAssetType: "lca",
    registryEntity: {
      id: "instrument.lca-banco-teste",
      kind: "instrument",
      legalName: "LCA Banco Teste",
      aliases: ["LCA Banco Teste"],
      identifiers: [],
    },
  },

  // --- Tesouro Direto ------------------------------------------------------------------------
  // Achado do diagnóstico: CandidateAssetType não tem NENHUM valor para
  // titulo publico/Tesouro Direto (stock/etf/fii/fund/debenture/cri/cra/
  // cdb/lci/lca/coe/crypto/international/unknown) -- por isso não há
  // `expectedAssetType` aqui: não é um caso "a resposta certa é X e o
  // sistema erra", é "o sistema não tem onde representar X ainda".
  {
    id: "TESOURO-SELIC",
    category: "treasury",
    description: "Tesouro Selic -- sem categoria correspondente no enum atual",
    input: {
      id: "diag:tesouro-selic",
      rawName: "Tesouro Selic",
      issuerName: "Tesouro Nacional",
      currency: "BRL",
      amount: 8000,
    },
    registryEntity: {
      id: "instrument.tesouro-selic",
      kind: "instrument",
      legalName: "Tesouro Selic",
      aliases: ["Tesouro Selic"],
      identifiers: [],
    },
  },
  {
    id: "TESOURO-IPCA",
    category: "treasury",
    description: "Tesouro IPCA+ -- sem categoria correspondente no enum atual",
    input: {
      id: "diag:tesouro-ipca",
      rawName: "Tesouro IPCA+",
      issuerName: "Tesouro Nacional",
      currency: "BRL",
      amount: 8000,
    },
    registryEntity: {
      id: "instrument.tesouro-ipca",
      kind: "instrument",
      legalName: "Tesouro IPCA+",
      aliases: ["Tesouro IPCA+"],
      identifiers: [],
    },
  },

  // --- casos ambíguos ou incompletos (sem registryEntity, de propósito) ---------------------
  {
    id: "AMBIGUO-SEM-TICKER",
    category: "ambiguous",
    description: "Nome descritivo sem ticker nem assetType",
    input: {
      id: "diag:sem-ticker",
      rawName: "Fundo Imobiliário Shopping",
      currency: "BRL",
      amount: 1500,
    },
  },
  {
    id: "AMBIGUO-TICKER-ESPACOS",
    category: "ambiguous",
    description: "Ticker com espaços nas pontas (deve normalizar para PETR4)",
    input: {
      id: "diag:ticker-espacos",
      rawName: "PETR4",
      assetType: "stock",
      ticker: "  PETR4  ",
      currency: "BRL",
      amount: 5000,
    },
    // Sem registryEntity próprio: o mesmo ticker PETR4 já é registrado pela
    // fixture "stock(PETR4, ...)" acima -- o registry é compartilhado por
    // toda a bateria (ver buildRegistryEngine), então duplicar a entidade
    // aqui colidiria (mesmo alias, id diferente).
    expectedAssetType: "stock",
  },
  {
    id: "AMBIGUO-TICKER-MINUSCULO",
    category: "ambiguous",
    description: "Ticker em minúsculas (deve normalizar para VALE3)",
    input: {
      id: "diag:ticker-minusculo",
      rawName: "vale3",
      assetType: "stock",
      ticker: "vale3",
      currency: "BRL",
      amount: 5000,
    },
    // Sem registryEntity próprio: VALE3 já é registrado pela fixture
    // "stock(VALE3, ...)" acima -- ver a nota da fixture anterior.
    expectedAssetType: "stock",
  },
  {
    id: "AMBIGUO-SEM-VALOR-MOEDA",
    category: "ambiguous",
    description: "Ticker válido, mas sem amount/currency",
    input: {
      id: "diag:sem-valor-moeda",
      rawName: "HGLG11",
      assetType: "fii",
      ticker: "HGLG11",
    },
    // Sem registryEntity próprio: HGLG11 já é registrado pela fixture
    // "fii(HGLG11, ...)" acima.
    expectedAssetType: "fii",
  },
  {
    id: "AMBIGUO-NOME-GENERICO",
    category: "ambiguous",
    description: "Nome comercial genérico, sem qualquer identificador",
    input: {
      id: "diag:nome-generico",
      rawName: "Investimento em Renda Fixa",
      currency: "BRL",
      amount: 2500,
    },
  },

  // --- TASK-051C: CSV "básico" real -- só rawName/ticker/valor, SEM a coluna
  // assetType. Antes da TASK-051C isso caía em "unknown" e nunca alcançava o
  // B3ListedAssetProvider (achado do smoke da TASK-051B em produção). Estas
  // fixtures replicam exatamente o CSV de validação manual da TASK-051C.
  {
    id: "SEMTIPO-PETR4",
    category: "b3-no-assettype",
    description: "PETR4 sem assetType (CSV básico, só nome/ticker/valor)",
    input: {
      id: "diag:semtipo-petr4",
      rawName: "PETR4",
      ticker: "PETR4",
      currency: "BRL",
      amount: 1000,
    },
    expectedAssetType: "stock",
  },
  {
    id: "SEMTIPO-HGLG11",
    category: "b3-no-assettype",
    description: "HGLG11 sem assetType",
    input: {
      id: "diag:semtipo-hglg11",
      rawName: "HGLG11",
      ticker: "HGLG11",
      currency: "BRL",
      amount: 2000,
    },
    expectedAssetType: "fii",
  },
  {
    id: "SEMTIPO-BOVA11",
    category: "b3-no-assettype",
    description: "BOVA11 sem assetType",
    input: {
      id: "diag:semtipo-bova11",
      rawName: "BOVA11",
      ticker: "BOVA11",
      currency: "BRL",
      amount: 3000,
    },
    expectedAssetType: "etf",
  },
  {
    id: "SEMTIPO-AAPL34",
    category: "b3-no-assettype",
    description: "AAPL34 sem assetType",
    input: {
      id: "diag:semtipo-aapl34",
      rawName: "AAPL34",
      ticker: "AAPL34",
      currency: "BRL",
      amount: 4000,
    },
    expectedAssetType: "international",
  },
  {
    id: "SEMTIPO-CDB-GENERICO",
    category: "b3-no-assettype",
    description: "CDB genérico sem assetType -- não deve virar B3 por engano",
    input: {
      id: "diag:semtipo-cdb",
      rawName: "CDB Banco Teste",
      currency: "BRL",
      amount: 5000,
    },
  },
  {
    id: "SEMTIPO-TESOURO-SELIC",
    category: "b3-no-assettype",
    description: "Tesouro Selic sem assetType -- não deve virar B3 por engano",
    input: {
      id: "diag:semtipo-tesouro",
      rawName: "Tesouro Selic",
      currency: "BRL",
      amount: 6000,
    },
  },

  // --- TASK-051C (correção pós-smoke em produção): o CSV "mínimo" de
  // verdade nem sempre tem uma coluna ticker separada -- às vezes só
  // rawName. Replica exatamente o CSV usado no smoke manual da TASK-051C.
  {
    id: "SOMENTE-RAWNAME-PETR4",
    category: "b3-no-assettype",
    description: "PETR4 só com rawName -- sem coluna ticker nem assetType",
    input: {
      id: "diag:somente-rawname-petr4",
      rawName: "PETR4",
      currency: "BRL",
      amount: 1000,
    },
    expectedAssetType: "stock",
  },
  {
    id: "SOMENTE-RAWNAME-HGLG11",
    category: "b3-no-assettype",
    description: "HGLG11 só com rawName",
    input: {
      id: "diag:somente-rawname-hglg11",
      rawName: "HGLG11",
      currency: "BRL",
      amount: 2000,
    },
    expectedAssetType: "fii",
  },
  {
    id: "SOMENTE-RAWNAME-BOVA11",
    category: "b3-no-assettype",
    description: "BOVA11 só com rawName",
    input: {
      id: "diag:somente-rawname-bova11",
      rawName: "BOVA11",
      currency: "BRL",
      amount: 3000,
    },
    expectedAssetType: "etf",
  },
  {
    id: "SOMENTE-RAWNAME-AAPL34",
    category: "b3-no-assettype",
    description: "AAPL34 só com rawName",
    input: {
      id: "diag:somente-rawname-aapl34",
      rawName: "AAPL34",
      currency: "BRL",
      amount: 4000,
    },
    expectedAssetType: "international",
  },

  // --- TASK-052: amostra do catálogo B3 expandido, todos só com rawName
  // (CSV básico, sem ticker/assetType), replicando o smoke real de produção.
  {
    id: "EXPANDIDO-ABEV3",
    category: "b3-expanded",
    description: "ABEV3 (ação nova do catálogo) só com rawName",
    input: { id: "diag:expandido-abev3", rawName: "ABEV3", currency: "BRL", amount: 1000 },
    expectedAssetType: "stock",
  },
  {
    id: "EXPANDIDO-B3SA3",
    category: "b3-expanded",
    description: "B3SA3 (ação nova do catálogo) só com rawName",
    input: { id: "diag:expandido-b3sa3", rawName: "B3SA3", currency: "BRL", amount: 1000 },
    expectedAssetType: "stock",
  },
  {
    id: "EXPANDIDO-BBAS3",
    category: "b3-expanded",
    description: "BBAS3 (ação nova do catálogo) só com rawName",
    input: { id: "diag:expandido-bbas3", rawName: "BBAS3", currency: "BRL", amount: 1000 },
    expectedAssetType: "stock",
  },
  {
    id: "EXPANDIDO-WEGE3",
    category: "b3-expanded",
    description: "WEGE3 (ação nova do catálogo) só com rawName",
    input: { id: "diag:expandido-wege3", rawName: "WEGE3", currency: "BRL", amount: 1000 },
    expectedAssetType: "stock",
  },
  {
    id: "EXPANDIDO-MXRF11",
    category: "b3-expanded",
    description: "MXRF11 (FII novo do catálogo) só com rawName",
    input: { id: "diag:expandido-mxrf11", rawName: "MXRF11", currency: "BRL", amount: 1000 },
    expectedAssetType: "fii",
  },
  {
    id: "EXPANDIDO-XPML11",
    category: "b3-expanded",
    description: "XPML11 (FII novo do catálogo) só com rawName",
    input: { id: "diag:expandido-xpml11", rawName: "XPML11", currency: "BRL", amount: 1000 },
    expectedAssetType: "fii",
  },
  {
    id: "EXPANDIDO-BTLG11",
    category: "b3-expanded",
    description: "BTLG11 (FII novo do catálogo) só com rawName",
    input: { id: "diag:expandido-btlg11", rawName: "BTLG11", currency: "BRL", amount: 1000 },
    expectedAssetType: "fii",
  },
  {
    id: "EXPANDIDO-SMAL11",
    category: "b3-expanded",
    description: "SMAL11 (ETF novo do catálogo) só com rawName",
    input: { id: "diag:expandido-smal11", rawName: "SMAL11", currency: "BRL", amount: 1000 },
    expectedAssetType: "etf",
  },
  {
    id: "EXPANDIDO-HASH11",
    category: "b3-expanded",
    description: "HASH11 (ETF novo do catálogo) só com rawName",
    input: { id: "diag:expandido-hash11", rawName: "HASH11", currency: "BRL", amount: 1000 },
    expectedAssetType: "etf",
  },
  {
    id: "EXPANDIDO-MSFT34",
    category: "b3-expanded",
    description: "MSFT34 (BDR novo do catálogo) só com rawName",
    input: { id: "diag:expandido-msft34", rawName: "MSFT34", currency: "BRL", amount: 1000 },
    expectedAssetType: "international",
  },
  {
    id: "EXPANDIDO-TSLA34",
    category: "b3-expanded",
    description: "TSLA34 (BDR novo do catálogo) só com rawName",
    input: { id: "diag:expandido-tsla34", rawName: "TSLA34", currency: "BRL", amount: 1000 },
    expectedAssetType: "international",
  },
  {
    id: "EXPANDIDO-NEGATIVO-PETR5",
    category: "b3-expanded",
    description: "PETR5 -- parece ticker B3 plausível, mas não está no catálogo",
    input: { id: "diag:expandido-negativo-petr5", rawName: "PETR5", currency: "BRL", amount: 1000 },
  },
];
