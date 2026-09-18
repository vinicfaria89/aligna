export type RegistryEntityKind =
  | "company"
  | "issuer"
  | "institution"
  | "fund"
  | "instrument"
  | "economicGroup";

export type RegistryIdentifierKind =
  | "cnpj"
  | "isin"
  | "ticker";

export interface RegistryIdentifier {
  kind: RegistryIdentifierKind;

  value: string;
}

export interface RegistryEntity {
  id: string;

  kind: RegistryEntityKind;

  legalName: string;

  aliases: string[];

  identifiers: RegistryIdentifier[];
}
