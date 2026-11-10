import { maintainCursorCount, maintainInboxCount, metaDelete } from "@erp/sync-core";

// Direct module import (not the ../store barrel): this purge only needs
// the frozen business-table allowlists + the store type (the desktop
// revocation.ts precedent — keep the import surface flat).
import { FIELD_BUSINESS_TABLES, PERSONAL_READ_MODELS, type MobileDeviceClass, type MobileStore } from "../store/store";

/**
 * PHASE-022 · the D-01 revocation purge, ported from the @erp/desktop
 * drill (T2-a; MASTER-PLAN §7 — the binding rule; SECURITY_AND_DEVICE_
 * MANAGEMENT §4 + §6.2):
 *
 * > "the revocation response and the next blocked sync carry an
 * > instruction the app honors on its next contact: purge local tenant
 * > data (outbox included — its commands are already server-rejected by
 * > policy) and require online re-login." (§6.2)
 *
 * Exact scope implemented here, PER PROFILE (the ONE app's TWO stores):
 *
 * - **android-field**: every business table (the POS-subset caches + the
 *   v4 field caches + the pos_sales write set) emptied, the OUTBOX
 *   emptied (the explicit §6.2 exception to FAILURE_RECOVERY §2.4's
 *   "outbox is sacred" — the purge IS the audited incident), the inbox
 *   mirrors + cursors emptied (machinery STRUCTURE kept; the re-enrolled
 *   device re-bootstraps from seq 0 like a fresh store).
 * - **android-personal**: the read models (statements, sales_invoices,
 *   receipts, notifications) + the cursors emptied. There IS no outbox
 *   to purge — the profile never had one (DR-P22-08b; the table lists
 *   below only name tables the profile actually owns; missing tables
 *   report honest zeros, never a throw).
 *
 * Both: meta reset (the device identity reset) — `enrolledDeviceId` +
 * `permissionSnapshotAt` deleted; `queueUnresolvable` deleted on field
 * (the queue it described no longer exists — a stale flag would block
 * the re-enrolled device's drains via `nextBatch`; on personal it never
 * existed). `contractVersion` STAYS (the store's compiled-in floor,
 * LOCAL_DATABASE §2 — never the server's version) alongside
 * `deviceClass`/`storageBudgetBytes`/`contractGate`/`quarantined` (each
 * re-evaluated by the next cycle or owned by the §6.4 corruption drill).
 * The `cursorCount` integrity checksum is recomputed on both profiles
 * (the `inboxCount` checksum only where an inbox exists) so the next
 * recoveryPass sees a consistent store.
 *
 * No local_events handling yet (the mobile parked-rejections audit trail
 * lands with its own migration version in the W3/W4 UX waves — the
 * purge will grow its scrub step then; recorded honestly, not skipped
 * silently).
 *
 * The whole purge is ONE transaction (atomic — either fully purged or
 * not at all) and returns an honest per-table count report.
 */

/** Every table emptied by the D-01 purge for the field profile
 * (identifier-allowlist guarded — the names interpolate into DELETEs). */
export const FIELD_REVOCATION_PURGED_TABLES: readonly string[] = [
  ...FIELD_BUSINESS_TABLES,
  "outbox",
  "inbox",
  "cursors",
];

/** Every table emptied by the D-01 purge for the personal profile (the
 * read models + the cursors; no outbox/inbox exists by construction). */
export const PERSONAL_REVOCATION_PURGED_TABLES: readonly string[] = [
  ...PERSONAL_READ_MODELS,
  "cursors",
];

/** The frozen purged-table list for one device class. */
export function revocationPurgedTables(deviceClass: MobileDeviceClass): readonly string[] {
  return deviceClass === "android-field" ? FIELD_REVOCATION_PURGED_TABLES : PERSONAL_REVOCATION_PURGED_TABLES;
}

/** Meta keys deleted by the purge (the device identity reset + the
 * queue state whose subject no longer exists). */
export const REVOCATION_DELETED_META_KEYS: readonly string[] = [
  "enrolledDeviceId",
  "permissionSnapshotAt",
  "queueUnresolvable",
];

/** A bare SQL identifier (defense-in-depth — the frozen constants above
 * are the primary guard; the store uses the same pattern). */
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The honest D-01 purge report (per-table counts — never a silent wipe). */
export interface PurgeReport {
  /** Rows deleted per table. Tables listed but absent from the profile
   * (never the case today) or already empty report 0 — the report is
   * exhaustive over the profile's list. */
  readonly tables: Readonly<Record<string, number>>;
  /** Meta keys that existed and were deleted. */
  readonly metaKeysDeleted: string[];
  /** Every meta key present after the purge (the honest remainder). */
  readonly metaKeysKept: string[];
  /** When the purge ran (ISO). */
  readonly purgedAt: string;
}

/**
 * Execute the D-01 purge against a mobile store (either profile — the
 * table list derives from `store.deviceClass`). Callers: the shell's
 * revocation handler (wired to `MobileSyncHost`'s `onRevocation` hook /
 * the `deviceRevoked` cycle outcome) — the host STOPPED syncing first;
 * this function does the destructive, audited data removal.
 */
export function purgeOnRevocation(store: MobileStore): PurgeReport {
  const purgedTables = revocationPurgedTables(store.deviceClass);
  for (const table of purgedTables) {
    if (!IDENTIFIER_PATTERN.test(table)) {
      throw new Error(`purgeOnRevocation: "${table}" is not a valid table identifier`);
    }
  }

  const purgedAt = new Date().toISOString();
  const tables: Record<string, number> = {};
  const metaKeysDeleted: string[] = [];

  store.transaction(() => {
    // 1. Local tenant data: the profile's table list (field: business
    //    tables + the outbox §6.2 "outbox included" + the inbox mirrors
    //    + the cursors; personal: the read models + the cursors).
    //    Missing tables (never the case today) skip honestly at 0.
    for (const table of purgedTables) {
      const existing = store.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [table]);
      if (existing === undefined) {
        tables[table] = 0;
        continue;
      }
      const rows = store.countRows(table);
      store.run(`DELETE FROM ${table}`);
      tables[table] = rows;
    }

    // 2. Meta: the device identity reset. Only keys that actually
    //    existed are reported as deleted (honest) — on the personal
    //    profile `queueUnresolvable` never existed (no queue by
    //    construction, DR-P22-08b).
    for (const key of REVOCATION_DELETED_META_KEYS) {
      const row = store.get("SELECT value FROM meta WHERE key = ?", [key]);
      if (row !== undefined) {
        metaDelete(store, key);
        metaKeysDeleted.push(key);
      }
    }

    // 3. Integrity checksums recomputed over the emptied tables — the
    //    next recoveryPass must see a consistent store (LOCAL_DATABASE
    //    §6.3), never a quarantine from stale counts. inboxCount only
    //    where an inbox exists (personal has none).
    maintainCursorCount(store);
    if (store.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'inbox'") !== undefined) {
      maintainInboxCount(store);
    }
  });

  const metaKeysKept = store.all("SELECT key FROM meta ORDER BY key").map((row) => String(row.key));

  return {
    tables,
    metaKeysDeleted,
    metaKeysKept,
    purgedAt,
  };
}
