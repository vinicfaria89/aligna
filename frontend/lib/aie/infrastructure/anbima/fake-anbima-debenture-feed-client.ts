import type {
  AnbimaDebentureFeedClient,
  AnbimaDebentureMarketRecord,
} from "./anbima-debenture-types";

/**
 * Offline test double. Performs no network access and needs no credentials.
 */
export function createAnbimaDebentureRecord(
  overrides: Partial<AnbimaDebentureMarketRecord> = {},
): AnbimaDebentureMarketRecord {
  return {
    grupo: "DI",

    codigo_ativo: "ABCD11",

    data_referencia: "2026-09-18",

    data_vencimento: "2030-01-15",

    percentual_taxa: null,

    taxa_compra: null,
    taxa_venda: null,
    taxa_indicativa: null,
    desvio_padrao: null,
    val_min_intervalo: null,
    val_max_intervalo: null,
    pu: null,
    percent_vne: null,
    percent_pu_par: null,
    duration: null,
    percent_reune: null,

    emissor: "Petrobras",

    referencia_ntnb: null,
    data_finalizado: null,
    pu_retificado: null,
    percent_pu_par_retificado: null,
    duration_retificada: null,
    data_finalizado_retificado: null,

    ...overrides,
  };
}

export class FakeAnbimaDebentureFeedClient
  implements AnbimaDebentureFeedClient
{
  readonly requestedCodes: string[] = [];

  constructor(
    private readonly records: readonly AnbimaDebentureMarketRecord[] = [],

    private readonly failure?: Error,
  ) {}

  async findSecondaryMarketDebentureByCode(
    instrumentCode: string,
  ): Promise<AnbimaDebentureMarketRecord | null> {
    this.requestedCodes.push(
      instrumentCode,
    );

    if (this.failure) {
      throw this.failure;
    }

    return (
      this.records.find(
        (record) =>
          record.codigo_ativo ===
          instrumentCode,
      ) ?? null
    );
  }
}
