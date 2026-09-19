import type {
  AssetEvidence,
} from "../contracts";

import type {
  EntityRegistry,
} from "../registry";

import type {
  EvidenceProvider,
  ProviderQuery,
  ProviderResult,
} from "./evidence-provider";

export class RegistryProvider
  implements EvidenceProvider
{
  readonly id =
    "REGISTRY";

  readonly version =
    "1.0.0";

  constructor(
    private readonly registry: EntityRegistry,
  ) {}

  supports(
    query: ProviderQuery,
  ): boolean {
    return Boolean(
      query.instrumentCode ||
      query.isin ||
      query.cnpj ||
      query.ticker ||
      query.rawName,
    );
  }

  async search(
    query: ProviderQuery,
  ): Promise<ProviderResult> {
    let entity = null;

    if (query.instrumentCode) {
      entity =
        this.registry.findByIdentifier(
          "instrumentCode",
          query.instrumentCode,
        );
    }

    if (
      !entity &&
      query.isin
    ) {
      entity =
        this.registry.findByIdentifier(
          "isin",
          query.isin,
        );
    }

    if (
      !entity &&
      query.cnpj
    ) {
      entity =
        this.registry.findByIdentifier(
          "cnpj",
          query.cnpj,
        );
    }

    if (
      !entity &&
      query.ticker
    ) {
      entity =
        this.registry.findByIdentifier(
          "ticker",
          query.ticker,
        );
    }

    if (
      !entity &&
      query.rawName
    ) {
      entity =
        this.registry.findByAlias(
          query.rawName,
        );
    }

    if (!entity) {
      return {
        providerId: this.id,
        searched: true,
        found: false,
        evidence: [],
      };
    }

    const evidence:
      AssetEvidence[] = [
        {
          id:
            `${this.id}:${query.assetId}:identity:${entity.id}`,

          assetId:
            query.assetId,

          source:
            "REGISTRY",

          strength:
            "supporting",

          field:
            "identity",

          value:
            entity.id,

          collectedAt:
            new Date().toISOString(),

          providerVersion:
            this.version,

          metadata: {
            entityKind:
              entity.kind,

            legalName:
              entity.legalName,

            aliases:
              entity.aliases,

            identifiers:
              entity.identifiers,
          },
        },
      ];

    return {
      providerId:
        this.id,

      searched:
        true,

      found:
        true,

      evidence,

      candidates: [
        {
          id:
            entity.id,

          label:
            entity.legalName,

          metadata: {
            kind:
              entity.kind,
          },
        },
      ],
    };
  }
}