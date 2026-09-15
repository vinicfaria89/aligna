"use client";

import { AlertTriangle, CheckCircle2, Info, Loader2, Mail } from "lucide-react";
import { useState } from "react";
import Donut from "@/components/Donut";
import { ApiError, submitIntake } from "@/lib/api";
import { STATIC_BENCHMARKS, buildReport } from "@/lib/report";
import { ExtractedAsset, PerfilData, riskProfileFromAnswers } from "@/lib/types";

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const SEVERITY_STYLES = {
  alto: { bg: "#fbe9e5", color: "#c1503a", Icon: AlertTriangle },
  medio: { bg: "#fbf1dd", color: "#c08a2e", Icon: AlertTriangle },
  info: { bg: "#e6f2f4", color: "#3d7a8a", Icon: Info },
};

export default function RelatorioStep({ perfil, assets }: { perfil: PerfilData; assets: ExtractedAsset[] }) {
  const riskProfile = riskProfileFromAnswers(perfil.toleranceAnswer);
  const report = buildReport(assets, riskProfile);

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinuar() {
    setSubmitting(true);
    setError(null);
    try {
      await submitIntake(perfil, riskProfile, assets);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não conseguimos continuar agora. Tente de novo em instantes.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="px-14 py-20 pb-28">
      <div className="max-w-[1040px]">
        <h1 className="font-serif font-extrabold tracking-tight text-[34px] mb-2">Relatório de adequação</h1>
        <div className="text-sm text-lastro-muted mb-11">
          Baseado em {new Set(assets.map((a) => a.institution)).size} instituição(ões) · {formatBRL(report.totalValue)} analisados
        </div>

        <div className="mb-11 grid grid-cols-[1.2fr_1fr] gap-4">
          <div className="rounded-lg border border-lastro-line bg-lastro-card p-6">
            <div className="mb-3.5 text-xs font-semibold uppercase tracking-wide text-lastro-muted">Perfil declarado</div>
            <div className="text-lg font-semibold capitalize">{riskProfile}</div>
            <div className="mt-1 text-[12.5px] text-lastro-muted">
              com base nas respostas do questionário de suitability
            </div>
          </div>
          <div className="rounded-lg border border-lastro-line bg-lastro-card p-6">
            <div className="mb-3.5 text-xs font-semibold uppercase tracking-wide text-lastro-muted">Patrimônio analisado</div>
            <div className="font-serif font-extrabold text-[22px]">{formatBRL(report.totalValue)}</div>
            <div className="mt-1 text-[12.5px] text-lastro-muted">{assets.length} ativo(s) confirmado(s)</div>
          </div>
        </div>

        <div className="mb-4 text-[15px] font-semibold">Alocação por classe de ativo</div>
        <div className="mb-11">
          <Donut
            slices={report.byClass.map((c) => ({ label: c.label, value: c.value, pct: c.pct }))}
            centerBig={formatBRL(report.totalValue)}
            centerSmall="patrimônio total"
          />
        </div>

        <div className="mb-4 text-[15px] font-semibold">O que encontramos</div>
        <div className="mb-11 flex flex-col gap-2.5">
          {report.alerts.map((alert, i) => {
            const style = SEVERITY_STYLES[alert.severity];
            const Icon = style.Icon;
            return (
              <div key={i} className="flex gap-3.5 rounded-md border border-lastro-line bg-lastro-card px-5 py-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md" style={{ background: style.bg, color: style.color }}>
                  <Icon size={17} />
                </div>
                <div>
                  <div className="mb-1 text-sm font-semibold">{alert.title}</div>
                  <div className="text-[13.5px] leading-relaxed text-lastro-muted">{alert.body}</div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mb-4 text-[15px] font-semibold">Indicadores usados na comparação</div>
        <div className="mb-8 overflow-hidden rounded-md border border-lastro-line">
          <div className="grid grid-cols-[1.4fr_1fr_1fr] bg-lastro-pale px-4.5 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-lastro-muted">
            <div>Indicador</div>
            <div>Valor</div>
            <div>Fonte</div>
          </div>
          {STATIC_BENCHMARKS.map((b) => (
            <div key={b.nome} className="grid grid-cols-[1.4fr_1fr_1fr] border-t border-lastro-line px-4.5 py-3 text-[13.5px]">
              <div className="font-medium">{b.nome}</div>
              <div>{b.valor}</div>
              <div className="text-lastro-muted">{b.fonte}</div>
            </div>
          ))}
        </div>

        <div className="mb-9 rounded-md border border-lastro-line bg-lastro-infoSoft p-5 text-[12.5px] leading-relaxed">
          Este relatório tem caráter exclusivamente informativo, com base nos dados enviados por você, e não constitui
          recomendação, orientação ou aconselhamento sobre investimentos específicos, nos termos da Resolução CVM 19/2021.
        </div>

        <div className="border-t border-lastro-line pt-6">
          <div className="mb-1 text-sm font-semibold">Qual o seu próximo passo?</div>
          <p className="mb-4.5 max-w-[520px] text-[13px] text-lastro-muted">
            As duas opções abaixo continuam do jeito que fizer mais sentido pra você.
          </p>

          {submitted ? (
            <div className="flex items-center gap-2.5 rounded-md border border-lastro-mid bg-lastro-pale px-5 py-4 text-sm font-semibold text-lastro-deep">
              <CheckCircle2 size={18} />
              Conta criada! Acesse o Planejador Financeiro e faça login com o e-mail e a senha que você definiu.
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border-[1.5px] border-lastro-mid bg-lastro-pale p-6">
                <div className="mb-3 inline-flex rounded-full bg-lastro-deep px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-lastro-cream">
                  Modo autônomo
                </div>
                <div className="mb-1.5 text-[14.5px] font-semibold">Continuar meu planejamento sozinho</div>
                <div className="mb-4 text-[13px] leading-relaxed text-lastro-muted">
                  Os dados que você já confirmou viram o ponto de partida do seu planejamento completo — metas, aposentadoria,
                  projeção de patrimônio.
                </div>
                <button className="btn-primary" disabled={submitting} onClick={handleContinuar}>
                  {submitting && <Loader2 size={16} className="animate-spin" />}
                  {submitting ? "Enviando..." : "Continuar no Planejador Financeiro"}
                </button>
                {error && <p className="mt-2.5 text-xs text-lastro-danger">{error}</p>}
              </div>

              <div className="rounded-lg border border-lastro-line bg-lastro-card p-6">
                <div className="mb-3 inline-flex rounded-full bg-lastro-goldSoft px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-lastro-ink">
                  Acompanhado
                </div>
                <div className="mb-1.5 text-[14.5px] font-semibold">Quero acompanhamento de um especialista</div>
                <div className="mb-4 text-[13px] leading-relaxed text-lastro-muted">
                  Um profissional registrado na CVM analisa sua carteira com você e pode dar recomendação de verdade.
                </div>
                <div className="flex flex-wrap gap-2.5">
                  <a
                    href="https://wa.me/5511919733914"
                    className="flex items-center gap-2 rounded-md bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white"
                  >
                    WhatsApp
                  </a>
                  <a
                    href="mailto:vinicius.faria@gcbinvestimentos.com"
                    className="flex items-center gap-2 rounded-md border border-lastro-line px-4 py-2.5 text-sm font-semibold"
                  >
                    <Mail size={15} /> E-mail
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
