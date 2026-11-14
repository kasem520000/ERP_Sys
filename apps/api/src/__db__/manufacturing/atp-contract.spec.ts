import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import * as itemsStore from "../../modules/items/infrastructure/items.store";
import * as partnersStore from "../../modules/partners/infrastructure/partners.store";
import * as salesStore from "../../modules/sales/infrastructure/sales.store";
import { SalesOrderService } from "../../modules/sales/application/orders";
import { AtpService } from "../../modules/manufacturing/application/atp-service";
import { DeliveryNoteService } from "../../modules/sales/application/deliveries";
import { PickingService } from "../../modules/inventory/application/picking-service";
import { TransferService } from "../../modules/inventory/application/transfer-service";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import {
  M_ACTOR,
  TENANT_M,
  atpSrv,
  purchaseOrdersSvc,
  setupMfgFixture,
  stock,
  type MfgFixture,
} from "./fixtures";

/**
 * PHASE-043 audit item 6 — the ATP/CTP judgment contract, made explicit
 * and time-phased.
 *
 * The audit's findings (confirmed by code reading): the verdict compared
 * the requested qty against available-NOW only — the requested date was
 * recorded and returned but never entered the judgment — so a promise
 * weeks out went SHORT even when the covering supply was already
 * scheduled to land in time; an in-transit transfer backed a suggested
 * date at the as-of date (against the service's own header law: BR-016 —
 * in-transit is VISIBLE but never promiseable); a batch expiring before
 * the promise date still promised; undated legs counted at the as-of
 * date.
 *
 * THE CONTRACT (documented in the service header, asserted here):
 * 1. The basis is expiry-aware against the promise date (a batch whose
 *    expiry precedes the requested date never backs it — the engine's
 *    batch-aware-carry law, M-10).
 * 2. Coverage at the requested date = the expiry-aware basis + the DATED
 *    incoming legs (open POs, open MOs) arriving on/before the requested
 *    date, inside the horizon. Verdict OK iff coverage ≥ the requested
 *    qty (the trivial case: the basis alone covers).
 * 3. In-transit transfers + undated legs: VISIBLE in the incoming
 *    evidence, NEVER promiseable (BR-016 + the no-date-no-promise law).
 * 4. Unreserved sibling demand does NOT reduce the basis (the
 *    soft-reservation law: only reservations hold) — the SHORT verdict is
 *    the line's own over-promise warning.
 * 5. A requested date in the past is floored to the as-of date.
 *
 * All dates are relative to TODAY (the service's as-of is the wall
 * clock — the goldens' fence-test pattern).
 */

const specAudit = new AuditService(new DrizzleAuditStore());
const specPosting = new PostingService(specAudit, new PartnerSubledgerService());
const specNumbering = new NumberingService(specAudit);
const transfers = new TransferService(specAudit, specPosting, specNumbering);
const salesOrdersSvc = new SalesOrderService(specAudit, specNumbering, new AtpService());
void DeliveryNoteService;
void PickingService;

const spec: { fixture?: MfgFixture; a?: string; b?: string; c?: string; d?: string } = {};

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

beforeAll(async () => {
  spec.fixture = await setupMfgFixture();
  await withTenant(TENANT_M, async () => {
    spec.a = await ensureItem("M-ATP-A", "ATP contract A (dated supply)");
    spec.b = await ensureItem("M-ATP-B", "ATP contract B (expiry)");
    spec.c = await ensureItem("M-ATP-C", "ATP contract C (in-transit)");
    spec.d = await ensureItem("M-ATP-D", "ATP contract D (sibling demand)");
  });
});

describe("PHASE-043 audit item 6 — the ATP/CTP judgment contract (time-phased, explicit)", () => {
  it("law 2 — DATED supply arriving BEFORE the requested date covers it (OK); arriving after → SHORT with the honest suggested date", async () => {
    const f = spec.fixture!;
    await withTenant(TENANT_M, async () => {
      // A covering PO landing at day(10), qty 8 — no on-hand at all.
      const po = await purchaseOrdersSvc.create({
        branchId: f.branchId,
        supplierId: f.supplierId,
        orderDate: day(0),
        expectedDate: day(10),
        currencyCode: "SAR",
        exchangeRate: null,
        note: "ATP contract — dated supply",
        noteAr: null,
        actorId: M_ACTOR,
        lines: [{ itemId: spec.a!, qty: "8", unitPrice: null, taxCodeId: null, note: null }],
      });
      await purchaseOrdersSvc.submit(po.id, M_ACTOR);

      // Requested at day(20): the supply lands IN TIME → OK (pre-fix:
      // SHORT — the verdict compared against available-now only).
      const inTime = await atpSrv.check({
        itemId: spec.a!,
        warehouseId: f.warehouseFg,
        qty: "5",
        date: day(20),
      });
      expect(inTime.verdict).toBe("OK");
      expect(inTime.availableNow).toBe("0.000000");
      expect(inTime.suggestedDate).toBe(day(10)); // the informative landing
      expect(inTime.incoming.map((leg) => [leg.kind, leg.date, leg.qty])).toContainEqual([
        "OPEN_PO",
        day(10),
        "8.000000",
      ]);

      // Requested at day(5): the supply lands TOO LATE → SHORT with the
      // honest CTP date (the day the supply actually covers).
      const tooLate = await atpSrv.check({
        itemId: spec.a!,
        warehouseId: f.warehouseFg,
        qty: "5",
        date: day(5),
      });
      expect(tooLate.verdict).toBe("SHORT");
      expect(tooLate.suggestedDate).toBe(day(10));
    });
  });

  it("law 1 — a batch EXPIRING before the promise date never backs it; before its expiry it still does", async () => {
    const f = spec.fixture!;
    await withTenant(TENANT_M, async () => {
      // 10 units in a batch expiring at day(5).
      await stock.manualReceipt({
        itemId: spec.b!,
        warehouseId: f.warehouseFg,
        qty: "10",
        unitCost: "2.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: day(0),
        batchNo: `M-ATP-B-EXP-${Date.now() % 100000}`,
        batchExpiry: day(5),
        actorId: M_ACTOR,
      });
      // Promised at day(20): the batch is gone by then → SHORT, the basis 0
      // (pre-fix: OK — the expiring batch counted).
      const afterExpiry = await atpSrv.check({
        itemId: spec.b!,
        warehouseId: f.warehouseFg,
        qty: "5",
        date: day(20),
      });
      expect(afterExpiry.verdict).toBe("SHORT");
      expect(afterExpiry.availableNow).toBe("0.000000");
      expect(afterExpiry.suggestedDate).toBeNull();
      // Promised at day(3): the batch is alive → OK.
      const beforeExpiry = await atpSrv.check({
        itemId: spec.b!,
        warehouseId: f.warehouseFg,
        qty: "5",
        date: day(3),
      });
      expect(beforeExpiry.verdict).toBe("OK");
      expect(beforeExpiry.availableNow).toBe("10.000000");
    });
  });

  it("law 3 — an in-transit transfer is VISIBLE evidence but NEVER promiseable (BR-016 — no suggested date off the truck)", async () => {
    const f = spec.fixture!;
    await withTenant(TENANT_M, async () => {
      // Source stock at the raw warehouse, then dispatch a transfer of 10
      // to the FG warehouse (IN_TRANSIT).
      await stock.manualReceipt({
        itemId: spec.c!,
        warehouseId: f.warehouseRaw,
        qty: "10",
        unitCost: "2.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: day(0),
        batchNo: `M-ATP-C-SRC-${Date.now() % 100000}`,
        batchExpiry: day(300),
        actorId: M_ACTOR,
      });
      const transfer = await transfers.create({
        fromWarehouseId: f.warehouseRaw,
        toWarehouseId: f.warehouseFg,
        lines: [{ itemId: spec.c!, qty: "10" }],
        note: "ATP contract — in-transit",
        noteAr: null,
        actorId: M_ACTOR,
      });
      await transfers.dispatch(transfer.id, M_ACTOR);

      // The FG warehouse holds nothing; the truck holds 10 — the promise
      // NEVER rides it: SHORT, no suggested date (pre-fix: the suggested
      // date was the as-of date — a promise off the truck).
      const result = await atpSrv.check({
        itemId: spec.c!,
        warehouseId: f.warehouseFg,
        qty: "5",
        date: day(2),
      });
      expect(result.verdict).toBe("SHORT");
      expect(result.suggestedDate).toBeNull();
      // VISIBLE: the transfer rides the incoming evidence.
      expect(result.incoming.map((leg) => leg.kind)).toContain("INBOUND_TRANSFER");
    });
  });

  it("law 4 — unreserved sibling demand does NOT reduce the basis (the soft-reservation law: only reservations hold)", async () => {
    const f = spec.fixture!;
    await withTenant(TENANT_M, async () => {
      await stock.manualReceipt({
        itemId: spec.d!,
        warehouseId: f.warehouseFg,
        qty: "10",
        unitCost: "2.000000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: day(0),
        batchNo: `M-ATP-D-${Date.now() % 100000}`,
        batchExpiry: day(300),
        actorId: M_ACTOR,
      });
      // An ISSUED sibling order consuming all 10 — with NO reservation.
      const sibling = await salesStore.insertSalesOrder({
        branchId: f.branchId,
        customerId: f.customerId,
        salesRepId: null,
        warehouseId: f.warehouseFg,
        quotationId: null,
        orderDate: day(0),
        expectedDate: day(10),
        currencyCode: "SAR",
        exchangeRate: null,
        note: "ATP contract — the unreserved sibling",
        noteAr: null,
        actorId: null,
        totalNet: "100.0000",
        totalTax: "0.0000",
        totalGross: "100.0000",
        lines: [
          {
            itemId: spec.d!,
            description: "sibling line",
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
      await salesOrdersSvc.submit(sibling.id, M_ACTOR);
      await salesOrdersSvc.approve(sibling.id, M_ACTOR);
      await salesOrdersSvc.issue(sibling.id, M_ACTOR);

      // The basis still promises 10 — the sibling holds nothing until it
      // RESERVES (the soft model; the SHORT verdict is the line's own
      // warning).
      const result = await atpSrv.check({
        itemId: spec.d!,
        warehouseId: f.warehouseFg,
        qty: "10",
        date: day(7),
      });
      expect(result.verdict).toBe("OK");
      expect(result.availableNow).toBe("10.000000");
    });
  });

  it("law 5 — a requested date in the past is floored to the as-of date (a promise never back-dates)", async () => {
    const f = spec.fixture!;
    await withTenant(TENANT_M, async () => {
      // atpB's batch (10 units, expiring day(+5)) is alive TODAY: a
      // promise dated 30 days AGO floors to TODAY and the alive batch
      // backs it — OK, exactly like a promise dated today (the floor in
      // action; a promise dated day(+20) is SHORT — the batch is gone).
      const backdated = await atpSrv.check({
        itemId: spec.b!,
        warehouseId: f.warehouseFg,
        qty: "5",
        date: day(-30),
      });
      expect(backdated.requestedDate).toBe(day(-30)); // recorded verbatim
      expect(backdated.verdict).toBe("OK"); // the floor: behaves as today
      const todayPromise = await atpSrv.check({
        itemId: spec.b!,
        warehouseId: f.warehouseFg,
        qty: "5",
        date: day(0),
      });
      expect(todayPromise.verdict).toBe("OK");
      const future = await atpSrv.check({
        itemId: spec.b!,
        warehouseId: f.warehouseFg,
        qty: "5",
        date: day(20),
      });
      expect(future.verdict).toBe("SHORT");
      void partnersStore;
    });
  });
});
