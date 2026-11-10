import { type StorageAdapter } from "./store/adapter";

/**
 * PHASE-020 · LRU pruning of pulled read models (MASTER-PLAN §13;
 * LOCAL_DATABASE §5). The spec's budgets are BYTES (POS 256 MB, Android
 * 128 MB, desktop 1 GB, overridable in device config); v1 approximates
 * them by ROW COUNT at ~6.4 KB per row — the documented approximation
 * (byte-exact budgets arrive with the real SQLite store in 021+). The
 * row budgets below are the §5 byte budgets divided by that constant:
 *
 *   pos-terminal    40_000 rows ≈  256 MB
 *   android-field   20_000 rows ≈  128 MB
 *   tauri-desktop  160_000 rows ≈ 1024 MB
 *   android-personal 10_000 rows — no §5 byte budget stated; the honest
 *                                  conservative default.
 *
 * Rules (§5.2): ONLY business tables (never outbox/inbox/cursors/meta —
 * the adapter's `listBusinessTables` excludes machinery by contract);
 * only rows with no local dirty state; write-set rows only after the
 * server acknowledged them (PENDING_SYNC/REJECTED sales are precious,
 * §6.5). Oldest-synced rows go first; a pruned row the user later needs
 * re-pulls transparently (§5.3).
 */

/** The ~6.4 KB/row constant behind the row budgets (documented
 * approximation of the §5 byte budgets). */
export const BYTES_PER_ROW_APPROX = 6_400;

/** Per-device-class row budgets (LOCAL_DATABASE §5 approximation). */
export const ROW_BUDGETS: Readonly<Record<string, number>> = {
  "pos-terminal": 40_000,
  "android-field": 20_000,
  "tauri-desktop": 160_000,
  "android-personal": 10_000,
};

export interface PruneResult {
  /** Rows actually deleted. */
  pruned: number;
  /** Approximate bytes now stored (rows × BYTES_PER_ROW_APPROX). */
  budgetBytesApprox: number;
}

export function pruneStore(
  adapter: StorageAdapter,
  deviceClass: string,
  opts?: { budgetRows?: number },
): PruneResult {
  const tables = adapter.listBusinessTables?.() ?? [];
  if (
    tables.length === 0 ||
    adapter.countRows === undefined ||
    adapter.deleteOldestSynced === undefined
  ) {
    // The adapter cannot enumerate/prune business rows (the 016 browser
    // bridge) — pruning is a no-op, never an error.
    return { pruned: 0, budgetBytesApprox: 0 };
  }
  const budget =
    opts?.budgetRows ?? ROW_BUDGETS[deviceClass] ?? ROW_BUDGETS["android-personal"]!;
  const counts = tables.map((table) => ({ table, rows: adapter.countRows!(table) }));
  const total = counts.reduce((sum, entry) => sum + entry.rows, 0);
  if (total <= budget) {
    return { pruned: 0, budgetBytesApprox: total * BYTES_PER_ROW_APPROX };
  }

  // Over budget: delete oldest-synced rows from the fullest tables first
  // (greedy — simple, deterministic, and it converges without float math)
  // until the store is back under budget. Machinery tables are not in
  // `tables` at all; dirty/unsynced rows are excluded per-table by the
  // adapter's deleteOldestSynced.
  let remaining = total - budget;
  let pruned = 0;
  const exhausted = new Set<string>();
  while (remaining > 0) {
    let target: { table: string; rows: number } | null = null;
    for (const entry of counts) {
      if (exhausted.has(entry.table) || entry.rows === 0) continue;
      if (target === null || entry.rows > target.rows) target = entry;
    }
    if (target === null) break; // every table exhausted its prunable rows
    const chunk = Math.min(remaining, target.rows);
    const deleted = adapter.deleteOldestSynced(target.table, chunk);
    if (deleted === 0) {
      exhausted.add(target.table);
      continue;
    }
    pruned += deleted;
    remaining -= deleted;
    target.rows -= deleted;
    if (deleted < chunk) exhausted.add(target.table);
  }
  return { pruned, budgetBytesApprox: (total - pruned) * BYTES_PER_ROW_APPROX };
}
