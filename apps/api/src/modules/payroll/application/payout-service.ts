import { Inject, Injectable } from "@nestjs/common";

import { generateUuidV7 } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import { addExact, compareExact, subExact } from "../../accounting/application/decimal-strings";
import { findPeriodById } from "../../accounting/infrastructure/accounting.store";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import {
  PayoutExceedsRunError,
  RunImmutableError,
  RunNotFoundError,
} from "../domain/payroll-errors";
import * as store from "../infrastructure/payroll.store";
import type { EmployeeRow, RunRow } from "../infrastructure/payroll.store";
import { toEmployeeView } from "./employee-service";
import {
  insertCashMovement,
  findCashAccountById,
} from "../../treasury/infrastructure/treasury.store";
import {
  type JournalLineSpec,
  type JournalSpec,
} from "../../accounting/domain/posting-engine/journal-spec";

/**
 * Payout service (PHASE-029 T7 — G-30): salary payout executes as a
 * treasury money movement + its journal — DR SALARIES_PAYABLE · CR
 * CASH/BANK per payout, BASE-denominated (rate 1 — INV-008), the cash
 * movement recorded through the treasury store API (INV-019 exact by
 * construction: movement.base == the journal's cash line).
 *
 * Per-execution idempotency (INV-013): each payout mints its own source
 * key (payroll_payout, payoutId, post). Run-level exactness: the run's
 * paid_net_total (DB CHECK 0 ≤ paid ≤ net) advances transactionally —
 * paying above the outstanding remainder dies typed; a second full payout
 * is rejected as above-outstanding (zero residue, no double payment).
 *
 * Payslips: per-run batch payload (masked national_id per the C-PII
 * discipline — the restricted permission gates the route; the payload
 * carries no unmasked PII).
 */

@Injectable()
export class PayoutService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
  ) {}

  /**
   * Pay out (G-30): the full outstanding net when amount is omitted, an
   * exact partial amount otherwise. Returns the updated run + the
   * movement/journal linkage.
   */
  async payout(
    runId: string,
    input: { cashAccountId: string; amount?: string; entryDate?: string; actorId: string | null },
  ): Promise<{ run: RunRow; payoutId: string; journalEntryId: string; amount: string }> {
    const run = await store.findRunById(runId);
    if (run === undefined) throw new RunNotFoundError(runId);
    if (run.status !== "POSTED") {
      throw new RunImmutableError({
        runId,
        status: run.status,
        action: "payout (only POSTED runs pay out)",
      });
    }
    const account = await findCashAccountById(input.cashAccountId);
    if (account === undefined || account.status !== "ACTIVE") {
      const { CashAccountNotFoundError } = await import("../../treasury/domain/treasury-errors");
      throw new CashAccountNotFoundError(input.cashAccountId);
    }
    const period = await findPeriodById(run.fiscalPeriodId);
    if (period === undefined) throw new RunNotFoundError(runId);

    const outstanding = subExact(run.netTotal, run.paidNetTotal);
    const amount = input.amount === undefined ? outstanding : input.amount;
    if (compareExact(amount, outstanding) > 0 || compareExact(amount, "0.0000") <= 0) {
      throw new PayoutExceedsRunError({ runId, requested: amount, outstanding });
    }

    const base = await ownTenantBaseCurrency();
    const payoutId = generateUuidV7();
    const entryDate =
      input.entryDate === undefined
        ? new Date().toISOString().slice(0, 10)
        : input.entryDate;
    const lines: JournalLineSpec[] = [
      {
        purpose: "SALARIES_PAYABLE",
        direction: "DEBIT",
        amount,
        memo: { en: "Salary payout (G-30)", ar: "صرف الرواتب (G-30)" },
      },
      {
        accountId: account.accountId,
        direction: "CREDIT",
        amount,
        memo: { en: `Payout via ${account.name}`, ar: `صرف عبر ${account.name}` },
      },
    ];
    const spec: JournalSpec = {
      source: { docType: "payroll_payout", docId: payoutId, operation: "post" },
      entryDate,
      description: {
        en: `Payroll payout — run ${run.runNo ?? run.id} (G-30)`,
        ar: `صرف رواتب — مسير ${run.runNo ?? run.id} (G-30)`,
      },
      currency: base,
      lines,
    };
    const result = await this.posting.post(spec, { postedBy: input.actorId });

    // The treasury money movement (INV-019 exact — base == the cash line).
    await insertCashMovement({
      cashAccountId: account.id,
      direction: "OUT",
      amount,
      currencyCode: base,
      exchangeRate: "1",
      baseAmount: amount,
      sourceType: "payroll_payout",
      sourceId: payoutId,
      valueDate: entryDate,
      memo: `Payroll payout ${run.runNo ?? run.id}`,
      memoAr: `صرف رواتب ${run.runNo ?? run.id}`,
    });

    const updated = await store.updateRun(runId, {
      paidNetTotal: addExact(run.paidNetTotal, amount),
    });
    await this.audit.record({
      action: "payroll.run_payout",
      entityType: "payroll_run",
      entityId: runId,
      actorId: input.actorId ?? undefined,
      after: {
        payoutId,
        amount,
        paidNetTotal: updated.paidNetTotal,
        outstanding: subExact(updated.netTotal, updated.paidNetTotal),
        journalEntryId: result.journalEntryId,
      },
    });
    return { run: updated, payoutId, journalEntryId: result.journalEntryId, amount };
  }

  /**
   * The per-run payslip batch (masked — the restricted permission gates
   * the route; the payload never carries unmasked national_id/bank
   * fields). Payslip count = the run's lines (paid or not — the slip is
   * the statement of the period's math).
   */
  async payslips(
    runId: string,
    locale: "ar" | "en",
  ): Promise<{
    run: {
      id: string;
      runNo: string | null;
      periodName: string;
      gross: string;
      deductions: string;
      net: string;
      employerContributions: string;
      eosAccrual: string;
      paid: string;
    };
    slips: {
      employee: ReturnType<typeof toEmployeeView>;
      gross: string;
      deductions: string;
      net: string;
      components: { key: string; name: string; nameAr: string | null; kind: string; computed: string }[];
      loanDeductions: { amount: string }[];
    }[];
  }> {
    const run = await store.findRunById(runId);
    if (run === undefined) throw new RunNotFoundError(runId);
    const period = await findPeriodById(run.fiscalPeriodId);
    if (period === undefined) throw new RunNotFoundError(runId);
    const lines = await store.listRunLines(runId);
    const slips: {
      employee: ReturnType<typeof toEmployeeView>;
      gross: string;
      deductions: string;
      net: string;
      components: { key: string; name: string; nameAr: string | null; kind: string; computed: string }[];
      loanDeductions: { amount: string }[];
    }[] = [];
    const employeeCache = new Map<string, EmployeeRow>();
    for (const line of lines) {
      let employee = employeeCache.get(line.employeeId);
      if (employee === undefined) {
        employee = await store.findEmployeeById(line.employeeId);
        if (employee === undefined) continue;
        employeeCache.set(employee.id, employee);
      }
      slips.push({
        employee: toEmployeeView(employee),
        gross: line.grossAmount,
        deductions: line.deductionsAmount,
        net: line.netAmount,
        components: line.componentSnapshot.components.map((component) => ({
          key: component.key,
          name: component.key,
          nameAr: null,
          kind: component.kind,
          computed: component.computed,
        })),
        loanDeductions: line.componentSnapshot.loanDeductions.map((loan) => ({
          amount: loan.amount,
        })),
      });
    }
    void locale; // slips carry both names; the rendering locale picks
    return {
      run: {
        id: run.id,
        runNo: run.runNo,
        periodName: period.name,
        gross: run.grossTotal,
        deductions: run.deductionsTotal,
        net: run.netTotal,
        employerContributions: run.employerContributionsTotal,
        eosAccrual: run.eosAccrualTotal,
        paid: run.paidNetTotal,
      },
      slips,
    };
  }
}
