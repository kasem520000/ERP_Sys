import { Inject, Injectable } from "@nestjs/common";

import { Decimal, generateUuidV7 } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import { addExact, compareExact, subExact } from "../../accounting/application/decimal-strings";
import {
  findPeriodById,
  listPeriods,
  findAccountById,
} from "../../accounting/infrastructure/accounting.store";
import { ownTenantBaseCurrency, readEffectiveSetting } from "../../../infra/settings/setting-reader";
import {
  EmployeeNotFoundError,
  LoanAccountUnmappedError,
  LoanLineNotFoundError,
  LoanNotFoundError,
  LoanScheduleImmutableError,
  PayrollCodeConflictError,
  PayrollStateError,
  RunNotFoundError,
} from "../domain/payroll-errors";
import * as store from "../infrastructure/payroll.store";
import type { LoanRow } from "../infrastructure/payroll.store";
import {
  insertCashMovement,
  findCashAccountById,
} from "../../treasury/infrastructure/treasury.store";
import {
  type JournalLineSpec,
  type JournalSpec,
} from "../../accounting/domain/posting-engine/journal-spec";

/**
 * Loan service (PHASE-029 T8): creation = disbursement. Creating the loan
 * posts the control-account journal (source employee_loan/disburse):
 * DR <tenant-mapped control account> · CR CASH — BASE-denominated — plus
 * the treasury cash movement (INV-019) and the per-period schedule
 * (equal installments with last-line remainder absorption, the
 * installments' Σ == amount discipline). The control account comes from
 * the payroll.loans.control_account_id policy key (typed
 * LOAN_ACCOUNT_UNMAPPED until mapped — no canonical purpose by design).
 *
 * Schedule lines transition PENDING → DEDUCTED (run-stamped, the run
 * posting service's job) / WAIVED (reason required, sticky). WRITE_OFF
 * requires a reason + audit and waives the remaining PENDING lines.
 */

@Injectable()
export class LoanService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
  ) {}

  async list(filter: { employeeId?: string; status?: store.LoanStatus; limit?: number }) {
    return store.listLoans({
      employeeId: filter.employeeId,
      status: filter.status,
      limit: Math.min(filter.limit ?? 200, 500),
    });
  }

  async get(id: string): Promise<{ loan: LoanRow; lines: store.LoanLineRow[] }> {
    const loan = await store.findLoanById(id);
    if (loan === undefined) throw new LoanNotFoundError(id);
    return { loan, lines: await store.listLoanLines(id) };
  }

  /**
   * Create + disburse (one ambient transaction): validates the employee,
   * the control-account mapping, the cash account; posts the disbursement
   * journal + movement; writes the loan register row + the schedule.
   */
  async create(input: {
    code: string;
    employeeId: string;
    amount: string;
    installmentsCount: number;
    startPeriodId: string;
    cashAccountId: string;
    valueDate?: string;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<{ loan: LoanRow; lines: store.LoanLineRow[] }> {
    const employee = await store.findEmployeeById(input.employeeId);
    if (employee === undefined) throw new EmployeeNotFoundError(input.employeeId);
    if (employee.status === "TERMINATED") {
      throw new PayrollStateError({
        entity: "employee",
        id: input.employeeId,
        from: employee.status,
        to: "loan disbursement",
        reason: "TERMINATED employees take no new loans",
      });
    }
    if ((await store.findLoanByCode(input.code)) !== undefined) {
      throw new PayrollCodeConflictError({ entity: "employee loan", code: input.code });
    }
    const controlAccountId = await readEffectiveSetting<string | null>(
      "payroll.loans.control_account_id",
    );
    if (controlAccountId === null || controlAccountId === undefined) {
      throw new LoanAccountUnmappedError();
    }
    const controlAccount = await findAccountById(controlAccountId);
    if (controlAccount === undefined || !controlAccount.isPostable || controlAccount.status !== "ACTIVE") {
      throw new LoanAccountUnmappedError();
    }
    const account = await findCashAccountById(input.cashAccountId);
    if (account === undefined || account.status !== "ACTIVE") {
      const { CashAccountNotFoundError } = await import("../../treasury/domain/treasury-errors");
      throw new CashAccountNotFoundError(input.cashAccountId);
    }
    const startPeriod = await findPeriodById(input.startPeriodId);
    if (startPeriod === undefined || startPeriod.kind !== "REGULAR") {
      throw new RunNotFoundError(input.startPeriodId);
    }

    const base = await ownTenantBaseCurrency();
    const valueDate = input.valueDate ?? new Date().toISOString().slice(0, 10);
    // The loan's uuid is minted FIRST: the disbursement journal's INV-013
    // source key is (employee_loan, loanId, disburse) — journal_entries.
    // source_id is uuid-typed, so codes cannot serve as doc ids.
    const loanId = generateUuidV7();
    const lines: JournalLineSpec[] = [
      {
        accountId: controlAccount.id,
        direction: "DEBIT",
        amount: input.amount,
        memo: {
          en: `Employee loan ${input.code} — ${employee.code}`,
          ar: `سلفة موظف ${input.code} — ${employee.code}`,
        },
      },
      {
        accountId: account.accountId,
        direction: "CREDIT",
        amount: input.amount,
        memo: { en: `Disbursement via ${account.name}`, ar: `الصرف عبر ${account.name}` },
      },
    ];
    const spec: JournalSpec = {
      source: { docType: "employee_loan", docId: loanId, operation: "disburse" },
      entryDate: valueDate,
      description: {
        en: `Employee loan ${input.code} disbursement`,
        ar: `صرف سلفة موظف ${input.code}`,
      },
      currency: base,
      lines,
    };
    // INV-013 idempotency on (employee_loan, loanId, disburse): re-running
    // a crashed creation converges on the stored journal.
    const result = await this.posting.post(spec, { postedBy: input.actorId });

    const schedulePeriods = await schedulePeriodsFrom(input.startPeriodId, input.installmentsCount);
    const created = await store.insertLoan({
      id: loanId,
      code: input.code,
      employeeId: input.employeeId,
      amount: input.amount,
      installmentsCount: input.installmentsCount,
      startPeriodId: input.startPeriodId,
      cashAccountId: account.id,
      disbursementJournalEntryId: result.journalEntryId,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      createdBy: input.actorId,
    });
    // Equal installments with last-line remainder absorption (Σ == amount).
    const perLine = new Decimal(input.amount)
      .div(new Decimal(input.installmentsCount))
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
      .toFixed(4);
    let scheduled = "0.0000";
    const inserted: store.LoanLineRow[] = [];
    for (let index = 0; index < schedulePeriods.length; index += 1) {
      const isLast = index === schedulePeriods.length - 1;
      const amount = isLast
        ? subExact(input.amount, scheduled)
        : perLine;
      if (compareExact(amount, "0.0000") <= 0 && isLast) continue;
      inserted.push(
        await store.insertLoanLine({
          loanId: created.id,
          fiscalPeriodId: schedulePeriods[index]!,
          amount,
        }),
      );
      scheduled = addExact(scheduled, amount);
    }
    await insertCashMovement({
      cashAccountId: account.id,
      direction: "OUT",
      amount: input.amount,
      currencyCode: base,
      exchangeRate: "1",
      baseAmount: input.amount,
      sourceType: "employee_loan",
      sourceId: created.id,
      valueDate,
      memo: `Employee loan ${input.code}`,
      memoAr: `سلفة موظف ${input.code}`,
    });
    await this.audit.record({
      action: "payroll.loan_disbursed",
      entityType: "employee_loan",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        code: created.code,
        employeeCode: employee.code,
        amount: created.amount,
        installmentsCount: created.installmentsCount,
        journalEntryId: result.journalEntryId,
      },
    });
    return { loan: created, lines: inserted };
  }

  /** WAIVE one schedule line (reason required, sticky; audited). */
  async waiveLine(
    lineId: string,
    input: { reason: string; actorId: string | null },
  ): Promise<{ line: store.LoanLineRow; loan: LoanRow | undefined }> {
    const line = await store.findLoanLineById(lineId);
    if (line === undefined) throw new LoanLineNotFoundError(lineId);
    if (line.status !== "PENDING") {
      throw new LoanScheduleImmutableError({
        loanId: line.loanId,
        action: `waive a ${line.status} line (only PENDING lines waive)`,
      });
    }
    const waived = await store.markLoanLineWaived(lineId, input.reason, input.actorId);
    const loan = await store.maybeCloseLoan(line.loanId);
    await this.audit.record({
      action: "payroll.loan_line_waived",
      entityType: "employee_loan_line",
      entityId: lineId,
      actorId: input.actorId ?? undefined,
      after: { reason: input.reason, loanId: line.loanId },
    });
    return { line: waived, loan: loan ?? undefined };
  }

  /**
   * WRITE_OFF the loan (reason required): waives every remaining PENDING
   * line with the write-off reason, stamps the register, audited.
   */
  async writeOff(
    loanId: string,
    input: { reason: string; actorId: string | null },
  ): Promise<LoanRow> {
    const loan = await store.findLoanById(loanId);
    if (loan === undefined) throw new LoanNotFoundError(loanId);
    if (loan.status !== "ACTIVE") {
      throw new PayrollStateError({
        entity: "employee loan",
        id: loanId,
        from: loan.status,
        to: "WRITE_OFF",
      });
    }
    const lines = await store.listLoanLines(loanId);
    for (const line of lines) {
      if (line.status === "PENDING") {
        await store.markLoanLineWaived(line.id, `write-off: ${input.reason}`, input.actorId);
      }
    }
    const updated = await store.updateLoan(loanId, {
      status: "WRITE_OFF",
      writeOffReason: input.reason,
      writeOffAt: new Date().toISOString(),
      writeOffBy: input.actorId,
    });
    await this.audit.record({
      action: "payroll.loan_written_off",
      entityType: "employee_loan",
      entityId: loanId,
      actorId: input.actorId ?? undefined,
      after: { reason: input.reason, code: loan.code, amount: loan.amount },
    });
    return updated;
  }
}

/**
 * The loan's schedule periods: N consecutive REGULAR periods starting at
 * startPeriodId (across fiscal years when the walk crosses one; the
 * honest degrade: fewer periods than installments → the tail collapses
 * onto the last available period's line via remainder absorption).
 */
async function schedulePeriodsFrom(
  startPeriodId: string,
  count: number,
): Promise<string[]> {
  const periods = (await listPeriods()).filter((p) => p.kind === "REGULAR");
  periods.sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  const index = periods.findIndex((p) => p.id === startPeriodId);
  if (index < 0) return [startPeriodId];
  const picked: string[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const at = Math.min(index + offset, periods.length - 1);
    picked.push(periods[at]!.id);
    if (at === periods.length - 1) break;
  }
  return picked;
}
