import { RESUBMITTABLE_BY_REASON, type SyncRejectionReason } from "@erp/contracts";
import { generateUuidV7 } from "@erp/domain-core";

import { LocalStoreCorruptError } from "../errors";
import { RETRY_CAP_MS } from "../retry";
import { assertWritable } from "../watermark";
import {
  WRITE_SET_TABLES,
  isQuarantined,
  maintainInboxCount,
  metaDelete,
  metaGet,
  metaSet,
  type StorageAdapter,
} from "../store/adapter";

/**
 * PHASE-016 · the outbox engine (T9; LOCAL_DATABASE §1.2; IDEMPOTENCY_
 * AND_RETRIES): every local write (a POS sale, a shift event) lands in
 * the outbox in the SAME local transaction as the business row — if the
 * device crashes between them, neither exists (atomic local capture).
 *
 * State machine (state honesty, OFFLINE_ARCHITECTURE §5 — the binding
 * rule: no locally created state is EVER presented as posted):
 *
 *   QUEUED ──drain──▶ IN_FLIGHT ──ACCEPTED──▶ ACKED   (official no recorded)
 *                        │
 *                        ├──REJECTED──▶ REJECTED  (typed reason + user action)
 *                        └──crash─────▶ IN_FLIGHT ─boot─▶ QUEUED (re-drain;
 *                                       the server dedupes by idempotency key
 *                                       + posting-operation key — INV-013)
 *
 * `PENDING_SYNC` is the business-facing view: every pos_sales row whose
 * outbox command is not ACKED renders as pending — the official number
 * appears nowhere until the server assigned it. (SYNC_PROTOCOL §5.2
 * calls the terminal state "SYNCED"; this engine's status literal is
 * `ACKED` — same state, the 016 vocabulary kept for wire compat.)
 *
 * PHASE-020 v2 (MASTER-PLAN §13): enqueue is guarded by `assertWritable`
 * (quarantine → LocalStoreCorruptError; contract gate / stale permission
 * watermark → SyncReadOnlyError — loud C-08/C-15/C-16 failures, never a
 * silent drop). Per-item results carry the v2 extensions: `duplicate:
 * true` replays mark ACKED idempotently, ACCEPTED stamps the official
 * number + entity version into the local write-set row via `markSynced`,
 * REJECTED stores a typed lastError JSON (reason + resubmittable +
 * details), and DEFERRED returns the command to QUEUED with
 * `nextAttemptAt = now + min(retryAfterMs, cap)` WITHOUT counting as an
 * attempt (SYNC_PROTOCOL §3.5 — DEFERRED is not a failure; the command
 * was neither executed nor recorded server-side).
 */

export type OutboxStatus =
  | "QUEUED"
  | "IN_FLIGHT"
  | "ACKED"
  | "REJECTED"
  | "CANCELLED";

export interface OutboxRow {
  commandId: string;
  entityType: string;
  intent: string;
  payload: string;
  idempotencyKey: string;
  baseVersion: number | null;
  clientCreatedAt: string;
  /** Advisory local reference (e.g. the OFF- receipt number, §3.2). */
  localRef: string | null;
  status: OutboxStatus;
  attempts: number;
  /** Retry pacing (unix ms; 0 = due now) — set from DEFERRED retryAfterMs. */
  nextAttemptAt: number;
  lastError: string | null;
  lastAttemptAt: string | null;
  acceptedResult: string | null;
  rejectionReason: string | null;
  rejectionAction: string | null;
  officialNo: string | null;
  ackedAt: string | null;
}

export interface EnqueueInput {
  entityType: string;
  intent: string;
  payload: Record<string, unknown>;
  /** Stable per-command key (the §11 first dedupe layer). */
  idempotencyKey: string;
  baseVersion?: number | null;
  commandId?: string;
  localRef?: string | null;
}

/** Enqueue a command — MUST be called inside the same local transaction
 * as the business row write (the caller's transaction). Throws
 * SyncReadOnlyError (contract gate / stale permission watermark) or
 * LocalStoreCorruptError (quarantined store) BEFORE any write — the
 * caller's transaction rolls back, nothing half-captured (C-16). */
export function enqueue(adapter: StorageAdapter, input: EnqueueInput): OutboxRow {
  assertWritable(adapter);
  const row: OutboxRow = {
    commandId: input.commandId ?? generateUuidV7(),
    entityType: input.entityType,
    intent: input.intent,
    payload: JSON.stringify(input.payload),
    idempotencyKey: input.idempotencyKey,
    baseVersion: input.baseVersion ?? null,
    clientCreatedAt: new Date().toISOString(),
    localRef: input.localRef ?? null,
    status: "QUEUED",
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
    lastAttemptAt: null,
    acceptedResult: null,
    rejectionReason: null,
    rejectionAction: null,
    officialNo: null,
    ackedAt: null,
  };
  adapter.run(
    `INSERT INTO outbox (command_id, entity_type, intent, payload, idempotency_key,
                         base_version, client_created_at, local_ref, status, attempts,
                         next_attempt_at, last_error, last_attempt_at, accepted_result,
                         rejection_reason, rejection_action, official_no, acked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.commandId,
      row.entityType,
      row.intent,
      row.payload,
      row.idempotencyKey,
      row.baseVersion,
      row.clientCreatedAt,
      row.localRef,
      row.status,
      row.attempts,
      row.nextAttemptAt,
      row.lastError,
      row.lastAttemptAt,
      row.acceptedResult,
      row.rejectionReason,
      row.rejectionAction,
      row.officialNo,
      row.ackedAt,
    ],
  );
  return row;
}

/** Crash recovery (SYNC_TESTS C-04): at boot, any IN_FLIGHT row (a crash
 * between the server's journal write and our ack) returns to QUEUED —
 * the replay is safe because the server dedupes; the ledger oracle
 * asserts exactly-once effects. */
export function recoverInFlight(adapter: StorageAdapter): number {
  const rows = adapter.all("SELECT * FROM outbox WHERE status = ?", ["IN_FLIGHT"]);
  for (const row of rows) {
    const commandId = String(row.command_id ?? row.commandId);
    adapter.run("UPDATE outbox SET status = ? WHERE command_id = ?", ["QUEUED", commandId]);
  }
  return rows.length;
}

/** The next drain batch (≤ 50, oldest first — the §3 budget). Only
 * QUEUED rows whose `nextAttemptAt` is due are eligible (DEFERRED
 * pacing), and nothing drains while the queue is marked unresolvable
 * (revoked device — pending reconciliation). */
export function nextBatch(adapter: StorageAdapter, limit = 50, nowMs = Date.now()): OutboxRow[] {
  if (queueUnresolvableReason(adapter) !== null) return [];
  const rows = adapter.all("SELECT * FROM outbox WHERE status = ?", ["QUEUED"]);
  return rows
    .map(fromRow)
    .filter((row) => row.nextAttemptAt <= nowMs)
    .sort(
      (a, b) =>
        // FIFO by creation time; UUIDv7 command ids break same-ms ties in
        // creation order (per-entity ordering survives batching, §6.1).
        a.clientCreatedAt.localeCompare(b.clientCreatedAt) || a.commandId.localeCompare(b.commandId),
    )
    .slice(0, limit);
}

function fromRow(row: Record<string, unknown>): OutboxRow {
  const read = (snake: string): unknown => {
    const value = row[snake];
    return value === undefined ? null : value;
  };
  return {
    commandId: String(read("command_id")),
    entityType: String(read("entity_type")),
    intent: String(row.intent),
    payload: String(row.payload),
    idempotencyKey: String(read("idempotency_key")),
    baseVersion: (() => {
      const value = read("base_version");
      return value === null ? null : Number(value);
    })(),
    clientCreatedAt: String(read("client_created_at")),
    localRef: (() => {
      const value = read("local_ref");
      return value === null ? null : String(value);
    })(),
    status: row.status as OutboxStatus,
    attempts: Number(row.attempts ?? 0),
    nextAttemptAt: (() => {
      const value = read("next_attempt_at");
      return value === null ? 0 : Number(value);
    })(),
    lastError: (() => {
      const value = read("last_error");
      return value === null ? null : String(value);
    })(),
    lastAttemptAt: (() => {
      const value = read("last_attempt_at");
      return value === null ? null : String(value);
    })(),
    acceptedResult: (() => {
      const value = read("accepted_result");
      return value === null ? null : String(value);
    })(),
    rejectionReason: (() => {
      const value = read("rejection_reason");
      return value === null ? null : String(value);
    })(),
    rejectionAction: (() => {
      const value = read("rejection_action");
      return value === null ? null : String(value);
    })(),
    officialNo: (() => {
      const value = read("official_no");
      return value === null ? null : String(value);
    })(),
    ackedAt: (() => {
      const value = read("acked_at");
      return value === null ? null : String(value);
    })(),
  };
}

/** Mark a batch as IN_FLIGHT (inside the caller's transaction — the
 * status flip and the HTTP send are NOT atomic, which is exactly why
 * crash recovery exists). The send counts as an attempt; a later
 * DEFERRED result un-counts it (applyResult). */
export function markInFlight(adapter: StorageAdapter, commandIds: readonly string[]): void {
  const now = new Date().toISOString();
  for (const commandId of commandIds) {
    adapter.run(
      "UPDATE outbox SET status = ?, last_attempt_at = ?, attempts = attempts + 1, next_attempt_at = ? WHERE command_id = ?",
      ["IN_FLIGHT", now, 0, commandId],
    );
  }
}

export interface ApplyResultInput {
  commandId: string;
  status: "ACCEPTED" | "REJECTED" | "DEFERRED";
  officialNo?: string | null;
  acceptedResult?: Record<string, unknown> | null;
  rejectionReason?: string | null;
  rejectionAction?: string | null;
  error?: string | null;
  /** v2 DEFERRED hint (SYNC_PROTOCOL §3.5): nextAttemptAt = now +
   * min(retryAfterMs, RETRY_CAP_MS). */
  retryAfterMs?: number | null;
  /** v2 REJECTED extension: whether the user may fix & resend (stored in
   * the typed lastError JSON). */
  resubmittable?: boolean | null;
  /** v2 REJECTED extension: machine-readable details (currentVersion,
   * constrainedFields, …). */
  rejectionDetails?: Record<string, unknown> | null;
}

/**
 * Apply a per-item push result. ACCEPTED stamps the official number (the
 * ONLY place it enters the local store) + records the inbox-mirror row;
 * REJECTED keeps the typed reason (+ resubmittable/details JSON) for the
 * shift-end reconciliation screen; DEFERRED returns the command to
 * QUEUED (retryable — the server asked us to back off) with
 * nextAttemptAt pacing and WITHOUT counting an attempt.
 */
export function applyResult(adapter: StorageAdapter, input: ApplyResultInput): void {
  if (isQuarantined(adapter)) {
    throw new LocalStoreCorruptError(
      `applyResult refused: store quarantined (command ${input.commandId}) — run the LOCAL_DATABASE §6.4 corruption path`,
    );
  }
  const now = new Date().toISOString();
  if (input.status === "ACCEPTED") {
    adapter.transaction(() => {
      adapter.run(
        `UPDATE outbox SET status = ?, accepted_result = ?, official_no = ?, acked_at = ?,
                           last_error = NULL, rejection_reason = NULL, rejection_action = NULL
         WHERE command_id = ?`,
        [
          "ACKED",
          JSON.stringify(input.acceptedResult ?? {}),
          input.officialNo ?? null,
          now,
          input.commandId,
        ],
      );
      recordInboxMirror(adapter, input.commandId);
    });
  } else if (input.status === "REJECTED") {
    const reason = input.rejectionReason ?? "VALIDATION_ERROR";
    const typed =
      input.resubmittable !== undefined || input.rejectionDetails !== undefined;
    const lastError = typed
      ? JSON.stringify({
          reason,
          resubmittable:
            input.resubmittable ?? RESUBMITTABLE_BY_REASON[reason as SyncRejectionReason] ?? true,
          details: input.rejectionDetails ?? null,
          message: input.error ?? null,
        })
      : (input.error ?? "rejected");
    adapter.transaction(() => {
      adapter.run(
        `UPDATE outbox SET status = ?, rejection_reason = ?, rejection_action = ?, last_error = ?
         WHERE command_id = ?`,
        ["REJECTED", reason, input.rejectionAction ?? "CANCEL_WITH_REASON", lastError, input.commandId],
      );
      recordInboxMirror(adapter, input.commandId);
    });
  } else {
    // DEFERRED: not executed, not recorded server-side (§3.5) — back to
    // QUEUED. The send was un-counted (not a failure) and the retry is
    // paced by retryAfterMs (bounded by the cap); a DEFERRED without a
    // hint is due on the next cycle (016 transport-failure semantics —
    // cycle-level pacing lives in the RetryScheduler).
    const current = adapter.get("SELECT attempts FROM outbox WHERE command_id = ?", [
      input.commandId,
    ]);
    const attempts = Math.max(0, Number(current?.attempts ?? 0) - 1);
    const retryAfterMs =
      typeof input.retryAfterMs === "number" && input.retryAfterMs > 0 ? input.retryAfterMs : null;
    const nextAttemptAt = retryAfterMs === null ? 0 : Date.now() + Math.min(retryAfterMs, RETRY_CAP_MS);
    adapter.run(
      "UPDATE outbox SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ? WHERE command_id = ?",
      ["QUEUED", attempts, nextAttemptAt, input.error ?? "deferred by server", input.commandId],
    );
  }
}

/** The client-side inbox mirror (SYNC_PROTOCOL §4.4): processed
 * commandIds recorded locally — the pushAck source + the integrity
 * checksum input. Idempotent by primary key. */
function recordInboxMirror(adapter: StorageAdapter, commandId: string): void {
  adapter.run("INSERT OR REPLACE INTO inbox (command_id, processed_at) VALUES (?, ?)", [
    commandId,
    Date.now(),
  ]);
  maintainInboxCount(adapter);
}

/** The v2 server-state stamp for an ACCEPTED command (MASTER-PLAN §1.1
 * extensions): the official number, the resulting entity id/version,
 * and any ledger/stock effects. */
export interface ServerStateStamp {
  officialNumber?: string | null;
  entity?: { id: string; version: number } | null;
  effects?: { journalEntryIds?: string[]; stockMoveIds?: string[] } | null;
}

/**
 * Generic ACCEPTED application onto the local business row (the v2
 * markSaleSynced): locates the row via the outbox payload's local
 * pointer (`payload.sale.clientId` — the 016 pos_sale shape) or the
 * server-returned entity id, then stamps the official number / journal
 * effect / authoritative version. Write-set rows only: read caches take
 * authoritative state via pull (stamping a cache row's version here
 * would make the next pull's equal version look stale and skip the real
 * data — CONFLICT_RESOLUTION §4 stays pull-driven for caches).
 */
export function markSynced(
  adapter: StorageAdapter,
  commandId: string,
  serverState: ServerStateStamp,
): void {
  const row = adapter.get("SELECT * FROM outbox WHERE command_id = ?", [commandId]);
  if (row === undefined) return;
  const payload = JSON.parse(String(row.payload ?? "{}")) as {
    sale?: { clientId?: string };
  };
  const now = new Date().toISOString();
  if (payload.sale !== undefined && typeof payload.sale.clientId === "string") {
    // pos_sales write-set row: PENDING_SYNC → SYNCED, official number +
    // journal effect + server version recorded alongside the OFF- ref.
    const existing = adapter.get("SELECT * FROM pos_sales WHERE id = ?", [payload.sale.clientId]);
    if (existing === undefined) return;
    const journalEntryId =
      serverState.effects?.journalEntryIds?.[0] ??
      (existing.journal_entry_id === undefined || existing.journal_entry_id === null
        ? null
        : String(existing.journal_entry_id));
    adapter.run(
      `UPDATE pos_sales SET local_status = 'SYNCED', official_no = ?, journal_entry_id = ?,
          version = ?, synced_at = ? WHERE id = ?`,
      [
        serverState.officialNumber ??
          (existing.official_no === undefined || existing.official_no === null
            ? ""
            : String(existing.official_no)),
        journalEntryId,
        serverState.entity?.version ??
          (existing.version === undefined || existing.version === null
            ? null
            : Number(existing.version)),
        now,
        payload.sale.clientId,
      ],
    );
    return;
  }
  const entityId = serverState.entity?.id;
  if (entityId === undefined) return;
  for (const table of WRITE_SET_TABLES) {
    const target = adapter.get(`SELECT id FROM ${table} WHERE id = ?`, [entityId]);
    if (target === undefined) continue;
    adapter.run(`UPDATE ${table} SET version = ? WHERE id = ?`, [
      serverState.entity?.version ?? null,
      entityId,
    ]);
    return;
  }
  // No local write-set row for the server entity (e.g. a draft created
  // offline whose local mirror table ships with 021) — the outbox row
  // already carries the authoritative result; nothing else to stamp.
}

/** Cancel a rejected command after the user chose CANCEL_WITH_REASON. */
export function cancel(adapter: StorageAdapter, commandId: string): void {
  adapter.run("UPDATE outbox SET status = ? WHERE command_id = ?", ["CANCELLED", commandId]);
}

/** Re-queue a rejected command after the user edited it (EDIT_AND_RESEND). */
export function requeue(
  adapter: StorageAdapter,
  commandId: string,
  payload: Record<string, unknown>,
): void {
  adapter.run(
    "UPDATE outbox SET payload = ?, status = ?, rejection_reason = NULL, rejection_action = NULL WHERE command_id = ?",
    [JSON.stringify(payload), "QUEUED", commandId],
  );
}

/** Mark the whole queue unresolvable (revoked device — C-06): pending
 * rows keep their QUEUED state (the server never decided anything) with
 * the reason stamped on last_error; `nextBatch` refuses to drain until
 * the reconciliation path clears the flag. */
export function markQueueUnresolvable(adapter: StorageAdapter, reason: string): void {
  metaSet(adapter, "queueUnresolvable", reason);
  const rows = adapter.all("SELECT command_id FROM outbox WHERE status = ?", ["QUEUED"]);
  for (const row of rows) {
    adapter.run("UPDATE outbox SET last_error = ? WHERE command_id = ?", [
      `queue unresolvable: ${reason} (pending reconciliation)`,
      String(row.command_id),
    ]);
  }
}

/** The unresolvable-queue reason (null = the queue drains normally). */
export function queueUnresolvableReason(adapter: StorageAdapter): string | null {
  return metaGet(adapter, "queueUnresolvable");
}

/** Clear the unresolvable flag (the reconciliation resolution path —
 * e.g. drafts reassigned to another device — resumes the drain). */
export function clearQueueUnresolvable(adapter: StorageAdapter): void {
  metaDelete(adapter, "queueUnresolvable");
}

/** The user-facing sync state (the offline banner + queue badge). */
export function queueStats(adapter: StorageAdapter): {
  pending: number;
  inFlight: number;
  rejected: number;
  acked: number;
} {
  const rows = adapter.all("SELECT * FROM outbox");
  const stats = { pending: 0, inFlight: 0, rejected: 0, acked: 0 };
  for (const row of rows) {
    if (row.status === "QUEUED") stats.pending += 1;
    else if (row.status === "IN_FLIGHT") stats.inFlight += 1;
    else if (row.status === "REJECTED") stats.rejected += 1;
    else if (row.status === "ACKED") stats.acked += 1;
  }
  return stats;
}

/** Every rejected command with its typed reason (the reconciliation
 * screen listing). */
export function rejectedCommands(adapter: StorageAdapter): OutboxRow[] {
  return adapter.all("SELECT * FROM outbox WHERE status = ?", ["REJECTED"]).map(fromRow);
}
