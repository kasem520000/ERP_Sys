import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";
import * as wms from "../infrastructure/wms-store";
import {
  BinNotFoundError,
  PartialPickNotAllowedError,
  PickTaskNotFoundError,
  PickTaskStateError,
  PickWaveEmptyError,
  PickWaveNotFoundError,
  PickWaveStateError,
  WrongBinPickError,
} from "../domain/inventory-errors";

/**
 * Directed picking (PHASE-044 T-05; §2.4; I-04/I-06/I-07, PP-11): the
 * per-warehouse strategy (FIFO / FEFO / NEAREST + the allow-partial
 * rule), pick waves grouping delivery notes into ONE route, scan-verified
 * task confirms, and the cluster route (one bin walk serves every order
 * of the wave).
 *
 * THE ECONOMIC LAW (INV-029's sibling discipline): a pick CONFIRM is
 * bookkeeping only — qty_done, the scan evidence, the task stamps. The
 * bin_contents decrement rides the DELIVERY POST (the movement core's
 * applyIssue consumes the wave's completed-task allocations through
 * directedTakes — bins and item_stock move in the SAME transaction, never
 * before). Between confirm and post the goods are "in the tote" — the
 * honest physical divergence the task board records.
 *
 * Wave lifecycle: DRAFT (tasks PENDING, allocations computed at create —
 * the ck_pick_tasks_direction floor requires from_bin at INSERT) →
 * RELEASED (PW- number, released stamps) → COMPLETED (every task
 * terminal, auto-stamped on the last confirm) / CANCELLED.
 */
const WAVE_FORMAT = { prefix: "PW", format: "PW-{YYYY}-{SEQ:6}", docType: "pick_wave" };
const METHODS = new Set(["FIFO", "FEFO", "NEAREST"]);

@Injectable()
export class PickingService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(NumberingService) private readonly numbering: NumberingService,
  ) {}

  // -- the strategy (§2.4; I-04) ---------------------------------------------------

  async getStrategy(warehouseId: string) {
    return wms.findPickStrategy(warehouseId);
  }

  async upsertStrategy(input: {
    warehouseId: string;
    method: "FIFO" | "FEFO" | "NEAREST";
    allowPartial: boolean;
    actorId: string | null;
  }) {
    if (!METHODS.has(input.method)) {
      throw new PickWaveStateError(`method must be FIFO/FEFO/NEAREST: ${input.method}`);
    }
    const strategy = await wms.upsertPickStrategyRow({
      warehouseId: input.warehouseId,
      method: input.method,
      allowPartial: input.allowPartial,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "inventory.pick_strategy_upserted",
      entityType: "pick_strategy",
      entityId: strategy.id,
      actorId: input.actorId ?? undefined,
      after: { method: strategy.method, allowPartial: strategy.allowPartial },
    });
    return strategy;
  }

  // -- waves (§2.4; I-06) ------------------------------------------------------------

  async listWaves(filter: { warehouseId?: string; status?: string; limit?: number }) {
    return wms.listPickWaves({
      warehouseId: filter.warehouseId,
      status: filter.status,
      limit: filter.limit ?? 100,
    });
  }

  async findWave(id: string) {
    const wave = await wms.findPickWaveById(id);
    if (wave === undefined) throw new PickWaveNotFoundError(id);
    return wave;
  }

  async waveTasks(waveId: string) {
    await this.findWave(waveId);
    return wms.listPickTasks({ waveId, limit: 500 });
  }

  /**
   * Create a DRAFT wave over a set of DELIVERABLE lines: the caller (the
   * sales delivery flow / the wave board) passes the exact lines
   * (deliveryNoteId + lineNo + item + qty + batch). Tasks allocate NOW —
   * the strategy-ordered bin walk (FIFO/FEFO/NEAREST over AVAILABLE
   * tenant-owned rows) — because a PICK task cannot exist without its
   * from_bin (the ck_pick_tasks_direction floor).
   */
  async createWave(input: {
    warehouseId: string;
    lines: {
      deliveryNoteId: string;
      lineNo: number;
      itemId: string;
      qty: string;
      batchId: string | null;
    }[];
    method?: "FIFO" | "FEFO" | "NEAREST" | null;
    routeNote: string | null;
    actorId: string | null;
  }) {
    if (input.lines.length === 0) {
      throw new PickWaveEmptyError(input.warehouseId);
    }
    const strategy = await wms.findPickStrategy(input.warehouseId);
    const method = input.method ?? strategy?.method ?? "FIFO";
    if (!METHODS.has(method)) {
      throw new PickWaveStateError(`method must be FIFO/FEFO/NEAREST: ${method}`);
    }
    const wave = await wms.insertPickWave({
      warehouseId: input.warehouseId,
      method,
      routeNote: input.routeNote,
      createdBy: input.actorId,
    });
    // The in-wave allocation ledger: successive lines must see the PRIOR
    // lines' takes on the same bin row (a 10-unit face cannot serve two
    // 6-unit lines — the allocation walks to the next row when the
    // in-wave net is exhausted).
    const allocatedByRow = new Map<string, number>();
    let sequence = 0;
    for (const line of input.lines) {
      const allocatable = await wms.listPickableRows({
        warehouseId: input.warehouseId,
        itemId: line.itemId,
        method: method as "FIFO" | "FEFO" | "NEAREST",
      });
      let remaining = Number(line.qty);
      for (const row of allocatable) {
        if (remaining <= 0) break;
        if (line.batchId !== null && row.batchId !== line.batchId) continue;
        const rowNet = Number(row.qty) - (allocatedByRow.get(row.id) ?? 0);
        if (rowNet <= 0) continue;
        const take = Math.min(rowNet, remaining);
        allocatedByRow.set(row.id, (allocatedByRow.get(row.id) ?? 0) + take);
        sequence += 1;
        await wms.insertPickTask({
          taskKind: "PICK",
          itemId: line.itemId,
          qty: take.toFixed(6),
          fromBinId: row.binId,
          toBinId: null,
          sourceType: "delivery_note",
          sourceId: line.deliveryNoteId,
          sourceLineNo: line.lineNo,
          batchId: row.batchId,
          waveId: wave.id,
          sequenceNo: sequence,
          note: null,
          createdBy: input.actorId,
        });
        remaining -= take;
      }
      // A short allocation is HONEST here: the task set covers what the
      // bins can serve; the delivery post still plans the full line
      // (BIN_CONTENTS_SHORT guards the true shortfall). allow_partial
      // governs the CONFIRM, not the allocation.
    }
    await this.audit.record({
      action: "inventory.pick_wave_created",
      entityType: "pick_wave",
      entityId: wave.id,
      actorId: input.actorId ?? undefined,
      after: { warehouseId: input.warehouseId, method, lines: input.lines.length },
    });
    return wms.findPickWaveById(wave.id);
  }

  /** DRAFT → RELEASED: the official PW- number + the release stamps. */
  async releaseWave(waveId: string, actorId: string | null) {
    const wave = await this.findWave(waveId);
    if (wave.status !== "DRAFT") {
      throw new PickWaveStateError(`wave ${waveId} is ${wave.status} — only DRAFT waves release`);
    }
    const year = new Date().toISOString().slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: WAVE_FORMAT.docType,
      branchId: null,
      periodKey: year,
      format: WAVE_FORMAT.format,
      prefix: WAVE_FORMAT.prefix,
      year,
    });
    const releasedAt = new Date().toISOString();
    await wms.updatePickWave(waveId, {
      status: "RELEASED",
      waveNo: acquired.number,
      releasedAt,
      releasedBy: actorId,
    });
    await this.audit.record({
      action: "inventory.pick_wave_released",
      entityType: "pick_wave",
      entityId: waveId,
      actorId: actorId ?? undefined,
      after: { waveNo: acquired.number },
    });
    return wms.findPickWaveById(waveId);
  }

  /** RELEASED → COMPLETED (every task terminal) — explicit close. */
  async completeWave(waveId: string, actorId: string | null) {
    const wave = await this.findWave(waveId);
    if (wave.status !== "RELEASED") {
      throw new PickWaveStateError(`wave ${waveId} is ${wave.status} — only RELEASED waves complete`);
    }
    const tasks = await wms.listPickTasks({ waveId, limit: 500 });
    const open = tasks.filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED");
    if (open.length > 0) {
      throw new PickWaveStateError(
        `wave ${waveId} still has ${open.length} open task(s) — complete or cancel them first`,
      );
    }
    await wms.updatePickWave(waveId, {
      status: "COMPLETED",
      completedAt: new Date().toISOString(),
      completedBy: actorId,
    });
    await this.audit.record({
      action: "inventory.pick_wave_completed",
      entityType: "pick_wave",
      entityId: waveId,
      actorId: actorId ?? undefined,
    });
    return wms.findPickWaveById(waveId);
  }

  async cancelWave(waveId: string, reason: string | null, actorId: string | null) {
    const wave = await this.findWave(waveId);
    if (wave.status === "COMPLETED" || wave.status === "CANCELLED") {
      throw new PickWaveStateError(`wave ${waveId} is ${wave.status} — nothing to cancel`);
    }
    const tasks = await wms.listPickTasks({ waveId, limit: 500 });
    if (tasks.some((t) => t.status === "COMPLETED")) {
      throw new PickWaveStateError(
        `wave ${waveId} has confirmed picks — post or reverse the deliveries instead`,
      );
    }
    for (const task of tasks) {
      if (task.status !== "CANCELLED") {
        await wms.updatePickTask(task.id, { status: "CANCELLED", note: reason });
      }
    }
    await wms.updatePickWave(waveId, { status: "CANCELLED", routeNote: reason });
    await this.audit.record({
      action: "inventory.pick_wave_cancelled",
      entityType: "pick_wave",
      entityId: waveId,
      actorId: actorId ?? undefined,
      after: { reason },
    });
    return wms.findPickWaveById(waveId);
  }

  // -- the task lifecycle + scan verification (PP-11; I-07) ---------------------------

  async listTasks(filter: {
    status?: string;
    waveId?: string;
    assigneeUserId?: string;
    sourceType?: string;
    sourceId?: string;
    limit?: number;
  }) {
    return wms.listPickTasks({ ...filter, taskKind: "PICK", limit: filter.limit ?? 200 });
  }

  async findTask(id: string) {
    const task = await wms.findPickTaskById(id);
    if (task === undefined) throw new PickTaskNotFoundError(id);
    return task;
  }

  async assignTask(taskId: string, userId: string | null, actorId: string | null) {
    const task = await this.findTask(taskId);
    if (task.taskKind !== "PICK") {
      throw new PickTaskStateError(`task ${taskId} is a ${task.taskKind} task`);
    }
    if (task.status !== "PENDING" && task.status !== "ASSIGNED") {
      throw new PickTaskStateError(`task ${taskId} is ${task.status} — only PENDING/ASSIGNED reassign`);
    }
    await wms.updatePickTask(taskId, {
      status: userId === null ? "PENDING" : "ASSIGNED",
      assigneeUserId: userId,
    });
    await this.audit.record({
      action: "inventory.pick_task_assigned",
      entityType: "pick_task",
      entityId: taskId,
      actorId: actorId ?? undefined,
      after: { assigneeUserId: userId },
    });
    return wms.findPickTaskById(taskId);
  }

  async startTask(taskId: string, actorId: string | null) {
    const task = await this.findTask(taskId);
    if (task.status !== "PENDING" && task.status !== "ASSIGNED") {
      throw new PickTaskStateError(`task ${taskId} is ${task.status} — only PENDING/ASSIGNED start`);
    }
    await wms.updatePickTask(taskId, { status: "IN_PROGRESS" });
    await this.audit.record({
      action: "inventory.pick_task_started",
      entityType: "pick_task",
      entityId: taskId,
      actorId: actorId ?? undefined,
    });
    return wms.findPickTaskById(taskId);
  }

  /**
   * Scan-confirm a PICK (PP-11/DF-17 — the browser camera feeds the scan):
   * the scan MUST resolve to the task's allocated from-bin; a short qty
   * confirms only under the warehouse strategy's allow_partial. The
   * confirm is BOOKKEEPING (see the class docblock) — the economic move
   * rides the delivery post. Idempotent replay returns the stored row.
   */
  async confirmPick(input: {
    taskId: string;
    scannedBarcode: string;
    qty?: string;
    actorId: string | null;
  }) {
    const task = await this.findTask(input.taskId);
    if (task.taskKind !== "PICK") {
      throw new PickTaskStateError(`task ${input.taskId} is a ${task.taskKind} task`);
    }
    if (task.fromBinId === null || task.fromBinCode === null) {
      throw new PickTaskStateError(`task ${input.taskId} has no allocated source bin`);
    }
    const sourceBin = await wms.findBinById(task.fromBinId);
    if (sourceBin === undefined) {
      throw new BinNotFoundError(task.fromBinId);
    }
    if (
      input.scannedBarcode !== sourceBin.barcode &&
      input.scannedBarcode !== sourceBin.code &&
      input.scannedBarcode !== task.fromBinId
    ) {
      throw new WrongBinPickError(input.scannedBarcode, sourceBin.barcode);
    }
    if (task.status === "COMPLETED") {
      return task; // idempotent replay — the stored row
    }
    if (task.status === "CANCELLED") {
      throw new PickTaskStateError(`task ${input.taskId} is CANCELLED`);
    }
    const qty = input.qty ?? task.qty;
    if (Number(qty) <= 0 || Number(qty) > Number(task.qty)) {
      throw new PickTaskStateError(
        `confirm qty must be within (0, ${task.qty}] for task ${input.taskId}: ${qty}`,
      );
    }
    if (Number(qty) < Number(task.qty)) {
      const strategy = await wms.findPickStrategy(sourceBin.warehouseId);
      if (strategy === undefined || !strategy.allowPartial) {
        throw new PartialPickNotAllowedError(sourceBin.warehouseId);
      }
    }
    const completedAt = new Date().toISOString();
    await wms.updatePickTask(task.id, {
      status: "COMPLETED",
      qtyDone: Number(qty).toFixed(6),
      scanVerified: true,
      completedAt,
      completedBy: input.actorId,
    });
    await this.audit.record({
      action: "inventory.pick_confirmed",
      entityType: "pick_task",
      entityId: task.id,
      actorId: input.actorId ?? undefined,
      after: { fromBinCode: task.fromBinCode, qty },
    });
    // Auto-close the wave when its last task resolved.
    if (task.waveId !== null) {
      const siblings = await wms.listPickTasks({ waveId: task.waveId, limit: 500 });
      const open = siblings.filter((t) => t.status !== "COMPLETED" && t.status !== "CANCELLED");
      if (open.length === 0) {
        await wms.updatePickWave(task.waveId, {
          status: "COMPLETED",
          completedAt: new Date().toISOString(),
          completedBy: input.actorId,
        });
      }
    }
    return (await wms.findPickTaskById(task.id))!;
  }

  async cancelTask(taskId: string, reason: string | null, actorId: string | null) {
    const task = await this.findTask(taskId);
    if (task.status === "COMPLETED") {
      throw new PickTaskStateError(`task ${taskId} is COMPLETED — nothing to cancel`);
    }
    await wms.updatePickTask(taskId, { status: "CANCELLED", note: reason });
    await this.audit.record({
      action: "inventory.pick_task_cancelled",
      entityType: "pick_task",
      entityId: taskId,
      actorId: actorId ?? undefined,
      after: { reason },
    });
    return wms.findPickTaskById(taskId);
  }

  /**
   * The CLUSTER route (§2.4; I-07): the wave's open tasks ordered by the
   * from-bin's pick sequence — one physical walk serves EVERY order of
   * the wave (the multi-order cluster discipline; the fixture proves two
   * deliveries complete on one route).
   */
  async clusterRoute(waveId: string) {
    await this.findWave(waveId);
    const tasks = await wms.listWaveRouteTasks(waveId);
    return tasks.filter((t) => t.status !== "CANCELLED");
  }

  /**
   * The delivery-post integration (T-05 ↔ T-03): the delivery's COMPLETED
   * pick tasks become the issue's directedTakes — the confirmed physical
   * picks drive the economic bin decrements through the movement core
   * (bins and item_stock move in the SAME delivery-post transaction;
   * INV-029's law holds at every step). Tasks that never confirmed (or
   * whose bins were emptied meanwhile) simply contribute nothing — the
   * plan's default allocation covers the line honestly.
   */
  async directedTakesForDelivery(
    deliveryNoteId: string,
  ): Promise<Map<number, { contentId: string; qty: string }[]>> {
    const tasks = await wms.listPickTasks({
      taskKind: "PICK",
      sourceType: "delivery_note",
      sourceId: deliveryNoteId,
      limit: 500,
    });
    const byLine = new Map<number, { contentId: string; qty: string }[]>();
    for (const task of tasks) {
      if (task.status !== "COMPLETED" || task.fromBinId === null || task.sourceLineNo === null) {
        continue;
      }
      const contents = await wms.listBinContents({
        binId: task.fromBinId,
        itemId: task.itemId,
        limit: 50,
      });
      let remaining = Number(task.qtyDone);
      const takes: { contentId: string; qty: string }[] = [];
      for (const row of contents) {
        if (remaining <= 0) break;
        if (row.batchId !== task.batchId || row.ownerPartnerId !== null || Number(row.qty) <= 0) {
          continue;
        }
        const take = Math.min(Number(row.qty), remaining);
        takes.push({ contentId: row.id, qty: take.toFixed(6) });
        remaining -= take;
      }
      if (takes.length > 0) {
        const list = byLine.get(task.sourceLineNo) ?? [];
        list.push(...takes);
        byLine.set(task.sourceLineNo, list);
      }
    }
    return byLine;
  }
}
