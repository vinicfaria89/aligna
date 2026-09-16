"use client";

import { AlertTriangle, CheckCircle2, Info, Loader2, Lock, Mail } from "lucide-react";
import { useState } from "react";
import Donut from "@/components/Donut";
import { ApiError, createCheckoutSession, IntakeTokens, submitIntake } from "@/lib/api";
import { STATIC_BENCHMARKS, buildReport, computeScore } from "@/lib/report";
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
  const score = computeScore(assets, riskProfile, report);
  const scoreColor = score.total >= 70 ? "#1c8a4f" : score.total >= 40 ? "#c08a2e" : "#c1503a";
  const scoreLabel = score.total >= 70 ? "Consolidado" : score.total >= 40 ? "Em desenvolvimento" : "Atenção";
  const worstCriterion = [...score.criteria].sort((a, b) => a.score - b.score)[0];
  const teaserAlert = report.alerts[0];

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assinando, setAssinando] = useState(false);
  const [tokens, setTokens] = useState<IntakeTokens | null>(null);

  const mailtoAssinar = `mailto:vinicius.faria@gcbinvestimentos.com?subject=${encodeURIComponent(
    "Quero assinar o Aligna Premium"
  )}&body=${encodeURIComponent(`Acabei de fazer meu diagnóstico (score ${score.total}) e quero ver o relatório completo.`)}`;

  // Tanto "Continuar no Planejador Financeiro" quanto "Quero assinar" partem
  // da mesma conta -- criar duas vezes falharia (e-mail já cadastrado), daí
  // o cache em `tokens`. A conta só é criada na primeira vez que uma das
  // duas ações é de fato acionada, nunca antes.
  async function ensureAccount(): Promise<IntakeTokens> {
    if (tokens) return tokens;
    const created = await submitIntake(perfil, riskProfile, assets);
    setTokens(created);
    return created;
  }

  async function handleContinuar() {
    setSubmitting(true);
    setError(null);
    try {
      await ensureAccount();
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não conseguimos continuar agora. Tente de novo em instantes.");
    } finally {
      setSubmitting(false);
    }
  }

  // "Assinar" cria a conta (se ainda não existir) e manda direto pro
  // Checkout hospedado da Stripe. Enquanto a conta Stripe não existir de
  // verdade (sem STRIPE_SECRET_KEY em produção), o backend responde 502 e
  // caímos pro contato manual -- nunca um erro cru na tela.
  async function handleAssinar() {
    setAssinando(true);
    try {
      const { access_token } = await ensureAccount();
      const checkoutUrl = await createCheckoutSession(access_token);
      window.location.href = checkoutUrl;
    } catch {
      window.location.href = mailtoAssinar;
    } finally {
      setAssinando(false);
    }
  }

  return (
    <div className="px-14 py-20 pb-28">
      <div className="max-w-[1040px]">
        <h1 className="font-serif font-extrabold tracking-tight text-[34px] mb-2">Relatório de adequação</h1>
        <div className="text-sm text-aligna-muted mb-11">
          Baseado em {new Set(assets.map((a) => a.institution)).size} instituição(ões) · {formatBRL(report.totalValue)} analisados
        </div>

        <div className="mb-11 flex items-center gap-7 rounded-xl border border-aligna-line bg-aligna-card p-7">
          <div
            className="flex h-[104px] w-[104px] shrink-0 items-center justify-center rounded-full text-[34px] font-extrabold font-serif"
            style={{ border: `6px solid ${scoreColor}`, color: scoreColor }}
          >
            {score.total}
          </div>
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wide" style={{ color: scoreColor }}>
              Score Aligna · {scoreLabel}
            </div>
            <div className="text-[17px] font-semibold leading-snug">
              {worstCriterion.score < 70
                ? `Seu ponto de maior atenção é ${worstCriterion.label.toLowerCase()}: ${worstCriterion.detail}`
                : "Nenhum dos quatro critérios avaliados está abaixo do esperado nesta análise."}
            </div>
            <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5">
              {score.criteria.map((c) => (
                <div key={c.label} className="text-[12px] text-aligna-muted">
                  <span className="font-semibold text-aligna-ink">{c.label}</span> · {c.score}/100
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mb-11 grid grid-cols-[1.2fr_1fr] gap-4">
          <div className="rounded-lg border border-aligna-line bg-aligna-card p-6">
            <div className="mb-3.5 text-xs font-semibold uppercase tracking-wide text-aligna-muted">Perfil declarado</div>
            <div className="text-lg font-semibold capitalize">{riskProfile}</div>
            <div className="mt-1 text-[12.5px] text-aligna-muted">
              com base nas respostas do questionário de suitability
            </div>
          </div>
          <div className="rounded-lg border border-aligna-line bg-aligna-card p-6">
            <div className="mb-3.5 text-xs font-semibold uppercase tracking-wide text-aligna-muted">Patrimônio analisado</div>
            <div className="font-serif font-extrabold text-[22px]">{formatBRL(report.totalValue)}</div>
            <div className="mt-1 text-[12.5px] text-aligna-muted">{assets.length} ativo(s) confirmado(s)</div>
          </div>
        </div>

        {teaserAlert && (
          <div className="mb-11">
            <div className="mb-4 text-[15px] font-semibold">O que encontramos</div>
            {(() => {
              const style = SEVERITY_STYLES[teaserAlert.severity];
              const Icon = style.Icon;
              return (
                <div className="flex gap-3.5 rounded-md border border-aligna-line bg-aligna-card px-5 py-4">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md" style={{ background: style.bg, color: style.color }}>
                    <Icon size={17} />
                  </div>
                  <div>
                    <div className="mb-1 text-sm font-semibold">{teaserAlert.title}</div>
                    <div className="text-[13.5px] leading-relaxed text-aligna-muted">{teaserAlert.body}</div>
                  </div>
                </div>
              );
            })()}
            {report.alerts.length > 1 && (
              <div className="mt-2.5 text-[12.5px] text-aligna-muted">
                + mais {report.alerts.length - 1} ponto(s) no relatório completo, abaixo.
              </div>
            )}
          </div>
        )}

        {/* A partir daqui é o relatório completo -- decisão do Conselho: mostrar
            score + 1 alerta de graça (o "aha moment"), travar o resto atrás da
            assinatura. Sem processador de pagamento integrado ainda, então o
            desbloqueio hoje é manual (fala comigo), não automático. */}
        <div className="relative">
          <div aria-hidden className="pointer-events-none select-none blur-[3px] opacity-40">
            <div className="mb-4 text-[15px] font-semibold">Alocação por classe de ativo</div>
            <div className="mb-11">
              <Donut
                slices={report.byClass.map((c) => ({ label: c.label, value: c.value, pct: c.pct }))}
                centerBig={formatBRL(report.totalValue)}
                centerSmall="patrimônio total"
              />
            </div>

            <div className="mb-4 text-[15px] font-semibold">Todos os pontos encontrados</div>
            <div className="mb-11 flex flex-col gap-2.5">
              {report.alerts.map((alert, i) => {
                const style = SEVERITY_STYLES[alert.severity];
                const Icon = style.Icon;
                return (
                  <div key={i} className="flex gap-3.5 rounded-md border border-aligna-line bg-aligna-card px-5 py-4">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md" style={{ background: style.bg, color: style.color }}>
                      <Icon size={17} />
                    </div>
                    <div>
                      <div className="mb-1 text-sm font-semibold">{alert.title}</div>
                      <div className="text-[13.5px] leading-relaxed text-aligna-muted">{alert.body}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mb-4 text-[15px] font-semibold">Indicadores usados na comparação</div>
            <div className="mb-8 overflow-hidden rounded-md border border-aligna-line">
              <div className="grid grid-cols-[1.4fr_1fr_1fr] bg-aligna-pale px-4.5 py-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-aligna-muted">
                <div>Indicador</div>
                <div>Valor</div>
                <div>Fonte</div>
              </div>
              {STATIC_BENCHMARKS.map((b) => (
                <div key={b.nome} className="grid grid-cols-[1.4fr_1fr_1fr] border-t border-aligna-line px-4.5 py-3 text-[13.5px]">
                  <div className="font-medium">{b.nome}</div>
                  <div>{b.valor}</div>
                  <div className="text-aligna-muted">{b.fonte}</div>
                </div>
              ))}
            </div>

            <div className="mb-9 rounded-md border border-aligna-line bg-aligna-infoSoft p-5 text-[12.5px] leading-relaxed">
              Este relatório tem caráter exclusivamente informativo, com base nos dados enviados por você, e não constitui
              recomendação, orientação ou aconselhamento sobre investimentos específicos, nos termos da Resolução CVM 19/2021.
            </div>

            <div className="border-t border-aligna-line pt-6">
              <div className="mb-1 text-sm font-semibold">Qual o seu próximo passo?</div>
              <p className="mb-4.5 max-w-[520px] text-[13px] text-aligna-muted">
                As duas opções abaixo continuam do jeito que fizer mais sentido pra você.
              </p>

              {submitted ? (
                <div className="flex items-center gap-2.5 rounded-md border border-aligna-mid bg-aligna-pale px-5 py-4 text-sm font-semibold text-aligna-deep">
                  <CheckCircle2 size={18} />
                  Conta criada! Acesse o Planejador Financeiro e faça login com o e-mail e a senha que você definiu.
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border-[1.5px] border-aligna-mid bg-aligna-pale p-6">
                    <div className="mb-3 inline-flex rounded-full bg-aligna-deep px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-aligna-cream">
                      Modo autônomo
                    </div>
                    <div className="mb-1.5 text-[14.5px] font-semibold">Continuar meu planejamento sozinho</div>
                    <div className="mb-4 text-[13px] leading-relaxed text-aligna-muted">
                      Os dados que você já confirmou viram o ponto de partida do seu planejamento completo — metas, aposentadoria,
                      projeção de patrimônio.
                    </div>
                    <button className="btn-primary" disabled={submitting} onClick={handleContinuar}>
                      {submitting && <Loader2 size={16} className="animate-spin" />}
                      {submitting ? "Enviando..." : "Continuar no Planejador Financeiro"}
                    </button>
                    {error && <p className="mt-2.5 text-xs text-aligna-danger">{error}</p>}
                  </div>

                  <div className="rounded-lg border border-aligna-line bg-aligna-card p-6">
                    <div className="mb-3 inline-flex rounded-full bg-aligna-goldSoft px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-aligna-ink">
                      Acompanhado
                    </div>
                    <div className="mb-1.5 text-[14.5px] font-semibold">Quero acompanhamento de um especialista</div>
                    <div className="mb-4 text-[13px] leading-relaxed text-aligna-muted">
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
                        className="flex items-center gap-2 rounded-md border border-aligna-line px-4 py-2.5 text-sm font-semibold"
                      >
                        <Mail size={15} /> E-mail
                      </a>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="absolute inset-0 flex justify-center pt-6">
            <div className="w-full max-w-[420px] rounded-xl border border-aligna-line bg-white p-7 text-center shadow-[0_8px_28px_-10px_rgba(15,35,24,0.25)]">
              <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-aligna-pale text-aligna-mid">
                <Lock size={20} />
              </div>
              <div className="mb-1 text-[15px] font-semibold">Aligna Premium</div>
              <div className="mb-4 text-[12.5px] text-aligna-muted">
                [R$ XX]/mês — cancele quando quiser
              </div>
              <div className="mb-5 flex flex-col gap-2 text-left text-[13px]">
                <div>✓ Composição completa e todos os pontos encontrados</div>
                <div>✓ Comparação com Selic, CDI e IPCA</div>
                <div>✓ Continuação no planejamento financeiro completo</div>
              </div>
              <button className="btn-primary w-full justify-center" disabled={assinando} onClick={handleAssinar}>
                {assinando && <Loader2 size={16} className="animate-spin" />}
                {assinando ? "Preparando..." : "Quero assinar"}
              </button>
              <div className="mt-3 text-[11.5px] text-aligna-muted">
                Se a assinatura automática não estiver disponível, você fala direto comigo por e-mail.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
