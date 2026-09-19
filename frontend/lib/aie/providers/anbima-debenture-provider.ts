import type {
  AssetEvidence,
} from "../contracts";

import type {
  AnbimaDebentureFeedClient,
  AnbimaDebentureMarketRecord,
} from "../infrastructure/anbima/anbima-debenture-types";

import type {
  EvidenceProvider,
  ProviderQuery,
  ProviderResult,
} from "./evidence-provider";

function normalizeInstrumentCode(
  value: string,
): string {
  return value
    .trim()
    .toUpperCase();
}

/**
 * Queries exactly one knowledge source: the ANBIMA debenture secondary market feed.
 *
 * - exact instrumentCode only (no fuzzy matching, no issuer-name-only resolution);
 * - no knowledge of HTTP, OAuth, credentials or URLs (see AnbimaDebentureFeedClient);
 * - never decides verification and never creates VerifiedAsset.
 *
 * Evidence rule (see ADR-003): the official instrument code is primary identity
 * evidence. The textual "emissor" is only SUPPORTING issuer evidence, because it
 * is a name, not a canonical issuer identifier.
 */
export class AnbimaDebentureProvider
  implements EvidenceProvider
{
  readonly id = "ANBIMA";

  readonly version = "1.0.0";

  constructor(
    private readonly client:
      AnbimaDebentureFeedClient,

    private readonly now:
      () => string =
        () =>
          new Date().toISOString(),
  ) {}

  supports(
    query: ProviderQuery,
  ): boolean {
    return (
      query.assetType ===
        "debenture" &&
      Boolean(
        query.instrumentCode?.trim(),
      )
    );
  }

  async search(
    query: ProviderQuery,
  ): Promise<ProviderResult> {
    if (
      !this.supports(query) ||
      !query.instrumentCode
    ) {
      return {
        providerId:
          this.id,

        searched:
          false,

        found:
          false,

        evidence: [],
      };
    }

    const instrumentCode =
      normalizeInstrumentCode(
        query.instrumentCode,
      );

    try {
      const record =
        await this.client
          .findSecondaryMarketDebentureByCode(
            instrumentCode,
          );

      if (
        !record ||
        normalizeInstrumentCode(
          record.codigo_ativo,
        ) !== instrumentCode
      ) {
        return {
          providerId:
            this.id,

          searched:
            true,

          found:
            false,

          evidence: [],
        };
      }

      return {
        providerId:
          this.id,

        searched:
          true,

        found:
          true,

        evidence:
          this.toEvidence(
            query,
            record,
          ),
      };
    } catch (error) {
      return {
        providerId:
          this.id,

        searched:
          true,

        found:
          false,

        evidence: [],

        error: {
          code:
            "ANBIMA_SEARCH_FAILED",

          message:
            error instanceof Error
              ? error.message
              : String(error),
        },
      };
    }
  }

  private toEvidence(
    query: ProviderQuery,

    record:
      AnbimaDebentureMarketRecord,
  ): AssetEvidence[] {
    const collectedAt =
      this.now();

    const sourceReference =
      `ANBIMA:debentures:mercado-secundario:${record.codigo_ativo}`;

    return [
      {
        id:
          `ANBIMA:${query.assetId}:identity:${record.codigo_ativo}`,

        assetId:
          query.assetId,

        source:
          "ANBIMA",

        strength:
          "primary",

        field:
          "identity",

        value:
          record.codigo_ativo,

        sourceReference,

        collectedAt,

        providerVersion:
          this.version,

        metadata: {
          codigo_ativo:
            record.codigo_ativo,

          emissor:
            record.emissor,

          data_referencia:
            record.data_referencia,

          data_vencimento:
            record.data_vencimento,

          grupo:
            record.grupo,
        },
      },

      {
        id:
          `ANBIMA:${query.assetId}:issuer:${record.codigo_ativo}`,

        assetId:
          query.assetId,

        source:
          "ANBIMA",

        strength:
          "supporting",

        field:
          "issuer",

        value:
          record.emissor,

        sourceReference,

        collectedAt,

        providerVersion:
          this.version,

        metadata: {
          codigo_ativo:
            record.codigo_ativo,

          data_referencia:
            record.data_referencia,
        },
      },
    ];
  }
}
