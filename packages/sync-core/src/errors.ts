/**
 * PHASE-020 · the sync-core typed failure surface (MASTER-PLAN §13;
 * LOCAL_DATABASE §2.3 + §6.4; SYNC_TESTS C-08/C-15/C-16): local store
 * problems are LOUD — typed errors thrown at the exact call site, never
 * silent drops. Both errors are re-exported from the modules that throw
 * them (`recovery.ts` → LocalStoreCorruptError, `watermark.ts` →
 * SyncReadOnlyError) and from the package index.
 */

/**
 * The store refuses local WRITES: either the contract gate tripped
 * (C-08 — the server's contractVersion is unsupported, `meta.contractGate
 * = "read-only"`) or the permission snapshot watermark is stale (D-04 —
 * `now − permissionSnapshotAt > 7d`). Reads and pulls continue; captures
 * fail loudly so the UI can present the honest state.
 */
export class SyncReadOnlyError extends Error {
  readonly code = "SYNC_READ_ONLY" as const;

  constructor(message: string) {
    super(message);
    this.name = "SyncReadOnlyError";
  }
}

/**
 * The local store is quarantined after an integrity-check failure
 * (LOCAL_DATABASE §6.4): every store operation refuses until the app runs
 * the corruption path (export outbox/inbox where readable → reset DB →
 * re-run migrations → re-import → full re-pull). Cached read models are
 * disposable; pending operations are precious and never silently dropped.
 */
export class LocalStoreCorruptError extends Error {
  readonly code = "LOCAL_STORE_CORRUPT" as const;

  constructor(message: string) {
    super(message);
    this.name = "LocalStoreCorruptError";
  }
}
