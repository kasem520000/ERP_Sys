import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/planning.store";
import {
  MpsEntryInvalidError,
  MpsEntryNotFoundError,
  MpsFrozenFenceEditError,
  MpsFrozenReasonRequiredError,
} from "../domain/manufacturing-errors";

/**
 * MPS service (PHASE-043 T-06; M-05): the master production schedule —
 * planned/firmed production quantities per (warehouse, item, bucket),
 * the demand override inside the frozen fence. The MRP engine consumes
 * every entry as bucket demand (kind MPS).
 *
 * The frozen-fence discipline (BR-078): editing an entry whose bucket
 * starts inside the item's frozen_fence_days window from today requires
 * the manufacturing.mps.frozen_edit permission AND a reason (the reason
 * rides the row as last_edit_reason — the evidence trail). Outside the
 * fence, no permission and no reason are required (the working
 * schedule). The permission arrives as a boolean from the controller
 * (the guard-resolved session permission set — the data-dependent check
 * cannot live in the static route table).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const QTY_RE = /^\d+(\.\d{1,6})?$/;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

@Injectable()
export class MpsService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async list(filter: {
    warehouseId?: string;
    itemId?: string;
    from?: string;
    to?: string;
    limit: number;
  }): Promise<store.MpsEntryRow[]> {
    return store.listMpsEntries(filter);
  }

  /**
   * Upsert one slot: (warehouse, item, bucket_start) — an existing row's
   * qty/status updates (the reason rides the row when inside the fence),
   * a new one inserts. Qty 0 on an existing row keeps the row (the
   * explicit zero — the audit trail's shape; mps_entries has no DELETE
   * grant by design).
   */
  async upsert(input: {
    warehouseId: string;
    itemId: string;
    bucketStart: string;
    qty: string;
    uomId: string;
    status?: "PLANNED" | "FIRMED";
    reason?: string | null;
    note?: string | null;
    noteAr?: string | null;
    /** The guard-resolved manufacturing.mps.frozen_edit grant. */
    frozenEditPermission: boolean;
    actorId: string | null;
  }): Promise<store.MpsEntryRow> {
    if (!DATE_RE.test(input.bucketStart) || Number.isNaN(Date.parse(`${input.bucketStart}T00:00:00Z`))) {
      throw new MpsEntryInvalidError(`bucketStart must be an ISO date (YYYY-MM-DD): ${input.bucketStart}`);
    }
    if (!QTY_RE.test(input.qty) || new Decimal(input.qty).lessThan(0)) {
      throw new MpsEntryInvalidError(`qty must be a non-negative decimal (≤ 6dp): ${input.qty}`);
    }
    if (input.reason !== undefined && input.reason !== null && (input.reason.trim().length < 1 || input.reason.trim().length > 300)) {
      throw new MpsEntryInvalidError("reason must be 1..300 characters when provided");
    }
    const status = input.status ?? "PLANNED";
    const item = await store.findItemPlanning(input.itemId);
    if (item === undefined) {
      throw new MpsEntryInvalidError(`item ${input.itemId} does not exist in this tenant`);
    }

    // BR-078: the frozen-fence gate. The fence is measured from TODAY
    // (the planning present), the item's own frozen_fence_days window.
    const existing = await store.findMpsEntryBySlot({
      warehouseId: input.warehouseId,
      itemId: input.itemId,
      bucketStart: input.bucketStart,
    });
    const fenceEnd = addDaysIso(today(), item.frozenFenceDays);
    const insideFence = input.bucketStart <= fenceEnd;
    if (insideFence) {
      const isEdit = existing !== undefined;
      const firming = status === "FIRMED" || existing?.status === "FIRMED";
      // Every write touching an in-fence bucket needs the permission; a
      // FIRMED row (or firming) needs it even more — one rule, no gaps.
      if (!input.frozenEditPermission) {
        throw new MpsFrozenFenceEditError(input.itemId, input.bucketStart, item.frozenFenceDays);
      }
      const reason = (input.reason ?? "").trim();
      if (reason === "" && (isEdit || firming)) {
        throw new MpsFrozenReasonRequiredError();
      }
    }

    const qty = new Decimal(input.qty).toFixed(6);
    const created = await store.upsertMpsEntry({
      warehouseId: input.warehouseId,
      itemId: input.itemId,
      bucketStart: input.bucketStart,
      qty,
      uomId: input.uomId,
      status,
      lastEditReason: insideFence ? (input.reason ?? null) : ((input.reason ?? null) ?? existing?.lastEditReason ?? null),
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "manufacturing.mps.upserted",
      entityType: "mps_entry",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        warehouseId: input.warehouseId,
        itemId: input.itemId,
        bucketStart: input.bucketStart,
        qty,
        status,
        insideFence,
        reason: input.reason ?? null,
      },
    });
    return created;
  }

  async find(id: string): Promise<store.MpsEntryRow> {
    const entry = await store.findMpsEntryById(id);
    if (entry === undefined) throw new MpsEntryNotFoundError(id);
    return entry;
  }

  /** The data-readiness panel read: items WITHOUT a policy at the
   * warehouse (the run screen's warning list — garbage-in prevention). */
  async readiness(warehouseId: string): Promise<{
    itemsWithoutLeadTime: string[];
    scopeSize: number;
  }> {
    const scope = await store.deriveScopeItems(warehouseId);
    const itemsWithoutLeadTime: string[] = [];
    for (const itemId of scope) {
      const item = await store.findItemPlanning(itemId);
      if (item !== undefined && item.leadTimeDays === null) itemsWithoutLeadTime.push(itemId);
    }
    return { itemsWithoutLeadTime, scopeSize: scope.length };
  }
}
