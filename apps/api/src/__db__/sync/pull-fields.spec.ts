import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { ensureTestDb, superuserClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { TransferService } from "../../modules/inventory/application/transfer-service";
import { SalesRepService } from "../../modules/sales/application/reps";
import { RouteService } from "../../modules/distribution/application/route-service";
import { VanStockService } from "../../modules/distribution/application/van-stock-service";
import { SettlementService } from "../../modules/distribution/application/settlement-service";
import * as dStore from "../../modules/distribution/infrastructure/distribution.store";
import { pull, SyncEntityNotPulledError } from "../../modules/sync/application/pull-service";
import { makeSyncServices, seedPosWorld, enrollDevice, type PosWorld } from "./_oracle";

/**
 * PHASE-022 T-P22-1d · DR-P22-05 — the FIELD feed group (MASTER-PLAN §0
 * golden constants + §6; OFFLINE_CAPABILITIES_MATRIX rows 4/5/13/14/33
 * android-field): the server-side pull substrate for the field class over
 * the REAL 020 machinery — feed-group gating (SYNC_ENTITY_NOT_PULLED
 * outside the group, no existence leak), the LITE projections (money as
 * TEXT decimal strings, ADR-0009), the van-stock vanished-key DELETE diff
 * (the PHASE-017 mirror's hard-delete rebuild), and the route-customer
 * statements scope ("the field statements feed serves route customers",
 * MASTER-PLAN §6) with the content-diff catch-up (the permissions-snapshot
 * pattern).
 *
 * Everything rides REAL owning services: the van load/unload chain
 * (registerVan → loadOut → receiveTransfer → unload) refreshes the REAL
 * mirror; the posted credit invoices ride the REAL posting engine (the AR
 * subledger the statements read model computes over); routes + settlement
 * template ride the REAL distribution services. The 021 spec conventions:
 * dedicated tenant, idempotent seeding, direct device rows (the
 * registration surface that writes linked_partner_id in production is 2-b's).
 */

const TENANT = "f1e1d1d1-f1e1-f1e1-f1e1-f1e1f1e1f1e1";
const ACTOR = "f1e1d1d1-0000-4000-8000-000000000001";
const CASHIER = "f1e1d1d1-0000-4000-8000-000000000002";
const REP_USER = "f1e1d1d1-0000-4000-8000-000000000003";
/** P1 = world.customerId (seedPosWorld's route customer); P2–P4 direct rows. */
const P2 = "f1e1d1d1-0000-4000-8000-000000000101";
const P3 = "f1e1d1d1-0000-4000-8000-000000000102";
const P4 = "f1e1d1d1-0000-4000-8000-000000000103";

const INVOICE_NOTE_1 = "F1D statement invoice 1";
const INVOICE_NOTE_2 = "F1D statement invoice 2";
const INVOICE_NOTE_P2 = "F1D statement invoice P2";
const VAN_CODE = "F1D-VAN-01";
const ROUTE_CODE = "F1D-ROUTE-01";
const REP_CODE = "F1D-REP-01";
const SETTLEMENT_DATE = "2026-03-16";

/** The tenant-scoped app client (RLS world) for tombstone read assertions. */
async function tenantClient(): Promise<Client> {
  const client = await (await import("../test-db")).appClient();
  await client.query("SELECT set_config('erp.tenant_id', $1, false)", [TENANT]);
  return client;
}

let world: PosWorld;
let repId = "";
let vanId = "";
let routeId = "";
let settlementId = "";
let fieldDevice = "";
let deskDevice = "";

/** A posted CREDIT invoice for a customer (the REAL create→submit→approve→
 * post chain — the AR subledger entries the statement computes over),
 * idempotent by note (the dedicated-tenant re-seed convention). */
async function ensurePostedCreditInvoice(customerId: string, note: string): Promise<string> {
  const su = await superuserClient();
  const found = await su.query<{ id: string }>(
    `SELECT id FROM sales_invoices WHERE tenant_id = $1 AND note = $2 LIMIT 1`,
    [TENANT, note],
  );
  const existing = found.rows[0]?.id;
  await su.end();
  if (existing !== undefined) {
    return existing;
  }
  const { invoices } = makeSyncServices();
  const invoice = await withTenant(TENANT, () =>
    invoices.create({
      branchId: world.branchId,
      customerId,
      salesRepId: null,
      kind: "CREDIT",
      invoiceDate: "2026-03-15",
      dueDate: null,
      currencyCode: "SAR",
      exchangeRate: null,
      orderId: null,
      deliveryId: null,
      warehouseId: world.warehouseId,
      cashAccountId: null,
      note,
      noteAr: null,
      actorId: REP_USER,
      lines: [
        {
          itemId: world.itemA,
          accountId: null,
          deliveryLineId: null,
          description: null,
          descriptionAr: null,
          qty: "1",
          unitPrice: "100.000000",
          discountAmount: null,
          taxCodeId: world.taxStd,
          batchId: null,
          serialIds: null,
          note: null,
        },
      ],
    }),
  );
  await withTenant(TENANT, () => invoices.submit(invoice.id, REP_USER));
  await withTenant(TENANT, () => invoices.approve(invoice.id, ACTOR, false));
  const posted = await withTenant(TENANT, () => invoices.post(invoice.id, ACTOR));
  return posted.invoice.id;
}

beforeAll(async () => {
  ensureTestDb();
  world = await seedPosWorld({
    tenant: TENANT,
    name: "Tenant F1D (field feeds)",
    nameAr: "مستأجر ١د",
    prefix: "F1D",
    actor: ACTOR,
    cashier: CASHIER,
    salesRep: REP_USER,
  });

  const su = await superuserClient();
  await su.query(
    `INSERT INTO partners (id, tenant_id, kind, code, name) VALUES
       ($1, $4, 'CUSTOMER', 'F1D-CUST-02', 'Field Fixture Partner 2'),
       ($2, $4, 'CUSTOMER', 'F1D-CUST-03', 'Field Fixture Partner 3'),
       ($3, $4, 'CUSTOMER', 'F1D-CUST-04', 'Field Fixture Partner 4')
     ON CONFLICT (id) DO NOTHING`,
    [P2, P3, P4, TENANT],
  );
  await su.end();

  // The REAL distribution chain (idempotent by code — the core.spec guards).
  await withTenant(TENANT, async () => {
    const audit = new AuditService(new DrizzleAuditStore());
    const posting = new PostingService(audit, new PartnerSubledgerService());
    const numbering = new NumberingService(audit);
    const transfers = new TransferService(audit, posting, numbering);
    const repService = new SalesRepService(audit);
    const vans = new VanStockService(audit, transfers);
    const routes = new RouteService(audit);
    const settlements = new SettlementService(audit, posting, numbering);

    const existingReps = await repService.list({ limit: 50 });
    const existingRep = existingReps.find((r) => r.code === REP_CODE);
    repId =
      existingRep?.id ??
      (
        await repService.create({
          code: REP_CODE,
          name: "F1D field rep",
          nameAr: "مندوب ميداني",
          email: null,
          phone: null,
          note: null,
          noteAr: null,
          actorId: ACTOR,
        })
      ).id;

    const existingVans = await dStore.listVans({ limit: 50 });
    const existingVan = existingVans.find((v) => v.code === VAN_CODE);
    vanId =
      existingVan?.id ??
      (
        await vans.registerVan({
          code: VAN_CODE,
          name: "Van 01",
          nameAr: "سيارة التوزيع ٠١",
          branchId: world.branchId,
          salesRepId: repId,
          actorId: ACTOR,
        })
      ).id;

    const existingRoutes = await routes.list({ limit: 50 });
    const existingRoute = existingRoutes.find((r) => r.code === ROUTE_CODE);
    routeId =
      existingRoute?.id ??
      (
        await routes.create({
          code: ROUTE_CODE,
          name: "F1D north route",
          nameAr: "خط الشمال",
          salesRepId: repId,
          vanWarehouseId: vanId,
          dayPattern: ["SUN", "MON", "TUE", "WED", "THU"],
          note: null,
          noteAr: null,
          actorId: ACTOR,
        })
      ).id;
    const existingCustomers = await dStore.listRouteCustomers(routeId);
    if (!existingCustomers.some((c) => c.customerId === P3)) {
      await routes.setCustomers(routeId, {
        // P1 = the world customer (a route customer); P3 the second one.
        customers: [
          { customerId: world.customerId, visitOrder: 1 },
          { customerId: P3, visitOrder: 2 },
        ],
        actorId: ACTOR,
      });
    }

    const suSettlement = await superuserClient();
    const existingSettlement = await suSettlement.query<{ id: string }>(
      `SELECT id FROM rep_settlements WHERE tenant_id = $1 AND sales_rep_id = $2
         AND settlement_date = $3 LIMIT 1`,
      [TENANT, repId, SETTLEMENT_DATE],
    );
    await suSettlement.end();
    settlementId =
      existingSettlement.rows[0]?.id ??
      (
        await settlements.open({
          salesRepId: repId,
          cashAccountId: world.cashAccountId,
          vanWarehouseId: vanId,
          settlementDate: SETTLEMENT_DATE,
          openingCash: "100.0000",
          note: null,
          noteAr: null,
          actorId: REP_USER,
        })
      ).id;

    // The REAL van load: 10 × itemA main → van (loadOut + receiveTransfer
    // refreshes the mirror inside the owning transaction).
    const inTransitVan = (await dStore.listVans({ limit: 50 })).find((v) => v.code === VAN_CODE);
    if (inTransitVan !== undefined) {
      const suMirror = await superuserClient();
      const mirrorCount = await suMirror.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM van_stocks WHERE tenant_id = $1 AND warehouse_id = $2`,
        [TENANT, vanId],
      );
      await suMirror.end();
      if (mirrorCount.rows[0]!.n === 0) {
        const load = await vans.loadOut({
          fromWarehouseId: world.warehouseId,
          vanWarehouseId: vanId,
          lines: [{ itemId: world.itemA, qty: "10" }],
          note: "morning load",
          noteAr: null,
          actorId: REP_USER,
        });
        await vans.receiveTransfer(load.id, { actorId: REP_USER });
      }
    }
  });

  // The statement content source: a REAL posted credit invoice for P1 (the
  // route customer) + one for P2 (a NON-route partner with real AR content —
  // the meaningful negative for the statements scope below).
  await ensurePostedCreditInvoice(world.customerId, INVOICE_NOTE_1);
  await ensurePostedCreditInvoice(P2, INVOICE_NOTE_P2);

  // Devices: the field class (this spec's subject) + a desktop class (the
  // negative group gate). The personal class is pull-personal.spec's subject
  // (its own dedicated tenant — the 020 suite convention: seedPosWorld is
  // once-per-tenant).
  fieldDevice = await enrollDevice(TENANT, ACTOR, { deviceClass: "android-field" });
  deskDevice = await enrollDevice(TENANT, REP_USER, { deviceClass: "tauri-desktop" });
});

afterAll(async () => {
  await closeDb();
});

describe("PHASE-022 T-P22-1d · field feed group (DR-P22-05; MASTER-PLAN §0/§6)", () => {
  it("field pulls van_stocks/routes/settlement_templates within its group — LITE payloads, money as TEXT decimal strings", async () => {
    // van_stocks: the REAL mirror row from the load chain (10 × itemA @60).
    const vanFeed = await withTenant(TENANT, () =>
      pull({ entityType: "van_stocks", cursor: null, deviceId: fieldDevice }),
    );
    expect(vanFeed.entityType).toBe("van_stocks");
    expect(vanFeed.changes).toHaveLength(1);
    const vanEntry = vanFeed.changes[0]!;
    expect(vanEntry.op).toBe("UPSERT");
    expect(vanEntry.version).toBe(1);
    expect(vanEntry.payload).toMatchObject({
      warehouseId: vanId,
      itemId: world.itemA,
      batchId: null,
      // TEXT decimal strings (numeric(19,6)/(19,4) at rest) — ADR-0009.
      qty: "10.000000",
      value: "600.0000",
      version: 1,
    });
    expect(typeof vanEntry.payload?.qty).toBe("string");

    // routes: the header + its ordered customer list (the route-customers
    // read model: P1 + P3, the statements scope for this class).
    const routeFeed = await withTenant(TENANT, () =>
      pull({ entityType: "routes", cursor: null, deviceId: fieldDevice }),
    );
    const routeEntry = routeFeed.changes.find((c) => c.id === routeId);
    expect(routeEntry).toBeDefined();
    expect(routeEntry!.payload).toMatchObject({
      code: ROUTE_CODE,
      status: "ACTIVE",
      salesRepId: repId,
      vanWarehouseId: vanId,
      dayPattern: ["SUN", "MON", "TUE", "WED", "THU"],
    });
    expect(routeEntry!.payload?.customers).toEqual([
      { partnerId: world.customerId, visitOrder: 1, isPinned: false },
      { partnerId: P3, visitOrder: 2, isPinned: false },
    ]);

    // settlement_templates: the DRAFT rep settlement day (settlementNo is
    // NULL until numbering assigns it at posting).
    const settlementFeed = await withTenant(TENANT, () =>
      pull({ entityType: "settlement_templates", cursor: null, deviceId: fieldDevice }),
    );
    const settlementEntry = settlementFeed.changes.find((c) => c.id === settlementId);
    expect(settlementEntry).toBeDefined();
    expect(settlementEntry!.payload).toMatchObject({
      settlementNo: null,
      salesRepId: repId,
      vanWarehouseId: vanId,
      settlementDate: "2026-03-16",
      status: "DRAFT",
      // TEXT 4-dp decimal strings.
      openingCash: "100.0000",
      expectedCash: "0.0000",
      countedCash: null,
      variance: null,
      varianceDirection: null,
    });
  });

  it("van stock DELETE diff: unload the whole load → op:'DELETE' + payload:null + a tombstones row (the vanished key)", async () => {
    // The REAL unload chain: van → main warehouse, the full 10 back.
    await withTenant(TENANT, async () => {
      const audit = new AuditService(new DrizzleAuditStore());
      const posting = new PostingService(audit, new PartnerSubledgerService());
      const numbering = new NumberingService(audit);
      const transfers = new TransferService(audit, posting, numbering);
      const vans = new VanStockService(audit, transfers);
      const suOpen = await superuserClient();
      const openTransfers = await suOpen.query<{ id: string }>(
        `SELECT t.id FROM stock_transfers t JOIN warehouses w ON w.id = t.from_warehouse_id
          WHERE t.tenant_id = $1 AND w.code = $2 AND t.status = 'IN_TRANSIT' LIMIT 1`,
        [TENANT, VAN_CODE],
      );
      await suOpen.end();
      if (openTransfers.rows[0] === undefined) {
        await vans.unload({
          vanWarehouseId: vanId,
          toWarehouseId: world.warehouseId,
          lines: [{ itemId: world.itemA, qty: "10" }],
          note: "end-of-day return",
          noteAr: null,
          actorId: REP_USER,
        });
      }
      // listVanStock refreshes the mirror before reading (the owning
      // transaction's contract) — the van's net for itemA is now 0, so the
      // mirror row VANISHES (HAVING <> 0 in refreshVanStockMirror).
      const mirror = await vans.listVanStock({ warehouseId: vanId, itemId: world.itemA });
      expect(mirror).toHaveLength(0);
    });

    // The catch-up's vanished-key diff: the mirror row fed in the previous
    // test is served as op:'DELETE' + payload:null (the tombstone
    // transport) alongside its original UPSERT in the same full feed.
    const feed = await withTenant(TENANT, () =>
      pull({ entityType: "van_stocks", cursor: null, deviceId: fieldDevice }),
    );
    const upsertIds = feed.changes.filter((c) => c.op === "UPSERT").map((c) => c.id);
    expect(upsertIds).toHaveLength(1);
    const deleteEntry = feed.changes.find(
      (c) => upsertIds.includes(c.id) && c.op === "DELETE",
    );
    expect(deleteEntry).toBeDefined();
    expect(deleteEntry!.payload).toBeNull();
    expect(deleteEntry!.version).toBeNull();

    // The GC ledger row (0029) — readable only through the tenant's RLS.
    const client = await tenantClient();
    const tombstones = await client.query<{ gc_after: string }>(
      `SELECT gc_after FROM tombstones WHERE entity_type = 'van_stocks' AND entity_id = ANY($1)`,
      [upsertIds],
    );
    await client.end();
    expect(tombstones.rows).toHaveLength(1);
    expect(tombstones.rows[0]!.gc_after).not.toBeNull();

    // Idempotence: the NEXT catch-up emits nothing new for the vanished key
    // (its last-fed op is DELETE now — a quiet tenant's feed stays quiet).
    const quiet = await withTenant(TENANT, () =>
      pull({ entityType: "van_stocks", cursor: feed.cursor, deviceId: fieldDevice }),
    );
    expect(quiet.changes).toHaveLength(0);
    expect(quiet.hasMore).toBe(false);
  });

  it("field statements: route customers ONLY — P1 (the posted invoice entry) + P3 (empty), never a non-route partner", async () => {
    const feed = await withTenant(TENANT, () =>
      pull({ entityType: "statements", cursor: null, deviceId: fieldDevice, limit: 100 }),
    );
    // The change ids ARE partner ids (the per-partner synthetic feed).
    const ids = feed.changes.map((c) => c.id);
    expect(ids).toContain(world.customerId);
    expect(ids).toContain(P3);
    expect(ids).not.toContain(P2);
    expect(ids).not.toContain(P4);

    // P1's statement carries the REAL posted-invoice content: one entry,
    // the running balance chain ties to the closing balance.
    const p1 = feed.changes.find((c) => c.id === world.customerId)!;
    expect(p1.op).toBe("UPSERT");
    expect(p1.version).toBeNull(); // synthetic snapshot — no server row version
    const payload = p1.payload as {
      partnerId: string;
      customerCode: string;
      asOf: string;
      entries: {
        debit: string;
        docRef: string | null;
        sourceType: string;
        balance: string;
      }[];
      closingBalance: string;
      closingBalanceBase: string;
      generatedAt: string;
      aging: Record<string, string>;
    };
    expect(payload.partnerId).toBe(world.customerId);
    expect(payload.customerCode).toBe("F1D-CUST-01");
    expect(payload.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(payload.entries).toHaveLength(1);
    expect(Number(payload.entries[0]!.debit)).toBeGreaterThan(0);
    // The posted invoice's official number (SAL_FORMAT "SAL-{YYYY}-{SEQ:6}",
    // invoices.ts) — the AR subledger entry's docRef.
    expect(payload.entries[0]!.docRef).toMatch(/^SAL-\d{4}-\d{6}$/);
    expect(payload.closingBalance).toBe(payload.entries[0]!.balance);
    expect(Number(payload.closingBalance)).toBeGreaterThan(0);
    expect(payload.closingBalanceBase).toBe(payload.closingBalance); // SAR base 1:1
    expect(typeof payload.generatedAt).toBe("string");
    for (const bucket of Object.values(payload.aging)) {
      expect(typeof bucket).toBe("string");
    }

    // P3 (route customer, no documents): an honest empty statement.
    const p3 = feed.changes.find((c) => c.id === P3)!;
    const p3Payload = p3.payload as { entries: unknown[]; closingBalance: string };
    expect(p3Payload.entries).toHaveLength(0);
    expect(p3Payload.closingBalance).toBe("0.0000");

    // No duplicate append on a re-pull from the returned cursor (the
    // content-diff catch-up: same content → no new row).
    const idle = await withTenant(TENANT, () =>
      pull({ entityType: "statements", cursor: feed.cursor, deviceId: fieldDevice }),
    );
    expect(idle.changes).toHaveLength(0);
    expect(idle.hasMore).toBe(false);
  });

  it("statement content-diff: a second posted invoice → the next pull serves the UPDATED snapshot (a new row, the old one intact)", async () => {
    // A REAL second posted invoice for P1 (1 × itemA @100 + STD 15%).
    await ensurePostedCreditInvoice(world.customerId, INVOICE_NOTE_2);

    const feed = await withTenant(TENANT, () =>
      pull({ entityType: "statements", cursor: null, deviceId: fieldDevice, limit: 100 }),
    );
    // Two snapshots for P1 in seq order: the append-only content diff (the
    // client applies last-writer-wins per partner id).
    const p1Rows = feed.changes.filter((c) => c.id === world.customerId);
    expect(p1Rows).toHaveLength(2);
    const v1 = p1Rows[0]!.payload as { entries: unknown[]; closingBalance: string };
    const v2 = p1Rows[1]!.payload as {
      entries: { debit: string; balance: string }[];
      closingBalance: string;
    };
    expect(v1.entries).toHaveLength(1);
    expect(v2.entries).toHaveLength(2);
    expect(Number(v2.entries[1]!.debit)).toBeGreaterThan(0);
    // The running balance chain: the last entry's balance IS the closing.
    expect(v2.closingBalance).toBe(v2.entries[1]!.balance);
    expect(Number(v2.closingBalance)).toBeGreaterThan(Number(v1.closingBalance));
  });

  it("outside the field group: SYNC_ENTITY_NOT_PULLED (personal-only entities, other classes, the 016 no-device path)", async () => {
    // Personal-only entities are NOT in the field group.
    for (const entityType of ["receipts", "notifications"] as const) {
      await expect(
        withTenant(TENANT, () => pull({ entityType, cursor: null, deviceId: fieldDevice })),
      ).rejects.toBeInstanceOf(SyncEntityNotPulledError);
    }
    // A desktop-class device cannot pull the field entities (the frozen 020
    // desktop scope: POS group + sales_invoices only).
    await expect(
      withTenant(TENANT, () =>
        pull({ entityType: "van_stocks", cursor: null, deviceId: deskDevice }),
      ),
    ).rejects.toMatchObject({ code: "SYNC_ENTITY_NOT_PULLED" });
    await expect(
      withTenant(TENANT, () =>
        pull({ entityType: "statements", cursor: null, deviceId: deskDevice }),
      ),
    ).rejects.toMatchObject({ code: "SYNC_ENTITY_NOT_PULLED" });
    // The 016 session path (no device) resolves the pos group — statements
    // and van_stocks stay out (no existence leak).
    await expect(
      withTenant(TENANT, () => pull({ entityType: "statements", cursor: null })),
    ).rejects.toMatchObject({ code: "SYNC_ENTITY_NOT_PULLED" });
    await expect(
      withTenant(TENANT, () => pull({ entityType: "van_stocks", cursor: null })),
    ).rejects.toMatchObject({ code: "SYNC_ENTITY_NOT_PULLED" });

    // The field device still pulls its POS-group base (the 020 inheritance
    // — items/partners ride the field group unchanged).
    const items = await withTenant(TENANT, () =>
      pull({ entityType: "items", cursor: null, deviceId: fieldDevice }),
    );
    expect(items.changes.map((c) => c.id)).toContain(world.itemA);
  });
});
