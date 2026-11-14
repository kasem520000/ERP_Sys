import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as itemsStore from "../../modules/items/infrastructure/items.store";
import * as partnersStore from "../../modules/partners/infrastructure/partners.store";
import * as salesStore from "../../modules/sales/infrastructure/sales.store";
import { SalesOrderService } from "../../modules/sales/application/orders";
import { AtpService } from "../../modules/manufacturing/application/atp-service";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import {
  M_ACTOR,
  TENANT_M,
  reservations,
  setupMfgFixture,
  stock,
  type MfgFixture,
} from "./fixtures";

/**
 * PHASE-043 audit round 2, item 5 — the UNRESERVED double promise, made
 * explicit and raised as an OPEN business decision.
 *
 * The audit's question: what happens when two customers request the SAME
 * quantity from limited stock WITHOUT reserving? The code documents law 4
 * (unreserved sibling demand does not reduce the basis — only
 * reservations hold) — but a documented policy is not an APPROVED one,
 * and the exposure is real: both lines stamp OK on stock that exists
 * ONCE. This spec proves the behavior verbatim on the live DB and pins
 * the answer to the question the audit asked:
 *
 *   IS "OK" A PROTECTED PROMISE? NO. The ATP stamp is an ADVISORY
 *   availability check at check-time — it reserves NOTHING, holds
 *   NOTHING, and protects NOTHING. Two unreserved ISSUED lines can both
 *   stamp OK on the same stock; the FIRST delivery to post physically
 *   wins (the soft model — the item-2 proof), and the second order
 *   over-promises silently. Only an ACTIVE reservation removes stock
 *   from the pool (asserted here: the moment one line reserves, the
 *   other's re-check flips SHORT).
 *
 * The business decision this exposes is OPEN (RISK-032 in the risk
 * register — NOT approved by documentation): the platform must choose
 * between (a) auto-reserving at order issue when stock allows (the
 * protected-promise model), (b) a blocking ATP gate at issue (reject or
 * warn on SHORT), or (c) accepting the soft model with the exposure
 * named to the operator at the point of promise. Until the owner
 * decides, the behavior stays exactly as asserted here — visible,
 * tested, and never described as a guarantee.
 */

const specAudit = new AuditService(new DrizzleAuditStore());
const specNumbering = new NumberingService(specAudit);
const salesOrdersSvc = new SalesOrderService(specAudit, specNumbering, new AtpService());

const spec: { fixture?: MfgFixture; item?: string; secondCustomerId?: string } = {};

function day(offset: number): string {
  return new Date(Date.now() + offset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

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

/** One ISSUED, UNRESERVED sales order of `qty` for one customer. */
async function issuedOrder(input: {
  customerId: string;
  itemId: string;
  qty: string;
}): Promise<{ orderId: string; lineId: string }> {
  const f = spec.fixture!;
  const order = await salesStore.insertSalesOrder({
    branchId: f.branchId,
    customerId: input.customerId,
    salesRepId: null,
    warehouseId: f.warehouseFg,
    quotationId: null,
    orderDate: day(0),
    expectedDate: day(10),
    currencyCode: "SAR",
    exchangeRate: null,
    note: "unreserved-promise spec",
    noteAr: null,
    actorId: null,
    totalNet: "100.0000",
    totalTax: "0.0000",
    totalGross: "100.0000",
    lines: [
      {
        itemId: input.itemId,
        description: "the unreserved line",
        descriptionAr: null,
        qty: input.qty,
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
  const line = (await salesStore.listSalesOrderLines(order.id))[0]!;
  return { orderId: order.id, lineId: line.id };
}

beforeAll(async () => {
  spec.fixture = await setupMfgFixture();
  await withTenant(TENANT_M, async () => {
    spec.item = await ensureItem("M-UP-A", "Unreserved promise item");
    const page = await partnersStore.listPartners({}, undefined, 100);
    const existing = page.rows.concat(
      page.hasMore ? (await partnersStore.listPartners({}, page.nextCursor ?? undefined, 100)).rows : [],
    );
    spec.secondCustomerId =
      existing.find((p) => p.code === "UP-CUST-2")?.id ??
      (
        await partnersStore.insertPartner({
          kind: "CUSTOMER",
          code: "UP-CUST-2",
          name: "Unreserved Promise Customer 2",
          nameAr: "عميل الوعد المزدوج",
          taxNumber: null,
          creditLimit: null,
          creditTermsId: null,
          priceListId: null,
        })
      ).id;
  });
});

describe("PHASE-043 audit round 2, item 5 — the unreserved double promise (an OPEN business decision, not an approved policy)", () => {
  it("TWO customers, the SAME 10 units, NO reservations: BOTH stamp OK — the exposure proven verbatim (OK is an advisory check, never a protected promise)", async () => {
    const f = spec.fixture!;
    await withTenant(TENANT_M, async () => {
      // The ONLY 10 units in the warehouse.
      await stock.manualReceipt({
        itemId: spec.item!,
        warehouseId: f.warehouseFg,
        qty: "10",
        unitCost: "2.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: day(0),
        batchNo: `M-UP-A-${Date.now() % 100000}`,
        batchExpiry: day(300),
        actorId: M_ACTOR,
      });

      // Customer 1 and customer 2, each with an ISSUED line of 10 —
      // NEITHER reserves.
      const first = await issuedOrder({ customerId: f.customerId, itemId: spec.item!, qty: "10" });
      const second = await issuedOrder({
        customerId: spec.secondCustomerId!,
        itemId: spec.item!,
        qty: "10",
      });

      // THE DOUBLE PROMISE: both advisory checks stamp OK on the same
      // 10 units (law 4: unreserved sibling demand does not reduce the
      // basis). This is the asserted exposure — the behavior is
      // deliberately unchanged here; the DECISION is raised, not made.
      const check1 = await salesOrdersSvc.checkLineAtp(first.orderId, first.lineId, {
        promisedDate: day(5),
        actorId: M_ACTOR,
      });
      expect(check1.verdict).toBe("OK");
      expect(check1.availableNow).toBe("10.000000");
      const check2 = await salesOrdersSvc.checkLineAtp(second.orderId, second.lineId, {
        promisedDate: day(5),
        actorId: M_ACTOR,
      });
      expect(check2.verdict).toBe("OK");
      expect(check2.availableNow).toBe("10.000000");

      // THE PROTECTION BOUNDARY: the moment ONE line reserves, the
      // other's re-check flips SHORT — only reservations hold stock.
      const held = await reservations.create({
        itemId: spec.item!,
        warehouseId: f.warehouseFg,
        qty: "10",
        holderType: "SALES_ORDER",
        holderId: first.orderId,
        expiresAt: null,
        note: "the first customer's hold",
        actorId: M_ACTOR,
      });
      await salesStore.setOrderLineReservation(first.lineId, held.id);
      const recheck2 = await salesOrdersSvc.checkLineAtp(second.orderId, second.lineId, {
        promisedDate: day(5),
        actorId: M_ACTOR,
      });
      expect(recheck2.verdict).toBe("SHORT");
      expect(recheck2.availableNow).toBe("0.000000");
      expect(recheck2.suggestedDate).toBeNull();

      // The stamps persist on the lines (the advisory trail).
      const line2 = (await salesStore.listSalesOrderLines(second.orderId))[0]!;
      expect(line2.atpStatus).toBe("SHORT");

      // Clean the pool for the suite (the orders stay ISSUED — the
      // sales-fixture delta discipline tolerates issued orders).
      await reservations.release(held.id, M_ACTOR);
      await salesStore.setOrderLineReservation(first.lineId, null);
    });
  });
});
