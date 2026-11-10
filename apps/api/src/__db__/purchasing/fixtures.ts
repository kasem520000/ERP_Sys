import type { Client } from "pg";

import { appClient, ensureTestDb, seedTenants, superuserClient } from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { CoaService } from "../../modules/accounting/application/coa-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { JournalService } from "../../modules/accounting/application/journal-service";
import { ReconciliationService } from "../../modules/accounting/application/reconciliation-service";
import { GlQueries } from "../../modules/accounting/application/gl-queries";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { OpeningBalancesPostingService } from "../../modules/accounting/application/opening-balances-service";
import { OpeningBalancesService } from "../../modules/partners/application/opening-balances-service";
import { WarehouseService } from "../../modules/inventory/application/warehouse-service";
import { TaxResolverService } from "../../modules/tax/application/tax-resolver-service";
import { TaxCodesService } from "../../modules/tax/application/codes-service";
import { RegistrationService } from "../../modules/tax/application/registration-service";
import { AccountService } from "../../modules/treasury/application/account-service";
import { PaymentService } from "../../modules/treasury/application/payment-service";
import { SettlementCore } from "../../modules/treasury/application/fx-settlement";
import { PettyCashGuard } from "../../modules/treasury/application/petty-cash-service";
import { AllocationService } from "../../modules/treasury/application/allocation-service";
import { RevaluationService } from "../../modules/inventory/application/revaluation-service";
import { PurchaseRequestService, PurchaseOrderService } from "../../modules/purchasing/application/orders";
import { GoodsReceiptService } from "../../modules/purchasing/application/goods-receipts";
import { SupplierInvoiceService } from "../../modules/purchasing/application/supplier-invoices";
import { DebitNoteService } from "../../modules/purchasing/application/debit-notes";
import { ReallocationService } from "../../modules/purchasing/application/reallocations";
import { ApQueriesService } from "../../modules/purchasing/application/ap-queries";
import { LandedCostService } from "../../modules/purchasing/application/landed-costs";
import { OpeningApService } from "../../modules/purchasing/application/opening-ap";
import { PurchasingReconciliationService } from "../../modules/purchasing/application/purchasing-reconciliation";
import { MatchingService } from "../../modules/purchasing/application/matching";

/**
 * PHASE-011 purchasing db-suite fixtures (ACCOUNTING_TESTS §1): real
 * PostgreSQL 16 through the app-role services exactly as production paths
 * run — every journal flows through PostingEngine.post, every stock row
 * through the PHASE-010 movement core, nothing inserts GL rows directly.
 *
 * Dedicated tenant P (SAR base, SA pack — the 15% STANDARD_RATED window):
 * the purchasing suites own it end to end. FY2026 spans the whole test
 * timeline (opening 2025-12-31 for the G-16 AP leg; documents Jan–Mar;
 * December reserved for PERIOD_LOCKED packs). The GRNI purpose maps to
 * 2130 (accrued expenses — the §2 purpose without a §3 template marker;
 * the fail-closed gap PHASE-007 recorded).
 */

export const P_ACTOR = "bbbbbbbb-0000-4000-8000-0000000000b1";
export const P_BUYER = "bbbbbbbb-0000-4000-8000-0000000000b2";
export const P_ACCOUNTANT = "bbbbbbbb-0000-4000-8000-0000000000b3";
export const TENANT_P = "77777777-7777-7777-7777-777777777777";

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const resolver = new TaxResolverService();
const matching = new MatchingService();

export const purchaseRequests = new PurchaseRequestService(audit, numbering);
export const purchaseOrders = new PurchaseOrderService(audit, numbering);
export const goodsReceipts = new GoodsReceiptService(audit, posting, numbering);
export const supplierInvoices = new SupplierInvoiceService(audit, posting, numbering, resolver, matching);
export const debitNotes = new DebitNoteService(audit, posting, numbering, resolver);
export const reallocations = new ReallocationService(audit, numbering);
export const apQueries = new ApQueriesService();
export const landedCosts = new LandedCostService(audit, posting, numbering, new RevaluationService(audit));
export const openingAp = new OpeningApService(audit);
export const purchasingReconciliation = new PurchasingReconciliationService(audit);

// Treasury surfaces the payment suites reuse (G-10 + allocations).
export const treasuryAccounts = new AccountService(audit);
export const payments = new PaymentService(audit, new SettlementCore(audit, posting, numbering), new PettyCashGuard(audit));
export const allocations = new AllocationService(audit);

// PHASE-007/009 surfaces the purchasing suite reuses.
export const pPosting = posting;
export const pPeriods = new PeriodService(audit);
export const pJournals = new JournalService(audit, posting);
export const pCoa = new CoaService(audit);
export const pGl = new GlQueries();
export const pReconciliation = new ReconciliationService(audit);
export const pOpeningDrafts = new OpeningBalancesService(audit);
export const pOpeningPost = new OpeningBalancesPostingService(audit, posting);
export const warehouses = new WarehouseService(audit);
export const taxCodes = new TaxCodesService(audit);
export const registrations = new RegistrationService(audit);

export type { Client };

/** Deterministic dates over the fixture timeline (FY2026 of tenant P). */
export const P_OPENING_DATE = "2025-12-31";
export const P_JAN = "2026-01-15";
export const P_FEB = "2026-02-15";
export const P_MAR = "2026-03-10";
export const P_DEC = "2026-12-05";

export interface PurchasingFixture {
  fiscalYearId: string;
  branchId: string;
  warehouseId: string;
  supplierId: string;
  supplierCode: string;
  creditTermId: string;
  /** GL accounts: inventory, GRNI (2130), AP control, VAT, COGS, cash. */
  gl: {
    inventory: string;
    grni: string;
    apControl: string;
    vatRecoverable: string;
    vatExpensed: string;
    cogs: string;
    openingEquity: string;
  };
  taxCodeIds: { standard: string; notSubject: string };
  items: { wac: string; fifo: string; expenseAccount: string };
  cashAccountId: string;
}

let fixture: PurchasingFixture | undefined;

/** Boots the suite db + tenant P's full purchasing substrate (idempotent). */
export async function setupPurchasingFixture(): Promise<PurchasingFixture> {
  if (fixture !== undefined) return fixture;
  ensureTestDb();
  const superuser = await superuserClient();
  await seedTenants(superuser as never);
  await superuser.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant P (purchasing)', 'المستأجر ب', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_P],
  );
  await superuser.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'purchasing-actor@fixture.test', 'Purchasing Actor', 'x', 'ACTIVE'),
       ($2, 'purchasing-buyer@fixture.test', 'Purchasing Buyer', 'x', 'ACTIVE'),
       ($3, 'purchasing-accountant@fixture.test', 'Purchasing Accountant', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [P_ACTOR, P_BUYER, P_ACCOUNTANT],
  );
  await superuser.end();

  const gl = {
    inventory: "",
    grni: "",
    apControl: "",
    vatRecoverable: "",
    vatExpensed: "",
    cogs: "",
    openingEquity: "",
  };
  let fiscalYearId = "";
  let branchId = "";
  let warehouseId = "";
  let supplierId = "";
  let supplierCode = "";
  let creditTermId = "";
  const taxCodeIds = { standard: "", notSubject: "" };
  const items = { wac: "", fifo: "", expenseAccount: "" };
  let cashAccountId = "";

  await withTenant(TENANT_P, async () => {
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
    gl.inventory = await mapPurpose("INVENTORY", "1140");
    gl.grni = await mapPurpose("GRNI", "2130");
    gl.apControl = await mapPurpose("AP_CONTROL", "2110");
    gl.vatExpensed = await mapPurpose("VAT_EXPENSED", "5290");
    gl.cogs = await mapPurpose("COGS", "5100");
    gl.openingEquity = await mapPurpose("OPENING_EQUITY", "3100");
    // Dedicated VAT input-tax account (child of 1150) — the same shape the
    // tax fixture maps.
    let vatIn = await findAccountByCode("1155");
    if (vatIn === undefined) {
      vatIn = await pCoa.create(P_ACTOR, {
        code: "1155",
        name: "VAT input tax (recoverable)",
        nameAr: "ض.ق.م المدخلات (قابلة للخصم)",
        type: "ASSET",
        parentId: (await byCode("1150")).id,
        currencyCode: null,
        isGroup: false,
      });
    }
    gl.vatRecoverable = await mapPurpose("VAT_RECOVERABLE", "1155");
    items.expenseAccount = (await byCode("5210")).id; // Rent — expense lines.

    // Fiscal year spanning the whole purchasing timeline.
    const existingYear = await findFiscalYearByName("FY2026");
    fiscalYearId =
      existingYear?.id ??
      (
        await pPeriods.createYear(P_ACTOR, {
          name: "FY2026",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
        })
      ).id;

    // Branch + warehouse.
    const branches = await listBranches(null);
    const mainBranch =
      branches.find((b) => b.code === "MAIN") ??
      (await insertBranch({
        code: "MAIN",
        name: "Main branch",
        nameAr: "الفرع الرئيسي",
        address: null,
      }));
    branchId = mainBranch.id;
    const existingWarehouses = await warehouses.list({ limit: 10, activeOnly: false });
    const main =
      existingWarehouses.find((w) => w.code === "P-WH") ??
      (await warehouses.create({
        branchId: mainBranch.id,
        code: "P-WH",
        name: "Purchasing warehouse",
        nameAr: "مستودع المشتريات",
        inventoryAccountId: null,
        note: null,
        actorId: P_ACTOR,
      }));
    warehouseId = main.id;

    // Supplier with NET-30 credit terms (BR-026: due dates derive here).
    const terms = await partnersStore.listCreditTerms();
    const net30 = terms.find((t) => t.days === 30) ?? (await partnersStore.insertCreditTerms({
      code: "NET30",
      name: "Net 30",
      nameAr: "٣٠ يومًا",
      days: 30,
      description: null,
    }));
    creditTermId = net30.id;
    const existingSupplier = await partnersStore.findPartnerByCode("P-SUPP-01");
    const supplier =
      existingSupplier ??
      (await partnersStore.insertPartner({
        kind: "SUPPLIER",
        code: "P-SUPP-01",
        name: "Purchasing Supplier",
        nameAr: "مورد المشتريات",
        taxNumber: null,
        creditLimit: null,
        creditTermsId: net30.id,
        priceListId: null,
      }));
    supplierId = supplier.id;
    supplierCode = supplier.code;

    // Tax registration (SA pack, REGISTERED) + codes.
    if ((await registrations.list()).length === 0) {
      await registrations.upsert({
        countryCode: "SA",
        status: "REGISTERED",
        registrationNumber: "310000000000003",
        effectiveFrom: "2016-01-01",
        effectiveTo: null,
        actorId: P_ACTOR,
        note: "purchasing fixture registration",
      });
    }
    const existingCodes = await taxCodes.list({ countryCode: "SA" });
    taxCodeIds.standard =
      existingCodes.find((row) => row.code === "STD")?.id ??
      (await taxCodes.create({
        code: "STD",
        name: "Standard (SA)",
        nameAr: null,
        countryCode: "SA",
        defaultTreatment: "STANDARD_RATED",
        actorId: P_ACTOR,
      })).id;
    taxCodeIds.notSubject =
      existingCodes.find((row) => row.code === "NS")?.id ??
      (await taxCodes.create({
        code: "NS",
        name: "Not subject",
        nameAr: null,
        countryCode: "SA",
        defaultTreatment: "NOT_SUBJECT",
        actorId: P_ACTOR,
      })).id;

    // Items: WAC + FIFO (the G-07/G-08 stock fixtures).
    const uoms = await itemsStore.listUoms();
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const ensureItem = async (sku: string, costingMethod: "WAC" | "FIFO") => {
      const found = await itemsStore.findItemBySku(sku);
      if (found !== undefined) return found.id;
      const created = await itemsStore.insertItem({
        sku,
        name: `Purchasing ${sku}`,
        nameAr: null,
        kind: "STOCK",
        uomId: pcs.id,
        categoryId: null,
        taxCodeId: null,
        costingMethod,
        trackBatch: false,
        trackSerial: false,
        trackImei: false,
        hasExpiry: false,
        reorderLevel: null,
        reorderQty: null,
        basePrice: null,
      });
      return created.id;
    };
    items.wac = await ensureItem("P-WAC", "WAC");
    items.fifo = await ensureItem("P-FIFO", "FIFO");

    // Cash account (the G-10 payment leg).
    const existingAccounts = await treasuryAccounts.list({});
    const cash =
      existingAccounts.find((a) => a.name === "Purchasing cash") ??
      (await treasuryAccounts.open({
        name: "Purchasing cash",
        nameAr: "صندوق المشتريات",
        type: "CASH",
        accountId: (await byCode("1111")).id,
        branchId: null,
        currencyCode: "SAR",
        actorId: P_ACTOR,
      }));
    cashAccountId = cash.id;
  });

  fixture = {
    fiscalYearId,
    branchId,
    warehouseId,
    supplierId,
    supplierCode,
    creditTermId,
    gl,
    taxCodeIds,
    items,
    cashAccountId,
  };
  return fixture;
}

/** The app-role client bound to tenant P (attack-suite ergonomics). */
export async function purchasingAppClient(): Promise<Client> {
  const client = await appClient();
  await client.query("SELECT set_config('erp.tenant_id', $1, false)", [TENANT_P]);
  return client;
}
