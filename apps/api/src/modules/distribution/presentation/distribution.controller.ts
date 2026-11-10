import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { RouteService } from "../application/route-service";
import { VisitService } from "../application/visit-service";
import { VanStockService } from "../application/van-stock-service";
import { SettlementService } from "../application/settlement-service";
import { TierService } from "../application/tier-service";
import { FreeGoodsService } from "../application/free-goods-service";

/**
 * Distribution routes (PHASE-017 §4): every route is permission-guarded,
 * BR-039 feature-gated, Idempotency-Key'd by the global POST guard, and
 * returns the success envelope. Paths are the EXACT entries registered in
 * infra/auth/route-permissions.ts (T7 routes/visits + T8 vans/van-stock +
 * T10 rep settlements + T11 tiers/free-goods-rules).
 *
 * T11 partner-tier ASSIGNMENT does not live here: the registered surface
 * has no tiers/:id/partners route, so the assignment rides the partners
 * module's PATCH /api/v1/partners/partners/:id (customerTierId field —
 * additive) plus TierService.assignPartner for the service-level callers.
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date");
const QTY = z.string().regex(/^\d+(\.\d{1,6})?$/, "positive decimal (≤ 6dp)");
/** Strictly-positive quantity (free-goods buy/get amounts — BR-008). */
const QTY_REFINE = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, "positive decimal (≤ 6dp)")
  .refine((value) => Number(value) > 0, "must be > 0");
const NOTE = z.string().max(500).nullable().optional();

const createRouteSchema = z.object({
  code: z.string().regex(/^[A-Za-z0-9._-]{2,30}$/),
  name: z.string().min(1).max(160),
  nameAr: z.string().max(200).nullable().optional(),
  salesRepId: UUID.nullable().optional(),
  vanWarehouseId: UUID.nullable().optional(),
  dayPattern: z.array(z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"])).min(1).max(7).optional(),
  note: NOTE,
  noteAr: NOTE,
});

const updateRouteSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  nameAr: z.string().max(200).nullable().optional(),
  salesRepId: UUID.nullable().optional(),
  vanWarehouseId: UUID.nullable().optional(),
  dayPattern: z.array(z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"])).min(1).max(7).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  note: NOTE,
  noteAr: NOTE,
});

const setCustomersSchema = z.object({
  customers: z
    .array(
      z.object({
        customerId: UUID,
        visitOrder: z.coerce.number().int().min(0).optional(),
        isPinned: z.boolean().optional(),
      }),
    )
    .max(500),
});

const transferLinesSchema = z
  .array(z.object({ itemId: UUID, qty: QTY }))
  .min(1)
  .max(200);

const MONEY = z.string().regex(/^\d+(\.\d{1,4})?$/, "non-negative decimal (≤ 4dp)");
const POSITIVE_MONEY = z.string().regex(/^\d+(\.\d{1,4})?$/).refine((value) => Number(value) > 0, "positive decimal");

const openSettlementSchema = z.object({
  salesRepId: UUID,
  cashAccountId: UUID,
  vanWarehouseId: UUID.nullable().optional(),
  settlementDate: DATE,
  openingCash: MONEY,
  note: NOTE,
  noteAr: NOTE,
});

@Controller("api/v1/distribution")
export class DistributionController {
  constructor(
    private readonly routes: RouteService,
    private readonly visits: VisitService,
    private readonly vanStock: VanStockService,
    private readonly settlements: SettlementService,
    private readonly tiers: TierService,
    private readonly freeGoods: FreeGoodsService,
  ) {}

  // -- routes (T7; distribution.routes.manage / distribution.routes) ------------

  @Get("routes")
  @RequirePermissions("distribution.routes.manage")
  @RequireFeature("distribution.routes")
  async listRoutes(
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.routes.list({
        status,
        limit: limit === undefined ? undefined : Number(limit),
      }),
    );
  }

  @Post("routes")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("distribution.routes.manage")
  @RequireFeature("distribution.routes")
  async createRoute(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createRouteSchema.parse(body);
    return envelope(
      await this.routes.create({
        code: input.code,
        name: input.name,
        nameAr: input.nameAr ?? null,
        salesRepId: input.salesRepId ?? null,
        vanWarehouseId: input.vanWarehouseId ?? null,
        dayPattern: input.dayPattern,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("routes/:id")
  @RequirePermissions("distribution.routes.manage")
  @RequireFeature("distribution.routes")
  async getRoute(@Param("id") id: string) {
    return envelope(await this.routes.find(id));
  }

  @Put("routes/:id")
  @RequirePermissions("distribution.routes.manage")
  @RequireFeature("distribution.routes")
  async updateRoute(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = updateRouteSchema.parse(body);
    return envelope(
      await this.routes.update(
        id,
        {
          name: input.name,
          nameAr: input.nameAr,
          salesRepId: input.salesRepId,
          vanWarehouseId: input.vanWarehouseId,
          dayPattern: input.dayPattern,
          status: input.status,
          note: input.note,
          noteAr: input.noteAr,
        },
        identity.userId,
      ),
    );
  }

  @Post("routes/:id/customers")
  @RequirePermissions("distribution.routes.manage")
  @RequireFeature("distribution.routes")
  async setRouteCustomers(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = setCustomersSchema.parse(body);
    return envelope(
      await this.routes.setCustomers(id, { customers: input.customers, actorId: identity.userId }),
    );
  }

  @Post("routes/:id/plan-visits")
  @RequirePermissions("distribution.routes.manage")
  @RequireFeature("distribution.routes")
  async planVisits(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z.object({ date: DATE }).parse(body);
    return envelope(await this.routes.planVisits(id, { date: input.date, actorId: identity.userId }));
  }

  // -- visits (T7; the visit board — same keys as routes) -----------------------

  @Get("visits")
  @RequirePermissions("distribution.routes.manage")
  @RequireFeature("distribution.routes")
  async listVisits(
    @Query("date") date?: string,
    @Query("routeId") routeId?: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.visits.list({
        date: date !== undefined && DATE.safeParse(date).success ? date : undefined,
        routeId: routeId !== undefined && UUID.safeParse(routeId).success ? routeId : undefined,
        status,
        limit: limit === undefined ? undefined : Number(limit),
      }),
    );
  }

  @Post("visits/:id/check-in")
  @RequirePermissions("distribution.routes.manage")
  @RequireFeature("distribution.routes")
  async checkInVisit(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z
      .object({ salesRepId: UUID.nullable().optional(), note: NOTE })
      .parse(body ?? {});
    return envelope(
      await this.visits.checkIn(id, {
        salesRepId: input.salesRepId ?? null,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("visits/:id/complete")
  @RequirePermissions("distribution.routes.manage")
  @RequireFeature("distribution.routes")
  async completeVisit(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z
      .object({
        salesInvoiceId: UUID.nullable().optional(),
        creditNoteId: UUID.nullable().optional(),
        receiptId: UUID.nullable().optional(),
        note: NOTE,
      })
      .parse(body ?? {});
    return envelope(
      await this.visits.complete(id, {
        salesInvoiceId: input.salesInvoiceId ?? null,
        creditNoteId: input.creditNoteId ?? null,
        receiptId: input.receiptId ?? null,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("visits/:id/skip")
  @RequirePermissions("distribution.routes.manage")
  @RequireFeature("distribution.routes")
  async skipVisit(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z.object({ note: NOTE }).parse(body ?? {});
    return envelope(await this.visits.skip(id, { note: input.note ?? null, actorId: identity.userId }));
  }

  // -- vans (T8; distribution.van_stock.view / .manage / distribution.van_stock) -

  @Get("vans")
  @RequirePermissions("distribution.van_stock.view")
  @RequireFeature("distribution.van_stock")
  async listVans() {
    return envelope(await this.vanStock.listVans());
  }

  @Post("vans")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("distribution.van_stock.manage")
  @RequireFeature("distribution.van_stock")
  async registerVan(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z
      .object({
        code: z.string().regex(/^[A-Za-z0-9_-]{1,20}$/),
        name: z.string().min(1).max(120),
        nameAr: z.string().max(160).nullable().optional(),
        branchId: UUID,
        salesRepId: UUID,
      })
      .parse(body);
    return envelope(
      await this.vanStock.registerVan({
        code: input.code,
        name: input.name,
        nameAr: input.nameAr ?? null,
        branchId: input.branchId,
        salesRepId: input.salesRepId,
        actorId: identity.userId,
      }),
    );
  }

  // -- van stock (T8) -------------------------------------------------------------

  @Get("van-stock")
  @RequirePermissions("distribution.van_stock.view")
  @RequireFeature("distribution.van_stock")
  async listVanStock(
    @Query("warehouseId") warehouseId?: string,
    @Query("itemId") itemId?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.vanStock.listVanStock({
        warehouseId: warehouseId !== undefined && UUID.safeParse(warehouseId).success ? warehouseId : undefined,
        itemId: itemId !== undefined && UUID.safeParse(itemId).success ? itemId : undefined,
        limit: limit === undefined ? undefined : Number(limit),
      }),
    );
  }

  @Post("van-stock/load-out")
  @RequirePermissions("distribution.van_stock.manage")
  @RequireFeature("distribution.van_stock")
  async loadOut(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z
      .object({
        fromWarehouseId: UUID,
        vanWarehouseId: UUID,
        lines: transferLinesSchema,
        note: NOTE,
        noteAr: NOTE,
      })
      .parse(body);
    return envelope(
      await this.vanStock.loadOut({
        fromWarehouseId: input.fromWarehouseId,
        vanWarehouseId: input.vanWarehouseId,
        lines: input.lines,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("van-stock/unload")
  @RequirePermissions("distribution.van_stock.manage")
  @RequireFeature("distribution.van_stock")
  async unload(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z
      .object({
        vanWarehouseId: UUID,
        toWarehouseId: UUID,
        lines: transferLinesSchema,
        note: NOTE,
        noteAr: NOTE,
      })
      .parse(body);
    return envelope(
      await this.vanStock.unload({
        vanWarehouseId: input.vanWarehouseId,
        toWarehouseId: input.toWarehouseId,
        lines: input.lines,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("van-stock/transfers/:id/receive")
  @RequirePermissions("distribution.van_stock.manage")
  @RequireFeature("distribution.van_stock")
  async receiveVanTransfer(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.vanStock.receiveTransfer(id, { actorId: identity.userId }));
  }

  // -- rep settlements (T10; distribution.settlements.manage / .approve) -------------
  // approve carries the RISKY money-lock key (creator ≠ approver, BR-034).

  @Get("settlements")
  @RequirePermissions("distribution.settlements.manage")
  @RequireFeature("distribution.settlements")
  async listSettlements(
    @Query("status") status?: string,
    @Query("repId") repId?: string,
    @Query("date") date?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.settlements.list({
        status,
        repId: repId !== undefined && UUID.safeParse(repId).success ? repId : undefined,
        date: date !== undefined && DATE.safeParse(date).success ? date : undefined,
        limit: limit === undefined ? undefined : Number(limit),
      }),
    );
  }

  @Post("settlements")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("distribution.settlements.manage")
  @RequireFeature("distribution.settlements")
  async openSettlement(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = openSettlementSchema.parse(body);
    return envelope(
      await this.settlements.open({
        salesRepId: input.salesRepId,
        cashAccountId: input.cashAccountId,
        vanWarehouseId: input.vanWarehouseId ?? null,
        settlementDate: input.settlementDate,
        openingCash: input.openingCash,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("settlements/:id")
  @RequirePermissions("distribution.settlements.manage")
  @RequireFeature("distribution.settlements")
  async getSettlement(@Param("id") id: string) {
    return envelope(await this.settlements.findWithLines(id));
  }

  @Post("settlements/:id/count")
  @RequirePermissions("distribution.settlements.manage")
  @RequireFeature("distribution.settlements")
  async countSettlement(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z
      .object({ countedCash: MONEY, varianceReason: z.string().max(500).nullable().optional() })
      .parse(body);
    return envelope(
      await this.settlements.count(id, {
        countedCash: input.countedCash,
        varianceReason: input.varianceReason ?? undefined,
        actorId: identity.userId,
      }),
    );
  }

  @Post("settlements/:id/approve")
  @RequirePermissions("distribution.settlements.approve")
  @RequireFeature("distribution.settlements")
  async approveSettlement(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.settlements.approve(id, { approverId: identity.userId }));
  }

  @Post("settlements/:id/post")
  @RequirePermissions("distribution.settlements.manage")
  @RequireFeature("distribution.settlements")
  async postSettlement(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z
      .object({
        depositAccountId: UUID.nullable().optional(),
        depositAmount: POSITIVE_MONEY.nullable().optional(),
      })
      .parse(body ?? {});
    return envelope(
      await this.settlements.post(id, {
        depositAccountId: input.depositAccountId ?? null,
        depositAmount: input.depositAmount ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("settlements/:id/cancel")
  @RequirePermissions("distribution.settlements.manage")
  @RequireFeature("distribution.settlements")
  async cancelSettlement(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z.object({ reason: z.string().min(1).max(500) }).parse(body);
    return envelope(
      await this.settlements.cancel(id, { reason: input.reason, actorId: identity.userId }),
    );
  }

  // -- customer tiers (T11; distribution.tiers.manage / distribution.customer_tiers) --
  // BR-003: the tier's SALE price list resolves between the customer's own
  // list and the item base price at sale time (sales pricing seam). Partner
  // ASSIGNMENT rides PATCH /api/v1/partners/partners/:id (customerTierId).

  @Get("tiers")
  @RequirePermissions("distribution.tiers.manage")
  @RequireFeature("distribution.customer_tiers")
  async listTiers(
    @Query("status") status?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.tiers.list({
        status,
        limit: limit === undefined ? undefined : Number(limit),
      }),
    );
  }

  @Post("tiers")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("distribution.tiers.manage")
  @RequireFeature("distribution.customer_tiers")
  async createTier(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z
      .object({
        code: z.string().regex(/^[A-Za-z0-9._-]{2,30}$/),
        name: z.string().min(1).max(160),
        nameAr: z.string().max(200).nullable().optional(),
        priceListId: UUID.nullable().optional(),
        discountCapPct: z
          .string()
          .regex(/^\d+(\.\d{1,2})?$/, "percentage 0..100")
          .nullable()
          .optional(),
        visitFrequencyDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
        note: NOTE,
        noteAr: NOTE,
      })
      .parse(body);
    return envelope(
      await this.tiers.create({
        code: input.code,
        name: input.name,
        nameAr: input.nameAr ?? null,
        priceListId: input.priceListId ?? null,
        discountCapPct: input.discountCapPct ?? null,
        visitFrequencyDays: input.visitFrequencyDays ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("tiers/:id")
  @RequirePermissions("distribution.tiers.manage")
  @RequireFeature("distribution.customer_tiers")
  async getTier(@Param("id") id: string) {
    return envelope(await this.tiers.find(id));
  }

  @Put("tiers/:id")
  @RequirePermissions("distribution.tiers.manage")
  @RequireFeature("distribution.customer_tiers")
  async updateTier(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z
      .object({
        name: z.string().min(1).max(160).optional(),
        nameAr: z.string().max(200).nullable().optional(),
        priceListId: UUID.nullable().optional(),
        discountCapPct: z
          .string()
          .regex(/^\d+(\.\d{1,2})?$/, "percentage 0..100")
          .nullable()
          .optional(),
        visitFrequencyDays: z.coerce.number().int().min(0).max(365).nullable().optional(),
        status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
        note: NOTE,
        noteAr: NOTE,
      })
      .parse(body);
    return envelope(
      await this.tiers.update(
        id,
        {
          name: input.name,
          nameAr: input.nameAr,
          priceListId: input.priceListId,
          discountCapPct: input.discountCapPct,
          visitFrequencyDays: input.visitFrequencyDays,
          status: input.status,
          note: input.note,
          noteAr: input.noteAr,
        },
        identity.userId,
      ),
    );
  }

  // -- free-goods rules (T11; distribution.free_goods.manage / distribution.free_goods) --
  // BR-008: rules compute zero-price FOC lines at sale time (evaluate /
  // appendFocLines) — the rule CRUD itself never posts anything.

  @Get("free-goods-rules")
  @RequirePermissions("distribution.free_goods.manage")
  @RequireFeature("distribution.free_goods")
  async listFreeGoodsRules(
    @Query("status") status?: string,
    @Query("tierId") tierId?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.freeGoods.list({
        status,
        tierId: tierId !== undefined && UUID.safeParse(tierId).success ? tierId : undefined,
        limit: limit === undefined ? undefined : Number(limit),
      }),
    );
  }

  @Post("free-goods-rules")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("distribution.free_goods.manage")
  @RequireFeature("distribution.free_goods")
  async createFreeGoodsRule(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z
      .object({
        code: z.string().regex(/^[A-Za-z0-9._-]{2,30}$/),
        name: z.string().min(1).max(160),
        nameAr: z.string().max(200).nullable().optional(),
        buyItemId: UUID,
        buyQty: QTY_REFINE,
        getItemId: UUID,
        getQty: QTY_REFINE,
        perMultiple: z.boolean().optional(),
        maxFreePerOrder: QTY.nullable().optional(),
        tierId: UUID.nullable().optional(),
        reasonCode: z.string().min(1).max(30),
        validFrom: DATE.nullable().optional(),
        validTo: DATE.nullable().optional(),
        note: NOTE,
        noteAr: NOTE,
      })
      .parse(body);
    return envelope(
      await this.freeGoods.create({
        code: input.code,
        name: input.name,
        nameAr: input.nameAr ?? null,
        buyItemId: input.buyItemId,
        buyQty: input.buyQty,
        getItemId: input.getItemId,
        getQty: input.getQty,
        perMultiple: input.perMultiple,
        maxFreePerOrder: input.maxFreePerOrder ?? null,
        tierId: input.tierId ?? null,
        reasonCode: input.reasonCode,
        validFrom: input.validFrom ?? null,
        validTo: input.validTo ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("free-goods-rules/:id")
  @RequirePermissions("distribution.free_goods.manage")
  @RequireFeature("distribution.free_goods")
  async getFreeGoodsRule(@Param("id") id: string) {
    return envelope(await this.freeGoods.find(id));
  }

  @Put("free-goods-rules/:id")
  @RequirePermissions("distribution.free_goods.manage")
  @RequireFeature("distribution.free_goods")
  async updateFreeGoodsRule(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z
      .object({
        name: z.string().min(1).max(160).optional(),
        nameAr: z.string().max(200).nullable().optional(),
        buyItemId: UUID.optional(),
        buyQty: QTY_REFINE.optional(),
        getItemId: UUID.optional(),
        getQty: QTY_REFINE.optional(),
        perMultiple: z.boolean().optional(),
        maxFreePerOrder: QTY.nullable().optional(),
        tierId: UUID.nullable().optional(),
        reasonCode: z.string().min(1).max(30).optional(),
        validFrom: DATE.nullable().optional(),
        validTo: DATE.nullable().optional(),
        status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
        note: NOTE,
        noteAr: NOTE,
      })
      .parse(body);
    return envelope(
      await this.freeGoods.update(
        id,
        {
          name: input.name,
          nameAr: input.nameAr,
          buyItemId: input.buyItemId,
          buyQty: input.buyQty,
          getItemId: input.getItemId,
          getQty: input.getQty,
          perMultiple: input.perMultiple,
          maxFreePerOrder: input.maxFreePerOrder,
          tierId: input.tierId,
          reasonCode: input.reasonCode,
          validFrom: input.validFrom,
          validTo: input.validTo,
          status: input.status,
          note: input.note,
          noteAr: input.noteAr,
        },
        identity.userId,
      ),
    );
  }
}
