import { describe, expect, it } from "vitest";
import { SYNC_CONTRACT_VERSION } from "@erp/contracts";

import {
  FakeSyncServerV2,
  ReferenceDevice,
  SyncReadOnlyError,
  V2Transport,
  applyMigrations,
  memoryAdapter,
  nextBatch,
  queueStats,
  runCycle,
  type CycleEvent,
  type PosSaleDraft,
  type ScriptedChange,
} from "../src";

/**
 * PHASE-020 · the full cycle (SYNC_PROTOCOL §9; MASTER-PLAN §13) against
 * the in-memory v2 fake server: hasMore pagination across entity types,
 * the push drain, best-effort acks, the C-08 contract gate, C-06
 * revocation, the C-12 resync directive, and C-01/C-04 duplicate replays.
 * Every scenario is deterministic (seeded devices, scripted feeds).
 */

const TERMINAL_ID = "11111111-1111-4111-8111-111111111111";

function makeSaleDraft(seq: number): PosSaleDraft {
  return {
    clientId: `00000000-0000-7000-8000-${String(seq).padStart(12, "0")}`,
    terminalId: TERMINAL_ID,
    offlineReceiptNo: `OFF-T1-${String(seq).padStart(5, "0")}`,
    invoiceDate: "2026-11-04",
    customerId: null,
    orderType: "COUNTER",
    lines: [
      {
        itemId: "22222222-2222-4222-8222-222222222222",
        qty: "1.000000",
        unitPrice: "10.000000",
      },
    ],
    tenders: [{ method: "CASH", amount: "10.0000" }],
  };
}

function itemChange(seq: number, id: string, name: string, version: number): ScriptedChange {
  return {
    id,
    seq,
    op: "UPSERT",
    payload: { id, sku: `SKU-${seq}`, name, kind: "STOCK", status: "ACTIVE", changedAt: "2026-11-04T00:00:00Z" },
    version,
  };
}

function makeDevice(server: FakeSyncServerV2, deviceClass?: string): ReferenceDevice {
  const adapter = memoryAdapter();
  applyMigrations(adapter);
  if (deviceClass !== undefined) {
    adapter.run("INSERT INTO meta (key, value) VALUES (?, ?)", ["deviceClass", deviceClass]);
  }
  return new ReferenceDevice(adapter, new V2Transport(server), 42);
}

describe("runCycle (SYNC_PROTOCOL §9)", () => {
  it("drains every feed entity across hasMore pages, pushes the outbox, and records acks", async () => {
    const server = new FakeSyncServerV2();
    server.seedEntity("items", [
      itemChange(1, "item-1", "Item One", 1),
      itemChange(2, "item-2", "Item Two", 1),
      itemChange(3, "item-3", "Item Three", 1),
      itemChange(4, "item-4", "Item Four", 1),
    ]);
    server.seedEntity("partners", [
      { id: "partner-1", seq: 1, op: "UPSERT", payload: { id: "partner-1", code: "P1", name: "Partner One", kind: "CUSTOMER", status: "ACTIVE" }, version: 3 },
      { id: "partner-2", seq: 2, op: "UPSERT", payload: { id: "partner-2", code: "P2", name: "Partner Two", kind: "CUSTOMER", status: "ACTIVE" }, version: 1 },
    ]);
    server.seedEntity("permissions", [
      {
        id: "user-1:page:1",
        seq: 1,
        op: "UPSERT",
        payload: { userId: "user-1", permissions: ["sync.push", "sync.pull"], snapshotAt: Date.now() },
        version: null,
      },
    ]);
    const device = makeDevice(server);
    device.captureSale(makeSaleDraft(1), "10.0000");

    const outcome = await device.cycle();

    // Pull: permissions (1) + items (4) + partners (2) = 7 changes; the
    // remaining feed entities pulled empty.
    expect(outcome.pulled).toBe(7);
    // Push: the single captured sale ACCEPTED.
    expect(outcome.pushed).toBe(1);
    expect(outcome.accepted).toBe(1);
    expect(outcome.rejected).toBe(0);
    expect(outcome.deferred).toBe(0);
    expect(outcome.duplicates).toBe(0);
    expect(outcome.readOnly).toBe(false);
    expect(outcome.deviceRevoked).toBe(false);
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);

    // hasMore pagination: items (4 changes, page size 2) took 2 pulls.
    const itemPulls = server.pullCalls.filter((call) => call.entityType === "items");
    expect(itemPulls).toHaveLength(2);
    expect(itemPulls.map((call) => call.cursor)).toEqual([null, "2"]);

    // Permissions pulled FIRST (watermark before business data).
    const pulledEntities = server.pullCalls.map((call) => call.entityType);
    expect(pulledEntities.indexOf("permissions")).toBe(0);

    // Cursors landed at each entity's head.
    const state = device.state();
    expect(state.cursors.items).toBe("4");
    expect(state.cursors.partners).toBe("2");
    expect(state.cursors.permissions).toBe("1");
    expect(state.businessRows.items).toHaveLength(4);
    expect(state.businessRows.partners).toHaveLength(2);
    expect(state.meta.permissionSnapshotAt).not.toBeNull();

    // The outbox drained: ACKED with the official number, and the sale
    // row is SYNCED (PENDING_SYNC never renders as posted until here).
    expect(state.queue.acked).toBe(1);
    expect(state.outbox[0]!.officialNo).toBe("POS-T1-2611-00001");
    const sale = device.adapter.get("SELECT * FROM pos_sales WHERE id = ?", [
      makeSaleDraft(1).clientId,
    ]);
    expect(sale!.local_status).toBe("SYNCED");
    expect(sale!.official_no).toBe("POS-T1-2611-00001");

    // Acks recorded (best-effort §5): pull positions + processed ids.
    expect(server.pullAcks.length).toBe(9); // permissions + 8 feed entities
    expect(server.pullAcks).toContainEqual({ entityType: "items", cursor: "4" });
    expect(server.pushAcks).toEqual([[makeSaleDraft(1).clientId]]);
  });

  it("C-08 contract gate: unsupported contractVersion → read-only marker, no pull, no push attempted", async () => {
    const server = new FakeSyncServerV2();
    server.seedEntity("items", [itemChange(1, "item-1", "Item One", 1)]);
    server.setStatus({ contractVersion: "1999-01-01.0" });
    const device = makeDevice(server);
    // The capture happens BEFORE the gate is known — it stays queued.
    device.captureSale(makeSaleDraft(1), "10.0000");

    const outcome = await device.cycle();

    expect(outcome.readOnly).toBe(true);
    expect(outcome.pulled).toBe(0);
    expect(outcome.pushed).toBe(0);
    expect(outcome.durationMs).toBeGreaterThanOrEqual(0);
    // No push was attempted through the v2 transport.
    expect(server.pushCalls).toHaveLength(0);
    // No business data pulled (the gate stops the whole data plane).
    expect(server.pullCalls).toHaveLength(0);
    // The read-only marker is set + captures now fail loudly.
    const state = device.state();
    expect(state.meta.contractGate).toBe("read-only");
    expect(state.meta.readOnly).toBe(true);
    expect(() =>
      device.capture({ entityType: "partner", intent: "contact_merge", payload: { partnerId: "p1", phone: "1" } }),
    ).toThrow(SyncReadOnlyError);
    // The queued command stays honest: QUEUED, never fabricated accepted.
    expect(queueStats(device.adapter).pending).toBe(1);
  });

  it("C-06 revocation: deviceRevoked surfaced, queue marked unresolvable, no push", async () => {
    const server = new FakeSyncServerV2();
    server.setStatus({ revoked: true });
    const device = makeDevice(server);
    device.captureSale(makeSaleDraft(1), "10.0000");

    const outcome = await device.cycle();

    expect(outcome.deviceRevoked).toBe(true);
    expect(outcome.pushed).toBe(0);
    expect(server.pushCalls).toHaveLength(0);
    const state = device.state();
    expect(state.meta.queueUnresolvable).toBe("DEVICE_REVOKED");
    // The pending row stays QUEUED (the server never decided anything)
    // and the engine refuses to drain while unresolvable.
    expect(state.queue.pending).toBe(1);
    expect(nextBatch(device.adapter)).toHaveLength(0);
    expect(state.outbox[0]!.lastError).toContain("DEVICE_REVOKED");

    // Reconciliation resolution: clear the flag → the queue drains again
    // once the device is un-revoked.
    server.setStatus({ revoked: false });
    device.resolveQueue();
    const resumed = await device.cycle();
    expect(resumed.deviceRevoked).toBe(false);
    expect(resumed.accepted).toBe(1);
    expect(device.state().queue.acked).toBe(1);
  });

  it("C-12 resync directive: cursor reset to the fresh position + re-pull from there", async () => {
    const server = new FakeSyncServerV2();
    server.seedEntity("items", [
      itemChange(1, "item-1", "Item One", 1),
      itemChange(2, "item-2", "Item Two", 1),
      itemChange(3, "item-3", "Item Three", 1),
      itemChange(4, "item-4", "Item Four", 1),
    ]);
    server.setResync("items");
    const device = makeDevice(server);

    const events: CycleEvent[] = [];
    const outcome = await runCycle(device.client, { onEvent: (event) => events.push(event) });

    // The bounded restart: directive consumed, cursor reset to "0", and
    // the SAME loop re-pulled the full history from there.
    expect(outcome.pulled).toBe(4);
    const itemPulls = server.pullCalls.filter((call) => call.entityType === "items");
    expect(itemPulls.map((call) => call.cursor)).toEqual([null, "0", "2"]);
    expect(device.state().cursors.items).toBe("4");
    expect(device.state().businessRows.items).toHaveLength(4);
    expect(events).toContainEqual({ type: "resync", entityType: "items", cursor: "0" });
    // The ledger is untouched by a resync (no push happened at all).
    expect(server.executed).toHaveLength(0);
  });

  it("C-01/C-04 duplicate replay: original result re-delivered, marks SYNCED without re-execution", async () => {
    const server = new FakeSyncServerV2();
    const device = makeDevice(server);
    const draft = makeSaleDraft(1);
    device.captureSale(draft, "10.0000");

    // Crash-after-commit: the server executed the command, the response
    // was lost, and the device died IN_FLIGHT (never applied anything).
    const row = device.adapter.get("SELECT * FROM outbox WHERE command_id = ?", [draft.clientId]);
    const command = JSON.parse(String(row!.payload)) as Record<string, unknown>;
    await device.transport.pushV2!({ contractVersion: SYNC_CONTRACT_VERSION, commands: [command] });
    device.markInFlight([draft.clientId]);
    expect(server.executed).toHaveLength(1);

    // Boot + cycle: recovery requeues the IN_FLIGHT row, the re-push is a
    // duplicate delivery — the server replays the ORIGINAL result.
    const outcome = await device.cycle();

    expect(outcome.duplicates).toBe(1);
    expect(outcome.accepted).toBe(1);
    // The ledger oracle: still exactly one execution (INV-013).
    expect(server.executed).toHaveLength(1);
    const state = device.state();
    expect(state.queue.acked).toBe(1);
    expect(state.outbox[0]!.officialNo).toBe("POS-T1-2611-00001");
    const sale = device.adapter.get("SELECT * FROM pos_sales WHERE id = ?", [draft.clientId]);
    expect(sale!.local_status).toBe("SYNCED");
    expect(sale!.official_no).toBe("POS-T1-2611-00001");
  });

  it("016 mode: a transport without status() skips the gate and pushes legacy", async () => {
    const server = new FakeSyncServerV2();
    // Legacy transport: pull + push only (the 016 browser shape).
    const legacyTransport = {
      pull: async (entityType: string, cursor: string | null) =>
        new V2Transport(server).pull(entityType, cursor),
      push: async (batchId: string, commands: readonly Record<string, unknown>[]) =>
        new V2Transport(server).push(batchId, commands),
    };
    const adapter = memoryAdapter();
    applyMigrations(adapter);
    const device = new ReferenceDevice(adapter, legacyTransport, 42);
    device.captureSale(makeSaleDraft(1), "10.0000");

    const outcome = await device.cycle();

    // No gate call possible, no v2 push — the legacy drain ran instead.
    expect(outcome.readOnly).toBe(false);
    expect(server.pushCalls).toHaveLength(0);
    expect(server.legacyPushCalls).toHaveLength(1);
    expect(outcome.accepted).toBe(1);
    expect(device.state().queue.acked).toBe(1);
  });
});
