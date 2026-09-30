import type { SnapshotItem } from "./portfolio-snapshot-mapping";

/**
 * TASK-065A: pure UX-only helper. Detects a textual clue in
 * `item.rawName` ALONE, purely to phrase a better suggestion for the user
 * -- it never touches classification. No provider, no catalog, no network,
 * no AIE, no mutation of `item`. `explainResolutionItem` (TASK-061A) and
 * `buildPortfolioResolutionImprovementPlan` (TASK-062A) are untouched by
 * this file and do not consume it (that wiring is a future task, TASK-065B).
 *
 * Deliberately narrow: whole-word matches only (`\b`), never a substring
 * ("CDBX" never matches "cdb", "tesouraria" never matches "tesouro"). A
 * hint is a suggestion for what to type more of, never a claim about what
 * the asset actually is.
 */

export type PortfolioResolutionUxHint =
  | { kind: "treasury"; suggestion: string }
  | { kind: "cdb"; suggestion: string }
  | { kind: "lci"; suggestion: string }
  | { kind: "lca"; suggestion: string };

const PRIVATE_FIXED_INCOME_SUGGESTION = "Informe o emissor e o produto específico.";

/** Same exclusion words as `../aie/providers/tesouro-direto/infer-asset-type.ts`'s
 * false-positive guard (fund/ETF/portfolio commercial names that merely
 * contain "tesouro") -- NOT `cdb`/`lci`/`lca`: those are handled by the
 * priority order below (Tesouro is checked, and can win, even when a CDB/
 * LCI/LCA keyword is also present in the same name). */
const TREASURY_EXCLUDED_TERMS = ["fundo", "etf", "carteira"];

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function hasWord(normalized: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`).test(normalized);
}

/** A plausible 19xx/20xx maturity year anywhere in the text -- purely
 * textual, never validated against any real calendar or catalog. */
function hasMaturityYear(normalized: string): boolean {
  return /\b(19|20)\d{2}\b/.test(normalized);
}

/** Detects a textual clue in `item.rawName`, for UX only. Pure: same input
 * always yields the same output, `item` is never mutated. Priority when
 * more than one keyword is present: Tesouro, then CDB, then LCI, then
 * LCA. */
export function detectPortfolioResolutionUxHint(
  item: SnapshotItem,
): PortfolioResolutionUxHint | null {
  const normalized = normalize(item.rawName);

  const looksLikeTreasury =
    hasWord(normalized, "tesouro") &&
    !hasMaturityYear(normalized) &&
    !TREASURY_EXCLUDED_TERMS.some((term) => hasWord(normalized, term));

  if (looksLikeTreasury) {
    return { kind: "treasury", suggestion: "Informe o vencimento do título do Tesouro." };
  }

  if (hasWord(normalized, "cdb")) {
    return { kind: "cdb", suggestion: PRIVATE_FIXED_INCOME_SUGGESTION };
  }

  if (hasWord(normalized, "lci")) {
    return { kind: "lci", suggestion: PRIVATE_FIXED_INCOME_SUGGESTION };
  }

  if (hasWord(normalized, "lca")) {
    return { kind: "lca", suggestion: PRIVATE_FIXED_INCOME_SUGGESTION };
  }

  return null;
}
