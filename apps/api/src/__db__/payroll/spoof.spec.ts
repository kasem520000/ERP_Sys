import { beforeAll, describe, expect, it } from "vitest";

import {
  ComponentAccountNotFoundError,
  EmployeeNotFoundError,
  LoanLineNotFoundError,
  LoanNotFoundError,
  StructureNotFoundError,
  RunNotFoundError,
} from "../../modules/payroll/domain/payroll-errors";
import {
  FOREIGN_FIXTURE_IDS,
  TENANT_PAY,
  employees,
  structures,
  calculation,
  loans,
  payouts,
  runPosting,
  eos,
  setupPayrollFixture,
  withTenant,
  type PayrollFixture,
} from "./fixtures";

/**
 * payroll spoof spec (PHASE-029 §6 — the S-04 battery over the payroll
 * surface, the notes/budgeting precedent): REAL foreign-tenant rows (the
 * fixture mints a full foreign payroll world with fixed ids) probed
 * through the OWN-tenant services — RLS must render them exactly like
 * unknown ids (A7 parity: typed 404s, zero partial creation, zero
 * existence disclosure). The unknown-vs-foreign parity probe pins the
 * indistinguishability law.
 */

let fixture: PayrollFixture;

beforeAll(async () => {
  fixture = await setupPayrollFixture();
});

const UNKNOWN = {
  structure: "00000000-0000-4000-8000-0000000000f1",
  component: "00000000-0000-4000-8000-0000000000f2",
  employee: "00000000-0000-4000-8000-0000000000f3",
  run: "00000000-0000-4000-8000-0000000000f4",
  loan: "00000000-0000-4000-8000-0000000000f5",
  loanLine: "00000000-0000-4000-8000-0000000000f6",
} as const;

describe("payroll spoof (S-04 — foreign ids stay opaque, zero partial creation)", () => {
  it("foreign + unknown structure ids: identical typed 404s (parity)", async () => {
    await withTenant(TENANT_PAY, async () => {
      await expect(structures.get(FOREIGN_FIXTURE_IDS.structure)).rejects.toBeInstanceOf(
        StructureNotFoundError,
      );
      await expect(structures.get(UNKNOWN.structure)).rejects.toBeInstanceOf(
        StructureNotFoundError,
      );
      // A foreign COMPONENT id as the gl_account_id rejects typed 404
      // (the builder's account validation — S-04 on the nested payload).
      // The probe uses a FRESH structure (the fixture's ST-1/ST-2 may be
      // frozen by run snapshots when the rules spec ran first — the
      // shared-DB ordering discipline).
      const probe = await structures.create({
        code: `ST-PROBE-${Date.now()}`,
        name: "Spoof probe structure",
        actorId: null,
      });
      await expect(
        structures.replaceComponents(
          probe.id,
          [
            {
              key: "X",
              name: "X",
              kind: "ALLOWANCE",
              calc: "FIXED",
              amount: "1.0000",
              glAccountId: FOREIGN_FIXTURE_IDS.component,
            },
          ],
          null,
        ),
      ).rejects.toBeInstanceOf(ComponentAccountNotFoundError);
    });
  });

  it("foreign + unknown employee ids: identical typed 404s (reads + loans + eos)", async () => {
    await withTenant(TENANT_PAY, async () => {
      await expect(employees.get(FOREIGN_FIXTURE_IDS.employee, null)).rejects.toBeInstanceOf(
        EmployeeNotFoundError,
      );
      await expect(employees.get(UNKNOWN.employee, null)).rejects.toBeInstanceOf(
        EmployeeNotFoundError,
      );
      await expect(
        employees.update(FOREIGN_FIXTURE_IDS.employee, { name: "X" }, null),
      ).rejects.toBeInstanceOf(EmployeeNotFoundError);
      await expect(
        employees.suspend(FOREIGN_FIXTURE_IDS.employee, null),
      ).rejects.toBeInstanceOf(EmployeeNotFoundError);
      await expect(
        employees.terminate(FOREIGN_FIXTURE_IDS.employee, {
          terminationDate: "2026-02-01",
          actorId: null,
        }),
      ).rejects.toBeInstanceOf(EmployeeNotFoundError);
      await expect(eos.balanceFor(FOREIGN_FIXTURE_IDS.employee)).rejects.toBeInstanceOf(
        EmployeeNotFoundError,
      );
      await expect(
        eos.settle(FOREIGN_FIXTURE_IDS.employee, {
          settledAmount: "1.0000",
          cashAccountId: fixture.bankCashAccountId,
          actorId: null,
        }),
      ).rejects.toBeInstanceOf(EmployeeNotFoundError);
      // Loan creation against a foreign employee: typed 404, ZERO partial
      // creation (no journal, no loan row, no schedule lines).
      await expect(
        loans.create({
          code: "LON-SPOOF-1",
          employeeId: FOREIGN_FIXTURE_IDS.employee,
          amount: "100.0000",
          installmentsCount: 1,
          startPeriodId: fixture.periodIds["FY2026-09"]!,
          cashAccountId: fixture.bankCashAccountId,
          actorId: null,
        }),
      ).rejects.toBeInstanceOf(EmployeeNotFoundError);
    });
  });

  it("foreign + unknown run ids: identical typed 404s; calculate/post/payout/reverse reject", async () => {
    await withTenant(TENANT_PAY, async () => {
      await expect(calculation.getRun(FOREIGN_FIXTURE_IDS.run)).rejects.toBeInstanceOf(
        RunNotFoundError,
      );
      await expect(calculation.getRun(UNKNOWN.run)).rejects.toBeInstanceOf(RunNotFoundError);
      await expect(
        calculation.calculate(FOREIGN_FIXTURE_IDS.run, { actorId: null }),
      ).rejects.toBeInstanceOf(RunNotFoundError);
      await expect(runPosting.post(FOREIGN_FIXTURE_IDS.run, null)).rejects.toBeInstanceOf(
        RunNotFoundError,
      );
      await expect(
        runPosting.reverse(FOREIGN_FIXTURE_IDS.run, {
          reason: "spoof",
          entryDate: "2026-03-01",
          actorId: null,
        }),
      ).rejects.toBeInstanceOf(RunNotFoundError);
      await expect(
        payouts.payout(FOREIGN_FIXTURE_IDS.run, {
          cashAccountId: fixture.bankCashAccountId,
          actorId: null,
        }),
      ).rejects.toBeInstanceOf(RunNotFoundError);
      await expect(
        payouts.payslips(FOREIGN_FIXTURE_IDS.run, "ar"),
      ).rejects.toBeInstanceOf(RunNotFoundError);
      // A run created in the OWN tenant then probed under a foreign
      // PERIOD id: the create dies typed 404 (the period belongs to the
      // foreign tenant — RLS hides it).
      await expect(
        calculation.createRun({
          fiscalPeriodId: "f9f9f9f9-0000-4000-8000-000000000009",
          actorId: null,
        }),
      ).rejects.toBeInstanceOf(RunNotFoundError);
    });
  });

  it("foreign + unknown loan/line ids: identical typed 404s; waive/write-off reject", async () => {
    await withTenant(TENANT_PAY, async () => {
      await expect(loans.get(FOREIGN_FIXTURE_IDS.loan)).rejects.toBeInstanceOf(LoanNotFoundError);
      await expect(loans.get(UNKNOWN.loan)).rejects.toBeInstanceOf(LoanNotFoundError);
      await expect(
        loans.waiveLine(FOREIGN_FIXTURE_IDS.loanLine, { reason: "spoof", actorId: null }),
      ).rejects.toBeInstanceOf(LoanLineNotFoundError);
      await expect(
        loans.writeOff(FOREIGN_FIXTURE_IDS.loan, { reason: "spoof", actorId: null }),
      ).rejects.toBeInstanceOf(LoanNotFoundError);
    });
  });

  it("zero partial creation across the battery (no spoof-named rows anywhere)", async () => {
    const { su } = await import("./fixtures");
    const client = await su();
    const rows = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM employees WHERE tenant_id = $1 AND code LIKE 'EMP-SPOOF%') AS employees,
         (SELECT COUNT(*)::int FROM employee_loans WHERE tenant_id = $1 AND code LIKE 'LON-SPOOF%') AS loans,
         (SELECT COUNT(*)::int FROM journal_entries WHERE tenant_id = $1 AND description LIKE '%spoof%') AS journals,
         (SELECT COUNT(*)::int FROM salary_structures WHERE tenant_id = $1 AND code LIKE 'ST-SPOOF%') AS structures`,
      [TENANT_PAY],
    );
    await client.end();
    expect(rows.rows[0]).toEqual({ employees: 0, loans: 0, journals: 0, structures: 0 });
  });
});
