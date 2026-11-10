import {
  FEED_GROUPS,
  PERMISSIONS_ENTITY_TYPE,
  POS_FEED_ENTITY_TYPES,
  isContractSupported,
} from "@erp/contracts";

import type { SyncClient } from "./client";
import { markQueueUnresolvable } from "./outbox/engine";
import { recoveryPass } from "./recovery";
import { metaGet, metaSet } from "./store/adapter";
import { applyPullBatch, posAppliers, readCursor, resetCursor } from "./store/pull";

/**
 * PHASE-020 · the full sync cycle (MASTER-PLAN §13; SYNC_PROTOCOL §9):
 *
 *   1. recovery pass — IN_FLIGHT → QUEUED + integrity check (§6.3);
 *   2. status — the contract-version gate (unsupported → `meta:
 *      contractGate = "read-only"`, STOP — no business pull, no push, no
 *      fabrications, C-08) and the revocation check (device.revoked →
 *      deviceRevoked + the queue marked unresolvable, no push, C-06);
 *   3. pull — the `permissions` snapshot entity FIRST (watermark update,
 *      MASTER-PLAN §10), then every feed entity for the device class
 *      until drained (hasMore loop), honoring `resync: true` (C-12
 *      bounded restart: reset the cursor to the directive's fresh
 *      position and re-pull from there);
 *   4. push — the outbox in FIFO batches ≤ 50 (engine nextBatch), v2
 *      transport when available (contractVersion from meta), else the
 *      legacy 016 push;
 *   5. best-effort acks — pullAck with the final cursor positions,
 *      pushAck with the commandIds that reached a terminal state.
 *
 * A transport without `status()` runs in 016 mode: no gate, no
 * permissions pull (the 016 wire has no permissions feed), the POS feed
 * group only, legacy push, no acks. A v2 transport whose `status()` call
 * fails proceeds defensively — every data path is still protected (each
 * pull envelope is contract-gated; every push item is rejected
 * CONTRACT_VERSION_UNSUPPORTED server-side when the version is wrong).
 */

export interface CycleOutcome {
  /** Changes applied across all pull entities this cycle. */
  pulled: number;
  pushed: number;
  accepted: number;
  rejected: number;
  deferred: number;
  /** ACCEPTED results that were inbox replays (duplicate: true, C-01). */
  duplicates: number;
  /** The contract gate tripped (C-08) — the store is read-only now. */
  readOnly: boolean;
  /** The device is revoked (C-06) — the queue is unresolvable. */
  deviceRevoked: boolean;
  durationMs: number;
}

export type CycleEvent =
  | { type: "recovery"; recoveredInFlight: number; integrity: "ok" | "corrupt"; actions: readonly string[] }
  | { type: "status"; serverTime: string; contractVersion: string }
  | { type: "statusError"; message: string }
  | { type: "contractGate"; contractVersion: string }
  | { type: "contractGateCleared" }
  | { type: "deviceRevoked" }
  | { type: "pullPage"; entityType: string; applied: number; hasMore: boolean }
  | { type: "pullError"; entityType: string; message: string }
  | { type: "resync"; entityType: string; cursor: string }
  | { type: "pushError"; message: string }
  | { type: "ack"; pullAcked: number; pushAcked: number };

export interface CycleOptions {
  /** Structured observability for every cycle step (the chaos matrix
   * logs its seed + these events). */
  onEvent?: (event: CycleEvent) => void;
  /** Page-size hint passed to transport.pull (the server caps anyway). */
  pullLimit?: number;
}

/** The pull scope per device class (FEED_GROUPS; LOCAL_DATABASE §1.1). */
export function feedEntitiesForDeviceClass(deviceClass: string): readonly string[] {
  switch (deviceClass) {
    case "tauri-desktop":
      return FEED_GROUPS.desktop;
    case "android-field":
      return FEED_GROUPS.field;
    case "android-personal":
      return FEED_GROUPS.personal;
    case "pos-terminal":
    default:
      return FEED_GROUPS.pos;
  }
}

/** Bounded loops: a hostile/broken server can never wedge a cycle. */
const MAX_PAGES_PER_ENTITY = 100;
const MAX_RESYNC_PER_ENTITY = 3;

export async function runCycle(client: SyncClient, opts?: CycleOptions): Promise<CycleOutcome> {
  const startedAt = Date.now();
  const outcome: CycleOutcome = {
    pulled: 0,
    pushed: 0,
    accepted: 0,
    rejected: 0,
    deferred: 0,
    duplicates: 0,
    readOnly: false,
    deviceRevoked: false,
    durationMs: 0,
  };
  const emit = (event: CycleEvent): void => {
    opts?.onEvent?.(event);
  };
  const finish = (): CycleOutcome => {
    outcome.durationMs = Date.now() - startedAt;
    return outcome;
  };
  const adapter = client.adapter;
  const transport = client.transport;

  // §9 step 1 — recovery pass.
  const recovery = recoveryPass(adapter);
  emit({
    type: "recovery",
    recoveredInFlight: recovery.recoveredInFlight,
    integrity: recovery.integrity,
    actions: recovery.actions,
  });
  if (recovery.integrity === "corrupt") {
    // Quarantined: the §6.4 corruption path must run before anything
    // else — no pull, no push this cycle (loud result, not a throw).
    return finish();
  }

  // §9 step 2 — status + contract gate (016 transports skip it entirely).
  // (Bind the method: the gate call must not depend on `this` transport.)
  const statusFn = transport.status?.bind(transport);
  const v2 = statusFn !== undefined;
  if (v2) {
    try {
      const status = await statusFn();
      emit({ type: "status", serverTime: status.serverTime, contractVersion: status.contractVersion });
      if (!isContractSupported(status.contractVersion)) {
        metaSet(adapter, "contractGate", "read-only");
        outcome.readOnly = true;
        emit({ type: "contractGate", contractVersion: status.contractVersion });
        return finish(); // C-08: STOP — no business data, no push
      }
      if (metaGet(adapter, "contractGate") === "read-only") {
        // The app updated + the server is supported again: resume writes.
        metaSet(adapter, "contractGate", "ok");
        emit({ type: "contractGateCleared" });
      }
      if (status.device?.revoked === true) {
        outcome.deviceRevoked = true;
        markQueueUnresolvable(adapter, "DEVICE_REVOKED");
        emit({ type: "deviceRevoked" });
        // No push this cycle (the queue is unresolvable pending
        // reconciliation); pulls are still attempted — the server's
        // DEVICE_REVOKED errors surface per pull.
      }
    } catch (error) {
      emit({ type: "statusError", message: String(error) });
    }
  }

  // §9 step 3 — pull: permissions first (v2 only — the 016 wire has no
  // permissions feed), then the device class's feed group.
  const deviceClass = metaGet(adapter, "deviceClass") ?? "pos-terminal";
  const entities: readonly string[] = v2
    ? [PERMISSIONS_ENTITY_TYPE, ...feedEntitiesForDeviceClass(deviceClass)]
    : POS_FEED_ENTITY_TYPES;
  const ackPositions: { entityType: string; cursor: string }[] = [];
  for (const entityType of entities) {
    let resyncs = 0;
    try {
      for (let page = 0; page < MAX_PAGES_PER_ENTITY; page += 1) {
        const cursor = readCursor(adapter, entityType);
        const envelope = await transport.pull(entityType, cursor, opts?.pullLimit);
        // Per-envelope gate: an unsupported contract in the envelope is
        // the same C-08 stop as an unsupported status.
        if (envelope.contractVersion !== undefined && !isContractSupported(envelope.contractVersion)) {
          metaSet(adapter, "contractGate", "read-only");
          outcome.readOnly = true;
          emit({ type: "contractGate", contractVersion: envelope.contractVersion });
          return finish();
        }
        if (envelope.resync === true) {
          // C-12 bounded restart: adopt the directive's fresh cursor and
          // re-pull from there (the loop's next iteration).
          resyncs += 1;
          resetCursor(adapter, entityType, envelope.cursor);
          emit({ type: "resync", entityType, cursor: envelope.cursor });
          if (resyncs >= MAX_RESYNC_PER_ENTITY) break;
          continue;
        }
        const applied = applyPullBatch(
          adapter,
          { entityType, cursor: envelope.nextCursor ?? envelope.cursor, changes: envelope.changes },
          posAppliers,
        );
        outcome.pulled += applied;
        emit({ type: "pullPage", entityType, applied, hasMore: envelope.hasMore });
        if (!envelope.hasMore) break;
      }
      const finalCursor = readCursor(adapter, entityType);
      if (finalCursor !== null) ackPositions.push({ entityType, cursor: finalCursor });
    } catch (error) {
      // One entity's failure never blocks the others — the persisted
      // cursor resumes exactly where the last commit landed (§2.7).
      emit({ type: "pullError", entityType, message: String(error) });
    }
  }

  // §9 step 4 — push the outbox (FIFO ≤ 50 batches via the engine).
  let processedCommandIds: readonly string[] = [];
  if (!outcome.deviceRevoked && !outcome.readOnly) {
    if (typeof transport.pushV2 === "function") {
      const push = await client.pushAllV2();
      outcome.pushed = push.pushed;
      outcome.accepted = push.accepted;
      outcome.rejected = push.rejected;
      outcome.deferred = push.deferred;
      outcome.duplicates = push.duplicates;
      processedCommandIds = push.processedCommandIds;
    } else {
      const push = await client.pushAll();
      outcome.pushed = push.pushed;
      outcome.accepted = push.accepted;
      outcome.rejected = push.rejected;
      outcome.deferred = push.deferred;
    }
  }

  // §9 step 5 — best-effort acks (correctness never depends on them).
  let pullAcked = 0;
  let pushAcked = 0;
  if (ackPositions.length > 0 && typeof transport.pullAck === "function") {
    try {
      await transport.pullAck(ackPositions);
      pullAcked = ackPositions.length;
    } catch {
      // best-effort — the local cursor is authoritative (§2.8)
    }
  }
  if (processedCommandIds.length > 0 && typeof transport.pushAck === "function") {
    try {
      await transport.pushAck(processedCommandIds);
      pushAcked = processedCommandIds.length;
    } catch {
      // best-effort — dedupe covers the un-acked case (§5.1)
    }
  }
  if (pullAcked > 0 || pushAcked > 0) {
    emit({ type: "ack", pullAcked, pushAcked });
  }
  return finish();
}
