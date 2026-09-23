import type { AssetEvidence } from "../../contracts";
import type {
  EvidenceProvider,
  ProviderQuery,
  ProviderResult,
} from "../evidence-provider";

import type { B3ListedAssetEntry } from "./catalog";
import { B3_LISTED_ASSETS } from "./catalog";

function normalizeTicker(value: string): string {
  return value.trim().toUpperCase();
}

/**
 * `primary` evidence source for the small, explicit, local catalog of
 * B3-listed assets (TASK-051B, see ./catalog.ts).
 *
 * Unlike RegistryProvider (lib/aie/providers/registry-provider.ts), whose
 * matches only ever back SUPPORTING `identity` evidence, this provider's
 * ticker<->issuer pairs are curated by hand and treated as authoritative for
 * the covered universe: it emits BOTH `identity` and `issuer` evidence at
 * `primary` strength. That is what lets VerificationPolicy
 * (lib/aie/policy/verification-policy.ts) reach "verified" for a covered
 * ticker WITHOUT that file changing at all -- the policy already accepts any
 * non-REGISTRY primary evidence; this provider simply supplies real, curated
 * evidence of that quality for a controlled set of assets, the same way
 * AnbimaDebentureProvider does for debentures (its `issuer` evidence stays
 * "supporting" on purpose, because ANBIMA's free-text "emissor" field is not
 * a canonical identifier the way this catalog's `issuerEntityId` is).
 *
 * Deliberately narrow: exact ticker match only, case/whitespace-normalized
 * (`  petr4 ` and `PETR4` both match). Never a substring or a name-based
 * match -- "PETR" never matches "PETR4", "Banco Teste" never matches
 * anything here, an unlisted ticker never matches. Nothing outside
 * `B3_LISTED_ASSETS` is ever found.
 */
export class B3ListedAssetProvider implements EvidenceProvider {
  readonly id = "B3";

  readonly version = "1.0.0";

  private readonly byTicker: ReadonlyMap<string, B3ListedAssetEntry>;

  constructor(
    catalog: readonly B3ListedAssetEntry[] = B3_LISTED_ASSETS,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.byTicker = new Map(catalog.map((entry) => [entry.ticker, entry]));
  }

  supports(query: ProviderQuery): boolean {
    const ticker = query.ticker?.trim();

    return Boolean(ticker) && this.byTicker.has(normalizeTicker(ticker as string));
  }

  async search(query: ProviderQuery): Promise<ProviderResult> {
    const ticker = query.ticker?.trim();

    if (!ticker) {
      return {
        providerId: this.id,
        searched: false,
        found: false,
        evidence: [],
      };
    }

    const entry = this.byTicker.get(normalizeTicker(ticker));

    if (!entry) {
      return {
        providerId: this.id,
        searched: true,
        found: false,
        evidence: [],
      };
    }

    return {
      providerId: this.id,
      searched: true,
      found: true,
      evidence: this.toEvidence(query, entry),
      candidates: [
        {
          id: entry.canonicalAssetId,
          label: entry.legalName,
          metadata: { assetType: entry.assetType },
        },
      ],
    };
  }

  private toEvidence(
    query: ProviderQuery,
    entry: B3ListedAssetEntry,
  ): AssetEvidence[] {
    const collectedAt = this.now();
    const sourceReference = `B3:listed-assets:${entry.ticker}`;

    return [
      {
        id: `B3:${query.assetId}:identity:${entry.ticker}`,
        assetId: query.assetId,
        source: "B3",
        strength: "primary",
        field: "identity",
        value: entry.canonicalAssetId,
        sourceReference,
        collectedAt,
        providerVersion: this.version,
        metadata: {
          ticker: entry.ticker,
          assetType: entry.assetType,
          legalName: entry.legalName,
        },
      },
      {
        id: `B3:${query.assetId}:issuer:${entry.ticker}`,
        assetId: query.assetId,
        source: "B3",
        strength: "primary",
        field: "issuer",
        value: entry.issuerEntityId,
        sourceReference,
        collectedAt,
        providerVersion: this.version,
        metadata: {
          ticker: entry.ticker,
          issuerName: entry.issuerName,
        },
      },
    ];
  }
}
