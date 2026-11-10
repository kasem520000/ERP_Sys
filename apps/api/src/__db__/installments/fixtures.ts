import { Client } from "pg";

import { appClient, ensureTestDb, seedTenants, superuserClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import { SettlementCore } from "../../modules/treasury/application/fx-settlement";
import { AccountService } from "../../modules/treasury/application/account-service";
import { AllocationService } from "../../modules/treasury/application/allocation-service";
import { ReceiptService } from "../../modules/treasury/application/receipt-service";
import { PlanService } from "../../modules/installments/application/plan-service";
import { InstallmentCollectionService } from "../../modules/installments/application/collection-service";

/**
 * PHASE-027 wave G installments db-suite fixtures (ACCOUNTING_TESTS §1): real
 * PostgreSQL 16 through the app-role services exactly as production code
 * paths run — every G-28 journal flows through PostingService.post, every
 * attribution recompute reads the invoice's posted receipt allocations
 * through the REAL treasury services (receipts posted, never synthesized).
 *
 * Dedicated tenant IN (SAR base, SA) with the same accounts world as the
 * notes suite (the 0038 CoA template purposes + the treasury template). The
 * settle target is a POSTED CREDIT sales invoice of 12,000.00 whose G-01
 * journal rides the real PostingService; an ACTIVE service contract with a
 * billing schedule Σ 12,000 backs the contract-plan source. A second tenant
 * (the S-04 spoof target) carries a REAL foreign plan world — posted
 * invoice + ACTIVE contract + an activated plan with live lines — so the
 * spoof battery distinguishes RLS-scoped lookups from FK leakage.
 */

export const IN_ACTOR = "aaaaaaaa-0000-4000-8000-0000000000ed";
export const IN_FOREIGN_ACTOR = "aaaaaaaa-0000-4000-8000-0000000000ee";
export const TENANT_IN = "71717171-7171-7171-7171-717171717171";
export const TENANT_IN_FOREIGN = "72727272-7272-7272-7272-727272727272";

/** Deterministic fixed ids for the FOREIGN tenant's S-04 attack targets. */
export const IN_FOREIGN_FIXTURE_IDS = {
  partner: "f8b8b8b8-0000-4000-8000-000000000001",
  invoice: "f8b8b8b8-0000-4000-8000-000000000002",
  contract: "f8b8b8b8-0000-4000-8000-000000000003",
} as const;

const audit = new AuditService(new DrizzleAuditStore());
const inbox = new InboxService();
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const settlement = new SettlementCore(audit, posting, numbering);

export const plans = new PlanService(audit);
export const installments = new InstallmentCollectionService(posting, audit, inbox);
export const receipts = new ReceiptService(audit, settlement);
export const treasuryAllocations = new AllocationService(audit);
export const periods = new PeriodService(audit);
export const iPosting = posting;

export { withTenant, appClient, superuserClient, seedTenants, ensureTestDb, closeDb };
export type { Client };

export interface InstallmentsFixture {
  fiscalYearId: string;
  /** periodId by period name ("FY2026-01" … "FY2026-12"), all OPEN. */
  periodIds: Record<string, string>;
  branchId: string;
  accountIds: {
    arControl: string;
    lateFeeIncome: string;
    bankGl: string;
  };
  partnerId: string;
  /** Treasury bank cash account (receipts post against it). */
  bankId: string;
  invoices: {
    /** POSTED CREDIT sales invoice 12,000.00 (the plan source). */
    invoiceId: string;
    /** The invoice's AR open item (the receipts' settle target). */
    itemId: string;
  };
  contract: {
    /** ACTIVE service contract with billing schedule Σ 12,000. */
    contractId: string;
  };
  foreign: {
    partnerId: string;
    invoiceId: string;
    contractId: string;
    /** The activated plan over the foreign invoice (with live lines). */
    planId: string;
    /** The first line of the foreign plan (the waive/charge probe target). */
    lineId: string;
  };
}

let fixture: InstallmentsFixture | undefined;

/** Mints a POSTED CREDIT sales invoice + its G-01 journal (real PostingService). */
export async function mintPostedInvoice(input: {
  partnerId: string;
  amount: string;
  invoiceNo: string;
  invoiceDate: string;
}): Promise<{ invoiceId: string; itemId: string }> {
  const sales = await import("../../modules/sales/infrastructure/sales.store");
  const treasury = await import("../../modules/treasury/infrastructure/treasury.store");
  const { generateUuidV7 } = await import("@erp/domain-core");
  const id = generateUuidV7();
  const result = await iPosting.post(
    {
      source: { docType: "sales_invoice", docId: id, operation: "post" },
      entryDate: input.invoiceDate,
      description: { en: `Fixture invoice ${input.invoiceNo}`, ar: `فاتورة ${input.invoiceNo}` },
      currency: "SAR",
      lines: [
        { purpose: "AR_CONTROL", direction: "DEBIT", amount: input.amount, partnerId: input.partnerId },
        { purpose: "SALES_REVENUE", direction: "CREDIT", amount: input.amount },
      ],
    },
    { postedBy: IN_ACTOR },
  );
  await sales.insertSalesInvoice({
    id,
    branchId: booted().branchId,
    customerId: input.partnerId,
    salesRepId: null,
    kind: "CREDIT",
    invoiceDate: input.invoiceDate,
    dueDate: "2026-07-15",
    currencyCode: "SAR",
    exchangeRate: null,
    orderId: null,
    deliveryId: null,
    warehouseId: null,
    cashAccountId: null,
    note: null,
    noteAr: null,
    actorId: IN_ACTOR,
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
    actorId: IN_ACTOR,
    invoiceNo: input.invoiceNo,
    postingDate: input.invoiceDate,
    postedJournalId: result.journalEntryId,
  });
  const open = await treasury.listOpenItems({ partnerId: input.partnerId, side: "AR", openOnly: true, limit: 200 });
  const item = open.find((row) => row.sourceType === "sales_invoice" && row.sourceId === id);
  if (item === undefined) throw new Error(`minted open item for ${input.invoiceNo} missing`);
  return { invoiceId: id, itemId: item.id };
}

function booted(): InstallmentsFixture {
  if (fixture === undefined) throw new Error("installments fixture not booted");
  return fixture!;
}

/** Boots the suite db + tenant IN's installments substrate (idempotent). */
export async function setupInstallmentsFixture(): Promise<InstallmentsFixture> {
  if (fixture !== undefined) return fixture;
  ensureTestDb();
  const suClient = await superuserClient();
  await seedTenants(suClient as never);
  await suClient.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant IN (installments)', 'المستأجر ق', 'SAR', 'SA', 'Asia/Riyadh'),
       ($2, 'Tenant IN-foreign (spoof target)', 'المستأجر ق-أجنبي', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_IN, TENANT_IN_FOREIGN],
  );
  await suClient.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'installments-actor@fixture.test', 'Installments Actor', 'x', 'ACTIVE'),
       ($2, 'installments-foreign@fixture.test', 'Installments Foreign', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [IN_ACTOR, IN_FOREIGN_ACTOR],
  );
  // The foreign partner (fixed id — the S-04 attack target).
  await suClient.query(
    `INSERT INTO partners (id, tenant_id, kind, code, name, name_ar)
     VALUES ($1, $2, 'CUSTOMER', 'INF-CUST-A', 'Foreign customer', 'عميل أجنبي')
     ON CONFLICT (id) DO NOTHING`,
    [IN_FOREIGN_FIXTURE_IDS.partner, TENANT_IN_FOREIGN],
  );
  await suClient.end();

  const periodIds: Record<string, string> = {};
  let fiscalYearId = "";

  await withTenant(TENANT_IN, async () => {
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
    const partnersStore = await import("../../modules/partners/infrastructure/partners.store");
    const treasuryStore = await import("../../modules/treasury/infrastructure/treasury.store");

    await tenancy.seedMasterDataBasics();
    await tenancy.provisionCoaTemplate();
    const byPurpose = async (key: string): Promise<string> => {
      const mapping = await accounting.findActivePurpose(key);
      if (mapping === undefined) throw new Error(`fixture purpose ${key} unmapped`);
      return mapping.accountId;
    };
    const byCode = async (code: string): Promise<string> => {
      const account = await accounting.findAccountByCode(code);
      if (account === undefined) throw new Error(`fixture account ${code} missing`);
      return account.id;
    };
    const accountIds = {
      arControl: await byPurpose("AR_CONTROL"),
      lateFeeIncome: await byPurpose("LATE_FEE_INCOME"),
      bankGl: await byCode("1121"),
    };

    const existingYear = await accounting.findFiscalYearByName("FY2026");
    fiscalYearId =
      existingYear?.id ??
      (await periods.createYear(IN_ACTOR, { name: "FY2026", startDate: "2026-01-01", endDate: "2026-12-31" })).id;
    for (const period of await accounting.listPeriods(fiscalYearId)) {
      periodIds[period.name] = period.id;
    }

    const branches = await tenancy.listBranches(null);
    const branch =
      branches.find((b) => b.code === "MAIN") ??
      (await tenancy.insertBranch({ code: "MAIN", name: "Main branch", nameAr: "الفرع الرئيسي", address: null }));

    const existingPartner = await partnersStore.findPartnerByCode("IN-CUST-A");
    const partner =
      existingPartner ??
      (await partnersStore.insertPartner({
        kind: "CUSTOMER",
        code: "IN-CUST-A",
        name: "Customer A (IN)",
        nameAr: "عميل أ (ق)",
        taxNumber: null,
        creditLimit: null,
        creditTermsId: null,
        priceListId: null,
      }));

    const accounts = new AccountService(audit);
    const existingBanks = await treasuryStore.listCashAccounts({ type: "BANK" });
    const bank =
      existingBanks.find((row) => row.accountId === accountIds.bankGl) ??
      (await accounts.open({
        name: "Bank Current (IN)",
        nameAr: "البنك الجاري (ق)",
        type: "BANK",
        accountId: accountIds.bankGl,
        branchId: null,
        currencyCode: "SAR",
        actorId: IN_ACTOR,
      }));

    // A SERVICE item (the billing-schedule fee_item FK target), the
    // contract, and its schedule ride superuser inserts (committed
    // immediately — no cross-FK against this transaction's uncommitted rows).
    fixture = {
      fiscalYearId,
      periodIds,
      branchId: branch.id,
      accountIds,
      partnerId: partner.id,
      bankId: bank.id,
      invoices: { invoiceId: "", itemId: "" },
      contract: { contractId: "" },
      foreign: { partnerId: "", invoiceId: "", contractId: "", planId: "", lineId: "" },
    };

    // …the POSTED invoice world (12,000.00)…
    const invoiceWorld = await mintPostedInvoice({
      partnerId: partner.id,
      amount: "12000.0000",
      invoiceNo: "IN-INV-4001",
      invoiceDate: "2026-06-05",
    });
    fixture.invoices.invoiceId = invoiceWorld.invoiceId;
    fixture.invoices.itemId = invoiceWorld.itemId;
  });

  // The ACTIVE service contract with a billing schedule Σ 12,000 — AFTER
  // the tenant scope committed (the superuser connection cannot see the
  // uncommitted uoms the seed inserted inside the transaction above).
  {
    const suC = await superuserClient();
    const hrUom = await suC.query<{ id: string }>(
      `SELECT id FROM uoms WHERE tenant_id = $1 AND code = 'HR' LIMIT 1`,
      [TENANT_IN],
    );
    const itemId = (
      await suC.query<{ id: string }>(
        `INSERT INTO items (id, tenant_id, sku, name, name_ar, kind, uom_id, status)
         VALUES (gen_random_uuid(), $1, 'IN-SVC-HR', 'Consulting hours', 'ساعات استشارية', 'SERVICE', $2, 'ACTIVE')
         RETURNING id`,
        [TENANT_IN, hrUom.rows[0]!.id],
      )
    ).rows[0]!.id;
    const contractId = (
      await suC.query<{ id: string }>(
        `INSERT INTO service_contracts (id, tenant_id, partner_id, title, fee_model,
            start_date, end_date, currency_code, status)
         VALUES (gen_random_uuid(), $1, $2, 'Maintenance retainer (IN)', 'RETAINER',
           '2026-06-01', '2026-12-31', 'SAR', 'ACTIVE')
         RETURNING id`,
        [TENANT_IN, fixture!.partnerId],
      )
    ).rows[0]!.id;
    await suC.query(
      `INSERT INTO contract_billing_schedule (id, tenant_id, contract_id, entry_type,
          bill_date, amount, fee_item_id, status)
       VALUES (gen_random_uuid(), $1, $2, 'RETAINER_PERIOD', '2026-07-01', 6000, $3, 'PLANNED'),
              (gen_random_uuid(), $1, $2, 'RETAINER_PERIOD', '2026-10-01', 6000, $3, 'PLANNED')`,
      [TENANT_IN, contractId, itemId],
    );
    await suC.end();
    fixture!.contract.contractId = contractId;
  }

  // -- the REAL foreign plan world (TENANT_IN_FOREIGN — the spoof target) ----
  await withTenant(TENANT_IN_FOREIGN, async () => {
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
    await tenancy.seedMasterDataBasics();
    await tenancy.provisionCoaTemplate();
    const existingYear = await accounting.findFiscalYearByName("FY2026");
    if (existingYear === undefined) {
      await periods.createYear(IN_FOREIGN_ACTOR, { name: "FY2026", startDate: "2026-01-01", endDate: "2026-12-31" });
    }
    if ((await tenancy.listBranches(null)).length === 0) {
      await tenancy.insertBranch({ code: "MAIN", name: "Foreign branch", nameAr: "فرع أجنبي", address: null });
    }
    // The foreign invoice world (fixed id)…
    const result = await posting.post(
      {
        source: { docType: "sales_invoice", docId: IN_FOREIGN_FIXTURE_IDS.invoice, operation: "post" },
        entryDate: "2026-06-05",
        description: { en: "Foreign fixture invoice", ar: "فاتورة أجنبية" },
        currency: "SAR",
        lines: [
          { purpose: "AR_CONTROL", direction: "DEBIT", amount: "12000.0000", partnerId: IN_FOREIGN_FIXTURE_IDS.partner },
          { purpose: "SALES_REVENUE", direction: "CREDIT", amount: "12000.0000" },
        ],
      },
      { postedBy: IN_FOREIGN_ACTOR },
    );
    const sales = await import("../../modules/sales/infrastructure/sales.store");
    const foreignBranch = (await tenancy.listBranches(null))[0]!;
    await sales.insertSalesInvoice({
      id: IN_FOREIGN_FIXTURE_IDS.invoice,
      branchId: foreignBranch.id,
      customerId: IN_FOREIGN_FIXTURE_IDS.partner,
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
      actorId: IN_FOREIGN_ACTOR,
      totalNet: "12000.0000",
      totalTax: "0.0000",
      totalGross: "12000.0000",
      taxSummary: null,
      creditCheck: null,
      lines: [],
    });
    await sales.updateSalesInvoiceStatus({
      id: IN_FOREIGN_FIXTURE_IDS.invoice,
      status: "POSTED",
      actorId: IN_FOREIGN_ACTOR,
      invoiceNo: "INF-INV-5001",
      postingDate: "2026-06-05",
      postedJournalId: result.journalEntryId,
    });
    // The foreign contract world moves BELOW — the superuser connection
    // cannot see this transaction's uncommitted uoms, so it splits out.
  });

  // The foreign contract world (fixed id) — the uoms seed above is now
  // committed and visible to the superuser connection.
  {
    const suC = await superuserClient();
    const hrUom = await suC.query<{ id: string }>(
      `SELECT id FROM uoms WHERE tenant_id = $1 AND code = 'HR' LIMIT 1`,
      [TENANT_IN_FOREIGN],
    );
    const itemId = (
      await suC.query<{ id: string }>(
        `INSERT INTO items (id, tenant_id, sku, name, name_ar, kind, uom_id, status)
         VALUES (gen_random_uuid(), $1, 'INF-SVC-HR', 'Foreign consulting', 'استشارات أجنبية', 'SERVICE', $2, 'ACTIVE')
         RETURNING id`,
        [TENANT_IN_FOREIGN, hrUom.rows[0]!.id],
      )
    ).rows[0]!.id;
    await suC.query(
      `INSERT INTO service_contracts (id, tenant_id, partner_id, title, fee_model,
          start_date, end_date, currency_code, status)
       VALUES ($1, $2, $3, 'Foreign retainer', 'RETAINER', '2026-06-01', '2026-12-31', 'SAR', 'ACTIVE')`,
      [IN_FOREIGN_FIXTURE_IDS.contract, TENANT_IN_FOREIGN, IN_FOREIGN_FIXTURE_IDS.partner],
    );
    await suC.query(
      `INSERT INTO contract_billing_schedule (id, tenant_id, contract_id, entry_type,
          bill_date, amount, fee_item_id, status)
       VALUES (gen_random_uuid(), $1, $2, 'RETAINER_PERIOD', '2026-07-01', 12000, $3, 'PLANNED')`,
      [TENANT_IN_FOREIGN, IN_FOREIGN_FIXTURE_IDS.contract, itemId],
    );
    await suC.end();
  }

  // …and a REAL activated plan over the foreign invoice (with live lines).
  await withTenant(TENANT_IN_FOREIGN, async () => {
    const created = await plans.createPlan({
      sourceType: "sales_invoice",
      sourceId: IN_FOREIGN_FIXTURE_IDS.invoice,
      downPayment: "2000.0000",
      count: 4,
      startDate: "2026-07-01",
      frequency: "MONTHLY",
      actorId: IN_FOREIGN_ACTOR,
    });
    const activated = await plans.activatePlan(created.plan.id, IN_FOREIGN_ACTOR);
    const store = await import("../../modules/installments/infrastructure/installments.store");
    const lines = await store.listLinesByPlan(activated.id);
    fixture!.foreign = {
      partnerId: IN_FOREIGN_FIXTURE_IDS.partner,
      invoiceId: IN_FOREIGN_FIXTURE_IDS.invoice,
      contractId: IN_FOREIGN_FIXTURE_IDS.contract,
      planId: activated.id,
      lineId: lines[0]!.id,
    };
  });

  return fixture!;
}

/** Fresh superuser client bound at call time. */
export async function su(): Promise<Client> {
  return superuserClient();
}
