import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ensureTestDb, superuserClient, appClient } from "../test-db";
import { reloadEnv } from "../../config/env";
import { closeDb } from "../../infra/db/client";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { ResolveEffectiveConfigService } from "../../modules/configuration/application/resolve/resolve-service";
import { ConfigRepository } from "../../modules/configuration/infrastructure/config-repository";
import { TaxResolverService } from "../../modules/tax/application/tax-resolver-service";
import { TaxCodesService } from "../../modules/tax/application/codes-service";
import { RegistrationService } from "../../modules/tax/application/registration-service";
import { AccountService } from "../../modules/treasury/application/account-service";
import { ReceiptService } from "../../modules/treasury/application/receipt-service";
import { SettlementCore } from "../../modules/treasury/application/fx-settlement";
import { SalesInvoiceService } from "../../modules/sales/application/invoices";
import { ContractService } from "../../modules/crm/application/contract-service";
import { BillingRunService } from "../../modules/crm/application/billing-run-service";
import { DeferralService } from "../../modules/crm/application/deferral-service";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import * as accountingStore from "../../modules/accounting/infrastructure/accounting.store";
import * as journal from "../../modules/accounting/infrastructure/journal.store";
import * as crmStore from "../../modules/crm/infrastructure/crm.store";
import * as itemsStore from "../../modules/items/infrastructure/items.store";
import * as partnersStore from "../../modules/partners/infrastructure/partners.store";
import type { Client } from "pg";

/**
 * PHASE-019 T47 db evidence (MASTER-PLAN §1 rows 4–5 DECISION pair + §15
 * deferral golden + §18 lessons 2/3/6): the deferred-revenue chain —
 * receipt (J-RCP) → tagging (J-DEF, the lesson-2 stamps) → the February
 * draft's post firing **J-REL automatically through the contract-billing
 * port inside the posting UoW** (lesson 6: the port is wired on this
 * spec's OWN salesInvoices instance exactly as CrmModule does) → the
 * receipt→invoice allocation (invoice open = gross − released; INV-016 by
 * construction) → DEFERRED_REVENUE back to zero with revenue recognized
 * ONLY in the posting period (never early) → the statement trail (receipt
 * credit → reclass debit → invoice debit → release credit). Plus the
 * partial-release continuation, the policy-OFF link-only control, the
 * DEFERRED_REVENUE-unmapped honest failure (the invoice post SUCCEEDS +
 * critical inbox + the advance stays HELD; the next posting after the
 * mapping is restored releases it), the link-only NEVER-releases pin, and
 * the INV-013 port replay no-op. Lesson 3's verification-by-assertion: the
 * J-REL journal is asserted to EXIST in the same test that posts the
 * invoice.
 *
 * Dedicated tenant 69696969 (SAR; the first-execution family — verified
 * unused). INV-009 (Σ subledger == AR control GL) is asserted at every
 * step.
 */

const TENANT_D = "69696969-6969-6969-6969-696969696969";
const ACTOR = "69696969-0000-4000-8000-0000000006c1";

// -- the service graph (constructed manually — §18 lesson 6) ----------------

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const resolver = new TaxResolverService();
const salesInvoices = new SalesInvoiceService(audit, posting, numbering, resolver);
const resolveConfig = new ResolveEffectiveConfigService(new ConfigRepository());
const contracts = new ContractService(audit, posting, numbering, resolveConfig);
const periods = new PeriodService(audit);
const taxCodes = new TaxCodesService(audit);
const registrations = new RegistrationService(audit);
const treasuryAccounts = new AccountService(audit);
const receipts = new ReceiptService(audit, new SettlementCore(audit, posting, numbering));
const inbox = new InboxService();
const deferral = new DeferralService(audit, posting, inbox);
const billingRuns = new BillingRunService(audit, salesInvoices, contracts, resolveConfig);

// §18 lesson 6: the port wired on the spec's OWN instance — the CrmModule
// constructor's exact wiring — or the release never fires under test.
salesInvoices.setContractBillingPort({
  validateContract: async (contractId: string) =>
    (await crmStore.findContractById(contractId)) !== undefined,
  onContractInvoicePosted: (contractId: string, invoiceId: string, actorId: string | null) =>
    deferral.onContractInvoicePosted(contractId, invoiceId, actorId),
});

// -- fixture ids (resolved in beforeAll) --------------------------------------

let PARTNER = "";
let CASE01 = "";
let FEE_RET = "";
let FEE_PLAIN = "";
let CASH_ACCOUNT = "";
let GL_CASH = "";
let GL_DEFERRED = "";
let GL_SERVICE_REVENUE = "";

// sequential state
let D1 = ""; // the §15 deferral golden contract (Feb post → J-REL)
let D2 = ""; // the partial-release chain (FEE-PLAIN, no VAT)
let D3 = ""; // the policy-OFF link-only control
let D4 = ""; // the unmapped honest-failure chain
let R1 = ""; // the §15 receipt (500 on-account 2025-12-15)
let R2 = ""; // the partial chain's receipt (600)
let R3 = ""; // the link-only receipt (300)
let R4 = ""; // the unmapped chain's receipt (400)
let FEB_INVOICE = "";
let D1_ADVANCE = ""; // the 500 advance (RELEASED by the Feb post)
let D2_ADVANCE = ""; // the 600 advance (partial → continuation)
let D3_ADVANCE = ""; // the link-only advance (NEVER releases)
let D4_ADVANCE = ""; // the unmapped-failure advance (released after restore)

// -- helpers -------------------------------------------------------------------

/** The tenant-scoped app client (RLS world) for read assertions. */
async function dClient(): Promise<Client> {
  const client = await appClient();
  await client.query("SELECT set_config('erp.tenant_id', $1, false)", [TENANT_D]);
  return client;
}

/** The setting-reader fingerprint helper (T46's setSetting — updated_at bump). */
async function setSetting(key: string, value: string | boolean): Promise<void> {
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenant_settings (id, tenant_id, key, value)
     VALUES (gen_random_uuid(), $1, $2, $3::jsonb)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [TENANT_D, key, JSON.stringify(value)],
  );
  await su.end();
}

/** INV-009: Σ partner subledger (signed base) == the AR control GL balance. */
async function arTie(): Promise<{ gl: string; subledger: string }> {
  const client = await dClient();
  const result = await client.query<{ gl: string; subledger: string }>(
    `SELECT
       (SELECT COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.amount ELSE -l.amount END), 0)::text
        FROM journal_lines l
        WHERE l.account_id = (SELECT account_id FROM account_purposes
                              WHERE purpose_key = 'AR_CONTROL' AND active_to IS NULL LIMIT 1)) AS gl,
       (SELECT COALESCE(SUM(CASE WHEN s.direction = 'DEBIT' THEN s.base_amount ELSE -s.base_amount END), 0)::text
        FROM partner_subledger_entries s) AS subledger`,
  );
  await client.end();
  return result.rows[0]!;
}

/** A GL account's signed balance (DEBIT positive). */
async function balanceOf(accountId: string): Promise<string> {
  const client = await dClient();
  const result = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE -amount END), 0)::text AS total
     FROM journal_lines WHERE account_id = $1`,
    [accountId],
  );
  await client.end();
  return result.rows[0]!.total;
}

/** The partner's AR subledger rows in insertion order (the statement trail). */
async function trailOf(): Promise<{ direction: string; amount: string; sourceType: string }[]> {
  const client = await dClient();
  const result = await client.query<{
    direction: string;
    amount: string;
    source_type: string;
  }>(
    `SELECT direction, amount::text, source_type FROM partner_subledger_entries
     WHERE partner_id = $1 ORDER BY created_at, id`,
    [PARTNER],
  );
  await client.end();
  return result.rows.map((row) => ({ direction: row.direction, amount: row.amount, sourceType: row.source_type }));
}

/** Journal lines as a comparable shape (account code + the §1 stamps). */
async function linesOf(entryId: string) {
  const rows = await withTenant(TENANT_D, () => journal.listLines(entryId));
  return rows.map((row) => ({
    accountCode: row.accountCode,
    direction: row.direction,
    amount: row.amount,
    partnerId: row.partnerId,
    projectId: row.projectId,
  }));
}

/** A posted on-account receipt (no allocations — the full amount stays credit). */
async function seedOnAccountReceipt(
  amount: string,
  valueDate: string,
  description: string,
): Promise<string> {
  const created = await withTenant(TENANT_D, () =>
    receipts.create({
      cashAccountId: CASH_ACCOUNT,
      partnerId: PARTNER,
      method: "CASH",
      payerName: "Client P-000001",
      currencyCode: "SAR",
      amount,
      exchangeRate: null,
      valueDate,
      reference: null,
      description,
      descriptionAr: null,
      actorId: ACTOR,
    }),
  );
  await withTenant(TENANT_D, () => receipts.post(created.id, ACTOR));
  return created.id;
}

/** The run + approve + post of one contract's draft (returns the invoice id). */
async function draftApprovePost(contractId: string, asOf: string): Promise<string> {
  const run = await withTenant(TENANT_D, () => billingRuns.run({ asOf, actorId: ACTOR }));
  const draft = run.draftsCreated.find((row) => row.contractId === contractId);
  expect(draft).toBeDefined();
  await withTenant(TENANT_D, () => salesInvoices.approve(draft!.invoiceId, ACTOR, false));
  await withTenant(TENANT_D, () => salesInvoices.post(draft!.invoiceId, ACTOR));
  return draft!.invoiceId;
}

// -- bootstrap -------------------------------------------------------------------

beforeAll(async () => {
  ensureTestDb();
  reloadEnv();

  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone)
     VALUES ($1, 'Tenant T47D (deferral)', 'المستأجر ت٤٧د', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_D],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status)
     VALUES ($1, 't47-deferral@fixture.test', 'T47 Deferral Actor', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [ACTOR],
  );
  await su.end();

  await withTenant(TENANT_D, async () => {
    const { provisionCoaTemplate, seedMasterDataBasics, insertBranch } = await import(
      "../../modules/tenancy/infrastructure/tenancy.store"
    );
    await seedMasterDataBasics();
    await provisionCoaTemplate(); // AR_CONTROL→1130, DEFERRED_REVENUE→2130, SERVICE_REVENUE→4200, VAT_PAYABLE→2120

    // FY2025 + FY2026: the receipt (2025-12-15), the §15 windows, and
    // today's J-DEF entry dates all need OPEN periods.
    if ((await accountingStore.findFiscalYearByName("FY2025")) === undefined) {
      await periods.createYear(ACTOR, { name: "FY2025", startDate: "2025-01-01", endDate: "2025-12-31" });
    }
    if ((await accountingStore.findFiscalYearByName("FY2026")) === undefined) {
      await periods.createYear(ACTOR, { name: "FY2026", startDate: "2026-01-01", endDate: "2026-12-31" });
    }

    await insertBranch({ code: "MAIN", name: "Main branch", nameAr: "الفرع الرئيسي", address: null });

    if ((await registrations.list()).length === 0) {
      await registrations.upsert({
        countryCode: "SA",
        status: "REGISTERED",
        registrationNumber: "310000000000003",
        effectiveFrom: "2016-01-01",
        effectiveTo: null,
        actorId: ACTOR,
        note: "T47 deferral fixture registration",
      });
    }
    const existingCodes = await taxCodes.list({ countryCode: "SA" });
    const std =
      existingCodes.find((row) => row.code === "STD")?.id ??
      (
        await taxCodes.create({
          code: "STD",
          name: "Standard (SA)",
          nameAr: null,
          countryCode: "SA",
          defaultTreatment: "STANDARD_RATED",
          actorId: ACTOR,
        })
      ).id;

    const terms = await partnersStore.listCreditTerms();
    const net30 = terms.find((t) => t.days === 30) ?? terms[0]!;
    PARTNER = (
      await partnersStore.insertPartner({
        kind: "CUSTOMER",
        code: "P-000001",
        name: "Gulf Advisory Group",
        nameAr: null,
        taxNumber: null,
        creditLimit: null,
        creditTermsId: net30.id,
        priceListId: null,
      })
    ).id;
    CASE01 = (
      await accountingStore.insertProject({ code: "CASE-01", name: "Advisory case 1", nameAr: null, parentId: null })
    ).id;

    // FEE-RET carries the 15% code (the §15 golden's 1150 gross);
    // FEE-PLAIN is tax-free (the partial chain's round 500 gross).
    const uoms = await itemsStore.listUoms();
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    FEE_RET = (
      await itemsStore.insertItem({
        sku: "FEE-RET",
        name: "Retainer fee",
        nameAr: null,
        kind: "SERVICE",
        uomId: pcs.id,
        categoryId: null,
        taxCodeId: std,
        costingMethod: "WAC",
        trackBatch: false,
        trackSerial: false,
        trackImei: false,
        hasExpiry: false,
        reorderLevel: null,
        reorderQty: null,
        basePrice: null,
      })
    ).id;
    FEE_PLAIN = (
      await itemsStore.insertItem({
        sku: "FEE-PLAIN",
        name: "Plain fee",
        nameAr: null,
        kind: "SERVICE",
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
        basePrice: null,
      })
    ).id;

    GL_CASH = (await accountingStore.findAccountByCode("1111"))!.id;
    GL_DEFERRED = (await accountingStore.findAccountByCode("2130"))!.id;
    GL_SERVICE_REVENUE = (await accountingStore.findAccountByCode("4200"))!.id;
    CASH_ACCOUNT = (
      await treasuryAccounts.open({
        name: "T47D main cash",
        nameAr: null,
        type: "CASH",
        accountId: GL_CASH,
        branchId: null,
        currencyCode: "SAR",
        actorId: ACTOR,
      })
    ).id;
  });

  // The §15 deferral-chain contract.
  const created = await withTenant(TENANT_D, () =>
    contracts.create({
      partnerId: PARTNER,
      projectId: CASE01,
      title: "Deferral chain retainer",
      titleAr: null,
      scope: null,
      feeModel: "RETAINER",
      startDate: "2026-01-15",
      endDate: "2026-06-14",
      monthlyAmount: "1000",
      feeItemId: FEE_RET,
      milestones: null,
      currencyCode: null,
      note: "The §15 deferral chain",
      noteAr: null,
      actorId: ACTOR,
    }),
  );
  const activated = await withTenant(TENANT_D, () => contracts.activate(created.contract.id, ACTOR));
  D1 = activated.contract.id;
  expect(activated.contract.status).toBe("ACTIVE");
}, 180_000);

afterAll(async () => {
  await closeDb();
});

// ---------------------------------------------------------------------------

describe("the §15 deferral golden chain — J-RCP → J-DEF → J-INV2 → J-REL", () => {
  it("receipt 500 on-account 2025-12-15 → J-RCP [DR cash 500 · CR AR 500] + the subledger credit row", async () => {
    R1 = await seedOnAccountReceipt("500.0000", "2025-12-15", "Advance funding");
    const entry = await withTenant(TENANT_D, () =>
      journal.findEntryBySourceKey("receipt", R1, "post"),
    );
    expect(entry).toBeDefined();
    expect(await linesOf(entry!.id)).toEqual([
      { accountCode: "1111", direction: "DEBIT", amount: "500.0000", partnerId: null, projectId: null },
      { accountCode: "1130", direction: "CREDIT", amount: "500.0000", partnerId: PARTNER, projectId: null },
    ]);
    expect(await arTie()).toEqual({ gl: "-500.0000", subledger: "-500.0000" });
  });

  it("tag the advance (policy ON) → J-DEF [DR AR 500 (partner, project) · CR DEFERRED 500 (lesson-2 stamps)]", async () => {
    await setSetting("crm.defer_advance_recognition", true);
    const advance = await withTenant(TENANT_D, () =>
      contracts.tagAdvance({
        contractId: D1,
        receiptId: R1,
        amount: "500",
        note: "December advance",
        noteAr: null,
        actorId: ACTOR,
      }),
    );
    D1_ADVANCE = advance.id;
    expect(advance.status).toBe("HELD");
    expect(advance.deferJournalId).not.toBeNull();

    const entry = await withTenant(TENANT_D, () =>
      journal.findEntryBySourceKey("contract_advance", D1_ADVANCE, "defer"),
    );
    expect(entry).toBeDefined();
    // §18 lesson 2: the AR DEBIT line carries partner + projectId; the
    // DEFERRED_REVENUE CREDIT line carries neither.
    expect(await linesOf(entry!.id)).toEqual([
      { accountCode: "1130", direction: "DEBIT", amount: "500.0000", partnerId: PARTNER, projectId: CASE01 },
      { accountCode: "2130", direction: "CREDIT", amount: "500.0000", partnerId: null, projectId: null },
    ]);
    // The liability is up; the AR credit became a reclass debit (INV-009).
    expect(await balanceOf(GL_DEFERRED)).toBe("-500.0000");
    expect(await arTie()).toEqual({ gl: "0.0000", subledger: "0.0000" });
  });

  it("post the February draft → J-INV2 + the port fires J-REL automatically in the posting UoW", async () => {
    // The run drafts Jan + Feb (asOf mid-February).
    const run = await withTenant(TENANT_D, () => billingRuns.run({ asOf: "2026-02-15", actorId: ACTOR }));
    expect(run.draftsCreated.map((draft) => draft.periodKey)).toEqual(["2026-01", "2026-02"]);
    FEB_INVOICE = run.draftsCreated.find((draft) => draft.periodKey === "2026-02")!.invoiceId;

    await withTenant(TENANT_D, () => salesInvoices.approve(FEB_INVOICE, ACTOR, false));
    const posted = await withTenant(TENANT_D, () => salesInvoices.post(FEB_INVOICE, ACTOR));
    expect(posted.invoice.status).toBe("POSTED");

    // J-INV2 [DR AR 1150 (partner, project) · CR SERVICE_REVENUE 1000
    // (project) · CR VAT_PAYABLE 150 (project)].
    const inv = await withTenant(TENANT_D, () =>
      journal.findEntryBySourceKey("sales_invoice", FEB_INVOICE, "post"),
    );
    expect(inv).toBeDefined();
    expect(inv!.entryDate).toBe("2026-02-01");
    expect(await linesOf(inv!.id)).toEqual([
      { accountCode: "1130", direction: "DEBIT", amount: "1150.0000", partnerId: PARTNER, projectId: CASE01 },
      { accountCode: "4200", direction: "CREDIT", amount: "1000.0000", partnerId: null, projectId: CASE01 },
      { accountCode: "2120", direction: "CREDIT", amount: "150.0000", partnerId: null, projectId: CASE01 },
    ]);

    // LESSON 3's verification-by-assertion: the J-REL journal MUST exist —
    // the release fired through the port inside the same posting UoW.
    const rel = await withTenant(TENANT_D, () =>
      journal.findEntryBySourceKey("contract_advance", D1_ADVANCE, "release"),
    );
    expect(rel).toBeDefined();
    expect(rel!.entryDate).toBe("2026-02-01"); // the INVOICE's date — same-period clearing
    // §1 row 5: projectId on BOTH lines; partner on the AR credit.
    expect(await linesOf(rel!.id)).toEqual([
      { accountCode: "2130", direction: "DEBIT", amount: "500.0000", partnerId: null, projectId: CASE01 },
      { accountCode: "1130", direction: "CREDIT", amount: "500.0000", partnerId: PARTNER, projectId: CASE01 },
    ]);

    // The advance is RELEASED + linked.
    const advance = await withTenant(TENANT_D, () => crmStore.findContractAdvanceById(D1_ADVANCE));
    expect(advance!.status).toBe("RELEASED");
    expect(advance!.releasedJournalId).toBe(rel!.id);
    expect(advance!.releasedInvoiceId).toBe(FEB_INVOICE);

    // The receipt→invoice allocation: invoice open = 1150 − 500 = 650;
    // the receipt's allocated_amount is exact (the ar.allocations tie).
    const openItem = await withTenant(TENANT_D, () => crmStore.findInvoiceArOpenItem(FEB_INVOICE));
    expect(openItem).toBeDefined();
    expect(openItem!.amount).toBe("1150.0000");
    expect(openItem!.settledAmount).toBe("500.0000");
    expect(openItem!.outstanding).toBe("650.0000");
    const client = await dClient();
    const allocation = await client.query<{ allocated: string; amount: string; open_item: string }>(
      `SELECT r.allocated_amount::text AS allocated, a.amount::text AS amount, a.open_item_id::text AS open_item
       FROM receipts r LEFT JOIN treasury_allocations a ON a.receipt_id = r.id WHERE r.id = $1`,
      [R1],
    );
    await client.end();
    expect(allocation.rows).toHaveLength(1);
    expect(allocation.rows[0]!.allocated).toBe("500.0000"); // Σ allocations == allocated_amount
    expect(allocation.rows[0]!.amount).toBe("500.0000");
    expect(allocation.rows[0]!.open_item).toBe(openItem!.id);

    // The liability cleared; revenue recognized ONLY in 2026-02 (never
    // early — 2025-12 revenue lines == 0); INV-009 holds after the post.
    expect(await balanceOf(GL_DEFERRED)).toBe("0.0000");
    const revenue2025_12 = await (async () => {
      const client = await dClient();
      const result = await client.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
         WHERE l.account_id = $1 AND e.entry_date BETWEEN '2025-12-01' AND '2025-12-31'`,
        [GL_SERVICE_REVENUE],
      );
      await client.end();
      return result.rows[0]!.n;
    })();
    expect(revenue2025_12).toBe("0");
    expect(await arTie()).toEqual({ gl: "650.0000", subledger: "650.0000" });

    // The statement trail, in order: receipt credit → reclass debit →
    // invoice debit → release credit (§15).
    expect(await trailOf()).toEqual([
      { direction: "CREDIT", amount: "500.0000", sourceType: "receipt" },
      { direction: "DEBIT", amount: "500.0000", sourceType: "contract_advance" },
      { direction: "DEBIT", amount: "1150.0000", sourceType: "sales_invoice" },
      { direction: "CREDIT", amount: "500.0000", sourceType: "contract_advance" },
    ]);
  });

  it("INV-013 replay: re-firing the port for the same invoice is a zero-effect no-op", async () => {
    const beforeJournals = await withTenant(TENANT_D, () =>
      journal.listEntries({ sourceType: "contract_advance", limit: 50 }),
    );
    await withTenant(TENANT_D, () => deferral.onContractInvoicePosted(D1, FEB_INVOICE, ACTOR));
    const afterJournals = await withTenant(TENANT_D, () =>
      journal.listEntries({ sourceType: "contract_advance", limit: 50 }),
    );
    expect(afterJournals.rows).toHaveLength(beforeJournals.rows.length); // zero new journals
    const openItem = await withTenant(TENANT_D, () => crmStore.findInvoiceArOpenItem(FEB_INVOICE));
    expect(openItem!.outstanding).toBe("650.0000"); // no double allocation
    const advance = await withTenant(TENANT_D, () => crmStore.findContractAdvanceById(D1_ADVANCE));
    expect(advance!.status).toBe("RELEASED"); // unchanged
    expect(await arTie()).toEqual({ gl: "650.0000", subledger: "650.0000" });
  });
});

describe("partial release — the continuation advance (§4)", () => {
  it("600 held, invoice 500 → 500 released + 100 continuation HELD; the next post consumes it", async () => {
    // The partial chain contract: FEE-PLAIN (no VAT) → round 500 grosses.
    const created = await withTenant(TENANT_D, () =>
      contracts.create({
        partnerId: PARTNER,
        projectId: CASE01,
        title: "Partial release chain",
        titleAr: null,
        scope: null,
        feeModel: "RETAINER",
        startDate: "2026-04-01",
        endDate: "2026-05-31",
        monthlyAmount: "500",
        feeItemId: FEE_PLAIN,
        milestones: null,
        currencyCode: null,
        note: null,
        noteAr: null,
        actorId: ACTOR,
      }),
    );
    const activated = await withTenant(TENANT_D, () => contracts.activate(created.contract.id, ACTOR));
    D2 = activated.contract.id;

    R2 = await seedOnAccountReceipt("600.0000", "2026-03-20", "Partial chain funding");
    const advance = await withTenant(TENANT_D, () =>
      contracts.tagAdvance({
        contractId: D2,
        receiptId: R2,
        amount: "600",
        note: "Partial chain advance",
        noteAr: null,
        actorId: ACTOR,
      }),
    );
    D2_ADVANCE = advance.id;
    expect(advance.status).toBe("HELD");
    expect(await balanceOf(GL_DEFERRED)).toBe("-600.0000"); // 500 released earlier + 600 deferred

    // The April post: gross 500 → release 500, remainder 100 continues.
    const aprilInvoice = await draftApprovePost(D2, "2026-04-15");
    const april = await withTenant(TENANT_D, () => salesInvoices.find(aprilInvoice));
    expect(april.totalGross).toBe("500.0000");

    const released = await withTenant(TENANT_D, () => crmStore.findContractAdvanceById(D2_ADVANCE));
    expect(released!.status).toBe("RELEASED");

    const d2Advances = await withTenant(TENANT_D, () => crmStore.listContractAdvances(D2));
    expect(d2Advances).toHaveLength(2);
    const continuation = d2Advances.find((row) => row.id !== D2_ADVANCE)!;
    expect(continuation.status).toBe("HELD");
    expect(continuation.amount).toBe("100.0000");
    expect(continuation.receiptId).toBe(R2); // same receipt
    expect(continuation.deferJournalId).toBe(released!.deferJournalId); // same J-DEF anchor

    const aprilOpen = await withTenant(TENANT_D, () => crmStore.findInvoiceArOpenItem(aprilInvoice));
    expect(aprilOpen!.outstanding).toBe("0.0000"); // fully covered by the release
    expect(await balanceOf(GL_DEFERRED)).toBe("-100.0000"); // the continuation's liability
    expect(await arTie()).toMatchObject({ gl: expect.any(String) });
    const tie = await arTie();
    expect(tie.gl).toBe(tie.subledger);

    // The May post consumes the continuation.
    const mayInvoice = await draftApprovePost(D2, "2026-05-15");
    const consumed = await withTenant(TENANT_D, () => crmStore.findContractAdvanceById(continuation.id));
    expect(consumed!.status).toBe("RELEASED");
    expect(consumed!.releasedInvoiceId).toBe(mayInvoice);
    const mayOpen = await withTenant(TENANT_D, () => crmStore.findInvoiceArOpenItem(mayInvoice));
    expect(mayOpen!.outstanding).toBe("400.0000"); // 500 − 100 continuation
    expect(await balanceOf(GL_DEFERRED)).toBe("0.0000"); // fully cleared

    // The receipt is fully allocated (500 + 100 across the two invoices).
    const client = await dClient();
    const receipt = await client.query<{ allocated: string }>(
      `SELECT allocated_amount::text AS allocated FROM receipts WHERE id = $1`,
      [R2],
    );
    await client.end();
    expect(receipt.rows[0]!.allocated).toBe("600.0000");
  });
});

describe("policy OFF — link-only advances never raise the liability, never release", () => {
  it("tag link-only → post → NO J-REL, HELD, plain on-account credit", async () => {
    await setSetting("crm.defer_advance_recognition", false);
    const created = await withTenant(TENANT_D, () =>
      contracts.create({
        partnerId: PARTNER,
        projectId: CASE01,
        title: "Link-only control",
        titleAr: null,
        scope: null,
        feeModel: "RETAINER",
        startDate: "2026-07-01",
        endDate: "2026-07-31",
        monthlyAmount: "300",
        feeItemId: FEE_PLAIN,
        milestones: null,
        currencyCode: null,
        note: null,
        noteAr: null,
        actorId: ACTOR,
      }),
    );
    const activated = await withTenant(TENANT_D, () => contracts.activate(created.contract.id, ACTOR));
    D3 = activated.contract.id;

    R3 = await seedOnAccountReceipt("300.0000", "2026-06-20", "Link-only funding");
    const before = await withTenant(TENANT_D, () =>
      journal.listEntries({ sourceType: "contract_advance", limit: 50 }),
    );
    const advance = await withTenant(TENANT_D, () =>
      contracts.tagAdvance({
        contractId: D3,
        receiptId: R3,
        amount: "300",
        note: "Link-only",
        noteAr: null,
        actorId: ACTOR,
      }),
    );
    D3_ADVANCE = advance.id;
    expect(advance.status).toBe("HELD");
    expect(advance.deferJournalId).toBeNull(); // link-only — no J-DEF
    const after = await withTenant(TENANT_D, () =>
      journal.listEntries({ sourceType: "contract_advance", limit: 50 }),
    );
    expect(after.rows).toHaveLength(before.rows.length); // ZERO journals

    // Post D3's July invoice: the port fires but finds no deferrable
    // advance — NO J-REL, the credit stays a plain on-account balance.
    const julyInvoice = await draftApprovePost(D3, "2026-08-01");
    const stillHeld = await withTenant(TENANT_D, () => crmStore.findContractAdvanceById(D3_ADVANCE));
    expect(stillHeld!.status).toBe("HELD");
    expect(stillHeld!.releasedJournalId).toBeNull();
    const releaseEntry = await withTenant(TENANT_D, () =>
      journal.findEntryBySourceKey("contract_advance", D3_ADVANCE, "release"),
    );
    expect(releaseEntry).toBeUndefined(); // NEVER released
    const julyOpen = await withTenant(TENANT_D, () => crmStore.findInvoiceArOpenItem(julyInvoice));
    expect(julyOpen!.outstanding).toBe("300.0000"); // no allocation
    const client = await dClient();
    const receipt = await client.query<{ allocated: string }>(
      `SELECT allocated_amount::text AS allocated FROM receipts WHERE id = $1`,
      [R3],
    );
    await client.end();
    expect(receipt.rows[0]!.allocated).toBe("0.0000"); // plain on-account credit
  });
});

describe("DEFERRED_REVENUE unmapped at posting — the honest-failure posture", () => {
  it("the invoice post SUCCEEDS + critical inbox + the advance stays HELD; the next posting releases it", async () => {
    await setSetting("crm.defer_advance_recognition", true);
    const created = await withTenant(TENANT_D, () =>
      contracts.create({
        partnerId: PARTNER,
        projectId: CASE01,
        title: "Unmapped chain",
        titleAr: null,
        scope: null,
        feeModel: "RETAINER",
        startDate: "2026-08-01",
        endDate: "2026-09-30",
        monthlyAmount: "400",
        feeItemId: FEE_PLAIN,
        milestones: null,
        currencyCode: null,
        note: null,
        noteAr: null,
        actorId: ACTOR,
      }),
    );
    const activated = await withTenant(TENANT_D, () => contracts.activate(created.contract.id, ACTOR));
    D4 = activated.contract.id;

    R4 = await seedOnAccountReceipt("400.0000", "2026-07-20", "Unmapped chain funding");
    const advance = await withTenant(TENANT_D, () =>
      contracts.tagAdvance({
        contractId: D4,
        receiptId: R4,
        amount: "400",
        note: "Unmapped chain advance",
        noteAr: null,
        actorId: ACTOR,
      }),
    );
    D4_ADVANCE = advance.id;
    expect(advance.deferJournalId).not.toBeNull();

    // Drop the tenant's DEFERRED_REVENUE mapping (the fresh-tenant posture).
    const su = await superuserClient();
    await su.query(`DELETE FROM account_purposes WHERE tenant_id = $1 AND purpose_key = 'DEFERRED_REVENUE'`, [
      TENANT_D,
    ]);
    await su.end();

    // The August post SUCCEEDS — the release failure is contained.
    const run = await withTenant(TENANT_D, () => billingRuns.run({ asOf: "2026-09-15", actorId: ACTOR }));
    const augustDraft = run.draftsCreated.find((row) => row.contractId === D4 && row.periodKey === "2026-08");
    expect(augustDraft).toBeDefined();
    await withTenant(TENANT_D, () => salesInvoices.approve(augustDraft!.invoiceId, ACTOR, false));
    const posted = await withTenant(TENANT_D, () => salesInvoices.post(augustDraft!.invoiceId, ACTOR));
    expect(posted.invoice.status).toBe("POSTED"); // the invoice itself is fine

    // No J-REL landed (the savepoint rolled the failed release back).
    const failedRelease = await withTenant(TENANT_D, () =>
      journal.findEntryBySourceKey("contract_advance", D4_ADVANCE, "release"),
    );
    expect(failedRelease).toBeUndefined();
    const heldAdvance = await withTenant(TENANT_D, () => crmStore.findContractAdvanceById(D4_ADVANCE));
    expect(heldAdvance!.status).toBe("HELD"); // stays HELD

    // The critical crm inbox row + the audit (deduped per advance).
    const client = await dClient();
    const notification = await client.query<{
      severity: string;
      category: string;
      dedupe_key: string;
      body: string;
    }>(
      `SELECT severity, category, dedupe_key, body::text AS body FROM notifications
       WHERE dedupe_key = $1`,
      [`crm-advance-release-failed:${D4_ADVANCE}`],
    );
    await client.end();
    expect(notification.rows).toHaveLength(1);
    expect(notification.rows[0]!.severity).toBe("critical");
    expect(notification.rows[0]!.category).toBe("crm");
    expect(notification.rows[0]!.body).toContain("DEFERRED_REVENUE");
    const failedAudits = await withTenant(TENANT_D, () =>
      audit.list({ action: "crm.advance_release_failed", limit: 10 }),
    );
    expect(failedAudits.some((row) => row.entityId === D4_ADVANCE)).toBe(true);

    // Restore the mapping (order independence) → the September post
    // releases the failed advance (the follow-up).
    const restore = await superuserClient();
    await restore.query(
      `INSERT INTO account_purposes (id, tenant_id, purpose_key, account_id, active_from)
       VALUES (gen_random_uuid(), $1, 'DEFERRED_REVENUE', $2, '2025-12-01')`,
      [TENANT_D, GL_DEFERRED],
    );
    await restore.end();

    const septemberDraft = run.draftsCreated.find(
      (row) => row.contractId === D4 && row.periodKey === "2026-09",
    );
    expect(septemberDraft).toBeDefined();
    await withTenant(TENANT_D, () => salesInvoices.approve(septemberDraft!.invoiceId, ACTOR, false));
    await withTenant(TENANT_D, () => salesInvoices.post(septemberDraft!.invoiceId, ACTOR));

    const release = await withTenant(TENANT_D, () =>
      journal.findEntryBySourceKey("contract_advance", D4_ADVANCE, "release"),
    );
    expect(release).toBeDefined(); // the follow-up release fired
    const releasedAdvance = await withTenant(TENANT_D, () =>
      crmStore.findContractAdvanceById(D4_ADVANCE),
    );
    expect(releasedAdvance!.status).toBe("RELEASED");
    expect(releasedAdvance!.releasedInvoiceId).toBe(septemberDraft!.invoiceId);
    const septemberOpen = await withTenant(TENANT_D, () =>
      crmStore.findInvoiceArOpenItem(septemberDraft!.invoiceId),
    );
    expect(septemberOpen!.outstanding).toBe("0.0000"); // 400 − 400
    expect(await balanceOf(GL_DEFERRED)).toBe("0.0000");

    // The link-only advance NEVER released through all of this.
    const linkOnly = await withTenant(TENANT_D, () => crmStore.findContractAdvanceById(D3_ADVANCE));
    expect(linkOnly!.status).toBe("HELD");
    expect(linkOnly!.releasedJournalId).toBeNull();

    // INV-009 still ties after the whole suite.
    const tie = await arTie();
    expect(tie.gl).toBe(tie.subledger);
  });
});
