import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { WorkCenterService } from "../application/work-center-service";

/**
 * Work-center routes (PHASE-042 matrix §3.20): the shop-floor capacity + rate
 * master data — list/create under `manufacturing.work_centers.manage`, the
 * PATCH full edit, and the guarded POST :id/status flip. BR-039 feature gate
 * `manufacturing.work_centers` on every route; foreign or unknown ids are
 * 404-shaped (A7); quantities/rates travel as decimal strings ≤ 6dp
 * (ADR-0009; numeric(7,2) capacity, numeric(19,6) rates).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const RATE = z.string().regex(/^\d+(\.\d{1,6})?$/, "non-negative decimal rate (≤ 6dp)");
const CAPACITY = z.string().regex(/^\d+(\.\d{1,2})?$/, "capacity decimal (≤ 2dp)");
const LIMIT = z.coerce.number().int().min(1).max(500);
const NOTE = z.string().min(1).max(500).nullable().optional();
const STATUS = z.enum(["ACTIVE", "INACTIVE"]).optional();

const createSchema = z.object({
  code: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{1,39}$/, "work center code shape"),
  name: z.string().min(1).max(200),
  nameAr: NOTE,
  description: NOTE,
  capacityPerShift: CAPACITY,
  shiftsPerDay: z.coerce.number().int().min(1).max(6),
  fixedCostRate: RATE.nullable().optional(),
  varCostRate: RATE.nullable().optional(),
  costCenterId: UUID.nullable().optional(),
});

const updateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  nameAr: NOTE,
  description: NOTE,
  capacityPerShift: CAPACITY.optional(),
  shiftsPerDay: z.coerce.number().int().min(1).max(6).optional(),
  fixedCostRate: RATE.nullable().optional(),
  varCostRate: RATE.nullable().optional(),
  costCenterId: UUID.nullable().optional(),
});

const statusSchema = z.object({ status: z.enum(["ACTIVE", "INACTIVE"]) });

@Controller("api/v1/manufacturing/work-centers")
export class WorkCentersController {
  constructor(@Inject(WorkCenterService) private readonly workCenters: WorkCenterService) {}

  @Get("")
  @RequirePermissions("manufacturing.work_centers.manage")
  @RequireFeature("manufacturing.work_centers")
  async list(@Query("status") status?: string, @Query("limit") limit?: string) {
    return envelope(
      await this.workCenters.list({
        status: STATUS.parse(status ?? undefined),
        limit: LIMIT.parse(limit ?? 100),
      }),
    );
  }

  @Post("")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("manufacturing.work_centers.manage")
  @RequireFeature("manufacturing.work_centers")
  async create(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createSchema.parse(body);
    return envelope(
      await this.workCenters.create({
        code: input.code,
        name: input.name,
        nameAr: input.nameAr ?? null,
        description: input.description ?? null,
        capacityPerShift: input.capacityPerShift,
        shiftsPerDay: input.shiftsPerDay,
        fixedCostRate: input.fixedCostRate ?? null,
        varCostRate: input.varCostRate ?? null,
        costCenterId: input.costCenterId ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Patch(":id")
  @RequirePermissions("manufacturing.work_centers.manage")
  @RequireFeature("manufacturing.work_centers")
  async update(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = updateSchema.parse(body ?? {});
    return envelope(
      await this.workCenters.update(id, {
        name: input.name,
        nameAr: input.nameAr,
        description: input.description,
        capacityPerShift: input.capacityPerShift,
        shiftsPerDay: input.shiftsPerDay,
        fixedCostRate: input.fixedCostRate,
        varCostRate: input.varCostRate,
        costCenterId: input.costCenterId,
        actorId: identity.userId,
      }),
    );
  }

  @Post(":id/status")
  @RequirePermissions("manufacturing.work_centers.manage")
  @RequireFeature("manufacturing.work_centers")
  async setStatus(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = statusSchema.parse(body ?? {});
    return envelope(await this.workCenters.setStatus(id, input.status, identity.userId));
  }
}
