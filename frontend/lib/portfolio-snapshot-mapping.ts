import type { PreviewRow } from "./aie/client/portfolio-csv-preview";
import type { ResolvedItemView } from "./aie/client/resolve-csv-client";

/**
 * The saved-result contract of the Planejador (TASK-029A) and its mapping to and
 * from what the /carteira screen already has (TASK-029B).
 *
 * Only what the screen needs to show a result again is ever sent: the row, the name
 * and hints the user typed, the resolution status, the pending fields and sources,
 * and, when there is one, the verified asset's code/type/currency. Never the CSV,
 * the file name, the upload id, an internal candidate id (`portfolio:*`), evidence,
 * provider payloads, a token or a correlation id. Pure and browser-safe: no storage,
 * no console, no network.
 */

export const SNAPSHOT_STATUSES = [
  "verified",
  "needs-more-evidence",
  "needs-user",
  "conflict",
  "blocked",
  "item-error",
] as const;

export type SnapshotStatus = (typeof SNAPSHOT_STATUSES)[number];

export interface SnapshotVerifiedAsset {
  code: string;
  type: string;
  currency: string;
}

export interface SnapshotItem {
  lineNumber: number;
  rawName: string;
  assetType?: string;
  ticker?: string;
  code?: string;
  amount?: number;
  currency?: string;
  status: SnapshotStatus;
  pendingFields: string[];
  sources: string[];
  verifiedAsset?: SnapshotVerifiedAsset;
}

export interface SavedSnapshot {
  items: SnapshotItem[];
  /** ISO timestamp from the Planejador. */
  updatedAt: string;
}

/** The Planejador's limits (kept equal to its validation). */
export const SNAPSHOT_LIMITS = {
  items: 100,
  rawName: 256,
  assetType: 64,
  ticker: 32,
  code: 64,
  currency: 8,
  listEntry: 64,
  listLength: 20,
  amount: 1e15,
} as const;

// Control characters are refused by the Planejador; they become a space here.
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/g;

function clean(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const text = value
    .replace(CONTROL_CHARACTERS, " ")
    .trim()
    .slice(0, max)
    .trim();

  return text.length > 0 ? text : undefined;
}

function cleanList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const entries: string[] = [];

  for (const entry of value) {
    const text = clean(entry, SNAPSHOT_LIMITS.listEntry);

    if (text !== undefined && !entries.includes(text)) {
      entries.push(text);
    }

    if (entries.length === SNAPSHOT_LIMITS.listLength) {
      break;
    }
  }

  return entries;
}

function isStatus(value: unknown): value is SnapshotStatus {
  return (
    typeof value === "string" &&
    (SNAPSHOT_STATUSES as readonly string[]).includes(value)
  );
}

function finiteAmount(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= SNAPSHOT_LIMITS.amount
    ? value
    : undefined;
}

/**
 * The items to send when the user chooses "Salvar resultado". An item that cannot be
 * shown again (no matching row, a name that is empty after cleaning, a status the
 * contract does not know) is left out rather than sent invalid; an empty list means
 * there is nothing to save.
 */
export function toSnapshotItems(
  items: ResolvedItemView[],
  rows: PreviewRow[],
): SnapshotItem[] {
  const out: SnapshotItem[] = [];

  for (const item of items) {
    const row = rows[item.index];

    if (!row || !Number.isInteger(row.row) || row.row < 1) {
      continue;
    }

    const rawName = clean(row.rawName, SNAPSHOT_LIMITS.rawName);

    const status: SnapshotStatus | null =
      item.kind === "item-error"
        ? "item-error"
        : isStatus(item.status)
          ? item.status
          : null;

    if (rawName === undefined || status === null) {
      continue;
    }

    const assetType = clean(row.assetType, SNAPSHOT_LIMITS.assetType);
    const ticker = clean(row.ticker, SNAPSHOT_LIMITS.ticker);
    const code = clean(row.instrumentCode, SNAPSHOT_LIMITS.code);
    const currency = clean(row.currency, SNAPSHOT_LIMITS.currency);
    const amount = finiteAmount(row.amount);

    const verifiedCode = clean(
      item.verifiedAsset?.canonicalAssetId,
      SNAPSHOT_LIMITS.code,
    );
    const verifiedType = clean(
      item.verifiedAsset?.assetType,
      SNAPSHOT_LIMITS.assetType,
    );
    const verifiedCurrency = clean(
      item.verifiedAsset?.currency,
      SNAPSHOT_LIMITS.currency,
    );

    out.push({
      lineNumber: row.row,
      rawName,
      ...(assetType !== undefined ? { assetType } : {}),
      ...(ticker !== undefined ? { ticker } : {}),
      ...(code !== undefined ? { code } : {}),
      ...(amount !== undefined ? { amount } : {}),
      ...(currency !== undefined ? { currency } : {}),
      status,
      pendingFields: cleanList(item.unresolvedFields),
      sources: cleanList(item.sources),
      ...(verifiedCode !== undefined &&
      verifiedType !== undefined &&
      verifiedCurrency !== undefined
        ? {
            verifiedAsset: {
              code: verifiedCode,
              type: verifiedType,
              currency: verifiedCurrency,
            },
          }
        : {}),
    });

    if (out.length === SNAPSHOT_LIMITS.items) {
      break;
    }
  }

  return out;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Reads the Planejador's answer defensively: only the contract's fields are kept and
 * anything malformed makes the whole answer unusable (`null`), never a half result.
 */
export function parseSavedSnapshot(body: unknown): SavedSnapshot | null {
  const root = asObject(body);

  if (
    !root ||
    !Array.isArray(root.items) ||
    root.items.length === 0 ||
    root.items.length > SNAPSHOT_LIMITS.items ||
    typeof root.updatedAt !== "string"
  ) {
    return null;
  }

  const items: SnapshotItem[] = [];

  for (const raw of root.items) {
    const item = asObject(raw);

    if (
      !item ||
      typeof item.lineNumber !== "number" ||
      !Number.isInteger(item.lineNumber) ||
      typeof item.rawName !== "string" ||
      item.rawName.length === 0 ||
      !isStatus(item.status)
    ) {
      return null;
    }

    const verified = asObject(item.verifiedAsset);

    const assetType = clean(item.assetType, SNAPSHOT_LIMITS.assetType);
    const ticker = clean(item.ticker, SNAPSHOT_LIMITS.ticker);
    const code = clean(item.code, SNAPSHOT_LIMITS.code);
    const currency = clean(item.currency, SNAPSHOT_LIMITS.currency);
    const amount = finiteAmount(item.amount);

    items.push({
      lineNumber: item.lineNumber,
      rawName: item.rawName,
      ...(assetType !== undefined ? { assetType } : {}),
      ...(ticker !== undefined ? { ticker } : {}),
      ...(code !== undefined ? { code } : {}),
      ...(amount !== undefined ? { amount } : {}),
      ...(currency !== undefined ? { currency } : {}),
      status: item.status,
      pendingFields: cleanList(item.pendingFields),
      sources: cleanList(item.sources),
      ...(verified &&
      typeof verified.code === "string" &&
      typeof verified.type === "string" &&
      typeof verified.currency === "string"
        ? {
            verifiedAsset: {
              code: verified.code,
              type: verified.type,
              currency: verified.currency,
            },
          }
        : {}),
    });
  }

  return { items, updatedAt: root.updatedAt };
}

/** A saved item as the existing results table expects it. */
export interface SavedDisplayRow {
  key: string;
  line: number;
  name: string;
  /** What the user typed for the asset, shown only when it was saved (TASK-030). */
  assetType?: string;
  /** The ticker, else the instrument code (the same rule as the preview). */
  code?: string;
  amount?: number;
  currency?: string;
  item: ResolvedItemView;
}

export function toDisplayRows(snapshot: SavedSnapshot): SavedDisplayRow[] {
  return snapshot.items.map((saved, index) => ({
    key: `saved-${index}-${saved.lineNumber}`,
    line: saved.lineNumber,
    name: saved.rawName,
    ...(saved.assetType !== undefined ? { assetType: saved.assetType } : {}),
    ...(saved.ticker ?? saved.code ? { code: (saved.ticker ?? saved.code) as string } : {}),
    ...(saved.amount !== undefined ? { amount: saved.amount } : {}),
    ...(saved.currency !== undefined ? { currency: saved.currency } : {}),
    item: {
      index,
      candidateAssetId: `saved-${index}`,
      kind: saved.status === "item-error" ? "item-error" : "resolved",
      ...(saved.status !== "item-error" ? { status: saved.status } : {}),
      unresolvedFields: saved.pendingFields,
      sources: saved.sources,
      failedSources: [],
      ...(saved.verifiedAsset
        ? {
            verifiedAsset: {
              canonicalAssetId: saved.verifiedAsset.code,
              assetType: saved.verifiedAsset.type,
              currency: saved.verifiedAsset.currency,
            },
          }
        : {}),
    },
  }));
}
