import { explainResolutionItem } from "./portfolio-resolution-explanations";
import { buildPortfolioResolutionImprovementPlan } from "./portfolio-resolution-improvement-plan";
import { summarizePortfolioResolutionQuality } from "./portfolio-resolution-quality-metrics";
import { detectPortfolioResolutionUxHint } from "./portfolio-resolution-ux-hints";
import type { SnapshotItem } from "./portfolio-snapshot-mapping";

/**
 * TASK-067A: pure HTML export of the resolution-quality diagnostic --
 * same composition as `portfolio-resolution-quality-export.ts`'s CSV
 * (TASK-066A): `summarizePortfolioResolutionQuality` (TASK-060A) +
 * `buildPortfolioResolutionImprovementPlan` (TASK-062A) +, per item,
 * `explainResolutionItem` (TASK-061A) merged with
 * `detectPortfolioResolutionUxHint` (TASK-065A) the same way
 * `PortfolioCsvResolver.tsx`'s `withUxHint` does (TASK-065B) -- the
 * suggestion shown is what the UI actually shows, not a re-derivation. No
 * new decision logic lives here: this module only reads fields those pure
 * helpers already computed and formats them as a static HTML document. No
 * UI, no DOM, no download trigger, no button, no script tag, no external
 * stylesheet -- that is TASK-067B.
 */

/** Escapes the five characters HTML text/attribute content requires
 * escaping (RFC-free; matches what every static-HTML generator needs). */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function text(value: string | undefined | null): string {
  return escapeHtml(value ?? "");
}

/** Same priority as TASK-056A/060A/061A/062A/066A: `item.assetType` first,
 * `verifiedAsset.type` as fallback, empty last -- no new rule. */
function extractAssetType(item: SnapshotItem): string {
  const raw = item.assetType ?? item.verifiedAsset?.type;
  return typeof raw === "string" ? raw.trim() : "";
}

/** Same merge `PortfolioCsvResolver.tsx`'s `withUxHint` does (TASK-065B):
 * the UX hint replaces only the displayed suggestion. */
function displayedSuggestion(item: SnapshotItem, explanationSuggestion: string | undefined): string {
  const hint = detectPortfolioResolutionUxHint(item);

  return hint ? hint.suggestion : (explanationSuggestion ?? "");
}

function summarySection(items: readonly SnapshotItem[]): string {
  const { totals } = summarizePortfolioResolutionQuality(items);
  const rate = totals.verificationRate === null ? "—" : `${totals.verificationRate.toFixed(1)}%`;

  const rows = [
    ["Total de ativos", String(totals.items)],
    ["Verificados", String(totals.verified)],
    ["Pendentes", String(totals.pending)],
    ["Erros", String(totals.errors)],
    ["Bloqueados", String(totals.blocked)],
    ["Conflitos", String(totals.conflicts)],
    ["Precisam de ação do usuário", String(totals.needsUser)],
    ["Precisam de mais evidências", String(totals.needsMoreEvidence)],
    ["Taxa de verificação", rate],
  ]
    .map(([label, value]) => `<tr><td>${text(label)}</td><td>${text(value)}</td></tr>`)
    .join("");

  return [
    "<h2>Resumo</h2>",
    "<table>",
    "<tr><th>Métrica</th><th>Valor</th></tr>",
    rows,
    "</table>",
  ].join("");
}

function improvementPlanSection(items: readonly SnapshotItem[]): string {
  const plan = buildPortfolioResolutionImprovementPlan(items);

  if (plan.suggestions.length === 0) {
    return ["<h2>Plano de melhoria</h2>", "<p>Nenhuma sugestão de melhoria.</p>"].join("");
  }

  const listItems = plan.suggestions
    .map(
      (s) =>
        `<li><strong>${text(s.title)}</strong> (${text(s.priority)}) — ${text(s.description)} ` +
        `(${text(String(s.affectedItems))} ativo(s) afetado(s))</li>`,
    )
    .join("");

  return ["<h2>Plano de melhoria</h2>", "<ul>", listItems, "</ul>"].join("");
}

function itemsSection(items: readonly SnapshotItem[]): string {
  if (items.length === 0) {
    return ["<h2>Ativos</h2>", "<p>Nenhum ativo para exibir.</p>"].join("");
  }

  const rows = items
    .map((item) => {
      const explanation = explainResolutionItem(item);
      const suggestion = displayedSuggestion(item, explanation.suggestion);

      return (
        "<tr>" +
        `<td>${text(item.rawName)}</td>` +
        `<td>${text(item.status)}</td>` +
        `<td>${text(extractAssetType(item))}</td>` +
        `<td>${text(item.sources.join("; "))}</td>` +
        `<td>${text(explanation.title)}</td>` +
        `<td>${text(suggestion)}</td>` +
        "</tr>"
      );
    })
    .join("");

  return [
    "<h2>Ativos</h2>",
    "<table>",
    "<tr><th>Nome</th><th>Status</th><th>Tipo</th><th>Fonte</th><th>Explicação</th><th>Sugestão</th></tr>",
    rows,
    "</table>",
  ].join("");
}

/** A minimal, dependency-free inline stylesheet -- readable tables and
 * headings, nothing that requires an external file or a build step. */
const STYLE = `
  body { font-family: Arial, Helvetica, sans-serif; color: #0f2318; margin: 2rem; }
  h1 { font-size: 1.5rem; }
  h2 { font-size: 1.15rem; margin-top: 2rem; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #dcece1; padding: 0.5rem; text-align: left; font-size: 0.9rem; }
  th { background: #f2fbf5; }
`;

/** The exported HTML document's text -- a complete, static HTML5 page: no
 * script tag, no external stylesheet or font, no library. Deterministic:
 * same input always yields the same output; `items` is never mutated. */
export function buildPortfolioResolutionQualityHtml(items: readonly SnapshotItem[]): string {
  return [
    "<!DOCTYPE html>",
    '<html lang="pt-BR">',
    "<head>",
    '<meta charset="UTF-8">',
    "<title>Qualidade da resolução</title>",
    `<style>${STYLE}</style>`,
    "</head>",
    "<body>",
    "<h1>Qualidade da resolução</h1>",
    summarySection(items),
    improvementPlanSection(items),
    itemsSection(items),
    "</body>",
    "</html>",
  ].join("\n");
}

/** `qualidade-resolucao-YYYY-MM-DD.html`, from the given date (defaults to
 * now). Same convention as `resolutionQualityExportFileName`
 * (portfolio-resolution-quality-export.ts), just the `.html` extension. */
export function resolutionQualityHtmlFileName(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");

  return `qualidade-resolucao-${y}-${m}-${d}.html`;
}
