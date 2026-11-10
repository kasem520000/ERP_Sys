import { sql } from "drizzle-orm";

import {
  stockCountSubmitLinesPayloadSchema,
  stockTransferCreateDraftPayloadSchema,
  type StockCountSubmitLinesPayload,
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
 * PHASE-021 · DR-P21-08 · the inventory-side desktop intents (MASTER-PLAN
 * §6 table rows 6–7; SERVER_DECIDES):
 *
 * - `stock_transfer:create_draft` (inventory TransferService.create): the
 *   DRAFT two-leg transfer — the distinct-warehouses gate (BR-016), the
 *   one-line-per-item rule and the positive-qty gate live in the owning
 *   service; dispatch/receive (the OUT/IN legs, G-15) post online only.
 *
 * - `stock_count:submit_lines` (CountService.enterCounts — the blind-safe
 *   line-entry path): counted lines for an EXISTING session (sessions are
 *   created online — the system-qty snapshot is frozen server-side). The
 *   handler resolves every (itemId, batchRef) payload line to the
 *   session's lineNo BEFORE any write (zero-residue), then applies the
 *   batch through the owning service; submit/review/approve stay online
 *   server decisions (SD-aggregate).
 *
 * Both are v2 only, validate the payload with the contracts schema BEFORE
 * any write, call ONLY the owning service, and declare a header-only feed
 * entry riding the same tx.
 */

/** The source row's version (feed marker + optimistic-concurrency source). */
async function rowVersion(table: "stock_transfers" | "stock_counts", id: string): Promise<number> {
  const tx = requireTenantContext().tx!;
  const rows = await tx.execute(
    sql`SELECT version FROM ${sql.raw(table)} WHERE id = ${id} LIMIT 1`,
  );
  return (rows.rows as unknown as { version: number }[])[0]?.version ?? 1;
}

// -- stock_transfer:create_draft ---------------------------------------------------

export const stockTransferCreateDraftHandler: SyncCommandHandler = async (
  ctx: SyncHandlerContext,
): Promise<HandlerOutcome> => {
  if (ctx.command.legacy) {
    handlerValidationError("stock_transfer:create_draft is a v2-only intent");
  }
  const parsed = stockTransferCreateDraftPayloadSchema.safeParse(ctx.command.payload);
  if (!parsed.success) {
    handlerValidationError("stock_transfer:create_draft payload rejected by the contract", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }
  const payload = parsed.data;

  // The inventory module's DRAFT creation (distinct warehouses, unique
  // items, positive qty + its own audit event live there; warehouse
  // existence is the DDL FK — the backstop of record).
  const created = await handlerServices().inventoryTransfers.create({
    fromWarehouseId: payload.fromWarehouseId,
    toWarehouseId: payload.toWarehouseId,
    lines: payload.lines.map((line) => ({ itemId: line.itemId, qty: line.qty })),
    note: payload.note ?? null,
    noteAr: payload.noteAr ?? null,
    actorId: ctx.userId,
  });

  await handlerServices().audit.record({
    action: "inventory.stock_transfer_offline_created",
    entityType: "stock_transfer",
    entityId: created.id,
    actorId: ctx.userId ?? undefined,
    deviceId: ctx.deviceId,
    after: {
      fromWarehouseId: created.fromWarehouseId,
      toWarehouseId: created.toWarehouseId,
      lines: created.lineCount,
    },
  });

  const version = await rowVersion("stock_transfers", created.id);
  return {
    status: "ACCEPTED",
    result: {
      transferId: created.id,
      status: created.status,
      // pg hands count(*) back as a string — normalize for the JSON wire.
      lineCount: Number(created.lineCount),
    },
    entity: { id: created.id, version },
    feedEntries: [
      {
        entityType: "stock_transfers",
        entityId: created.id,
        op: "UPSERT" as const,
        payload: { id: created.id, version },
      },
    ],
  };
};

// -- stock_count:submit_lines ------------------------------------------------------

/** The session-line resolution key: (itemId, batch) — batch-tracked items
 * may carry several lines per item (one per batch); a null batchRef only
 * resolves unambiguous single-line items. */
function lineKey(itemId: string, batchId: string | null): string {
  return `${itemId}:${batchId ?? ""}`;
}

/** Resolve every payload line to its session lineNo BEFORE any write —
 * an unresolvable or ambiguous reference is a typed VALIDATION_ERROR with
 * zero residue (the owning service then cannot fail on shape). */
function resolveLineNumbers(
  payload: StockCountSubmitLinesPayload,
  sessionLines: { lineNo: number; itemId: string; batchId: string | null }[],
): { lineNo: number; countedQty: string }[] {
  const byKey = new Map<string, { lineNo: number; count: number }>();
  for (const line of sessionLines) {
    const key = lineKey(line.itemId, line.batchId);
    const existing = byKey.get(key);
    byKey.set(key, { lineNo: line.lineNo, count: (existing?.count ?? 0) + 1 });
  }
  const resolved: { lineNo: number; countedQty: string }[] = [];
  const claimed = new Set<number>();
  for (const line of payload.lines) {
    const key = lineKey(line.itemId, line.batchRef ?? null);
    const match = byKey.get(key);
    if (match === undefined) {
      handlerValidationError(
        `count ${payload.countId} has no line for item ${line.itemId}` +
          (line.batchRef !== undefined && line.batchRef !== null ? ` batch ${line.batchRef}` : ""),
        { unresolvedItemId: line.itemId },
      );
    }
    if (match.count > 1) {
      handlerValidationError(
        `item ${line.itemId} has ${match.count} session lines — batchRef is required to disambiguate`,
        { ambiguousItemId: line.itemId },
      );
    }
    if (claimed.has(match.lineNo)) {
      handlerValidationError(
        `count ${payload.countId} line ${match.lineNo} is referenced twice in the payload`,
        { duplicateLineNo: match.lineNo },
      );
    }
    claimed.add(match.lineNo);
    resolved.push({ lineNo: match.lineNo, countedQty: line.countedQty });
  }
  return resolved;
}

export const stockCountSubmitLinesHandler: SyncCommandHandler = async (
  ctx: SyncHandlerContext,
): Promise<HandlerOutcome> => {
  if (ctx.command.legacy) {
    handlerValidationError("stock_count:submit_lines is a v2-only intent");
  }
  const parsed = stockCountSubmitLinesPayloadSchema.safeParse(ctx.command.payload);
  if (!parsed.success) {
    handlerValidationError("stock_count:submit_lines payload rejected by the contract", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }
  const payload = parsed.data;

  // Load the session + its lines (the owning service's own typed
  // StockCountNotFoundError / StockCountStateError surfaces verbatim).
  const count = await handlerServices().stockCounts.find(payload.countId);
  const sessionLines = await handlerServices().stockCounts.lines(payload.countId);
  const entries = resolveLineNumbers(payload, sessionLines);

  // The blind-safe line-entry path (status gate DRAFT + qty shape +
  // the inventory.count_lines_entered audit event live there).
  await handlerServices().stockCounts.enterCounts({
    countId: payload.countId,
    entries,
    actorId: ctx.userId,
  });

  await handlerServices().audit.record({
    action: "inventory.stock_count_lines_offline_submitted",
    entityType: "stock_count",
    entityId: payload.countId,
    actorId: ctx.userId ?? undefined,
    deviceId: ctx.deviceId,
    after: {
      warehouseId: count.warehouseId,
      lines: entries.length,
      status: count.status,
    },
  });

  const version = await rowVersion("stock_counts", payload.countId);
  return {
    status: "ACCEPTED",
    result: {
      countId: payload.countId,
      status: count.status,
      lines: entries.length,
    },
    entity: { id: payload.countId, version },
    feedEntries: [
      {
        entityType: "stock_counts",
        entityId: payload.countId,
        op: "UPSERT" as const,
        payload: { id: payload.countId, version },
      },
    ],
  };
};
