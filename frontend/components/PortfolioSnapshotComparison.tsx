"use client";

import { Download } from "lucide-react";
import { useEffect, useState } from "react";

import {
  comparePortfolioSnapshots,
  type ComparedSnapshotItem,
  type ComparedSnapshotItemChange,
} from "@/lib/portfolio-snapshot-comparison";
import {
  buildPortfolioSnapshotComparisonCsv,
  comparisonExportFileName,
} from "@/lib/portfolio-snapshot-comparison-export";
import type { SnapshotHistoryEntry, SnapshotItem, SnapshotStatus } from "@/lib/portfolio-snapshot-mapping";
import { downloadCsvFile } from "@/lib/portfolio-snapshot-export";
import { FOCUS_RING } from "@/lib/ui/focus-ring";

import { formatAmount, savedAtText } from "./PortfolioCsvResolver";

/**
 * TASK-053B: compares two ALREADY-LOADED saved snapshots from the history
 * list. Purely client-side, over `history[].items` the parent already has
 * (TASK-048B's `list()` loads full items per entry) -- this component never
 * fetches, never calls the AIE resolver, never saves, opens or deletes a
 * snapshot. It reads `comparePortfolioSnapshots` (TASK-053A, pure) and
 * renders its result; it never mutates `history` or any entry in it.
 *
 * Selecting a comparison here never changes what "Abrir" displays elsewhere
 * on the page -- entirely independent state.
 */

const SNAPSHOT_STATUS_LABEL: Record<SnapshotStatus, string> = {
  verified: "Verificado",
  "needs-more-evidence": "Precisa de mais evidências",
  "needs-user": "Precisa da sua confirmação",
  conflict: "Evidências em conflito",
  blocked: "Bloqueado",
  "item-error": "Erro ao resolver",
};

function describeItem(item: SnapshotItem): string {
  return item.verifiedAsset?.code || item.ticker || item.code || item.rawName;
}

function entryOptionLabel(entry: SnapshotHistoryEntry): string {
  const at = savedAtText(entry.createdAt) ?? "data desconhecida";
  const count = entry.items.length;
  return `${at} — ${count} ${count === 1 ? "ativo" : "ativos"}`;
}

interface PortfolioSnapshotComparisonProps {
  history: SnapshotHistoryEntry[];
}

export function PortfolioSnapshotComparison({ history }: PortfolioSnapshotComparisonProps) {
  const [baseId, setBaseId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);

  // Keeps the user's explicit choice whenever both selected ids still exist
  // in `history`; only picks a default (or clears the selection) when one of
  // them no longer does -- e.g. TASK-053B requirement 10, a selected entry
  // was deleted. `history[0]` is the most recent entry (same order the
  // history list above already renders), so the default pairs the two most
  // recent snapshots: base = second most recent, target = most recent.
  useEffect(() => {
    const ids = new Set(history.map((entry) => entry.id));
    const baseStillValid = baseId !== null && ids.has(baseId);
    const targetStillValid = targetId !== null && ids.has(targetId);

    if (baseStillValid && targetStillValid) {
      return;
    }

    if (history.length >= 2) {
      setTargetId(history[0].id);
      setBaseId(history[1].id);
    } else {
      setBaseId(null);
      setTargetId(null);
    }
    // Only the SET of available ids should retrigger this -- see the
    // early-return above, which keeps an explicit user choice stable across
    // unrelated re-renders of `history` (e.g. after opening an entry).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history]);

  if (history.length === 0) {
    // Nothing saved at all: no point offering a comparison -- mirrors the
    // history section's own "Nenhum resultado salvo ainda." zero-state,
    // which already tells the user this.
    return null;
  }

  if (history.length === 1) {
    return (
      <section className="card" aria-labelledby="csv-compare-title">
        <h2 id="csv-compare-title" className="mb-1 text-[14.5px] font-semibold">
          Comparar resultados salvos
        </h2>
        <p className="text-[13px] text-aligna-muted">
          Salve pelo menos dois resultados para comparar.
        </p>
      </section>
    );
  }

  const baseEntry = history.find((entry) => entry.id === baseId) ?? null;
  const targetEntry = history.find((entry) => entry.id === targetId) ?? null;
  const sameEntrySelected = baseEntry !== null && targetEntry !== null && baseEntry.id === targetEntry.id;

  const comparison =
    baseEntry && targetEntry && !sameEntrySelected
      ? comparePortfolioSnapshots(baseEntry.items, targetEntry.items)
      : null;

  return (
    <section className="card" aria-labelledby="csv-compare-title">
      <h2 id="csv-compare-title" className="mb-3 text-[14.5px] font-semibold">
        Comparar resultados salvos
      </h2>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="csv-compare-base" className="mb-1 block text-[13px] font-medium text-aligna-ink">
            Base
          </label>
          <select
            id="csv-compare-base"
            className="w-full rounded-lg border border-aligna-line bg-white px-3 py-2 text-[13px]"
            value={baseId ?? ""}
            onChange={(event) => setBaseId(event.target.value || null)}
          >
            <option value="" disabled>
              Selecione um resultado salvo
            </option>
            {history.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entryOptionLabel(entry)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="csv-compare-target" className="mb-1 block text-[13px] font-medium text-aligna-ink">
            Alvo
          </label>
          <select
            id="csv-compare-target"
            className="w-full rounded-lg border border-aligna-line bg-white px-3 py-2 text-[13px]"
            value={targetId ?? ""}
            onChange={(event) => setTargetId(event.target.value || null)}
          >
            <option value="" disabled>
              Selecione um resultado salvo
            </option>
            {history.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entryOptionLabel(entry)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div aria-live="polite" className="mt-4">
        {baseEntry === null || targetEntry === null ? (
          <p className="text-[13px] text-aligna-muted">Selecione dois resultados salvos.</p>
        ) : sameEntrySelected ? (
          <p className="text-[13px] text-aligna-muted">Selecione dois resultados diferentes.</p>
        ) : comparison === null ? (
          <p className="text-[13px] text-aligna-danger">
            Não foi possível montar a comparação agora. Escolha os resultados novamente.
          </p>
        ) : (
          <ComparisonSummary comparison={comparison} baseEntry={baseEntry} targetEntry={targetEntry} />
        )}
      </div>
    </section>
  );
}

/** "Exportar comparação CSV": builds the CSV from the comparison ALREADY
 * computed (never recalculates anything, never touches the network) and
 * triggers a local download -- the same `downloadCsvFile` the individual
 * saved-result export already uses (lib/portfolio-snapshot-export.ts). */
function handleExportComparisonCsv(
  comparison: ReturnType<typeof comparePortfolioSnapshots>,
  baseEntry: SnapshotHistoryEntry,
  targetEntry: SnapshotHistoryEntry,
) {
  const csv = buildPortfolioSnapshotComparisonCsv(comparison);
  const filename = comparisonExportFileName(baseEntry.id, targetEntry.id);
  downloadCsvFile(filename, csv);
}

function ComparisonSummary({
  comparison,
  baseEntry,
  targetEntry,
}: {
  comparison: ReturnType<typeof comparePortfolioSnapshots>;
  baseEntry: SnapshotHistoryEntry;
  targetEntry: SnapshotHistoryEntry;
}) {
  const { totals, counts, added, removed, kept } = comparison;
  const valueChanged = kept.filter((entry) => entry.valueChanged);
  const statusChanged = kept.filter((entry) => entry.statusChanged);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-[13.5px] font-semibold">Resumo</h3>
          <button
            type="button"
            className={`btn-ghost inline-flex items-center gap-1.5 ${FOCUS_RING}`}
            onClick={() => handleExportComparisonCsv(comparison, baseEntry, targetEntry)}
          >
            <Download size={16} aria-hidden="true" />
            Exportar comparação CSV
          </button>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13px] sm:grid-cols-4">
          <div>
            <dt className="text-aligna-muted">Valor inicial</dt>
            <dd className="font-medium">{formatAmount(totals.baseValue)}</dd>
          </div>
          <div>
            <dt className="text-aligna-muted">Valor final</dt>
            <dd className="font-medium">{formatAmount(totals.targetValue)}</dd>
          </div>
          <div>
            <dt className="text-aligna-muted">Variação absoluta</dt>
            <dd className="font-medium">{formatAmount(totals.absoluteChange)}</dd>
          </div>
          <div>
            <dt className="text-aligna-muted">Variação percentual</dt>
            <dd className="font-medium">
              {totals.percentageChange === null ? "—" : `${totals.percentageChange.toFixed(1)}%`}
            </dd>
          </div>
        </dl>
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-aligna-muted">
        <li>Adicionados: {counts.added}</li>
        <li>Removidos: {counts.removed}</li>
        <li>Mantidos: {counts.kept}</li>
        <li>Alteraram valor: {counts.changedValue}</li>
        <li>Alteraram status: {counts.changedStatus}</li>
      </ul>

      <ComparisonList
        title="Adicionados"
        items={added}
        render={(entry) => `${describeItem(entry.item)} — ${formatAmount(entry.value, entry.item.currency)}`}
      />
      <ComparisonList
        title="Removidos"
        items={removed}
        render={(entry) => `${describeItem(entry.item)} — ${formatAmount(entry.value, entry.item.currency)}`}
      />
      <ComparisonChangeList
        title="Alteraram valor"
        items={valueChanged}
        render={(entry) =>
          `${describeItem(entry.base)} — de ${formatAmount(entry.baseValue, entry.base.currency)} para ${formatAmount(entry.targetValue, entry.target.currency)} — ${entry.absoluteChange >= 0 ? "+" : ""}${formatAmount(entry.absoluteChange, entry.target.currency)}`
        }
      />
      <ComparisonChangeList
        title="Alteraram status"
        items={statusChanged}
        render={(entry) =>
          `${describeItem(entry.base)} — de ${SNAPSHOT_STATUS_LABEL[entry.baseStatus]} para ${SNAPSHOT_STATUS_LABEL[entry.targetStatus]}`
        }
      />
    </div>
  );
}

function ComparisonList({
  title,
  items,
  render,
}: {
  title: string;
  items: ComparedSnapshotItem[];
  render: (entry: ComparedSnapshotItem) => string;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div>
      <h4 className="mb-1 text-[13px] font-semibold">{title}</h4>
      <ul className="list-disc pl-5 text-[13px] text-aligna-ink">
        {items.map((entry) => (
          <li key={entry.key}>{render(entry)}</li>
        ))}
      </ul>
    </div>
  );
}

function ComparisonChangeList({
  title,
  items,
  render,
}: {
  title: string;
  items: ComparedSnapshotItemChange[];
  render: (entry: ComparedSnapshotItemChange) => string;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div>
      <h4 className="mb-1 text-[13px] font-semibold">{title}</h4>
      <ul className="list-disc pl-5 text-[13px] text-aligna-ink">
        {items.map((entry) => (
          <li key={entry.key}>{render(entry)}</li>
        ))}
      </ul>
    </div>
  );
}
