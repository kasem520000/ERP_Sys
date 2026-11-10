import { Client } from "pg";

import { generateUuidV7 } from "@erp/domain-core";

import { appClient, ensureTestDb, seedTenants, superuserClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import { ReceiveService } from "../../modules/notes/application/receive-service";
import { IssueService } from "../../modules/notes/application/issue-service";
import { CollectionService } from "../../modules/notes/application/collection-service";
import { DishonorService } from "../../modules/notes/application/dishonor-service";
import { EndorsementService } from "../../modules/notes/application/endorsement-service";
import { DiscountService } from "../../modules/notes/application/discount-service";
import { NoteService } from "../../modules/notes/application/note-service";
import { NotesReconciliationService } from "../../modules/notes/application/notes-reconciliation";

/**
 * PHASE-027 wave G notes db-suite fixtures (ACCOUNTING_TESTS §1): real
 * PostgreSQL 16 through the app-role services exactly as production code
 * paths run — every journal flows through PostingService.post (ADR-0007),
 * every register write through the notes services; nothing inserts GL or
 * register rows directly.
 *
 * Dedicated tenant N (SAR base, SA): the accounting/treasury suites own
 * their tenants' exact-code assertions, so notes consumes its own isolated
 * tenant with the onboarding-shaped CoA substrate (provisionCoaTemplate:
 * AR_CONTROL 1130, AP_CONTROL 2110, SALES_REVENUE 4100, COGS 5100,
 * BANK_CHARGES 5240, FX_GAIN 4900, FX_LOSS 5900 + migration 0038's
 * NOTES_RECEIVABLE 1160 / NOTES_PAYABLE 2150 / LATE_FEE_INCOME 4920 /
 * NOTES_DISCOUNT_EXPENSE 5260). A second tenant (the S-04 spoof target)
 * carries a REAL foreign notes world — partner + posted invoice + a
 * received note that genuinely settled the foreign AR item — so the spoof
 * battery distinguishes RLS-scoped lookups from FK leakage.
 *
 * The settle targets are POSTED invoice worlds posted through the REAL
 * PostingService with source {docType:"sales_invoice"|"supplier_invoice",
 * docId, operation:"post"} (the engine's partner-subledger port creates the
 * open items automatically); the invoice register rows ride the module
 * stores' own writers (sales/purchasing) flipped to the full POSTED shape.
 * Specs mint fresh worlds per test via mintPostedSalesInvoice /
 * mintPostedSupplierInvoice (the source-open-item helper) so settle targets
 * are never shared across tests.
 */

export const N_ACTOR = "aaaaaaaa-0000-4000-8000-0000000000ea";
export const N_APPROVER = "aaaaaaaa-0000-4000-8000-0000000000eb";
export const N_FOREIGN_ACTOR = "aaaaaaaa-0000-4000-8000-0000000000ec";
export const TENANT_N = "6e6e6e6e-6e6e-6e6e-6e6e-6e6e6e6e6e6e";
export const TENANT_N_FOREIGN = "70707070-7070-7070-7070-707070707070";

/** Deterministic fixed ids for the FOREIGN tenant's S-04 attack targets. */
export const FOREIGN_FIXTURE_IDS = {
  partner: "f7a7a7a7-0000-4000-8000-000000000001",
  invoice: "f7a7a7a7-0000-4000-8000-000000000002",
} as const;

const audit = new AuditService(new DrizzleAuditStore());
const inbox = new InboxService();
const posting = new PostingService(audit, new PartnerSubledgerService());

export const receive = new ReceiveService(posting, audit);
export const issue = new IssueService(posting, audit);
export const collection = new CollectionService(posting, audit);
export const dishonor = new DishonorService(posting, audit, inbox);
export const endorsement = new EndorsementService(audit);
export const discount = new DiscountService(posting, audit);
export const noteService = new NoteService(audit);
export const notesReconciliation = new NotesReconciliationService(audit, inbox);
export const periods = new PeriodService(audit);
export const nPosting = posting;

export { withTenant, appClient, superuserClient, seedTenants, ensureTestDb, closeDb };
export type { Client };

/** Deterministic dates over the fixture timeline (FY2026 of tenant N). */
export const N_JUN = "2026-06-15";
export const N_JUL = "2026-07-10";
/** A date inside a deliberately LOCKED period (the PERIOD_LOCKED pack). */
export const N_LOCKED_DATE = "2026-03-10";

export interface NotesAccountIds {
  arControl: string;
  apControl: string;
  salesRevenue: string;
  cogs: string;
  notesReceivable: string;
  notesPayable: string;
  lateFeeIncome: string;
  notesDiscountExpense: string;
  bankCharges: string;
  fxGain: string;
  fxLoss: string;
  /** GL accounts behind the treasury bank accounts (posting asserts). */
  bankGl: string;
  usdBankGl: string;
}

export interface NotesPartners {
  customer: { id: string; code: string };
  customerFx: { id: string; code: string };
  supplier: { id: string; code: string };
  supplierFx: { id: string; code: string };
}

export interface NotesFixture {
  fiscalYearId: string;
  /** periodId by period name ("FY2026-01" … "FY2026-12"), all OPEN. */
  periodIds: Record<string, string>;
  branchId: string;
  accountIds: NotesAccountIds;
  partners: NotesPartners;
  /** Treasury bank cash accounts: SAR bank (1121) + USD bank (1122). */
  bank: { sar: string; usd: string };
  invoices: {
    /** POSTED CREDIT sales invoices (the G-24 settle targets). */
    customer: string;
    customerFx: string;
    /** POSTED supplier invoices (the G-27 settle targets). */
    supplier: string;
    supplierFx: string;
  };
  /** The AR/AP open items created by the invoice journals (engine E3 rows). */
  items: {
    customer: string;
    customerFx: string;
    supplier: string;
    supplierFx: string;
  };
  /** The REAL foreign notes world in TENANT_N_FOREIGN (the spoof target). */
  foreign: {
    partnerId: string;
    invoiceId: string;
    /** The open item the foreign note genuinely settled. */
    itemId: string;
    /** The received note (IN_CUSTODY) created by the real receive service. */
    noteId: string;
  };
}

let fixture: NotesFixture | undefined;

/** The booted fixture (fails loudly when the world is not up yet). */
function booted(): NotesFixture {
  if (fixture === undefined) throw new Error("notes fixture not booted");
  return fixture;
}

// -- the source-open-item helper (specs mint fresh settle targets) ----------------

/**
 * Mints a POSTED CREDIT sales invoice + its G-01 journal (real PostingService,
 * source {docType:"sales_invoice", docId, operation:"post"}) and resolves the
 * AR open item the engine's partner-subledger port creates. Runs inside the
 * caller's ambient tenant scope.
 */
export async function mintPostedSalesInvoice(input: {
  partnerId: string;
  amount: string;
  currency: string;
  exchangeRate?: string | null;
  invoiceNo: string;
  invoiceDate: string;
}): Promise<{ invoiceId: string; itemId: string }> {
  const sales = await import("../../modules/sales/infrastructure/sales.store");
  const treasuryStore = await import("../../modules/treasury/infrastructure/treasury.store");
  const id = generateUuidV7();
  const result = await nPosting.post(
    {
      source: { docType: "sales_invoice", docId: id, operation: "post" },
      entryDate: input.invoiceDate,
      description: { en: `Fixture invoice ${input.invoiceNo}`, ar: `فاتورة ${input.invoiceNo}` },
      currency: input.currency,
      exchangeRate: input.exchangeRate ?? undefined,
      lines: [
        { purpose: "AR_CONTROL", direction: "DEBIT", amount: input.amount, partnerId: input.partnerId },
        { purpose: "SALES_REVENUE", direction: "CREDIT", amount: input.amount },
      ],
    },
    { postedBy: N_ACTOR },
  );
  await sales.insertSalesInvoice({
    id,
    branchId: booted().branchId,
    customerId: input.partnerId,
    salesRepId: null,
    kind: "CREDIT",
    invoiceDate: input.invoiceDate,
    dueDate: "2026-07-15",
    currencyCode: input.currency,
    exchangeRate: input.exchangeRate ?? null,
    orderId: null,
    deliveryId: null,
    warehouseId: null,
    cashAccountId: null,
    note: null,
    noteAr: null,
    actorId: N_ACTOR,
    totalNet: input.amount,
    totalTax: "0.0000",
    totalGross: input.amount,
    taxSummary: null,
    creditCheck: null,
    lines: [],
  });
  await sales.updateSalesInvoiceStatus({
    id,
    status: "POSTED",
    actorId: N_ACTOR,
    invoiceNo: input.invoiceNo,
    postingDate: input.invoiceDate,
    postedJournalId: result.journalEntryId,
  });
  const open = await treasuryStore.listOpenItems({
    partnerId: input.partnerId,
    side: "AR",
    openOnly: true,
    limit: 200,
  });
  const item = open.find((row) => row.sourceType === "sales_invoice" && row.sourceId === id);
  if (item === undefined) throw new Error(`minted open item for ${input.invoiceNo} missing`);
  return { invoiceId: id, itemId: item.id };
}

/**
 * Mints a POSTED supplier invoice + its journal (real PostingService, source
 * {docType:"supplier_invoice", …}) and resolves the AP open item. Runs inside
 * the caller's ambient tenant scope.
 */
export async function mintPostedSupplierInvoice(input: {
  partnerId: string;
  amount: string;
  currency: string;
  exchangeRate?: string | null;
  invoiceNo: string;
  internalNo: string;
  invoiceDate: string;
}): Promise<{ invoiceId: string; itemId: string }> {
  const purchasing = await import("../../modules/purchasing/infrastructure/purchasing.store");
  const treasuryStore = await import("../../modules/treasury/infrastructure/treasury.store");
  const created = await purchasing.insertSupplierInvoice({
    branchId: booted().branchId,
    supplierId: input.partnerId,
    invoiceNo: input.invoiceNo,
    invoiceDate: input.invoiceDate,
    dueDate: "2026-07-15",
    currencyCode: input.currency,
    exchangeRate: input.exchangeRate ?? null,
    poId: null,
    totalNet: input.amount,
    totalTax: "0.0000",
    totalGross: input.amount,
    taxSummary: null,
    duplicateWarning: null,
    note: null,
    noteAr: null,
    actorId: N_ACTOR,
    lines: [],
  });
  const result = await nPosting.post(
    {
      source: { docType: "supplier_invoice", docId: created.id, operation: "post" },
      entryDate: input.invoiceDate,
      description: { en: `Fixture supplier invoice ${input.invoiceNo}`, ar: `فاتورة مورد ${input.invoiceNo}` },
      currency: input.currency,
      exchangeRate: input.exchangeRate ?? undefined,
      lines: [
        { purpose: "COGS", direction: "DEBIT", amount: input.amount },
        { purpose: "AP_CONTROL", direction: "CREDIT", amount: input.amount, partnerId: input.partnerId },
      ],
    },
    { postedBy: N_ACTOR },
  );
  await purchasing.updateSupplierInvoiceStatus({
    id: created.id,
    status: "POSTED",
    actorId: N_ACTOR,
    internalNo: input.internalNo,
    postingDate: input.invoiceDate,
    postedJournalId: result.journalEntryId,
  });
  const open = await treasuryStore.listOpenItems({
    partnerId: input.partnerId,
    side: "AP",
    openOnly: true,
    limit: 200,
  });
  const item = open.find((row) => row.sourceType === "supplier_invoice" && row.sourceId === created.id);
  if (item === undefined) throw new Error(`minted open item for ${input.invoiceNo} missing`);
  return { invoiceId: created.id, itemId: item.id };
}

/** Boots the suite db + tenant N's notes substrate (idempotent). */
export async function setupNotesFixture(): Promise<NotesFixture> {
  if (fixture !== undefined) return fixture;
  ensureTestDb();
  const suClient = await superuserClient();
  await seedTenants(suClient as never);
  await suClient.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant N (notes)', 'المستأجر ن', 'SAR', 'SA', 'Asia/Riyadh'),
       ($2, 'Tenant N-foreign (spoof target)', 'المستأجر ن-أجنبي', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_N, TENANT_N_FOREIGN],
  );
  await suClient.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'notes-actor@fixture.test', 'Notes Actor', 'x', 'ACTIVE'),
       ($2, 'notes-approver@fixture.test', 'Notes Approver', 'x', 'ACTIVE'),
       ($3, 'notes-foreign@fixture.test', 'Notes Foreign', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [N_ACTOR, N_APPROVER, N_FOREIGN_ACTOR],
  );
  // The foreign partner (fixed id — the S-04 attack target: it exists in
  // the database but belongs to another tenant, so RLS must render it
  // exactly like an unknown id).
  await suClient.query(
    `INSERT INTO partners (id, tenant_id, kind, code, name, name_ar)
     VALUES ($1, $2, 'CUSTOMER', 'NF-CUST-A', 'Foreign customer', 'عميل أجنبي')
     ON CONFLICT (id) DO NOTHING`,
    [FOREIGN_FIXTURE_IDS.partner, TENANT_N_FOREIGN],
  );
  await suClient.end();

  const accountIds = {} as NotesAccountIds;
  const partners = {} as NotesPartners;
  const bank = { sar: "", usd: "" };
  const periodIds: Record<string, string> = {};
  let fiscalYearId = "";
  let branchId = "";

  await withTenant(TENANT_N, async () => {
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
    const partnersStore = await import("../../modules/partners/infrastructure/partners.store");
    const treasuryStore = await import("../../modules/treasury/infrastructure/treasury.store");
    const { AccountService } = await import("../../modules/treasury/application/account-service");

    await tenancy.seedMasterDataBasics();
    await tenancy.provisionCoaTemplate();
    const byCode = async (code: string): Promise<string> => {
      const account = await accounting.findAccountByCode(code);
      if (account === undefined) throw new Error(`fixture account ${code} missing`);
      return account.id;
    };
    const byPurpose = async (key: string): Promise<string> => {
      const mapping = await accounting.findActivePurpose(key);
      if (mapping === undefined) throw new Error(`fixture purpose ${key} unmapped`);
      return mapping.accountId;
    };
    accountIds.arControl = await byPurpose("AR_CONTROL");
    accountIds.apControl = await byPurpose("AP_CONTROL");
    accountIds.salesRevenue = await byPurpose("SALES_REVENUE");
    accountIds.cogs = await byPurpose("COGS");
    accountIds.notesReceivable = await byPurpose("NOTES_RECEIVABLE");
    accountIds.notesPayable = await byPurpose("NOTES_PAYABLE");
    accountIds.lateFeeIncome = await byPurpose("LATE_FEE_INCOME");
    accountIds.notesDiscountExpense = await byPurpose("NOTES_DISCOUNT_EXPENSE");
    accountIds.bankCharges = await byPurpose("BANK_CHARGES");
    accountIds.fxGain = await byPurpose("FX_GAIN");
    accountIds.fxLoss = await byPurpose("FX_LOSS");
    accountIds.bankGl = await byCode("1121");

    // A dedicated GL account for the USD bank (treasury allows ONE cash
    // account per GL account; the FX money legs need their own so INV-019
    // per-account comparisons stay exact).
    const usdBankAccount = await tenancy.insertAccount({
      code: "1122",
      name: "Bank — USD current account (N)",
      nameAr: "البنك — حساب دولاري (ن)",
      type: "ASSET",
      parentId: await byCode("1120"),
      isPostable: true,
    });
    accountIds.usdBankGl = usdBankAccount.id;

    // Fiscal year spanning the whole notes timeline (June/July goldens; the
    // PERIOD_LOCKED pack locks an early month and restores it).
    const existingYear = await accounting.findFiscalYearByName("FY2026");
    fiscalYearId =
      existingYear?.id ??
      (await periods.createYear(N_ACTOR, { name: "FY2026", startDate: "2026-01-01", endDate: "2026-12-31" })).id;
    for (const period of await accounting.listPeriods(fiscalYearId)) {
      periodIds[period.name] = period.id;
    }

    const branches = await tenancy.listBranches(null);
    const mainBranch =
      branches.find((b) => b.code === "MAIN") ??
      (await tenancy.insertBranch({ code: "MAIN", name: "Main branch", nameAr: "الفرع الرئيسي", address: null }));
    branchId = mainBranch.id;

    const ensurePartner = async (
      key: keyof NotesPartners,
      kind: "CUSTOMER" | "SUPPLIER",
      code: string,
      name: string,
    ): Promise<void> => {
      const existing = await partnersStore.findPartnerByCode(code);
      const partner =
        existing ??
        (await partnersStore.insertPartner({
          kind,
          code,
          name: `${name} (N)`,
          nameAr: `${name} (ن)`,
          taxNumber: null,
          creditLimit: null,
          creditTermsId: null,
          priceListId: null,
        }));
      partners[key] = { id: partner.id, code: partner.code };
    };
    await ensurePartner("customer", "CUSTOMER", "N-CUST-A", "Customer A");
    await ensurePartner("customerFx", "CUSTOMER", "N-CUST-FX", "Customer FX");
    await ensurePartner("supplier", "SUPPLIER", "N-SUPP-A", "Supplier A");
    await ensurePartner("supplierFx", "SUPPLIER", "N-SUPP-FX", "Supplier FX");

    // Treasury bank accounts (the G-25/G-27/discount money legs).
    const accounts = new AccountService(audit);
    const existingBanks = await treasuryStore.listCashAccounts({ type: "BANK" });
    const sarBank =
      existingBanks.find((row) => row.accountId === accountIds.bankGl) ??
      (await accounts.open({
        name: "Bank Current (N)",
        nameAr: "البنك الجاري (ن)",
        type: "BANK",
        accountId: accountIds.bankGl,
        branchId: null,
        currencyCode: "SAR",
        actorId: N_ACTOR,
      }));
    const usdBank =
      existingBanks.find((row) => row.accountId === accountIds.usdBankGl) ??
      (await accounts.open({
        name: "Bank USD Current (N)",
        nameAr: "البنك الدولاري (ن)",
        type: "BANK",
        accountId: accountIds.usdBankGl,
        branchId: null,
        currencyCode: "USD",
        actorId: N_ACTOR,
      }));
    bank.sar = sarBank.id;
    bank.usd = usdBank.id;

    // The four fixture invoice worlds (the golden settle targets). The
    // shell is assigned first so the mint helpers can resolve branchId via
    // booted() while still inside this transaction.
    fixture = {
      fiscalYearId,
      periodIds,
      branchId,
      accountIds,
      partners,
      bank,
      invoices: { customer: "", customerFx: "", supplier: "", supplierFx: "" },
      items: { customer: "", customerFx: "", supplier: "", supplierFx: "" },
      foreign: { partnerId: FOREIGN_FIXTURE_IDS.partner, invoiceId: FOREIGN_FIXTURE_IDS.invoice, itemId: "", noteId: "" },
    };
    const customerWorld = await mintPostedSalesInvoice({
      partnerId: partners.customer.id,
      amount: "1000.0000",
      currency: "SAR",
      invoiceNo: "N-INV-1001",
      invoiceDate: "2026-06-05",
    });
    fixture.invoices.customer = customerWorld.invoiceId;
    fixture.items.customer = customerWorld.itemId;
    const customerFxWorld = await mintPostedSalesInvoice({
      partnerId: partners.customerFx.id,
      amount: "1000.0000",
      currency: "USD",
      exchangeRate: "3.75",
      invoiceNo: "N-INV-1002",
      invoiceDate: "2026-06-05",
    });
    fixture.invoices.customerFx = customerFxWorld.invoiceId;
    fixture.items.customerFx = customerFxWorld.itemId;
    const supplierWorld = await mintPostedSupplierInvoice({
      partnerId: partners.supplier.id,
      amount: "2500.0000",
      currency: "SAR",
      invoiceNo: "N-SUPP-2001",
      internalNo: "N-SUPP-2001",
      invoiceDate: "2026-06-05",
    });
    fixture.invoices.supplier = supplierWorld.invoiceId;
    fixture.items.supplier = supplierWorld.itemId;
    const supplierFxWorld = await mintPostedSupplierInvoice({
      partnerId: partners.supplierFx.id,
      amount: "1000.0000",
      currency: "USD",
      exchangeRate: "3.75",
      invoiceNo: "N-SUPP-2002",
      internalNo: "N-SUPP-2002",
      invoiceDate: "2026-06-05",
    });
    fixture.invoices.supplierFx = supplierFxWorld.invoiceId;
    fixture.items.supplierFx = supplierFxWorld.itemId;
  });

  // -- the REAL foreign world (TENANT_N_FOREIGN — the spoof target) ----------
  await withTenant(TENANT_N_FOREIGN, async () => {
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
    const treasuryStore = await import("../../modules/treasury/infrastructure/treasury.store");
    await tenancy.provisionCoaTemplate();
    const existingYear = await accounting.findFiscalYearByName("FY2026");
    if (existingYear === undefined) {
      await periods.createYear(N_FOREIGN_ACTOR, { name: "FY2026", startDate: "2026-01-01", endDate: "2026-12-31" });
    }
    if ((await tenancy.listBranches(null)).length === 0) {
      await tenancy.insertBranch({ code: "MAIN", name: "Foreign branch", nameAr: "فرع أجنبي", address: null });
    }
    // The foreign G-01 journal + POSTED invoice row (fixed ids)…
    const result = await posting.post(
      {
        source: { docType: "sales_invoice", docId: FOREIGN_FIXTURE_IDS.invoice, operation: "post" },
        entryDate: "2026-06-05",
        description: { en: "Foreign fixture invoice", ar: "فاتورة أجنبية" },
        currency: "SAR",
        lines: [
          { purpose: "AR_CONTROL", direction: "DEBIT", amount: "1000.0000", partnerId: FOREIGN_FIXTURE_IDS.partner },
          { purpose: "SALES_REVENUE", direction: "CREDIT", amount: "1000.0000" },
        ],
      },
      { postedBy: N_FOREIGN_ACTOR },
    );
    const sales = await import("../../modules/sales/infrastructure/sales.store");
    const foreignBranch = (await tenancy.listBranches(null))[0]!;
    await sales.insertSalesInvoice({
      id: FOREIGN_FIXTURE_IDS.invoice,
      branchId: foreignBranch.id,
      customerId: FOREIGN_FIXTURE_IDS.partner,
      salesRepId: null,
      kind: "CREDIT",
      invoiceDate: "2026-06-05",
      dueDate: "2026-07-15",
      currencyCode: "SAR",
      exchangeRate: null,
      orderId: null,
      deliveryId: null,
      warehouseId: null,
      cashAccountId: null,
      note: null,
      noteAr: null,
      actorId: N_FOREIGN_ACTOR,
      totalNet: "1000.0000",
      totalTax: "0.0000",
      totalGross: "1000.0000",
      taxSummary: null,
      creditCheck: null,
      lines: [],
    });
    await sales.updateSalesInvoiceStatus({
      id: FOREIGN_FIXTURE_IDS.invoice,
      status: "POSTED",
      actorId: N_FOREIGN_ACTOR,
      invoiceNo: "NF-INV-3001",
      postingDate: "2026-06-05",
      postedJournalId: result.journalEntryId,
    });
    const open = await treasuryStore.listOpenItems({
      partnerId: FOREIGN_FIXTURE_IDS.partner,
      side: "AR",
      openOnly: true,
      limit: 200,
    });
    const foreignItem = open.find((row) => row.sourceId === FOREIGN_FIXTURE_IDS.invoice);
    if (foreignItem === undefined) throw new Error("foreign fixture open item missing");
    fixture!.foreign.itemId = foreignItem.id;
    // …and a REAL received note settling it (the spoof battery's target).
    const foreignNote = await receive.receiveNote({
      partnerId: FOREIGN_FIXTURE_IDS.partner,
      kind: "CHEQUE",
      number: "NF-CHQ-777",
      issuingBank: "Foreign Bank",
      amount: "1000.0000",
      currency: "SAR",
      issueDate: "2026-06-01",
      maturityDate: "2026-07-01",
      sourceInvoiceId: FOREIGN_FIXTURE_IDS.invoice,
      eventDate: "2026-06-10",
      actorId: N_FOREIGN_ACTOR,
    });
    fixture!.foreign.noteId = foreignNote.id;
  });

  return fixture!;
}

/** Fresh superuser client bound at call time. */
export async function su(): Promise<Client> {
  return superuserClient();
}
