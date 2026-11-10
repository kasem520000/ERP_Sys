import type { AssertionResult } from "./contract";

/**
 * PHASE-013 T7 · the assertion engine (REPORT_RECONCILIATION §1;
 * FINANCIAL_REPORT_RULES §11): executable self-checks with EXACT-decimal
 * comparison, tolerance 0 (tolerance fudging is forbidden in accounting
 * checks). A FAIL is stored with the compared values (audit review can see
 * what was checked and what it equalled, historically) and blocks
 * export/print server-side — the block is not a hidden button.
 */

import { addExact, compareExact, subExact } from "../../accounting/application/decimal-strings";

/** Exact-decimal equality (tolerance 0). */
export function assertExact(
  id: string,
  left: string,
  right: string,
): AssertionResult {
  const equal = compareExact(left, right) === 0;
  return {
    id,
    status: equal ? "PASS" : "FAIL",
    compared: { left, right },
  };
}

/**
 * `tb-debits-equal-credits` (INV-001): Σ period debit == Σ period credit.
 */
export function tbDebitsEqualCredits(totalDebit: string, totalCredit: string): AssertionResult {
  return assertExact("tb-debits-equal-credits", totalDebit, totalCredit);
}

/**
 * `tb-closing-net-zero` (INV-001/002): Σ closing debit == Σ closing credit.
 */
export function tbClosingNetZero(totalClosingDebit: string, totalClosingCredit: string): AssertionResult {
  return assertExact("tb-closing-net-zero", totalClosingDebit, totalClosingCredit);
}

/**
 * `gl-entry-balance` (INV-001/002): every included entry balances in base.
 */
export function glEntryBalance(
  unbalancedEntries: readonly { entryNo: string; net: string }[],
): AssertionResult {
  const ok = unbalancedEntries.length === 0;
  return {
    id: "gl-entry-balance",
    status: ok ? "PASS" : "FAIL",
    compared: {
      left: "0.0000",
      right: ok ? "0.0000" : unbalancedEntries.map((e) => `${e.entryNo}:${e.net}`).join(","),
    },
    detail: ok
      ? undefined
      : {
          ar: `قيود غير متوازنة: ${unbalancedEntries.length}`,
          en: `Unbalanced entries: ${unbalancedEntries.length}`,
        },
  };
}

/** `is-tb-tie`: IS line totals == TB revenue/expense period movements. */
export function isTbTie(
  isTotals: readonly { id: string; amount: string }[],
  tbMovements: readonly { id: string; amount: string }[],
): AssertionResult {
  let ok = isTotals.length === tbMovements.length;
  if (ok) {
    for (let i = 0; i < isTotals.length; i += 1) {
      const isAmount = isTotals[i]?.amount ?? "0.0000";
      const tbAmount = tbMovements[i]?.amount ?? "0.0000";
      if (compareExact(isAmount, tbAmount) !== 0) {
        ok = false;
        break;
      }
    }
  }
  return {
    id: "is-tb-tie",
    status: ok ? "PASS" : "FAIL",
    compared: {
      left: isTotals.map((t) => t.amount).join("+") || "0.0000",
      right: tbMovements.map((t) => t.amount).join("+") || "0.0000",
    },
  };
}

/** `bs-tb-tie`: BS closing balances == TB closing balances (same scope). */
export function bsTbTie(bsAssets: string, tbClosings: string): AssertionResult {
  return assertExact("bs-tb-tie", bsAssets, tbClosings);
}

/**
 * `bs-current-year-once` (FINANCIAL_REPORT_RULES §4): the current-year
 * result is counted exactly once — closing-entry amount + live YTD net
 * must equal the presented current-year line, and the closing component
 * must be zero when the year is not closed.
 */
export function bsCurrentYearOnce(
  presentedLine: string,
  closingComponent: string,
  ytdComponent: string,
): AssertionResult {
  const composed = addExact(closingComponent, ytdComponent);
  return assertExact("bs-current-year-once", presentedLine, composed);
}

/** `is-net-equals-bs-current-result` (cross-statement identity). */
export function isNetEqualsBsCurrentResult(
  isNet: string,
  bsCurrentYearLine: string,
): AssertionResult {
  return assertExact("is-net-equals-bs-current-result", isNet, bsCurrentYearLine);
}

/** `cf-cash-tie` (INV-019): computed net change == Δ cash+equivalents. */
export function cfCashTie(computedChange: string, actualDelta: string): AssertionResult {
  return assertExact("cf-cash-tie", computedChange, actualDelta);
}

/**
 * A generic ledger-tie assertion for operational reports (§1.4): report
 * total vs GL movement for the same scope.
 */
export function ledgerTie(
  id: string,
  reportTotal: string,
  glMovement: string,
): AssertionResult {
  return assertExact(id, reportTotal, glMovement);
}

/** Aggregate the assertion results into the run-level status. */
export function assertionStatus(results: readonly AssertionResult[]): "PASS" | "FAIL" {
  return results.some((r) => r.status === "FAIL") ? "FAIL" : "PASS";
}

/** Convenience: net of two decimal strings (comparison payloads). */
export { subExact as assertionDelta };
