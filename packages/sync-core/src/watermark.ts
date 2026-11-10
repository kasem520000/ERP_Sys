import { LocalStoreCorruptError, SyncReadOnlyError } from "./errors";
import { isQuarantined, metaGet, type StorageAdapter } from "./store/adapter";

export { SyncReadOnlyError } from "./errors";

/**
 * PHASE-020 · the permission-snapshot watermark (MASTER-PLAN §10 + §13;
 * SYNC_TESTS D-04): every device class pulls the synthetic `permissions`
 * entity each cycle; the pull applier records the snapshot's `snapshotAt`
 * into meta (`permissionSnapshotAt`). When the watermark is older than
 * 7 days the store refuses local writes (SyncReadOnlyError) — the device
 * might be acting on revoked permissions, and the server stays the final
 * authority on every push regardless (re-checks are never skipped).
 *
 * 016 compat: a store that has never pulled a permissions snapshot
 * (snapshotAt = null) is WRITABLE — the 016 terminal has no permissions
 * feed, so an absent watermark is "not tracked", not "stale".
 */

/** D-04: a permission snapshot older than this many days → read-only. */
export const PERMISSION_SNAPSHOT_MAX_AGE_DAYS = 7;

const MS_PER_DAY = 86_400_000;

export interface PermissionWatermarkState {
  /** The last applied permissions snapshot (epoch ms) — null when the
   * device has never pulled one. */
  snapshotAt: number | null;
  /** now − snapshotAt in days (0 when unknown; negative tolerance for
   * clock skew — §7: server time is authoritative, never punitive). */
  ageDays: number;
  /** ageDays > 7 (D-04) — captures must fail with SyncReadOnlyError. */
  readOnly: boolean;
}

/** Read the permission watermark state from meta. */
export function permissionWatermarkState(adapter: StorageAdapter): PermissionWatermarkState {
  const raw = metaGet(adapter, "permissionSnapshotAt");
  if (raw === null) return { snapshotAt: null, readOnly: false, ageDays: 0 };
  const snapshotAt = Number(raw);
  if (!Number.isFinite(snapshotAt) || snapshotAt <= 0) {
    return { snapshotAt: null, readOnly: false, ageDays: 0 };
  }
  const ageDays = (Date.now() - snapshotAt) / MS_PER_DAY;
  return {
    snapshotAt,
    ageDays,
    readOnly: ageDays > PERMISSION_SNAPSHOT_MAX_AGE_DAYS,
  };
}

/**
 * The local-write gate the outbox engine calls before every enqueue
 * (C-15/C-16 loud-failure surface) — throws BEFORE any write so the
 * caller's capture transaction rolls back whole:
 *
 * - quarantined store → LocalStoreCorruptError (§6.4 corruption path);
 * - contract gate tripped (`meta.contractGate = "read-only"`, C-08) or
 *   stale permission watermark (> 7d, D-04) → SyncReadOnlyError.
 *
 * Reads and pulls are NOT gated — a read-only device keeps its caches
 * fresh; only local writes (captures) are refused.
 */
export function assertWritable(adapter: StorageAdapter): void {
  if (isQuarantined(adapter)) {
    throw new LocalStoreCorruptError(
      "local store quarantined (integrity check failed) — writes refused until the LOCAL_DATABASE §6.4 corruption path runs",
    );
  }
  if (metaGet(adapter, "contractGate") === "read-only") {
    throw new SyncReadOnlyError(
      "sync contract gate tripped (contractVersion unsupported) — the store is read-only until the app updates (C-08)",
    );
  }
  const watermark = permissionWatermarkState(adapter);
  if (watermark.readOnly) {
    throw new SyncReadOnlyError(
      `permission snapshot is ${watermark.ageDays.toFixed(1)} days old (> ${PERMISSION_SNAPSHOT_MAX_AGE_DAYS}) — local writes refused until a fresh pull (D-04)`,
    );
  }
}
