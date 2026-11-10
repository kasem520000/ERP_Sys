import { Client } from "pg";

import { generateUuidV7 } from "@erp/domain-core";

import { appClient, ensureTestDb, seedTenants, superuserClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { JournalService } from "../../modules/accounting/application/journal-service";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { FxService } from "../../modules/accounting/application/fx-service";
import { GlQueries } from "../../modules/accounting/application/gl-queries";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { OpeningBalancesPostingService } from "../../modules/accounting/application/opening-balances-service";
import { ReconciliationService } from "../../modules/accounting/application/reconciliation-service";
import { CoaService } from "../../modules/accounting/application/coa-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { SettlementCore } from "../../modules/treasury/application/fx-settlement";
import { AccountService } from "../../modules/treasury/application/account-service";
import { AllocationService } from "../../modules/treasury/application/allocation-service";
import { ReceiptService } from "../../modules/treasury/application/receipt-service";
import { PaymentService } from "../../modules/treasury/application/payment-service";
import { PettyCashGuard } from "../../modules/treasury/application/petty-cash-service";
import { TransferService } from "../../modules/treasury/application/transfer-service";
import { ExpenseService } from "../../modules/treasury/application/expense-service";
import { ShiftService } from "../../modules/treasury/application/shift-service";
import { StatementImportService } from "../../modules/treasury/application/statement-import-service";
import { BankRecService } from "../../modules/treasury/application/bank-rec-service";
import { TreasuryReconciliationService } from "../../modules/treasury/application/treasury-reconciliation-service";
import { TaxResolverService } from "../../modules/tax/application/tax-resolver-service";
import { TaxCodesService } from "../../modules/tax/application/codes-service";
import { RegistrationService } from "../../modules/tax/application/registration-service";

/**
 * PHASE-008 treasury db-suite fixtures (ACCOUNTING_TESTS §1): real
 * PostgreSQL 16 through the app-role services exactly as production paths
 * run — every journal flows through PostingEngine.post, every movement
 * through the treasury services, nothing inserts GL rows directly.
 *
 * Dedicated tenant T (SAR base): the PHASE-007 accounting suites own tenant
 * A's exact-code assertions, so treasury consumes its own isolated tenant
 * with the same onboarding-shaped CoA substrate. FY2026 spans the whole
 * test timeline (opening 2025-12-31, receipts Feb–Mar, shifts in October —
 * "today"; December reserved for the PERIOD_LOCKED packs).
 */

export const T_ACTOR = "aaaaaaaa-0000-4000-8000-00000000000a";
export const T_SUPERVISOR = "aaaaaaaa-0000-4000-8000-00000000000b";
export const TENANT_T = "44444444-4444-4444-4444-444444444444";

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const settlement = new SettlementCore(audit, posting, numbering);

export const accounts = new AccountService(audit);
export const allocations = new AllocationService(audit);
export const receipts = new ReceiptService(audit, settlement);
export const pettyCash = new PettyCashGuard(audit);
export const payments = new PaymentService(audit, settlement, pettyCash);
export const transfers = new TransferService(audit, posting, numbering, pettyCash);
export const taxResolver = new TaxResolverService();
export const taxCodes = new TaxCodesService(audit);
export const taxRegistrations = new RegistrationService(audit);
export const expenses = new ExpenseService(audit, posting, numbering, pettyCash, taxResolver);
export const shifts = new ShiftService(audit, posting);
export const statements = new StatementImportService(audit);
export const bankRec = new BankRecService(audit);
export const treasuryReconciliation = new TreasuryReconciliationService(audit);

// PHASE-007 surfaces the treasury suite reuses (settlement target creation).
export const tPosting = posting;
export const tPeriods = new PeriodService(audit);
export const tOpening = new OpeningBalancesPostingService(audit, posting);
export const tReconciliation = new ReconciliationService(audit);
export const tJournals = new JournalService(audit, posting);
export const tCoa = new CoaService(audit);
export const tGl = new GlQueries();
export const tFx = new FxService(audit);

export { withTenant, appClient, superuserClient, seedTenants, ensureTestDb, closeDb };
export type { Client };

/** Deterministic dates over the fixture timeline (FY2026 of tenant T). */
export const T_OPENING_DATE = "2025-12-31";
export const T_FEB = "2026-02-15";
export const T_MAR = "2026-03-10";

export interface TreasuryAccountIds {
  cash: string;
  bank: string;
  petty: string;
  /** GL account ids behind the treasury accounts + posting purposes. */
  glCash: string;
  glBank: string;
  glPetty: string;
  arControl: string;
  apControl: string;
  salesRevenue: string;
  rentExpense: string;
  bankCharges: string;
  fxGain: string;
  fxLoss: string;
  cashDifference: string;
  vatRecoverable: string;
}

export interface TreasuryPartners {
  customerA: { id: string; code: string };
  customerB: { id: string; code: string };
  customerFx: { id: string; code: string };
  supplierA: { id: string; code: string };
  supplierFx: { id: string; code: string };
}

export interface TreasuryFixture {
  fiscalYearId: string;
  accountIds: TreasuryAccountIds;
  partners: TreasuryPartners;
  /** AR/AP open items created by the G-16 opening posting + FX journals. */
  items: {
    customerA: string;
    customerB: string;
    supplierA: string;
    customerFxUsd: string;
    supplierFxUsd: string;
  };
}

let fixture: TreasuryFixture | undefined;

/** PHASE-009 golden extras: the standard-rated code id for the G-11 VAT leg. */
const fixtureExtra: { stdTaxCodeId?: string } = {};

/** Boots the suite db + tenant T's full treasury substrate (idempotent). */
export async function setupTreasuryFixture(): Promise<TreasuryFixture> {
  if (fixture !== undefined) return fixture;
  ensureTestDb();
  const superuser = await superuserClient();
  await seedTenants(superuser as never);
  await superuser.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant T (treasury)', 'المستأجر ت', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_T],
  );
  await superuser.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'treasury-actor@fixture.test', 'Treasury Actor', 'x', 'ACTIVE'),
       ($2, 'treasury-supervisor@fixture.test', 'Treasury Supervisor', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [T_ACTOR, T_SUPERVISOR],
  );
  await superuser.end();

  const accountIds = {} as TreasuryAccountIds;
  const partners = {} as TreasuryPartners;
  const items = {} as TreasuryFixture["items"];
  let fiscalYearId = "";

  await withTenant(TENANT_T, async () => {
    const { provisionCoaTemplate, seedMasterDataBasics, insertAccountPurpose } = await import(
      "../../modules/tenancy/infrastructure/tenancy.store"
    );
    const { findAccountByCode, findActivePurpose, findFiscalYearByName } = await import(
      "../../modules/accounting/infrastructure/accounting.store"
    );
    await seedMasterDataBasics();
    await provisionCoaTemplate();
    // Tenant setup step (the 0008 fail-closed gap): map the purposes the
    // template deliberately leaves unmarked — CASH → 1111, OPENING_EQUITY →
    // 3100, PETTY_CASH → 1112 (treasury), CASH_DIFFERENCE → 5900 (the
    // classical cash-over-short host for BR-021 variance posting).
    for (const [purposeKey, code] of [
      ["CASH", "1111"],
      ["OPENING_EQUITY", "3100"],
      ["PETTY_CASH", "1112"],
      ["CASH_DIFFERENCE", "5900"],
    ] as const) {
      const existing = await findActivePurpose(purposeKey);
      if (existing !== undefined) continue;
      const account = await findAccountByCode(code);
      if (account === undefined) throw new Error(`fixture account ${code} missing`);
      await insertAccountPurpose({
        purposeKey,
        accountId: account.id,
        activeFrom: "2025-12-01",
      });
    }

    // PHASE-009 (G-11 VAT leg): a dedicated VAT input-tax account + purpose
    // mapping, a REGISTERED SA registration, and the standard-rated code the
    // golden posts with.
    let vatInputAccount = await findAccountByCode("1155");
    if (vatInputAccount === undefined) {
      const parent = await findAccountByCode("1150");
      if (parent === undefined) throw new Error("fixture account 1150 missing");
      vatInputAccount = await tCoa.create(T_ACTOR, {
        code: "1155",
        name: "VAT input tax (recoverable)",
        nameAr: "ض.ق.م المدخلات",
        type: "ASSET",
        parentId: parent.id,
        currencyCode: null,
        isGroup: false,
      });
    }
    if ((await findActivePurpose("VAT_RECOVERABLE")) === undefined) {
      await insertAccountPurpose({
        purposeKey: "VAT_RECOVERABLE",
        accountId: vatInputAccount.id,
        activeFrom: "2025-12-01",
      });
    }
    if ((await taxRegistrations.list()).length === 0) {
      await taxRegistrations.upsert({
        countryCode: "SA",
        status: "REGISTERED",
        registrationNumber: "310000000000003",
        effectiveFrom: "2020-01-01",
        effectiveTo: null,
        actorId: T_ACTOR,
        note: "treasury fixture registration",
      });
    }
    let stdTaxCodeId = (await taxCodes.list({ countryCode: "SA" })).find((row) => row.code === "STD")?.id;
    if (stdTaxCodeId === undefined) {
      stdTaxCodeId = (
        await taxCodes.create({
          code: "STD",
          name: "Standard 15%",
          nameAr: "السعر الأساسي ١٥٪",
          countryCode: "SA",
          defaultTreatment: "STANDARD_RATED",
          actorId: T_ACTOR,
        })
      ).id;
    }
    (fixtureExtra as { stdTaxCodeId: string }).stdTaxCodeId = stdTaxCodeId;

    // Fiscal year spanning the whole treasury timeline.
    const existingYear = await findFiscalYearByName("FY2026");
    fiscalYearId =
      existingYear?.id ??
      (await tPeriods.createYear(T_ACTOR, { name: "FY2026", startDate: "2026-01-01", endDate: "2026-12-31" })).id;

    // GL account ids (purpose-mapped where marked, by code otherwise).
    const byPurpose = async (key: string): Promise<string> => {
      const mapping = await findActivePurpose(key);
      if (mapping === undefined) throw new Error(`fixture purpose ${key} unmapped`);
      return mapping.accountId;
    };
    const byCode = async (code: string): Promise<string> => {
      const account = await findAccountByCode(code);
      if (account === undefined) throw new Error(`fixture account ${code} missing`);
      return account.id;
    };
    accountIds.glCash = await byPurpose("CASH");
    accountIds.glBank = await byCode("1121");
    accountIds.glPetty = await byPurpose("PETTY_CASH");
    accountIds.arControl = await byPurpose("AR_CONTROL");
    accountIds.apControl = await byPurpose("AP_CONTROL");
    accountIds.salesRevenue = await byPurpose("SALES_REVENUE");
    accountIds.rentExpense = await byCode("5210");
    accountIds.bankCharges = await byPurpose("BANK_CHARGES");
    accountIds.fxGain = await byPurpose("FX_GAIN");
    accountIds.fxLoss = await byPurpose("FX_LOSS");
    accountIds.cashDifference = await byPurpose("CASH_DIFFERENCE");
    accountIds.vatRecoverable = await byPurpose("VAT_RECOVERABLE");

    // Partners + opening-balance docs (posted once through the G-16 path).
    const partnersStore = await import("../../modules/partners/infrastructure/partners.store");
    const ensurePartner = async (
      key: keyof TreasuryPartners,
      kind: "CUSTOMER" | "SUPPLIER" | "BOTH",
      code: string,
      name: string,
      openingAmount: number | null,
    ): Promise<void> => {
      const existing = await partnersStore.findPartnerByCode(code);
      const partner =
        existing ??
        (await partnersStore.insertPartner({
          kind,
          code,
          name: `${name} (T)`,
          nameAr: `${name} (ت)`,
          taxNumber: null,
          creditLimit: null,
          creditTermsId: null,
          priceListId: null,
        }));
      partners[key] = { id: partner.id, code: partner.code };
      if (openingAmount !== null) {
        await partnersStore.insertOpeningBalanceDoc({
          kind: "PARTNER",
          partnerId: partner.id,
          accountId: null,
          itemId: null,
          qty: null,
          unitCost: null,
          amount: `${openingAmount.toFixed(4)}`,
          currencyCode: "SAR",
          note: "treasury fixture opening",
        });
      }
    };
    await ensurePartner("customerA", "CUSTOMER", "T-CUST-A", "Customer A", 1500);
    await ensurePartner("customerB", "CUSTOMER", "T-CUST-B", "Customer B", 1000);
    await ensurePartner("customerFx", "CUSTOMER", "T-CUST-FX", "Customer FX", null);
    await ensurePartner("supplierA", "SUPPLIER", "T-SUPP-A", "Supplier A", -900);
    await ensurePartner("supplierFx", "SUPPLIER", "T-SUPP-FX", "Supplier FX", null);

    // Post the opening balances (G-16): one entry, per-partner subledger
    // rows — the settleable AR/AP open items of this phase.
    await tOpening.post(T_ACTOR, fiscalYearId);

    // Treasury accounts on the mapped GL accounts (1111/1121/1112).
    const ensureAccount = async (
      name: string,
      type: "CASH" | "BANK" | "PETTY",
      glAccountId: string,
    ): Promise<string> => {
      const existing = await accounts.list({ type });
      const found = existing.find((row) => row.accountId === glAccountId);
      if (found !== undefined) return found.id;
      const created = await accounts.open({
        name,
        nameAr: null,
        type,
        accountId: glAccountId,
        branchId: null,
        currencyCode: "SAR",
        actorId: T_ACTOR,
      });
      return created.id;
    };
    accountIds.cash = await ensureAccount("Main Cash (T)", "CASH", accountIds.glCash);
    accountIds.bank = await ensureAccount("Bank Current (T)", "BANK", accountIds.glBank);
    accountIds.petty = await ensureAccount("Petty Fund (T)", "PETTY", accountIds.glPetty);

    // FX open items (the G-06/G-10 settlement targets): manual FX journals —
    // the invoice surrogate pre-PHASE-012 (DR AR_CONTROL USD 1000 @3.75
    // partner · CR SALES_REVENUE; the AP mirror for payments).
    const journalStore = await import("../../modules/accounting/infrastructure/journal.store");
    const ensureFxItem = async (
      sourceKey: string,
      partnerId: string,
      purpose: "AR_CONTROL" | "AP_CONTROL",
      direction: "DEBIT" | "CREDIT",
    ): Promise<string> => {
      const existingEntry = await journalStore.findEntryBySourceKey("journal_entry", sourceKey, "post");
      if (existingEntry === undefined) {
        const amount = purpose === "AR_CONTROL" ? "1000.0000" : "800.0000";
        await tPosting.post(
          {
            source: { docType: "journal_entry", docId: sourceKey, operation: "post" },
            entryDate: "2026-01-05",
            description: { en: `FX open item ${sourceKey}`, ar: `بند عملة ${sourceKey}` },
            currency: "USD",
            exchangeRate: "3.75000000",
            lines: [
              { purpose, direction, amount, partnerId },
              { purpose: "SALES_REVENUE", direction: direction === "DEBIT" ? "CREDIT" : "DEBIT", amount },
            ],
          },
          { postedBy: T_ACTOR },
        );
      }
      const subledger = await import("../../modules/treasury/infrastructure/treasury.store");
      const openItems = await subledger.listOpenItems({
        partnerId,
        side: purpose === "AR_CONTROL" ? "AR" : "AP",
        openOnly: true,
        limit: 50,
      });
      const item = openItems.find((row) => row.currencyCode === "USD");
      if (item === undefined) throw new Error(`FX open item for ${sourceKey} missing`);
      return item.id;
    };
    // journal_entries.source_id is a UUID column (ADR-0006) — the FX-item
    // source keys are UUIDv7s; deterministic resolution goes through the
    // open-item lookup below, not the source key.
    items.customerFxUsd = await ensureFxItem(
      newDocId(),
      partners.customerFx.id,
      "AR_CONTROL",
      "DEBIT",
    );
    items.supplierFxUsd = await ensureFxItem(
      newDocId(),
      partners.supplierFx.id,
      "AP_CONTROL",
      "CREDIT",
    );

    // Resolve the SAR opening items (per-partner AR/AP subledger rows).
    const subledger = await import("../../modules/treasury/infrastructure/treasury.store");
    const arItems = await subledger.listOpenItems({
      partnerId: partners.customerA.id,
      side: "AR",
      openOnly: true,
      limit: 50,
    });
    items.customerA = arItems[0]?.id ?? "";
    const arItemsB = await subledger.listOpenItems({
      partnerId: partners.customerB.id,
      side: "AR",
      openOnly: true,
      limit: 50,
    });
    items.customerB = arItemsB[0]?.id ?? "";
    const apItems = await subledger.listOpenItems({
      partnerId: partners.supplierA.id,
      side: "AP",
      openOnly: true,
      limit: 50,
    });
    items.supplierA = apItems[0]?.id ?? "";
  });

  fixture = { fiscalYearId, accountIds, partners, items };
  return fixture;
}

/** The standard-rated SA tax code id (the G-11 VAT leg golden). */
export function stdSaTaxCodeId(): string {
  const id = fixtureExtra.stdTaxCodeId;
  if (id === undefined) throw new Error("tax fixture not booted");
  return id;
}

/** Fresh superuser client bound at call time. */
export async function su(): Promise<Client> {
  return superuserClient();
}

export function newDocId(): string {
  return generateUuidV7();
}

/** Zero-residue probe for treasury docs (ACCOUNTING_TESTS §1). */
export async function assertZeroTreasuryResidue(input: {
  docType: "receipt" | "payment" | "expense" | "cash_transfer";
  docId: string;
}): Promise<void> {
  await withTenant(TENANT_T, async () => {
    const journal = await import("../../modules/accounting/infrastructure/journal.store");
    const entry = await journal.findEntryBySourceKey(input.docType, input.docId, "post");
    if (entry !== undefined) {
      throw new Error(`zero-residue violated: entry ${entry.id} exists for ${input.docId}`);
    }
    const store = await import("../../modules/treasury/infrastructure/treasury.store");
    const allAccounts = await store.listCashAccounts({});
    for (const account of allAccounts) {
      const movements = await store.listMovements({ cashAccountId: account.id, limit: 1000 });
      const mine = movements.filter((row) => row.sourceId === input.docId && row.sourceType === input.docType);
      if (mine.length > 0) {
        throw new Error(`zero-residue violated: ${mine.length} movement rows exist for ${input.docId}`);
      }
    }
  });
}
