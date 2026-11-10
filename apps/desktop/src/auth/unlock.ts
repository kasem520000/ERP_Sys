import { metaGet, writePermissionWatermark, type StorageAdapter } from "@erp/sync-core";

/**
 * PHASE-021 · the offline unlock decision (T3/T7; MASTER-PLAN §4.3;
 * SECURITY_AND_DEVICE_MANAGEMENT §5 — offline authorization; the D-04
 * semantics from SYNC_TESTS, now against the desktop store).
 *
 * Offline login = app unlock against the cached permission snapshot: every
 * sync cycle pulls the synthetic `permissions` entity (the device user's
 * CURRENT effective keys in the device tenant); the pull applier records
 * the snapshot's `snapshotAt` into meta (`permissionSnapshotAt` —
 * sync-core's watermark, the D-04 source of truth). Within 7 days of that
 * watermark the unlock grants the FULL UI per the cached key set; beyond it
 * the app degrades to read-only + online-required (the keys might be
 * revoked — the server stays the final authority on every push regardless);
 * with no snapshot at all the store has never pulled, which is the same
 * read-only verdict with the NO_SNAPSHOT reason.
 *
 * Store contract (the part sync-core does NOT persist — decision recorded
 * for the W2 sync host): the permission KEYS ride the snapshot payload but
 * sync-core's applier only writes the watermark. The desktop unlock cache
 * is a local `permissions` table (`key TEXT PRIMARY KEY`), replaced
 * atomically by `applyPermissionSnapshotPayload` whenever a `permissions`
 * UPSERT lands (the payload shape: `{ userId, permissions: string[],
 * snapshotAt, watermarkDays }` — the server's permission-snapshot feed).
 * The table rides the SAME StorageAdapter transaction surface as everything
 * else, so it is exactly as durable as the store around it.
 */

/** D-04: a permission snapshot older than 7 days → read-only unlock (the
 * same value as sync-core's PERMISSION_SNAPSHOT_MAX_AGE_DAYS = 7, in ms). */
export const SNAPSHOT_WATERMARK_MS = 7 * 24 * 60 * 60 * 1000;

/** The unlock verdict. `mode: "full"` carries the cached permission keys
 * (the UI derives its affordances from them — derived, never authoritative:
 * the server re-checks everything on every push); `mode: "readonly"`
 * carries the machine-readable reason for the honest-state banner. */
export type UnlockDecision =
  | { mode: "full"; permissions: string[]; snapshotAt: Date }
  | { mode: "readonly"; reason: "SNAPSHOT_EXPIRED"; snapshotAt: Date }
  | { mode: "readonly"; reason: "NO_SNAPSHOT" };

/** The permissions-feed change payload (the server's permission-snapshot
 * shape: permission-snapshot.ts — chunked ≤ 500 keys per change row, one
 * row carries the whole set today). */
export interface PermissionSnapshotPayload {
  userId?: string;
  permissions?: unknown;
  snapshotAt?: unknown;
  watermarkDays?: number;
}

/** Normalize a `permissionSnapshotAt` value to epoch ms — the mirror of
 * sync-core's watermark normalization (number, numeric string, or ISO
 * 8601); null when absent/unparseable. */
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

/** Read the cached permission keys from the local `permissions` table.
 * Fail-soft on a store without the table (the watermark — not the key list
 * — is the unlock-mode authority; an empty key set yields full mode with
 * no affordances, never a blocked unlock). */
function cachedPermissions(adapter: StorageAdapter): string[] {
  try {
    return adapter
      .all("SELECT key FROM permissions")
      .map((row) => String(row.key))
      .filter((key) => key !== "");
  } catch {
    return [];
  }
}

/**
 * The offline-unlock decision (D-04): read meta `permissionSnapshotAt` +
 * the cached permission rows and decide the mode.
 *
 * - no snapshot (never pulled) → `{ mode: "readonly", reason: "NO_SNAPSHOT" }`;
 * - now − snapshotAt > 7 days → `{ mode: "readonly", reason: "SNAPSHOT_EXPIRED" }`
 *   (strictly greater — exactly 7 days is still full, the sync-core
 *   `ageDays > 7` boundary);
 * - otherwise → `{ mode: "full", permissions, snapshotAt }`.
 */
export function unlockWithSnapshot(
  adapter: StorageAdapter,
  opts?: { now?: Date },
): UnlockDecision {
  const raw = metaGet(adapter, "permissionSnapshotAt");
  const snapshotAtMs = raw === null ? null : normalizeSnapshotAtMs(raw);
  if (snapshotAtMs === null) {
    return { mode: "readonly", reason: "NO_SNAPSHOT" };
  }
  const now = (opts?.now ?? new Date()).getTime();
  if (now - snapshotAtMs > SNAPSHOT_WATERMARK_MS) {
    return { mode: "readonly", reason: "SNAPSHOT_EXPIRED", snapshotAt: new Date(snapshotAtMs) };
  }
  return {
    mode: "full",
    permissions: cachedPermissions(adapter),
    snapshotAt: new Date(snapshotAtMs),
  };
}

/**
 * Replace the cached permission-key rows (the desktop half of the
 * permissions feed: the W2 sync host calls this on every `permissions`
 * UPSERT payload). Atomic: the table is created on demand and the whole
 * key set is swapped in ONE transaction.
 */
export function applyPermissionSnapshotRows(
  adapter: StorageAdapter,
  permissions: readonly string[],
): void {
  const keys = [...new Set(permissions.filter((key) => key !== ""))].sort();
  adapter.transaction(() => {
    adapter.run("CREATE TABLE IF NOT EXISTS permissions (key TEXT PRIMARY KEY)");
    adapter.run("DELETE FROM permissions");
    for (const key of keys) {
      adapter.run("INSERT INTO permissions (key) VALUES (?)", [key]);
    }
  });
}

/**
 * Apply a full permissions-feed change payload: swap the cached key rows
 * AND record the D-04 watermark (sync-core's `writePermissionWatermark`
 * handles the snapshotAt normalization — epoch ms, numeric string, or ISO).
 * Callers that only want the watermark (the 016 compat path) keep using
 * sync-core's helper directly.
 */
export function applyPermissionSnapshotPayload(
  adapter: StorageAdapter,
  payload: PermissionSnapshotPayload,
): void {
  const permissions = Array.isArray(payload.permissions)
    ? payload.permissions.map((key) => String(key))
    : [];
  applyPermissionSnapshotRows(adapter, permissions);
  writePermissionWatermark(adapter, payload.snapshotAt);
}
