"use client";

import { ArrowUpDown, Download, Equal, Minus, Plus, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";

import {
  comparePortfolioSnapshots,
  type ComparedSnapshotItem,
  type ComparedSnapshotItemChange,
} from "@/lib/portfolio-snapshot-comparison";
import {
  groupPortfolioSnapshotComparisonByAssetType,
  type PortfolioSnapshotComparisonAssetTypeGroup,
} from "@/lib/portfolio-snapshot-comparison-by-asset-type";
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
 *
 * TASK-055: visual/UX polish only -- five clearly separated blocks
 * (seleção → resumo → por tipo de ativo → diferenças → exportar), each
 * difference category dual-coded with an icon AND a color (never color
 * alone), and an explicit empty state per category instead of hiding the
 * section. None of this changes what gets compared, exported or how
 * identity/status are computed -- `comparePortfolioSnapshots` and the CSV
 * export helper are untouched.
 *
 * TASK-056B: the "Por tipo de ativo" block consumes
 * `groupPortfolioSnapshotComparisonByAssetType` (TASK-056A, pure) exactly as
 * it returns it -- this component never re-groups, re-sorts or re-labels an
 * asset type itself. It's read-only display: no group's totals/counts are
 * ever recomputed here, and the CSV export is untouched (still built from
 * `comparison`, never from the grouped view).
 */

const SNAPSHOT_STATUS_LABEL: Record<SnapshotStatus, string> = {
  verified: "Verificado",
  "needs-more-evidence": "Precisa de mais evidências",
  "needs-user": "Precisa da sua confirmação",
  conflict: "Evidências em conflito",
  blocked: "Bloqueado",
  "item-error": "Erro ao resolver",
};

type DiffTone = "added" | "removed" | "value" | "status" | "neutral";

const TONE_STYLES: Record<
  DiffTone,
  { badgeBg: string; badgeText: string; rowBg: string; rowBorder: string; icon: string }
> = {
  added: {
    badgeBg: "bg-aligna-pale",
    badgeText: "text-aligna-deep",
    rowBg: "bg-aligna-pale",
    rowBorder: "border-aligna-mid",
    icon: "text-aligna-deep",
  },
  removed: {
    badgeBg: "bg-aligna-dangerSoft",
    badgeText: "text-aligna-danger",
    rowBg: "bg-aligna-dangerSoft",
    rowBorder: "border-aligna-danger",
    icon: "text-aligna-danger",
  },
  value: {
    badgeBg: "bg-aligna-warnSoft",
    badgeText: "text-aligna-warn",
    rowBg: "bg-aligna-warnSoft",
    rowBorder: "border-aligna-warn",
    icon: "text-aligna-warn",
  },
  status: {
    badgeBg: "bg-aligna-infoSoft",
    badgeText: "text-aligna-info",
    rowBg: "bg-aligna-infoSoft",
    rowBorder: "border-aligna-info",
    icon: "text-aligna-info",
  },
  neutral: {
    badgeBg: "bg-aligna-paper",
    badgeText: "text-aligna-muted",
    rowBg: "bg-aligna-paper",
    rowBorder: "border-aligna-line",
    icon: "text-aligna-muted",
  },
};

/** `null` (base value of 0) reads as "—", matching the rest of the
 * comparison's own convention (e.g. the Resumo card above) -- never
 * `Infinity`/`NaN`, never a raw `null`. */
function percentageChangeText(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

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
        <p className="rounded-lg bg-aligna-paper px-3 py-2.5 text-[13px] text-aligna-muted">
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
      <h2 id="csv-compare-title" className="mb-4 text-[14.5px] font-semibold">
        Comparar resultados salvos
      </h2>

      <div>
        <h3 className="mb-2 text-[13px] font-semibold text-aligna-ink">Selecionar resultados</h3>
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
      </div>

      <div aria-live="polite" className="mt-4">
        {baseEntry === null || targetEntry === null ? (
          <p className="rounded-lg bg-aligna-paper px-3 py-2.5 text-[13px] text-aligna-muted">
            Selecione os dois resultados que você quer comparar.
          </p>
        ) : sameEntrySelected ? (
          <p className="rounded-lg bg-aligna-paper px-3 py-2.5 text-[13px] text-aligna-muted">
            Selecione dois resultados diferentes.
          </p>
        ) : comparison === null ? (
          <p className="rounded-lg bg-aligna-dangerSoft px-3 py-2.5 text-[13px] text-aligna-danger">
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-aligna-line bg-aligna-paper px-3 py-2.5">
      <dt className="text-[11.5px] text-aligna-muted">{label}</dt>
      <dd className="mt-0.5 break-words text-[14px] font-semibold text-aligna-ink">{value}</dd>
    </div>
  );
}

function CountBadge({
  tone,
  icon: Icon,
  label,
  count,
}: {
  tone: DiffTone;
  icon: LucideIcon;
  label: string;
  count: number;
}) {
  const t = TONE_STYLES[tone];
  return (
    <li
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-medium ${t.badgeBg} ${t.badgeText}`}
    >
      <Icon size={13} aria-hidden="true" />
      <span>
        {label}: {count}
      </span>
    </li>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="mb-1.5 flex items-center gap-2">
      <h4 className="text-[13px] font-semibold text-aligna-ink">{title}</h4>
      <span className="rounded-full bg-aligna-paper px-2 py-0.5 text-[11px] font-medium text-aligna-muted">
        {count}
      </span>
    </div>
  );
}

function DiffRow({ tone, icon: Icon, children }: { tone: DiffTone; icon: LucideIcon; children: React.ReactNode }) {
  const t = TONE_STYLES[tone];
  return (
    <li className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[13px] ${t.rowBorder} ${t.rowBg}`}>
      <Icon size={14} aria-hidden="true" className={`mt-0.5 shrink-0 ${t.icon}`} />
      <span className="min-w-0 break-words text-aligna-ink">{children}</span>
    </li>
  );
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
  const hasDifferences = counts.added > 0 || counts.removed > 0 || counts.changedValue > 0 || counts.changedStatus > 0;
  // TASK-056B: the grouped view is derived HERE, at render time, from the
  // SAME `comparison` the rest of this component already has -- never a
  // second call to `comparePortfolioSnapshots`, never a parallel grouping
  // rule. `groupPortfolioSnapshotComparisonByAssetType` is pure and cheap
  // (no network/DOM), so recomputing it on every render is fine.
  const byAssetType = groupPortfolioSnapshotComparisonByAssetType(comparison);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="mb-2 text-[13.5px] font-semibold text-aligna-ink">Resumo</h3>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatCard label="Valor inicial" value={formatAmount(totals.baseValue)} />
          <StatCard label="Valor final" value={formatAmount(totals.targetValue)} />
          <StatCard label="Variação absoluta" value={formatAmount(totals.absoluteChange)} />
          <StatCard label="Variação percentual" value={percentageChangeText(totals.percentageChange)} />
        </dl>

        <ul className="mt-3 flex flex-wrap gap-2">
          <CountBadge tone="added" icon={Plus} label="Adicionados" count={counts.added} />
          <CountBadge tone="removed" icon={Minus} label="Removidos" count={counts.removed} />
          <CountBadge tone="neutral" icon={Equal} label="Mantidos" count={counts.kept} />
          <CountBadge tone="value" icon={ArrowUpDown} label="Alteraram valor" count={counts.changedValue} />
          <CountBadge tone="status" icon={RefreshCw} label="Alteraram status" count={counts.changedStatus} />
        </ul>

        {!hasDifferences && (
          <p className="mt-3 rounded-lg bg-aligna-paper px-3 py-2.5 text-[13px] text-aligna-muted">
            Nenhuma diferença relevante entre esses dois resultados — os ativos e valores são os mesmos.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t border-aligna-line pt-5">
        <div>
          <h3 className="text-[13.5px] font-semibold text-aligna-ink">Por tipo de ativo</h3>
          <p className="mt-0.5 text-[12px] text-aligna-muted">
            Veja como cada classe da carteira mudou entre os dois resultados.
          </p>
        </div>
        {byAssetType.groups.length === 0 ? (
          <p className="text-[13px] text-aligna-muted">Nenhum tipo de ativo identificado para esta comparação.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {byAssetType.groups.map((group) => (
              <AssetTypeGroupCard key={group.assetType} group={group} />
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-5 border-t border-aligna-line pt-5">
        <h3 className="text-[13.5px] font-semibold text-aligna-ink">Diferenças</h3>

        <ComparisonList
          tone="added"
          icon={Plus}
          title="Adicionados"
          items={added}
          emptyMessage="Nenhum ativo adicionado."
          render={(entry) => `${describeItem(entry.item)} — ${formatAmount(entry.value, entry.item.currency)}`}
        />
        <ComparisonList
          tone="removed"
          icon={Minus}
          title="Removidos"
          items={removed}
          emptyMessage="Nenhum ativo removido."
          render={(entry) => `${describeItem(entry.item)} — ${formatAmount(entry.value, entry.item.currency)}`}
        />
        <ComparisonChangeList
          tone="value"
          icon={ArrowUpDown}
          title="Alteraram valor"
          items={valueChanged}
          emptyMessage="Nenhuma alteração de valor encontrada."
          render={(entry) =>
            `${describeItem(entry.base)} — de ${formatAmount(entry.baseValue, entry.base.currency)} para ${formatAmount(entry.targetValue, entry.target.currency)} — ${entry.absoluteChange >= 0 ? "+" : ""}${formatAmount(entry.absoluteChange, entry.target.currency)}`
          }
        />
        <ComparisonChangeList
          tone="status"
          icon={RefreshCw}
          title="Alteraram status"
          items={statusChanged}
          emptyMessage="Nenhuma alteração de status encontrada."
          render={(entry) =>
            `${describeItem(entry.base)} — de ${SNAPSHOT_STATUS_LABEL[entry.baseStatus]} para ${SNAPSHOT_STATUS_LABEL[entry.targetStatus]}`
          }
        />
      </div>

      <div className="flex flex-col gap-2 border-t border-aligna-line pt-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[13px] font-medium text-aligna-ink">Exportar esta comparação</p>
          <p id="csv-compare-export-help" className="text-[12px] text-aligna-muted">
            CSV com resumo, adicionados, removidos e alterações de valor ou status.
          </p>
        </div>
        <button
          type="button"
          aria-describedby="csv-compare-export-help"
          className={`btn-ghost inline-flex shrink-0 items-center gap-1.5 self-start ${FOCUS_RING}`}
          onClick={() => handleExportComparisonCsv(comparison, baseEntry, targetEntry)}
        >
          <Download size={16} aria-hidden="true" />
          Exportar comparação CSV
        </button>
      </div>
    </div>
  );
}

/** One card in the "Por tipo de ativo" grid -- purely presentational over a
 * `PortfolioSnapshotComparisonAssetTypeGroup` (TASK-056A), never recomputing
 * any of its totals/counts. The variation's sign is spelled out as a literal
 * "+"/"-" character (same convention as the "Alteraram valor" list above),
 * never left to color alone. */
function AssetTypeGroupCard({ group }: { group: PortfolioSnapshotComparisonAssetTypeGroup }) {
  const { totals, counts } = group;
  const sign = totals.absoluteChange >= 0 ? "+" : "";
  const changeTone =
    totals.absoluteChange > 0
      ? "text-aligna-deep"
      : totals.absoluteChange < 0
        ? "text-aligna-danger"
        : "text-aligna-muted";

  return (
    <li className="min-w-0 rounded-lg border border-aligna-line bg-white p-3">
      <h4 className="break-words text-[13px] font-semibold text-aligna-ink">{group.label}</h4>

      <dl className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
        <div className="min-w-0">
          <dt className="text-aligna-muted">Valor inicial</dt>
          <dd className="break-words font-medium text-aligna-ink">{formatAmount(totals.baseValue)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-aligna-muted">Valor final</dt>
          <dd className="break-words font-medium text-aligna-ink">{formatAmount(totals.targetValue)}</dd>
        </div>
      </dl>

      <p className="mt-2 break-words text-[12px] text-aligna-muted">
        Variação:{" "}
        <span className={`font-medium ${changeTone}`}>
          {sign}
          {formatAmount(totals.absoluteChange)} ({percentageChangeText(totals.percentageChange)})
        </span>
      </p>

      <ul className="mt-2 flex flex-wrap gap-1.5">
        <CountBadge tone="added" icon={Plus} label="Adicionados" count={counts.added} />
        <CountBadge tone="removed" icon={Minus} label="Removidos" count={counts.removed} />
        <CountBadge tone="neutral" icon={Equal} label="Mantidos" count={counts.kept} />
        <CountBadge tone="value" icon={ArrowUpDown} label="Alteraram valor" count={counts.changedValue} />
        <CountBadge tone="status" icon={RefreshCw} label="Alteraram status" count={counts.changedStatus} />
      </ul>
    </li>
  );
}

function ComparisonList({
  tone,
  icon,
  title,
  items,
  emptyMessage,
  render,
}: {
  tone: DiffTone;
  icon: LucideIcon;
  title: string;
  items: ComparedSnapshotItem[];
  emptyMessage: string;
  render: (entry: ComparedSnapshotItem) => string;
}) {
  return (
    <div>
      <SectionHeader title={title} count={items.length} />
      {items.length === 0 ? (
        <p className="text-[13px] text-aligna-muted">{emptyMessage}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((entry) => (
            <DiffRow key={entry.key} tone={tone} icon={icon}>
              {render(entry)}
            </DiffRow>
          ))}
        </ul>
      )}
    </div>
  );
}

function ComparisonChangeList({
  tone,
  icon,
  title,
  items,
  emptyMessage,
  render,
}: {
  tone: DiffTone;
  icon: LucideIcon;
  title: string;
  items: ComparedSnapshotItemChange[];
  emptyMessage: string;
  render: (entry: ComparedSnapshotItemChange) => string;
}) {
  return (
    <div>
      <SectionHeader title={title} count={items.length} />
      {items.length === 0 ? (
        <p className="text-[13px] text-aligna-muted">{emptyMessage}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {items.map((entry) => (
            <DiffRow key={entry.key} tone={tone} icon={icon}>
              {render(entry)}
            </DiffRow>
          ))}
        </ul>
      )}
    </div>
  );
}
