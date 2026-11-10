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
import { BudgetVersionService } from "../../modules/budgeting/application/budget-version-service";
import { BudgetGridService } from "../../modules/budgeting/application/budget-grid-service";
import { ApprovalWorkflow } from "../../modules/budgeting/application/approval-workflow";
import { ConsumptionService } from "../../modules/budgeting/application/consumption-service";
import { ControlGuard } from "../../modules/budgeting/application/control-guard";
import { ImportService } from "../../modules/budgeting/application/import-service";

/**
 * PHASE-028 wave E budgeting db-suite fixtures (ACCOUNTING_TESTS §1): real
 * PostgreSQL 16 through the app-role services exactly as production code
 * paths run — the GL world (actuals) flows through PostingService.post
 * (ADR-0007); every budget register write flows through the budgeting
 * services. The budgeting module itself NEVER posts (DR-004): the
 * negative ledger proof snapshots journal_entries/journal_lines counts
 * before/after the whole budgeting operation set and asserts byte-equal.
 *
 * Dedicated tenant BUD (SAR base, SA): an isolated tenant with the
 * onboarding-shaped CoA substrate (provisionCoaTemplate: AP_CONTROL 2110,
 * COGS 5100 — the budgeted expense account — + a postable operating
 * expense account 5210 for the second grid dimension), FY2026 with 12
 * OPEN periods, a MAIN branch, one cost center, one project. The GL world
 * posts the phase §6 worked example: 750.00 on COGS in period 4 (budget
 * 1,000.00 ⇒ variance −250.00 / −25.00%).
 *
 * A second tenant (BUD-foreign, the S-04 spoof target) carries a REAL
 * foreign budgeting world — fiscal year + period + postable account +
 * cost center + project + branch + a DRAFT budget with lines — so the
 * spoof battery distinguishes RLS-scoped lookups from FK leakage.
 */

export const B_ACTOR = "abababab-0000-4000-8000-0000000000ea";
export const B_APPROVER = "abababab-0000-4000-8000-0000000000eb";
export const B_FOREIGN_ACTOR = "abababab-0000-4000-8000-0000000000ec";
export const TENANT_BUD = "8e8e8e8e-8e8e-8e8e-8e8e-8e8e8e8e8e8e";
export const TENANT_BUD_FOREIGN = "90909090-9090-9090-9090-909090909090";

/** Deterministic fixed ids for the FOREIGN tenant's S-04 attack targets. */
export const FOREIGN_FIXTURE_IDS = {
  fiscalYear: "e8e8e8e8-0000-4000-8000-000000000001",
  period: "e8e8e8e8-0000-4000-8000-000000000002",
  account: "e8e8e8e8-0000-4000-8000-000000000003",
  costCenter: "e8e8e8e8-0000-4000-8000-000000000004",
  project: "e8e8e8e8-0000-4000-8000-000000000005",
  branch: "e8e8e8e8-0000-4000-8000-000000000006",
  budget: "e8e8e8e8-0000-4000-8000-000000000007",
  budgetLine: "e8e8e8e8-0000-4000-8000-000000000008",
} as const;

const audit = new AuditService(new DrizzleAuditStore());
const inbox = new InboxService();
const posting = new PostingService(audit, new PartnerSubledgerService());

export const consumption = new ConsumptionService();
export const grid = new BudgetGridService(audit, consumption);
export const versions = new BudgetVersionService(audit);
export const workflow = new ApprovalWorkflow(audit);
export const guard = new ControlGuard(audit, inbox);
export const imports = new ImportService(audit, grid);
export const periods = new PeriodService(audit);

export { withTenant, appClient, superuserClient, seedTenants, ensureTestDb, closeDb };

/** The GL posting surface (the fixture's own world; budgeting never calls
 * it — the engine-spy proof wraps this instance). */
export const bPosting = posting;
export const bInbox = inbox;

export async function su(): Promise<Client> {
  return superuserClient();
}

export interface BudgetingFixture {
  fiscalYearId: string;
  /** periodId by period name ("FY2026-01" … "FY2026-12"), all OPEN. */
  periodIds: Record<string, string>;
  branchId: string;
  costCenterId: string;
  projectId: string;
  /** COGS 5100 — the worked-example budgeted expense account. */
  cogsAccountId: string;
  /** 5210 — a second postable operating-expense account. */
  opexAccountId: string;
  /** The AP control account (the GL world's counterpart leg). */
  apControlAccountId: string;
  /** The partner on the GL world's AP legs (INV-009(a)). */
  supplierPartnerId: string;
  /** The journal entry ids posted into the GL world (the actuals). */
  postedEntryIds: string[];
}

let fixture: BudgetingFixture | undefined;

function booted(): BudgetingFixture {
  if (fixture === undefined) throw new Error("budgeting fixture not booted");
  return fixture;
}

/**
 * Mint one posted journal into the GL world (real PostingService; a
 * manual-post shape): DR <expense account> <amount> / CR AP_CONTROL
 * <amount> with the partner stamp — the actual side the variance engine
 * reads. The projected-amount signature mirrors the control guard's input.
 */
export async function mintExpenseActual(input: {
  accountId: string;
  amount: string;
  entryDate: string;
  partnerId: string;
  apControlAccountId: string;
  description?: string;
  costCenterId?: string | null;
  projectId?: string | null;
}): Promise<string> {
  const result = await posting.post(
    {
      source: { docType: "journal_entry", docId: generateUuidV7(), operation: "post" },
      entryDate: input.entryDate,
      description: {
        en: input.description ?? "Fixture expense actual",
        ar: input.description ?? "مصروف فعلي (تجهيعة)",
      },
      currency: "SAR",
      lines: [
        {
          accountId: input.accountId,
          direction: "DEBIT",
          amount: input.amount,
          costCenterId: input.costCenterId ?? undefined,
          projectId: input.projectId ?? undefined,
        },
        {
          accountId: input.apControlAccountId,
          direction: "CREDIT",
          amount: input.amount,
          partnerId: input.partnerId,
        },
      ],
    },
    { postedBy: B_ACTOR },
  );
  return result.journalEntryId;
}

/** Boot the budgeting world (idempotent across specs in the suite run). */
export async function setupBudgetingFixture(): Promise<BudgetingFixture> {
  if (fixture !== undefined) return fixture;
  ensureTestDb();
  const suClient = await superuserClient();
  await seedTenants(suClient as never);
  await suClient.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant BUD (budgeting)', 'المستأجر م', 'SAR', 'SA', 'Asia/Riyadh'),
       ($2, 'Tenant BUD-foreign (spoof target)', 'المستأجر م-أجنبي', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_BUD, TENANT_BUD_FOREIGN],
  );
  await suClient.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'budget-actor@fixture.test', 'Budget Actor', 'x', 'ACTIVE'),
       ($2, 'budget-approver@fixture.test', 'Budget Approver', 'x', 'ACTIVE'),
       ($3, 'budget-foreign@fixture.test', 'Budget Foreign', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [B_ACTOR, B_APPROVER, B_FOREIGN_ACTOR],
  );
  await suClient.end();

  const periodIds: Record<string, string> = {};
  let fiscalYearId = "";
  let branchId = "";
  let costCenterId = "";
  let projectId = "";
  let cogsAccountId = "";
  let opexAccountId = "";
  let apControlAccountId = "";
  let supplierPartnerId = "";
  const postedEntryIds: string[] = [];

  await withTenant(TENANT_BUD, async () => {
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
    const partnersStore = await import("../../modules/partners/infrastructure/partners.store");

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
    cogsAccountId = await byPurpose("COGS");
    apControlAccountId = await byPurpose("AP_CONTROL");

    // A second postable operating-expense account (grid dimension variety) —
    // idempotent across spec files (each file re-boots the module-level
    // fixture against the same persistent test database).
    const existingOpex = await accounting.findAccountByCode("5210");
    const opex =
      existingOpex ??
      (await tenancy.insertAccount({
        code: "5210",
        name: "Operating expenses — budget fixture",
        nameAr: "مصاريف تشغيلية — تجهيعة الموازنة",
        type: "EXPENSE",
        parentId: await byCode("5200"),
        isPostable: true,
      }));
    opexAccountId = opex.id;

    // FY2026 with 12 OPEN REGULAR periods (the standard grid — the
    // OPENING/CLOSING system periods stay out of the fixture map).
    const existingYear = await accounting.findFiscalYearByName("FY2026");
    fiscalYearId =
      existingYear?.id ??
      (await periods.createYear(B_ACTOR, { name: "FY2026", startDate: "2026-01-01", endDate: "2026-12-31" })).id;
    for (const period of await accounting.listPeriods(fiscalYearId)) {
      if (period.kind === "REGULAR") {
        periodIds[period.name] = period.id;
      }
    }

    const branches = await tenancy.listBranches(null);
    const mainBranch =
      branches.find((b) => b.code === "MAIN") ??
      (await tenancy.insertBranch({ code: "MAIN", name: "Main branch", nameAr: "الفرع الرئيسي", address: null }));
    branchId = mainBranch.id;

    const existingCostCenters = await accounting.listCostCenters();
    const existingCostCenter = existingCostCenters.find((row) => row.code === "BUD-CC-1");
    costCenterId =
      existingCostCenter?.id ??
      (
        await accounting.insertCostCenter({
          code: "BUD-CC-1",
          name: "Budget cost center 1",
          nameAr: "مركز تكلفة الموازنة 1",
          parentId: null,
        })
      ).id;

    const existingProjects = await accounting.listProjects();
    const existingProject = existingProjects.find((row) => row.code === "BUD-PRJ-1");
    projectId =
      existingProject?.id ??
      (
        await accounting.insertProject({
          code: "BUD-PRJ-1",
          name: "Budget project 1",
          nameAr: "مشروع الموازنة 1",
          parentId: null,
        })
      ).id;

    const existingPartner = await partnersStore.findPartnerByCode("BUD-SUP-A");
    const partner =
      existingPartner ??
      (await partnersStore.insertPartner({
        kind: "SUPPLIER",
        code: "BUD-SUP-A",
        name: "Supplier A (BUD)",
        nameAr: "مورد أ (م)",
        taxNumber: null,
        creditLimit: null,
        creditTermsId: null,
        priceListId: null,
      }));
    supplierPartnerId = partner.id;

    // The GL world (the actuals) — idempotent across spec files: mint only
    // when the tenant carries no journal yet (the dedicated-tenant marker).
    // The phase §6 worked example — 750.00 on COGS in period 4 (budget
    // 1,000.00 ⇒ variance −250.00 / −25.00%), plus one dimension-stamped
    // line for the scope fixtures (a CC-scoped 300.00 in period 2 and a
    // project-stamped 200.00 in period 5 on OPEX).
    const ledgerProbe = await accounting.countJournalEntries();
    if (ledgerProbe === 0) {
      postedEntryIds.push(
        await mintExpenseActual({
          accountId: cogsAccountId,
          amount: "750.0000",
          entryDate: "2026-04-10",
          partnerId: supplierPartnerId,
          apControlAccountId,
          description: "Worked example actual (period 4)",
        }),
        await mintExpenseActual({
          accountId: cogsAccountId,
          amount: "300.0000",
          entryDate: "2026-02-12",
          partnerId: supplierPartnerId,
          apControlAccountId,
          costCenterId,
          description: "CC-scoped actual (period 2)",
        }),
        await mintExpenseActual({
          accountId: opexAccountId,
          amount: "200.0000",
          entryDate: "2026-05-15",
          partnerId: supplierPartnerId,
          apControlAccountId,
          projectId,
          description: "Project-stamped actual (period 5)",
        }),
      );
    }
  });

  // The REAL foreign budgeting world (the S-04 spoof target): its own year,
  // period, account, dimensions, and a DRAFT budget with one line (fixed
  // ids the spoof battery probes; RLS must render them exactly like
  // unknown ids under the own-tenant scope).
  const su2 = await superuserClient();
  await su2.query(
    `INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date) VALUES
       ($1, $2, 'FY2026-F', '2026-01-01', '2026-12-31') ON CONFLICT (id) DO NOTHING`,
    [FOREIGN_FIXTURE_IDS.fiscalYear, TENANT_BUD_FOREIGN],
  );
  await su2.query(
    `INSERT INTO fiscal_periods (id, tenant_id, fiscal_year_id, name, kind, start_date, end_date, status) VALUES
       ($1, $2, $3, 'FY2026-F-01', 'REGULAR', '2026-01-01', '2026-01-31', 'OPEN') ON CONFLICT (id) DO NOTHING`,
    [FOREIGN_FIXTURE_IDS.period, TENANT_BUD_FOREIGN, FOREIGN_FIXTURE_IDS.fiscalYear],
  );
  await su2.query(
    `INSERT INTO accounts (id, tenant_id, code, name, name_ar, type, is_postable) VALUES
       ($1, $2, '5399', 'Foreign expense account', 'حساب مصروف أجنبي', 'EXPENSE', true)
     ON CONFLICT (id) DO NOTHING`,
    [FOREIGN_FIXTURE_IDS.account, TENANT_BUD_FOREIGN],
  );
  await su2.query(
    `INSERT INTO cost_centers (id, tenant_id, code, name, name_ar) VALUES
       ($1, $2, 'FCC-FIX', 'Foreign cost center fixed', 'مركز أجنبي ثابت') ON CONFLICT (id) DO NOTHING`,
    [FOREIGN_FIXTURE_IDS.costCenter, TENANT_BUD_FOREIGN],
  );
  await su2.query(
    `INSERT INTO projects (id, tenant_id, code, name, name_ar) VALUES
       ($1, $2, 'FPRJ-FIX', 'Foreign project fixed', 'مشروع أجنبي ثابت') ON CONFLICT (id) DO NOTHING`,
    [FOREIGN_FIXTURE_IDS.project, TENANT_BUD_FOREIGN],
  );
  await su2.query(
    `INSERT INTO branches (id, tenant_id, code, name, name_ar) VALUES
       ($1, $2, 'FBR-FIX', 'Foreign branch fixed', 'فرع أجنبي ثابت') ON CONFLICT (id) DO NOTHING`,
    [FOREIGN_FIXTURE_IDS.branch, TENANT_BUD_FOREIGN],
  );
  await su2.query(
    `INSERT INTO budgets (id, tenant_id, code, fiscal_year_id, scope, name, name_ar, revision_no, status) VALUES
       ($1, $2, 'BUD-2026-1', $3, 'ACCOUNTS', 'Foreign budget', 'موازنة أجنبية', 1, 'DRAFT') ON CONFLICT (id) DO NOTHING`,
    [FOREIGN_FIXTURE_IDS.budget, TENANT_BUD_FOREIGN, FOREIGN_FIXTURE_IDS.fiscalYear],
  );
  await su2.query(
    `INSERT INTO budget_lines (id, tenant_id, budget_id, fiscal_period_id, account_id, amount) VALUES
       ($1, $2, $3, $4, $5, 1000) ON CONFLICT (id) DO NOTHING`,
    [
      FOREIGN_FIXTURE_IDS.budgetLine,
      TENANT_BUD_FOREIGN,
      FOREIGN_FIXTURE_IDS.budget,
      FOREIGN_FIXTURE_IDS.period,
      FOREIGN_FIXTURE_IDS.account,
    ],
  );
  await su2.end();

  fixture = {
    fiscalYearId,
    periodIds,
    branchId,
    costCenterId,
    projectId,
    cogsAccountId,
    opexAccountId,
    apControlAccountId,
    supplierPartnerId,
    postedEntryIds,
  };
  return fixture;
}

export { booted };
