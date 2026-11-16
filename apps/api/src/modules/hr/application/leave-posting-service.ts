import { Inject, Injectable } from "@nestjs/common";
import { Decimal, generateUuidV7 } from "@erp/domain-core";

import { PostingService } from "../../accounting/application/posting-service";
import { findPeriodById } from "../../accounting/infrastructure/accounting.store";
import { AuditService } from "../../audit/api/audit";
import {
  insertCashMovement,
  findCashAccountById,
} from "../../treasury/infrastructure/treasury.store";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import {
  ResolveEffectiveConfigService,
  RESOLVE_EFFECTIVE_CONFIG_SERVICE,
} from "../../configuration/application/resolve/resolve-service";
import {
  LeaveAccrualPeriodInvalidError,
  LeaveAccrualPostingDisabledError,
  LeaveEncashmentInsufficientError,
  LeaveEncashmentInvalidError,
} from "../domain/leave-posting-errors";
import {
  LeaveAccrualInvalidError,
  LeaveTypeInactiveError,
  LeaveTypeNotFoundError,
} from "../domain/leave-errors";
import { FeedPeriodNotFoundError } from "../domain/feed-errors";
import { EmployeeNotFoundError } from "../domain/hr-errors";
import * as atomic from "../infrastructure/atomic";
import * as store from "../infrastructure/leave.store";

/**
 * PHASE-045 (T-11) — the goldens G-50/G-51: the period-end leave-accrual
 * posting and the leave encashment settlement — the leave family's ONLY
 * ledger surfaces (attendance, rosters, and overtime entries are NOT
 * ledger documents; they feed the variable lines PHASE-046 consumes).
 *
 * G-50 — THE PERIOD-END ACCRUAL POSTING (policy-gated, the BR-055
 * discipline): OFF by default — no fabricated ledger effect; with the
 * `hr.leave_accrual_posting` policy on 'post', the monthly slice's
 * earned-leave value posts through the engine:
 *   DR SALARIES_EXPENSE · CR SALARIES_PAYABLE
 * (the payroll family's canonical pair — NO new account purposes) at
 * Σ_employees (accrual_days_per_year / 12) × (basic_salary / 30) — the
 * 029 EOS daily-rate convention, exact 4dp Decimal math (ADR-0009).
 * The roster: hired on or before the period's end, not terminated
 * before its start (the hire/termination month counts fully — the
 * T-07 convention). EXACTLY-ONCE per (type, period month) under
 * INV-013 (source leave_accrual_run:{typeId} · post_{YYYYMM}); a
 * multi-month period is the typed refusal (the slice is monthly); a
 * zero-value run never posts (the honest floor).
 *
 * G-51 — THE ENCASHMENT SETTLEMENT (through the payroll payout
 * machinery — no new purposes, no new movement kinds): the employee's
 * remaining leave days cash out at days × basic/30 with INV-031 AT THE
 * ENCASH BOUNDARY (days ≤ remaining — the typed refusal BEFORE the
 * same-transaction decrement, never a negative remaining):
 *   DR SALARIES_PAYABLE · CR CASH
 * + the treasury money movement (source 'payroll_payout', the existing
 * kind — INV-019 exact: movement.base == the journal's cash line).
 * The charge lands on the entry date's year cell (the T-07 charge
 * convention); each encashment mints its own INV-013 key
 * (leave_encashment:{id} · post — the payout precedent).
 *
 * THE SHARED ATOMICITY FLOOR (T-20, the owner's concurrency review
 * round): the encashment takes the SAME (employee, type, year) CELL
 * lock as the approval, the accrual recompute, and the carry-over
 * rollover — the remaining read and the used_days decrement are one
 * atomic step under the lock (used_days is the source of truth:
 * leaves AND encashments ride it), so a racing approval can never
 * jointly push the cell past the cap.
 */

/** Exact 4dp string math via domain-core Decimal (ADR-0009). */
function round4(value: Decimal): string {
  return value.toDecimalPlaces(4).toFixed(4);
}

@Injectable()
export class LeavePostingService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(RESOLVE_EFFECTIVE_CONFIG_SERVICE)
    private readonly resolveConfig: ResolveEffectiveConfigService,
  ) {}

  /** The policy seam: G-50's hr.leave_accrual_posting enum ("off" |
   * "post", default "off") off the resolved effective config — the
   * same config.policies seam the downtime service reads. */
  private async accrualPostingPolicy(): Promise<"off" | "post"> {
    const tenantId = requireTenantContext().tenantId;
    const config = await this.resolveConfig.resolveTenantStatic(tenantId);
    return config.policies["hr.leave_accrual_posting"] === "post" ? "post" : "off";
  }

  /** G-50: post the period's earned-leave value for one leave type. */
  async postAccrual(input: {
    leaveTypeId: string;
    periodId: string;
    actorId: string | null;
  }): Promise<{
    journalEntryId: string;
    amount: string;
    employees: number;
    monthSliceDays: string;
  }> {
    if ((await this.accrualPostingPolicy()) !== "post") {
      throw new LeaveAccrualPostingDisabledError();
    }
    const period = await findPeriodById(input.periodId);
    if (period === undefined) {
      throw new FeedPeriodNotFoundError(input.periodId);
    }
    // THE MONTHLY LAW: the slice is a month — a period crossing a month
    // boundary cannot carry it (the typed refusal, never a prorated
    // guess).
    const startMonth = period.startDate.slice(0, 7);
    const endMonth = period.endDate.slice(0, 7);
    if (startMonth !== endMonth) {
      throw new LeaveAccrualPeriodInvalidError(
        `the accrual posting answers MONTHLY periods only — period ${period.name} spans ${period.startDate}…${period.endDate} (two calendar months)`,
      );
    }
    const type = await store.findLeaveTypeById(input.leaveTypeId);
    if (type === undefined) throw new LeaveTypeNotFoundError(input.leaveTypeId);
    if (!type.active) throw new LeaveTypeInactiveError(input.leaveTypeId);
    if (new Decimal(type.accrualDaysPerYear).lessThanOrEqualTo(0)) {
      // THE BR-055 LAW at the posting boundary: a 0-accrual type never
      // posts (the T-07 accrual-run refusal's mirror).
      throw new LeaveAccrualInvalidError(
        `leave type ${type.code} accrues 0.00 days/year — nothing to post (the BR-055 law)`,
      );
    }

    const roster = await store.listAccrualRoster(period.startDate, period.endDate);
    const monthSliceDays = new Decimal(type.accrualDaysPerYear).div(12);
    let total = new Decimal(0);
    let headcount = 0;
    for (const employee of roster) {
      const value = monthSliceDays.times(new Decimal(employee.basicSalary).div(30));
      total = total.plus(value);
      headcount += 1;
    }
    const amount = round4(total);
    if (headcount === 0 || new Decimal(amount).lessThanOrEqualTo(0)) {
      // The honest floor: a zero-value journal cannot post.
      throw new LeaveAccrualPeriodInvalidError(
        `the accrual slice for ${period.name} is zero (no eligible employees or a zero total) — a zero-value journal never posts`,
      );
    }

    const base = await ownTenantBaseCurrency();
    const monthSlug = `post_${startMonth.replace("-", "")}`; // post_YYYYMM
    const result = await this.posting.post(
      {
        source: { docType: "leave_accrual_run", docId: type.id, operation: monthSlug },
        entryDate: period.endDate,
        description: {
          en: `Leave accrual — ${type.name} (${period.name}, ${headcount} employees) — G-50`,
          ar: `استحقاق إجازات — ${type.nameAr ?? type.name} (${period.name}، ${headcount} موظفًا) — G-50`,
        },
        currency: base,
        lines: [
          {
            purpose: "SALARIES_EXPENSE",
            direction: "DEBIT",
            amount,
            memo: {
              en: `Leave accrual ${period.name} — ${type.code}`,
              ar: `استحقاق إجازات ${period.name} — ${type.code}`,
            },
          },
          {
            purpose: "SALARIES_PAYABLE",
            direction: "CREDIT",
            amount,
            memo: {
              en: `Accrued leave liability ${period.name} — ${type.code}`,
              ar: `التزام إجازات مستحقة ${period.name} — ${type.code}`,
            },
          },
        ],
      },
      { postedBy: input.actorId },
    );

    // The replay (INV-013/CC-01) returns the stored result — it posted
    // nothing, so it audits nothing.
    if (!result.idempotentReplay) {
      await this.audit.record({
        action: "hr.leave_accrual_posted",
        entityType: "leave_type",
        entityId: type.id,
        actorId: input.actorId ?? undefined,
        after: {
          periodId: period.id,
          periodName: period.name,
          monthSliceDays: monthSliceDays.toDecimalPlaces(4).toFixed(4),
          employees: headcount,
          amount,
          journalEntryId: result.journalEntryId,
        },
      });
    }
    return {
      journalEntryId: result.journalEntryId,
      amount,
      employees: headcount,
      monthSliceDays: monthSliceDays.toDecimalPlaces(4).toFixed(4),
    };
  }

  /** G-51: encash an employee's remaining leave days through the payout
   * machinery (DR SALARIES_PAYABLE · CR CASH + the treasury movement). */
  async encash(input: {
    employeeId: string;
    leaveTypeId: string;
    days: string;
    cashAccountId: string;
    entryDate?: string;
    actorId: string | null;
  }): Promise<{
    encashmentId: string;
    journalEntryId: string;
    amount: string;
    remainingDays: string;
  }> {
    const entryDate = input.entryDate ?? new Date().toISOString().slice(0, 10);
    const type = await store.findLeaveTypeById(input.leaveTypeId);
    if (type === undefined) throw new LeaveTypeNotFoundError(input.leaveTypeId);
    if (!type.active) throw new LeaveTypeInactiveError(input.leaveTypeId);
    const employee = await store.findEncashableEmployee(input.employeeId);
    if (employee === undefined || employee.status === "TERMINATED") {
      throw new EmployeeNotFoundError(input.employeeId);
    }
    const days = new Decimal(input.days);
    if (days.lessThanOrEqualTo(0) || days.greaterThan(366)) {
      throw new LeaveEncashmentInvalidError(`days must be within (0 … 366]: ${input.days}`);
    }
    const account = await findCashAccountById(input.cashAccountId);
    if (account === undefined || account.status !== "ACTIVE") {
      const { CashAccountNotFoundError } = await import("../../treasury/domain/treasury-errors");
      throw new CashAccountNotFoundError(input.cashAccountId);
    }

    // INV-031 AT THE ENCASH BOUNDARY (T-20's rework) — the typed
    // refusal BEFORE the decrement (the T-07 approve-boundary
    // pattern; the charge lands on the entry date's year cell).
    // THE CELL LOCK FIRST: the encashment, the approval, the accrual
    // recompute, and the carry-over rollover ALL serialize on the
    // (employee, type, year) cell (the shared atomicity floor) — the
    // remaining read and the decrement below are one atomic step
    // under the lock, so a racing approval can never jointly push the
    // cell past the cap (the owner's used=25-on-20 proof, pinned).
    const year = Number(entryDate.slice(0, 4));
    await store.ensureBalanceCell(input.employeeId, input.leaveTypeId, year);
    await atomic.lockBalanceCell(input.employeeId, input.leaveTypeId, year);
    // The cell read runs UNDER the lock (the post-lock recompute —
    // used_days is the source of truth: approved leaves AND
    // encashments ride it).
    const cell = await store.findBalanceCell(input.employeeId, input.leaveTypeId, year);
    const remaining =
      new Decimal(cell!.entitlementDays).plus(cell!.carriedForwardDays).minus(cell!.usedDays);
    if (days.greaterThan(remaining)) {
      throw new LeaveEncashmentInsufficientError({
        employeeCode: employee.code,
        remainingDays: remaining.toDecimalPlaces(2).toFixed(2),
        requestedDays: days.toDecimalPlaces(2).toFixed(2),
      });
    }

    const amount = round4(days.times(new Decimal(employee.basicSalary).div(30)));
    if (new Decimal(amount).lessThanOrEqualTo(0)) {
      throw new LeaveEncashmentInvalidError("the encashment value is zero — nothing to settle");
    }

    const base = await ownTenantBaseCurrency();
    const encashmentId = generateUuidV7();
    const result = await this.posting.post(
      {
        source: { docType: "leave_encashment", docId: encashmentId, operation: "post" },
        entryDate,
        description: {
          en: `Leave encashment — ${employee.name} (${type.code}, ${input.days} days) — G-51`,
          ar: `تسديد إجازات نقدًا — ${employee.name} (${type.code}، ${input.days} يومًا) — G-51`,
        },
        currency: base,
        lines: [
          {
            purpose: "SALARIES_PAYABLE",
            direction: "DEBIT",
            amount,
            memo: {
              en: `Leave encashment ${employee.code} — ${type.code}`,
              ar: `تسديد إجازات ${employee.code} — ${type.code}`,
            },
          },
          {
            accountId: account.accountId,
            direction: "CREDIT",
            amount,
            memo: { en: `Encashment via ${account.name}`, ar: `تسديد عبر ${account.name}` },
          },
        ],
      },
      { postedBy: input.actorId },
    );

    // The treasury money movement (the payroll-payout machinery —
    // INV-019 exact: base == the journal's cash line).
    await insertCashMovement({
      cashAccountId: account.id,
      direction: "OUT",
      amount,
      currencyCode: base,
      exchangeRate: "1",
      baseAmount: amount,
      sourceType: "payroll_payout",
      sourceId: encashmentId,
      valueDate: entryDate,
      memo: `Leave encashment ${employee.code}`,
      memoAr: `تسديد إجازات ${employee.code}`,
    });

    // The same-transaction balance decrement (INV-031 — used never
    // exceeds entitlement + carried at ANY moment).
    await store.incrementUsedDays(
      input.employeeId,
      input.leaveTypeId,
      year,
      days.toDecimalPlaces(2).toFixed(2),
    );

    await this.audit.record({
      action: "hr.leave_encashed",
      entityType: "employee",
      entityId: input.employeeId,
      actorId: input.actorId ?? undefined,
      after: {
        encashmentId,
        leaveTypeCode: type.code,
        days: input.days,
        amount,
        cashAccount: account.name,
        journalEntryId: result.journalEntryId,
      },
    });
    return {
      encashmentId,
      journalEntryId: result.journalEntryId,
      amount,
      remainingDays: remaining.minus(days).toDecimalPlaces(2).toFixed(2),
    };
  }
}
