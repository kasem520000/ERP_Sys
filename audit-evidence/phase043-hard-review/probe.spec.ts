import { beforeAll, describe, expect, it } from "vitest";

import { Decimal } from "@erp/domain-core";

import { withTenant } from "../../apps/api/src/infra/db/tenant-context";
import * as itemsStore from "../../apps/api/src/modules/items/infrastructure/items.store";
import * as invStore from "../../apps/api/src/modules/inventory/infrastructure/inventory.store";
import * as salesStore from "../../apps/api/src/modules/sales/infrastructure/sales.store";
import { DeliveryNoteService } from "../../apps/api/src/modules/sales/application/deliveries";
import { SalesOrderService } from "../../apps/api/src/modules/sales/application/orders";
import { AtpService } from "../../apps/api/src/modules/manufacturing/application/atp-service";
import { PickingService } from "../../apps/api/src/modules/inventory/application/picking-service";
import { StockService } from "../../apps/api/src/modules/inventory/application/stock-service";
import { AuditService } from "../../apps/api/src/modules/audit/api/audit";
import { DrizzleAuditStore } from "../../apps/api/src/modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../apps/api/src/modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../apps/api/src/modules/partners/application/subledger-service";
import { NumberingService } from "../../apps/api/src/modules/accounting/application/numbering-service";
import {
  M_ACTOR,
  TENANT_M,
  boms,
  orders,
  reservations,
  setupMfgFixture,
  stock,
  type MfgFixture,
} from "../../apps/api/src/__db__/manufacturing/fixtures";

/**
 * THE PHASE-043 HARD-REVIEW PROBE (reopened 2026-11-15 against the
 * unified head 1674849): the owner's independent reproduction of TWO
 * BLOCKING DEFECTS in the delivered reservation hard protection.
 *
 * This spec asserts the POST-FIX CONTRACT. At head 1674849 it FAILS —
 * probe.log is the before-evidence (each failing expectation names its
 * defect); after the hard-review fixes it PASSES — probe-after.log is
 * the after-evidence. It deliberately lives OUTSIDE the app's DB suite
 * (the auditor's standalone probe) and is pinned as the reproduction
 * the regression tests (apps/api/src/__db__/manufacturing/
 * reservation-hard-review.spec.ts) mirror inside the suite.
 *
 * DEFECT 1 — allow_negative_stock DISABLES the protection: planIssue's
 * reserved-pool guard rode `!allowNegative`, so an explicit negative-
 * stock policy (BR-013, a tenant setting) silently switched the whole
 * protection OFF — another order's delivery shipped the MTO-reserved
 * stock and left an unbacked ACTIVE holder. THE CONTRACT: the policy
 * keeps its declared meaning for the UNRESERVED portion only (free
 * stock may go negative); the protected quota (the ACTIVE reserved
 * pool this issue is not entitled to) is untouchable at ANY policy
 * position — the only door is the permission-gated, audited release.
 *
 * DEFECT 2 — the delivery identity is never verified: neither delivery
 * creation nor posting verified that an order-line binding BELONGS to
 * the delivery's order, that the line's ITEM matches the order line's,
 * or that the WAREHOUSE is consistent — and the beneficiary allowance
 * trusted the reservation ID ALONE (activeReservationQty reads qty
 * with no item/warehouse/holder check). A crafted delivery counted
 * another item's / another warehouse's reservation as its entitlement
 * and consumed a third party's protected pool. THE CONTRACT: create
 * AND post verify the binding (order-line ∈ the DN's order, item
 * match, warehouse match, no duplicate bindings), and every allowance
 * row must be a LIVE reservation matching the line's item, the DN's
 * warehouse, and the beneficiary — never the id alone.
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

async function ensureItem(
  sku: string,
  name: string,
  batchTracked = true,
): Promise<string> {
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
    trackBatch: batchTracked,
    trackSerial: false,
    trackImei: false,
    hasExpiry: batchTracked,
    shelfLifeDays: 365,
    reorderLevel: null,
    reorderQty: null,
    basePrice: null,
  });
  return created.id;
}

interface Chain {
  moId: string;
  salesOrderId: string;
  fgLineId: string;
  fgItem: string;
}

/** A dedicated-FG-item MTO chain parked one complete() away from done
 * (the hard-protection spec's pattern). */
async function buildChain(label: string): Promise<Chain> {
  const f = spec.fixture!;
  chainSeq += 1;
  const stamp = `${Date.now() % 100000}-${chainSeq}`;
  return withTenant(TENANT_M, async () => {
    const fgItem = await ensureItem(`M-HR-${label}-${stamp}`, `hard review FG (${label})`);
    const draft = await boms.create({
      itemId: fgItem,
      outputUomId: (await itemsStore.findItemById(fgItem))!.uomId,
      yieldPct: "100.0000",
      mainAllocationPct: "100.0000",
      note: `hard review BOM (${label})`,
      noteAr: null,
      actorId: M_ACTOR,
      lines: [{ componentItemId: spec.matItem!, qtyPerOutput: "1.000000", scrapPct: "0" }],
    });
    const activeBom = await boms.activate(draft.id, { effectiveFrom: "2026-03-01", actorId: M_ACTOR });
    await stock.manualReceipt({
      itemId: spec.matItem!,
      warehouseId: f.warehouseRaw,
      qty: "30",
      unitCost: "4.000000",
      reason: "COUNT_GAIN",
      counterAccountId: null,
      valueDate: "2026-03-01",
      batchNo: `M-HR-${label}-MAT-${stamp}`,
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
      note: `hard review order (${label})`,
      noteAr: null,
      actorId: null,
      totalNet: "100.0000",
      totalTax: "0.0000",
      totalGross: "100.0000",
      lines: [
        {
          itemId: fgItem,
          description: "hard review FG line",
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
      note: `hard review MO (${label})`,
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

async function completeChain(chain: Chain, actualQty: string): Promise<void> {
  await withTenant(TENANT_M, () =>
    orders.complete(chain.moId, { actualQty, completedAt: "2026-03-16", actorId: M_ACTOR }),
  );
}

async function receiveAt(
  itemId: string,
  warehouseId: string,
  qty: string,
  batch: string,
): Promise<void> {
  await withTenant(TENANT_M, () =>
    stock.manualReceipt({
      itemId,
      warehouseId,
      qty,
      unitCost: "4.000000",
      reason: "COUNT_GAIN",
      counterAccountId: null,
      valueDate: "2026-03-01",
      batchNo: batch,
      batchExpiry: "2027-01-01",
      actorId: M_ACTOR,
    }),
  );
}

async function issuedOrderLine(
  itemId: string,
  qty: string,
  warehouseId: string,
  note: string,
): Promise<{ orderId: string; lineId: string; itemId: string }> {
  const f = spec.fixture!;
  return withTenant(TENANT_M, async () => {
    const order = await salesStore.insertSalesOrder({
      branchId: f.branchId,
      customerId: f.customerId,
      salesRepId: null,
      warehouseId,
      quotationId: null,
      orderDate: "2026-03-01",
      expectedDate: "2026-03-20",
      currencyCode: "SAR",
      exchangeRate: null,
      note,
      noteAr: null,
      actorId: null,
      totalNet: new Decimal(qty).times(10).toFixed(4),
      totalTax: "0.0000",
      totalGross: new Decimal(qty).times(10).toFixed(4),
      lines: [
        {
          itemId,
          description: "the probe line",
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
    await salesOrdersSvc.submit(order.id, M_ACTOR);
    await salesOrdersSvc.approve(order.id, M_ACTOR);
    await salesOrdersSvc.issue(order.id, M_ACTOR);
    const line = (await salesStore.listSalesOrderLines(order.id))[0]!;
    return { orderId: order.id, lineId: line.id, itemId };
  });
}

async function onHandAt(itemId: string, warehouseId: string): Promise<string> {
  return withTenant(TENANT_M, async () => {
    const row = await invStore.findItemStock(itemId, warehouseId);
    return row?.qty ?? "0.000000";
  });
}

async function activePoolAt(
  itemId: string,
  warehouseId: string,
): Promise<{ qty: string; count: number }> {
  return withTenant(TENANT_M, async () => {
    const rows = await invStore.listReservations({
      itemId,
      warehouseId,
      status: "ACTIVE",
      limit: 100,
    });
    return {
      qty: rows.reduce((sum, row) => sum.plus(new Decimal(row.qty)), new Decimal(0)).toFixed(6),
      count: rows.length,
    };
  });
}

async function setNegativePolicy(enabled: boolean): Promise<void> {
  await withTenant(TENANT_M, async () => {
    const { upsertSetting } = await import(
      "../../apps/api/src/modules/tenancy/infrastructure/tenancy.store"
    );
    await upsertSetting("inventory.allow_negative_stock", enabled, M_ACTOR);
  });
}

/** A DRAFT DN bound to an order line — the attacker's document. */
async function draftBoundDelivery(input: {
  orderId: string;
  warehouseId: string;
  orderLineId: string | null;
  itemId: string;
  qty: string;
  label: string;
}): Promise<string> {
  const f = spec.fixture!;
  return withTenant(TENANT_M, async () => {
    const note = await deliveries.create({
      branchId: f.branchId,
      customerId: f.customerId,
      salesRepId: null,
      orderId: input.orderId,
      warehouseId: input.warehouseId,
      deliveryDate: "2026-03-17",
      currencyCode: "SAR",
      note: `the probe delivery (${input.label})`,
      noteAr: null,
      actorId: M_ACTOR,
      lines: [
        {
          orderLineId: input.orderLineId,
          itemId: input.itemId,
          qty: input.qty,
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

beforeAll(async () => {
  spec.fixture = await setupMfgFixture();
  await withTenant(TENANT_M, async () => {
    spec.matItem = await ensureItem("M-HR-MAT", "hard review material");
  });
});

describe("DEFECT 1 — allow_negative_stock must NEVER disable the reservation protection (the policy governs the UNRESERVED portion only)", () => {
  it("P1: with the policy ON, another order's delivery of the MTO-reserved stock is REJECTED, a manual issue is REJECTED, the goods stay intact — while free stock still goes negative by policy", async () => {
    const f = spec.fixture!;
    const chain = await buildChain("P1");
    await completeChain(chain, "10");
    await expect(onHandAt(chain.fgItem, f.warehouseFg)).resolves.toBe("10.000000");
    await expect(activePoolAt(chain.fgItem, f.warehouseFg)).resolves.toEqual({
      qty: "10.000000",
      count: 1,
    });

    await setNegativePolicy(true);
    try {
      // (i) THE OTHER ORDER'S DELIVERY — the defect's core: pre-fix this
      // post RESOLVED under the policy (the steal) and this expectation
      // is exactly what failed at head 1674849.
      const thief = await issuedOrderLine(chain.fgItem, "10", f.warehouseFg, "P1 thief");
      const thiefNote = await draftBoundDelivery({
        orderId: thief.orderId,
        warehouseId: f.warehouseFg,
        orderLineId: thief.lineId,
        itemId: chain.fgItem,
        qty: "10",
        label: "P1-thief",
      });
      await expect(
        withTenant(TENANT_M, () => deliveries.post(thiefNote, M_ACTOR)),
      ).rejects.toMatchObject({ code: "RESERVED_STOCK_PROTECTED" });

      // (ii) ANOTHER ISSUE PATH — the manual issue, same law.
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

      // (iii) THE POST-STATE: nothing moved, nothing leaked.
      await expect(onHandAt(chain.fgItem, f.warehouseFg)).resolves.toBe("10.000000");
      await expect(activePoolAt(chain.fgItem, f.warehouseFg)).resolves.toEqual({
        qty: "10.000000",
        count: 1,
      });

      // (iv) THE POLICY'S DECLARED SCOPE — the UNRESERVED portion: an
      // item with NO reservation still goes negative by policy (BR-013
      // preserved for free stock; non-batch-tracked — the negative
      // policy's existing scope, the valuation-ledger precedent).
      const freeItem = await withTenant(TENANT_M, () =>
        ensureItem(`M-HR-P1-FREE-${Date.now() % 100000}`, "the policy-scope free item", false),
      );
      await receiveAt(freeItem, f.warehouseFg, "2", `M-HR-P1-FREE-${Date.now() % 100000}`);
      await withTenant(TENANT_M, () =>
        stockSvc.manualIssue({
          itemId: freeItem,
          warehouseId: f.warehouseFg,
          qty: "5",
          reason: "DAMAGE",
          counterAccountId: null,
          valueDate: "2026-03-17",
          actorId: M_ACTOR,
        }),
      );
      await expect(onHandAt(freeItem, f.warehouseFg)).resolves.toBe("-3.000000");

      // (v) THE PROTECTED FLOOR ABOVE ZERO — with the policy ON, the
      // free portion of a RESERVED position still moves (15 − 5 = 10 =
      // the pool floor) but one unit deeper is REJECTED.
      const poolItem = await withTenant(TENANT_M, () =>
        ensureItem(`M-HR-P1-POOL-${Date.now() % 100000}`, "the pool-floor item"),
      );
      await receiveAt(poolItem, f.warehouseFg, "15", `M-HR-P1-POOL-${Date.now() % 100000}`);
      await withTenant(TENANT_M, () =>
        reservations.create({
          itemId: poolItem,
          warehouseId: f.warehouseFg,
          qty: "10",
          holderType: "MANUAL",
          holderId: null,
          expiresAt: null,
          note: "the protected pool (P1v)",
          actorId: M_ACTOR,
        }),
      );
      const freeShipper = await issuedOrderLine(poolItem, "5", f.warehouseFg, "P1 free shipper");
      const freeNote = await draftBoundDelivery({
        orderId: freeShipper.orderId,
        warehouseId: f.warehouseFg,
        orderLineId: freeShipper.lineId,
        itemId: poolItem,
        qty: "5",
        label: "P1-free-5",
      });
      await withTenant(TENANT_M, () => deliveries.post(freeNote, M_ACTOR));
      await expect(onHandAt(poolItem, f.warehouseFg)).resolves.toBe("10.000000");
      const deepShipper = await issuedOrderLine(poolItem, "6", f.warehouseFg, "P1 deep shipper");
      const deepNote = await draftBoundDelivery({
        orderId: deepShipper.orderId,
        warehouseId: f.warehouseFg,
        orderLineId: deepShipper.lineId,
        itemId: poolItem,
        qty: "6",
        label: "P1-deep-6",
      });
      await expect(
        withTenant(TENANT_M, () => deliveries.post(deepNote, M_ACTOR)),
      ).rejects.toMatchObject({ code: "RESERVED_STOCK_PROTECTED" });
      await expect(onHandAt(poolItem, f.warehouseFg)).resolves.toBe("10.000000");
    } finally {
      await setNegativePolicy(false);
    }
  });
});

describe("DEFECT 2 — the delivery identity is verified at CREATE and at POST; every allowance traces to a LIVE reservation matching item, warehouse, and beneficiary", () => {
  it("P2: a foreign order line, an item mismatch, and a warehouse mismatch are all REJECTED at create — and a DIRECTLY-INSERTED mismatched delivery (create bypassed) is REJECTED at post with ZERO residue", async () => {
    const f = spec.fixture!;

    // The attacker's own chain: order A, line for FG-A, MTO reservation
    // 10 of FG-A at WH-FG (the mis-counted "entitlement").
    const chainA = await buildChain("P2A");
    await completeChain(chainA, "10");

    // The victim on ANOTHER ITEM: 10 of FG-V at WH-FG held by a MANUAL
    // reservation (a third party's protected pool).
    const victimItem = await withTenant(TENANT_M, () =>
      ensureItem(`M-HR-P2-V-${Date.now() % 100000}`, "the item-mismatch victim item"),
    );
    await receiveAt(victimItem, f.warehouseFg, "10", `M-HR-P2-V-${Date.now() % 100000}`);
    await withTenant(TENANT_M, () =>
      reservations.create({
        itemId: victimItem,
        warehouseId: f.warehouseFg,
        qty: "10",
        holderType: "MANUAL",
        holderId: null,
        expiresAt: null,
        note: "the victim's protected pool (another item)",
        actorId: M_ACTOR,
      }),
    );

    // The victim on ANOTHER WAREHOUSE: 10 of FG-W at WH-RAW held by a
    // MANUAL reservation, while the attacker's own chain holds FG-W at
    // WH-FG (order W's entitlement lives in the WRONG warehouse for a
    // WH-RAW delivery).
    const chainW = await buildChain("P2W");
    await completeChain(chainW, "10");
    await receiveAt(chainW.fgItem, f.warehouseRaw, "10", `M-HR-P2W-RAW-${Date.now() % 100000}`);
    await withTenant(TENANT_M, () =>
      reservations.create({
        itemId: chainW.fgItem,
        warehouseId: f.warehouseRaw,
        qty: "10",
        holderType: "MANUAL",
        holderId: null,
        expiresAt: null,
        note: "the victim's protected pool (another warehouse)",
        actorId: M_ACTOR,
      }),
    );

    // A bystander order (for the foreign-line arm).
    const bystanderItem = await withTenant(TENANT_M, () =>
      ensureItem(`M-HR-P2-BY-${Date.now() % 100000}`, "the bystander item"),
    );
    const bystander = await issuedOrderLine(bystanderItem, "10", f.warehouseFg, "P2 bystander");

    // (i) FOREIGN ORDER LINE at create: the DN belongs to order A but
    // binds the BYSTANDER's line (its own item, its own order — a
    // well-formed line of the WRONG order). Pre-fix: accepted silently.
    await expect(
      draftBoundDelivery({
        orderId: chainA.salesOrderId,
        warehouseId: f.warehouseFg,
        orderLineId: bystander.lineId,
        itemId: bystanderItem,
        qty: "10",
        label: "P2-foreign-line",
      }),
    ).rejects.toMatchObject({ code: "DELIVERY_LINE_IDENTITY" });

    // (ii) ITEM MISMATCH at create: the DN binds order A's line (item
    // FG-A) but ships the VICTIM's item FG-V. Pre-fix: accepted, and
    // its post consumed the victim's protected pool (the allowance
    // counted FG-A's reservation as FG-V entitlement — the theft).
    await expect(
      draftBoundDelivery({
        orderId: chainA.salesOrderId,
        warehouseId: f.warehouseFg,
        orderLineId: chainA.fgLineId,
        itemId: victimItem,
        qty: "10",
        label: "P2-item-mismatch",
      }),
    ).rejects.toMatchObject({ code: "DELIVERY_LINE_IDENTITY" });

    // (iii) WAREHOUSE MISMATCH at create: the DN binds order W's line
    // but ships from WH-RAW — a different warehouse than the order's.
    // Pre-fix: accepted, and its post consumed the WH-RAW victim pool
    // (the allowance counted the WH-FG reservation — wrong warehouse).
    await expect(
      draftBoundDelivery({
        orderId: chainW.salesOrderId,
        warehouseId: f.warehouseRaw,
        orderLineId: chainW.fgLineId,
        itemId: chainW.fgItem,
        qty: "10",
        label: "P2-warehouse-mismatch",
      }),
    ).rejects.toMatchObject({ code: "DELIVERY_LINE_IDENTITY" });

    // (iv) DEFENSE IN DEPTH — create BYPASSED (the store directly, the
    // rogue-writer / pre-fix-row shape): the item-mismatched delivery
    // must die at POST, never at the plan. Pre-fix: the post RESOLVED
    // and shipped the victim's 10 (the theft, observed).
    const rogueNote = await withTenant(TENANT_M, async () => {
      const created = await salesStore.insertDeliveryNote({
        branchId: f.branchId,
        customerId: f.customerId,
        salesRepId: null,
        orderId: chainA.salesOrderId,
        warehouseId: f.warehouseFg,
        deliveryDate: "2026-03-17",
        currencyCode: "SAR",
        note: "the rogue mismatched delivery (create bypassed)",
        noteAr: null,
        actorId: M_ACTOR,
        totalNet: "100.0000",
        totalTax: "0.0000",
        totalGross: "100.0000",
        lines: [
          {
            orderLineId: chainA.fgLineId,
            itemId: victimItem,
            description: "the mismatched line",
            descriptionAr: null,
            qty: "10",
            unitPrice: "10.000000",
            discountAmount: "0.0000",
            netAmount: "100.0000",
            batchId: null,
            serialIds: null,
            note: null,
          },
        ],
      });
      return created.id;
    });
    await expect(
      withTenant(TENANT_M, () => deliveries.post(rogueNote, M_ACTOR)),
    ).rejects.toMatchObject({ code: "DELIVERY_LINE_IDENTITY" });
    // ZERO residue: the victim's pool and stock untouched.
    await expect(onHandAt(victimItem, f.warehouseFg)).resolves.toBe("10.000000");
    await expect(activePoolAt(victimItem, f.warehouseFg)).resolves.toEqual({
      qty: "10.000000",
      count: 1,
    });
    const rogueRow = await withTenant(TENANT_M, () => deliveries.find(rogueNote));
    expect(rogueRow.status).toBe("DRAFT");

    // (v) DEFENSE IN DEPTH — the warehouse-mismatched rogue delivery
    // dies at POST too (never touches the WH-RAW victim pool).
    const rogueWhNote = await withTenant(TENANT_M, async () => {
      const created = await salesStore.insertDeliveryNote({
        branchId: f.branchId,
        customerId: f.customerId,
        salesRepId: null,
        orderId: chainW.salesOrderId,
        warehouseId: f.warehouseRaw,
        deliveryDate: "2026-03-17",
        currencyCode: "SAR",
        note: "the rogue warehouse-mismatched delivery",
        noteAr: null,
        actorId: M_ACTOR,
        totalNet: "100.0000",
        totalTax: "0.0000",
        totalGross: "100.0000",
        lines: [
          {
            orderLineId: chainW.fgLineId,
            itemId: chainW.fgItem,
            description: "the wrong-warehouse line",
            descriptionAr: null,
            qty: "10",
            unitPrice: "10.000000",
            discountAmount: "0.0000",
            netAmount: "100.0000",
            batchId: null,
            serialIds: null,
            note: null,
          },
        ],
      });
      return created.id;
    });
    await expect(
      withTenant(TENANT_M, () => deliveries.post(rogueWhNote, M_ACTOR)),
    ).rejects.toMatchObject({ code: "DELIVERY_LINE_IDENTITY" });
    await expect(onHandAt(chainW.fgItem, f.warehouseRaw)).resolves.toBe("10.000000");
    await expect(activePoolAt(chainW.fgItem, f.warehouseRaw)).resolves.toEqual({
      qty: "10.000000",
      count: 1,
    });

    // (vi) DUPLICATE BINDINGS: two lines of ONE delivery binding the
    // SAME order line. Pre-fix: accepted; the allowance double-counted
    // the same reservation rows.
    await expect(
      withTenant(TENANT_M, async () =>
        deliveries.create({
          branchId: f.branchId,
          customerId: f.customerId,
          salesRepId: null,
          orderId: chainA.salesOrderId,
          warehouseId: f.warehouseFg,
          deliveryDate: "2026-03-17",
          currencyCode: "SAR",
          note: "the duplicate-binding delivery",
          noteAr: null,
          actorId: M_ACTOR,
          lines: [
            {
              orderLineId: chainA.fgLineId,
              itemId: chainA.fgItem,
              qty: "5",
              unitPrice: "10.000000",
              discountAmount: null,
              batchId: null,
              serialIds: null,
              description: null,
              descriptionAr: null,
              note: null,
            },
            {
              orderLineId: chainA.fgLineId,
              itemId: chainA.fgItem,
              qty: "5",
              unitPrice: "10.000000",
              discountAmount: null,
              batchId: null,
              serialIds: null,
              description: null,
              descriptionAr: null,
              note: null,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "DELIVERY_LINE_IDENTITY" });

    // (vii) THE CONTROL — the honest beneficiary delivery (correct
    // line, correct item, correct warehouse) still ships and settles:
    // the identity gate must never break the legitimate path.
    const honestNote = await draftBoundDelivery({
      orderId: chainA.salesOrderId,
      warehouseId: f.warehouseFg,
      orderLineId: chainA.fgLineId,
      itemId: chainA.fgItem,
      qty: "10",
      label: "P2-honest",
    });
    const posted = await withTenant(TENANT_M, () => deliveries.post(honestNote, M_ACTOR));
    expect(posted.delivery.status).toBe("POSTED");
    await expect(onHandAt(chainA.fgItem, f.warehouseFg)).resolves.toBe("0.000000");
    await expect(activePoolAt(chainA.fgItem, f.warehouseFg)).resolves.toEqual({
      qty: "0.000000",
      count: 0,
    });
  });
});
