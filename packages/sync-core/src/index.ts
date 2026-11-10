/** @erp/sync-core — PHASE-016 POS slice + PHASE-020 sync-core v1
 * (MASTER-PLAN §13): the device-side local store, outbox, cursors, pull
 * applier, sync client + full cycle, retry scheduler, recovery, pruning,
 * permission watermark, and the harness-native reference device. */
export {
  LOCAL_MIGRATIONS,
  applyMigrations,
  memoryAdapter,
  BUSINESS_TABLES,
  MACHINERY_TABLES,
  WRITE_SET_TABLES,
  isQuarantined,
  maintainCursorCount,
  maintainInboxCount,
  metaDelete,
  metaGet,
  metaSet,
  type LocalMigration,
  type MemoryAdapter,
  type StorageAdapter,
} from "./store/adapter";
export {
  applyPullBatch,
  capturePosSale,
  markSaleRejected,
  markSaleSynced,
  posAppliers,
  readCursor,
  readMeta,
  resetCursor,
  writeMeta,
  writePermissionWatermark,
  type LocalCursor,
  type PullAppliers,
  type PullBatchChange,
} from "./store/pull";
export {
  applyResult,
  cancel,
  clearQueueUnresolvable,
  enqueue,
  markInFlight,
  markQueueUnresolvable,
  markSynced,
  nextBatch,
  queueStats,
  queueUnresolvableReason,
  rejectedCommands,
  recoverInFlight,
  requeue,
  type ApplyResultInput,
  type EnqueueInput,
  type OutboxRow,
  type OutboxStatus,
  type ServerStateStamp,
} from "./outbox/engine";
export {
  buildPosSaleCommand,
  buildShiftCloseCommand,
  buildShiftOpenCommand,
  buildSyncCommandV2,
  buildPartnerContactMerge,
  buildDraftInvoiceCreate,
  buildDraftInvoiceUpdate,
  currentOfflineSeq,
  nextOfflineNumber,
  type BuildSyncCommandV2Input,
  type PartnerContactMergeFields,
  type PosSaleDraft,
  type SyncCommandV2Envelope,
} from "./commands/builders";
export { SyncClient, type SyncOutcome, type SyncTransport } from "./client";
export {
  feedEntitiesForDeviceClass,
  runCycle,
  type CycleEvent,
  type CycleOptions,
  type CycleOutcome,
} from "./cycle";
export {
  RETRY_BASE_MS,
  RETRY_CAP_MS,
  RetryScheduler,
  fullJitterDelay,
  type FullJitterOptions,
} from "./retry";
export { recoveryPass, type RecoveryResult } from "./recovery";
export {
  BYTES_PER_ROW_APPROX,
  ROW_BUDGETS,
  pruneStore,
  type PruneResult,
} from "./pruning";
export {
  PERMISSION_SNAPSHOT_MAX_AGE_DAYS,
  assertWritable,
  permissionWatermarkState,
  type PermissionWatermarkState,
} from "./watermark";
export { LocalStoreCorruptError, SyncReadOnlyError } from "./errors";
export {
  FakeServer,
  FakeSyncServerV2,
  FaultTransport,
  V2Transport,
  makeDevice,
  seededRandom,
  type FakeSyncStatus,
  type FaultMode,
  type ScriptedChange,
  type ServerProbe,
} from "./test-harness/chaos";
export { ReferenceDevice, type ReferenceDeviceState } from "./test-harness/reference-device";
