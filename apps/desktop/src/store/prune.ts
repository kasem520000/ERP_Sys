import { DESKTOP_STORAGE_BUDGET_BYTES } from "../constants";
import type { DesktopStore } from "./sqlite-adapter";

/**
 * PHASE-021 · the desktop byte-exact pruning pass (DR-P21-03 — the
 * DR-P20-10 promise; MASTER-PLAN §1 item 4 / §3; LOCAL_DATABASE §5):
 * `sync-core.pruneStore` stays untouched as the generic row-budget
 * fallback; the desktop maintenance loop runs THIS pass against the
 * 1 GB byte-exact budget, measuring real bytes via the store's
 * `tableBytes` (SQLite `dbstat` `sum(pgsize)` — or the store's honest
 * row-count fallback when dbstat is absent, reported as
 * `estimated: true`).
 *
 * Rules (LOCAL_DATABASE §5.2, identical in spirit to the sync-core
 * pass): ONLY business tables (the store's allowlist — never
 * outbox/inbox/cursors/meta/schema_migrations, never local_events),
 * never dirty rows, write-set rows only in server-acked terminal
 * statuses, oldest-synced first, plain DELETEs (a pruned row the user
 * later needs re-pulls transparently, §5.3 — cursors and machinery are
 * untouched). Byte-exact re-measure after every pass; stops under
 * budget or when nothing more is prunable — in which case the result
 * SAYS SO (`stillOverBudget: true`), never a silent pass.
 */

/** LRU batch size per table per pass (MASTER-PLAN §3 "e.g., 50
 * rows/table/pass" — small bounded deletes keep WAL checkpoints cheap
 * and the loop converges without long write locks). */
export const PRUNE_BATCH_ROWS = 50;

export interface DesktopPruneOptions {
  /** Budget override in bytes (tests use tiny budgets; production uses
   * the 1 GB golden constant DESKTOP_STORAGE_BUDGET_BYTES by default). */
  readonly budgetBytes?: number;
}

/** The honest prune report (DR-P21-03): measured bytes freed, whether
 * the measurement was exact or the documented row-count approximation,
 * rows deleted per table, LRU passes run, and whether the store is
 * STILL over budget because nothing more was prunable. */
export interface DesktopPruneResult {
  /** Measured bytes freed (start − end across the pass, byte-exact when
   * dbstat is available). */
  readonly freedBytes: number;
  /** True when `tableBytes` fell back to the row-count approximation
   * (dbstat absent from the build) — the report never claims exactness
   * it did not measure. */
  readonly estimated: boolean;
  /** Rows deleted per business table (LRU order inside each table). */
  readonly perTable: Readonly<Record<string, number>>;
  /** LRU passes over the business-table set. */
  readonly iterations: number;
  /** True when the loop exhausted every prunable row and the store is
   * still over budget — the loud honest flag, never a silent pass. */
  readonly stillOverBudget: boolean;
}

/** Sum of `tableBytes` across the store's business tables (the measured
 * budget footprint; machinery/audit tables are excluded by the store's
 * allowlist and never counted against the cache budget). */
export function desktopStoreBytes(store: DesktopStore): number {
  return store.listBusinessTables().reduce((sum, table) => sum + store.tableBytes(table), 0);
}

/** Run one byte-exact prune pass against the desktop budget. */
export function pruneDesktopStore(
  store: DesktopStore,
  opts?: DesktopPruneOptions,
): DesktopPruneResult {
  const budget = opts?.budgetBytes ?? DESKTOP_STORAGE_BUDGET_BYTES;
  const estimated = store.info.byteMeasurement === "row-approx";
  const tables = store.listBusinessTables();

  const startBytes = desktopStoreBytes(store);
  if (startBytes <= budget) {
    return { freedBytes: 0, estimated, perTable: {}, iterations: 0, stillOverBudget: false };
  }

  const perTable: Record<string, number> = {};
  let iterations = 0;
  // Loop: measure → delete one LRU batch per table → re-measure. Stops
  // under budget or when a full pass deleted nothing (nothing more
  // prunable — dirty rows, precious write-set rows, machinery).
  for (;;) {
    if (desktopStoreBytes(store) <= budget) break;
    iterations += 1;
    let progressed = false;
    for (const table of tables) {
      const deleted = store.deleteOldestSynced(table, PRUNE_BATCH_ROWS);
      if (deleted > 0) {
        perTable[table] = (perTable[table] ?? 0) + deleted;
        progressed = true;
      }
    }
    if (!progressed) break;
  }

  const endBytes = desktopStoreBytes(store);
  return {
    freedBytes: startBytes - endBytes,
    estimated,
    perTable,
    iterations,
    stillOverBudget: endBytes > budget,
  };
}
