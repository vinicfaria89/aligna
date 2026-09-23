import { describe, expect, it } from "vitest";

import { createAie } from "../application/create-aie";
import { ingestPortfolioCandidate } from "../ingestion/portfolio-candidate-ingestion";
import { RegistryProvider } from "../providers";
import { EntityRegistryLoader } from "../registry";

import type { DiagnosticFixture } from "./portfolio-resolution-quality.fixtures";
import { DIAGNOSTIC_FIXTURES } from "./portfolio-resolution-quality.fixtures";

/**
 * TASK-051A -- diagnostic only. Never asserts that resolution quality is
 * "good"; it maps where the CURRENT resolver lands for a realistic battery
 * of common assets, so TASK-051B can be scoped from real evidence instead of
 * guesses. Nothing here touches production code: it composes the same
 * public building blocks `lib/aie/application/create-aie.ts` and the
 * existing tests already use (see `asset-resolution-engine.test.ts`).
 *
 * Two passes per fixture, both against the REAL, unmodified
 * `AssetResolutionEngine`/`VerificationPolicy`/`ResolutionPlanner`:
 *
 *  - "baseline": zero providers registered -- exactly `createAieFromEnv`'s
 *    production wiring when no ANBIMA credentials are set
 *    (lib/aie/application/create-aie-from-env.ts), and functionally
 *    identical to production WITH credentials for every fixture here, since
 *    none of them are debentures and ANBIMA only ever answers debenture
 *    queries. This is "what a user gets today".
 *  - "withRegistry": the same engine, plus a `RegistryProvider` backed by a
 *    TEST-ONLY registry seeded with the fixtures' `registryEntity` data --
 *    i.e. "what would happen if a registry of common assets existed,
 *    changing nothing else". The gap between the two passes tells TASK-051B
 *    how much is a DATA problem (no registry) versus an ARCHITECTURE
 *    problem (see the "registry evidence can never verify" finding below).
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
  withRegistry: PassOutcome;
}

function buildBaselineEngine() {
  return createAie({});
}

function buildRegistryEngine(fixtures: readonly DiagnosticFixture[]) {
  const entities = fixtures
    .map((fixture) => fixture.registryEntity)
    .filter((entity): entity is NonNullable<typeof entity> => entity !== undefined);

  const registry = new EntityRegistryLoader().load(entities);

  return createAie({ providers: [new RegistryProvider(registry)] });
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
  const registryEngine = buildRegistryEngine(DIAGNOSTIC_FIXTURES);

  const rows: DiagnosticRow[] = [];

  for (const fixture of DIAGNOSTIC_FIXTURES) {
    const candidate = ingestPortfolioCandidate(fixture.input);

    let baselineError: string | undefined;
    let registryError: string | undefined;

    let baselineResult;
    let registryResult;

    try {
      baselineResult = await baselineEngine.resolve({
        candidateAsset: candidate,
        now: "2026-09-23T12:00:00.000Z",
      });
    } catch (error) {
      baselineError = error instanceof Error ? error.message : String(error);
    }

    try {
      registryResult = await registryEngine.resolve({
        candidateAsset: candidate,
        now: "2026-09-23T12:00:00.000Z",
      });
    } catch (error) {
      registryError = error instanceof Error ? error.message : String(error);
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
      withRegistry: toOutcome(registryResult, registryError),
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
    "registry.status": row.withRegistry.status,
    "registry.identitySupported": row.withRegistry.identitySupported,
    "registry.unresolvedFields": row.withRegistry.unresolvedFields.join("+"),
    "registry.diagnosis": row.withRegistry.diagnosis,
  }));

  // eslint-disable-next-line no-console -- intentional diagnostic report (TASK-051A)
  console.table(table);

  const total = rows.length;
  const count = (pass: "baseline" | "withRegistry", diagnosis: Diagnosis) =>
    rows.filter((row) => row[pass].diagnosis === diagnosis).length;

  const identitySupportedByRegistry = rows.filter((row) => row.withRegistry.identitySupported).length;
  const withTicker = rows.filter((row) => row.tickerPreserved !== "(sem ticker)").length;
  const tickerOk = rows.filter((row) => row.tickerPreserved === "ok").length;

  const summary = [
    "",
    "=== TASK-051A -- resumo do diagnóstico de qualidade de resolução AIE ===",
    `Total de casos: ${total}`,
    "",
    "-- Baseline (produção hoje, sem credenciais ANBIMA relevantes para estes casos) --",
    `  resolved_expected: ${count("baseline", "resolved_expected")}`,
    `  needs_more_evidence_expected: ${count("baseline", "needs_more_evidence_expected")}`,
    `  unexpected_needs_more_evidence: ${count("baseline", "unexpected_needs_more_evidence")}`,
    `  wrong_type: ${count("baseline", "wrong_type")}`,
    `  wrong_code: ${count("baseline", "wrong_code")}`,
    `  unexpected_error: ${count("baseline", "unexpected_error")}`,
    "",
    "-- Com um registry hipotético (TASK-051B, se apenas dados fossem adicionados) --",
    `  resolved_expected: ${count("withRegistry", "resolved_expected")}`,
    `  needs_more_evidence_expected: ${count("withRegistry", "needs_more_evidence_expected")}`,
    `  unexpected_needs_more_evidence: ${count("withRegistry", "unexpected_needs_more_evidence")}`,
    `  casos com evidência de identidade via REGISTRY: ${identitySupportedByRegistry} / ${total}`,
    "",
    "-- Padrões de falha principais --",
    "  1. NENHUM caso não-debênture pode chegar a 'verified' hoje, com ou sem",
    "     registry: VerificationPolicy.evaluate (lib/aie/policy/verification-policy.ts)",
    "     exige evidência de força 'primary' vinda de uma fonte != REGISTRY para",
    "     os campos 'identity' E 'issuer'. O único provider 'primary' existente",
    "     em todo o código é o ANBIMA (debêntures). Ações, FIIs, ETFs, BDR,",
    "     Tesouro e CDB/LCI/LCA genéricos não têm NENHUM provider capaz de",
    "     produzir evidência primária hoje.",
    "  2. Mesmo com um registry hipotético perfeito (ticker/nome batendo",
    `     exatamente), ${identitySupportedByRegistry}/${total} casos ganham evidência 'identity'`,
    "     (supporting), mas o campo 'issuer' nunca é preenchido: RegistryProvider",
    "     (lib/aie/providers/registry-provider.ts) só emite evidência para o campo",
    "     'identity', nunca para 'issuer'. Popular um registry sozinho NÃO",
    "     destrava 'verified' para nada.",
    "  3. 'Tesouro Selic'/'Tesouro IPCA+' não têm NENHUM valor correspondente em",
    "     CandidateAssetType (lib/aie/contracts/candidate-asset.ts) -- não é uma",
    "     falha de reconhecimento, é uma categoria ausente do modelo de dados.",
    "  4. Dados explícitos simples (ticker normalizado) sobrevivem corretamente",
    `     à ingestão em todos os casos testados (${tickerOk}/${withTicker} casos com` +
      " ticker chegam normalizados sem perda).",
    "",
    "-- Candidatos prioritários para TASK-051B --",
    "  a. Um provider 'primary' para ativos listados na B3 (ações/FIIs/ETFs/BDR)",
    "     -- sem ele, nenhuma melhoria de regex/normalização muda o status final.",
    "  b. RegistryProvider emitir também evidência de 'issuer' quando o registry",
    "     souber o emissor/gestor (hoje só emite 'identity').",
    "  c. Adicionar 'treasury'/'government-bond' a CandidateAssetType, com plano",
    "     de busca próprio (SEARCH_PLANS em lib/aie/planner/resolution-planner.ts).",
    "  d. Decisão de produto: permitir que REGISTRY conte como evidência",
    "     suficiente (política mais permissiva) para certas classes de ativo,",
    "     ao custo de menor garantia -- avaliar antes de mudar VerificationPolicy.",
    "",
  ].join("\n");

  // eslint-disable-next-line no-console -- intentional diagnostic report (TASK-051A)
  console.log(summary);
}

describe("TASK-051A -- diagnóstico de qualidade de resolução AIE", () => {
  it("o resolver não lança exceção para nenhum caso da bateria de diagnóstico", async () => {
    const rows = await runAllFixtures();

    for (const row of rows) {
      expect(row.baseline.diagnosis, `${row.id} (baseline)`).not.toBe("unexpected_error");
      expect(row.withRegistry.diagnosis, `${row.id} (withRegistry)`).not.toBe("unexpected_error");
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
        registryStatus: row.withRegistry.status,
        registryDiagnosis: row.withRegistry.diagnosis,
        registryIdentitySupported: row.withRegistry.identitySupported,
      }));

    expect(strip(first)).toEqual(strip(second));
  });

  it("produz e imprime o relatório de diagnóstico (TASK-051A)", async () => {
    const rows = await runAllFixtures();

    printReport(rows);

    // Invariante fraca, só para o teste ter uma asserção própria: o relatório
    // cobre a bateria inteira.
    expect(rows.length).toBeGreaterThan(0);
  });
});
