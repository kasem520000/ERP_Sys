import type { Client } from "pg";

import { generateUuidV7 } from "@erp/domain-core";
import { sql } from "drizzle-orm";

import { appClient, ensureTestDb, superuserClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { ProjectActualsService } from "../../modules/crm/application/project-actuals-service";
import { ProjectBudgetService } from "../../modules/crm/application/project-budget-service";
import { WbsService } from "../../modules/crm/application/wbs-service";

/**
 * PHASE-048 (W-9 — T-05 + T-06 + T-07) — the projects-plane db-suite
 * fixtures (the hr/budgeting precedents): a dedicated tenant PJW with
 * the onboarding-shaped substrate (CoA + FY2026 + periods), the W-9
 * engines' service graph, and the coherent four-leg actuals world the
 * INV-033 reconciliation proves.
 *
 * THE COHERENT WORLD (the plan §4's `projects-budgets-actuals.db.spec`
 * acceptance #3): project P1 carries the four legs —
 *   LABOR  820.3125  = 10h + 2.5h × 65.625000 (the 13,650.0000 monthly
 *                     employer cost ÷ the configured 208 standard hours)
 *   MAT.   500.0000  = the WMS issue move tied by its posting's stamp
 *   SUB  9,000.0000  = the APPROVED certificate's net
 *   OVH    625.0000  = the 1,000.0000 pool × P1's 12.5/20 labor-hours
 *                     share (the LABOR_HOURS driver)
 *   AC   10,945.3125 = exactly the GL project dimension's net carry.
 * The GL side mints through the REAL PostingService (ADR-0007); the
 * substrate rows (employees, the salary structure, the stock move, the
 * 0103 certificates) seed raw — the W-9 engines own the reads, the
 * later waves own the write surfaces.
 */

export const TENANT_PJW = "5a5a5a5a-5a5a-5a5a-5a5a-5a5a5a5a5a5a";
export const PJW_ACTOR = "5a5a5a5a-0000-4000-8000-0000000005a1";

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const periods = new PeriodService(audit);

export const wbs = new WbsService(audit);
export const actuals = new ProjectActualsService();
export const budgets = new ProjectBudgetService(audit, actuals);

export { withTenant, appClient, superuserClient, ensureTestDb, closeDb, posting, periods };

export interface ProjectsFixture {
  /** P1 — the coherent four-leg world (INV-033's green arm). */
  project1Id: string;
  /** P2 — the second project (the cross-project arms + the driver share). */
  project2Id: string;
  /** PB-CLS — the budget-lifecycle closure arm's own project. */
  projectClsId: string;
  /** The WBS tree's task ids on P1 (R/A/B/B1/B2 + the milestone M). */
  tasks: {
    r: string;
    a: string;
    b: string;
    b1: string;
    b2: string;
    m: string;
    /** A leaf on P2 (the cross-project guard's target). */
    foreign: string;
  };
  /** The fee-earner user (employees.user_id — the labor rate's bridge). */
  feeEarnerUserId: string;
  employeeId: string;
  /** The overhead pool account (5210 — the SOURCE register; the
   * allocation postings credit the CLEARING account 5220, never the
   * pool: the pool read stays stable). */
  overheadPoolAccountId: string;
  overheadClearAccountId: string;
  /** A project-cost account the four legs' GL sides debit. */
  projectCostAccountId: string;
  /** The AP control account (the fixture journals' credit side). */
  apControlAccountId: string;
  supplierPartnerId: string;
  feeItemId: string;
  warehouseId: string;
  fiscalYearId: string;
  periodIds: Record<string, string>;
}

const spec: { fixture?: ProjectsFixture } = {};

export function pjw(): ProjectsFixture {
  if (spec.fixture === undefined) throw new Error("projects fixture not booted");
  return spec.fixture;
}

/** Upsert a tenant setting with the fingerprint bump (the resolve cache). */
export async function setPjwSetting(key: string, value: unknown): Promise<void> {
  const su = await superuserClient();
  if (value === null) {
    await su.query(`DELETE FROM tenant_settings WHERE tenant_id = $1 AND key = $2`, [
      TENANT_PJW,
      key,
    ]);
  } else {
    await su.query(
      `INSERT INTO tenant_settings (id, tenant_id, key, value)
       VALUES (gen_random_uuid(), $1, $2, $3::jsonb)
       ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [TENANT_PJW, key, JSON.stringify(value)],
    );
  }
  await su.end();
}

/** Mint one posted journal through the REAL PostingService — the GL
 * world's only writer (ADR-0007). The project stamp lands on the DEBIT
 * line by default; `stampCredit` moves it to the CREDIT side (the
 * reversal shape — a project-stamped credit subtracts from the
 * dimension's net carry). */
export async function mintJournal(input: {
  debitAccountId: string;
  creditAccountId: string;
  amount: string;
  entryDate: string;
  projectId?: string | null;
  partnerId?: string | null;
  stampCredit?: boolean;
  description: string;
}): Promise<string> {
  const stamp = input.projectId ?? undefined;
  const result = await posting.post(
    {
      source: { docType: "journal_entry", docId: generateUuidV7(), operation: "post" },
      entryDate: input.entryDate,
      description: { en: input.description, ar: input.description },
      currency: "SAR",
      lines: [
        {
          accountId: input.debitAccountId,
          direction: "DEBIT",
          amount: input.amount,
          projectId: input.stampCredit === true ? undefined : stamp,
        },
        {
          accountId: input.creditAccountId,
          direction: "CREDIT",
          amount: input.amount,
          partnerId: input.partnerId ?? undefined,
          projectId: input.stampCredit === true ? stamp : undefined,
        },
      ],
    },
    { postedBy: PJW_ACTOR },
  );
  return result.journalEntryId;
}

export async function setupProjectsFixture(): Promise<ProjectsFixture> {
  if (spec.fixture !== undefined) return spec.fixture;
  ensureTestDb();
  let branchId = "";
  let warehouseId = "";
  const suClient = await superuserClient();
  await suClient.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant PJW (projects W-9)', 'المستأجر مشاريع', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_PJW],
  );
  await suClient.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'pjw-actor@fixture.test', 'PJW Actor', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [PJW_ACTOR],
  );
  // The MAIN branch + the warehouse on it (the stock move's substrate)
  // — BOTH on the superuser connection, committed before the tenant
  // scope opens (the ambient transaction's rows are invisible to a
  // second connection; this pair must see each other).
  const branchRow = await suClient.query<{ id: string }>(
    `INSERT INTO branches (id, tenant_id, code, name, name_ar)
     VALUES (gen_random_uuid(), $1, 'MAIN', 'Main branch (PJW)', 'الفرع الرئيسي')
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_PJW],
  );
  branchId = branchRow.rows[0]!.id;
  const warehouseRow = await suClient.query<{ id: string }>(
    `INSERT INTO warehouses (id, tenant_id, branch_id, code, name, name_ar, created_by)
     VALUES (gen_random_uuid(), $1, $2, 'PJW-WH', 'PJW Warehouse', 'مخزن المشاريع', $3)
     ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [TENANT_PJW, branchId, PJW_ACTOR],
  );
  warehouseId = warehouseRow.rows[0]!.id;
  await suClient.end();

  let project1Id = "";
  let project2Id = "";
  let projectClsId = "";
  const tasks: ProjectsFixture["tasks"] = {
    r: "",
    a: "",
    b: "",
    b1: "",
    b2: "",
    m: "",
    foreign: "",
  };
  const feeEarnerUserId = PJW_ACTOR;
  let employeeId = "";
  let overheadPoolAccountId = "";
  let overheadClearAccountId = "";
  let projectCostAccountId = "";
  let apControlAccountId = "";
  let supplierPartnerId = "";
  let feeItemId = "";
  let fiscalYearId = "";
  const periodIds: Record<string, string> = {};

  await withTenant(TENANT_PJW, async () => {
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
    const apControl = await byPurpose("AP_CONTROL");
    apControlAccountId = apControl;
    projectCostAccountId = await byCode("5100"); // COGS — the project-cost debit side

    // The overhead pair: 5210 the pool register, 5220 the allocation
    // clearing (the allocation postings credit 5220 — NEVER the pool:
    // the pool read stays stable across allocations).
    const existingPool = await accounting.findAccountByCode("5210");
    overheadPoolAccountId =
      existingPool?.id ??
      (
        await tenancy.insertAccount({
          code: "5210",
          name: "Overhead pool register",
          nameAr: "سجل تكاليف حملة المشروع",
          type: "EXPENSE",
          parentId: await byCode("5200"),
          isPostable: true,
        })
      ).id;
    const existingClear = await accounting.findAccountByCode("5220");
    overheadClearAccountId =
      existingClear?.id ??
      (
        await tenancy.insertAccount({
          code: "5220",
          name: "Overhead allocation clearing",
          nameAr: "تسوية توزيع الحملة",
          type: "EXPENSE",
          parentId: await byCode("5200"),
          isPostable: true,
        })
      ).id;

    // FY2026 with 12 OPEN REGULAR periods.
    const existingYear = await accounting.findFiscalYearByName("FY2026");
    fiscalYearId =
      existingYear?.id ??
      (await periods.createYear(PJW_ACTOR, { name: "FY2026", startDate: "2026-01-01", endDate: "2026-12-31" })).id;
    for (const period of await accounting.listPeriods(fiscalYearId)) {
      if (period.kind === "REGULAR") periodIds[period.name] = period.id;
    }

    // The projects (the frozen 019 substrate — extended, never replaced).
    const projects = await accounting.listProjects();
    const ensureProject = async (code: string, name: string): Promise<string> => {
      const existing = projects.find((row) => row.code === code);
      if (existing !== undefined) return existing.id;
      return (
        await accounting.insertProject({ code, name, nameAr: null, parentId: null })
      ).id;
    };
    project1Id = await ensureProject("PJW-PRJ-1", "Coherent world project");
    project2Id = await ensureProject("PJW-PRJ-2", "Second project");
    projectClsId = await ensureProject("PJW-PRJ-CLS", "Budget lifecycle project");

    // The supplier partner (the sub agreement's counterparty + the AP legs).
    const existingPartner = await partnersStore.findPartnerByCode("PJW-SUB-A");
    supplierPartnerId =
      existingPartner?.id ??
      (
        await partnersStore.insertPartner({
          kind: "SUPPLIER",
          code: "PJW-SUB-A",
          name: "Subcontractor A (PJW)",
          nameAr: "مقاول الباطن أ",
          taxNumber: null,
          creditLimit: null,
          creditTermsId: null,
          priceListId: null,
        })
      ).id;

    // The SERVICE fee item (the time entries' billing surface) + the HR
    // uom (the time.spec precedent's shape). The uom row lives in the
    // AMBIENT transaction (seedMasterDataBasics just wrote it) — the
    // read goes through the same tenant scope, never a second
    // connection (which could not see the uncommitted row).
    const itemsStore = await import("../../modules/items/infrastructure/items.store");
    const uomRows = await requireTenantContext().tx!.execute<{ id: string }>(
      sql`SELECT id FROM uoms WHERE tenant_id = erp.current_tenant_id() AND code = 'HR' LIMIT 1`,
    );
    const hrUomId = uomRows.rows[0]!.id;
    const existingItem = await itemsStore.findItemBySku("PJW-FEE-HR");
    feeItemId =
      existingItem?.id ??
      (
        await itemsStore.insertItem({
          sku: "PJW-FEE-HR",
          name: "PJW hourly fee",
          nameAr: "أتعاب بالساعة",
          kind: "SERVICE",
          uomId: hrUomId,
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


  });

  // The WBS tree on P1 — the unit spec's hand-computed shape.
  await withTenant(TENANT_PJW, async () => {
    const r = await wbs.createTask({
      projectId: project1Id,
      parentTaskId: null,
      predecessorTaskId: null,
      wbsCode: "R",
      name: "Root",
      nameAr: "الجذر",
      isMilestone: false,
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      weight: null,
      percentComplete: "0.00",
      note: null,
      noteAr: null,
      actorId: PJW_ACTOR,
    });
    const a = await wbs.createTask({
      projectId: project1Id,
      parentTaskId: r.id,
      predecessorTaskId: null,
      wbsCode: "R.A",
      name: "Task A",
      nameAr: "المهمة أ",
      isMilestone: false,
      startDate: "2026-01-01",
      endDate: "2026-06-30",
      weight: "60.0000",
      percentComplete: "50.00",
      note: null,
      noteAr: null,
      actorId: PJW_ACTOR,
    });
    const b = await wbs.createTask({
      projectId: project1Id,
      parentTaskId: r.id,
      predecessorTaskId: null,
      wbsCode: "R.B",
      name: "Task B",
      nameAr: "المهمة ب",
      isMilestone: false,
      startDate: "2026-02-01",
      endDate: "2026-11-30",
      weight: "40.0000",
      percentComplete: "0.00",
      note: null,
      noteAr: null,
      actorId: PJW_ACTOR,
    });
    const b1 = await wbs.createTask({
      projectId: project1Id,
      parentTaskId: b.id,
      predecessorTaskId: a.id,
      wbsCode: "R.B.1",
      name: "Task B1",
      nameAr: "المهمة ب-1",
      isMilestone: false,
      startDate: "2026-02-01",
      endDate: "2026-06-30",
      weight: "30.0000",
      percentComplete: "80.00",
      note: null,
      noteAr: null,
      actorId: PJW_ACTOR,
    });
    const b2 = await wbs.createTask({
      projectId: project1Id,
      parentTaskId: b.id,
      predecessorTaskId: b1.id,
      wbsCode: "R.B.2",
      name: "Task B2",
      nameAr: "المهمة ب-2",
      isMilestone: false,
      startDate: "2026-07-01",
      endDate: "2026-11-30",
      weight: "10.0000",
      percentComplete: "20.00",
      note: null,
      noteAr: null,
      actorId: PJW_ACTOR,
    });
    const m = await wbs.createTask({
      projectId: project1Id,
      parentTaskId: null,
      predecessorTaskId: null,
      wbsCode: "M",
      name: "Milestone M",
      nameAr: "المعلم م",
      isMilestone: true,
      startDate: "2026-06-30",
      endDate: "2026-06-30",
      weight: null,
      percentComplete: "100.00",
      note: null,
      noteAr: null,
      actorId: PJW_ACTOR,
    });
    const foreign = await wbs.createTask({
      projectId: project2Id,
      parentTaskId: null,
      predecessorTaskId: null,
      wbsCode: "P2.1",
      name: "P2 leaf",
      nameAr: "ورقة المشروع الثاني",
      isMilestone: false,
      startDate: null,
      endDate: null,
      weight: null,
      percentComplete: "0.00",
      note: null,
      noteAr: null,
      actorId: PJW_ACTOR,
    });
    tasks.r = r.id;
    tasks.a = a.id;
    tasks.b = b.id;
    tasks.b1 = b1.id;
    tasks.b2 = b2.id;
    tasks.m = m.id;
    tasks.foreign = foreign.id;
  });

  // The employee + the ACTIVE salary structure (the payroll READ-ONLY
  // substrate — D-01): basic 10,000 + FIXED allowance 2,000 + 10% of
  // basic (1,000) + 5% employer contribution on the gross-before-it
  // (13,000 × 5% = 650) = the 13,650.0000 monthly employer cost.
  const suSubstrate = await superuserClient();
  const structure = await suSubstrate.query<{ id: string }>(
    `INSERT INTO salary_structures (id, tenant_id, code, name, name_ar, currency, status, created_by)
     VALUES (gen_random_uuid(), $1, 'PJW-STRUCT', 'PJW Structure', 'هيكل المشاريع', 'SAR', 'ACTIVE', $2)
     ON CONFLICT (tenant_id, code) DO UPDATE SET status = 'ACTIVE'
     RETURNING id`,
    [TENANT_PJW, PJW_ACTOR],
  );
  const structureId = structure.rows[0]!.id;
  const expenseAccountRow = await suSubstrate.query<{ id: string }>(
    `SELECT id FROM accounts WHERE tenant_id = $1 AND code = '5100' LIMIT 1`,
    [TENANT_PJW],
  );
  const expenseAccountId = expenseAccountRow.rows[0]!.id;
  await suSubstrate.query(
    `INSERT INTO salary_components (id, tenant_id, structure_id, key, name, name_ar, kind, calc, amount, rate, gl_account_id, seq)
     VALUES
       (gen_random_uuid(), $1, $2, 'HOUSING', 'Housing allowance', 'بدل سكن', 'ALLOWANCE', 'FIXED', 2000, NULL, $3, 1),
       (gen_random_uuid(), $1, $2, 'TRANSPORT', 'Transport allowance', 'بدل نقل', 'ALLOWANCE', 'PERCENT_OF_BASIC', NULL, 10.0000, $3, 2),
       (gen_random_uuid(), $1, $2, 'GOSI_ER', 'GOSI employer', 'تأمينات (حصة صاحب العمل)', 'EMPLOYER_CONTRIBUTION', 'PERCENT_OF_GROSS', NULL, 5.0000, $3, 3)
     ON CONFLICT (tenant_id, structure_id, key) DO NOTHING`,
    [TENANT_PJW, structureId, expenseAccountId],
  );
  const employee = await suSubstrate.query<{ id: string }>(
    `INSERT INTO employees (id, tenant_id, code, name, name_ar, hire_date, contract_type, basic_salary, salary_structure_id, user_id, created_by)
     VALUES (gen_random_uuid(), $1, 'PJW-EMP-1', 'Lina Al-Muhandisa', 'لينا المهندسة', '2024-01-01', 'FULL_TIME', 10000, $2, $3, $4)
     ON CONFLICT (tenant_id, code) DO UPDATE SET salary_structure_id = EXCLUDED.salary_structure_id, user_id = EXCLUDED.user_id
     RETURNING id`,
    [TENANT_PJW, structureId, PJW_ACTOR, PJW_ACTOR],
  );
  employeeId = employee.rows[0]!.id;
  await suSubstrate.end();

  // The two tenant settings (the BR-055 plane — NO platform defaults):
  // the 208 standard monthly hours + the LABOR_HOURS overhead
  // distributor over the 5210 pool register.
  await setPjwSetting("projects.labor_standard_monthly_hours", 208);
  await setPjwSetting("projects.overhead_distributor", {
    driver: "LABOR_HOURS",
    pool_account_ids: [overheadPoolAccountId],
  });

  spec.fixture = {
    project1Id,
    project2Id,
    projectClsId,
    tasks,
    feeEarnerUserId,
    employeeId,
    overheadPoolAccountId,
    overheadClearAccountId,
    projectCostAccountId,
    apControlAccountId,
    supplierPartnerId,
    feeItemId,
    warehouseId,
    fiscalYearId,
    periodIds,
  };
  return spec.fixture;
}

/** Seed a stock issue move tied to a posted journal (the 044 WMS issue
 * path's read shape: direction OUT, kind issue, the posting carries the
 * project stamp). Through the AMBIENT transaction — the journal was
 * minted inside the same scope and is invisible to a second connection
 * until commit. Raw SQL — the write surfaces are the later waves'. */
export async function seedIssueMove(input: {
  journalEntryId: string;
  valueAmount: string;
  movedAt: string;
}): Promise<string> {
  const fixture = pjw();
  const rows = await requireTenantContext().tx!.execute<{ id: string }>(
    sql`INSERT INTO stock_moves (id, tenant_id, item_id, warehouse_id, direction, move_kind, qty,
                                 unit_cost, value_amount, source_type, source_id, moved_at, posted_journal_id)
        VALUES (gen_random_uuid(), ${TENANT_PJW}, ${fixture.feeItemId}, ${fixture.warehouseId}, 'OUT', 'issue', 1,
                ${input.valueAmount}, ${input.valueAmount}, 'manual_issue', ${fixture.feeItemId},
                ${input.movedAt}, ${input.journalEntryId})
        RETURNING id`,
  );
  return rows.rows[0]!.id;
}

/** Seed the 0103 subcontract pair (agreement + APPROVED certificate) —
 * the collector reads; the write surfaces are W-11's. */
export async function seedSubCertificate(input: {
  projectId: string;
  grossValue: string;
  retentionWithheld: string;
  netPayable: string;
  certificateDate: string;
}): Promise<{ agreementId: string; certificateId: string }> {
  const su: Client = await superuserClient();
  const fixture = pjw();
  const agreement = await su.query<{ id: string }>(
    `INSERT INTO subcontractor_agreements (id, tenant_id, project_id, partner_id, agreement_no, title,
                                           agreement_value, currency_code, retention_percent, status, activated_at, created_by)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, 'Fixture sub agreement', 100000, 'SAR', 10, 'ACTIVE', now(), $5)
     RETURNING id`,
    [TENANT_PJW, input.projectId, fixture.supplierPartnerId, `PJW-SUB-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, PJW_ACTOR],
  );
  const certificate = await su.query<{ id: string }>(
    `INSERT INTO subcontractor_certificates (id, tenant_id, agreement_id, certificate_date, progress_percent,
                                              gross_value, retention_withheld, net_payable, status, approved_at, approved_by, created_by)
     VALUES (gen_random_uuid(), $1, $2, $3, 10, $4, $5, $6, 'APPROVED', now(), $7, $7)
     RETURNING id`,
    [TENANT_PJW, agreement.rows[0]!.id, input.certificateDate, input.grossValue, input.retentionWithheld, input.netPayable, PJW_ACTOR],
  );
  await su.end();
  return { agreementId: agreement.rows[0]!.id, certificateId: certificate.rows[0]!.id };
}
