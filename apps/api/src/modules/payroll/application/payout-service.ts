import { Inject, Injectable } from "@nestjs/common";

import { generateUuidV7 } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import { addExact, compareExact, subExact } from "../../accounting/application/decimal-strings";
import { findPeriodById } from "../../accounting/infrastructure/accounting.store";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import { lockPayrollRun } from "../../hr/infrastructure/atomic";
import {
  PayoutExceedsRunError,
  RemittanceExceedsLiabilityError,
  RunImmutableError,
  RunNotFoundError,
} from "../domain/payroll-errors";
import * as store from "../infrastructure/payroll.store";
import type { EmployeeRow, RunRow } from "../infrastructure/payroll.store";
import type { StatutorySummaryRow } from "../domain/statutory-math";
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
 * PHASE-046 (W-6, T-17 — THE OWNER'S F2 SCOPE ADDITION, recorded
 * 2026-11-17 at 6387da9, implemented here): payout() rides the run gate
 * `payroll.run|{runId}` (the remit two-line adoption). The pre-F2 shape
 * was an app-computed read-modify-write with NO gate — paid_net_total
 * advanced as `updateRun(paidNetTotal: run.paidNetTotal + amount)` on a
 * stale read, so two concurrent partial payouts on one run BOTH read the
 * same outstanding, BOTH post their journals, and the second update
 * OVERWRITES the first's advance (a lost update the 0043 CHECK
 * 0 ≤ paid ≤ net does NOT catch — both writes land inside the legal
 * window while the CASH side doubles). Under the gate the outstanding
 * read + the advance are ONE serialized window: the second payout
 * re-reads the winner's committed advance and dies typed on the emptied
 * outstanding (or settles exactly what remains). Pinned by the permanent
 * duel (8) — payroll-writer-races.spec.ts.
 *
 * PHASE-046 (W-3, T-05 — D-06's G-52 settlement leg): THE REMITTANCE
 * SETTLEMENT — pay the authority. The run's statutory liability (the
 * frozen statutory_summary: the employee share + the employer share +
 * PIT the run credited to DEDUCTIONS_PAYABLE) settles ONLY through this
 * payout-machinery path: DR DEDUCTIONS_PAYABLE · CR the cash account
 * (explicit accountId) + the treasury movement `sourceType:
 * 'payroll_payout'` (the G-51 precedent — NO cash_movements CHECK
 * widening), INV-019 exact (movement.base == the journal's cash line),
 * source key (payroll_remittance, remittanceId, post) under INV-013 —
 * each settlement mints its own remittanceId; the run gate + the
 * outstanding re-read UNDER the lock make the double-settle
 * unrepresentable; the summary's `remitted` advances in the stored
 * order (a partial settlement allocates first-row-first — deterministic,
 * the same lines always fold the same summary); remitting above the
 * outstanding (or on a nothing-outstanding run) is the typed
 * RemittanceExceedsLiabilityError (the payout precedent).
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
    // PHASE-046 (W-6, T-17 — F2, the owner's 2026-11-17 scope addition):
    // THE RUN GATE, before the outstanding read — the same two-line
    // adoption as W-3's remit. The outstanding computation + the
    // paid_net_total advance are one window under the lock; two
    // concurrent payouts serialize and the loser answers on the winner's
    // COMMITTED advance (the typed above-outstanding refusal), never on
    // a stale read (the lost-update shape the CHECK cannot catch).
    await lockPayrollRun(runId);

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
   * PHASE-046 (W-3, T-05) — THE REMITTANCE SETTLEMENT (G-52's leg): pay
   * the authority the run's outstanding statutory liability. The full
   * outstanding when amount is omitted, an exact partial otherwise
   * (allocated first-summary-row-first); the over-remit is the typed
   * refusal. POSTED-only (the liability exists once the run posted) and
   * entirely under the run gate (D-09): the outstanding read + the
   * summary advance are one window.
   */
  async remit(
    runId: string,
    input: { cashAccountId: string; amount?: string; entryDate?: string; actorId: string | null },
  ): Promise<{
    run: RunRow;
    remittanceId: string;
    journalEntryId: string;
    amount: string;
    summary: StatutorySummaryRow[];
  }> {
    // D-09 THE RUN GATE — before the outstanding read: two concurrent
    // remittances serialize (the second re-reads the advanced summary and
    // dies typed on the emptied outstanding, or settles what remains).
    await lockPayrollRun(runId);

    const run = await store.findRunById(runId);
    if (run === undefined) throw new RunNotFoundError(runId);
    if (run.status !== "POSTED") {
      throw new RunImmutableError({
        runId,
        status: run.status,
        action: "remit (only POSTED runs carry a statutory liability — the accrual posts with the run)",
      });
    }
    const account = await findCashAccountById(input.cashAccountId);
    if (account === undefined || account.status !== "ACTIVE") {
      const { CashAccountNotFoundError } = await import("../../treasury/domain/treasury-errors");
      throw new CashAccountNotFoundError(input.cashAccountId);
    }

    // The outstanding liability: Σ (accrued − remitted) over the frozen
    // summary — the run's own DEDUCTIONS_PAYABLE statutory credit. A run
    // with NO statutory rows carries NO summary (null) — nothing to
    // settle (the typed refusal, never a zero-dollar journal).
    const summary = run.statutorySummary ?? [];
    let outstanding = "0.0000";
    for (const row of summary) {
      outstanding = addExact(outstanding, subExact(row.accrued, row.remitted));
    }
    const amount = input.amount === undefined ? outstanding : input.amount;
    if (compareExact(amount, outstanding) > 0 || compareExact(amount, "0.0000") <= 0) {
      throw new RemittanceExceedsLiabilityError({ runId, requested: amount, outstanding });
    }

    const base = await ownTenantBaseCurrency();
    const remittanceId = generateUuidV7();
    const entryDate =
      input.entryDate === undefined ? new Date().toISOString().slice(0, 10) : input.entryDate;
    const lines: JournalLineSpec[] = [
      {
        purpose: "DEDUCTIONS_PAYABLE",
        direction: "DEBIT",
        amount,
        memo: {
          en: "Statutory remittance to the authority (G-52)",
          ar: "تحويل الاستقطاعات القانونية إلى الجهة (G-52)",
        },
      },
      {
        accountId: account.accountId,
        direction: "CREDIT",
        amount,
        memo: { en: `Remittance via ${account.name}`, ar: `تحويل عبر ${account.name}` },
      },
    ];
    const spec: JournalSpec = {
      source: { docType: "payroll_remittance", docId: remittanceId, operation: "post" },
      entryDate,
      description: {
        en: `Statutory remittance — run ${run.runNo ?? run.id} (G-52)`,
        ar: `تحويل الاستقطاعات القانونية — مسير ${run.runNo ?? run.id} (G-52)`,
      },
      currency: base,
      lines,
    };
    const result = await this.posting.post(spec, { postedBy: input.actorId });

    // The treasury money movement (the payout machinery — the G-51
    // precedent; INV-019 exact: base == the journal's cash line).
    await insertCashMovement({
      cashAccountId: account.id,
      direction: "OUT",
      amount,
      currencyCode: base,
      exchangeRate: "1",
      baseAmount: amount,
      sourceType: "payroll_payout",
      sourceId: remittanceId,
      valueDate: entryDate,
      memo: `Statutory remittance ${run.runNo ?? run.id}`,
      memoAr: `تحويل الاستقطاعات القانونية ${run.runNo ?? run.id}`,
    });

    // The summary advance: the settled amount allocates first-row-first
    // (the summary's stored order — deterministic; the same lines always
    // fold the same summary, so the allocation is stable).
    let remaining = amount;
    const advanced: StatutorySummaryRow[] = summary.map((row) => {
      const rowOutstanding = subExact(row.accrued, row.remitted);
      const take = compareExact(rowOutstanding, remaining) <= 0 ? rowOutstanding : remaining;
      remaining = subExact(remaining, take);
      return { ...row, remitted: addExact(row.remitted, take) };
    });
    const updated = await store.updateRun(runId, { statutorySummary: advanced });
    await this.audit.record({
      action: "payroll.remittance_settled",
      entityType: "payroll_run",
      entityId: runId,
      actorId: input.actorId ?? undefined,
      after: {
        remittanceId,
        amount,
        outstandingBefore: outstanding,
        outstandingAfter: subExact(outstanding, amount),
        journalEntryId: result.journalEntryId,
        cashAccount: account.name,
      },
    });
    return { run: updated, remittanceId, journalEntryId: result.journalEntryId, amount, summary: advanced };
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
