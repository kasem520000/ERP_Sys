import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { SupplierReturnsService } from "../application/supplier-rma";

/**
 * Supplier-return routes (PHASE-039 §2.13; matrix §3.17): the
 * return-to-vendor workspace — REQUESTED → APPROVED (SoD) → SHIPPED (the
 * inventory issue leg) → CREDITED (G-38 + the auto-generated AP debit
 * note). Permission-guarded with the seeded 0056 pair
 * (purchasing.rma.read/manage) and feature-gated on purchasing.rma.
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const QTY = z.string().regex(/^\d+(\.\d{1,6})?$/, "positive decimal (≤ 6dp)");
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date");

const SRMA_REASON_CODES = z.enum([
  "DAMAGED",
  "DEFECTIVE",
  "WRONG_ITEM",
  "OVER_SHIPMENT",
  "EXPIRED",
  "RECALL",
  "OTHER",
]) as z.ZodType<
  "DAMAGED" | "DEFECTIVE" | "WRONG_ITEM" | "OVER_SHIPMENT" | "EXPIRED" | "RECALL" | "OTHER"
>;

const srmaLineSchema = z.object({
  poLineId: UUID,
  qty: QTY,
  note: z.string().max(500).nullable().optional(),
});

const createSrmaSchema = z.object({
  branchId: UUID,
  purchaseOrderId: UUID,
  reasonCode: SRMA_REASON_CODES,
  reason: z.string().max(1000).nullable().optional(),
  reasonAr: z.string().max(1000).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  noteAr: z.string().max(2000).nullable().optional(),
  lines: z.array(srmaLineSchema).min(1).max(200),
});

const shipSrmaSchema = z.object({
  warehouseId: UUID,
  entryDate: DATE.optional(),
});

const creditSrmaSchema = z.object({
  entryDate: DATE.optional(),
});

const cancelSchema = z.object({ reason: z.string().min(3).max(500) });

const LIMIT = (value: string | undefined, fallback: number) =>
  z.coerce.number().int().min(1).max(500).parse(value ?? fallback);

@Controller("/api/v1/purchasing")
export class SupplierReturnsController {
  constructor(
    @Inject(SupplierReturnsService) private readonly returns: SupplierReturnsService,
  ) {}

  @Get("returns")
  @RequireFeature("purchasing.rma")
  @RequirePermissions("purchasing.rma.read")
  listSupplierRmas(
    @Req() request: Request,
    @Query("status") status?: string,
    @Query("supplierId") supplierId?: string,
    @Query("limit") limit?: string,
  ) {
    requireIdentity(request);
    return envelope(
      this.returns.list({ status, supplierId, limit: LIMIT(limit, 200) }),
    );
  }

  @Get("returns/:id")
  @RequireFeature("purchasing.rma")
  @RequirePermissions("purchasing.rma.read")
  async getSupplierRma(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    return envelope(await this.returns.findWithLines(UUID.parse(id)));
  }

  @Post("returns")
  @HttpCode(HttpStatus.CREATED)
  @RequireFeature("purchasing.rma")
  @RequirePermissions("purchasing.rma.manage")
  async createSupplierRma(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createSrmaSchema.parse(body);
    return envelope(
      await this.returns.create({
        branchId: input.branchId,
        purchaseOrderId: input.purchaseOrderId,
        reasonCode: input.reasonCode,
        reason: input.reason ?? null,
        reasonAr: input.reasonAr ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
        lines: input.lines.map((line) => ({
          poLineId: line.poLineId,
          qty: line.qty,
          note: line.note ?? null,
        })),
      }),
    );
  }

  @Post("returns/:id/approve")
  @RequireFeature("purchasing.rma")
  @RequirePermissions("purchasing.rma.manage")
  async approveSupplierRma(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.returns.approve(UUID.parse(id), identity.userId));
  }

  @Post("returns/:id/ship")
  @RequireFeature("purchasing.rma")
  @RequirePermissions("purchasing.rma.manage")
  async shipSupplierRma(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = shipSrmaSchema.parse(body);
    return envelope(
      await this.returns.ship({
        srmaId: UUID.parse(id),
        warehouseId: input.warehouseId,
        entryDate: input.entryDate,
        actorId: identity.userId,
      }),
    );
  }

  @Post("returns/:id/credit")
  @RequireFeature("purchasing.rma")
  @RequirePermissions("purchasing.rma.manage")
  async creditSupplierRma(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = creditSrmaSchema.parse(body ?? {});
    return envelope(
      await this.returns.credit({
        srmaId: UUID.parse(id),
        entryDate: input.entryDate,
        actorId: identity.userId,
      }),
    );
  }

  @Post("returns/:id/cancel")
  @RequireFeature("purchasing.rma")
  @RequirePermissions("purchasing.rma.manage")
  async cancelSupplierRma(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = cancelSchema.parse(body);
    return envelope(await this.returns.cancel(UUID.parse(id), input.reason, identity.userId));
  }
}
