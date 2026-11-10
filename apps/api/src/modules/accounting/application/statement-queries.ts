/**
 * PHASE-013 T6 · accounting statement query services (FINANCIAL_REPORT_RULES
 * §1–§7, normative): Trial Balance, General Ledger, Income Statement
 * (contra aggregation), Balance Sheet (RE composition), Cash Flow
 * (indirect). Derivation is EXCLUSIVE to posted journal lines joined to
 * the chart of accounts and fiscal calendar — never document tables, never
 * cached balances as source (ACCOUNTING_PRINCIPLES §3).
 *
 * Sign convention: signed = Σ debit − Σ credit; presentation per account
 * type normal side; a contra balance shows on its abnormal side (a credit
 * balance on an asset account renders on the credit side — never a
 * debit-negative). All money is exact decimal strings (ADR-0009).
 *
 * Branch note (documented reality): journal lines carry no branch
 * dimension in migrations 0001–0020 — statements are consolidated over
 * the tenant's posted book by construction; the reporting contracts
 * declare `fixed-all` accordingly (FINANCIAL_REPORT_RULES §1 branch
 * subsets land with a branch-dimensioned journal substrate).
 */
import { Injectable } from "@nestjs/common";

import * as journal from "../infrastructure/journal.store";
import { addExact, compareExact, subExact } from "./decimal-strings";

export interface StatementScope {
  readonly fromDate: string;
  readonly toDate: string;
  /** posted_at cutoff — null = "current" (no freeze). */
  readonly asOf: string | null;
}

/** Purpose markers that make a REVENUE account a contra (deduction) line. */
const REVENUE_CONTRA_PURPOSES: ReadonlySet<string> = new Set([
  "SALES_RETURNS",
  "SALES_DISCOUNTS",
  "PURCHASE_DISCOUNTS",
]);

/** Cash & cash-equivalent purposes (CF §5 + INV-019 tie scope). */
const CASH_PURPOSES: readonly string[] = ["CASH", "PETTY_CASH", "BANK", "BANK_ACCOUNT"];

export interface TrialBalanceAccountRow {
  accountId: string;
  code: string;
  name: string;
  nameAr: string;
  type: string;
  purposeKeys: string[];
  openingDebit: string;
  openingCredit: string;
  periodDebit: string;
  periodCredit: string;
  closingDebit: string;
  closingCredit: string;
}

export interface TrialBalanceResult {
  readonly rows: readonly TrialBalanceAccountRow[];
  readonly totals: {
    openingDebit: string;
    openingCredit: string;
    periodDebit: string;
    periodCredit: string;
    closingDebit: string;
    closingCredit: string;
  };
}

@Injectable()
export class StatementQueries {
  /**
   * Trial Balance (§2): per leaf postable account — opening side balance,
   * period debit/credit flows, closing side balance. One-side presentation
   * by balance sign; zero rows suppressed by the contract layer (assertion
   * math always sees the full set).
   */
  async trialBalance(scope: StatementScope): Promise<TrialBalanceResult> {
    const window = await journal.statementAccountWindow(scope);
    const rows: TrialBalanceAccountRow[] = window.map((row) => {
      const closing = addExact(row.openingSigned, row.periodSigned);
      const [openingDebit, openingCredit] = sideSplit(row.openingSigned);
      const [closingDebit, closingCredit] = sideSplit(closing);
      return {
        accountId: row.accountId,
        code: row.code,
        name: row.name,
        nameAr: row.nameAr,
        type: row.type,
        purposeKeys: row.purposeKeys,
        openingDebit,
        openingCredit,
        periodDebit: row.periodDebit,
        periodCredit: row.periodCredit,
        closingDebit,
        closingCredit,
      };
    });
    const totals = {
      openingDebit: sumOf(rows.map((r) => r.openingDebit)),
      openingCredit: sumOf(rows.map((r) => r.openingCredit)),
      periodDebit: sumOf(rows.map((r) => r.periodDebit)),
      periodCredit: sumOf(rows.map((r) => r.periodCredit)),
      closingDebit: sumOf(rows.map((r) => r.closingDebit)),
      closingCredit: sumOf(rows.map((r) => r.closingCredit)),
    };
    return { rows, totals };
  }

  /**
   * General Ledger (§2 drill): one account's line feed with opening +
   * running balance. Entries arrive balanced by construction; the contract
   * asserts gl-entry-balance over the window.
   */
  async generalLedger(
    scope: StatementScope & { accountId: string; limit?: number },
  ): Promise<{
    account: { id: string; code: string; name: string; nameAr: string; type: string };
    openingBalance: string;
    lines: readonly {
      entryId: string;
      entryNo: string;
      entryDate: string;
      sourceType: string;
      sourceId: string | null;
      description: string | null;
      lineNo: number;
      direction: "DEBIT" | "CREDIT";
      amount: string;
      baseAmount: string;
      currencyCode: string;
      exchangeRate: string;
      memo: string | null;
      balanceAfter: string;
    }[];
  }> {
    const window = await journal.statementAccountWindow(scope);
    const accountRow = window.find((row) => row.accountId === scope.accountId);
    const lines = await journal.accountLedgerLines(scope);
    let running = accountRow === undefined ? "0.0000" : accountRow.openingSigned;
    const openingBalance = running;
    const withBalance = lines.map((line) => {
      running = addExact(
        running,
        line.direction === "DEBIT" ? line.baseAmount : `-${line.baseAmount}`,
      );
      return {
        entryId: line.entryId,
        entryNo: line.entryNo,
        entryDate: line.entryDate,
        sourceType: line.sourceType,
        sourceId: line.sourceId,
        description: line.descriptionAr ?? line.description,
        lineNo: line.lineNo,
        direction: line.direction,
        amount: line.amount,
        baseAmount: line.baseAmount,
        currencyCode: line.currencyCode,
        exchangeRate: line.exchangeRate,
        memo: line.memoAr ?? line.memo,
        balanceAfter: running,
      };
    });
    return {
      account: {
        id: scope.accountId,
        code: accountRow?.code ?? "",
        name: accountRow?.name ?? "",
        nameAr: accountRow?.nameAr ?? "",
        type: accountRow?.type ?? "",
      },
      openingBalance,
      lines: withBalance,
    };
  }

  /** Unbalanced entries in a window (the gl-entry-balance check feed). */
  async unbalancedEntries(
    scope: StatementScope,
  ): Promise<readonly { entryId: string; entryNo: string; net: string }[]> {
    return journal.unbalancedEntries(scope);
  }

  /**
   * Income Statement (§3): the REVENUE + EXPENSE universe with contra
   * aggregation into the parent presentation — gross revenue − returns −
   * discounts = net revenue (purposes declare the deduction, statements
   * never guess by name); COGS as its own section; period movement and a
   * YTD column from the fiscal-year start.
   */
  async incomeStatement(
    scope: StatementScope & { fiscalYearStart: string },
  ): Promise<IncomeStatementResult> {
    const window = await journal.statementAccountWindow(scope);
    const ytdWindow = await journal.statementAccountWindow({
      fromDate: scope.fiscalYearStart,
      toDate: scope.toDate,
      asOf: scope.asOf,
    });
    const ytdByAccount = new Map(ytdWindow.map((row) => [row.accountId, row]));

    const revenue = window
      .filter((row) => row.type === "REVENUE")
      .map((row) => this.isRevenueRow(row, incomeRow(row)));
    const expenses = window
      .filter((row) => row.type === "EXPENSE" && !row.purposeKeys.includes("COGS"))
      .map((row) => incomeRow(row));
    const cogs = window.filter((row) => row.purposeKeys.includes("COGS")).map((row) => incomeRow(row));

    const grossRevenue = sumOf(revenue.filter((r) => !r.isContra).map((r) => r.presented));
    const contraTotal = sumOf(revenue.filter((r) => r.isContra).map((r) => r.presented));
    const netRevenue = addExact(grossRevenue, contraTotal); // contras are negative
    const cogsTotal = sumOf(cogs.map((r) => r.presented));
    const grossProfit = subExact(netRevenue, cogsTotal);
    const expenseTotal = sumOf(expenses.map((r) => r.presented));
    const netIncome = subExact(grossProfit, expenseTotal);

    // YTD columns: same presentation rules over the fiscal-year window.
    const ytdRevenue = sumOf(
      [...ytdByAccount.values()]
        .filter((row) => row.type === "REVENUE")
        .map((row) => negate(row.periodSigned)),
    );
    // PHASE-013 fix (T-TESTS): presentation is per normal side — REVENUE
    // accounts are credit-normal (presented = negate(signed); contra revenue
    // debits surface negative as they must), EXPENSE/COGS accounts are
    // debit-normal (presented = signed, i.e. positive). The original
    // blanket negate() presented expenses negative, so netIncome ADDED them
    // back (1200 − (−300) = 1500 instead of 1200 − 300 = 900).
    const ytdCogs = sumOf(
      [...ytdByAccount.values()]
        .filter((row) => row.purposeKeys.includes("COGS"))
        .map((row) => row.periodSigned),
    );
    const ytdExpense = sumOf(
      [...ytdByAccount.values()]
        .filter((row) => row.type === "EXPENSE" && !row.purposeKeys.includes("COGS"))
        .map((row) => row.periodSigned),
    );
    // YTD net = ytdRevenue − ytdCogs − ytdExpense (all presented positive).
    const ytdNetIncome = subExact(subExact(ytdRevenue, ytdCogs), ytdExpense);

    return {
      revenue,
      cogs,
      expenses,
      totals: {
        grossRevenue,
        contraTotal,
        netRevenue,
        cogsTotal,
        grossProfit,
        expenseTotal,
        netIncome,
        ytdNetIncome,
      },
      ytdRevenue,
      ytdNet: ytdNetIncome,
    };
  }

  private isRevenueRow(
    row: journal.StatementWindowRow,
    base: IncomeLine,
  ): IncomeLine & { isContra: boolean } {
    const isContra = row.purposeKeys.some((key) => REVENUE_CONTRA_PURPOSES.has(key));
    return { ...base, isContra };
  }

  /**
   * Balance Sheet (§4): as-of balances for ASSET/LIABILITY/EQUITY with the
   * retained-earnings composition — prior-years RE + CLOSING-purpose
   * balance + live current-year YTD net income, counted exactly once
   * (`bs-current-year-once`). Optional prior-year comparative column
   * re-derives from posted lines at its own asOf (never a stored snapshot).
   */
  async balanceSheet(
    scope: { asOfDate: string; asOf: string | null; fiscalYearStart: string },
    options: { priorYearComparative?: boolean } = {},
  ): Promise<BalanceSheetResult> {
    const current = await journal.accountBalancesAt({ asOfDate: scope.asOfDate, asOf: scope.asOf });
    const prior = options.priorYearComparative
      ? await journal.accountBalancesAt({
          asOfDate: dateShiftYear(scope.asOfDate, -1),
          asOf: scope.asOf,
        })
      : [];
    const priorByAccount = new Map(prior.map((row) => [row.accountId, row.signedBalance]));

    // Live current-year YTD net income (revenue+expense balances from the
    // fiscal-year start up to asOf — the closing entry's counter-lines
    // zero these naturally once posted, so the result is counted once).
    const ytdWindow = await journal.statementAccountWindow({
      fromDate: scope.fiscalYearStart,
      toDate: scope.asOfDate,
      asOf: scope.asOf,
    });
    let ytdNetSigned = "0.0000";
    for (const row of ytdWindow) {
      if (row.type === "REVENUE" || row.type === "EXPENSE") {
        ytdNetSigned = addExact(ytdNetSigned, row.periodSigned);
      }
    }
    const liveYtdNetIncome = negate(ytdNetSigned); // positive = profit

    const assets: BalanceLine[] = [];
    const liabilities: BalanceLine[] = [];
    const equity: BalanceLine[] = [];
    let closingAccountSigned = "0.0000";
    let totalAssets = "0.0000";
    let totalLiabilities = "0.0000";
    let totalEquityBase = "0.0000";

    for (const row of current) {
      const presented = negate(row.signedBalance); // credit-normal presentation
      const priorBalance = negate(priorByAccount.get(row.accountId) ?? "0.0000");
      const line: BalanceLine = {
        accountId: row.accountId,
        code: row.code,
        name: row.name,
        nameAr: row.nameAr,
        parentCode: row.parentCode,
        purposeKeys: row.purposeKeys,
        amount: presented,
        priorYear: priorBalance,
      };
      if (row.purposeKeys.includes("CLOSING")) {
        closingAccountSigned = row.signedBalance;
        // The CLOSING account itself nets to zero after its close entry;
        // its balance feeds the current-year composition line below.
        continue;
      }
      if (row.type === "ASSET") {
        assets.push({ ...line, amount: row.signedBalance, priorYear: priorByAccount.get(row.accountId) ?? "0.0000" });
        totalAssets = addExact(totalAssets, row.signedBalance);
      } else if (row.type === "LIABILITY") {
        liabilities.push(line);
        totalLiabilities = addExact(totalLiabilities, presented);
      } else if (row.type === "EQUITY") {
        equity.push(line);
        totalEquityBase = addExact(totalEquityBase, presented);
      }
    }

    // Current-year result line: CLOSING balance (closed earlier year inside
    // the asOf scope) + live YTD net income — exactly once.
    const closingComponent = negate(closingAccountSigned);
    const currentYearLine = addExact(closingComponent, liveYtdNetIncome);
    const totalEquity = addExact(totalEquityBase, currentYearLine);

    return {
      assets,
      liabilities,
      equity,
      currentYearResult: {
        closingComponent,
        ytdComponent: liveYtdNetIncome,
        total: currentYearLine,
      },
      totals: {
        totalAssets,
        totalLiabilities,
        totalEquity,
        difference: subExact(totalAssets, addExact(totalLiabilities, totalEquity)),
      },
    };
  }

  /**
   * Cash Flow (§5, indirect): net income ± non-cash working-capital deltas
   * ± identifiable non-cash adjustments (FX purposes) − investments in
   * non-current assets ± financing items = net change in cash, tied to the
   * actual Δ of cash & equivalents (INV-019). Untagged accounts aggregate
   * into "أخرى / Other" — the limitation is displayed on the report itself.
   */
  async cashFlow(
    scope: StatementScope & { fiscalYearStart: string },
  ): Promise<CashFlowResult> {
    const is = await this.incomeStatement(scope);
    const start = await journal.accountBalancesAt({
      asOfDate: dayBefore(scope.fromDate),
      asOf: scope.asOf,
    });
    const end = await journal.accountBalancesAt({ asOfDate: scope.toDate, asOf: scope.asOf });
    const startByAccount = new Map(start.map((row) => [row.accountId, row.signedBalance]));
    const cashAccounts = await journal.accountsForPurposes(CASH_PURPOSES);
    const cashIds = new Set(cashAccounts.map((row) => row.accountId));

    const buckets: CashFlowLine[] = [];
    let actualCashDelta = "0.0000";

    const deltaOf = (row: { accountId: string; signedBalance: string }): string =>
      subExact(row.signedBalance, startByAccount.get(row.accountId) ?? "0.0000");

    for (const row of end) {
      const delta = deltaOf(row);
      if (cashIds.has(row.accountId)) {
        actualCashDelta = addExact(actualCashDelta, delta);
        continue;
      }
      if (row.type === "REVENUE" || row.type === "EXPENSE") {
        continue; // P&L flows through net income
      }
      let section: "operating" | "investing" | "financing" | "other";
      if (row.purposeKeys.includes("AR_CONTROL")) {
        section = "operating"; // Δ AR
      } else if (row.purposeKeys.includes("AP_CONTROL")) {
        section = "operating"; // Δ AP
      } else if (row.purposeKeys.includes("INVENTORY") || row.purposeKeys.includes("GRNI")) {
        section = "operating"; // Δ inventory / GRNI
      } else if (row.purposeKeys.includes("VAT_PAYABLE") || row.purposeKeys.includes("VAT_RECOVERABLE")) {
        section = "operating"; // Δ VAT
      } else if (row.type === "ASSET") {
        section = row.parentCode !== null && row.parentCode.startsWith("12") ? "investing" : "operating";
      } else if (row.type === "LIABILITY") {
        section = row.parentCode !== null && row.parentCode.startsWith("22") ? "financing" : "operating";
      } else if (row.type === "EQUITY") {
        section = "financing";
      } else {
        section = "other";
      }
      buckets.push({
        accountId: row.accountId,
        code: row.code,
        name: row.name,
        nameAr: row.nameAr,
        type: row.type,
        section,
        delta,
      });
    }

    const operatingExNet = sumOf(
      buckets.filter((b) => b.section === "operating").map((b) => negate(b.delta)),
    );
    const investing = sumOf(
      buckets.filter((b) => b.section === "investing").map((b) => negate(b.delta)),
    );
    const financing = sumOf(
      buckets.filter((b) => b.section === "financing").map((b) => negate(b.delta)),
    );
    const other = sumOf(buckets.filter((b) => b.section === "other").map((b) => negate(b.delta)));
    const computedChange = sumOf([is.totals.netIncome, operatingExNet, investing, financing, other]);

    return {
      netIncome: is.totals.netIncome,
      operatingAdjustments: buckets.filter((b) => b.section === "operating"),
      investingAdjustments: buckets.filter((b) => b.section === "investing"),
      financingAdjustments: buckets.filter((b) => b.section === "financing"),
      otherAdjustments: buckets.filter((b) => b.section === "other"),
      totals: {
        netIncome: is.totals.netIncome,
        operating: addExact(is.totals.netIncome, operatingExNet),
        investing,
        financing,
        other,
        computedChange,
        actualCashDelta,
        difference: subExact(computedChange, actualCashDelta),
      },
    };
  }

  /** Fiscal-year start for a date (calendar-year MVP: Jan 1 of the year). */
  fiscalYearStartOf(date: string): string {
    return `${date.slice(0, 4)}-01-01`;
  }
}

// ---------------------------------------------------------------------------
// Shapes + helpers
// ---------------------------------------------------------------------------

export interface IncomeLine {
  accountId: string;
  code: string;
  name: string;
  nameAr: string;
  purposeKeys: string[];
  presented: string;
  ytd: string;
}

export interface IncomeStatementResult {
  revenue: readonly (IncomeLine & { isContra: boolean })[];
  cogs: readonly IncomeLine[];
  expenses: readonly IncomeLine[];
  totals: {
    grossRevenue: string;
    contraTotal: string;
    netRevenue: string;
    cogsTotal: string;
    grossProfit: string;
    expenseTotal: string;
    netIncome: string;
    ytdNetIncome: string;
  };
  ytdRevenue: string;
  ytdNet: string;
}

export interface BalanceLine {
  accountId: string;
  code: string;
  name: string;
  nameAr: string;
  parentCode: string | null;
  purposeKeys: string[];
  amount: string;
  priorYear: string;
}

export interface BalanceSheetResult {
  assets: readonly BalanceLine[];
  liabilities: readonly BalanceLine[];
  equity: readonly BalanceLine[];
  currentYearResult: { closingComponent: string; ytdComponent: string; total: string };
  totals: {
    totalAssets: string;
    totalLiabilities: string;
    totalEquity: string;
    difference: string;
  };
}

export interface CashFlowLine {
  accountId: string;
  code: string;
  name: string;
  nameAr: string;
  type: string;
  section: "operating" | "investing" | "financing" | "other";
  delta: string;
}

export interface CashFlowResult {
  netIncome: string;
  operatingAdjustments: readonly CashFlowLine[];
  investingAdjustments: readonly CashFlowLine[];
  financingAdjustments: readonly CashFlowLine[];
  otherAdjustments: readonly CashFlowLine[];
  totals: {
    netIncome: string;
    operating: string;
    investing: string;
    financing: string;
    other: string;
    computedChange: string;
    actualCashDelta: string;
    difference: string;
  };
}

function incomeRow(row: journal.StatementWindowRow): IncomeLine {
  // Presentation per account-type normal side (§1 sign convention):
  // REVENUE rows are credit-normal (negate the signed balance — contras
  // surface negative); EXPENSE/COGS rows are debit-normal (the signed debit
  // movement IS the presented expense). PHASE-013 fix (T-TESTS): the
  // original blanket negate() made every expense negative and the
  // subtraction in netIncome/grossProfit added them back.
  const presented = row.type === "REVENUE" ? negate(row.periodSigned) : row.periodSigned;
  return {
    accountId: row.accountId,
    code: row.code,
    name: row.name,
    nameAr: row.nameAr,
    purposeKeys: row.purposeKeys,
    presented,
    ytd: "0.0000",
  };
}

/** Split a signed balance onto one side (§2: sign decides the side). */
function sideSplit(signed: string): [string, string] {
  if (compareExact(signed, "0.0000") > 0) {
    return [signed, "0.0000"];
  }
  if (compareExact(signed, "0.0000") < 0) {
    return ["0.0000", subExact("0.0000", signed)];
  }
  return ["0.0000", "0.0000"];
}

function negate(value: string): string {
  return subExact("0.0000", value);
}

function sumOf(values: readonly string[]): string {
  return values.reduce((acc, value) => addExact(acc, value), "0.0000");
}

function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function dateShiftYear(date: string, years: number): string {
  const year = Number(date.slice(0, 4)) + years;
  return `${String(year).padStart(4, "0")}${date.slice(4)}`;
}
