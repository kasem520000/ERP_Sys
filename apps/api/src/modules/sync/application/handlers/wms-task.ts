import {
  wmsTaskConfirmPickPayloadSchema,
  wmsTaskConfirmPutawayPayloadSchema,
} from "@erp/contracts";

import { handlerServices, handlerValidationError } from "./contract";
import type { HandlerOutcome, SyncCommandHandler, SyncHandlerContext } from "./contract";

/**
 * PHASE-044 · OA-02 · `wms_task:confirm_putaway` + `wms_task:confirm_pick`
 * (the phase §2.16 sync duty): the field workforce's scan confirmations
 * over the inventory module's WMS services — transport only, never a
 * second business-logic path.
 *
 * - `wms_task:confirm_putaway` (PP-12): PutawayService.confirm — the scan
 *   MUST resolve to the task's directed bin (a wrong-bin scan rejects
 *   VALIDATION_ERROR with the typed service's machine-readable details);
 *   the label payload rides the result.
 * - `wms_task:confirm_pick` (PP-11/DF-17): PickingService.confirmPick —
 *   the scan resolves the allocated source bin; an optional short qty
 *   confirms only under the warehouse's allow_partial (the typed
 *   PARTIAL_PICK_NOT_ALLOWED maps to VALIDATION_ERROR with the details).
 *
 * Both are idempotent on duplicate delivery (C-01): the owning services
 * return the STORED row for an already-COMPLETED task, so a replayed
 * command re-ACCEPTS with the current state and never a second move (the
 * INV-013 discipline). The task's feed marker re-feeds the row
 * (pick_tasks/putaway_tasks) in the same transaction.
 */
export const wmsTaskConfirmPutawayHandler: SyncCommandHandler = async (
  ctx: SyncHandlerContext,
): Promise<HandlerOutcome> => {
  if (ctx.command.legacy) {
    handlerValidationError("wms_task:confirm_putaway is a v2-only intent");
  }
  const parsed = wmsTaskConfirmPutawayPayloadSchema.safeParse(ctx.command.payload);
  if (!parsed.success) {
    handlerValidationError("wms_task:confirm_putaway payload rejected by the contract", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }
  const payload = parsed.data;

  const { putaway } = handlerServices();
  const { task, label } = await putaway.confirm({
    taskId: payload.taskId,
    scannedBarcode: payload.scannedBarcode,
    actorId: ctx.userId,
  });
  return {
    status: "ACCEPTED",
    result: {
      taskId: task.id,
      taskKind: task.taskKind,
      status: task.status,
      qtyDone: task.qtyDone,
      completedAt: task.completedAt,
      label,
    },
    entity: { id: task.id, version: task.version },
    localized: {
      ar: `تم تأكيد التخزين الموجّه — ${task.toBinCode ?? ""}`,
      en: `Directed putaway confirmed — ${task.toBinCode ?? ""}`,
    },
    feedEntries: [
      {
        entityType: "putaway_tasks",
        entityId: task.id,
        op: "UPSERT" as const,
        payload: { id: task.id, version: task.version, changedAt: task.completedAt ?? new Date().toISOString(), status: task.status, taskKind: task.taskKind },
      },
    ],
  };
};

export const wmsTaskConfirmPickHandler: SyncCommandHandler = async (
  ctx: SyncHandlerContext,
): Promise<HandlerOutcome> => {
  if (ctx.command.legacy) {
    handlerValidationError("wms_task:confirm_pick is a v2-only intent");
  }
  const parsed = wmsTaskConfirmPickPayloadSchema.safeParse(ctx.command.payload);
  if (!parsed.success) {
    handlerValidationError("wms_task:confirm_pick payload rejected by the contract", {
      issues: parsed.error.issues.map((issue) => issue.message),
    });
  }
  const payload = parsed.data;

  const { picking } = handlerServices();
  const task = await picking.confirmPick({
    taskId: payload.taskId,
    scannedBarcode: payload.scannedBarcode,
    qty: payload.qty ?? undefined,
    actorId: ctx.userId,
  });
  return {
    status: "ACCEPTED",
    result: {
      taskId: task.id,
      taskKind: task.taskKind,
      status: task.status,
      qtyDone: task.qtyDone,
      completedAt: task.completedAt,
    },
    entity: { id: task.id, version: task.version },
    localized: {
      ar: `تم تأكيد الانتقاء — ${task.fromBinCode ?? ""}`,
      en: `Pick confirmed — ${task.fromBinCode ?? ""}`,
    },
    feedEntries: [
      {
        entityType: "pick_tasks",
        entityId: task.id,
        op: "UPSERT" as const,
        payload: { id: task.id, version: task.version, changedAt: task.completedAt ?? new Date().toISOString(), status: task.status, taskKind: task.taskKind },
      },
    ],
  };
};
