import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import * as journalStore from "../../accounting/infrastructure/journal.store";
import * as store from "../infrastructure/treasury.store";
import {
  BankRecPeriodLockedError,
  MovementAlreadyMatchedError,
  MovementNotFoundError,
  StatementAlreadyReconciledError,
  StatementLineNotFoundError,
  StatementNotFoundError,
  TreasuryDocumentStateError,
} from "../domain/treasury-errors";
import { moneyAbs } from "./document-support";

/**
 * Bank reconciliation service (PHASE-008 T11; BR-022 fixed;
 * RECONCILIATION.md §4): auto-match (amount + date window + reference
 * boost), manual match/unmatch remainder, unmatched aging on BOTH sides,
 * and the per-account statement-period reconcile that LOCKS the period.
 * No tolerance absorption — every unmatched item stays listed and
 * explainable; statement lines never create ledger entries.
 */
const AUTO_MATCH_WINDOW_DAYS = 3;

@Injectable()
export class BankRecService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /**
   * Auto-match (§2.8): for every unmatched statement line, find the
   * unmatched system movement on the same account with the exact amount
   * (direction implied by the sign), value date within the window, and the
   * reference (when provided) boosting proximity. First candidate wins.
   */
  async autoMatch(input: { statementId: string; actorId: string | null }): Promise<{ matched: number }> {
    const statement = await this.requireStatement(input.statementId);
    if (statement.status === "RECONCILED") {
      throw new StatementAlreadyReconciledError(statement.id);
    }
    const lines = await store.listStatementLines(statement.id);
    let matched = 0;
    for (const line of lines) {
      if (line.matchedMovementId !== null) continue;
      await this.assertPeriodUnlocked(statement.cashAccountId, line.lineDate);
      // Sign convention: positive line = money into the bank (IN movement),
      // negative = money out (OUT movement) — exact amount, no tolerance.
      const candidates = await store.findMatchCandidates({
        cashAccountId: statement.cashAccountId,
        amount: moneyAbs(line.amount),
        fromDate: shiftIso(line.lineDate, -AUTO_MATCH_WINDOW_DAYS),
        toDate: shiftIso(line.lineDate, AUTO_MATCH_WINDOW_DAYS),
        reference: line.reference ?? undefined,
        limit: 5,
      });
      const direction = line.amount.startsWith("-") ? "OUT" : "IN";
      const candidate = candidates.find((row) => row.direction === direction);
      if (candidate === undefined) continue;
      await store.setLineMatch({
        lineId: line.id,
        matchedMovementId: candidate.id,
        actorId: input.actorId,
        mode: "AUTO",
      });
      matched += 1;
    }
    if (matched > 0) {
      await this.audit.record({
        action: "treasury.bank_statement_auto_matched",
        entityType: "bank_statement",
        entityId: statement.id,
        actorId: input.actorId ?? undefined,
        after: { matched },
      });
    }
    return { matched };
  }

  /** Manual match (or unmatch when movementId is null) of a single line. */
  async manualMatch(input: {
    lineId: string;
    movementId: string | null;
    actorId: string | null;
  }): Promise<void> {
    const line = await store.findStatementLineById(input.lineId);
    if (line === undefined) throw new StatementLineNotFoundError(input.lineId);
    const statement = await this.requireStatement(line.bankStatementId);
    if (statement.status === "RECONCILED") {
      throw new StatementAlreadyReconciledError(statement.id);
    }
    if (line.matchedMovementId !== null && input.movementId === null) {
      // Un-match: informational only, allowed while IMPORTED.
      await store.setLineMatch({ lineId: line.id, matchedMovementId: null, actorId: input.actorId, mode: "MANUAL" });
      await this.audit.record({
        action: "treasury.bank_statement_line_unmatched",
        entityType: "bank_statement_line",
        entityId: line.id,
        actorId: input.actorId ?? undefined,
        before: { matchedMovementId: line.matchedMovementId },
      });
      return;
    }
    if (input.movementId === null) return;
    const movement = await store.findMovementById(input.movementId);
    if (movement === undefined) throw new MovementNotFoundError(input.movementId);
    if (movement.cashAccountId !== statement.cashAccountId) {
      throw new TreasuryDocumentStateError(
        "the movement belongs to a different cash account than the statement",
      );
    }
    const existing = await store.listStatementLines(statement.id);
    if (existing.some((row) => row.matchedMovementId === movement.id)) {
      throw new MovementAlreadyMatchedError(movement.id);
    }
    if (movement.amount !== moneyAbs(line.amount)) {
      throw new TreasuryDocumentStateError(
        `amount mismatch: line ${line.amount} vs movement ${movement.amount} (matching is exact — no tolerance absorption, BR-022)`,
      );
    }
    const movementDirection = line.amount.startsWith("-") ? "OUT" : "IN";
    if (movement.direction !== movementDirection) {
      throw new TreasuryDocumentStateError(
        `direction mismatch: the line is money ${movementDirection === "IN" ? "in" : "out"} but the movement is ${movement.direction}`,
      );
    }
    await this.assertPeriodUnlocked(statement.cashAccountId, line.lineDate);
    await store.setLineMatch({
      lineId: line.id,
      matchedMovementId: movement.id,
      actorId: input.actorId,
      mode: "MANUAL",
    });
    await this.audit.record({
      action: "treasury.bank_statement_line_matched",
      entityType: "bank_statement_line",
      entityId: line.id,
      actorId: input.actorId ?? undefined,
      after: { movementId: movement.id, mode: "MANUAL" },
    });
  }

  /**
   * Unmatched aging (§2.8): both sides — unmatched statement lines and
   * unmatched system movements on the account — with age in days. Never
   * absorbed, always explainable (BR-022).
   */
  async unmatchedAging(input: { cashAccountId: string; asOf?: string }) {
    const statements = await store.listStatements({ cashAccountId: input.cashAccountId, limit: 100 });
    const lines = (
      await Promise.all(
        statements.map(async (statement) => store.listStatementLines(statement.id)),
      )
    ).flat();
    const unmatchedLines = lines
      .filter((line) => line.matchedMovementId === null)
      .map((line) => ({ ...line, ageDays: ageDays(line.lineDate, input.asOf) }));
    const movements = await store.listMovements({
      cashAccountId: input.cashAccountId,
      limit: 500,
    });
    const matchedIds = new Set(lines.map((line) => line.matchedMovementId).filter((id): id is string => id !== null));
    const unmatchedMovements = movements
      .filter((movement) => !matchedIds.has(movement.id))
      .map((movement) => ({
        id: movement.id,
        direction: movement.direction,
        amount: movement.amount,
        baseAmount: movement.baseAmount,
        valueDate: movement.valueDate,
        memo: movement.memo,
        sourceType: movement.sourceType,
        sourceId: movement.sourceId,
        ageDays: ageDays(movement.valueDate, input.asOf),
      }));
    return { unmatchedLines, unmatchedMovements };
  }

  /**
   * Reconcile (BR-022): locks the statement period for the account. The
   * unmatched items stay listed with aging (they are NOT absorbed); a
   * second reconcile is refused; matching inside a reconciled window for
   * this account is refused (BANK_REC_PERIOD_LOCKED). A 'BANK_REC'
   * reconciliation run is recorded in the PHASE-007 framework so the
   * period-close checklist (PERIOD_CLOSING §2 item 3) reads it.
   */
  async reconcile(input: { statementId: string; actorId: string | null }) {
    const statement = await this.requireStatement(input.statementId);
    if (statement.status === "RECONCILED") {
      throw new StatementAlreadyReconciledError(statement.id);
    }
    const lines = await store.listStatementLines(statement.id);
    const matched = lines.filter((line) => line.matchedMovementId !== null).length;
    const unmatchedLines = lines.length - matched;
    const movements = await store.listMovements({
      cashAccountId: statement.cashAccountId,
      fromDate: statement.periodStart,
      toDate: statement.periodEnd,
      limit: 500,
    });
    const matchedIds = new Set(
      lines.map((line) => line.matchedMovementId).filter((id): id is string => id !== null),
    );
    const unmatchedMovements = movements.filter((movement) => !matchedIds.has(movement.id)).length;

    await store.markStatementReconciled({ id: statement.id, actorId: input.actorId });

    // The framework run: kind BANK_REC, as-of the period end (PC checklist).
    await journalStore.insertReconciliationRun({
      kind: "BANK_REC",
      asOf: statement.periodEnd,
      status: "OK",
      controlBalance: "0.0000",
      subledgerBalance: "0.0000",
      diffCount: 0,
      diff: {
        accountId: statement.cashAccountId,
        statementId: statement.id,
        lines: lines.length,
        matched,
        unmatchedLines,
        unmatchedMovements,
        note: "statement reconciled — unmatched items listed with aging (BR-022: never absorbed)",
      },
      runMode: "ON_DEMAND",
      checkedBy: input.actorId,
    });

    await this.audit.record({
      action: "treasury.bank_statement_reconciled",
      entityType: "bank_statement",
      entityId: statement.id,
      actorId: input.actorId ?? undefined,
      before: { status: "IMPORTED" },
      after: {
        status: "RECONCILED",
        period: `${statement.periodStart}..${statement.periodEnd}`,
        lines: lines.length,
        matched,
        unmatchedLines,
        unmatchedMovements,
      },
    });
    return this.find(statement.id);
  }

  async find(id: string) {
    const statement = await store.findStatementById(id);
    if (statement === undefined) throw new StatementNotFoundError(id);
    return statement;
  }

  private async requireStatement(id: string) {
    return this.find(id);
  }

  /** BR-022 lock probe: matching inside a RECONCILED period is refused. */
  private async assertPeriodUnlocked(cashAccountId: string, date: string): Promise<void> {
    const locked = await store.isAccountPeriodReconciled(cashAccountId, date);
    if (locked) {
      throw new BankRecPeriodLockedError({ accountId: cashAccountId, date });
    }
  }
}

function shiftIso(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function ageDays(date: string, asOf?: string): number {
  // Calendar-day aging (not money math): whole UTC days between the dates.
  const from = new Date(`${date}T00:00:00Z`).getTime();
  const to = asOf === undefined
    ? new Date(new Date().toISOString().slice(0, 10)).getTime()
    : new Date(`${asOf}T00:00:00Z`).getTime();
  const millisecondsPerDay = 86_400_000;
  const remainder = (to - from) % millisecondsPerDay;
  // Truncation is the correct calendar semantic here (a partial day is not
  // a day of age); the money rule (ADR-0009) governs amounts, not dates.
  const quotient = ((to - from) - remainder) / millisecondsPerDay;
  return quotient;
}
