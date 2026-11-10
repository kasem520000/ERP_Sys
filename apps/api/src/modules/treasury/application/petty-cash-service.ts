import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/treasury.store";
import { PettyCashLimitExceededError } from "../domain/treasury-errors";
import { moneyAdd, moneyCompare, pettyCashSettings } from "./document-support";

/**
 * Petty-cash service (PHASE-008 T6; BR-020): the PETTY fund discipline —
 * per-transaction cap on disbursements, fund-balance cap on inflows
 * (reimbursements are transfers INTO the fund), and the accountant
 * override with audit. Caps read from the typed settings registry
 * (PLACEHOLDER defaults documented per OQ-002 — §2.4).
 */
@Injectable()
export class PettyCashGuard {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /** BR-020 single-transaction cap on a disbursement from a PETTY fund. */
  async assertSingleTxCap(input: {
    account: store.CashAccountRow;
    amount: string;
    override: boolean;
    actorId: string | null;
  }): Promise<void> {
    if (input.account.type !== "PETTY") return;
    const { singleTxLimit } = await pettyCashSettings();
    if (moneyCompare(input.amount, singleTxLimit) <= 0) return;
    if (input.override) {
      await this.audit.record({
        action: "treasury.petty_cash_override",
        entityType: "cash_account",
        entityId: input.account.id,
        actorId: input.actorId ?? undefined,
        after: { cap: "single_tx_limit", amount: input.amount, limit: singleTxLimit },
      });
      return;
    }
    throw new PettyCashLimitExceededError({
      cap: "single_tx_limit",
      value: input.amount,
      limit: singleTxLimit,
    });
  }

  /**
   * BR-020 fund-balance cap on an inflow to a PETTY fund (reimbursement
   * transfer, receipt). Balance after = current + inflow base (account
   * currency) must stay ≤ max_balance unless the accountant overrides.
   */
  async assertBalanceCap(input: {
    account: store.CashAccountRow;
    inflowAmount: string;
    override: boolean;
    actorId: string | null;
  }): Promise<void> {
    if (input.account.type !== "PETTY") return;
    const { maxBalance } = await pettyCashSettings();
    const current = await store.movementBalance(input.account.id);
    const after = moneyAdd(current, input.inflowAmount);
    if (moneyCompare(after, maxBalance) <= 0) return;
    if (input.override) {
      await this.audit.record({
        action: "treasury.petty_cash_override",
        entityType: "cash_account",
        entityId: input.account.id,
        actorId: input.actorId ?? undefined,
        after: { cap: "max_balance", balanceAfter: after, limit: maxBalance },
      });
      return;
    }
    throw new PettyCashLimitExceededError({ cap: "max_balance", value: after, limit: maxBalance });
  }

  /** The fund view: account + caps + balance + recent movements (§2.12 UI). */
  async fundOverview(accountId: string) {
    const account = await store.findCashAccountById(accountId);
    if (account === undefined || account.type !== "PETTY") return null;
    const settings = await pettyCashSettings();
    const movements = await store.listMovements({ cashAccountId: accountId, limit: 50 });
    return { account, caps: settings, movements };
  }
}
