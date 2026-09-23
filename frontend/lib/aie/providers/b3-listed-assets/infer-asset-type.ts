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
export function inferListedB3AssetTypeFromTicker(
  ticker: string | undefined,
): CandidateAssetType | undefined {
  const trimmed = ticker?.trim();

  if (!trimmed) {
    return undefined;
  }

  return CATALOG_BY_TICKER.get(normalizeTicker(trimmed))?.assetType;
}
