import { maintainCursorCount, maintainInboxCount, metaDelete } from "@erp/sync-core";

// Direct module import (not the ../store barrel — it drags in
// store/prune → ../index, widening the root-barrel dependency cycle):
// this purge only needs the frozen business-table allowlist + the type.
import { DESKTOP_BUSINESS_TABLES, type DesktopStore } from "../store/sqlite-adapter";

/**
 * PHASE-021 · the D-01 revocation purge (T4; MASTER-PLAN §5 "Revocation/
 * `dataExpiresAt` ⇒ revocation.ts purge (D-01) — the response instruction
 * honored"; SECURITY_AND_DEVICE_MANAGEMENT §4 + §6.2 — the BINDING rule):
 *
 * > "the revocation response and the next blocked sync carry an
 * > instruction the app honors on its next contact: purge local tenant
 * > data (outbox included — its commands are already server-rejected by
 * > policy) and require online re-login." (§6.2)
 *
 * Exact scope implemented here:
 *
 * - **Every business table emptied** — the read caches + local write sets
 *   (`DESKTOP_BUSINESS_TABLES`: items/barcodes/uoms/price_list_items/
 *   partners/tax_codes/pos_sales + the v4 desktop caches sales_invoices/
 *   quotations/delivery_notes/stock_counts + draft_docs). Local tenant
 *   data, all of it (§6.2).
 * - **The outbox emptied** — the explicit §6.2 exception to FAILURE_
 *   RECOVERY §2.4's "outbox is sacred" (the purge IS the audited
 *   incident: the commands were server-rejected by policy, and the
 *   revocation itself is audited server-side — SECURITY §4.1/§8).
 * - **inbox mirrors + cursors emptied** — machinery STRUCTURE kept, the
 *   per-device rows are tenant-linked sync state (the re-enrolled device
 *   re-bootstraps from seq 0 like a fresh store).
 * - **local_events KEPT, payloads SCRUBBED** — the audit trail of
 *   user choices is "kept forever, never pruned" (LOCAL_DATABASE §5.2
 *   exclusion; SECURITY §8's audit posture), but its `payload` column may
 *   embed tenant business data, so the CONTENT is nulled while the audit
 *   facts (kind/choice/reason/trace_id/command_id/at) survive.
 * - **Meta reset (device identity reset)** — `enrolledDeviceId` +
 *   `permissionSnapshotAt` deleted; `queueUnresolvable` deleted (the
 *   queue it described no longer exists — a stale flag would block the
 *   re-enrolled device's drains via `nextBatch`). `contractVersion`
 *   STAYS (the store's compiled-in floor, LOCAL_DATABASE §2 — never the
 *   server's version) alongside `deviceClass`/`rolloutChannel`/
 *   `contractGate`/`quarantined` (each re-evaluated by the next cycle or
 *   owned by the §6.4 corruption drill). The `cursorCount`/`inboxCount`
 *   integrity checksums are recomputed so the next `recoveryPass` sees a
 *   consistent store.
 *
 * The whole purge is ONE transaction (atomic — either fully purged or
 * not at all) and returns an honest per-table count report.
 */

/** Every table emptied by the D-01 purge (identifier-allowlist guarded —
 * the names interpolate into DELETE/SELECT statements). */
export const REVOCATION_PURGED_TABLES: readonly string[] = [
  ...DESKTOP_BUSINESS_TABLES,
  "outbox",
  "inbox",
  "cursors",
];

/** Meta keys deleted by the purge (the device identity reset + the queue
 * state whose subject no longer exists). */
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
  /** Rows deleted per table (business tables + outbox + inbox + cursors).
   * Zero-count tables are still listed — the report is exhaustive. */
  readonly tables: Readonly<Record<string, number>>;
  /** local_events rows KEPT (the audit trail survives, §5.2). */
  readonly localEventsKept: number;
  /** local_events rows whose payload column was scrubbed (tenant data
   * content nulled; audit facts kept). */
  readonly localEventsPayloadsScrubbed: number;
  /** Meta keys that existed and were deleted. */
  readonly metaKeysDeleted: string[];
  /** Every meta key present after the purge (the honest remainder). */
  readonly metaKeysKept: string[];
  /** When the purge ran (ISO). */
  readonly purgedAt: string;
}

/**
 * Execute the D-01 purge against a desktop store. Callers: the shell's
 * revocation handler (wired to `SyncDesktopHost`'s `onRevocation` hook /
 * the `deviceRevoked` cycle outcome / the session rotation-failure hook)
 * — the host STOPPED syncing and marked the queue unresolvable first;
 * this function does the destructive, audited data removal.
 */
export function purgeOnRevocation(store: DesktopStore): PurgeReport {
  for (const table of REVOCATION_PURGED_TABLES) {
    if (!IDENTIFIER_PATTERN.test(table)) {
      throw new Error(`purgeOnRevocation: "${table}" is not a valid table identifier`);
    }
  }

  const purgedAt = new Date().toISOString();
  const tables: Record<string, number> = {};
  let localEventsKept = 0;
  let localEventsPayloadsScrubbed = 0;
  const metaKeysDeleted: string[] = [];

  store.transaction(() => {
    // 1. Local tenant data: every business table + the outbox (§6.2
    //    "outbox included") + the inbox mirrors + the cursors.
    for (const table of REVOCATION_PURGED_TABLES) {
      const rows = store.countRows(table);
      store.run(`DELETE FROM ${table}`);
      tables[table] = rows;
    }

    // 2. local_events: the audit trail SURVIVES (LOCAL_DATABASE §5.2 —
    //    kept forever, never pruned) but the payload CONTENT is tenant
    //    business data → scrubbed to NULL, audit facts kept.
    localEventsKept = store.countRows("local_events");
    const withPayload = store.get("SELECT count(*) AS n FROM local_events WHERE payload IS NOT NULL");
    localEventsPayloadsScrubbed = withPayload === undefined ? 0 : Number(withPayload.n ?? 0);
    if (localEventsPayloadsScrubbed > 0) {
      store.run("UPDATE local_events SET payload = NULL WHERE payload IS NOT NULL");
    }

    // 3. Meta: the device identity reset. Only keys that actually existed
    //    are reported as deleted (honest).
    for (const key of REVOCATION_DELETED_META_KEYS) {
      const existing = store.get("SELECT value FROM meta WHERE key = ?", [key]);
      if (existing !== undefined) {
        metaDelete(store, key);
        metaKeysDeleted.push(key);
      }
    }

    // 4. Integrity checksums recomputed over the emptied tables — the
    //    next recoveryPass must see a consistent store (LOCAL_DATABASE
    //    §6.3), never a quarantine from stale counts.
    maintainCursorCount(store);
    maintainInboxCount(store);
  });

  const metaKeysKept = store.all("SELECT key FROM meta ORDER BY key").map((row) => String(row.key));

  return {
    tables,
    localEventsKept,
    localEventsPayloadsScrubbed,
    metaKeysDeleted,
    metaKeysKept,
    purgedAt,
  };
}
