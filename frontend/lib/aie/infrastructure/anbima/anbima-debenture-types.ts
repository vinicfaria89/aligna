export interface AnbimaDebentureMarketRecord {
  grupo:
    string | null;

  codigo_ativo:
    string;

  data_referencia:
    string;

  data_vencimento:
    string;

  percentual_taxa:
    string | null;

  taxa_compra:
    number | null;

  taxa_venda:
    number | null;

  taxa_indicativa:
    number | null;

  desvio_padrao:
    number | null;

  val_min_intervalo:
    number | null;

  val_max_intervalo:
    number | null;

  pu:
    number | null;

  percent_vne:
    number | null;

  percent_pu_par:
    number | null;

  duration:
    number | null;

  percent_reune:
    string | null;

  emissor:
    string;

  referencia_ntnb:
    string | null;

  data_finalizado:
    string | null;

  pu_retificado:
    number | null;

  percent_pu_par_retificado:
    number | null;

  duration_retificada:
    number | null;

  data_finalizado_retificado:
    string | null;
}

export interface AnbimaDebentureMarketQuery {
  date?: string;
}

export interface AnbimaDebentureFeedClient {
  getSecondaryMarketDebentures(
    query?: AnbimaDebentureMarketQuery,
  ): Promise<
    AnbimaDebentureMarketRecord[]
  >;
}
