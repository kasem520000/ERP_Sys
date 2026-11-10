import { beforeAll, describe, expect, it } from "vitest";
import { Decimal } from "@erp/domain-core";

import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { TransferService } from "../../modules/inventory/application/transfer-service";
import { SalesRepService } from "../../modules/sales/application/reps";
import { RouteService } from "../../modules/distribution/application/route-service";
import { VisitService } from "../../modules/distribution/application/visit-service";
import { VanStockService } from "../../modules/distribution/application/van-stock-service";
import * as dStore from "../../modules/distribution/infrastructure/distribution.store";
import { S_ACTOR, TENANT_S, quickPostedInvoice, setupSalesFixture, type SalesFixture } from "../sales/fixtures";

/**
 * PHASE-017 T7/T8 distribution core packs (DB-backed on the real sales
 * fixture, tenant S): route CRUD + composition + idempotent visit planning
 * with the weekday gate, the PLANNING-ONLY invariant (no route/visit
 * operation ever writes a journal — CAPABILITY_MATRIX §2.4), the van
 * registry (VAN warehouse + one-van-per-rep binding), and van stock
 * conservation through load-out → receive → unload riding the REAL
 * TransferService (BR-016: in-transit is never sellable — the mirror stays
 * 0 until the IN leg lands; shared INVENTORY account ⇒ no journal at all).
 */

let fixture: SalesFixture;
let routes: RouteService;
let visits: VisitService;
let vans: VanStockService;
let repId = "";
let secondRepId = "";
let vanId = "";

beforeAll(async () => {
  fixture = await setupSalesFixture();
  const audit = new AuditService(new DrizzleAuditStore());
  const posting = new PostingService(audit, new PartnerSubledgerService());
  const numbering = new NumberingService(audit);
  const transferService = new TransferService(audit, posting, numbering);
  routes = new RouteService(audit);
  visits = new VisitService(audit);
  vans = new VanStockService(audit, transferService);

  await withTenant(TENANT_S, async () => {
    // The route's rep (idempotent — the suite db may persist across runs).
    const repService = new SalesRepService(audit);
    const existingReps = await repService.list({ limit: 50 });
    const existingRep = existingReps.find((r) => r.code === "D-REP-01");
    repId =
      existingRep?.id ??
      (
        await repService.create({
          code: "D-REP-01",
          name: "Field rep one",
          nameAr: "مندوب ميداني",
          email: null,
          phone: null,
          note: null,
          noteAr: null,
          actorId: S_ACTOR,
        })
      ).id;

    // A second rep (the one-van-per-rep + code-collision packs).
    const secondRep = existingReps.find((r) => r.code === "D-REP-02");
    secondRepId =
      secondRep?.id ??
      (
        await repService.create({
          code: "D-REP-02",
          name: "Field rep two",
          nameAr: null,
          email: null,
          phone: null,
          note: null,
          noteAr: null,
          actorId: S_ACTOR,
        })
      ).id;

    // The van (idempotent register through the real service).
    const existingVans = await dStore.listVans({ limit: 50 });
    const existingVan = existingVans.find((v) => v.code === "D-VAN-01");
    vanId =
      existingVan?.id ??
      (
        await vans.registerVan({
          code: "D-VAN-01",
          name: "Van 01",
          nameAr: "سيارة توزيع ٠١",
          branchId: fixture.branchId,
          salesRepId: repId,
          actorId: S_ACTOR,
        })
      ).id;
  });
});

/** Journal count over the whole tenant — the planning-only / no-journal probe. */
async function countJournals(): Promise<number> {
  return withTenant(TENANT_S, async () => {
    const { sql } = await import("drizzle-orm");
    const { requireTenantContext } = await import("../../infra/db/tenant-context");
    const rows = await requireTenantContext().tx!.execute(
      sql`SELECT count(*)::int AS n FROM journal_entries`,
    );
    return (rows.rows as unknown as { n: number }[])[0]!.n;
  });
}

/** Σ signed stock_moves qty for a warehouse — the conservation side. */
async function signedMoveQty(warehouseId: string, itemId: string): Promise<string> {
  return withTenant(TENANT_S, async () => {
    const { sql } = await import("drizzle-orm");
    const { requireTenantContext } = await import("../../infra/db/tenant-context");
    const rows = await requireTenantContext().tx!.execute(sql`
      SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN qty ELSE -qty END), 0)::text AS q
      FROM stock_moves WHERE warehouse_id = ${warehouseId} AND item_id = ${itemId}
    `);
    return (rows.rows as unknown as { q: string }[])[0]!.q;
  });
}

describe("PHASE-017 T7 routes + visits: planning-only core", () => {
  it("route CRUD + composition + idempotent planVisits with the weekday gate; planning posts NOTHING", async () => {
    const journalsAtStart = await countJournals();

    // Create (code unique, rep ACTIVE, day pattern validated).
    const route = await withTenant(TENANT_S, () =>
      routes.create({
        code: "RT-NORTH",
        name: "North route",
        nameAr: "خط الشمال",
        salesRepId: repId,
        dayPattern: ["MON", "TUE", "WED", "THU", "FRI"],
        note: null,
        noteAr: null,
        actorId: S_ACTOR,
      }),
    );
    expect(route.status).toBe("ACTIVE");
    expect(route.salesRepCode).toBe("D-REP-01");
    expect(route.dayPattern).toEqual(["MON", "TUE", "WED", "THU", "FRI"]);

    // Duplicate code → typed error.
    await expect(
      withTenant(TENANT_S, () =>
        routes.create({ code: "RT-NORTH", name: "dupe", actorId: S_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "ROUTE_CODE_TAKEN" });

    // Invalid day pattern → typed planning error.
    await expect(
      withTenant(TENANT_S, () =>
        routes.create({ code: "RT-BAD", name: "bad", dayPattern: ["FRI", "XYZ"], actorId: S_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "ROUTE_PLANNING_INVALID" });

    // Find + list.
    expect((await withTenant(TENANT_S, () => routes.find(route.id))).code).toBe("RT-NORTH");
    const listed = await withTenant(TENANT_S, () => routes.list({ status: "ACTIVE", limit: 50 }));
    expect(listed.some((r) => r.id === route.id)).toBe(true);

    // Update: rename + status round-trip.
    const updated = await withTenant(TENANT_S, () =>
      routes.update(route.id, { name: "North route A", status: "INACTIVE" }, S_ACTOR),
    );
    expect(updated.name).toBe("North route A");
    expect(updated.status).toBe("INACTIVE");
    await withTenant(TENANT_S, () => routes.update(route.id, { status: "ACTIVE" }, S_ACTOR));

    // Composition: duplicates and unknown partners are typed planning errors.
    await expect(
      withTenant(TENANT_S, () =>
        routes.setCustomers(route.id, {
          customers: [
            { customerId: fixture.customerId },
            { customerId: fixture.customerId },
          ],
          actorId: S_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "ROUTE_PLANNING_INVALID" });
    await expect(
      withTenant(TENANT_S, () =>
        routes.setCustomers(route.id, {
          customers: [{ customerId: "00000000-0000-4000-8000-0000000000ff" }],
          actorId: S_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "ROUTE_PLANNING_INVALID" });

    const set = await withTenant(TENANT_S, () =>
      routes.setCustomers(route.id, {
        customers: [
          { customerId: fixture.customerId, isPinned: true },
          { customerId: fixture.limitedCustomerId },
        ],
        actorId: S_ACTOR,
      }),
    );
    expect(set).toHaveLength(2);
    expect(set[0]!.visitOrder).toBe(1);
    expect(set[0]!.isPinned).toBe(true);
    expect(set[1]!.visitOrder).toBe(2);
    expect(set[0]!.customerName).not.toBeNull();

    // planVisits: 2026-01-15 is a THURSDAY (in pattern) → 2 PLANNED visits.
    const planned = await withTenant(TENANT_S, () =>
      routes.planVisits(route.id, { date: "2026-01-15", actorId: S_ACTOR }),
    );
    expect(planned.planned).toBe(2);
    expect(planned.visits).toHaveLength(2);
    expect(planned.visits.every((v) => v.status === "PLANNED")).toBe(true);
    expect(planned.visits.every((v) => v.salesRepId === repId)).toBe(true);
    expect(planned.visits[0]!.routeCode).toBe("RT-NORTH");
    expect(planned.visits[0]!.customerName).not.toBeNull();

    // Idempotent: re-planning the same date creates nothing.
    const replanned = await withTenant(TENANT_S, () =>
      routes.planVisits(route.id, { date: "2026-01-15", actorId: S_ACTOR }),
    );
    expect(replanned.planned).toBe(0);
    expect(replanned.skipped).toBe(2);
    expect(replanned.visits).toHaveLength(2);

    // Wrong weekday (2026-01-17 is a Saturday) → typed planning error.
    await expect(
      withTenant(TENANT_S, () => routes.planVisits(route.id, { date: "2026-01-17", actorId: S_ACTOR })),
    ).rejects.toMatchObject({ code: "ROUTE_PLANNING_INVALID" });

    // visitsForRoute + board read.
    const forRoute = await withTenant(TENANT_S, () => routes.visitsForRoute(route.id, "2026-01-15"));
    expect(forRoute).toHaveLength(2);
    const board = await withTenant(TENANT_S, () => visits.list({ date: "2026-01-15" }));
    expect(board.length).toBeGreaterThanOrEqual(2);

    // PLANNING-ONLY (CAPABILITY_MATRIX §2.4): nothing above posted a journal.
    expect(await countJournals()).toBe(journalsAtStart);
  });

  it("planning-only invariant: a full second route's plan/check-in-free lifecycle leaves the ledger untouched", async () => {
    const journalsAtStart = await countJournals();
    const route = await withTenant(TENANT_S, () =>
      routes.create({
        code: "RT-SOUTH",
        name: "South route",
        dayPattern: ["MON"],
        actorId: S_ACTOR,
      }),
    );
    await withTenant(TENANT_S, () =>
      routes.setCustomers(route.id, {
        customers: [{ customerId: fixture.limitedCustomerId }],
        actorId: S_ACTOR,
      }),
    );
    const planned = await withTenant(TENANT_S, () =>
      routes.planVisits(route.id, { date: "2026-02-16", actorId: S_ACTOR }),
    );
    expect(planned.planned).toBe(1);
    // An unknown route id is the typed not-found.
    await expect(
      withTenant(TENANT_S, () => routes.find("00000000-0000-4000-8000-0000000000f1")),
    ).rejects.toMatchObject({ code: "ROUTE_NOT_FOUND" });
    // Binding a route to a STANDARD warehouse is not a van (typed error).
    await expect(
      withTenant(TENANT_S, () =>
        routes.create({
          code: "RT-WH",
          name: "bad van",
          vanWarehouseId: fixture.warehouseId,
          actorId: S_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "VAN_NOT_FOUND" });
    expect(await countJournals()).toBe(journalsAtStart);
  });
});

describe("PHASE-017 T8 vans + van stock: registry, BR-016, conservation", () => {
  it("registerVan creates a VAN warehouse bound to the rep; a rep never drives two vans", async () => {
    const van = await withTenant(TENANT_S, () => dStore.findVanByWarehouseId(vanId));
    expect(van?.type).toBe("VAN");
    expect(van?.code).toBe("D-VAN-01");
    expect(van?.salesRepId).toBe(repId);
    expect(van?.salesRepCode).toBe("D-REP-01");
    expect(van?.isActive).toBe(true);

    const all = await withTenant(TENANT_S, () => vans.listVans());
    expect(all.some((v) => v.id === vanId)).toBe(true);

    // One van per rep (uq_warehouses_tenant_rep) → typed binding error.
    await expect(
      withTenant(TENANT_S, () =>
        vans.registerVan({
          code: "D-VAN-02",
          name: "Van 02",
          branchId: fixture.branchId,
          salesRepId: repId,
          actorId: S_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "VAN_REP_BINDING" });

    // Van codes live in the warehouse code namespace (uq_warehouses_tenant_code
    // — typed, surfaced through a SECOND rep so the rep gate doesn't shadow it).
    await expect(
      withTenant(TENANT_S, () =>
        vans.registerVan({
          code: "S-WH",
          name: "code clash",
          branchId: fixture.branchId,
          salesRepId: secondRepId,
          actorId: S_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "VAN_CODE_TAKEN" });
  });

  it("load-out → IN_TRANSIT (mirror 0, BR-016) → receive (mirror 5) → unload 2 (mirror 3); conservation ties to stock_moves; NO journal (shared inventory account)", async () => {
    const journalsAtStart = await countJournals();

    // Load-out 5 × item a from the fixture warehouse.
    const load = await withTenant(TENANT_S, () =>
      vans.loadOut({
        fromWarehouseId: fixture.warehouseId,
        vanWarehouseId: vanId,
        lines: [{ itemId: fixture.items.a, qty: "5" }],
        note: "morning load",
        noteAr: "تحميل صباحي",
        actorId: S_ACTOR,
      }),
    );
    expect(load.status).toBe("IN_TRANSIT");
    expect(load.transferNo).toMatch(/^TRN-\d{4}-\d{6}$/);

    // BR-016: the load is in transit — the van mirror is still EMPTY
    // (in-transit stock never sellable; only the OUT leg exists, at source).
    const inTransitMirror = await withTenant(TENANT_S, () =>
      vans.listVanStock({ warehouseId: vanId }),
    );
    expect(inTransitMirror).toHaveLength(0);

    // Load-out guards: source ≡ van and empty lines are typed errors.
    await expect(
      withTenant(TENANT_S, () =>
        vans.loadOut({
          fromWarehouseId: vanId,
          vanWarehouseId: vanId,
          lines: [{ itemId: fixture.items.a, qty: "1" }],
          actorId: S_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "VAN_LOAD_OUT" });
    await expect(
      withTenant(TENANT_S, () =>
        vans.loadOut({
          fromWarehouseId: fixture.warehouseId,
          vanWarehouseId: vanId,
          lines: [],
          actorId: S_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "VAN_LOAD_OUT" });

    // Receive: the IN leg lands at the carried cost (5 × 60.000000 WAC).
    const received = await withTenant(TENANT_S, () =>
      vans.receiveTransfer(load.id, { actorId: S_ACTOR }),
    );
    expect(received.status).toBe("POSTED");

    const afterReceive = await withTenant(TENANT_S, () =>
      vans.listVanStock({ warehouseId: vanId }),
    );
    expect(afterReceive).toHaveLength(1);
    expect(afterReceive[0]!.itemId).toBe(fixture.items.a);
    expect(new Decimal(afterReceive[0]!.qty).toFixed(6)).toBe("5.000000");
    expect(new Decimal(afterReceive[0]!.value).toFixed(4)).toBe("300.0000");

    // Unload 2 back to the fixture warehouse → mirror 3.
    const unload = await withTenant(TENANT_S, () =>
      vans.unload({
        vanWarehouseId: vanId,
        toWarehouseId: fixture.warehouseId,
        lines: [{ itemId: fixture.items.a, qty: "2" }],
        note: "end-of-day return",
        actorId: S_ACTOR,
      }),
    );
    expect(unload.status).toBe("IN_TRANSIT");

    const afterUnload = await withTenant(TENANT_S, () =>
      vans.listVanStock({ warehouseId: vanId }),
    );
    expect(new Decimal(afterUnload[0]!.qty).toFixed(6)).toBe("3.000000");

    // CONSERVATION TIE: Σ signed stock_moves at the van == the mirror qty
    // (+5 transfer_in − 2 transfer_out = 3).
    const moves = await signedMoveQty(vanId, fixture.items.a);
    expect(new Decimal(moves).toFixed(6)).toBe(new Decimal(afterUnload[0]!.qty).toFixed(6));

    // Balances surface the same total per van.
    const balances = await withTenant(TENANT_S, () => vans.balances({ warehouseId: vanId }));
    expect(balances).toHaveLength(1);
    expect(new Decimal(balances[0]!.totalQty).toFixed(6)).toBe("3.000000");

    // Shared INVENTORY account (both warehouses NULL → the tenant purpose)
    // ⇒ the transfers posted NO journal at all through the whole chain.
    expect(await countJournals()).toBe(journalsAtStart);
  });
});

describe("PHASE-017 T7 visit lifecycle: check-in, completion links, skip, missed sweep", () => {
  it("checkIn → complete with a real posted invoice; skip; markMissedVisits flips stale PLANNED", async () => {
    // Two fresh visits on Monday 2026-01-12 (RT-NORTH composition).
    const route = (await withTenant(TENANT_S, () => routes.list({ limit: 50 }))).find(
      (r) => r.code === "RT-NORTH",
    )!;
    const planned = await withTenant(TENANT_S, () =>
      routes.planVisits(route.id, { date: "2026-01-12", actorId: S_ACTOR }),
    );
    expect(planned.planned).toBe(2);
    const target = planned.visits.find((v) => v.customerId === fixture.customerId)!;
    const other = planned.visits.find((v) => v.customerId === fixture.limitedCustomerId)!;

    const journalsBeforeVisitOps = await countJournals();

    // Check-in stamps the time; a second check-in is a typed state error.
    const checkedIn = await withTenant(TENANT_S, () =>
      visits.checkIn(target.id, { note: "arrived", actorId: S_ACTOR }),
    );
    expect(checkedIn.checkedInAt).not.toBeNull();
    expect(checkedIn.status).toBe("PLANNED");
    await expect(
      withTenant(TENANT_S, () => visits.checkIn(target.id, { actorId: S_ACTOR })),
    ).rejects.toMatchObject({ code: "VISIT_STATE" });

    // A dangling completion link is a typed error (EXISTS-validated).
    await expect(
      withTenant(TENANT_S, () =>
        visits.complete(target.id, {
          salesInvoiceId: "00000000-0000-4000-8000-0000000000f9",
          actorId: S_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "VISIT_DOCUMENT_NOT_FOUND" });

    // Complete against a REAL posted invoice (the sales fixture helper).
    const invoiceId = await quickPostedInvoice("distribution visit completion");
    const journalsAfterInvoice = await countJournals();
    expect(journalsAfterInvoice).toBe(journalsBeforeVisitOps + 1); // the invoice's own posting
    const completed = await withTenant(TENANT_S, () =>
      visits.complete(target.id, { salesInvoiceId: invoiceId, actorId: S_ACTOR }),
    );
    expect(completed.status).toBe("COMPLETED");
    expect(completed.checkedOutAt).not.toBeNull();
    expect(completed.salesInvoiceId).toBe(invoiceId);
    await expect(
      withTenant(TENANT_S, () => visits.complete(target.id, { actorId: S_ACTOR })),
    ).rejects.toMatchObject({ code: "VISIT_STATE" });

    // Skip the other stop; re-skip is a typed state error.
    const skipped = await withTenant(TENANT_S, () =>
      visits.skip(other.id, { note: "customer closed", actorId: S_ACTOR }),
    );
    expect(skipped.status).toBe("SKIPPED");
    await expect(
      withTenant(TENANT_S, () => visits.skip(other.id, { actorId: S_ACTOR })),
    ).rejects.toMatchObject({ code: "VISIT_STATE" });

    // Missed sweep (report hygiene): COMPLETED/SKIPPED stops on 2026-01-12
    // never flip, and nothing older is stale at this point → 0 flipped here
    // (the genuinely-stale flip is the pack below).
    const swept = await withTenant(TENANT_S, () => visits.markMissedVisits("2026-01-13"));
    expect(swept.missed).toBe(0);
    const afterSweep = await withTenant(TENANT_S, () => visits.find(target.id));
    expect(afterSweep.status).toBe("COMPLETED"); // completed stops never flip

    // The visit operations themselves posted nothing beyond the invoice.
    expect(await countJournals()).toBe(journalsAfterInvoice);
  });

  it("markMissedVisits flips a genuinely stale PLANNED visit to MISSED", async () => {
    const route = (await withTenant(TENANT_S, () => routes.list({ limit: 50 }))).find(
      (r) => r.code === "RT-SOUTH",
    )!;
    const planned = await withTenant(TENANT_S, () =>
      routes.planVisits(route.id, { date: "2026-01-05", actorId: S_ACTOR }),
    );
    expect(planned.planned).toBe(1);
    const stale = planned.visits[0]!;
    expect(stale.status).toBe("PLANNED");

    const swept = await withTenant(TENANT_S, () => visits.markMissedVisits("2026-01-13"));
    expect(swept.visitIds).toContain(stale.id);
    const missed = await withTenant(TENANT_S, () => visits.find(stale.id));
    expect(missed.status).toBe("MISSED");
    // A MISSED visit no longer mutates.
    await expect(
      withTenant(TENANT_S, () => visits.skip(stale.id, { actorId: S_ACTOR })),
    ).rejects.toMatchObject({ code: "VISIT_STATE" });
  });
});
