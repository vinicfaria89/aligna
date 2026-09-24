import type { AssetEvidence } from "../../contracts";
import type {
  EvidenceProvider,
  ProviderQuery,
  ProviderResult,
} from "../evidence-provider";

import type { TesouroDiretoEntry } from "./catalog";
import { findTesouroDiretoEntry } from "./infer-asset-type";

/**
 * `primary` evidence source for the small, explicit, local catalog of
 * Tesouro Direto titles WITH an explicit maturity year (TASK-058B, see
 * ./catalog.ts). Same trust model as `B3ListedAssetProvider`
 * (../b3-listed-assets/b3-listed-asset-provider.ts): a curated catalog
 * treated as authoritative for the narrow universe it covers, emitting
 * BOTH `identity` and `issuer` evidence at `primary` strength -- what lets
 * `VerificationPolicy` (../../policy/verification-policy.ts) reach
 * "verified" without that file changing at all.
 *
 * Deliberately narrow, per the TASK-058A diagnostic's conclusions
 * (docs/tasks/task-058a-tesouro-direto-diagnostics.md):
 *
 *   - only the 8 titles in ./catalog.ts, each with type + modality +
 *     maturity year -- never a name without a year ("Tesouro Selic" alone
 *     never matches, no matter how it is written);
 *   - matches by `rawName` only, normalized (trim + collapsed whitespace +
 *     lowercase + no space before "+"), never a substring/partial match;
 *   - an explicit alias list per catalog entry, never generic suffix
 *     stripping, covers the one known broker-export variant ("(LFT)");
 *   - a guard rejects any input containing "fundo", "etf", "carteira",
 *     "cdb", "lci", "lca" or "renda fixa" as a whole word, even if the
 *     rest of the text would otherwise look like a catalog entry -- see
 *     `findTesouroDiretoEntry` in ./infer-asset-type.ts, which this
 *     provider and the engine's own inference step both reuse, so the
 *     guard can never disagree between the two;
 *   - never calls a network, never depends on the current date (besides
 *     the injectable evidence timestamp), fully deterministic.
 *
 * TASK-058B mirrors TASK-051C's guard for B3: an explicit `query.assetType`
 * that disagrees with `"treasury"` is never overridden and never matched --
 * a documented conflict for `needs-more-evidence` to reflect, never a
 * silent override.
 */
export class TesouroDiretoProvider implements EvidenceProvider {
  readonly id = "TESOURO";

  readonly version = "1.0.0";

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  supports(query: ProviderQuery): boolean {
    return this.matchingEntry(query) !== null;
  }

  async search(query: ProviderQuery): Promise<ProviderResult> {
    const rawName = query.rawName?.trim();

    if (!rawName) {
      return {
        providerId: this.id,
        searched: false,
        found: false,
        evidence: [],
      };
    }

    const entry = this.matchingEntry(query);

    if (!entry) {
      // Covers three cases identically: the name is not in the catalog, it
      // contains an excluded term, OR it is a real catalog entry but the
      // caller's own (explicit) `assetType` disagrees with "treasury" --
      // never a silent override, never a false "found".
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
          metadata: { assetType: entry.assetType, maturityYear: entry.maturityYear },
        },
      ],
    };
  }

  /** Catalog entry for the query's `rawName`, or `null` if absent, excluded
   * by a guard term, OR if an explicit `query.assetType` conflicts with
   * `"treasury"` (TASK-058B, mirrors TASK-051C's B3 guard). */
  private matchingEntry(query: ProviderQuery): TesouroDiretoEntry | null {
    if (query.assetType !== undefined && query.assetType !== "treasury") {
      return null;
    }

    return findTesouroDiretoEntry(query.rawName) ?? null;
  }

  private toEvidence(query: ProviderQuery, entry: TesouroDiretoEntry): AssetEvidence[] {
    const collectedAt = this.now();
    const sourceReference = `TESOURO:catalog:${entry.canonicalAssetId}`;

    return [
      {
        id: `TESOURO:${query.assetId}:identity:${entry.canonicalAssetId}`,
        assetId: query.assetId,
        source: "TESOURO",
        strength: "primary",
        field: "identity",
        value: entry.canonicalAssetId,
        sourceReference,
        collectedAt,
        providerVersion: this.version,
        metadata: {
          legalName: entry.legalName,
          assetType: entry.assetType,
          maturityYear: entry.maturityYear,
        },
      },
      {
        id: `TESOURO:${query.assetId}:issuer:${entry.canonicalAssetId}`,
        assetId: query.assetId,
        source: "TESOURO",
        strength: "primary",
        field: "issuer",
        value: entry.issuerEntityId,
        sourceReference,
        collectedAt,
        providerVersion: this.version,
        metadata: {
          issuerName: entry.issuerName,
        },
      },
    ];
  }
}
