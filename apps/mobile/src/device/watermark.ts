import {
  PERMISSION_SNAPSHOT_MAX_AGE_DAYS,
  metaGet,
  writePermissionWatermark,
  type StorageAdapter,
} from "@erp/sync-core";

/**
 * PHASE-022 · the 7-day permission-snapshot watermark policy (T2-b;
 * MASTER-PLAN §1 DR-P22-09 + §0 golden constants — "Permission
 * snapshot watermark 7 days → read-only + online-required-for-writes";
 * SECURITY_AND_DEVICE_MANAGEMENT §5; SYNC_TESTS D-04) — the
 * `@erp/desktop` `auth/unlock.ts` watermark application ported to the
 * mobile store:
 *
 * - every sync cycle pulls the synthetic `permissions` entity; the
 *   pull applier (2-a's MOBILE_FEED_APPLIERS → sync-core's
 *   `writePermissionWatermark`) records the snapshot's `snapshotAt`
 *   into meta (`permissionSnapshotAt`);
 * - within 7 days of that watermark the app is WRITABLE (the offline
 *   UI rides the cached key set);
 * - beyond it (strictly greater — exactly 7 days is still fresh, the
 *   sync-core `ageDays > 7` boundary) the app degrades to READ-ONLY +
 *   ONLINE-REQUIRED-FOR-WRITES: cached reads are viewable, every
 *   write requires connectivity so authorization is live (§5.3 —
 *   bounds how long a stale-grant UI can mislead when a role was
 *   revoked while offline);
 * - no snapshot at all (never pulled) is the SAME read-only verdict
 *   with the NO_SNAPSHOT reason (the desktop D-04 semantics — the 022
 *   client is always-permissions-fed, unlike sync-core's 016-compat
 *   writable-on-null).
 *
 * THE SNAPSHOT GATES UI ONLY (§5.2, verbatim): "Enforcement is
 * server-final: every pushed command is permission-checked at
 * execution, exactly like online requests." sync-core's own
 * `assertWritable` already refuses local writes at the outbox engine
 * level on a stale watermark; this module is the UI/flow-facing policy
 * view (the degradation states + the as-of label the screens render).
 */

/** D-04: a permission snapshot older than 7 days → read-only (the
 * sync-core PERMISSION_SNAPSHOT_MAX_AGE_DAYS value, in ms — the
 * desktop SNAPSHOT_WATERMARK_MS port). */
export const SNAPSHOT_WATERMARK_MS = PERMISSION_SNAPSHOT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

/** The watermark state (the desktop unlockWithSnapshot verdict,
 * mobile-shaped: the mode + the honest as-of label for the UI). */
export interface PermissionWatermarkState {
  /** "fresh" inside the 7-day window; "stale" beyond it (or with no
   * snapshot at all). */
  readonly mode: "fresh" | "stale";
  /** "SNAPSHOT_EXPIRED" beyond the window; "NO_SNAPSHOT" when the
   * store never pulled a permissions snapshot; null when fresh. */
  readonly reason: "SNAPSHOT_EXPIRED" | "NO_SNAPSHOT" | null;
  /** The last applied snapshot (null when none). */
  readonly snapshotAt: Date | null;
  /** The AS-OF label the UI renders (ISO date of the snapshot; null
   * when none) — "cached as of <label>", stale is labeled, never
   * guessed (the companion's honest-state convention). */
  readonly asOf: string | null;
}

/** Normalize a `permissionSnapshotAt` value to epoch ms — the mirror
 * of sync-core's watermark normalization (number, numeric string, or
 * ISO 8601); null when absent/unparseable. */
function normalizeSnapshotAtMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    if (/^\d+$/.test(value)) {
      const asNumber = Number(value);
      return Number.isFinite(asNumber) && asNumber > 0 ? asNumber : null;
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/**
 * Read the permission watermark from the store's meta and decide the
 * mode (the desktop unlockWithSnapshot decision, with the injectable
 * clock the desktop carried):
 *
 * - no snapshot (never pulled) → stale / NO_SNAPSHOT;
 * - now − snapshotAt > 7 days → stale / SNAPSHOT_EXPIRED (strictly
 *   greater — exactly 7 days is still fresh);
 * - otherwise → fresh (the UI derives affordances from the cached key
 *   set — derived, never authoritative; the server re-checks every
 *   push, §5.2).
 */
export function permissionWatermarkState(
  adapter: StorageAdapter,
  opts?: { now?: Date },
): PermissionWatermarkState {
  const raw = metaGet(adapter, "permissionSnapshotAt");
  const snapshotAtMs = raw === null ? null : normalizeSnapshotAtMs(raw);
  if (snapshotAtMs === null) {
    return { mode: "stale", reason: "NO_SNAPSHOT", snapshotAt: null, asOf: null };
  }
  const now = (opts?.now ?? new Date()).getTime();
  const snapshotAt = new Date(snapshotAtMs);
  if (now - snapshotAtMs > SNAPSHOT_WATERMARK_MS) {
    return {
      mode: "stale",
      reason: "SNAPSHOT_EXPIRED",
      snapshotAt,
      asOf: snapshotAt.toISOString(),
    };
  }
  return { mode: "fresh", reason: null, snapshotAt, asOf: snapshotAt.toISOString() };
}

/** The offline write-policy verdict (the D-04 degradation, §5.3). */
export interface OfflineWritePolicy {
  /** "writable" inside the window; "read-only" beyond it. */
  readonly mode: "writable" | "read-only";
  /** Local write caching (the outbox queue) is allowed — false in
   * read-only mode (writes are NEVER queued on a stale snapshot). */
  readonly localWriteCaching: boolean;
  /** Every write requires live connectivity (server-side
   * authorization is live) — the read-only mode's rule. */
  readonly onlineRequiredForWrites: boolean;
  readonly reason: "FRESH" | "SNAPSHOT_EXPIRED" | "NO_SNAPSHOT";
  /** The as-of label for the UI's honest-state banner (null when no
   * snapshot). */
  readonly asOf: string | null;
}

/**
 * The writePolicy gate: fresh → writable (offline capture + queueing
 * fully available); stale → read-only + online-required-for-writes
 * (§5.3: cached reads viewable, every write needs connectivity so
 * authorization is live — a write WITH connectivity is allowed through
 * the live path, see {@link canWriteOffline}). The gate binds the UI
 * and the flow state machines (2-e); sync-core's `assertWritable`
 * remains the engine-level backstop — the snapshot gates UI only,
 * server enforcement is final (§5.2).
 */
export function offlineWritePolicy(state: PermissionWatermarkState): OfflineWritePolicy {
  if (state.mode === "fresh") {
    return {
      mode: "writable",
      localWriteCaching: true,
      onlineRequiredForWrites: false,
      reason: "FRESH",
      asOf: state.asOf,
    };
  }
  return {
    mode: "read-only",
    localWriteCaching: false,
    onlineRequiredForWrites: true,
    reason: state.reason ?? "SNAPSHOT_EXPIRED",
    asOf: state.asOf,
  };
}

/**
 * Whether a write may proceed under the policy at the given
 * connectivity: writable → always (queued offline); read-only → only
 * with LIVE connectivity (the online-required-for-writes rule — the
 * write goes straight to the server, never the queue).
 */
export function canWriteOffline(policy: OfflineWritePolicy, online: boolean): boolean {
  if (!policy.onlineRequiredForWrites) return true;
  return online;
}

export { writePermissionWatermark };
