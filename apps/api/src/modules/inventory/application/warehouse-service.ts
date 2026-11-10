import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import * as store from "../infrastructure/inventory.store";
import {
  InvalidQuantityError,
  WarehouseCodeExistsError,
  WarehouseNotDeactivatableError,
  WarehouseNotFoundError,
  WarehouseRoleInvalidError,
} from "../domain/inventory-errors";

/**
 * Warehouse service (PHASE-010 T2; §2.1/§2.2): tenant stock locations under
 * a PHASE-004 branch, with the optional GL inventory-account override that
 * realizes G-15's branch-distinct valuation accounts (NULL ⇒ the tenant's
 * active INVENTORY purpose). Deactivation blocks new documents; every
 * historical row (moves FK'd RESTRICT) is preserved. Per-item-per-
 * warehouse reorder/min defaults ride `item_warehouse_settings` (BR-019's
 * job substrate — the in-app alert surface lands PHASE-015).
 */
@Injectable()
export class WarehouseService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async list(filter: { activeOnly?: boolean; branchId?: string; limit: number }) {
    return store.listWarehouses(filter);
  }

  async find(id: string) {
    const warehouse = await store.findWarehouseById(id);
    if (warehouse === undefined) throw new WarehouseNotFoundError(id);
    return warehouse;
  }

  /** PHASE-018 (migration 0026): role must be RAW/WIP/FG or null — the
   * convention tag for the raw/WIP/FG store layout (no behavior). */
  private assertWarehouseRole(role: string | null | undefined): string | null {
    if (role === undefined || role === null) {
      return null;
    }
    if (role !== "RAW" && role !== "WIP" && role !== "FG") {
      throw new WarehouseRoleInvalidError(role);
    }
    return role;
  }

  async create(input: {
    branchId: string;
    code: string;
    name: string;
    nameAr: string | null;
    inventoryAccountId: string | null;
    note: string | null;
    /** PHASE-018 (migration 0026): RAW/WIP/FG convention tag (optional). */
    role?: string | null;
    actorId: string | null;
  }) {
    const existing = await store.findWarehouseByCode(input.code);
    if (existing !== undefined) throw new WarehouseCodeExistsError(input.code);
    const role = this.assertWarehouseRole(input.role);
    const created = await store.insertWarehouse({
      branchId: input.branchId,
      code: input.code,
      name: input.name,
      nameAr: input.nameAr,
      inventoryAccountId: input.inventoryAccountId,
      note: input.note,
      role,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "inventory.warehouse_created",
      entityType: "warehouse",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        code: created.code,
        name: created.name,
        branchId: created.branchId,
        inventoryAccountId: created.inventoryAccountId,
        role: created.role,
      },
    });
    return created;
  }

  async update(
    id: string,
    patch: {
      name?: string;
      nameAr?: string | null;
      inventoryAccountId?: string | null;
      note?: string | null;
      /** PHASE-018: RAW/WIP/FG or null (clears); undefined = untouched. */
      role?: string | null;
    },
    actorId: string | null,
  ) {
    await this.find(id);
    const patchWithRole =
      patch.role === undefined ? patch : { ...patch, role: this.assertWarehouseRole(patch.role) };
    await store.updateWarehouse(id, patchWithRole);
    await this.audit.record({
      action: "inventory.warehouse_updated",
      entityType: "warehouse",
      entityId: id,
      actorId: actorId ?? undefined,
      after: patchWithRole,
    });
    return store.findWarehouseById(id);
  }

  async deactivate(id: string, actorId: string | null) {
    const warehouse = await this.find(id);
    const inTransit = await store.listInTransit(id);
    if (inTransit.length > 0) {
      throw new WarehouseNotDeactivatableError(
        `warehouse ${warehouse.code} has ${inTransit.length} IN_TRANSIT transfer lines — receive or cancel them first`,
      );
    }
    await store.deactivateWarehouse(id, actorId);
    await this.audit.record({
      action: "inventory.warehouse_deactivated",
      entityType: "warehouse",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { code: warehouse.code },
    });
  }

  async reactivate(id: string, actorId: string | null) {
    await this.find(id);
    await store.reactivateWarehouse(id);
    await this.audit.record({
      action: "inventory.warehouse_reactivated",
      entityType: "warehouse",
      entityId: id,
      actorId: actorId ?? undefined,
    });
  }

  async upsertItemSetting(input: {
    itemId: string;
    warehouseId: string;
    reorderLevel: string;
    minQty: string;
    actorId: string | null;
  }) {
    await this.find(input.warehouseId);
    const QTY_RE = /^\d+(\.\d{1,6})?$/;
    if (!QTY_RE.test(input.reorderLevel) || !QTY_RE.test(input.minQty)) {
      throw new InvalidQuantityError(
        `reorderLevel/minQty must be non-negative decimals (≤ 6dp): ${input.reorderLevel}/${input.minQty}`,
      );
    }
    const setting = await store.upsertItemWarehouseSetting({
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      reorderLevel: new Decimal(input.reorderLevel).toFixed(6),
      minQty: new Decimal(input.minQty).toFixed(6),
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "inventory.item_warehouse_setting_upserted",
      entityType: "item_warehouse_setting",
      entityId: setting.id,
      actorId: input.actorId ?? undefined,
      after: {
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        reorderLevel: setting.reorderLevel,
        minQty: setting.minQty,
      },
    });
    return setting;
  }
}
