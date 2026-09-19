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

export class AnbimaDebentureProvider
  implements EvidenceProvider
{
  readonly id =
    "ANBIMA";

  readonly version =
    "1.0.0";

  constructor(
    private readonly client:
      AnbimaDebentureFeedClient,
  ) {}

  supports(
    query: ProviderQuery,
  ): boolean {
    return (
      query.assetType ===
        "debenture" &&
      Boolean(query.ticker)
    );
  }

  async search(
    query: ProviderQuery,
  ): Promise<ProviderResult> {
    if (!this.supports(query)) {
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

    try {
      const records =
        await this.client
          .getSecondaryMarketDebentures();

      const record =
        this.findExactRecord(
          records,
          query.ticker!,
        );

      if (!record) {
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

  private findExactRecord(
    records:
      AnbimaDebentureMarketRecord[],

    code: string,
  ):
    AnbimaDebentureMarketRecord |
    undefined {
    const normalizedCode =
      code.trim().toUpperCase();

    return records.find(
      (record) =>
        record.codigo_ativo
          .trim()
          .toUpperCase() ===
        normalizedCode,
    );
  }

  private toEvidence(
    query: ProviderQuery,
    record:
      AnbimaDebentureMarketRecord,
  ): AssetEvidence[] {
    const collectedAt =
      new Date().toISOString();

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

        collectedAt,

        providerVersion:
          this.version,

        sourceReference,

        metadata: {
          issuer:
            record.emissor,

          maturityDate:
            record.data_vencimento,

          referenceDate:
            record.data_referencia,

          group:
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
          "primary",

        field:
          "issuer",

        value:
          record.emissor,

        collectedAt,

        providerVersion:
          this.version,

        sourceReference,

        metadata: {
          instrumentCode:
            record.codigo_ativo,

          referenceDate:
            record.data_referencia,
        },
      },
    ];
  }
}
