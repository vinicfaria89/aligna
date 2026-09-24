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
  | "b3-expanded"
  // TASK-059A: renda fixa privada (CDB/LCI/LCA) -- ver
  // docs/tasks/task-059a-private-fixed-income-diagnostics.md. Categorias
  // próprias (em vez de reaproveitar "fixed-income-generic") para que o
  // relatório diagnóstico separe cada tipo, os ambíguos e os negativos
  // (risco de falso positivo) de forma legível.
  | "cdb"
  | "lci"
  | "lca"
  | "private-fixed-income-ambiguous"
  | "private-fixed-income-negative";

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
  // Achado do diagnóstico (TASK-051A): CandidateAssetType não tem NENHUM valor
  // para titulo publico/Tesouro Direto (stock/etf/fii/fund/debenture/cri/cra/
  // cdb/lci/lca/coe/crypto/international/unknown) -- por isso não há
  // `expectedAssetType` aqui: não é um caso "a resposta certa é X e o
  // sistema erra", é "o sistema não tem onde representar X ainda".
  //
  // TASK-058A expande esta seção (diagnóstico e modelagem apenas -- ver
  // docs/tasks/task-058a-tesouro-direto-diagnostics.md): nenhuma fixture
  // abaixo tem `expectedAssetType`, de propósito, incluindo as de vencimento
  // explícito -- esta task não decide que "com vencimento = verificável",
  // só documenta o comportamento atual e levanta os casos para a TASK-058B
  // decidir com calma. Todas continuam, e devem continuar,
  // `needs-more-evidence` neste diagnóstico.
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

  // --- TASK-058A: com vencimento explícito no nome (candidatos possíveis a
  // identidade específica numa futura TASK-058B -- ver critérios propostos no
  // documento de modelagem; aqui, só documentando que continuam pendentes).
  {
    id: "TESOURO-SELIC-2029",
    category: "treasury",
    description: "Tesouro Selic com ano de vencimento no nome",
    input: {
      id: "diag:tesouro-selic-2029",
      rawName: "Tesouro Selic 2029",
      issuerName: "Tesouro Nacional",
      currency: "BRL",
      amount: 8000,
    },
    registryEntity: {
      id: "instrument.tesouro-selic-2029",
      kind: "instrument",
      legalName: "Tesouro Selic 2029",
      aliases: ["Tesouro Selic 2029"],
      identifiers: [],
    },
  },
  {
    id: "TESOURO-SELIC-2031",
    category: "treasury",
    description: "Tesouro Selic com ano de vencimento diferente",
    input: {
      id: "diag:tesouro-selic-2031",
      rawName: "Tesouro Selic 2031",
      issuerName: "Tesouro Nacional",
      currency: "BRL",
      amount: 8000,
    },
    registryEntity: {
      id: "instrument.tesouro-selic-2031",
      kind: "instrument",
      legalName: "Tesouro Selic 2031",
      aliases: ["Tesouro Selic 2031"],
      identifiers: [],
    },
  },
  {
    id: "TESOURO-IPCA-2035",
    category: "treasury",
    description: "Tesouro IPCA+ com ano de vencimento no nome",
    input: {
      id: "diag:tesouro-ipca-2035",
      rawName: "Tesouro IPCA+ 2035",
      issuerName: "Tesouro Nacional",
      currency: "BRL",
      amount: 8000,
    },
    registryEntity: {
      id: "instrument.tesouro-ipca-2035",
      kind: "instrument",
      legalName: "Tesouro IPCA+ 2035",
      aliases: ["Tesouro IPCA+ 2035"],
      identifiers: [],
    },
  },
  {
    id: "TESOURO-IPCA-2045",
    category: "treasury",
    description: "Tesouro IPCA+ com ano de vencimento diferente",
    input: {
      id: "diag:tesouro-ipca-2045",
      rawName: "Tesouro IPCA+ 2045",
      issuerName: "Tesouro Nacional",
      currency: "BRL",
      amount: 8000,
    },
    registryEntity: {
      id: "instrument.tesouro-ipca-2045",
      kind: "instrument",
      legalName: "Tesouro IPCA+ 2045",
      aliases: ["Tesouro IPCA+ 2045"],
      identifiers: [],
    },
  },
  {
    id: "TESOURO-IPCA-JS-2040",
    category: "treasury",
    description: "Tesouro IPCA+ com Juros Semestrais, com vencimento -- modalidade adicional no nome",
    input: {
      id: "diag:tesouro-ipca-js-2040",
      rawName: "Tesouro IPCA+ com Juros Semestrais 2040",
      issuerName: "Tesouro Nacional",
      currency: "BRL",
      amount: 8000,
    },
    registryEntity: {
      id: "instrument.tesouro-ipca-js-2040",
      kind: "instrument",
      legalName: "Tesouro IPCA+ com Juros Semestrais 2040",
      aliases: ["Tesouro IPCA+ com Juros Semestrais 2040"],
      identifiers: [],
    },
  },
  {
    id: "TESOURO-PREFIXADO-2027",
    category: "treasury",
    description: "Tesouro Prefixado com ano de vencimento no nome",
    input: {
      id: "diag:tesouro-prefixado-2027",
      rawName: "Tesouro Prefixado 2027",
      issuerName: "Tesouro Nacional",
      currency: "BRL",
      amount: 8000,
    },
    registryEntity: {
      id: "instrument.tesouro-prefixado-2027",
      kind: "instrument",
      legalName: "Tesouro Prefixado 2027",
      aliases: ["Tesouro Prefixado 2027"],
      identifiers: [],
    },
  },
  {
    id: "TESOURO-PREFIXADO-2031",
    category: "treasury",
    description: "Tesouro Prefixado com ano de vencimento diferente",
    input: {
      id: "diag:tesouro-prefixado-2031",
      rawName: "Tesouro Prefixado 2031",
      issuerName: "Tesouro Nacional",
      currency: "BRL",
      amount: 8000,
    },
    registryEntity: {
      id: "instrument.tesouro-prefixado-2031",
      kind: "instrument",
      legalName: "Tesouro Prefixado 2031",
      aliases: ["Tesouro Prefixado 2031"],
      identifiers: [],
    },
  },
  {
    id: "TESOURO-PREFIXADO-JS-2035",
    category: "treasury",
    description: "Tesouro Prefixado com Juros Semestrais, com vencimento",
    input: {
      id: "diag:tesouro-prefixado-js-2035",
      rawName: "Tesouro Prefixado com Juros Semestrais 2035",
      issuerName: "Tesouro Nacional",
      currency: "BRL",
      amount: 8000,
    },
    registryEntity: {
      id: "instrument.tesouro-prefixado-js-2035",
      kind: "instrument",
      legalName: "Tesouro Prefixado com Juros Semestrais 2035",
      aliases: ["Tesouro Prefixado com Juros Semestrais 2035"],
      identifiers: [],
    },
  },

  // --- TASK-058A: sem vencimento -- nome de família/tipo, não de um título
  // específico. Proposta do documento de modelagem: sem vencimento, nunca
  // verificar (identidade insuficiente por natureza, não por falta de fonte).
  {
    id: "TESOURO-PREFIXADO",
    category: "treasury",
    description: "Tesouro Prefixado sem vencimento -- nome de família, não de título específico",
    input: {
      id: "diag:tesouro-prefixado",
      rawName: "Tesouro Prefixado",
      issuerName: "Tesouro Nacional",
      currency: "BRL",
      amount: 8000,
    },
  },
  {
    id: "TESOURO-DIRETO-GENERICO",
    category: "treasury",
    description: "\"Tesouro Direto\" genérico -- nome do programa, não de um título",
    input: {
      id: "diag:tesouro-direto-generico",
      rawName: "Tesouro Direto",
      issuerName: "Tesouro Nacional",
      currency: "BRL",
      amount: 8000,
    },
  },
  {
    id: "TITULO-PUBLICO-GENERICO",
    category: "treasury",
    description: "\"Título Público\" genérico -- nem tipo nem indexador identificados",
    input: {
      id: "diag:titulo-publico-generico",
      rawName: "Título Público",
      currency: "BRL",
      amount: 8000,
    },
  },

  // --- TASK-058A: variações de escrita -- mesma intenção do usuário, texto
  // diferente (caixa, acentos, espaçamento no "+", sufixo entre parênteses).
  // Sem `registryEntity` de propósito: são o MESMO título das fixtures acima
  // (ex.: "Tesouro Selic 2029"), não uma entidade nova -- duplicar o alias
  // colidiria com a fixture canônica (mesma convenção das fixtures
  // "ambíguas" que reusam ticker já registrado, ver AMBIGUO-TICKER-ESPACOS).
  {
    id: "TESOURO-VARIACAO-MINUSCULO",
    category: "treasury",
    description: "Tesouro Selic 2029 todo em minúsculas",
    input: {
      id: "diag:tesouro-variacao-minusculo",
      rawName: "tesouro selic 2029",
      issuerName: "Tesouro Nacional",
      currency: "BRL",
      amount: 8000,
    },
  },
  {
    id: "TESOURO-VARIACAO-CAIXA-ALTA-ESPACOS",
    category: "treasury",
    description: "Tesouro IPCA+ 2035 em caixa alta, com espaços extras nas pontas",
    input: {
      id: "diag:tesouro-variacao-caixa-alta-espacos",
      rawName: " TESOURO IPCA+ 2035 ",
      issuerName: "Tesouro Nacional",
      currency: "BRL",
      amount: 8000,
    },
  },
  {
    id: "TESOURO-VARIACAO-ESPACO-NO-SINAL",
    category: "treasury",
    description: "\"IPCA +\" com espaço antes do sinal de mais, em vez de \"IPCA+\"",
    input: {
      id: "diag:tesouro-variacao-espaco-no-sinal",
      rawName: "Tesouro IPCA + 2035",
      issuerName: "Tesouro Nacional",
      currency: "BRL",
      amount: 8000,
    },
  },
  {
    id: "TESOURO-VARIACAO-JUROS-MINUSCULO",
    category: "treasury",
    description: "\"com juros semestrais\" em minúsculas, em vez de Title Case",
    input: {
      id: "diag:tesouro-variacao-juros-minusculo",
      rawName: "Tesouro IPCA+ com juros semestrais 2040",
      issuerName: "Tesouro Nacional",
      currency: "BRL",
      amount: 8000,
    },
  },
  {
    id: "TESOURO-VARIACAO-SUFIXO-LFT",
    category: "treasury",
    description: "Sufixo entre parênteses com a sigla do título (LFT), como algumas corretoras exportam",
    input: {
      id: "diag:tesouro-variacao-sufixo-lft",
      rawName: "Tesouro Selic 2029 (LFT)",
      issuerName: "Tesouro Nacional",
      currency: "BRL",
      amount: 8000,
    },
  },

  // --- TASK-058A: casos negativos -- contêm "Tesouro" no nome mas NÃO são um
  // título do Tesouro Direto (fundo/ETF/carteira/produto bancário com nome
  // comercial parecido). Risco de falso positivo mapeado no documento de
  // modelagem: nenhum destes pode nunca resolver como verificado por conter
  // a palavra "Tesouro".
  {
    id: "TESOURO-NEGATIVO-FUNDO",
    category: "treasury",
    description: "Fundo com \"Tesouro\" no nome comercial -- não é um título direto",
    input: {
      id: "diag:tesouro-negativo-fundo",
      rawName: "Fundo Tesouro Selic",
      currency: "BRL",
      amount: 5000,
    },
  },
  {
    id: "TESOURO-NEGATIVO-ETF",
    category: "treasury",
    description: "ETF com \"Tesouro\" no nome comercial",
    input: {
      id: "diag:tesouro-negativo-etf",
      rawName: "ETF Tesouro Selic",
      currency: "BRL",
      amount: 5000,
    },
  },
  {
    id: "TESOURO-NEGATIVO-CARTEIRA",
    category: "treasury",
    description: "\"Carteira Tesouro\" -- nome de produto/estratégia, não de um título",
    input: {
      id: "diag:tesouro-negativo-carteira",
      rawName: "Carteira Tesouro",
      currency: "BRL",
      amount: 5000,
    },
  },
  {
    id: "TESOURO-NEGATIVO-CDB",
    category: "treasury",
    description: "CDB com \"Tesouro\" no nome comercial do banco/produto",
    input: {
      id: "diag:tesouro-negativo-cdb",
      rawName: "CDB Tesouro Selic",
      currency: "BRL",
      amount: 5000,
    },
  },
  {
    id: "TESOURO-NEGATIVO-LCI",
    category: "treasury",
    description: "LCI com \"Tesouro\" no nome comercial",
    input: {
      id: "diag:tesouro-negativo-lci",
      rawName: "LCI Tesouro IPCA",
      currency: "BRL",
      amount: 5000,
    },
  },
  {
    id: "TESOURO-NEGATIVO-RENDA-FIXA",
    category: "treasury",
    description: "\"Renda Fixa Tesouro\" -- categoria genérica de carteira, não um título",
    input: {
      id: "diag:tesouro-negativo-renda-fixa",
      rawName: "Renda Fixa Tesouro",
      currency: "BRL",
      amount: 5000,
    },
  },

  // --- TASK-059A: renda fixa privada (CDB/LCI/LCA) ------------------------------------------
  // Diagnóstico e modelagem apenas -- ver
  // docs/tasks/task-059a-private-fixed-income-diagnostics.md. Nenhuma
  // fixture abaixo deve resolver como "verified": `cdb`/`lci`/`lca` já
  // existem em CandidateAssetType (ao contrário de Tesouro na TASK-058A),
  // mas nenhum provider primary cobre nenhum deles ainda -- `expectedAssetType`
  // é definido nas fixtures de CDB/LCI/LCA (o tipo que um humano atribuiria
  // corretamente) só para documentar a expectativa futura; não implica que a
  // task verifique nada agora.
  {
    id: "CDB-EMISSOR-INDEXADOR",
    category: "cdb",
    description: "CDB com emissor e indexador, sem vencimento",
    input: {
      id: "diag:cdb-emissor-indexador",
      rawName: "CDB Banco Teste 110% CDI",
      assetType: "cdb",
      issuerName: "Banco Teste",
      currency: "BRL",
      amount: 10000,
    },
    expectedAssetType: "cdb",
  },
  {
    id: "CDB-EMISSOR-VENCIMENTO",
    category: "cdb",
    description: "CDB com emissor e vencimento, sem indexador explícito no nome",
    input: {
      id: "diag:cdb-emissor-vencimento",
      rawName: "CDB Banco Teste CDI 2027",
      assetType: "cdb",
      issuerName: "Banco Teste",
      currency: "BRL",
      amount: 10000,
    },
    expectedAssetType: "cdb",
  },
  {
    id: "CDB-COMPLETO",
    category: "cdb",
    description: "CDB com emissor, indexador e vencimento -- o caso mais completo do diagnóstico",
    input: {
      id: "diag:cdb-completo",
      rawName: "CDB Banco Teste 110% CDI 2027",
      assetType: "cdb",
      issuerName: "Banco Teste",
      currency: "BRL",
      amount: 10000,
    },
    expectedAssetType: "cdb",
  },
  {
    id: "CDB-NOME-COMERCIAL-LIQUIDEZ",
    category: "cdb",
    description: "CDB com nome comercial (\"Liquidez Diária\"), emissor presente",
    input: {
      id: "diag:cdb-nome-comercial-liquidez",
      rawName: "CDB Liquidez Diária Banco Teste",
      assetType: "cdb",
      issuerName: "Banco Teste",
      currency: "BRL",
      amount: 10000,
    },
    expectedAssetType: "cdb",
  },
  {
    id: "CDB-SEM-EMISSOR",
    category: "cdb",
    description: "CDB com indexador, mas SEM emissor -- identidade incompleta",
    input: {
      id: "diag:cdb-sem-emissor",
      rawName: "CDB 110% CDI",
      assetType: "cdb",
      currency: "BRL",
      amount: 10000,
    },
    expectedAssetType: "cdb",
  },
  {
    id: "CDB-NOME-COMERCIAL-POS",
    category: "cdb",
    description: "CDB com nome comercial (\"Pós\"), emissor presente, sem indexador/vencimento explícitos",
    input: {
      id: "diag:cdb-nome-comercial-pos",
      rawName: "CDB Pós Banco Teste",
      assetType: "cdb",
      issuerName: "Banco Teste",
      currency: "BRL",
      amount: 10000,
    },
    expectedAssetType: "cdb",
  },
  {
    id: "CDB-VARIACAO-ESCRITA",
    category: "cdb",
    description: "Mesmo caso completo, todo em minúsculas -- variação de escrita",
    input: {
      id: "diag:cdb-variacao-escrita",
      rawName: "cdb banco teste 110% cdi 2027",
      assetType: "cdb",
      issuerName: "Banco Teste",
      currency: "BRL",
      amount: 10000,
    },
    expectedAssetType: "cdb",
  },

  {
    id: "LCI-INDEXADOR",
    category: "lci",
    description: "LCI com emissor e indexador, sem vencimento",
    input: {
      id: "diag:lci-indexador",
      rawName: "LCI Banco Teste IPCA+",
      assetType: "lci",
      issuerName: "Banco Teste",
      currency: "BRL",
      amount: 10000,
    },
    expectedAssetType: "lci",
  },
  {
    id: "LCI-COMPLETO",
    category: "lci",
    description: "LCI com emissor, indexador e vencimento",
    input: {
      id: "diag:lci-completo",
      rawName: "LCI Banco Teste IPCA+ 2028",
      assetType: "lci",
      issuerName: "Banco Teste",
      currency: "BRL",
      amount: 10000,
    },
    expectedAssetType: "lci",
  },
  {
    id: "LCI-INDEXADOR-CDI-VENCIMENTO",
    category: "lci",
    description: "LCI com emissor, indexador CDI e vencimento (indexador diferente do caso IPCA+)",
    input: {
      id: "diag:lci-indexador-cdi-vencimento",
      rawName: "LCI Banco Teste CDI 2028",
      assetType: "lci",
      issuerName: "Banco Teste",
      currency: "BRL",
      amount: 10000,
    },
    expectedAssetType: "lci",
  },
  {
    id: "LCI-NOME-COMERCIAL",
    category: "lci",
    description: "LCI com nome comercial (\"90 dias\"), emissor presente",
    input: {
      id: "diag:lci-nome-comercial",
      rawName: "LCI 90 dias Banco Teste",
      assetType: "lci",
      issuerName: "Banco Teste",
      currency: "BRL",
      amount: 10000,
    },
    expectedAssetType: "lci",
  },
  {
    id: "LCI-SEM-EMISSOR",
    category: "lci",
    description: "LCI com indexador, mas SEM emissor -- identidade incompleta",
    input: {
      id: "diag:lci-sem-emissor",
      rawName: "LCI IPCA+",
      assetType: "lci",
      currency: "BRL",
      amount: 10000,
    },
    expectedAssetType: "lci",
  },
  {
    id: "LCI-VARIACAO-ESCRITA",
    category: "lci",
    description: "Mesmo caso completo, todo em minúsculas -- variação de escrita",
    input: {
      id: "diag:lci-variacao-escrita",
      rawName: "lci banco teste ipca+ 2028",
      assetType: "lci",
      issuerName: "Banco Teste",
      currency: "BRL",
      amount: 10000,
    },
    expectedAssetType: "lci",
  },
  {
    id: "LCI-VARIACAO-CAIXA-ESPACOS",
    category: "lci",
    description: "Mesmo caso completo, caixa alta com espaços extras nas pontas",
    input: {
      id: "diag:lci-variacao-caixa-espacos",
      rawName: " LCI BANCO TESTE IPCA+ 2028 ",
      assetType: "lci",
      issuerName: "Banco Teste",
      currency: "BRL",
      amount: 10000,
    },
    expectedAssetType: "lci",
  },

  {
    id: "LCA-INDEXADOR",
    category: "lca",
    description: "LCA com emissor e indexador, sem vencimento",
    input: {
      id: "diag:lca-indexador",
      rawName: "LCA Banco Teste CDI",
      assetType: "lca",
      issuerName: "Banco Teste",
      currency: "BRL",
      amount: 10000,
    },
    expectedAssetType: "lca",
  },
  {
    id: "LCA-COMPLETO",
    category: "lca",
    description: "LCA com emissor, indexador e vencimento",
    input: {
      id: "diag:lca-completo",
      rawName: "LCA Banco Teste CDI 2029",
      assetType: "lca",
      issuerName: "Banco Teste",
      currency: "BRL",
      amount: 10000,
    },
    expectedAssetType: "lca",
  },
  {
    id: "LCA-INDEXADOR-IPCA-VENCIMENTO",
    category: "lca",
    description: "LCA com emissor, indexador IPCA+ e vencimento (indexador diferente do caso CDI)",
    input: {
      id: "diag:lca-indexador-ipca-vencimento",
      rawName: "LCA Banco Teste IPCA+ 2029",
      assetType: "lca",
      issuerName: "Banco Teste",
      currency: "BRL",
      amount: 10000,
    },
    expectedAssetType: "lca",
  },
  {
    id: "LCA-NOME-COMERCIAL",
    category: "lca",
    description: "LCA com nome comercial (\"Agro\"), emissor presente",
    input: {
      id: "diag:lca-nome-comercial",
      rawName: "LCA Agro Banco Teste",
      assetType: "lca",
      issuerName: "Banco Teste",
      currency: "BRL",
      amount: 10000,
    },
    expectedAssetType: "lca",
  },
  {
    id: "LCA-SEM-EMISSOR",
    category: "lca",
    description: "LCA com indexador, mas SEM emissor -- identidade incompleta",
    input: {
      id: "diag:lca-sem-emissor",
      rawName: "LCA CDI",
      assetType: "lca",
      currency: "BRL",
      amount: 10000,
    },
    expectedAssetType: "lca",
  },
  {
    id: "LCA-VARIACAO-ESCRITA",
    category: "lca",
    description: "Mesmo caso completo, todo em minúsculas -- variação de escrita",
    input: {
      id: "diag:lca-variacao-escrita",
      rawName: "lca banco teste cdi 2029",
      assetType: "lca",
      issuerName: "Banco Teste",
      currency: "BRL",
      amount: 10000,
    },
    expectedAssetType: "lca",
  },
  {
    id: "LCA-VARIACAO-CAIXA-ESPACOS",
    category: "lca",
    description: "Mesmo caso completo, caixa alta com espaços extras nas pontas",
    input: {
      id: "diag:lca-variacao-caixa-espacos",
      rawName: " LCA BANCO TESTE CDI 2029 ",
      assetType: "lca",
      issuerName: "Banco Teste",
      currency: "BRL",
      amount: 10000,
    },
    expectedAssetType: "lca",
  },

  // --- TASK-059A: casos ambíguos -- não é claro qual dos três tipos (ou se
  // é renda fixa privada mesmo), sem registryEntity/expectedAssetType de
  // propósito.
  {
    id: "RFPRIV-AMBIGUO-RENDA-FIXA",
    category: "private-fixed-income-ambiguous",
    description: "\"Renda Fixa\" genérica com emissor -- não diz se é CDB, LCI ou LCA",
    input: {
      id: "diag:rfpriv-ambiguo-renda-fixa",
      rawName: "Renda Fixa Banco Teste",
      issuerName: "Banco Teste",
      currency: "BRL",
      amount: 8000,
    },
  },
  {
    id: "RFPRIV-AMBIGUO-PRODUTO-CDI",
    category: "private-fixed-income-ambiguous",
    description: "\"Produto\" genérico com indexador -- sem tipo explícito",
    input: {
      id: "diag:rfpriv-ambiguo-produto-cdi",
      rawName: "Produto Banco Teste CDI",
      issuerName: "Banco Teste",
      currency: "BRL",
      amount: 8000,
    },
  },
  {
    id: "RFPRIV-AMBIGUO-INVESTIMENTO",
    category: "private-fixed-income-ambiguous",
    description: "\"Investimento\" genérico com indexador e vencimento, sem emissor nem tipo",
    input: {
      id: "diag:rfpriv-ambiguo-investimento",
      rawName: "Investimento CDI 2027",
      currency: "BRL",
      amount: 8000,
    },
  },
  {
    id: "RFPRIV-AMBIGUO-TITULO-PRIVADO",
    category: "private-fixed-income-ambiguous",
    description: "\"Título Privado\" genérico com emissor -- sem tipo explícito",
    input: {
      id: "diag:rfpriv-ambiguo-titulo-privado",
      rawName: "Título Privado Banco Teste",
      issuerName: "Banco Teste",
      currency: "BRL",
      amount: 8000,
    },
  },
  {
    id: "RFPRIV-AMBIGUO-SEM-TIPO",
    category: "private-fixed-income-ambiguous",
    description: "Emissor + indexador, mas nenhuma palavra indicando o tipo do produto",
    input: {
      id: "diag:rfpriv-ambiguo-sem-tipo",
      rawName: "Banco Teste 110% CDI",
      issuerName: "Banco Teste",
      currency: "BRL",
      amount: 8000,
    },
  },

  // --- TASK-059A: casos negativos -- contêm "CDB"/"LCI"/"LCA" (ou um
  // indexador típico de renda fixa privada) no nome, mas NÃO são um CDB/LCI/
  // LCA (fundo/ETF/carteira/debênture/COE/Tesouro com nome parecido). Risco
  // de falso positivo mapeado no documento de modelagem: nenhum destes pode
  // nunca resolver como CDB/LCI/LCA verificado.
  {
    id: "RFPRIV-NEGATIVO-FUNDO-CDB",
    category: "private-fixed-income-negative",
    description: "Fundo com \"CDB\" no nome comercial -- não é um CDB direto",
    input: {
      id: "diag:rfpriv-negativo-fundo-cdb",
      rawName: "Fundo CDB",
      currency: "BRL",
      amount: 5000,
    },
  },
  {
    id: "RFPRIV-NEGATIVO-FUNDO-LCI",
    category: "private-fixed-income-negative",
    description: "Fundo com \"LCI\" no nome comercial",
    input: {
      id: "diag:rfpriv-negativo-fundo-lci",
      rawName: "Fundo LCI",
      currency: "BRL",
      amount: 5000,
    },
  },
  {
    id: "RFPRIV-NEGATIVO-FUNDO-LCA",
    category: "private-fixed-income-negative",
    description: "Fundo com \"LCA\" no nome comercial",
    input: {
      id: "diag:rfpriv-negativo-fundo-lca",
      rawName: "Fundo LCA",
      currency: "BRL",
      amount: 5000,
    },
  },
  {
    id: "RFPRIV-NEGATIVO-CARTEIRA-CDB",
    category: "private-fixed-income-negative",
    description: "\"Carteira CDB\" -- nome de produto/estratégia, não um título",
    input: {
      id: "diag:rfpriv-negativo-carteira-cdb",
      rawName: "Carteira CDB",
      currency: "BRL",
      amount: 5000,
    },
  },
  {
    id: "RFPRIV-NEGATIVO-CARTEIRA-LCI",
    category: "private-fixed-income-negative",
    description: "\"Carteira LCI\" -- nome de produto/estratégia, não um título",
    input: {
      id: "diag:rfpriv-negativo-carteira-lci",
      rawName: "Carteira LCI",
      currency: "BRL",
      amount: 5000,
    },
  },
  {
    id: "RFPRIV-NEGATIVO-ETF-RENDA-FIXA",
    category: "private-fixed-income-negative",
    description: "ETF de renda fixa -- não é um título de renda fixa privada direto",
    input: {
      id: "diag:rfpriv-negativo-etf-renda-fixa",
      rawName: "ETF de Renda Fixa",
      currency: "BRL",
      amount: 5000,
    },
  },
  {
    id: "RFPRIV-NEGATIVO-DEBENTURE-CDI",
    category: "private-fixed-income-negative",
    description: "Debênture indexada a CDI -- outro tipo de ativo inteiramente, não CDB/LCI/LCA",
    input: {
      id: "diag:rfpriv-negativo-debenture-cdi",
      rawName: "Debênture CDI Banco Teste",
      currency: "BRL",
      amount: 5000,
    },
  },
  {
    id: "RFPRIV-NEGATIVO-COE-CDI",
    category: "private-fixed-income-negative",
    description: "COE indexado a CDI -- outro tipo de ativo inteiramente",
    input: {
      id: "diag:rfpriv-negativo-coe-cdi",
      rawName: "COE Banco Teste CDI",
      currency: "BRL",
      amount: 5000,
    },
  },
  {
    id: "RFPRIV-NEGATIVO-TESOURO-CDB",
    category: "private-fixed-income-negative",
    description: "\"Tesouro CDB\" -- nome contraditório/comercial, não é nem Tesouro nem CDB de verdade",
    input: {
      id: "diag:rfpriv-negativo-tesouro-cdb",
      rawName: "Tesouro CDB",
      currency: "BRL",
      amount: 5000,
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
