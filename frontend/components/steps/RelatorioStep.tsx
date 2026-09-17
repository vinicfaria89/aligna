"use client";

import { AlertTriangle, ArrowRight, CheckCircle2, Download, Info, Loader2, Lock, Mail } from "lucide-react";
import { useState } from "react";
import Donut from "@/components/Donut";
import ProjectionChart from "@/components/ProjectionChart";
import { ApiError, createCheckoutSession, IntakeTokens, saveScoreSnapshot, submitIntake } from "@/lib/api";
import { buildProjection, buildRiskRange } from "@/lib/projection";
import { RISK_CAPACITY_LABELS, STATIC_BENCHMARKS, buildReport, computeScore, realRate, riskCapacityFromAnswers } from "@/lib/report";
import { saveSession } from "@/lib/session";
import { ExtractedAsset, PerfilData, riskProfileFromAnswers } from "@/lib/types";

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Chaves normalizadas pro breakdown salvo no histórico -- os labels de
// score.criteria são pra exibição (acentuados, com espaço), não pra chave
// de dado persistido.
const BREAKDOWN_KEYS: Record<string, string> = {
  "Concentração": "concentracao",
  "Diversificação": "diversificacao",
  Liquidez: "liquidez",
  "Aderência ao perfil": "aderencia_perfil",
  "Sucessão e governança": "sucessao_governanca",
};

const SEVERITY_STYLES = {
  alto: { bg: "#fbe9e5", color: "#c1503a", Icon: AlertTriangle },
  medio: { bg: "#fbf1dd", color: "#c08a2e", Icon: AlertTriangle },
  info: { bg: "#e6f2f4", color: "#3d7a8a", Icon: Info },
};

export default function RelatorioStep({
  perfil,
  onChangePerfil,
  assets,
}: {
  perfil: PerfilData;
  onChangePerfil: (patch: Partial<PerfilData>) => void;
  assets: ExtractedAsset[];
}) {
  const riskProfile = riskProfileFromAnswers(perfil.toleranceAnswer);
  const report = buildReport(assets, riskProfile, perfil.horizonAnswer);
  const riskCapacity = riskCapacityFromAnswers(perfil.horizonAnswer);
  const score = computeScore(assets, riskProfile, report, perfil.sucessaoAnswer, perfil.governancaAnswer);
  // "E se" interativo (padrão Wealthfront Path) -- aporte mensal adicional
  // hipotético, recalcula a projeção ao vivo sem chamada nenhuma ao backend.
  const [monthlyContribution, setMonthlyContribution] = useState(0);
  const projection = buildProjection(assets, riskProfile, 20, monthlyContribution);
  const riskRange = projection ? buildRiskRange(assets, projection.blendedRate) : null;
  const ipcaBenchmark = STATIC_BENCHMARKS.find((b) => b.nome.startsWith("IPCA"));
  const benchmarkComparisons = ipcaBenchmark
    ? STATIC_BENCHMARKS.filter((b) => b !== ipcaBenchmark).map((b) => ({
        nome: b.nome,
        realPct: realRate(b.nominal, ipcaBenchmark.nominal) * 100,
      }))
    : [];
  const scoreColor = score.total >= 70 ? "#1c8a4f" : score.total >= 40 ? "#c08a2e" : "#c1503a";
  const scoreLabel = score.total >= 70 ? "Consolidado" : score.total >= 40 ? "Em desenvolvimento" : "Atenção";
  const worstCriterion = [...score.criteria].sort((a, b) => a.score - b.score)[0];
  const teaserAlert = report.alerts[0];

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assinando, setAssinando] = useState(false);
  const [tokens, setTokens] = useState<IntakeTokens | null>(null);
  // Conta por último -- mesmo padrão da Empower (recomendação antes do
  // cadastro): nada aqui pede nome/e-mail/senha até a pessoa decidir agir.
  // `pendingAction` lembra qual dos dois CTAs foi clicado, pra retomar a
  // ação certa assim que o formulário de conta for preenchido.
  const [pendingAction, setPendingAction] = useState<"continuar" | "assinar" | null>(null);
  const accountComplete =
    perfil.full_name.trim().length > 0 && perfil.email.includes("@") && perfil.password.length >= 8 && perfil.birth_date.length > 0;

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
    saveSession(created);
    // Registra este diagnóstico no histórico ("Minha evolução") -- nunca
    // trava o fluxo principal se isso falhar, é um extra, não o objetivo
    // da tela.
    saveScoreSnapshot(created.access_token, {
      score_total: score.total,
      breakdown: Object.fromEntries(score.criteria.map((c) => [BREAKDOWN_KEYS[c.label] ?? c.label, c.score])),
      patrimonio_total: report.totalValue,
      risk_profile: riskProfile,
    }).catch(() => {});
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

  function handleContinuarClick() {
    if (accountComplete) {
      handleContinuar();
      return;
    }
    setPendingAction("continuar");
  }

  function handleAssinarClick() {
    if (accountComplete) {
      handleAssinar();
      return;
    }
    setPendingAction("assinar");
  }

  function handleAccountConfirm() {
    if (pendingAction === "assinar") handleAssinar();
    else handleContinuar();
    setPendingAction(null);
  }

  const today = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

  return (
    <div className="px-14 py-20 pb-28 print:px-0 print:py-0">
      <div className="max-w-[1040px]">
        {/* Capa só no PDF/impressão -- na tela o cabeçalho fica no Stepper */}
        <div className="print-only mb-10 flex items-center justify-between border-b-2 border-aligna-deep pb-5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-[9px]" style={{ background: "linear-gradient(135deg, #22a35e, #0f5c33)" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 19 12 4 19 19" />
                <path d="M8 14h8" />
                <circle cx="12" cy="14" r="1.6" fill="#22a35e" stroke="white" strokeWidth="1" />
              </svg>
            </div>
            <span className="text-lg font-extrabold tracking-tight">Aligna</span>
          </div>
          <div className="text-right text-[11px] text-aligna-muted">
            <div>Relatório de adequação de carteira</div>
            <div>{today}</div>
          </div>
        </div>

        <div className="mb-2 flex items-center justify-between gap-4 print-hide">
          <h1 className="font-serif font-extrabold tracking-tight text-[34px]">Relatório de adequação</h1>
          <button className="btn-ghost shrink-0" onClick={() => window.print()}>
            <Download size={15} />
            Baixar PDF
          </button>
        </div>
        <h1 className="print-only font-extrabold tracking-tight text-[26px] mb-2">Relatório de adequação</h1>
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
              Capacidade financeira: {RISK_CAPACITY_LABELS[riskCapacity]} · com base no horizonte declarado
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

        {projection && (
          <div className="mb-11">
            <div className="mb-1 text-[15px] font-semibold">Projeção de patrimônio em {projection.horizonYears} anos</div>
            <p className="mb-4 max-w-[640px] text-[13px] leading-relaxed text-aligna-muted">
              Mantendo a alocação atual, sua carteira renderia o equivalente a {(projection.blendedRate * 100).toFixed(1)}%
              acima da inflação ao ano. Uma alocação de referência pro perfil {riskProfile} costuma render{" "}
              {(projection.profileRate * 100).toFixed(1)}% — a diferença, projetada, é o que está em jogo.
            </p>
            <div className="rounded-lg border border-aligna-line bg-aligna-card p-6">
              <ProjectionChart projection={projection} />
              <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-[12px]">
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-[3px] w-4 rounded-full" style={{ background: "#1c8a4f" }} />
                  Mantendo a alocação atual
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-[3px] w-4 rounded-full border-t-2 border-dashed" style={{ borderColor: "#c08a2e" }} />
                  Referência pro perfil {riskProfile}
                </div>
              </div>

              <div className="mt-5 border-t border-aligna-line pt-4 print-hide">
                <div className="mb-2 flex items-center justify-between text-[12.5px]">
                  <span className="font-semibold">E se você investisse mais por mês, a partir de agora?</span>
                  <span className="font-semibold text-aligna-deep">
                    {monthlyContribution > 0 ? `${formatBRL(monthlyContribution)}/mês` : "Sem aporte extra"}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={10000}
                  step={100}
                  value={monthlyContribution}
                  onChange={(e) => setMonthlyContribution(Number(e.target.value))}
                  className="w-full accent-[#1c8a4f]"
                  aria-label="Aporte mensal adicional hipotético"
                />
              </div>

              {projection.gapAtHorizon > 0 && (
                <div className="mt-4 rounded-md bg-aligna-warnSoft px-4 py-3 text-[13px] font-medium text-aligna-warn">
                  Nesse ritmo, a diferença projetada em {projection.horizonYears} anos é de{" "}
                  {formatBRL(projection.gapAtHorizon)} — valores reais, sem considerar impostos ou custos.
                </div>
              )}
              {benchmarkComparisons.length > 0 && (
                <div className="mt-5 border-t border-aligna-line pt-4">
                  <div className="mb-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-aligna-muted">
                    Sua taxa vs. referências de mercado (acima da inflação)
                  </div>
                  <div className="flex flex-wrap gap-2.5">
                    <div className="rounded-md bg-aligna-pale px-3.5 py-2 text-[13px] font-semibold text-aligna-deep">
                      Sua carteira: {(projection.blendedRate * 100).toFixed(1)}%
                    </div>
                    {benchmarkComparisons.map((b) => (
                      <div key={b.nome} className="rounded-md bg-aligna-card border border-aligna-line px-3.5 py-2 text-[13px] text-aligna-muted">
                        {b.nome}: {b.realPct.toFixed(1)}%
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <p className="mt-3 text-[11.5px] text-aligna-muted">
              Estimativa ilustrativa com taxas de retorno de mercado de longo prazo por categoria de ativo — não é garantia de
              rentabilidade nem recomendação de alocação (Resolução CVM 19/2021).
            </p>
          </div>
        )}

        {riskRange && (
          <div className="mb-11">
            <div className="mb-1 text-[15px] font-semibold">Cenário em 6 meses</div>
            <p className="mb-4 max-w-[640px] text-[13px] leading-relaxed text-aligna-muted">
              Risco não é só uma nota — é uma faixa de valores possíveis. Com a volatilidade típica dessa alocação, há 90% de
              chance de sua carteira valer entre os números abaixo daqui a 6 meses.
            </p>
            <div className="rounded-lg border border-aligna-line bg-aligna-card p-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-md bg-aligna-dangerSoft px-4 py-3.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-aligna-danger">Cenário ruim (5%)</div>
                  <div className="mt-1 font-serif text-[20px] font-extrabold text-aligna-danger">{formatBRL(riskRange.lowValue)}</div>
                  <div className="mt-0.5 text-[12px] text-aligna-danger">{(riskRange.lowPct * 100).toFixed(1)}%</div>
                </div>
                <div className="rounded-md bg-aligna-pale px-4 py-3.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-aligna-deep">Cenário bom (5%)</div>
                  <div className="mt-1 font-serif text-[20px] font-extrabold text-aligna-deep">{formatBRL(riskRange.highValue)}</div>
                  <div className="mt-0.5 text-[12px] text-aligna-deep">+{(riskRange.highPct * 100).toFixed(1)}%</div>
                </div>
              </div>
            </div>
            <p className="mt-3 text-[11.5px] text-aligna-muted">
              Estimativa ilustrativa com volatilidade típica de mercado por categoria de ativo, sem considerar a correlação
              entre os ativos da sua carteira (o que tende a superestimar o risco, nunca subestimar) — não é garantia nem
              recomendação de alocação (Resolução CVM 19/2021).
            </p>
          </div>
        )}

        <div className="mb-11 rounded-xl border-[1.5px] border-aligna-mid bg-aligna-pale p-6 print-hide">
          <div className="mb-1.5 text-[14.5px] font-semibold">Veja isso virar um plano completo</div>
          <div className="mb-4 max-w-[560px] text-[13px] leading-relaxed text-aligna-muted">
            O que você já confirmou aqui vira o ponto de partida do seu Planejamento Financeiro completo — metas, fluxo de
            renda e despesas, e a mesma projeção de patrimônio, mas com aposentadoria, objetivos e o seu fluxo de caixa real.
          </div>
          {submitted ? (
            <div className="flex items-center gap-2.5 rounded-md border border-aligna-mid bg-white px-5 py-4 text-sm font-semibold text-aligna-deep">
              <CheckCircle2 size={18} />
              Conta criada! Acesse o Planejador Financeiro e faça login com o e-mail e a senha que você definiu.
            </div>
          ) : (
            <>
              <button className="btn-primary" disabled={submitting} onClick={handleContinuarClick}>
                {submitting && <Loader2 size={16} className="animate-spin" />}
                {submitting ? "Enviando..." : "Continuar no Planejador Financeiro"}
                {!submitting && <ArrowRight size={16} />}
              </button>
              {error && <p className="mt-2.5 text-xs text-aligna-danger">{error}</p>}
            </>
          )}
        </div>

        {/* Disclaimer fica fora da área paga de propósito -- é aviso
            regulatório, não conteúdo premium; sai tanto na tela quanto no
            PDF gratuito. */}
        <div className="mb-11 rounded-md border border-aligna-line bg-aligna-infoSoft p-5 text-[12.5px] leading-relaxed">
          Este relatório tem caráter exclusivamente informativo, com base nos dados enviados por você, e não constitui
          recomendação, orientação ou aconselhamento sobre investimentos específicos, nos termos da Resolução CVM 19/2021.
        </div>

        <div className="print-only text-[12.5px] text-aligna-muted">
          O relatório completo (composição por classe, todos os pontos encontrados e comparação com Selic/CDI/IPCA) está
          disponível na assinatura Aligna Premium.
        </div>

        {/* A partir daqui é o relatório completo -- decisão do Conselho: mostrar
            score + 1 alerta de graça (o "aha moment"), travar o resto atrás da
            assinatura. Sem processador de pagamento integrado ainda, então o
            desbloqueio hoje é manual (fala comigo), não automático. Fica de
            fora do PDF gratuito (print-hide) -- imprimir a versão borrada
            não vaza o conteúdo pago, mas também não faz sentido no papel. */}
        <div className="relative print-hide">
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

            <div className="border-t border-aligna-line pt-6">
              <div className="mb-1 text-sm font-semibold">Quer acompanhamento de um especialista?</div>
              <p className="mb-4.5 max-w-[520px] text-[13px] text-aligna-muted">
                Um profissional registrado na CVM analisa sua carteira com você e pode dar recomendação de verdade.
              </p>
              <div className="max-w-[420px] rounded-lg border border-aligna-line bg-aligna-card p-6">
                <div className="mb-3 inline-flex rounded-full bg-aligna-goldSoft px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-aligna-ink">
                  Acompanhado
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
          </div>

          <div className="absolute inset-0 flex items-start justify-center pt-6">
            <div className="w-full max-w-[420px] rounded-xl border border-aligna-line bg-white p-7 text-center shadow-[0_8px_28px_-10px_rgba(15,35,24,0.25)]">
              <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-aligna-pale text-aligna-mid">
                <Lock size={20} />
              </div>
              <div className="mb-1 text-[15px] font-semibold">Aligna Premium</div>
              <div className="mb-4 text-[12.5px] text-aligna-muted">
                R$ 39,90/mês — cancele quando quiser
              </div>
              <div className="mb-5 flex flex-col gap-2 text-left text-[13px]">
                <div>✓ Composição completa e todos os pontos encontrados</div>
                <div>✓ Comparação com Selic, CDI e IPCA</div>
                <div>✓ Continuação no planejamento financeiro completo</div>
              </div>
              <button className="btn-primary w-full justify-center" disabled={assinando} onClick={handleAssinarClick}>
                {assinando && <Loader2 size={16} className="animate-spin" />}
                {assinando ? "Preparando..." : "Quero assinar"}
              </button>
              <div className="mt-3 text-[11.5px] text-aligna-muted">
                Se a assinatura automática não estiver disponível, você fala direto comigo por e-mail.
              </div>
            </div>
          </div>
        </div>

        {pendingAction && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print-hide"
            onClick={() => setPendingAction(null)}
          >
            <div
              className="w-full max-w-[440px] rounded-xl bg-white p-7 shadow-[0_20px_60px_-15px_rgba(15,35,24,0.4)]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-1 text-[17px] font-semibold">Só falta criar sua conta</div>
              <p className="mb-5 text-[13px] leading-relaxed text-aligna-muted">
                É a mesma conta que você usa depois pra ver seu planejamento completo — não pedimos nada além disso.
              </p>
              <div className="mb-5 flex flex-col gap-3.5">
                <div>
                  <label className="text-sm font-medium">Nome completo</label>
                  <input
                    className="input mt-1"
                    value={perfil.full_name}
                    onChange={(e) => onChangePerfil({ full_name: e.target.value })}
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">E-mail</label>
                  <input
                    className="input mt-1"
                    type="email"
                    value={perfil.email}
                    onChange={(e) => onChangePerfil({ email: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Senha</label>
                  <input
                    className="input mt-1"
                    type="password"
                    minLength={8}
                    value={perfil.password}
                    onChange={(e) => onChangePerfil({ password: e.target.value })}
                  />
                  <p className="mt-1 text-xs text-aligna-muted">Mínimo de 8 caracteres.</p>
                </div>
                <div>
                  <label className="text-sm font-medium">Data de nascimento</label>
                  <input
                    className="input mt-1"
                    type="date"
                    value={perfil.birth_date}
                    onChange={(e) => onChangePerfil({ birth_date: e.target.value })}
                  />
                </div>
              </div>
              <button className="btn-primary w-full justify-center" disabled={!accountComplete} onClick={handleAccountConfirm}>
                Confirmar e continuar
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
