import { sql } from "drizzle-orm";

import { DomainError } from "@erp/domain-core";
import { receiptCreateFieldCollectionPayloadSchema } from "@erp/contracts";

import { requireTenantContext } from "../../../../infra/db/tenant-context";
import {
  handlerServices,
  handlerValidationError,
  type HandlerOutcome,
  type SyncCommandHandler,
  type SyncHandlerContext,
} from "./contract";

/**
 * PHASE-022 · DR-P22-06 · `receipt:create_field_collection` (MASTER-PLAN §6
 * + §1 row 6; OFFLINE_CAPABILITIES_MATRIX row 9 android-field —
 * OFFLINE-COMPLETE, SD; `PENDING_SYNC → POSTED` at sync, like pos_sale).
 *
 * The field rep's money-in collection captured on the van route: the
 * command POSTS a REAL treasury receipt at sync through the owning
 * module's create→post chain (ReceiptService.create →
 * ReceiptService.post → SettlementCore.postSettlement → the posting
 * engine). Server-final, exactly like the 016 offline sale:
 *
 * - the value date is the server's (period locks + the RCV numbering ride
 *   it — a locked period rejects PERIOD_LOCKED with the engine's
 *   `details.entryDate`, zero residue);
 * - the partner must be ACTIVE in this tenant (PARTNER_INACTIVE — the
 *   owning service checks existence only; the ACTIVE gate is this
 *   handler's typed seam, the 021 ITEM_INACTIVE/PARTNER_INACTIVE
 *   vocabulary rule);
 * - the amount/account/rate gates live in the owning service
 *   (requirePositiveAmount, requireActiveAccount, resolveDocumentRate);
 * - optional `allocations` ride AllocationService.setAllocations on the
 *   DRAFT (soft INV-016 bounds; the AUTHORITATIVE per-item enforcement
 *   runs at posting under the CC-02 row lock) — omitted = fully on-account
 *   (BR-027's explicit unallocated remainder, the field default);
 * - idempotency is the §11 stack: the inbox dedupe (C-01, per
 *   commandId+idempotencyKey) + the INV-013 posting-operation key
 *   (`receipt:{id}:post` — a replayed post returns the STORED result,
 *   never re-writes);
 * - the official RCV number returns in the result + the
 *   `officialNumber` extension; the journal + the cash movement + the AR
 *   subledger rows land in the SAME transaction (the `effects` extension).
 *
 * Rep attribution (deviation-recorded): receipts carry no sales-rep
 * column (0012 DDL) — the field rep IS the device user: `created_by`
 * (ctx.userId) + the device-stamped audit event below are the
 * attribution surface, exactly how the 017 rep-day settlement ties a
 * collection (repDayCollections by the rep cash account + value date).
 */
export const receiptFieldCollectionHandler: SyncCommandHandler = async (
  ctx: SyncHandlerContext,
): Promise<HandlerOutcome> => {
  if (ctx.command.legacy) {
    handlerValidationError("receipt:create_field_collection is a v2-only intent");
  }
  const parsed = receiptCreateFieldCollectionPayloadSchema.safeParse(ctx.command.payload);
  if (!parsed.success) {
    handlerValidationError(
      "receipt:create_field_collection payload rejected by the contract",
      { issues: parsed.error.issues.map((issue) => issue.message) },
    );
  }
  const payload = parsed.data;

  // The partner gate BEFORE any write (zero-residue): existence is the
  // owning service's check; the ACTIVE status is this handler's typed seam
  // (PARTNER_INACTIVE — deactivated master data is the actionable reason,
  // never a generic VALIDATION_ERROR; CONFLICT_RESOLUTION §3).
  const partnersStore = await import("../../../partners/infrastructure/partners.store");
  const partner = await partnersStore.findPartnerById(payload.partnerId);
  if (partner === undefined) {
    handlerValidationError(
      `partner ${payload.partnerId} does not exist in this tenant (A7 no-disclosure)`,
    );
  }
  if (partner.status !== "ACTIVE") {
    throw new DomainError(
      "PARTNER_INACTIVE",
      `partner ${partner.code} is ${partner.status} — a field collection needs an ACTIVE partner`,
      { partnerId: payload.partnerId, status: partner.status },
    );
  }

  // The treasury module's DRAFT creation (positive amount, active account
  // in-currency, rate shape + its own audit event live there; the device
  // user is the collecting rep — created_by, the attribution surface).
  const created = await handlerServices().receipts.create({
    cashAccountId: payload.cashAccountId,
    partnerId: payload.partnerId,
    method: payload.method,
    payerName: payload.payerName ?? null,
    currencyCode: payload.currencyCode,
    amount: payload.amount,
    exchangeRate: payload.exchangeRate ?? null,
    valueDate: payload.valueDate,
    reference: payload.reference ?? null,
    description: payload.description ?? null,
    descriptionAr: payload.descriptionAr ?? null,
    actorId: ctx.userId,
  });

  // The optional open-item allocations (INV-016/BR-027) on the DRAFT —
  // soft bounds here; the authoritative per-item enforcement runs at
  // post time under the CC-02 row lock.
  if (payload.allocations !== undefined && payload.allocations.length > 0) {
    await handlerServices().allocations.setAllocations({
      docType: "receipt",
      docId: created.id,
      allocations: payload.allocations.map((allocation) => ({
        openItemId: allocation.openItemId,
        amount: allocation.amount,
      })),
      actorId: ctx.userId,
    });
  }

  // The POST at sync (OFFLINE-COMPLETE): the engine owns the period lock
  // (PERIOD_LOCKED, typed), the INV-013 operation key (a replay returns
  // the STORED result — never re-writes), the official RCV number
  // (INV-021), the cash movement (INV-019) and the AR control lines +
  // subledger rows (INV-009).
  const posted = await handlerServices().receipts.post(created.id, ctx.userId);
  const executed = !posted.idempotentReplay;

  // Device provenance: the service's audit rows carry the actor only —
  // this event records the offline-collect surface (the device identity +
  // the advisory capture moment).
  await handlerServices().audit.record({
    action: "treasury.receipt_field_collection_posted",
    entityType: "receipt",
    entityId: created.id,
    actorId: ctx.userId ?? undefined,
    deviceId: ctx.deviceId,
    after: {
      partnerId: payload.partnerId,
      amount: payload.amount,
      valueDate: payload.valueDate,
      collectedAt: payload.collectedAt ?? null,
      docNo: posted.docNo,
      journalEntryId: posted.journalEntryId,
      replay: posted.idempotentReplay,
    },
  });

  const version = await receiptRowVersion(created.id);
  return {
    status: "ACCEPTED",
    result: {
      receiptId: created.id,
      status: "POSTED",
      receiptNo: posted.docNo,
      amount: payload.amount,
      allocatedAmount: posted.allocatedAmount,
      journalEntryId: posted.journalEntryId,
      replay: posted.idempotentReplay,
    },
    entity: { id: created.id, version },
    officialNumber: posted.docNo,
    effects: executed ? { journalEntryIds: [posted.journalEntryId] } : undefined,
    feedEntries: executed
      ? [
          {
            // receipts IS a pulled feed entity (the personal group,
            // partner-scoped server-side): the header-only marker makes the
            // posted collection re-pullable in the same tx; the catch-up
            // writer projects the full row (with the partnerId scope key)
            // at pull time.
            entityType: "receipts",
            entityId: created.id,
            op: "UPSERT" as const,
            payload: { id: created.id, version },
          },
        ]
      : undefined,
  };
};

/** The source row's version (feed marker + optimistic-concurrency source). */
async function receiptRowVersion(receiptId: string): Promise<number> {
  const tx = requireTenantContext().tx!;
  const rows = await tx.execute(
    sql`SELECT version FROM receipts WHERE id = ${receiptId} LIMIT 1`,
  );
  return (rows.rows as unknown as { version: number }[])[0]?.version ?? 1;
}
