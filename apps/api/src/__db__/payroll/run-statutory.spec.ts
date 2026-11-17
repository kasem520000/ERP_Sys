import { beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { sql } from "drizzle-orm";

import * as payrollStore from "../../modules/payroll/infrastructure/payroll.store";

import {
  P_ACTOR,
  P_APPROVER,
  calculation,
  employees,
  periods,
  runPosting,
  setupPayrollFixture,
  su,
  withTenant,
  workflow,
  payouts,
} from "./fixtures";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { materializeCanonicalStatutorySet } from "../../modules/payroll/infrastructure/statutory-canonical";
import { StructureService } from "../../modules/payroll/application/structure-service";
import { RemittanceExceedsLiabilityError } from "../../modules/payroll/domain/payroll-errors";

/**
 * PHASE-046 (W-3, T-05) — THE RUN INTEGRATION (§4's run-statutory
 * matrix): the KSA worked example END-TO-END — calculate → submit →
 * approve (SoD) → post with the statutory line set, then the G-52
 * remittance settlement — on the owner's CORRECTED schedule:
 *
 *   Saudi employee, basic 10,000 + housing 2,000 (the contributory base)
 *   → GOSI-PENSION 1,080/1,080 + GOSI-SANED 90/90 + GOSI-OH 0/240
 *   = employee 1,170.0000 / employer 1,410.0000; KSA PIT: the honest
 *   no-bracket zero; gross 12,000 / deductions 1,170 / net 10,830;
 *   the G-29-extended journal: DR SALARIES_EXPENSE 12,000 · DR
 *   EMPLOYER_CONTRIBUTIONS 1,410 · CR DEDUCTIONS_PAYABLE 2,580 · CR
 *   SALARIES_PAYABLE 10,830 (13,410 = 13,410);
 *   the REMITTANCE settles the 2,580 (DR DEDUCTIONS_PAYABLE · CR CASH +
 *   the payroll_payout movement, INV-019 exact) and flips the
 *   statutory_summary's liability accrued → remitted; the over-remit is
 *   the typed refusal.
 *
 * INV-032(a) pinned per breakdown row (rate × clamped base == the share,
 * exact 4dp); INV-032(b) the totals tie (Σ lines == run totals == an
 * independent SQL fold); INV-025 the fold (net = gross − deductions at
 * both levels). The non-Saudi arm (OH-only 240), the NULL-nationality
 * fail-closed arm (D-02), and BR-085 AT THE RUN LEVEL (a blocked row
 * refuses the whole calculation typed, zero residue) follow.
 *
 * Isolation — THE DEDICATED TENANT (the T-20 race-suite + eosb.spec
 * precedent): tenant RUNSTAT carries its own CoA + FY2026 + settings +
 * structure + the canonical statutory set, so this spec's runs and
 * journals never touch the PAY world's registers (whose censuses the
 * 029 spec pins). EOS stays OFF here (the clean statutory golden — no
 * EOS legs; the eosb spec owns that interplay).
 */

const TENANT_RUNSTAT = "8c8c8c8c-8c8c-8c8c-8c8c-8c8c8c8c8c8c";

const audit = new AuditService(new DrizzleAuditStore());
const structures = new StructureService(audit);

interface RunStatWorld {
  structureId: string;
  periodIds: Record<string, string>;
  bankCashAccountId: string;
  purposeAccounts: Record<
    "SALARIES_EXPENSE" | "SALARIES_PAYABLE" | "DEDUCTIONS_PAYABLE" | "EMPLOYER_CONTRIBUTIONS",
    string
  >;
  ksaEmployeeId: string;
  nsEmployeeId: string;
  nnEmployeeId: string;
}

let world: RunStatWorld;

/** The journal's lines — through the AMBIENT tenant tx (the caller's
 *  still-open UoW is invisible to independent connections). */
async function journalLinesOf(entryId: string): Promise<
  { accountId: string; direction: string; amount: string }[]
> {
  const { listLines } = await import("../../modules/accounting/infrastructure/journal.store");
  const lines = await listLines(entryId);
  return lines.map((line) => ({ accountId: line.accountId, direction: line.direction, amount: line.amount }));
}


beforeAll(async () => {
  // The dedicated RUNSTAT tenant (idempotent — its own books).
  await setupPayrollFixture(); // the DB harness + the shared services
  const client = await su();
  await client.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant RUNSTAT (046 run integration)', 'المستأجر لتكامل المسير', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_RUNSTAT],
  );
  await client.end();

  world = await withTenant(TENANT_RUNSTAT, async () => {
    const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
    const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
    const treasury = await import("../../modules/treasury/infrastructure/treasury.store");
    await tenancy.seedMasterDataBasics();
    await tenancy.provisionCoaTemplate();
    const byPurpose = async (key: string): Promise<string> => {
      const mapping = await accounting.findActivePurpose(key);
      if (mapping === undefined) throw new Error(`purpose ${key} unmapped`);
      return mapping.accountId;
    };
    const salariesExpenseAccount = await byPurpose("SALARIES_EXPENSE");

    // ST-RS — the worked-example structure: housing 2,000 mapped to the
    // SAME account as the basic (the one 12,000 DR leg, the 029 golden's
    // fold shape).
    const existing = await structures.list(50);
    const structure =
      existing.find((row) => row.code === "ST-RS") ??
      (await structures.create({
        code: "ST-RS",
        name: "Run-statutory spec structure",
        nameAr: "هيكل مواصفة تكامل المسير",
        actorId: P_ACTOR,
      }));
    if ((await (await import("../../modules/payroll/infrastructure/payroll.store")).countComponents(structure.id)) === 0) {
      await structures.replaceComponents(
        structure.id,
        [
          {
            key: "HOUSING",
            name: "Housing allowance",
            nameAr: "بدل السكن",
            kind: "ALLOWANCE",
            calc: "FIXED",
            amount: "2000.0000",
            glAccountId: salariesExpenseAccount,
            isEosBase: false,
            seq: 1,
          },
        ],
        P_ACTOR,
      );
    }

    const year = await periods.createYear(P_ACTOR, {
      name: "FY2026",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    });
    const periodIds: Record<string, string> = {};
    for (const period of await accounting.listPeriods(year.id)) {
      if (period.kind === "REGULAR") periodIds[period.name] = period.id;
    }

    const byCode = async (code: string): Promise<string> => {
      const account = await accounting.findAccountByCode(code);
      if (account === undefined) throw new Error(`account ${code} missing`);
      return account.id;
    };
    const bank = await treasury.insertCashAccount({
      name: "RunStat Bank",
      nameAr: "بنك تكامل المسير",
      type: "BANK",
      accountId: await byCode("1121"),
      branchId: null,
      currencyCode: "SAR",
      createdBy: P_ACTOR,
    });

    // THE CANONICAL STATUTORY SET for this tenant (the KSA GOSI rows,
    // VERIFIED with the 0093 PwC citation records; AE/EG/JO blocked).
    await materializeCanonicalStatutorySet();

    // The spec's employees: KSA-EE ACTIVE (the golden); NS-EE + NN-EE
    // booted SUSPENDED (the E2 pattern — invisible to runs until their
    // own arms reactivate them).
    const list = await employees.list({ limit: 100 });
    const ksa =
      list.find((row) => row.code === "EMP-RS-001") ??
      (await employees.create({
        code: "EMP-RS-001",
        name: "Saudi Worked Example",
        nameAr: "المثال السعودي",
        nationality: "SA",
        hireDate: "2020-01-01",
        contractType: "FULL_TIME",
        basicSalary: "10000.0000",
        salaryStructureId: structure.id,
        actorId: P_ACTOR,
      }));
    const ns =
      list.find((row) => row.code === "EMP-RS-002") ??
      (await employees.create({
        code: "EMP-RS-002",
        name: "Non-Saudi Employee",
        nameAr: "موظف غير سعودي",
        nationality: "EG",
        hireDate: "2021-01-01",
        contractType: "FULL_TIME",
        basicSalary: "10000.0000",
        salaryStructureId: structure.id,
        actorId: P_ACTOR,
      }));
    const nn =
      list.find((row) => row.code === "EMP-RS-003") ??
      (await employees.create({
        code: "EMP-RS-003",
        name: "No-Nationality Employee",
        nameAr: "موظف بلا جنسية",
        hireDate: "2022-01-01",
        contractType: "FULL_TIME",
        basicSalary: "5000.0000",
        salaryStructureId: structure.id,
        actorId: P_ACTOR,
      }));
    if (ns.status === "ACTIVE") await employees.suspend(ns.id, P_ACTOR);
    if (nn.status === "ACTIVE") await employees.suspend(nn.id, P_ACTOR);

    return {
      structureId: structure.id,
      periodIds,
      bankCashAccountId: bank.id,
      purposeAccounts: {
        SALARIES_EXPENSE: salariesExpenseAccount,
        SALARIES_PAYABLE: await byPurpose("SALARIES_PAYABLE"),
        DEDUCTIONS_PAYABLE: await byPurpose("DEDUCTIONS_PAYABLE"),
        EMPLOYER_CONTRIBUTIONS: await byPurpose("EMPLOYER_CONTRIBUTIONS"),
      },
      ksaEmployeeId: ksa.id,
      nsEmployeeId: ns.id,
      nnEmployeeId: nn.id,
    };
  });
});

describe("PHASE-046 W-3 T-05 — the run integration (the KSA worked example end-to-end)", () => {
  let goldenRunId = "";
  let goldenJournalId = "";

  it("(a) THE GOLDEN RUN — calculate: the corrected GOSI split on the run's columns, breakdowns, and summary; INV-032(a)/(b) + INV-025", async () => {
    await withTenant(TENANT_RUNSTAT, async () => {
      const run = await calculation.createRun({
        fiscalPeriodId: world.periodIds["FY2026-01"]!,
        actorId: P_ACTOR,
      });
      goldenRunId = run.id;
      const calculated = await calculation.calculate(run.id, { actorId: P_ACTOR });

      // The worked-example totals (INV-025 — exact strings).
      expect(calculated.run.grossTotal).toBe("12000.0000");
      expect(calculated.run.deductionsTotal).toBe("1170.0000");
      expect(calculated.run.netTotal).toBe("10830.0000");
      expect(calculated.run.employerContributionsTotal).toBe("1410.0000");
      // The statutory/variable breakdown totals (D-05).
      expect(calculated.run.statutoryEmployeeTotal).toBe("1170.0000");
      expect(calculated.run.statutoryEmployerTotal).toBe("1410.0000");
      expect(calculated.run.pitTotal).toBe("0.0000"); // KSA: the honest no-bracket zero
      expect(calculated.run.variableOvertimeTotal).toBe("0.0000");
      expect(calculated.run.variableAbsenceTotal).toBe("0.0000");
      expect(calculated.run.variableLateTotal).toBe("0.0000");
      // No warning: the employee carries a nationality, the jurisdiction
      // carries live rows.
      expect(calculated.warnings.unpricedNationality).toHaveLength(0);
      expect(calculated.warnings.noStatutoryProfile).toHaveLength(0);

      expect(calculated.lines).toHaveLength(1);
      const line = calculated.lines[0]!;
      expect(line.employee.id).toBe(world.ksaEmployeeId);
      expect(line.statutoryEmployeeShare).toBe("1170.0000");
      expect(line.statutoryEmployerShare).toBe("1410.0000");
      expect(line.pitWithheld).toBe("0.0000");

      // The frozen per-row breakdown — INV-032(a): rate × clamped base ==
      // the share, exact 4dp (the 0093-cited schedule).
      const byCode = new Map(line.statutoryBreakdown.map((row) => [row.code, row]));
      expect([...byCode.keys()].sort()).toEqual(["GOSI-OH", "GOSI-PENSION", "GOSI-SANED"]);
      expect(byCode.get("GOSI-PENSION")).toMatchObject({
        base: "12000.0000",
        clampedBase: "12000.0000",
        clampedBy: null,
        employeeRate: "9.0000",
        employerRate: "9.0000",
        employeeAmount: "1080.0000",
        employerAmount: "1080.0000",
      });
      expect(byCode.get("GOSI-SANED")).toMatchObject({
        clampedBase: "12000.0000",
        employeeRate: "0.7500",
        employeeAmount: "90.0000",
        employerAmount: "90.0000",
      });
      expect(byCode.get("GOSI-OH")).toMatchObject({
        clampedBase: "12000.0000",
        employeeRate: "0.0000",
        employerRate: "2.0000",
        employeeAmount: "0.0000",
        employerAmount: "240.0000",
      });

      // The remittance liability summary (D-05): per profile row the
      // (employee + employer) accrual, remitted starting at zero.
      const summary = calculated.run.statutorySummary ?? [];
      // The summary follows the store's ORDER BY code (GOSI-OH, GOSI-
      // PENSION, GOSI-SANED) — deterministic, the same lines always fold
      // the same summary.
      expect(summary.map((row) => row.code)).toEqual(["GOSI-OH", "GOSI-PENSION", "GOSI-SANED"]);
      expect(summary.map((row) => row.accrued)).toEqual(["240.0000", "2160.0000", "180.0000"]);
      expect(summary.every((row) => row.remitted === "0.0000")).toBe(true);

      // INV-032(b) — the totals tie an INDEPENDENT SQL fold.
      const sqlFold = await payrollStore.requireAmbientTx().execute<{
        employeeShare: string;
        employerShare: string;
        linesDeductions: string;
      }>(sql`
          SELECT coalesce(sum(statutory_employee_share), 0)::text AS "employeeShare",
                 coalesce(sum(statutory_employer_share), 0)::text AS "employerShare",
                 coalesce(sum(deductions_amount), 0)::text AS "linesDeductions"
          FROM payroll_run_lines WHERE run_id = ${run.id}
        `);
      const fold = sqlFold.rows[0]!;
      expect(fold.employeeShare).toBe("1170.0000");
      expect(fold.employerShare).toBe("1410.0000");
      expect(fold.linesDeductions).toBe(calculated.run.deductionsTotal);
    });
  });

  it("(b) THE GOLDEN JOURNAL — submit → approve (SoD) → post: DR SALARIES 12,000 · DR EMPLOYER_CONTRIBUTIONS 1,410 · CR DEDUCTIONS_PAYABLE 2,580 · CR SALARIES_PAYABLE 10,830", async () => {
    await withTenant(TENANT_RUNSTAT, async () => {
      await workflow.submit(goldenRunId, P_ACTOR);
      await expect(workflow.approve(goldenRunId, P_ACTOR)).rejects.toMatchObject({
        code: "PAYROLL_RUN_SELF_APPROVAL",
      });
      await workflow.approve(goldenRunId, P_APPROVER);
      const posted = await runPosting.post(goldenRunId, P_ACTOR);
      expect(posted.status).toBe("POSTED");
      goldenJournalId = posted.journalEntryId!;

      const lines = await journalLinesOf(goldenJournalId);
      const sum = (direction: string): string =>
        lines
          .filter((row) => row.direction === direction)
          .reduce((acc, row) => (Number(acc) + Number(row.amount)).toFixed(4), "0.0000");
      expect(sum("DEBIT")).toBe("13410.0000");
      expect(sum("CREDIT")).toBe("13410.0000");

      const P = world.purposeAccounts;
      const amountOf = (accountId: string, direction: string): string => {
        const found = lines.find(
          (row) => row.accountId === accountId && row.direction === direction,
        );
        return found === undefined ? "0.0000" : found.amount;
      };
      // The one 12,000 salary leg (basic + housing — the same account).
      expect(amountOf(P.SALARIES_EXPENSE, "DEBIT")).toBe("12000.0000");
      // G-53's expense leg at the employer statutory total.
      expect(amountOf(P.EMPLOYER_CONTRIBUTIONS, "DEBIT")).toBe("1410.0000");
      // G-52's withholding + G-53's liability — ONE DEDUCTIONS_PAYABLE
      // credit line: 1,170 (employee share + PIT 0) + 1,410 (employer).
      expect(amountOf(P.DEDUCTIONS_PAYABLE, "CREDIT")).toBe("2580.0000");
      expect(
        lines.filter((row) => row.accountId === P.DEDUCTIONS_PAYABLE && row.direction === "CREDIT")
          .length,
      ).toBe(1);
      // The net leg.
      expect(amountOf(P.SALARIES_PAYABLE, "CREDIT")).toBe("10830.0000");
    });
  });

  it("(c) THE REMITTANCE SETTLEMENT — the full 2,580 through the payout machinery; INV-019 exact; the summary flips accrued → remitted; the over-remit refuses typed", async () => {
    let remitted: { remittanceId: string; journalEntryId: string } | undefined;
    await withTenant(TENANT_RUNSTAT, async () => {
      const result = await payouts.remit(goldenRunId, {
        cashAccountId: world.bankCashAccountId,
        actorId: P_ACTOR,
      });
      remitted = { remittanceId: result.remittanceId, journalEntryId: result.journalEntryId };
      expect(result.amount).toBe("2580.0000");

      // The settlement journal: DR DEDUCTIONS_PAYABLE · CR the cash
      // account (the G-51 precedent's shape).
      const lines = await journalLinesOf(result.journalEntryId);
      const P = world.purposeAccounts;
      expect(lines).toHaveLength(2);
      expect(lines.find((row) => row.direction === "DEBIT")).toMatchObject({
        accountId: P.DEDUCTIONS_PAYABLE,
        amount: "2580.0000",
      });
      const cashLeg = lines.find((row) => row.direction === "CREDIT")!;
      expect(cashLeg.amount).toBe("2580.0000");

      // INV-019 exact: the treasury movement's base == the journal's cash
      // line (sourceType payroll_payout — the movement-kind law, no CHECK
      // widening; sourceId = the minted remittanceId).
      const movements = await payrollStore.requireAmbientTx().execute<{
        base_amount: string;
        source_type: string;
        source_id: string;
        direction: string;
      }>(sql`
          SELECT base_amount::text, source_type, source_id::text, direction
          FROM cash_movements WHERE source_id = ${result.remittanceId}
        `);
      const movement = movements.rows[0]!;
      expect(movement).toMatchObject({
        base_amount: "2580.0000",
        source_type: "payroll_payout",
        source_id: result.remittanceId,
        direction: "OUT",
      });
      expect(movement.base_amount).toBe(cashLeg.amount);

      // The statutory_summary liability: accrued → remitted on EVERY row.
      const updated = await calculation.getRun(goldenRunId);
      expect(updated.run.statutorySummary?.map((row) => [row.code, row.remitted])).toEqual([
        ["GOSI-OH", "240.0000"],
        ["GOSI-PENSION", "2160.0000"],
        ["GOSI-SANED", "180.0000"],
      ]);

      // THE OVER-REMIT: the emptied outstanding refuses typed (zero
      // residue — the summary unchanged, no journal).
      await expect(
        payouts.remit(goldenRunId, { cashAccountId: world.bankCashAccountId, actorId: P_ACTOR }),
      ).rejects.toBeInstanceOf(RemittanceExceedsLiabilityError);
      await expect(
        payouts.remit(goldenRunId, {
          cashAccountId: world.bankCashAccountId,
          amount: "1.0000",
          actorId: P_ACTOR,
        }),
      ).rejects.toMatchObject({ code: "PAYROLL_REMITTANCE_EXCEEDS_LIABILITY" });
      const afterRefusal = await calculation.getRun(goldenRunId);
      expect(afterRefusal.run.statutorySummary).toEqual(updated.run.statutorySummary);
    });
    void remitted;
  });

  it("(d) THE PARTIAL REMITTANCE — an exact partial allocates first-row-first; the remainder settles after", async () => {
    await withTenant(TENANT_RUNSTAT, async () => {
      // A second golden run (period 2) accrues a fresh 2,580 liability.
      const run = await calculation.createRun({
        fiscalPeriodId: world.periodIds["FY2026-02"]!,
        actorId: P_ACTOR,
      });
      await calculation.calculate(run.id, { actorId: P_ACTOR });
      await workflow.submit(run.id, P_ACTOR);
      await workflow.approve(run.id, P_APPROVER);
      await runPosting.post(run.id, P_ACTOR);

      const partial = await payouts.remit(run.id, {
        cashAccountId: world.bankCashAccountId,
        amount: "1000.0000",
        actorId: P_ACTOR,
      });
      expect(partial.amount).toBe("1000.0000");
      // First-row-first in the stored order: GOSI-OH takes its whole
      // 240, GOSI-PENSION the remaining 760 of its 2,160.
      expect(partial.summary.map((row) => [row.code, row.remitted])).toEqual([
        ["GOSI-OH", "240.0000"],
        ["GOSI-PENSION", "760.0000"],
        ["GOSI-SANED", "0.0000"],
      ]);

      const rest = await payouts.remit(run.id, {
        cashAccountId: world.bankCashAccountId,
        actorId: P_ACTOR,
      });
      expect(rest.amount).toBe("1580.0000");
      expect(rest.summary.map((row) => [row.code, row.remitted])).toEqual([
        ["GOSI-OH", "240.0000"],
        ["GOSI-PENSION", "2160.0000"],
        ["GOSI-SANED", "180.0000"],
      ]);
      // Three journals for this run now: the G-29 + two settlements —
      // each settlement its own INV-013 key (payroll_remittance, id, post).
    });
  });

  it("(e) THE NON-SAUDI ARM — OH-only: employee 0 / employer 240; the journal's pair", async () => {
    await withTenant(TENANT_RUNSTAT, async () => {
      await employees.suspend(world.ksaEmployeeId, P_ACTOR);
      await employees.reactivate(world.nsEmployeeId, P_ACTOR);
      const run = await calculation.createRun({
        fiscalPeriodId: world.periodIds["FY2026-03"]!,
        actorId: P_ACTOR,
      });
      const calculated = await calculation.calculate(run.id, { actorId: P_ACTOR });
      expect(calculated.run.statutoryEmployeeTotal).toBe("0.0000");
      expect(calculated.run.statutoryEmployerTotal).toBe("240.0000");
      expect(calculated.run.deductionsTotal).toBe("0.0000");
      expect(calculated.run.netTotal).toBe("12000.0000");
      const line = calculated.lines[0]!;
      expect(line.statutoryBreakdown.map((row) => row.code)).toEqual(["GOSI-OH"]);
      expect(line.statutoryBreakdown[0]).toMatchObject({
        employeeAmount: "0.0000",
        employerAmount: "240.0000",
      });

      await workflow.submit(run.id, P_ACTOR);
      await workflow.approve(run.id, P_APPROVER);
      const posted = await runPosting.post(run.id, P_ACTOR);
      const lines = await journalLinesOf(posted.journalEntryId!);
      const P = world.purposeAccounts;
      const amountOf = (accountId: string, direction: string): string =>
        lines.find((row) => row.accountId === accountId && row.direction === direction)?.amount ??
        "0.0000";
      expect(amountOf(P.SALARIES_EXPENSE, "DEBIT")).toBe("12000.0000");
      expect(amountOf(P.EMPLOYER_CONTRIBUTIONS, "DEBIT")).toBe("240.0000");
      expect(amountOf(P.DEDUCTIONS_PAYABLE, "CREDIT")).toBe("240.0000");
      expect(amountOf(P.SALARIES_PAYABLE, "CREDIT")).toBe("12000.0000");

      await employees.suspend(world.nsEmployeeId, P_ACTOR);
    });
  });

  it("(f) THE NULL-NATIONALITY FAIL-CLOSED ARM (D-02) — NO statutory lines, the explicit warning, the run still prices and posts clean", async () => {
    await withTenant(TENANT_RUNSTAT, async () => {
      await employees.reactivate(world.nnEmployeeId, P_ACTOR);
      const run = await calculation.createRun({
        fiscalPeriodId: world.periodIds["FY2026-04"]!,
        actorId: P_ACTOR,
      });
      const calculated = await calculation.calculate(run.id, { actorId: P_ACTOR });
      expect(calculated.warnings.unpricedNationality).toHaveLength(1);
      expect(calculated.warnings.unpricedNationality[0]!.employeeCode).toBe("EMP-RS-003");
      expect(calculated.run.statutoryEmployeeTotal).toBe("0.0000");
      expect(calculated.run.statutoryEmployerTotal).toBe("0.0000");
      expect(calculated.run.grossTotal).toBe("7000.0000"); // basic 5,000 + housing 2,000
      expect(calculated.run.deductionsTotal).toBe("0.0000");
      expect(calculated.run.netTotal).toBe("7000.0000");
      expect(calculated.run.statutorySummary).toEqual([]); // no accrual rows
      expect(calculated.lines[0]!.statutoryBreakdown).toEqual([]);

      await workflow.submit(run.id, P_ACTOR);
      await workflow.approve(run.id, P_APPROVER);
      const posted = await runPosting.post(run.id, P_ACTOR);
      const lines = await journalLinesOf(posted.journalEntryId!);
      const P = world.purposeAccounts;
      expect(lines).toHaveLength(2); // no statutory legs at all
      expect(lines.find((row) => row.direction === "DEBIT")!.accountId).toBe(
        P.SALARIES_EXPENSE,
      );
      expect(lines.find((row) => row.direction === "CREDIT")!.accountId).toBe(
        P.SALARIES_PAYABLE,
      );
    });
  });

  it("(g) BR-085 AT THE RUN LEVEL — a REQUIRES_VERIFICATION row that would match refuses the WHOLE calculation typed, zero residue; withdrawn, the run recalculates green", async () => {
    const client: Client = await su();
    await client.query(
      `INSERT INTO statutory_contribution_profiles
         (id, tenant_id, jurisdiction_code, code, name, employee_rate, employer_rate, base_min, base_max,
          contributory_keys, applies_to, effective_from, status, review_note)
       VALUES (gen_random_uuid(), $1, 'SA', 'GOSI-BLOCKED', 'The blocked spec row', 1.0000, 1.0000,
               NULL, NULL, '["HOUSING"]'::jsonb, 'CITIZEN', DATE '2020-01-01', 'REQUIRES_VERIFICATION',
               'the spec''s blocked row (run-level BR-085)')`,
      [TENANT_RUNSTAT],
    );
    await client.end();

    let blockedRunId = "";
    await withTenant(TENANT_RUNSTAT, async () => {
      // NN (null nationality) stays ACTIVE + KSA-EE reactivated: the
      // blocked CITIZEN row would match KSA-EE — the whole calculation
      // refuses typed (BR-085; the audit event records in the service's
      // own UoW and survives the rollback).
      await employees.reactivate(world.ksaEmployeeId, P_ACTOR);
      const run = await calculation.createRun({
        fiscalPeriodId: world.periodIds["FY2026-05"]!,
        actorId: P_ACTOR,
      });
      blockedRunId = run.id;
      await expect(calculation.calculate(run.id, { actorId: P_ACTOR })).rejects.toMatchObject({
        code: "STATUTORY_REQUIRES_VERIFICATION",
      });

      // ZERO RESIDUE: the DRAFT run shell stands, no lines, no totals.
      const after = await calculation.getRun(run.id);
      expect(after.lines).toEqual([]);
      expect(after.run.grossTotal).toBe("0.0000");
    });

    // The refusal's audit event survived the caller's rollback (the
    // service's own UoW — the W-2 law).
    const su2 = await su();
    const events = await su2.query(
      `SELECT action FROM audit_events
        WHERE tenant_id = $1 AND action = 'payroll.statutory_refused' LIMIT 1`,
      [TENANT_RUNSTAT],
    );
    await su2.end();
    expect(events.rows[0]!.action).toBe("payroll.statutory_refused");

    // Withdrawn, the same run recalculates green (the fail-closed gate's
    // other side).
    const su3 = await su();
    await su3.query(
      `DELETE FROM statutory_contribution_profiles
        WHERE tenant_id = $1 AND code = 'GOSI-BLOCKED'`,
      [TENANT_RUNSTAT],
    );
    await su3.end();
    await withTenant(TENANT_RUNSTAT, async () => {
      const calculated = await calculation.calculate(blockedRunId, { actorId: P_ACTOR });
      expect(calculated.lines.length).toBe(2); // KSA-EE + NN
      expect(calculated.run.statutoryEmployeeTotal).toBe("1170.0000"); // KSA-EE priced again
    });
  });
});
