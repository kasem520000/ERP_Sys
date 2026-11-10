/**
 * PHASE-016 · the chaos-slice test harness (T13; SYNC_TESTS §1 + §7): a
 * seeded-RNG simulator with a fault-injecting transport and an in-memory
 * device store — the deterministic substrate the C-01/03/04/07/09/16
 * scenarios run against. Server-side effects are observed through the
 * injected `ServerProbe` (the harness never re-implements server logic —
 * it replays what the server contract says happened).
 */

import type { PullEnvelope, PushItemResult, PushItemResultV2 } from "@erp/contracts";
import { SYNC_CONTRACT_VERSION, isContractSupported } from "@erp/contracts";

import { SyncClient, type SyncTransport } from "../client";
import { applyMigrations, memoryAdapter, type StorageAdapter } from "../store/adapter";

/** Deterministic RNG (mulberry32) — every scenario is replayable from
 * its seed (SYNC_TESTS §9 Sev-1 requirement). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The observed server-side effects (the ledger oracle input). */
export interface ServerProbe {
  /** Executed commands, in execution order — the exactly-once oracle
   * asserts one ledger effect per unique idempotencyKey. */
  executed: { commandId: string; idempotencyKey: string; at: number }[];
  /** The per-key results the server returned (replays must return the
   * ORIGINAL result — C-01). */
  resultsByKey: Map<string, PushItemResult>;
}

export type FaultMode =
  | { kind: "none" }
  | { kind: "dropConnection" } // transport throws mid-batch (C-04/C-09)
  | { kind: "duplicateDelivery" } // the batch is delivered twice (C-01)
  | { kind: "rejectSome"; fraction: number; reason: string } // C-09 typed rejects
  | { kind: "clockSkew"; skewMs: number } // C-07 (server-authoritative dates)
  | { kind: "storageFullAtCapture" }; // C-16 loud failure

/**
 * A fake server honoring the §11 dedupe contract: every idempotencyKey
 * executes exactly once; replays return the original result.
 */
export class FakeServer {
  readonly probe: ServerProbe = { executed: [], resultsByKey: new Map() };
  private clock = 1_700_000_000_000;

  constructor(rng: () => number = seededRandom(1)) {
    // The RNG is part of the harness signature for replayability; the
    // deterministic rejection targeting below hashes the OFF- number
    // instead (simpler to assert), so the seed is reserved for future
    // interleaving scenarios.
    void rng;
  }

  tick(): number {
    this.clock += 1;
    return this.clock;
  }

  push(batchId: string, commands: readonly Record<string, unknown>[]): PushItemResult[] {
    const results: PushItemResult[] = [];
    for (const raw of commands) {
      const id = String(raw.id ?? "");
      const key = String(raw.idempotencyKey ?? "");
      const original = this.probe.resultsByKey.get(key);
      if (original !== undefined) {
        // Replay: the original result verbatim, zero new effects (C-01).
        results.push(original);
        continue;
      }
      const rejection = this.shouldReject(raw);
      if (rejection !== null) {
        const result: PushItemResult = {
          id,
          status: "REJECTED",
          idempotencyKey: key,
          reason: rejection as PushItemResult extends { reason: infer R } ? R : never,
          message: `server decision: ${rejection}`,
          action: rejection === "PRICE_CHANGED" ? "ACCEPT_SERVER_PRICE" : "CANCEL_WITH_REASON",
        };
        this.probe.executed.push({ commandId: id, idempotencyKey: key, at: this.tick() });
        this.probe.resultsByKey.set(key, result);
        results.push(result);
        continue;
      }
      const result: PushItemResult = {
        id,
        status: "ACCEPTED",
        idempotencyKey: key,
        result: {
          officialNo: `POS-T1-2611-${String(this.probe.executed.length + 1).padStart(5, "0")}`,
          invoiceId: id,
          journalEntryId: `je-${key}`,
          replay: false,
        },
      };
      this.probe.executed.push({ commandId: id, idempotencyKey: key, at: this.tick() });
      this.probe.resultsByKey.set(key, result);
      results.push(result);
    }
    void batchId;
    return results;
  }

  private rejectionPolicy: { targets: readonly string[]; reason: string } | null = null;

  /** Deterministic typed rejections: the listed OFF- numbers are rejected
   * (C-03's single failure; C-09's two of twenty) — every other command
   * accepts. Replays of a rejected command return the original rejection. */
  setRejectionTargets(targets: readonly string[], reason: string): void {
    this.rejectionPolicy = { targets, reason };
  }

  clearRejectionTargets(): void {
    this.rejectionPolicy = null;
  }

  private shouldReject(raw: Record<string, unknown>): string | null {
    if (raw.type !== "pos_sale" || this.rejectionPolicy === null) return null;
    const sale = raw.sale as { offlineReceiptNo?: string } | undefined;
    if (sale?.offlineReceiptNo !== undefined && this.rejectionPolicy.targets.includes(sale.offlineReceiptNo)) {
      return this.rejectionPolicy.reason;
    }
    return null;
  }
}

/** The fault-injecting transport: wraps a device's push path with the
 * SYNC_TESTS §1 fault modes. */
export class FaultTransport implements SyncTransport {
  constructor(
    private readonly server: FakeServer,
    private mode: FaultMode = { kind: "none" },
  ) {}

  setMode(mode: FaultMode): void {
    this.mode = mode;
  }

  async pull(entityType: string, cursor: string | null): Promise<PullEnvelope> {
    if (this.mode.kind === "dropConnection") {
      throw new Error("simulated connection drop");
    }
    return {
      entityType,
      cursor: cursor ?? "cursor-1",
      hasMore: false,
      changes: [],
    };
  }

  async push(batchId: string, commands: readonly Record<string, unknown>[]): Promise<PushItemResult[]> {
    switch (this.mode.kind) {
      case "dropConnection":
        throw new Error("simulated connection drop mid-batch");
      case "duplicateDelivery": {
        // The server sees the batch TWICE (network retry) — it must
        // execute once and replay the original results (C-01).
        this.server.push(batchId, commands);
        return this.server.push(batchId, commands);
      }
      default:
        return this.server.push(batchId, commands);
    }
  }
}

/** A device: local store + sync client wired through a fault transport. */
export function makeDevice(
  server: FakeServer,
  seed: number = 42,
): {
  adapter: StorageAdapter;
  client: SyncClient;
  transport: FaultTransport;
} {
  void seed; // devices hash their own OFF- numbers deterministically
  const adapter = memoryAdapter();
  applyMigrations(adapter);
  const transport = new FaultTransport(server);
  return { adapter, client: new SyncClient(adapter, transport), transport };
}

// -- PHASE-020 v2 harness (MASTER-PLAN §13/§14) ---------------------------------------
//
// The v2 fake server + transport the W2/W3 cycle tests and the chaos
// matrix drive: a scripted per-entity change log (hasMore pagination,
// per-change versions, tombstones, the C-12 resync directive), a status
// endpoint with a configurable contract version + revocation flag, a
// push engine with inbox-replay semantics (duplicate: true, C-01) and
// DEFERRED rate-limit injection (retryAfterMs), and ack recorders. The
// 016 FakeServer/FaultTransport above stay untouched.

/** One scripted feed change (the wire change shape minus the envelope). */
export interface ScriptedChange {
  id: string;
  seq: number;
  op: "UPSERT" | "DELETE";
  payload: Record<string, unknown> | null;
  /** Server row version (null on DELETE entries). */
  version?: number | null;
  changedAt?: string;
}

/** The configurable /sync/status response. */
export interface FakeSyncStatus {
  serverTime?: string;
  contractVersion?: string;
  suspended?: boolean;
  revoked?: boolean;
}

/** The v2 fake server: change logs + status + push replay + acks. */
export class FakeSyncServerV2 {
  /** Every pull call (entityType, cursor) — the C-05/C-12 assertions. */
  readonly pullCalls: { entityType: string; cursor: string | null }[] = [];
  /** Every v2 push call (the C-08 "no push attempted" assertion). */
  readonly pushCalls: { contractVersion: string; commands: readonly Record<string, unknown>[] }[] = [];
  /** Every legacy push call. */
  readonly legacyPushCalls: { batchId: string; commands: readonly Record<string, unknown>[] }[] = [];
  /** Recorded pullAck positions. */
  readonly pullAcks: { entityType: string; cursor: string }[] = [];
  /** Recorded pushAck commandIds. */
  readonly pushAcks: string[][] = [];
  /** Executed commands (exactly-once oracle — replays never re-execute). */
  readonly executed: { commandId: string; idempotencyKey: string }[] = [];

  readonly status: FakeSyncStatus = { contractVersion: SYNC_CONTRACT_VERSION };
  /** Page size served per pull (default 2 → forces hasMore pagination). */
  pageSize = 2;

  private readonly logs = new Map<string, ScriptedChange[]>();
  private readonly resyncEntities = new Set<string>();
  private readonly deferPolicy = new Map<string, number>();
  private readonly resultsByCommand = new Map<string, PushItemResultV2>();

  /** Script an entity's feed (applied in seq order; pulled by cursor). */
  seedEntity(entityType: string, changes: readonly ScriptedChange[]): void {
    this.logs.set(
      entityType,
      [...changes].sort((a, b) => a.seq - b.seq),
    );
  }

  /** Make the NEXT pull for this entity return the C-12 resync directive
   * (fresh 0-cursor, no changes) — one-shot. */
  setResync(entityType: string): void {
    this.resyncEntities.add(entityType);
  }

  /** Make one commandId DEFERRED with retryAfterMs (rate limit — NOT
   * executed, NOT recorded; retried by the client per the hint). */
  setDefer(commandId: string, retryAfterMs: number): void {
    this.deferPolicy.set(commandId, retryAfterMs);
  }

  setStatus(status: FakeSyncStatus): void {
    this.status.serverTime = status.serverTime;
    this.status.contractVersion = status.contractVersion ?? SYNC_CONTRACT_VERSION;
    this.status.suspended = status.suspended;
    this.status.revoked = status.revoked;
  }

  /** GET /sync/pull — cursor is "seq-of-last-change" ("0"/null = bootstrap). */
  pull(entityType: string, cursor: string | null, limit?: number): PullEnvelope {
    this.pullCalls.push({ entityType, cursor });
    const contractVersion = this.status.contractVersion ?? SYNC_CONTRACT_VERSION;
    if (this.resyncEntities.delete(entityType)) {
      // C-12: cursor newer than head → the bounded-restart directive.
      return {
        entityType,
        cursor: "0",
        hasMore: true,
        changes: [],
        serverTime: this.status.serverTime ?? "2026-11-04T00:00:00Z",
        contractVersion,
        resync: true,
      };
    }
    const after = cursor === null ? 0 : Number(cursor);
    const page = this.logs.get(entityType) ?? [];
    const startIndex = page.findIndex((change) => change.seq > after);
    const from = startIndex === -1 ? page.length : startIndex;
    const size = limit ?? this.pageSize;
    const slice = page.slice(from, from + size);
    const lastSeq = slice.length > 0 ? slice[slice.length - 1]!.seq : after;
    return {
      entityType,
      cursor: String(lastSeq),
      nextCursor: String(lastSeq),
      hasMore: from + slice.length < page.length,
      changes: slice.map((change) => ({
        id: change.id,
        seq: change.seq,
        op: change.op,
        payload: change.payload,
        changedAt: change.changedAt ?? "2026-11-04T00:00:00Z",
        version: change.version ?? null,
      })),
      serverTime: this.status.serverTime ?? "2026-11-04T00:00:00Z",
      contractVersion,
    };
  }

  /** POST /sync/push v2 — inbox replay + per-item results. */
  pushV2(request: { contractVersion: string; commands: readonly Record<string, unknown>[] }): PushItemResultV2[] {
    this.pushCalls.push({ contractVersion: request.contractVersion, commands: request.commands });
    return request.commands.map((raw) => this.decide(raw, request.contractVersion));
  }

  /** The per-command decision engine shared by both push shapes (the
   * legacy adapter must NOT record a v2 pushCall). */
  private decide(raw: Record<string, unknown>, contractVersion: string): PushItemResultV2 {
    const commandId = typeof raw.commandId === "string" ? raw.commandId : String(raw.id ?? "");
    const idempotencyKey = String(raw.idempotencyKey ?? commandId);
    const replay = this.resultsByCommand.get(commandId);
    if (replay !== undefined) {
      // Inbox replay: the original result verbatim + duplicate flag,
      // zero new effects (C-01/C-04).
      return { ...replay, duplicate: true };
    }
    if (this.status.revoked === true) {
      return {
        id: commandId,
        commandId,
        status: "REJECTED",
        idempotencyKey,
        reason: "DEVICE_REVOKED",
        message: "device revoked",
        action: "CANCEL_WITH_REASON",
        resubmittable: false,
      };
    }
    if (contractVersion !== "" && !isContractSupported(contractVersion)) {
      return {
        id: commandId,
        commandId,
        status: "REJECTED",
        idempotencyKey,
        reason: "CONTRACT_VERSION_UNSUPPORTED",
        message: `contract ${contractVersion} unsupported`,
        action: "CANCEL_WITH_REASON",
        resubmittable: false,
      };
    }
    const deferred = this.deferPolicy.get(commandId);
    if (deferred !== undefined) {
      // DEFERRED: NOT executed, NOT recorded (SYNC_PROTOCOL §3.5).
      return {
        id: commandId,
        commandId,
        status: "DEFERRED",
        idempotencyKey,
        reason: "RATE_LIMITED",
        message: "rate limited",
        // The v2 result extension type does not declare retryAfterMs;
        // the wire carries it (§3.5) and sync-core reads defensively.
        ...({ retryAfterMs: deferred } as Record<string, unknown>),
      };
    }
    const sequence = this.executed.length + 1;
    const result: PushItemResultV2 = {
      id: commandId,
      commandId,
      status: "ACCEPTED",
      idempotencyKey,
      result: {
        officialNo: `POS-T1-2611-${String(sequence).padStart(5, "0")}`,
        invoiceId: commandId,
        journalEntryId: `je-${idempotencyKey}`,
        replay: false,
      },
      officialNumber: `POS-T1-2611-${String(sequence).padStart(5, "0")}`,
      entity: { id: entityIdOf(raw, commandId), version: sequence },
      effects: { journalEntryIds: [`je-${idempotencyKey}`] },
    };
    this.executed.push({ commandId, idempotencyKey });
    this.resultsByCommand.set(commandId, result);
    return result;
  }

  /** The 016 legacy push shape over the same decision engine (byte-
   * compatible results — the v2 extensions are stripped). */
  legacyPush(batchId: string, commands: readonly Record<string, unknown>[]): PushItemResult[] {
    this.legacyPushCalls.push({ batchId, commands });
    const v2 = commands.map((raw) => this.decide(raw, this.status.contractVersion ?? SYNC_CONTRACT_VERSION));
    return v2.map((result) => {
      if (result.status === "ACCEPTED") {
        return {
          id: result.id,
          status: "ACCEPTED" as const,
          idempotencyKey: result.idempotencyKey,
          result: result.result,
        };
      }
      if (result.status === "REJECTED") {
        return {
          id: result.id,
          status: "REJECTED" as const,
          idempotencyKey: result.idempotencyKey,
          reason: result.reason as PushItemResult extends { reason: infer R } ? R : never,
          message: result.message,
          action: result.action,
        };
      }
      return {
        id: result.id,
        status: "DEFERRED" as const,
        idempotencyKey: result.idempotencyKey,
        reason: result.reason,
        message: result.message,
      };
    });
  }
}

/** The server entity id a command's result reports (payload partnerId /
 * invoiceId when present, else the commandId). */
function entityIdOf(raw: Record<string, unknown>, commandId: string): string {
  const payload = raw.payload;
  if (payload !== null && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    for (const key of ["partnerId", "invoiceId", "clientId", "id"]) {
      if (typeof record[key] === "string") return String(record[key]);
    }
  }
  return commandId;
}

/** The v2 transport: pull/push/status/pushV2/pullAck/pushAck over a
 * FakeSyncServerV2 (the in-process harness adapter shape — the chaos
 * matrix drives the REAL SyncClient through this). */
export class V2Transport implements SyncTransport {
  constructor(private readonly server: FakeSyncServerV2) {}

  async pull(entityType: string, cursor: string | null, limit?: number): Promise<PullEnvelope> {
    return this.server.pull(entityType, cursor, limit);
  }

  async push(batchId: string, commands: readonly Record<string, unknown>[]): Promise<PushItemResult[]> {
    return this.server.legacyPush(batchId, commands);
  }

  async status(): Promise<{
    serverTime: string;
    contractVersion: string;
    suspended?: boolean;
    device?: { revoked?: boolean };
  }> {
    return {
      serverTime: this.server.status.serverTime ?? "2026-11-04T00:00:00Z",
      contractVersion: this.server.status.contractVersion ?? SYNC_CONTRACT_VERSION,
      ...(this.server.status.suspended === undefined ? {} : { suspended: this.server.status.suspended }),
      device: { revoked: this.server.status.revoked === true },
    };
  }

  async pushV2(request: {
    contractVersion: string;
    commands: readonly Record<string, unknown>[];
  }): Promise<PushItemResultV2[]> {
    return this.server.pushV2(request);
  }

  async pullAck(positions: readonly { entityType: string; cursor: string }[]): Promise<void> {
    this.server.pullAcks.push(...positions.map((position) => ({ ...position })));
  }

  async pushAck(commandIds: readonly string[]): Promise<void> {
    this.server.pushAcks.push([...commandIds]);
  }
}
