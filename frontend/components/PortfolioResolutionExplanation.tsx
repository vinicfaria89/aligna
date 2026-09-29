"use client";

import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { useId } from "react";

import type { ResolutionExplanation } from "@/lib/portfolio-resolution-explanations";

/**
 * TASK-061B: presentational only -- renders exactly what
 * `explainResolutionItem` (TASK-061A, pure) already decided. Never
 * re-derives a title, description, suggestion or severity; never calls the
 * network, the AIE resolver, or any provider. Used for both a fresh
 * resolution result and an opened saved/history snapshot -- both feed it
 * the same `ResolutionExplanation` shape.
 */

interface PortfolioResolutionExplanationProps {
  explanation: ResolutionExplanation;
}

const SEVERITY_STYLES: Record<
  ResolutionExplanation["severity"],
  { container: string; icon: string; Icon: typeof CheckCircle2 }
> = {
  success: {
    container: "border-aligna-line bg-aligna-pale",
    icon: "text-aligna-deep",
    Icon: CheckCircle2,
  },
  info: {
    container: "border-aligna-line bg-aligna-infoSoft",
    icon: "text-aligna-info",
    Icon: Info,
  },
  warning: {
    container: "border-aligna-line bg-aligna-warnSoft",
    icon: "text-aligna-warn",
    Icon: AlertTriangle,
  },
  error: {
    container: "border-aligna-line bg-aligna-dangerSoft",
    icon: "text-aligna-danger",
    Icon: XCircle,
  },
};

export function PortfolioResolutionExplanation({
  explanation,
}: PortfolioResolutionExplanationProps) {
  const titleId = useId();
  const { container, icon, Icon } = SEVERITY_STYLES[explanation.severity];

  return (
    <section
      aria-labelledby={titleId}
      className={`mt-2 min-w-0 rounded-lg border p-2.5 text-[12.5px] ${container}`}
    >
      <h4 id={titleId} className="flex items-center gap-1.5 font-semibold text-aligna-ink">
        <Icon size={14} className={icon} aria-hidden="true" />
        <span className="break-words">{explanation.title}</span>
      </h4>
      <p className="mt-1 break-words text-aligna-ink">{explanation.description}</p>
      {explanation.suggestion && (
        <div className="mt-1.5">
          <p className="font-semibold text-aligna-ink">Sugestão</p>
          <p className="break-words text-aligna-ink">{explanation.suggestion}</p>
        </div>
      )}
    </section>
  );
}
