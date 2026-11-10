import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import * as accountingStore from "../../accounting/infrastructure/accounting.store";
import * as store from "../infrastructure/treasury.store";
import {
  CashAccountAlreadyExistsError,
  CashAccountNotFoundError,
  CashAccountNotCloseableError,
  CashAccountTypeInvalidError,
} from "../domain/treasury-errors";

/**
 * Cash-account service (PHASE-008 T2; §2.1): open/close lifecycle over the
 * CASH|BANK|PETTY accounts. Opening requires an existing, ACTIVE, postable
 * GL account (each treasury account IS a GL account — the 1:1 link is
 * enforced by uq_cash_accounts_tenant_account); closing blocks new
 * documents and preserves history (every movement + journal stays). The
 * balance read model is Σ movements — INV-019's definition, never a stored
 * counter that could drift.
 */
@Injectable()
export class AccountService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async list(filter: { type?: string; status?: string }): Promise<store.CashAccountRow[]> {
    return store.listCashAccounts(filter);
  }

  async find(id: string): Promise<store.CashAccountRow> {
    const account = await store.findCashAccountById(id);
    if (account === undefined) throw new CashAccountNotFoundError(id);
    return account;
  }

  async open(input: {
    name: string;
    nameAr: string | null;
    type: "CASH" | "BANK" | "PETTY";
    accountId: string;
    branchId: string | null;
    currencyCode: string;
    actorId: string | null;
  }): Promise<store.CashAccountRow> {
    if (input.name.trim().length === 0) {
      throw new CashAccountAlreadyExistsError("account name is required");
    }
    // The GL account must exist, be ACTIVE and postable (§2.1: opening
    // requires an existing mapped GL account; unknown/foreign → 404 shape).
    const glAccount = await accountingStore.findAccountById(input.accountId);
    if (glAccount === undefined) {
      throw new CashAccountNotFoundError(`gl:${input.accountId}`);
    }
    if (glAccount.status !== "ACTIVE" || !glAccount.isPostable) {
      throw new CashAccountTypeInvalidError(
        `GL account ${glAccount.code} is ${glAccount.status}/postable=${glAccount.isPostable} — treasury accounts require an ACTIVE postable account`,
      );
    }
    const existingByGL = await store.findCashAccountByGLAccountId(input.accountId);
    if (existingByGL !== undefined) {
      throw new CashAccountAlreadyExistsError(
        `GL account ${glAccount.code} is already linked to treasury account "${existingByGL.name}" (1:1 per tenant — INV-019)`,
      );
    }
    const duplicateName = (await store.listCashAccounts({})).find((row) => row.name === input.name);
    if (duplicateName !== undefined) {
      throw new CashAccountAlreadyExistsError(`account name "${input.name}" is already in use`);
    }
    const created = await store.insertCashAccount({ ...input, createdBy: input.actorId });
    await this.audit.record({
      action: "treasury.cash_account_opened",
      entityType: "cash_account",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        name: created.name,
        type: created.type,
        accountId: created.accountId,
        accountCode: created.accountCode,
        currency: created.currencyCode,
      },
    });
    return created;
  }

  async close(input: { id: string; reason: string; actorId: string | null }): Promise<store.CashAccountRow> {
    const account = await this.find(input.id);
    if (account.status === "CLOSED") return account;
    if (input.reason.trim().length === 0) {
      throw new CashAccountNotCloseableError("a close reason is required (history is preserved)");
    }
    // Guards: no OPEN cashier shift and no unreconciled statement may remain
    // on a bank account being closed (auditable wind-down discipline).
    const openShift = await store.findOpenShiftForAccount(account.id);
    if (openShift !== undefined) {
      throw new CashAccountNotCloseableError(
        `cash account ${account.name} has an OPEN shift (${openShift.id}) — close the shift first`,
      );
    }
    await store.closeCashAccount({ id: account.id, closedBy: input.actorId, reason: input.reason });
    await this.audit.record({
      action: "treasury.cash_account_closed",
      entityType: "cash_account",
      entityId: account.id,
      actorId: input.actorId ?? undefined,
      before: { status: account.status, balance: account.balance },
      after: { status: "CLOSED", reason: input.reason, preservedMovements: account.movementCount },
    });
    return (await store.findCashAccountById(account.id))!;
  }

  /** Movement ledger of an account (the INV-019 view — the account IS its movements). */
  async movements(input: { id: string; fromDate?: string; toDate?: string; limit: number }) {
    await this.find(input.id);
    return store.listMovements({
      cashAccountId: input.id,
      fromDate: input.fromDate,
      toDate: input.toDate,
      limit: input.limit,
    });
  }
}
