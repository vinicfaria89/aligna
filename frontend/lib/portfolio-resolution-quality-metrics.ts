import type { SnapshotItem, SnapshotStatus } from "./portfolio-snapshot-mapping";

/**
 * TASK-060A: pure summary of resolution QUALITY over an already-resolved
 * portfolio (`SnapshotItem[]` -- the same normalized shape a fresh
 * resolution and a saved snapshot both converge on, see
 * portfolio-snapshot-mapping.ts). No UI, no DOM, no network, no storage, no
 * current date, no call into the AIE resolver or any provider -- this
 * module only ever reads fields `SnapshotItem` already carries. It never
 * explains or fixes a pendency; it only measures and groups what the
 * result already contains. The "why is this still pending" copy for a
 * user belongs to a future task (TASK-060B/061), not here.
 *
 * --- Adaptations from the task's suggested shape to the REAL SnapshotItem ------------------
 *
 * `SnapshotVerifiedAsset` (portfolio-snapshot-mapping.ts) has no `.name`
 * field (only `code`/`type`/`currency`) -- the "melhor nome" chain
 * collapses to `item.rawName` alone, which is a REQUIRED, always-present
 * field on `SnapshotItem` (never optional), so there is no fallback chain
 * to write for names. `bestKey` still has a real chain, since
 * `verifiedAsset.code`/`ticker`/`code` are all optional. `SnapshotItem` has
 * no distinct "error message" field today -- `itemErrorMessage` reads an
 * optional `message` property defensively (never throws, never fabricates
 * one) so this stays forward-compatible if one is ever added.
 */

export interface ResolutionStatusMetric {
  status: string;
  label: string;
  count: number;
  percentage: number | null;
}

export interface ResolutionAssetTypeMetric {
  assetType: string;
  label: string;
  count: number;
  verified: number;
  pending: number;
  errors: number;
  value: number;
}

export interface ResolutionSourceMetric {
  source: string;
  count: number;
  assetTypes: string[];
}

export interface ResolutionPendingReasonMetric {
  reason: string;
  label: string;
  count: number;
}

export interface ResolutionErrorMetric {
  key: string;
  name: string;
  status: string;
  message?: string;
}

export interface PortfolioResolutionQualitySummary {
  totals: {
    items: number;
    verified: number;
    pending: number;
    errors: number;
    blocked: number;
    conflicts: number;
    needsUser: number;
    needsMoreEvidence: number;
    verificationRate: number | null;
  };
  byStatus: ResolutionStatusMetric[];
  byAssetType: ResolutionAssetTypeMetric[];
  bySource: ResolutionSourceMetric[];
  pendingReasons: ResolutionPendingReasonMetric[];
  errors: ResolutionErrorMetric[];
}

// --- status ------------------------------------------------------------------------------------

// Fixed order for the known statuses (SNAPSHOT_STATUSES,
// portfolio-snapshot-mapping.ts); ALWAYS emitted in `byStatus`, even at
// count 0, so a consumer gets a stable shape to render against. Any OTHER
// string a caller's data happens to carry (never expected today, but never
// trusted to be exhaustive either) is appended afterward, alphabetically,
// and ONLY when it actually occurs at least once.
const KNOWN_STATUS_ORDER: readonly SnapshotStatus[] = [
  "verified",
  "needs-more-evidence",
  "needs-user",
  "conflict",
  "blocked",
  "item-error",
];

// Same copy the comparison UI already uses (PortfolioSnapshotComparison.tsx's
// SNAPSHOT_STATUS_LABEL) -- duplicated here rather than imported, on
// purpose: a `.ts` metrics module has no business depending on a `.tsx`
// component file, and the small, stable list is cheap to keep in sync
// (both are covered by tests).
const STATUS_LABELS: Readonly<Record<SnapshotStatus, string>> = {
  verified: "Verificado",
  "needs-more-evidence": "Precisa de mais evidências",
  "needs-user": "Precisa da sua confirmação",
  conflict: "Evidências em conflito",
  blocked: "Bloqueado",
  "item-error": "Erro ao resolver",
};

function isKnownStatus(status: string): status is SnapshotStatus {
  return (KNOWN_STATUS_ORDER as readonly string[]).includes(status);
}

// --- asset type ----------------------------------------------------------------------------------

// Curated order for the asset types the project's AIE resolver can
// currently produce, plus "unknown". A DELIBERATE, independent copy of the
// same idea as lib/portfolio-snapshot-comparison-by-asset-type.ts's own
// list -- not imported from there: this module summarizes RESOLUTION
// quality (SnapshotItem-only), that one summarizes a COMPARISON between two
// snapshots -- different domains, and importing across them would create
// coupling neither actually needs. Both lists are small, stable and
// covered by their own tests, so the duplication is cheap and safe.
const KNOWN_ASSET_TYPE_ORDER: readonly string[] = [
  "stock",
  "fii",
  "etf",
  "international",
  "treasury",
  "debenture",
  "cdb",
  "lci",
  "lca",
  "cri",
  "cra",
  "coe",
  "fund",
  "crypto",
  "unknown",
];

const ASSET_TYPE_LABELS: Readonly<Record<string, string>> = {
  stock: "Ações",
  fii: "FIIs",
  etf: "ETFs",
  international: "BDRs e internacionais",
  treasury: "Tesouro",
  debenture: "Debêntures",
  cdb: "CDBs",
  lci: "LCIs",
  lca: "LCAs",
  cri: "CRIs",
  cra: "CRAs",
  coe: "COEs",
  fund: "Fundos",
  crypto: "Criptoativos",
  unknown: "Sem tipo definido",
};

/** Missing/empty/whitespace-only becomes "unknown"; everything else is
 * trim()+toLowerCase(). */
function normalizeAssetType(value: string | undefined): string {
  if (typeof value !== "string") {
    return "unknown";
  }
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : "unknown";
}

/** `item.assetType` first, `verifiedAsset.type` as fallback, "unknown" last
 * -- same conservative priority as TASK-056A's grouping, adapted to a
 * single item (no base/target side here). */
function extractAssetType(item: SnapshotItem): string {
  return normalizeAssetType(item.assetType ?? item.verifiedAsset?.type);
}

/** A minimal, deterministic label for a type with no curated entry:
 * capitalizes each hyphen/underscore/space-separated word, never inventing
 * meaning it doesn't have. */
function humanizeUnknownAssetType(assetType: string): string {
  return assetType
    .split(/[-_\s]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function labelForAssetType(assetType: string): string {
  return ASSET_TYPE_LABELS[assetType] ?? humanizeUnknownAssetType(assetType);
}

function compareAssetTypeForSort(a: string, b: string): number {
  const rankA = KNOWN_ASSET_TYPE_ORDER.indexOf(a);
  const rankB = KNOWN_ASSET_TYPE_ORDER.indexOf(b);
  const bucketA = rankA === -1 ? KNOWN_ASSET_TYPE_ORDER.length : rankA;
  const bucketB = rankB === -1 ? KNOWN_ASSET_TYPE_ORDER.length : rankB;

  if (bucketA !== bucketB) {
    return bucketA - bucketB;
  }
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

// --- values ----------------------------------------------------------------------------------------

/** Missing/invalid/non-finite counts as 0 -- never thrown, never
 * Infinity/NaN. Same rule `comparePortfolioSnapshots` (TASK-053A) already
 * uses. Never converts currency: a portfolio mixing BRL and USD items is
 * summed as plain numbers regardless of `currency` -- a known, documented
 * limitation carried over unchanged from the rest of the snapshot/
 * comparison code, not something this task tries to fix. */
function safeValue(item: SnapshotItem): number {
  return typeof item.amount === "number" && Number.isFinite(item.amount) ? item.amount : 0;
}

// --- identity (key/name) -----------------------------------------------------------------------------

function nonEmpty(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Stable, deterministic key -- never the item's value/amount. Priority:
 * verifiedAsset.code -> ticker -> code -> rawName -> `item-<index>` (only
 * reached when even `rawName` is somehow empty, which real ingestion never
 * produces, but this function never assumes that). */
function bestKey(item: SnapshotItem, index: number): string {
  return (
    nonEmpty(item.verifiedAsset?.code) ??
    nonEmpty(item.ticker) ??
    nonEmpty(item.code) ??
    nonEmpty(item.rawName) ??
    `item-${index}`
  );
}

/** `rawName` is a REQUIRED field on `SnapshotItem` (never optional/empty by
 * the time ingestion produces one) -- so, unlike `bestKey`, there is no
 * real fallback chain to write here; this always returns it directly. */
function bestName(item: SnapshotItem): string {
  return item.rawName;
}

/** Defensive, forward-compatible read of an error message `SnapshotItem`
 * does not declare today -- never throws when absent (a normal `undefined`
 * property read), never fabricates one, and never trusts a non-string
 * value. */
function itemErrorMessage(item: SnapshotItem): string | undefined {
  const raw = (item as { message?: unknown }).message;
  return typeof raw === "string" && raw.trim().length > 0 ? raw : undefined;
}

// --- pending reasons -----------------------------------------------------------------------------------

interface ReasonInfo {
  reason: string;
  label: string;
}

/**
 * `SnapshotItem` carries no separate "reason code" field beyond `status`
 * itself -- `status` (a closed, typed `SnapshotStatus`) IS the explicit,
 * structured signal this task's "usar esse campo, se existir" instruction
 * refers to; there is nothing more explicit to prefer over it today. Only
 * called for non-verified, non-error items.
 */
function reasonForStatus(status: SnapshotStatus | string): ReasonInfo {
  switch (status) {
    case "needs-more-evidence":
      return { reason: "needs_more_evidence", label: "Precisa de mais evidências" };
    case "needs-user":
      return { reason: "needs_user", label: "Precisa de ação do usuário" };
    case "conflict":
      return { reason: "conflict", label: "Conflito de informações" };
    case "blocked":
      return { reason: "blocked", label: "Bloqueado" };
    default:
      return { reason: "unknown_status", label: "Status desconhecido" };
  }
}

// --- main ------------------------------------------------------------------------------------------------

/**
 * Summarizes resolution quality over an already-resolved portfolio.
 * Never mutates `items` or any item inside it; never sorts the input array
 * in place (every returned list is a fresh array).
 */
export function summarizePortfolioResolutionQuality(
  items: readonly SnapshotItem[],
): PortfolioResolutionQualitySummary {
  const totalItems = items.length;

  let verified = 0;
  let pending = 0;
  let errors = 0;
  let blocked = 0;
  let conflicts = 0;
  let needsUser = 0;
  let needsMoreEvidence = 0;

  const statusCounts = new Map<string, number>();
  const assetTypeAgg = new Map<
    string,
    { count: number; verified: number; pending: number; errors: number; value: number }
  >();
  const sourceCounts = new Map<string, { count: number; assetTypes: Set<string> }>();
  const pendingReasonCounts = new Map<string, { label: string; count: number }>();
  const errorRows: ResolutionErrorMetric[] = [];

  items.forEach((item, index) => {
    const status = item.status;
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);

    const assetType = extractAssetType(item);
    const value = safeValue(item);
    const assetTypeRow = assetTypeAgg.get(assetType) ?? { count: 0, verified: 0, pending: 0, errors: 0, value: 0 };
    assetTypeRow.count += 1;
    assetTypeRow.value += value;

    const isVerified = status === "verified";
    const isError = status === "item-error";
    const isBlocked = status === "blocked";
    // Everything that is neither verified nor an error is treated as
    // "pending" for the totals/byAssetType buckets -- INCLUDING "blocked"
    // and "conflict" (both explicitly required by the task to also count
    // as pending), and including any unrecognized status (safe default:
    // never silently dropped, never counted as verified).
    const isPending = !isVerified && !isError;

    if (isVerified) {
      verified += 1;
      assetTypeRow.verified += 1;

      const itemSources = item.sources.length > 0 ? Array.from(new Set(item.sources)) : ["unknown"];
      for (const source of itemSources) {
        const sourceRow = sourceCounts.get(source) ?? { count: 0, assetTypes: new Set<string>() };
        sourceRow.count += 1;
        sourceRow.assetTypes.add(assetType);
        sourceCounts.set(source, sourceRow);
      }
    } else if (isError) {
      errors += 1;
      assetTypeRow.errors += 1;
      errorRows.push({
        key: bestKey(item, index),
        name: bestName(item),
        status,
        ...(itemErrorMessage(item) !== undefined ? { message: itemErrorMessage(item) } : {}),
      });
    }

    if (isPending) {
      pending += 1;
      assetTypeRow.pending += 1;

      if (isBlocked) {
        blocked += 1;
      } else if (status === "conflict") {
        conflicts += 1;
      } else if (status === "needs-user") {
        needsUser += 1;
      } else if (status === "needs-more-evidence") {
        needsMoreEvidence += 1;
      }

      const { reason, label } = reasonForStatus(status);
      const reasonRow = pendingReasonCounts.get(reason) ?? { label, count: 0 };
      reasonRow.count += 1;
      pendingReasonCounts.set(reason, reasonRow);
    }

    assetTypeAgg.set(assetType, assetTypeRow);
  });

  const byStatus: ResolutionStatusMetric[] = [];
  for (const status of KNOWN_STATUS_ORDER) {
    const count = statusCounts.get(status) ?? 0;
    byStatus.push({
      status,
      label: STATUS_LABELS[status],
      count,
      percentage: totalItems === 0 ? null : (count / totalItems) * 100,
    });
  }
  const unknownStatuses = Array.from(statusCounts.keys())
    .filter((status) => !isKnownStatus(status))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const status of unknownStatuses) {
    const count = statusCounts.get(status) ?? 0;
    byStatus.push({
      status,
      label: status,
      count,
      percentage: totalItems === 0 ? null : (count / totalItems) * 100,
    });
  }

  const byAssetType: ResolutionAssetTypeMetric[] = Array.from(assetTypeAgg.entries())
    .map(([assetType, row]) => ({
      assetType,
      label: labelForAssetType(assetType),
      count: row.count,
      verified: row.verified,
      pending: row.pending,
      errors: row.errors,
      value: row.value,
    }))
    .sort((a, b) => compareAssetTypeForSort(a.assetType, b.assetType));

  const bySource: ResolutionSourceMetric[] = Array.from(sourceCounts.entries())
    .map(([source, row]) => ({
      source,
      count: row.count,
      assetTypes: Array.from(row.assetTypes).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    }))
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.source < b.source ? -1 : a.source > b.source ? 1 : 0;
    });

  const pendingReasons: ResolutionPendingReasonMetric[] = Array.from(pendingReasonCounts.entries())
    .map(([reason, row]) => ({ reason, label: row.label, count: row.count }))
    .sort((a, b) => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }
      return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
    });

  return {
    totals: {
      items: totalItems,
      verified,
      pending,
      errors,
      blocked,
      conflicts,
      needsUser,
      needsMoreEvidence,
      verificationRate: totalItems === 0 ? null : (verified / totalItems) * 100,
    },
    byStatus,
    byAssetType,
    bySource,
    pendingReasons,
    errors: errorRows,
  };
}
