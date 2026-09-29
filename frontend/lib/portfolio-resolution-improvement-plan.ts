import type { SnapshotItem } from "./portfolio-snapshot-mapping";

/**
 * TASK-062A: pure prioritized improvement plan over an already-resolved
 * portfolio (`SnapshotItem[]`). Never mutates an item, never recomputes a
 * resolution, never calls the AIE resolver, a provider, or the network --
 * it only reads fields `SnapshotItem` already carries and summarizes which
 * categories of pendency are present. No free-text analysis, no regex, no
 * asset inference: every suggestion is triggered strictly by a status or by
 * the absence of a known asset type, never by guessing from `rawName`.
 */

export type ImprovementPriority = "high" | "medium" | "low";

export interface ImprovementSuggestion {
  id: string;
  priority: ImprovementPriority;
  title: string;
  description: string;
  affectedItems: number;
}

export interface PortfolioResolutionImprovementPlan {
  suggestions: ImprovementSuggestion[];
  totals: {
    items: number;
    suggestions: number;
  };
}

/** Same priority as TASK-056A/060A/061A: `item.assetType` first,
 * `verifiedAsset.type` as fallback, "unknown" last -- no new rule. */
function extractAssetType(item: SnapshotItem): string {
  const raw = item.assetType ?? item.verifiedAsset?.type;
  if (typeof raw !== "string") {
    return "unknown";
  }
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : "unknown";
}

const PRIORITY_RANK: Record<ImprovementPriority, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

interface CandidateRule {
  id: string;
  priority: ImprovementPriority;
  title: string;
  description: string;
  matches: (item: SnapshotItem) => boolean;
}

const RULES: CandidateRule[] = [
  {
    id: "identify-asset-types",
    priority: "high",
    title: "Identifique o tipo dos ativos",
    description: "Preencher o tipo do ativo ajuda a aumentar a taxa de verificação automática.",
    matches: (item) => extractAssetType(item) === "unknown",
  },
  {
    id: "provide-more-evidence",
    priority: "high",
    title: "Forneça mais informações dos ativos",
    description:
      "Alguns ativos precisam de informações adicionais para serem verificados automaticamente.",
    matches: (item) => item.status === "needs-more-evidence",
  },
  {
    id: "review-item-errors",
    priority: "high",
    title: "Revise os ativos com erro",
    description: "Alguns ativos não puderam ser processados e retornaram erro.",
    matches: (item) => item.status === "item-error",
  },
  {
    id: "resolve-conflicts",
    priority: "medium",
    title: "Resolva informações conflitantes",
    description: "Alguns ativos têm informações que não coincidem entre as fontes consultadas.",
    matches: (item) => item.status === "conflict",
  },
  {
    id: "complete-required-data",
    priority: "medium",
    title: "Complete os dados obrigatórios",
    description: "Alguns ativos não puderam avançar na resolução por falta de dados obrigatórios.",
    matches: (item) => item.status === "blocked",
  },
];

/** Builds a prioritized, deduplicated improvement plan for the given
 * portfolio. Pure: same input always yields the same output, and the input
 * array (and its items) is never mutated. */
export function buildPortfolioResolutionImprovementPlan(
  items: readonly SnapshotItem[],
): PortfolioResolutionImprovementPlan {
  const suggestions: ImprovementSuggestion[] = [];

  for (const rule of RULES) {
    const affectedItems = items.filter(rule.matches).length;

    if (affectedItems > 0) {
      suggestions.push({
        id: rule.id,
        priority: rule.priority,
        title: rule.title,
        description: rule.description,
        affectedItems,
      });
    }
  }

  suggestions.sort((a, b) => {
    const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (byPriority !== 0) {
      return byPriority;
    }
    // Plain code-unit comparison, not `localeCompare` -- avoids any
    // dependency on the runtime's ICU/locale configuration.
    return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
  });

  return {
    suggestions,
    totals: {
      items: items.length,
      suggestions: suggestions.length,
    },
  };
}
