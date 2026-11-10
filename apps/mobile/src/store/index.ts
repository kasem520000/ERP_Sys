/**
 * PHASE-022 · the @erp/mobile store barrel (T2-a; MASTER-PLAN §2 package
 * layout / §7 boot mechanics; DR-P22-08 + DR-P22-08b): the driver port
 * (the ONE seam — Node better-sqlite3 today, expo-sqlite on device),
 * the Node driver, the field + personal migration chains, the
 * StorageAdapter store with per-profile business allowlists, the
 * byte-exact 128 MB prune pass, and the LOCAL_DATABASE §6.4 corruption
 * drill — plus the `openFieldStore` / `openPersonalStore` boot
 * conveniences (MASTER-PLAN §7's open → migrate sequence):
 *
 *   field:    driver open (WAL + FK) → applyMigrations (sync-core v1–3)
 *             → applyFieldMigrations (v4+)
 *   personal: driver open (WAL + FK) → applyPersonalMigrations (v1+ —
 *             NO outbox/inbox by construction, DR-P22-08b)
 *
 * …minus `recoveryPass` — the sync host (src/sync) owns every recovery/
 * cycle call; it is re-exported here for consumers so nobody imports
 * sync-core directly for the boot chain.
 */

export {
  type ByteMeasurement,
  type DriverIntegrityCheckResult,
  type SqliteDriverPort,
} from "./driver-port";
export {
  MOBILE_ROW_BYTES_FALLBACK,
  createNodeDriver,
  dbstatAvailable,
} from "./node-driver";
export {
  applyFieldMigrations,
  applyPersonalMigrations,
  MOBILE_FIELD_MIGRATIONS,
  MOBILE_FIELD_SCHEMA_VERSION,
  MOBILE_PERSONAL_MIGRATIONS,
  MOBILE_PERSONAL_SCHEMA_VERSION,
} from "./migrations";
export {
  createMobileStore,
  FIELD_BUSINESS_TABLES,
  PERSONAL_READ_MODELS,
  openFieldStore,
  openPersonalStore,
  type MobileDeviceClass,
  type MobileStore,
  type MobileStoreInfo,
  type MobileStoreProfile,
  type OpenMobileStoreOptions,
} from "./store";
export {
  mobileStoreBytes,
  pruneMobileStore,
  PRUNE_BATCH_ROWS,
  type MobilePruneOptions,
  type MobilePruneResult,
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

// Consumed UNMODIFIED from sync-core (MASTER-PLAN §1 item 8): the boot
// recovery pass (invoked by the sync host after the open helpers) and
// the shared typed error surface the drill throws.
export {
  applyMigrations,
  recoveryPass,
  LocalStoreCorruptError,
  type RecoveryResult,
} from "@erp/sync-core";
