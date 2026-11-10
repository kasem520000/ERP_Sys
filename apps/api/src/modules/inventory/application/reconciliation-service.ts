import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import * as journalStore from "../../accounting/infrastructure/journal.store";
import * as store from "../infrastructure/inventory.store";

/**
 * Inventory↔GL reconciliation (PHASE-010 T12; INV-010; RECONCILIATION §1
 * row 3; RC-04/RC-05): for every GL inventory account (per-warehouse
 * override ∪ the tenant INVENTORY purpose), the money trail —
 * Σ signed value_amount over the mapped warehouses' moves + the pending
 * IN legs of IN_TRANSIT transfers — must equal the account's journal-line
 * base balance (as-of), exact with ZERO tolerance.
 *
 * By construction the check also verifies INV-017 (no retroactive cost
 * mutation — stock_moves are append-only by grants + guard) and INV-018
 * (no move without its economic effect): an orphan move (no journal) or a
 * journal without its moves skews one side and the run lands BROKEN with
 * the offending row ids.
 *
 * Drift discipline (RISK-009): BROKEN blocks the period LOCK via the
 * PHASE-007 framework (ReconciliationService.assertCoreChecksGreen reads
 * the INVENTORY kind — PC-04) and fires the notification record (audit
 * event carrying the offending rows).
 */
@Injectable()
export class InventoryReconciliationService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /**
   * RC-04 green path + RC-05 drift: Σ movement trail vs GL balance per
   * resolved account. Runs even with zero moves (an OK run with zero
   * counts — the close checklist's NOT_APPLICABLE branch reads the diff).
   */
  async runStockCheck(input: {
    asOf: string;
    runMode: "NIGHTLY" | "ON_DEMAND";
    checkedBy: string | null;
  }) {
    const byAccount = await store.stockValueByAccount(input.asOf);
    const diffs: {
      accountId: string;
      accountCode: string;
      glBalance: string;
      movementValue: string;
      moveCount: number;
    }[] = [];
    let glTotal = "0.0000";
    let movementTotal = "0.0000";
    let moveCount = 0;
    for (const account of byAccount) {
      const glBalance = await store.glBalanceAsOf(account.accountId, input.asOf);
      glTotal = new Decimal(glTotal).plus(new Decimal(glBalance)).toFixed(4);
      movementTotal = new Decimal(movementTotal)
        .plus(new Decimal(account.movementValue))
        .toFixed(4);
      moveCount += account.moveCount;
      if (new Decimal(glBalance).minus(new Decimal(account.movementValue)).abs().gt(0)) {
        diffs.push({
          accountId: account.accountId,
          accountCode: account.accountCode,
          glBalance,
          movementValue: account.movementValue,
          moveCount: account.moveCount,
        });
      }
    }
    const orphanMoves = await store.movesWithoutJournal(25);
    const orphanJournals = await store.stockJournalsWithoutMoves(25);
    const valuation = await store.onHandValuation();

    const status = diffs.length === 0 ? "OK" : "BROKEN";
    const run = await journalStore.insertReconciliationRun({
      kind: "INVENTORY",
      asOf: input.asOf,
      status,
      controlBalance: glTotal,
      subledgerBalance: movementTotal,
      diffCount: diffs.length,
      diff: {
        accounts: byAccount.length,
        moveCount,
        offending: diffs,
        orphanMoves,
        orphanJournals,
        onHandValuation: valuation,
      },
      runMode: input.runMode,
      checkedBy: input.checkedBy,
    });
    if (status === "BROKEN") {
      await this.audit.record({
        action: "inventory.reconciliation_broken",
        entityType: "reconciliation_run",
        entityId: run.id,
        actorId: input.checkedBy ?? undefined,
        after: { kind: "INVENTORY", diffCount: diffs.length, offending: diffs, orphanMoves },
      });
    }
    return run;
  }
}
