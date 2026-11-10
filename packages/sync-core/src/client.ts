import {
  POS_FEED_ENTITY_TYPES,
  RESUBMITTABLE_BY_REASON,
  SYNC_CONTRACT_VERSION,
  type PullEnvelope,
  type PushItemResult,
  type PushItemResultV2,
} from "@erp/contracts";

import { metaGet, type StorageAdapter } from "./store/adapter";
import {
  applyPullBatch,
  markSaleRejected,
  markSaleSynced,
  posAppliers,
  readCursor,
} from "./store/pull";
import {
  applyResult,
  markInFlight,
  markSynced,
  nextBatch,
  recoverInFlight,
  type OutboxRow,
} from "./outbox/engine";

/**
 * PHASE-016 · the sync client (T8/T9 consumer side; SYNC_PROTOCOL §2/§3/
 * §8): pulls per entity type until `hasMore` drains, pushes the outbox in
 * ≤ 50-command batches with per-item result application. The transport is
 * injected (the browser terminal: BFF fetch with the device header; the
 * Tauri shell in 021: the same fetch over its HTTP client) — the sync
 * core never owns networking.
 *
 * Sync cadence (§8): periodic every 1 min when the outbox is non-empty +
 * on reconnect triggers; the caller drives both.
 *
 * PHASE-020 v2 (MASTER-PLAN §13): the transport gains OPTIONAL v2
 * methods — `status` (the contract-version gate + revocation check),
 * `pushV2` (contractVersion + v2 per-item results), `pullAck`/`pushAck`
 * (best-effort acks). A 016 transport (pull + push only) keeps compiling
 * and working byte-identically; the v2 full cycle lives in `cycle.ts`
 * (`runCycle`) and `pushAllV2` below.
 */
export interface SyncTransport {
  /** GET the pull envelope for one entity type at a cursor position. */
  pull(entityType: string, cursor: string | null, limit?: number): Promise<PullEnvelope>;
  /** POST a command batch; returns per-item results. */
  push(batchId: string, commands: readonly Record<string, unknown>[]): Promise<PushItemResult[]>;

  // -- v2 (all optional with defaults so the 016 browser transport keeps
  // compiling; runCycle degrades to 016 mode when `status` is absent) ----

  /** GET /sync/status — the contract-version gate input (C-08), the
   * revocation check (C-06) and the authoritative server time (§7). */
  status?(): Promise<{
    serverTime: string;
    contractVersion: string;
    suspended?: boolean;
    device?: { revoked?: boolean };
  }>;
  /** POST /sync/push v2 — the contract version rides the request; results
   * carry the v2 extensions (duplicate/entity/officialNumber/effects/
   * resubmittable). */
  pushV2?(request: {
    contractVersion: string;
    commands: readonly Record<string, unknown>[];
  }): Promise<PushItemResultV2[]>;
  /** POST /sync/pull/ack — the device's final cursor positions (server
   * hint only; correctness never depends on it, §2.8). */
  pullAck?(positions: readonly { entityType: string; cursor: string }[]): Promise<void>;
  /** POST /sync/push/ack — the commandIds that reached a terminal state
   * this cycle (bookkeeping hint, §5.1). */
  pushAck?(commandIds: readonly string[]): Promise<void>;
}

export interface SyncOutcome {
  pulled: Record<string, number>;
  pushed: number;
  accepted: number;
  rejected: number;
  deferred: number;
}

export class SyncClient {
  constructor(
    public readonly adapter: StorageAdapter,
    public readonly transport: SyncTransport,
  ) {}

  /** Boot-time recovery: IN_FLIGHT → QUEUED (C-04 crash resume). */
  recover(): number {
    return recoverInFlight(this.adapter);
  }

  /** Pull every POS feed entity until drained (cursor advance only
   * after each batch's local commit — §2, asserted by the chaos suite). */
  async pullAll(): Promise<Record<string, number>> {
    const pulled: Record<string, number> = {};
    for (const entityType of POS_FEED_ENTITY_TYPES) {
      let total = 0;
      // hasMore loop — bounded by the server's page budgets.
      for (let page = 0; page < 100; page += 1) {
        const cursor = readCursor(this.adapter, entityType);
        const envelope = await this.transport.pull(entityType, cursor);
        const applied = applyPullBatch(
          this.adapter,
          { entityType, cursor: envelope.cursor, changes: envelope.changes },
          posAppliers,
        );
        total += applied;
        if (!envelope.hasMore) break;
      }
      pulled[entityType] = total;
    }
    return pulled;
  }

  /** Drain the outbox: batches of ≤ 50, per-item results applied in the
   * same local transaction batch (C-09 queue drain; C-03 partial-batch
   * failures leave zero residue for the failed command — each item's
   * result application is independent). */
  async pushAll(): Promise<{ pushed: number; accepted: number; rejected: number; deferred: number }> {
    let pushed = 0;
    let accepted = 0;
    let rejected = 0;
    let deferred = 0;
    for (let round = 0; round < 20; round += 1) {
      const batch = nextBatch(this.adapter);
      if (batch.length === 0) break;
      const commands = batch.map((row) => JSON.parse(row.payload) as Record<string, unknown>);
      markInFlight(
        this.adapter,
        batch.map((row) => row.commandId),
      );
      const batchId = `batch:${new Date().toISOString()}:${batch[0]!.commandId}`;
      let results: PushItemResult[];
      try {
        results = await this.transport.push(batchId, commands);
      } catch (error) {
        // Transport failure mid-batch: back to QUEUED (safe replay — the
        // server dedupes; C-01 duplicate push proves zero extra effects).
        for (const row of batch) {
          applyResult(this.adapter, {
            commandId: row.commandId,
            status: "DEFERRED",
            error: `transport: ${String(error)}`,
          });
        }
        break;
      }
      this.applyResults(batch, results);
      pushed += batch.length;
      for (const result of results) {
        if (result.status === "ACCEPTED") accepted += 1;
        else if (result.status === "REJECTED") rejected += 1;
        else deferred += 1;
      }
    }
    return { pushed, accepted, rejected, deferred };
  }

  /** The v2 drain (runCycle step 4): pushes through `pushV2` with the
   * contract version from meta (defaulting to the compiled-in current
   * version), applies the v2 per-item extensions, and returns the
   * commandIds that reached a terminal state (the pushAck payload).
   * `duplicate: true` replays mark ACKED idempotently (C-01/C-04). */
  async pushAllV2(): Promise<{
    pushed: number;
    accepted: number;
    rejected: number;
    deferred: number;
    duplicates: number;
    processedCommandIds: string[];
  }> {
    if (this.transport.pushV2 === undefined) {
      throw new Error("SyncClient.pushAllV2 requires a transport with pushV2()");
    }
    const contractVersion = metaGet(this.adapter, "contractVersion") ?? SYNC_CONTRACT_VERSION;
    let pushed = 0;
    let accepted = 0;
    let rejected = 0;
    let deferred = 0;
    let duplicates = 0;
    const processedCommandIds: string[] = [];
    for (let round = 0; round < 20; round += 1) {
      const batch = nextBatch(this.adapter);
      if (batch.length === 0) break;
      const commands = batch.map((row) => JSON.parse(row.payload) as Record<string, unknown>);
      markInFlight(
        this.adapter,
        batch.map((row) => row.commandId),
      );
      const batchId = `batch:${new Date().toISOString()}:${batch[0]!.commandId}`;
      let results: PushItemResultV2[];
      try {
        results = await this.transport.pushV2({ contractVersion, commands });
      } catch (error) {
        // Transport failure mid-batch: back to QUEUED, due next cycle
        // (cycle-level pacing lives in the RetryScheduler, §8).
        for (const row of batch) {
          applyResult(this.adapter, {
            commandId: row.commandId,
            status: "DEFERRED",
            error: `transport: ${String(error)}`,
          });
        }
        break;
      }
      const applied = this.applyResultsV2(batch, results);
      pushed += batch.length;
      accepted += applied.accepted;
      rejected += applied.rejected;
      deferred += applied.deferred;
      duplicates += applied.duplicates;
      processedCommandIds.push(...applied.processed);
      void batchId;
    }
    return { pushed, accepted, rejected, deferred, duplicates, processedCommandIds };
  }

  /** One full cycle (the reconnect trigger + the periodic tick). */
  async sync(): Promise<SyncOutcome> {
    const pulled = await this.pullAll();
    const push = await this.pushAll();
    return { pulled, ...push };
  }

  private applyResults(batch: readonly OutboxRow[], results: readonly PushItemResult[]): void {
    const byId = new Map(batch.map((row) => [row.commandId, row]));
    for (const result of results) {
      const row = byId.get(result.id);
      if (row === undefined) continue;
      this.adapter.transaction(() => {
        if (result.status === "ACCEPTED") {
          applyResult(this.adapter, {
            commandId: row.commandId,
            status: "ACCEPTED",
            officialNo:
              typeof result.result?.officialNo === "string" ? result.result.officialNo : null,
            acceptedResult: result.result ?? null,
          });
          // Mark the captured sale row SYNCED (official number recorded
          // alongside the OFF- reference — the 1:1 reconciliation pair).
          const payload = JSON.parse(row.payload) as { sale?: { clientId?: string } };
          if (payload.sale?.clientId !== undefined) {
            markSaleSynced(this.adapter, {
              saleId: payload.sale.clientId,
              officialNo:
                typeof result.result?.officialNo === "string" ? result.result.officialNo : "",
              journalEntryId:
                typeof result.result?.journalEntryId === "string"
                  ? result.result.journalEntryId
                  : null,
            });
          }
        } else if (result.status === "REJECTED") {
          applyResult(this.adapter, {
            commandId: row.commandId,
            status: "REJECTED",
            rejectionReason: result.reason,
            rejectionAction: result.action,
            error: result.message,
          });
          const payload = JSON.parse(row.payload) as { sale?: { clientId?: string } };
          if (payload.sale?.clientId !== undefined) {
            markSaleRejected(this.adapter, payload.sale.clientId);
          }
        } else {
          applyResult(this.adapter, {
            commandId: row.commandId,
            status: "DEFERRED",
            error: result.message,
          });
        }
      });
    }
  }

  private applyResultsV2(batch: readonly OutboxRow[], results: readonly PushItemResultV2[]): {
    accepted: number;
    rejected: number;
    deferred: number;
    duplicates: number;
    processed: string[];
  } {
    const byId = new Map(batch.map((row) => [row.commandId, row]));
    let accepted = 0;
    let rejected = 0;
    let deferred = 0;
    let duplicates = 0;
    const processed: string[] = [];
    for (const result of results) {
      const row = byId.get(result.commandId ?? result.id);
      if (row === undefined) continue;
      this.adapter.transaction(() => {
        if (result.status === "ACCEPTED") {
          const officialNumber =
            result.officialNumber ??
            (typeof result.result?.officialNo === "string" ? result.result.officialNo : null);
          applyResult(this.adapter, {
            commandId: row.commandId,
            status: "ACCEPTED",
            officialNo: officialNumber,
            acceptedResult: result as unknown as Record<string, unknown>,
          });
          // Server-state stamp onto the local write-set row: official
          // number + entity version + effects (016 pos_sales payload or
          // the generic v2 entity pointer).
          const journalEntryId =
            typeof result.result?.journalEntryId === "string" ? result.result.journalEntryId : null;
          const effects =
            result.effects ?? (journalEntryId !== null ? { journalEntryIds: [journalEntryId] } : null);
          markSynced(this.adapter, row.commandId, {
            officialNumber,
            entity: result.entity ?? null,
            effects,
          });
          if (result.duplicate === true) duplicates += 1;
          accepted += 1;
          processed.push(row.commandId);
        } else if (result.status === "REJECTED") {
          applyResult(this.adapter, {
            commandId: row.commandId,
            status: "REJECTED",
            rejectionReason: result.reason,
            rejectionAction: result.action,
            error: result.message,
            // Typed lastError JSON (reason + resubmittable + details):
            resubmittable: result.resubmittable ?? RESUBMITTABLE_BY_REASON[result.reason] ?? true,
            rejectionDetails: result.details ?? null,
          });
          const payload = JSON.parse(row.payload) as { sale?: { clientId?: string } };
          if (payload.sale?.clientId !== undefined) {
            markSaleRejected(this.adapter, payload.sale.clientId);
          }
          rejected += 1;
          processed.push(row.commandId);
        } else {
          applyResult(this.adapter, {
            commandId: row.commandId,
            status: "DEFERRED",
            error: result.message,
            retryAfterMs: retryAfterMsOf(result),
          });
          deferred += 1;
        }
      });
    }
    return { accepted, rejected, deferred, duplicates, processed };
  }
}

/** SYNC_PROTOCOL §3.5: DEFERRED items carry `retryAfterMs`. The v2
 * contracts extension type does not declare it, so it is read
 * defensively off the wire object. */
function retryAfterMsOf(result: PushItemResultV2): number | null {
  const raw = (result as { retryAfterMs?: unknown }).retryAfterMs;
  return typeof raw === "number" && raw > 0 ? raw : null;
}
