import { vi } from "vitest";

import type { PortfolioSnapshotClient } from "@/lib/portfolio-snapshot-api";

/**
 * A stand-in for the saved-result client (TASK-029B) for tests that are about
 * something else (the resolution, the session, the layout): "nothing saved", no
 * network, and every call observable. The default client reads the saved result when
 * the page opens, so a test that counts session or fetch calls injects this.
 */
export function fakeSnapshotClient(
  overrides: Partial<PortfolioSnapshotClient> = {},
): PortfolioSnapshotClient & {
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  removeById: ReturnType<typeof vi.fn>;
} {
  return {
    load: vi.fn(async () => ({ kind: "none" as const })),
    save: vi.fn(async () => ({ kind: "failed" as const })),
    remove: vi.fn(async () => ({ kind: "deleted" as const })),
    // TASK-048B: the history list, read the same way as `load` when the page
    // opens -- "found, empty" by default, so a test about something else
    // never sees an unrelated failure note or network call.
    list: vi.fn(async () => ({ kind: "found" as const, snapshots: [] })),
    get: vi.fn(async () => ({ kind: "none" as const })),
    removeById: vi.fn(async () => ({ kind: "deleted" as const })),
    ...overrides,
  } as PortfolioSnapshotClient & {
    load: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    removeById: ReturnType<typeof vi.fn>;
  };
}
