import { addExact, compareExact } from "../../accounting/application/decimal-strings";

import { ConsolidationDriftError } from "../domain/consolidation-errors";

/**
 * PHASE-034 T12 · the INV-026 core — PURE (exported for the unit suite; no
 * I/O): **consolidated statement = Σ member statements (group currency,
 * dated FX) − eliminations**, checked LINE-BY-LINE against the run snapshot.
 *
 * INV-026 (ACCOUNTING_INVARIANTS): consolidation runs never write member
 * books; every elimination is a balanced journal in the parent's
 * consolidation books; the consolidated statements are DERIVED artifacts
 * that must reconcile to Σ members − eliminations or the assertion fails,
 * export blocks, the statement flags (never a silent drift — Sev-1).
 *
 * The G-32 elimination shape (JOURNAL_RULES §7): DR AP_CONTROL (entity B
 * intercompany) · CR AR_CONTROL (entity A intercompany) — in the PARENT's
 * consolidation books only.
 */

/** One consolidated-statement line's money shape (group currency, 4dp). */
export interface StatementAmounts {
  debit: string;
  credit: string;
}

export function zeroAmounts(): StatementAmounts {
  return { debit: "0.0000", credit: "0.0000" };
}

/** One member's translated account extract (the snapshot member line). */
export interface MemberExtractLine {
  memberTenantId: string;
  accountCode: string;
  accountType: string;
  purposeKey: string | null;
  /** Group-currency debit/credit for the period (translated, 4dp). */
  amounts: StatementAmounts;
}

/** One elimination line effect in group currency (the parent's consolidation
 * books — the G-32 journals). */
export interface EliminationEffectLine {
  eliminationId: string;
  eliminationNo: string | null;
  accountCode: string;
  purposeKey: string | null;
  /** The elimination journal's DR/CR lines (the parent's consolidation
   * books) — they ADD into the consolidated view and CANCEL the
   * intra-group positions business-wise: an intercompany elimination DR
   * AP_CONTROL (entity B) nets B's payable to zero, CR AR_CONTROL (entity
   * A) nets A's receivable to zero. INV-026's "− eliminations" is the
   * business phrasing; the mechanical arithmetic is Σ member NET +
   * elimination NET (the journals are part of the consolidated universe,
   * posted in the parent's consolidation books — the member extracts
   * EXCLUDE consolidation-source rows so nothing double-counts). */
  amounts: StatementAmounts;
}

/** A consolidated statement line (account-level, group currency). */
export interface ConsolidatedLine {
  accountCode: string;
  accountType: string;
  purposeKey: string | null;
  amounts: StatementAmounts;
}

/**
 * Σ member statements + the elimination journals' nets, LINE-BY-LINE (per
 * account):
 *
 *   consolidated[account].debit   = Σ members[account].debit   + eliminations[account].debit
 *   consolidated[account].credit  = Σ members[account].credit  + eliminations[account].credit
 *
 * The ADD semantics is the correct consolidation mechanics: the G-32
 * elimination journal (in the parent's consolidation books) carries the
 * OPPOSITE side of each intra-group position — DR AP_CONTROL (entity B)
 * nets B's payable out, CR AR_CONTROL (entity A) nets A's receivable out
 * — so adding its lines to Σ members yields the group view with the
 * intra-group positions removed (INV-026's "− eliminations" business
 * phrasing). The member extracts exclude consolidation-source rows (the
 * reader filters source_type ≠ 'consolidation_elimination'), so the
 * parent-member's statutory books never double-count its consolidation
 * books. Deterministic: same inputs → same output (the
 * snapshot-determinism suite pins this at the byte level).
 */
export function computeConsolidatedLines(
  members: readonly MemberExtractLine[],
  eliminations: readonly EliminationEffectLine[],
): ConsolidatedLine[] {
  const byAccount = new Map<
    string,
    { accountType: string; purposeKey: string | null; amounts: StatementAmounts }
  >();
  const touch = (line: { accountCode: string; accountType?: string; purposeKey?: string | null }) => {
    let row = byAccount.get(line.accountCode);
    if (row === undefined) {
      row = {
        accountType: line.accountType ?? "",
        purposeKey: line.purposeKey ?? null,
        amounts: zeroAmounts(),
      };
      byAccount.set(line.accountCode, row);
    }
    if (line.accountType && line.accountType !== row.accountType) {
      row.accountType = line.accountType;
    }
    return row;
  };

  for (const member of members) {
    const row = touch(member);
    row.amounts.debit = addExact(row.amounts.debit, member.amounts.debit);
    row.amounts.credit = addExact(row.amounts.credit, member.amounts.credit);
  }
  for (const elimination of eliminations) {
    const row = touch(elimination);
    row.amounts.debit = addExact(row.amounts.debit, elimination.amounts.debit);
    row.amounts.credit = addExact(row.amounts.credit, elimination.amounts.credit);
  }

  return [...byAccount.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([accountCode, row]) => ({
      accountCode,
      accountType: row.accountType,
      purposeKey: row.purposeKey,
      amounts: row.amounts,
    }));
}

/** The INV-026 headline assertion result (REPORT_CONTRACT shape). */
export interface Inv026AssertionResult {
  id: "inv026-consolidated-equals-members-minus-eliminations";
  status: "PASS" | "FAIL";
  compared: { left: string; right: string };
  brokenLines: string[];
}

/**
 * The INV-026 line-by-line check: every consolidated line must equal its Σ
 * members + eliminations reconstruction (the intra-group positions net
 * out), and the TOTAL must reconcile:
 *
 *   Σ consolidated.debit − Σ consolidated.credit
 *     == Σ (Σ members + eliminations).debit − ... .credit
 *
 * Used twice: by the run service at snapshot build (drift ⇒ the run FAILS
 * typed — a snapshot that does not reconcile is never COMPLETED) and by the
 * report contracts at render (drift ⇒ ASSERTION_FAILED + export blocked).
 */
export function assertInv026(input: {
  runId: string;
  consolidated: readonly ConsolidatedLine[];
  members: readonly MemberExtractLine[];
  eliminations: readonly EliminationEffectLine[];
}): Inv026AssertionResult {
  const reconstructed = computeConsolidatedLines(input.members, input.eliminations);
  const byCode = new Map(reconstructed.map((line) => [line.accountCode, line]));

  let consolidatedDebit = "0.0000";
  let consolidatedCredit = "0.0000";
  let expectedDebit = "0.0000";
  let expectedCredit = "0.0000";
  const brokenLines: string[] = [];

  for (const line of input.consolidated) {
    consolidatedDebit = addExact(consolidatedDebit, line.amounts.debit);
    consolidatedCredit = addExact(consolidatedCredit, line.amounts.credit);
    const expected = byCode.get(line.accountCode);
    const expDebit = expected?.amounts.debit ?? "0.0000";
    const expCredit = expected?.amounts.credit ?? "0.0000";
    if (compareExact(line.amounts.debit, expDebit) !== 0 || compareExact(line.amounts.credit, expCredit) !== 0) {
      brokenLines.push(
        `${line.accountCode}: consolidated DR ${line.amounts.debit}/CR ${line.amounts.credit} ≠ Σ members − eliminations DR ${expDebit}/CR ${expCredit}`,
      );
    }
  }
  for (const line of reconstructed) {
    expectedDebit = addExact(expectedDebit, line.amounts.debit);
    expectedCredit = addExact(expectedCredit, line.amounts.credit);
  }

  const totalOk =
    compareExact(consolidatedDebit, expectedDebit) === 0 &&
    compareExact(consolidatedCredit, expectedCredit) === 0;
  const ok = brokenLines.length === 0 && totalOk;
  return {
    id: "inv026-consolidated-equals-members-minus-eliminations",
    status: ok ? "PASS" : "FAIL",
    compared: {
      left: `DR ${consolidatedDebit} / CR ${consolidatedCredit}`,
      right: `DR ${expectedDebit} / CR ${expectedCredit}`,
    },
    brokenLines,
  };
}

/** Throw on drift (the run-service build-time gate — a snapshot that does
 * not reconcile never reaches COMPLETED). */
export function throwOnDrift(input: {
  runId: string;
  result: Inv026AssertionResult;
}): void {
  if (input.result.status === "FAIL") {
    throw new ConsolidationDriftError({
      runId: input.runId,
      assertion: input.result.id,
      left: input.result.compared.left,
      right: input.result.compared.right,
    });
  }
}

/** The standard TB balance assertion (FINANCIAL_REPORT_RULES §3, reused for
 * the consolidated TB: Σ debits == Σ credits — tolerance 0). */
export function assertTrialBalanceBalanced(
  lines: readonly ConsolidatedLine[],
): { status: "PASS" | "FAIL"; debit: string; credit: string } {
  let debit = "0.0000";
  let credit = "0.0000";
  for (const line of lines) {
    debit = addExact(debit, line.amounts.debit);
    credit = addExact(credit, line.amounts.credit);
  }
  return {
    status: compareExact(debit, credit) === 0 ? "PASS" : "FAIL",
    debit,
    credit,
  };
}

/** Seeded-drift detection helper (the INV-026 suite's tamper surface): a
 * snapshot line whose stored amounts no longer reconstruct from its own
 * member/elimination components. Pure — the suite tampers and re-checks. */
export function detectSnapshotTamper(input: {
  runId: string;
  snapshotLines: readonly ConsolidatedLine[];
  members: readonly MemberExtractLine[];
  eliminations: readonly EliminationEffectLine[];
}): Inv026AssertionResult {
  return assertInv026({
    runId: input.runId,
    consolidated: input.snapshotLines,
    members: input.members,
    eliminations: input.eliminations,
  });
}
