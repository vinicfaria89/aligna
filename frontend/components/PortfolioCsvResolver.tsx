"use client";

import {
  CheckCircle2,
  HelpCircle,
  Info,
  Loader2,
  Save,
  Upload,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

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
import {
  createPortfolioSnapshotClient,
  type PortfolioSnapshotClient,
  type SnapshotFetch,
} from "@/lib/portfolio-snapshot-api";
import {
  toDisplayRows,
  toSnapshotItems,
  type SavedSnapshot,
} from "@/lib/portfolio-snapshot-mapping";
import { FOCUS_RING } from "@/lib/ui/focus-ring";
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
  | { kind: "aie-access-denied" }
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

  /**
   * The saved-result client (TASK-029B). Default: the Planejador client, built on the
   * same session; `snapshotFetchImpl` is the test seam for its fetch. A test can also
   * inject a whole client.
   */
  snapshotClient?: PortfolioSnapshotClient;

  snapshotFetchImpl?: SnapshotFetch;
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "rejected" }
  | { kind: "failed" }
  | { kind: "unauthenticated" }
  | { kind: "no-session" };

interface SavedNote {
  tone: "info" | "error";

  text: string;

  /** Offer the sign-in link (the session is gone). */
  signIn?: boolean;
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

/** The per-value label of a stacked card; hidden from `md` up (the table header takes over). */
function CardLabel({ children }: { children: React.ReactNode }) {
  return (
    <span aria-hidden="true" className="mr-2 font-semibold text-aligna-muted md:hidden">
      {children}
    </span>
  );
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

interface ResultRowView {
  key: string;

  line: number;

  name: string;

  /** Optional extras, given only by the saved result (TASK-030); a fresh result has none. */
  assetType?: string;

  code?: string;

  amount?: number;

  currency?: string;

  item: ResolvedItemView;
}

/**
 * A cell that exists only for a value the row has: with no value it takes no room in a
 * card (hidden below `md`) and stays an empty cell in the table, never a placeholder.
 */
function OptionalCell({ label, value }: { label: string; value?: string }) {
  return value !== undefined ? (
    <td role="cell" className="block py-0.5 md:table-cell md:py-2 md:pr-4">
      <CardLabel>{label}</CardLabel>
      {value}
    </td>
  ) : (
    <td role="cell" className="hidden md:table-cell md:py-2 md:pr-4" />
  );
}

function countItems(items: ResolvedItemView[]) {
  return {
    verified: items.filter((i) => i.kind === "resolved" && i.status === "verified").length,
    errors: items.filter((i) => i.kind === "item-error").length,
    pending: items.filter((i) => i.kind === "resolved" && i.status !== "verified").length,
  };
}

function countsText(items: ResolvedItemView[]): string {
  const counts = countItems(items);

  return items.length === 0
    ? "Nenhum ativo para resolver."
    : `${counts.verified} verificados · ${counts.pending} com pendências · ${counts.errors} com erro.`;
}

/**
 * The results, as a table from `md` and stacked cards below it (one markup). Used for
 * a fresh resolution and, unchanged, for the saved one.
 *
 * On narrow screens each result becomes a stacked card (labels shown inline) instead
 * of a wide table that hides the details behind a horizontal scroll. Explicit ARIA
 * roles keep the table semantics when the layout is not a CSS table.
 */
function ResultsTable({ caption, rows }: { caption: string; rows: ResultRowView[] }) {
  // A column exists only if some row has that value: a fresh result (no extras) keeps
  // its four columns, and a saved one shows what was saved.
  const showType = rows.some((row) => row.assetType !== undefined);
  const showCode = rows.some((row) => row.code !== undefined);
  const showAmount = rows.some((row) => row.amount !== undefined);

  return (
    <table role="table" className="block w-full text-left text-[13px] md:table">
      <caption className="sr-only">{caption}</caption>
      <thead className="sr-only md:not-sr-only md:table-header-group">
        <tr role="row" className="md:table-row md:border-b md:border-aligna-line md:text-aligna-muted">
          <th role="columnheader" scope="col" className="py-2 pr-4 font-semibold">Linha</th>
          <th role="columnheader" scope="col" className="py-2 pr-4 font-semibold">Ativo</th>
          {showType && (
            <th role="columnheader" scope="col" className="py-2 pr-4 font-semibold">Tipo</th>
          )}
          {showCode && (
            <th role="columnheader" scope="col" className="py-2 pr-4 font-semibold">Ticker / código</th>
          )}
          {showAmount && (
            <th role="columnheader" scope="col" className="py-2 pr-4 font-semibold">Valor</th>
          )}
          <th role="columnheader" scope="col" className="py-2 pr-4 font-semibold">Situação</th>
          <th role="columnheader" scope="col" className="py-2 font-semibold">Detalhes</th>
        </tr>
      </thead>
      <tbody className="block md:table-row-group">
        {rows.map(({ key, line, name, assetType, code, amount, currency, item }) => (
          <tr
            role="row"
            key={key}
            className="mb-3 block rounded-lg border border-aligna-line p-3 align-top md:mb-0 md:table-row md:rounded-none md:border-0 md:border-b md:p-0 md:last:border-0"
          >
            <td role="cell" className="block py-0.5 md:table-cell md:py-2 md:pr-4">
              <CardLabel>Linha</CardLabel>
              {line}
            </td>
            <td role="cell" className="block py-0.5 md:table-cell md:py-2 md:pr-4">
              <CardLabel>Ativo</CardLabel>
              {name}
            </td>
            {showType && <OptionalCell label="Tipo" value={assetType} />}
            {showCode && <OptionalCell label="Ticker / código" value={code} />}
            {showAmount && (
              <OptionalCell
                label="Valor"
                value={amount !== undefined ? formatAmount(amount, currency) : undefined}
              />
            )}
            <td role="cell" className="block py-1 md:table-cell md:py-2 md:pr-4">
              <StatusBadge item={item} />
            </td>
            <td role="cell" className="block py-0.5 md:table-cell md:py-2">
              <ItemDetails item={item} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * "21/09/2026 às 14:32" in the user's time zone. The Planejador sends an ISO instant;
 * a value without a zone designator is read as UTC (never as a local time).
 */
function savedAtText(iso: string): string | null {
  const date = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const day = date.toLocaleDateString("pt-BR");
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  return `${day} às ${time}`;
}

/** The sign-in action, a real link styled as the primary button (44px target). */
function SignInLink() {
  return (
    <a
      className={`btn-primary mt-3 min-h-[44px] justify-center ${FOCUS_RING}`}
      href={loginHrefReturningTo("/carteira")}
    >
      Entrar
    </a>
  );
}

const SAVE_FAILURE_TEXT: Record<"rejected" | "failed", string> = {
  failed:
    "Não foi possível salvar o resultado agora. Ele continua na tela; tente de novo em instantes.",
  rejected:
    "O resultado não pôde ser salvo: o servidor recusou o conteúdo. Ele continua na tela.",
};

export default function PortfolioCsvResolver({
  getSession = acquireAccessToken,
  clearSession: endSession = clearSession,
  fetchImpl,
  snapshotClient,
  snapshotFetchImpl,
}: PortfolioCsvResolverProps = {}) {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [view, setView] = useState<View>({ kind: "idle" });
  const [inputKey, setInputKey] = useState(0);

  const submittingRef = useRef(false);
  const selectionSeq = useRef(0);

  // Saved result (TASK-029B). It is independent of the file and of the on-screen
  // result: choosing a file, "Limpar" and a new resolution never touch it. Only the
  // explicit "Salvar resultado" replaces it and only the confirmed "Apagar" removes it.
  const [saved, setSaved] = useState<SavedSnapshot | null>(null);
  const [loadUnavailable, setLoadUnavailable] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savedNote, setSavedNote] = useState<SavedNote | null>(null);

  const savingRef = useRef(false);
  const deletingRef = useRef(false);

  // The client is cheap to build; the ref keeps the read-on-open effect from depending
  // on the identity of inline props.
  const client: PortfolioSnapshotClient =
    snapshotClient ??
    createPortfolioSnapshotClient({
      getSession,
      clearSession: endSession,
      fetchImpl: snapshotFetchImpl,
    });

  const clientRef = useRef(client);
  clientRef.current = client;

  // Read the saved result once, when the page opens. Without a session this asks for
  // nothing over the network; a 404 is the normal "nothing saved"; an expired session
  // or a failure never raises an alert here (the user has not asked for anything yet).
  useEffect(() => {
    let active = true;

    clientRef.current
      .load()
      .then((outcome) => {
        if (!active) return;

        if (outcome.kind === "found") {
          setSaved(outcome.snapshot);
        } else if (outcome.kind === "unavailable") {
          setLoadUnavailable(true);
        }
      })
      .catch(() => {
        if (active) setLoadUnavailable(true);
      });

    return () => {
      active = false;
    };
  }, []);

  function reset() {
    selectionSeq.current += 1;
    submittingRef.current = false;
    setSelection(null);
    setView({ kind: "idle" });
    setSaveState({ kind: "idle" });
    setInputKey((key) => key + 1);
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    // A new choice (or a cleared one) always drops the previous file and results
    // (never the saved result).
    selectionSeq.current += 1;
    const seq = selectionSeq.current;
    setSelection(null);
    setSaveState({ kind: "idle" });

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
    setSaveState({ kind: "idle" });
    setView({ kind: "submitting" });

    const outcome: ResolveCsvOutcome = await submitPortfolioCsv({
      csvText: selection.text,
      fileId: selection.fileId,
      getSession,
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
      case "aie-access-denied":
        setView({ kind: "aie-access-denied" });
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

  /** "Salvar resultado": an explicit PUT of the re-displayable result, never of the file. */
  async function handleSave() {
    if (view.kind !== "success" || !selection || savingRef.current) {
      return;
    }

    const snapshotItems = toSnapshotItems(view.items, selection.rows);

    if (snapshotItems.length === 0) {
      return;
    }

    savingRef.current = true;
    const seq = selectionSeq.current;
    setSaveState({ kind: "saving" });

    const outcome = await client.save(snapshotItems);

    savingRef.current = false;

    if (outcome.kind === "saved") {
      // Server state: shown even if the file was changed meanwhile.
      setSaved(outcome.snapshot);
      setSavedNote(null);
      setConfirmingDelete(false);
    }

    // The message belongs to the result that is still on screen.
    if (seq !== selectionSeq.current) return;

    setSaveState(
      outcome.kind === "saved"
        ? { kind: "saved" }
        : outcome.kind === "unavailable"
          ? { kind: "failed" }
          : { kind: outcome.kind },
    );
  }

  /** The confirmed "Apagar resultado salvo": DELETE, then the saved state goes away. */
  async function handleDelete() {
    if (deletingRef.current) {
      return;
    }

    deletingRef.current = true;
    setDeleting(true);

    const outcome = await client.remove();

    deletingRef.current = false;
    setDeleting(false);
    setConfirmingDelete(false);

    if (outcome.kind === "deleted") {
      setSaved(null);
      // The result on screen (if any) is no longer saved: offer to save it again.
      setSaveState({ kind: "idle" });
      setSavedNote({ tone: "info", text: "Resultado salvo apagado da sua conta." });
    } else if (outcome.kind === "no-session" || outcome.kind === "unauthenticated") {
      setSavedNote({
        tone: "error",
        text: "Sua sessão expirou, então o resultado salvo não foi apagado. Entre novamente para apagá-lo.",
        signIn: true,
      });
    } else {
      setSavedNote({
        tone: "error",
        text: "Não foi possível apagar o resultado salvo agora. Ele continua na sua conta; tente de novo em instantes.",
      });
    }
  }

  const submitting = view.kind === "submitting";

  const canSubmit =
    selection !== null && selection.rows.length > 0 && !submitting;

  // Display-ready preview rows, derived once and rendered by the single responsive markup.
  const previewDisplay = (selection?.rows ?? []).map((row) => ({
    key: row.candidateId,
    line: row.row,
    name: row.rawName,
    type: row.assetType ?? "—",
    code: row.ticker ?? row.instrumentCode ?? "—",
    amount: formatAmount(row.amount, row.currency),
    status: "Formato válido",
  }));

  const items = view.kind === "success" ? view.items : null;

  const resultRows: ResultRowView[] = (items ?? []).map((item) => {
    const row = selection?.rows[item.index];

    return {
      key: `${item.index}-${item.candidateAssetId}`,
      line: row?.row ?? item.index + 2,
      name: row?.rawName ?? "—",
      item,
    };
  });

  // What "Salvar resultado" would send; nothing to send means no button.
  const savableCount =
    items && selection ? toSnapshotItems(items, selection.rows).length : 0;

  const savedRows = saved ? toDisplayRows(saved) : null;

  const savedAt = saved ? savedAtText(saved.updatedAt) : null;

  return (
    <div className="flex flex-col gap-6">
      {savedNote && (
        <div
          role={savedNote.tone === "error" ? "alert" : "status"}
          className={`rounded-lg p-4 text-sm ${
            savedNote.tone === "error"
              ? "bg-aligna-warnSoft text-aligna-ink"
              : "bg-aligna-pale text-aligna-deep"
          }`}
        >
          <p>{savedNote.text}</p>
          {savedNote.signIn && <SignInLink />}
        </div>
      )}

      {loadUnavailable && !saved && (
        <p role="status" className="text-[13px] text-aligna-muted">
          Não foi possível verificar se há um resultado salvo agora. Você pode continuar usando a
          página normalmente.
        </p>
      )}

      {saved && savedRows && (
        <section className="card" aria-labelledby="csv-saved-title">
          <h2 id="csv-saved-title" className="mb-1 text-[14.5px] font-semibold">
            Resultado salvo
          </h2>
          <p className="mb-1 text-[13px] text-aligna-ink">
            {savedAt ? `Resultado salvo em ${savedAt}.` : "Resultado salvo na sua conta."}
          </p>
          <p className="mb-4 text-[13px] text-aligna-muted">
            {countsText(savedRows.map((row) => row.item))} Este é o último resultado que você
            salvou; para atualizá-lo, resolva uma carteira e clique em &quot;Salvar resultado&quot;.
          </p>

          <ResultsTable caption="Resultado salvo de cada ativo" rows={savedRows} />

          <div className="mt-4">
            {confirmingDelete ? (
              <div
                role="group"
                aria-labelledby="csv-delete-question"
                className="rounded-lg bg-aligna-warnSoft p-4 text-sm text-aligna-ink"
              >
                <p id="csv-delete-question" className="font-semibold">
                  Apagar o resultado salvo da sua conta?
                </p>
                <p className="mt-1">
                  Isso não pode ser desfeito. O arquivo original nunca foi guardado.
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  <button
                    type="button"
                    className={`btn-primary ${FOCUS_RING}`}
                    onClick={handleDelete}
                    disabled={deleting}
                    aria-busy={deleting}
                  >
                    {deleting ? (
                      <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    ) : null}
                    {deleting ? "Apagando..." : "Sim, apagar"}
                  </button>
                  <button
                    type="button"
                    className={`btn-ghost ${FOCUS_RING}`}
                    onClick={() => setConfirmingDelete(false)}
                    disabled={deleting}
                    autoFocus
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                className={`btn-ghost ${FOCUS_RING}`}
                onClick={() => {
                  setSavedNote(null);
                  setConfirmingDelete(true);
                }}
              >
                Apagar resultado salvo
              </button>
            )}
          </div>
        </section>
      )}

      <section className="card" aria-labelledby="csv-file-title">
        <h2 id="csv-file-title" className="mb-1 text-[14.5px] font-semibold">
          1. Escolha o arquivo
        </h2>
        <p className="mb-4 text-[13px] text-aligna-muted">
          Um arquivo CSV com um ativo por linha (até {MAX_PORTFOLIO_ROWS} ativos e {MAX_KIB} KB).
          A coluna <code>rawName</code> é obrigatória. O arquivo é lido só no seu navegador e enviado
          apenas quando você pedir para resolver.
        </p>
        <p id="csv-privacy" className="mb-4 text-[13px] text-aligna-muted">
          O arquivo original nunca é guardado. Salvar o resultado é opcional: se você escolher salvar,
          guardamos só o resultado (nomes, tipos, códigos, valores e situação de cada ativo) na sua
          conta, e você pode apagá-lo quando quiser.
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

          {/*
           * Same responsive strategy as the results (TASK-025): a semantic table from
           * `md` up; below it each row becomes a stacked card with a label per value,
           * so nothing hides behind a horizontal scroll. One markup and one set of
           * display-ready rows (`previewDisplay`), so the two layouts cannot drift.
           * Explicit ARIA roles keep the table semantics while the layout is not a
           * CSS table. The candidate id is a React key only and is never rendered.
           */}
          <table role="table" className="block w-full text-left text-[13px] md:table">
            <caption className="sr-only">Prévia das linhas do arquivo CSV</caption>
            <thead className="sr-only md:not-sr-only md:table-header-group">
              <tr role="row" className="md:table-row md:border-b md:border-aligna-line md:text-aligna-muted">
                <th role="columnheader" scope="col" className="py-2 pr-4 font-semibold">Linha</th>
                <th role="columnheader" scope="col" className="py-2 pr-4 font-semibold">Ativo</th>
                <th role="columnheader" scope="col" className="py-2 pr-4 font-semibold">Tipo</th>
                <th role="columnheader" scope="col" className="py-2 pr-4 font-semibold">Ticker / código</th>
                <th role="columnheader" scope="col" className="py-2 pr-4 font-semibold">Valor</th>
                <th role="columnheader" scope="col" className="py-2 font-semibold">Situação local</th>
              </tr>
            </thead>
            <tbody className="block md:table-row-group">
              {previewDisplay.map((row) => (
                <tr
                  role="row"
                  key={row.key}
                  className="mb-3 block rounded-lg border border-aligna-line p-3 md:mb-0 md:table-row md:rounded-none md:border-0 md:border-b md:p-0 md:last:border-0"
                >
                  <td role="cell" className="block py-0.5 md:table-cell md:py-2 md:pr-4">
                    <CardLabel>Linha</CardLabel>
                    {row.line}
                  </td>
                  <td role="cell" className="block py-0.5 md:table-cell md:py-2 md:pr-4">
                    <CardLabel>Ativo</CardLabel>
                    {row.name}
                  </td>
                  <td role="cell" className="block py-0.5 md:table-cell md:py-2 md:pr-4">
                    <CardLabel>Tipo</CardLabel>
                    {row.type}
                  </td>
                  <td role="cell" className="block py-0.5 md:table-cell md:py-2 md:pr-4">
                    <CardLabel>Ticker / código</CardLabel>
                    {row.code}
                  </td>
                  <td role="cell" className="block py-0.5 md:table-cell md:py-2 md:pr-4">
                    <CardLabel>Valor</CardLabel>
                    {row.amount}
                  </td>
                  <td role="cell" className="block py-0.5 font-medium text-aligna-deep md:table-cell md:py-2">
                    <CardLabel>Situação local</CardLabel>
                    {row.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={`btn-primary ${FOCUS_RING}`}
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
          className={`btn-ghost ${FOCUS_RING}`}
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
            O arquivo não fica guardado: depois de entrar, você volta a esta página e escolhe o arquivo de novo.
          </p>
          {/* A real link (same href as before) styled as the app's primary button: at least 44px tall. */}
          <SignInLink />
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

      {view.kind === "aie-access-denied" && (
        <div role="alert" className="rounded-lg bg-aligna-warnSoft p-4 text-sm text-aligna-ink">
          <p className="font-semibold">Resolução de carteiras ainda não está liberada.</p>
          <p className="mt-1">
            Sua conta ainda não tem acesso à resolução de carteiras em lote. Você continua logado; o arquivo não fica
            guardado, então basta tentar de novo mais tarde.
          </p>
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

      {items && (
        <section className="card" aria-labelledby="csv-results-title">
          <h2 id="csv-results-title" className="mb-1 text-[14.5px] font-semibold">
            3. Resultado
          </h2>
          <p role="status" className="mb-4 text-[13px] text-aligna-muted">
            {countsText(items)}{" "}
            Um ativo que &quot;precisa de mais evidências&quot; não é um erro: é um resultado em que
            ainda faltam confirmações.
          </p>

          {savableCount > 0 && (
            <div className="mb-4 flex flex-col gap-2">
              {saveState.kind === "saved" ? (
                <p role="status" className="text-sm font-medium text-aligna-deep">
                  Este resultado está salvo na sua conta.
                </p>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    className={`btn-ghost ${FOCUS_RING}`}
                    onClick={handleSave}
                    disabled={saveState.kind === "saving"}
                    aria-busy={saveState.kind === "saving"}
                  >
                    {saveState.kind === "saving" ? (
                      <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <Save size={16} aria-hidden="true" />
                    )}
                    {saveState.kind === "saving" ? "Salvando..." : "Salvar resultado"}
                  </button>
                  <span className="text-[13px] text-aligna-muted">
                    Guarda só o resultado na sua conta, nunca o arquivo.
                  </span>
                </div>
              )}

              {(saveState.kind === "failed" || saveState.kind === "rejected") && (
                <p role="alert" className="text-sm text-aligna-danger">
                  {SAVE_FAILURE_TEXT[saveState.kind]}
                </p>
              )}

              {(saveState.kind === "unauthenticated" || saveState.kind === "no-session") && (
                <div role="alert" className="rounded-lg bg-aligna-warnSoft p-4 text-sm text-aligna-ink">
                  <p className="font-semibold">
                    {saveState.kind === "unauthenticated"
                      ? "Sua sessão expirou, então o resultado não foi salvo."
                      : "Entre na sua conta para salvar o resultado."}
                  </p>
                  <p className="mt-1">
                    O resultado continua na tela. Depois de entrar você volta a esta página e precisa
                    escolher o arquivo e resolver de novo para salvar.
                  </p>
                  <SignInLink />
                </div>
              )}
            </div>
          )}

          {items.length > 0 && (
            <ResultsTable caption="Resultado da resolução de cada ativo" rows={resultRows} />
          )}
        </section>
      )}    </div>
  );
}
