import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/pos.store";
import type { CheckLine, PosCheckRow, PosTableRow } from "../infrastructure/pos.store";
import {
  PosCheckNotOpenError,
  PosCheckNotFoundError,
  PosTableNotFoundError,
} from "../domain/pos-errors";

/**
 * Floor service (PHASE-016 T6): table service — the floor plan, open
 * guest checks with send/merge/transfer/split, kitchen ticket printing.
 * **Unpaid open tables hold NO ledger effect** (binding): a check is a
 * working jsonb document; it converts to a POS sale (a sales invoice,
 * channel='POS') only at payment — the ledger writes happen there, in
 * the sales module's posting transaction (INV-013/018).
 */
@Injectable()
export class PosFloorService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  // -- floor plan ----------------------------------------------------------------

  async listFloor(branchId: string) {
    const [tables, openChecks] = await Promise.all([
      store.listTables(branchId),
      store.listChecks({ branchId, status: "OPEN", limit: 500 }),
    ]);
    const checkByTable = new Map<string, PosCheckRow>();
    for (const check of openChecks) {
      if (check.tableId !== null) checkByTable.set(check.tableId, check);
    }
    const zones = new Map<string, { zone: string; zoneAr: string | null; tables: FloorTable[] }>();
    for (const table of tables) {
      const check = checkByTable.get(table.id);
      const zone = zones.get(table.zone) ?? { zone: table.zone, zoneAr: table.zoneAr, tables: [] };
      zone.tables.push({
        ...table,
        status: check !== undefined ? "OCCUPIED" : table.status,
        openCheckId: check?.id ?? null,
        openCheckNo: check?.checkNo ?? null,
      });
      zones.set(table.zone, zone);
    }
    return [...zones.values()];
  }

  async addTable(input: {
    branchId: string;
    zone: string;
    zoneAr: string | null;
    label: string;
    seats: number;
    sortKey: number;
    actorId: string | null;
  }) {
    return store.insertTable({ ...input, createdBy: input.actorId });
  }

  async setTableStatus(input: { id: string; status: PosTableRow["status"] }) {
    await this.requireTable(input.id);
    return store.updateTableStatus(input);
  }

  // -- guest checks ----------------------------------------------------------------

  async openCheck(input: {
    branchId: string;
    tableId: string | null;
    orderType: PosCheckRow["orderType"];
    guestCount: number;
    actorId: string | null;
  }) {
    if (input.tableId !== null) {
      const table = await this.requireTable(input.tableId);
      if (table.branchId !== input.branchId) {
        throw new PosTableNotFoundError(input.tableId);
      }
      const open = await store.listChecks({ branchId: input.branchId, status: "OPEN", limit: 500 });
      if (open.some((check) => check.tableId === input.tableId)) {
        throw new PosCheckNotOpenError(input.tableId, "already has an OPEN check");
      }
    }
    const check = await store.insertCheck({ ...input, lines: [], note: null });
    if (input.tableId !== null) {
      await store.updateTableStatus({ id: input.tableId, status: "OCCUPIED" });
    }
    await this.audit.record({
      action: "pos.check_opened",
      entityType: "pos_check",
      entityId: check.id,
      actorId: input.actorId ?? undefined,
      after: { checkNo: check.checkNo, tableId: input.tableId, orderType: input.orderType },
    });
    return check;
  }

  async findCheck(id: string) {
    const check = await store.findCheckById(id);
    if (check === undefined) throw new PosCheckNotFoundError(id);
    return check;
  }

  async listChecks(branchId: string, status?: string) {
    return store.listChecks({ branchId, status, limit: 500 });
  }

  /** Add/replace lines (item sends accumulate; merges are line-list ops). */
  async saveLines(input: { checkId: string; lines: CheckLine[]; actorId: string | null }) {
    const check = await this.requireOpenCheck(input.checkId);
    let lineNo = 0;
    const lines = input.lines.map((line) => ({ ...line, lineNo: (lineNo += 1) }));
    const updated = await store.updateCheckLines({ id: check.id, lines });
    await this.audit.record({
      action: "pos.check_lines_saved",
      entityType: "pos_check",
      entityId: check.id,
      actorId: input.actorId ?? undefined,
      after: { lineCount: lines.length },
    });
    return updated;
  }

  /** Send (print) a kitchen ticket for the unsent lines; marks them sent. */
  async sendKitchenTicket(input: { checkId: string; actorId: string | null }) {
    const check = await this.requireOpenCheck(input.checkId);
    const unsent = check.lines.filter((line) => !line.sentToKitchen);
    if (unsent.length === 0) {
      throw new PosCheckNotOpenError(check.id, "has no unsent lines");
    }
    const ticket = await store.insertKitchenTicket({
      checkId: check.id,
      items: unsent,
      actorId: input.actorId,
    });
    const lines = check.lines.map((line) =>
      unsent.some((unsentLine) => unsentLine.lineNo === line.lineNo)
        ? { ...line, sentToKitchen: true }
        : line,
    );
    await store.updateCheckLines({ id: check.id, lines });
    await this.audit.record({
      action: "pos.kitchen_ticket_printed",
      entityType: "pos_check",
      entityId: check.id,
      actorId: input.actorId ?? undefined,
      after: { ticketNo: ticket.ticketNo, items: unsent.length },
    });
    return ticket;
  }

  async listKitchenTickets(checkId: string) {
    await this.findCheck(checkId);
    return store.listKitchenTickets(checkId);
  }

  /** Transfer the check to another table (guest move). */
  async transfer(input: { checkId: string; toTableId: string; actorId: string | null }) {
    const check = await this.requireOpenCheck(input.checkId);
    const table = await this.requireTable(input.toTableId);
    if (table.branchId !== check.branchId) {
      throw new PosTableNotFoundError(input.toTableId);
    }
    await store.updateCheckTable({ id: check.id, tableId: input.toTableId });
    if (check.tableId !== null) {
      await store.updateTableStatus({ id: check.tableId, status: "FREE" });
    }
    await store.updateTableStatus({ id: input.toTableId, status: "OCCUPIED" });
    await this.audit.record({
      action: "pos.check_transferred",
      entityType: "pos_check",
      entityId: check.id,
      actorId: input.actorId ?? undefined,
      after: { fromTableId: check.tableId, toTableId: input.toTableId },
    });
    return this.findCheck(check.id);
  }

  /** Split: move the selected line numbers to a NEW check (same table). */
  async split(input: { checkId: string; lineNos: number[]; actorId: string | null }) {
    const check = await this.requireOpenCheck(input.checkId);
    const picked = new Set(input.lineNos);
    const moved = check.lines.filter((line) => picked.has(line.lineNo));
    if (moved.length === 0 || moved.length === check.lines.length) {
      throw new PosCheckNotOpenError(check.id, "split must move at least one line but not all");
    }
    const remaining = check.lines.filter((line) => !picked.has(line.lineNo));
    const target = await store.insertCheck({
      branchId: check.branchId,
      tableId: check.tableId,
      orderType: check.orderType,
      guestCount: 1,
      lines: moved.map((line, index) => ({ ...line, lineNo: index + 1 })),
      note: `split from ${check.checkNo}`,
      actorId: input.actorId,
    });
    await store.updateCheckLines({
      id: check.id,
      lines: remaining.map((line, index) => ({ ...line, lineNo: index + 1 })),
    });
    await this.audit.record({
      action: "pos.check_split",
      entityType: "pos_check",
      entityId: check.id,
      actorId: input.actorId ?? undefined,
      after: { newCheckId: target.id, movedLines: moved.length },
    });
    return { source: await this.findCheck(check.id), target };
  }

  /** Cancel an open check (audited; never silently — a manager action). */
  async cancel(input: { checkId: string; reason: string; actorId: string | null }) {
    const check = await this.requireOpenCheck(input.checkId);
    const updated = await store.closeCheck({ id: check.id, status: "CANCELLED", invoiceId: null });
    if (check.tableId !== null) {
      await store.updateTableStatus({ id: check.tableId, status: "FREE" });
    }
    await this.audit.record({
      action: "pos.check_cancelled",
      entityType: "pos_check",
      entityId: check.id,
      actorId: input.actorId ?? undefined,
      after: { reason: input.reason },
    });
    return updated;
  }

  /** Payment completes a check: the caller (pos sale service) has posted
   * the invoice; this stamps the check PAID + frees the table. */
  async settleFromSale(input: { checkId: string; invoiceId: string }) {
    const check = await store.findCheckById(input.checkId);
    if (check === undefined) throw new PosCheckNotFoundError(input.checkId);
    if (check.status !== "OPEN") throw new PosCheckNotOpenError(input.checkId, check.status);
    const updated = await store.closeCheck({
      id: check.id,
      status: "PAID",
      invoiceId: input.invoiceId,
    });
    if (check.tableId !== null) {
      await store.updateTableStatus({ id: check.tableId, status: "FREE" });
    }
    return updated;
  }

  private async requireOpenCheck(id: string): Promise<PosCheckRow> {
    const check = await this.findCheck(id);
    if (check.status !== "OPEN") throw new PosCheckNotOpenError(id, check.status);
    return check;
  }

  private async requireTable(id: string): Promise<PosTableRow> {
    const table = await store.findTableById(id);
    if (table === undefined) throw new PosTableNotFoundError(id);
    return table;
  }
}

export interface FloorTable extends PosTableRow {
  openCheckId: string | null;
  openCheckNo: string | null;
}
