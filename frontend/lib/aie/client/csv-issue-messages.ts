/**
 * Human-readable (pt-BR) text for the SAFE issues the CSV adapter, the ingestion
 * layer and the server return: a structural location (`header[3]`, `row[4].amount`,
 * `rows`, `query.fileId`) plus a stable code. Never a value: the messages are
 * built only from the location's shape and the code, so nothing a user typed can
 * be echoed.
 *
 * Browser-safe and pure.
 */

export interface SafeIssue {
  path: string;

  code: string;
}

const CODE_TEXT: Record<string, string> = {
  malformed_csv: "arquivo CSV mal formado",

  unknown_field: "coluna não reconhecida",

  forbidden_field:
    "coluna não permitida (dados pessoais ou credenciais)",

  duplicate_header: "coluna repetida",

  empty_header: "coluna sem nome",

  extra_columns: "colunas a mais que o cabeçalho",

  missing_columns:
    "colunas a menos que o cabeçalho",

  required: "campo obrigatório ausente",

  empty: "campo vazio",

  invalid_value: "valor inválido",

  too_long: "valor longo demais",

  type: "tipo inválido",

  invalid_json: "conteúdo inválido",
};

/** Field names that may be shown (the canonical CSV/candidate fields only). */
const KNOWN_FIELDS = new Set([
  "id",
  "rawName",
  "assetType",
  "ticker",
  "isin",
  "cnpj",
  "instrumentCode",
  "issuerName",
  "fundName",
  "maturityDate",
  "currency",
  "amount",
  "fileId",
  "fileName",
  "section",
  "row",
  "institution",
]);

function locationText(
  path: string,
): string {
  const header =
    /^header\[(\d{1,4})\]$/.exec(path);

  if (header) {
    return `Cabeçalho, coluna ${header[1]}`;
  }

  if (path === "header") {
    return "Cabeçalho";
  }

  const row =
    /^row\[(\d{1,6})\](?:\.([A-Za-z.]{1,40}))?$/.exec(
      path,
    );

  if (row) {
    const field = row[2];

    // Only a canonical field name is shown; anything else is left out.
    const named =
      field !== undefined &&
      KNOWN_FIELDS.has(
        field.replace(/^(hints|source)\./, ""),
      )
        ? `, campo ${field.replace(/^(hints|source)\./, "")}`
        : "";

    return `Linha ${row[1]}${named}`;
  }

  if (path === "rows") {
    return "Quantidade de linhas";
  }

  if (path === "$") {
    return "Arquivo";
  }

  if (path === "query.fileId" || path === "query") {
    return "Identificação do envio";
  }

  return "Arquivo";
}

export function describeIssue(
  issue: SafeIssue,
): string {
  const code =
    CODE_TEXT[issue.code] ??
    "problema de validação";

  return `${locationText(issue.path)}: ${code}.`;
}

export function describeIssues(
  issues: readonly SafeIssue[],
  limit = 5,
): string[] {
  return issues
    .slice(0, limit)
    .map(describeIssue);
}
