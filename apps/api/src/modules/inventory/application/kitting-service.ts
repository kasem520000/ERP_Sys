import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import { NumberingService } from "../../accounting/application/numbering-service";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/inventory.store";
import * as wmsStore from "../infrastructure/wms-store";
import * as kit from "../infrastructure/kitting.store";
import {
  applyIssue,
  applyReceipt,
  inventoryJournalLines,
  planIssue,
  planReceipt,
  resolveInventoryAccount,
} from "./movement-core";
import {
  BinNotFoundError,
  CrossDockBinNotDockError,
  CrossDockQtyExceededError,
  InvalidQuantityError,
  ItemNotFoundError,
  WarehouseKitNotFoundError,
  WarehouseKitStateError,
} from "../domain/inventory-errors";

/**
 * Warehouse kitting + cross-docking (PHASE-044 T-10; §2.10/§2.11,
 * I-12/I-13): the two dock-side light flows.
 *
 * KITTING — light kit assembly from bins WITHOUT a production order: the
 * order's lines are the kit BOM SNAPSHOT (the caller names the components;
 * the production-order freeze discipline, minus the MO), the components
 * issue from their bins (reason KIT_CONSUMPTION) and the kit receipts at
 * Σ component costs EXACTLY (G-45's roll-up — same-account by
 * construction: every leg hits the warehouse's INVENTORY account, so NO
 * journal posts — the G-15 policy-none mirror, the documented D-4). The
 * kit lands at the warehouse DEFAULT bin (a putaway task can move it on).
 *
 * CROSS-DOCKING — the dock-side receive-and-ship bypass (I-12): a receipt
 * that lands DIRECTLY into a DOCK-zone bin (the putaway bypass), linked
 * to its outbound document (the move's source), with the in-transit
 * exactness check — the cumulative docked qty per (item, link) may NEVER
 * exceed the linked outbound's demand (the surplus must go through
 * putaway). The docked stock is ordinary AVAILABLE stock: the wave engine
 * picks it like any other face.
 */
@Injectable()
export class KittingService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly numbering: NumberingService,
  ) {}

  // -- kit orders (§2.11) --------------------------------------------------------------

  async listKitOrders(filter: { warehouseId?: string; status?: string; limit?: number }) {
    return kit.listKitOrders({
      warehouseId: filter.warehouseId,
      status: filter.status,
      limit: filter.limit ?? 100,
    });
  }

  async findKitOrder(id: string) {
    const order = await kit.findKitOrderById(id);
    if (order === undefined) throw new WarehouseKitNotFoundError(id);
    return order;
  }

  async kitLines(id: string) {
    await this.findKitOrder(id);
    return kit.listKitLines(id);
  }

  /** Create a DRAFT kit order: the lines are the kit BOM snapshot. */
  async createKitOrder(input: {
    warehouseId: string;
    kitItemId: string;
    qty: string;
    lines: { componentItemId: string; qty: string; fromBinId: string | null }[];
    note: string | null;
    actorId: string | null;
  }) {
    const kitItem = await store.findItemForInventory(input.kitItemId);
    if (kitItem === undefined) throw new ItemNotFoundError(input.kitItemId);
    if (!/^\d+(\.\d{1,6})?$/.test(input.qty) || Number(input.qty) <= 0) {
      throw new InvalidQuantityError("kit qty must be a positive decimal");
    }
    if (input.lines.length === 0) {
      throw new WarehouseKitStateError("a kit order needs at least one component line");
    }
    for (const line of input.lines) {
      const component = await store.findItemForInventory(line.componentItemId);
      if (component === undefined) throw new ItemNotFoundError(line.componentItemId);
      if (!/^\d+(\.\d{1,6})?$/.test(line.qty) || Number(line.qty) <= 0) {
        throw new InvalidQuantityError("component qty must be a positive decimal");
      }
      if (line.componentItemId === input.kitItemId) {
        throw new WarehouseKitStateError("a kit cannot consume itself");
      }
      if (line.fromBinId !== null) {
        const bin = await wmsStore.findBinById(line.fromBinId);
        if (bin === undefined) throw new BinNotFoundError(line.fromBinId);
        if (bin.warehouseId !== input.warehouseId) {
          throw new WarehouseKitStateError(
            `component bin ${line.fromBinId} belongs to another warehouse`,
          );
        }
      }
    }
    const id = await kit.insertKitOrder({
      warehouseId: input.warehouseId,
      kitItemId: input.kitItemId,
      qty: input.qty,
      note: input.note,
      createdBy: input.actorId,
    });
    let lineNo = 0;
    for (const line of input.lines) {
      await kit.insertKitLine({
        orderId: id,
        lineNo: ++lineNo,
        componentItemId: line.componentItemId,
        qty: line.qty,
        fromBinId: line.fromBinId,
        createdBy: input.actorId,
      });
    }
    await this.audit.record({
      action: "inventory.warehouse_kit_created",
      entityType: "warehouse_kit_order",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: {
        warehouseId: input.warehouseId,
        kitItemId: input.kitItemId,
        qty: input.qty,
        lines: input.lines.length,
      },
    });
    return this.findKitOrder(id);
  }

  /**
   * Post the kit (G-45): components issue (reason KIT_CONSUMPTION), the
   * kit receipts at Σ component costs EXACTLY — NO journal (same-account
   * by construction, the D-4 law). INV-029 holds: every leg rides the
   * movement core, so bin_contents move in the same transactions as
   * item_stock.
   */
  async postKitOrder(input: { id: string; actorId: string | null }) {
    const order = await this.findKitOrder(input.id);
    if (order.status !== "DRAFT") {
      throw new WarehouseKitStateError(`kit order ${input.id} is ${order.status} — only DRAFT posts`);
    }
    const lines = await kit.listKitLines(input.id);
    if (lines.length === 0) {
      throw new WarehouseKitStateError("a kit order needs at least one component line");
    }

    const postingDate = new Date().toISOString().slice(0, 10);
    // PLAN every component issue (no writes).
    const issuePlans: { line: kit.WarehouseKitLineRow; plan: Awaited<ReturnType<typeof planIssue>> }[] = [];
    for (const line of lines) {
      let directedTakes: { contentId: string; qty: string }[] | undefined;
      if (line.fromBinId !== null) {
        // The directed allocation over the named bin's rows exactly.
        const rows = await wmsStore.listAllocatableBinContents({
          warehouseId: order.warehouseId,
          itemId: line.componentItemId,
          batchId: null,
          serialId: null,
        });
        const inBin = rows.filter((row) => row.binId === line.fromBinId);
        const available = inBin.reduce((sum, row) => sum + Number(row.qty), 0);
        if (available < Number(line.qty)) {
          throw new WarehouseKitStateError(
            `component bin ${line.fromBinId} holds ${available.toFixed(6)} — the line needs ${line.qty}`,
          );
        }
        directedTakes = [];
        let remaining = Number(line.qty);
        for (const row of inBin) {
          if (remaining <= 0) break;
          const take = Math.min(Number(row.qty), remaining);
          directedTakes.push({ contentId: row.id, qty: take.toFixed(6) });
          remaining -= take;
        }
      }
      const plan = await planIssue({
        itemId: line.componentItemId,
        warehouseId: order.warehouseId,
        qty: line.qty,
        movedAt: postingDate,
        moveKind: "issue",
        sourceType: "warehouse_kit",
        sourceId: input.id,
        reason: "KIT_CONSUMPTION",
        directedTakes,
        serialEvent: "KIT_OUT",
      });
      issuePlans.push({ line, plan });
    }

    const totalComponentCost = issuePlans
      .reduce((sum, row) => sum.plus(new Decimal(row.plan.valueAmount)), new Decimal(0))
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
      .toFixed(4);
    // The kit's unit cost = Σ components / kit qty (the G-45 roll-up).
    const kitUnitCost = new Decimal(totalComponentCost)
      .div(new Decimal(order.qty))
      .toDecimalPlaces(6, Decimal.ROUND_HALF_UP)
      .toFixed(6);

    // The kit receipt plan (same-account: NO journal — the D-4 law).
    const kitPlan = await planReceipt({
      itemId: order.kitItemId,
      warehouseId: order.warehouseId,
      qty: order.qty,
      unitCost: kitUnitCost,
      movedAt: postingDate,
      moveKind: "receipt",
      sourceType: "warehouse_kit",
      sourceId: input.id,
      reason: "KIT_ASSEMBLY",
      targetBinId: null, // the warehouse DEFAULT bin (a putaway task can move it on)
      serialEvent: "KIT_IN",
    });

    // APPLY: every leg (journal-less — G-45's same-account construction).
    for (const row of issuePlans) {
      await applyIssue(row.plan, null);
      await kit.setKitLineValues({
        orderId: input.id,
        lineNo: row.line.lineNo,
        unitCost: row.plan.valueAmount === "0.0000" ? "0.000000" : perUnit(row.plan.valueAmount, row.line.qty),
        valueAmount: row.plan.valueAmount,
      });
    }
    await applyReceipt(kitPlan, null);

    const acquired = await this.numbering.reserve({
      docType: "warehouse_kit",
      branchId: null,
      periodKey: postingDate.slice(0, 4),
      format: "WK-{YYYY}-{SEQ:6}",
      prefix: "WK",
      year: postingDate.slice(0, 4),
    });
    const flipped = await kit.markKitPosted({
      id: input.id,
      kitNo: acquired.number,
      totalComponentCost,
      postedBy: input.actorId,
    });
    if (!flipped) throw new WarehouseKitStateError(`kit order ${input.id} post raced`);
    await this.audit.record({
      action: "inventory.warehouse_kit_posted",
      entityType: "warehouse_kit_order",
      entityId: input.id,
      actorId: input.actorId ?? undefined,
      after: {
        kitNo: acquired.number,
        kitItemId: order.kitItemId,
        qty: order.qty,
        totalComponentCost,
        kitUnitCost,
      },
    });
    return {
      kitNo: acquired.number,
      totalComponentCost,
      kitUnitCost,
    };
  }

  async cancelKitOrder(id: string, actorId: string | null) {
    const order = await this.findKitOrder(id);
    if (order.status !== "DRAFT") {
      throw new WarehouseKitStateError(`only DRAFT kit orders cancel — ${id} is ${order.status}`);
    }
    const cancelled = await kit.cancelKitOrder(id);
    if (!cancelled) throw new WarehouseKitStateError(`kit order ${id} cancel raced`);
    await this.audit.record({
      action: "inventory.warehouse_kit_cancelled",
      entityType: "warehouse_kit_order",
      entityId: id,
      actorId: actorId ?? undefined,
    });
  }

  // -- cross-docking (§2.10, I-12) -------------------------------------------------------

  /**
   * The dock receipt: goods land DIRECTLY into a DOCK-zone bin (the
   * putaway bypass), the move's source links the outbound document, and
   * the in-transit exactness check guards the cumulative docked qty per
   * (item, link) against the linked outbound's demand. The docked stock
   * is ordinary AVAILABLE stock — the wave engine picks it like any
   * other face.
   */
  async crossDockReceipt(input: {
    warehouseId: string;
    dockBinId: string;
    itemId: string;
    qty: string;
    unitCost: string;
    /** The linked outbound document (the move's source — the I-12 link). */
    linkId: string;
    /** The linked outbound line's demand for this item (the exactness ceiling). */
    expectedQty: string;
    batchId: string | null;
    batchNo: string | null;
    batchExpiry: string | null;
    serialIds: string[] | null;
    valueDate: string;
    note: string | null;
    actorId: string | null;
  }) {
    // DOCK-zone only (the bypass is the dock face).
    const bin = await wmsStore.findBinById(input.dockBinId);
    if (bin === undefined) throw new BinNotFoundError(input.dockBinId);
    if (bin.zoneType !== "DOCK") {
      throw new CrossDockBinNotDockError(input.dockBinId, bin.zoneType ?? "UNZONED");
    }

    // The in-transit exactness check (I-12): Σ prior cross_dock receipts
    // for (item, link) + this qty ≤ the linked demand.
    const priorMoves = await store.listStockMoves({
      warehouseId: input.warehouseId,
      itemId: input.itemId,
      direction: "IN",
      sourceType: "cross_dock",
      sourceId: input.linkId,
      limit: 500,
    });
    const alreadyDocked = priorMoves.reduce((sum, move) => sum + Number(move.qty), 0);
    if (alreadyDocked + Number(input.qty) > Number(input.expectedQty)) {
      throw new CrossDockQtyExceededError({
        itemId: input.itemId,
        linkId: input.linkId,
        expected: input.expectedQty,
        alreadyDocked: alreadyDocked.toFixed(6),
        requested: input.qty,
      });
    }

    // The receipt through the movement core (targetBinId = the dock face).
    const plan = await planReceipt({
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      qty: input.qty,
      unitCost: input.unitCost,
      movedAt: input.valueDate,
      moveKind: "receipt",
      sourceType: "cross_dock",
      sourceId: input.linkId,
      reason: "CROSS_DOCK",
      batchId: input.batchId,
      batchNo: input.batchNo,
      batchExpiry: input.batchExpiry,
      serialIds: input.serialIds ?? [],
      memo: input.note,
      targetBinId: input.dockBinId,
    });

    // POST: the ordinary receipt economics (the cross-dock changes WHERE
    // stock lands, never THAT it lands — the G-07-family shape rides the
    // appreciation counter here; the PO-linked flow posts through the
    // goods-receipt service with its dock bin).
    const item = await store.findItemForInventory(input.itemId);
    const lines = inventoryJournalLines({
      inventoryAccountId: await resolveInventoryAccount(input.warehouseId),
      direction: "IN",
      value: plan.valueAmount,
      counterPurpose: "INVENTORY_APPRECIATION",
      memoEn: `Cross-dock receipt — ${item?.sku ?? input.itemId}`,
      memoAr: `استلام عبور مباشر — ${item?.sku ?? input.itemId}`,
    });
    const spec = {
      source: { docType: "stock_move", docId: plan.anchorId, operation: "post" },
      entryDate: input.valueDate,
      description: {
        en: `Cross-dock receipt — ${item?.sku ?? input.itemId}`,
        ar: `استلام عبور مباشر — ${item?.sku ?? input.itemId}`,
      },
      currency: await ownTenantBaseCurrency(),
      lines,
    };
    const result = await this.posting.post(spec, { postedBy: input.actorId });
    const moveId = await applyReceipt(plan, result.journalEntryId);

    await this.audit.record({
      action: "inventory.cross_dock_receipt",
      entityType: "stock_move",
      entityId: moveId,
      actorId: input.actorId ?? undefined,
      after: {
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        dockBinId: input.dockBinId,
        linkId: input.linkId,
        qty: input.qty,
        alreadyDocked: alreadyDocked.toFixed(6),
        expectedQty: input.expectedQty,
        journalEntryId: result.journalEntryId,
      },
    });
    return {
      moveId,
      journalEntryId: result.journalEntryId,
      entryNo: result.entryNo,
      dockBinId: input.dockBinId,
      cumulativeDocked: (alreadyDocked + Number(input.qty)).toFixed(6),
    };
  }
}

function perUnit(value: string, qty: string): string {
  return new Decimal(value).div(new Decimal(qty)).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
}
