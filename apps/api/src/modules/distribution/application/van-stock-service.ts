import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { TransferService } from "../../inventory/application/transfer-service";
import * as store from "../infrastructure/distribution.store";
import {
  LoadOutError,
  VanCodeDuplicateError,
  VanNotFoundError,
  VanRepBindingError,
} from "../domain/distribution-errors";

/**
 * Van stock service (PHASE-017 T8; §2 item 5; CAPABILITY_MATRIX §2.4
 * `van_stock`): a van is a warehouse of type VAN bound to a rep; load-out
 * and unload are ORDINARY two-leg stock transfers (DRAFT → IN_TRANSIT →
 * POSTED) wrapping inventory's TransferService — distribution owns none of
 * the stock_moves/journal logic, only the van semantics around it:
 *
 * - in-transit stock is visible but never sellable (BR-016 — the OUT leg
 *   already left the source and the IN leg has not landed);
 * - the transfer posts a journal ONLY when the two warehouses resolve
 *   distinct GL inventory accounts (G-15); the shared-account default posts
 *   nothing and this service never adds a journal of its own;
 * - `van_stocks` is a read-model mirror of stock_moves scoped to VAN
 *   warehouses, refreshed inside the owning transaction (listVanStock and
 *   balances refresh before reading; receiveTransfer refreshes the
 *   destination van so the board reflects the landed stock immediately).
 */

@Injectable()
export class VanStockService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly transferService: TransferService,
  ) {}

  /** Register a van: a VAN-type warehouse + the rep binding (one van per
   * rep — the typed rejection mirrors uq_warehouses_tenant_rep). */
  async registerVan(input: {
    code: string;
    name: string;
    nameAr?: string | null;
    branchId: string;
    salesRepId: string;
    actorId: string | null;
  }) {
    const rep = await store.findSalesRepRef(input.salesRepId);
    if (rep === undefined) {
      throw new VanRepBindingError(`sales rep ${input.salesRepId} does not exist in this tenant`);
    }
    if (rep.status !== "ACTIVE") {
      throw new VanRepBindingError(`sales rep ${rep.code} is ${rep.status} — a van needs an ACTIVE rep`);
    }
    const boundVan = await store.findVanByRepId(input.salesRepId);
    if (boundVan !== undefined) {
      throw new VanRepBindingError(
        `rep ${rep.code} is already bound to van ${boundVan.code} — one van per rep`,
        { repId: input.salesRepId, vanWarehouseId: boundVan.id },
      );
    }
    const codeOwner = await store.findWarehouseCodeRef(input.code);
    if (codeOwner !== undefined) throw new VanCodeDuplicateError(input.code);
    const van = await store.insertVanWarehouse({
      code: input.code,
      name: input.name,
      nameAr: input.nameAr ?? null,
      branchId: input.branchId,
      repId: input.salesRepId,
      note: null,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "distribution.van_registered",
      entityType: "van",
      entityId: van.id,
      actorId: input.actorId ?? undefined,
      after: { code: van.code, name: van.name, branchId: van.branchId, salesRepId: input.salesRepId },
    });
    return van;
  }

  async listVans() {
    return store.listVans({ limit: 200 });
  }

  /** The van must exist, be VAN-type, and be active — the shared gate for
   * every van stock movement. */
  private async requireActiveVan(warehouseId: string) {
    const van = await store.findVanByWarehouseId(warehouseId);
    if (van === undefined || van.type !== "VAN") throw new VanNotFoundError(warehouseId);
    if (!van.isActive) {
      throw new LoadOutError(`van ${van.code} is INACTIVE — activate it before moving stock`, {
        vanWarehouseId: warehouseId,
      });
    }
    return van;
  }

  /** Mirror-first read: refresh (the given van, or every VAN warehouse),
   * then list — the board always ties to stock_moves. */
  async listVanStock(filter: { warehouseId?: string; itemId?: string; limit?: number } = {}) {
    if (filter.warehouseId !== undefined) {
      const van = await store.findVanByWarehouseId(filter.warehouseId);
      if (van === undefined || van.type !== "VAN") throw new VanNotFoundError(filter.warehouseId);
      await store.refreshVanStockMirror([filter.warehouseId]);
    } else {
      await store.refreshVanStockMirror();
    }
    return store.listVanStock({
      warehouseId: filter.warehouseId,
      itemId: filter.itemId,
      limit: filter.limit ?? 500,
    });
  }

  /**
   * Load a van from a (main) warehouse: create + dispatch an ordinary
   * transfer → the load is IN_TRANSIT (the van mirror stays 0 until the
   * transfer is received — in-transit is never sellable, BR-016). No
   * journal of its own: TransferService owns the G-15 branch-distinct
   * logic (shared account ⇒ no journal at all).
   */
  async loadOut(input: {
    fromWarehouseId: string;
    vanWarehouseId: string;
    lines: { itemId: string; qty: string }[];
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }) {
    await this.requireActiveVan(input.vanWarehouseId);
    if (input.fromWarehouseId === input.vanWarehouseId) {
      throw new LoadOutError("load-out source and van are the same warehouse", {
        warehouseId: input.fromWarehouseId,
      });
    }
    if (input.lines.length === 0) {
      throw new LoadOutError("load-out needs at least one line");
    }
    const transfer = await this.transferService.create({
      fromWarehouseId: input.fromWarehouseId,
      toWarehouseId: input.vanWarehouseId,
      lines: input.lines,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: input.actorId,
    });
    const dispatched = await this.transferService.dispatch(transfer.id, input.actorId);
    await this.audit.record({
      action: "distribution.van_loadout",
      entityType: "van",
      entityId: input.vanWarehouseId,
      actorId: input.actorId ?? undefined,
      after: {
        transferId: dispatched.id,
        transferNo: dispatched.transferNo,
        fromWarehouseId: input.fromWarehouseId,
        lines: input.lines.length,
        status: dispatched.status,
      },
    });
    return dispatched;
  }

  /** Receive a transfer into its van: the ordinary receive leg, then the
   * destination van's mirror is refreshed so the board reflects the load. */
  async receiveTransfer(transferId: string, input: { actorId: string | null }) {
    const transfer = await this.transferService.find(transferId);
    const van = await store.findVanByWarehouseId(transfer.toWarehouseId);
    if (van === undefined || van.type !== "VAN") {
      throw new LoadOutError(`transfer ${transferId} does not deliver to a van warehouse`, {
        toWarehouseId: transfer.toWarehouseId,
      });
    }
    const received = await this.transferService.receive(transferId, input.actorId);
    await store.refreshVanStockMirror([transfer.toWarehouseId]);
    await this.audit.record({
      action: "distribution.van_transfer_received",
      entityType: "van",
      entityId: transfer.toWarehouseId,
      actorId: input.actorId ?? undefined,
      after: { transferId: received.id, transferNo: received.transferNo, status: received.status },
    });
    return received;
  }

  /** Unload a van back to a (main) warehouse: the reverse-direction
   * transfer, dispatched immediately — returns are ordinary receives. */
  async unload(input: {
    vanWarehouseId: string;
    toWarehouseId: string;
    lines: { itemId: string; qty: string }[];
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }) {
    await this.requireActiveVan(input.vanWarehouseId);
    if (input.vanWarehouseId === input.toWarehouseId) {
      throw new LoadOutError("unload destination and van are the same warehouse", {
        warehouseId: input.toWarehouseId,
      });
    }
    if (input.lines.length === 0) {
      throw new LoadOutError("unload needs at least one line");
    }
    const transfer = await this.transferService.create({
      fromWarehouseId: input.vanWarehouseId,
      toWarehouseId: input.toWarehouseId,
      lines: input.lines,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: input.actorId,
    });
    const dispatched = await this.transferService.dispatch(transfer.id, input.actorId);
    await this.audit.record({
      action: "distribution.van_unload",
      entityType: "van",
      entityId: input.vanWarehouseId,
      actorId: input.actorId ?? undefined,
      after: {
        transferId: dispatched.id,
        transferNo: dispatched.transferNo,
        toWarehouseId: input.toWarehouseId,
        lines: input.lines.length,
        status: dispatched.status,
      },
    });
    return dispatched;
  }

  /** Per-van totals off the mirror (the balances screen / the settlement
   * tie-in), refreshed first so they always tie to stock_moves. */
  async balances(filter: { warehouseId?: string } = {}) {
    if (filter.warehouseId !== undefined) {
      const van = await store.findVanByWarehouseId(filter.warehouseId);
      if (van === undefined || van.type !== "VAN") throw new VanNotFoundError(filter.warehouseId);
      await store.refreshVanStockMirror([filter.warehouseId]);
    } else {
      await store.refreshVanStockMirror();
    }
    return store.vanStockTotals({ warehouseId: filter.warehouseId });
  }
}
