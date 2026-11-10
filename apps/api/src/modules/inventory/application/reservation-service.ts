import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";
import { generateUuidV7 } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { withTenant } from "../../../infra/db/tenant-context";
import { listActiveTenantIds } from "../../../infra/jobs/system-tenants";
import * as store from "../infrastructure/inventory.store";
import {
  ItemNotFoundError,
  ReservationNotFoundError,
  ReservationStateError,
  WarehouseNotFoundError,
} from "../domain/inventory-errors";
import { requirePositiveQty } from "./movement-core";

/**
 * Soft reservations (PHASE-010 T10; §2.13 → PHASE-015 T9
 * `inventory.reservations`): the reservation pool — holders reserve qty
 * against an item-warehouse with an optional expiry; the availability
 * service nets ACTIVE non-expired rows out of on-hand. The pool's
 * entitlement surface (feature-gated routes) + the scheduled expiry sweep
 * land here in PHASE-015; SALES_ORDER holders arrived with PHASE-012.
 */
@Injectable()
export class ReservationService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async list(filter: { itemId?: string; warehouseId?: string; status?: string; limit: number }) {
    return store.listReservations(filter);
  }

  async find(id: string) {
    const reservation = await store.findReservationById(id);
    if (reservation === undefined) throw new ReservationNotFoundError(id);
    return reservation;
  }

  async create(input: {
    itemId: string;
    warehouseId: string;
    qty: string;
    holderType: "MANUAL" | "SALES_ORDER";
    holderId: string | null;
    expiresAt: string | null;
    note: string | null;
    actorId: string | null;
  }) {
    requirePositiveQty(input.qty, "reservation qty");
    const item = await store.findItemForInventory(input.itemId);
    if (item === undefined) throw new ItemNotFoundError(input.itemId);
    const warehouse = await store.findWarehouseById(input.warehouseId);
    if (warehouse === undefined) throw new WarehouseNotFoundError(input.warehouseId);
    const id = generateUuidV7();
    await store.insertReservation({
      id,
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      qty: new Decimal(input.qty).toFixed(6),
      holderType: input.holderType,
      holderId: input.holderId,
      expiresAt: input.expiresAt,
      note: input.note,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "inventory.reservation_created",
      entityType: "stock_reservation",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: {
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        qty: input.qty,
        holderType: input.holderType,
        expiresAt: input.expiresAt,
      },
    });
    return this.find(id);
  }

  async release(id: string, actorId: string | null) {
    await this.find(id);
    const flipped = await store.releaseReservation({ id, releasedBy: actorId });
    if (!flipped) throw new ReservationStateError(`reservation ${id} is not ACTIVE`);
    await this.audit.record({
      action: "inventory.reservation_released",
      entityType: "stock_reservation",
      entityId: id,
      actorId: actorId ?? undefined,
    });
  }

  async consume(id: string, actorId: string | null) {
    await this.find(id);
    const flipped = await store.consumeReservation(id);
    if (!flipped) throw new ReservationStateError(`reservation ${id} is not ACTIVE`);
    await this.audit.record({
      action: "inventory.reservation_consumed",
      entityType: "stock_reservation",
      entityId: id,
      actorId: actorId ?? undefined,
    });
  }

  /**
   * Expiry sweep (§2.13): flip lapsed ACTIVE rows to RELEASED. Availability
   * ignores them either way (expires_at <= now()); the sweep keeps the
   * pool honest and the volume bounded. The scheduled job (and the nightly
   * reorder window) calls this before the reorder scan.
   */
  async sweepExpired(actorId: string | null) {
    const flippedIds = await store.sweepExpiredReservations();
    if (flippedIds.length > 0) {
      // entity_id is a NOT NULL uuid — anchor the sweep's audit on the
      // first flipped row (the after payload carries the full count).
      await this.audit.record({
        action: "inventory.reservations_swept",
        entityType: "stock_reservation",
        entityId: flippedIds[0]!,
        actorId: actorId ?? undefined,
        after: { released: flippedIds.length, reservationIds: flippedIds },
      });
    }
    return { released: flippedIds.length };
  }

  /**
   * The system expiry job (PHASE-015 T9 `inventory.reservations`; the
   * pg-boss schedule `inventory.reservations-sweep` enqueues here): sweep
   * every ACTIVE tenant's pool — past-due ACTIVE rows (MANUAL and
   * SALES_ORDER holders alike) flip to RELEASED; fresh, no-expiry,
   * CANCELLED-side (released/consumed) rows are untouched. Audited per
   * tenant as a system action (actorId null — no user drove the pass).
   */
  async expireReservations(): Promise<{ tenants: number; released: number }> {
    const tenantIds = await listActiveTenantIds();
    let released = 0;
    for (const tenantId of tenantIds) {
      // One UoW per tenant (ADR-0005): the sweep + its audit commit
      // atomically, and a failure in one tenant never blocks the rest.
      const swept = await withTenant(tenantId, () => this.sweepExpired(null));
      released += swept.released;
    }
    return { tenants: tenantIds.length, released };
  }
}
