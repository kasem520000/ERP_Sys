/**
 * PHASE-021 · the @erp/desktop store barrel (MASTER-PLAN §2 package
 * layout / §3 boot mechanics; PHASE-021 T2): the SQLite StorageAdapter
 * (dual-profile, DR-P21-02), the desktop migrations v4+ (consuming
 * sync-core v1–3 first), the byte-exact 1 GB prune pass (DR-P21-03),
 * and the LOCAL_DATABASE §6.4 corruption drill — plus the
 * `openDesktopStore` boot convenience:
 *
 *   open (WAL + FK + profile) → applyMigrations (sync-core v1–3) →
 *   applyDesktopMigrations (v4+)
 *
 * …which is MASTER-PLAN §3's boot sequence minus `recoveryPass` — the
 * W2 sync host owns that step (and every other recovery/cycle call);
 * it is re-exported here for consumers so nobody imports sync-core
 * directly for the boot chain.
 */

export {
  createDesktopStore,
  dbstatAvailable,
  storeProfile,
  DESKTOP_BUSINESS_TABLES,
  DESKTOP_ROW_BYTES_FALLBACK,
  SqlCipherUnavailableError,
  type CreateDesktopStoreOptions,
  type DesktopStore,
  type DesktopStoreInfo,
  type DesktopStoreProfile,
  type DesktopStoreProfileRequest,
  type SqliteDatabase,
} from "./sqlite-adapter";
export {
  applyDesktopMigrations,
  DESKTOP_MIGRATIONS,
  DESKTOP_SCHEMA_VERSION,
} from "./desktop-migrations";
export {
  desktopStoreBytes,
  pruneDesktopStore,
  PRUNE_BATCH_ROWS,
  type DesktopPruneOptions,
  type DesktopPruneResult,
} from "./prune";
export {
  integrityCheck,
  readStagedSurvivors,
  recoverCorruptStore,
  stageSurvivors,
  type IntegrityCheckResult,
  type RecoverCorruptStoreOptions,
  type RecoverCorruptStoreResult,
  type StagedSurvivors,
  type StagedSurvivorsManifest,
} from "./corruption";

import { applyMigrations } from "@erp/sync-core";

import { createDesktopStore, type CreateDesktopStoreOptions, type DesktopStore } from "./sqlite-adapter";
import { applyDesktopMigrations } from "./desktop-migrations";

// Consumed UNMODIFIED from sync-core (MASTER-PLAN §1 item 5): the boot
// recovery pass (invoked by the W2 sync host after openDesktopStore)
// and the shared typed error surface the drill throws.
export { applyMigrations, recoveryPass, LocalStoreCorruptError, type RecoveryResult } from "@erp/sync-core";

/**
 * The desktop boot convenience (MASTER-PLAN §3 minus recoveryPass):
 * open the store (WAL + foreign keys + DR-P21-02 profile resolution),
 * apply the sync-core migrations v1–3, then the desktop migrations
 * v4+ — returning a fully migrated, ready-to-sync store.
 */
export function openDesktopStore(opts: CreateDesktopStoreOptions): DesktopStore {
  const store = createDesktopStore(opts);
  applyMigrations(store);
  applyDesktopMigrations(store);
  return store;
}
