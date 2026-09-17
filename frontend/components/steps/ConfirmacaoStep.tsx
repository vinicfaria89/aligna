"use client";

import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { CATEGORY_LABELS, LIQUIDITY_LABELS } from "@/lib/labels";
import { AssetCategory, ExtractedAsset, Liquidity } from "@/lib/types";

const CATEGORY_OPTIONS = Object.entries(CATEGORY_LABELS) as [AssetCategory, string][];
const LIQUIDITY_OPTIONS = Object.entries(LIQUIDITY_LABELS) as [Liquidity, string][];

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function newBlankAsset(): ExtractedAsset {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `manual-${Date.now()}-${Math.random()}`;
  return {
    id: `manual-${id}`,
    name: "",
    category: "outros",
    value: 0,
    institution: "",
    liquidity: "diaria",
    indexer: "",
    confidence: "ok",
  };
}

function AssetRow({
  asset,
  editing,
  onToggleEdit,
  onUpdate,
  onRemove,
}: {
  asset: ExtractedAsset;
  editing: boolean;
  onToggleEdit: () => void;
  onUpdate: (patch: Partial<ExtractedAsset>) => void;
  onRemove: () => void;
}) {
  if (!editing) {
    return (
      <div className="grid grid-cols-[2.1fr_1.2fr_1fr_1fr_1.1fr_32px] items-center gap-2 border-t border-aligna-line px-4 py-3.5 text-[13.5px]">
        <div className="font-semibold">{asset.name || "Sem nome"}</div>
        <div className="text-aligna-muted">{CATEGORY_LABELS[asset.category]}</div>
        <div>{formatBRL(asset.value)}</div>
        <div className="text-aligna-muted">{asset.indexer || "—"}</div>
        <div>
          {asset.confidence === "ok" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-aligna-pale px-2.5 py-1 text-[11.5px] font-semibold text-aligna-mid">
              <CheckCircle2 size={13} /> Confirmado
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-aligna-warnSoft px-2.5 py-1 text-[11.5px] font-semibold text-aligna-warn">
              <AlertTriangle size={13} /> Verificar
            </span>
          )}
        </div>
        <button onClick={onToggleEdit} className="text-aligna-muted hover:text-aligna-ink">
          <Pencil size={15} />
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[2.1fr_1.2fr_1fr_1fr_1.1fr_32px] items-center gap-2 border-t border-aligna-line bg-aligna-pale/40 px-4 py-3">
      <input
        className="input py-1.5 text-xs"
        placeholder="Nome do ativo"
        value={asset.name}
        onChange={(e) => onUpdate({ name: e.target.value })}
      />
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
          onToggleEdit();
        }}
        className="text-aligna-mid text-xs font-semibold"
      >
        Salvar
      </button>
      <button onClick={onRemove} className="text-aligna-muted hover:text-aligna-danger">
        <Trash2 size={15} />
      </button>
    </div>
  );
}

export default function ConfirmacaoStep({
  loading,
  error,
  onRetry,
  assets,
  onUpdateAsset,
  onAddAsset,
  onRemoveAsset,
  onBack,
  onNext,
}: {
  loading: boolean;
  error?: string | null;
  onRetry: () => void;
  assets: ExtractedAsset[];
  onUpdateAsset: (id: string, patch: Partial<ExtractedAsset>) => void;
  onAddAsset: (asset: ExtractedAsset) => void;
  onRemoveAsset: (id: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  function handleAddAsset() {
    const asset = newBlankAsset();
    onAddAsset(asset);
    setEditingId(asset.id);
  }

  const groups = new Map<string, ExtractedAsset[]>();
  for (const a of assets) {
    const list = groups.get(a.institution || "Instituição não informada") ?? [];
    list.push(a);
    groups.set(a.institution || "Instituição não informada", list);
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center px-16 py-32 text-center">
        <Loader2 size={28} className="mb-4 animate-spin text-aligna-mid" />
        <div className="text-[15px] font-semibold mb-1">Lendo seus extratos...</div>
        <div className="text-sm text-aligna-muted">Isso leva alguns segundos.</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center px-16 py-32 text-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-aligna-dangerSoft text-aligna-danger">
          <AlertTriangle size={22} />
        </div>
        <div className="text-[15px] font-semibold mb-1.5">Não conseguimos ler seus extratos</div>
        <div className="mb-6 max-w-[440px] text-sm text-aligna-muted">{error}</div>
        <div className="flex items-center gap-3">
          <button className="text-sm font-medium text-aligna-muted" onClick={onBack}>
            ← Trocar arquivos
          </button>
          <button className="btn-primary" onClick={onRetry}>
            <RefreshCw size={15} />
            Tentar de novo
          </button>
        </div>
        <button className="mt-4 text-sm font-medium text-aligna-mid" onClick={handleAddAsset}>
          ou adicionar ativos manualmente
        </button>
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-16 py-32 text-center">
        <div className="text-[15px] font-semibold mb-1.5">Nenhum ativo identificado</div>
        <div className="mb-6 max-w-[440px] text-sm text-aligna-muted">
          Não encontramos nenhuma posição de investimento nos arquivos enviados. Confira se são extratos de
          investimento (não fatura ou boleto), ou adicione seus ativos direto — renda fixa, ações, cripto, ouro,
          imóveis, qualquer tipo.
        </div>
        <div className="flex items-center gap-3">
          <button className="text-sm font-medium text-aligna-muted" onClick={onBack}>
            ← Trocar arquivos
          </button>
          <button className="btn-primary" onClick={handleAddAsset}>
            <Plus size={15} />
            Adicionar ativo manualmente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-14 py-24">
      <div className="max-w-[1000px]">
        <h1 className="font-serif font-extrabold tracking-tight text-3xl mb-2.5">Confira os ativos identificados</h1>
        <p className="text-[15px] text-aligna-muted leading-relaxed mb-10 max-w-[640px]">
          Organizamos os ativos abaixo a partir dos seus extratos. Revise, corrija ou adicione o que faltar — renda
          fixa, ações, cripto, ouro, imóveis, qualquer tipo de investimento. A análise final é baseada exatamente no
          que estiver aqui.
        </p>

        {Array.from(groups.entries()).map(([institution, items]) => {
          const total = items.reduce((sum, a) => sum + a.value, 0);
          return (
            <div key={institution} className="mb-7">
              <div className="mb-3 flex items-baseline justify-between">
                <div className="text-sm font-semibold">{institution}</div>
                <div className="text-[13px] text-aligna-muted">{formatBRL(total)}</div>
              </div>
              <div className="overflow-hidden rounded-md border border-aligna-line bg-aligna-card">
                <div className="grid grid-cols-[2.1fr_1.2fr_1fr_1fr_1.1fr_32px] gap-2 bg-aligna-pale px-4 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-aligna-muted">
                  <div>Ativo</div>
                  <div>Tipo</div>
                  <div>Valor</div>
                  <div>Indexador</div>
                  <div>Status</div>
                  <div />
                </div>
                {items.map((a) => (
                  <AssetRow
                    key={a.id}
                    asset={a}
                    editing={editingId === a.id}
                    onToggleEdit={() => setEditingId((cur) => (cur === a.id ? null : a.id))}
                    onUpdate={(patch) => onUpdateAsset(a.id, patch)}
                    onRemove={() => {
                      onRemoveAsset(a.id);
                      setEditingId((cur) => (cur === a.id ? null : cur));
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}

        <button
          className="mb-12 flex items-center gap-1.5 text-sm font-semibold text-aligna-mid"
          onClick={handleAddAsset}
        >
          <Plus size={15} />
          Adicionar ativo manualmente
        </button>

        <div className="flex items-center justify-between">
          <button className="text-sm font-medium text-aligna-muted" onClick={onBack}>
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
