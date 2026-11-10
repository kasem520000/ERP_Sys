import { Client } from "pg";

import { appClient, ensureTestDb, seedTenants, superuserClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { EmployeeService } from "../../modules/payroll/application/employee-service";
import { StructureService } from "../../modules/payroll/application/structure-service";
import { RunCalculationService } from "../../modules/payroll/application/run-calculation-service";
import { ApprovalWorkflow } from "../../modules/payroll/application/approval-workflow";
import { RunPostingService } from "../../modules/payroll/application/run-posting-service";
import { PayoutService } from "../../modules/payroll/application/payout-service";
import { LoanService } from "../../modules/payroll/application/loan-service";
import { EosService } from "../../modules/payroll/application/eos-service";
import * as payrollStore from "../../modules/payroll/infrastructure/payroll.store";

/**
 * PHASE-029 wave E payroll db-suite fixtures (ACCOUNTING_TESTS §1): real
 * PostgreSQL 16 through the app-role services exactly as production code
 * paths run — every payroll write flows through the payroll services, and
 * EVERY journal flows through PostingService.post (ADR-0007; G-29/G-30/
 * G-31 all engine-sourced).
 *
 * Dedicated tenant PAY (SAR base, SA): an isolated tenant with the
 * onboarding-shaped CoA substrate (provisionCoaTemplate — the 0040 six
 * payroll purposes resolve from day one), FY2026 with 12 OPEN periods, a
 * MAIN branch, one cost center, one project, a BANK cash account, and the
 * loan control account mapped via payroll.loans.control_account_id to a
 * dedicated postable asset account ('1155 سلف الموظفين' — the
 * tenant-mapped account, NOT a canonical purpose).
 *
 * The phase §6 worked-example world (E1): structure ST-1 — basic 8,000 +
 * housing allowance 2,000 FIXED (not EOS-base) + third-party deduction
 * 1,000 FIXED + employer contribution 1,000 FIXED; EOS enabled with basis
 * 3 days/service-year ⇒ accrual 8,000 × 3/30 = 800; employee E1 (basic
 * 8,000, the structure, cost center + branch) with an ACTIVE loan carrying
 * one 500.00 PENDING line in period 1 (code LON-E1, disbursed through the
 * control account). Run 1 ⇒ gross 10,000 / deductions 1,500 (third-party
 * 1,000 + loan 500) / net 8,500 — the G-29 golden: DR SALARIES_EXPENSE
 * 10,000 · DR EMPLOYER_CONTRIBUTIONS 1,000 · DR EOS_PROVISION_EXPENSE 800
 * · CR DEDUCTIONS_PAYABLE 2,000 · CR loan control 500 · CR EOS_PROVISION
 * 800 · CR SALARIES_PAYABLE 8,500 (11,800 = 11,800).
 *
 * The G-31 world (E2): employee with basic 42,000, no allowances ⇒ EOS
 * accrual 42,000 × 3/30 = 4,200 per period; one posted run in period 2
 * (E1 suspended first) ⇒ provision balance 4,200; termination + settle
 * 4,000 ⇒ DR EOS_PROVISION 4,200 · CR CASH 4,000 · CR
 * EOS_PROVISION_EXPENSE 200.
 *
 * A second tenant (PAY-foreign, the S-04 spoof target) carries a REAL
 * foreign payroll world — structure + component + employee + run + loan
 * with fixed ids, so the spoof battery distinguishes RLS-scoped lookups
 * from FK leakage.
 */

export const P_ACTOR = "bcabcbcb-0000-4000-8000-0000000000ea";
export const P_APPROVER = "bcabcbcb-0000-4000-8000-0000000000eb";
export const P_FOREIGN_ACTOR = "bcabcbcb-0000-4000-8000-0000000000ec";
export const TENANT_PAY = "8f8f8f8f-8f8f-8f8f-8f8f-8f8f8f8f8f8f";
export const TENANT_PAY_FOREIGN = "91919191-9191-9191-9191-919191919191";

/** Deterministic fixed ids for the FOREIGN tenant's S-04 attack targets. */
export const FOREIGN_FIXTURE_IDS = {
  structure: "f9f9f9f9-0000-4000-8000-000000000001",
  component: "f9f9f9f9-0000-4000-8000-000000000002",
  employee: "f9f9f9f9-0000-4000-8000-000000000003",
  run: "f9f9f9f9-0000-4000-8000-000000000004",
  runLine: "f9f9f9f9-0000-4000-8000-000000000005",
  loan: "f9f9f9f9-0000-4000-8000-000000000006",
  loanLine: "f9f9f9f9-0000-4000-8000-000000000007",
} as const;

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);

export const employees = new EmployeeService(audit);
export const structures = new StructureService(audit);
export const calculation = new RunCalculationService(audit);
export const workflow = new ApprovalWorkflow(audit);
export const runPosting = new RunPostingService(audit, posting, numbering);
export const payouts = new PayoutService(audit, posting);
export const loans = new LoanService(audit, posting);
export const eos = new EosService(audit, posting);
export const periods = new PeriodService(audit);

export { withTenant, appClient, superuserClient, seedTenants, ensureTestDb, closeDb };
export { posting as pPosting };

export async function su(): Promise<Client> {
  return superuserClient();
}

export interface PayrollFixture {
  fiscalYearId: string;
  /** periodId by period name ("FY2026-01" … "FY2026-12"), all OPEN REGULAR. */
  periodIds: Record<string, string>;
  branchId: string;
  costCenterId: string;
  projectId: string;
  /** The BANK cash account (G-30 payout + loan disbursement target). */
  bankCashAccountId: string;
  /** The tenant-mapped employee-loan control account id (1155). */
  loanControlAccountId: string;
  /** The six payroll purpose account ids (worked-example assert targets). */
  purposeAccounts: Record<
    | "SALARIES_EXPENSE"
    | "SALARIES_PAYABLE"
    | "DEDUCTIONS_PAYABLE"
    | "EMPLOYER_CONTRIBUTIONS"
    | "EOS_PROVISION"
    | "EOS_PROVISION_EXPENSE",
    string
  >;
  /** E1 — the worked-example employee (basic 8,000 + ST-1). */
  employeeE1Id: string;
  /** E2 — the G-31 employee (basic 42,000, EOS-heavy). */
  employeeE2Id: string;
  structureId: string;
  /** E1's loan (one 500.00 PENDING line in period 1). */
  loanE1Id: string;
}

let fixture: PayrollFixture | undefined;

function booted(): PayrollFixture {
  if (fixture === undefined) throw new Error("payroll fixture not booted");
  return fixture;
}

export function payBooted(): PayrollFixture {
  return booted();
}

/** Set a tenant setting (jsonb value) — the budgeting-spec pattern. */
export async function setSetting(key: string, value: unknown): Promise<void> {
  const client = await superuserClient();
  await client.query(
    `INSERT INTO tenant_settings (id, tenant_id, key, value) VALUES
       (gen_random_uuid(), $1, $2, $3::jsonb)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`,
    [TENANT_PAY, key, JSON.stringify(value)],
  );
  await client.end();
}

/** Boot the payroll world (idempotent across specs in the suite run). */
export async function setupPayrollFixture(): Promise<PayrollFixture> {
  if (fixture !== undefined) return fixture;
  ensureTestDb();
  const suClient = await superuserClient();
  await seedTenants(suClient as never);
  await suClient.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant PAY (payroll)', 'المستأجر ر', 'SAR', 'SA', 'Asia/Riyadh'),
       ($2, 'Tenant PAY-foreign (spoof target)', 'المستأجر ر-أجنبي', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_PAY, TENANT_PAY_FOREIGN],
  );
  await suClient.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'pay-actor@fixture.test', 'Payroll Actor', 'x', 'ACTIVE'),
       ($2, 'pay-approver@fixture.test', 'Payroll Approver', 'x', 'ACTIVE'),
       ($3, 'pay-foreign@fixture.test', 'Payroll Foreign', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [P_ACTOR, P_APPROVER, P_FOREIGN_ACTOR],
  );
  await suClient.end();

  const periodIds: Record<string, string> = {};
  let fiscalYearId = "";
  let branchId = "";
  let costCenterId = "";
  let projectId = "";
  let bankCashAccountId = "";
  let loanControlAccountId = "";
  let employeeE1Id = "";
  let employeeE2Id = "";
  let structureId = "";
  let loanE1Id = "";

  await withTenant(TENANT_PAY, async () => {
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
    const treasury = await import("../../modules/treasury/infrastructure/treasury.store");

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

    // The six payroll purposes (0040 template rows — day-one mapped).
    const purposeAccounts = {
      SALARIES_EXPENSE: await byPurpose("SALARIES_EXPENSE"),
      SALARIES_PAYABLE: await byPurpose("SALARIES_PAYABLE"),
      DEDUCTIONS_PAYABLE: await byPurpose("DEDUCTIONS_PAYABLE"),
      EMPLOYER_CONTRIBUTIONS: await byPurpose("EMPLOYER_CONTRIBUTIONS"),
      EOS_PROVISION: await byPurpose("EOS_PROVISION"),
      EOS_PROVISION_EXPENSE: await byPurpose("EOS_PROVISION_EXPENSE"),
    } as PayrollFixture["purposeAccounts"];

    // The tenant-mapped loan control account: a dedicated postable asset
    // under 1150 (Other current assets) — 'سلف الموظفين'. NOT a purpose.
    const existingControl = await accounting.findAccountByCode("1155");
    const control =
      existingControl ??
      (await tenancy.insertAccount({
        code: "1155",
        name: "Employee loans & advances",
        nameAr: "سلف الموظفين",
        type: "ASSET",
        parentId: await byCode("1150"),
        isPostable: true,
      }));
    loanControlAccountId = control.id;

    // FY2026 with 12 OPEN REGULAR periods.
    const existingYear = await accounting.findFiscalYearByName("FY2026");
    fiscalYearId =
      existingYear?.id ??
      (await periods.createYear(P_ACTOR, { name: "FY2026", startDate: "2026-01-01", endDate: "2026-12-31" })).id;
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
    const existingCostCenter = existingCostCenters.find((row) => row.code === "PAY-CC-1");
    costCenterId =
      existingCostCenter?.id ??
      (
        await accounting.insertCostCenter({
          code: "PAY-CC-1",
          name: "Payroll cost center 1",
          nameAr: "مركز تكلفة الرواتب 1",
          parentId: null,
        })
      ).id;

    const existingProjects = await accounting.listProjects();
    const existingProject = existingProjects.find((row) => row.code === "PAY-PRJ-1");
    projectId =
      existingProject?.id ??
      (
        await accounting.insertProject({
          code: "PAY-PRJ-1",
          name: "Payroll project 1",
          nameAr: "مشروع الرواتب 1",
          parentId: null,
        })
      ).id;

    // The BANK cash account (G-30's CR target).
    const existingBank = await treasury.listCashAccounts({});
    const bank =
      existingBank.find((row) => row.name === "Pay Bank") ??
      (await treasury.insertCashAccount({
        name: "Pay Bank",
        nameAr: "بنك الرواتب",
        type: "BANK",
        accountId: await byCode("1121"),
        branchId: null,
        currencyCode: "SAR",
        createdBy: P_ACTOR,
      }));
    bankCashAccountId = bank.id;

    // The tenant policy surface (BR-054/BR-055): the control account +
    // EOS enabled with basis 3 days/service-year (the worked example:
    // 8,000 × 3/30 = 800).
    await setSetting("payroll.loans.control_account_id", loanControlAccountId);
    await setSetting("payroll.eos.enabled", true);
    await setSetting("payroll.eos.accrual_days_per_service_year", 3);

    // ST-1 — the worked-example structure: housing 2,000 (NOT eos-base),
    // third-party deduction 1,000, employer contribution 1,000.
    const existingStructures = await structures.list(50);
    const st1 =
      existingStructures.find((row) => row.code === "ST-1") ??
      (await structures.create({
        code: "ST-1",
        name: "Standard staff 2026",
        nameAr: "هيكل الموظفين القياسي ٢٠٢٦",
        actorId: P_ACTOR,
      }));
    structureId = st1.id;
    if ((await payrollStore.countComponents(st1.id)) === 0) {
      await structures.replaceComponents(
        st1.id,
        [
          {
            key: "HOUSING",
            name: "Housing allowance",
            nameAr: "بدل السكن",
            kind: "ALLOWANCE",
            calc: "FIXED",
            amount: "2000.0000",
            glAccountId: purposeAccounts.SALARIES_EXPENSE,
            isEosBase: false,
            seq: 1,
          },
          {
            key: "GOSI-EE",
            name: "Third-party deduction (employee)",
            nameAr: "استقطاع طرف ثالث (الموظف)",
            kind: "DEDUCTION",
            calc: "FIXED",
            amount: "1000.0000",
            glAccountId: purposeAccounts.DEDUCTIONS_PAYABLE,
            isEosBase: false,
            seq: 2,
          },
          {
            key: "GOSI-ER",
            name: "Employer contribution",
            nameAr: "مساهمة صاحب العمل",
            kind: "EMPLOYER_CONTRIBUTION",
            calc: "FIXED",
            amount: "1000.0000",
            glAccountId: purposeAccounts.EMPLOYER_CONTRIBUTIONS,
            isEosBase: false,
            seq: 3,
          },
        ],
        P_ACTOR,
      );
    }

    // E1 — the worked-example employee.
    const existingEmployeeRows = await employees.list({ limit: 50 });
    const e1 =
      existingEmployeeRows.find((row) => row.code === "EMP-001") ??
      (await employees.create({
        code: "EMP-001",
        name: "Worked Example",
        nameAr: "مثال التشغيل",
        nationalId: "1023456789",
        hireDate: "2025-01-01",
        contractType: "FULL_TIME",
        basicSalary: "8000.0000",
        salaryStructureId: st1.id,
        branchId,
        costCenterId,
        projectId,
        bankName: "Pay Bank",
        bankIban: "SA0380000000608020167519",
        bankAccount: "6080201675",
        actorId: P_ACTOR,
      }));
    employeeE1Id = e1.id;

    // E2 — the G-31 employee (basic 42,000 ⇒ accrual 4,200 at basis 3).
    // Booted SUSPENDED: the worked-example run 1 must carry E1 ONLY (the
    // §6 totals are single-employee); the G-31 scenario reactivates E2 and
    // suspends E1 for run 2.
    const e2Existing = existingEmployeeRows.find((row) => row.code === "EMP-002");
    if (e2Existing === undefined) {
      const created = await employees.create({
        code: "EMP-002",
        name: "EOS Employee",
        nameAr: "موظف نهاية الخدمة",
        hireDate: "2024-06-01",
        contractType: "FULL_TIME",
        basicSalary: "42000.0000",
        salaryStructureId: st1.id,
        branchId,
        costCenterId,
        actorId: P_ACTOR,
      });
      employeeE2Id = created.id;
      await employees.suspend(created.id, P_ACTOR);
    } else {
      employeeE2Id = e2Existing.id;
      if (e2Existing.status === "ACTIVE") {
        await employees.suspend(e2Existing.id, P_ACTOR);
      }
    }

    // E1's loan: one 500.00 line in period 1 — disbursed through the
    // control account (the disbursement journal posts HERE, once).
    const existingLoans = await loans.list({ limit: 50 });
    const loanE1 = existingLoans.find((row) => row.code === "LON-E1");
    if (loanE1 === undefined) {
      const created = await loans.create({
        code: "LON-E1",
        employeeId: employeeE1Id,
        amount: "500.0000",
        installmentsCount: 1,
        startPeriodId: periodIds["FY2026-01"]!,
        cashAccountId: bankCashAccountId,
        valueDate: "2026-01-02",
        actorId: P_ACTOR,
      });
      loanE1Id = created.loan.id;
    } else {
      loanE1Id = loanE1.id;
    }
  });

  // The REAL foreign payroll world (the S-04 spoof target).
  const su2 = await superuserClient();
  const foreignYear = "f9f9f9f9-0000-4000-8000-000000000008";
  const foreignPeriod = "f9f9f9f9-0000-4000-8000-000000000009";
  const foreignAccount = "f9f9f9f9-0000-4000-8000-00000000000a";
  await su2.query(
    `INSERT INTO fiscal_years (id, tenant_id, name, start_date, end_date) VALUES
       ($1, $2, 'FY2026-F', '2026-01-01', '2026-12-31') ON CONFLICT (id) DO NOTHING`,
    [foreignYear, TENANT_PAY_FOREIGN],
  );
  await su2.query(
    `INSERT INTO fiscal_periods (id, tenant_id, fiscal_year_id, name, kind, start_date, end_date, status) VALUES
       ($1, $2, $3, 'FY2026-F-01', 'REGULAR', '2026-01-01', '2026-01-31', 'OPEN') ON CONFLICT (id) DO NOTHING`,
    [foreignPeriod, TENANT_PAY_FOREIGN, foreignYear],
  );
  await su2.query(
    `INSERT INTO accounts (id, tenant_id, code, name, name_ar, type, is_postable) VALUES
       ($1, $2, '5399', 'Foreign expense account', 'حساب مصروف أجنبي', 'EXPENSE', true)
     ON CONFLICT (id) DO NOTHING`,
    [foreignAccount, TENANT_PAY_FOREIGN],
  );
  await su2.query(
    `INSERT INTO salary_structures (id, tenant_id, code, name, currency, status) VALUES
       ($1, $2, 'ST-F', 'Foreign structure', 'SAR', 'ACTIVE') ON CONFLICT (id) DO NOTHING`,
    [FOREIGN_FIXTURE_IDS.structure, TENANT_PAY_FOREIGN],
  );
  await su2.query(
    `INSERT INTO salary_components (id, tenant_id, structure_id, key, name, kind, calc, amount, gl_account_id, is_eos_base, seq) VALUES
       ($1, $2, $3, 'F-ALLOW', 'Foreign allowance', 'ALLOWANCE', 'FIXED', 100, $4, false, 1)
     ON CONFLICT (id) DO NOTHING`,
    [FOREIGN_FIXTURE_IDS.component, TENANT_PAY_FOREIGN, FOREIGN_FIXTURE_IDS.structure, foreignAccount],
  );
  await su2.query(
    `INSERT INTO employees (id, tenant_id, code, name, hire_date, contract_type, basic_salary, salary_structure_id, status) VALUES
       ($1, $2, 'EMP-F', 'Foreign Employee', '2025-01-01', 'FULL_TIME', 5000, $3, 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [FOREIGN_FIXTURE_IDS.employee, TENANT_PAY_FOREIGN, FOREIGN_FIXTURE_IDS.structure],
  );
  await su2.query(
    `INSERT INTO payroll_runs (id, tenant_id, run_no, fiscal_period_id, status,
       journal_entry_id, posted_at, posted_by) VALUES
       ($1, $2, 'PR-2026-1', $3, 'POSTED',
        'f9f9f9f9-0000-4000-8000-0000000000be', now(), $4)
     ON CONFLICT (id) DO NOTHING`,
    [FOREIGN_FIXTURE_IDS.run, TENANT_PAY_FOREIGN, foreignPeriod, P_FOREIGN_ACTOR],
  );
  await su2.query(
    `INSERT INTO payroll_run_lines (id, tenant_id, run_id, employee_id, component_snapshot,
       gross_amount, deductions_amount, net_amount) VALUES
       ($1, $2, $3, $4, '{"structure":{"id":"x","code":"ST-F","name":"F"},"components":[],"loanDeductions":[],"eos":{"enabled":false,"accrual":"0"},"basicSalary":"5000"}'::jsonb,
       5000, 0, 5000)
     ON CONFLICT (id) DO NOTHING`,
    [FOREIGN_FIXTURE_IDS.runLine, TENANT_PAY_FOREIGN, FOREIGN_FIXTURE_IDS.run, FOREIGN_FIXTURE_IDS.employee],
  );
  await su2.query(
    `INSERT INTO employee_loans (id, tenant_id, code, employee_id, amount, installments_count, start_period_id, status) VALUES
       ($1, $2, 'LON-F', $3, 300, 1, $4, 'ACTIVE') ON CONFLICT (id) DO NOTHING`,
    [FOREIGN_FIXTURE_IDS.loan, TENANT_PAY_FOREIGN, FOREIGN_FIXTURE_IDS.employee, foreignPeriod],
  );
  await su2.query(
    `INSERT INTO employee_loan_lines (id, tenant_id, loan_id, fiscal_period_id, amount, status) VALUES
       ($1, $2, $3, $4, 300, 'PENDING') ON CONFLICT (id) DO NOTHING`,
    [FOREIGN_FIXTURE_IDS.loanLine, TENANT_PAY_FOREIGN, FOREIGN_FIXTURE_IDS.loan, foreignPeriod],
  );
  await su2.end();

  fixture = {
    fiscalYearId,
    periodIds,
    branchId,
    costCenterId,
    projectId,
    bankCashAccountId,
    loanControlAccountId,
    purposeAccounts: (await withTenant(TENANT_PAY, async () => {
      const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
      const byPurpose = async (key: string): Promise<string> => {
        const mapping = await accounting.findActivePurpose(key);
        if (mapping === undefined) throw new Error(`fixture purpose ${key} unmapped`);
        return mapping.accountId;
      };
      return {
        SALARIES_EXPENSE: await byPurpose("SALARIES_EXPENSE"),
        SALARIES_PAYABLE: await byPurpose("SALARIES_PAYABLE"),
        DEDUCTIONS_PAYABLE: await byPurpose("DEDUCTIONS_PAYABLE"),
        EMPLOYER_CONTRIBUTIONS: await byPurpose("EMPLOYER_CONTRIBUTIONS"),
        EOS_PROVISION: await byPurpose("EOS_PROVISION"),
        EOS_PROVISION_EXPENSE: await byPurpose("EOS_PROVISION_EXPENSE"),
      };
    })) as PayrollFixture["purposeAccounts"],
    employeeE1Id,
    employeeE2Id,
    structureId,
    loanE1Id,
  };
  void booted;
  return booted();
}
