/**
 * PHASE-021 · the desktop sync barrel (T4; MASTER-PLAN §2 package layout
 * / §5 sync host mechanics — BINDING): the bridge transport
 * (`SyncTransport` over the shell http member), the thin sync host
 * (SyncDesktopHost over the UNMODIFIED sync-core client + runCycle), the
 * SYNC_PROTOCOL §8 trigger set, and the D-01 revocation purge. Consumed
 * through `@erp/desktop`'s root barrel by the shell (2-c) and the web
 * Offline Console (2-b) state mirrors.
 */

export {
  bridgeTransport,
  DesktopSessionExpiredError,
  DesktopSyncHttpError,
  DesktopSyncResponseError,
  DEVICE_ID_HEADER,
  SYNC_PULL_ACK_PATH,
  SYNC_PULL_PATH,
  SYNC_PUSH_ACK_PATH,
  SYNC_PUSH_PATH,
  SYNC_STATUS_PATH,
  type BridgeTransport,
  type BridgeTransportOptions,
  type DesktopSyncStatus,
  type DesktopSyncStatusDevice,
} from "./transport";
export {
  SyncDesktopHost,
  type HostState,
  type OutboxQueueStats,
  type PushNowResult,
  type RevocationDetection,
  type SyncCycleResult,
  type SyncDesktopHostOptions,
} from "./host";
export {
  SyncTriggers,
  SYNC_CONNECTIVITY_DEBOUNCE_MS,
  SYNC_PERIODIC_INTERVAL_MS,
  globalSyncTimers,
  type SyncTimerHandle,
  type SyncTimers,
  type SyncTriggersOptions,
} from "./triggers";
export {
  purgeOnRevocation,
  REVOCATION_DELETED_META_KEYS,
  REVOCATION_PURGED_TABLES,
  type PurgeReport,
} from "./revocation";
