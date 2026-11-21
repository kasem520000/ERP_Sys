import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { envelope } from "../../../infra/http/envelope";
import { MaintenanceWorkOrderService } from "../application/maintenance-work-order-service";

/**
 * PHASE-049 (W-17 — T-05/T-06) the maintenance work-order routes (matrix
 * §3.27): every route is permission-guarded with the exact 0108-seeded
 * keys (assets.maintenance.view / assets.maintenance.manage — the manage
 * key is the SoD surface over the G-59 completion act), Idempotency-Key
 * guarded by the global POST guard, and returns the success envelope.
 * Foreign/unknown ids are 404-shaped (A7 — RLS makes them
 * indistinguishable). The completion route is the G-59 act's door: the
 * gate's refusals (open steps, unpriced lines, the zero-total law) and
 * the machine's named state errors surface as typed envelopes.
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const TEXT = z.string().min(1).max(2000);
const NOTE = z.string().max(2000).nullable().optional();
const PRIORITY = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM");
const QTY = z.string().regex(/^\d+(\.\d{1,6})?$/, "decimal (≤ 6dp)");
const RATE = z.string().regex(/^\d+(\.\d{1,6})?$/, "non-negative decimal (≤ 6dp)");
const MONEY = z.string().regex(/^\d+(\.\d{1,4})?$/, "non-negative decimal (≤ 4dp)");
const LEG = z.enum(["LABOR", "PARTS", "EXTERNAL"]);
const RESULT = z.enum(["PASS", "FAIL"]);

const createOrderSchema = z.object({
  assetId: UUID,
  problem: TEXT,
  problemAr: NOTE,
  priority: PRIORITY,
  technicianEmployeeId: UUID.nullable().optional(),
  note: NOTE,
  noteAr: NOTE,
});

const addLineSchema = z
  .object({
    legType: LEG,
    employeeId: UUID.optional(),
    hours: QTY.optional(),
    unitRate: RATE.optional(),
    itemId: UUID.optional(),
    warehouseId: UUID.optional(),
    qty: QTY.optional(),
    partnerId: UUID.optional(),
    amount: MONEY.optional(),
    description: NOTE,
    descriptionAr: NOTE,
    note: NOTE,
    noteAr: NOTE,
  })
  .refine((value) => value.unitRate === undefined || value.unitRate !== "", {
    message: "unitRate is optional but never empty",
  });

const priceLineSchema = z.object({
  unitRate: RATE.optional(),
  amount: MONEY.optional(),
});

const completeSchema = z.object({
  solution: NOTE,
  solutionAr: NOTE,
});

const stepResultSchema = z.object({
  result: RESULT,
  resultNote: NOTE,
  resultNoteAr: NOTE,
});

const STATUS = z
  .enum(["REQUESTED", "PLANNED", "IN_PROGRESS", "ON_HOLD", "COMPLETED"])
  .optional();

@Controller("/api/v1/assets/maintenance")
export class MaintenanceController {
  constructor(
    @Inject(MaintenanceWorkOrderService) private readonly orders: MaintenanceWorkOrderService,
  ) {}

  // -- the orders board (T-05) ----------------------------------------------------

  @Get("orders")
  @RequirePermissions("assets.maintenance.view")
  listOrders(@Query("assetId") assetId?: string, @Query("status") status?: string, @Query("planId") planId?: string) {
    return envelope(
      this.orders.list({
        assetId: assetId === undefined || assetId === "" ? undefined : assetId,
        status: STATUS.parse(status ?? undefined) as string | undefined,
        planId: planId === undefined || planId === "" ? undefined : planId,
      }),
    );
  }

  @Post("orders")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("assets.maintenance.manage")
  async createOrder(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createOrderSchema.parse(body);
    return envelope(await this.orders.create({ ...input, actorId: identity.userId }));
  }

  @Get("orders/:id")
  @RequirePermissions("assets.maintenance.view")
  async getOrder(@Param("id") id: string) {
    return envelope(await this.orders.get(id));
  }

  @Get("orders/:id/lines")
  @RequirePermissions("assets.maintenance.view")
  async listLines(@Param("id") id: string) {
    return envelope(await this.orders.listLines(id));
  }

  @Get("orders/:id/steps")
  @RequirePermissions("assets.maintenance.view")
  async listSteps(@Param("id") id: string) {
    return envelope(await this.orders.listSteps(id));
  }

  // -- the machine (D-03 — one CAS per move) ---------------------------------------

  @Post("orders/:id/plan")
  @RequirePermissions("assets.maintenance.manage")
  async planOrder(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.orders.plan(id, identity.userId));
  }

  @Post("orders/:id/start")
  @RequirePermissions("assets.maintenance.manage")
  async startOrder(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.orders.start(id, identity.userId));
  }

  @Post("orders/:id/hold")
  @RequirePermissions("assets.maintenance.manage")
  async holdOrder(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.orders.hold(id, identity.userId));
  }

  @Post("orders/:id/resume")
  @RequirePermissions("assets.maintenance.manage")
  async resumeOrder(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.orders.resume(id, identity.userId));
  }

  /** THE G-59 ACT'S DOOR (T-06): the completion gate + the fused posting
   * (the parts issue + the journal + the single-use stamp — one
   * transaction; INV-034's reconciliation rides the response). */
  @Post("orders/:id/complete")
  @RequirePermissions("assets.maintenance.manage")
  async completeOrder(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = completeSchema.parse(body ?? {});
    return envelope(
      await this.orders.complete({ workOrderId: id, ...input, actorId: identity.userId }),
    );
  }

  // -- the cost collectors (D-03/D-05) ---------------------------------------------

  @Post("orders/:id/lines")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("assets.maintenance.manage")
  async addLine(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = addLineSchema.parse(body);
    return envelope(await this.orders.addLine({ workOrderId: id, ...input, actorId: identity.userId }));
  }

  @Patch("orders/:id/lines/:lineId")
  @RequirePermissions("assets.maintenance.manage")
  async priceLine(
    @Req() request: Request,
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = priceLineSchema.parse(body);
    return envelope(
      await this.orders.priceLine({ workOrderId: id, lineId, ...input, actorId: identity.userId }),
    );
  }

  @Delete("orders/:id/lines/:lineId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions("assets.maintenance.manage")
  async removeLine(
    @Req() request: Request,
    @Param("id") id: string,
    @Param("lineId") lineId: string,
  ) {
    const identity = requireIdentity(request);
    await this.orders.removeLine({ workOrderId: id, lineId, actorId: identity.userId });
    return undefined;
  }

  // -- the step results (BR-098's other half) --------------------------------------

  @Post("orders/:id/steps/:stepId/result")
  @RequirePermissions("assets.maintenance.manage")
  async recordStep(
    @Req() request: Request,
    @Param("id") id: string,
    @Param("stepId") stepId: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = stepResultSchema.parse(body);
    return envelope(
      await this.orders.recordStep({ workOrderId: id, stepId, ...input, actorId: identity.userId }),
    );
  }
}
