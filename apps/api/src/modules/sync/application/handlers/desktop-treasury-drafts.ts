import { sql } from "drizzle-orm";

import {
  cashTransferCreateDraftPayloadSchema,
  expenseCreatePayloadSchema,
} from "@erp/contracts";

import { requireTenantContext } from "../../../../infra/db/tenant-context";
import {
  handlerServices,
  handlerValidationError,
  type HandlerOutcome,
  type SyncCommandHandler,
  type SyncHandlerContext,
} from "./contract";

/**
 * PHASE-021 · DR-P21-08 · the treasury-side desktop drafts (MASTER-PLAN
 * §6 table rows 4–5; SERVER_DECIDES — the module's own typed gates decide,
 * posting stays online):
 *
 * - `expense:create` (ExpenseService.create): the DRAFT expense claim —
 *   BR-023 lifecycle (DRAFT → PENDING_APPROVAL → APPROVED → POSTED), the
 *   positive-amount rule, the active-category gate, the
 *   active-account-in-currency gate and the petty single-tx cap all live
 *   in the owning service.
 *
 * - `cash_transfer:create_draft` (treasury TransferService.create): the
 *   DRAFT account↔account transfer — the fee rules (0 ≤ F < A), the
 *   currency-match gate and the distinct-accounts shape (DB CHECK) live
 *   in the owning service + DDL; the G-12 posting is online-only.
 *
 * Both are v2 only, validate the payload with the contracts schema BEFORE
 * any write (zero-residue), call ONLY the owning service, and declare a
 * header-only feed entry riding the same tx.
 */

/** The source row's version (feed marker + optimistic-concurrency source). */
async function rowVersion(table: "expenses" | "cash_transfers", id: string): Promise<number> {
  const tx = requireTenantContext().tx!;
  const rows = await tx.execute(
    sql`SELECT version FROM ${sql.raw(table)} WHERE id = ${id} LIMIT 1`,
  );
  return (rows.rows as unknown as { version: number }[])[0]?.version ?? 1;
}

// -- expense:create ----------------------------------------------------------------

export const expenseCreateHandler: SyncCommandHandler = async (
  ctx: SyncHandlerContext,
): Promise<HandlerOutcome> => {
  if (ctx.command.legacy) {
    handlerValidationError("expense:create is a v2-only intent");
  }
  const parsed = expenseCreatePayloadSchema.safeParse(ctx.command.payload);
  if (!parsed.success) {
    handlerValidationError("expense:create payload rejected by the contract", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }
  const payload = parsed.data;

  // The treasury module's DRAFT creation (positive amount, active
  // category, active account in the claim currency, FX-rate shape, the
  // petty single-tx cap + its own audit event live there).
  const created = await handlerServices().expenses.create({
    categoryId: payload.categoryId,
    cashAccountId: payload.cashAccountId,
    payeeName: payload.payeeName,
    currencyCode: payload.currencyCode,
    amount: payload.amount,
    exchangeRate: payload.exchangeRate ?? null,
    taxCodeId: payload.taxCodeId ?? null,
    receiptFileId: payload.receiptFileId ?? null,
    valueDate: payload.valueDate,
    description: payload.description ?? null,
    descriptionAr: payload.descriptionAr ?? null,
    actorId: ctx.userId,
  });

  await handlerServices().audit.record({
    action: "treasury.expense_offline_created",
    entityType: "expense",
    entityId: created.id,
    actorId: ctx.userId ?? undefined,
    deviceId: ctx.deviceId,
    after: {
      amount: created.amount,
      categoryId: created.categoryId,
      cashAccountId: created.cashAccountId,
      payee: created.payeeName,
      valueDate: created.valueDate,
    },
  });

  const version = await rowVersion("expenses", created.id);
  return {
    status: "ACCEPTED",
    result: { expenseId: created.id, status: created.status, amount: created.amount },
    entity: { id: created.id, version },
    feedEntries: [
      {
        entityType: "expenses",
        entityId: created.id,
        op: "UPSERT" as const,
        payload: { id: created.id, version },
      },
    ],
  };
};

// -- cash_transfer:create_draft ----------------------------------------------------

export const cashTransferCreateDraftHandler: SyncCommandHandler = async (
  ctx: SyncHandlerContext,
): Promise<HandlerOutcome> => {
  if (ctx.command.legacy) {
    handlerValidationError("cash_transfer:create_draft is a v2-only intent");
  }
  const parsed = cashTransferCreateDraftPayloadSchema.safeParse(ctx.command.payload);
  if (!parsed.success) {
    handlerValidationError("cash_transfer:create_draft payload rejected by the contract", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }
  const payload = parsed.data;

  // The treasury module's DRAFT creation (fee rules, currency match,
  // petty balance cap on reimbursements + its own audit event live
  // there; the distinct-accounts shape is the DDL CHECK — backstop).
  const created = await handlerServices().treasuryTransfers.create({
    fromAccountId: payload.fromAccountId,
    toAccountId: payload.toAccountId,
    currencyCode: payload.currencyCode,
    amount: payload.amount,
    feeAmount: payload.feeAmount ?? "0.0000",
    exchangeRate: payload.exchangeRate ?? null,
    valueDate: payload.valueDate,
    reference: payload.reference ?? null,
    description: payload.description ?? null,
    descriptionAr: payload.descriptionAr ?? null,
    actorId: ctx.userId,
  });

  await handlerServices().audit.record({
    action: "treasury.cash_transfer_offline_created",
    entityType: "cash_transfer",
    entityId: created.id,
    actorId: ctx.userId ?? undefined,
    deviceId: ctx.deviceId,
    after: {
      amount: created.amount,
      feeAmount: created.feeAmount,
      fromAccountId: created.fromAccountId,
      toAccountId: created.toAccountId,
      valueDate: created.valueDate,
    },
  });

  const version = await rowVersion("cash_transfers", created.id);
  return {
    status: "ACCEPTED",
    result: {
      transferId: created.id,
      status: created.status,
      amount: created.amount,
      feeAmount: created.feeAmount,
    },
    entity: { id: created.id, version },
    feedEntries: [
      {
        entityType: "cash_transfers",
        entityId: created.id,
        op: "UPSERT" as const,
        payload: { id: created.id, version },
      },
    ],
  };
};
