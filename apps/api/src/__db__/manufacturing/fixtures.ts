import type { Client } from "pg";

import { appClient, ensureTestDb, seedTenants, superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { CoaService } from "../../modules/accounting/application/coa-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { WarehouseService } from "../../modules/inventory/application/warehouse-service";
import { StockService } from "../../modules/inventory/application/stock-service";
import { TrackingService } from "../../modules/inventory/application/tracking-service";
import { TaxResolverService } from "../../modules/tax/application/tax-resolver-service";
import { TaxCodesService } from "../../modules/tax/application/codes-service";
import { RegistrationService } from "../../modules/tax/application/registration-service";
import { SalesInvoiceService } from "../../modules/sales/application/invoices";
import { BomService } from "../../modules/manufacturing/application/bom-service";
import { ProductionOrderService } from "../../modules/manufacturing/application/production-order-service";
import { ManufacturingReconciliationService } from "../../modules/manufacturing/application/wip-reconciliation-service";
import { InspectionService } from "../../modules/manufacturing/application/inspection-service";
import { GenealogyService } from "../../modules/manufacturing/application/genealogy-service";
import { ConfigRepository } from "../../modules/configuration/infrastructure/config-repository";
import { ResolveEffectiveConfigService } from "../../modules/configuration/application/resolve/resolve-service";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import type { BomRow, ProductionOrderRow } from "../../modules/manufacturing/infrastructure/manufacturing.store";

/**
 * PHASE-018 manufacturing db-suite fixtures (ACCOUNTING_TESTS §1): real
 * PostgreSQL 16 through the app-role services exactly as production paths
 * run — every journal flows through PostingEngine.post, every stock row
 * through the PHASE-010 movement core, every BOM through BomService; nothing
 * inserts GL rows directly.
 *
 * Dedicated tenant M (SAR base, SA pack): the manufacturing suites own it
 * end to end. FY2026 spans the whole test timeline (moves/documents Jan–Mar;
 * December reserved for PERIOD_LOCKED packs). Purposes mapped: INVENTORY→1140,
 * WIP→1160, PRODUCTION_SCRAP→5120, PRODUCTION_LABOR→5410,
 * PRODUCTION_OVERHEAD→5420, COGS→5100, AR_CONTROL→1130, SALES_REVENUE→4100,
 * VAT_PAYABLE→2120, OPENING_EQUITY→3100 + INVENTORY_APPRECIATION→4920 (the
 * COUNT_GAIN seed path's counter leg — see the stock-seeding note below).
 *
 * Stock-seeding path DECISION: `opening_balance_docs` lines carry only
 * item/qty/unit_cost/currency (no batchNo/expiry — verified against
 * OpeningStockService.post), so the material stock seeds through
 * `stock.manualReceipt({ reason: "COUNT_GAIN", batchNo, batchExpiry,
 * unitCost })` — the `inventory/tracking.spec.ts` pattern. One batch per
 * material (M-F1/M-Y1/M-P1) keeps FEFO trivial for T38b's golden chain.
 */

export const M_ACTOR = "e6e6e6e6-0000-4000-8000-0000000006e1";
export const M_WAREHOUSE = "e6e6e6e6-0000-4000-8000-0000000006e2";
export const M_QC = "e6e6e6e6-0000-4000-8000-0000000006e3";
export const TENANT_M = "66666666-6666-6666-6666-666666666666";

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const resolver = new TaxResolverService();

// The manufacturing surfaces the suites reuse (direct construction like the
// sales fixtures — T38b's order service joins the export list, after the
// inventory surfaces it composes).
export const boms = new BomService(audit);
export const warehouses = new WarehouseService(audit);
export const stock = new StockService(audit, posting);
export const tracking = new TrackingService(audit, stock);
export const orders = new ProductionOrderService(
  audit,
  numbering,
  boms,
  posting,
  tracking,
  new InboxService(),
  new ResolveEffectiveConfigService(new ConfigRepository()),
);
// T38b-ii: the WIP↔GL check (INV-010 extension) — read-only analysis
// recording into the PHASE-007 reconciliation framework.
export const wipReconciliation = new ManufacturingReconciliationService(audit, new InboxService());
// T39: the QC gate (inspections) + the read-only genealogy recall walks —
// same module-level audit/posting/tracking instances the services above
// use (posting is this module-local const; mPosting is the export alias).
export const inspections = new InspectionService(audit, posting, tracking);
export const genealogy = new GenealogyService();
export const periods = new PeriodService(audit);
export const coa = new CoaService(audit);
export const taxCodes = new TaxCodesService(audit);
export const registrations = new RegistrationService(audit);
export const salesInvoices = new SalesInvoiceService(audit, posting, numbering, resolver);
export const mPosting = posting;
export const mNumbering = numbering;

export type { Client };

/** Deterministic dates over the fixture timeline (FY2026 of tenant M). */
export const M_OPENING_DATE = "2025-12-31";
export const M_JAN = "2026-01-05";
export const M_FEB = "2026-02-15";
export const M_DEC = "2026-12-05";

/**
 * The §8 golden chain (T38b): the two production orders + the downstream
 * sale, created ONCE inside setupMfgFixture with pinned deterministic dates
 * (all in March 2026 — an OPEN month of the fixture's FY2026; never today()).
 * Genealogy (T39) and the reports (T40) read these rows; the costing spec
 * pins the exact journals. QC gate stays OFF (the platform default — the QC
 * spec runs its own gate-required chain on a separate order).
 */
export interface MfgChainFixture {
  /** The COMPLETED dough order row (§8: planned 1000, fg M-RAW, rates 0). */
  doughOrder: ProductionOrderRow;
  /** The COMPLETED bread order row (§8: planned 750, fg M-FG, 0.50/0.25). */
  breadOrder: ProductionOrderRow;
  /** The seeded material batch ids the chain consumes (M-F1 / M-Y1 / M-P1). */
  flourBatchId: string;
  yeastBatchId: string;
  packagingBatchId: string;
  /** The PRODUCED batches (dough → M-RAW, bread → M-FG) — genealogy edges. */
  doughBatchId: string;
  breadBatchId: string;
  doughBatchNo: string;
  breadBatchNo: string;
  /** The five chain journals (J1 dough consume, J2 dough scrap, J3 dough
   * complete, J4 bread consume, J5 bread complete) + the sale's COGS. */
  doughConsumeJournalId: string;
  doughScrapJournalId: string;
  doughCompleteJournalId: string;
  breadConsumeJournalId: string;
  breadCompleteJournalId: string;
  saleInvoiceId: string;
  saleSettlementJournalId: string | null;
  saleCogsJournalId: string | null;
  /** The exact post-chain stock positions, captured INSIDE setupMfgFixture
   * right after the sale — the only moment the absolutes are pristine (the
   * specs share the tenant sequentially and later packs draw from the same
   * pools; the sales-fixture delta discipline). costing.spec pins these
   * against the §8 goldens. */
  chainBalances: {
    doughRaw: { qty: string; avgCost: string };
    packRaw: { qty: string; avgCost: string };
    flourRaw: { qty: string; avgCost: string };
    yeastRaw: { qty: string; avgCost: string };
    breadFg: { qty: string; avgCost: string };
  };
  /** The pinned dates (all ISO, March 2026 — deterministic). */
  consumedAt: string;
  breadConsumedAt: string;
  doughCompletedAt: string;
  breadCompletedAt: string;
  saleDate: string;
}

export interface MfgFixture {
  fiscalYearId: string;
  branchId: string;
  /** M-RAW (role RAW) — the materials store. */
  warehouseRaw: string;
  /** M-FG (role FG) — the finished-goods store. */
  warehouseFg: string;
  customerId: string;
  creditTermId: string;
  /** GL accounts for the posting legs (purpose-mapped, template + explicit). */
  gl: {
    inventory: string;
    wip: string;
    productionScrap: string;
    productionLabor: string;
    productionOverhead: string;
    cogs: string;
    arControl: string;
    salesRevenue: string;
    vatPayable: string;
    openingEquity: string;
    /** The COUNT_GAIN seed path's counter leg (4920). */
    inventoryAppreciation: string;
    cashGl: string;
    serviceAccount: string;
  };
  taxCodeIds: { standard: string; notSubject: string };
  items: { flour: string; yeast: string; pack: string; dough: string; bread: string };
  /** The three seeded material batches (M-F1 / M-Y1 / M-P1) — batch ids. */
  batches: { flour: string; yeast: string; packaging: string };
  /** The two ACTIVE recipe versions (golden §8 numbers), post-activate rows. */
  boms: { dough: BomRow; bread: BomRow };
  /** The §8 golden chain rows + journals + pinned dates (T38b). */
  chain: MfgChainFixture;
}

let fixture: MfgFixture | undefined;

/** Boots the suite db + tenant M's full manufacturing substrate (idempotent). */
export async function setupMfgFixture(): Promise<MfgFixture> {
  if (fixture !== undefined) return fixture;
  ensureTestDb();
  const superuser = await superuserClient();
  await seedTenants(superuser as never);
  await superuser.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant M (manufacturing)', 'المستأجر م', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_M],
  );
  await superuser.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'mfg-actor@fixture.test', 'Mfg Actor (owner-tier)', 'x', 'ACTIVE'),
       ($2, 'mfg-warehouse@fixture.test', 'Mfg Warehouse', 'x', 'ACTIVE'),
       ($3, 'mfg-qc@fixture.test', 'Mfg QC', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [M_ACTOR, M_WAREHOUSE, M_QC],
  );
  await superuser.end();

  const gl: MfgFixture["gl"] = {
    inventory: "",
    wip: "",
    productionScrap: "",
    productionLabor: "",
    productionOverhead: "",
    cogs: "",
    arControl: "",
    salesRevenue: "",
    vatPayable: "",
    openingEquity: "",
    inventoryAppreciation: "",
    cashGl: "",
    serviceAccount: "",
  };
  let fiscalYearId = "";
  let branchId = "";
  let warehouseRaw = "";
  let warehouseFg = "";
  let customerId = "";
  let creditTermId = "";
  const taxCodeIds = { standard: "", notSubject: "" };
  const items = { flour: "", yeast: "", pack: "", dough: "", bread: "" };
  const batches = { flour: "", yeast: "", packaging: "" };
  const bomRows: { dough: BomRow | null; bread: BomRow | null } = { dough: null, bread: null };
  let chain: MfgChainFixture | null = null;

  await withTenant(TENANT_M, async () => {
    const { provisionCoaTemplate, seedMasterDataBasics, insertAccountPurpose, listBranches, insertBranch } =
      await import("../../modules/tenancy/infrastructure/tenancy.store");
    const { findAccountByCode, findActivePurpose, findFiscalYearByName } = await import(
      "../../modules/accounting/infrastructure/accounting.store"
    );
    const partnersStore = await import("../../modules/partners/infrastructure/partners.store");
    const itemsStore = await import("../../modules/items/infrastructure/items.store");
    await seedMasterDataBasics();
    await provisionCoaTemplate();

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
    // PHASE-018 (0026 template markers): provisionCoaTemplate normally maps
    // the four manufacturing purposes from the CoA markers; the explicit
    // mapPurpose calls are the idempotent belt-and-braces (mirroring the
    // sales fixture's SERVICE_REVENUE note — fail-closed consumers need the
    // mapping present regardless of provisioning order).
    gl.inventory = await mapPurpose("INVENTORY", "1140");
    gl.wip = await mapPurpose("WIP", "1160");
    gl.productionScrap = await mapPurpose("PRODUCTION_SCRAP", "5120");
    gl.productionLabor = await mapPurpose("PRODUCTION_LABOR", "5410");
    gl.productionOverhead = await mapPurpose("PRODUCTION_OVERHEAD", "5420");
    gl.cogs = await mapPurpose("COGS", "5100");
    gl.arControl = await mapPurpose("AR_CONTROL", "1130");
    gl.salesRevenue = await mapPurpose("SALES_REVENUE", "4100");
    gl.vatPayable = await mapPurpose("VAT_PAYABLE", "2120");
    gl.openingEquity = await mapPurpose("OPENING_EQUITY", "3100");
    gl.cashGl = (await byCode("1111")).id;
    gl.serviceAccount = (await byCode("5210")).id; // Rent — service lines.
    // The COUNT_GAIN seed path credits INVENTORY_APPRECIATION (4920) — the
    // template leaves it unmarked (the inventory fixture's gap): create the
    // host account if missing, then map it.
    let appreciation = await findAccountByCode("4920");
    if (appreciation === undefined) {
      appreciation = await coa.create(M_ACTOR, {
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
    gl.inventoryAppreciation = appreciation.id;

    // Fiscal year spanning the whole manufacturing timeline.
    const existingYear = await findFiscalYearByName("FY2026");
    fiscalYearId =
      existingYear?.id ??
      (await periods.createYear(M_ACTOR, { name: "FY2026", startDate: "2026-01-01", endDate: "2026-12-31" })).id;

    // Branch + the two role-tagged stores (M-RAW feeds, M-FG finishes).
    const branches = await listBranches(null);
    const mainBranch =
      branches.find((b) => b.code === "MAIN") ??
      (await insertBranch({ code: "MAIN", name: "Main branch", nameAr: "الفرع الرئيسي", address: null }));
    branchId = mainBranch.id;
    const existingWarehouses = await warehouses.list({ limit: 20, activeOnly: false });
    const rawStore =
      existingWarehouses.find((w) => w.code === "M-RAW") ??
      (await warehouses.create({
        branchId: mainBranch.id,
        code: "M-RAW",
        name: "Raw materials store",
        nameAr: "مخزن المواد",
        inventoryAccountId: null,
        note: null,
        role: "RAW",
        actorId: M_ACTOR,
      }));
    warehouseRaw = rawStore.id;
    const fgStore =
      existingWarehouses.find((w) => w.code === "M-FG") ??
      (await warehouses.create({
        branchId: mainBranch.id,
        code: "M-FG",
        name: "Finished goods store",
        nameAr: "مخزن الإنتاج التام",
        inventoryAccountId: null,
        note: null,
        role: "FG",
        actorId: M_ACTOR,
      }));
    warehouseFg = fgStore.id;

    // Items (MASTER-PLAN §8): all STOCK + WAC + trackBatch + hasExpiry, PCS
    // base unit, shelf life per the golden chain (dough is semi-finished by
    // convention — kind stays STOCK so it can be consumed AND carry a BOM).
    const uoms = await itemsStore.listUoms();
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const ensureItem = async (
      key: keyof MfgFixture["items"],
      sku: string,
      name: string,
      nameAr: string,
      shelfLifeDays: number,
    ) => {
      const found = await itemsStore.findItemBySku(sku);
      if (found !== undefined) {
        items[key] = found.id;
        return;
      }
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
      items[key] = created.id;
    };
    await ensureItem("flour", "M-FLOUR", "Flour", "دقيق", 180);
    await ensureItem("yeast", "M-YEAST", "Yeast", "خميرة", 90);
    await ensureItem("pack", "M-PACK", "Packaging", "تغليف", 365);
    await ensureItem("dough", "M-DOUGH", "Dough (semi-finished)", "عجين (نصف مصنّع)", 2);
    await ensureItem("bread", "M-BREAD", "Bread", "خبز", 5);

    // Customer + credit term (mirror the sales fixture's customer leg).
    const terms = await partnersStore.listCreditTerms();
    const net30 = terms.find((t) => t.days === 30) ?? terms[0]!;
    creditTermId = net30.id;
    const existingCustomer = await partnersStore.findPartnerByCode("M-C1");
    if (existingCustomer === undefined) {
      const created = await partnersStore.insertPartner({
        kind: "CUSTOMER",
        code: "M-C1",
        name: "شركة الخبز الطازج",
        nameAr: null,
        taxNumber: null,
        creditLimit: null,
        creditTermsId: net30.id,
        priceListId: null,
      });
      customerId = created.id;
    } else {
      customerId = existingCustomer.id;
    }

    // SA tax registration (REGISTERED) + STD/NS codes — the invoice path
    // (T38b sells bread through SalesInvoiceService) needs both.
    if ((await registrations.list()).length === 0) {
      await registrations.upsert({
        countryCode: "SA",
        status: "REGISTERED",
        registrationNumber: "310000000000003",
        effectiveFrom: "2016-01-01",
        effectiveTo: null,
        actorId: M_ACTOR,
        note: "manufacturing fixture registration",
      });
    }
    const existingCodes = await taxCodes.list({ countryCode: "SA" });
    taxCodeIds.standard =
      existingCodes.find((row) => row.code === "STD")?.id ??
      (
        await taxCodes.create({
          code: "STD",
          name: "Standard (SA)",
          nameAr: null,
          countryCode: "SA",
          defaultTreatment: "STANDARD_RATED",
          actorId: M_ACTOR,
        })
      ).id;
    taxCodeIds.notSubject =
      existingCodes.find((row) => row.code === "NS")?.id ??
      (
        await taxCodes.create({
          code: "NS",
          name: "Not subject",
          nameAr: null,
          countryCode: "SA",
          defaultTreatment: "NOT_SUBJECT",
          actorId: M_ACTOR,
        })
      ).id;

    // Material stock into M-RAW — the chosen batch-capable path (see the
    // header note): one batch each, FEFO trivial, WAC single-lot.
    const receiveMaterial = (
      itemId: string,
      qty: string,
      unitCost: string,
      batchNo: string,
      batchExpiry: string,
    ) =>
      stock.manualReceipt({
        itemId,
        warehouseId: warehouseRaw,
        qty,
        unitCost,
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: M_JAN,
        batchNo,
        batchExpiry,
        actorId: M_ACTOR,
      });
    await receiveMaterial(items.flour, "2000", "10.000000", "M-F1", "2026-07-15");
    await receiveMaterial(items.yeast, "1000", "20.000000", "M-Y1", "2026-04-15");
    await receiveMaterial(items.pack, "1000", "1.000000", "M-P1", "2027-01-15");
    for (const [key, itemId, batchNo] of [
      ["flour", items.flour, "M-F1"],
      ["yeast", items.yeast, "M-Y1"],
      ["packaging", items.pack, "M-P1"],
    ] as const) {
      const rows = await tracking.listBatches({ itemId, limit: 10 });
      const batch = rows.find((row) => row.batchNo === batchNo);
      if (batch === undefined) throw new Error(`fixture batch ${batchNo} missing`);
      batches[key] = batch.id;
    }

    // The two golden recipe versions (MASTER-PLAN §8), through the real
    // BomService — create DRAFT then activate (exercises the service).
    const doughDraft = await boms.create({
      itemId: items.dough,
      outputUomId: pcs.id,
      yieldPct: "80.0000",
      note: "Dough v1 (golden)",
      noteAr: null,
      actorId: M_ACTOR,
      lines: [
        { componentItemId: items.flour, qtyPerOutput: "0.500000", scrapPct: "2.0000" },
        { componentItemId: items.yeast, qtyPerOutput: "0.100000", scrapPct: "0" },
      ],
    });
    bomRows.dough = await boms.activate(doughDraft.id, { effectiveFrom: M_JAN, actorId: M_ACTOR });

    const breadDraft = await boms.create({
      itemId: items.bread,
      outputUomId: pcs.id,
      yieldPct: "80.0000",
      note: "Bread v1 (golden)",
      noteAr: null,
      actorId: M_ACTOR,
      lines: [
        { componentItemId: items.dough, qtyPerOutput: "1.000000", scrapPct: "0" },
        { componentItemId: items.pack, qtyPerOutput: "0.250000", scrapPct: "0" },
      ],
    });
    bomRows.bread = await boms.activate(breadDraft.id, { effectiveFrom: M_JAN, actorId: M_ACTOR });

    // The golden chain (MASTER-PLAN §8 — binding numbers, deterministic
    // dates, QC gate off). Dough first: its FG batch feeds the bread order.
    const doughOrder = await orders.create({
      branchId,
      itemId: items.dough,
      bomId: null,
      plannedQty: "1000",
      plannedDate: M_FEB,
      materialsWarehouseId: warehouseRaw,
      fgWarehouseId: warehouseRaw, // semi-finished returns to the materials store
      laborRate: "0",
      overheadRate: "0",
      costCenterId: null,
      note: "Golden dough order (§8)",
      noteAr: null,
      actorId: M_ACTOR,
    });
    await orders.release(doughOrder.id, M_ACTOR);
    await orders.start(doughOrder.id, M_ACTOR);
    // J1: DR WIP 8875.0000 · CR INVENTORY 8875.0000 (flour 637.5×10 + yeast 125×20).
    const doughConsumed = await orders.consume(doughOrder.id, {
      lines: [
        { itemId: items.flour, qty: "637.5", batchId: batches.flour },
        { itemId: items.yeast, qty: "125", batchId: batches.yeast },
      ],
      consumedAt: "2026-03-02",
      note: "Golden dough consumption",
      noteAr: null,
      actorId: M_ACTOR,
    });
    // J2: DR PRODUCTION_SCRAP 443.7500 · CR WIP 443.7500 — WIP 8431.2500 after.
    const doughScrapped = await orders.scrap(doughOrder.id, {
      qty: "50",
      reasonCode: "BURNT",
      value: "443.7500",
      scrappedAt: "2026-03-02",
      note: "Golden dough scrap",
      noteAr: null,
      actorId: M_ACTOR,
    });
    // J3: DR INVENTORY 8431.2500 · CR WIP 8431.2500 — dough batch @ 8.875000,
    // expiry = completedAt + 2d, WIP nets to exactly zero.
    const doughDone = await orders.complete(doughOrder.id, {
      actualQty: "950",
      batchNo: null, // defaults to the PRD order number
      completedAt: "2026-03-03",
      actorId: M_ACTOR,
    });

    const breadOrder = await orders.create({
      branchId,
      itemId: items.bread,
      bomId: null,
      plannedQty: "750",
      plannedDate: M_FEB,
      materialsWarehouseId: warehouseRaw,
      fgWarehouseId: warehouseFg,
      laborRate: "0.500000",
      overheadRate: "0.250000",
      costCenterId: null,
      note: "Golden bread order (§8)",
      noteAr: null,
      actorId: M_ACTOR,
    });
    await orders.release(breadOrder.id, M_ACTOR);
    await orders.start(breadOrder.id, M_ACTOR);
    // J4: DR WIP 8554.6875 · CR INVENTORY 8554.6875 (dough 937.5×8.875 from
    // the produced batch + packaging 234.375×1).
    const breadConsumed = await orders.consume(breadOrder.id, {
      lines: [
        { itemId: items.dough, qty: "937.5", batchId: doughDone.batchId },
        { itemId: items.pack, qty: "234.375", batchId: batches.packaging },
      ],
      consumedAt: "2026-03-04",
      note: "Golden bread consumption",
      noteAr: null,
      actorId: M_ACTOR,
    });
    // J5: DR INVENTORY 9117.1875 · CR WIP 8554.6875 · CR LABOR 375.0000 ·
    // CR OVERHEAD 187.5000 — bread batch @ 12.156250, expiry +5d.
    const breadDone = await orders.complete(breadOrder.id, {
      actualQty: "750",
      batchNo: null,
      completedAt: "2026-03-05",
      actorId: M_ACTOR,
    });

    // The downstream sale (genealogy edge + the COGS tie at WAC 12.15625):
    // 100 bread off the produced batch, credit invoice to M-C1, NS tax. The
    // creator/approver split mirrors quickPostedInvoice (SoD BR-034: the
    // warehouse actor raises, the owner approves).
    const saleInvoice = await salesInvoices.create({
      branchId,
      customerId,
      salesRepId: null,
      kind: "CREDIT",
      invoiceDate: "2026-03-06",
      dueDate: null,
      currencyCode: "SAR",
      exchangeRate: null,
      orderId: null,
      deliveryId: null,
      warehouseId: warehouseFg,
      cashAccountId: null,
      note: "Golden chain bread sale (§8)",
      noteAr: null,
      actorId: M_WAREHOUSE,
      lines: [
        {
          itemId: items.bread,
          accountId: null,
          deliveryLineId: null,
          description: "Bread (golden chain)",
          descriptionAr: "خبز (السلسلة الذهبية)",
          qty: "100",
          unitPrice: "20.000000",
          discountAmount: null,
          taxCodeId: taxCodeIds.notSubject,
          batchId: breadDone.batchId,
          serialIds: null,
          note: null,
        },
      ],
    });
    await salesInvoices.submit(saleInvoice.id, M_WAREHOUSE);
    await salesInvoices.approve(saleInvoice.id, M_ACTOR, false);
    const salePosted = await salesInvoices.post(saleInvoice.id, M_ACTOR);

    // The pristine post-chain positions (see MfgChainFixture.chainBalances).
    const inventoryStore = await import("../../modules/inventory/infrastructure/inventory.store");
    const readStock = async (itemId: string, warehouseId: string) => {
      const row = await inventoryStore.findItemStock(itemId, warehouseId);
      return { qty: row?.qty ?? "0.000000", avgCost: row?.avgCost ?? "0.000000" };
    };
    const chainBalances = {
      doughRaw: await readStock(items.dough, warehouseRaw),
      packRaw: await readStock(items.pack, warehouseRaw),
      flourRaw: await readStock(items.flour, warehouseRaw),
      yeastRaw: await readStock(items.yeast, warehouseRaw),
      breadFg: await readStock(items.bread, warehouseFg),
    };

    chain = {
      doughOrder: doughDone.order,
      breadOrder: breadDone.order,
      flourBatchId: batches.flour,
      yeastBatchId: batches.yeast,
      packagingBatchId: batches.packaging,
      doughBatchId: doughDone.batchId!,
      breadBatchId: breadDone.batchId!,
      doughBatchNo: doughDone.batchNo!,
      breadBatchNo: breadDone.batchNo!,
      doughConsumeJournalId: doughConsumed.journalEntryId,
      doughScrapJournalId: doughScrapped.journalEntryId,
      doughCompleteJournalId: doughDone.journalEntryId!,
      breadConsumeJournalId: breadConsumed.journalEntryId,
      breadCompleteJournalId: breadDone.journalEntryId!,
      saleInvoiceId: salePosted.invoice.id,
      saleSettlementJournalId: salePosted.journalEntryId,
      saleCogsJournalId: salePosted.cogsJournalEntryId,
      chainBalances,
      consumedAt: "2026-03-02",
      breadConsumedAt: "2026-03-04",
      doughCompletedAt: "2026-03-03",
      breadCompletedAt: "2026-03-05",
      saleDate: "2026-03-06",
    };
  });

  fixture = {
    fiscalYearId,
    branchId,
    warehouseRaw,
    warehouseFg,
    customerId,
    creditTermId,
    gl,
    taxCodeIds,
    items,
    batches,
    boms: { dough: bomRows.dough!, bread: bomRows.bread! },
    chain: chain!,
  };
  return fixture;
}

/** The app-role client bound to tenant M (attack-suite ergonomics). */
export async function mfgAppClient(): Promise<Client> {
  const client = await appClient();
  await client.query("SELECT set_config('erp.tenant_id', $1, false)", [TENANT_M]);
  return client;
}

/** Superuser client (settings mutations + drift seeding). */
export async function su(): Promise<Client> {
  return superuserClient();
}

/** Set a tenant setting (deterministic probes over the registry defaults).
 * Values JSON.stringify'd so readSetting<T> sees the JSON scalar type. */
export async function setMfgSetting(key: string, value: string | number | boolean): Promise<void> {
  const suClient = await superuserClient();
  await suClient.query(
    `INSERT INTO tenant_settings (id, tenant_id, key, value)
     VALUES (gen_random_uuid(), $1, $2, $3::jsonb)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [TENANT_M, key, JSON.stringify(value)],
  );
  await suClient.end();
}

/** Remove a tenant setting (restore the registry default). */
export async function clearMfgSetting(key: string): Promise<void> {
  const suClient = await superuserClient();
  await suClient.query(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND key = $2`, [
    TENANT_M,
    key,
  ]);
  await suClient.end();
}
