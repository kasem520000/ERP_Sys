import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SYNC_CONTRACT_VERSION, type PullEnvelope, type PushItemResult, type PushItemResultV2 } from "@erp/contracts";
import {
  applyPullBatch,
  assertWritable,
  buildSyncCommandV2,
  enqueue,
  FakeSyncServerV2,
  metaGet,
  metaSet,
  queueUnresolvableReason,
  readCursor,
  SyncReadOnlyError,
  V2Transport,
  type SyncTransport,
} from "@erp/sync-core";

import { BudgetGuard } from "../src/sync/transport";
import { purgeOnRevocation, type PurgeReport } from "../src/sync/revocation";
import {
  MOBILE_FEED_APPLIERS,
  MobileSessionExpiredError,
  MobileSyncHttpError,
  MobileSyncHost,
  type HostState,
  type RevocationDetection,
} from "../src/sync";
import { openFieldStore, openPersonalStore, type MobileStore } from "../src/store";
import {
  PERSONAL_BACKGROUND_PULL_BUDGET_BYTES,
  SYNC_PULL_BUDGET_BYTES,
} from "../src/constants";

/**
 * PHASE-022 · the mobile sync host suite (T2-a; MASTER-PLAN §7 — BINDING;
 * SYNC_PROTOCOL §8/§9; LOCAL_DATABASE §1.1 rule 2 + §6.3/§6.4): REAL
 * SQLite temp stores + REAL sync-core cycle engine — only the TRANSPORT
 * is scripted (sync-core's own FakeSyncServerV2 + V2Transport, wrapped
 * in a counting proxy for call-count assertions). The mandated matrix,
 * per profile: the field happy path with the feed materialization
 * asserted row-by-row (the LITE payloads landing as TEXT money), C-08,
 * D-01 + the purge, the one-in-flight mutex, the fast push, the
 * session-expired fail-closed path, the post-cycle prune, the budget
 * profiles — and the personal pull-only hard guard (pushNow refused,
 * enqueue structurally impossible, zero push calls ever).
 */

const FIELD_DEVICE_ID = "31313131-1111-4111-8111-111111111111";
const PARTNER_ID = "31313131-2222-4222-8222-222222222222";

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

const workDirs: string[] = [];
const openStores: MobileStore[] = [];

afterAll(() => {
  for (const store of openStores) store.close();
  for (const dir of workDirs) rmSync(dir, { recursive: true, force: true });
});

interface Harness {
  readonly store: MobileStore;
  readonly server: FakeSyncServerV2;
  readonly transport: CountingTransport;
  readonly host: MobileSyncHost;
  readonly budget: BudgetGuard;
  readonly states: HostState[];
  readonly revocations: RevocationDetection[];
  readonly prompts: string[];
}

function makeHarness(
  profile: "field" | "personal",
  options?: {
    transport?: SyncTransport;
    accessToken?: () => string | null;
    hostOptions?: { prune?: { budgetBytes?: number } };
  },
): Harness {
  const dir = mkdtempSync(join(tmpdir(), profile === "field" ? "erp-mobile-host-field-" : "erp-mobile-host-personal-"));
  workDirs.push(dir);
  const store = profile === "field" ? openFieldStore(join(dir, "store.sqlite")) : openPersonalStore(join(dir, "store.sqlite"));
  openStores.push(store);
  const server = new FakeSyncServerV2();
  const states: HostState[] = [];
  const revocations: RevocationDetection[] = [];
  const prompts: string[] = [];
  const transport = new CountingTransport(options?.transport ?? new V2Transport(server));
  const budget = new BudgetGuard();
  const host = new MobileSyncHost({
    store,
    deviceClass: profile === "field" ? "android-field" : "android-personal",
    transport,
    accessToken: options?.accessToken ?? (() => "access-token-field-01"),
    onState: (state) => states.push(state),
    onRevocation: (detection) => revocations.push(detection),
    onUpdatePrompt: (reason) => prompts.push(reason),
    budget: { controller: budget },
    ...options?.hostOptions,
  });
  return { store, server, transport, host, budget, states, revocations, prompts };
}

// -- seed helpers (the LITE payload shapes, money TEXT) ------------------------------

function seedPermissionSnapshot(server: FakeSyncServerV2): void {
  server.seedEntity("permissions", [
    {
      id: "31313131-0000-4000-8000-000000002101:page:0",
      seq: 1,
      op: "UPSERT" as const,
      payload: {
        userId: "31313131-0000-4000-8000-000000002101",
        permissions: ["van_sales.sell"],
        snapshotAt: Date.now(),
        watermarkDays: 7,
      },
      version: 1,
    },
  ]);
}

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

function seedVanStocks(server: FakeSyncServerV2, count: number): void {
  server.seedEntity(
    "van_stocks",
    Array.from({ length: count }, (_, index) => ({
      id: `vs-${index + 1}`,
      seq: index + 1,
      op: "UPSERT" as const,
      payload: {
        id: `vs-${index + 1}`,
        warehouseId: "31313131-4444-4444-8444-444444444441",
        itemId: `item-${index + 1}`,
        batchId: null,
        // VanStockLite: TEXT 6-dp qty / 4-dp value (ADR-0009).
        qty: "10.000000",
        value: "600.0000",
        refreshedAt: "2026-11-04T00:00:00Z",
        changedAt: "2026-11-04T00:00:00Z",
      },
      version: index + 1,
    })),
  );
}

function seedRoutes(server: FakeSyncServerV2): void {
  server.seedEntity("routes", [
    {
      id: "route-1",
      seq: 1,
      op: "UPSERT" as const,
      payload: {
        id: "route-1",
        code: "R-1",
        name: "Route 1",
        nameAr: "خط ١",
        salesRepId: "31313131-5555-4555-8555-555555555551",
        vanWarehouseId: "31313131-4444-4444-8444-444444444441",
        dayPattern: ["SUN", "MON"],
        status: "ACTIVE",
        customers: [
          { partnerId: PARTNER_ID, visitOrder: 1, isPinned: true },
          { partnerId: "31313131-2222-4222-8222-222222222229", visitOrder: 2, isPinned: false },
        ],
        changedAt: "2026-11-04T00:00:00Z",
      },
      version: 1,
    },
  ]);
}

function seedSettlementTemplate(server: FakeSyncServerV2): void {
  server.seedEntity("settlement_templates", [
    {
      id: "st-1",
      seq: 1,
      op: "UPSERT" as const,
      payload: {
        id: "st-1",
        settlementNo: null,
        salesRepId: "31313131-5555-4555-8555-555555555551",
        vanWarehouseId: "31313131-4444-4444-8444-444444444441",
        shiftId: null,
        settlementDate: "2026-11-04",
        status: "DRAFT",
        openingCash: "100.0000",
        cashSales: "0.0000",
        collections: "0.0000",
        cashRefunds: "0.0000",
        repExpenses: "0.0000",
        expectedCash: "100.0000",
        countedCash: null,
        variance: null,
        varianceDirection: null,
        depositAmount: null,
        changedAt: "2026-11-04T00:00:00Z",
      },
      version: 1,
    },
  ]);
}

function seedStatement(server: FakeSyncServerV2, partnerId: string): void {
  server.seedEntity("statements", [
    {
      // The change row's id IS the partner id (the permissions-snapshot
      // pattern; version null on the wire).
      id: partnerId,
      seq: 1,
      op: "UPSERT" as const,
      payload: {
        partnerId,
        customerCode: "P-1",
        customerName: "Partner 1",
        customerNameAr: "الشريك ١",
        asOf: "2026-11-04",
        currencyCode: "SAR",
        openingBalance: "100.0000",
        entries: [
          {
            entryDate: "2026-11-04",
            docRef: "SAL-2026-000001",
            sourceType: "INVOICE",
            currencyCode: "SAR",
            debit: "50.0000",
            credit: "0.0000",
            balance: "150.0000",
            outstanding: "50.0000",
          },
        ],
        closingBalance: "150.0000",
        closingBalanceBase: "150.0000",
        aging: { not_due: "100.0000", "1_30": "50.0000", "31_60": "0.0000", "61_90": "0.0000", "90_plus": "0.0000" },
        generatedAt: "2026-11-04T06:00:00Z",
      },
      version: null,
    },
  ]);
}

function seedReceipt(server: FakeSyncServerV2): void {
  server.seedEntity("receipts", [
    {
      id: "rc-1",
      seq: 1,
      op: "UPSERT" as const,
      payload: {
        id: "rc-1",
        receiptNo: null,
        status: "DRAFT",
        partnerId: PARTNER_ID,
        method: "CASH",
        currencyCode: "SAR",
        amount: "250.0000",
        valueDate: "2026-11-04",
        reference: null,
        postedAt: null,
        changedAt: "2026-11-04T00:00:00Z",
      },
      version: 1,
    },
  ]);
}

function seedNotifications(server: FakeSyncServerV2, count: number): void {
  server.seedEntity(
    "notifications",
    Array.from({ length: count }, (_, index) => ({
      id: `n-${index + 1}`,
      seq: index + 1,
      op: "UPSERT" as const,
      payload: {
        id: `n-${index + 1}`,
        userId: "31313131-0000-4000-8000-000000002101",
        category: "invoice_overdue",
        severity: "warning",
        title: { ar: "تنبيه", en: "Notice" },
        body: { ar: "محتوى", en: "Body" },
        actionLabel: { ar: "عرض", en: "View" },
        actionUrl: "/invoices",
        readAt: null,
        changedAt: "2026-11-04T00:00:00Z",
      },
      version: 1,
    })),
  );
}

function seedSalesInvoices(server: FakeSyncServerV2, count: number): void {
  server.seedEntity(
    "sales_invoices",
    Array.from({ length: count }, (_, index) => ({
      id: `inv-${index + 1}`,
      seq: index + 1,
      op: "UPSERT" as const,
      payload: {
        id: `inv-${index + 1}`,
        invoiceNo: null,
        status: "DRAFT",
        kind: "CREDIT",
        channel: "FIELD",
        customerId: PARTNER_ID,
        orderDate: "2026-11-04",
        totalAmount: "120.0000",
        currency: "SAR",
        ownerDeviceId: FIELD_DEVICE_ID,
        changedAt: "2026-11-04T00:00:00Z",
      },
      version: 1,
    })),
  );
}

/** A real v2 local write (the ReferenceDevice.capture pattern): the full
 * sync-core-built command envelope enqueued through the engine. */
function enqueuePartnerContactMerge(store: MobileStore, suffix: string): string {
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

// -- 1. the field profile: boot + full cycle ------------------------------------------

describe("MobileSyncHost (field) — boot + full cycle (MASTER-PLAN §7, SYNC_PROTOCOL §9)", () => {
  it("runs the full cycle with the feed materialization: LITE rows land as TEXT money, cursors advance", async () => {
    const harness = makeHarness("field");
    const { store, server, transport, host, states } = harness;
    seedPermissionSnapshot(server);
    seedItems(server, 2);
    seedVanStocks(server, 3);
    seedRoutes(server);
    seedSettlementTemplate(server);
    seedStatement(server, PARTNER_ID);
    const commandId = enqueuePartnerContactMerge(store, "happy");

    expect(host.state.phase).toBe("idle"); // pre-boot mirror
    expect(host.canWrite()).toBe(true);
    const result = await host.boot();

    // Outcome counts: 1 permissions + 2 items + 3 van_stocks + 1 route +
    // 1 settlement + 1 statement pushed+accepted; the field feed group's
    // empty entities contribute 0.
    expect(result.skipped).toBeUndefined();
    expect(result.outcome).toBeDefined();
    expect(result.outcome!.pulled).toBe(9);
    expect(result.outcome!.pushed).toBe(1);
    expect(result.outcome!.accepted).toBe(1);
    expect(result.outcome!.rejected).toBe(0);
    expect(result.outcome!.deferred).toBe(0);
    expect(result.outcome!.duplicates).toBe(0);
    expect(result.outcome!.readOnly).toBe(false);
    expect(result.outcome!.deviceRevoked).toBe(false);

    // THE materialization seam: the 022 feed types landed as rows with
    // the LITE columns (money TEXT) — what the flows + chaos harness read.
    expect(store.countRows("van_stocks")).toBe(3);
    const vanStock = store.get("SELECT * FROM van_stocks WHERE id = ?", ["vs-1"]);
    expect(vanStock?.qty).toBe("10.000000");
    expect(vanStock?.value).toBe("600.0000");
    expect(vanStock?.warehouse_id).toBe("31313131-4444-4444-8444-444444444441");
    expect(JSON.parse(String(vanStock?.payload ?? "{}")).id).toBe("vs-1");
    expect(store.countRows("routes")).toBe(1);
    const route = store.get("SELECT * FROM routes WHERE id = ?", ["route-1"]);
    expect(JSON.parse(String(route?.customers ?? "[]"))).toHaveLength(2); // the ordered customer list
    expect(JSON.parse(String(route?.customers ?? "[]"))[0].partnerId).toBe(PARTNER_ID);
    expect(store.countRows("settlement_templates")).toBe(1);
    expect(store.get("SELECT * FROM settlement_templates WHERE id = ?", ["st-1"])?.opening_cash).toBe("100.0000");
    expect(store.countRows("statements")).toBe(1);
    expect(store.get("SELECT * FROM statements WHERE id = ?", [PARTNER_ID])?.closing_balance).toBe("150.0000");
    // The items landed through sync-core's posAppliers (the POS base).
    expect(store.countRows("items")).toBe(2);

    // Cursors advanced for every pulled entity (persisted per entity — §2.7).
    expect(readCursor(store, "van_stocks")).toBe("3");
    expect(readCursor(store, "items")).toBe("2");
    expect(readCursor(store, "permissions")).toBe("1");
    expect(readCursor(store, "routes")).toBe("1");

    // meta.contractVersion set — the v5 seed = the compiled-in floor.
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
    expect(server.pullAcks.length).toBeGreaterThanOrEqual(4);

    // HostState mirror: idle → syncing → idle, timestamps + writability.
    expect(host.state.phase).toBe("idle");
    expect(states.map((state) => state.phase)).toEqual(["syncing", "idle"]);
    expect(host.state.lastSyncAt).toBeDefined();
    expect(host.state.lastOutcome?.pulled).toBe(9);
    expect(host.canWrite()).toBe(true);
    expect(host.lastPrune?.freedBytes).toBe(0); // default budget — no-op pass
  });

  it("a stale server version is skipped by the version guard (the row keeps its older stamp)", () => {
    const store = openFieldStore(":memory:");
    openStores.push(store);
    // Through the REAL applier path (applyPullBatch's guard — the same
    // one the personal cycle + the materializing wrapper use).
    const changeAt = (changedAt: string): { entityType: string; cursor: string; changes: readonly { id: string; seq: number; op: "UPSERT"; payload: Record<string, unknown>; changedAt: string; version: number }[] } => ({
      entityType: "van_stocks",
      cursor: "1",
      changes: [
        {
          id: "vs-stale",
          seq: 1,
          op: "UPSERT",
          payload: {
            id: "vs-stale", warehouseId: "wh-1", itemId: "item-1", batchId: null,
            qty: "5.000000", value: "25.0000", refreshedAt: "2026-11-04T00:00:00Z",
            changedAt,
          },
          changedAt,
          version: 4,
        },
      ],
    });
    applyPullBatch(store, changeAt("2026-11-01T00:00:00Z"), MOBILE_FEED_APPLIERS);
    applyPullBatch(store, changeAt("2026-11-02T00:00:00Z"), MOBILE_FEED_APPLIERS); // same version → stale skip
    const row = store.get("SELECT * FROM van_stocks WHERE id = ?", ["vs-stale"]);
    expect(row?.updated_at).toBe("2026-11-01T00:00:00Z"); // the second (stale) apply did NOT clobber
    expect(row?.version).toBe(4);
  });
});

// -- 2. C-08 contract gate (both profiles) ----------------------------------------------

describe("MobileSyncHost — C-08 contract-version gate (read-only + update prompt)", () => {
  it("field: unsupported server version stops the cycle read-only; a fixed server clears the gate", async () => {
    const harness = makeHarness("field");
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

  it("personal: the same gate through the pull-only cycle's status check", async () => {
    const harness = makeHarness("personal");
    const { store, server, host, prompts } = harness;
    seedStatement(server, PARTNER_ID);
    server.setStatus({ contractVersion: "1999-01-01.0" });

    const gated = await host.boot();
    expect(gated.outcome!.readOnly).toBe(true);
    expect(gated.outcome!.pulled).toBe(0);
    expect(host.state.phase).toBe("read-only");
    expect(prompts).toEqual(["CONTRACT_VERSION_UNSUPPORTED"]);
    expect(() => assertWritable(store)).toThrow(SyncReadOnlyError);

    server.setStatus({ contractVersion: SYNC_CONTRACT_VERSION });
    const recovered = await host.syncNow();
    expect(recovered.outcome!.readOnly).toBe(false);
    expect(host.state.phase).toBe("idle");
    expect(() => assertWritable(store)).not.toThrow();
    expect(prompts).toEqual(["CONTRACT_VERSION_UNSUPPORTED"]);
  });
});

// -- 3. D-01 revocation (both profiles) --------------------------------------------------

describe("MobileSyncHost — D-01 revocation (SECURITY_AND_DEVICE_MANAGEMENT §4 + §6.2)", () => {
  it("field: status.device.revoked → phase revoked + queue unresolvable, then the purge empties the store", async () => {
    const harness = makeHarness("field");
    const { store, server, host, revocations } = harness;
    seedPermissionSnapshot(server);
    seedVanStocks(server, 2);
    const commandId = enqueuePartnerContactMerge(store, "revoked"); // stays QUEUED

    server.setStatus({ revoked: true });
    const result = await host.syncNow();

    expect(result.outcome!.deviceRevoked).toBe(true);
    expect(result.outcome!.pushed).toBe(0); // no push on a revoked device
    expect(host.state.phase).toBe("revoked");
    expect(host.canWrite()).toBe(false);
    expect(revocations).toHaveLength(1);
    expect(revocations[0]!.source).toBe("status");

    // The queue was marked unresolvable — exactly what runCycle does:
    // QUEUED rows keep their state with the reason stamped on last_error.
    expect(queueUnresolvableReason(store)).toBe("DEVICE_REVOKED");
    const row = store.get("SELECT * FROM outbox WHERE command_id = ?", [commandId]);
    expect(String(row?.last_error ?? "")).toContain("queue unresolvable");
    expect(row?.status).toBe("QUEUED");

    // STOP syncing: every later call skips until re-enrollment.
    expect((await host.syncNow()).skipped).toBe("revoked");

    // Then the D-01 purge (the shell's step — onRevocation → purgeOnRevocation):
    // the materialized feed rows + outbox + cursors emptied, honest counts.
    const purged = purgeOnRevocation(store);
    host.recordRevocationPurge(purged);
    expect(purged.tables["van_stocks"]).toBe(2);
    expect(purged.tables["outbox"]).toBe(1);
    expect(store.countRows("van_stocks")).toBe(0);
    expect(store.countRows("outbox")).toBe(0);
    expect(readCursor(store, "van_stocks")).toBeNull();
    expect(host.lastPurge).toBe(purged);
    // The store stays recovery-consistent after the purge.
    expect((await import("@erp/sync-core")).recoveryPass(store).integrity).toBe("ok");
    // ...and the terminal phase survives the purge (re-enroll required).
    expect(host.state.phase).toBe("revoked");
    expect((await host.syncNow()).skipped).toBe("revoked");
  });

  it("personal: revoked → phase revoked + the purge empties the read models; NO queue to mark", async () => {
    const harness = makeHarness("personal");
    const { store, server, host, revocations } = harness;
    seedStatement(server, PARTNER_ID);
    seedReceipt(server);
    seedNotifications(server, 2);
    seedSalesInvoices(server, 1);
    await host.syncNow(); // populate the read models
    expect(store.countRows("statements")).toBe(1);
    expect(store.countRows("notifications")).toBe(2);

    server.setStatus({ revoked: true });
    const result = await host.syncNow();
    expect(result.outcome!.deviceRevoked).toBe(true);
    expect(host.state.phase).toBe("revoked");
    expect(revocations).toHaveLength(1);
    // The personal profile has NO queue to mark unresolvable — the D-01
    // IS the purge + re-enroll (no outbox table exists at all).
    expect(queueUnresolvableReason(store)).toBeNull();
    expect((await host.syncNow()).skipped).toBe("revoked");

    const purged: PurgeReport = purgeOnRevocation(store);
    host.recordRevocationPurge(purged);
    expect(purged.tables["statements"]).toBe(1);
    expect(purged.tables["notifications"]).toBe(2);
    expect(purged.tables["receipts"]).toBe(1);
    expect(purged.tables["cursors"]).toBeGreaterThanOrEqual(1);
    expect(store.countRows("sales_invoices")).toBe(0);
    expect(host.lastPurge).toBe(purged);
  });

  it("an expired status.device.dataExpiresAt (§6.2 remote data-expiry) triggers the D-01 path", async () => {
    // The real server BLOCKS the sync of an expired device — the scripted
    // transport mirrors that: status reports the expired watermark.
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
    const harness = makeHarness("field", { transport });
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

// -- 4. the one-in-flight mutex ------------------------------------------------------------

describe("MobileSyncHost — one-in-flight mutex (SYNC_PROTOCOL §8)", () => {
  it("two concurrent syncNow calls run exactly ONE cycle; the second returns skipped", async () => {
    const harness = makeHarness("field");
    const { server, transport, host } = harness;
    seedItems(server, 3);
    seedVanStocks(server, 3);

    const first = host.syncNow();
    const second = host.syncNow();
    const secondResult = await second;
    expect(secondResult.skipped).toBe("already-running");
    expect(secondResult.outcome).toBeUndefined();

    const firstResult = await first;
    expect(firstResult.skipped).toBeUndefined();
    expect(firstResult.outcome!.pulled).toBe(6);

    // Exactly one cycle ran: one status call, one pull round, one ack.
    expect(transport.counts.status).toBe(1);
    // Pull math: permissions(1, empty) + the 12-entity field group with
    // items(3 changes @pageSize 2 → 2 calls) + van_stocks(3 → 2 calls) +
    // the other 10 entities (1 empty call each) = 1 + 2 + 2 + 10 = 15.
    expect(transport.counts.pull).toBe(15);
    expect(transport.counts.pullAck).toBe(1);

    // After completion the mutex releases — a third call runs a fresh cycle.
    const third = await host.syncNow();
    expect(third.outcome).toBeDefined();
    expect(transport.counts.status).toBe(2);
  });
});

// -- 5. session-expired (fail-closed, never anonymous) -------------------------------------

describe("MobileSyncHost — session-expired (fail-closed; SECURITY_AND_DEVICE_MANAGEMENT §3)", () => {
  it("no token ⇒ boot/syncNow reject with MobileSessionExpiredError, phase error, ZERO requests", async () => {
    const harness = makeHarness("field", { accessToken: () => null });
    const { transport, host } = harness;

    await expect(host.boot()).rejects.toBeInstanceOf(MobileSessionExpiredError);
    expect(host.state.phase).toBe("error");
    expect(host.state.lastError ?? "").toContain("session-expired");

    // No anonymous request fired — nothing left the process.
    expect(transport.counts.status).toBe(0);
    expect(transport.counts.pull).toBe(0);
    expect(transport.counts.push).toBe(0);
    expect(transport.counts.pushV2).toBe(0);
    expect(transport.counts.pullAck).toBe(0);
    expect(transport.counts.pushAck).toBe(0);

    await expect(host.syncNow()).rejects.toBeInstanceOf(MobileSessionExpiredError);
    expect(transport.counts.pull).toBe(0);
  });

  it("an HTTP 401 mid-cycle phases as session-expired (the host's 401 mapping)", async () => {
    const server = new FakeSyncServerV2();
    const inner = new V2Transport(server);
    const transport: SyncTransport = {
      pull: (entityType, cursor, limit) => inner.pull(entityType, cursor, limit),
      push: (batchId, commands) => inner.push(batchId, commands),
      async status() {
        throw new MobileSyncHttpError(
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
    const harness = makeHarness("field", { transport });
    const { host } = harness;
    const result = await host.syncNow();
    expect(result.outcome).toBeDefined(); // the cycle completed (pulls served)
    expect(host.state.phase).toBe("error");
    expect(host.state.lastError ?? "").toContain("session-expired");
    expect(host.state.lastError ?? "").toContain("401");
  });
});

// -- 6. post-write fast push (real outbox, field only) ----------------------------------------

describe("MobileSyncHost — pushNow (SYNC_PROTOCOL §8 after-local-write)", () => {
  it("drains a queued v2 command with NO pull; the outbox is stamped by the real engine", async () => {
    const harness = makeHarness("field");
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
    // deliberately NOT sent here (acks batch with the next full cycle).
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
    const harness = makeHarness("field", { transport: legacyOnly });
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

// -- 7. per-item rejection surfacing ----------------------------------------------------------

describe("MobileSyncHost — per-item rejection surfacing (CONFLICT_RESOLUTION §3)", () => {
  it("a typed rejection lands in the outbox + host.rejectedCommands() lists it with the reason", async () => {
    const server = new FakeSyncServerV2();
    const inner = new V2Transport(server);
    // Rewrite one command's result to a typed PRICE_CHANGED rejection
    // carrying machine-readable details (the 2-c contract shape).
    const transport: SyncTransport = {
      pull: (entityType, cursor, limit) => inner.pull(entityType, cursor, limit),
      push: (batchId, commands) => inner.push(batchId, commands),
      status: () => inner.status!(),
      pushV2: async (request) => {
        const results = await inner.pushV2(request);
        return results.map((result) =>
          result.status === "ACCEPTED"
            ? {
                ...result,
                status: "REJECTED" as const,
                reason: "PRICE_CHANGED" as const,
                message: "price moved beyond tolerance",
                action: "ACCEPT_SERVER_PRICE" as const,
                details: { currentPrice: "12.0000" },
                resubmittable: true,
              }
            : result,
        );
      },
      pullAck: (positions) => inner.pullAck(positions),
      pushAck: (commandIds) => inner.pushAck(commandIds),
    };
    const harness = makeHarness("field", { transport });
    const { store, host } = harness;
    const commandId = enqueuePartnerContactMerge(store, "rejected");

    const result = await host.syncNow();
    expect(result.outcome!.rejected).toBe(1);
    expect(result.outcome!.accepted).toBe(0);
    // The cycle itself still completed honestly.
    expect(host.state.phase).toBe("idle");

    // The rejected row is surfaced per-item for the parked-rejections UX.
    const rejected = host.rejectedCommands();
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.commandId).toBe(commandId);
    expect(rejected[0]!.rejectionReason).toBe("PRICE_CHANGED");
    expect(rejected[0]!.rejectionAction).toBe("ACCEPT_SERVER_PRICE");
    const typed = JSON.parse(String(rejected[0]!.lastError ?? "{}")) as {
      reason: string;
      details: { currentPrice: string };
    };
    expect(typed.reason).toBe("PRICE_CHANGED");
    expect(typed.details.currentPrice).toBe("12.0000");
  });
});

// -- 8. DR-P21-03 post-cycle prune ---------------------------------------------------------------

describe("MobileSyncHost — post-cycle byte-exact prune (the DR-P21-03 port)", () => {
  it("an over-stuffed cache + tiny budget: the prune runs POST-cycle (cursor survives)", async () => {
    const harness = makeHarness("field", { hostOptions: { prune: { budgetBytes: 1 } } });
    const { store, server, host } = harness;
    server.pageSize = 10;
    seedVanStocks(server, 60);

    const result = await host.boot();
    expect(result.outcome!.pulled).toBe(60); // the cycle pulled all 60 (with the materialization)

    // The prune ran after the successful cycle — real freed bytes.
    const prune = host.lastPrune;
    expect(prune).not.toBeNull();
    expect(prune!.freedBytes).toBeGreaterThan(0);
    expect(prune!.perTable["van_stocks"] ?? 0).toBeGreaterThan(0);
    expect(prune!.stillOverBudget).toBe(false);

    // LRU cache rows cleared (the post-cycle prune already ran inside the
    // cycle — the desktop host's identical semantics); the cursor +
    // machinery untouched (post-cycle, never mid-cycle: the cursor proves
    // the pull committed first).
    expect(store.countRows("van_stocks")).toBe(0);
    expect(readCursor(store, "van_stocks")).toBe("60");
    expect(store.all("SELECT * FROM cursors").length).toBeGreaterThan(0);
  });
});

// -- 9. §6.4 corrupt mirror -------------------------------------------------------------------------

describe("MobileSyncHost — corrupt store mirror (LOCAL_DATABASE §6.3/§6.4)", () => {
  it("field: a quarantined store phases corrupt and refuses pushes until the drill runs", async () => {
    const harness = makeHarness("field");
    const { store, transport, host } = harness;
    // Sabotage the cursor-count checksum → runCycle's recoveryPass quarantines.
    metaSet(store, "cursorCount", "99");

    const result = await host.syncNow();
    expect(result.outcome).toBeDefined(); // loud result, never a throw
    expect(result.outcome!.pulled).toBe(0);
    expect(result.outcome!.pushed).toBe(0);
    expect(host.state.phase).toBe("corrupt");
    expect(host.state.lastError ?? "").toContain("§6.4");
    // No network work happened after the corrupt verdict.
    expect(transport.counts.pull).toBe(0);
    // The write path is refused; the fast push skips.
    expect(host.canWrite()).toBe(false);
    expect((await host.pushNow()).skipped).toBe("corrupt");
  });

  it("personal: a cursor-count mismatch quarantines through the pull-only cycle's own check", async () => {
    const harness = makeHarness("personal");
    const { store, transport, host } = harness;
    seedStatement(server0(harness), PARTNER_ID);
    metaSet(store, "cursorCount", "99");

    const result = await host.syncNow();
    expect(result.outcome).toBeDefined();
    expect(result.outcome!.pulled).toBe(0);
    expect(host.state.phase).toBe("corrupt");
    expect(host.state.lastError ?? "").toContain("§6.4");
    expect(transport.counts.pull).toBe(0);
    expect((await host.pushNow()).skipped).toBe("pull-only"); // still no push — ALWAYS
  });
});

// -- 10. the budget profiles ------------------------------------------------------------------------

describe("MobileSyncHost — the per-cycle transport budget profiles", () => {
  it("field cycles arm the 8 MB/2 MB golden budgets in every mode", async () => {
    const harness = makeHarness("field");
    const { host, budget } = harness;
    await host.syncNow();
    expect(budget.usage().pullLimitBytes).toBe(SYNC_PULL_BUDGET_BYTES);
    await host.syncNow({ background: true }); // field background keeps the same budgets
    expect(budget.usage().pullLimitBytes).toBe(SYNC_PULL_BUDGET_BYTES);
    await host.pushNow();
    expect(budget.usage().pullLimitBytes).toBe(SYNC_PULL_BUDGET_BYTES);
  });

  it("personal foreground arms 8 MB; BACKGROUND arms the 256 KB golden budget", async () => {
    const harness = makeHarness("personal");
    const { host, budget } = harness;
    await host.syncNow();
    expect(budget.usage().pullLimitBytes).toBe(SYNC_PULL_BUDGET_BYTES);
    await host.syncNow({ background: true });
    expect(budget.usage().pullLimitBytes).toBe(PERSONAL_BACKGROUND_PULL_BUDGET_BYTES);
    expect(PERSONAL_BACKGROUND_PULL_BUDGET_BYTES).toBe(262_144);
  });
});

// -- 11. the personal pull-only hard guard (DR-P22-08b) ------------------------------------------------

describe("MobileSyncHost (personal) — pull-only happy path + the NO-PUSH hard guard", () => {
  it("the pull-only cycle materializes the read models, watermarks permissions, acks — and can never push", async () => {
    const harness = makeHarness("personal");
    const { store, server, transport, host, states } = harness;
    seedPermissionSnapshot(server);
    seedStatement(server, PARTNER_ID);
    seedReceipt(server);
    seedNotifications(server, 2);
    seedSalesInvoices(server, 1);

    expect(host.canWrite()).toBe(false); // zero write affordances — ALWAYS
    expect(host.queueStats()).toEqual({ pending: 0, inFlight: 0, rejected: 0, acked: 0 });
    expect(host.rejectedCommands()).toEqual([]);
    expect(host.deviceProfile).toBe("personal");

    const result = await host.boot();
    expect(result.skipped).toBeUndefined();
    expect(result.outcome!.pulled).toBe(6); // 1 permissions + 1 statement + 1 receipt + 2 notifications + 1 sales invoice
    expect(result.outcome!.pushed).toBe(0); // pull-only

    // The read models materialized with the LITE columns (money TEXT).
    expect(store.countRows("statements")).toBe(1);
    const statement = store.get("SELECT * FROM statements WHERE id = ?", [PARTNER_ID]);
    expect(statement?.customer_name).toBe("Partner 1");
    expect(statement?.closing_balance).toBe("150.0000");
    expect(JSON.parse(String(statement?.entries ?? "[]"))[0].docRef).toBe("SAL-2026-000001");
    expect(store.countRows("receipts")).toBe(1);
    expect(store.get("SELECT * FROM receipts WHERE id = ?", ["rc-1"])?.amount).toBe("250.0000");
    expect(store.countRows("notifications")).toBe(2);
    expect(JSON.parse(String(store.get("SELECT * FROM notifications WHERE id = ?", ["n-1"])?.title ?? "{}")).en).toBe("Notice");
    expect(store.countRows("sales_invoices")).toBe(1);
    expect(store.get("SELECT * FROM sales_invoices WHERE id = ?", ["inv-1"])?.customer_id).toBe(PARTNER_ID);

    // The permissions watermark + per-entity cursors + the best-effort ack.
    expect(Number(metaGet(store, "permissionSnapshotAt") ?? "0")).toBeGreaterThan(0);
    expect(readCursor(store, "statements")).toBe("1");
    expect(readCursor(store, "notifications")).toBe("2");
    expect(server.pullAcks.length).toBeGreaterThanOrEqual(4);

    // HostState: idle → syncing → idle.
    expect(host.state.phase).toBe("idle");
    expect(states.map((state) => state.phase)).toEqual(["syncing", "idle"]);

    // THE HARD GUARD — three layers, all observed:
    // (1) pushNow is refused with the dedicated skip reason…
    expect((await host.pushNow()).skipped).toBe("pull-only");
    // (2) …zero push calls EVER reached the (fake) server…
    expect(transport.counts.pushV2).toBe(0);
    expect(transport.counts.push).toBe(0);
    expect(server.pushCalls).toHaveLength(0);
    // (3) …and an enqueue is structurally impossible on the personal
    // store (no outbox table — the engine-level guard).
    expect(() =>
      store.transaction(() => {
        enqueue(store, {
          entityType: "partner",
          intent: "contact_merge",
          payload: { partnerId: PARTNER_ID },
          idempotencyKey: "personal-impossible-1",
        });
      }),
    ).toThrow(/no such table: outbox/);
  });
});

/** Helper: the harness's server (typed access inside describe blocks). */
function server0(harness: Harness): FakeSyncServerV2 {
  return harness.server;
}
