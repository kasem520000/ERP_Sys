import type { Client } from "pg";

import {
  appClient,
  ensureTestDb,
  seedTenants,
  superuserClient,
} from "../test-db";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PeriodService } from "../../modules/accounting/application/period-service";
import type { JournalSpec } from "../../modules/accounting/domain/posting-engine/journal-spec";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { RunService } from "../../modules/reporting/application/run-service";
import type { ReportResult, RunContext } from "../../modules/reporting/application/contract";

/**
 * PHASE-013 reporting db-suite fixtures (REPORTING_ARCHITECTURE §1–§8,
 * ACCOUNTING_TESTS §1): real PostgreSQL 16 through the app-role services
 * exactly as production paths run — every journal flows through
 * PostingService.post, every report through RunService + the contract
 * registry, exports through the real FilesService/s3rver stack.
 *
 * Dedicated tenant R (SAR base): the reporting suites own it end to end and
 * the statement goldens pin its exact posted book, so it carries ONLY the
 * four-entry golden journal set below. The as-of suite provisions its own
 * clone tenant (R_ASOF) so its "post after the freeze" timeline can never be
 * perturbed by the other specs' file order (the repo's order-independence
 * discipline — see the PHASE-008 note in the accounting fixtures).
 *
 * Golden journal set (the pinned book, all FY2026 January):
 *   G1 2026-01-01  DR cash 10000            / CR capital 10000
 *   G2 2026-01-15  DR AR 1380 (customer)    / CR sales revenue 1200 / CR VAT payable 180
 *   G3 2026-01-20  DR cash 500              / CR AR 500 (customer)
 *   G4 2026-01-25  DR rent expense 300      / CR cash 300
 * Period debit=credit 12180; AR closes at 880; net income 1200−300=900;
 * assets 11080 = liabilities 180 + equity 10900 (capital 10000 + YTD 900);
 * Δ cash = 10200.
 *
 * All four specs share ONE docId set (fixed uuids → PostingService replays
 * idempotently, INV-013), so re-entry from any beforeAll is a no-op.
 */

/** Dedicated reporting-suite tenant (the golden book). */
export const TENANT_R = "36363636-3636-3636-3636-363636363636";
/** The as-of suite's clone tenant (own posting timeline, own docIds per tenant). */
export const TENANT_R_ASOF = "37373737-3737-3737-3737-373737373737";
/** The acting user for postings/runs/exports. */
export const R_ACTOR = "3f3f3f3f-0000-4000-8000-00000000003f";

/** Fixed INV-013 source keys — idempotent across every re-entry. */
const DOC = {
  capital: "46464646-0000-4000-8000-000000000001",
  sale: "46464646-0000-4000-8000-000000000002",
  collection: "46464646-0000-4000-8000-000000000003",
  rent: "46464646-0000-4000-8000-000000000004",
} as const;

/** The superuser-seeded unbalanced probe entry (exports.spec assertion block). */
export const UNBALANCED_ENTRY_ID = "46464646-0000-4000-8000-00000000d0a1";

const audit = new AuditService(new DrizzleAuditStore());
export const rPosting = new PostingService(audit, new PartnerSubledgerService());
const periods = new PeriodService(audit);

export interface ReportingAccounts {
  cash: string;
  capital: string;
  arControl: string;
  apControl: string;
  salesRevenue: string;
  salesReturns: string;
  vatPayable: string;
  cogs: string;
  inventory: string;
  retainedEarnings: string;
  closing: string;
  fxGain: string;
  fxLoss: string;
  rentExpense: string;
}

export interface ReportingFixture {
  tenantId: string;
  fiscalYearId: string;
  customerId: string;
  accounts: ReportingAccounts;
}

const fixtures = new Map<string, ReportingFixture>();

/** A fresh RunService over a no-op enqueuer (the job path is driven manually). */
export function newRunService(): RunService {
  return new RunService(async () => {});
}

/**
 * The known-permission catalog re-declared from ReportingModule (the run
 * context of the "full grants" actor — same list the unit meta-tests pin).
 */
export const ALL_KNOWN_PERMISSIONS: ReadonlySet<string> = new Set([
  "reporting.reports.run",
  "reporting.reports.export",
  "reporting.templates.manage",
  "reports.financial.tb.read",
  "reports.financial.gl.read",
  "reports.financial.is.read",
  "reports.financial.bs.read",
  "reports.financial.cf.read",
  "reports.financial.close.read",
  "reports.accounting.cost-centers.read",
  "accounting.journals.read",
  "reports.ar.aging.read",
  "reports.ap.aging.read",
  "sales.statements.read",
  "purchasing.statements.read",
  "reports.ar-alloc.read",
  "partners.balances.read",
  "reports.sales.by-item.read",
  "reports.sales.by-customer.read",
  "reports.sales.by-rep.read",
  "reports.sales.by-paymethod.read",
  "reports.sales.pipeline.read",
  "reports.sales.by-branch.read",
  "reports.sales.profitability.read",
  "reports.purchasing.by-supplier.read",
  "reports.purchasing.by-item.read",
  "reports.purchasing.grni.read",
  "purchasing.po.read",
  "reports.purchasing.matching.read",
  "inventory.stock.read",
  "inventory.moves.read",
  "inventory.valuation.read",
  "inventory.batches.read",
  "inventory.counts.read",
  "inventory.serials.read",
  "treasury.cash.read",
  "treasury.receipts.read",
  "treasury.payments.read",
  "treasury.petty.read",
  "treasury.expenses.read",
  "treasury.shifts.read",
  "treasury.bankrec.read",
  "reports.treasury.fx.read",
  "reports.tax.vat-return.read",
  "reports.tax.summary.read",
  "platform.audit.read",
  "platform.users.read",
  "platform.reporting.read",
  "platform.tenants.read",
  // PHASE-018 (0026 seed): the manufacturing report keys
  "manufacturing.costing.read",
  "manufacturing.genealogy.read",
  "manufacturing.qc.manage",
  // PHASE-019 (0027 seed): the CRM services report key
  "crm.contracts.manage",
]);

/** A full-grants RunContext (override permissions for the deny paths). */
export function fullContext(
  tenantId: string = TENANT_R,
  overrides: Partial<RunContext> = {},
): RunContext {
  return {
    tenantId,
    userId: R_ACTOR,
    effectiveBranchIds: null,
    baseCurrency: "SAR",
    permissions: ALL_KNOWN_PERMISSIONS,
    ...overrides,
  };
}

/** The golden-suite tenant (G1 + G2 posted; golden.spec completes the set). */
export async function setupReportingFixture(): Promise<ReportingFixture> {
  return provision(TENANT_R, "Tenant R (reporting)");
}

/** The as-of suite's clone tenant (G1 + G2 posted at setup time). */
export async function setupAsOfFixture(): Promise<ReportingFixture> {
  return provision(TENANT_R_ASOF, "Tenant R-asof (reporting)");
}

async function provision(tenantId: string, name: string): Promise<ReportingFixture> {
  const cached = fixtures.get(tenantId);
  if (cached !== undefined) return cached;

  ensureTestDb();
  const superuser = await superuserClient();
  await seedTenants(superuser as never);
  await superuser.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, $2, 'المستأجر ر', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [tenantId, name],
  );
  await superuser.query(
    `INSERT INTO users (id, email, full_name, password_hash, status)
     VALUES ($1, 'reporting-actor@fixture.test', 'Reporting Actor', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [R_ACTOR],
  );
  await superuser.end();

  const fixture = await withTenant(tenantId, async () => {
    const { provisionCoaTemplate, seedMasterDataBasics, insertAccountPurpose } = await import(
      "../../modules/tenancy/infrastructure/tenancy.store"
    );
    const { findAccountByCode, findActivePurpose } = await import(
      "../../modules/accounting/infrastructure/accounting.store"
    );
    await seedMasterDataBasics();
    await provisionCoaTemplate();

    // The tenant-setup step the template deliberately leaves unmarked
    // (0008 header): CASH → 1111, OPENING_EQUITY → 3100. Everything else
    // (AR/AP control, revenue, returns, VAT, COGS, inventory, RE, CLOSING,
    // FX) resolves through the template's own 1:1 purpose markers.
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
    const accounts: ReportingAccounts = {
      cash: await mapPurpose("CASH", "1111"),
      capital: await mapPurpose("OPENING_EQUITY", "3100"),
      arControl: await mapPurpose("AR_CONTROL", "1130"),
      apControl: await mapPurpose("AP_CONTROL", "2110"),
      salesRevenue: await mapPurpose("SALES_REVENUE", "4100"),
      salesReturns: await mapPurpose("SALES_RETURNS", "4110"),
      vatPayable: await mapPurpose("VAT_PAYABLE", "2120"),
      cogs: await mapPurpose("COGS", "5100"),
      inventory: await mapPurpose("INVENTORY", "1140"),
      retainedEarnings: await mapPurpose("RETAINED_EARNINGS", "3200"),
      closing: await mapPurpose("CLOSING", "3300"),
      fxGain: await mapPurpose("FX_GAIN", "4900"),
      fxLoss: await mapPurpose("FX_LOSS", "5900"),
      rentExpense: (await byCode("5210")).id,
    };

    // FY2026 (idempotent — createYear replays on the existing name).
    const { findFiscalYearByName } = await import(
      "../../modules/accounting/infrastructure/accounting.store"
    );
    const existingYear = await findFiscalYearByName("FY2026");
    const fiscalYearId =
      existingYear?.id ??
      (
        await periods.createYear(R_ACTOR, {
          name: "FY2026",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
        })
      ).id;

    // The AR counterparty (INV-009: control-account lines carry a partner).
    const partnersStore = await import("../../modules/partners/infrastructure/partners.store");
    const existingCustomer = await partnersStore.findPartnerByCode("R-CUST-01");
    const customerId =
      existingCustomer?.id ??
      (
        await partnersStore.insertPartner({
          kind: "CUSTOMER",
          code: "R-CUST-01",
          name: "شركة التقارير",
          nameAr: null,
          taxNumber: null,
          creditLimit: null,
          creditTermsId: null,
          priceListId: null,
        })
      ).id;

    // The first half of the golden set (setup-time posted_at — the as-of
    // freeze point sits safely after these).
    await rPosting.post(capitalSpec(accounts), { postedBy: R_ACTOR });
    await rPosting.post(saleSpec(accounts, customerId), { postedBy: R_ACTOR });

    return { tenantId, fiscalYearId, customerId, accounts };
  });

  fixtures.set(tenantId, fixture);
  return fixture;
}

/** G3 + G4 (collection + rent) — idempotent; posted_at = call time. */
export async function postRemainingGoldenEntries(tenantId: string): Promise<void> {
  const fixture = fixtures.get(tenantId) ?? (await provision(tenantId, `Tenant ${tenantId}`));
  await withTenant(tenantId, async () => {
    await rPosting.post(collectionSpec(fixture.accounts, fixture.customerId), { postedBy: R_ACTOR });
    await rPosting.post(rentSpec(fixture.accounts), { postedBy: R_ACTOR });
  });
}

/** G1 — the capital injection opening the book. */
function capitalSpec(accounts: ReportingAccounts): JournalSpec {
  return {
    source: { docType: "journal_entry", docId: DOC.capital, operation: "post" },
    entryDate: "2026-01-01",
    description: { en: "capital injection", ar: "إيداع رأس المال" },
    currency: "SAR",
    lines: [
      { accountId: accounts.cash, direction: "DEBIT", amount: "10000.0000" },
      { accountId: accounts.capital, direction: "CREDIT", amount: "10000.0000" },
    ],
  };
}

/** G2 — the credit sale (AR 1380 = revenue 1200 + VAT 180). */
function saleSpec(accounts: ReportingAccounts, customerId: string): JournalSpec {
  return {
    source: { docType: "journal_entry", docId: DOC.sale, operation: "post" },
    entryDate: "2026-01-15",
    description: { en: "credit sale", ar: "بيع آجل" },
    currency: "SAR",
    lines: [
      { accountId: accounts.arControl, direction: "DEBIT", amount: "1380.0000", partnerId: customerId },
      { accountId: accounts.salesRevenue, direction: "CREDIT", amount: "1200.0000" },
      { accountId: accounts.vatPayable, direction: "CREDIT", amount: "180.0000" },
    ],
  };
}

/** G3 — the customer collection (cash 500 against AR). */
function collectionSpec(accounts: ReportingAccounts, customerId: string): JournalSpec {
  return {
    source: { docType: "journal_entry", docId: DOC.collection, operation: "post" },
    entryDate: "2026-01-20",
    description: { en: "customer collection", ar: "تحصيل من عميل" },
    currency: "SAR",
    lines: [
      { accountId: accounts.cash, direction: "DEBIT", amount: "500.0000" },
      { accountId: accounts.arControl, direction: "CREDIT", amount: "500.0000", partnerId: customerId },
    ],
  };
}

/** G4 — the rent expense paid in cash. */
function rentSpec(accounts: ReportingAccounts): JournalSpec {
  return {
    source: { docType: "journal_entry", docId: DOC.rent, operation: "post" },
    entryDate: "2026-01-25",
    description: { en: "rent expense", ar: "مصروف إيجار" },
    currency: "SAR",
    lines: [
      { accountId: accounts.rentExpense, direction: "DEBIT", amount: "300.0000" },
      { accountId: accounts.cash, direction: "CREDIT", amount: "300.0000" },
    ],
  };
}

/** Fiscal-period id by name on a tenant (the superuser probe's period). */
export async function findPeriodId(
  tenantId: string,
  yearName: string,
  periodName: string,
): Promise<string> {
  return withTenant(tenantId, async () => {
    const store = await import("../../modules/accounting/infrastructure/accounting.store");
    const year = await store.findFiscalYearByName(yearName);
    if (year === undefined) throw new Error(`fiscal year ${yearName} missing on ${tenantId}`);
    const period = (await store.listPeriods(year.id)).find((row) => row.name === periodName);
    if (period === undefined) throw new Error(`period ${periodName} missing`);
    return period.id;
  });
}

/** A minimal stored-envelope stand-in for cache-only tests. */
export function fakeResult(runId = "018f0000-0000-7000-8000-000000000001"): ReportResult {
  return {
    reportId: "financial.trial-balance",
    contractVersion: 1,
    runId,
    paramsEcho: { dateFrom: "2026-01-01", dateTo: "2026-01-31", locale: "en" },
    columns: [],
    groups: [],
    rows: [],
    totals: [],
    assertions: [{ id: "tb-debits-equal-credits", status: "PASS" }],
    freshness: { computedAt: "2026-02-01T10:00:00.000Z", asOf: null, cacheState: "recomputed" },
    formatting: { baseCurrency: "SAR", numerals: "western", locale: "en" },
  };
}

export async function su(): Promise<Client> {
  return superuserClient();
}

export { withTenant, appClient, superuserClient, ensureTestDb };
export type { Client };
