import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SYNC_CONTRACT_VERSION, type PullEnvelope, type PushItemResult, type PushItemResultV2 } from "@erp/contracts";
import {
  assertWritable,
  buildSyncCommandV2,
  enqueue,
  FakeSyncServerV2,
  metaGet,
  metaSet,
  queueUnresolvableReason,
  readCursor,
  recoveryPass,
  SyncReadOnlyError,
  V2Transport,
  type SyncTransport,
} from "@erp/sync-core";

import { DesktopSession } from "../src/auth";
import { openDesktopStore, type DesktopStore } from "../src/store";
import {
  DesktopSessionExpiredError,
  DesktopSyncHttpError,
  purgeOnRevocation,
  SyncDesktopHost,
  type HostState,
  type RevocationDetection,
  type SyncDesktopHostOptions,
} from "../src/sync";

/**
 * PHASE-021 · the sync host suite (T4; MASTER-PLAN §5 — BINDING; SYNC_
 * PROTOCOL §8/§9; LOCAL_DATABASE §6.3/§6.4; SECURITY_AND_DEVICE_MANAGE-
 * MENT §4/§6.2): REAL SQLite temp stores + REAL sync-core cycle engine —
 * only the TRANSPORT is scripted (sync-core's own FakeSyncServerV2 +
 * V2Transport, wrapped in a counting proxy for call-count assertions).
 * The mandated matrix: boot happy path, C-08 contract gate, D-01
 * revocation, the one-in-flight mutex, the post-write fast push against
 * a real outbox, the session-expired fail-closed path, and the
 * DR-P21-03 post-cycle prune hook.
 */

const DEVICE_ID = "21212121-1111-4111-8111-111111111111";
const PARTNER_ID = "21212121-2222-4222-8222-222222222222";

// -- harness -----------------------------------------------------------------------

/** A counting proxy over any transport — the mutex/no-push assertions.
 * Optional members stay optional (a 016-style inner keeps running 016 —
 * the host must see the REAL capability surface, not an inflated one). */
class CountingTransport implements SyncTransport {
  readonly counts = {
    status: 0,
    pull: 0,
    pushV2: 0,
    push: 0,
    pullAck: 0,
    pushAck: 0,
  };

  constructor(private readonly inner: SyncTransport) {
    if (inner.status !== undefined) {
      this.status = async () => {
        this.counts.status += 1;
        return inner.status!();
      };
    }
    if (inner.pushV2 !== undefined) {
      this.pushV2 = async (request: {
        contractVersion: string;
        commands: readonly Record<string, unknown>[];
      }) => {
        this.counts.pushV2 += 1;
        return inner.pushV2!(request);
      };
    }
    if (inner.pullAck !== undefined) {
      this.pullAck = async (positions: readonly { entityType: string; cursor: string }[]) => {
        this.counts.pullAck += 1;
        return inner.pullAck!(positions);
      };
    }
    if (inner.pushAck !== undefined) {
      this.pushAck = async (commandIds: readonly string[]) => {
        this.counts.pushAck += 1;
        return inner.pushAck!(commandIds);
      };
    }
  }

  async pull(entityType: string, cursor: string | null, limit?: number): Promise<PullEnvelope> {
    this.counts.pull += 1;
    return this.inner.pull(entityType, cursor, limit);
  }

  async push(batchId: string, commands: readonly Record<string, unknown>[]): Promise<PushItemResult[]> {
    this.counts.push += 1;
    return this.inner.push(batchId, commands);
  }

  declare readonly status?: () => Promise<{
    serverTime: string;
    contractVersion: string;
    suspended?: boolean;
    device?: { revoked?: boolean };
  }>;
  declare readonly pushV2?: (request: {
    contractVersion: string;
    commands: readonly Record<string, unknown>[];
  }) => Promise<PushItemResultV2[]>;
  declare readonly pullAck?: (positions: readonly { entityType: string; cursor: string }[]) => Promise<void>;
  declare readonly pushAck?: (commandIds: readonly string[]) => Promise<void>;
}

/** A session with a working refresh rotation, primed 14 min out (no
 * exchange needed during a test cycle). */
function makeSession(): DesktopSession {
  let refreshToken = "refresh-secret-0123456789abcdef0123456789";
  const session = new DesktopSession({
    getRefreshToken: () => Promise.resolve(refreshToken),
    refresh: async (presented: string) => {
      if (presented !== refreshToken) throw new Error("stale refresh token presented (reuse)");
      refreshToken = `refresh-rotated-${Date.now()}`;
      return {
        accessToken: `access-${Date.now()}`,
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        refreshTokenExpiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      };
    },
  });
  session.prime("access-primed-token", new Date(Date.now() + 14 * 60_000).toISOString());
  return session;
}

const workDirs: string[] = [];
const openStores: DesktopStore[] = [];

afterAll(() => {
  for (const store of openStores) store.close();
  for (const dir of workDirs) rmSync(dir, { recursive: true, force: true });
});

interface Harness {
  readonly store: DesktopStore;
  readonly server: FakeSyncServerV2;
  readonly transport: CountingTransport;
  readonly host: SyncDesktopHost;
  readonly states: HostState[];
  readonly revocations: RevocationDetection[];
  readonly prompts: string[];
}

function makeHarness(options?: {
  session?: DesktopSession;
  transport?: SyncTransport;
  hostOptions?: Partial<SyncDesktopHostOptions>;
}): Harness {
  const dir = mkdtempSync(join(tmpdir(), "erp-desktop-synchost-"));
  workDirs.push(dir);
  const store = openDesktopStore({ path: join(dir, "store.sqlite") });
  openStores.push(store);
  const server = new FakeSyncServerV2();
  const states: HostState[] = [];
  const revocations: RevocationDetection[] = [];
  const prompts: string[] = [];
  const transport = new CountingTransport(options?.transport ?? new V2Transport(server));
  const host = new SyncDesktopHost({
    store,
    transport,
    session: options?.session ?? makeSession(),
    deviceId: DEVICE_ID,
    onState: (state) => states.push(state),
    onRevocation: (detection) => revocations.push(detection),
    onUpdatePrompt: (reason) => prompts.push(reason),
    ...options?.hostOptions,
  });
  return { store, server, transport, host, states, revocations, prompts };
}

// -- seed helpers -------------------------------------------------------------------

function seedItems(server: FakeSyncServerV2, count: number): void {
  server.seedEntity(
    "items",
    Array.from({ length: count }, (_, index) => ({
      id: `item-${index + 1}`,
      seq: index + 1,
      op: "UPSERT" as const,
      payload: {
        id: `item-${index + 1}`,
        sku: `SKU-${index + 1}`,
        name: `Item ${index + 1}`,
        kind: "STOCK",
        status: "ACTIVE",
        changedAt: "2026-11-04T00:00:00Z",
      },
      version: 1,
    })),
  );
}

function seedPartners(server: FakeSyncServerV2, count: number): void {
  server.seedEntity(
    "partners",
    Array.from({ length: count }, (_, index) => ({
      id: `partner-${index + 1}`,
      seq: index + 1,
      op: "UPSERT" as const,
      payload: {
        id: `partner-${index + 1}`,
        code: `P-${index + 1}`,
        name: `Partner ${index + 1}`,
        kind: "CUSTOMER",
        status: "ACTIVE",
        changedAt: "2026-11-04T00:00:00Z",
      },
      version: 1,
    })),
  );
}

function seedPermissionSnapshot(server: FakeSyncServerV2): void {
  server.seedEntity("permissions", [
    {
      id: "21212121-0000-4000-8000-000000002101:page:0",
      seq: 1,
      op: "UPSERT" as const,
      payload: {
        userId: "21212121-0000-4000-8000-000000002101",
        permissions: ["pos.sales.sell"],
        snapshotAt: Date.now(),
        watermarkDays: 7,
      },
      version: 1,
    },
  ]);
}

/** A real v2 local write (the ReferenceDevice.capture pattern): the full
 * sync-core-built command envelope enqueued through the engine. */
function enqueuePartnerContactMerge(store: DesktopStore, suffix: string): string {
  const command = buildSyncCommandV2({
    entityType: "partner",
    intent: "contact_merge",
    payload: { partnerId: PARTNER_ID, phone: `+9733000${suffix}` },
    idempotencyKey: `partner:contact_merge:${suffix}`,
    localRef: `partner-edit-${suffix}`,
  });
  store.transaction(() => {
    enqueue(store, {
      entityType: command.entityType,
      intent: command.intent,
      payload: command as unknown as Record<string, unknown>,
      idempotencyKey: command.idempotencyKey,
      commandId: command.commandId,
      localRef: command.localRef ?? null,
    });
  });
  return command.commandId;
}

// -- 1. boot + full cycle happy path --------------------------------------------------

describe("SyncDesktopHost — boot + full cycle (MASTER-PLAN §5, SYNC_PROTOCOL §9)", () => {
  it("runs the full cycle: outcome counts, cursor advances, meta contractVersion, idle→syncing→idle", async () => {
    const harness = makeHarness();
    const { store, server, transport, host, states } = harness;
    seedPermissionSnapshot(server);
    seedItems(server, 3);
    seedPartners(server, 2);
    const commandId = enqueuePartnerContactMerge(store, "happy");

    expect(host.state.phase).toBe("idle"); // pre-boot mirror
    const result = await host.boot();

    // Outcome counts: 1 permissions snapshot + 3 items + 2 partners pulled;
    // 1 queued v2 command pushed + accepted; no rejects/defers/duplicates.
    expect(result.skipped).toBeUndefined();
    expect(result.outcome).toBeDefined();
    expect(result.outcome!.pulled).toBe(6);
    expect(result.outcome!.pushed).toBe(1);
    expect(result.outcome!.accepted).toBe(1);
    expect(result.outcome!.rejected).toBe(0);
    expect(result.outcome!.deferred).toBe(0);
    expect(result.outcome!.duplicates).toBe(0);
    expect(result.outcome!.readOnly).toBe(false);
    expect(result.outcome!.deviceRevoked).toBe(false);

    // Cursors advanced (persisted per entity — §2.7).
    expect(readCursor(store, "items")).toBe("3");
    expect(readCursor(store, "partners")).toBe("2");
    expect(readCursor(store, "permissions")).toBe("1");
    expect(readCursor(store, "sales_invoices")).toBe("0"); // desktop feed entity, empty page

    // meta.contractVersion set — the v5 seed = the compiled-in floor
    // (LOCAL_DATABASE §2; the store's floor, never the server's version).
    expect(metaGet(store, "contractVersion")).toBe(SYNC_CONTRACT_VERSION);
    // The permission-snapshot watermark landed (D-04).
    expect(Number(metaGet(store, "permissionSnapshotAt") ?? "0")).toBeGreaterThan(0);

    // The outbox drained through the REAL engine; official number stamped.
    expect(host.queueDepth()).toBe(0);
    const row = store.get("SELECT * FROM outbox WHERE command_id = ?", [commandId]);
    expect(row?.status).toBe("ACKED");
    expect(String(row?.official_no ?? "")).not.toBe("");
    expect(row?.accepted_result).not.toBeNull();
    expect(row?.acked_at).not.toBeNull();

    // The v2 wire carried the meta contract version.
    expect(server.pushCalls).toHaveLength(1);
    expect(server.pushCalls[0]!.contractVersion).toBe(SYNC_CONTRACT_VERSION);

    // Best-effort acks delivered (§5.1/§2.8).
    expect(transport.counts.pullAck).toBe(1);
    expect(transport.counts.pushAck).toBe(1);
    expect(server.pushAcks[0]).toEqual([commandId]);
    expect(server.pullAcks.length).toBeGreaterThanOrEqual(3);

    // HostState mirror: idle → syncing → idle, timestamps + writability.
    expect(host.state.phase).toBe("idle");
    expect(states.map((state) => state.phase)).toEqual(["syncing", "idle"]);
    expect(host.state.lastSyncAt).toBeDefined();
    expect(host.state.lastOutcome?.pulled).toBe(6);
    expect(host.canWrite()).toBe(true);
    expect(host.lastPrune?.freedBytes).toBe(0); // default budget — no-op pass
  });
});

// -- 2. C-08 contract gate --------------------------------------------------------------

describe("SyncDesktopHost — C-08 contract-version gate (read-only + update prompt)", () => {
  it("unsupported server version stops the cycle read-only; a fixed server clears the gate", async () => {
    const harness = makeHarness();
    const { store, server, transport, host, prompts, states } = harness;
    server.setStatus({ contractVersion: "1999-01-01.0" });

    const gated = await host.boot();
    expect(gated.outcome!.readOnly).toBe(true);
    expect(gated.outcome!.pushed).toBe(0);
    expect(gated.outcome!.pulled).toBe(0);
    expect(host.state.phase).toBe("read-only");
    expect(host.state.readOnlyReason).toBe("CONTRACT_VERSION_UNSUPPORTED");
    expect(host.readOnlyReason).toBe("CONTRACT_VERSION_UNSUPPORTED");
    expect(prompts).toEqual(["CONTRACT_VERSION_UNSUPPORTED"]); // fired ONCE
    expect(host.canWrite()).toBe(false);
    // NO push attempted (C-08) — and no business pull either.
    expect(transport.counts.pushV2).toBe(0);
    expect(transport.counts.push).toBe(0);
    expect(transport.counts.pull).toBe(0);
    expect(server.pushCalls).toHaveLength(0);
    // The store-level gate tripped — sync-core's assertWritable refuses.
    expect(metaGet(store, "contractGate")).toBe("read-only");
    expect(() => assertWritable(store)).toThrow(SyncReadOnlyError);
    // The fast push is refused while gated.
    expect((await host.pushNow()).skipped).toBe("read-only");
    expect(states.map((state) => state.phase)).toEqual(["syncing", "read-only"]);

    // Server fixed → the next syncNow re-checks, clears the gate, resumes.
    server.setStatus({ contractVersion: SYNC_CONTRACT_VERSION });
    const recovered = await host.syncNow();
    expect(recovered.skipped).toBeUndefined();
    expect(recovered.outcome!.readOnly).toBe(false);
    expect(host.state.phase).toBe("idle");
    expect(host.state.readOnlyReason).toBeUndefined();
    expect(host.canWrite()).toBe(true);
    expect(metaGet(store, "contractGate")).toBe("ok");
    expect(() => assertWritable(store)).not.toThrow();
    expect(transport.counts.pull).toBeGreaterThan(0); // pulls resumed
    expect(prompts).toEqual(["CONTRACT_VERSION_UNSUPPORTED"]); // NOT re-fired
  });
});

// -- 3. D-01 revocation ------------------------------------------------------------------

describe("SyncDesktopHost — D-01 revocation (SECURITY_AND_DEVICE_MANAGEMENT §4 + §6.2)", () => {
  it("status.device.revoked → phase revoked + queue unresolvable, then the purge empties the store", async () => {
    const harness = makeHarness();
    const { store, server, host, revocations } = harness;
    seedPermissionSnapshot(server);
    seedItems(server, 2);
    const commandId = enqueuePartnerContactMerge(store, "revoked"); // stays QUEUED

    server.setStatus({ revoked: true });
    const result = await host.syncNow();

    expect(result.outcome!.deviceRevoked).toBe(true);
    expect(result.outcome!.pushed).toBe(0); // no push on a revoked device
    expect(host.state.phase).toBe("revoked");
    expect(host.canWrite()).toBe(false);
    expect(revocations).toHaveLength(1);
    expect(revocations[0]!.source).toBe("status");

    // The queue was marked unresolvable — exactly what runCycle does
    // (cycle.ts markQueueUnresolvable): QUEUED rows keep their state with
    // the reason stamped on last_error, nextBatch refuses to drain.
    expect(queueUnresolvableReason(store)).toBe("DEVICE_REVOKED");
    const row = store.get("SELECT * FROM outbox WHERE command_id = ?", [commandId]);
    expect(String(row?.last_error ?? "")).toContain("queue unresolvable");
    expect(row?.status).toBe("QUEUED");

    // STOP syncing: every later call skips until re-enrollment.
    expect((await host.syncNow()).skipped).toBe("revoked");

    // Then the D-01 purge (the shell's step — onRevocation → purgeOnRevocation):
    // business tables + outbox + cursors emptied, honest counts.
    const purged = purgeOnRevocation(store);
    host.recordRevocationPurge(purged);
    expect(purged.tables["items"]).toBe(2);
    expect(purged.tables["outbox"]).toBe(1);
    expect(store.countRows("items")).toBe(0);
    expect(store.countRows("outbox")).toBe(0);
    expect(readCursor(store, "items")).toBeNull();
    expect(host.lastPurge).toBe(purged);
    // The store stays recovery-consistent after the purge.
    expect(recoveryPass(store).integrity).toBe("ok");
    // ...and the terminal phase survives the purge (re-enroll required).
    expect(host.state.phase).toBe("revoked");
    expect((await host.syncNow()).skipped).toBe("revoked");
  });

  it("the session rotation-failure hook (reuse detection) runs the same D-01 path", async () => {
    const harness = makeHarness();
    const { store, host, revocations } = harness;

    // NO_CREDENTIAL is NOT a revocation (never enrolled / already purged):
    // the session-expired path owns that state.
    host.handleRotationFailure({ kind: "NO_CREDENTIAL", error: null, requiresReEnrollment: true });
    expect(host.state.phase).toBe("idle");
    expect(queueUnresolvableReason(store)).toBeNull();
    expect(revocations).toHaveLength(0);

    // ROTATION_FAILED (the M-05 reuse signal) → STOP + unresolvable + revoked.
    host.handleRotationFailure({
      kind: "ROTATION_FAILED",
      error: new Error("DEVICE_REFRESH_INVALID"),
      requiresReEnrollment: true,
    });
    expect(host.state.phase).toBe("revoked");
    expect(queueUnresolvableReason(store)).toBe("DEVICE_REVOKED");
    expect(revocations).toHaveLength(1);
    expect(revocations[0]!.source).toBe("rotation-failure");
    expect((await host.syncNow()).skipped).toBe("revoked");
    expect((await host.pushNow()).skipped).toBe("revoked");
  });

  it("an expired status.device.dataExpiresAt (§6.2 remote data-expiry) triggers the D-01 path", async () => {
    // The real server BLOCKS the sync of an expired device (§6.2 "the
    // next blocked sync") — the scripted transport mirrors that: status
    // reports the expired watermark, pushes fail.
    const server = new FakeSyncServerV2();
    server.setStatus({ serverTime: "2026-11-04T12:00:00Z" });
    const inner = new V2Transport(server);
    const expired: { value: boolean } = { value: false };
    const transport: SyncTransport = {
      pull: (entityType, cursor, limit) => inner.pull(entityType, cursor, limit),
      push: (batchId, commands) => inner.push(batchId, commands),
      async status(): Promise<{
        serverTime: string;
        contractVersion: string;
        suspended?: boolean;
        device?: { revoked?: boolean; dataExpiresAt?: string | null };
      }> {
        return {
          serverTime: "2026-11-04T12:00:00Z",
          contractVersion: SYNC_CONTRACT_VERSION,
          device: { revoked: false, dataExpiresAt: expired.value ? "2026-11-01T00:00:00Z" : "2027-01-01T00:00:00Z" },
        };
      },
      pushV2: async (request) => {
        if (expired.value) throw new Error("DEVICE_REVOKED: device data expired (blocked sync)");
        return inner.pushV2(request);
      },
      pullAck: (positions) => inner.pullAck(positions),
      pushAck: (commandIds) => inner.pushAck(commandIds),
    };
    const harness = makeHarness({ transport });
    const { store, host, revocations } = harness;
    enqueuePartnerContactMerge(store, "expiry");

    // Future expiry: normal cycle, command drains.
    const healthy = await host.syncNow();
    expect(healthy.outcome!.pushed).toBe(1);
    expect(host.state.phase).toBe("idle");
    expect(revocations).toHaveLength(0);

    // Past expiry (server time is authoritative, §7): D-01.
    expired.value = true;
    enqueuePartnerContactMerge(store, "expiry2");
    const blocked = await host.syncNow();
    expect(blocked.outcome!.deviceRevoked).toBe(false); // runCycle never saw revoked
    expect(blocked.outcome!.pushed).toBe(0); // the blocked push never landed
    expect(host.state.phase).toBe("revoked");
    expect(queueUnresolvableReason(store)).toBe("DEVICE_REVOKED");
    expect(revocations).toHaveLength(1);
    expect(revocations[0]!.source).toBe("data-expiry");
    expect(host.canWrite()).toBe(false);
  });
});

// -- 4. the one-in-flight mutex -----------------------------------------------------------

describe("SyncDesktopHost — one-in-flight mutex (SYNC_PROTOCOL §8)", () => {
  it("two concurrent syncNow calls run exactly ONE cycle; the second returns skipped", async () => {
    const harness = makeHarness();
    const { server, transport, host } = harness;
    seedItems(server, 3);

    const first = host.syncNow();
    const second = host.syncNow();
    const secondResult = await second;
    expect(secondResult.skipped).toBe("already-running");
    expect(secondResult.outcome).toBeUndefined();

    const firstResult = await first;
    expect(firstResult.skipped).toBeUndefined();
    expect(firstResult.outcome!.pulled).toBe(3);

    // Exactly one cycle ran: one status call, one pull round, one ack.
    expect(transport.counts.status).toBe(1);
    // permissions + the 9-entity desktop feed group; items (3 changes,
    // page size 2) takes 2 pages → 11 pull calls total.
    expect(transport.counts.pull).toBe(11);
    expect(transport.counts.pullAck).toBe(1);

    // After completion the mutex releases — a third call runs a fresh cycle.
    const third = await host.syncNow();
    expect(third.outcome).toBeDefined();
    expect(transport.counts.status).toBe(2);
  });
});

// -- 5. session-expired (fail-closed, never anonymous) -------------------------------------

describe("SyncDesktopHost — session-expired (fail-closed; SECURITY_AND_DEVICE_MANAGEMENT §3)", () => {
  it("no credential ⇒ boot/syncNow reject with DesktopSessionExpiredError, phase error, ZERO requests", async () => {
    const session = new DesktopSession({
      getRefreshToken: () => Promise.resolve(null), // never enrolled / purged
      refresh: async () => {
        throw new Error("no credential to exchange");
      },
    });
    const harness = makeHarness({ session });
    const { transport, host } = harness;

    await expect(host.boot()).rejects.toBeInstanceOf(DesktopSessionExpiredError);
    expect(host.state.phase).toBe("error");
    expect(host.state.lastError ?? "").toContain("session-expired");

    // No anonymous request fired — nothing left the process.
    expect(transport.counts.status).toBe(0);
    expect(transport.counts.pull).toBe(0);
    expect(transport.counts.push).toBe(0);
    expect(transport.counts.pushV2).toBe(0);
    expect(transport.counts.pullAck).toBe(0);
    expect(transport.counts.pushAck).toBe(0);

    await expect(host.syncNow()).rejects.toBeInstanceOf(DesktopSessionExpiredError);
    expect(transport.counts.pull).toBe(0);
  });

  it("an HTTP 401 mid-cycle phases as session-expired (the host's 401 mapping)", async () => {
    const server = new FakeSyncServerV2();
    const inner = new V2Transport(server);
    const transport: SyncTransport = {
      pull: (entityType, cursor, limit) => inner.pull(entityType, cursor, limit),
      push: (batchId, commands) => inner.push(batchId, commands),
      async status() {
        throw new DesktopSyncHttpError(
          "GET /api/v1/sync/status failed: HTTP 401",
          401,
          '{"error":{"code":"UNAUTHENTICATED"}}',
          "https://api.erp.example/api/v1/sync/status",
        );
      },
      pushV2: (request) => inner.pushV2(request),
      pullAck: (positions) => inner.pullAck(positions),
      pushAck: (commandIds) => inner.pushAck(commandIds),
    };
    const harness = makeHarness({ transport });
    const { host } = harness;
    const result = await host.syncNow();
    expect(result.outcome).toBeDefined(); // the cycle completed (pulls served)
    expect(host.state.phase).toBe("error");
    expect(host.state.lastError ?? "").toContain("session-expired");
    expect(host.state.lastError ?? "").toContain("401");
  });
});

// -- 6. post-write fast push (real outbox) ---------------------------------------------------

describe("SyncDesktopHost — pushNow (SYNC_PROTOCOL §8 after-local-write)", () => {
  it("drains a queued v2 command with NO pull; the outbox is stamped by the real engine", async () => {
    const harness = makeHarness();
    const { store, server, transport, host } = harness;
    const commandId = enqueuePartnerContactMerge(store, "fastpush");
    expect(host.queueDepth()).toBe(1);

    const result = await host.pushNow();
    expect(result.skipped).toBeUndefined();
    if (result.skipped !== undefined) {
      throw new Error(`pushNow unexpectedly skipped: ${result.skipped}`);
    }
    expect(result.pushed).toBe(1);
    expect(result.accepted).toBe(1);
    expect(result.rejected).toBe(0);
    expect(result.deferred).toBe(0);
    expect(result.duplicates).toBe(0);

    // Fast push: NO pull, NO status — only the drain. The push ack is
    // deliberately NOT sent here (SYNC_PROTOCOL §5: acks batch with the
    // next full cycle — the bandwidth rule).
    expect(transport.counts.pull).toBe(0);
    expect(transport.counts.status).toBe(0);
    expect(transport.counts.pushV2).toBe(1);
    expect(transport.counts.pushAck).toBe(0);

    // The outbox row is stamped (the ONLY place official numbers enter).
    const row = store.get("SELECT * FROM outbox WHERE command_id = ?", [commandId]);
    expect(row?.status).toBe("ACKED");
    expect(row?.official_no).not.toBeNull();
    expect(row?.accepted_result).not.toBeNull();
    expect(host.queueDepth()).toBe(0);
    expect(host.state.lastSyncAt).toBeDefined();

    // The v2 wire carried the meta contract version (the compiled floor).
    expect(server.pushCalls).toHaveLength(1);
    expect(server.pushCalls[0]!.contractVersion).toBe(SYNC_CONTRACT_VERSION);
  });

  it("falls back to the 016 pushAll when the transport has no pushV2", async () => {
    const server = new FakeSyncServerV2();
    const v2 = new V2Transport(server);
    const legacyOnly: SyncTransport = {
      pull: (entityType, cursor, limit) => v2.pull(entityType, cursor, limit),
      push: (batchId, commands) => v2.push(batchId, commands),
    };
    const harness = makeHarness({ transport: legacyOnly });
    const { store, transport, host } = harness;
    const commandId = enqueuePartnerContactMerge(store, "legacy");
    const result = await host.pushNow();
    expect(result.skipped).toBeUndefined();
    if (result.skipped !== undefined) {
      throw new Error(`pushNow unexpectedly skipped: ${result.skipped}`);
    }
    expect(result.pushed).toBe(1);
    expect(result.accepted).toBe(1);
    expect(result.duplicates).toBe(0);
    expect(transport.counts.push).toBe(1);
    expect(transport.counts.pushV2).toBe(0);
    expect(store.get("SELECT * FROM outbox WHERE command_id = ?", [commandId])?.status).toBe("ACKED");
  });
});

// -- 7. DR-P21-03 post-cycle prune hook --------------------------------------------------------

describe("SyncDesktopHost — post-cycle byte-exact prune (DR-P21-03)", () => {
  it("an over-stuffed cache + tiny budget: the prune runs POST-cycle (cursor survives)", async () => {
    const harness = makeHarness({ hostOptions: { prune: { budgetBytes: 1 } } });
    const { store, server, host } = harness;
    server.pageSize = 10;
    seedItems(server, 60);

    const result = await host.boot();
    expect(result.outcome!.pulled).toBe(60);

    // The prune ran after the successful cycle — real freed bytes.
    const prune = host.lastPrune;
    expect(prune).not.toBeNull();
    expect(prune!.freedBytes).toBeGreaterThan(0);
    expect(prune!.perTable["items"] ?? 0).toBeGreaterThan(0);
    expect(prune!.stillOverBudget).toBe(false);

    // LRU cache rows cleared; the cursor + machinery untouched (post-cycle,
    // never mid-cycle: the cursor proves the pull committed first).
    expect(store.countRows("items")).toBe(0);
    expect(readCursor(store, "items")).toBe("60");
    expect(store.all("SELECT * FROM cursors").length).toBeGreaterThan(0);
  });
});

// -- 8. §6.4 corruption mirror (extra) -----------------------------------------------------------

describe("SyncDesktopHost — corrupt store mirror (LOCAL_DATABASE §6.3/§6.4)", () => {
  it("a quarantined store phases corrupt and refuses pushes until the drill runs", async () => {
    const harness = makeHarness();
    const { store, transport, host } = harness;
    // Sabotage the cursor-count checksum → recoveryPass quarantines.
    metaSet(store, "cursorCount", "99");

    const result = await host.syncNow();
    expect(result.outcome).toBeDefined(); // loud result, never a throw
    expect(result.outcome!.pulled).toBe(0);
    expect(result.outcome!.pushed).toBe(0);
    expect(host.state.phase).toBe("corrupt");
    expect(host.state.lastError ?? "").toContain("§6.4");
    // No network work happened after the corrupt verdict.
    expect(transport.counts.status).toBe(0);
    expect(transport.counts.pull).toBe(0);
    // The write path is refused; the fast push skips.
    expect(host.canWrite()).toBe(false);
    expect((await host.pushNow()).skipped).toBe("corrupt");
  });
});
