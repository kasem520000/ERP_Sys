import { beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";
import { sql } from "drizzle-orm";

import { Decimal } from "@erp/domain-core";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import * as itemsStore from "../../modules/items/infrastructure/items.store";
import * as invStore from "../../modules/inventory/infrastructure/inventory.store";
import * as salesStore from "../../modules/sales/infrastructure/sales.store";
import { DeliveryNoteService } from "../../modules/sales/application/deliveries";
import { SalesOrderService } from "../../modules/sales/application/orders";
import { AtpService } from "../../modules/manufacturing/application/atp-service";
import { PickingService } from "../../modules/inventory/application/picking-service";
import { StockService } from "../../modules/inventory/application/stock-service";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import {
  M_ACTOR,
  TENANT_M,
  boms,
  orders,
  reservations,
  setupMfgFixture,
  stock,
  type MfgFixture,
} from "./fixtures";

/**
 * THE RESERVATION HARD PROTECTION (the PHASE-043 completion round — the
 * owner's directive after accepting the round-4 race fix): the MTO
 * reservation must be protected ACTUALLY, per the original phase
 * criterion —
 *
 *   1. NO other order or issue path can consume the reserved quantity
 *      without an explicit authorized action;
 *   2. the CORRECT beneficiary can consume it — partial delivery,
 *      cancellation, closing, surplus, concurrency, and rollback all
 *      supported;
 *   3. any unlock (taking reserved stock as anyone else) needs the
 *      permission-gated, audited release — never a silent bypass.
 *
 * THE PRE-FIX TRUTH (the round-2 soft-model declaration, pinned by
 * reservation-basis.spec test (c) until this round): a reservation was
 * an AVAILABILITY-level hold only — it netted ATP, the MRP basis, and
 * later reservations' capacity, but NEVER physically locked the goods:
 * the issue paths checked ON-HAND only, so another order's delivery
 * could ship the reserved stock and leave an unbacked ACTIVE holder.
 *
 * THE POST-FIX CONTRACT (implemented + pinned here):
 *
 * - THE GUARD (movement-core planIssue, inside the item_stock row lock
 *   every issue already takes): an issue may never take the position
 *   below the ACTIVE reserved pool it is not entitled to draw on —
 *     onHand − qty ≥ reservedPool − allowance
 *   where reservedPool = Σ ACTIVE non-expired stock_reservations at the
 *   item+warehouse (read UNDER the lock — every reservation creation
 *   takes the same lock first, so the pool cannot grow beneath the
 *   issue; concurrent releases only shrink it, which relaxes the guard
 *   — fail-closed in the strict direction), and allowance = the qty of
 *   the pool THIS issue is entitled to draw: the beneficiary delivery's
 *   own line reservation (ACTIVE, non-expired) + the ACTIVE MTO chain
 *   reservations feeding that line. Every other caller passes no
 *   allowance → FREE STOCK ONLY. The typed error is
 *   RESERVED_STOCK_PROTECTED (machine-readable detail: onHand, pool,
 *   allowance, free-for-others).
 *
 * - THE ALLOWANCE IS VERIFIED BY THE SETTLEMENT (why a stale allowance
 *   can never steal): the delivery's settlement retires the shipped qty
 *   through EXACTLY the allowance's source rows (the MTO chain first,
 *   then the line's own reservation — the round-2 settlement contract)
 *   and every retirement is a conditional row update (WHERE status =
 *   'ACTIVE', fail-closed on non-ACTIVE and on over-consume). A
 *   concurrent release of an allowance row makes the settlement THROW
 *   → the WHOLE delivery post rolls back (the issue with it); a
 *   concurrent release that commits AFTER the settlement's row update
 *   finds the row CONSUMED and itself fails. The stock_reservations
 *   row lock is the verifier — no new lock, no new lock order.
 *
 * - THE LOCK ORDER IS UNCHANGED (round-4's star, preserved): the guard
 *   adds NO lock (a plain indexed SUM under the already-held item_stock
 *   row lock); the release/consume paths stay lock-free on item_stock
 *   (a termination still acquires ONLY the sales header first — the
 *   round-4 law "a termination never touches item_stock" holds); a
 *   delivery still never locks the header. No cycle can form.
 *
 * - THE EXPLICIT AUTHORIZED UNLOCK: taking reserved stock as anyone
 *   other than the beneficiary requires the release first — the
 *   permission-gated route (`inventory.reservations` feature +
 *   `inventory.stock.view` permission in ROUTE_PERMISSIONS) whose
 *   service writes the `inventory.reservation_released` audit event.
 *   There is NO bypass parameter on any issue path — the only door is
 *   the audited release.
 *
 * - ATP FOR UNRESERVED DEMAND STAYS ADVISORY (the owner's explicit
 *   direction): the OK stamp is guidance, never a guarantee —
 *   unreserved sibling demand still does not reduce the basis, a
 *   backorder remains possible, and a stock shortage NEVER blocks
 *   issuing a sales order. The sales line's ATP check now answers with
 *   an explicit protection standing: PROTECTED_BY_RESERVATION (an
 *   ACTIVE allocation feeds the line) or UNPROTECTED (the verdict is
 *   advisory only — never describe it as a guaranteed promise before
 *   an allocation protects it).
 */

const specAudit = new AuditService(new DrizzleAuditStore());
const specPosting = new PostingService(specAudit, new PartnerSubledgerService());
const specNumbering = new NumberingService(specAudit);
const deliveries = new DeliveryNoteService(
  specAudit,
  specPosting,
  specNumbering,
  new PickingService(specAudit, specNumbering),
);
const salesOrdersSvc = new SalesOrderService(specAudit, specNumbering, new AtpService());
const stockSvc = new StockService(specAudit, specPosting);

const spec: { fixture?: MfgFixture; matItem?: string } = {};

let chainSeq = 0;

async function ensureItem(sku: string, name: string): Promise<string> {
  const found = await itemsStore.findItemBySku(sku);
  if (found !== undefined) return found.id;
  const uoms = await itemsStore.listUoms();
  const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
  const created = await itemsStore.insertItem({
    sku,
    name,
    nameAr: null,
    kind: "STOCK",
    uomId: pcs.id,
    categoryId: null,
    taxCodeId: null,
    costingMethod: "WAC",
    trackBatch: true,
    trackSerial: false,
    trackImei: false,
    hasExpiry: true,
    shelfLifeDays: 365,
    reorderLevel: null,
    reorderQty: null,
    basePrice: null,
  });
  return created.id;
}

interface ProtectedChain {
  /** The linked MO (IN_PROGRESS, consumed, one complete() away). */
  moId: string;
  salesOrderId: string;
  fgLineId: string;
  fgItem: string;
}

/** A dedicated-FG-item MTO chain parked one complete() away from done
 * (the race spec's pattern): the per-scenario FG item keeps every
 * protection assertion answerable for THIS chain alone. */
async function buildChain(label: string): Promise<ProtectedChain> {
  const f = spec.fixture!;
  chainSeq += 1;
  const stamp = `${Date.now() % 100000}-${chainSeq}`;
  return withTenant(TENANT_M, async () => {
    const fgItem = await ensureItem(
      `M-HP-${label}-${stamp}`,
      `hard protection FG (${label})`,
    );
    const draft = await boms.create({
      itemId: fgItem,
      outputUomId: (await itemsStore.findItemById(fgItem))!.uomId,
      yieldPct: "100.0000",
      mainAllocationPct: "100.0000",
      note: `hard protection BOM (${label})`,
      noteAr: null,
      actorId: M_ACTOR,
      lines: [{ componentItemId: spec.matItem!, qtyPerOutput: "1.000000", scrapPct: "0" }],
    });
    const activeBom = await boms.activate(draft.id, {
      effectiveFrom: "2026-03-01",
      actorId: M_ACTOR,
    });
    await stock.manualReceipt({
      itemId: spec.matItem!,
      warehouseId: f.warehouseRaw,
      qty: "30",
      unitCost: "4.000000",
      reason: "COUNT_GAIN",
      counterAccountId: null,
      valueDate: "2026-03-01",
      batchNo: `M-HP-${label}-MAT-${stamp}`,
      batchExpiry: "2027-01-01",
      actorId: M_ACTOR,
    });
    const salesOrder = await salesStore.insertSalesOrder({
      branchId: f.branchId,
      customerId: f.customerId,
      salesRepId: null,
      warehouseId: f.warehouseFg,
      quotationId: null,
      orderDate: "2026-03-01",
      expectedDate: "2026-03-20",
      currencyCode: "SAR",
      exchangeRate: null,
      note: `hard protection order (${label})`,
      noteAr: null,
      actorId: null,
      totalNet: "100.0000",
      totalTax: "0.0000",
      totalGross: "100.0000",
      lines: [
        {
          itemId: fgItem,
          description: "hard protection FG line",
          descriptionAr: null,
          qty: "10",
          unitPrice: "10.000000",
          discountAmount: "0.000000",
          taxCodeId: f.taxCodeIds.notSubject,
          netAmount: "100.0000",
          taxAmount: "0.0000",
          note: null,
        },
      ],
    });
    await salesOrdersSvc.submit(salesOrder.id, M_ACTOR);
    await salesOrdersSvc.approve(salesOrder.id, M_ACTOR);
    await salesOrdersSvc.issue(salesOrder.id, M_ACTOR);
    const fgLine = (await salesStore.listSalesOrderLines(salesOrder.id))[0]!;
    const order = await orders.create({
      branchId: f.branchId,
      itemId: fgItem,
      bomId: activeBom.id,
      plannedQty: "10",
      plannedDate: "2026-03-18",
      materialsWarehouseId: f.warehouseRaw,
      fgWarehouseId: f.warehouseFg,
      laborRate: "0",
      overheadRate: "0",
      costCenterId: null,
      note: `hard protection MO (${label})`,
      noteAr: null,
      actorId: M_ACTOR,
    });
    await orders.linkSalesOrder(order.id, { salesOrderLineId: fgLine.id, actorId: M_ACTOR });
    await orders.release(order.id, M_ACTOR);
    await orders.start(order.id, M_ACTOR);
    await orders.consume(order.id, {
      lines: [{ itemId: spec.matItem!, qty: "10" }],
      consumedAt: "2026-03-15",
      note: null,
      noteAr: null,
      actorId: M_ACTOR,
    });
    return { moId: order.id, salesOrderId: salesOrder.id, fgLineId: fgLine.id, fgItem };
  });
}

/** Complete the chain's MO — the moment the FG lands, the holder
 * reserves it (G-49). */
async function completeChain(
  chain: ProtectedChain,
  actualQty: string,
): Promise<void> {
  await withTenant(TENANT_M, () =>
    orders.complete(chain.moId, { actualQty, completedAt: "2026-03-16", actorId: M_ACTOR }),
  );
}

/** A DRAFT delivery for an ISSUED (thief) order of the SAME item — the
 * "other order" of the criterion. */
async function draftThiefDelivery(
  chain: ProtectedChain,
  qty: string,
  label: string,
): Promise<string> {
  const f = spec.fixture!;
  return withTenant(TENANT_M, async () => {
    const thief = await salesStore.insertSalesOrder({
      branchId: f.branchId,
      customerId: f.customerId,
      salesRepId: null,
      warehouseId: f.warehouseFg,
      quotationId: null,
      orderDate: "2026-03-01",
      expectedDate: "2026-03-20",
      currencyCode: "SAR",
      exchangeRate: null,
      note: `hard protection thief order (${label})`,
      noteAr: null,
      actorId: null,
      totalNet: new Decimal(qty).times(10).toFixed(4),
      totalTax: "0.0000",
      totalGross: new Decimal(qty).times(10).toFixed(4),
      lines: [
        {
          itemId: chain.fgItem,
          description: "the thief line",
          descriptionAr: null,
          qty,
          unitPrice: "10.000000",
          discountAmount: "0.000000",
          taxCodeId: f.taxCodeIds.notSubject,
          netAmount: new Decimal(qty).times(10).toFixed(4),
          taxAmount: "0.0000",
          note: null,
        },
      ],
    });
    await salesOrdersSvc.submit(thief.id, M_ACTOR);
    await salesOrdersSvc.approve(thief.id, M_ACTOR);
    await salesOrdersSvc.issue(thief.id, M_ACTOR);
    const thiefLine = (await salesStore.listSalesOrderLines(thief.id))[0]!;
    const note = await deliveries.create({
      branchId: f.branchId,
      customerId: f.customerId,
      salesRepId: null,
      orderId: thief.id,
      warehouseId: f.warehouseFg,
      deliveryDate: "2026-03-17",
      currencyCode: "SAR",
      note: `the other order's delivery (${label})`,
      noteAr: null,
      actorId: M_ACTOR,
      lines: [
        {
          orderLineId: thiefLine.id,
          itemId: chain.fgItem,
          qty,
          unitPrice: "10.000000",
          discountAmount: null,
          batchId: null,
          serialIds: null,
          description: null,
          descriptionAr: null,
          note: null,
        },
      ],
    });
    return note.id;
  });
}

/** A DRAFT delivery for the chain's OWN (beneficiary) order line. */
async function draftBeneficiaryDelivery(
  chain: ProtectedChain,
  qty: string,
): Promise<string> {
  const f = spec.fixture!;
  return withTenant(TENANT_M, async () => {
    const note = await deliveries.create({
      branchId: f.branchId,
      customerId: f.customerId,
      salesRepId: null,
      orderId: chain.salesOrderId,
      warehouseId: f.warehouseFg,
      deliveryDate: "2026-03-17",
      currencyCode: "SAR",
      note: "the beneficiary's delivery",
      noteAr: null,
      actorId: M_ACTOR,
      lines: [
        {
          orderLineId: chain.fgLineId,
          itemId: chain.fgItem,
          qty,
          unitPrice: "10.000000",
          discountAmount: null,
          batchId: null,
          serialIds: null,
          description: null,
          descriptionAr: null,
          note: null,
        },
      ],
    });
    return note.id;
  });
}

async function fgOnHand(fgItem: string): Promise<string> {
  const f = spec.fixture!;
  return withTenant(TENANT_M, async () => {
    const row = await invStore.findItemStock(fgItem, f.warehouseFg);
    return row?.qty ?? "0.000000";
  });
}

async function fgReservations(
  fgItem: string,
  status?: string,
): Promise<invStore.ReservationRow[]> {
  const f = spec.fixture!;
  return withTenant(TENANT_M, async () =>
    invStore.listReservations({
      itemId: fgItem,
      warehouseId: f.warehouseFg,
      ...(status === undefined ? {} : { status }),
      limit: 100,
    }),
  );
}

/** The reserved error code the guard throws (matched by CODE, never by
 * import — the spec must RUN at the pre-fix head for the before-run). */
function reservedCode(error: unknown): string {
  return (error as { code?: string })?.code ?? "";
}

/** Is ANY lock in the cluster ungranted (someone waiting)? The race
 * spec's world-readable pg_locks probe. */
async function anyLockWaiter(): Promise<boolean> {
  return withTenant(TENANT_M, async () => {
    const rows = await requireTenantContext().tx!.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM pg_locks WHERE granted = false`,
    );
    return rows.rows[0]!.n > 0;
  });
}

beforeAll(async () => {
  spec.fixture = await setupMfgFixture();
  await withTenant(TENANT_M, async () => {
    spec.matItem = await ensureItem("M-HP-MAT", "hard protection material");
  });
});

describe("the reservation hard protection — no other order or issue path consumes the reserved quantity; the beneficiary can; the unlock is explicit and audited", () => {
  it("(a) PREVENTION: another order's delivery of the MTO-reserved stock is REJECTED with RESERVED_STOCK_PROTECTED — pre-fix it shipped and left an unbacked ACTIVE holder", async () => {
    const chain = await buildChain("A");
    await completeChain(chain, "10");
    await expect(fgOnHand(chain.fgItem)).resolves.toBe("10.000000");
    const active = await fgReservations(chain.fgItem, "ACTIVE");
    expect(active).toHaveLength(1);
    expect(active[0]!.holderType).toBe("PRODUCTION_ORDER");
    expect(active[0]!.qty).toBe("10.000000");

    const thiefNote = await draftThiefDelivery(chain, "10", "A");
    // THE LAW: the other order's issue NEVER takes the reserved stock
    // (pre-fix this post RESOLVED — the steal — and this expectation is
    // exactly what failed in the before-run).
    await expect(
      withTenant(TENANT_M, () => deliveries.post(thiefNote, M_ACTOR)),
    ).rejects.toMatchObject({ code: "RESERVED_STOCK_PROTECTED" });

    // The post-state: the goods INTACT (10 on-hand), the holder still
    // ACTIVE and still backed — nothing moved, nothing leaked.
    await expect(fgOnHand(chain.fgItem)).resolves.toBe("10.000000");
    const stillActive = await fgReservations(chain.fgItem, "ACTIVE");
    expect(stillActive).toHaveLength(1);
    expect(stillActive[0]!.qty).toBe("10.000000");
    // The thief's delivery is still DRAFT (a rejection is a rollback,
    // never a half-posted document).
    const thiefDelivery = await withTenant(TENANT_M, () => deliveries.find(thiefNote));
    expect(thiefDelivery.status).toBe("DRAFT");
  });

  it("(b) THE BENEFICIARY CONSUMES: the linked order's own delivery ships the FULL reserved qty — the holder retires CONSUMED, the stock moves, no orphan", async () => {
    const chain = await buildChain("B");
    await completeChain(chain, "10");
    const note = await draftBeneficiaryDelivery(chain, "10");
    const posted = await withTenant(TENANT_M, () => deliveries.post(note, M_ACTOR));
    expect(posted.delivery.status).toBe("POSTED");

    await expect(fgOnHand(chain.fgItem)).resolves.toBe("0.000000");
    const active = await fgReservations(chain.fgItem, "ACTIVE");
    expect(active).toHaveLength(0);
    const consumed = await fgReservations(chain.fgItem, "CONSUMED");
    expect(consumed).toHaveLength(1);
    expect(consumed[0]!.holderType).toBe("PRODUCTION_ORDER");
    expect(consumed[0]!.qty).toBe("10.000000");
    // The line's reservation link cleared (fully retired).
    const line = (
      await withTenant(TENANT_M, () => salesStore.listSalesOrderLines(chain.salesOrderId))
    )[0]!;
    expect(line.reservationId).toBeNull();
  });

  it("(c) PARTIAL DELIVERY + the interleaved theft attempts: each partial shipment retires only its share, the remainder stays protected, the final shipment completes the line", async () => {
    const chain = await buildChain("C");
    await completeChain(chain, "10");

    // Partial shipment 1: 4 of 10.
    const part1 = await draftBeneficiaryDelivery(chain, "4");
    await withTenant(TENANT_M, () => deliveries.post(part1, M_ACTOR));
    await expect(fgOnHand(chain.fgItem)).resolves.toBe("6.000000");
    const afterPart1 = await fgReservations(chain.fgItem, "ACTIVE");
    expect(afterPart1).toHaveLength(1);
    expect(afterPart1[0]!.qty).toBe("6.000000"); // the remainder stays held

    // The theft attempt BETWEEN the partials: the 6 free units are the
    // HOLDER's — another order may not take them.
    const thiefNote = await draftThiefDelivery(chain, "6", "C");
    await expect(
      withTenant(TENANT_M, () => deliveries.post(thiefNote, M_ACTOR)),
    ).rejects.toMatchObject({ code: "RESERVED_STOCK_PROTECTED" });
    await expect(fgOnHand(chain.fgItem)).resolves.toBe("6.000000");

    // Partial shipment 2: the remaining 6 completes the line.
    const part2 = await draftBeneficiaryDelivery(chain, "6");
    await withTenant(TENANT_M, () => deliveries.post(part2, M_ACTOR));
    await expect(fgOnHand(chain.fgItem)).resolves.toBe("0.000000");
    expect((await fgReservations(chain.fgItem, "ACTIVE"))).toHaveLength(0);
    expect((await fgReservations(chain.fgItem, "CONSUMED"))).toHaveLength(1);
  });

  it("(d) THE SURPLUS: an over-producing MO's excess is blocked while held, then RELEASED at the line's full delivery — and the freed stock serves a NEW order", async () => {
    const chain = await buildChain("D");
    await completeChain(chain, "15"); // 15 produced for a line of 10
    await expect(fgOnHand(chain.fgItem)).resolves.toBe("15.000000");
    const holder = (await fgReservations(chain.fgItem, "ACTIVE"))[0]!;
    expect(holder.qty).toBe("15.000000"); // the completion holds the ACTUAL qty

    // While the holder holds 15, NOTHING is free — even the surplus
    // half is protected until the line's settlement releases it.
    const blockedThief = await draftThiefDelivery(chain, "5", "D-blocked");
    await expect(
      withTenant(TENANT_M, () => deliveries.post(blockedThief, M_ACTOR)),
    ).rejects.toMatchObject({ code: "RESERVED_STOCK_PROTECTED" });

    // The beneficiary ships the line's 10: 10 consumed (the row's qty
    // reduced by the partial retire), the surplus 5 RELEASED (the
    // fully-delivered finalization — the round-2 law; the released row
    // carries its REMAINING 5 — the actual surplus that flows to free).
    const note = await draftBeneficiaryDelivery(chain, "10");
    await withTenant(TENANT_M, () => deliveries.post(note, M_ACTOR));
    await expect(fgOnHand(chain.fgItem)).resolves.toBe("5.000000");
    expect((await fgReservations(chain.fgItem, "ACTIVE"))).toHaveLength(0);
    const released = await fgReservations(chain.fgItem, "RELEASED");
    expect(released).toHaveLength(1);
    expect(released[0]!.qty).toBe("5.000000");

    // The freed surplus is FREE STOCK now — a new order ships it.
    const freedThief = await draftThiefDelivery(chain, "5", "D-freed");
    await withTenant(TENANT_M, () => deliveries.post(freedThief, M_ACTOR));
    await expect(fgOnHand(chain.fgItem)).resolves.toBe("0.000000");
  });

  it("(e) TERMINATION SETTLES: cancelling the MTO order releases the holder — the made-for-order stock returns to the FREE pool and another order ships it", async () => {
    const chain = await buildChain("E");
    await completeChain(chain, "10");

    // Protected while the order lives.
    const blockedThief = await draftThiefDelivery(chain, "10", "E-blocked");
    await expect(
      withTenant(TENANT_M, () => deliveries.post(blockedThief, M_ACTOR)),
    ).rejects.toMatchObject({ code: "RESERVED_STOCK_PROTECTED" });

    // The termination (cancel): the holder releases (the round-2/4 law).
    await withTenant(TENANT_M, () =>
      salesOrdersSvc.cancel(chain.salesOrderId, "the customer walked", M_ACTOR),
    );
    expect((await fgReservations(chain.fgItem, "ACTIVE"))).toHaveLength(0);

    // The stock is FREE — the settled-at-termination outcome.
    const freedThief = await draftThiefDelivery(chain, "10", "E-freed");
    await withTenant(TENANT_M, () => deliveries.post(freedThief, M_ACTOR));
    await expect(fgOnHand(chain.fgItem)).resolves.toBe("0.000000");
  });

  it("(f) ROLLBACK: a delivery post that fails AFTER its plans leaves ZERO residue — the issue, the settlement, and the protection all roll back as ONE unit of work", async () => {
    const chain = await buildChain("F");
    await completeChain(chain, "10");
    const note = await draftBeneficiaryDelivery(chain, "4");

    // Fail the post at its LAST step (the DEL numbering — after the
    // issue applied and the settlement ran) exactly once, only for the
    // delivery_note doc type.
    const realReserve = specNumbering.reserve.bind(specNumbering);
    const spy: MockInstance<typeof specNumbering.reserve> = vi.spyOn(
      specNumbering,
      "reserve",
    ).mockImplementationOnce(async (input) => {
      if (input.docType === "delivery_note") {
        throw new Error("the deliberate post-failure probe (after the plans applied)");
      }
      return realReserve(input);
    });
    try {
      await expect(
        withTenant(TENANT_M, () => deliveries.post(note, M_ACTOR)),
      ).rejects.toThrow("the deliberate post-failure probe");
    } finally {
      spy.mockRestore();
    }

    // ZERO residue: the stock did not move, the holder kept its full
    // coverage, the delivery stayed DRAFT — and the protection still
    // holds for the next attempt.
    await expect(fgOnHand(chain.fgItem)).resolves.toBe("10.000000");
    const active = await fgReservations(chain.fgItem, "ACTIVE");
    expect(active).toHaveLength(1);
    expect(active[0]!.qty).toBe("10.000000");
    const thiefNote = await draftThiefDelivery(chain, "10", "F");
    await expect(
      withTenant(TENANT_M, () => deliveries.post(thiefNote, M_ACTOR)),
    ).rejects.toMatchObject({ code: "RESERVED_STOCK_PROTECTED" });

    // And the retried beneficiary post succeeds on the intact state.
    const retried = await withTenant(TENANT_M, () => deliveries.post(note, M_ACTOR));
    expect(retried.delivery.status).toBe("POSTED");
    await expect(fgOnHand(chain.fgItem)).resolves.toBe("6.000000");
    const after = (await fgReservations(chain.fgItem, "ACTIVE"))[0]!;
    expect(after.qty).toBe("6.000000");
  });

  it("(g) THE CONCURRENT RACE: the beneficiary's delivery and the other order's delivery post TOGETHER — no deadlock, the beneficiary ALWAYS fulfills, the thief ALWAYS loses, never a steal", async () => {
    const chain = await buildChain("G");
    await completeChain(chain, "10");
    const beneficiaryNote = await draftBeneficiaryDelivery(chain, "10");
    const thiefNote = await draftThiefDelivery(chain, "10", "G");

    const settled = await Promise.allSettled([
      withTenant(TENANT_M, () => deliveries.post(beneficiaryNote, M_ACTOR)),
      withTenant(TENANT_M, () => deliveries.post(thiefNote, M_ACTOR)),
    ]);

    // The beneficiary ALWAYS fulfills (its allowance covers its own
    // holder in either serialization order).
    expect(settled[0]!.status).toBe("fulfilled");
    // The thief ALWAYS loses: RESERVED_STOCK_PROTECTED when it locked
    // first (the pool held, free 0), INSUFFICIENT_STOCK when the
    // beneficiary committed first (the stock itself gone). Either
    // error is a loss — the steal is impossible.
    expect(settled[1]!.status).toBe("rejected");
    const thiefCode = reservedCode(settled[1]!.status === "rejected" ? settled[1]!.reason : null);
    expect(["RESERVED_STOCK_PROTECTED", "INSUFFICIENT_STOCK"]).toContain(thiefCode);

    // The final world: exactly the beneficiary's 10 shipped, the
    // holder consumed, nothing ACTIVE, nothing negative.
    await expect(fgOnHand(chain.fgItem)).resolves.toBe("0.000000");
    expect((await fgReservations(chain.fgItem, "ACTIVE"))).toHaveLength(0);
    expect((await fgReservations(chain.fgItem, "CONSUMED"))).toHaveLength(1);
  });

  it("(h) THE SERIALIZATION WINDOW (deterministic): the other order's post PAUSES holding the item_stock lock — the beneficiary's post WAITS on it (pg_locks), the thief's guard REJECTS, its rollback RELEASES the lock, and the beneficiary then ships — pre-fix the thief STOLE inside this exact window", async () => {
    const chain = await buildChain("H");
    await completeChain(chain, "10");
    const beneficiaryNote = await draftBeneficiaryDelivery(chain, "10");
    const thiefNote = await draftThiefDelivery(chain, "10", "H");

    // The window: the thief's planIssue takes the item_stock row lock
    // (lockItemStock), then the post PAUSES — the beneficiary's post
    // starts and BLOCKS on the same row (observed via pg_locks), and
    // only then does the thief continue toward its guard verdict.
    const realLock = invStore.lockItemStock;
    let observedWaiter = false;
    let beneficiary: Promise<unknown> | undefined;
    const spy: MockInstance<typeof invStore.lockItemStock> = vi.spyOn(
      invStore,
      "lockItemStock",
    ).mockImplementationOnce(async (itemId: string, warehouseId: string) => {
      const row = await realLock(itemId, warehouseId); // the REAL lock, held by the thief's UoW
      // Start the beneficiary's post NOW (its own UoW + connection) and
      // watch it block on the lock this UoW holds.
      beneficiary = withTenant(TENANT_M, () => deliveries.post(beneficiaryNote, M_ACTOR));
      const deadline = Date.now() + 20_000;
      for (;;) {
        if (await anyLockWaiter()) {
          observedWaiter = true;
          break;
        }
        if (Date.now() > deadline) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return row;
    });
    let thiefError: unknown;
    try {
      await withTenant(TENANT_M, () => deliveries.post(thiefNote, M_ACTOR));
    } catch (error) {
      thiefError = error;
    } finally {
      spy.mockRestore();
    }

    // The serialization engaged: the beneficiary was observed WAITING
    // on the lock the thief's UoW held (the window is real — pre-fix
    // the thief COMMITTED inside it and the beneficiary then failed
    // with INSUFFICIENT_STOCK: the steal, observed).
    expect(observedWaiter).toBe(true);
    // The thief lost INSIDE the window (post-fix: the guard rejected,
    // the UoW rolled back, the lock released).
    expect(reservedCode(thiefError)).toBe("RESERVED_STOCK_PROTECTED");
    // The beneficiary proceeded after the release and shipped.
    const posted = await beneficiary;
    expect((posted as { delivery: { status: string } }).delivery.status).toBe("POSTED");
    await expect(fgOnHand(chain.fgItem)).resolves.toBe("0.000000");
    expect((await fgReservations(chain.fgItem, "ACTIVE"))).toHaveLength(0);
  });

  it("(i) ANOTHER ISSUE PATH + THE EXPLICIT AUTHORIZED UNLOCK: a manual issue of the reserved stock is REJECTED; the permission-gated release (audited) is the ONLY door — through it the stock becomes free", async () => {
    const chain = await buildChain("I");
    await completeChain(chain, "10");
    const f = spec.fixture!;

    // Another issue path (the manual issue route's service): blocked.
    await expect(
      withTenant(TENANT_M, () =>
        stockSvc.manualIssue({
          itemId: chain.fgItem,
          warehouseId: f.warehouseFg,
          qty: "3",
          reason: "DAMAGE",
          counterAccountId: null,
          valueDate: "2026-03-17",
          actorId: M_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "RESERVED_STOCK_PROTECTED" });

    // THE EXPLICIT AUTHORIZED ACTION: the release (the route is
    // permission-gated: `inventory.reservations` feature +
    // `inventory.stock.view` in ROUTE_PERMISSIONS) — and it is AUDITED.
    const holder = (await fgReservations(chain.fgItem, "ACTIVE"))[0]!;
    await withTenant(TENANT_M, () => reservations.release(holder.id, M_ACTOR));
    const releaseAudit = await withTenant(TENANT_M, async () => {
      const rows = await requireTenantContext().tx!.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM audit_events
            WHERE action = 'inventory.reservation_released' AND entity_id = ${holder.id}`,
      );
      return rows.rows[0]!.n;
    });
    expect(releaseAudit).toBeGreaterThan(0);

    // Through the open door: the manual issue now takes the freed
    // stock (the guard passes — the pool is empty).
    const issued = await withTenant(TENANT_M, () =>
      stockSvc.manualIssue({
        itemId: chain.fgItem,
        warehouseId: f.warehouseFg,
        qty: "3",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: "2026-03-17",
        actorId: M_ACTOR,
      }),
    );
    void issued;
    await expect(fgOnHand(chain.fgItem)).resolves.toBe("7.000000");
    // And the remaining 7 are FREE — another order ships them.
    const freedThief = await draftThiefDelivery(chain, "7", "I");
    await withTenant(TENANT_M, () => deliveries.post(freedThief, M_ACTOR));
    await expect(fgOnHand(chain.fgItem)).resolves.toBe("0.000000");
  });

  it("(j) ATP STANDING + THE BACKORDER LAW: an UNRESERVED line's OK verdict carries the UNPROTECTED standing and the advisory note; an ALLOCATED line carries PROTECTED_BY_RESERVATION; and a stock shortage NEVER blocks issuing a sales order", async () => {
    const f = spec.fixture!;
    // (j1) THE UNRESERVED PROMISE: free stock exists (10, no holders),
    // the line holds NO allocation → verdict OK + protection UNPROTECTED
    // + the advisory note naming the exposure verbatim (the owner's
    // directive: never describe an unallocated OK as a guarantee).
    const freeItem = await withTenant(TENANT_M, () =>
      ensureItem(`M-HP-FREE-${Date.now() % 100000}`, "the free-stock advisory item"),
    );
    await withTenant(TENANT_M, async () => {
      await stock.manualReceipt({
        itemId: freeItem,
        warehouseId: f.warehouseFg,
        qty: "10",
        unitCost: "4.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: "2026-03-01",
        batchNo: `M-HP-FREE-${Date.now() % 100000}`,
        batchExpiry: "2027-01-01",
        actorId: M_ACTOR,
      });
    });
    const freeOrder = await withTenant(TENANT_M, async () => {
      const order = await salesStore.insertSalesOrder({
        branchId: f.branchId,
        customerId: f.customerId,
        salesRepId: null,
        warehouseId: f.warehouseFg,
        quotationId: null,
        orderDate: "2026-03-01",
        expectedDate: "2026-03-20",
        currencyCode: "SAR",
        exchangeRate: null,
        note: "the unreserved advisory order",
        noteAr: null,
        actorId: null,
        totalNet: "100.0000",
        totalTax: "0.0000",
        totalGross: "100.0000",
        lines: [
          {
            itemId: freeItem,
            description: "the unreserved line",
            descriptionAr: null,
            qty: "10",
            unitPrice: "10.000000",
            discountAmount: "0.000000",
            taxCodeId: f.taxCodeIds.notSubject,
            netAmount: "100.0000",
            taxAmount: "0.0000",
            note: null,
          },
        ],
      });
      await salesOrdersSvc.submit(order.id, M_ACTOR);
      await salesOrdersSvc.approve(order.id, M_ACTOR);
      await salesOrdersSvc.issue(order.id, M_ACTOR);
      return order;
    });
    const freeLine = (
      await withTenant(TENANT_M, () => salesStore.listSalesOrderLines(freeOrder.id))
    )[0]!;
    const advisory = await withTenant(TENANT_M, () =>
      salesOrdersSvc.checkLineAtp(freeOrder.id, freeLine.id, {
        promisedDate: "2026-03-18",
        actorId: M_ACTOR,
      }),
    );
    expect(advisory.verdict).toBe("OK");
    expect((advisory as { protection?: string }).protection).toBe("UNPROTECTED");
    expect(
      ((advisory as { advisoryNote?: { en: string } }).advisoryNote ?? { en: "" }).en,
    ).toContain("unprotected");

    // (j2) THE ALLOCATED PROMISE: the MTO chain line — the holder feeds
    // THIS line. The generic basis nets the holder (nothing NEW is
    // promiseable at the position: SHORT), but the line's own standing
    // is PROTECTED_BY_RESERVATION — its promise is backed by an
    // allocation that physically holds the stock.
    const chain = await buildChain("J");
    await completeChain(chain, "10");
    const protectedResult = await withTenant(TENANT_M, () =>
      salesOrdersSvc.checkLineAtp(chain.salesOrderId, chain.fgLineId, {
        promisedDate: "2026-03-18",
        actorId: M_ACTOR,
      }),
    );
    expect(protectedResult.verdict).toBe("SHORT"); // the position is fully committed — to this very line
    expect((protectedResult as { protection?: string }).protection).toBe(
      "PROTECTED_BY_RESERVATION",
    );

    // (j3) THE BACKORDER LAW: an order for an item with ZERO stock
    // still ISSUES — a shortage never blocks a sales order; the
    // backorder stays possible (the ATP stamp is advisory).
    await withTenant(TENANT_M, async () => {
      const fgItem = await ensureItem(
        `M-HP-BACKORDER-${Date.now() % 100000}`,
        "the zero-stock backorder item",
      );
      const order = await salesStore.insertSalesOrder({
        branchId: f.branchId,
        customerId: f.customerId,
        salesRepId: null,
        warehouseId: f.warehouseFg,
        quotationId: null,
        orderDate: "2026-03-01",
        expectedDate: "2026-03-20",
        currencyCode: "SAR",
        exchangeRate: null,
        note: "the backorder law — zero stock, still issued",
        noteAr: null,
        actorId: null,
        totalNet: "100.0000",
        totalTax: "0.0000",
        totalGross: "100.0000",
        lines: [
          {
            itemId: fgItem,
            description: "the zero-stock line",
            descriptionAr: null,
            qty: "10",
            unitPrice: "10.000000",
            discountAmount: "0.000000",
            taxCodeId: f.taxCodeIds.notSubject,
            netAmount: "100.0000",
            taxAmount: "0.0000",
            note: null,
          },
        ],
      });
      await salesOrdersSvc.submit(order.id, M_ACTOR);
      await salesOrdersSvc.approve(order.id, M_ACTOR);
      const issuedOrder = await salesOrdersSvc.issue(order.id, M_ACTOR); // NO ATP gate — the law
      expect(issuedOrder.status).toBe("ISSUED");
    });
  });
});
