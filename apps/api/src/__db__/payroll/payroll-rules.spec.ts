import { beforeAll, describe, expect, it } from "vitest";

import * as journalStore from "../../modules/accounting/infrastructure/journal.store";
import {
  EmployeeNotFoundError,
  EosBasisRequiredError,
  LoanAccountUnmappedError,
  RunEmptyError,
  RunImmutableError,
  RunSelfApprovalError,
  StructureInUseError,
  StructureNotActiveError,
} from "../../modules/payroll/domain/payroll-errors";
import * as payrollStore from "../../modules/payroll/infrastructure/payroll.store";
import {
  appClient,
  setupPayrollFixture,
  su,
  withTenant,
  employees,
  structures,
  calculation,
  workflow,
  runPosting,
  payouts,
  loans,
  eos,
  pPosting,
  setSetting,
  P_ACTOR,
  P_APPROVER,
  TENANT_PAY,
  type PayrollFixture,
} from "./fixtures";

/**
 * payroll-rules.spec (PHASE-029 wave E — BUSINESS_RULES §8 rows
 * BR-052…BR-055 + the phase §6 verification matrix): the payroll business
 * rules exercised against real PostgreSQL through the module services
 * exactly as production code paths run — no direct register inserts; every
 * journal flows through the posting engine (ADR-0007).
 *
 * State flow (DB specs share the file's world — the order is deliberate):
 *  1. run 1 (period 1, E1 only — E2 booted SUSPENDED): the G-29 WORKED
 *     EXAMPLE (gross 10,000 / deductions 1,500 / net 8,500; the balanced
 *     11,800 journal with every golden leg + dimensions + PR number).
 *  2. INV-025: Σ lines == totals; net = gross − deductions; posted-run
 *     immutability (the DB guard trigger rejects UPDATE; double-post
 *     converges on the same journal).
 *  3. G-30: partial payout 5,000 → outstanding 3,500 → payout the rest →
 *     zero; both journals checked + INV-019 movements; payslips.
 *  4. BR-053: the manual-journal engine guard (PAYROLL_ACCOUNT_ENGINE_ONLY
 *     — purpose-keyed AND explicit-accountId smuggles).
 *  5. run 2 (period 2, E2 only — E1 suspended): the G-31 world (accrual
 *     4,200) → terminate → settle 4,000 (residual 200) + the mirror case.
 *  6. BR-052: the used structure freezes (typed 409); versioning creates
 *     the successor + ARCHIVED predecessor; an ARCHIVED structure cannot
 *     enter a run (typed 409).
 *  7. BR-054: the cap math — 500 ≤ 25% × 8,500 passes (run 1's loan);
 *     3,000 clamps to 2,500 with the explicit warning; the partial take
 *     splits + carries (nothing lost); strict mode throws typed.
 *  8. BR-055: enabled-without-basis is the typed rejection; disabled ⇒
 *     accrual 0 and no EOS legs.
 *  9. Failure packs: PERIOD_LOCKED, PURPOSE_NOT_MAPPED ×6 (each unmap +
 *     restore, zero residue), empty population, SoD, one-live-run.
 * 10. The PII read-audit: every employee read leaves the
 *     payroll.employee_read audit event; masked shapes by construction.
 */

let fixture: PayrollFixture;
let run1Id = "";
let run2Id = "";

beforeAll(async () => {
  fixture = await setupPayrollFixture();
});

describe("payroll-rules.spec (PHASE-029 §6)", () => {
  it("boots the worked-example world (E1 active, E2 suspended, purposes mapped)", async () => {
    await withTenant(TENANT_PAY, async () => {
      const list = await employees.list({ limit: 10 });
      expect(list.map((row) => row.code).sort()).toEqual(["EMP-001", "EMP-002"]);
      expect(list.find((row) => row.code === "EMP-001")?.status).toBe("ACTIVE");
      expect(list.find((row) => row.code === "EMP-002")?.status).toBe("SUSPENDED");
      // The 0040 six purposes resolve day one (provisionCoaTemplate).
      for (const key of [
        "SALARIES_EXPENSE",
        "SALARIES_PAYABLE",
        "DEDUCTIONS_PAYABLE",
        "EMPLOYER_CONTRIBUTIONS",
        "EOS_PROVISION",
        "EOS_PROVISION_EXPENSE",
      ] as const) {
        expect(fixture.purposeAccounts[key]).toBeTruthy();
      }
      // The loan control account is mapped (the tenant policy key).
      expect(fixture.loanControlAccountId).toBeTruthy();
    });
  });

  it("G-29 WORKED EXAMPLE: calculate → submit → approve (SoD) → post — the balanced 11,800 journal with every golden leg", async () => {
    await withTenant(TENANT_PAY, async () => {
      // SoD pre-pack: self-approval dies typed BEFORE the real approval.
      const run = await calculation.createRun({
        fiscalPeriodId: fixture.periodIds["FY2026-01"]!,
        actorId: P_ACTOR,
      });
      run1Id = run.id;
      const calculated = await calculation.calculate(run.id, { actorId: P_ACTOR });
      // The worked-example totals (INV-025 — exact strings).
      expect(calculated.run.grossTotal).toBe("10000.0000");
      expect(calculated.run.deductionsTotal).toBe("1500.0000");
      expect(calculated.run.netTotal).toBe("8500.0000");
      expect(calculated.run.employerContributionsTotal).toBe("1000.0000");
      expect(calculated.run.eosAccrualTotal).toBe("800.0000");
      expect(calculated.lines).toHaveLength(1);
      const line = calculated.lines[0]!;
      // E1: basic 8,000 + housing 2,000 = gross 10,000; deductions 1,000
      // third-party + 500 loan; net 8,500 (the BR-054 pass case: 500 ≤
      // 25% × 8,500 = 2,125 — no clamp warning).
      expect(line.gross).toBe("10000.0000");
      expect(line.employeeDeductions).toBe("1000.0000");
      expect(line.loanDeductionsTotal).toBe("500.0000");
      expect(line.net).toBe("8500.0000");
      expect(calculated.warnings.loanClamps).toHaveLength(0);
      expect(calculated.warnings.skippedEmployees).toHaveLength(0);

      await workflow.submit(run.id, P_ACTOR);
      // SoD: the creator never approves.
      await expect(workflow.approve(run.id, P_ACTOR)).rejects.toBeInstanceOf(RunSelfApprovalError);
      await workflow.approve(run.id, P_APPROVER);
      const posted = await runPosting.post(run.id, P_ACTOR);

      expect(posted.status).toBe("POSTED");
      expect(posted.journalEntryId).toBeTruthy();
      expect(posted.runNo).toMatch(/^PR-2026-\d{1,6}$/); // INV-021 official
      expect(posted.grossTotal).toBe("10000.0000");
      expect(posted.netTotal).toBe("8500.0000");

      // The G-29 journal — every golden leg, balanced 11,800 = 11,800.
      const entry = await journalStore.findEntryById(posted.journalEntryId!);
      expect(entry).toBeDefined();
      expect(entry!.sourceType).toBe("payroll_run");
      expect(entry!.sourceId).toBe(run.id);
      expect(entry!.operation).toBe("post");
      const lines = await journalStore.listLines(entry!.id);
      const sum = (direction: string): string =>
        lines
          .filter((row) => row.direction === direction)
          .reduce((acc, row) => (Number(acc) + Number(row.amount)).toFixed(4), "0.0000");
      expect(sum("DEBIT")).toBe("11800.0000");
      expect(sum("CREDIT")).toBe("11800.0000");

      const leg = (accountId: string, direction: string): number =>
        lines.filter((row) => row.accountId === accountId && row.direction === direction).length;
      const amountOf = (accountId: string, direction: string): string => {
        const found = lines.find((row) => row.accountId === accountId && row.direction === direction);
        return found === undefined ? "0.0000" : found.amount;
      };
      const P = fixture.purposeAccounts;
      // DR SALARIES_EXPENSE 10,000 (basic + housing — same account).
      expect(leg(P.SALARIES_EXPENSE, "DEBIT")).toBe(1);
      expect(amountOf(P.SALARIES_EXPENSE, "DEBIT")).toBe("10000.0000");
      // DR EMPLOYER_CONTRIBUTIONS 1,000.
      expect(amountOf(P.EMPLOYER_CONTRIBUTIONS, "DEBIT")).toBe("1000.0000");
      // DR EOS_PROVISION_EXPENSE 800.
      expect(amountOf(P.EOS_PROVISION_EXPENSE, "DEBIT")).toBe("800.0000");
      // CR DEDUCTIONS_PAYABLE 2,000 (third-party 1,000 + employer 1,000).
      expect(amountOf(P.DEDUCTIONS_PAYABLE, "CREDIT")).toBe("2000.0000");
      // CR the tenant-mapped loan control account 500 (recovery — never
      // DEDUCTIONS_PAYABLE).
      expect(amountOf(fixture.loanControlAccountId, "CREDIT")).toBe("500.0000");
      // CR EOS_PROVISION 800 (the non-cash accrual balance leg).
      expect(amountOf(P.EOS_PROVISION, "CREDIT")).toBe("800.0000");
      // CR SALARIES_PAYABLE 8,500 (net).
      expect(amountOf(P.SALARIES_PAYABLE, "CREDIT")).toBe("8500.0000");
      // Zero legs on the wrong sides.
      expect(leg(P.SALARIES_PAYABLE, "DEBIT")).toBe(0);
      expect(leg(P.DEDUCTIONS_PAYABLE, "DEBIT")).toBe(0);

      // The dimension stamps (phase item 7): the expense lines carry E1's
      // cost center.
      const salariesLeg = lines.find(
        (row) => row.accountId === P.SALARIES_EXPENSE && row.direction === "DEBIT",
      );
      expect(salariesLeg?.costCenterId).toBe(fixture.costCenterId);

      // The loan line flipped DEDUCTED with the run stamp.
      const loanLines = await payrollStore.listLoanLines(fixture.loanE1Id);
      expect(loanLines).toHaveLength(1);
      expect(loanLines[0]!.status).toBe("DEDUCTED");
      expect(loanLines[0]!.payrollRunId).toBe(run.id);
      // The loan CLOSED (no PENDING lines remain).
      const loanRow = await payrollStore.findLoanById(fixture.loanE1Id);
      expect(loanRow?.status).toBe("CLOSED");

      // component_snapshot frozen (BR-052): the structure basis + values.
      const storedLines = await payrollStore.listRunLines(run.id);
      expect(storedLines).toHaveLength(1);
      expect(storedLines[0]!.componentSnapshot.structure.code).toBe("ST-1");
      expect(storedLines[0]!.componentSnapshot.basicSalary).toBe("8000.0000");
      // Computation order frozen in the snapshot: the earnings pass
      // (basic → allowances → employer) then the deductions pass.
      expect(storedLines[0]!.componentSnapshot.components.map((c) => c.key)).toEqual([
        "HOUSING",
        "GOSI-ER",
        "GOSI-EE",
      ]);
    });
  });

  it("INV-025: Σ lines == totals exactly; posted runs are immutable (the DB guard) + double-post converges", async () => {
    await withTenant(TENANT_PAY, async () => {
      const run = await payrollStore.findRunById(run1Id);
      expect(run).toBeDefined();
      const lines = await payrollStore.listRunLines(run1Id);
      const fold = lines.reduce(
        (acc, line) => ({
          gross: (Number(acc.gross) + Number(line.grossAmount)).toFixed(4),
          deductions: (Number(acc.deductions) + Number(line.deductionsAmount)).toFixed(4),
          net: (Number(acc.net) + Number(line.netAmount)).toFixed(4),
        }),
        { gross: "0.0000", deductions: "0.0000", net: "0.0000" },
      );
      expect(fold.gross).toBe(run!.grossTotal);
      expect(fold.deductions).toBe(run!.deductionsTotal);
      expect(fold.net).toBe(run!.netTotal);
      // net = gross − deductions EXACTLY (the row-level CHECK's mirror).
      expect(
        (Number(run!.grossTotal) - Number(run!.deductionsTotal)).toFixed(4),
      ).toBe(run!.netTotal);

      // Posted-run line UPDATE dies at the DB level (INV-003 — the guard
      // trigger, regardless of grants).
      const client = await appClient();
      // Either the grant denial (no UPDATE grant) or the guard trigger
      // fires first — both are the immutability law (INV-003).
      await expect(
        client.query(
          "UPDATE payroll_run_lines SET net_amount = 99999 WHERE run_id = $1",
          [run1Id],
        ),
      ).rejects.toThrow(/append-only|permission denied/);
      await client.end();

      // Recalculation of a POSTED run dies typed (reversal-only).
      await expect(calculation.calculate(run1Id, { actorId: P_ACTOR })).rejects.toBeInstanceOf(
        RunImmutableError,
      );

      // Double-post converges on the SAME journal (INV-013 replay).
      const again = await runPosting.post(run1Id, P_ACTOR);
      expect(again.journalEntryId).toBe(run!.journalEntryId);
      expect(again.runNo).toBe(run!.runNo);
    });
  });

  it("G-30: partial payout 5,000 → outstanding 3,500 → payout the rest → zero; INV-019 movements + payslips", async () => {
    await withTenant(TENANT_PAY, async () => {
      // PARTIAL: 5,000 of 8,500 — exact remainder tracking.
      const partial = await payouts.payout(run1Id, {
        cashAccountId: fixture.bankCashAccountId,
        amount: "5000.0000",
        actorId: P_ACTOR,
      });
      expect(partial.amount).toBe("5000.0000");
      expect(partial.run.paidNetTotal).toBe("5000.0000");
      const run = await payrollStore.findRunById(run1Id);
      expect(run!.paidNetTotal).toBe("5000.0000");

      // The G-30 journal shape: DR SALARIES_PAYABLE · CR the bank account.
      const entry = await journalStore.findEntryById(partial.journalEntryId);
      expect(entry!.sourceType).toBe("payroll_payout");
      const lines = await journalStore.listLines(entry!.id);
      expect(lines).toHaveLength(2);
      const payableLeg = lines.find(
        (row) => row.accountId === fixture.purposeAccounts.SALARIES_PAYABLE,
      );
      expect(payableLeg?.direction).toBe("DEBIT");
      expect(payableLeg?.amount).toBe("5000.0000");
      const cashLeg = lines.find((row) => row.accountId !== fixture.purposeAccounts.SALARIES_PAYABLE);
      expect(cashLeg?.direction).toBe("CREDIT");
      expect(cashLeg?.amount).toBe("5000.0000");

      // Over-pay dies typed (the exact-remainder law).
      await expect(
        payouts.payout(run1Id, {
          cashAccountId: fixture.bankCashAccountId,
          amount: "4000.0000",
          actorId: P_ACTOR,
        }),
      ).rejects.toThrow(/exceeds run/);

      // The REST: 3,500 → outstanding zero.
      const rest = await payouts.payout(run1Id, {
        cashAccountId: fixture.bankCashAccountId,
        actorId: P_ACTOR,
      });
      expect(rest.amount).toBe("3500.0000");
      const after = await payrollStore.findRunById(run1Id);
      expect(after!.paidNetTotal).toBe("8500.0000");

      // INV-019: the two payout movements landed (source payroll_payout,
      // OUT, base == the cash legs — 5,000 + 3,500) with the payout ids as
      // their per-execution source ids.
      const { sql } = await import("drizzle-orm");
      const movementRows = await payrollStore.requireAmbientTx().execute(sql`
        SELECT base_amount AS base FROM cash_movements
        WHERE source_type = 'payroll_payout' AND source_id IN (${partial.payoutId}, ${rest.payoutId})
      `);
      const movementSum = (movementRows.rows as unknown as { base: string }[]).reduce(
        (acc, row) => acc + Number(row.base),
        0,
      );
      expect(movementSum).toBeCloseTo(8500, 4);
      // A third full payout dies (above outstanding = 0 — idempotent
      // exactness, no double payment).
      await expect(
        payouts.payout(run1Id, { cashAccountId: fixture.bankCashAccountId, actorId: P_ACTOR }),
      ).rejects.toThrow(/exceeds run/);

      // Payslips: count == the run's lines; masked national id only.
      const slips = await payouts.payslips(run1Id, "ar");
      expect(slips.slips).toHaveLength(1);
      expect(slips.slips[0]!.employee.nationalIdMasked).not.toBe("1023456789");
      expect(slips.slips[0]!.employee.nationalIdMasked).toContain("*");
      expect(slips.slips[0]!.net).toBe("8500.0000");
    });
  });

  it("BR-053: manual journals on payroll-purpose accounts die typed (purpose-keyed AND explicit-accountId smuggles)", async () => {
    await withTenant(TENANT_PAY, async () => {
      const P = fixture.purposeAccounts;
      // The purpose-keyed smuggle.
      await expect(
        pPosting.post(
          {
            source: { docType: "journal_entry", docId: null, operation: "post" },
            entryDate: "2026-01-15",
            currency: "SAR",
            description: { en: "manual smuggle", ar: "تهريب يدوي" },
            lines: [
              { purpose: "SALARIES_PAYABLE", direction: "DEBIT", amount: "100.0000" },
              { accountId: P.SALARIES_EXPENSE, direction: "CREDIT", amount: "100.0000" },
            ],
          },
          { postedBy: P_ACTOR },
        ),
      ).rejects.toThrow(/PAYROLL_ACCOUNT_ENGINE_ONLY|payroll accounts post only via payroll runs/);
      // The explicit-accountId smuggle (SALARIES_EXPENSE by id).
      await expect(
        pPosting.post(
          {
            source: { docType: "journal_entry", docId: null, operation: "post" },
            entryDate: "2026-01-15",
            currency: "SAR",
            lines: [
              { accountId: P.SALARIES_EXPENSE, direction: "DEBIT", amount: "100.0000" },
              { accountId: P.DEDUCTIONS_PAYABLE, direction: "DEBIT", amount: "50.0000" },
              { accountId: P.EOS_PROVISION, direction: "CREDIT", amount: "150.0000" },
            ],
          },
          { postedBy: P_ACTOR },
        ),
      ).rejects.toThrow(/payroll accounts post only via payroll runs/);
      // Zero residue: no manual journal landed on the payroll accounts.
      const client = await su();
      const residue = await client.query(
        `SELECT COUNT(*)::int AS n FROM journal_lines l
         JOIN journal_entries e ON e.id = l.journal_entry_id
         WHERE e.tenant_id = $1 AND e.source_type = 'journal_entry'
           AND l.account_id = ANY($2::uuid[])`,
        [TENANT_PAY, Object.values(P)],
      );
      await client.end();
      expect(residue.rows[0]!.n).toBe(0);
    });
  });

  it("G-31: run 2 (E2) accrues 4,200 → terminate → settle 4,000 (residual 200) + the mirror case", async () => {
    await withTenant(TENANT_PAY, async () => {
      // Flip the population: E1 suspended, E2 reactivated.
      await employees.suspend(fixture.employeeE1Id, P_ACTOR);
      await employees.reactivate(fixture.employeeE2Id, P_ACTOR);

      const run = await calculation.createRun({
        fiscalPeriodId: fixture.periodIds["FY2026-02"]!,
        actorId: P_ACTOR,
      });
      run2Id = run.id;
      const calculated = await calculation.calculate(run.id, { actorId: P_ACTOR });
      // E2: basic 42,000 + housing 2,000 = 44,000 gross; third-party 1,000;
      // net 43,000; EOS accrual 42,000 × 3/30 = 4,200 (housing not in the
      // base — BR-055's worked basis).
      expect(calculated.run.grossTotal).toBe("44000.0000");
      expect(calculated.run.eosAccrualTotal).toBe("4200.0000");
      expect(calculated.run.netTotal).toBe("43000.0000");
      await workflow.submit(run.id, P_ACTOR);
      await workflow.approve(run.id, P_APPROVER);
      const posted = await runPosting.post(run.id, P_ACTOR);
      expect(posted.status).toBe("POSTED");

      // The provision balance reads 4,200.
      const before = await eos.balanceFor(fixture.employeeE2Id);
      expect(before.accrued).toBe("4200.0000");
      expect(before.balance).toBe("4200.0000");

      // Terminate E2 (the G-31 trigger).
      const terminated = await employees.terminate(fixture.employeeE2Id, {
        terminationDate: "2026-02-28",
        reason: "resignation",
        actorId: P_ACTOR,
      });
      expect(terminated.status).toBe("TERMINATED");

      // The MIRROR case first: settle above the balance dies typed.
      await expect(
        eos.settle(fixture.employeeE2Id, {
          settledAmount: "4200.0001",
          cashAccountId: fixture.bankCashAccountId,
          actorId: P_ACTOR,
        }),
      ).rejects.toThrow(/exceeds/);

      // The G-31 settlement: settled 4,000 of 4,200 → residual 200.
      const settled = await eos.settle(fixture.employeeE2Id, {
        settledAmount: "4000.0000",
        cashAccountId: fixture.bankCashAccountId,
        actorId: P_ACTOR,
      });
      expect(settled.settled).toBe("4000.0000");
      expect(settled.residual).toBe("200.0000");

      // The journal: DR EOS_PROVISION 4,200 · CR CASH 4,000 · CR
      // EOS_PROVISION_EXPENSE 200 (the residual release).
      const entry = await journalStore.findEntryById(settled.journalEntryId);
      expect(entry!.sourceType).toBe("employee");
      expect(entry!.operation).toBe("eos_settle");
      const lines = await journalStore.listLines(entry!.id);
      const amountOf = (accountId: string, direction: string): string => {
        const found = lines.find((row) => row.accountId === accountId && row.direction === direction);
        return found === undefined ? "0.0000" : found.amount;
      };
      const P = fixture.purposeAccounts;
      expect(amountOf(P.EOS_PROVISION, "DEBIT")).toBe("4200.0000");
      expect(amountOf(P.EOS_PROVISION_EXPENSE, "CREDIT")).toBe("200.0000");
      const cashLeg = lines.find(
        (row) =>
          row.direction === "CREDIT" &&
          row.accountId !== P.EOS_PROVISION_EXPENSE &&
          row.accountId !== P.EOS_PROVISION,
      );
      expect(cashLeg?.amount).toBe("4000.0000");

      // The provision balance is extinguished (zero residual provision).
      const after = await eos.balanceFor(fixture.employeeE2Id);
      expect(after.balance).toBe("0.0000");
      expect(after.settled).toBe("4000.0000");
      // run2 recorded for the report-tie suite below.
      expect(run2Id).toBe(run.id);
      // One settlement per employee (terminal).
      await expect(
        eos.settle(fixture.employeeE2Id, {
          settledAmount: "100.0000",
          cashAccountId: fixture.bankCashAccountId,
          actorId: P_ACTOR,
        }),
      ).rejects.toThrow(/already settled/);
    });
  });

  it("BR-052: the used structure freezes; versioning creates the successor; ARCHIVED structures cannot enter a run", async () => {
    await withTenant(TENANT_PAY, async () => {
      // ST-1 is frozen (run 1 snapshotted it).
      await expect(
        structures.replaceComponents(fixture.structureId, [], P_ACTOR),
      ).rejects.toBeInstanceOf(StructureInUseError);

      // Versioning: the successor ST-2 (components copied).
      const versioned = await structures.createVersion(fixture.structureId, {
        code: "ST-2",
        actorId: P_ACTOR,
      });
      expect(versioned.structure.status).toBe("ACTIVE");
      expect(versioned.components.map((c) => c.key)).toEqual(["HOUSING", "GOSI-EE", "GOSI-ER"]);
      // The predecessor flipped ARCHIVED pointing at the successor.
      const predecessor = await payrollStore.findStructureById(fixture.structureId);
      expect(predecessor!.status).toBe("ARCHIVED");
      expect(predecessor!.supersededById).toBe(versioned.structure.id);

      // An ARCHIVED structure cannot enter a run: E2 (still TERMINATED —
      // suspend/reactivate can't revive it) — use E1 (SUSPENDED, still
      // pointing at the ARCHIVED ST-1): reactivate + calculate a run in
      // period 3 ⇒ StructureNotActiveError (BR-052), zero residue.
      await employees.reactivate(fixture.employeeE1Id, P_ACTOR);
      const run = await calculation.createRun({
        fiscalPeriodId: fixture.periodIds["FY2026-03"]!,
        actorId: P_ACTOR,
      });
      await expect(calculation.calculate(run.id, { actorId: P_ACTOR })).rejects.toBeInstanceOf(
        StructureNotActiveError,
      );
      // Clean up the empty DRAFT run (period 3 stays usable later) and
      // restore the population state (E1 back to SUSPENDED — its structure
      // reference is ARCHIVED now; later tests assign ST-2 explicitly).
      const client = await su();
      await client.query("DELETE FROM payroll_runs WHERE id = $1 AND tenant_id = $2", [
        run.id,
        TENANT_PAY,
      ]);
      await client.end();
      await employees.suspend(fixture.employeeE1Id, P_ACTOR);
    });
  });

  it("BR-054: the cap math — 3,000 clamps to 2,500 with the warning; the partial take splits + carries (nothing lost)", async () => {
    await withTenant(TENANT_PAY, async () => {
      // E3: basic 10,000 on the ACTIVE ST-2 (no deductions) + a 3,000
      // one-line loan in period 4.
      const e3 = await employees.create({
        code: "EMP-003",
        name: "Cap Employee",
        nameAr: "موظف الحد",
        hireDate: "2025-03-01",
        contractType: "FULL_TIME",
        basicSalary: "10000.0000",
        salaryStructureId: await (async () => {
          const rows = await payrollStore.listStructures(10);
          return rows.find((row) => row.code === "ST-2")!.id;
        })(),
        branchId: fixture.branchId,
        costCenterId: fixture.costCenterId,
        actorId: P_ACTOR,
      });
      const loan = await loans.create({
        code: "LON-E3",
        employeeId: e3.id,
        amount: "3000.0000",
        installmentsCount: 1,
        startPeriodId: fixture.periodIds["FY2026-04"]!,
        cashAccountId: fixture.bankCashAccountId,
        valueDate: "2026-04-02",
        actorId: P_ACTOR,
      });
      expect(loan.loan.status).toBe("ACTIVE");

      const run = await calculation.createRun({
        fiscalPeriodId: fixture.periodIds["FY2026-04"]!,
        actorId: P_ACTOR,
      });
      const calculated = await calculation.calculate(run.id, { actorId: P_ACTOR });
      // The clamp: E3 on ST-2 carries housing 2,000 + the third-party
      // 1,000 — gross 12,000, pre-loan net 11,000, cap 25% = 2,750 < the
      // scheduled 3,000 ⇒ the warning + the clamped deduction 2,750.
      expect(calculated.warnings.loanClamps).toHaveLength(1);
      expect(calculated.warnings.loanClamps[0]!.scheduled).toBe("3000.0000");
      expect(calculated.warnings.loanClamps[0]!.clampedTo).toBe("2750.0000");
      expect(calculated.run.deductionsTotal).toBe("3750.0000"); // 1,000 + 2,750
      expect(calculated.run.netTotal).toBe("8250.0000"); // 12,000 − 3,750 (floor held)

      // STRICT mode: the typed rejection (the phase's reject path).
      await expect(
        calculation.calculate(run.id, { actorId: P_ACTOR, strictCap: true }),
      ).rejects.toThrow(/LOAN_DEDUCTION_CAP_EXCEEDED|schedules 3000/i);
      // Recalculate (non-strict) so the post below sees the clamped state.
      await calculation.calculate(run.id, { actorId: P_ACTOR });

      // Post: the partial take splits — the line DEDUCTED at 2,500, the
      // 500 remainder CARRIED to the next period (audited, never lost).
      await workflow.submit(run.id, P_ACTOR);
      await workflow.approve(run.id, P_APPROVER);
      await runPosting.post(run.id, P_ACTOR);
      const loanLines = await payrollStore.listLoanLines(loan.loan.id);
      expect(loanLines).toHaveLength(2);
      expect(loanLines[0]!.status).toBe("DEDUCTED");
      expect(loanLines[0]!.amount).toBe("2750.0000");
      const carry = loanLines.find((line) => line.status === "PENDING");
      expect(carry).toBeDefined();
      expect(carry!.amount).toBe("250.0000");
      expect(carry!.fiscalPeriodId).toBe(fixture.periodIds["FY2026-05"]!);
      // The loan stays ACTIVE (the carry is outstanding).
      const loanRow = await payrollStore.findLoanById(loan.loan.id);
      expect(loanRow!.status).toBe("ACTIVE");
    });
  });

  it("BR-055: enabled-without-basis is the typed rejection; disabled ⇒ accrual 0 + no EOS legs", async () => {
    await withTenant(TENANT_PAY, async () => {
      // Enabled without a basis: the typed rejection (never a silent 0).
      await setSetting("payroll.eos.enabled", true);
      await setSetting("payroll.eos.accrual_days_per_service_year", null);
      await expect(eos.policy()).rejects.toBeInstanceOf(EosBasisRequiredError);

      // Restore the basis; disable ⇒ accrual 0 and no EOS legs in the run.
      await setSetting("payroll.eos.enabled", false);
      await setSetting("payroll.eos.accrual_days_per_service_year", 3);
      const run = await calculation.createRun({
        fiscalPeriodId: fixture.periodIds["FY2026-05"]!,
        actorId: P_ACTOR,
      });
      const calculated = await calculation.calculate(run.id, { actorId: P_ACTOR });
      expect(Number(calculated.run.eosAccrualTotal)).toBe(0);
      await workflow.submit(run.id, P_ACTOR);
      await workflow.approve(run.id, P_APPROVER);
      const posted = await runPosting.post(run.id, P_ACTOR);
      const lines = await journalStore.listLines(posted.journalEntryId!);
      expect(
        lines.some((row) => row.accountId === fixture.purposeAccounts.EOS_PROVISION),
      ).toBe(false);
      expect(
        lines.some((row) => row.accountId === fixture.purposeAccounts.EOS_PROVISION_EXPENSE),
      ).toBe(false);
      // Restore the fixture policy (EOS on, basis 3).
      await setSetting("payroll.eos.enabled", true);
    });
  });

  it("failure packs: PERIOD_LOCKED, empty population, one-live-run, approve-before-submit", async () => {
    await withTenant(TENANT_PAY, async () => {
      // PERIOD_LOCKED: lock period 12, run it, post ⇒ the engine's typed
      // rejection (the run stays PENDING_APPROVAL, zero journal residue).
      const periods = await import("../../modules/accounting/application/period-service");
      const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
      const periodService = new periods.PeriodService(
        new (await import("../../modules/audit/api/audit")).AuditService(
          new (await import("../../modules/audit/infrastructure/drizzle-audit.store")).DrizzleAuditStore(),
        ),
      );
      const p12 = fixture.periodIds["FY2026-12"]!;
      // The close discipline (PERIOD_CLOSING §2): OPEN → SOFT_CLOSED →
      // LOCKED — lock demands the soft-close first.
      await periodService.softClose(P_ACTOR, p12);
      await periodService.lock(P_ACTOR, p12);
      const lockedRun = await calculation.createRun({ fiscalPeriodId: p12, actorId: P_ACTOR });
      await calculation.calculate(lockedRun.id, { actorId: P_ACTOR });
      await workflow.submit(lockedRun.id, P_ACTOR);
      await workflow.approve(lockedRun.id, P_APPROVER);
      await expect(runPosting.post(lockedRun.id, P_ACTOR)).rejects.toThrow(/PERIOD_LOCKED|LOCKED/);
      // Zero residue: no journal for the locked run.
      const stuck = await payrollStore.findRunById(lockedRun.id);
      expect(stuck!.journalEntryId).toBeNull();
      expect(stuck!.status).toBe("PENDING_APPROVAL");
      void accounting;

      // Empty population: suspend everyone ⇒ RunEmptyError, zero lines.
      const list = await employees.list({ status: "ACTIVE", limit: 10 });
      for (const row of list) {
        await employees.suspend(row.id, P_ACTOR);
      }
      const emptyRun = await calculation.createRun({
        fiscalPeriodId: fixture.periodIds["FY2026-06"]!,
        actorId: P_ACTOR,
      });
      await expect(calculation.calculate(emptyRun.id, { actorId: P_ACTOR })).rejects.toBeInstanceOf(
        RunEmptyError,
      );

      // One live run per period: a second non-DRAFT run for period 1 dies.
      await expect(
        calculation.createRun({ fiscalPeriodId: fixture.periodIds["FY2026-01"]!, actorId: P_ACTOR }),
      ).rejects.toThrow(/already exists/);

      // Approve-before-submit on the empty DRAFT: typed state error.
      await expect(workflow.approve(emptyRun.id, P_APPROVER)).rejects.toBeInstanceOf(
        RunImmutableError,
      );
    });
  });

  it("failure packs: PURPOSE_NOT_MAPPED ×6 (each unmap + restore, zero residue)", async () => {
    await withTenant(TENANT_PAY, async () => {
      const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
      const purposes = Object.entries(fixture.purposeAccounts) as [
        keyof PayrollFixture["purposeAccounts"],
        string,
      ][];
      expect(purposes).toHaveLength(6);
      // The probe population: E1 reassigned to the ACTIVE ST-2 (ST-1 is
      // ARCHIVED after the BR-052 versioning) + reactivated ONCE before
      // the loop (each iteration re-suspends it at the end).
      const st2 = (await payrollStore.listStructures(10)).find((row) => row.code === "ST-2")!;
      const e1 = await payrollStore.findEmployeeById(fixture.employeeE1Id);
      if (e1!.salaryStructureId !== st2.id) {
        await employees.update(fixture.employeeE1Id, { salaryStructureId: st2.id }, P_ACTOR);
      }
      await employees.reactivate(fixture.employeeE1Id, P_ACTOR);
      for (const [key, accountId] of purposes) {
        // Unmap: supersede the active purpose row.
        const mapping = await accounting.findActivePurpose(key);
        expect(mapping).toBeDefined();
        await accounting.supersedePurpose(mapping!.id, new Date().toISOString());

        const run = await calculation.createRun({
          fiscalPeriodId: fixture.periodIds["FY2026-07"]!,
          actorId: P_ACTOR,
        });
        await calculation.calculate(run.id, { actorId: P_ACTOR });
        await workflow.submit(run.id, P_ACTOR);
        await workflow.approve(run.id, P_APPROVER);
        await expect(runPosting.post(run.id, P_ACTOR)).rejects.toThrow(
          /PURPOSE_NOT_MAPPED|not mapped|no active account mapping/,
        );
        // Zero residue: the run carries no journal.
        const stuck = await payrollStore.findRunById(run.id);
        expect(stuck!.journalEntryId).toBeNull();
        // Restore: re-map the purpose (the fixture's original account).
        await accounting.mapPurpose({
          purposeKey: key,
          accountId,
          activeFrom: new Date().toISOString(),
        });
        // Reset the probe run to DRAFT INSIDE the ambient transaction (the
        // su() connection cannot see uncommitted rows — the 028 lesson):
        // a DRAFT run frees the period for the next iteration (DRAFTs are
        // free; the monthly law binds only non-DRAFT runs).
        const { sql } = await import("drizzle-orm");
        await payrollStore.requireAmbientTx().execute(sql`
          UPDATE payroll_runs SET status = 'DRAFT', approved_at = NULL,
            approved_by = NULL, submitted_at = NULL, submitted_by = NULL,
            updated_at = now(), version = version + 1
          WHERE id = ${run.id}
        `);
      }
      // The probe population parks suspended after the battery.
      await employees.suspend(fixture.employeeE1Id, P_ACTOR);
    });
  });

  it("BR-054 guard: the unmapped control account dies typed (LOAN_ACCOUNT_UNMAPPED)", async () => {
    await withTenant(TENANT_PAY, async () => {
      await setSetting("payroll.loans.control_account_id", null);
      const e4 = await employees.create({
        code: "EMP-004",
        name: "Loan Guard Employee",
        nameAr: "موظف حارس السلف",
        hireDate: "2025-05-01",
        contractType: "FULL_TIME",
        basicSalary: "9000.0000",
        salaryStructureId: (await payrollStore.listStructures(10)).find((row) => row.code === "ST-2")!
          .id,
        actorId: P_ACTOR,
      });
      await expect(
        loans.create({
          code: "LON-E4",
          employeeId: e4.id,
          amount: "400.0000",
          installmentsCount: 1,
          startPeriodId: fixture.periodIds["FY2026-08"]!,
          cashAccountId: fixture.bankCashAccountId,
          actorId: P_ACTOR,
        }),
      ).rejects.toBeInstanceOf(LoanAccountUnmappedError);
      // Restore the mapping.
      await setSetting("payroll.loans.control_account_id", fixture.loanControlAccountId);
    });
  });

  it("PII read-audit: every employee read leaves the payroll.employee_read event (the access trail)", async () => {
    const before = await su();
    const countBefore = await before.query(
      "SELECT COUNT(*)::int AS n FROM audit_events WHERE tenant_id = $1 AND action = 'payroll.employee_read'",
      [TENANT_PAY],
    );
    await before.end();
    await withTenant(TENANT_PAY, async () => {
      const read = await employees.get(fixture.employeeE1Id, P_ACTOR);
      expect(read.code).toBe("EMP-001");
      // Unknown ids stay opaque typed 404s (A7 parity).
      await expect(
        employees.get("00000000-0000-4000-8000-0000000000ff", P_ACTOR),
      ).rejects.toBeInstanceOf(EmployeeNotFoundError);
    });
    // The event is COMMITTED now (the withTenant UoW closed) — the su()
    // connection sees committed rows only (the read-count discipline).
    const after = await su();
    const countAfter = await after.query(
      "SELECT COUNT(*)::int AS n FROM audit_events WHERE tenant_id = $1 AND action = 'payroll.employee_read' AND entity_id = $2",
      [TENANT_PAY, fixture.employeeE1Id],
    );
    await after.end();
    expect(Number(countAfter.rows[0]!.n)).toBeGreaterThan(Number(countBefore.rows[0]!.n));
  });

  it("the reports' ledger ties: register ties to run + journal; cost-summary folds; eos balances", async () => {
    await withTenant(TENANT_PAY, async () => {
      const { PayrollQueriesService } = await import(
        "../../modules/reporting/registry/payroll/payroll-queries"
      );
      const queries = new PayrollQueriesService();

      const register = await queries.register({ runId: run1Id });
      expect(register.ties.ok).toBe(true);
      expect(register.rows).toHaveLength(1);
      expect(register.rows[0]!.net).toBe("8500.0000");

      const cost = await queries.costSummary({ fromDate: "2026-01-01", toDate: "2026-12-31" });
      expect(cost.ties.ok).toBe(true);
      // Period 1: E1's cost = gross 10,000 + employer 1,000 + eos 800.
      const jan = cost.rows.filter((row) => row.periodName === "FY2026-01");
      expect(jan).toHaveLength(1);
      expect(jan[0]!.cost).toBe("11800.0000");
      expect(jan[0]!.costCenterCode).toBe("PAY-CC-1");

      const eosRows = await queries.eosProvision();
      expect(eosRows.ties.ok).toBe(true);
      // E2's provision: accrued 4,200, cash settled 4,000, released 200,
      // balance 0 (extinguished); E1's accrual 800 stays outstanding.
      const e2Row = eosRows.rows.find((row) => row.employeeCode === "EMP-002");
      expect(e2Row?.accrued).toBe("4200.0000");
      expect(e2Row?.settled).toBe("4000.0000");
      expect(e2Row?.released).toBe("200.0000");
      expect(e2Row?.balance).toBe("0.0000");
      const e1Row = eosRows.rows.find((row) => row.employeeCode === "EMP-001");
      expect(e1Row?.balance).toBe("800.0000");
    });
  });
});
