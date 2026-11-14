import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { ReservationService } from "../../inventory/application/reservation-service";
import * as wmsStore from "../../inventory/infrastructure/wms-store";
import * as invStore from "../../inventory/infrastructure/inventory.store";
import { ReservationPolicyError } from "../domain/manufacturing-errors";

/**
 * Reservation policy engine (PHASE-043 T-12; I-14): the missing policy
 * layer over the existing stock_reservations — automatic reservation of
 * sales and production order lines against BIN-LEVEL stock using the
 * PHASE-044 strategies (FIFO/FEFO/NEAREST per warehouse, the
 * pick_strategies row; FIFO the fail-safe default).
 *
 * The engine VERIFIES then RESERVES: the strategy-ordered pickable rows
 * (AVAILABLE, tenant-owned — the same exclusion set the WMS allocator
 * and the MRP qualified on-hand use) must cover the target before the
 * item+warehouse-level stock_reservations row is created (the table has
 * no batch column by design — the allocation plan the strategy walk
 * produces rides the response so the caller and the UI can show WHICH
 * bins/batches the reservation draws from; the physical pick itself
 * stays the WMS wave allocator's business).
 *
 * The MTO completion (G-49) is the unconditional consumer: the finished
 * goods of a linked sales line are hard-reserved the moment they land
 * (holder PRODUCTION_ORDER, holderId = the MO id) — the reservation
 * chain the golden pins.
 */

export interface AllocationSlice {
  binId: string;
  binCode: string | null;
  batchId: string | null;
  expiryDate: string | null;
  qty: string;
}

export interface PolicyReservationResult {
  reservationId: string;
  strategy: "FIFO" | "FEFO" | "NEAREST";
  allocationPlan: readonly AllocationSlice[];
}

@Injectable()
export class ReservationPolicyService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ReservationService) private readonly reservations: ReservationService,
  ) {}

  /**
   * Verify + create one reservation for a holder. Fails closed with the
   * typed ReservationPolicyError when the strategy-ordered pickable rows
   * cannot cover the target (never a partial reservation — an
   * all-or-nothing policy).
   */
  async reserveForHolder(input: {
    itemId: string;
    warehouseId: string;
    qty: string;
    holderType: "MANUAL" | "SALES_ORDER" | "PRODUCTION_ORDER";
    holderId: string | null;
    expiresAt?: string | null;
    note?: string | null;
    actorId: string | null;
  }): Promise<PolicyReservationResult> {
    const qty = new Decimal(input.qty);
    if (qty.lessThanOrEqualTo(0)) {
      throw new ReservationPolicyError("the reservation target must be a positive decimal", {
        itemId: input.itemId,
        qty: input.qty,
      });
    }
    const strategyRow = await wmsStore.findPickStrategy(input.warehouseId);
    const method = strategyRow?.method ?? "FIFO";

    // The strategy-ordered availability walk (PHASE-044's own query —
    // AVAILABLE, tenant-owned, qty > 0) + the reserved-pool subtraction
    // (the 043-audit item-5 fix: the raw walk ignored the ACTIVE
    // reservations already drawn against the same stock — the early
    // message now names the honest pool; the creation choke point in
    // ReservationService.create enforces the same invariant under the
    // item_stock row lock either way).
    const rows = await wmsStore.listPickableRows({
      warehouseId: input.warehouseId,
      itemId: input.itemId,
      method,
    });
    const reserved = new Decimal(
      (await invStore.reservedQty(input.itemId, input.warehouseId)) ?? "0",
    );
    const available = rows
      .reduce((sum, row) => sum.plus(new Decimal(row.qty)), new Decimal(0))
      .minus(reserved);
    if (available.lessThan(qty)) {
      throw new ReservationPolicyError(
        `the ${method} walk cannot cover ${qty.toFixed(6)} of item ${input.itemId} at warehouse ${input.warehouseId} — pickable ${rows.reduce((sum, row) => sum.plus(new Decimal(row.qty)), new Decimal(0)).toFixed(6)} (AVAILABLE, tenant-owned rows only) − reserved ${reserved.toFixed(6)} = available ${available.toFixed(6)}`,
        { itemId: input.itemId, warehouseId: input.warehouseId, requested: qty.toFixed(6), available: available.toFixed(6), method },
      );
    }

    // The allocation plan: the strategy order, filled greedily.
    const plan: AllocationSlice[] = [];
    let remaining = qty;
    for (const row of rows) {
      if (remaining.lessThanOrEqualTo(0)) break;
      const take = Decimal.min(remaining, new Decimal(row.qty));
      plan.push({
        binId: row.binId,
        binCode: row.binCode,
        batchId: row.batchId,
        expiryDate: row.expiryDate,
        qty: take.toFixed(6),
      });
      remaining = remaining.minus(take);
    }

    const created = await this.reservations.create({
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      qty: qty.toFixed(6),
      holderType: input.holderType,
      holderId: input.holderId,
      expiresAt: input.expiresAt ?? null,
      note: input.note ?? `${method} allocation plan: ${plan.map((s) => `${s.binCode ?? s.binId}:${s.qty}`).join(", ")}`.slice(0, 300),
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "manufacturing.reservation_policy.reserved",
      entityType: "stock_reservation",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        method,
        holderType: input.holderType,
        holderId: input.holderId,
        qty: qty.toFixed(6),
        slices: plan.length,
      },
    });
    return { reservationId: created.id, strategy: method, allocationPlan: plan };
  }
}
