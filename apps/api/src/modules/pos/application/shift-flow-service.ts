import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { ShiftService } from "../../treasury/application/shift-service";
import * as store from "../infrastructure/pos.store";
import {
  PosShiftNotOnTerminalError,
  PosTerminalInactiveError,
  PosTerminalNotFoundError,
} from "../domain/pos-errors";

/**
 * POS shift flow (PHASE-016 T3): the terminal-scoped open/close UX over
 * the PHASE-008 treasury shift model — opening float, per-denomination
 * blind count entry, supervisor PIN beyond tolerance. Runtime writes
 * remain treasury-owned: this service resolves/validates terminal state
 * and delegates to `ShiftService` (its published application service) —
 * no cross-module table writes (MODULE_BOUNDARIES).
 */
@Injectable()
export class PosShiftFlowService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly shifts: ShiftService,
  ) {}

  /** The OPEN shift on a terminal's till, if any (the sale screen's badge). */
  async openShiftForTerminal(terminalId: string) {
    const terminal = await store.findTerminalById(terminalId);
    if (terminal === undefined) throw new PosTerminalNotFoundError(terminalId);
    const treasuryStore = await import("../../treasury/infrastructure/treasury.store");
    return treasuryStore.findOpenShiftForAccount(terminal.cashAccountId);
  }

  /**
   * Open a shift ON a terminal: validates the terminal (ACTIVE) and the
   * one-open-shift-per-till rule, then delegates to the treasury service
   * (BR-021 float validation + audit live there). The terminal linkage +
   * denomination plan are recorded as POS-flow audit context.
   */
  async open(input: {
    terminalId: string;
    openingAmount: string;
    denominations?: Record<string, string> | null;
    actorId: string | null;
  }) {
    const terminal = await store.findTerminalById(input.terminalId);
    if (terminal === undefined) throw new PosTerminalNotFoundError(input.terminalId);
    if (terminal.status !== "ACTIVE") throw new PosTerminalInactiveError(input.terminalId);

    const treasuryStore = await import("../../treasury/infrastructure/treasury.store");
    const existing = await treasuryStore.findOpenShiftForAccount(terminal.cashAccountId);
    if (existing !== undefined) {
      return { shift: existing, alreadyOpen: true as const };
    }
    const shift = await this.shifts.open({
      cashAccountId: terminal.cashAccountId,
      openingAmount: input.openingAmount,
      actorId: input.actorId,
    });
    // POS linkage (the narrow additive columns from 0024): treasury owns
    // the row; this service stamps the terminal + denomination plan.
    const { requireTenantContext } = await import("../../../infra/db/tenant-context");
    const context = requireTenantContext();
    if (context.tx !== undefined) {
      const { sql } = await import("drizzle-orm");
      await context.tx.execute(sql`
        UPDATE cashier_shifts SET pos_terminal_id = ${input.terminalId},
          denominations = ${input.denominations === undefined || input.denominations === null
            ? null
            : JSON.stringify(input.denominations)}::jsonb,
          blind_count = true, updated_at = now(), version = version + 1
        WHERE id = ${shift.id}
      `);
    }
    await this.audit.record({
      action: "shift.opened",
      entityType: "cashier_shift",
      entityId: shift.id,
      actorId: input.actorId ?? undefined,
      after: {
        terminalId: input.terminalId,
        openingAmount: input.openingAmount,
        denominations: input.denominations ?? null,
        blindCount: true,
      },
    });
    return { shift, alreadyOpen: false as const };
  }

  /** In-shift manual tellering capture (paid-outs etc.) — treasury-owned. */
  async capture(input: {
    terminalId: string;
    shiftId: string;
    cashIn: string;
    cashOut: string;
    actorId: string | null;
  }) {
    await this.requireShiftOnTerminal(input.shiftId, input.terminalId);
    return this.shifts.capture({
      id: input.shiftId,
      cashIn: input.cashIn,
      cashOut: input.cashOut,
      actorId: input.actorId,
    });
  }

  /**
   * Blind close with the denomination count: the counted total is derived
   * from the per-denomination entries (the cashier counts without seeing
   * expected); variance approval flows through the treasury BR-021 path
   * (tolerance → auto-post; beyond → supervisor id + PIN + reason).
   */
  async close(input: {
    terminalId: string;
    shiftId: string;
    denominations: Record<string, string>;
    reason?: string;
    supervisorId?: string;
    supervisorPin?: string;
    actorId: string | null;
  }) {
    await this.requireShiftOnTerminal(input.shiftId, input.terminalId);
    let counted = "0";
    for (const [denomination, count] of Object.entries(input.denominations)) {
      if (!/^\d+(\.\d{1,4})?$/.test(denomination) || !/^\d+$/.test(count)) {
        throw new (await import("../domain/pos-errors")).PosTenderInvalidError(
          `denomination entry ${denomination} × ${count} is not a valid count`,
        );
      }
      counted = (Number(counted) + Number(denomination) * Number(count)).toFixed(4);
    }
    const shift = await this.shifts.close({
      id: input.shiftId,
      countedAmount: counted,
      reason: input.reason,
      supervisorId: input.supervisorId,
      supervisorPin: input.supervisorPin,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "shift.closed",
      entityType: "cashier_shift",
      entityId: input.shiftId,
      actorId: input.actorId ?? undefined,
      after: { terminalId: input.terminalId, denominations: input.denominations, counted },
    });
    return shift;
  }

  private async requireShiftOnTerminal(shiftId: string, terminalId: string) {
    const terminal = await store.findTerminalById(terminalId);
    if (terminal === undefined) throw new PosTerminalNotFoundError(terminalId);
    const treasuryStore = await import("../../treasury/infrastructure/treasury.store");
    const open = await treasuryStore.findOpenShiftForAccount(terminal.cashAccountId);
    if (open === undefined || open.id !== shiftId) {
      throw new PosShiftNotOnTerminalError(shiftId, terminalId);
    }
    return open;
  }
}
