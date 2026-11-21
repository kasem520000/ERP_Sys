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
import { MaintenancePlanService } from "../application/maintenance-plan-service";

/**
 * PHASE-049 (W-17 — T-07) the preventive-plans routes (matrix §3.27, the
 * assets.maintenance.plan key — the risky key: plans generate work orders
 * automatically, BR-097's single-open window is the structural floor).
 * The evaluation surface is the EXPLICIT entry W-18's event-driven
 * wiring and W-19's sweep job call; the forced generation refuses BY
 * NAME when the window is open (never a silent skip).
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
const TRIGGER = z.enum(["CALENDAR", "METER"]);
const QTY = z.string().regex(/^\d+(\.\d{1,6})?$/, "decimal (≤ 6dp)");
const INTERVAL = z.coerce.number().int().min(1).max(3650);
const NOTE = z.string().max(2000).nullable().optional();

const createPlanSchema = z
  .object({
    assetId: UUID,
    name: z.string().min(1).max(200),
    nameAr: NOTE,
    description: NOTE,
    descriptionAr: NOTE,
    triggerType: TRIGGER,
    intervalDays: INTERVAL.nullable().optional(),
    nextDueDate: DATE.nullable().optional(),
    meterId: UUID.nullable().optional(),
    thresholdDelta: QTY.nullable().optional(),
    note: NOTE,
    noteAr: NOTE,
  })
  .refine((value) => value.triggerType === "CALENDAR" || value.meterId !== undefined, {
    message: "a METER plan names its meter",
  });

const patchPlanSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    nameAr: NOTE,
    description: NOTE,
    descriptionAr: NOTE,
    isActive: z.boolean().optional(),
    intervalDays: INTERVAL.nullable().optional(),
    nextDueDate: DATE.nullable().optional(),
    thresholdDelta: QTY.nullable().optional(),
    note: NOTE,
    noteAr: NOTE,
  })
  .refine((value) => Object.keys(value).length > 0, { message: "empty patch" });

const taskSchema = z.object({
  seq: z.coerce.number().int().min(1).optional(),
  title: z.string().min(1).max(300),
  titleAr: NOTE,
  instruction: NOTE,
  instructionAr: NOTE,
});

const patchTaskSchema = z
  .object({
    title: z.string().min(1).max(300).optional(),
    titleAr: NOTE,
    instruction: NOTE,
    instructionAr: NOTE,
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "empty patch" });

const forceSchema = z.object({ force: z.boolean().optional() });

@Controller("/api/v1/assets/plans")
export class MaintenancePlansController {
  constructor(@Inject(MaintenancePlanService) private readonly plans: MaintenancePlanService) {}

  // -- the register (D-08 — the XOR shape law at every authoring path) ------------

  @Get()
  @RequirePermissions("assets.maintenance.plan")
  listPlans(@Query("assetId") assetId?: string, @Query("active") active?: string) {
    return envelope(
      this.plans.list({
        assetId: assetId === undefined || assetId === "" ? undefined : assetId,
        activeOnly: active === "true",
      }),
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("assets.maintenance.plan")
  async createPlan(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createPlanSchema.parse(body);
    return envelope(await this.plans.create({ ...input, actorId: identity.userId }));
  }

  @Get(":id")
  @RequirePermissions("assets.maintenance.plan")
  async getPlan(@Param("id") id: string) {
    return envelope(await this.plans.get(id));
  }

  @Patch(":id")
  @RequirePermissions("assets.maintenance.plan")
  async patchPlan(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = patchPlanSchema.parse(body);
    return envelope(await this.plans.patch({ planId: id, ...input, actorId: identity.userId }));
  }

  // -- the checklist template (D-08 — the carry-over's source) ----------------------

  @Get(":id/tasks")
  @RequirePermissions("assets.maintenance.plan")
  async listTasks(@Param("id") id: string) {
    return envelope(await this.plans.listTasks(id));
  }

  @Post(":id/tasks")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("assets.maintenance.plan")
  async addTask(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = taskSchema.parse(body);
    return envelope(await this.plans.addTask({ planId: id, ...input, actorId: identity.userId }));
  }

  @Patch(":id/tasks/:taskId")
  @RequirePermissions("assets.maintenance.plan")
  async patchTask(
    @Req() request: Request,
    @Param("id") id: string,
    @Param("taskId") taskId: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = patchTaskSchema.parse(body);
    return envelope(
      await this.plans.patchTask({ planId: id, taskId, ...input, actorId: identity.userId }),
    );
  }

  @Delete(":id/tasks/:taskId")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions("assets.maintenance.plan")
  async removeTask(
    @Req() request: Request,
    @Param("id") id: string,
    @Param("taskId") taskId: string,
  ) {
    const identity = requireIdentity(request);
    await this.plans.removeTask({ planId: id, taskId, actorId: identity.userId });
    return undefined;
  }

  // -- THE EVALUATION + GENERATION (D-08 — BR-097's named skips) --------------------

  /** One plan's explicit evaluation (the surface W-18's event wiring and
   * W-19's sweep call): due → generate (PLANNED + the carried checklist
   * + the plan stamps); the skips are NAMED in the response. */
  @Post(":id/evaluate")
  @RequirePermissions("assets.maintenance.plan")
  async evaluatePlan(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.plans.evaluate({ planId: id, actorId: identity.userId }));
  }

  /** The forced generation (the board's «generate now») — refuses BY NAME
   * when the window holds an open order (BR-097). */
  @Post(":id/generate")
  @RequirePermissions("assets.maintenance.plan")
  async forceGenerate(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = forceSchema.parse(body ?? {});
    return envelope(
      await this.plans.forceGenerate({ planId: id, actorId: identity.userId, force: input.force }),
    );
  }

  /** The bulk sweep entry (the daily calendar walk's surface — every
   * active plan evaluated, the skips NAMED in the report). */
  @Post("evaluate")
  @RequirePermissions("assets.maintenance.plan")
  async evaluateAll(@Req() request: Request) {
    const identity = requireIdentity(request);
    return envelope(await this.plans.evaluateAll({ actorId: identity.userId }));
  }
}
