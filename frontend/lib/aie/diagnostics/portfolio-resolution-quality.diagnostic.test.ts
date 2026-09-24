import { describe, expect, it } from "vitest";

import { createAie } from "../application/create-aie";
import { ingestPortfolioCandidate } from "../ingestion/portfolio-candidate-ingestion";
import { B3ListedAssetProvider } from "../providers/b3-listed-assets/b3-listed-asset-provider";
import { TesouroDiretoProvider } from "../providers/tesouro-direto/tesouro-direto-provider";

import type { DiagnosticFixture } from "./portfolio-resolution-quality.fixtures";
import { DIAGNOSTIC_FIXTURES } from "./portfolio-resolution-quality.fixtures";

/**
 * TASK-051A (baseline) + TASK-051B (updated baseline) -- diagnostic only.
 * Never asserts that resolution quality is "good" across the board; it maps
 * where the resolver lands for a realistic battery of common assets. Nothing
 * here touches production LOGIC: it composes the same public building block
 * `lib/aie/application/create-aie.ts` the existing tests already use (see
 * `asset-resolution-engine.test.ts`), the second pass now mirroring real
 * production wiring after TASK-051B
 * (`lib/aie/application/create-aie-from-env.ts` always registers
 * `B3ListedAssetProvider`).
 *
 * Two passes per fixture, both against the REAL, unmodified
 * `AssetResolutionEngine`/`VerificationPolicy`/`ResolutionPlanner`:
 *
 *  - "baseline": zero providers registered -- the TASK-051A snapshot, kept
 *    unchanged on purpose so the improvement is visible in the same report.
 *    Functionally identical to production WITHOUT ANBIMA credentials, and to
 *    production WITH them for every fixture here, since none is a debenture.
 *  - "afterB3Provider": the same engine, plus the real
 *    `B3ListedAssetProvider` (TASK-051B) -- i.e. today's actual production
 *    wiring for every fixture in this battery. This is "what a user gets
 *    today", not a hypothetical.
 */

type Diagnosis =
  | "resolved_expected"
  | "needs_more_evidence_expected"
  | "unexpected_needs_more_evidence"
  | "wrong_type"
  | "wrong_code"
  | "missing_explicit_data"
  | "unexpected_error";

interface PassOutcome {
  status: string;
  nextAction: string;
  unresolvedFields: readonly string[];
  identitySupported: boolean;
  verifiedAssetType: string | null;
  verifiedCanonicalId: string | null;
  diagnosis: Diagnosis;
  error?: string;
}

interface DiagnosticRow {
  id: string;
  category: string;
  rawName: string;
  expectedAssetType: string;
  tickerPreserved: string;
  baseline: PassOutcome;
  afterB3Provider: PassOutcome;
  afterTesouroProvider: PassOutcome;
}

function buildBaselineEngine() {
  return createAie({});
}

function buildB3Engine() {
  return createAie({ providers: [new B3ListedAssetProvider()] });
}

// TASK-058B: today's REAL production wiring
// (lib/aie/application/create-aie-from-env.ts) -- B3ListedAssetProvider AND
// TesouroDiretoProvider both registered. Kept as its OWN pass, separate from
// "afterB3Provider" above, so every existing assertion about that pass (B3
// coverage, CDB/LCI/LCA/Tesouro-without-vencimento staying pending, etc.)
// stays literally unchanged and still means exactly what it always meant.
function buildFullEngine() {
  return createAie({ providers: [new B3ListedAssetProvider(), new TesouroDiretoProvider()] });
}

/**
 * Classifies one pass's result. This function encodes the diagnostic
 * judgement, never the resolver's own logic -- it is read-only over the
 * result the real engine already produced.
 */
function classify(
  fixture: DiagnosticFixture,
  status: string,
  verifiedAssetType: string | null,
): Diagnosis {
  if (status === "verified") {
    if (fixture.expectedAssetType && verifiedAssetType !== fixture.expectedAssetType) {
      return "wrong_type";
    }
    return "resolved_expected";
  }

  // Nothing in the current architecture can ever reach "verified" for a
  // non-debenture asset (see the module docstring and the diagnostic
  // summary below) -- so, for every fixture in this battery,
  // "needs-more-evidence" today IS the expected, correct-per-the-current-
  // system outcome, not a surprise. This still counts as an opportunity
  // for TASK-051B: it is recorded, never hidden, by the summary counters.
  return "needs_more_evidence_expected";
}

async function runAllFixtures(): Promise<DiagnosticRow[]> {
  const baselineEngine = buildBaselineEngine();
  const b3Engine = buildB3Engine();
  const fullEngine = buildFullEngine();

  const rows: DiagnosticRow[] = [];

  for (const fixture of DIAGNOSTIC_FIXTURES) {
    const candidate = ingestPortfolioCandidate(fixture.input);

    let baselineError: string | undefined;
    let b3Error: string | undefined;
    let fullError: string | undefined;

    let baselineResult;
    let b3Result;
    let fullResult;

    try {
      baselineResult = await baselineEngine.resolve({
        candidateAsset: candidate,
        now: "2026-09-23T12:00:00.000Z",
      });
    } catch (error) {
      baselineError = error instanceof Error ? error.message : String(error);
    }

    try {
      b3Result = await b3Engine.resolve({
        candidateAsset: candidate,
        now: "2026-09-23T12:00:00.000Z",
      });
    } catch (error) {
      b3Error = error instanceof Error ? error.message : String(error);
    }

    try {
      fullResult = await fullEngine.resolve({
        candidateAsset: candidate,
        now: "2026-09-23T12:00:00.000Z",
      });
    } catch (error) {
      fullError = error instanceof Error ? error.message : String(error);
    }

    const toOutcome = (
      result: Awaited<ReturnType<typeof baselineEngine.resolve>> | undefined,
      error: string | undefined,
    ): PassOutcome => {
      if (error !== undefined || !result) {
        return {
          status: "error",
          nextAction: "error",
          unresolvedFields: [],
          identitySupported: false,
          verifiedAssetType: null,
          verifiedCanonicalId: null,
          diagnosis: "unexpected_error",
          error,
        };
      }

      const verifiedAssetType = result.verifiedAsset?.assetType ?? null;

      return {
        status: result.status,
        nextAction: result.nextAction,
        unresolvedFields: result.investigation.unresolvedFields,
        identitySupported: result.investigation.evidence.some((item) => item.field === "identity"),
        verifiedAssetType,
        verifiedCanonicalId: result.verifiedAsset?.canonicalAssetId ?? null,
        diagnosis: classify(fixture, result.status, verifiedAssetType),
      };
    };

    rows.push({
      id: fixture.id,
      category: fixture.category,
      rawName: fixture.input.rawName,
      expectedAssetType: fixture.expectedAssetType ?? "(sem categoria hoje)",
      tickerPreserved:
        fixture.input.ticker === undefined
          ? "(sem ticker)"
          : candidate.hints.ticker === fixture.input.ticker.trim().toUpperCase()
            ? "ok"
            : `PERDIDO (esperado ${fixture.input.ticker.trim().toUpperCase()}, obteve ${candidate.hints.ticker ?? "undefined"})`,
      baseline: toOutcome(baselineResult, baselineError),
      afterB3Provider: toOutcome(b3Result, b3Error),
      afterTesouroProvider: toOutcome(fullResult, fullError),
    });
  }

  return rows;
}

function printReport(rows: DiagnosticRow[]): void {
  const table = rows.map((row) => ({
    id: row.id,
    category: row.category,
    rawName: row.rawName,
    expectedType: row.expectedAssetType,
    ticker: row.tickerPreserved,
    "baseline.status": row.baseline.status,
    "baseline.diagnosis": row.baseline.diagnosis,
    "afterB3.status": row.afterB3Provider.status,
    "afterB3.unresolvedFields": row.afterB3Provider.unresolvedFields.join("+"),
    "afterB3.diagnosis": row.afterB3Provider.diagnosis,
    "afterTesouro.status": row.afterTesouroProvider.status,
    "afterTesouro.unresolvedFields": row.afterTesouroProvider.unresolvedFields.join("+"),
    "afterTesouro.diagnosis": row.afterTesouroProvider.diagnosis,
  }));

  // eslint-disable-next-line no-console -- intentional diagnostic report (TASK-051A/TASK-051B/TASK-058B)
  console.table(table);

  const total = rows.length;
  const count = (pass: "baseline" | "afterB3Provider" | "afterTesouroProvider", diagnosis: Diagnosis) =>
    rows.filter((row) => row[pass].diagnosis === diagnosis).length;

  const withTicker = rows.filter((row) => row.tickerPreserved !== "(sem ticker)").length;
  const tickerOk = rows.filter((row) => row.tickerPreserved === "ok").length;

  const newlyResolved = rows.filter(
    (row) => row.baseline.diagnosis !== "resolved_expected" && row.afterB3Provider.diagnosis === "resolved_expected",
  );

  const newlyResolvedByTesouro = rows.filter(
    (row) =>
      row.afterB3Provider.diagnosis !== "resolved_expected" &&
      row.afterTesouroProvider.diagnosis === "resolved_expected",
  );

  const summary = [
    "",
    "=== TASK-051A/TASK-051B/TASK-058B -- resumo do diagnóstico de qualidade de resolução AIE ===",
    `Total de casos: ${total}`,
    "",
    "-- Baseline (TASK-051A, sem nenhum provider primary para estes casos) --",
    `  resolved_expected: ${count("baseline", "resolved_expected")}`,
    `  needs_more_evidence_expected: ${count("baseline", "needs_more_evidence_expected")}`,
    `  unexpected_needs_more_evidence: ${count("baseline", "unexpected_needs_more_evidence")}`,
    `  wrong_type: ${count("baseline", "wrong_type")}`,
    `  wrong_code: ${count("baseline", "wrong_code")}`,
    `  unexpected_error: ${count("baseline", "unexpected_error")}`,
    "",
    "-- Depois de B3ListedAssetProvider (TASK-051B) --",
    `  resolved_expected: ${count("afterB3Provider", "resolved_expected")}`,
    `  needs_more_evidence_expected: ${count("afterB3Provider", "needs_more_evidence_expected")}`,
    `  unexpected_needs_more_evidence: ${count("afterB3Provider", "unexpected_needs_more_evidence")}`,
    `  wrong_type: ${count("afterB3Provider", "wrong_type")}`,
    `  wrong_code: ${count("afterB3Provider", "wrong_code")}`,
    `  unexpected_error: ${count("afterB3Provider", "unexpected_error")}`,
    `  casos que passaram a 'resolved_expected' nesta task: ${newlyResolved.length}` +
      ` (${newlyResolved.map((row) => row.id).join(", ")})`,
    "",
    "-- Depois de B3ListedAssetProvider + TesouroDiretoProvider (TASK-058B, produção real hoje) --",
    `  resolved_expected: ${count("afterTesouroProvider", "resolved_expected")}`,
    `  needs_more_evidence_expected: ${count("afterTesouroProvider", "needs_more_evidence_expected")}`,
    `  unexpected_needs_more_evidence: ${count("afterTesouroProvider", "unexpected_needs_more_evidence")}`,
    `  wrong_type: ${count("afterTesouroProvider", "wrong_type")}`,
    `  wrong_code: ${count("afterTesouroProvider", "wrong_code")}`,
    `  unexpected_error: ${count("afterTesouroProvider", "unexpected_error")}`,
    `  casos que passaram a 'resolved_expected' nesta task: ${newlyResolvedByTesouro.length}` +
      ` (${newlyResolvedByTesouro.map((row) => row.id).join(", ")})`,
    "",
    "-- Padrões de falha principais (restantes) --",
    "  1. CDB/LCI/LCA genéricos e 'Investimento em Renda Fixa' continuam sem",
    "     'verified': não têm ticker/código oficial -- fora do escopo de um",
    "     catálogo por ticker como o B3ListedAssetProvider (TASK-051B).",
    "  2. Tesouro Direto SEM vencimento no nome ('Tesouro Selic', 'Tesouro",
    "     IPCA+', 'Tesouro Prefixado', 'Tesouro Direto', 'Título Público')",
    "     continua sem categoria verificável, por decisão explícita da",
    "     TASK-058A/TASK-058B: nome de família, não de título específico.",
    "     Tesouro COM vencimento catalogado (8 títulos, TASK-058B) já",
    "     resolve -- ver TesouroDiretoProvider",
    "     (lib/aie/providers/tesouro-direto).",
    "  3. Um ticker desconhecido (fora do catálogo) continua em",
    "     'needs-more-evidence', nunca em falso positivo -- ver",
    "     'does not resolve an unlisted ticker as verified' em",
    "     asset-resolution-engine.b3-listed-assets.test.ts.",
    "  4. Dados explícitos simples (ticker normalizado) sobrevivem corretamente",
    `     à ingestão em todos os casos testados (${tickerOk}/${withTicker} casos com` +
      " ticker chegam normalizados sem perda).",
    "",
    "-- Candidatos prioritários para a próxima task --",
    "  a. Expandir o catálogo de TesouroDiretoProvider para mais títulos com",
    "     vencimento, como decisão de produto explícita -- nunca crescimento",
    "     silencioso (mesma regra do catálogo B3).",
    "  b. Renda fixa genérica (CDB/LCI/LCA) sem código oficial: exige uma fonte",
    "     de evidência diferente de um catálogo por ticker (ex.: por emissor).",
    "  c. Ampliar o catálogo de B3ListedAssetProvider para mais tickers, como",
    "     decisão de produto explícita -- nunca crescimento silencioso.",
    "",
  ].join("\n");

  // eslint-disable-next-line no-console -- intentional diagnostic report (TASK-051A/TASK-051B/TASK-058B)
  console.log(summary);
}

const treasuryFixtureIds = DIAGNOSTIC_FIXTURES.filter((fixture) => fixture.category === "treasury").map(
  (fixture) => fixture.id,
);

describe("TASK-051A -- diagnóstico de qualidade de resolução AIE", () => {
  it("o resolver não lança exceção para nenhum caso da bateria de diagnóstico", async () => {
    const rows = await runAllFixtures();

    for (const row of rows) {
      expect(row.baseline.diagnosis, `${row.id} (baseline)`).not.toBe("unexpected_error");
      expect(row.afterB3Provider.diagnosis, `${row.id} (afterB3Provider)`).not.toBe("unexpected_error");
      expect(row.afterTesouroProvider.diagnosis, `${row.id} (afterTesouroProvider)`).not.toBe("unexpected_error");
    }
  });

  it("toda linha de entrada produz exatamente um resultado, na mesma ordem", async () => {
    const rows = await runAllFixtures();

    expect(rows).toHaveLength(DIAGNOSTIC_FIXTURES.length);
    expect(rows.map((row) => row.id)).toEqual(DIAGNOSTIC_FIXTURES.map((fixture) => fixture.id));
  });

  it("ticker explícito e normalizado nunca desaparece na ingestão", async () => {
    const rows = await runAllFixtures();

    for (const row of rows) {
      if (row.tickerPreserved === "(sem ticker)") {
        continue;
      }
      expect(row.tickerPreserved, row.id).toBe("ok");
    }
  });

  it("o diagnóstico é determinístico (duas execuções produzem o mesmo resultado)", async () => {
    const first = await runAllFixtures();
    const second = await runAllFixtures();

    const strip = (rows: DiagnosticRow[]) =>
      rows.map((row) => ({
        id: row.id,
        baselineStatus: row.baseline.status,
        baselineDiagnosis: row.baseline.diagnosis,
        afterB3Status: row.afterB3Provider.status,
        afterB3Diagnosis: row.afterB3Provider.diagnosis,
      }));

    expect(strip(first)).toEqual(strip(second));
  });

  it("produz e imprime o relatório de diagnóstico (TASK-051A/TASK-051B)", async () => {
    const rows = await runAllFixtures();

    printReport(rows);

    // Invariante fraca, só para o teste ter uma asserção própria: o relatório
    // cobre a bateria inteira.
    expect(rows.length).toBeGreaterThan(0);
  });

  it("TASK-051B: os 8 ativos listados cobertos pelo catálogo passam a resolved_expected", async () => {
    const rows = await runAllFixtures();

    const coveredIds = [
      "PETR4",
      "VALE3",
      "ITUB4",
      "HGLG11",
      "KNRI11",
      "BOVA11",
      "IVVB11",
      "AAPL34",
    ];

    for (const id of coveredIds) {
      const row = rows.find((candidate) => candidate.id === id);

      expect(row, id).toBeDefined();
      expect(row?.afterB3Provider.status, id).toBe("verified");
      expect(row?.afterB3Provider.diagnosis, id).toBe("resolved_expected");
    }
  });

  it("TASK-051B: Tesouro, renda fixa genérica e nomes sem ticker continuam sem falso positivo", async () => {
    const rows = await runAllFixtures();

    const stillPendingIds = [
      "CDB-GENERICO",
      "LCI-GENERICO",
      "LCA-GENERICO",
      "TESOURO-SELIC",
      "TESOURO-IPCA",
      "AMBIGUO-SEM-TICKER",
      "AMBIGUO-NOME-GENERICO",
    ];

    for (const id of stillPendingIds) {
      const row = rows.find((candidate) => candidate.id === id);

      expect(row, id).toBeDefined();
      expect(row?.afterB3Provider.status, id).not.toBe("verified");
    }
  });

  it("TASK-051C: ativos B3 catalogados resolvem mesmo SEM assetType explícito (CSV básico)", async () => {
    const rows = await runAllFixtures();

    const coveredWithoutAssetType = [
      "SEMTIPO-PETR4",
      "SEMTIPO-HGLG11",
      "SEMTIPO-BOVA11",
      "SEMTIPO-AAPL34",
    ];

    for (const id of coveredWithoutAssetType) {
      const row = rows.find((candidate) => candidate.id === id);

      expect(row, id).toBeDefined();
      expect(row?.afterB3Provider.status, id).toBe("verified");
      expect(row?.afterB3Provider.diagnosis, id).toBe("resolved_expected");
    }
  });

  it("TASK-051C: CDB/Tesouro sem assetType continuam sem falso positivo (nunca viram B3 por engano)", async () => {
    const rows = await runAllFixtures();

    const stillPendingWithoutAssetType = ["SEMTIPO-CDB-GENERICO", "SEMTIPO-TESOURO-SELIC"];

    for (const id of stillPendingWithoutAssetType) {
      const row = rows.find((candidate) => candidate.id === id);

      expect(row, id).toBeDefined();
      expect(row?.afterB3Provider.status, id).not.toBe("verified");
    }
  });

  it("TASK-051C (correção pós-smoke): ativos B3 resolvem só com rawName, sem coluna ticker", async () => {
    const rows = await runAllFixtures();

    const rawNameOnlyIds = [
      "SOMENTE-RAWNAME-PETR4",
      "SOMENTE-RAWNAME-HGLG11",
      "SOMENTE-RAWNAME-BOVA11",
      "SOMENTE-RAWNAME-AAPL34",
    ];

    for (const id of rawNameOnlyIds) {
      const row = rows.find((candidate) => candidate.id === id);

      expect(row, id).toBeDefined();
      expect(row?.afterB3Provider.status, id).toBe("verified");
      expect(row?.afterB3Provider.diagnosis, id).toBe("resolved_expected");
    }
  });

  it("TASK-052: amostra do catálogo B3 expandido resolve a partir de rawName sozinho", async () => {
    const rows = await runAllFixtures();

    const expandedCoveredIds = [
      "EXPANDIDO-ABEV3",
      "EXPANDIDO-B3SA3",
      "EXPANDIDO-BBAS3",
      "EXPANDIDO-WEGE3",
      "EXPANDIDO-MXRF11",
      "EXPANDIDO-XPML11",
      "EXPANDIDO-BTLG11",
      "EXPANDIDO-SMAL11",
      "EXPANDIDO-HASH11",
      "EXPANDIDO-MSFT34",
      "EXPANDIDO-TSLA34",
    ];

    for (const id of expandedCoveredIds) {
      const row = rows.find((candidate) => candidate.id === id);

      expect(row, id).toBeDefined();
      expect(row?.afterB3Provider.status, id).toBe("verified");
      expect(row?.afterB3Provider.diagnosis, id).toBe("resolved_expected");
    }
  });

  it("TASK-052: um ticker plausível mas não catalogado (PETR5) continua pendente, nunca falso positivo", async () => {
    const rows = await runAllFixtures();

    const row = rows.find((candidate) => candidate.id === "EXPANDIDO-NEGATIVO-PETR5");

    expect(row).toBeDefined();
    expect(row?.afterB3Provider.status).not.toBe("verified");
  });

  describe("TASK-058A -- diagnóstico e modelagem de Tesouro Direto", () => {
    /**
     * Diagnóstico apenas -- ver
     * docs/tasks/task-058a-tesouro-direto-diagnostics.md. Esta task NÃO deve
     * aumentar o número de Tesouros verificados em produção: todo caso
     * `category === "treasury"` (com vencimento, sem vencimento, variação de
     * escrita ou negativo) tem que continuar `needs-more-evidence` no
     * `baseline` e no `afterB3Provider` (o pass que representava a produção
     * real NA ÉPOCA da TASK-058A -- sem nenhum provider que verificasse
     * Tesouro). Isso continua verdadeiro e intocado por esta task.
     *
     * TASK-058B (describe abaixo) adiciona um TERCEIRO pass,
     * `afterTesouroProvider`, que representa a produção real de HOJE
     * (B3ListedAssetProvider + TesouroDiretoProvider) -- é só nesse pass
     * que os 8 títulos catalogados (e as variações de escrita que
     * normalizam para eles) passam a `resolved_expected`.
     */
    it("a bateria de Tesouro tem entre 15 e 25 fixtures novas além das duas originais da TASK-051A", async () => {
      // TESOURO-SELIC e TESOURO-IPCA já existiam antes da TASK-058A.
      const newFixtures = treasuryFixtureIds.length - 2;

      expect(newFixtures).toBeGreaterThanOrEqual(15);
      expect(newFixtures).toBeLessThanOrEqual(25);
    });

    it("nenhum caso de Tesouro (com ou sem vencimento, variação de escrita ou negativo) resolve como verificado, em nenhuma das duas passagens", async () => {
      const rows = await runAllFixtures();

      for (const id of treasuryFixtureIds) {
        const row = rows.find((candidate) => candidate.id === id);

        expect(row, id).toBeDefined();
        expect(row?.baseline.status, `${id} (baseline)`).not.toBe("verified");
        expect(row?.afterB3Provider.status, `${id} (afterB3Provider)`).not.toBe("verified");
      }
    });

    it("nenhum caso de Tesouro produz wrong_type, wrong_code ou unexpected_error", async () => {
      const rows = await runAllFixtures();
      const forbidden = new Set(["wrong_type", "wrong_code", "unexpected_error"]);

      for (const id of treasuryFixtureIds) {
        const row = rows.find((candidate) => candidate.id === id);

        expect(row, id).toBeDefined();
        expect(forbidden.has(row!.baseline.diagnosis), `${id} (baseline): ${row!.baseline.diagnosis}`).toBe(false);
        expect(
          forbidden.has(row!.afterB3Provider.diagnosis),
          `${id} (afterB3Provider): ${row!.afterB3Provider.diagnosis}`,
        ).toBe(false);
      }
    });

    it("casos com vencimento explícito no nome continuam pendentes nesta task (não é evidência suficiente hoje)", async () => {
      const rows = await runAllFixtures();

      const withMaturityInName = [
        "TESOURO-SELIC-2029",
        "TESOURO-SELIC-2031",
        "TESOURO-IPCA-2035",
        "TESOURO-IPCA-2045",
        "TESOURO-IPCA-JS-2040",
        "TESOURO-PREFIXADO-2027",
        "TESOURO-PREFIXADO-2031",
        "TESOURO-PREFIXADO-JS-2035",
      ];

      for (const id of withMaturityInName) {
        const row = rows.find((candidate) => candidate.id === id);

        expect(row, id).toBeDefined();
        expect(row?.afterB3Provider.status, id).not.toBe("verified");
      }
    });

    it("casos sem vencimento (nome de família/programa, não de título específico) continuam pendentes", async () => {
      const rows = await runAllFixtures();

      const withoutMaturity = ["TESOURO-SELIC", "TESOURO-IPCA", "TESOURO-PREFIXADO", "TESOURO-DIRETO-GENERICO", "TITULO-PUBLICO-GENERICO"];

      for (const id of withoutMaturity) {
        const row = rows.find((candidate) => candidate.id === id);

        expect(row, id).toBeDefined();
        expect(row?.afterB3Provider.status, id).not.toBe("verified");
      }
    });

    it("variações de escrita (caixa, acentos, espaço no '+', sufixo) não causam erro nem falso positivo", async () => {
      const rows = await runAllFixtures();

      const writingVariations = [
        "TESOURO-VARIACAO-MINUSCULO",
        "TESOURO-VARIACAO-CAIXA-ALTA-ESPACOS",
        "TESOURO-VARIACAO-ESPACO-NO-SINAL",
        "TESOURO-VARIACAO-JUROS-MINUSCULO",
        "TESOURO-VARIACAO-SUFIXO-LFT",
      ];

      for (const id of writingVariations) {
        const row = rows.find((candidate) => candidate.id === id);

        expect(row, id).toBeDefined();
        expect(row?.afterB3Provider.diagnosis, id).not.toBe("unexpected_error");
        expect(row?.afterB3Provider.status, id).not.toBe("verified");
      }
    });

    it("casos negativos (Fundo/ETF/Carteira/CDB/LCI com 'Tesouro' no nome) nunca resolvem como Tesouro verificado", async () => {
      const rows = await runAllFixtures();

      const negatives = [
        "TESOURO-NEGATIVO-FUNDO",
        "TESOURO-NEGATIVO-ETF",
        "TESOURO-NEGATIVO-CARTEIRA",
        "TESOURO-NEGATIVO-CDB",
        "TESOURO-NEGATIVO-LCI",
        "TESOURO-NEGATIVO-RENDA-FIXA",
      ];

      for (const id of negatives) {
        const row = rows.find((candidate) => candidate.id === id);

        expect(row, id).toBeDefined();
        expect(row?.afterB3Provider.status, id).not.toBe("verified");
      }
    });

    it("o relatório diagnóstico identifica os casos de Tesouro pela categoria 'treasury'", async () => {
      const rows = await runAllFixtures();

      const treasuryRows = rows.filter((row) => row.category === "treasury");

      expect(treasuryRows.length).toBe(treasuryFixtureIds.length);
      expect(treasuryRows.every((row) => row.category === "treasury")).toBe(true);
    });
  });

  describe("TASK-058B -- TesouroDiretoProvider: catalogados COM vencimento passam a resolved_expected", () => {
    // Os 8 títulos catalogados (docs/tasks/task-058a-tesouro-direto-diagnostics.md).
    const cataloguedWithMaturity = [
      "TESOURO-SELIC-2029",
      "TESOURO-SELIC-2031",
      "TESOURO-IPCA-2035",
      "TESOURO-IPCA-2045",
      "TESOURO-IPCA-JS-2040",
      "TESOURO-PREFIXADO-2027",
      "TESOURO-PREFIXADO-2031",
      "TESOURO-PREFIXADO-JS-2035",
    ];

    // As 5 variações de escrita normalizam para um dos 8 títulos acima (ou
    // para o alias "(LFT)" do TESOURO-SELIC-2029) -- a normalização é a
    // MESMA função que o provider usa para o nome canônico, então elas
    // passam a resolver também, não por acidente.
    const writingVariationsNowResolved = [
      "TESOURO-VARIACAO-MINUSCULO",
      "TESOURO-VARIACAO-CAIXA-ALTA-ESPACOS",
      "TESOURO-VARIACAO-ESPACO-NO-SINAL",
      "TESOURO-VARIACAO-JUROS-MINUSCULO",
      "TESOURO-VARIACAO-SUFIXO-LFT",
    ];

    it("os 8 títulos catalogados com vencimento passam a resolved_expected (afterTesouroProvider)", async () => {
      const rows = await runAllFixtures();

      for (const id of cataloguedWithMaturity) {
        const row = rows.find((candidate) => candidate.id === id);

        expect(row, id).toBeDefined();
        expect(row?.afterTesouroProvider.status, id).toBe("verified");
        expect(row?.afterTesouroProvider.diagnosis, id).toBe("resolved_expected");
        expect(row?.afterTesouroProvider.verifiedAssetType, id).toBe("treasury");
      }
    });

    it("as 5 variações de escrita suportadas também passam a resolved_expected (mesma normalização do provider)", async () => {
      const rows = await runAllFixtures();

      for (const id of writingVariationsNowResolved) {
        const row = rows.find((candidate) => candidate.id === id);

        expect(row, id).toBeDefined();
        expect(row?.afterTesouroProvider.status, id).toBe("verified");
        expect(row?.afterTesouroProvider.diagnosis, id).toBe("resolved_expected");
      }
    });

    it("casos sem vencimento continuam pendentes mesmo com o novo provider registrado", async () => {
      const rows = await runAllFixtures();

      const withoutMaturity = [
        "TESOURO-SELIC",
        "TESOURO-IPCA",
        "TESOURO-PREFIXADO",
        "TESOURO-DIRETO-GENERICO",
        "TITULO-PUBLICO-GENERICO",
      ];

      for (const id of withoutMaturity) {
        const row = rows.find((candidate) => candidate.id === id);

        expect(row, id).toBeDefined();
        expect(row?.afterTesouroProvider.status, id).not.toBe("verified");
      }
    });

    it("casos negativos (Fundo/ETF/Carteira/CDB/LCI/LCA/Renda Fixa) continuam pendentes mesmo com o novo provider registrado", async () => {
      const rows = await runAllFixtures();

      const negatives = [
        "TESOURO-NEGATIVO-FUNDO",
        "TESOURO-NEGATIVO-ETF",
        "TESOURO-NEGATIVO-CARTEIRA",
        "TESOURO-NEGATIVO-CDB",
        "TESOURO-NEGATIVO-LCI",
        "TESOURO-NEGATIVO-RENDA-FIXA",
      ];

      for (const id of negatives) {
        const row = rows.find((candidate) => candidate.id === id);

        expect(row, id).toBeDefined();
        expect(row?.afterTesouroProvider.status, id).not.toBe("verified");
      }
    });

    it("um ano de vencimento não catalogado (uncatalogued) continua pendente, nunca falso positivo", async () => {
      const rows = await runAllFixtures();
      // TESOURO-SELIC/TESOURO-IPCA (TASK-051A, sem vencimento) já cobertos
      // acima; aqui a garantia é sobre o restante da bateria: nenhum outro
      // caso de Tesouro, além dos 13 explicitamente listados, resolve.
      const resolvedIds = new Set([...cataloguedWithMaturity, ...writingVariationsNowResolved]);

      for (const id of treasuryFixtureIds) {
        if (resolvedIds.has(id)) {
          continue;
        }
        const row = rows.find((candidate) => candidate.id === id);

        expect(row, id).toBeDefined();
        expect(row?.afterTesouroProvider.status, id).not.toBe("verified");
      }
    });

    it("nenhum caso de Tesouro produz wrong_type, wrong_code ou unexpected_error no pass afterTesouroProvider", async () => {
      const rows = await runAllFixtures();
      const forbidden = new Set(["wrong_type", "wrong_code", "unexpected_error"]);

      for (const id of treasuryFixtureIds) {
        const row = rows.find((candidate) => candidate.id === id);

        expect(row, id).toBeDefined();
        expect(
          forbidden.has(row!.afterTesouroProvider.diagnosis),
          `${id} (afterTesouroProvider): ${row!.afterTesouroProvider.diagnosis}`,
        ).toBe(false);
      }
    });

    it("cobertura B3 não regrediu com o novo provider registrado", async () => {
      const rows = await runAllFixtures();

      const b3CoveredIds = ["PETR4", "VALE3", "ITUB4", "HGLG11", "KNRI11", "BOVA11", "IVVB11", "AAPL34"];

      for (const id of b3CoveredIds) {
        const row = rows.find((candidate) => candidate.id === id);

        expect(row, id).toBeDefined();
        expect(row?.afterTesouroProvider.status, id).toBe("verified");
        expect(row?.afterTesouroProvider.diagnosis, id).toBe("resolved_expected");
      }
    });
  });
});
