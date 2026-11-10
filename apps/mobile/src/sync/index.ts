/**
 * PHASE-022 · the @erp/mobile sync barrel (T2-a; MASTER-PLAN §2 package
 * layout / §7 — BINDING; DR-P22-08): the HTTP port + the
 * MobileHttpTransport (`SyncTransport` over the fetch-like seam, with
 * the per-cycle budget guard), the thin per-class sync host
 * (MobileSyncHost over the UNMODIFIED sync-core client + runCycle,
 * with the mobile feed appliers), the trigger set (+ the
 * BackgroundSchedulerPort), and the D-01 revocation purge. Consumed
 * through `@erp/mobile`'s root barrel by the native shell (2-b/2-e)
 * and the W3 chaos harness (3-a).
 */

export {
  mobileHttpTransport,
  MobileSessionExpiredError,
  MobileSyncHttpError,
  MobileSyncResponseError,
  SyncBudgetExceededError,
  BudgetGuard,
  DEVICE_ID_HEADER,
  FIELD_FOREGROUND_BUDGET,
  PERSONAL_BACKGROUND_BUDGET,
  PERSONAL_FOREGROUND_BUDGET,
  SYNC_PULL_ACK_PATH,
  SYNC_PULL_PATH,
  SYNC_PUSH_ACK_PATH,
  SYNC_PUSH_PATH,
  SYNC_STATUS_PATH,
  type AccessTokenProvider,
  type MobileHttpTransport,
  type MobileHttpTransportOptions,
  type MobileSyncStatus,
  type MobileSyncStatusDevice,
  type TransportBudgetController,
  type TransportBudgetProfile,
} from "./transport";
export type { HttpPort, HttpPortRequest, HttpPortRequestOptions, HttpPortResponse } from "./http-port";
export {
  MOBILE_FEED_APPLIERS,
  MOBILE_FIELD_FEED_TYPES,
  PERSONAL_FEED_TYPES,
  MobileSyncHost,
  type HostState,
  type MobileCycleResult,
  type MobilePushResult,
  type OutboxQueueStats,
  type RevocationDetection,
  type MobileSyncHostOptions,
} from "./host";
export {
  MobileSyncTriggers,
  FakeScheduler,
  globalSyncTimers,
  type BackgroundSchedulerPort,
  type ConnectivitySignal,
  type SyncTimerHandle,
  type SyncTimers,
  type MobileSyncTriggersOptions,
} from "./triggers";
export {
  purgeOnRevocation,
  revocationPurgedTables,
  FIELD_REVOCATION_PURGED_TABLES,
  PERSONAL_REVOCATION_PURGED_TABLES,
  REVOCATION_DELETED_META_KEYS,
  type PurgeReport,
} from "./revocation";
