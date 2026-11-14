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
 * THE UNIFIED BASIS (the 043-audit round-2 item-2 fix): the
 * verify-then-reserve check draws on the SAME pool EVERY reservation
 * path and EVERY availability surface uses — pickable bins (AVAILABLE,
 * tenant-owned, the batch ACTIVE and not expired) + the UNBINNED
 * fallback (item_stock − every bin row) − the ACTIVE non-expired
 * reserved pool (`reservationAvailability` — one truth with
 * ReservationService.create's choke point, the ATP basis (BR-080), and
 * the MRP engine's qualified on-hand; pre-fix this walk counted RAW bin
 * rows only, so an unbinned balance was invisible HERE while the choke
 * point accepted it — the same stock, different answers — and a
 * quarantine-held or lapsed batch was reservable while ATP refused to
 * promise it). The allocation plan the strategy walk produces still
 * rides the response (WHICH bins/batches the BIN-LEVEL portion draws
 * from — informational: when the unbinned fallback covers part of the
 * target, the plan shows the bin portion and the note names the
 * split); the physical pick itself stays the WMS wave allocator's
 * business.
 *
 * THE HARD-PROTECTION CONTRACT (the 043-completion round — the owner's
 * directive after accepting the round-4 race fix; it SUPERSEDES the
 * round-2 soft-model declaration): a reservation is now BOTH an
 * availability-level hold AND a physical protection — it nets ATP, the
 * MRP basis, and every later reservation's capacity as before, AND the
 * movement core's issue choke point (planIssue) refuses any issue that
 * would take the position below the ACTIVE reserved pool unless the
 * caller is the pool's beneficiary (the delivery post's per-line
 * allowance — the line's own reservation + its ACTIVE MTO chain) or the
 * reservation was first RELEASED through the permission-gated, audited
 * route (the explicit authorized action; there is no bypass parameter
 * on any issue path). The over-commit exposure the round-2 audit proved
 * (another order shipping the reserved stock) is CLOSED: the pinned
 * proof moved from reservation-basis.spec (c)'s soft-model shape to the
 * hard-protection shape (the thief's delivery rejects with
 * RESERVED_STOCK_PROTECTED), and reservation-hard-protection.spec pins
 * the full contract — prevention, the beneficiary's consumption
 * (partial/surplus/cancel/close/rollback), the concurrent races, and
 * the audited unlock.
 *
 * The MTO completion (G-49) is the unconditional consumer: the finished
 * goods of a linked sales line are reserved for it the moment they land
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
   * typed ReservationPolicyError when the UNIFIED basis (pickable bins
   * + the unbinned fallback − the ACTIVE reserved pool —
   * `reservationAvailability`, the same truth the creation choke point
   * enforces under the item_stock row lock) cannot cover the target
   * (never a partial reservation — an all-or-nothing policy).
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

    // THE UNIFIED BASIS (the 043-audit round-2 item-2 fix): the same
    // `reservationAvailability` the creation choke point enforces —
    // pickable bins (batch ACTIVE, not expired) + the unbinned fallback
    // − the ACTIVE reserved pool. Pre-fix this walk summed RAW bin rows
    // (the item's whole bin_contents presence): an unbinned balance was
    // invisible, and a quarantined/lapsed batch counted — different
    // answers than ReservationService.create, ATP, and the engine on the
    // SAME stock. The item_stock row lock at the choke point still
    // serializes concurrent reserves; this early check gives the honest
    // strategy-ordered message.
    const availability = await invStore.reservationAvailability(input.itemId, input.warehouseId);
    if (
      availability === undefined ||
      new Decimal(availability.available).lessThan(qty)
    ) {
      throw new ReservationPolicyError(
        `the ${method} policy cannot cover ${qty.toFixed(6)} of item ${input.itemId} at warehouse ${input.warehouseId} — pickable ${availability?.pickableBins ?? "0"} (AVAILABLE, tenant-owned, batch ACTIVE and not expired) + unbinned ${availability?.unbinned ?? "0"} − reserved ${availability?.reserved ?? "0"} = available ${availability?.available ?? "0"}`,
        { itemId: input.itemId, warehouseId: input.warehouseId, requested: qty.toFixed(6), available: availability?.available ?? "0.000000", method },
      );
    }

    // The allocation plan: the strategy-ordered pickable walk, filled
    // greedily — the BIN-LEVEL portion of the coverage (informational:
    // when the unbinned fallback covers part of the target, the plan
    // shows the bin portion; the note names the split).
    const rows = await wmsStore.listPickableRows({
      warehouseId: input.warehouseId,
      itemId: input.itemId,
      method,
    });
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
    const unbinnedCovered = remaining; // what the fallback carried (never negative here)

    const created = await this.reservations.create({
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      qty: qty.toFixed(6),
      holderType: input.holderType,
      holderId: input.holderId,
      expiresAt: input.expiresAt ?? null,
      note:
        input.note ??
        `${method} allocation plan: ${plan.map((s) => `${s.binCode ?? s.binId}:${s.qty}`).join(", ")}${
          unbinnedCovered.greaterThan(0) ? ` + unbinned:${unbinnedCovered.toFixed(6)}` : ""
        }`.slice(0, 300),
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
