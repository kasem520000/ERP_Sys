import { sql } from "drizzle-orm";

import {
  deliveryNoteCreateDraftPayloadSchema,
  quotationCreateDraftPayloadSchema,
} from "@erp/contracts";

import { requireTenantContext } from "../../../../infra/db/tenant-context";
import { ownTenantBaseCurrency } from "../../../../infra/settings/setting-reader";
import {
  handlerServices,
  handlerValidationError,
  type HandlerOutcome,
  type SyncCommandHandler,
  type SyncHandlerContext,
} from "./contract";

/**
 * PHASE-021 · DR-P21-08 · the sales-side desktop drafts (MASTER-PLAN §6
 * table rows 2–3):
 *
 * - `quotation:create_draft` (OWNER_DEVICE_WINS-create): DRAFT creation
 *   through the sales module's QuotationService.create (BR-006 validity,
 *   BR-003 price resolution for null unitPrice, the sellable-item gate —
 *   everything validated by the owning service before its first write).
 *   CREATE-draft only: quotations carry NO owner_device_id column (0029
 *   granted the substrate stamp to sales_invoices only; 2-d adds no
 *   migrations) and no update intent exists for the type — the creating
 *   device's provenance rides the audit event (`deviceId`), and a second
 *   device's update attempt is an unknown-intent rejection by
 *   construction (registry carries no quotation:update_draft).
 *
 * - `delivery_note:create_draft` (SERVER_DECIDES-at-submit): DRAFT
 *   creation through DeliveryNoteService.create — the draft writes no
 *   stock and no COGS; planIssue/applyIssue + the G-03 journal run at
 *   POST time online (BR-007 delivery_then_invoice).
 *
 * Both are v2 only, validate the payload with the contracts schema BEFORE
 * any write (zero-residue), call ONLY the owning service, and declare a
 * header-only feed entry (the catch-up writer projects details at pull
 * time; neither type is in a frozen 020 feed group — the rows are future
 * substrate, the confirmation rides the push result).
 */

/** The tenant's primary branch (MAIN) — the branch default for drafts. */
async function primaryBranchId(): Promise<string> {
  const { listBranches } = await import("../../../tenancy/infrastructure/tenancy.store");
  const branches = await listBranches(null);
  const main = branches.find((branch) => branch.code === "MAIN") ?? branches[0];
  if (main === undefined) {
    handlerValidationError("the tenant has no branch — the draft needs one");
  }
  return main.id;
}

/** The source row's version (feed marker + optimistic-concurrency source). */
async function rowVersion(table: "quotations" | "delivery_notes", id: string): Promise<number> {
  const tx = requireTenantContext().tx!;
  const rows = await tx.execute(
    sql`SELECT version FROM ${sql.raw(table)} WHERE id = ${id} LIMIT 1`,
  );
  return (rows.rows as unknown as { version: number }[])[0]?.version ?? 1;
}

// -- quotation:create_draft --------------------------------------------------------

export const quotationCreateDraftHandler: SyncCommandHandler = async (
  ctx: SyncHandlerContext,
): Promise<HandlerOutcome> => {
  if (ctx.command.legacy) {
    handlerValidationError("quotation:create_draft is a v2-only intent");
  }
  const parsed = quotationCreateDraftPayloadSchema.safeParse(ctx.command.payload);
  if (!parsed.success) {
    handlerValidationError("quotation:create_draft payload rejected by the contract", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }
  const payload = parsed.data;

  const branchId = await primaryBranchId();
  const currencyCode = await ownTenantBaseCurrency();

  // The sales module's DRAFT creation (requireCustomer + the sellable-item
  // gate + BR-006 valid-until derivation + price resolution + its own
  // audit event live there).
  const created = await handlerServices().quotations.create({
    branchId,
    customerId: payload.customerId,
    salesRepId: null,
    quoteDate: payload.quoteDate,
    validUntil: payload.validUntil ?? null,
    currencyCode,
    exchangeRate: null,
    note: payload.note ?? null,
    noteAr: payload.noteAr ?? null,
    actorId: ctx.userId,
    lines: payload.lines.map((line) => ({
      itemId: line.itemId,
      qty: line.qty,
      unitPrice: line.unitPrice ?? null,
      discountAmount: line.discountAmount ?? null,
      taxCodeId: line.taxCodeId ?? null,
      description: line.description ?? null,
      descriptionAr: line.descriptionAr ?? null,
      note: line.note ?? null,
    })),
  });

  // OD-create provenance (no owner_device_id column on quotations — the
  // file header): the creating device is recorded here; ownership
  // guarding is create-only by registry shape (no update intent).
  await handlerServices().audit.record({
    action: "sales.quotation_offline_created",
    entityType: "quotation",
    entityId: created.id,
    actorId: ctx.userId ?? undefined,
    deviceId: ctx.deviceId,
    after: {
      customerId: payload.customerId,
      quoteDate: payload.quoteDate,
      lines: payload.lines.length,
      totalNet: created.totalNet,
    },
  });

  const version = await rowVersion("quotations", created.id);
  return {
    status: "ACCEPTED",
    result: { quotationId: created.id, status: created.status, totalNet: created.totalNet },
    entity: { id: created.id, version },
    feedEntries: [
      {
        entityType: "quotations",
        entityId: created.id,
        op: "UPSERT" as const,
        payload: { id: created.id, version },
      },
    ],
  };
};

// -- delivery_note:create_draft ----------------------------------------------------

export const deliveryNoteCreateDraftHandler: SyncCommandHandler = async (
  ctx: SyncHandlerContext,
): Promise<HandlerOutcome> => {
  if (ctx.command.legacy) {
    handlerValidationError("delivery_note:create_draft is a v2-only intent");
  }
  const parsed = deliveryNoteCreateDraftPayloadSchema.safeParse(ctx.command.payload);
  if (!parsed.success) {
    handlerValidationError("delivery_note:create_draft payload rejected by the contract", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }
  const payload = parsed.data;

  const branchId = await primaryBranchId();
  const currencyCode = await ownTenantBaseCurrency();

  // The sales module's DRAFT creation (requireCustomer + STOCK-item gate +
  // BR-008 discount rule + its own audit event live there; posting-time
  // stock planning is a POST concern — SD-at-submit).
  const created = await handlerServices().deliveries.create({
    branchId,
    customerId: payload.customerId,
    salesRepId: null,
    orderId: payload.orderId ?? null,
    warehouseId: payload.warehouseId,
    deliveryDate: payload.deliveryDate,
    currencyCode,
    note: payload.note ?? null,
    noteAr: payload.noteAr ?? null,
    actorId: ctx.userId,
    lines: payload.lines.map((line) => ({
      orderLineId: null,
      itemId: line.itemId,
      qty: line.qty,
      unitPrice: line.unitPrice ?? null,
      discountAmount: line.discountAmount ?? null,
      batchId: line.batchId ?? null,
      serialIds: line.serialIds ?? null,
      description: line.description ?? null,
      descriptionAr: null,
      note: line.note ?? null,
    })),
  });

  await handlerServices().audit.record({
    action: "sales.delivery_note_offline_created",
    entityType: "delivery_note",
    entityId: created.id,
    actorId: ctx.userId ?? undefined,
    deviceId: ctx.deviceId,
    after: {
      customerId: payload.customerId,
      warehouseId: payload.warehouseId,
      orderId: payload.orderId ?? null,
      lines: payload.lines.length,
      totalNet: created.totalNet,
    },
  });

  const version = await rowVersion("delivery_notes", created.id);
  return {
    status: "ACCEPTED",
    result: { deliveryId: created.id, status: created.status, totalNet: created.totalNet },
    entity: { id: created.id, version },
    feedEntries: [
      {
        entityType: "delivery_notes",
        entityId: created.id,
        op: "UPSERT" as const,
        payload: { id: created.id, version },
      },
    ],
  };
};
