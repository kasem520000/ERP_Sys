import { recoverInFlight } from "./outbox/engine";
import { maintainCursorCount, metaGet, metaSet, type StorageAdapter } from "./store/adapter";

export { LocalStoreCorruptError } from "./errors";

/**
 * PHASE-020 · the boot-time recovery pass (MASTER-PLAN §13; SYNC_PROTOCOL
 * §9 step 1; LOCAL_DATABASE §6.3 + §6.4): requeue IN_FLIGHT commands
 * (crash between the server's commit and our ack — the replay is safe,
 * the server dedupes) and run the integrity check — the meta-key
 * checksums (`cursorCount`/`inboxCount`, maintained by the store helpers
 * after every committed cursor advance / inbox-mirror record) compared
 * against the real tables. A mismatch quarantines the store + resets the
 * cursors for re-bootstrap (cached read models are disposable; the
 * outbox is precious and never touched).
 *
 * This function NEVER throws — corruption is a loud RESULT (actions +
 * `integrity: "corrupt"`), and the subsequent store operations are the
 * ones that fail loudly with LocalStoreCorruptError.
 */

export interface RecoveryResult {
  /** IN_FLIGHT commands returned to QUEUED (C-04). */
  recoveredInFlight: number;
  /** "ok" | "corrupt" — corrupt means the store is quarantined and the
   * §6.4 corruption path must run (export outbox/inbox → reset DB →
   * re-migrate → re-import → full re-pull). */
  integrity: "ok" | "corrupt";
  /** Human-readable log of everything the pass did (audit + tests). */
  actions: string[];
}

export function recoveryPass(adapter: StorageAdapter): RecoveryResult {
  const actions: string[] = [];
  const recoveredInFlight = recoverInFlight(adapter);
  if (recoveredInFlight > 0) {
    actions.push(`requeued ${recoveredInFlight} IN_FLIGHT command(s) to QUEUED`);
  }

  const cursorMeta = metaGet(adapter, "cursorCount");
  const inboxMeta = metaGet(adapter, "inboxCount");
  const actualCursors = adapter.all("SELECT entity_type FROM cursors").length;
  const actualInbox = adapter.all("SELECT command_id FROM inbox").length;

  const mismatches: string[] = [];
  if (cursorMeta !== null && Number(cursorMeta) !== actualCursors) {
    mismatches.push(`cursorCount mismatch (meta=${cursorMeta}, actual=${actualCursors})`);
  }
  if (inboxMeta !== null && Number(inboxMeta) !== actualInbox) {
    mismatches.push(`inboxCount mismatch (meta=${inboxMeta}, actual=${actualInbox})`);
  }

  if (mismatches.length > 0) {
    // Quarantine: refuse everything until the §6.4 path runs, and reset
    // the cursors so the (rebuilt) store re-bootstraps from seq 0 rather
    // than resuming from possibly-corrupt positions.
    metaSet(adapter, "quarantined", "true");
    adapter.run("DELETE FROM cursors");
    maintainCursorCount(adapter);
    actions.push(...mismatches);
    actions.push("store quarantined (meta quarantined=true) — §6.4 corruption path required");
    actions.push("cursors reset for re-bootstrap (cached read models are disposable)");
    return { recoveredInFlight, integrity: "corrupt", actions };
  }

  // Legacy (016) stores never maintained the checksums: backfill them on
  // the first pass instead of flagging corruption (absent ≠ mismatch).
  if (cursorMeta === null) {
    metaSet(adapter, "cursorCount", String(actualCursors));
    actions.push(`backfilled cursorCount=${actualCursors}`);
  }
  if (inboxMeta === null) {
    metaSet(adapter, "inboxCount", String(actualInbox));
    actions.push(`backfilled inboxCount=${actualInbox}`);
  }
  return { recoveredInFlight, integrity: "ok", actions };
}
