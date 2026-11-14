import { beforeAll, describe, expect, it, vi, type MockInstance } from "vitest";

import { Decimal } from "@erp/domain-core";

import { withTenant } from "../../infra/db/tenant-context";
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
 * THE HARD-REVIEW REGRESSION TESTS (the 043 hard-review round, reopened
 * 2026-11-15 against the unified head 1674849): the owner's independent
 * probe (audit-evidence/phase043-hard-review/probe.spec.ts — probe.log
 * is the before-evidence, probe-after.log the after-evidence)
 * reproduced TWO BLOCKING DEFECTS in the delivered reservation hard
 * protection. These are their pinning regression tests INSIDE the DB
 * suite:
 *
 * (1) THE NEGATIVE-STOCK BYPASS — planIssue's reserved-pool guard rode
 *     `!allowNegative`: an explicit `inventory.allow_negative_stock`
 *     policy (BR-013 — a tenant setting) silently switched the WHOLE
 *     protection OFF. THE FIXED LAW: the policy governs the UNRESERVED
 *     portion only (free stock may go negative); the PROTECTED QUOTA —
 *     the ACTIVE reserved pool beyond the issue's own entitlement — is
 *     untouchable at ANY policy position; the only door to it is the
 *     permission-gated, audited release.
 *
 * (2) THE DELIVERY IDENTITY HOLE — neither delivery CREATE nor POST
 *     verified that an order-line binding belongs to the delivery's
 *     order, that the line's item matches the order line's item, or
 *     that the warehouse is consistent; and the beneficiary allowance
 *     trusted the reservation ID ALONE (a qty read with no
 *     item/warehouse/holder verification). THE FIXED LAW: create AND
 *     post verify every binding (order-line ∈ the DN's order, item
 *     match, warehouse match for bound lines, no duplicate bindings),
 *     and every allowance row must be a LIVE reservation (ACTIVE,
 *     non-expired) matching the line's item, the DN's warehouse, and
 *     the beneficiary — plus the partial/concurrent settlement and
 *     atomic-rollback contracts stay intact.
 *
 * (3) THE ATP PROTECTION STANDING (the hard-review ATP-semantics fix):
 *     the promise point must distinguish — RELATIVE TO THE REMAINING
 *     QTY — UNPROTECTED / PARTIALLY_PROTECTED / FULLY_PROTECTED, show
 *     the protected and unprotected QUANTITIES, carry the bilingual
 *     (AR/EN) advisory note, and NEVER block a backorder (a shortage
 *     never blocks issuing a sales order).
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

interface Chain {
  moId: string;
  salesOrderId: string;
  fgLineId: string;
  fgItem: string;
}

async function buildChain(label: string): Promise<Chain> {
  const f = spec.fixture!;
  chainSeq += 1;
  const stamp = `${Date.now() % 100000}-${chainSeq}`;
  return withTenant(TENANT_M, async () => {
    const fgItem = await ensureItem(`M-HRV-${label}-${stamp}`, `hard-review FG (${label})`);
    const draft = await boms.create({
      itemId: fgItem,
      outputUomId: (await itemsStore.findItemById(fgItem))!.uomId,
      yieldPct: "100.0000",
      mainAllocationPct: "100.0000",
      note: `hard-review BOM (${label})`,
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
      batchNo: `M-HRV-${label}-MAT-${stamp}`,
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
      note: `hard-review order (${label})`,
      noteAr: null,
      actorId: null,
      totalNet: "100.0000",
      totalTax: "0.0000",
      totalGross: "100.0000",
      lines: [
        {
          itemId: fgItem,
          description: "hard-review FG line",
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
      note: `hard-review MO (${label})`,
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

async function receiveAt(itemId: string, warehouseId: string, qty: string, batch: string): Promise<void> {
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
): Promise<{ orderId: string; lineId: string }> {
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
          description: "the hard-review line",
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
    return { orderId: order.id, lineId: line.id };
  });
}

async function onHandAt(itemId: string, warehouseId: string): Promise<string> {
  return withTenant(TENANT_M, async () => {
    const row = await invStore.findItemStock(itemId, warehouseId);
    return row?.qty ?? "0.000000";
  });
}

async function activePoolQty(itemId: string, warehouseId: string): Promise<string> {
  return withTenant(TENANT_M, async () => {
    const rows = await invStore.listReservations({
      itemId,
      warehouseId,
      status: "ACTIVE",
      limit: 100,
    });
    return rows.reduce((sum, row) => sum.plus(new Decimal(row.qty)), new Decimal(0)).toFixed(6);
  });
}

async function setNegativePolicy(enabled: boolean): Promise<void> {
  await withTenant(TENANT_M, async () => {
    const { upsertSetting } = await import(
      "../../modules/tenancy/infrastructure/tenancy.store"
    );
    await upsertSetting("inventory.allow_negative_stock", enabled, M_ACTOR);
  });
}

async function draftBoundDelivery(input: {
  orderId: string;
  warehouseId: string;
  orderLineId: string;
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
      note: `the hard-review delivery (${input.label})`,
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
    spec.matItem = await ensureItem("M-HRV-MAT", "hard-review material");
  });
});

describe("the hard-review regression tests — the negative-stock bypass and the delivery identity hole, both closed", () => {
  it("(k) THE NEGATIVE-STOCK POLICY NEVER DISABLES THE PROTECTION: with the policy ON another order's delivery and a manual issue are REJECTED; the free (unreserved) portion still goes negative by policy; the pool floor above zero still binds; the beneficiary still ships", async () => {
    const f = spec.fixture!;
    const chain = await buildChain("K");
    await completeChain(chain, "10");
    await expect(onHandAt(chain.fgItem, f.warehouseFg)).resolves.toBe("10.000000");
    await expect(activePoolQty(chain.fgItem, f.warehouseFg)).resolves.toBe("10.000000");

    await setNegativePolicy(true);
    try {
      // (k1) The other order's delivery: REJECTED even under the policy
      // (pre-fix this post RESOLVED — the steal — the probe's defect 1).
      const thief = await issuedOrderLine(chain.fgItem, "10", f.warehouseFg, "K thief");
      const thiefNote = await draftBoundDelivery({
        orderId: thief.orderId,
        warehouseId: f.warehouseFg,
        orderLineId: thief.lineId,
        itemId: chain.fgItem,
        qty: "10",
        label: "K-thief",
      });
      await expect(
        withTenant(TENANT_M, () => deliveries.post(thiefNote, M_ACTOR)),
      ).rejects.toMatchObject({ code: "RESERVED_STOCK_PROTECTED" });

      // (k2) The manual issue path: same law under the policy.
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

      // (k3) Zero residue: the goods and the holder intact.
      await expect(onHandAt(chain.fgItem, f.warehouseFg)).resolves.toBe("10.000000");
      await expect(activePoolQty(chain.fgItem, f.warehouseFg)).resolves.toBe("10.000000");

      // (k4) THE POLICY'S DECLARED SCOPE — free stock (no reservation)
      // still goes negative by policy (BR-013 preserved).
      const freeItem = await withTenant(TENANT_M, () =>
        ensureItem(`M-HRV-K-FREE-${Date.now() % 100000}`, "the policy-scope free item"),
      );
      await receiveAt(freeItem, f.warehouseFg, "2", `M-HRV-K-FREE-${Date.now() % 100000}`);
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

      // (k5) THE POOL FLOOR ABOVE ZERO under the policy: 15 on hand,
      // 10 protected — the free 5 ships; the 6th unit is REJECTED.
      const poolItem = await withTenant(TENANT_M, () =>
        ensureItem(`M-HRV-K-POOL-${Date.now() % 100000}`, "the pool-floor item"),
      );
      await receiveAt(poolItem, f.warehouseFg, "15", `M-HRV-K-POOL-${Date.now() % 100000}`);
      await withTenant(TENANT_M, () =>
        reservations.create({
          itemId: poolItem,
          warehouseId: f.warehouseFg,
          qty: "10",
          holderType: "MANUAL",
          holderId: null,
          expiresAt: null,
          note: "the protected pool (k5)",
          actorId: M_ACTOR,
        }),
      );
      const freeShipper = await issuedOrderLine(poolItem, "5", f.warehouseFg, "K free shipper");
      const freeNote = await draftBoundDelivery({
        orderId: freeShipper.orderId,
        warehouseId: f.warehouseFg,
        orderLineId: freeShipper.lineId,
        itemId: poolItem,
        qty: "5",
        label: "K-free-5",
      });
      await withTenant(TENANT_M, () => deliveries.post(freeNote, M_ACTOR));
      await expect(onHandAt(poolItem, f.warehouseFg)).resolves.toBe("10.000000");
      const deepShipper = await issuedOrderLine(poolItem, "6", f.warehouseFg, "K deep shipper");
      const deepNote = await draftBoundDelivery({
        orderId: deepShipper.orderId,
        warehouseId: f.warehouseFg,
        orderLineId: deepShipper.lineId,
        itemId: poolItem,
        qty: "6",
        label: "K-deep-6",
      });
      await expect(
        withTenant(TENANT_M, () => deliveries.post(deepNote, M_ACTOR)),
      ).rejects.toMatchObject({ code: "RESERVED_STOCK_PROTECTED" });
      await expect(onHandAt(poolItem, f.warehouseFg)).resolves.toBe("10.000000");

      // (k6) THE BENEFICIARY under the policy: still ships its full
      // entitlement (the protection never blocks the right holder).
      const honestNote = await draftBoundDelivery({
        orderId: chain.salesOrderId,
        warehouseId: f.warehouseFg,
        orderLineId: chain.fgLineId,
        itemId: chain.fgItem,
        qty: "10",
        label: "K-honest",
      });
      const posted = await withTenant(TENANT_M, () => deliveries.post(honestNote, M_ACTOR));
      expect(posted.delivery.status).toBe("POSTED");
      await expect(onHandAt(chain.fgItem, f.warehouseFg)).resolves.toBe("0.000000");
      await expect(activePoolQty(chain.fgItem, f.warehouseFg)).resolves.toBe("0.000000");
    } finally {
      await setNegativePolicy(false);
    }
  });

  it("(l) THE DELIVERY IDENTITY CONTRACT: a foreign order line, an item mismatch, a warehouse mismatch, and duplicate bindings are REJECTED at create AND at post (create bypassed — zero residue); partial and concurrent settlements still settle exactly; a post that fails after its plans leaves ZERO residue", async () => {
    const f = spec.fixture!;

    // The attacker's chain: order A, line for FG-A, MTO reservation 10
    // of FG-A at WH-FG.
    const chainA = await buildChain("LA");
    await completeChain(chainA, "10");

    // The victim on ANOTHER ITEM: FG-V at WH-FG, 10 held (MANUAL).
    const victimItem = await withTenant(TENANT_M, () =>
      ensureItem(`M-HRV-L-V-${Date.now() % 100000}`, "the item-mismatch victim item"),
    );
    await receiveAt(victimItem, f.warehouseFg, "10", `M-HRV-L-V-${Date.now() % 100000}`);
    await withTenant(TENANT_M, () =>
      reservations.create({
        itemId: victimItem,
        warehouseId: f.warehouseFg,
        qty: "10",
        holderType: "MANUAL",
        holderId: null,
        expiresAt: null,
        note: "the victim's protected pool (item arm)",
        actorId: M_ACTOR,
      }),
    );

    // The victim on ANOTHER WAREHOUSE: FG-W at WH-RAW, 10 held; the
    // attacker's own chain for FG-W holds its 10 at WH-FG.
    const chainW = await buildChain("LW");
    await completeChain(chainW, "10");
    await receiveAt(chainW.fgItem, f.warehouseRaw, "10", `M-HRV-LW-RAW-${Date.now() % 100000}`);
    await withTenant(TENANT_M, () =>
      reservations.create({
        itemId: chainW.fgItem,
        warehouseId: f.warehouseRaw,
        qty: "10",
        holderType: "MANUAL",
        holderId: null,
        expiresAt: null,
        note: "the victim's protected pool (warehouse arm)",
        actorId: M_ACTOR,
      }),
    );

    // The bystander order (the foreign-line arm).
    const bystanderItem = await withTenant(TENANT_M, () =>
      ensureItem(`M-HRV-L-BY-${Date.now() % 100000}`, "the bystander item"),
    );
    const bystander = await issuedOrderLine(bystanderItem, "10", f.warehouseFg, "L bystander");

    // (l1) FOREIGN ORDER LINE at create.
    await expect(
      draftBoundDelivery({
        orderId: chainA.salesOrderId,
        warehouseId: f.warehouseFg,
        orderLineId: bystander.lineId,
        itemId: bystanderItem,
        qty: "10",
        label: "L-foreign-line",
      }),
    ).rejects.toMatchObject({ code: "DELIVERY_LINE_IDENTITY" });

    // (l2) ITEM MISMATCH at create — pre-fix accepted, and the post ate
    // the victim's pool through the miscounted allowance.
    await expect(
      draftBoundDelivery({
        orderId: chainA.salesOrderId,
        warehouseId: f.warehouseFg,
        orderLineId: chainA.fgLineId,
        itemId: victimItem,
        qty: "10",
        label: "L-item-mismatch",
      }),
    ).rejects.toMatchObject({ code: "DELIVERY_LINE_IDENTITY" });

    // (l3) WAREHOUSE MISMATCH at create (a bound line shipping from a
    // warehouse other than the order's).
    await expect(
      draftBoundDelivery({
        orderId: chainW.salesOrderId,
        warehouseId: f.warehouseRaw,
        orderLineId: chainW.fgLineId,
        itemId: chainW.fgItem,
        qty: "10",
        label: "L-warehouse-mismatch",
      }),
    ).rejects.toMatchObject({ code: "DELIVERY_LINE_IDENTITY" });

    // (l4) DEFENSE IN DEPTH — the store-written rogue rows (create
    // bypassed) die at POST with zero residue.
    const rogueItemNote = await withTenant(TENANT_M, async () => {
      const created = await salesStore.insertDeliveryNote({
        branchId: f.branchId,
        customerId: f.customerId,
        salesRepId: null,
        orderId: chainA.salesOrderId,
        warehouseId: f.warehouseFg,
        deliveryDate: "2026-03-17",
        currencyCode: "SAR",
        note: "the rogue item-mismatched delivery",
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
      withTenant(TENANT_M, () => deliveries.post(rogueItemNote, M_ACTOR)),
    ).rejects.toMatchObject({ code: "DELIVERY_LINE_IDENTITY" });
    await expect(onHandAt(victimItem, f.warehouseFg)).resolves.toBe("10.000000");
    await expect(activePoolQty(victimItem, f.warehouseFg)).resolves.toBe("10.000000");

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
    await expect(activePoolQty(chainW.fgItem, f.warehouseRaw)).resolves.toBe("10.000000");

    // (l5) DUPLICATE BINDINGS — at create AND at post (the rogue row).
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
    const rogueDupNote = await withTenant(TENANT_M, async () => {
      const created = await salesStore.insertDeliveryNote({
        branchId: f.branchId,
        customerId: f.customerId,
        salesRepId: null,
        orderId: chainA.salesOrderId,
        warehouseId: f.warehouseFg,
        deliveryDate: "2026-03-17",
        currencyCode: "SAR",
        note: "the rogue duplicate-binding delivery",
        noteAr: null,
        actorId: M_ACTOR,
        totalNet: "100.0000",
        totalTax: "0.0000",
        totalGross: "100.0000",
        lines: [
          {
            orderLineId: chainA.fgLineId,
            itemId: chainA.fgItem,
            description: "the first binding",
            descriptionAr: null,
            qty: "5",
            unitPrice: "10.000000",
            discountAmount: "0.0000",
            netAmount: "50.0000",
            batchId: null,
            serialIds: null,
            note: null,
          },
          {
            orderLineId: chainA.fgLineId,
            itemId: chainA.fgItem,
            description: "the duplicate binding",
            descriptionAr: null,
            qty: "5",
            unitPrice: "10.000000",
            discountAmount: "0.0000",
            netAmount: "50.0000",
            batchId: null,
            serialIds: null,
            note: null,
          },
        ],
      });
      return created.id;
    });
    await expect(
      withTenant(TENANT_M, () => deliveries.post(rogueDupNote, M_ACTOR)),
    ).rejects.toMatchObject({ code: "DELIVERY_LINE_IDENTITY" });
    await expect(onHandAt(chainA.fgItem, f.warehouseFg)).resolves.toBe("10.000000");
    await expect(activePoolQty(chainA.fgItem, f.warehouseFg)).resolves.toBe("10.000000");

    // (l6) PARTIAL SETTLEMENTS still work: 4 then 6 — the coverage
    // retires exactly, the remainder stays protected between them.
    const part1 = await draftBoundDelivery({
      orderId: chainA.salesOrderId,
      warehouseId: f.warehouseFg,
      orderLineId: chainA.fgLineId,
      itemId: chainA.fgItem,
      qty: "4",
      label: "L-part-1",
    });
    await withTenant(TENANT_M, () => deliveries.post(part1, M_ACTOR));
    await expect(onHandAt(chainA.fgItem, f.warehouseFg)).resolves.toBe("6.000000");
    await expect(activePoolQty(chainA.fgItem, f.warehouseFg)).resolves.toBe("6.000000");

    // (l7) CONCURRENT PARTIAL SETTLEMENTS: the remaining 6 and an
    // over-shipping 7 post TOGETHER — the exact 6 fulfills, the 7
    // loses (the stock floor), never a double-settle.
    const exactNote = await draftBoundDelivery({
      orderId: chainA.salesOrderId,
      warehouseId: f.warehouseFg,
      orderLineId: chainA.fgLineId,
      itemId: chainA.fgItem,
      qty: "6",
      label: "L-concurrent-exact",
    });
    const overNote = await draftBoundDelivery({
      orderId: chainA.salesOrderId,
      warehouseId: f.warehouseFg,
      orderLineId: chainA.fgLineId,
      itemId: chainA.fgItem,
      qty: "7",
      label: "L-concurrent-over",
    });
    const settled = await Promise.allSettled([
      withTenant(TENANT_M, () => deliveries.post(exactNote, M_ACTOR)),
      withTenant(TENANT_M, () => deliveries.post(overNote, M_ACTOR)),
    ]);
    const fulfilled = settled.filter((outcome) => outcome.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    await expect(onHandAt(chainA.fgItem, f.warehouseFg)).resolves.toBe("0.000000");
    await expect(activePoolQty(chainA.fgItem, f.warehouseFg)).resolves.toBe("0.000000");

    // (l8) ATOMIC ROLLBACK under the identity gates: a post that fails
    // AFTER its plans (the DEL numbering sabotaged exactly once) leaves
    // ZERO residue — the issue, the settlement, and the state intact.
    const chainR = await buildChain("LR");
    await completeChain(chainR, "10");
    const rollbackNote = await draftBoundDelivery({
      orderId: chainR.salesOrderId,
      warehouseId: f.warehouseFg,
      orderLineId: chainR.fgLineId,
      itemId: chainR.fgItem,
      qty: "4",
      label: "L-rollback",
    });
    const realReserve = specNumbering.reserve.bind(specNumbering);
    const spy: MockInstance<typeof specNumbering.reserve> = vi.spyOn(
      specNumbering,
      "reserve",
    ).mockImplementationOnce(async (input) => {
      if (input.docType === "delivery_note") {
        throw new Error("the deliberate hard-review post-failure probe");
      }
      return realReserve(input);
    });
    try {
      await expect(
        withTenant(TENANT_M, () => deliveries.post(rollbackNote, M_ACTOR)),
      ).rejects.toThrow("the deliberate hard-review post-failure probe");
    } finally {
      spy.mockRestore();
    }
    await expect(onHandAt(chainR.fgItem, f.warehouseFg)).resolves.toBe("10.000000");
    await expect(activePoolQty(chainR.fgItem, f.warehouseFg)).resolves.toBe("10.000000");
    const rollbackRow = await withTenant(TENANT_M, () => deliveries.find(rollbackNote));
    expect(rollbackRow.status).toBe("DRAFT");
    // And the protection still holds for the next attempt.
    const thiefR = await issuedOrderLine(chainR.fgItem, "10", f.warehouseFg, "LR thief");
    const thiefRNote = await draftBoundDelivery({
      orderId: thiefR.orderId,
      warehouseId: f.warehouseFg,
      orderLineId: thiefR.lineId,
      itemId: chainR.fgItem,
      qty: "10",
      label: "LR-thief",
    });
    await expect(
      withTenant(TENANT_M, () => deliveries.post(thiefRNote, M_ACTOR)),
    ).rejects.toMatchObject({ code: "RESERVED_STOCK_PROTECTED" });
  });

  it("(m) THE ATP PROTECTION STANDING at the promise point: UNPROTECTED vs PARTIALLY_PROTECTED vs FULLY_PROTECTED relative to the REMAINING qty, with the protected/unprotected QUANTITIES and the bilingual advisory note — and a shortage NEVER blocks issuing a sales order (the backorder law)", async () => {
    const f = spec.fixture!;

    // (m1) UNPROTECTED: free stock, no allocation — the full remaining
    // qty is exposed; the note names it and the quantities.
    const freeItem = await withTenant(TENANT_M, () =>
      ensureItem(`M-HRV-M-FREE-${Date.now() % 100000}`, "the standing free item"),
    );
    await receiveAt(freeItem, f.warehouseFg, "10", `M-HRV-M-FREE-${Date.now() % 100000}`);
    const freeOrder = await issuedOrderLine(freeItem, "10", f.warehouseFg, "M free order");
    const unprotected = await withTenant(TENANT_M, () =>
      salesOrdersSvc.checkLineAtp(freeOrder.orderId, freeOrder.lineId, {
        promisedDate: "2026-03-18",
        actorId: M_ACTOR,
      }),
    );
    expect(unprotected.verdict).toBe("OK");
    expect(unprotected.protection).toBe("UNPROTECTED");
    expect(unprotected.remainingQty).toBe("10.000000");
    expect(unprotected.protectedQty).toBe("0.000000");
    expect(unprotected.unprotectedQty).toBe("10.000000");
    expect(unprotected.advisoryNote.en).toContain("unprotected");
    expect(unprotected.advisoryNote.en).toContain("10.000000");
    expect(unprotected.advisoryNote.ar).toContain("غير محمي");
    expect(unprotected.advisoryNote.ar).toContain("10.000000");

    // (m2) FULLY_PROTECTED: the MTO chain covers the full line qty.
    const chain = await buildChain("M");
    await completeChain(chain, "10");
    const full = await withTenant(TENANT_M, () =>
      salesOrdersSvc.checkLineAtp(chain.salesOrderId, chain.fgLineId, {
        promisedDate: "2026-03-18",
        actorId: M_ACTOR,
      }),
    );
    expect(full.protection).toBe("FULLY_PROTECTED");
    expect(full.remainingQty).toBe("10.000000");
    expect(full.protectedQty).toBe("10.000000");
    expect(full.unprotectedQty).toBe("0.000000");
    expect(full.advisoryNote.en).toContain("Fully protected");
    expect(full.advisoryNote.ar).toContain("محمي بالكامل");

    // (m3) PARTIALLY_PROTECTED: a part-shipped line whose remainder
    // exceeds its remaining coverage — 10 line, 4 shipped, 6 coverage
    // → protected 6, unprotected 2.
    const chainP = await buildChain("MP");
    await completeChain(chainP, "6"); // the MO made only 6 of the 10
    const partialNote = await draftBoundDelivery({
      orderId: chainP.salesOrderId,
      warehouseId: f.warehouseFg,
      orderLineId: chainP.fgLineId,
      itemId: chainP.fgItem,
      qty: "4",
      label: "M-partial",
    });
    await withTenant(TENANT_M, () => deliveries.post(partialNote, M_ACTOR));
    const partial = await withTenant(TENANT_M, () =>
      salesOrdersSvc.checkLineAtp(chainP.salesOrderId, chainP.fgLineId, {
        promisedDate: "2026-03-18",
        actorId: M_ACTOR,
      }),
    );
    expect(partial.remainingQty).toBe("6.000000"); // 10 − 4 shipped
    expect(partial.protection).toBe("PARTIALLY_PROTECTED");
    expect(partial.protectedQty).toBe("2.000000"); // 6 coverage − 4 retired
    expect(partial.unprotectedQty).toBe("4.000000");
    expect(partial.advisoryNote.en).toContain("Partially protected");
    expect(partial.advisoryNote.en).toContain("2.000000");
    expect(partial.advisoryNote.en).toContain("4.000000");
    expect(partial.advisoryNote.ar).toContain("محمي جزئيًا");
    expect(partial.advisoryNote.ar).toContain("2.000000");
    expect(partial.advisoryNote.ar).toContain("4.000000");

    // (m4) THE BACKORDER LAW: zero stock still issues — no ATP gate.
    const zeroItem = await withTenant(TENANT_M, () =>
      ensureItem(`M-HRV-M-ZERO-${Date.now() % 100000}`, "the standing zero-stock item"),
    );
    const zeroOrder = await issuedOrderLine(zeroItem, "10", f.warehouseFg, "M zero order");
    const zeroCheck = await withTenant(TENANT_M, () =>
      salesOrdersSvc.checkLineAtp(zeroOrder.orderId, zeroOrder.lineId, {
        promisedDate: "2026-03-18",
        actorId: M_ACTOR,
      }),
    );
    expect(zeroCheck.verdict).toBe("SHORT");
    expect(zeroCheck.protection).toBe("UNPROTECTED");
    const issuedOrder = await withTenant(TENANT_M, () =>
      salesOrdersSvc.issue(zeroOrder.orderId, M_ACTOR),
    );
    expect(issuedOrder.status).toBe("ISSUED");
  });
});
