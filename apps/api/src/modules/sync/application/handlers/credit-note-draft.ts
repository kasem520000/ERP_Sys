import { sql } from "drizzle-orm";

import { creditNoteCreateDraftPayloadSchema } from "@erp/contracts";

import { requireTenantContext } from "../../../../infra/db/tenant-context";
import {
  handlerServices,
  handlerValidationError,
  type HandlerOutcome,
  type SyncCommandHandler,
  type SyncHandlerContext,
} from "./contract";

/**
 * PHASE-022 · DR-P22-06 · `credit_note:create_draft` (MASTER-PLAN §6 + §1
 * row 6; OFFLINE_CAPABILITIES_MATRIX row 27 android-field — OFFLINE-DRAFT,
 * SD, `DRAFT_LOCAL → DRAFT`; posting stays online). The OD-draft pattern
 * the 020 `sales_invoice:create_draft` set (draft-invoice.ts) applied to
 * the sales module's CreditNoteService.create:
 *
 * - the reference is the POSTED invoice (BR-004 — never optional; the
 *   return window + the INV-016 outstanding bound live in the owning
 *   service, typed CREDIT_NOTE_* errors → the existing push-service
 *   VALIDATION_ERROR fallback, the honest T-P21-2d mapping);
 * - lines reference the invoice's own lines (`invoiceLineId`) — the
 *   server derives the item, the original price, the tax snapshot and the
 *   issue-cost re-entry value (W-3) from it; the customer is derived from
 *   the invoice, never trusted from the device;
 * - NO posting here: submit → approve → post is the online lifecycle
 *   (G-04 + the W-3 stock re-entry land online); no stock moves, no
 *   journal, zero residue by construction.
 */
export const creditNoteCreateDraftHandler: SyncCommandHandler = async (
  ctx: SyncHandlerContext,
): Promise<HandlerOutcome> => {
  if (ctx.command.legacy) {
    handlerValidationError("credit_note:create_draft is a v2-only intent");
  }
  const parsed = creditNoteCreateDraftPayloadSchema.safeParse(ctx.command.payload);
  if (!parsed.success) {
    handlerValidationError("credit_note:create_draft payload rejected by the contract", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }
  const payload = parsed.data;

  // The tenant's primary branch (the draft-invoice create precedent —
  // MAIN; the credit note's branch default).
  const branchId = await primaryBranchId();

  // The sales module's DRAFT creation (POSTED-reference gate, the BR-004
  // return window, per-line bounds, the INV-016 outstanding bound, tax
  // snapshots + the W-3 re-entry valuation, and its own audit event
  // sales.credit_note_created — all live there).
  const created = await handlerServices().creditNotes.create({
    branchId,
    salesRepId: null,
    invoiceId: payload.invoiceId,
    noteDate: payload.noteDate,
    note: payload.note ?? null,
    noteAr: payload.noteAr ?? null,
    actorId: ctx.userId,
    lines: payload.lines.map((line) => ({
      invoiceLineId: line.invoiceLineId,
      qty: line.qty,
      unitPrice: line.unitPrice ?? null,
      discountAmount: line.discountAmount ?? null,
      taxCodeId: line.taxCodeId ?? null,
      returnToStock: line.returnToStock,
      batchId: line.batchId ?? null,
      serialIds: line.serialIds ?? null,
      description: line.description ?? null,
      descriptionAr: line.descriptionAr ?? null,
      note: line.note ?? null,
    })),
  });

  // Device provenance: the service's audit row carries the actor only —
  // this event records the offline-create surface (the device identity).
  await handlerServices().audit.record({
    action: "sales.credit_note_offline_created",
    entityType: "credit_note",
    entityId: created.id,
    actorId: ctx.userId ?? undefined,
    deviceId: ctx.deviceId,
    after: {
      invoiceId: payload.invoiceId,
      totalGross: created.totalGross,
      reentryValue: created.reentryValue,
      lines: payload.lines.length,
    },
  });

  const version = await creditNoteRowVersion(created.id);
  return {
    status: "ACCEPTED",
    result: {
      creditNoteId: created.id,
      status: created.status,
      totalGross: created.totalGross,
      reentryValue: created.reentryValue,
    },
    entity: { id: created.id, version },
    // No official number at DRAFT (CRN- reserves at post — the 012
    // numbering convention); the confirmation rides the push result.
    feedEntries: [
      {
        entityType: "credit_notes",
        entityId: created.id,
        op: "UPSERT" as const,
        payload: { id: created.id, version },
      },
    ],
  };
};

/** The tenant's primary branch (the draft-invoice create precedent — MAIN). */
async function primaryBranchId(): Promise<string> {
  const { listBranches } = await import("../../../tenancy/infrastructure/tenancy.store");
  const branches = await listBranches(null);
  const main = branches.find((branch) => branch.code === "MAIN") ?? branches[0];
  if (main === undefined) {
    handlerValidationError("the tenant has no branch — create_draft needs one");
  }
  return main.id;
}

/** The source row's version (feed marker + optimistic-concurrency source). */
async function creditNoteRowVersion(noteId: string): Promise<number> {
  const tx = requireTenantContext().tx!;
  const rows = await tx.execute(
    sql`SELECT version FROM credit_notes WHERE id = ${noteId} LIMIT 1`,
  );
  return (rows.rows as unknown as { version: number }[])[0]?.version ?? 1;
}
