import { cashierShiftCommandSchema, type CashierShiftCommand } from "@erp/contracts";

import {
  handlerServices,
  type HandlerOutcome,
  type SyncCommandHandler,
  type SyncHandlerContext,
} from "./contract";

/**
 * PHASE-020 · `cashier_shift:open` + `cashier_shift:close` (MASTER-PLAN §7
 * SERVER_DECISION rows; SYNC_PROTOCOL §3; CONFLICT_RESOLUTION §2). The 016
 * shift events, verbatim: PosShiftFlowService over the treasury shift
 * model — runtime writes stay treasury-owned (MODULE_BOUNDARIES).
 *
 * The legacy command maps `event` → intent at normalize time; the v2
 * payload is {shift: {…}} (the same inner shape, validated with the same
 * contracts schema).
 */

function shiftOf(ctx: SyncHandlerContext): CashierShiftCommand["shift"] {
  if (ctx.command.legacy) {
    return (ctx.command.payload as CashierShiftCommand).shift;
  }
  const raw = (ctx.command.payload as { shift?: unknown })?.shift;
  return cashierShiftCommandSchema.shape.shift.parse(raw);
}

export const shiftOpenHandler: SyncCommandHandler = async (
  ctx: SyncHandlerContext,
): Promise<HandlerOutcome> => {
  const shift = shiftOf(ctx);
  // The 016 executeShiftCommand open branch, verbatim.
  const opened = await handlerServices().shiftFlow.open({
    terminalId: shift.terminalId,
    openingAmount: shift.openingAmount ?? "0",
    denominations: shift.denominations ?? null,
    actorId: null,
  });
  const result: Record<string, unknown> = {
    shiftId: opened.shift.id,
    alreadyOpen: opened.alreadyOpen,
  };
  return {
    status: "ACCEPTED",
    result,
    entity: { id: opened.shift.id, version: 1 },
    // A feed entry only when the open actually wrote the shift row —
    // alreadyOpen:true added nothing (no server change to re-pull).
    feedEntries: opened.alreadyOpen
      ? undefined
      : [
          {
            entityType: "cashier_shifts",
            entityId: opened.shift.id,
            op: "UPSERT" as const,
            payload: { id: opened.shift.id, version: 1 },
          },
        ],
  };
};

export const shiftCloseHandler: SyncCommandHandler = async (
  ctx: SyncHandlerContext,
): Promise<HandlerOutcome> => {
  const shift = shiftOf(ctx);
  // The 016 executeShiftCommand close branch, verbatim.
  const open = await handlerServices().shiftFlow.openShiftForTerminal(shift.terminalId);
  if (open === undefined) {
    return {
      status: "ACCEPTED",
      result: { shiftId: null, alreadyClosed: true },
    };
  }
  const closed = await handlerServices().shiftFlow.close({
    terminalId: shift.terminalId,
    shiftId: open.id,
    denominations: shift.denominations ?? {},
    reason: shift.reason ?? undefined,
    supervisorId: shift.supervisorId ?? undefined,
    supervisorPin: shift.supervisorPin ?? undefined,
    actorId: null,
  });
  return {
    status: "ACCEPTED",
    result: { shiftId: closed.id, difference: closed.difference },
    entity: { id: closed.id, version: 1 },
    feedEntries: [
      {
        entityType: "cashier_shifts",
        entityId: closed.id,
        op: "UPSERT" as const,
        payload: { id: closed.id, version: 1 },
      },
    ],
  };
};
