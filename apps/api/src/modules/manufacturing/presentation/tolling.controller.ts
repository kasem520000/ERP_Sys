import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { TollingService } from "../application/tolling-service";

/**
 * Tolling (contract manufacturing) routes (PHASE-043 §2.8, M-21): the
 * stock-at-processor round trip. The surface rides the PRODUCTION-ORDER
 * permission family (matrix §3.8 — tolling posts stock + journals exactly
 * like production orders; no dedicated key was seeded, and the family is
 * the honest fit): view on .view, create/DRAFT-edits on .create, the
 * RISKY posting legs (issue/return/settle) on .post, cancel on .approve.
 * Feature gate `manufacturing.production_orders`.
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const LIMIT = z.coerce.number().int().min(1).max(500);
const QTY = z.string().regex(/^\d+(\.\d{1,6})?$/, "decimal quantity (≤ 6dp)");
const MONEY = z.string().regex(/^\d+(\.\d{1,4})?$/, "money decimal (≤ 4dp)");
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date (YYYY-MM-DD)");
const NOTE = z.string().min(1).max(500).nullable().optional();

const createSchema = z.object({
  processorPartnerId: UUID,
  itemId: UUID,
  bomId: UUID,
  warehouseId: UUID,
  plannedQty: QTY,
  expectedReturnDate: DATE.nullable().optional(),
  conversionFee: MONEY.nullable().optional(),
  note: NOTE,
  noteAr: NOTE,
});

const issueSchema = z.object({
  materials: z
    .array(
      z.object({
        itemId: UUID,
        qty: QTY,
        batchId: UUID.nullable().optional(),
      }),
    )
    .min(1)
    .max(200),
  feePo: z
    .object({ supplierId: UUID, serviceItemId: UUID })
    .nullable()
    .optional(),
  issuedAt: DATE.nullable().optional(),
  note: NOTE,
});

const returnSchema = z.object({
  finished: z
    .array(z.object({ qty: QTY, batchNo: z.string().min(1).max(60).nullable().optional() }))
    .max(50),
  returnedMaterials: z.array(z.object({ itemId: UUID, qty: QTY })).max(200),
  yieldLoss: z.array(z.object({ itemId: UUID, qty: QTY, value: MONEY })).max(200),
  returnedAt: DATE.nullable().optional(),
  note: NOTE,
});

const cancelSchema = z.object({ reason: z.string().min(1).max(500) });

const TOLLING_STATUS = z
  .enum(["DRAFT", "ISSUED", "RETURNED", "SETTLED", "CANCELLED"])
  .optional();

@Controller("api/v1/manufacturing/tolling")
export class TollingController {
  constructor(@Inject(TollingService) private readonly tolling: TollingService) {}

  @Get("orders")
  @RequirePermissions("manufacturing.production_orders.view")
  @RequireFeature("manufacturing.production_orders")
  async list(@Query("status") status?: string, @Query("limit") limit?: string) {
    return envelope(
      await this.tolling.list({
        status: TOLLING_STATUS.parse(status ?? undefined),
        limit: LIMIT.parse(limit ?? 100),
      }),
    );
  }

  @Post("orders")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("manufacturing.production_orders.create")
  @RequireFeature("manufacturing.production_orders")
  async create(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createSchema.parse(body);
    return envelope(
      await this.tolling.create({
        processorPartnerId: input.processorPartnerId,
        itemId: input.itemId,
        bomId: input.bomId,
        warehouseId: input.warehouseId,
        plannedQty: input.plannedQty,
        expectedReturnDate: input.expectedReturnDate ?? null,
        conversionFee: input.conversionFee ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("orders/:id")
  @RequirePermissions("manufacturing.production_orders.view")
  @RequireFeature("manufacturing.production_orders")
  async get(@Param("id") id: string) {
    return envelope(await this.tolling.get(id));
  }

  @Post("orders/:id/issue")
  @RequirePermissions("manufacturing.production_orders.post")
  @RequireFeature("manufacturing.production_orders")
  async issue(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = issueSchema.parse(body);
    return envelope(
      await this.tolling.issue(id, {
        materials: input.materials.map((m) => ({
          itemId: m.itemId,
          qty: m.qty,
          batchId: m.batchId ?? null,
        })),
        feePo: input.feePo ?? null,
        issuedAt: input.issuedAt ?? null,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("orders/:id/return")
  @RequirePermissions("manufacturing.production_orders.post")
  @RequireFeature("manufacturing.production_orders")
  async return_(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = returnSchema.parse(body ?? {});
    return envelope(
      await this.tolling.return_(id, {
        finished: input.finished.map((f) => ({ qty: f.qty, batchNo: f.batchNo ?? null })),
        returnedMaterials: input.returnedMaterials,
        yieldLoss: input.yieldLoss,
        returnedAt: input.returnedAt ?? null,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("orders/:id/settle")
  @RequirePermissions("manufacturing.production_orders.post")
  @RequireFeature("manufacturing.production_orders")
  async settle(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.tolling.settle(id, identity.userId));
  }

  @Post("orders/:id/cancel")
  @RequirePermissions("manufacturing.production_orders.approve")
  @RequireFeature("manufacturing.production_orders")
  async cancel(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = cancelSchema.parse(body ?? {});
    return envelope(await this.tolling.cancel(id, input.reason, identity.userId));
  }
}
