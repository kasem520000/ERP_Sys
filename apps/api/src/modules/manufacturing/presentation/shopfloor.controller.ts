import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { OperationExecutionService } from "../application/operation-execution-service";
import { DowntimeService } from "../application/downtime-service";
import * as store from "../infrastructure/manufacturing.store";

/**
 * Shop-floor routes (PHASE-042 M-17/M-15/M-16; matrix §3.20): the terminal
 * surface — the order's live operations view (production_orders.view), the
 * operation transitions + the OP-scan endpoint (shopfloor.execute), the
 * downtime log (downtime.log), and the OEE reads (oee.read). One controller
 * over the shared /api/v1/manufacturing prefix; the operations paths live
 * under production-orders/:id (the route-permissions rows match verbatim).
 *
 * Idempotency: the scan + the lifecycle transitions are idempotent by
 * construction (INV-013 through the `op_<seq>` journal key and the state
 * machine's replay paths) — repeated scans return the original result row
 * without duplicate effects; the global Idempotency-Key POST guard rides on
 * top for HTTP retries.
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const SEQ = z.coerce.number().int().min(1).max(999);
const TIME = z.string().regex(/^\d+(\.\d{1,6})?$/, "non-negative decimal hours (≤ 6dp)");
const QTY = z.string().regex(/^\d+(\.\d{1,6})?$/, "decimal quantity (≤ 6dp)");
const LIMIT = z.coerce.number().int().min(1).max(500);
const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date (YYYY-MM-DD)");
const TIMESTAMP = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/,
    "ISO date or timestamp",
  );
const REASON_CODE = z.enum([
  "PLAN_SETUP",
  "BREAKDOWN",
  "MAINTENANCE",
  "MATERIAL_SHORTAGE",
  "QUALITY_HOLD",
  "POWER_OUTAGE",
  "CHANGEOVER",
  "OPERATOR_ABSENT",
  "OTHER",
]);

const completeSchema = z.object({
  actualSetupTime: TIME,
  actualRunTime: TIME,
  scrapQty: QTY.nullable().optional(),
  scrapReasonCode: z.string().min(1).max(40).nullable().optional(),
});

const skipSchema = z.object({
  reason: z.string().min(1).max(500),
  approvedBy: UUID,
});

const scanSchema = z.object({
  code: z.string().min(4).max(120),
  actualSetupTime: TIME.nullable().optional(),
  actualRunTime: TIME.nullable().optional(),
  scrapQty: QTY.nullable().optional(),
  scrapReasonCode: z.string().min(1).max(40).nullable().optional(),
});

const downtimeLogSchema = z.object({
  workCenterId: UUID,
  reasonCode: REASON_CODE,
  startedAt: TIMESTAMP,
  durationMinutes: z.coerce.number().int().min(0).max(1440),
  endedAt: TIMESTAMP.nullable().optional(),
  orderId: UUID.nullable().optional(),
  operationSequence: z.coerce.number().int().min(1).max(999).nullable().optional(),
  note: z.string().min(1).max(500).nullable().optional(),
});

const downtimeCloseSchema = z.object({
  endedAt: TIMESTAMP,
  durationMinutes: z.coerce.number().int().min(0).max(1440),
});

@Controller("api/v1/manufacturing")
export class ShopfloorController {
  constructor(
    @Inject(OperationExecutionService) private readonly operations: OperationExecutionService,
    @Inject(DowntimeService) private readonly downtime: DowntimeService,
  ) {}

  // -- the order's live operations (production_orders.view) --------------------------

  @Get("production-orders/:id/operations")
  @RequirePermissions("manufacturing.production_orders.view")
  @RequireFeature("manufacturing.production_orders")
  async listOperations(@Param("id") id: string) {
    return envelope(await this.operations.listOperations(id));
  }

  // -- the operation transitions (shopfloor.execute) ----------------------------------

  @Post("production-orders/:id/operations/:seq/start")
  @RequirePermissions("manufacturing.shopfloor.execute")
  @RequireFeature("manufacturing.shopfloor")
  async startOp(@Req() request: Request, @Param("id") id: string, @Param("seq") seq: string) {
    const identity = requireIdentity(request);
    return envelope(await this.operations.startOp(id, SEQ.parse(seq), identity.userId));
  }

  @Post("production-orders/:id/operations/:seq/pause")
  @RequirePermissions("manufacturing.shopfloor.execute")
  @RequireFeature("manufacturing.shopfloor")
  async pauseOp(@Req() request: Request, @Param("id") id: string, @Param("seq") seq: string) {
    const identity = requireIdentity(request);
    return envelope(await this.operations.pauseOp(id, SEQ.parse(seq), identity.userId));
  }

  @Post("production-orders/:id/operations/:seq/resume")
  @RequirePermissions("manufacturing.shopfloor.execute")
  @RequireFeature("manufacturing.shopfloor")
  async resumeOp(@Req() request: Request, @Param("id") id: string, @Param("seq") seq: string) {
    const identity = requireIdentity(request);
    return envelope(await this.operations.resumeOp(id, SEQ.parse(seq), identity.userId));
  }

  @Post("production-orders/:id/operations/:seq/complete")
  @RequirePermissions("manufacturing.shopfloor.execute")
  @RequireFeature("manufacturing.shopfloor")
  async completeOp(@Req() request: Request, @Param("id") id: string, @Param("seq") seq: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = completeSchema.parse(body);
    return envelope(
      await this.operations.completeOp(id, SEQ.parse(seq), {
        actualSetupTime: input.actualSetupTime,
        actualRunTime: input.actualRunTime,
        scrapQty: input.scrapQty ?? null,
        scrapReasonCode: input.scrapReasonCode ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("production-orders/:id/operations/:seq/skip")
  @RequirePermissions("manufacturing.shopfloor.execute")
  @RequireFeature("manufacturing.shopfloor")
  async skipOp(@Req() request: Request, @Param("id") id: string, @Param("seq") seq: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = skipSchema.parse(body);
    return envelope(
      await this.operations.skipOp(id, SEQ.parse(seq), {
        reason: input.reason,
        approvedBy: input.approvedBy,
        actorId: identity.userId,
      }),
    );
  }

  // -- the terminal scan (M-17) ---------------------------------------------------------

  @Post("shopfloor/scan")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("manufacturing.shopfloor.execute")
  @RequireFeature("manufacturing.shopfloor")
  async scan(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = scanSchema.parse(body);
    return envelope(
      await this.operations.scan({
        code: input.code,
        actualSetupTime: input.actualSetupTime ?? null,
        actualRunTime: input.actualRunTime ?? null,
        scrapQty: input.scrapQty ?? null,
        scrapReasonCode: input.scrapReasonCode ?? null,
        actorId: identity.userId,
      }),
    );
  }

  // -- downtime (downtime.log) -------------------------------------------------------------

  @Get("downtime")
  @RequirePermissions("manufacturing.downtime.log")
  @RequireFeature("manufacturing.downtime")
  async listDowntime(
    @Query("workCenterId") workCenterId?: string,
    @Query("orderId") orderId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.downtime.list({
        workCenterId: workCenterId && UUID.safeParse(workCenterId).success ? workCenterId : undefined,
        orderId: orderId && UUID.safeParse(orderId).success ? orderId : undefined,
        from: from && ISO_DATE.safeParse(from).success ? from : undefined,
        to: to && ISO_DATE.safeParse(to).success ? to : undefined,
        limit: LIMIT.parse(limit ?? 100),
      }),
    );
  }

  @Post("downtime")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("manufacturing.downtime.log")
  @RequireFeature("manufacturing.downtime")
  async logDowntime(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = downtimeLogSchema.parse(body);
    return envelope(
      await this.downtime.log({
        workCenterId: input.workCenterId,
        reasonCode: input.reasonCode,
        startedAt: input.startedAt,
        durationMinutes: input.durationMinutes,
        endedAt: input.endedAt ?? null,
        orderId: input.orderId ?? null,
        operationSequence: input.operationSequence ?? null,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("downtime/:id/close")
  @RequirePermissions("manufacturing.downtime.log")
  @RequireFeature("manufacturing.downtime")
  async closeDowntime(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = downtimeCloseSchema.parse(body ?? {});
    return envelope(
      await this.downtime.close(id, {
        endedAt: input.endedAt,
        durationMinutes: input.durationMinutes,
        actorId: identity.userId,
      }),
    );
  }

  // -- OEE (oee.read) ------------------------------------------------------------------------

  @Get("oee")
  @RequirePermissions("manufacturing.oee.read")
  @RequireFeature("manufacturing.work_centers")
  async oee(
    @Query("workCenterId") workCenterId?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("granularity") granularity?: string,
    @Query("limit") limit?: string,
  ) {
    const filter = {
      workCenterId: workCenterId && UUID.safeParse(workCenterId).success ? workCenterId : undefined,
      from: from && ISO_DATE.safeParse(from).success ? from : undefined,
      to: to && ISO_DATE.safeParse(to).success ? to : undefined,
    };
    // The period view is the month rollup over the daily view (0065 §2.8);
    // both are security_invoker — RLS applies through them.
    const rows =
      granularity === "period"
        ? await store.listOeePeriod({ ...filter, limit: LIMIT.parse(limit ?? 500) })
        : await store.listOeeDaily({ ...filter, limit: LIMIT.parse(limit ?? 500) });
    return envelope(rows);
  }
}
