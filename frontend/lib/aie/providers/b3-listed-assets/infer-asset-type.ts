import type { CandidateAssetType } from "../../contracts";

import type { B3ListedAssetEntry } from "./catalog";
import { B3_LISTED_ASSETS } from "./catalog";

function normalizeTicker(value: string): string {
  return value.trim().toUpperCase();
}

const CATALOG_BY_TICKER: ReadonlyMap<string, B3ListedAssetEntry> = new Map(
  B3_LISTED_ASSETS.map((entry) => [entry.ticker, entry]),
);

/**
 * TASK-051C: infers `assetType` ONLY for a ticker that exact-matches
 * `B3ListedAssetProvider`'s own catalog (./catalog.ts) -- never a generic
 * "looks like a B3 ticker" guess. `XPTO4` and `ABCD11` return `undefined`
 * even though they have the right shape: catalog membership is the only
 * source of truth, appearance never is (no regex-based classification, no
 * partial/substring match, no inference for anything outside the exact 8
 * tickers the catalog lists).
 *
 * Case/whitespace-normalized (trim + uppercase) the same way ingestion
 * already normalizes `hints.ticker`
 * (lib/aie/ingestion/portfolio-candidate-ingestion.ts) -- so `petr4` and
 * `  PETR4  ` both match, but an internal space (`PETR 4`) does not: the
 * existing ingestion normalization does not collapse internal whitespace
 * either, and this function deliberately does not go further than that.
 */
function findEntry(
  value: string | undefined,
): B3ListedAssetEntry | undefined {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  return CATALOG_BY_TICKER.get(normalizeTicker(trimmed));
}

export function inferListedB3AssetTypeFromTicker(
  ticker: string | undefined,
): CandidateAssetType | undefined {
  return findEntry(ticker)?.assetType;
}

/**
 * TASK-051C (fix after production smoke): the most basic real CSV a user
 * uploads often has no separate `ticker` column at all -- just `rawName`
 * ("PETR4" typed once, not twice, no "ticker" header). Looking at
 * `hints.ticker` alone missed exactly that case. This tries `hints.ticker`
 * first (an explicit ticker column, when present, is the stronger signal)
 * and falls back to `rawName` -- through the SAME exact-match-only lookup
 * either way, so the conservative guarantee is identical for both: the
 * value must equal a catalog ticker exactly after trim+uppercase, never a
 * substring ("MEUPETR4FUNDO" never matches "PETR4").
 *
 * Returns the full catalog entry (not just the type) because the caller
 * (AssetResolutionEngine) also needs `entry.ticker` when the match came
 * from `rawName`: `B3ListedAssetProvider` looks up `hints.ticker`, not
 * `rawName`, so inferring the type alone would not be enough to actually
 * reach the provider for a ticker-only CSV row.
 */
export function findListedB3CatalogEntry(
  candidate: { rawName: string; hints: { ticker?: string } },
): B3ListedAssetEntry | undefined {
  return findEntry(candidate.hints.ticker) ?? findEntry(candidate.rawName);
}
