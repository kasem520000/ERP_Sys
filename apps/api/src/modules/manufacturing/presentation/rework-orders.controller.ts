import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { ReworkService } from "../application/rework-service";

/**
 * Rework-order routes (PHASE-042 M-14; matrix §3.20): DRAFT creation from a
 * COMPLETED parent order's defect, the RW- numbered release (aggregate
 * routing freeze), start, the G-41 completion, and the zero-effect cancel —
 * one manage key (`manufacturing.rework_orders.manage`) for the whole
 * lifecycle. BR-039 feature gate `manufacturing.rework`; foreign or unknown
 * ids are 404-shaped (A7); qty decimal strings ≤ 6dp (ADR-0009).
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
const TIME = z.string().regex(/^\d+(\.\d{1,6})?$/, "non-negative decimal hours (≤ 6dp)");
const LIMIT = z.coerce.number().int().min(1).max(500);
const NOTE = z.string().min(1).max(500).nullable().optional();
const REWORK_STATUS = z.enum(["DRAFT", "RELEASED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]).optional();

const createSchema = z.object({
  parentOrderId: UUID,
  batchId: UUID.nullable().optional(),
  defectRef: z.string().min(1).max(120),
  qty: QTY,
  routingId: UUID.nullable().optional(),
  defectReasonCode: z.string().min(1).max(40).nullable().optional(),
  note: NOTE,
  noteAr: NOTE,
});

const completeSchema = z.object({
  actualSetupTime: TIME,
  actualRunTime: TIME,
});

const cancelSchema = z.object({ reason: z.string().min(1).max(500) });

@Controller("api/v1/manufacturing/rework-orders")
export class ReworkOrdersController {
  constructor(@Inject(ReworkService) private readonly rework: ReworkService) {}

  @Get("")
  @RequirePermissions("manufacturing.rework_orders.manage")
  @RequireFeature("manufacturing.rework")
  async list(@Query("status") status?: string, @Query("limit") limit?: string) {
    return envelope(
      await this.rework.list({
        status: REWORK_STATUS.parse(status ?? undefined),
        limit: LIMIT.parse(limit ?? 100),
      }),
    );
  }

  @Post("")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("manufacturing.rework_orders.manage")
  @RequireFeature("manufacturing.rework")
  async create(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createSchema.parse(body);
    return envelope(
      await this.rework.create({
        parentOrderId: input.parentOrderId,
        batchId: input.batchId ?? null,
        defectRef: input.defectRef,
        qty: input.qty,
        routingId: input.routingId ?? null,
        defectReasonCode: input.defectReasonCode ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post(":id/release")
  @RequirePermissions("manufacturing.rework_orders.manage")
  @RequireFeature("manufacturing.rework")
  async release(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.rework.release(id, identity.userId));
  }

  @Post(":id/start")
  @RequirePermissions("manufacturing.rework_orders.manage")
  @RequireFeature("manufacturing.rework")
  async start(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.rework.start(id, identity.userId));
  }

  @Post(":id/complete")
  @RequirePermissions("manufacturing.rework_orders.manage")
  @RequireFeature("manufacturing.rework")
  async complete(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = completeSchema.parse(body);
    return envelope(
      await this.rework.complete(id, {
        actualSetupTime: input.actualSetupTime,
        actualRunTime: input.actualRunTime,
        actorId: identity.userId,
      }),
    );
  }

  @Post(":id/cancel")
  @RequirePermissions("manufacturing.rework_orders.manage")
  @RequireFeature("manufacturing.rework")
  async cancel(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = cancelSchema.parse(body ?? {});
    return envelope(await this.rework.cancel(id, { reason: input.reason, actorId: identity.userId }));
  }
}
