import { describe, expect, it } from "vitest";

import { createAie } from "../application/create-aie";
import { ingestPortfolioCandidate } from "../ingestion/portfolio-candidate-ingestion";
import { B3ListedAssetProvider } from "../providers/b3-listed-assets/b3-listed-asset-provider";

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
}

function buildBaselineEngine() {
  return createAie({});
}

function buildB3Engine() {
  return createAie({ providers: [new B3ListedAssetProvider()] });
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

  const rows: DiagnosticRow[] = [];

  for (const fixture of DIAGNOSTIC_FIXTURES) {
    const candidate = ingestPortfolioCandidate(fixture.input);

    let baselineError: string | undefined;
    let b3Error: string | undefined;

    let baselineResult;
    let b3Result;

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
  }));

  // eslint-disable-next-line no-console -- intentional diagnostic report (TASK-051A/TASK-051B)
  console.table(table);

  const total = rows.length;
  const count = (pass: "baseline" | "afterB3Provider", diagnosis: Diagnosis) =>
    rows.filter((row) => row[pass].diagnosis === diagnosis).length;

  const withTicker = rows.filter((row) => row.tickerPreserved !== "(sem ticker)").length;
  const tickerOk = rows.filter((row) => row.tickerPreserved === "ok").length;

  const newlyResolved = rows.filter(
    (row) => row.baseline.diagnosis !== "resolved_expected" && row.afterB3Provider.diagnosis === "resolved_expected",
  );

  const summary = [
    "",
    "=== TASK-051A/TASK-051B -- resumo do diagnóstico de qualidade de resolução AIE ===",
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
    "-- Depois de B3ListedAssetProvider (TASK-051B, produção real hoje) --",
    `  resolved_expected: ${count("afterB3Provider", "resolved_expected")}`,
    `  needs_more_evidence_expected: ${count("afterB3Provider", "needs_more_evidence_expected")}`,
    `  unexpected_needs_more_evidence: ${count("afterB3Provider", "unexpected_needs_more_evidence")}`,
    `  wrong_type: ${count("afterB3Provider", "wrong_type")}`,
    `  wrong_code: ${count("afterB3Provider", "wrong_code")}`,
    `  unexpected_error: ${count("afterB3Provider", "unexpected_error")}`,
    `  casos que passaram a 'resolved_expected' nesta task: ${newlyResolved.length}` +
      ` (${newlyResolved.map((row) => row.id).join(", ")})`,
    "",
    "-- Padrões de falha principais (restantes) --",
    "  1. CDB/LCI/LCA genéricos e 'Investimento em Renda Fixa' continuam sem",
    "     'verified': não têm ticker/código oficial -- fora do escopo de um",
    "     catálogo por ticker como o B3ListedAssetProvider (TASK-051B).",
    "  2. 'Tesouro Selic'/'Tesouro IPCA+' continuam sem categoria correspondente",
    "     em CandidateAssetType (lib/aie/contracts/candidate-asset.ts) -- fora de",
    "     escopo desta task por decisão explícita.",
    "  3. Um ticker desconhecido (fora do catálogo) continua em",
    "     'needs-more-evidence', nunca em falso positivo -- ver",
    "     'does not resolve an unlisted ticker as verified' em",
    "     asset-resolution-engine.b3-listed-assets.test.ts.",
    "  4. Dados explícitos simples (ticker normalizado) sobrevivem corretamente",
    `     à ingestão em todos os casos testados (${tickerOk}/${withTicker} casos com` +
      " ticker chegam normalizados sem perda).",
    "",
    "-- Candidatos prioritários para a próxima task --",
    "  a. Cobertura de Tesouro Direto: exige categoria própria em",
    "     CandidateAssetType e plano de busca (fora do escopo da TASK-051B).",
    "  b. Renda fixa genérica (CDB/LCI/LCA) sem código oficial: exige uma fonte",
    "     de evidência diferente de um catálogo por ticker (ex.: por emissor).",
    "  c. Ampliar o catálogo de B3ListedAssetProvider para mais tickers, como",
    "     decisão de produto explícita -- nunca crescimento silencioso.",
    "",
  ].join("\n");

  // eslint-disable-next-line no-console -- intentional diagnostic report (TASK-051A/TASK-051B)
  console.log(summary);
}

describe("TASK-051A -- diagnóstico de qualidade de resolução AIE", () => {
  it("o resolver não lança exceção para nenhum caso da bateria de diagnóstico", async () => {
    const rows = await runAllFixtures();

    for (const row of rows) {
      expect(row.baseline.diagnosis, `${row.id} (baseline)`).not.toBe("unexpected_error");
      expect(row.afterB3Provider.diagnosis, `${row.id} (afterB3Provider)`).not.toBe("unexpected_error");
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
});
