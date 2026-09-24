"use client";

import { summarizePortfolioResolutionQuality } from "@/lib/portfolio-resolution-quality-metrics";
import type { SnapshotItem } from "@/lib/portfolio-snapshot-mapping";

/**
 * TASK-060B: presentational only -- consumes
 * `summarizePortfolioResolutionQuality` (TASK-060A, pure) exactly as it
 * returns it. Never recomputes a metric, never calls the network, never
 * calls the AIE resolver, never touches a snapshot. Rendered from whatever
 * `SnapshotItem[]` the caller already has in memory (a fresh resolution's
 * `exportableItems`, or an opened saved snapshot's `items`) -- both cases
 * are the SAME array shape, so this component never needs to know which
 * one it is.
 *
 * This task only PRESENTS the metrics; it does not explain a pendency in
 * depth (that is TASK-061) and does not add any visualization beyond
 * small cards/compact lists, per the task's own "sem gráfico, sem
 * biblioteca nova" instruction.
 */

function formatVerificationRate(rate: number | null): string {
  if (rate === null) {
    return "—";
  }
  const rounded = Math.round(rate * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1)}%`;
}

function pluralAtivos(count: number): string {
  return count === 1 ? "ativo" : "ativos";
}

interface PortfolioResolutionQualityPanelProps {
  items: readonly SnapshotItem[];
  /** Distinct heading id per mount point -- the fresh-result section and
   * the saved-snapshot section can both be visible at once (they are
   * independent pieces of state in PortfolioCsvResolver.tsx), so each
   * instance needs its own id to stay valid HTML/accessible. */
  titleId?: string;
}

export function PortfolioResolutionQualityPanel({
  items,
  titleId = "csv-quality-title",
}: PortfolioResolutionQualityPanelProps) {
  const summary = summarizePortfolioResolutionQuality(items);
  const { totals, bySource, byAssetType, pendingReasons, errors } = summary;

  return (
    <section className="card mt-4" aria-labelledby={titleId}>
      <h2 id={titleId} className="mb-1 text-[14.5px] font-semibold">
        Qualidade da resolução
      </h2>
      <p className="mb-4 text-[13px] text-aligna-muted">
        Resumo de quantos ativos foram identificados automaticamente e quais ainda precisam de evidências.
      </p>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <StatCard label="Total de ativos" value={String(totals.items)} />
        <StatCard label="Verificados" value={String(totals.verified)} />
        <StatCard label="Pendentes" value={String(totals.pending)} />
        <StatCard label="Erros" value={String(totals.errors)} />
        <StatCard label="Taxa de verificação" value={formatVerificationRate(totals.verificationRate)} />
      </dl>

      <div className="mt-4">
        <h3 className="mb-1.5 text-[13px] font-semibold text-aligna-ink">Fontes usadas</h3>
        {bySource.length === 0 ? (
          <p className="text-[13px] text-aligna-muted">Nenhuma fonte usada ainda.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {bySource.map((row) => (
              <li
                key={row.source}
                className="min-w-0 rounded-full bg-aligna-paper px-3 py-1 text-[12.5px] text-aligna-ink"
              >
                <span className="break-words">
                  {row.source}: {row.count} {pluralAtivos(row.count)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4">
        <h3 className="mb-1.5 text-[13px] font-semibold text-aligna-ink">Tipos identificados</h3>
        {byAssetType.length === 0 ? (
          <p className="text-[13px] text-aligna-muted">Nenhum tipo identificado ainda.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {byAssetType.map((row) => (
              <li
                key={row.assetType}
                className="min-w-0 rounded-full bg-aligna-paper px-3 py-1 text-[12.5px] text-aligna-ink"
              >
                <span className="break-words">
                  {row.label}: {row.count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4">
        <h3 className="mb-1.5 text-[13px] font-semibold text-aligna-ink">Pendências</h3>
        <p className="mb-1.5 text-[12px] text-aligna-muted">
          Pendências não significam erro; indicam que não houve evidência suficiente para verificar
          automaticamente.
        </p>
        {pendingReasons.length === 0 ? (
          <p className="text-[13px] text-aligna-muted">Nenhuma pendência encontrada.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {pendingReasons.map((row) => (
              <li key={row.reason} className="break-words text-[13px] text-aligna-ink">
                {row.label}: {row.count}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4">
        <h3 className="mb-1.5 text-[13px] font-semibold text-aligna-ink">Erros</h3>
        {errors.length === 0 ? (
          <p className="text-[13px] text-aligna-muted">Nenhum erro encontrado.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {errors.map((row) => (
              <li
                key={row.key}
                className="rounded-lg border border-aligna-dangerSoft bg-aligna-dangerSoft px-3 py-2 text-[13px] text-aligna-danger"
              >
                <span className="break-words">
                  {row.name} — {row.status}
                  {row.message ? `: ${row.message}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-aligna-line bg-aligna-paper px-3 py-2.5">
      <dt className="text-[11.5px] text-aligna-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-[14px] font-semibold text-aligna-ink">{value}</dd>
    </div>
  );
}
