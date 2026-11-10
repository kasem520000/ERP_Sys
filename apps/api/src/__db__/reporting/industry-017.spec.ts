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
import { WarehouseService } from "../../modules/inventory/application/warehouse-service";
import { ReservationService } from "../../modules/inventory/application/reservation-service";
import { TransferService } from "../../modules/inventory/application/transfer-service";
import { GoodsReceiptService } from "../../modules/purchasing/application/goods-receipts";
import { SalesInvoiceService } from "../../modules/sales/application/invoices";
import { CreditNoteService } from "../../modules/sales/application/credit-notes";
import { SalesRepService } from "../../modules/sales/application/reps";
import { JobCardService } from "../../modules/sales/job-cards/application/job-card-service";
import { JobCardPosting } from "../../modules/sales/job-cards/application/posting/job-card-posting";
import { CommissionService } from "../../modules/sales/commissions/application/commission-service";
import { RouteService } from "../../modules/distribution/application/route-service";
import { VisitService } from "../../modules/distribution/application/visit-service";
import { VanStockService } from "../../modules/distribution/application/van-stock-service";
import { SettlementService } from "../../modules/distribution/application/settlement-service";
import { AccountService } from "../../modules/treasury/application/account-service";
import type { ReportResult } from "../../modules/reporting/application/contract";

/**
 * PHASE-017 T8-a · the seven PHASE-017 industry report fixtures
 * (industries/reports/README PHASE-017 rows; the README rule 5: "cover with
 * a fixture asserting totals against journal lines where applicable"):
 * the contracts over a dedicated, fully-journaled tenant R17 — every row
 * flows through the real services (GRN → job card → invoice → warranty CN;
 * van load-out → route visits → cash/credit sales with a FOC line →
 * settlement with variance + deposit → commission run), so the report
 * totals tie EXACTLY to the journal lines:
 *
 * - `automotive.job_card_profitability` — parts revenue/cogs/margin net of
 *   the warranty CN, the `jc-parts-cogs-tie` PASSing at 0 tolerance.
 * - `automotive.vehicle_service_history` — the per-vehicle timeline rows.
 * - `distribution.rep_settlement` — counted/expected/variance + the
 *   `settlement-gl-tie` PASSing (|variance| + deposits == Σ journal debits).
 * - `distribution.route_visit_compliance` — planned 2, completed 2, sales
 *   per visit.
 * - `distribution.van_stock_balances` — the post-sale mirror with expiry
 *   risk + the `van-conservation-tie` PASSing (mirror == Σ signed moves).
 * - `sales.discount_management_effectiveness` — FOC qty + 0 revenue +
 *   the paired paid sales.
 * - `sales.commissions_due` — the posted run's line + the
 *   `commissions-total-tie` PASSing (posted total == accrual debits).
 *
 * Dedicated tenant R17 (SAR base): the workshop book (vehicle + reserve
 * card: parts 2 × 100 + labor 1.5 h × 80, COGS 2 × 60, warranty CN 1 part)
 * and the van book (rep + van; load-out 10 @ 5 + a batch GRN 6 @ 4 into the
 * van; 2 visits: cash sale 4 × 10 and credit sale 2 × 12 + 1 FOC PROMO-1 at
 * a true zero price — net 0 with foc_reason_code, legal since migration
 * 0025 relaxed ck_sales_invoice_lines_net_positive; settlement opening 20 +
 * cash 40, counted 58 → shortage 2, deposit 58; commission run 5% INVOICED
 * over 64.0000). All dates ride today — the honest document dates the
 * services stamp.
 */

/** Dedicated PHASE-017 reporting tenant (owns its book end to end). */
export const TENANT_R17 = "39393939-3939-3939-3939-393939393939";
/** The approver (BR-034: the creator never approves their own document). */
const R17_APPROVER = "3e3e3e3e-0000-4000-8000-00000000003e";

const TODAY = () => new Date().toISOString().slice(0, 10);

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const periods = new PeriodService(audit);
const coa = new CoaService(audit);
const resolver = new TaxResolverService();
const warehouses = new WarehouseService(audit);
const goodsReceipts = new GoodsReceiptService(audit, posting, numbering);
const salesInvoices = new SalesInvoiceService(audit, posting, numbering, resolver);
const creditNotes = new CreditNoteService(audit, posting, numbering, resolver);
const salesReps = new SalesRepService(audit);
const reservations = new ReservationService(audit);
const jobCardPort = new JobCardPosting(posting, salesInvoices, creditNotes, reservations);
const jobCards = new JobCardService(audit, numbering);
jobCards.setPostingPort(jobCardPort);
const commissions = new CommissionService(audit, posting);
const transfers = new TransferService(audit, posting, numbering);
const vans = new VanStockService(audit, transfers);
const routes = new RouteService(audit);
const visits = new VisitService(audit);
const settlements = new SettlementService(audit, posting, numbering);
const treasuryAccounts = new AccountService(audit);

interface R17Fixture {
  branchId: string;
  mainWarehouseId: string;
  vanWarehouseId: string;
  vehicleId: string;
  partItemId: string;
  laborItemId: string;
  vanPlainItemId: string;
  vanBatchItemId: string;
  customer1Id: string;
  customer2Id: string;
  repId: string;
  repCashId: string;
  bankTreasuryId: string;
  cardId: string;
  invoiceNo: string | null;
  creditNoteNo: string | null;
  cashInvoiceId: string;
  creditInvoiceId: string;
  settlementNo: string | null;
}

let fixture: R17Fixture | undefined;

function assertDefined<T>(value: T | undefined | null, label: string): T {
  if (value === undefined || value === null) throw new Error(`fixture ${label} missing`);
  return value;
}

/** Boots tenant R17's workshop + van books (idempotent — every step guards its own rows). */
async function setupR17Fixture(): Promise<R17Fixture> {
  if (fixture !== undefined) return fixture;
  ensureTestDb();
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant R17 (industry reporting 017)', 'المستأجر ر-١٧', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_R17],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status)
     VALUES ($1, 'reporting-actor@fixture.test', 'Reporting Actor', 'x', 'ACTIVE'),
            ($2, 'r17-approver@fixture.test', 'R17 Approver', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [R_ACTOR, R17_APPROVER],
  );
  await su.end();

  const built = await withTenant(TENANT_R17, async () => {
    const { provisionCoaTemplate, seedMasterDataBasics, insertAccountPurpose, listBranches, insertBranch } =
      await import("../../modules/tenancy/infrastructure/tenancy.store");
    const { findAccountByCode, findActivePurpose, findFiscalYearByName } = await import(
      "../../modules/accounting/infrastructure/accounting.store"
    );
    const partnersStore = await import("../../modules/partners/infrastructure/partners.store");
    const vehiclesStore = await import("../../modules/partners/infrastructure/vehicles.store");
    const itemsStore = await import("../../modules/items/infrastructure/items.store");
    const salesStore = await import("../../modules/sales/infrastructure/sales.store");
    const jobCardsStore = await import("../../modules/sales/infrastructure/job-cards.store");
    const inventoryStore = await import("../../modules/inventory/infrastructure/inventory.store");
    await seedMasterDataBasics();
    await provisionCoaTemplate();

    // Purpose map (defensive — mirrors the sales fixture): everything the
    // posting services in this book resolve. GRNI is the one the CoA
    // template leaves unmarked (GRN posting); CASH_DIFFERENCE hosts BR-021.
    const mapPurpose = async (purposeKey: string, code: string) => {
      const existing = await findActivePurpose(purposeKey);
      if (existing !== undefined) return existing.accountId;
      const account = await findAccountByCode(code);
      if (account === undefined) throw new Error(`fixture account ${code} missing`);
      await insertAccountPurpose({ purposeKey, accountId: account.id, activeFrom: "2025-12-01" });
      return account.id;
    };
    await mapPurpose("INVENTORY", "1140");
    await mapPurpose("AR_CONTROL", "1130");
    await mapPurpose("SALES_REVENUE", "4100");
    await mapPurpose("SERVICE_REVENUE", "4200");
    await mapPurpose("SALES_RETURNS", "4110");
    await mapPurpose("VAT_PAYABLE", "2120");
    await mapPurpose("COGS", "5100");
    await mapPurpose("GRNI", "2130");
    await mapPurpose("CASH_DIFFERENCE", "5900");
    await mapPurpose("COMMISSION_EXPENSE", "5250");
    await mapPurpose("COMMISSION_ACCRUAL", "2150");

    // The fiscal year covering today (the services stamp honest dates).
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
    const mainWarehouse =
      existingWarehouses.find((w) => w.code === "R17-WH") ??
      (await warehouses.create({
        branchId: mainBranch.id,
        code: "R17-WH",
        name: "R17 main warehouse",
        nameAr: "مستودع ر-١٧",
        inventoryAccountId: null,
        note: null,
        actorId: R_ACTOR,
      }));

    const uoms = await itemsStore.listUoms();
    const pcs = assertDefined(uoms.find((u) => u.code === "PCS"), "PCS uom");
    const ensureItem = async (
      sku: string,
      name: string,
      extra: { kind?: "STOCK" | "SERVICE"; trackBatch?: boolean; hasExpiry?: boolean; basePrice?: string | null },
    ) => {
      const found = await itemsStore.findItemBySku(sku);
      if (found !== undefined) return found.id;
      const created = await itemsStore.insertItem({
        sku,
        name,
        nameAr: null,
        kind: extra.kind ?? "STOCK",
        uomId: pcs.id,
        categoryId: null,
        taxCodeId: null,
        costingMethod: "WAC",
        trackBatch: extra.trackBatch ?? false,
        trackSerial: false,
        trackImei: false,
        hasExpiry: extra.hasExpiry ?? false,
        reorderLevel: null,
        reorderQty: null,
        basePrice: extra.basePrice ?? null,
      });
      return created.id;
    };
    const partItem = await ensureItem("R17-PART", "R17 brake pads", {});
    const laborItem = await ensureItem("R17-LABOR", "R17 workshop labor", {
      kind: "SERVICE",
      basePrice: "80.000000",
    });
    const vanPlainItem = await ensureItem("R17-VAN-PLAIN", "R17 van plain item", {});
    const vanBatchItem = await ensureItem("R17-VAN-BATCH", "R17 van batch item", {
      trackBatch: true,
      hasExpiry: true,
    });

    const ensurePartner = async (kind: "CUSTOMER" | "SUPPLIER", code: string, name: string) => {
      const found = await partnersStore.findPartnerByCode(code);
      if (found !== undefined) return found.id;
      const created = await partnersStore.insertPartner({
        kind,
        code,
        name,
        nameAr: null,
        taxNumber: null,
        creditLimit: null,
        creditTermsId: null,
        priceListId: null,
      });
      return created.id;
    };
    const customer1 = await ensurePartner("CUSTOMER", "R17-CUST-01", "ورشة الرياض");
    const customer2 = await ensurePartner("CUSTOMER", "R17-CUST-02", "بقالة الحي");
    const supplier = await ensurePartner("SUPPLIER", "R17-SUP-01", "مورد ر-١٧");

    // The serviced vehicle (chassis-keyed → idempotent; VIN shape, no I/O/Q).
    const vehicle =
      (await vehiclesStore.findVehicleByChassis("R17VH00000000001")) ??
      (await vehiclesStore.insertVehicle({
        partnerId: customer1,
        make: "Toyota",
        model: "Land Cruiser",
        modelYear: 2021,
        chassisNo: "R17VH00000000001",
        plateNo: "R17-1234",
        color: null,
        engineNo: null,
        odometerKm: "125000",
        odometerAt: null,
        note: null,
        noteAr: null,
        createdBy: R_ACTOR,
      }));

    // The rep + the van (one van per rep — both idempotent by code).
    const existingReps = await salesReps.list({ limit: 100 });
    const repId =
      existingReps.find((r) => r.code === "R17-REP-01")?.id ??
      (
        await salesReps.create({
          code: "R17-REP-01",
          name: "R17 route rep",
          nameAr: "مندوب ر-١٧",
          email: null,
          phone: null,
          note: null,
          noteAr: null,
          actorId: R_ACTOR,
        })
      ).id;
    const existingVans = await vans.listVans();
    const van =
      existingVans.find((v) => v.code === "R17-VAN-01") ??
      (await vans.registerVan({
        code: "R17-VAN-01",
        name: "Van 01",
        nameAr: "سيارة ٠١",
        branchId: mainBranch.id,
        salesRepId: repId,
        actorId: R_ACTOR,
      }));

    // Treasury: the rep cash drawer + the deposit bank (novel GL codes).
    const ensureGl = async (code: string, name: string, nameAr: string, parentCode: string) => {
      const found = await findAccountByCode(code);
      if (found !== undefined) return found.id;
      const parent = await findAccountByCode(parentCode);
      if (parent === undefined) throw new Error(`fixture parent ${parentCode} missing`);
      const created = await coa.create(R_ACTOR, {
        code,
        name,
        nameAr,
        type: "ASSET",
        parentId: parent.id,
        currencyCode: null,
        isGroup: false,
      });
      return created.id;
    };
    const repCashGl = await ensureGl("1113", "Rep cash (R17)", "صندوق المندوب", "1110");
    const bankGl = await ensureGl("1122", "Bank - R17 deposits", "البنك - إيداعات ر-١٧", "1120");
    const accounts = await treasuryAccounts.list({});
    const repCash =
      accounts.find((a) => a.name === "R17 rep cash") ??
      (await treasuryAccounts.open({
        name: "R17 rep cash",
        nameAr: "صندوق مندوب ر-١٧",
        type: "CASH",
        accountId: repCashGl,
        branchId: null,
        currencyCode: "SAR",
        actorId: R_ACTOR,
      }));
    const bank =
      accounts.find((a) => a.name === "R17 bank") ??
      (await treasuryAccounts.open({
        name: "R17 bank",
        nameAr: "بنك ر-١٧",
        type: "BANK",
        accountId: bankGl,
        branchId: null,
        currencyCode: "SAR",
        actorId: R_ACTOR,
      }));

    // -- goods-in (guarded by the on-hand read model) -------------------------
    // GRN-1 into the main warehouse: parts ×10 @ 60 + van plain ×20 @ 5.
    const partStock = await inventoryStore.findItemStock(partItem, mainWarehouse.id);
    if (partStock === undefined || Number(partStock.qty) === 0) {
      const grn = await goodsReceipts.create({
        branchId: mainBranch.id,
        supplierId: supplier,
        poId: null,
        warehouseId: mainWarehouse.id,
        receiptDate: TODAY(),
        poLessReason: "R17 industry-report fixture substrate",
        note: null,
        noteAr: null,
        actorId: R_ACTOR,
        lines: [
          { poLineId: null, itemId: partItem, qty: "10", unitCost: "60.000000", accountId: null, batchNo: null, batchExpiry: null, serialIds: null, note: null },
          { poLineId: null, itemId: vanPlainItem, qty: "20", unitCost: "5.000000", accountId: null, batchNo: null, batchExpiry: null, serialIds: null, note: null },
        ],
      });
      await goodsReceipts.post(grn.id, R_ACTOR);
    }
    // GRN-2 straight into the van: the batch item ×6 @ 4, expiry +20 days
    // (the expiry-risk row of the van stock balances).
    const batchVanStock = await inventoryStore.findItemStock(vanBatchItem, van.id);
    if (batchVanStock === undefined || Number(batchVanStock.qty) === 0) {
      const expiry = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const grn = await goodsReceipts.create({
        branchId: mainBranch.id,
        supplierId: supplier,
        poId: null,
        warehouseId: van.id,
        receiptDate: TODAY(),
        poLessReason: "R17 van direct load fixture",
        note: null,
        noteAr: null,
        actorId: R_ACTOR,
        lines: [
          { poLineId: null, itemId: vanBatchItem, qty: "6", unitCost: "4.000000", accountId: null, batchNo: "R17-B-1", batchExpiry: expiry, serialIds: null, note: null },
        ],
      });
      await goodsReceipts.post(grn.id, R_ACTOR);
    }
    // Load-out: plain ×10 from the main warehouse into the van (receive in
    // the same step — the mirror lands).
    const plainVanStock = await inventoryStore.findItemStock(vanPlainItem, van.id);
    if (plainVanStock === undefined || Number(plainVanStock.qty) === 0) {
      const load = await vans.loadOut({
        fromWarehouseId: mainWarehouse.id,
        vanWarehouseId: van.id,
        lines: [{ itemId: vanPlainItem, qty: "10" }],
        note: "R17 morning load",
        noteAr: null,
        actorId: R_ACTOR,
      });
      await vans.receiveTransfer(load.id, { actorId: R_ACTOR });
    }

    // -- the workshop book (reserve mode card → posted invoice → warranty CN) --
    let cardId = "";
    let invoiceNo: string | null = null;
    let creditNoteNo: string | null = null;
    const invoicedCard = (await jobCards.list({ vehicleId: vehicle.id, limit: 10 })).find(
      (c) => c.status === "INVOICED",
    );
    if (invoicedCard === undefined) {
      const card = await jobCards.create({
        branchId: mainBranch.id,
        customerId: customer1,
        vehicleId: vehicle.id,
        warehouseId: mainWarehouse.id,
        partsIssueMode: "reserve",
        complaints: "brake noise",
        complaintsAr: null,
        odometerKm: "125000.5",
        checkedInAt: null,
        note: null,
        noteAr: null,
        actorId: R_ACTOR,
        lines: [
          {
            lineType: "PARTS",
            itemId: partItem,
            qty: "2",
            unitPrice: "100",
            estimatedHours: null,
            discountAmount: null,
            taxCodeId: null,
            description: "brake pads",
            descriptionAr: "فرامل",
            note: null,
          },
          {
            lineType: "LABOR",
            itemId: laborItem,
            qty: "1",
            unitPrice: "80",
            estimatedHours: "1.5",
            discountAmount: null,
            taxCodeId: null,
            description: "replace pads",
            descriptionAr: null,
            note: null,
          },
        ],
      });
      await jobCards.approve(card.id, { actorId: R_ACTOR });
      const laborLine = assertDefined(
        (await jobCardsStore.listJobCardLines(card.id)).find((l) => l.lineType === "LABOR"),
        "labor card line",
      );
      await jobCards.logHours(card.id, laborLine.id, { hours: "1.5", actorId: R_ACTOR });
      await jobCards.complete(card.id, { actorId: R_ACTOR });
      const invoiced = await jobCards.invoice(card.id, { actorId: R_ACTOR });
      cardId = invoiced.id;
      invoiceNo = invoiced.invoiceId === null ? null : assertDefined(
        await salesStore.findSalesInvoiceById(invoiced.invoiceId),
        "card invoice",
      ).invoiceNo;
    } else {
      cardId = invoicedCard.id;
      invoiceNo = assertDefined(
        await salesStore.findSalesInvoiceById(assertDefined(invoicedCard.invoiceId, "card invoice id")),
        "card invoice",
      ).invoiceNo;
    }
    // The warranty CN against the card's invoice (1 part back to stock at
    // the original issue cost) — idempotent by invoice reference.
    const cardInvoiceId = assertDefined(
      (await jobCardsStore.findJobCardById(cardId)),
      "card",
    ).invoiceId;
    const postedCardNote = (
      await salesStore.listCreditNotes({ invoiceId: cardInvoiceId ?? undefined, limit: 5 })
    ).find((n) => n.status === "POSTED" && n.jobCardId === cardId);
    if (postedCardNote === undefined) {
      const invoiceLines = await salesStore.listSalesInvoiceLines(assertDefined(cardInvoiceId, "card invoice id"));
      const partsLine = assertDefined(invoiceLines.find((l) => l.itemId === partItem), "parts invoice line");
      const note = await jobCardPort.warrantyCreditNote(cardId, {
        invoiceId: assertDefined(cardInvoiceId, "card invoice id"),
        lines: [{ invoiceLineId: partsLine.id, qty: "1" }],
        note: null,
        actorId: R_ACTOR,
      });
      creditNoteNo = note.noteNo ?? null;
    } else {
      creditNoteNo = postedCardNote.noteNo;
    }

    // -- the van book (route + 2 visits: cash sale, credit sale with FOC) -----
    const existingRoutes = await routes.list({ limit: 50 });
    const route =
      existingRoutes.find((r) => r.code === "R17-RT-01") ??
      (await routes.create({
        code: "R17-RT-01",
        name: "R17 city route",
        nameAr: "خط المدينة",
        salesRepId: repId,
        vanWarehouseId: van.id,
        dayPattern: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"],
        note: null,
        noteAr: null,
        actorId: R_ACTOR,
      }));
    const composition = await routes.setCustomers(route.id, {
      customers: [{ customerId: customer1 }, { customerId: customer2 }],
      actorId: R_ACTOR,
    });
    void composition;
    let dayVisits = await visits.list({ routeId: route.id, date: TODAY(), limit: 10 });
    if (dayVisits.length === 0) {
      await routes.planVisits(route.id, { date: TODAY(), actorId: R_ACTOR });
      dayVisits = await visits.list({ routeId: route.id, date: TODAY(), limit: 10 });
    }

    // Invoice A — the cash sale from the van (customer 1: 4 × 10 = 40).
    let cashInvoiceId =
      (await salesStore.listSalesInvoices({ customerId: customer1, kind: "CASH", limit: 10 })).find(
        (i) => i.warehouseId === van.id,
      )?.id ?? "";
    if (cashInvoiceId === "") {
      const invoice = await salesInvoices.create({
        branchId: mainBranch.id,
        customerId: customer1,
        salesRepId: repId,
        kind: "CASH",
        invoiceDate: TODAY(),
        dueDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        orderId: null,
        deliveryId: null,
        warehouseId: van.id,
        cashAccountId: repCash.id,
        note: "R17 visit cash sale",
        noteAr: null,
        actorId: R_ACTOR,
        lines: [
          {
            itemId: vanPlainItem,
            accountId: null,
            deliveryLineId: null,
            description: "van sale",
            descriptionAr: null,
            qty: "4",
            unitPrice: "10.000000",
            discountAmount: null,
            taxCodeId: null,
            batchId: null,
            serialIds: null,
            note: null,
          },
        ],
      });
      await salesInvoices.approve(invoice.id, R17_APPROVER, false);
      await salesInvoices.post(invoice.id, R_ACTOR);
      cashInvoiceId = invoice.id;
    }

    // Invoice B — the credit sale from the van (customer 2: 2 × 12 = 24 +
    // 1 FOC unit, reason PROMO-1). BR-008 zero-price FOC line: net 0 with
    // foc_reason_code — legal since migration 0025 relaxed
    // ck_sales_invoice_lines_net_positive to
    // (net_amount > 0 OR foc_reason_code IS NOT NULL), so the line carries
    // exactly 0 revenue, full WAC cost, and the reason code persists.
    let creditInvoiceId =
      (await salesStore.listSalesInvoices({ customerId: customer2, kind: "CREDIT", limit: 10 })).find(
        (i) => i.warehouseId === van.id,
      )?.id ?? "";
    if (creditInvoiceId === "") {
      const invoice = await salesInvoices.create({
        branchId: mainBranch.id,
        customerId: customer2,
        salesRepId: repId,
        kind: "CREDIT",
        invoiceDate: TODAY(),
        dueDate: null,
        currencyCode: "SAR",
        exchangeRate: null,
        orderId: null,
        deliveryId: null,
        warehouseId: van.id,
        cashAccountId: null,
        note: "R17 visit credit sale",
        noteAr: null,
        actorId: R_ACTOR,
        lines: [
          {
            itemId: vanPlainItem,
            accountId: null,
            deliveryLineId: null,
            description: "van sale",
            descriptionAr: null,
            qty: "2",
            unitPrice: "12.000000",
            discountAmount: null,
            taxCodeId: null,
            batchId: null,
            serialIds: null,
            note: null,
          },
          {
            itemId: vanPlainItem,
            accountId: null,
            deliveryLineId: null,
            description: "FOC promo unit (BR-008)",
            descriptionAr: "وحدة ترويجية مجانية",
            qty: "1",
            unitPrice: "0.000000",
            discountAmount: null,
            taxCodeId: null,
            batchId: null,
            serialIds: null,
            focReasonCode: "PROMO-1",
            note: null,
          },
        ],
      });
      await salesInvoices.approve(invoice.id, R17_APPROVER, false);
      await salesInvoices.post(invoice.id, R_ACTOR);
      creditInvoiceId = invoice.id;
    }

    // Complete the visits against their evidence invoices (exactly-once
    // flips — only PLANNED rows complete).
    for (const visit of dayVisits) {
      if (visit.status !== "PLANNED") continue;
      await visits.complete(visit.id, {
        salesInvoiceId: visit.customerId === customer1 ? cashInvoiceId : creditInvoiceId,
        actorId: R_ACTOR,
      });
    }

    // The van board read — refreshes the mirror after the sales (the
    // distribution module's own read discipline).
    await vans.listVanStock({ warehouseId: van.id });

    // The settlement: opening 20 + cash sales 40 = expected 60; counted 58
    // → shortage 2 (reason + separate approver), bank deposit 58.
    let settlementNo: string | null = null;
    const liveSettlement = (
      await settlements.list({ repId, date: TODAY(), limit: 5 })
    ).find((s) => s.status !== "CANCELLED");
    if (liveSettlement === undefined) {
      const opened = await settlements.open({
        salesRepId: repId,
        cashAccountId: repCash.id,
        vanWarehouseId: van.id,
        settlementDate: TODAY(),
        openingCash: "20.0000",
        note: null,
        noteAr: null,
        actorId: R_ACTOR,
      });
      await settlements.count(opened.id, {
        countedCash: "58.0000",
        varianceReason: "short 2 — damaged note rejected",
        actorId: R_ACTOR,
      });
      await settlements.approve(opened.id, { approverId: R17_APPROVER });
      const postedSettlement = await settlements.post(opened.id, {
        depositAccountId: bank.id,
        depositAmount: "58.0000",
        actorId: R_ACTOR,
      });
      settlementNo = postedSettlement.settlementNo;
    } else {
      settlementNo = liveSettlement.settlementNo;
    }

    // The commission run: 5% INVOICED over the rep's day (base 40 + 24 =
    // 64 → 3.2000), posted → the accrual journal.
    const rule = await commissions.getRule(repId);
    if (rule.method !== "PERCENTAGE" || rule.basis !== "INVOICED") {
      await commissions.setRule(
        repId,
        { method: "PERCENTAGE", rate: "5", basis: "INVOICED", tiers: null },
        R_ACTOR,
      );
    }
    const existingRun = (await commissions.list({ limit: 20 })).find(
      (r) => r.periodFrom === TODAY() && r.periodTo === TODAY() && r.basis === "INVOICED" && r.status !== "CANCELLED",
    );
    if (existingRun === undefined) {
      const run = await commissions.createRun({
        periodFrom: TODAY(),
        periodTo: TODAY(),
        basis: "INVOICED",
        note: "R17 daily commissions",
        noteAr: null,
        actorId: R_ACTOR,
      });
      await commissions.post(run.id, R_ACTOR);
    } else if (existingRun.status === "DRAFT") {
      await commissions.post(existingRun.id, R_ACTOR);
    }

    return {
      branchId: mainBranch.id,
      mainWarehouseId: mainWarehouse.id,
      vanWarehouseId: van.id,
      vehicleId: vehicle.id,
      partItemId: partItem,
      laborItemId: laborItem,
      vanPlainItemId: vanPlainItem,
      vanBatchItemId: vanBatchItem,
      customer1Id: customer1,
      customer2Id: customer2,
      repId,
      repCashId: repCash.id,
      bankTreasuryId: bank.id,
      cardId,
      invoiceNo,
      creditNoteNo,
      cashInvoiceId,
      creditInvoiceId,
      settlementNo,
    };
  });

  fixture = built;
  return fixture;
}

function runReport(
  reportKey: string,
  params: Record<string, unknown>,
): Promise<{ runId: string; result?: ReportResult; status: string }> {
  return withTenant(TENANT_R17, () =>
    newRunService().run({ reportKey, params, ctx: fullContext(TENANT_R17) }),
  );
}

beforeAll(async () => {
  await setupR17Fixture();
});

// -- the workshop book ------------------------------------------------------------

describe("automotive.job_card_profitability (PHASE-017 T8-a; GL tie-out)", () => {
  it("shows the card's parts revenue/cogs/margin net of the warranty CN, labor revenue, and invoice status; the parts COGS tie PASSES exactly", async () => {
    const day = TODAY();
    const outcome = await runReport("automotive.job_card_profitability", {
      dateFrom: day,
      dateTo: day,
      locale: "en",
    });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;
    expect(result.reportId).toBe("automotive.job_card_profitability");

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    // parts 2 × 100 = 200 invoiced − 100 warranty CN; COGS 2 × 60 = 120
    // invoiced − 60 re-entry; labor 1.5 h × 80 = 120 (untouched by the CN).
    expect(row.values.cardNo).toMatch(/^JC-\d{4}-\d{5}$/);
    expect(row.values.vehicleLabel).toBe("Toyota Land Cruiser");
    expect(row.values.plateNo).toBe("R17-1234");
    expect(row.values.status).toBe("INVOICED");
    expect(row.values.partsRevenue).toBe("100.0000");
    expect(row.values.partsCogs).toBe("60.0000");
    expect(row.values.partsMargin).toBe("40.0000");
    expect(row.values.laborRevenue).toBe("120.0000");
    expect(row.values.laborHours).toBe("1.500000");
    expect(row.values.daysOpen).toBe(0);
    expect(row.values.invoiceNo).toMatch(/^SAL-\d{4}-\d{6}$/);
    expect(row.values.invoiceStatus).toBe("POSTED");

    const totals = new Map(result.totals.map((total) => [total.id, total.amount]));
    expect(totals.get("partsRevenueTotal")).toBe("100.0000");
    expect(totals.get("partsCogsTotal")).toBe("60.0000");
    expect(totals.get("partsMarginTotal")).toBe("40.0000");
    expect(totals.get("laborRevenueTotal")).toBe("120.0000");

    // The GL tie: register parts COGS == Σ net COGS journal lines of the
    // postings backing the card (invoice cogs 120 − re-entry 60).
    const tie = result.assertions.find((a) => a.id === "jc-parts-cogs-tie")!;
    expect(tie.status).toBe("PASS");
    expect(tie.compared).toEqual({ left: "60.0000", right: "60.0000" });
  });

  it("an empty window is honestly empty (zero rows, zero tie)", async () => {
    const outcome = await runReport("automotive.job_card_profitability", {
      dateFrom: "2025-01-01",
      dateTo: "2025-01-31",
      locale: "en",
    });
    const result = outcome.result!;
    expect(result.rows).toHaveLength(0);
    const tie = result.assertions.find((a) => a.id === "jc-parts-cogs-tie")!;
    expect(tie.status).toBe("PASS");
    expect(tie.compared).toEqual({ left: "0.0000", right: "0.0000" });
  });
});

describe("automotive.vehicle_service_history (PHASE-017 T8-a; the timeline read model)", () => {
  it("lists the vehicle's job card, invoice, and warranty credit note — newest first", async () => {
    const fx = await setupR17Fixture();
    const outcome = await runReport("automotive.vehicle_service_history", {
      vehicleId: fx.vehicleId,
      locale: "en",
    });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;

    expect(result.rows).toHaveLength(3);
    // All three carry today's date; the ordering is date DESC then kind ASC.
    expect(result.rows.map((row) => row.values.kind)).toEqual([
      "Credit note (warranty)",
      "Invoice",
      "Job card",
    ]);
    const [cnRow, invoiceRow, cardRow] = result.rows;
    expect(cnRow!.values.docNo).toBe(fx.creditNoteNo);
    expect(cnRow!.values.status).toBe("POSTED");
    expect(cnRow!.values.total).toBe("100.0000"); // 1 part @ 100 returned
    expect(invoiceRow!.values.docNo).toBe(fx.invoiceNo);
    expect(invoiceRow!.values.total).toBe("320.0000"); // 200 parts + 120 labor
    expect(cardRow!.values.docNo).toMatch(/^JC-\d{4}-\d{5}$/);
    expect(cardRow!.values.total).toBeNull(); // cards carry no document total
    expect(result.assertions).toHaveLength(0); // operational — README rule 2
  });
});

// -- the van book ------------------------------------------------------------------

describe("distribution.rep_settlement (PHASE-017 T8-a; GL tie-out)", () => {
  it("shows the rep's day with load-out, expected/counted cash, the BR-021 variance, and the deposit; the variance+deposit tie PASSES exactly", async () => {
    const day = TODAY();
    const outcome = await runReport("distribution.rep_settlement", {
      dateFrom: day,
      dateTo: day,
      locale: "en",
    });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row.values.settlementNo).toMatch(/^STL-\d{4}-\d{5}$/);
    expect(row.values.repCode).toBe("R17-REP-01");
    expect(row.values.vanCode).toBe("R17-VAN-01");
    expect(row.values.status).toBe("POSTED");
    // Load-out: the transfer-in 10 @ 5 + the direct van GRN 6 @ 4 = 16 / 74.
    expect(row.values.loadOutQty).toBe("16.000000");
    expect(row.values.loadOutValue).toBe("74.0000");
    expect(row.values.openingCash).toBe("20.0000");
    expect(row.values.cashSales).toBe("40.0000");
    expect(row.values.collections).toBe("0.0000");
    expect(row.values.cashRefunds).toBe("0.0000");
    expect(row.values.repExpenses).toBe("0.0000");
    expect(row.values.expectedCash).toBe("60.0000");
    expect(row.values.countedCash).toBe("58.0000");
    expect(row.values.variance).toBe("-2.0000");
    expect(row.values.varianceDirection).toBe("SHORTAGE");
    expect(row.values.depositAmount).toBe("58.0000");
    expect(row.values.varianceJournalNo).toBeTruthy();
    expect(row.values.depositJournalNo).toBeTruthy();
    // The component-lines ledger: opening + cash sale + variance + deposit
    // = 4 lines, Σ signed = 20 + 40 − 2 − 58 = 0 = counted − deposit.
    expect(row.values.componentLineCount).toBe(4);
    expect(row.values.componentLinesTotal).toBe("0.0000");

    // The GL tie: |variance| 2 + deposit 58 == Σ debits of the settlement
    // journals (DR CASH_DIFFERENCE 2 + DR bank 58).
    const tie = result.assertions.find((a) => a.id === "settlement-gl-tie")!;
    expect(tie.status).toBe("PASS");
    expect(tie.compared).toEqual({ left: "60.0000", right: "60.0000" });
  });
});

describe("distribution.route_visit_compliance (PHASE-017 T8-a; planning data)", () => {
  it("aggregates planned 2 / completed 2 with the sales per completed visit", async () => {
    const day = TODAY();
    const outcome = await runReport("distribution.route_visit_compliance", {
      dateFrom: day,
      dateTo: day,
      locale: "en",
    });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row.values.routeCode).toBe("R17-RT-01");
    expect(row.values.repCode).toBe("R17-REP-01");
    expect(row.values.plannedCount).toBe(2);
    expect(row.values.completedCount).toBe(2);
    expect(row.values.skippedCount).toBe(0);
    expect(row.values.missedCount).toBe(0);
    expect(row.values.pendingCount).toBe(0);
    expect(row.values.salesInvoiceCount).toBe(2);
    // Cash sale 40 + credit sale 24.0000 (the zero-net FOC line adds no
    // revenue) over 2 completed visits → 32.0000 per visit.
    expect(row.values.salesTotal).toBe("64.0000");
    expect(row.values.salesPerVisit).toBe("32.0000");

    const totals = new Map(result.totals.map((total) => [total.id, total.amount]));
    expect(totals.get("plannedTotal")).toBe("2");
    expect(totals.get("completedTotal")).toBe("2");
    expect(totals.get("salesGrandTotal")).toBe("64.0000");
    expect(result.assertions).toHaveLength(0); // planning data — README rule 2
  });
});

describe("distribution.van_stock_balances (PHASE-017 T8-a; conservation tie)", () => {
  it("mirrors the post-sale van stock with expiry risk and ageing; the conservation tie PASSES exactly", async () => {
    const outcome = await runReport("distribution.van_stock_balances", { locale: "en" });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;

    expect(result.rows).toHaveLength(2);
    const plain = result.rows.find((row) => row.values.sku === "R17-VAN-PLAIN")!;
    const batch = result.rows.find((row) => row.values.sku === "R17-VAN-BATCH")!;

    // Plain: loaded 10, sold 7 (4 cash + 2 credit + 1 FOC) → 3 @ WAC 5.
    expect(plain.values.warehouseCode).toBe("R17-VAN-01");
    expect(plain.values.repCode).toBe("R17-REP-01");
    expect(plain.values.qty).toBe("3.000000");
    expect(plain.values.value).toBe("15.0000");
    expect(plain.values.batchNo).toBeNull();
    expect(plain.values.expiryDate).toBeNull();
    expect(plain.values.daysToExpiry).toBeNull();
    expect(plain.values.oldestInbound).toBe(TODAY());
    expect(Number(plain.values.ageDays)).toBeGreaterThanOrEqual(0);

    // The batch row: 6 @ 4 straight into the van, expiry ~20 days out.
    expect(batch.values.batchNo).toBe("R17-B-1");
    expect(batch.values.qty).toBe("6.000000");
    expect(batch.values.value).toBe("24.0000");
    expect(batch.values.expiryDate).toBeTruthy();
    expect(Number(batch.values.daysToExpiry)).toBeGreaterThanOrEqual(18);
    expect(Number(batch.values.daysToExpiry)).toBeLessThanOrEqual(22);

    const totals = new Map(result.totals.map((total) => [total.id, total.amount]));
    expect(totals.get("totalQty")).toBe("9.0000");
    expect(totals.get("totalValue")).toBe("39.0000");

    // The conservation tie: mirror 3 + 6 == Σ signed moves (10 + 6 − 7).
    const tie = result.assertions.find((a) => a.id === "van-conservation-tie")!;
    expect(tie.status).toBe("PASS");
    expect(tie.compared).toEqual({ left: "9.000000", right: "9.000000" });
  });
});

describe("sales.discount_management_effectiveness (PHASE-017 T8-a; BR-008 FOC)", () => {
  it("aggregates the FOC line by reason + customer with 0 revenue, its cost, and the paired paid sales", async () => {
    const day = TODAY();
    const outcome = await runReport("sales.discount_management_effectiveness", {
      dateFrom: day,
      dateTo: day,
      locale: "en",
    });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row.values.reasonCode).toBe("PROMO-1");
    expect(row.values.customerCode).toBe("R17-CUST-02");
    expect(row.values.focLineCount).toBe(1);
    expect(row.values.focQty).toBe("1.000000");
    // The true zero-price FOC line's revenue is exactly 0 (BR-008 + the
    // relaxed 0025 constraint).
    expect(row.values.focRevenue).toBe("0.0000");
    expect(row.values.focCostValue).toBe("5.0000"); // 1 unit @ WAC 5 — full cost
    expect(row.values.pairedInvoiceCount).toBe(1);
    expect(row.values.pairedSalesQty).toBe("2.000000");
    expect(row.values.pairedSalesNet).toBe("24.0000");

    const totals = new Map(result.totals.map((total) => [total.id, total.amount]));
    expect(totals.get("focQtyTotal")).toBe("1.0000");
    expect(totals.get("focCostTotal")).toBe("5.0000");
    expect(totals.get("pairedNetTotal")).toBe("24.0000");
    expect(result.assertions).toHaveLength(0); // operational — README rule 2
  });
});

describe("sales.commissions_due (PHASE-017 T8-a; GL tie-out)", () => {
  it("shows the posted run's rep line with base/rate/payout state; the posted total ties to the accrual journal exactly", async () => {
    const day = TODAY();
    const outcome = await runReport("sales.commissions_due", {
      dateFrom: day,
      dateTo: day,
      locale: "en",
    });
    expect(outcome.status).toBe("SUCCEEDED");
    const result = outcome.result!;

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row.values.repCode).toBe("R17-REP-01");
    expect(row.values.basis).toBe("INVOICED");
    expect(row.values.runStatus).toBe("POSTED");
    expect(row.values.periodFrom).toBe(day);
    expect(row.values.periodTo).toBe(day);
    expect(row.values.baseAmount).toBe("64.0000"); // cash 40 + credit 24.0000 (FOC is 0)
    expect(row.values.rateApplied).toBe("5.0000");
    expect(row.values.commissionAmount).toBe("3.2000"); // 64.0000 × 5% (4dp)
    expect(row.values.payoutStatus).toBe("ACCRUED");

    const totals = new Map(result.totals.map((total) => [total.id, total.amount]));
    expect(totals.get("postedTotal")).toBe("3.2000");

    // The GL tie: the posted lines' total == Σ COMMISSION_EXPENSE debits of
    // the accrual journal in the window.
    const tie = result.assertions.find((a) => a.id === "commissions-total-tie")!;
    expect(tie.status).toBe("PASS");
    expect(tie.compared).toEqual({ left: "3.2000", right: "3.2000" });
  });
});

// -- registry integration ------------------------------------------------------------

describe("registry integration (the shared contract)", () => {
  it("the seven PHASE-017 keys are registered with the industry category and reused permissions", async () => {
    const snapshot = newRunService().contracts();
    const expected: [string, string][] = [
      ["automotive.job_card_profitability", "reports.sales.profitability.read"],
      ["automotive.vehicle_service_history", "sales.statements.read"],
      ["distribution.rep_settlement", "reports.treasury.fx.read"],
      ["distribution.route_visit_compliance", "reports.sales.by-rep.read"],
      ["distribution.van_stock_balances", "inventory.stock.read"],
      ["sales.discount_management_effectiveness", "reports.sales.by-customer.read"],
      ["sales.commissions_due", "reports.sales.by-rep.read"],
    ];
    for (const [id, permission] of expected) {
      const contract = snapshot.find((c) => c.id === id);
      expect(contract, id).toBeDefined();
      expect(contract!.category).toBe("industry");
      expect(contract!.requiredPermission).toBe(permission);
      expect(contract!.executionClass).toBe("inline");
      expect(ALL_KNOWN_PERMISSIONS.has(permission), permission).toBe(true);
    }
  });

  it("exports flow through the shared contract (CSV renderer over the stored envelope)", async () => {
    const day = TODAY();
    const { renderCsv } = await import("../../modules/reporting/application/export/csv");
    const outcome = await runReport("distribution.rep_settlement", {
      dateFrom: day,
      dateTo: day,
      locale: "en",
    });
    const csv = renderCsv(outcome.result!).toString("utf8");
    expect(csv).toContain("STL-");
    expect(csv).toContain("-2.0000");
    expect(csv).toContain("settlement-gl-tie,PASS");
  });
});
