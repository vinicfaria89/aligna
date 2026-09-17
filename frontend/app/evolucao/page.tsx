"use client";

import { Loader2, Lock, LogIn } from "lucide-react";
import { useEffect, useState } from "react";
import PatrimonioHistoryChart from "@/components/PatrimonioHistoryChart";
import ScoreHistoryChart from "@/components/ScoreHistoryChart";
import { ApiError, getScoreHistory, login as loginRequest } from "@/lib/api";
import { getValidAccessToken, saveSession } from "@/lib/session";
import { ScoreSnapshot } from "@/lib/types";

type ViewState =
  | { kind: "loading" }
  | { kind: "login" }
  | { kind: "needs_subscription" }
  | { kind: "error"; message: string }
  | { kind: "ready"; snapshots: ScoreSnapshot[] };

export default function EvolucaoPage() {
  const [state, setState] = useState<ViewState>({ kind: "loading" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  async function loadHistory() {
    setState({ kind: "loading" });
    const token = await getValidAccessToken();
    if (!token) {
      setState({ kind: "login" });
      return;
    }
    try {
      const snapshots = await getScoreHistory(token);
      setState({ kind: "ready", snapshots });
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        setState({ kind: "needs_subscription" });
      } else {
        setState({ kind: "error", message: "Não conseguimos carregar seu histórico agora. Tente de novo em instantes." });
      }
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

  async function handleLogin() {
    setLoggingIn(true);
    setLoginError(null);
    try {
      const tokens = await loginRequest(email, password);
      saveSession(tokens);
      await loadHistory();
    } catch (err) {
      setLoginError(err instanceof ApiError ? err.message : "Não conseguimos entrar agora. Tente de novo.");
    } finally {
      setLoggingIn(false);
    }
  }

  return (
    <div className="flex min-h-screen justify-center px-10 py-24">
      <div className="w-full max-w-[560px]">
        <h1 className="font-serif font-extrabold tracking-tight text-3xl mb-2.5">Minha evolução</h1>
        <p className="text-[15px] text-aligna-muted leading-relaxed mb-9">
          Acompanhe como seu Score Aligna muda a cada diagnóstico — é o que mostra se as coisas estão indo pro lado certo.
        </p>

        {state.kind === "loading" && (
          <div className="flex items-center gap-2 text-sm text-aligna-muted">
            <Loader2 size={16} className="animate-spin" /> Carregando...
          </div>
        )}

        {state.kind === "login" && (
          <div className="flex flex-col gap-4 rounded-lg border border-aligna-line bg-aligna-card p-6">
            <div className="mb-1 text-[14.5px] font-semibold">Entrar na sua conta</div>
            <div>
              <label className="text-sm font-medium">E-mail</label>
              <input className="input mt-1" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="text-sm font-medium">Senha</label>
              <input className="input mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {loginError && <p className="text-xs text-aligna-danger">{loginError}</p>}
            <button className="btn-primary self-start" disabled={loggingIn || !email || !password} onClick={handleLogin}>
              {loggingIn ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
              {loggingIn ? "Entrando..." : "Entrar"}
            </button>
            <p className="text-[12px] text-aligna-muted">
              Use o mesmo e-mail e senha que você definiu ao fazer seu primeiro diagnóstico.
            </p>
          </div>
        )}

        {state.kind === "needs_subscription" && (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-aligna-line bg-aligna-card p-8 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-aligna-pale text-aligna-mid">
              <Lock size={20} />
            </div>
            <div className="text-[15px] font-semibold">Sua evolução é parte da assinatura</div>
            <p className="max-w-[360px] text-[13px] text-aligna-muted">
              Comparar diagnósticos ao longo do tempo é um dos benefícios do Aligna Premium. Faça um novo diagnóstico pra
              assinar, ou fale comigo se já tiver assinado e algo parecer errado.
            </p>
          </div>
        )}

        {state.kind === "error" && <p className="text-sm text-aligna-danger">{state.message}</p>}

        {state.kind === "ready" && state.snapshots.length === 0 && (
          <div className="rounded-lg border border-aligna-line bg-aligna-card p-8 text-center text-sm text-aligna-muted">
            Ainda não há nenhum diagnóstico salvo nesta conta.
          </div>
        )}

        {state.kind === "ready" && state.snapshots.length > 0 && (
          <div className="flex flex-col gap-5">
            <div className="rounded-lg border border-aligna-line bg-aligna-card p-6">
              <div className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-aligna-muted">Score Aligna</div>
              <ScoreHistoryChart snapshots={state.snapshots} />
              {state.snapshots.length >= 2 && (
                <div className="mt-4 text-[13px] text-aligna-muted">
                  {(() => {
                    const last = state.snapshots[state.snapshots.length - 1];
                    const prev = state.snapshots[state.snapshots.length - 2];
                    const delta = last.score_total - prev.score_total;
                    return delta === 0
                      ? "Sem mudança desde o diagnóstico anterior."
                      : `${delta > 0 ? "+" : ""}${delta} desde o diagnóstico anterior.`;
                  })()}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-aligna-line bg-aligna-card p-6">
              <div className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-aligna-muted">
                Patrimônio analisado
              </div>
              <PatrimonioHistoryChart snapshots={state.snapshots} />
              {state.snapshots.length >= 2 && (
                <div className="mt-4 text-[13px] text-aligna-muted">
                  {(() => {
                    const last = state.snapshots[state.snapshots.length - 1];
                    const prev = state.snapshots[state.snapshots.length - 2];
                    const delta = last.patrimonio_total - prev.patrimonio_total;
                    const deltaFmt = Math.abs(delta).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
                    return delta === 0
                      ? "Sem mudança desde o diagnóstico anterior."
                      : `${delta > 0 ? "+" : "-"}${deltaFmt} desde o diagnóstico anterior.`;
                  })()}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
