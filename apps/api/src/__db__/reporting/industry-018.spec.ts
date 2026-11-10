import { beforeAll, describe, expect, it } from "vitest";

import {
  ALL_KNOWN_PERMISSIONS,
  R_ACTOR,
  fullContext,
  newRunService,
  withTenant,
} from "./fixtures";
import { ensureTestDb, superuserClient } from "../test-db";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { CoaService } from "../../modules/accounting/application/coa-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { TaxResolverService } from "../../modules/tax/application/tax-resolver-service";
import { TaxCodesService } from "../../modules/tax/application/codes-service";
import { RegistrationService } from "../../modules/tax/application/registration-service";
import { WarehouseService } from "../../modules/inventory/application/warehouse-service";
import { StockService } from "../../modules/inventory/application/stock-service";
import { TrackingService } from "../../modules/inventory/application/tracking-service";
import { SalesInvoiceService } from "../../modules/sales/application/invoices";
import { BomService } from "../../modules/manufacturing/application/bom-service";
import { ProductionOrderService } from "../../modules/manufacturing/application/production-order-service";
import { InspectionService } from "../../modules/manufacturing/application/inspection-service";
import { ConfigRepository } from "../../modules/configuration/infrastructure/config-repository";
import { ResolveEffectiveConfigService } from "../../modules/configuration/application/resolve/resolve-service";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import type { ReportResult } from "../../modules/reporting/application/contract";

/**
 * PHASE-018 T40 · the three manufacturing report fixtures
 * (industries/reports/README PHASE-018 rows; the README rule 5: "cover with a
 * fixture asserting totals against journal lines where applicable"): the
 * contracts over a dedicated, fully-journaled tenant R18 whose whole book
 * runs with the QC GATE ON (the setting is seeded ON for the tenant and LEFT
 * IN PLACE — R18 is single-use) and flows ONLY through the real services
 * (BomService → ProductionOrderService consume/scrap/complete →
 * InspectionService releases + a FAIL+SCRAP qc_scrap → SalesInvoiceService):
 *
 * - Order A (dough, R18-RAW→R18-RAW, rates 0): BOM yield 100 (cocoa 0.2 /
 *   box 0.1); release plans cocoa 20 + box 10; consume 20×4 + 10×2 =
 *   100.0000 (DR WIP · CR INV); complete 100 → fgValue 100.0000 @ 1.000000,
 *   dough batch QUARANTINED → PASS releases it (the in-process semi-finished
 *   release B1's explicit-batch consume needs).
 * - Order B1 (cake, fg R18-FG, labor 0.1 / overhead 0.05): consume dough 50
 *   @ 1.00 → 50.0000; scrap 2.0000 (WIP 48); complete 50 → labor 5.0000,
 *   overhead 2.5000, fgValue 55.5000 @ 1.110000, cake batch #1 QUARANTINED
 *   → PASS (sampled 10) releases it.
 * - Sale: 20 cake @ 25 off batch #1 (NS tax) → COGS 22.2000 (WAC 1.11).
 * - Order B2 (cake, rates 0): consume the last dough 50 @ 1.00 → 50.0000;
 *   complete 50 → fgValue 50.0000 @ 1.000000, cake batch #2 QUARANTINED
 *   (position 80 / 83.300000 → avgCost 1.041250) → FAIL (sampled 2) +
 *   SCRAP: the whole batch on-hand 50 @ 1.041250 = 52.0625 (DR
 *   PRODUCTION_SCRAP · CR FG-INV), batch stays QUARANTINED at zero.
 *
 * The report totals then tie EXACTLY: consumed 200.0000 == Σ WIP debits of
 * the three consume journals (production-materials-gl-tie at tolerance 0).
 */

/** Dedicated PHASE-018 reporting tenant (owns its book end to end). */
export const TENANT_R18 = "58585858-5858-5858-5858-585858585858";
/** The invoice approver (BR-034 SoD: the creator never approves their own). */
const R18_APPROVER = "5a5a5a5a-0000-4000-8000-0000000005a1";

/** Order notes — the book's idempotency markers. */
const ORDER_A_NOTE = "R18 reports book — dough order A";
const ORDER_B1_NOTE = "R18 reports book — cake order B1";
const ORDER_B2_NOTE = "R18 reports book — cake order B2";

const TODAY = () => new Date().toISOString().slice(0, 10);
const plusDays = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const resolver = new TaxResolverService();
const periods = new PeriodService(audit);
const coa = new CoaService(audit);
const warehouses = new WarehouseService(audit);
const taxCodes = new TaxCodesService(audit);
const registrations = new RegistrationService(audit);
const stock = new StockService(audit, posting);
const tracking = new TrackingService(audit, stock);
const boms = new BomService(audit);
const orders = new ProductionOrderService(
  audit,
  numbering,
  boms,
  posting,
  tracking,
  new InboxService(),
  new ResolveEffectiveConfigService(new ConfigRepository()),
);
const inspections = new InspectionService(audit, posting, tracking);
const salesInvoices = new SalesInvoiceService(audit, posting, numbering, resolver);

interface R18Fixture {
  branchId: string;
  warehouseRawId: string;
  warehouseFgId: string;
  cocoaItemId: string;
  boxItemId: string;
  doughItemId: string;
  cakeItemId: string;
  cocoaBatchId: string;
  boxBatchId: string;
  doughBatchId: string;
  doughBatchNo: string;
  cakeBatch1Id: string;
  cakeBatch1No: string;
  cakeBatch2Id: string;
  cakeBatch2No: string;
  orderAId: string;
  orderANo: string;
  orderB1Id: string;
  orderB1No: string;
  orderB2Id: string;
  orderB2No: string;
  invoiceNo: string | null;
}

let fixture: R18Fixture | undefined;

function assertDefined<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null) throw new Error(`fixture ${label} missing`);
  return value;
}

/** Boots tenant R18's gate-on manufacturing book (idempotent — the book is guarded by order A's note). */
async function setupR18Fixture(): Promise<R18Fixture> {
  if (fixture !== undefined) return fixture;
  ensureTestDb();
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant R18 (manufacturing reporting 018)', 'المستأجر ر-١٨', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_R18],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status)
     VALUES ($1, 'reporting-actor@fixture.test', 'Reporting Actor', 'x', 'ACTIVE'),
            ($2, 'r18-approver@fixture.test', 'R18 Approver', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [R_ACTOR, R18_APPROVER],
  );
  // The QC gate is ON for the WHOLE book (and stays on — R18 is a dedicated,
  // single-use tenant; the setting is deliberately left in place).
  await su.query(
    `INSERT INTO tenant_settings (id, tenant_id, key, value)
     VALUES (gen_random_uuid(), $1, 'manufacturing.qc_gate', '"required"'::jsonb)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [TENANT_R18],
  );
  await su.end();

  const built = await withTenant(TENANT_R18, async () => {
    const { provisionCoaTemplate, seedMasterDataBasics, insertAccountPurpose, listBranches, insertBranch } =
      await import("../../modules/tenancy/infrastructure/tenancy.store");
    const { findAccountByCode, findActivePurpose, findFiscalYearByName } = await import(
      "../../modules/accounting/infrastructure/accounting.store"
    );
    const partnersStore = await import("../../modules/partners/infrastructure/partners.store");
    const itemsStore = await import("../../modules/items/infrastructure/items.store");
    const inventoryStore = await import("../../modules/inventory/infrastructure/inventory.store");
    const salesStore = await import("../../modules/sales/infrastructure/sales.store");
    await seedMasterDataBasics();
    await provisionCoaTemplate();

    // Purpose map (the mfg-fixture pattern — provisionCoaTemplate normally
    // maps the four manufacturing markers; explicit is the idempotent
    // belt-and-braces).
    const byCode = async (code: string) => {
      const account = await findAccountByCode(code);
      if (account === undefined) throw new Error(`fixture account ${code} missing`);
      return account;
    };
    const mapPurpose = async (purposeKey: string, code: string) => {
      const existing = await findActivePurpose(purposeKey);
      if (existing !== undefined) return existing.accountId;
      const account = await byCode(code);
      await insertAccountPurpose({ purposeKey, accountId: account.id, activeFrom: "2025-12-01" });
      return account.id;
    };
    await mapPurpose("INVENTORY", "1140");
    await mapPurpose("WIP", "1160");
    await mapPurpose("PRODUCTION_SCRAP", "5120");
    await mapPurpose("PRODUCTION_LABOR", "5410");
    await mapPurpose("PRODUCTION_OVERHEAD", "5420");
    await mapPurpose("COGS", "5100");
    await mapPurpose("AR_CONTROL", "1130");
    await mapPurpose("SALES_REVENUE", "4100");
    await mapPurpose("VAT_PAYABLE", "2120");
    await mapPurpose("OPENING_EQUITY", "3100");
    // The COUNT_GAIN seed path credits INVENTORY_APPRECIATION (4920) — the
    // template leaves it unmarked: create the host account if missing, map it.
    let appreciation = await findAccountByCode("4920");
    if (appreciation === undefined) {
      appreciation = await coa.create(R_ACTOR, {
        code: "4920",
        name: "Inventory appreciation",
        nameAr: "زيادة قيمة المخزون",
        type: "REVENUE",
        parentId: (await byCode("4000")).id,
        currencyCode: null,
        isGroup: false,
      });
    }
    if ((await findActivePurpose("INVENTORY_APPRECIATION")) === undefined) {
      await insertAccountPurpose({
        purposeKey: "INVENTORY_APPRECIATION",
        accountId: appreciation.id,
        activeFrom: "2025-12-01",
      });
    }

    // The fiscal year covering today (all book dates ride TODAY — the honest
    // document dates the services stamp).
    const year = TODAY().slice(0, 4);
    if ((await findFiscalYearByName(`FY${year}`)) === undefined) {
      await periods.createYear(R_ACTOR, {
        name: `FY${year}`,
        startDate: `${year}-01-01`,
        endDate: `${year}-12-31`,
      });
    }

    const branches = await listBranches(null);
    const mainBranch =
      branches.find((b) => b.code === "MAIN") ??
      (await insertBranch({ code: "MAIN", name: "Main branch", nameAr: "الفرع الرئيسي", address: null }));
    const existingWarehouses = await warehouses.list({ limit: 20, activeOnly: false });
    const rawStore =
      existingWarehouses.find((w) => w.code === "R18-RAW") ??
      (await warehouses.create({
        branchId: mainBranch.id,
        code: "R18-RAW",
        name: "R18 raw materials store",
        nameAr: "مخزن مواد ر-١٨",
        inventoryAccountId: null,
        note: null,
        role: "RAW",
        actorId: R_ACTOR,
      }));
    const fgStore =
      existingWarehouses.find((w) => w.code === "R18-FG") ??
      (await warehouses.create({
        branchId: mainBranch.id,
        code: "R18-FG",
        name: "R18 finished goods store",
        nameAr: "مخزن تام ر-١٨",
        inventoryAccountId: null,
        note: null,
        role: "FG",
        actorId: R_ACTOR,
      }));

    const uoms = await itemsStore.listUoms();
    const pcs = assertDefined(uoms.find((u) => u.code === "PCS"), "PCS uom");
    const ensureItem = async (sku: string, name: string, nameAr: string, shelfLifeDays: number) => {
      const found = await itemsStore.findItemBySku(sku);
      if (found !== undefined) return found.id;
      const created = await itemsStore.insertItem({
        sku,
        name,
        nameAr,
        kind: "STOCK",
        uomId: pcs.id,
        categoryId: null,
        taxCodeId: null,
        costingMethod: "WAC",
        trackBatch: true,
        trackSerial: false,
        trackImei: false,
        hasExpiry: true,
        shelfLifeDays,
        reorderLevel: null,
        reorderQty: null,
        basePrice: null,
      });
      return created.id;
    };
    const cocoaItem = await ensureItem("R18-COCOA", "R18 cocoa", "كاكاو ر-١٨", 120);
    const boxItem = await ensureItem("R18-BOX", "R18 box", "علب ر-١٨", 365);
    const doughItem = await ensureItem("R18-DOUGH", "R18 dough (semi-finished)", "عجين ر-١٨", 2);
    const cakeItem = await ensureItem("R18-CAKE", "R18 cake", "كيك ر-١٨", 3);

    // Customer R18-C1 on NET30 terms.
    const terms = await partnersStore.listCreditTerms();
    const net30 = terms.find((t) => t.days === 30) ?? terms[0]!;
    const existingCustomer = await partnersStore.findPartnerByCode("R18-C1");
    const customerId =
      existingCustomer?.id ??
      (
        await partnersStore.insertPartner({
          kind: "CUSTOMER",
          code: "R18-C1",
          name: "مخبز ر-١٨",
          nameAr: null,
          taxNumber: null,
          creditLimit: null,
          creditTermsId: net30.id,
          priceListId: null,
        })
      ).id;

    // SA tax registration (REGISTERED) + the NS code — the sale's tax leg.
    if ((await registrations.list()).length === 0) {
      await registrations.upsert({
        countryCode: "SA",
        status: "REGISTERED",
        registrationNumber: "310000000000003",
        effectiveFrom: "2016-01-01",
        effectiveTo: null,
        actorId: R_ACTOR,
        note: "R18 reports fixture registration",
      });
    }
    const existingCodes = await taxCodes.list({ countryCode: "SA" });
    const nsTaxCode =
      existingCodes.find((row) => row.code === "NS")?.id ??
      (
        await taxCodes.create({
          code: "NS",
          name: "Not subject",
          nameAr: null,
          countryCode: "SA",
          defaultTreatment: "NOT_SUBJECT",
          actorId: R_ACTOR,
        })
      ).id;

    // Material stock into R18-RAW (guarded by the on-hand read model): one
    // batch each — cocoa 500 @ 4, box 500 @ 2.
    const receiveMaterial = async (
      itemId: string,
      qty: string,
      unitCost: string,
      batchNo: string,
      batchExpiry: string,
    ) => {
      const onHand = await inventoryStore.findItemStock(itemId, rawStore.id);
      if (onHand !== undefined && Number(onHand.qty) > 0) return;
      await stock.manualReceipt({
        itemId,
        warehouseId: rawStore.id,
        qty,
        unitCost,
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: TODAY(),
        batchNo,
        batchExpiry,
        actorId: R_ACTOR,
      });
    };
    await receiveMaterial(cocoaItem, "500", "4.000000", "R18-C1", plusDays(120));
    await receiveMaterial(boxItem, "500", "2.000000", "R18-B1", plusDays(365));
    const batchByNo = async (itemId: string, batchNo: string) => {
      const rows = await tracking.listBatches({ itemId, limit: 10 });
      return assertDefined(rows.find((row) => row.batchNo === batchNo), `batch ${batchNo}`);
    };
    const cocoaBatch = await batchByNo(cocoaItem, "R18-C1");
    const boxBatch = await batchByNo(boxItem, "R18-B1");

    // -- the book (guarded by order A's note) ---------------------------------
    const existingOrders = await orders.list({ limit: 500 });
    const existingA = existingOrders.find((o) => o.note === ORDER_A_NOTE);
    if (existingA !== undefined) {
      // The book already exists (a re-entry into the memoized setup): recover
      // the ids from the persisted rows.
      const orderB1 = assertDefined(existingOrders.find((o) => o.note === ORDER_B1_NOTE), "order B1");
      const orderB2 = assertDefined(existingOrders.find((o) => o.note === ORDER_B2_NOTE), "order B2");
      const doughBatch = assertDefined(
        await tracking.findBatch(assertDefined(existingA.fgBatchId, "order A fg batch")),
        "dough batch",
      );
      const cake1 = assertDefined(
        await tracking.findBatch(assertDefined(orderB1.fgBatchId, "order B1 fg batch")),
        "cake batch #1",
      );
      const cake2 = assertDefined(
        await tracking.findBatch(assertDefined(orderB2.fgBatchId, "order B2 fg batch")),
        "cake batch #2",
      );
      const invoice = (
        await salesStore.listSalesInvoices({ customerId, kind: "CREDIT", limit: 10 })
      ).find((row) => row.warehouseId === fgStore.id && row.status === "POSTED");
      return {
        branchId: mainBranch.id,
        warehouseRawId: rawStore.id,
        warehouseFgId: fgStore.id,
        cocoaItemId: cocoaItem,
        boxItemId: boxItem,
        doughItemId: doughItem,
        cakeItemId: cakeItem,
        cocoaBatchId: cocoaBatch.id,
        boxBatchId: boxBatch.id,
        doughBatchId: doughBatch.id,
        doughBatchNo: doughBatch.batchNo,
        cakeBatch1Id: cake1.id,
        cakeBatch1No: cake1.batchNo,
        cakeBatch2Id: cake2.id,
        cakeBatch2No: cake2.batchNo,
        orderAId: existingA.id,
        orderANo: assertDefined(existingA.orderNo, "order A no"),
        orderB1Id: orderB1.id,
        orderB1No: assertDefined(orderB1.orderNo, "order B1 no"),
        orderB2Id: orderB2.id,
        orderB2No: assertDefined(orderB2.orderNo, "order B2 no"),
        invoiceNo: invoice?.invoiceNo ?? null,
      };
    }

    // The two recipes (yield 100 → gross = planned × qty, exact arithmetic):
    // dough v1 (cocoa 0.2 / box 0.1) then cake v1 (dough 1.0).
    const doughDraft = await boms.create({
      itemId: doughItem,
      outputUomId: pcs.id,
      yieldPct: "100.0000",
      note: "Dough v1 (R18 reports)",
      noteAr: null,
      actorId: R_ACTOR,
      lines: [
        { componentItemId: cocoaItem, qtyPerOutput: "0.200000", scrapPct: "0" },
        { componentItemId: boxItem, qtyPerOutput: "0.100000", scrapPct: "0" },
      ],
    });
    await boms.activate(doughDraft.id, { effectiveFrom: TODAY(), actorId: R_ACTOR });
    const cakeDraft = await boms.create({
      itemId: cakeItem,
      outputUomId: pcs.id,
      yieldPct: "100.0000",
      note: "Cake v1 (R18 reports)",
      noteAr: null,
      actorId: R_ACTOR,
      lines: [{ componentItemId: doughItem, qtyPerOutput: "1.000000", scrapPct: "0" }],
    });
    await boms.activate(cakeDraft.id, { effectiveFrom: TODAY(), actorId: R_ACTOR });

    // Order A (dough): release plans cocoa 20 + box 10; consume → J DR WIP
    // 100.0000 · CR INV 100.0000; complete 100 → fgValue 100.0000 @ 1.000000,
    // dough batch QUARANTINED (gate on).
    const orderA = await orders.create({
      branchId: mainBranch.id,
      itemId: doughItem,
      bomId: null,
      plannedQty: "100",
      plannedDate: TODAY(),
      materialsWarehouseId: rawStore.id,
      fgWarehouseId: rawStore.id, // semi-finished returns to the materials store
      laborRate: "0",
      overheadRate: "0",
      costCenterId: null,
      note: ORDER_A_NOTE,
      noteAr: null,
      actorId: R_ACTOR,
    });
    await orders.release(orderA.id, R_ACTOR);
    await orders.start(orderA.id, R_ACTOR);
    await orders.consume(orderA.id, {
      lines: [
        { itemId: cocoaItem, qty: "20", batchId: cocoaBatch.id },
        { itemId: boxItem, qty: "10", batchId: boxBatch.id },
      ],
      consumedAt: TODAY(),
      note: "R18 dough consumption",
      noteAr: null,
      actorId: R_ACTOR,
    });
    const doughDone = await orders.complete(orderA.id, {
      actualQty: "100",
      batchNo: null, // defaults to the PRD order number
      completedAt: TODAY(),
      actorId: R_ACTOR,
    });
    const doughBatchId = assertDefined(doughDone.batchId, "dough batch id");
    const doughBatchNo = assertDefined(doughDone.batchNo, "dough batch no");

    // Inspection PASS on order A → the dough batch ACTIVE (no journal) — the
    // semi-finished QC release order B1's explicit-batch consume needs.
    const passA = await inspections.create({
      targetType: "production_order",
      orderId: orderA.id,
      result: "PASS",
      sampled: false,
      sampleSize: null,
      disposition: null,
      inspectedAt: TODAY(),
      note: "R18 dough release",
      noteAr: null,
      actorId: R_ACTOR,
    });
    if (!passA.released) throw new Error("R18 fixture: order A PASS did not release the dough batch");

    // Order B1 (cake): consume dough 50 @ 1.00 → DR WIP 50.0000 · CR INV
    // 50.0000; scrap 2.0000 (WIP 48); complete 50 → labor 5.0000 + overhead
    // 2.5000 → fgValue 55.5000 @ 1.110000, cake batch #1 QUARANTINED.
    const orderB1 = await orders.create({
      branchId: mainBranch.id,
      itemId: cakeItem,
      bomId: null,
      plannedQty: "50",
      plannedDate: TODAY(),
      materialsWarehouseId: rawStore.id,
      fgWarehouseId: fgStore.id,
      laborRate: "0.100000",
      overheadRate: "0.050000",
      costCenterId: null,
      note: ORDER_B1_NOTE,
      noteAr: null,
      actorId: R_ACTOR,
    });
    await orders.release(orderB1.id, R_ACTOR);
    await orders.start(orderB1.id, R_ACTOR);
    await orders.consume(orderB1.id, {
      lines: [{ itemId: doughItem, qty: "50", batchId: doughBatchId }],
      consumedAt: TODAY(),
      note: "R18 cake B1 consumption",
      noteAr: null,
      actorId: R_ACTOR,
    });
    await orders.scrap(orderB1.id, {
      qty: "2",
      reasonCode: "BURNT",
      value: "2.0000",
      scrappedAt: TODAY(),
      note: "R18 cake B1 scrap",
      noteAr: null,
      actorId: R_ACTOR,
    });
    const b1Done = await orders.complete(orderB1.id, {
      actualQty: "50",
      batchNo: null,
      completedAt: TODAY(),
      actorId: R_ACTOR,
    });
    const cakeBatch1Id = assertDefined(b1Done.batchId, "cake batch #1 id");
    const cakeBatch1No = assertDefined(b1Done.batchNo, "cake batch #1 no");

    // Inspection PASS (sampled 10) on B1 → cake batch #1 ACTIVE.
    const passB1 = await inspections.create({
      targetType: "production_order",
      orderId: orderB1.id,
      result: "PASS",
      sampled: true,
      sampleSize: 10,
      disposition: null,
      inspectedAt: TODAY(),
      note: "R18 cake release",
      noteAr: null,
      actorId: R_ACTOR,
    });
    if (!passB1.released) throw new Error("R18 fixture: order B1 PASS did not release cake batch #1");

    // The sale: 20 cake @ 25 off batch #1, credit invoice, NS tax → COGS
    // 22.2000 (WAC 1.11). The SoD guard rejects a self-approval, so the R18
    // approver user approves what R_ACTOR raised.
    const saleInvoice = await salesInvoices.create({
      branchId: mainBranch.id,
      customerId,
      salesRepId: null,
      kind: "CREDIT",
      invoiceDate: TODAY(),
      dueDate: null,
      currencyCode: "SAR",
      exchangeRate: null,
      orderId: null,
      deliveryId: null,
      warehouseId: fgStore.id,
      cashAccountId: null,
      note: "R18 cake sale (reports book)",
      noteAr: null,
      actorId: R_ACTOR,
      lines: [
        {
          itemId: cakeItem,
          accountId: null,
          deliveryLineId: null,
          description: "Cake (R18 reports book)",
          descriptionAr: "كيك (كتاب تقارير ر-١٨)",
          qty: "20",
          unitPrice: "25.000000",
          discountAmount: null,
          taxCodeId: nsTaxCode,
          batchId: cakeBatch1Id,
          serialIds: null,
          note: null,
        },
      ],
    });
    await salesInvoices.submit(saleInvoice.id, R_ACTOR);
    await salesInvoices.approve(saleInvoice.id, R18_APPROVER, false);
    const salePosted = await salesInvoices.post(saleInvoice.id, R_ACTOR);
    const invoiceNo = salePosted.invoice.invoiceNo;

    // Order B2 (cake, rates 0): consume the last dough 50 @ 1.00 → DR WIP
    // 50.0000 (dough position → 0); complete 50 → fgValue 50.0000 @ 1.000000,
    // cake batch #2 QUARANTINED (position 30 @ 1.11 + 50 @ 1.00 = 80 /
    // 83.300000 → avgCost 1.041250).
    const orderB2 = await orders.create({
      branchId: mainBranch.id,
      itemId: cakeItem,
      bomId: null,
      plannedQty: "50",
      plannedDate: TODAY(),
      materialsWarehouseId: rawStore.id,
      fgWarehouseId: fgStore.id,
      laborRate: "0",
      overheadRate: "0",
      costCenterId: null,
      note: ORDER_B2_NOTE,
      noteAr: null,
      actorId: R_ACTOR,
    });
    await orders.release(orderB2.id, R_ACTOR);
    await orders.start(orderB2.id, R_ACTOR);
    await orders.consume(orderB2.id, {
      lines: [{ itemId: doughItem, qty: "50", batchId: doughBatchId }],
      consumedAt: TODAY(),
      note: "R18 cake B2 consumption",
      noteAr: null,
      actorId: R_ACTOR,
    });
    const b2Done = await orders.complete(orderB2.id, {
      actualQty: "50",
      batchNo: null,
      completedAt: TODAY(),
      actorId: R_ACTOR,
    });
    const cakeBatch2Id = assertDefined(b2Done.batchId, "cake batch #2 id");
    const cakeBatch2No = assertDefined(b2Done.batchNo, "cake batch #2 no");

    // Inspection FAIL (sampled 2) + SCRAP on B2 → the qc_scrap flow: the
    // whole batch #2 on-hand 50 @ WAC 1.041250 = 52.0625 (DR
    // PRODUCTION_SCRAP · CR FG-INV); batch #2 stays QUARANTINED at zero.
    const failB2 = await inspections.create({
      targetType: "production_order",
      orderId: orderB2.id,
      result: "FAIL",
      sampled: true,
      sampleSize: 2,
      disposition: "SCRAP",
      inspectedAt: TODAY(),
      note: "R18 cake B2 QC fail",
      noteAr: null,
      actorId: R_ACTOR,
    });
    if (failB2.scrapJournalEntryId === null || failB2.scrapValue !== "52.0625") {
      throw new Error(`R18 fixture: B2 qc_scrap unexpected — ${failB2.scrapValue}`);
    }

    return {
      branchId: mainBranch.id,
      warehouseRawId: rawStore.id,
      warehouseFgId: fgStore.id,
      cocoaItemId: cocoaItem,
      boxItemId: boxItem,
      doughItemId: doughItem,
      cakeItemId: cakeItem,
      cocoaBatchId: cocoaBatch.id,
      boxBatchId: boxBatch.id,
      doughBatchId,
      doughBatchNo,
      cakeBatch1Id,
      cakeBatch1No,
      cakeBatch2Id,
      cakeBatch2No,
      orderAId: orderA.id,
      orderANo: assertDefined(doughDone.order.orderNo, "order A no"),
      orderB1Id: orderB1.id,
      orderB1No: assertDefined(b1Done.order.orderNo, "order B1 no"),
      orderB2Id: orderB2.id,
      orderB2No: assertDefined(b2Done.order.orderNo, "order B2 no"),
      invoiceNo,
    };
  });

  fixture = built;
  return fixture;
}

function runReport(
  reportKey: string,
  params: Record<string, unknown>,
): Promise<{ runId: string; result?: ReportResult; status: string }> {
  return withTenant(TENANT_R18, () =>
    newRunService().run({ reportKey, params, ctx: fullContext(TENANT_R18) }),
  );
}

beforeAll(async () => {
  await setupR18Fixture();
});

// -- manufacturing.production_cost ----------------------------------------------------

describe("manufacturing.production_cost (PHASE-018 T40; GL tie-out)", () => {
  it("shows the three orders' planned-vs-actual rows with exact money; the materials GL tie PASSES exactly", async () => {
    const fx = await setupR18Fixture();
    const day = TODAY();
    const outcome = await runReport("manufacturing.production_cost", {
      dateFrom: day,
      dateTo: day,
      locale: "en",
    });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;
    expect(result.reportId).toBe("manufacturing.production_cost");

    // PRD-sequence ordering: A < B1 < B2.
    expect(result.rows).toHaveLength(3);
    const [rowA, rowB1, rowB2] = result.rows;
    expect(rowA!.values.orderNo).toBe(fx.orderANo);
    expect(rowB1!.values.orderNo).toBe(fx.orderB1No);
    expect(rowB2!.values.orderNo).toBe(fx.orderB2No);
    for (const row of result.rows) {
      expect(row.values.status).toBe("COMPLETED");
    }

    // Order A (dough): plan 100 → cocoa 20 + box 10 = 30 planned and
    // consumed; consumed value 20×4 + 10×2 = 100.0000; no scrap; fg 100.0000.
    expect(rowA!.values.sku).toBe("R18-DOUGH");
    expect(rowA!.values.plannedQty).toBe("100.000000");
    expect(rowA!.values.actualQty).toBe("100.000000");
    expect(rowA!.values.yieldPct).toBe("100.0000");
    expect(rowA!.values.plannedComponentsQty).toBe("30.000000");
    expect(rowA!.values.consumedQty).toBe("30.000000");
    expect(rowA!.values.overPlanLines).toBe(0);
    expect(rowA!.values.consumedValue).toBe("100.0000");
    expect(rowA!.values.scrapValue).toBe("0.0000");
    expect(rowA!.values.scrapCount).toBe(0);
    expect(rowA!.values.plannedLaborValue).toBe("0.0000");
    expect(rowA!.values.laborValue).toBe("0.0000");
    expect(rowA!.values.plannedOverheadValue).toBe("0.0000");
    expect(rowA!.values.overheadValue).toBe("0.0000");
    expect(rowA!.values.fgValue).toBe("100.0000");
    expect(rowA!.values.wipBalance).toBe("0.0000"); // completed → WIP nets 0

    // Order B1 (cake): dough 50 planned and consumed @ 1.00; scrap 2.0000;
    // labor/overhead 5.0000/2.5000 planned (50 × rate) AND absorbed; fg =
    // 48 + 5 + 2.5 = 55.5000.
    expect(rowB1!.values.sku).toBe("R18-CAKE");
    expect(rowB1!.values.plannedQty).toBe("50.000000");
    expect(rowB1!.values.actualQty).toBe("50.000000");
    expect(rowB1!.values.yieldPct).toBe("100.0000");
    expect(rowB1!.values.plannedComponentsQty).toBe("50.000000");
    expect(rowB1!.values.consumedQty).toBe("50.000000");
    expect(rowB1!.values.consumedValue).toBe("50.0000");
    expect(rowB1!.values.scrapValue).toBe("2.0000");
    expect(rowB1!.values.scrapCount).toBe(1);
    expect(rowB1!.values.plannedLaborValue).toBe("5.0000");
    expect(rowB1!.values.laborValue).toBe("5.0000");
    expect(rowB1!.values.plannedOverheadValue).toBe("2.5000");
    expect(rowB1!.values.overheadValue).toBe("2.5000");
    expect(rowB1!.values.fgValue).toBe("55.5000");
    expect(rowB1!.values.wipBalance).toBe("0.0000");

    // Order B2 (cake, rates 0): dough 50 consumed, fg 50.0000.
    expect(rowB2!.values.sku).toBe("R18-CAKE");
    expect(rowB2!.values.consumedValue).toBe("50.0000");
    expect(rowB2!.values.scrapValue).toBe("0.0000"); // pre-completion scrap only
    expect(rowB2!.values.fgValue).toBe("50.0000");
    expect(rowB2!.values.wipBalance).toBe("0.0000");

    const totals = new Map(result.totals.map((total) => [total.id, total.amount]));
    expect(totals.get("consumedValueTotal")).toBe("200.0000");
    expect(totals.get("scrapValueTotal")).toBe("2.0000");
    expect(totals.get("fgValueTotal")).toBe("205.5000");
    expect(totals.get("laborValueTotal")).toBe("5.0000");
    expect(totals.get("overheadValueTotal")).toBe("2.5000");

    // The GL tie: Σ consumed value 100 + 50 + 50 == Σ WIP debits of the
    // three consume journals (the qc_scrap journal touches PRODUCTION_SCRAP /
    // FG inventory, never WIP — excluded by the consume_% operation filter).
    const tie = result.assertions.find((a) => a.id === "production-materials-gl-tie")!;
    expect(tie.status).toBe("PASS");
    expect(tie.compared).toEqual({ left: "200.0000", right: "200.0000" });
  });

  it("an empty window is honestly empty (zero rows, zero tie)", async () => {
    const outcome = await runReport("manufacturing.production_cost", {
      dateFrom: "2025-01-01",
      dateTo: "2025-01-31",
      locale: "en",
    });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;
    expect(result.rows).toHaveLength(0);
    const tie = result.assertions.find((a) => a.id === "production-materials-gl-tie")!;
    expect(tie.status).toBe("PASS");
    expect(tie.compared).toEqual({ left: "0.0000", right: "0.0000" });
  });

  it("the status filter scopes the rows (COMPLETED → all three; DRAFT → none)", async () => {
    const day = TODAY();
    const completed = await runReport("manufacturing.production_cost", {
      dateFrom: day,
      dateTo: day,
      status: "COMPLETED",
      locale: "en",
    });
    expect(completed.status).toBe("SUCCEEDED");
    expect(completed.result!.rows).toHaveLength(3);

    const draft = await runReport("manufacturing.production_cost", {
      dateFrom: day,
      dateTo: day,
      status: "DRAFT",
      locale: "en",
    });
    expect(draft.status).toBe("SUCCEEDED");
    expect(draft.result!.rows).toHaveLength(0);
  });
});

// -- manufacturing.batch_genealogy ----------------------------------------------------

describe("manufacturing.batch_genealogy (PHASE-018 T40; the recall walk)", () => {
  it("walks cake batch #1: dough upstream (with its own producer), cocoa/box one hop deeper, the invoice downstream — no PRODUCED rows", async () => {
    const fx = await setupR18Fixture();
    const day = TODAY();
    const outcome = await runReport("manufacturing.batch_genealogy", {
      batchId: fx.cakeBatch1Id,
      locale: "en",
    });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;

    // Kind order MATERIAL → SOLD; level asc; batchNo tiebreak at level 2.
    expect(result.rows).toHaveLength(4);
    expect(result.rows.map((row) => row.values.kind)).toEqual([
      "MATERIAL",
      "MATERIAL",
      "MATERIAL",
      "SOLD",
    ]);
    const [dough, box, cocoa, sold] = result.rows;
    expect(dough!.values).toMatchObject({
      kind: "MATERIAL",
      level: 1,
      batchNo: fx.doughBatchNo,
      sku: "R18-DOUGH",
      qty: "50.000000",
      orderNo: fx.orderB1No, // the consuming order = cake #1's producer
      producedByOrderNo: fx.orderANo, // the dough batch's own producer
      docNo: null,
      docDate: null,
    });
    expect(box!.values).toMatchObject({
      kind: "MATERIAL",
      level: 2,
      batchNo: "R18-B1",
      sku: "R18-BOX",
      qty: "10.000000",
      orderNo: fx.orderANo,
      producedByOrderNo: null, // purchased
      docNo: null,
      docDate: null,
    });
    expect(cocoa!.values).toMatchObject({
      kind: "MATERIAL",
      level: 2,
      batchNo: "R18-C1",
      sku: "R18-COCOA",
      qty: "20.000000",
      orderNo: fx.orderANo,
      producedByOrderNo: null,
      docNo: null,
      docDate: null,
    });
    // The enrichment: the sale edge carries the invoice number + date.
    expect(sold!.values).toMatchObject({
      kind: "SOLD",
      level: 1,
      batchNo: fx.cakeBatch1No,
      sku: "R18-CAKE",
      qty: "20.000000",
      orderNo: null,
      producedByOrderNo: null,
      docNo: fx.invoiceNo,
      docDate: day,
    });
    expect(result.assertions).toHaveLength(0); // operational — README rule 2
  });

  it("walks the dough batch: cocoa/box upstream, both cake orders produced, the invoice two hops down", async () => {
    const fx = await setupR18Fixture();
    const day = TODAY();
    const outcome = await runReport("manufacturing.batch_genealogy", {
      batchId: fx.doughBatchId,
      locale: "en",
    });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;

    expect(result.rows).toHaveLength(5);
    expect(result.rows.map((row) => `${row.values.kind}:${row.values.level}`)).toEqual([
      "MATERIAL:1",
      "MATERIAL:1",
      "PRODUCED:1",
      "PRODUCED:1",
      "SOLD:2",
    ]);
    const [box, cocoa, produced1, produced2, sold] = result.rows;
    expect(box!.values).toMatchObject({
      kind: "MATERIAL",
      level: 1,
      batchNo: "R18-B1",
      qty: "10.000000",
      orderNo: fx.orderANo,
      producedByOrderNo: null,
    });
    expect(cocoa!.values).toMatchObject({
      kind: "MATERIAL",
      level: 1,
      batchNo: "R18-C1",
      qty: "20.000000",
      orderNo: fx.orderANo,
      producedByOrderNo: null,
    });
    // PRODUCED level 1 ordered by batchNo (cake #1 < cake #2).
    expect(produced1!.values).toMatchObject({
      kind: "PRODUCED",
      level: 1,
      batchNo: fx.cakeBatch1No,
      sku: "R18-CAKE",
      qty: "50.000000",
      orderNo: fx.orderB1No,
      producedByOrderNo: null,
      docNo: null,
      docDate: null,
    });
    expect(produced2!.values).toMatchObject({
      kind: "PRODUCED",
      level: 1,
      batchNo: fx.cakeBatch2No,
      sku: "R18-CAKE",
      qty: "50.000000",
      orderNo: fx.orderB2No,
    });
    expect(sold!.values).toMatchObject({
      kind: "SOLD",
      level: 2, // via cake batch #1
      batchNo: fx.cakeBatch1No,
      qty: "20.000000",
      docNo: fx.invoiceNo,
      docDate: day,
    });
  });

  it("walks the purchased cocoa batch forward: dough at hop 1, both cakes at hop 2, the invoice at hop 3 (the multi-level forward recall)", async () => {
    const fx = await setupR18Fixture();
    const day = TODAY();
    const outcome = await runReport("manufacturing.batch_genealogy", {
      batchId: fx.cocoaBatchId,
      locale: "en",
    });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;

    // A purchased batch has no upstream: only PRODUCED + SOLD rows.
    expect(result.rows).toHaveLength(4);
    expect(result.rows.map((row) => `${row.values.kind}:${row.values.level}`)).toEqual([
      "PRODUCED:1",
      "PRODUCED:2",
      "PRODUCED:2",
      "SOLD:3",
    ]);
    const [dough, cake1, cake2, sold] = result.rows;
    expect(dough!.values).toMatchObject({
      kind: "PRODUCED",
      level: 1,
      batchNo: fx.doughBatchNo,
      sku: "R18-DOUGH",
      qty: "20.000000",
      orderNo: fx.orderANo,
    });
    expect(cake1!.values).toMatchObject({
      kind: "PRODUCED",
      level: 2,
      batchNo: fx.cakeBatch1No,
      qty: "50.000000",
      orderNo: fx.orderB1No,
    });
    expect(cake2!.values).toMatchObject({
      kind: "PRODUCED",
      level: 2,
      batchNo: fx.cakeBatch2No,
      qty: "50.000000",
      orderNo: fx.orderB2No,
    });
    expect(sold!.values).toMatchObject({
      kind: "SOLD",
      level: 3,
      batchNo: fx.cakeBatch1No,
      qty: "20.000000",
      docNo: fx.invoiceNo,
      docDate: day,
    });
  });

  it("an unknown batch is an honest miss: SUCCEEDED, zero rows, the not-found note", async () => {
    const outcome = await runReport("manufacturing.batch_genealogy", {
      batchId: "59595959-5959-4959-8959-595959595959",
      locale: "en",
    });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;
    expect(result.rows).toHaveLength(0);
    const totals = new Map(result.totals.map((total) => [total.id, total.amount]));
    expect(totals.get("rows")).toBe("0");
    expect(result.notes?.some((note) => note.en.includes("Batch not found in this tenant"))).toBe(
      true,
    );
  });
});

// -- manufacturing.qc_inspection_log --------------------------------------------------

describe("manufacturing.qc_inspection_log (PHASE-018 T40; the QC register)", () => {
  it("lists the three book inspections with results, sampling, dispositions and FG batches", async () => {
    const fx = await setupR18Fixture();
    const day = TODAY();
    const outcome = await runReport("manufacturing.qc_inspection_log", {
      dateFrom: day,
      dateTo: day,
      locale: "en",
    });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;

    expect(result.rows).toHaveLength(3);
    const [passA, passB1, failB2] = result.rows;
    expect(passA!.values).toMatchObject({
      inspectedAt: day,
      targetType: "production_order",
      orderNo: fx.orderANo,
      grnNo: null,
      fgBatchNo: fx.doughBatchNo,
      result: "PASS",
      sampled: "false",
      sampleSize: null,
      disposition: null,
    });
    expect(passB1!.values).toMatchObject({
      orderNo: fx.orderB1No,
      fgBatchNo: fx.cakeBatch1No,
      result: "PASS",
      sampled: "true",
      sampleSize: 10,
      disposition: null,
    });
    expect(failB2!.values).toMatchObject({
      orderNo: fx.orderB2No,
      fgBatchNo: fx.cakeBatch2No,
      result: "FAIL",
      sampled: "true",
      sampleSize: 2,
      disposition: "SCRAP",
    });

    const totals = new Map(result.totals.map((total) => [total.id, total.amount]));
    expect(totals.get("resultCount")).toBe("3");
    expect(result.assertions).toHaveLength(0); // operational — README rule 2
  });

  it("a narrow window excluding today is honestly empty", async () => {
    const outcome = await runReport("manufacturing.qc_inspection_log", {
      dateFrom: "2026-06-01",
      dateTo: "2026-06-30",
      locale: "en",
    });
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.result!.rows).toHaveLength(0);
  });
});

// -- registry integration ------------------------------------------------------------

describe("registry integration (the shared contract)", () => {
  it("the three PHASE-018 keys are registered with the industry category and the 0026 permissions", async () => {
    const snapshot = newRunService().contracts();
    const expected: [string, string][] = [
      ["manufacturing.production_cost", "manufacturing.costing.read"],
      ["manufacturing.batch_genealogy", "manufacturing.genealogy.read"],
      ["manufacturing.qc_inspection_log", "manufacturing.qc.manage"],
    ];
    for (const [id, permission] of expected) {
      const contract = snapshot.find((c) => c.id === id);
      expect(contract, id).toBeDefined();
      expect(contract!.category).toBe("industry");
      expect(contract!.requiredPermission).toBe(permission);
      expect(contract!.executionClass).toBe("inline");
      expect(ALL_KNOWN_PERMISSIONS.has(permission), permission).toBe(true);
    }
    expect(snapshot).toHaveLength(81); // PHASE-028: +2 budgeting; PHASE-029: +3 payroll contracts
  });

  it("exports flow through the shared contract (CSV renderer over the stored envelope)", async () => {
    const day = TODAY();
    const { renderCsv } = await import("../../modules/reporting/application/export/csv");
    const outcome = await runReport("manufacturing.production_cost", {
      dateFrom: day,
      dateTo: day,
      locale: "en",
    });
    const csv = renderCsv(outcome.result!).toString("utf8");
    expect(csv).toContain("PRD-");
    expect(csv).toContain("200.0000");
    expect(csv).toContain("production-materials-gl-tie,PASS");
  });
});
