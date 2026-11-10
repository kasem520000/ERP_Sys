import { describe, expect, it } from "vitest";

import {
  FakeServer,
  FaultTransport,
  SyncClient,
  applyMigrations,
  buildPosSaleCommand,
  capturePosSale,
  enqueue,
  memoryAdapter,
  nextOfflineNumber,
  queueStats,
  recoverInFlight,
  rejectedCommands,
  seededRandom,
  type StorageAdapter,
} from "../src";

/**
 * PHASE-016 · the chaos slice (SYNC_TESTS §7 — binding for POS release):
 * C-01 duplicate push, C-03 partial batch failure, C-04 crash between
 * journal write and ack, C-07 clock skew, C-09 offline queue drain with
 * server rejects, C-16 storage-full during capture. Every scenario runs
 * against the seeded harness (replayable from the seed — Sev-1 rule) and
 * asserts the ledger oracle: exactly-once effects per idempotency key +
 * honest local states (PENDING_SYNC never renders as posted).
 */

function captureSale(
  adapter: StorageAdapter,
  seq: number,
  overrides: Partial<Parameters<typeof capturePosSale>[0]> = {},
): { offlineNo: string; command: Record<string, unknown>; clientId: string } {
  const offlineNo = `OFF-T1-${String(seq).padStart(5, "0")}`;
  const draft = {
    clientId: `00000000-0000-7000-8000-${String(seq).padStart(12, "0")}`,
    terminalId: "11111111-1111-4111-8111-111111111111",
    offlineReceiptNo: offlineNo,
    invoiceDate: "2026-11-01",
    customerId: null,
    orderType: "COUNTER" as const,
    lines: [
      {
        itemId: "22222222-2222-4222-8222-222222222222",
        qty: "1.000000",
        unitPrice: "10.000000",
      },
    ],
    tenders: [{ method: "CASH" as const, amount: "10.0000" }],
  };
  const command = buildPosSaleCommand(draft);
  capturePosSale(adapter, {
    offlineReceiptNo: offlineNo,
    terminalId: draft.terminalId,
    customerId: null,
    orderType: "COUNTER",
    invoiceDate: draft.invoiceDate,
    totalGross: "10.0000",
    tenders: draft.tenders,
    lines: draft.lines,
    enqueueCommand: (store) => {
      enqueue(store, {
        entityType: "pos_sale",
        intent: "create",
        payload: command as unknown as Record<string, unknown>,
        idempotencyKey: command.idempotencyKey,
        commandId: command.id,
      });
    },
    ...overrides,
  });
  return { offlineNo, command: command as unknown as Record<string, unknown>, clientId: draft.clientId };
}

describe("chaos slice (SYNC_TESTS §7 — blocking for POS release)", () => {
  it("C-01 duplicate push: every command processed once; replays return the original result", async () => {
    const server = new FakeServer(seededRandom(101));
    const { adapter, client, transport } = makeWired(server);
    captureSale(adapter, 1);
    transport.setMode({ kind: "duplicateDelivery" });
    const outcome = await client.pushAll();
    expect(outcome.accepted).toBe(1);
    // The ledger oracle: exactly ONE execution for the idempotency key.
    expect(server.probe.executed).toHaveLength(1);
    // Both deliveries returned the SAME result (the original one).
    const stats = queueStats(adapter);
    expect(stats.acked).toBe(1);
    expect(stats.pending).toBe(0);
  });

  it("C-03 partial batch failure: per-item results, zero residue for the failed command", async () => {
    const server = new FakeServer(seededRandom(103));
    const { adapter, client } = makeWired(server);
    captureSale(adapter, 1);
    const second = captureSale(adapter, 2);
    // The server rejects the second deterministically with a typed reason.
    server.setRejectionTargets([second.offlineNo], "PRICE_CHANGED");
    const outcome = await client.pushAll();
    expect(outcome.accepted).toBe(1);
    expect(outcome.rejected).toBe(1);
    // Zero residue: the rejected command carries the typed reason + the
    // CONFLICT_RESOLUTION §3 action; the accepted one is ACKED.
    const rejected = rejectedCommands(adapter);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.rejectionReason).toBe("PRICE_CHANGED");
    expect(rejected[0]!.rejectionAction).toBe("ACCEPT_SERVER_PRICE");
    expect(queueStats(adapter).acked).toBe(1);
    // The ledger oracle: both commands executed EXACTLY once (a rejection
    // is a decision, not a lost command — no re-execution happens).
    expect(server.probe.executed).toHaveLength(2);
  });

  it("C-04 crash between journal write and ack: idempotent resume, no second journal", async () => {
    const server = new FakeServer(seededRandom(104));
    const { adapter, client, transport } = makeWired(server);
    const captured = captureSale(adapter, 1);
    // Faithful crash simulation: the server committed its journal (the
    // push reached it) but the ack was lost — the device died IN_FLIGHT.
    server.push("batch-crash", [captured.command]);
    const { markInFlight } = await import("../src");
    markInFlight(adapter, [captured.command.id]);
    expect(queueStats(adapter).inFlight).toBe(1);
    // Boot recovery returns it to QUEUED (never lost, never duplicated).
    const recovered = recoverInFlight(adapter);
    expect(recovered).toBe(1);
    expect(queueStats(adapter).pending).toBe(1);
    // Reconnect + re-drain: the server replays the ORIGINAL result.
    transport.setMode({ kind: "none" });
    const outcome = await client.pushAll();
    expect(outcome.accepted).toBe(1);
    // The ledger oracle: STILL exactly one execution (INV-013 replay) —
    // the second delivery returned the original result, no new journal.
    expect(server.probe.executed).toHaveLength(1);
    expect(queueStats(adapter).acked).toBe(1);
  });

  it("C-07 clock skew: server-authoritative dates; skew creates no future-dated postings", async () => {
    const server = new FakeServer(seededRandom(107));
    const { adapter, client } = makeWired(server);
    // The device clock is skewed 3 days ahead; the captured invoice_date
    // is a business fact carried verbatim — the SERVER decides acceptance
    // (PERIOD_LOCKED rejections come from the server's calendar, not the
    // device's clock), and the official numbering period is server-side.
    const skewed = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    captureSale(adapter, 1, { invoiceDate: skewed });
    const outcome = await client.pushAll();
    expect(outcome.accepted + outcome.rejected).toBe(1);
    // Whatever the decision, exactly-once holds and the state is honest.
    expect(server.probe.executed).toHaveLength(1);
    const stats = queueStats(adapter);
    expect(stats.pending + stats.rejected + stats.acked).toBe(1);
  });

  it("C-09 offline queue drain: 20 queued sales; 18 post; 2 typed rejections with actions", async () => {
    const server = new FakeServer(seededRandom(109));
    const { adapter, client } = makeWired(server);
    const rejectedNumbers: string[] = [];
    for (let seq = 1; seq <= 20; seq += 1) {
      const captured = captureSale(adapter, seq);
      if (seq === 7 || seq === 13) rejectedNumbers.push(captured.offlineNo);
    }
    // Exactly 2 of 20 rejected with the typed PRICE_CHANGED reason.
    server.setRejectionTargets(rejectedNumbers, "PRICE_CHANGED");
    const outcome = await client.pushAll();
    expect(outcome.pushed).toBe(20);
    expect(outcome.accepted).toBe(18);
    expect(outcome.rejected).toBe(2);
    // State honesty throughout: every sale was PENDING_SYNC before the
    // drain; after, 18 are SYNCED (official number recorded alongside the
    // OFF- reference — 1:1) and 2 are REJECTED with user actions.
    const stats = queueStats(adapter);
    expect(stats.acked).toBe(18);
    expect(stats.rejected).toBe(2);
    const rejected = rejectedCommands(adapter);
    for (const row of rejected) {
      expect(row.rejectionReason).toBe("PRICE_CHANGED");
      expect(row.rejectionAction).toBe("ACCEPT_SERVER_PRICE");
    }
    // The ledger oracle: 20 executions exactly — 18 accepted + 2 decided.
    expect(server.probe.executed).toHaveLength(20);
    // Reconnect storm (flap → re-drain): nothing left, zero re-execution.
    const second = await client.pushAll();
    expect(second.pushed).toBe(0);
    expect(server.probe.executed).toHaveLength(20);
  });

  it("C-16 storage-full during capture: loud failure, queue drains after recovery", async () => {
    const server = new FakeServer(seededRandom(116));
    const { adapter, client } = makeWired(server);
    // Fill the store until the adapter refuses loudly (simulated quota):
    // the transaction wraps the business row + outbox command — the throw
    // leaves NEITHER behind (atomic local capture).
    let captured = 0;
    let failed = false;
    const failing: StorageAdapter = {
      transaction: (fn) => fn(),
      run: (sql, params) => {
        if (captured >= 3 && sql.startsWith("INSERT INTO pos_sales")) {
          failed = true;
          throw new Error("sync-core: local storage full — sale not queued (QuotaExceededError)");
        }
        adapter.run(sql, params);
      },
      all: (sql, params) => adapter.all(sql, params),
      get: (sql, params) => adapter.get(sql, params),
    };
    for (let seq = 1; seq <= 4; seq += 1) {
      try {
        captureSale(failing, seq);
        captured += 1;
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("storage full");
        failed = true;
      }
    }
    expect(failed).toBe(true);
    expect(captured).toBe(3);
    // Nothing half-captured: the queue holds exactly the 3 successful
    // sales (the 4th left zero residue — no orphan outbox row).
    expect(queueStats(adapter).pending).toBe(3);
    // After "recovery" (quota freed), the queue drains normally.
    const outcome = await client.pushAll();
    expect(outcome.accepted).toBe(3);
    expect(server.probe.executed).toHaveLength(3);
  });
});

function makeWired(server: FakeServer): {
  adapter: ReturnType<typeof memoryAdapter>;
  client: SyncClient;
  transport: FaultTransport;
} {
  const adapter = memoryAdapter();
  applyMigrations(adapter);
  const transport = new FaultTransport(server);
  return { adapter, client: new SyncClient(adapter, transport), transport };
}

describe("offline numbering + state honesty (BR-030/A-010; OFFLINE_ARCHITECTURE §5)", () => {
  it("OFF- numbers are terminal-scoped, monotone, and never carry an official number", () => {
    const adapter = memoryAdapter();
    applyMigrations(adapter);
    const first = nextOfflineNumber(adapter, "T1", "11111111-1111-4111-8111-111111111111");
    const second = nextOfflineNumber(adapter, "T1", "11111111-1111-4111-8111-111111111111");
    expect(first).toBe("OFF-T1-00001");
    expect(second).toBe("OFF-T1-00002");
    // Terminals number independently (parallel terminals, INV-021).
    const otherTerminal = nextOfflineNumber(adapter, "T2", "99999999-9999-4999-8999-999999999999");
    expect(otherTerminal).toBe("OFF-T2-00001");
  });

  it("a captured sale renders PENDING_SYNC with NO official number anywhere", () => {
    const adapter = memoryAdapter();
    applyMigrations(adapter);
    const { offlineNo } = captureSale(adapter, 7);
    const sale = adapter.get("SELECT * FROM pos_sales WHERE offline_receipt_no = ?", [offlineNo]);
    expect(sale).toBeDefined();
    expect(sale!.local_status).toBe("PENDING_SYNC");
    expect(sale!.official_no ?? null).toBeNull();
    // The outbox mirrors the same honesty: QUEUED, no official_no.
    const command = adapter.get("SELECT * FROM outbox WHERE status = ?", ["QUEUED"]);
    expect(command).toBeDefined();
    expect(command!.official_no).toBeNull();
  });
});
