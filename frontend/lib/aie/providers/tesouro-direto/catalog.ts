export interface TesouroDiretoEntry {
  /** Canonical, already-normalized name (lowercase, single spaces, no space
   * before "+") -- the PRIMARY lookup key. Never the raw display name. */
  canonicalName: string;

  /** Additional pre-normalized name variants that map to this SAME entry,
   * for the specific cases the algorithmic normalization alone cannot cover
   * (e.g. a broker-exported suffix like "(LFT)") -- explicitly whitelisted
   * per entry, never a generic suffix-stripping rule (see
   * ./infer-asset-type.ts's module docstring). */
  aliases?: readonly string[];

  assetType: "treasury";

  /** Stable canonical id for `identity` evidence -- never the raw name. */
  canonicalAssetId: string;

  legalName: string;

  /** Stable id for `issuer` evidence -- the same for every entry (single
   * sovereign issuer, Tesouro Nacional). */
  issuerEntityId: string;

  issuerName: string;

  maturityYear: number;
}

const ISSUER_ENTITY_ID = "issuer.tesouro-nacional";
const ISSUER_NAME = "Tesouro Nacional";

/**
 * TASK-058B: local, explicit, deliberately narrow catalog -- covers ONLY
 * the eight "com vencimento" cases the TASK-058A diagnostic
 * (docs/tasks/task-058a-tesouro-direto-diagnostics.md) recommended as
 * candidates for a first, conservative implementation. Nothing without an
 * explicit maturity year belongs here -- "Tesouro Selic" alone is never
 * added, on purpose: a name without a vencimento does not identify a
 * SPECIFIC title, no matter how confident the source, per that document's
 * "critérios mínimos propostos para identidade".
 *
 * Same convention as ../b3-listed-assets/catalog.ts: public, low-churn,
 * hand-verified data (title existence and its year), never a quote, a
 * price, or anything needing live updates. Never consults a live/external
 * feed. Growing this list is a deliberate product decision each time, not
 * something to expand silently inside this file.
 */
export const TESOURO_DIRETO_CATALOG: readonly TesouroDiretoEntry[] = [
  {
    canonicalName: "tesouro selic 2029",
    aliases: ["tesouro selic 2029 (lft)"],
    assetType: "treasury",
    canonicalAssetId: "tesouro:selic:2029",
    legalName: "Tesouro Selic 2029",
    issuerEntityId: ISSUER_ENTITY_ID,
    issuerName: ISSUER_NAME,
    maturityYear: 2029,
  },
  {
    canonicalName: "tesouro selic 2031",
    assetType: "treasury",
    canonicalAssetId: "tesouro:selic:2031",
    legalName: "Tesouro Selic 2031",
    issuerEntityId: ISSUER_ENTITY_ID,
    issuerName: ISSUER_NAME,
    maturityYear: 2031,
  },
  {
    canonicalName: "tesouro ipca+ 2035",
    assetType: "treasury",
    canonicalAssetId: "tesouro:ipca:2035",
    legalName: "Tesouro IPCA+ 2035",
    issuerEntityId: ISSUER_ENTITY_ID,
    issuerName: ISSUER_NAME,
    maturityYear: 2035,
  },
  {
    canonicalName: "tesouro ipca+ 2045",
    assetType: "treasury",
    canonicalAssetId: "tesouro:ipca:2045",
    legalName: "Tesouro IPCA+ 2045",
    issuerEntityId: ISSUER_ENTITY_ID,
    issuerName: ISSUER_NAME,
    maturityYear: 2045,
  },
  {
    canonicalName: "tesouro ipca+ com juros semestrais 2040",
    assetType: "treasury",
    canonicalAssetId: "tesouro:ipca-js:2040",
    legalName: "Tesouro IPCA+ com Juros Semestrais 2040",
    issuerEntityId: ISSUER_ENTITY_ID,
    issuerName: ISSUER_NAME,
    maturityYear: 2040,
  },
  {
    canonicalName: "tesouro prefixado 2027",
    assetType: "treasury",
    canonicalAssetId: "tesouro:prefixado:2027",
    legalName: "Tesouro Prefixado 2027",
    issuerEntityId: ISSUER_ENTITY_ID,
    issuerName: ISSUER_NAME,
    maturityYear: 2027,
  },
  {
    canonicalName: "tesouro prefixado 2031",
    assetType: "treasury",
    canonicalAssetId: "tesouro:prefixado:2031",
    legalName: "Tesouro Prefixado 2031",
    issuerEntityId: ISSUER_ENTITY_ID,
    issuerName: ISSUER_NAME,
    maturityYear: 2031,
  },
  {
    canonicalName: "tesouro prefixado com juros semestrais 2035",
    assetType: "treasury",
    canonicalAssetId: "tesouro:prefixado-js:2035",
    legalName: "Tesouro Prefixado com Juros Semestrais 2035",
    issuerEntityId: ISSUER_ENTITY_ID,
    issuerName: ISSUER_NAME,
    maturityYear: 2035,
  },
];
