import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { RequireLimit } from "../../../infra/auth/require-limit.decorator";
import { envelope } from "../../../infra/http/envelope";
import { WarehouseService } from "../application/warehouse-service";
import { StockService } from "../application/stock-service";
import { AdjustmentService } from "../application/adjustment-service";
import { TransferService } from "../application/transfer-service";
import { CountService } from "../application/count-service";
import { TrackingService } from "../application/tracking-service";
import { ReservationService } from "../application/reservation-service";
import { ReorderService } from "../application/reorder-service";
import { InventoryReconciliationService } from "../application/reconciliation-service";
import { MethodSwitchService } from "../application/method-switch-service";
import { OpeningStockService } from "../application/opening-stock-service";

/**
 * Inventory routes (PHASE-010 §4; matrix §3.5): every route is
 * permission-guarded (the exact seeded matrix keys), Idempotency-Key'd
 * by the global POST guard, and returns the success envelope. Foreign or
 * unknown ids are 404-shaped (A7 — no existence disclosure), risky keys
 * (method-switch, count/adjustment posting) are approval-separated by
 * permission + audited server-side.
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date");
const LIMIT = z.coerce.number().int().min(1).max(500).default(100);
const QTY = z.string().regex(/^\d+(\.\d{1,6})?$/, "positive decimal (≤ 6dp)");
const SIGNED_QTY = z.string().regex(/^-?\d+(\.\d{1,6})?$/, "signed decimal (≤ 6dp)");
const COST = z.string().regex(/^\d+(\.\d{1,6})?$/, "non-negative decimal (≤ 6dp)").nullable();
const UUID = z.string().uuid();
const DATETIME = z.string().datetime().nullable().optional();

const warehouseSchema = z.object({
  branchId: UUID,
  code: z.string().regex(/^[A-Za-z0-9_-]{1,20}$/),
  name: z.string().min(1).max(120),
  nameAr: z.string().min(1).max(160).nullable().optional(),
  inventoryAccountId: UUID.nullable().optional(),
  note: z.string().min(1).max(500).nullable().optional(),
});

const warehousePatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  nameAr: z.string().min(1).max(160).nullable().optional(),
  inventoryAccountId: UUID.nullable().optional(),
  note: z.string().min(1).max(500).nullable().optional(),
});

const itemSettingSchema = z.object({
  itemId: UUID,
  warehouseId: UUID,
  reorderLevel: z.string().regex(/^\d+(\.\d{1,6})?$/, "non-negative decimal"),
  minQty: z.string().regex(/^\d+(\.\d{1,6})?$/, "non-negative decimal"),
});

const manualReceiptSchema = z.object({
  itemId: UUID,
  warehouseId: UUID,
  qty: QTY,
  unitCost: COST,
  reason: z.enum(["CUSTOMER_RETURN", "COUNT_GAIN", "OTHER"]),
  counterAccountId: UUID.nullable().optional(),
  valueDate: DATE,
  serialId: UUID.nullable().optional(),
  serialIds: z.array(UUID).max(200).nullable().optional(),
  batchId: UUID.nullable().optional(),
  batchNo: z.string().min(1).max(60).nullable().optional(),
  batchExpiry: DATE.nullable().optional(),
  note: z.string().min(1).max(500).nullable().optional(),
  noteAr: z.string().min(1).max(500).nullable().optional(),
});

const manualIssueSchema = z.object({
  itemId: UUID,
  warehouseId: UUID,
  qty: QTY,
  reason: z.enum(["DAMAGE", "EXPIRED", "COUNT_LOSS", "OTHER"]),
  counterAccountId: UUID.nullable().optional(),
  valueDate: DATE,
  serialIds: z.array(UUID).max(200).optional(),
  batchId: UUID.nullable().optional(),
  note: z.string().min(1).max(500).nullable().optional(),
  noteAr: z.string().min(1).max(500).nullable().optional(),
});

const adjustmentSchema = z.object({
  warehouseId: UUID,
  itemId: UUID,
  reason: z.enum(["DAMAGE", "EXPIRED", "COUNT_LOSS", "COUNT_GAIN", "OTHER"]),
  deltaQty: SIGNED_QTY,
  unitCost: COST,
  counterAccountId: UUID.nullable().optional(),
  note: z.string().min(1).max(500).nullable().optional(),
  noteAr: z.string().min(1).max(500).nullable().optional(),
});

const transferSchema = z.object({
  fromWarehouseId: UUID,
  toWarehouseId: UUID,
  lines: z.array(z.object({ itemId: UUID, qty: QTY })).min(1).max(200),
  note: z.string().min(1).max(500).nullable().optional(),
  noteAr: z.string().min(1).max(500).nullable().optional(),
});

const countCreateSchema = z.object({
  warehouseId: UUID,
  blind: z.boolean().default(false),
  itemIds: z.array(UUID).min(1).max(500),
  note: z.string().min(1).max(500).nullable().optional(),
  noteAr: z.string().min(1).max(500).nullable().optional(),
});

const countEntrySchema = z.object({
  entries: z.array(z.object({ lineNo: z.coerce.number().int().min(1), countedQty: z.string().regex(/^\d+(\.\d{1,6})?$/) })).min(1).max(500),
});

const recountSchema = z.object({
  lineNo: z.coerce.number().int().min(1),
  countedQty: z.string().regex(/^\d+(\.\d{1,6})?$/),
  recountNote: z.string().min(1).max(300),
});

const batchSchema = z.object({
  itemId: UUID,
  batchNo: z.string().min(1).max(60),
  expiryDate: DATE.nullable().optional(),
  sourceRef: z.string().min(1).max(120).nullable().optional(),
});

const serialSchema = z.object({
  itemId: UUID,
  serialNo: z.string().min(1).max(80),
  imei: z.string().regex(/^[0-9]{15,17}$/).nullable().optional(),
});

const reservationSchema = z.object({
  itemId: UUID,
  warehouseId: UUID,
  qty: QTY,
  holderType: z.enum(["MANUAL", "SALES_ORDER"]).default("MANUAL"),
  holderId: UUID.nullable().optional(),
  expiresAt: DATETIME,
  note: z.string().min(1).max(300).nullable().optional(),
});

const methodSwitchSchema = z.object({
  targetMethod: z.enum(["WAC", "FIFO"]),
  switchDate: DATE,
});

@Controller("/api/v1/inventory")
export class InventoryController {
  constructor(
    @Inject(WarehouseService) private readonly warehouses: WarehouseService,
    @Inject(StockService) private readonly stock: StockService,
    @Inject(AdjustmentService) private readonly adjustments: AdjustmentService,
    @Inject(TransferService) private readonly transfers: TransferService,
    @Inject(CountService) private readonly counts: CountService,
    @Inject(TrackingService) private readonly tracking: TrackingService,
    @Inject(ReservationService) private readonly reservations: ReservationService,
    @Inject(ReorderService) private readonly reorder: ReorderService,
    @Inject(InventoryReconciliationService) private readonly reconciliation: InventoryReconciliationService,
    @Inject(MethodSwitchService) private readonly methodSwitcher: MethodSwitchService,
    @Inject(OpeningStockService) private readonly openingStock: OpeningStockService,
  ) {}

  // -- warehouses (§4; matrix inventory.warehouses.manage) -----------------------

  @Get("warehouses")
  @RequirePermissions("inventory.stock.view")
  async listWarehouses(
    @Query() query: { activeOnly?: string; branchId?: string; limit?: string },
  ) {
    requireIdentity(query as unknown as Request);
    const rows = await this.warehouses.list({
      activeOnly: query.activeOnly === "true",
      branchId: query.branchId,
      limit: LIMIT.parse(query.limit ?? undefined),
    });
    return envelope(rows);
  }

  @Post("warehouses")
  @RequirePermissions("inventory.warehouses.manage")
  @RequireLimit("warehouses")
  @HttpCode(HttpStatus.CREATED)
  async createWarehouse(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = warehouseSchema.parse(body);
    const row = await this.warehouses.create({
      branchId: input.branchId,
      code: input.code,
      name: input.name,
      nameAr: input.nameAr ?? null,
      inventoryAccountId: input.inventoryAccountId ?? null,
      note: input.note ?? null,
      actorId: identity.userId,
    });
    return envelope(row);
  }

  @Get("warehouses/:id")
  @RequirePermissions("inventory.stock.view")
  async findWarehouse(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    return envelope(await this.warehouses.find(id));
  }

  @Post("warehouses/:id/update")
  @RequirePermissions("inventory.warehouses.manage")
  async updateWarehouse(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const patch = warehousePatchSchema.parse(body);
    const row = await this.warehouses.update(id, patch, identity.userId);
    return envelope(row);
  }

  @Post("warehouses/:id/deactivate")
  @RequirePermissions("inventory.warehouses.manage")
  async deactivateWarehouse(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    await this.warehouses.deactivate(id, identity.userId);
    return envelope({ id, status: "INACTIVE" });
  }

  @Post("warehouses/:id/reactivate")
  @RequirePermissions("inventory.warehouses.manage")
  async reactivateWarehouse(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    await this.warehouses.reactivate(id, identity.userId);
    return envelope(await this.warehouses.find(id));
  }

  @Post("item-warehouse-settings")
  @RequirePermissions("inventory.warehouses.manage")
  async upsertItemSetting(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = itemSettingSchema.parse(body);
    const row = await this.warehouses.upsertItemSetting({
      ...input,
      actorId: identity.userId,
    });
    return envelope(row);
  }

  // -- stock queries (§4; matrix inventory.stock.view) ------------------------------

  @Get("stock")
  @RequirePermissions("inventory.stock.view")
  async stockOnHand(
    @Req() request: Request,
    @Query() query: { warehouseId?: string; itemId?: string; q?: string; limit?: string },
  ) {
    requireIdentity(request);
    const rows = await this.stock.onHand({
      warehouseId: query.warehouseId,
      itemId: query.itemId,
      q: query.q,
      limit: LIMIT.parse(query.limit ?? undefined),
    });
    return envelope(rows);
  }

  @Get("availability")
  @RequirePermissions("inventory.stock.view")
  async availability(
    @Req() request: Request,
    @Query() query: { itemId: string; warehouseId: string },
  ) {
    requireIdentity(request);
    const parsed = z.object({ itemId: UUID, warehouseId: UUID }).parse(query);
    return envelope(await this.stock.availability(parsed));
  }

  @Get("moves")
  @RequirePermissions("inventory.moves.view")
  async moves(
    @Req() request: Request,
    @Query()
      query: {
        warehouseId?: string;
        itemId?: string;
        direction?: string;
        moveKind?: string;
        fromDate?: string;
        toDate?: string;
        limit?: string;
      },
  ) {
    requireIdentity(request);
    const rows = await this.stock.moves({
      warehouseId: query.warehouseId,
      itemId: query.itemId,
      direction: query.direction,
      moveKind: query.moveKind,
      fromDate: query.fromDate,
      toDate: query.toDate,
      limit: LIMIT.parse(query.limit ?? undefined),
    });
    return envelope(rows);
  }

  // -- manual receipts / issues (§4; matrix inventory.receipts/issues.create) -------

  @Post("receipts")
  @RequirePermissions("inventory.receipts.create")
  @HttpCode(HttpStatus.CREATED)
  async manualReceipt(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = manualReceiptSchema.parse(body);
    const result = await this.stock.manualReceipt({
      ...input,
      serialIds: input.serialIds ?? undefined,
      counterAccountId: input.counterAccountId ?? null,
      actorId: identity.userId,
    });
    return envelope(result);
  }

  @Post("issues")
  @RequirePermissions("inventory.issues.create")
  @HttpCode(HttpStatus.CREATED)
  async manualIssue(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = manualIssueSchema.parse(body);
    const result = await this.stock.manualIssue({
      ...input,
      counterAccountId: input.counterAccountId ?? null,
      actorId: identity.userId,
    });
    return envelope(result);
  }

  // -- adjustments (§4; matrix inventory.adjustments.*/post; G-13/G-14) ---------------

  @Get("adjustments")
  @RequirePermissions("inventory.stock.view")
  async listAdjustments(
    @Req() request: Request,
    @Query() query: { status?: string; warehouseId?: string; limit?: string },
  ) {
    requireIdentity(request);
    const rows = await this.adjustments.list({
      status: query.status,
      warehouseId: query.warehouseId,
      limit: LIMIT.parse(query.limit ?? undefined),
    });
    return envelope(rows);
  }

  @Post("adjustments")
  @RequirePermissions("inventory.adjustments.create")
  @HttpCode(HttpStatus.CREATED)
  async createAdjustment(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = adjustmentSchema.parse(body);
    const row = await this.adjustments.create({
      warehouseId: input.warehouseId,
      itemId: input.itemId,
      reason: input.reason,
      deltaQty: input.deltaQty,
      unitCost: input.unitCost ?? null,
      counterAccountId: input.counterAccountId ?? null,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: identity.userId,
    });
    return envelope(row);
  }

  @Post("adjustments/:id/post")
  @RequirePermissions("inventory.adjustments.post")
  async postAdjustment(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    const result = await this.adjustments.post(id, identity.userId);
    return envelope(result);
  }

  @Post("adjustments/:id/cancel")
  @RequirePermissions("inventory.adjustments.create")
  async cancelAdjustment(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    await this.adjustments.cancel(id, identity.userId);
    return envelope({ id, status: "CANCELLED" });
  }

  // -- transfers (§4; matrix inventory.transfers.*; BR-016/G-15) ----------------------

  @Get("transfers")
  @RequirePermissions("inventory.transfers.view")
  async listTransfers(
    @Req() request: Request,
    @Query() query: { status?: string; warehouseId?: string; limit?: string },
  ) {
    requireIdentity(request);
    const rows = await this.transfers.list({
      status: query.status,
      warehouseId: query.warehouseId,
      limit: LIMIT.parse(query.limit ?? undefined),
    });
    return envelope(rows);
  }

  @Post("transfers")
  @RequirePermissions("inventory.transfers.create")
  @HttpCode(HttpStatus.CREATED)
  async createTransfer(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = transferSchema.parse(body);
    const row = await this.transfers.create({
      fromWarehouseId: input.fromWarehouseId,
      toWarehouseId: input.toWarehouseId,
      lines: input.lines,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: identity.userId,
    });
    return envelope(row);
  }

  @Get("transfers/:id")
  @RequirePermissions("inventory.transfers.view")
  async findTransfer(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    return envelope(await this.transfers.find(id));
  }

  @Get("transfers/:id/lines")
  @RequirePermissions("inventory.transfers.view")
  async transferLines(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    return envelope(await this.transfers.lines(id));
  }

  @Post("transfers/:id/dispatch")
  @RequirePermissions("inventory.transfers.create")
  async dispatchTransfer(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.transfers.dispatch(id, identity.userId));
  }

  @Post("transfers/:id/receive")
  @RequirePermissions("inventory.transfers.approve")
  async receiveTransfer(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.transfers.receive(id, identity.userId));
  }

  @Post("transfers/:id/cancel")
  @RequirePermissions("inventory.transfers.create")
  async cancelTransfer(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    await this.transfers.cancel(id, identity.userId);
    return envelope({ id, status: "CANCELLED" });
  }

  // -- counts (§4; matrix inventory.counts.*; BR-015/Journey D) -------------------------

  @Get("counts")
  @RequirePermissions("inventory.counts.view")
  async listCounts(
    @Req() request: Request,
    @Query() query: { status?: string; warehouseId?: string; limit?: string },
  ) {
    requireIdentity(request);
    const rows = await this.counts.list({
      status: query.status,
      warehouseId: query.warehouseId,
      limit: LIMIT.parse(query.limit ?? undefined),
    });
    return envelope(rows);
  }

  @Post("counts")
  @RequirePermissions("inventory.counts.create")
  @HttpCode(HttpStatus.CREATED)
  async createCount(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = countCreateSchema.parse(body);
    const row = await this.counts.create({
      warehouseId: input.warehouseId,
      blind: input.blind,
      itemIds: input.itemIds,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: identity.userId,
    });
    return envelope(row);
  }

  @Get("counts/:id")
  @RequirePermissions("inventory.counts.view")
  async findCount(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    return envelope(await this.counts.find(id));
  }

  @Get("counts/:id/lines")
  @RequirePermissions("inventory.counts.view")
  async countLines(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    return envelope(await this.counts.lines(id));
  }

  @Post("counts/:id/enter")
  @RequirePermissions("inventory.counts.create")
  async enterCount(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = countEntrySchema.parse(body);
    await this.counts.enterCounts({ countId: id, entries: input.entries, actorId: identity.userId });
    return envelope(await this.counts.find(id));
  }

  @Post("counts/:id/submit")
  @RequirePermissions("inventory.counts.create")
  async submitCount(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.counts.submit(id, identity.userId));
  }

  @Post("counts/:id/recount")
  @RequirePermissions("inventory.counts.create")
  async recountLine(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = recountSchema.parse(body);
    await this.counts.recountLine({ countId: id, ...input, actorId: identity.userId });
    return envelope(await this.counts.find(id));
  }

  @Post("counts/:id/approve")
  @RequirePermissions("inventory.counts.approve")
  async approveCount(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const parsed = z.object({ supervisor: z.boolean().default(false) }).parse(body ?? {});
    const result = await this.counts.approve({
      id,
      supervisor: parsed.supervisor,
      actorId: identity.userId,
    });
    return envelope(result);
  }

  @Post("counts/:id/cancel")
  @RequirePermissions("inventory.counts.create")
  async cancelCount(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    await this.counts.cancel(id, identity.userId);
    return envelope({ id, status: "CANCELLED" });
  }

  // -- batches / serials (§4; matrix inventory.tracking.manage) ---------------------------

  @Get("batches")
  @RequirePermissions("inventory.moves.view")
  async listBatches(
    @Req() request: Request,
    @Query() query: { itemId?: string; expiredOnly?: string; limit?: string },
  ) {
    requireIdentity(request);
    const rows = await this.tracking.listBatches({
      itemId: query.itemId,
      expiredOnly: query.expiredOnly === "true",
      limit: LIMIT.parse(query.limit ?? undefined),
    });
    return envelope(rows);
  }

  @Post("batches")
  @RequirePermissions("inventory.tracking.manage")
  @HttpCode(HttpStatus.CREATED)
  async registerBatch(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = batchSchema.parse(body);
    const row = await this.tracking.registerBatch({
      ...input,
      expiryDate: input.expiryDate ?? null,
      sourceRef: input.sourceRef ?? null,
      actorId: identity.userId,
    });
    return envelope(row);
  }

  @Post("batches/:id/write-off")
  @RequirePermissions("inventory.tracking.manage")
  async writeOffBatch(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const parsed = z.object({ warehouseId: UUID, valueDate: DATE }).parse(body);
    const result = await this.tracking.writeOffExpiredBatch({
      batchId: id,
      warehouseId: parsed.warehouseId,
      valueDate: parsed.valueDate,
      actorId: identity.userId,
    });
    return envelope(result);
  }

  @Get("serials")
  @RequirePermissions("inventory.moves.view")
  async listSerials(
    @Req() request: Request,
    @Query() query: { itemId?: string; status?: string; limit?: string },
  ) {
    requireIdentity(request);
    const rows = await this.tracking.listSerials({
      itemId: query.itemId,
      status: query.status,
      limit: LIMIT.parse(query.limit ?? undefined),
    });
    return envelope(rows);
  }

  @Post("serials")
  @RequirePermissions("inventory.tracking.manage")
  @HttpCode(HttpStatus.CREATED)
  async registerSerial(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = serialSchema.parse(body);
    const row = await this.tracking.registerSerial({
      ...input,
      imei: input.imei ?? null,
      actorId: identity.userId,
    });
    return envelope(row);
  }

  @Get("serials/:id/sale")
  @RequirePermissions("inventory.moves.view")
  async serialSale(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    return envelope(await this.tracking.serialSale(id));
  }

  // -- reservations (§2.13 → PHASE-015 T9 `inventory.reservations`) ------------------------

  @Get("reservations")
  @RequirePermissions("inventory.stock.view")
  @RequireFeature("inventory.reservations")
  async listReservations(
    @Req() request: Request,
    @Query() query: { itemId?: string; warehouseId?: string; status?: string; limit?: string },
  ) {
    requireIdentity(request);
    const rows = await this.reservations.list({
      itemId: query.itemId,
      warehouseId: query.warehouseId,
      status: query.status,
      limit: LIMIT.parse(query.limit ?? undefined),
    });
    return envelope(rows);
  }

  @Post("reservations")
  @RequirePermissions("inventory.stock.view")
  @RequireFeature("inventory.reservations")
  @HttpCode(HttpStatus.CREATED)
  async createReservation(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = reservationSchema.parse(body);
    const row = await this.reservations.create({
      ...input,
      holderId: input.holderId ?? null,
      expiresAt: input.expiresAt ?? null,
      note: input.note ?? null,
      actorId: identity.userId,
    });
    return envelope(row);
  }

  @Post("reservations/:id/release")
  @RequirePermissions("inventory.stock.view")
  @RequireFeature("inventory.reservations")
  async releaseReservation(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    await this.reservations.release(id, identity.userId);
    return envelope({ id, status: "RELEASED" });
  }

  @Post("reservations/:id/consume")
  @RequirePermissions("inventory.stock.view")
  @RequireFeature("inventory.reservations")
  async consumeReservation(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    await this.reservations.consume(id, identity.userId);
    return envelope({ id, status: "CONSUMED" });
  }

  @Post("reservations/sweep-expired")
  @RequirePermissions("inventory.stock.view")
  @RequireFeature("inventory.reservations")
  async sweepExpired(@Req() request: Request) {
    const identity = requireIdentity(request);
    return envelope(await this.reservations.sweepExpired(identity.userId));
  }

  // -- reorder + reconciliation jobs (§2.14/§2.16; BR-019/INV-010) ---------------------------

  /**
   * PHASE-015 T10 · the replenishment suggestions surface (BR-019 — the
   * in-app alert's action target): items at or below their reorder level
   * with a suggested reorder quantity. Suggestion only — never a PO.
   */
  @Get("reports/below-reorder")
  @RequirePermissions("inventory.stock.view")
  async belowReorderList() {
    return envelope(await this.reorder.belowReorderList());
  }

  @Post("reorder/run-scan")
  @RequirePermissions("inventory.stock.view")
  async runReorderScan(@Req() request: Request) {
    const identity = requireIdentity(request);
    return envelope(
      await this.reorder.runNightlyScan({ runMode: "ON_DEMAND", checkedBy: identity.userId }),
    );
  }

  @Post("reconciliation/stock-check")
  @RequirePermissions("inventory.stock.view")
  async runStockCheck(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const parsed = z.object({ asOf: DATE }).parse(body ?? {});
    return envelope(
      await this.reconciliation.runStockCheck({
        asOf: parsed.asOf,
        runMode: "ON_DEMAND",
        checkedBy: identity.userId,
      }),
    );
  }

  // -- method switch (§4; matrix inventory.items.method_switch — risky) ----------------------

  @Get("items/:id/method-switch/preview")
  @RequirePermissions("inventory.stock.view")
  async methodSwitchPreview(
    @Req() request: Request,
    @Param("id") id: string,
    @Query() query: { targetMethod: string },
  ) {
    requireIdentity(request);
    const target = z.enum(["WAC", "FIFO"]).parse(query.targetMethod);
    return envelope(await this.methodSwitcher.preview({ itemId: id, targetMethod: target }));
  }

  @Post("items/:id/method-switch")
  @RequirePermissions("inventory.items.method_switch")
  async methodSwitch(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = methodSwitchSchema.parse(body);
    return envelope(
      await this.methodSwitcher.switch({ itemId: id, ...input, actorId: identity.userId }),
    );
  }

  // -- opening stock (§2.8; G-16's stock leg — consumes the PHASE-006 drafts) -----------------

  @Get("opening-stock/drafts")
  @RequirePermissions("inventory.stock.view")
  async openingStockDrafts(@Req() request: Request) {
    requireIdentity(request);
    return envelope(await this.openingStock.listDrafts());
  }

  @Post("opening-stock/post")
  @RequirePermissions("inventory.adjustments.post")
  async postOpeningStock(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const parsed = z.object({ warehouseId: UUID }).parse(body);
    return envelope(
      await this.openingStock.post({ warehouseId: parsed.warehouseId, actorId: identity.userId }),
    );
  }
}
