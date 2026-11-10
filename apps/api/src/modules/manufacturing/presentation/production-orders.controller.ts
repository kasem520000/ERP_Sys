import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { ProductionOrderService } from "../application/production-order-service";

/**
 * Production-order routes (PHASE-018 §9 rows 8–17; matrix §3.8): the order
 * workspace — list/create/read/update under the view/create keys, the RISKY
 * approve pair (release/start/cancel) and the RISKY post trio
 * (consume/scrap/complete). Feature gate `manufacturing.production_orders`
 * on every route EXCEPT scrap, which rides `manufacturing.scrap` (the scrap
 * surface is its own entitlement). requireIdentity, BR-039 feature gate, the
 * global Idempotency-Key POST guard, and the success envelope throughout;
 * foreign or unknown ids are 404-shaped (A7). Quantities ≤ 6dp, money ≤ 4dp,
 * dates ISO (ADR-0009).
 *
 * NOTE (INV-013, by design): consume and scrap are DISTINCT business events
 * — each call posts its own journal under a unique source operation
 * (`consume:<seq>` / `scrap:<seq>`), so an HTTP Idempotency-Key retry of the
 * same call is served by the global guard's replay semantics, while two
 * different consume calls never collide. Release and complete are the
 * idempotent lifecycle anchors (release-on-RELEASED is a no-op returning the
 * current order; complete-on-COMPLETED returns the stored completion).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const QTY = z.string().regex(/^\d+(\.\d{1,6})?$/, "decimal quantity (≤ 6dp)");
const RATE = z.string().regex(/^\d+(\.\d{1,6})?$/, "non-negative decimal rate (≤ 6dp)");
const MONEY = z.string().regex(/^\d+(\.\d{1,4})?$/, "money decimal (≤ 4dp)");
const LIMIT = z.coerce.number().int().min(1).max(500);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date (YYYY-MM-DD)");
const NOTE = z.string().min(1).max(500).nullable().optional();
const ORDER_STATUS = z.enum(["DRAFT", "RELEASED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional();

const createSchema = z.object({
  branchId: UUID,
  itemId: UUID,
  /** Explicit recipe version to bind at release; omitted = the item's ACTIVE. */
  bomId: UUID.nullable().optional(),
  plannedQty: QTY,
  plannedDate: DATE.nullable().optional(),
  materialsWarehouseId: UUID,
  fgWarehouseId: UUID,
  laborRate: RATE.nullable().optional(),
  overheadRate: RATE.nullable().optional(),
  costCenterId: UUID.nullable().optional(),
  note: NOTE,
  noteAr: NOTE,
});

const updateSchema = z.object({
  bomId: UUID.nullable().optional(),
  plannedQty: QTY.optional(),
  plannedDate: DATE.nullable().optional(),
  materialsWarehouseId: UUID.optional(),
  fgWarehouseId: UUID.optional(),
  laborRate: RATE.nullable().optional(),
  overheadRate: RATE.nullable().optional(),
  costCenterId: UUID.nullable().optional(),
  note: NOTE,
  noteAr: NOTE,
});

const consumeSchema = z.object({
  lines: z
    .array(
      z.object({
        itemId: UUID,
        qty: QTY,
        batchId: UUID.nullable().optional(),
      }),
    )
    .min(1)
    .max(200),
  consumedAt: DATE.nullable().optional(),
  note: NOTE,
  noteAr: NOTE,
});

const scrapSchema = z.object({
  qty: QTY,
  reasonCode: z.string().min(1).max(40).nullable().optional(),
  value: MONEY,
  scrappedAt: DATE.nullable().optional(),
  note: NOTE,
  noteAr: NOTE,
});

const completeSchema = z.object({
  actualQty: QTY,
  batchNo: z.string().min(1).max(60).nullable().optional(),
  completedAt: DATE.nullable().optional(),
});

const cancelSchema = z.object({ reason: z.string().min(1).max(500) });

@Controller("api/v1/manufacturing/production-orders")
export class ProductionOrdersController {
  constructor(@Inject(ProductionOrderService) private readonly orders: ProductionOrderService) {}

  @Get("")
  @RequirePermissions("manufacturing.production_orders.view")
  @RequireFeature("manufacturing.production_orders")
  async list(
    @Query("status") status?: string,
    @Query("itemId") itemId?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.orders.list({
        status: ORDER_STATUS.parse(status ?? undefined),
        itemId: itemId && UUID.safeParse(itemId).success ? itemId : undefined,
        limit: LIMIT.parse(limit ?? 100),
      }),
    );
  }

  @Post("")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("manufacturing.production_orders.create")
  @RequireFeature("manufacturing.production_orders")
  async create(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createSchema.parse(body);
    return envelope(
      await this.orders.create({
        branchId: input.branchId,
        itemId: input.itemId,
        bomId: input.bomId ?? null,
        plannedQty: input.plannedQty,
        plannedDate: input.plannedDate ?? null,
        materialsWarehouseId: input.materialsWarehouseId,
        fgWarehouseId: input.fgWarehouseId,
        laborRate: input.laborRate ?? null,
        overheadRate: input.overheadRate ?? null,
        costCenterId: input.costCenterId ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get(":id")
  @RequirePermissions("manufacturing.production_orders.view")
  @RequireFeature("manufacturing.production_orders")
  async get(@Param("id") id: string) {
    return envelope(await this.orders.get(id));
  }

  @Put(":id")
  @RequirePermissions("manufacturing.production_orders.create")
  @RequireFeature("manufacturing.production_orders")
  async update(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = updateSchema.parse(body ?? {});
    return envelope(
      await this.orders.update(id, {
        bomId: input.bomId,
        plannedQty: input.plannedQty,
        plannedDate: input.plannedDate,
        materialsWarehouseId: input.materialsWarehouseId,
        fgWarehouseId: input.fgWarehouseId,
        laborRate: input.laborRate,
        overheadRate: input.overheadRate,
        costCenterId: input.costCenterId,
        note: input.note,
        noteAr: input.noteAr,
        actorId: identity.userId,
      }),
    );
  }

  @Post(":id/release")
  @RequirePermissions("manufacturing.production_orders.approve")
  @RequireFeature("manufacturing.production_orders")
  async release(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.orders.release(id, identity.userId));
  }

  @Post(":id/start")
  @RequirePermissions("manufacturing.production_orders.approve")
  @RequireFeature("manufacturing.production_orders")
  async start(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.orders.start(id, identity.userId));
  }

  @Post(":id/consume")
  @RequirePermissions("manufacturing.production_orders.post")
  @RequireFeature("manufacturing.production_orders")
  async consume(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = consumeSchema.parse(body);
    return envelope(
      await this.orders.consume(id, {
        lines: input.lines.map((line) => ({
          itemId: line.itemId,
          qty: line.qty,
          batchId: line.batchId ?? null,
        })),
        consumedAt: input.consumedAt ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post(":id/scrap")
  @RequirePermissions("manufacturing.production_orders.post")
  @RequireFeature("manufacturing.scrap")
  async scrap(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = scrapSchema.parse(body);
    return envelope(
      await this.orders.scrap(id, {
        qty: input.qty,
        reasonCode: input.reasonCode ?? null,
        value: input.value,
        scrappedAt: input.scrappedAt ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post(":id/complete")
  @RequirePermissions("manufacturing.production_orders.post")
  @RequireFeature("manufacturing.production_orders")
  async complete(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = completeSchema.parse(body);
    return envelope(
      await this.orders.complete(id, {
        actualQty: input.actualQty,
        batchNo: input.batchNo ?? null,
        completedAt: input.completedAt ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post(":id/cancel")
  @RequirePermissions("manufacturing.production_orders.approve")
  @RequireFeature("manufacturing.production_orders")
  async cancel(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = cancelSchema.parse(body ?? {});
    return envelope(await this.orders.cancel(id, { reason: input.reason, actorId: identity.userId }));
  }
}
