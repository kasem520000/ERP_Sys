import { Inject, Injectable } from "@nestjs/common";

import { Decimal, generateUuidV7 } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { readEffectiveSetting, ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/accounting.store";
import * as journal from "../infrastructure/journal.store";
import { PostingService } from "./posting-service";
import type { JournalSpec, JournalLineSpec } from "../domain/posting-engine/journal-spec";
import {
  FxRevaluationDisabledError,
  FxRevaluationError,
  YearEndCloseError,
} from "../domain/accounting-errors";
import { absExact, addExact, subExact } from "./decimal-strings";

/**
 * Year-end close (PHASE-007 T15; PERIOD_CLOSING §3; G-20) + the optional
 * unrealized FX revaluation run (BR-036, G-19 minimal).
 *
 * Close shape (source `year_end_close`, one live entry per year):
 *   DR each REVENUE account balance · CR CLOSING (Σ revenues)
 *   DR CLOSING (Σ expenses) · CR each EXPENSE account balance
 *   net → DR CLOSING · CR RETAINED_EARNINGS (loss mirrored)
 * Reversible as a unit only (`year_end_close:reverse`); regenerate after
 * reversal posts a fresh suffixed-operation entry (INV-013); prior-year
 * statements never change (PC-07 — posted history is immutable).
 */

@Injectable()
export class YearEndService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
  ) {}

  /** Account balances (signed base) grouped by type for the close math. */
  private async balancesByType(
    fromDate: string,
    toDate: string,
  ): Promise<{ code: string; accountId: string; type: string; balance: string }[]> {
    const balances = await journal.trialBalances({ fromDate, toDate });
    return balances.map((row) => ({
      code: row.code,
      accountId: row.accountId,
      type: row.type,
      balance: row.balance,
    }));
  }

  /**
   * Execute the year-end close. Preconditions: every REGULAR period of the
   * year is LOCKED (the CLOSING window may remain OPEN — the close entry
   * posts there explicitly); no live closing entry exists.
   */
  async execute(actorId: string, fiscalYearId: string) {
    const year = await store.findFiscalYearById(fiscalYearId);
    if (year === undefined) {
      throw new YearEndCloseError(`fiscal year ${fiscalYearId} does not exist`);
    }
    const periods = await store.listPeriods(fiscalYearId);
    const regulars = periods.filter((period) => period.kind === "REGULAR");
    if (regulars.length === 0) {
      throw new YearEndCloseError("year has no REGULAR periods");
    }
    const unlocked = regulars.filter((period) => period.status !== "LOCKED");
    if (unlocked.length > 0) {
      throw new YearEndCloseError(
        `all REGULAR periods must be LOCKED before close (open: ${unlocked.map((p) => p.name).join(", ")})`,
      );
    }
    const closing = periods.find((period) => period.kind === "CLOSING");
    if (closing === undefined) {
      throw new YearEndCloseError("year has no CLOSING period");
    }
    // Idempotency + live-entry guard (INV-013): count prior closing entries.
    const prior = await closingEntriesFor(fiscalYearId);
    const live = prior.filter((entry) => entry.status === "POSTED");
    if (live.length > 0) {
      throw new YearEndCloseError(
        `year ${year.name} already has a live closing entry ${live[0]!.entryNo} (reverse it first — PC-06)`,
      );
    }
    const base = await ownTenantBaseCurrency();
    const balances = await this.balancesByType(year.startDate, year.endDate);
    const revenues = balances.filter((row) => row.type === "REVENUE" && row.balance !== "0");
    const expenses = balances.filter((row) => row.type === "EXPENSE" && row.balance !== "0");
    if (revenues.length === 0 && expenses.length === 0) {
      throw new YearEndCloseError("year has no revenue/expense balances to close");
    }
    const lines: JournalLineSpec[] = [];
    // DR revenue accounts (positive revenue balances are credits → DR to zero).
    let revenueTotal = "0";
    for (const revenue of revenues) {
      lines.push({
        accountId: revenue.accountId,
        direction: "DEBIT",
        amount: absExact(revenue.balance),
        memo: { en: `Year-end close ${year.name}`, ar: `إقفال نهاية السنة ${year.name}` },
      });
      revenueTotal = addExact(revenueTotal, absExact(revenue.balance));
    }
    let expenseTotal = "0";
    for (const expense of expenses) {
      lines.push({
        accountId: expense.accountId,
        direction: "CREDIT",
        amount: absExact(expense.balance),
        memo: { en: `Year-end close ${year.name}`, ar: `إقفال نهاية السنة ${year.name}` },
      });
      expenseTotal = addExact(expenseTotal, absExact(expense.balance));
    }
    const net = subExact(revenueTotal, expenseTotal); // > 0 = profit
    // CLOSING summary legs + net transfer to RETAINED_EARNINGS.
    lines.push({
      purpose: "CLOSING",
      direction: "CREDIT",
      amount: revenueTotal,
      memo: { en: `Close revenues ${year.name}`, ar: `إقفال الإيرادات ${year.name}` },
    });
    lines.push({
      purpose: "CLOSING",
      direction: "DEBIT",
      amount: expenseTotal,
      memo: { en: `Close expenses ${year.name}`, ar: `إقفال المصروفات ${year.name}` },
    });
    if (net !== "0") {
      lines.push({
        purpose: net.startsWith("-") ? "RETAINED_EARNINGS" : "CLOSING",
        direction: net.startsWith("-") ? "DEBIT" : "DEBIT",
        amount: absExact(net),
        memo: { en: `Net result transfer ${year.name}`, ar: `ترحيل نتيجة ${year.name}` },
      });
      lines.push({
        purpose: net.startsWith("-") ? "CLOSING" : "RETAINED_EARNINGS",
        direction: "CREDIT",
        amount: absExact(net),
        memo: { en: `Net result transfer ${year.name}`, ar: `ترحيل نتيجة ${year.name}` },
      });
    }
    const suffix = prior.length === 0 ? "execute" : `execute_${prior.length + 1}`;
    const spec: JournalSpec = {
      source: { docType: "year_end_close", docId: fiscalYearId, operation: suffix },
      entryDate: closing.startDate,
      fiscalPeriodId: closing.id,
      description: { en: `Year-end close ${year.name}`, ar: `إقفال نهاية السنة ${year.name}` },
      currency: base,
      lines,
    };
    const result = await this.posting.post(spec, {
      postedBy: actorId,
      onPosted: async () => {
        await store.setFiscalYearStatus(fiscalYearId, "CLOSED");
      },
    });
    await this.audit.record({
      action: "accounting.year_end_closed",
      entityType: "fiscal_year",
      entityId: fiscalYearId,
      actorId,
      after: {
        journalEntryId: result.journalEntryId,
        entryNo: result.entryNo,
        revenues: revenueTotal,
        expenses: expenseTotal,
        net,
      },
    });
    return { ...result, revenues: revenueTotal, expenses: expenseTotal, net };
  }

  /**
   * Reverse the closing entry as a unit (PC-06) and reopen the year —
   * regeneration posts a fresh entry with the next operation suffix.
   */
  async reverse(actorId: string, fiscalYearId: string, reason: string) {
    const year = await store.findFiscalYearById(fiscalYearId);
    if (year === undefined) {
      throw new YearEndCloseError(`fiscal year ${fiscalYearId} does not exist`);
    }
    const prior = await closingEntriesFor(fiscalYearId);
    const live = prior.filter((entry) => entry.status === "POSTED");
    if (live.length === 0) {
      throw new YearEndCloseError(`year ${year.name} has no live closing entry to reverse`);
    }
    const original = live[live.length - 1]!;
    const result = await this.posting.reverse(
      {
        originalEntryId: original.id,
        entryDate: original.entryDate,
        reason: `year_end_close:reverse — ${reason}`,
      },
      { reversedBy: actorId },
    );
    await store.setFiscalYearStatus(fiscalYearId, "OPEN");
    await this.audit.record({
      action: "accounting.year_end_reversed",
      entityType: "fiscal_year",
      entityId: fiscalYearId,
      actorId,
      before: { status: "CLOSED" },
      after: { status: "OPEN", reversalEntryId: result.journalEntryId, reason },
    });
    return result;
  }

  /**
   * Minimal FX revaluation (G-19; BR-036 — default OFF per tenant setting):
   * dated run over foreign-currency ACCOUNT balances: adjusting entry at
   * the chosen rate + a self-reversing twin dated the next day. Audited;
   * reversible as a unit (both entries carry the run id).
   */
  async runFxRevaluation(
    actorId: string,
    input: { runDate: string; currencyCode: string; rate: string },
  ) {
    const enabled = await readEffectiveSetting<boolean>("accounting.fx_revaluation_enabled");
    if (enabled !== true) {
      throw new FxRevaluationDisabledError();
    }
    const base = await ownTenantBaseCurrency();
    if (input.currencyCode === base) {
      throw new FxRevaluationError("revaluation currency must differ from the base currency");
    }
    if (!/^[0-9]+(\.[0-9]+)?$/.test(input.rate) || Number(input.rate) <= 0) {
      throw new FxRevaluationError("rate must be a positive decimal");
    }
    // Foreign-currency exposure per account: Σ signed amount in the foreign
    // currency (base exposure at stored rates vs at the chosen rate).
    const exposures = await foreignCurrencyExposures(input.currencyCode);
    if (exposures.length === 0) {
      return { adjustingEntryId: null, reversingEntryId: null, delta: "0" };
    }
    const runId = generateRunId();
    const lines: JournalLineSpec[] = [];
    let deltaDebit = "0";
    let deltaCredit = "0";
    for (const exposure of exposures) {
      const atStored = exposure.baseBalance;
      const atCurrent = multiplyRate(exposure.foreignBalance, input.rate);
      const delta = subExact(atCurrent, atStored);
      if (delta === "0") continue;
      // Asset positive delta → gain (credit FX_GAIN); the mirror for
      // negative deltas posts FX_LOSS. Liabilities invert naturally by sign.
      lines.push({
        accountId: exposure.accountId,
        direction: delta.startsWith("-") ? "DEBIT" : "CREDIT",
        amount: absExact(delta),
        memo: { en: `FX revaluation @ ${input.rate}`, ar: `إعادة تقييم عملة @ ${input.rate}` },
      });
      if (delta.startsWith("-")) deltaDebit = addExact(deltaDebit, absExact(delta));
      else deltaCredit = addExact(deltaCredit, absExact(delta));
    }
    if (lines.length === 0) {
      return { adjustingEntryId: null, reversingEntryId: null, delta: "0" };
    }
    // FX gain/loss legs (purpose-resolved, fail-closed).
    if (deltaCredit !== "0") {
      lines.push({
        purpose: "FX_GAIN",
        direction: "DEBIT",
        amount: deltaCredit,
        memo: { en: "FX revaluation", ar: "إعادة تقييم العملات" },
      });
    }
    if (deltaDebit !== "0") {
      lines.push({
        purpose: "FX_LOSS",
        direction: "CREDIT",
        amount: deltaDebit,
        memo: { en: "FX revaluation", ar: "إعادة تقييم العملات" },
      });
    }
    const spec: JournalSpec = {
      source: { docType: "fx_revaluation", docId: runId, operation: "post" },
      entryDate: input.runDate,
      description: {
        en: `FX revaluation ${input.currencyCode}@${input.rate} on ${input.runDate}`,
        ar: `إعادة تقييم ${input.currencyCode}@${input.rate} بتاريخ ${input.runDate}`,
      },
      currency: base,
      lines,
    };
    const adjusting = await this.posting.post(spec, { postedBy: actorId });
    // Self-reversing twin (dated the next day, in an open period).
    const nextDate = nextDay(input.runDate);
    const twin = await this.posting.reverse(
      {
        originalEntryId: adjusting.journalEntryId,
        entryDate: nextDate,
        reason: `fx_revaluation:auto-reverse of run ${runId}`,
      },
      { reversedBy: actorId },
    );
    await this.audit.record({
      action: "accounting.fx_revaluation_run",
      entityType: "fx_revaluation_run",
      entityId: runId,
      actorId,
      after: {
        runDate: input.runDate,
        currency: input.currencyCode,
        rate: input.rate,
        adjustingEntryId: adjusting.journalEntryId,
        reversingEntryId: twin.journalEntryId,
      },
    });
    return {
      adjustingEntryId: adjusting.journalEntryId,
      reversingEntryId: twin.journalEntryId,
      delta: subExact(deltaCredit, deltaDebit),
    };
  }
}

function generateRunId(): string {
  return generateUuidV7();
}

function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

async function closingEntriesFor(fiscalYearId: string): Promise<journal.JournalEntryRow[]> {
  const rows = await journal.listEntries({
    fromDate: "1900-01-01",
    toDate: "2999-12-31",
    sourceType: "year_end_close",
    limit: 50,
  });
  return rows.rows.filter(
    (row) => row.sourceId === fiscalYearId && row.operation.startsWith("execute"),
  );
}

interface ForeignExposure {
  accountId: string;
  foreignBalance: string;
  baseBalance: string;
}

async function foreignCurrencyExposures(currencyCode: string): Promise<ForeignExposure[]> {
  const exposures: ForeignExposure[] = [];
  const rows = await journal.foreignCurrencyBalances(currencyCode);
  for (const row of rows) {
    if (row.foreignBalance === "0") continue;
    exposures.push({
      accountId: row.accountId,
      foreignBalance: row.foreignBalance,
      baseBalance: row.baseBalance,
    });
  }
  return exposures;
}

function multiplyRate(amount: string, rate: string): string {
  const product = new Decimal(amount).times(new Decimal(rate)).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  return product.toFixed(4);
}


