import type { SnapshotItem } from "./portfolio-snapshot-mapping";

/**
 * TASK-061A: pure translation of an already-resolved `SnapshotItem` into a
 * human-friendly explanation. This module NEVER decides anything -- it only
 * interprets a status the AIE resolver (or a saved snapshot) already
 * produced. No network, no provider, no AIE call, no DOM, no React, no
 * current date, no locale-dependent formatting. The UI that renders these
 * explanations is a later task (TASK-061B).
 *
 * It never claims something it cannot know from `SnapshotItem` alone (e.g.
 * "ticker inválido", "produto inexistente") -- only what the status and
 * asset type already tell us.
 */

export type ResolutionExplanationKind =
  | "verified"
  | "needs-more-evidence"
  | "needs-user"
  | "conflict"
  | "blocked"
  | "item-error";

export type ResolutionExplanationSeverity = "success" | "info" | "warning" | "error";

export interface ResolutionExplanation {
  kind: ResolutionExplanationKind;
  title: string;
  description: string;
  suggestion?: string;
  severity: ResolutionExplanationSeverity;
}

/** Same priority as TASK-056A/TASK-060A: `item.assetType` first,
 * `verifiedAsset.type` as fallback, "unknown" last -- no new rule. */
function extractAssetType(item: SnapshotItem): string {
  const raw = item.assetType ?? item.verifiedAsset?.type;
  if (typeof raw !== "string") {
    return "unknown";
  }
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : "unknown";
}

const B3_LIKE_TYPES = new Set(["stock", "fii", "etf", "international"]);
const PRIVATE_FIXED_INCOME_TYPES = new Set(["cdb", "lci", "lca"]);

function needsMoreEvidenceSuggestion(item: SnapshotItem): string {
  const assetType = extractAssetType(item);

  if (B3_LIKE_TYPES.has(assetType)) {
    return "Confira se o ticker ou o nome do ativo está completo.";
  }
  if (assetType === "treasury") {
    return "Informe o vencimento do título.";
  }
  if (PRIVATE_FIXED_INCOME_TYPES.has(assetType)) {
    return "Informe o emissor e o produto específico.";
  }
  return "Forneça um nome mais específico para o ativo.";
}

/** Transforms an already-resolved item into a structured explanation.
 * Pure: same input always yields the same output, no side effects. */
export function explainResolutionItem(item: SnapshotItem): ResolutionExplanation {
  switch (item.status) {
    case "verified":
      return {
        kind: "verified",
        title: "Ativo verificado",
        description: "O ativo foi identificado automaticamente utilizando evidências suficientes.",
        severity: "success",
      };

    case "needs-more-evidence":
      return {
        kind: "needs-more-evidence",
        title: "São necessárias mais evidências",
        description:
          "Ainda não houve informação suficiente para confirmar este ativo automaticamente.",
        suggestion: needsMoreEvidenceSuggestion(item),
        severity: "info",
      };

    case "needs-user":
      return {
        kind: "needs-user",
        title: "Ação do usuário necessária",
        description: "Este ativo precisa de uma decisão sua para que a resolução continue.",
        suggestion: "Revise os dados enviados.",
        severity: "warning",
      };

    case "conflict":
      return {
        kind: "conflict",
        title: "Informações conflitantes",
        description:
          "Foram encontradas informações que não coincidem entre si para este ativo.",
        suggestion: "Revise os dados do ativo antes de tentar novamente.",
        severity: "warning",
      };

    case "blocked":
      return {
        kind: "blocked",
        title: "Resolução bloqueada",
        description: "Não foi possível avançar na resolução deste ativo.",
        suggestion: "Verifique se todas as informações obrigatórias foram fornecidas.",
        severity: "warning",
      };

    case "item-error":
      return {
        kind: "item-error",
        title: "Erro ao processar o ativo",
        description: "Ocorreu um erro ao processar este ativo.",
        suggestion: "Tente novamente mais tarde.",
        severity: "error",
      };

    default:
      // Defensive fallback for a status this module does not recognize --
      // never claims a cause it cannot know; treated as pending (closest
      // safe default, matching TASK-060A's own precedent).
      return {
        kind: "needs-more-evidence",
        title: "São necessárias mais evidências",
        description: "A situação deste ativo não foi reconhecida por esta função.",
        severity: "info",
      };
  }
}
