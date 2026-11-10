import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import * as journalStore from "../../accounting/infrastructure/journal.store";
import * as store from "../infrastructure/treasury.store";
import { moneyAdd } from "./document-support";

/**
 * Treasury↔GL reconciliation checks (PHASE-008 T12; INV-019; RC-08): the
 * cash check registered into the PHASE-007 job framework — every
 * cash/bank/petty account's GL base balance must equal Σ its movements'
 * signed base amounts (as-of date), exact with 0 tolerance. Seeded drift
 * (a movement row without its ledger effect, or vice versa) surfaces as a
 * `BROKEN` run with the offending account ids — which blocks period LOCK
 * (PC-04 — ReconciliationService.assertCoreChecksGreen reads the runs)
 * and fires the notification record (audit event with the diff).
 */
@Injectable()
export class TreasuryReconciliationService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /**
   * RC-08 / INV-019: Σ per-account (GL base balance as-of) == Σ per-account
   * (movements' signed base as-of), plus the aggregate + per-account diff
   * detail. Runs even with zero accounts (an OK run with counts — the
   * checklist's NOT_APPLICABLE branch reads the diff).
   */
  async runCashCheck(input: {
    asOf: string;
    runMode: "NIGHTLY" | "ON_DEMAND";
    checkedBy: string | null;
  }) {
    const accounts = await store.listCashAccounts({});
    const diffs: {
      accountId: string;
      name: string;
      glBalance: string;
      movementBalance: string;
    }[] = [];
    let glTotal = "0.0000";
    let movementTotal = "0.0000";
    for (const account of accounts) {
      const glBalance = await store.glBaseBalanceAsOf(account.accountId, input.asOf);
      const movementBalance = await store.movementBalance(account.id, input.asOf);
      glTotal = moneyAdd(glTotal, glBalance);
      movementTotal = moneyAdd(movementTotal, movementBalance);
      if (glBalance !== movementBalance) {
        diffs.push({ accountId: account.id, name: account.name, glBalance, movementBalance });
      }
    }
    const run = await journalStore.insertReconciliationRun({
      kind: "CASH",
      asOf: input.asOf,
      status: diffs.length === 0 ? "OK" : "BROKEN",
      controlBalance: glTotal,
      subledgerBalance: movementTotal,
      diffCount: diffs.length,
      diff:
        diffs.length === 0
          ? {
              accounts: accounts.length,
              bankAccounts: accounts.filter((account) => account.type === "BANK").length,
            }
          : {
              accounts: accounts.length,
              bankAccounts: accounts.filter((account) => account.type === "BANK").length,
              offending: diffs,
            },
      runMode: input.runMode,
      checkedBy: input.checkedBy,
    });
    if (diffs.length > 0) {
      // The notification record (RC-08): the durable, assertable surface —
      // the audit event carries the offending ids (email fan-out rides the
      // notifications substrate with the PHASE-013 workspace).
      await this.audit.record({
        action: "treasury.reconciliation_broken",
        entityType: "reconciliation_run",
        entityId: run.id,
        actorId: input.checkedBy ?? undefined,
        after: { kind: "CASH", diffCount: diffs.length, offending: diffs },
      });
    }
    return run;
  }
}
