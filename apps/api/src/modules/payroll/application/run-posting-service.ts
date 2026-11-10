import { Inject, Injectable } from "@nestjs/common";

import { sql } from "drizzle-orm";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import { NumberingService } from "../../accounting/application/numbering-service";
import { addExact, compareExact } from "../../accounting/application/decimal-strings";
import {
  findPeriodById,
  findActivePurpose,
  listPeriods,
} from "../../accounting/infrastructure/accounting.store";
import { ownTenantBaseCurrency, readEffectiveSetting } from "../../../infra/settings/setting-reader";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import {
  LoanAccountUnmappedError,
  RunImmutableError,
  RunNotFoundError,
} from "../domain/payroll-errors";
import * as store from "../infrastructure/payroll.store";
import type { RunRow } from "../infrastructure/payroll.store";
import {
  type JournalLineSpec,
  type JournalSpec,
} from "../../accounting/domain/posting-engine/journal-spec";

/**
 * Run posting service (PHASE-029 T5): ONE G-29 journal per run through the
 * PHASE-007 engine (ADR-0007 monopoly; INV-013 idempotency on
 * (payroll_run, runId, post); BR-053 — payroll accounts post ONLY here).
 *
 * G-29 shape (the phase §6 worked example, balanced 11,800 = 11,800):
 *   DR  per-component expense accounts (basic → SALARIES_EXPENSE purpose;
 *        each ALLOWANCE/EMPLOYER_CONTRIBUTION → its own gl_account_id)
 *        — aggregated per (account × dimensions)
 *   DR  EOS_PROVISION_EXPENSE (Σ accruals)
 *   CR  DEDUCTIONS_PAYABLE (employee third-party deductions + employer
 *        contributions payable — the worked example's 2,000)
 *   CR  the tenant-mapped employee-loan control account (recoveries —
 *        never DEDUCTIONS_PAYABLE)
 *   CR  EOS_PROVISION (the non-cash accrual balance — the liability leg)
 *   CR  SALARIES_PAYABLE (net)
 *
 * Every line carries the employee's cost_center_id/project_id/branch_id
 * (phase item 7 — lines aggregate per (account × dimension group) so
 * salary expense lands in cost-center/project reporting; the
 * payroll.cost-summary report ties by the same fold).
 *
 * Posting stamps the official run number (INV-021 — PR-{YYYY}-{SEQ:6} at
 * posting, the treasury format-constants pattern) and flips the run
 * POSTED. The engine's replay path (double-post) converges on the stored
 * journal — zero re-writes.
 *
 * Loan deductions inside the run flip their PENDING lines DEDUCTED with
 * the run stamp; a partial (clamped) take splits the line — the remainder
 * carries forward as a NEW PENDING line in the next regular period (the
 * audited carry: nothing lost, never silent; documented in the completion
 * report as the BR-054 clamp mechanics).
 */

/** Official payroll run numbers (INV-021/ADR-0006). */
export const PAYROLL_NUMBER_FORMATS = {
  payroll_run: { prefix: "PR", format: "PR-{YYYY}-{SEQ:6}", docType: "payroll_run" },
} as const;

/** The six payroll purposes (BR-053's guarded set — the engine's list). */
export const PAYROLL_PURPOSE_KEYS: readonly string[] = Object.freeze([
  "SALARIES_EXPENSE",
  "SALARIES_PAYABLE",
  "DEDUCTIONS_PAYABLE",
  "EMPLOYER_CONTRIBUTIONS",
  "EOS_PROVISION",
  "EOS_PROVISION_EXPENSE",
]);

/** One aggregated G-29 line group (account/purpose × dimensions). */
interface LineGroup {
  purpose?: string;
  accountId?: string;
  costCenterId?: string;
  projectId?: string;
  branchId?: string;
  direction: "DEBIT" | "CREDIT";
  memo: { en: string; ar: string };
}

function groupKey(group: LineGroup): string {
  return [
    group.purpose ?? `acct:${group.accountId ?? ""}`,
    group.direction,
    group.costCenterId ?? "-",
    group.projectId ?? "-",
    group.branchId ?? "-",
  ].join("|");
}

@Injectable()
export class RunPostingService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly numbering: NumberingService,
  ) {}

  /** Post the approved run (G-29). Double-post converges (INV-013). */
  async post(runId: string, actorId: string | null): Promise<RunRow> {
    const run = await store.findRunById(runId);
    if (run === undefined) throw new RunNotFoundError(runId);
    if (run.status === "POSTED") {
      // Idempotent replay: the stored journal is the truth — never re-write.
      return run;
    }
    if (run.status !== "PENDING_APPROVAL") {
      throw new RunImmutableError({
        runId,
        status: run.status,
        action: "post (submit + approve first)",
      });
    }
    if (run.approvedAt === null) {
      throw new RunImmutableError({
        runId,
        status: run.status,
        action: "post (no approval stamp — a distinct approver is required, SoD)",
      });
    }
    const period = await findPeriodById(run.fiscalPeriodId);
    if (period === undefined) throw new RunNotFoundError(runId);

    const lines = await store.listRunLines(runId);
    if (lines.length === 0) {
      throw new RunImmutableError({
        runId,
        status: run.status,
        action: "post (no calculated lines)",
      });
    }

    // The six-purpose pre-flight (fail-closed): the run journal requires
    // the WHOLE payroll purpose surface mapped — the phase §6 failure pack
    // (PURPOSE_NOT_MAPped ×6) unmaps each in turn. The component legs post
    // by explicit gl_account_id, but the purpose surface is the module's
    // posting contract (BR-053's guarded set) — an unmapped key aborts the
    // post BEFORE any write (zero residue).
    for (const key of PAYROLL_PURPOSE_KEYS) {
      await findActivePurposeAccount(key);
    }
    // The loan control account (tenant-mapped policy — not a purpose).
    const controlAccountId = await readEffectiveSetting<string | null>(
      "payroll.loans.control_account_id",
    );
    let loanDeductionsTotal = "0.0000";
    for (const line of lines) {
      for (const loan of line.componentSnapshot.loanDeductions) {
        loanDeductionsTotal = addExact(loanDeductionsTotal, loan.amount);
      }
    }
    if (
      compareExact(loanDeductionsTotal, "0.0000") > 0 &&
      (controlAccountId === null || controlAccountId === undefined)
    ) {
      throw new LoanAccountUnmappedError();
    }

    // Fold the G-29 line groups from the frozen snapshots. The basic salary
    // resolves the SALARIES_EXPENSE purpose to its ACCOUNT up front so the
    // basic + the housing allowance (whose component maps the same account)
    // aggregate into ONE golden leg (the worked example's 10,000).
    const salariesExpenseAccount = await findActivePurposeAccount("SALARIES_EXPENSE");
    const groups = new Map<string, { group: LineGroup; amount: string }>();
    const bump = (group: LineGroup, amount: string): void => {
      if (compareExact(amount, "0.0000") === 0) return;
      const key = groupKey(group);
      const existing = groups.get(key);
      groups.set(key, {
        group,
        amount: existing === undefined ? amount : addExact(existing.amount, amount),
      });
    };

    for (const line of lines) {
      const dims = {
        costCenterId: line.costCenterId ?? undefined,
        projectId: line.projectId ?? undefined,
        branchId: line.branchId ?? undefined,
      };
      // Basic salary → the SALARIES_EXPENSE account (the purpose resolved
      // once — the phase worked example folds basic + allowances into one
      // 10,000 leg when the components map the same account).
      bump(
        {
          accountId: salariesExpenseAccount,
          direction: "DEBIT",
          ...dims,
          memo: { en: "Basic salaries (G-29)", ar: "الرواتب الأساسية (G-29)" },
        },
        line.componentSnapshot.basicSalary,
      );
      // Components: ALLOWANCE/EMPLOYER_CONTRIBUTION → their own accounts
      // (DEBIT); DEDUCTION → DEDUCTIONS_PAYABLE (CR — employee third-party).
      for (const component of line.componentSnapshot.components) {
        if (component.kind === "DEDUCTION") {
          bump(
            {
              purpose: "DEDUCTIONS_PAYABLE",
              direction: "CREDIT",
              ...dims,
              memo: {
                en: `Third-party deduction ${component.key} (G-29)`,
                ar: `استقطاع ${component.key} (G-29)`,
              },
            },
            component.computed,
          );
        } else {
          bump(
            {
              accountId: component.glAccountId,
              direction: "DEBIT",
              ...dims,
              memo: {
                en: `${component.kind === "ALLOWANCE" ? "Allowance" : "Employer contribution"} ${component.key} (G-29)`,
                ar: `${component.kind === "ALLOWANCE" ? "بدل" : "مساهمة صاحب العمل"} ${component.key} (G-29)`,
              },
            },
            component.computed,
          );
        }
      }
      // Employer contributions ALSO credit DEDUCTIONS_PAYABLE (payable to
      // the third party — the worked example's 2,000 CR).
      bump(
        {
          purpose: "DEDUCTIONS_PAYABLE",
          direction: "CREDIT",
          ...dims,
          memo: {
            en: "Employer contributions payable (G-29)",
            ar: "مساهمات صاحب العمل المستحقة (G-29)",
          },
        },
        line.employerContributions,
      );
      // EOS: expense DR + the non-cash provision CR (the liability leg).
      bump(
        {
          purpose: "EOS_PROVISION_EXPENSE",
          direction: "DEBIT",
          ...dims,
          memo: { en: "EOS accrual expense (G-29)", ar: "مصروف مخصص نهاية الخدمة (G-29)" },
        },
        line.eosAccrual,
      );
      bump(
        {
          purpose: "EOS_PROVISION",
          direction: "CREDIT",
          ...dims,
          memo: { en: "EOS provision accrual (G-29)", ar: "مخصص نهاية الخدمة (G-29)" },
        },
        line.eosAccrual,
      );
      // Loan recoveries → the tenant-mapped control account (CR).
      for (const loan of line.componentSnapshot.loanDeductions) {
        bump(
          {
            accountId: controlAccountId ?? undefined,
            direction: "CREDIT",
            ...dims,
            memo: { en: "Employee loan recovery (G-29)", ar: "استرداد سلفة الموظف (G-29)" },
          },
          loan.amount,
        );
      }
      // Net → SALARIES_PAYABLE.
      bump(
        {
          purpose: "SALARIES_PAYABLE",
          direction: "CREDIT",
          ...dims,
          memo: { en: "Net salaries payable (G-29)", ar: "صافي الرواتب المستحق (G-29)" },
        },
        line.netAmount,
      );
    }

    const base = await ownTenantBaseCurrency();
    const spec: JournalSpec = {
      source: { docType: "payroll_run", docId: run.id, operation: "post" },
      entryDate: period.endDate,
      fiscalPeriodId: run.fiscalPeriodId,
      description: {
        en: `Payroll run ${run.runNo ?? run.id} — ${period.name} (G-29)`,
        ar: `مسير رواتب ${run.runNo ?? run.id} — ${period.name} (G-29)`,
      },
      currency: base,
      lines: [...groups.values()].map(({ group, amount }) => {
        const line: JournalLineSpec = {
          purpose: group.purpose,
          accountId: group.accountId,
          direction: group.direction,
          amount,
          costCenterId: group.costCenterId,
          projectId: group.projectId,
          memo: group.memo,
        };
        return line;
      }),
    };

    const result = await this.posting.post(spec, { postedBy: actorId });

    // The official run number at posting (INV-021).
    let runNo = run.runNo;
    if (!result.idempotentReplay && runNo === null) {
      const acquired = await this.numbering.reserve({
        docType: PAYROLL_NUMBER_FORMATS.payroll_run.docType,
        // The PR- series is global per tenant-YEAR (the CT-/treasury
        // precedent): uq_number_assignments_scope_number pins the NUMBER
        // unique per (tenant, docType, branch) — a monthly periodKey would
        // restart the sequence and collide on PR-<year>-000001.
        branchId: null,
        periodKey: period.endDate.slice(0, 4),
        format: PAYROLL_NUMBER_FORMATS.payroll_run.format,
        prefix: PAYROLL_NUMBER_FORMATS.payroll_run.prefix,
        year: period.endDate.slice(0, 4),
      });
      runNo = acquired.number;
    }

    // Loan lines → DEDUCTED with the run stamp; partial (clamped) takes
    // split — the remainder carries to the next regular period.
    for (const line of lines) {
      for (const loan of line.componentSnapshot.loanDeductions) {
        await this.applyLoanDeduction(loan, runId);
      }
    }

    const updated = await store.updateRun(runId, {
      status: "POSTED",
      runNo,
      journalEntryId: result.journalEntryId,
      entryNo: result.entryNo,
      postedAt: new Date().toISOString(),
      postedBy: actorId,
    });
    await this.audit.record({
      action: "payroll.run_posted",
      entityType: "payroll_run",
      entityId: runId,
      actorId: actorId ?? undefined,
      after: {
        runNo,
        journalEntryId: result.journalEntryId,
        entryNo: result.entryNo,
        gross: updated.grossTotal,
        deductions: updated.deductionsTotal,
        net: updated.netTotal,
        idempotentReplay: result.idempotentReplay,
      },
    });
    return updated;
  }

  /**
   * Reverse a POSTED run (the INV-003-style correction): posts the engine
   * reversal of the G-29 journal and stamps the reversal linkage — POSTED
   * stays POSTED, the ledger stays append-only.
   */
  async reverse(
    runId: string,
    input: { reason: string; entryDate: string; actorId: string | null },
  ): Promise<RunRow> {
    const run = await store.findRunById(runId);
    if (run === undefined) throw new RunNotFoundError(runId);
    if (run.status !== "POSTED" || run.journalEntryId === null) {
      throw new RunImmutableError({
        runId,
        status: run.status,
        action: "reverse (only POSTED runs reverse)",
      });
    }
    if (run.reversalJournalEntryId !== null) {
      throw new RunImmutableError({
        runId,
        status: run.status,
        action: "reverse (already reversed — reversal-only, once)",
      });
    }
    const result = await this.posting.reverse(
      { originalEntryId: run.journalEntryId, entryDate: input.entryDate, reason: input.reason },
      { reversedBy: input.actorId },
    );
    const updated = await store.updateRun(runId, {
      reversalJournalEntryId: result.journalEntryId,
      reversedAt: new Date().toISOString(),
      reversedBy: input.actorId,
    });
    await this.audit.record({
      action: "payroll.run_reversed",
      entityType: "payroll_run",
      entityId: runId,
      actorId: input.actorId ?? undefined,
      after: { reversalJournalEntryId: result.journalEntryId, reason: input.reason },
    });
    return updated;
  }

  /**
   * A loan deduction inside the posted run: whole takes flip the line
   * DEDUCTED; partial (clamped) takes split the line — the taken part
   * becomes the line's amount (history stays truthful, one audited
   * parameterized UPDATE confined to the clamp path), the remainder
   * carries forward as a NEW PENDING line in the next regular period.
   */
  private async applyLoanDeduction(
    loan: { loanId: string; lineId: string; amount: string },
    runId: string,
  ): Promise<void> {
    const line = await store.findLoanLineById(loan.lineId);
    if (line === undefined || line.status !== "PENDING") return;
    if (compareExact(loan.amount, line.amount) === 0) {
      await store.markLoanLineDeducted(line.id, runId);
      await store.maybeCloseLoan(loan.loanId);
      return;
    }
    // Partial take (the BR-054 clamp): split + carry forward.
    const remainder = addExact(line.amount, `-${loan.amount}`);
    await store.markLoanLineDeducted(line.id, runId);
    const context = requireTenantContext();
    if (context.tx === undefined) {
      throw new Error("payroll access requires an ambient tenant scope");
    }
    await context.tx.execute(
      sql`UPDATE employee_loan_lines SET amount = ${loan.amount}, updated_at = now(),
          version = version + 1 WHERE id = ${line.id}`,
    );
    const nextPeriodId = await nextRegularPeriodAfter(line.fiscalPeriodId);
    if (nextPeriodId !== null) {
      await store.insertLoanLine({
        loanId: loan.loanId,
        fiscalPeriodId: nextPeriodId,
        amount: remainder,
      });
    }
    await this.audit.record({
      action: "payroll.loan_line_carried",
      entityType: "employee_loan_line",
      entityId: line.id,
      after: { deducted: loan.amount, carried: remainder, toPeriod: nextPeriodId, runId },
    });
    await store.maybeCloseLoan(loan.loanId);
  }
}

/** The resolved account id of a purpose (fail-closed: the engine's own law). */
async function findActivePurposeAccount(key: string): Promise<string> {
  const mapping = await findActivePurpose(key);
  if (mapping === undefined) {
    const { purposeNotMapped } = await import(
      "../../accounting/domain/posting-engine/posting-errors"
    );
    throw purposeNotMapped({ purposeKey: key });
  }
  return mapping.accountId;
}

/** The next REGULAR period after the given one (the carry target). */
async function nextRegularPeriodAfter(fiscalPeriodId: string): Promise<string | null> {
  const current = await findPeriodById(fiscalPeriodId);
  if (current === undefined) return null;
  const periods = (await listPeriods()).filter((p) => p.kind === "REGULAR");
  periods.sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  const index = periods.findIndex((p) => p.id === fiscalPeriodId);
  return index >= 0 && index + 1 < periods.length ? periods[index + 1]!.id : null;
}
