import type {
  RegistryIdentifierKind,
} from "./entity";

export function normalizeAlias(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

export function normalizeIdentifierValue(
  kind: RegistryIdentifierKind,
  value: string,
): string {
  const trimmed = value
    .normalize("NFKC")
    .trim()
    .toUpperCase();

  if (kind === "cnpj") {
    return trimmed.replace(
      /\D/g,
      "",
    );
  }

  return trimmed.replace(
    /\s+/g,
    "",
  );
}
