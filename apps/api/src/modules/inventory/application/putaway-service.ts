import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/inventory.store";
import * as wms from "../infrastructure/wms-store";
import {
  BinNotFoundError,
  PutawayRuleInvalidError,
  PutawayRuleNotFoundError,
  PutawayTaskNotFoundError,
  PutawayTaskStateError,
  WrongBinPutawayError,
} from "../domain/inventory-errors";

/**
 * Directed putaway (PHASE-044 T-04; §2.3; I-03, PP-12): the condition
 * engine over `putaway_rules` — active rules in priority order, the FIRST
 * match wins, its target (an explicit bin, or the EMPTIEST bin of the
 * target zone type) becomes the suggestion. Goods receipts generate
 * PUTAWAY tasks from the suggestions (the landing slot is the warehouse's
 * DEFAULT bin — D-5's anchor); the operator confirms with a BIN SCAN
 * (PP-11/DF-17 — the browser camera is the web layer's concern), and a
 * wrong-bin scan is the typed WrongBinPutawayError (§6.3 — zero residue:
 * the plan-then-confirm discipline).
 *
 * The confirm executes a STRUCTURAL slot move (bin → bin, same item, same
 * status): item_stock NEVER moves — INV-029's fold is untouched by
 * design; only the bin_contents slots change. Serialized rows append
 * their PUTAWAY ledger event (T-11's map).
 *
 * PP-12: the bin label prints immediately after the receipt commits —
 * `receiptLabels` returns one fixed-format label payload per generated
 * task (BIN-LABEL-V1; the template DESIGNER stays PHASE-062).
 *
 * The v1 condition vocabulary (validated fail-closed at save):
 *   skuPrefix    — the item's SKU starts with the prefix
 *   categoryId   — the item's category (uuid)
 *   trackBatch   — batch-tracked items only (or false: untracked only)
 *   trackSerial  — serial-tracked items only
 *   hasExpiry    — shelf-life items only
 *   costingMethod— "WAC" | "FIFO"
 *   minQty/maxQty— the received line qty within the inclusive bounds
 */
const CONDITION_KEYS = new Set([
  "skuPrefix",
  "categoryId",
  "trackBatch",
  "trackSerial",
  "hasExpiry",
  "costingMethod",
  "minQty",
  "maxQty",
]) as ReadonlySet<string>;
const ZONE_TYPES = new Set(["PICKING", "BULK", "QUARANTINE", "DOCK", "STAGE"]);
const QTY_RE = /^\d+(\.\d{1,6})?$/;

/** PP-12's fixed label format (v1 — the 062 designer replaces the layout,
 * never the payload contract). */
export interface BinLabelPayload {
  labelFormat: "BIN-LABEL-V1";
  taskId: string;
  bin: { id: string; code: string; barcode: string };
  item: { id: string; sku: string | null; name: string | null };
  qty: string;
  batch: { id: string | null; batchNo: string | null; expiryDate: string | null };
  lpn: { id: string | null; lpnCode: string | null };
  generatedAt: string;
}

@Injectable()
export class PutawayService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  // -- rule CRUD -------------------------------------------------------------------

  async listRules(activeOnly = false) {
    return wms.listPutawayRules({ activeOnly });
  }

  private validateRule(input: {
    priority?: number;
    condition: Record<string, unknown>;
    targetZoneType: string | null;
    targetBinId: string | null;
  }): void {
    for (const key of Object.keys(input.condition)) {
      if (!CONDITION_KEYS.has(key)) {
        throw new PutawayRuleInvalidError(
          `unknown condition key "${key}" — the v1 vocabulary is: ${[...CONDITION_KEYS].join(", ")}`,
        );
      }
    }
    if (
      (input.targetZoneType === null) === (input.targetBinId === null) ||
      (input.targetZoneType !== null && input.targetBinId !== null)
    ) {
      throw new PutawayRuleInvalidError(
        "a rule targets EXACTLY ONE of: targetZoneType | targetBinId",
      );
    }
    if (input.targetZoneType !== null && !ZONE_TYPES.has(input.targetZoneType)) {
      throw new PutawayRuleInvalidError(
        `targetZoneType must be one of ${[...ZONE_TYPES].join("/")}: ${input.targetZoneType}`,
      );
    }
    for (const bound of ["minQty", "maxQty"] as const) {
      const value = input.condition[bound];
      if (value !== undefined && (typeof value !== "string" || !QTY_RE.test(value))) {
        throw new PutawayRuleInvalidError(`${bound} must be a decimal string ≤ 6dp`);
      }
    }
  }

  async createRule(input: {
    priority: number;
    name: string;
    condition: Record<string, unknown>;
    targetZoneType: string | null;
    targetBinId: string | null;
    note: string | null;
    actorId: string | null;
  }) {
    this.validateRule(input);
    if (input.targetBinId !== null && (await wms.findBinById(input.targetBinId)) === undefined) {
      throw new BinNotFoundError(input.targetBinId);
    }
    const rule = await wms.insertPutawayRule({
      priority: input.priority,
      name: input.name,
      condition: input.condition,
      targetZoneType: input.targetZoneType,
      targetBinId: input.targetBinId,
      note: input.note,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "inventory.putaway_rule_created",
      entityType: "putaway_rule",
      entityId: rule.id,
      actorId: input.actorId ?? undefined,
      after: { priority: rule.priority, name: rule.name },
    });
    return rule;
  }

  async updateRule(
    id: string,
    patch: {
      name?: string;
      condition?: Record<string, unknown>;
      targetZoneType?: string | null;
      targetBinId?: string | null;
      isActive?: boolean;
      note?: string | null;
    },
    actorId: string | null,
  ) {
    const rule = await wms.findPutawayRuleById(id);
    if (rule === undefined) throw new PutawayRuleNotFoundError(id);
    if (patch.condition !== undefined || patch.targetZoneType !== undefined || patch.targetBinId !== undefined) {
      this.validateRule({
        condition: patch.condition ?? rule.condition,
        targetZoneType: patch.targetZoneType ?? rule.targetZoneType,
        targetBinId: patch.targetBinId ?? rule.targetBinId,
      });
    }
    await wms.updatePutawayRule(id, patch);
    await this.audit.record({
      action: "inventory.putaway_rule_updated",
      entityType: "putaway_rule",
      entityId: id,
      actorId: actorId ?? undefined,
      after: patch,
    });
    return wms.findPutawayRuleById(id);
  }

  // -- the engine (§2.3) -------------------------------------------------------------

  /**
   * The suggestion: FIRST active rule (priority asc) whose condition
   * matches the line wins. An explicit targetBinId returns that bin; a
   * zone-type target returns the EMPTIEST bin of that type in the
   * warehouse (no matching bin of the type → the rule is passed over).
   * NO rule matching → null (the stock stays in its landing bin — the
   * default-bin anchor; no task is generated for that line).
   */
  async suggestBin(input: {
    warehouseId: string;
    itemId: string;
    qty: string;
  }): Promise<{ bin: wms.BinRow; ruleId: string } | null> {
    const item = await store.findItemForInventory(input.itemId);
    if (item === undefined) return null;
    const rules = await wms.listPutawayRules({ activeOnly: true });
    for (const rule of rules) {
      if (!ruleMatches(rule.condition, item, input.qty)) continue;
      if (rule.targetBinId !== null) {
        const bin = await wms.findBinById(rule.targetBinId);
        if (bin === undefined || bin.warehouseId !== input.warehouseId) continue;
        return { bin, ruleId: rule.id };
      }
      const candidates = await wms.listBinsByZoneType(input.warehouseId, rule.targetZoneType!);
      if (candidates.length === 0) continue;
      return { bin: candidates[0]!, ruleId: rule.id };
    }
    return null;
  }

  // -- task generation on goods receipt (§2.3/PP-12) -----------------------------------

  /**
   * Generate the suggested PUTAWAY tasks for a posted receipt: one task
   * per line whose suggestion differs from the landing (DEFAULT) bin —
   * from the landing bin to the suggested bin. Lines without a matching
   * rule (or whose suggestion IS the landing bin) generate nothing (the
   * stock is already where it belongs).
   */
  async generateTasksForReceipt(input: {
    warehouseId: string;
    lines: {
      itemId: string;
      qty: string;
      batchId: string | null;
      lpnId: string | null;
      sourceType: string;
      sourceId: string;
      sourceLineNo: number | null;
    }[];
    actorId: string | null;
  }): Promise<wms.PickTaskRow[]> {
    const landing = await wms.findDefaultBin(input.warehouseId);
    if (landing === undefined) return [];
    const tasks: wms.PickTaskRow[] = [];
    let sequence = 0;
    for (const line of input.lines) {
      const suggestion = await this.suggestBin({
        warehouseId: input.warehouseId,
        itemId: line.itemId,
        qty: line.qty,
      });
      if (suggestion === null || suggestion.bin.id === landing.id) continue;
      sequence += 1;
      const task = await wms.insertPickTask({
        taskKind: "PUTAWAY",
        itemId: line.itemId,
        qty: line.qty,
        fromBinId: landing.id,
        toBinId: suggestion.bin.id,
        sourceType: line.sourceType,
        sourceId: line.sourceId,
        sourceLineNo: line.sourceLineNo,
        batchId: line.batchId,
        lpnId: line.lpnId,
        sequenceNo: sequence,
        note: `putaway rule ${suggestion.ruleId}`,
        createdBy: input.actorId,
      });
      tasks.push(task);
    }
    if (tasks.length > 0) {
      await this.audit.record({
        action: "inventory.putaway_tasks_generated",
        entityType: "goods_receipt",
        entityId: input.lines[0]?.sourceId ?? input.warehouseId,
        actorId: input.actorId ?? undefined,
        after: { tasks: tasks.length, warehouseId: input.warehouseId },
      });
    }
    return tasks;
  }

  // -- the task lifecycle ---------------------------------------------------------------

  async listTasks(filter: {
    status?: string;
    assigneeUserId?: string;
    sourceType?: string;
    sourceId?: string;
    limit?: number;
  }) {
    return wms.listPickTasks({ ...filter, taskKind: "PUTAWAY", limit: filter.limit ?? 200 });
  }

  async findTask(id: string) {
    const task = await wms.findPickTaskById(id);
    if (task === undefined) throw new PutawayTaskNotFoundError(id);
    return task;
  }

  async assign(taskId: string, userId: string | null, actorId: string | null) {
    const task = await this.findTask(taskId);
    if (task.status !== "PENDING" && task.status !== "ASSIGNED") {
      throw new PutawayTaskStateError(`task ${taskId} is ${task.status} — only PENDING/ASSIGNED reassign`);
    }
    await wms.updatePickTask(taskId, { status: userId === null ? "PENDING" : "ASSIGNED", assigneeUserId: userId });
    await this.audit.record({
      action: "inventory.putaway_task_assigned",
      entityType: "pick_task",
      entityId: taskId,
      actorId: actorId ?? undefined,
      after: { assigneeUserId: userId },
    });
    return wms.findPickTaskById(taskId);
  }

  /** Scan-confirm the putaway (PP-11/PP-12): the scan MUST resolve to the
   * task's directed bin — a wrong-bin scan is the typed rejection and
   * leaves ZERO residue. An idempotent replay (already COMPLETED, same
   * bin) returns the stored row without a second move (the INV-013
   * discipline). */
  async confirm(input: {
    taskId: string;
    scannedBarcode: string;
    actorId: string | null;
  }): Promise<{ task: wms.PickTaskRow; label: BinLabelPayload }> {
    const task = await this.findTask(input.taskId);
    if (task.taskKind !== "PUTAWAY") {
      throw new PutawayTaskStateError(`task ${input.taskId} is a ${task.taskKind} task`);
    }
    if (task.toBinCode === null || task.toBinId === null) {
      throw new PutawayTaskStateError(`task ${input.taskId} has no directed target bin`);
    }
    // The scan target is the bin's BARCODE (the scan-stable key, §2.1) —
    // the code and the id are accepted as typed fallbacks.
    const targetBin = await wms.findBinById(task.toBinId);
    if (targetBin === undefined) {
      throw new BinNotFoundError(task.toBinId);
    }
    if (
      input.scannedBarcode !== targetBin.barcode &&
      input.scannedBarcode !== targetBin.code &&
      input.scannedBarcode !== task.toBinId
    ) {
      throw new WrongBinPutawayError(input.scannedBarcode, targetBin.barcode);
    }
    if (task.status === "COMPLETED") {
      // Idempotent replay — the stored row, never a second move.
      return { task, label: await this.binLabel(task.id) };
    }
    if (task.status === "CANCELLED") {
      throw new PutawayTaskStateError(`task ${input.taskId} is CANCELLED`);
    }

    // The structural move: from the landing slot to the directed bin —
    // same status (AVAILABLE), item_stock NEVER moves (INV-029 folds
    // every slot). Zero-qty landing rows (an intervening issue) fail
    // closed below — the honest floor.
    const contents = await wms.listBinContents({
      binId: task.fromBinId ?? undefined,
      itemId: task.itemId,
      limit: 50,
    });
    let remaining = Number(task.qty);
    for (const row of contents) {
      if (remaining <= 0) break;
      if (Number(row.qty) <= 0) continue;
      if (row.batchId !== task.batchId) continue;
      if (row.ownerPartnerId !== null) continue;
      const take = Math.min(Number(row.qty), remaining);
      await wms.moveBetweenSlots({
        fromContentId: row.id,
        qty: take.toFixed(6),
        toBinId: task.toBinId!,
        toStatus: row.status,
        note: `putaway task ${task.id}`,
      });
      if (row.serialId !== null) {
        await wms.appendSerialMovement({
          serialId: row.serialId,
          event: "PUTAWAY",
          moveId: null,
          sourceType: "putaway_task",
          sourceId: task.id,
          fromBinId: task.fromBinId,
          toBinId: task.toBinId,
          movedAt: new Date().toISOString(),
          note: null,
          createdBy: input.actorId,
        });
      }
      remaining -= take;
    }
    if (remaining > 0) {
      // The landing bin cannot serve the task anymore (someone moved or
      // issued the stock) — fail closed BEFORE the completion stamp; the
      // partial moves above ride this same ambient transaction, so the
      // rejection leaves zero residue (the plan-then-write law).
      throw new PutawayTaskStateError(
        `the landing bin holds less than the task qty (${task.qty}) — recount or cancel task ${task.id}`,
      );
    }

    const completedAt = new Date().toISOString();
    await wms.updatePickTask(task.id, {
      status: "COMPLETED",
      qtyDone: task.qty,
      scanVerified: true,
      completedAt,
      completedBy: input.actorId,
    });
    await this.audit.record({
      action: "inventory.putaway_confirmed",
      entityType: "pick_task",
      entityId: task.id,
      actorId: input.actorId ?? undefined,
      after: { toBinCode: task.toBinCode, qty: task.qty },
    });
    return { task: (await wms.findPickTaskById(task.id))!, label: await this.binLabel(task.id) };
  }

  async cancel(taskId: string, reason: string | null, actorId: string | null) {
    const task = await this.findTask(taskId);
    if (task.status === "COMPLETED") {
      throw new PutawayTaskStateError(`task ${taskId} is COMPLETED — nothing to cancel`);
    }
    await wms.updatePickTask(taskId, { status: "CANCELLED", note: reason });
    await this.audit.record({
      action: "inventory.putaway_cancelled",
      entityType: "pick_task",
      entityId: taskId,
      actorId: actorId ?? undefined,
      after: { reason },
    });
    return wms.findPickTaskById(taskId);
  }

  // -- PP-12: the fixed-format bin label -------------------------------------------------

  /** The label payload for one task (BIN-LABEL-V1 — fixed format here;
   * the template DESIGNER stays PHASE-062). */
  async binLabel(taskId: string): Promise<BinLabelPayload> {
    const task = await this.findTask(taskId);
    const bin = await wms.findBinById(task.toBinId!);
    const batch =
      task.batchId === null
        ? { id: null, batchNo: null, expiryDate: null }
        : await (async () => {
            const b = await store.findBatchById(task.batchId!);
            return { id: task.batchId, batchNo: b?.batchNo ?? null, expiryDate: b?.expiryDate ?? null };
          })();
    return {
      labelFormat: "BIN-LABEL-V1",
      taskId: task.id,
      bin: { id: bin!.id, code: bin!.code, barcode: bin!.barcode },
      item: { id: task.itemId, sku: task.itemSku, name: task.itemName },
      qty: task.qty,
      batch,
      lpn: { id: task.lpnId, lpnCode: task.lpnCode },
      generatedAt: new Date().toISOString(),
    };
  }

  /** PP-12's "immediate print after receipt commit": one label per
   * generated task of the receipt. */
  async receiptLabels(sourceType: string, sourceId: string): Promise<BinLabelPayload[]> {
    const tasks = await this.listTasks({ sourceType, sourceId, limit: 100 });
    const labels: BinLabelPayload[] = [];
    for (const task of tasks) {
      labels.push(await this.binLabel(task.id));
    }
    return labels;
  }
}

/** The v1 condition matcher — unknown keys were rejected at save; here a
 * missing item attribute simply fails that predicate. */
function ruleMatches(
  condition: Record<string, unknown>,
  item: {
    sku: string;
    categoryId: string | null;
    trackBatch: boolean;
    trackSerial: boolean;
    hasExpiry: boolean;
    costingMethod: string;
  },
  qty: string,
): boolean {
  if (
    condition.skuPrefix !== undefined &&
    !item.sku.startsWith(String(condition.skuPrefix))
  ) {
    return false;
  }
  if (condition.categoryId !== undefined && item.categoryId !== condition.categoryId) {
    return false;
  }
  if (condition.trackBatch !== undefined && Boolean(condition.trackBatch) !== item.trackBatch) {
    return false;
  }
  if (condition.trackSerial !== undefined && Boolean(condition.trackSerial) !== item.trackSerial) {
    return false;
  }
  if (condition.hasExpiry !== undefined && Boolean(condition.hasExpiry) !== item.hasExpiry) {
    return false;
  }
  if (condition.costingMethod !== undefined && condition.costingMethod !== item.costingMethod) {
    return false;
  }
  if (condition.minQty !== undefined && Number(qty) < Number(condition.minQty)) {
    return false;
  }
  if (condition.maxQty !== undefined && Number(qty) > Number(condition.maxQty)) {
    return false;
  }
  return true;
}
