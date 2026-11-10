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
import { OpeningBalancesService } from "../../modules/partners/application/opening-balances-service";
import { WarehouseService } from "../../modules/inventory/application/warehouse-service";
import { OpeningStockService } from "../../modules/inventory/application/opening-stock-service";
import { TaxResolverService } from "../../modules/tax/application/tax-resolver-service";
import { TaxCodesService } from "../../modules/tax/application/codes-service";
import { RegistrationService } from "../../modules/tax/application/registration-service";
import { AccountService } from "../../modules/treasury/application/account-service";
import { ReceiptService } from "../../modules/treasury/application/receipt-service";
import { SettlementCore } from "../../modules/treasury/application/fx-settlement";
import { AllocationService } from "../../modules/treasury/application/allocation-service";
import { QuotationService } from "../../modules/sales/application/quotations";
import { SalesOrderService } from "../../modules/sales/application/orders";
import { DeliveryNoteService } from "../../modules/sales/application/deliveries";
import { SalesInvoiceService } from "../../modules/sales/application/invoices";
import { CreditNoteService } from "../../modules/sales/application/credit-notes";
import { SalesReallocationService } from "../../modules/sales/application/reallocations";
import { ArQueriesService } from "../../modules/sales/application/ar-queries";

/**
 * PHASE-012 sales db-suite fixtures (ACCOUNTING_TESTS §1): real PostgreSQL
 * 16 through the app-role services exactly as production paths run — every
 * journal flows through PostingEngine.post, every stock row through the
 * PHASE-010 movement core, nothing inserts GL rows directly.
 *
 * Dedicated tenant S (SAR base, SA pack — the 15% STANDARD_RATED window):
 * the sales suites own it end to end. FY2026 spans the whole test timeline
 * (opening 2025-12-31 for the G-16 stock leg — items A ×20 @ WAC 60.0000 +
 * B ×10 @ WAC 25.0000, exactly the W-1 seed; documents Jan–Mar; December
 * reserved for PERIOD_LOCKED packs). AR_CONTROL maps to 1130,
 * SALES_REVENUE 4100, SALES_RETURNS 4110, VAT_PAYABLE 2120.
 */

export const S_ACTOR = "cccccccc-0000-4000-8000-0000000000c1";
export const S_SALES = "cccccccc-0000-4000-8000-0000000000c2";
export const S_CASHIER = "cccccccc-0000-4000-8000-0000000000c3";
export const TENANT_S = "88888888-8888-8888-8888-888888888888";

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const resolver = new TaxResolverService();

export const quotations = new QuotationService(audit, numbering);
export const salesOrders = new SalesOrderService(audit, numbering);
export const deliveries = new DeliveryNoteService(audit, posting, numbering);
export const salesInvoices = new SalesInvoiceService(audit, posting, numbering, resolver);
export const creditNotes = new CreditNoteService(audit, posting, numbering, resolver);
export const salesReallocations = new SalesReallocationService(audit, numbering);
export const arQueries = new ArQueriesService();

// Treasury surfaces the receipt suites reuse (G-05/G-06 + allocations).
export const treasuryAccounts = new AccountService(audit);
export const receipts = new ReceiptService(audit, new SettlementCore(audit, posting, numbering));
export const allocations = new AllocationService(audit);

// PHASE-007/009/010 surfaces the sales suite reuses.
export const sPosting = posting;
export const sPeriods = new PeriodService(audit);
export const sJournals = new JournalService(audit, posting);
export const sCoa = new CoaService(audit);
export const sGl = new GlQueries();
export const sReconciliation = new ReconciliationService(audit);
export const sOpeningDrafts = new OpeningBalancesService(audit);
export const warehouses = new WarehouseService(audit);
export const openingStock = new OpeningStockService(audit, posting);
export const taxCodes = new TaxCodesService(audit);
export const registrations = new RegistrationService(audit);

export type { Client };

/** Deterministic dates over the fixture timeline (FY2026 of tenant S). */
export const S_OPENING_DATE = "2025-12-31";
export const S_JAN = "2026-01-15";
export const S_FEB = "2026-02-15";
export const S_MAR = "2026-03-10";
export const S_DEC = "2026-12-05";

export interface SalesFixture {
  fiscalYearId: string;
  branchId: string;
  warehouseId: string;
  customerId: string;
  /** A credit-capped customer (limit 10,000 — the BR-001 fixture). */
  limitedCustomerId: string;
  creditTermId: string;
  /** GL accounts: inventory, AR control, revenue, returns, VAT payable, COGS, opening equity, cash GL,
   * commission expense/accrual (PHASE-017 0025 template markers 5250/2150). */
  gl: {
    inventory: string;
    arControl: string;
    salesRevenue: string;
    /** PHASE-017 (0025): labor/service revenue — purpose SERVICE_REVENUE → 4200. */
    serviceRevenue: string;
    salesReturns: string;
    vatPayable: string;
    cogs: string;
    openingEquity: string;
    cashGl: string;
    serviceAccount: string;
    commissionExpense: string;
    commissionAccrual: string;
  };
  taxCodeIds: { standard: string; notSubject: string };
  items: { a: string; b: string; c: string };
  cashAccountId: string;
  /** USD FX rates for the W-2 fixture. */
  rates: { usdInvoice: string; usdGain: string; usdLoss: string };
}

let fixture: SalesFixture | undefined;

/** Boots the suite db + tenant S's full sales substrate (idempotent). */
export async function setupSalesFixture(): Promise<SalesFixture> {
  if (fixture !== undefined) return fixture;
  ensureTestDb();
  const superuser = await superuserClient();
  await seedTenants(superuser as never);
  await superuser.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant S (sales)', 'المستأجر س', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_S],
  );
  await superuser.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'sales-actor@fixture.test', 'Sales Actor', 'x', 'ACTIVE'),
       ($2, 'sales-sales@fixture.test', 'Sales Person', 'x', 'ACTIVE'),
       ($3, 'sales-cashier@fixture.test', 'Sales Cashier', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [S_ACTOR, S_SALES, S_CASHIER],
  );

  const gl: SalesFixture["gl"] = {
    inventory: "",
    arControl: "",
    salesRevenue: "",
    serviceRevenue: "",
    salesReturns: "",
    vatPayable: "",
    cogs: "",
    openingEquity: "",
    cashGl: "",
    serviceAccount: "",
    commissionExpense: "",
    commissionAccrual: "",
  };
  let fiscalYearId = "";
  let branchId = "";
  let warehouseId = "";
  let customerId = "";
  let limitedCustomerId = "";
  let creditTermId = "";
  const taxCodeIds = { standard: "", notSubject: "" };
  const items = { a: "", b: "", c: "" };
  let cashAccountId = "";

  await withTenant(TENANT_S, async () => {
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
    gl.arControl = await mapPurpose("AR_CONTROL", "1130");
    gl.salesRevenue = await mapPurpose("SALES_REVENUE", "4100");
    // PHASE-017 (0025): the template marker on 4200 (migration 0025) makes
    // provisionCoaTemplate map it; the explicit mapPurpose call is the
    // idempotent belt-and-braces (fail-closed findActivePurpose consumers —
    // SalesInvoiceService.post's SERVICE_REVENUE leg — need it mapped).
    gl.serviceRevenue = await mapPurpose("SERVICE_REVENUE", "4200");
    gl.salesReturns = await mapPurpose("SALES_RETURNS", "4110");
    gl.vatPayable = await mapPurpose("VAT_PAYABLE", "2120");
    gl.cogs = await mapPurpose("COGS", "5100");
    gl.openingEquity = await mapPurpose("OPENING_EQUITY", "3100");
    gl.cashGl = (await byCode("1111")).id;
    gl.serviceAccount = (await byCode("5210")).id; // Rent — service lines.
    // PHASE-017 (migration 0025 template markers): the commission accrual
    // journal pair — DR 5250 COMMISSION_EXPENSE · CR 2150 COMMISSION_ACCRUAL
    // at commission-run post time (defensive map; provisionCoaTemplate
    // normally seeds both from the template markers).
    gl.commissionExpense = await mapPurpose("COMMISSION_EXPENSE", "5250");
    gl.commissionAccrual = await mapPurpose("COMMISSION_ACCRUAL", "2150");

    // Fiscal year spanning the whole sales timeline.
    const existingYear = await findFiscalYearByName("FY2026");
    fiscalYearId =
      existingYear?.id ??
      (await sPeriods.createYear(S_ACTOR, { name: "FY2026", startDate: "2026-01-01", endDate: "2026-12-31" })).id;

    // Branch + warehouse.
    const branches = await listBranches(null);
    const mainBranch =
      branches.find((b) => b.code === "MAIN") ??
      (await insertBranch({ code: "MAIN", name: "Main branch", nameAr: "الفرع الرئيسي", address: null }));
    branchId = mainBranch.id;
    const existingWarehouses = await warehouses.list({ limit: 10, activeOnly: false });
    const main =
      existingWarehouses.find((w) => w.code === "S-WH") ??
      (await warehouses.create({
        branchId: mainBranch.id,
        code: "S-WH",
        name: "Sales warehouse",
        nameAr: "مستودع المبيعات",
        inventoryAccountId: null,
        note: null,
        actorId: S_ACTOR,
      }));
    warehouseId = main.id;

    // Customers: the standard one (unlimited credit, NET-30 → BR-026 due
    // dates) + the capped one (limit 10,000 — the BR-001 fixture).
    const terms = await partnersStore.listCreditTerms();
    const net30 =
      terms.find((t) => t.days === 30) ??
      (await partnersStore.insertCreditTerms({
        code: "NET30",
        name: "Net 30",
        nameAr: "٣٠ يومًا",
        days: 30,
        description: null,
      }));
    creditTermId = net30.id;
    const ensureCustomer = async (
      code: string,
      name: string,
      creditLimit: string | null,
      termsId: string | null,
    ) => {
      const existing = await partnersStore.findPartnerByCode(code);
      if (existing !== undefined) return existing.id;
      const created = await partnersStore.insertPartner({
        kind: "CUSTOMER",
        code,
        name,
        nameAr: null,
        taxNumber: null,
        creditLimit,
        creditTermsId: termsId,
        priceListId: null,
      });
      return created.id;
    };
    customerId = await ensureCustomer("S-CUST-01", "شركة النور", null, net30.id);
    limitedCustomerId = await ensureCustomer("S-CUST-LIM", "Capped Customer", "10000.0000", null);

    // Tax registration (SA pack, REGISTERED) + codes.
    if ((await registrations.list()).length === 0) {
      await registrations.upsert({
        countryCode: "SA",
        status: "REGISTERED",
        registrationNumber: "310000000000003",
        effectiveFrom: "2016-01-01",
        effectiveTo: null,
        actorId: S_ACTOR,
        note: "sales fixture registration",
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
          actorId: S_ACTOR,
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
          actorId: S_ACTOR,
        })
      ).id;

    // Items: A (base 100) + B (base 40) — the W-1 seed; C for extra cases.
    const uoms = await itemsStore.listUoms();
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const ensureItem = async (sku: string, basePrice: string | null) => {
      const found = await itemsStore.findItemBySku(sku);
      if (found !== undefined) return found.id;
      const created = await itemsStore.insertItem({
        sku,
        name: `Sales ${sku}`,
        nameAr: null,
        kind: "STOCK",
        uomId: pcs.id,
        categoryId: null,
        taxCodeId: null,
        costingMethod: "WAC",
        trackBatch: false,
        trackSerial: false,
        trackImei: false,
        hasExpiry: false,
        reorderLevel: null,
        reorderQty: null,
        basePrice,
      });
      return created.id;
    };
    items.a = await ensureItem("S-A", "100.000000");
    items.b = await ensureItem("S-B", "40.000000");
    items.c = await ensureItem("S-C", null);

    // Cash account (the G-02 cash leg).
    const existingAccounts = await treasuryAccounts.list({});
    const cash =
      existingAccounts.find((a) => a.name === "Sales cash") ??
      (await treasuryAccounts.open({
        name: "Sales cash",
        nameAr: "صندوق المبيعات",
        type: "CASH",
        accountId: gl.cashGl,
        branchId: null,
        currencyCode: "SAR",
        actorId: S_ACTOR,
      }));
    cashAccountId = cash.id;

    // USD exchange rates (the W-2 fixture): 3.7500 at invoice, 3.7600
    // (gain) / 3.7400 (loss) at receipt — dated rows, latest-on-or-before
    // wins (CURRENCY_AND_PRECISION §5).
    const accountingStore = await import("../../modules/accounting/infrastructure/accounting.store");
    await accountingStore.upsertExchangeRate({
      currencyCode: "USD",
      rateDate: "2026-01-01",
      rate: "3.75000000",
      source: "MANUAL",
    });
    await accountingStore.upsertExchangeRate({
      currencyCode: "USD",
      rateDate: "2026-02-20",
      rate: "3.76000000",
      source: "MANUAL",
    });
    await accountingStore.upsertExchangeRate({
      currencyCode: "USD",
      rateDate: "2026-03-20",
      rate: "3.74000000",
      source: "MANUAL",
    });
  });

  // Opening stock drafts (superuser): A ×200 @ 60.0000 + B ×100 @ 25.0000 —
  // the W-1 seed (same single-lot WAC: 60 / 25), sized for the shared-db
  // suite: every spec file in the sequential singleFork run draws from this
  // one lot (PHASE-017 added the automotive/distribution packs — the
  // original ×20/×10 depleted before the sales files ran). Stock asserts
  // are delta-based, never absolute, so the size is invisible to goldens.
  await superuser.query(
    `INSERT INTO opening_balance_docs (id, tenant_id, kind, item_id, qty, unit_cost, currency_code, status)
     VALUES
       ('cacacaca-0000-4000-8000-0000000000a1', $1, 'STOCK', $2, 200, 60.000000, 'SAR', 'DRAFT'),
       ('cacacaca-0000-4000-8000-0000000000b1', $1, 'STOCK', $3, 100, 25.000000, 'SAR', 'DRAFT')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_S, items.a, items.b],
  );
  await superuser.end();

  await withTenant(TENANT_S, async () => {
    await openingStock.post({ warehouseId, actorId: S_ACTOR });
  });

  fixture = {
    fiscalYearId,
    branchId,
    warehouseId,
    customerId,
    limitedCustomerId,
    creditTermId,
    gl,
    taxCodeIds,
    items,
    cashAccountId,
    rates: { usdInvoice: "3.75000000", usdGain: "3.76000000", usdLoss: "3.74000000" },
  };
  return fixture;
}

/** The app-role client bound to tenant S (attack-suite ergonomics). */
export async function salesAppClient(): Promise<Client> {
  const client = await appClient();
  await client.query("SELECT set_config('erp.tenant_id', $1, false)", [TENANT_S]);
  return client;
}

/** Superuser client (settings mutations + drift seeding). */
export async function su(): Promise<Client> {
  return superuserClient();
}

/** Set a tenant setting (deterministic probes over the registry defaults).
 * Numbers/booleans must pass through un-quoted so readSetting<T> sees the
 * JSON scalar type (jsonb "0" ≠ "0" — the setting-reader quirk). */
export async function setSalesSetting(key: string, value: string | number | boolean): Promise<void> {
  const suClient = await superuserClient();
  await suClient.query(
    `INSERT INTO tenant_settings (id, tenant_id, key, value)
     VALUES (gen_random_uuid(), $1, $2, $3::jsonb)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [TENANT_S, key, JSON.stringify(value)],
  );
  await suClient.end();
}

/** Remove a tenant setting (restore the registry default). */
export async function clearSalesSetting(key: string): Promise<void> {
  const suClient = await superuserClient();
  await suClient.query(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND key = $2`, [
    TENANT_S,
    key,
  ]);
  await suClient.end();
}

/** A fully-posted NS-tax credit invoice (fast + no VAT) — packs reuse. */
export async function quickPostedInvoice(note: string): Promise<string> {
  const fx = await setupSalesFixture();
  const invoice = await withTenant(TENANT_S, () =>
    salesInvoices.create({
      branchId: fx.branchId,
      customerId: fx.customerId,
      salesRepId: null,
      kind: "CREDIT",
      invoiceDate: S_JAN,
      dueDate: null,
      currencyCode: "SAR",
      exchangeRate: null,
      orderId: null,
      deliveryId: null,
      warehouseId: null,
      cashAccountId: null,
      note,
      noteAr: null,
      actorId: S_SALES,
      lines: [
        {
          itemId: null,
          accountId: fx.gl.serviceAccount,
          deliveryLineId: null,
          description: "quick charge",
          descriptionAr: null,
          qty: "1",
          unitPrice: "10.000000",
          discountAmount: null,
          taxCodeId: fx.taxCodeIds.notSubject,
          batchId: null,
          serialIds: null,
          note: null,
        },
      ],
    }),
  );
  await withTenant(TENANT_S, () => salesInvoices.submit(invoice.id, S_SALES));
  await withTenant(TENANT_S, () => salesInvoices.approve(invoice.id, S_ACTOR, false));
  const posted = await withTenant(TENANT_S, () => salesInvoices.post(invoice.id, S_ACTOR));
  return posted.invoice.id;
}
