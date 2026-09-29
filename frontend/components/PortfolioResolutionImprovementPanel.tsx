"use client";

import { AlertCircle, AlertTriangle, Info } from "lucide-react";

import { buildPortfolioResolutionImprovementPlan } from "@/lib/portfolio-resolution-improvement-plan";
import type { SnapshotItem } from "@/lib/portfolio-snapshot-mapping";

/**
 * TASK-062B: presentational only -- consumes
 * `buildPortfolioResolutionImprovementPlan` (TASK-062A, pure) exactly as it
 * returns it. Never recomputes a suggestion, never reorders, never calls
 * the network or the AIE resolver. Renders from whatever `SnapshotItem[]`
 * the caller already has in memory (a fresh resolution's `exportableItems`,
 * or an opened saved snapshot's `items`) -- both cases are the SAME array
 * shape, so this component never needs to know which one it is. When the
 * plan has no suggestions (fully verified portfolio), the whole panel
 * renders nothing -- no empty-state copy.
 */

interface PortfolioResolutionImprovementPanelProps {
  items: readonly SnapshotItem[];
  /** Distinct heading id per mount point -- the fresh-result section and
   * the saved-snapshot section can both be visible at once. */
  titleId?: string;
}

const PRIORITY_STYLES = {
  high: {
    container: "border-aligna-line bg-aligna-dangerSoft",
    icon: "text-aligna-danger",
    Icon: AlertCircle,
  },
  medium: {
    container: "border-aligna-line bg-aligna-warnSoft",
    icon: "text-aligna-warn",
    Icon: AlertTriangle,
  },
  low: {
    container: "border-aligna-line bg-aligna-infoSoft",
    icon: "text-aligna-info",
    Icon: Info,
  },
} as const;

function pluralAtivos(count: number): string {
  return count === 1 ? "ativo" : "ativos";
}

export function PortfolioResolutionImprovementPanel({
  items,
  titleId = "csv-improvement-title",
}: PortfolioResolutionImprovementPanelProps) {
  const plan = buildPortfolioResolutionImprovementPlan(items);

  if (plan.suggestions.length === 0) {
    return null;
  }

  return (
    <section className="card mt-4" aria-labelledby={titleId}>
      <h2 id={titleId} className="mb-3 text-[14.5px] font-semibold">
        Como melhorar esta resolução
      </h2>
      <ul className="flex flex-col gap-2">
        {plan.suggestions.map((suggestion) => {
          const { container, icon, Icon } = PRIORITY_STYLES[suggestion.priority];
          const headingId = `${titleId}-${suggestion.id}`;

          return (
            <li key={suggestion.id} className={`min-w-0 rounded-lg border p-3 ${container}`}>
              <h3
                id={headingId}
                className="flex items-center gap-1.5 text-[13px] font-semibold text-aligna-ink"
              >
                <Icon size={15} className={icon} aria-hidden="true" />
                <span className="break-words">{suggestion.title}</span>
              </h3>
              <p className="mt-1 break-words text-[12.5px] text-aligna-ink">{suggestion.description}</p>
              <span className="mt-1.5 inline-flex min-w-0 items-center gap-1 rounded-full bg-aligna-paper px-2.5 py-0.5 text-[11.5px] font-semibold text-aligna-ink">
                <span className="break-words">
                  {suggestion.affectedItems} {pluralAtivos(suggestion.affectedItems)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
