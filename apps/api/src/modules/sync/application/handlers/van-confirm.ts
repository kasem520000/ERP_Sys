import { sql } from "drizzle-orm";

import { DomainError } from "@erp/domain-core";
import {
  vanConfirmLoadPayloadSchema,
  vanConfirmUnloadPayloadSchema,
} from "@erp/contracts";

import { requireTenantContext } from "../../../../infra/db/tenant-context";
import { requireSellableItem } from "../../../sales/application/quotations";
import { handlerServices, handlerValidationError } from "./contract";
import type { HandlerOutcome, SyncCommandHandler, SyncHandlerContext } from "./contract";

/**
 * PHASE-022 · DR-P22-06 · `van:confirm_load` + `van:confirm_unload`
 * (MASTER-PLAN §6 + §1 row 6; OFFLINE_CAPABILITIES_MATRIX row 12
 * android-field — OFFLINE-COMPLETE, SD, against the van snapshot).
 *
 * The two van-ledger confirmations over the 017 VanStockService (ordinary
 * two-leg stock transfers wrapped around inventory's TransferService —
 * distribution owns the van semantics, sync adds transport only):
 *
 * - `van:confirm_load` (the morning load): the warehouse created +
 *   dispatched the load transfer online (IN_TRANSIT — BR-016 in-transit is
 *   never sellable); the field rep confirms it landed in the van, which
 *   RECEIVES the IN leg (value conservation — the carried cost) and
 *   refreshes the van mirror inside the owning transaction. The transfer IS
 *   the load document; a double-confirm rejects STALE_VERSION (the row's
 *   state changed underfoot — the CONFLICT_RESOLUTION §2 double-load
 *   rule), a not-yet-dispatched transfer rejects VALIDATION_ERROR.
 *
 * - `van:confirm_unload` (the end-of-day return): creates + dispatches the
 *   reverse-direction transfer (van → main warehouse) — the OUT leg issues
 *   from the CURRENT van snapshot. The handler pre-checks every line
 *   against the mirror-first read (`listVanStock` refreshes then reads —
 *   the 017 board contract) and rejects an unload beyond the current van
 *   quantity with INSUFFICIENT_STOCK carrying the machine-readable
 *   `availableQty` (CONFLICT_RESOLUTION §2 + §6.3); an inactive item
 *   rejects ITEM_INACTIVE (the 021 deactivated-master-data vocabulary).
 *   The dispatch's planIssue (allowNegative:false) stays the authoritative
 *   backstop — never trust a snapshot.
 */
export const vanConfirmLoadHandler: SyncCommandHandler = async (
  ctx: SyncHandlerContext,
): Promise<HandlerOutcome> => {
  if (ctx.command.legacy) {
    handlerValidationError("van:confirm_load is a v2-only intent");
  }
  const parsed = vanConfirmLoadPayloadSchema.safeParse(ctx.command.payload);
  if (!parsed.success) {
    handlerValidationError("van:confirm_load payload rejected by the contract", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }
  const payload = parsed.data;

  // State gate BEFORE any write (zero-residue). The load document is a
  // stock_transfers row (the pragmatic direct read — the draft-invoice
  // update precedent; RLS tenant-scoped, identical error for
  // unknown-vs-foreign ids, C-13).
  const tx = requireTenantContext().tx!;
  const rows = await tx.execute(sql`
    SELECT id, status, to_warehouse_id AS "toWarehouseId"
    FROM stock_transfers
    WHERE tenant_id = erp.current_tenant_id() AND id = ${payload.transferId}::uuid
    LIMIT 1
  `);
  const load = (rows.rows as unknown as { status: string }[])[0];
  if (load === undefined) {
    handlerValidationError(`load transfer ${payload.transferId} does not exist in this tenant`);
  }
  if (load.status === "POSTED") {
    // The double-load rule (CONFLICT_RESOLUTION §2): the load was already
    // confirmed — the row's state changed underfoot since the device
    // snapshotted it. STALE_VERSION with the machine-readable current
    // status (the client re-pulls and re-applies).
    throw new DomainError(
      "STALE_VERSION",
      `load transfer ${payload.transferId} is already POSTED — a double-load confirm (refresh the row from the server and re-apply)`,
      { transferId: payload.transferId, currentStatus: load.status },
    );
  }
  if (load.status !== "IN_TRANSIT") {
    handlerValidationError(
      `load transfer ${payload.transferId} is ${load.status} — only IN_TRANSIT loads confirm (dispatch it first)`,
      { transferId: payload.transferId, currentStatus: load.status },
    );
  }

  // The 017 receive leg: the ordinary IN leg at the carried cost, the van
  // mirror refreshed inside this transaction, the service's own audit
  // event (distribution.van_transfer_received) rides the actor.
  const received = await handlerServices().vanStock.receiveTransfer(payload.transferId, {
    actorId: ctx.userId,
  });

  // Device provenance (the offline-confirm surface + the advisory moment).
  await handlerServices().audit.record({
    action: "distribution.van_load_offline_confirmed",
    entityType: "stock_transfer",
    entityId: payload.transferId,
    actorId: ctx.userId ?? undefined,
    deviceId: ctx.deviceId,
    after: {
      transferNo: received.transferNo,
      vanWarehouseId: received.toWarehouseId,
      confirmedAt: payload.confirmedAt ?? null,
      status: received.status,
    },
  });

  const version = await transferRowVersion(payload.transferId);
  return {
    status: "ACCEPTED",
    result: {
      transferId: received.id,
      transferNo: received.transferNo,
      status: received.status,
      vanWarehouseId: received.toWarehouseId,
    },
    entity: { id: received.id, version },
    // The official TRN number was taken at dispatch; the confirm completes
    // the document (POSTED) — surfaced as the official number.
    officialNumber: received.transferNo ?? undefined,
    feedEntries: [
      {
        entityType: "stock_transfers",
        entityId: received.id,
        op: "UPSERT" as const,
        payload: { id: received.id, version },
      },
    ],
  };
};

export const vanConfirmUnloadHandler: SyncCommandHandler = async (
  ctx: SyncHandlerContext,
): Promise<HandlerOutcome> => {
  if (ctx.command.legacy) {
    handlerValidationError("van:confirm_unload is a v2-only intent");
  }
  const parsed = vanConfirmUnloadPayloadSchema.safeParse(ctx.command.payload);
  if (!parsed.success) {
    handlerValidationError("van:confirm_unload payload rejected by the contract", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }
  const payload = parsed.data;

  // Item gates BEFORE any write (zero-residue): the sellable gate is the
  // sales module's (ITEM_INACTIVE on deactivated master data — the
  // actionable reason, never a generic VALIDATION_ERROR; unknown items
  // reject VALIDATION_ERROR — A7 no-disclosure).
  for (const line of payload.lines) {
    await requireSellableItem(line.itemId);
  }

  // The van snapshot pre-check (CONFLICT_RESOLUTION §2 "unload beyond the
  // current van quantity"): the mirror-first read refreshes the 017 mirror
  // from stock_moves then reads it — `listVanStock` also fails closed on a
  // non-VAN warehouse (VAN_NOT_FOUND → the honest VALIDATION_ERROR
  // fallback). `availableQty` is the machine-readable detail the brief's
  // §6.3 prescribes; the dispatch's planIssue (allowNegative:false, BR-013)
  // stays the authoritative backstop.
  const snapshot = await handlerServices().vanStock.listVanStock({
    warehouseId: payload.vanWarehouseId,
  });
  const availableByItem = new Map<string, number>();
  for (const row of snapshot) {
    availableByItem.set(row.itemId, (availableByItem.get(row.itemId) ?? 0) + Number(row.qty));
  }
  for (const line of payload.lines) {
    const availableQty = availableByItem.get(line.itemId) ?? 0;
    if (Number(line.qty) > availableQty) {
      throw new DomainError(
        "INSUFFICIENT_STOCK",
        `unload of ${line.qty} exceeds the current van quantity ${availableQty} (availableQty) — the van snapshot is the bound, never the payload`,
        {
          vanWarehouseId: payload.vanWarehouseId,
          itemId: line.itemId,
          availableQty: availableQty.toFixed(6),
          requestedQty: line.qty,
        },
      );
    }
  }

  // The 017 unload: creates + dispatches the reverse-direction transfer
  // (the OUT leg issues from the van at the current valuation; the service
  // validates the distinct-warehouse shape + one-line-per-item + positive
  // qty, and records its own audit event distribution.van_unload).
  const dispatched = await handlerServices().vanStock.unload({
    vanWarehouseId: payload.vanWarehouseId,
    toWarehouseId: payload.toWarehouseId,
    lines: payload.lines.map((line) => ({ itemId: line.itemId, qty: line.qty })),
    note: payload.note ?? null,
    noteAr: payload.noteAr ?? null,
    actorId: ctx.userId,
  });

  // The mirror-first read again (the 017 board contract: every van
  // movement leaves the mirror current in the owning transaction — the
  // same-tx refresh receiveTransfer performs on its side; recorded in
  // T-P22-2c.md as the handler-side seam).
  await handlerServices().vanStock.listVanStock({ warehouseId: payload.vanWarehouseId });

  // Device provenance (the offline-confirm surface + the advisory moment).
  await handlerServices().audit.record({
    action: "distribution.van_unload_offline_confirmed",
    entityType: "stock_transfer",
    entityId: dispatched.id,
    actorId: ctx.userId ?? undefined,
    deviceId: ctx.deviceId,
    after: {
      transferNo: dispatched.transferNo,
      vanWarehouseId: payload.vanWarehouseId,
      toWarehouseId: payload.toWarehouseId,
      lines: payload.lines.length,
      confirmedAt: payload.confirmedAt ?? null,
      status: dispatched.status,
    },
  });

  const version = await transferRowVersion(dispatched.id);
  return {
    status: "ACCEPTED",
    result: {
      transferId: dispatched.id,
      transferNo: dispatched.transferNo,
      status: dispatched.status,
      toWarehouseId: payload.toWarehouseId,
      lines: payload.lines.length,
    },
    entity: { id: dispatched.id, version },
    // The official TRN number at dispatch — the unload document's number.
    officialNumber: dispatched.transferNo ?? undefined,
    feedEntries: [
      {
        entityType: "stock_transfers",
        entityId: dispatched.id,
        op: "UPSERT" as const,
        payload: { id: dispatched.id, version },
      },
    ],
  };
};

/** The source row's version (feed marker + optimistic-concurrency source). */
async function transferRowVersion(transferId: string): Promise<number> {
  const tx = requireTenantContext().tx!;
  const rows = await tx.execute(
    sql`SELECT version FROM stock_transfers WHERE id = ${transferId} LIMIT 1`,
  );
  return (rows.rows as unknown as { version: number }[])[0]?.version ?? 1;
}
