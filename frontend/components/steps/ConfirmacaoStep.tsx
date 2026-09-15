"use client";

import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, Pencil } from "lucide-react";
import { useState } from "react";
import { CATEGORY_LABELS, LIQUIDITY_LABELS } from "@/lib/labels";
import { AssetCategory, ExtractedAsset, Liquidity } from "@/lib/types";

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS) as [AssetCategory, string][];
const LIQUIDITY_OPTIONS = Object.entries(LIQUIDITY_LABELS) as [Liquidity, string][];

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function AssetRow({ asset, onUpdate }: { asset: ExtractedAsset; onUpdate: (patch: Partial<ExtractedAsset>) => void }) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div className="grid grid-cols-[2.1fr_1.2fr_1fr_1fr_1.1fr_32px] items-center gap-2 border-t border-lastro-line px-4 py-3.5 text-[13.5px]">
        <div className="font-semibold">{asset.name}</div>
        <div className="text-lastro-muted">{CATEGORY_LABELS[asset.category]}</div>
        <div>{formatBRL(asset.value)}</div>
        <div className="text-lastro-muted">{asset.indexer || "—"}</div>
        <div>
          {asset.confidence === "ok" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-lastro-pale px-2.5 py-1 text-[11.5px] font-semibold text-lastro-mid">
              <CheckCircle2 size={13} /> Confirmado
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-lastro-warnSoft px-2.5 py-1 text-[11.5px] font-semibold text-lastro-warn">
              <AlertTriangle size={13} /> Verificar
            </span>
          )}
        </div>
        <button onClick={() => setEditing(true)} className="text-lastro-muted hover:text-lastro-ink">
          <Pencil size={15} />
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[2.1fr_1.2fr_1fr_1fr_1.1fr_32px] items-center gap-2 border-t border-lastro-line bg-lastro-pale/40 px-4 py-3">
      <input className="input py-1.5 text-xs" value={asset.name} onChange={(e) => onUpdate({ name: e.target.value })} />
      <select
        className="input py-1.5 text-xs"
        value={asset.category}
        onChange={(e) => onUpdate({ category: e.target.value as AssetCategory })}
      >
        {CATEGORY_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <input
        className="input py-1.5 text-xs"
        type="number"
        value={asset.value}
        onChange={(e) => onUpdate({ value: Number(e.target.value) })}
      />
      <select
        className="input py-1.5 text-xs"
        value={asset.liquidity}
        onChange={(e) => onUpdate({ liquidity: e.target.value as Liquidity })}
      >
        {LIQUIDITY_OPTIONS.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <button
        onClick={() => {
          onUpdate({ confidence: "ok" });
          setEditing(false);
        }}
        className="text-lastro-mid text-xs font-semibold"
      >
        Salvar
      </button>
    </div>
  );
}

export default function ConfirmacaoStep({
  loading,
  assets,
  onUpdateAsset,
  onBack,
  onNext,
}: {
  loading: boolean;
  assets: ExtractedAsset[];
  onUpdateAsset: (id: string, patch: Partial<ExtractedAsset>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const groups = new Map<string, ExtractedAsset[]>();
  for (const a of assets) {
    const list = groups.get(a.institution || "Instituição não informada") ?? [];
    list.push(a);
    groups.set(a.institution || "Instituição não informada", list);
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center px-16 py-32 text-center">
        <Loader2 size={28} className="mb-4 animate-spin text-lastro-mid" />
        <div className="text-[15px] font-semibold mb-1">Lendo seus extratos...</div>
        <div className="text-sm text-lastro-muted">Isso leva alguns segundos.</div>
      </div>
    );
  }

  return (
    <div className="px-14 py-24">
      <div className="max-w-[1000px]">
        <h1 className="font-serif font-extrabold tracking-tight text-3xl mb-2.5">Confira os ativos identificados</h1>
        <p className="text-[15px] text-lastro-muted leading-relaxed mb-10 max-w-[640px]">
          Organizamos os ativos abaixo a partir dos seus extratos. Revise e corrija o que for necessário — a análise final é
          baseada exatamente no que estiver aqui.
        </p>

        {Array.from(groups.entries()).map(([institution, items]) => {
          const total = items.reduce((sum, a) => sum + a.value, 0);
          return (
            <div key={institution} className="mb-7">
              <div className="mb-3 flex items-baseline justify-between">
                <div className="text-sm font-semibold">{institution}</div>
                <div className="text-[13px] text-lastro-muted">{formatBRL(total)}</div>
              </div>
              <div className="overflow-hidden rounded-md border border-lastro-line bg-lastro-card">
                <div className="grid grid-cols-[2.1fr_1.2fr_1fr_1fr_1.1fr_32px] gap-2 bg-lastro-pale px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-lastro-muted">
                  <div>Ativo</div>
                  <div>Tipo</div>
                  <div>Valor</div>
                  <div>Indexador</div>
                  <div>Status</div>
                  <div />
                </div>
                {items.map((a) => (
                  <AssetRow key={a.id} asset={a} onUpdate={(patch) => onUpdateAsset(a.id, patch)} />
                ))}
              </div>
            </div>
          );
        })}

        <div className="mt-12 flex items-center justify-between">
          <button className="text-sm font-medium text-lastro-muted" onClick={onBack}>
            ← Voltar
          </button>
          <button className="btn-primary" disabled={assets.length === 0} onClick={onNext}>
            Confirmar e gerar relatório
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
