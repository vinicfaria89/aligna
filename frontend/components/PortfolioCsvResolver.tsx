"use client";

import {
  CheckCircle2,
  HelpCircle,
  Info,
  Loader2,
  Upload,
  XCircle,
} from "lucide-react";
import { useRef, useState } from "react";

import {
  describeIssues,
  type SafeIssue,
} from "@/lib/aie/client/csv-issue-messages";
import {
  buildPortfolioCsvPreview,
  type PreviewRow,
} from "@/lib/aie/client/portfolio-csv-preview";
import {
  submitPortfolioCsv,
  type ResolveCsvOutcome,
  type ResolvedItemView,
  type SubmitPortfolioCsvInput,
} from "@/lib/aie/client/resolve-csv-client";
import { deriveUploadFileId } from "@/lib/aie/client/upload-file-id";
import {
  MAX_CSV_UPLOAD_BYTES,
  MAX_PORTFOLIO_ROWS,
} from "@/lib/aie/ingestion/portfolio-csv-limits";
import { loginHrefReturningTo } from "@/lib/navigation/safe-return-path";
import { acquireAccessToken, clearSession } from "@/lib/session";

/**
 * First user-facing AIE workflow (TASK-025): choose a CSV, preview it locally,
 * send the raw CSV to POST /api/aie/resolve-csv, and show what the server
 * resolved.
 *
 * The UI reproduces NO AIE logic: it reads a file, previews it with the same
 * browser-safe adapter the server uses, asks the server to resolve, and renders
 * the answer. It never verifies an asset, never calls a provider, never touches
 * credentials, and never turns a server failure into a success. The server is
 * authoritative even when the local preview says the file is fine.
 *
 * Privacy: the file, its text and the preview live only in component memory. They
 * are never written to localStorage/sessionStorage, the URL, analytics or the
 * console, and disappear on reload or "Limpar".
 */

const MAX_KIB = MAX_CSV_UPLOAD_BYTES / 1024;

interface Selection {
  name: string;

  size: number;

  fileId: string;

  text: string;

  rows: PreviewRow[];
}

type View =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "invalid-local-file"; messages: string[] }
  | { kind: "ready" }
  | { kind: "submitting" }
  | {
      kind: "success";
      items: ResolvedItemView[];
      correlationId?: string;
    }
  | {
      kind: "server-validation-error";
      issues: SafeIssue[];
    }
  | { kind: "unauthenticated"; expired: boolean }
  | { kind: "session-unavailable" }
  | { kind: "forbidden" }
  | { kind: "too-large" }
  | { kind: "unsupported-media" }
  | { kind: "rate-limited"; retryAfterSeconds?: number }
  | { kind: "server-error"; correlationId?: string }
  | { kind: "network-error" };

export interface PortfolioCsvResolverProps {
  /** Test seams. Defaults: the app's existing session (lib/session.ts) and the global fetch. */
  getSession?: SubmitPortfolioCsvInput["getSession"];

  clearSession?: () => void;

  fetchImpl?: SubmitPortfolioCsvInput["fetchImpl"];
}

const FIELD_LABELS: Record<string, string> = {
  identity: "identificação do ativo",
  assetType: "tipo do ativo",
  issuer: "emissor",
  institution: "instituição",
  ticker: "ticker",
  isin: "ISIN",
  cnpj: "CNPJ",
  fund: "fundo",
  currency: "moeda",
  maturity: "vencimento",
  economicGroup: "grupo econômico",
};

const ITEM_ERROR_TEXT: Record<string, string> = {
  AIE_CONFIGURATION_UNAVAILABLE:
    "A resolução está temporariamente indisponível.",
  AIE_INTERNAL_ERROR: "Não foi possível resolver este ativo.",
};

const STATUS_TEXT: Record<string, string> = {
  verified: "Verificado",
  "needs-more-evidence": "Precisa de mais evidências",
  "needs-user": "Precisa da sua confirmação",
  conflict: "Evidências em conflito",
  blocked: "Bloqueado",
};

function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsText(file);
  });
}

function formatAmount(amount: number | undefined, currency?: string): string {
  if (amount === undefined) return "—";

  try {
    if (currency && /^[A-Z]{3}$/.test(currency)) {
      return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency,
      }).format(amount);
    }
  } catch {
    // Unknown currency code: fall back to a plain number.
  }

  return amount.toLocaleString("pt-BR");
}

function StatusBadge({ item }: { item: ResolvedItemView }) {
  if (item.kind === "item-error") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-aligna-dangerSoft px-2.5 py-1 text-xs font-semibold text-aligna-danger">
        <XCircle size={14} aria-hidden="true" /> Erro ao resolver
      </span>
    );
  }

  if (item.status === "verified") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-aligna-pale px-2.5 py-1 text-xs font-semibold text-aligna-deep">
        <CheckCircle2 size={14} aria-hidden="true" /> Verificado
      </span>
    );
  }

  // "Needs more evidence" (and its siblings) are valid domain outcomes, not errors.
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-aligna-warnSoft px-2.5 py-1 text-xs font-semibold text-aligna-warn">
      <HelpCircle size={14} aria-hidden="true" />
      {STATUS_TEXT[item.status ?? ""] ?? "Situação desconhecida"}
    </span>
  );
}

function ItemDetails({ item }: { item: ResolvedItemView }) {
  if (item.kind === "item-error") {
    return (
      <span className="text-aligna-danger">
        {ITEM_ERROR_TEXT[item.itemErrorCode ?? ""] ??
          "Não foi possível resolver este ativo."}
      </span>
    );
  }

  if (item.status === "verified" && item.verifiedAsset) {
    return (
      <div className="flex flex-col gap-0.5">
        <span>
          Código canônico: <strong>{item.verifiedAsset.canonicalAssetId}</strong>
        </span>
        <span className="text-aligna-muted">
          {item.verifiedAsset.assetType} · {item.verifiedAsset.currency}
          {item.verifiedAsset.amount !== undefined
            ? ` · ${formatAmount(item.verifiedAsset.amount, item.verifiedAsset.currency)}`
            : ""}
        </span>
        {item.sources.length > 0 && (
          <span className="text-aligna-muted">Fontes: {item.sources.join(", ")}</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5">
      {item.unresolvedFields.length > 0 ? (
        <span>
          Falta confirmar:{" "}
          {item.unresolvedFields.map((field) => FIELD_LABELS[field] ?? field).join(", ")}
        </span>
      ) : (
        <span>Ainda sem evidências suficientes.</span>
      )}
      {item.sources.length > 0 && (
        <span className="text-aligna-muted">Fontes consultadas: {item.sources.join(", ")}</span>
      )}
      {item.failedSources.length > 0 && (
        <span className="text-aligna-muted">
          Falha ao consultar: {item.failedSources.join(", ")}
        </span>
      )}
    </div>
  );
}

export default function PortfolioCsvResolver({
  getSession = acquireAccessToken,
  clearSession: endSession = clearSession,
  fetchImpl,
}: PortfolioCsvResolverProps = {}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [view, setView] = useState<View>({ kind: "idle" });
  const [inputKey, setInputKey] = useState(0);

  const submittingRef = useRef(false);
  const selectionSeq = useRef(0);

  function reset() {
    selectionSeq.current += 1;
    submittingRef.current = false;
    setSelection(null);
    setView({ kind: "idle" });
    setInputKey((key) => key + 1);
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    // A new choice (or a cleared one) always drops the previous file and results.
    selectionSeq.current += 1;
    const seq = selectionSeq.current;
    setSelection(null);

    if (!file) {
      setView({ kind: "idle" });
      return;
    }

    if (file.size > MAX_CSV_UPLOAD_BYTES) {
      setView({
        kind: "invalid-local-file",
        messages: [
          `O arquivo é grande demais. O limite é ${MAX_KIB} KB.`,
        ],
      });
      return;
    }

    setView({ kind: "reading" });

    let text: string;

    try {
      text = await readFileText(file);
    } catch {
      if (seq === selectionSeq.current) {
        setView({
          kind: "invalid-local-file",
          messages: ["Não foi possível ler o arquivo. Tente escolher de novo."],
        });
      }
      return;
    }

    if (seq !== selectionSeq.current) return;

    if (text.trim().length === 0) {
      setView({ kind: "invalid-local-file", messages: ["O arquivo está vazio."] });
      return;
    }

    const fileId = deriveUploadFileId({
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
    });

    const preview = buildPortfolioCsvPreview(text, fileId);

    if (!preview.ok) {
      setView({
        kind: "invalid-local-file",
        messages:
          preview.reason === "too-large"
            ? [`O arquivo é grande demais. O limite é ${MAX_KIB} KB.`]
            : preview.reason === "too-many-rows"
              ? [`O arquivo tem linhas demais. O limite é ${MAX_PORTFOLIO_ROWS} ativos por envio.`]
              : describeIssues(preview.issues),
      });
      return;
    }

    setSelection({
      name: file.name,
      size: file.size,
      fileId,
      text,
      rows: preview.rows,
    });
    setView({ kind: "ready" });
  }

  async function handleSubmit() {
    if (!selection || submittingRef.current || selection.rows.length === 0) {
      return;
    }

    submittingRef.current = true;
    const seq = selectionSeq.current;
    setView({ kind: "submitting" });

    const outcome: ResolveCsvOutcome = await submitPortfolioCsv({
      csvText: selection.text,
      fileId: selection.fileId,
      getSession,
      clearSession: endSession,
      fetchImpl,
    });

    submittingRef.current = false;

    // The file was replaced or cleared while the request was pending.
    if (seq !== selectionSeq.current) return;

    switch (outcome.kind) {
      case "success":
        setView({
          kind: "success",
          items: outcome.items,
          correlationId: outcome.correlationId,
        });
        break;
      case "validation-error":
        setView({ kind: "server-validation-error", issues: outcome.issues });
        break;
      case "unauthenticated":
        setView({ kind: "unauthenticated", expired: outcome.reason !== "no-session" });
        break;
      case "session-unavailable":
        setView({ kind: "session-unavailable" });
        break;
      case "forbidden":
        setView({ kind: "forbidden" });
        break;
      case "too-large":
        setView({ kind: "too-large" });
        break;
      case "unsupported-media":
        setView({ kind: "unsupported-media" });
        break;
      case "rate-limited":
        setView({ kind: "rate-limited", retryAfterSeconds: outcome.retryAfterSeconds });
        break;
      case "network-error":
        setView({ kind: "network-error" });
        break;
      default:
        setView({ kind: "server-error", correlationId: outcome.correlationId });
    }
  }

  const submitting = view.kind === "submitting";

  const canSubmit =
    selection !== null && selection.rows.length > 0 && !submitting;

  const items = view.kind === "success" ? view.items : null;

  const counts = items
    ? {
        verified: items.filter((i) => i.kind === "resolved" && i.status === "verified").length,
        errors: items.filter((i) => i.kind === "item-error").length,
        pending: items.filter((i) => i.kind === "resolved" && i.status !== "verified").length,
      }
    : null;

  return (
    <div className="flex flex-col gap-6">
      <section className="card" aria-labelledby="csv-file-title">
        <h2 id="csv-file-title" className="mb-1 text-[14.5px] font-semibold">
          1. Escolha o arquivo
        </h2>
        <p className="mb-4 text-[13px] text-aligna-muted">
          Um arquivo CSV com um ativo por linha (até {MAX_PORTFOLIO_ROWS} ativos e {MAX_KIB} KB).
          A coluna <code>rawName</code> é obrigatória. O arquivo é lido só no seu navegador e enviado
          apenas quando você pedir para resolver.
        </p>

        <label htmlFor="csv-file" className="text-sm font-medium">
          Arquivo CSV da carteira
        </label>
        <input
          key={inputKey}
          id="csv-file"
          className="input mt-1"
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
          disabled={submitting}
        />

        {selection && (
          <p className="mt-3 text-[13px] text-aligna-muted">
            Arquivo selecionado: <strong>{selection.name}</strong> ({Math.max(1, Math.round(selection.size / 1024))} KB,{" "}
            {selection.rows.length} {selection.rows.length === 1 ? "linha" : "linhas"})
          </p>
        )}

        {view.kind === "reading" && (
          <p role="status" className="mt-3 flex items-center gap-2 text-sm text-aligna-muted">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Lendo o arquivo...
          </p>
        )}

        {view.kind === "invalid-local-file" && (
          <div role="alert" className="mt-3 rounded-lg bg-aligna-dangerSoft p-3 text-sm text-aligna-danger">
            <p className="font-semibold">Não conseguimos usar este arquivo.</p>
            <ul className="mt-1 list-disc pl-5">
              {view.messages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        )}

        {selection && selection.rows.length === 0 && (
          <p role="status" className="mt-3 flex items-start gap-2 text-sm text-aligna-muted">
            <Info size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            O arquivo tem só o cabeçalho, sem linhas de dados. Não há nada para resolver.
          </p>
        )}
      </section>

      {selection && selection.rows.length > 0 && (
        <section className="card" aria-labelledby="csv-preview-title">
          <h2 id="csv-preview-title" className="mb-1 text-[14.5px] font-semibold">
            2. Confira o que será enviado
          </h2>
          <p className="mb-4 text-[13px] text-aligna-muted">
            Esta é só uma prévia local: o servidor faz a validação e a resolução de verdade. Nada é
            deduzido do nome do ativo.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px]">
              <caption className="sr-only">Prévia das linhas do arquivo CSV</caption>
              <thead>
                <tr className="border-b border-aligna-line text-aligna-muted">
                  <th scope="col" className="py-2 pr-4 font-semibold">Linha</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Ativo</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Tipo</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Ticker / código</th>
                  <th scope="col" className="py-2 pr-4 font-semibold">Valor</th>
                  <th scope="col" className="py-2 font-semibold">Situação local</th>
                </tr>
              </thead>
              <tbody>
                {selection.rows.map((row) => (
                  <tr key={row.candidateId} className="border-b border-aligna-line last:border-0">
                    <td className="py-2 pr-4">{row.row}</td>
                    <td className="py-2 pr-4">{row.rawName}</td>
                    <td className="py-2 pr-4">{row.assetType ?? "—"}</td>
                    <td className="py-2 pr-4">{row.ticker ?? row.instrumentCode ?? "—"}</td>
                    <td className="py-2 pr-4">{formatAmount(row.amount, row.currency)}</td>
                    <td className="py-2 text-aligna-deep">Formato válido</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary"
          onClick={handleSubmit}
          disabled={!canSubmit}
          aria-busy={submitting}
        >
          {submitting ? (
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
          ) : (
            <Upload size={16} aria-hidden="true" />
          )}
          {submitting ? "Resolvendo..." : "Resolver carteira"}
        </button>

        <button
          type="button"
          className="btn-ghost"
          onClick={reset}
          disabled={submitting || (selection === null && view.kind === "idle")}
        >
          Limpar
        </button>

        {submitting && (
          <span role="status" className="text-sm text-aligna-muted">
            Enviando e resolvendo os ativos. Isso pode levar alguns segundos.
          </span>
        )}
      </div>

      {view.kind === "unauthenticated" && (
        <div role="alert" className="rounded-lg bg-aligna-warnSoft p-4 text-sm text-aligna-ink">
          <p className="font-semibold">
            {view.expired ? "Sua sessão expirou." : "Entre na sua conta para continuar."}
          </p>
          <p className="mt-1">
            {view.expired
              ? "Entre novamente para resolver a carteira. "
              : "É preciso estar logado para resolver uma carteira. "}
            O arquivo não fica guardado: depois de entrar, você volta a esta página e escolhe o arquivo de novo.{" "}
            <a className="font-semibold underline" href={loginHrefReturningTo("/carteira")}>
              Entrar
            </a>
          </p>
        </div>
      )}

      {view.kind === "session-unavailable" && (
        <div role="alert" className="rounded-lg bg-aligna-warnSoft p-4 text-sm text-aligna-ink">
          <p className="font-semibold">Não foi possível verificar sua sessão agora.</p>
          <p className="mt-1">
            Sua conta continua conectada. Tente de novo em instantes; o arquivo enviado continua nesta tela.
          </p>
        </div>
      )}

      {view.kind === "forbidden" && (
        <div role="alert" className="rounded-lg bg-aligna-warnSoft p-4 text-sm text-aligna-ink">
          <p className="font-semibold">Sem acesso a este recurso.</p>
          <p className="mt-1">Sua conta não tem acesso à resolução de carteiras em lote.</p>
        </div>
      )}

      {view.kind === "server-validation-error" && (
        <div role="alert" className="rounded-lg bg-aligna-dangerSoft p-4 text-sm text-aligna-danger">
          <p className="font-semibold">O servidor recusou este CSV.</p>
          {view.issues.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {describeIssues(view.issues).map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {view.kind === "too-large" && (
        <div role="alert" className="rounded-lg bg-aligna-dangerSoft p-4 text-sm text-aligna-danger">
          <p className="font-semibold">Arquivo grande demais.</p>
          <p className="mt-1">O servidor recusou o arquivo. O limite é {MAX_KIB} KB.</p>
        </div>
      )}

      {view.kind === "unsupported-media" && (
        <div role="alert" className="rounded-lg bg-aligna-dangerSoft p-4 text-sm text-aligna-danger">
          <p className="font-semibold">Não foi possível enviar o arquivo.</p>
          <p className="mt-1">
            O envio não foi aceito pelo servidor. Isso indica um problema no aplicativo, não no seu
            arquivo. Tente de novo mais tarde.
          </p>
        </div>
      )}

      {view.kind === "rate-limited" && (
        <div role="alert" className="rounded-lg bg-aligna-warnSoft p-4 text-sm text-aligna-ink">
          <p className="font-semibold">Muitas solicitações em pouco tempo.</p>
          <p className="mt-1">
            {view.retryAfterSeconds !== undefined
              ? `Tente novamente em cerca de ${view.retryAfterSeconds} ${view.retryAfterSeconds === 1 ? "segundo" : "segundos"}.`
              : "Aguarde um pouco e tente novamente."}
          </p>
        </div>
      )}

      {view.kind === "server-error" && (
        <div role="alert" className="rounded-lg bg-aligna-dangerSoft p-4 text-sm text-aligna-danger">
          <p className="font-semibold">Não conseguimos resolver a carteira agora.</p>
          <p className="mt-1">Tente de novo em instantes.</p>
          {view.correlationId && (
            <p className="mt-1 text-[12px]">Referência para suporte: {view.correlationId}</p>
          )}
        </div>
      )}

      {view.kind === "network-error" && (
        <div role="alert" className="rounded-lg bg-aligna-dangerSoft p-4 text-sm text-aligna-danger">
          <p className="font-semibold">Não foi possível conectar ao servidor.</p>
          <p className="mt-1">Verifique sua conexão e tente de novo.</p>
        </div>
      )}

      {items && counts && (
        <section className="card" aria-labelledby="csv-results-title">
          <h2 id="csv-results-title" className="mb-1 text-[14.5px] font-semibold">
            3. Resultado
          </h2>
          <p role="status" className="mb-4 text-[13px] text-aligna-muted">
            {items.length === 0
              ? "Nenhum ativo para resolver."
              : `${counts.verified} verificados · ${counts.pending} com pendências · ${counts.errors} com erro.`}{" "}
            Um ativo que &quot;precisa de mais evidências&quot; não é um erro: é um resultado em que
            ainda faltam confirmações.
          </p>

          {items.length > 0 && (
            /*
             * On narrow screens each result becomes a stacked card (labels shown
             * inline) instead of a wide table that hides the details behind a
             * horizontal scroll. Explicit ARIA roles keep the table semantics when
             * the layout is not a CSS table.
             */
            <table
              role="table"
              className="block w-full text-left text-[13px] md:table"
            >
              <caption className="sr-only">Resultado da resolução de cada ativo</caption>
              <thead className="sr-only md:table-header-group">
                <tr role="row" className="md:table-row md:border-b md:border-aligna-line md:text-aligna-muted">
                  <th role="columnheader" scope="col" className="py-2 pr-4 font-semibold">Linha</th>
                  <th role="columnheader" scope="col" className="py-2 pr-4 font-semibold">Ativo</th>
                  <th role="columnheader" scope="col" className="py-2 pr-4 font-semibold">Situação</th>
                  <th role="columnheader" scope="col" className="py-2 font-semibold">Detalhes</th>
                </tr>
              </thead>
              <tbody className="block md:table-row-group">
                {items.map((item) => {
                  const row = selection?.rows[item.index];

                  return (
                    <tr
                      role="row"
                      key={`${item.index}-${item.candidateAssetId}`}
                      className="mb-3 block rounded-lg border border-aligna-line p-3 align-top md:mb-0 md:table-row md:rounded-none md:border-0 md:border-b md:p-0 md:last:border-0"
                    >
                      <td role="cell" className="block py-0.5 md:table-cell md:py-2 md:pr-4">
                        <span aria-hidden="true" className="mr-2 font-semibold text-aligna-muted md:hidden">Linha</span>
                        {row?.row ?? item.index + 2}
                      </td>
                      <td role="cell" className="block py-0.5 md:table-cell md:py-2 md:pr-4">
                        <span aria-hidden="true" className="mr-2 font-semibold text-aligna-muted md:hidden">Ativo</span>
                        {row?.rawName ?? "—"}
                      </td>
                      <td role="cell" className="block py-1 md:table-cell md:py-2 md:pr-4">
                        <StatusBadge item={item} />
                      </td>
                      <td role="cell" className="block py-0.5 md:table-cell md:py-2">
                        <ItemDetails item={item} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}        </section>
      )}
    </div>
  );
}
