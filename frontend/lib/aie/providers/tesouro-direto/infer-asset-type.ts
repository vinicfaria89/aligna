import type { TesouroDiretoEntry } from "./catalog";
import { TESOURO_DIRETO_CATALOG } from "./catalog";

// TASK-058A's diagnostic (docs/tasks/task-058a-tesouro-direto-diagnostics.md)
// mapped these as the concrete false-positive risk: a name that CONTAINS
// "Tesouro Selic"/"Tesouro IPCA+" but is actually a fund, ETF, portfolio
// label or bank product with a similar commercial name. Checked as WHOLE
// WORDS (word-boundary regex), case-insensitive, against the ALREADY
// space-collapsed normalized text -- "renda fixa" matches as a two-word
// phrase the same way.
const EXCLUDED_TERMS = ["fundo", "etf", "carteira", "cdb", "lci", "lca", "renda fixa"];

/**
 * trim + collapse internal whitespace to a single space + lowercase +
 * remove any whitespace immediately before a "+" (so "IPCA + 2035" and
 * "IPCA+ 2035" normalize identically). Deliberately conservative: no accent
 * stripping, no punctuation removal beyond the "+"-spacing rule, no generic
 * parenthetical stripping -- a "(LFT)"-style suffix is only ever tolerated
 * via an entry's explicit `aliases` (./catalog.ts), never a generic rule
 * that could silently swallow meaningful text elsewhere.
 */
function normalizeTreasuryName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\s+\+/g, "+");
}

function containsExcludedTerm(normalized: string): boolean {
  return EXCLUDED_TERMS.some((term) => new RegExp(`\\b${term}\\b`).test(normalized));
}

const CATALOG_BY_NAME: ReadonlyMap<string, TesouroDiretoEntry> = new Map(
  TESOURO_DIRETO_CATALOG.flatMap((entry) => [
    [normalizeTreasuryName(entry.canonicalName), entry] as const,
    ...(entry.aliases ?? []).map((alias) => [normalizeTreasuryName(alias), entry] as const),
  ]),
);

/**
 * TASK-058B: finds a Tesouro Direto catalog entry (./catalog.ts) for a raw
 * name -- EXACT match only, after normalization, never a substring/partial
 * match and never a regex-based guess at "this looks like Tesouro". The
 * SAME function backs both `TesouroDiretoProvider` (the evidence source)
 * and the engine's own inference step
 * (../../resolution/asset-resolution-engine.ts), so the exclusion guard can
 * never disagree between the two.
 *
 * Two independent defenses, both must pass:
 *
 *   1. The normalized text must equal a catalog entry's canonical name OR
 *      one of its explicitly whitelisted aliases -- "Tesouro Selic" (no
 *      year) and "Tesouro Selic 2033" (a real-looking year, but
 *      uncatalogued) both return `undefined`, same as an unlisted B3
 *      ticker in `../b3-listed-assets/infer-asset-type.ts`.
 *   2. The normalized text must not contain an excluded term ("fundo",
 *      "etf", "carteira", "cdb", "lci", "lca", "renda fixa") as a whole
 *      word -- "Fundo Tesouro Selic 2029" never matches even though the
 *      rest of the string is close to a catalog entry, because this guard
 *      runs BEFORE the lookup.
 */
export function findTesouroDiretoEntry(rawName: string | undefined): TesouroDiretoEntry | undefined {
  const trimmed = rawName?.trim();

  if (!trimmed) {
    return undefined;
  }

  const normalized = normalizeTreasuryName(trimmed);

  if (containsExcludedTerm(normalized)) {
    return undefined;
  }

  return CATALOG_BY_NAME.get(normalized);
}

/**
 * Engine-facing helper, same shape/contract as
 * `../b3-listed-assets/infer-asset-type.ts`'s `findListedB3CatalogEntry` --
 * used by `withInferredAssetType` in
 * `../../resolution/asset-resolution-engine.ts`. Tesouro Direto catalog
 * entries have no ticker (unlike B3-listed assets), so this matches on
 * `rawName` alone.
 */
export function findTesouroDiretoCatalogEntry(candidate: { rawName: string }): TesouroDiretoEntry | undefined {
  return findTesouroDiretoEntry(candidate.rawName);
}
