import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { envelope } from "../../../infra/http/envelope";
import { UnauthenticatedError } from "../../identity/api/identity";
import { BridgeService } from "../application/bridge-service";
import { TalentGoalsService } from "../application/talent-goals-service";
import { SelfNotLinkedError } from "../domain/self-service-errors";

/**
 * PHASE-047 (W-2 — T-06) — the goals routes: the cascade tree (the
 * manage-side authoring — the cascade is authored top-down,
 * hr.performance.manage), the OWN goals read + the KRI progress triage
 * (hr.performance.review — the acting employee's own rows, resolved
 * through the identity bridge, never a client-supplied owner id), and
 * the reads (hr.performance.view). BR-089's explicit check is a read;
 * the law's enforcement point is the review submission (T-05's gate).
 *
 * The envelope law (the T-14 repair): every site awaits its service
 * call INSIDE envelope(...).
 */
function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const UUID = z.string().uuid();
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date (YYYY-MM-DD)");
const PCT = z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, 'a decimal string like "55.50"');
const TEXT = z.string().min(1).max(500).nullable().optional();

const goalBody = z.object({
  cycleId: UUID,
  ownerEmployeeId: UUID,
  parentGoalId: UUID.nullable(),
  title: z.string().min(1).max(200),
  titleAr: TEXT,
  weight: PCT,
  kriTarget: TEXT,
  dueDate: DATE.nullable(),
});

const goalPatch = z.object({
  title: z.string().min(1).max(200).optional(),
  titleAr: TEXT,
  weight: PCT.optional(),
  parentGoalId: UUID.nullable(),
  kriTarget: TEXT,
  dueDate: DATE.nullable(),
  status: z.enum(["ACTIVE", "AT_RISK", "ACHIEVED", "CANCELLED"]).optional(),
});

const progressBody = z.object({
  kriActual: TEXT,
  progressPct: PCT,
});

@Controller("api/v1/hr")
export class TalentGoalsController {
  constructor(
    @Inject(TalentGoalsService) private readonly goals: TalentGoalsService,
    @Inject(BridgeService) private readonly bridge: BridgeService,
  ) {}

  /** The own-employee resolver (the own-rows law's service-boundary
   * half — the self-service precedent). */
  private async requireOwnEmployeeId(userId: string): Promise<string> {
    const linked = await this.bridge.resolveByUser(userId);
    if (linked === undefined) throw new SelfNotLinkedError();
    return linked.id;
  }

  // -- the cascade (manage-side authoring) --------------------------------------------

  @Post("goals")
  @RequirePermissions("hr.performance.manage")
  async createGoal(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = goalBody.parse(body);
    return envelope(
      await this.goals.createGoal({
        cycleId: input.cycleId,
        ownerEmployeeId: input.ownerEmployeeId,
        parentGoalId: input.parentGoalId ?? null,
        title: input.title,
        titleAr: input.titleAr ?? null,
        weight: input.weight,
        kriTarget: input.kriTarget ?? null,
        dueDate: input.dueDate ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Put("goals/:id")
  @RequirePermissions("hr.performance.manage")
  async updateGoal(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = goalPatch.parse(body);
    return envelope(
      await this.goals.updateGoal({
        goalId: id,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.titleAr === undefined ? {} : { titleAr: input.titleAr }),
        ...(input.weight === undefined ? {} : { weight: input.weight }),
        ...(input.parentGoalId === undefined ? {} : { parentGoalId: input.parentGoalId }),
        ...(input.kriTarget === undefined ? {} : { kriTarget: input.kriTarget }),
        ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
        ...(input.status === undefined ? {} : { status: input.status }),
        actorId: identity.userId,
      }),
    );
  }

  /** The cascade tree (the read — any cycle state). */
  @Get("goals/tree")
  @RequirePermissions("hr.performance.view")
  async tree(@Req() request: Request, @Query("cycleId") cycleId: string) {
    requireIdentity(request);
    return envelope(await this.goals.listGoalTree(UUID.parse(cycleId)));
  }

  /**
   * PHASE-047 (W-5 — T-14, the 360 extension's goals panel): any
   * employee's goals (the manage-side read; the OWN plane stays
   * `goals/own` on hr.performance.review — the acting employee's
   * rows through the identity bridge).
   */
  @Get("goals/for-employee/:employeeId")
  @RequirePermissions("hr.performance.view")
  async goalsForEmployee(
    @Req() request: Request,
    @Param("employeeId") employeeId: string,
    @Query("cycleId") cycleId?: string,
  ) {
    requireIdentity(request);
    return envelope(
      await this.goals.listGoalsForEmployee(
        employeeId,
        cycleId === undefined || cycleId === "" ? undefined : cycleId,
      ),
    );
  }

  // -- the own plane (the KRI progress triage) ----------------------------------------

  @Get("goals/own")
  @RequirePermissions("hr.performance.review")
  async ownGoals(@Req() request: Request, @Query("cycleId") cycleId?: string) {
    const identity = requireIdentity(request);
    const ownerEmployeeId = await this.requireOwnEmployeeId(identity.userId);
    return envelope(
      await this.goals.listOwnGoals(
        ownerEmployeeId,
        cycleId === undefined || cycleId === "" ? undefined : cycleId,
      ),
    );
  }

  /** THE KRI PROGRESS TRIAGE: the acting employee updates their OWN
   * goal's KRI actual + progress; the status re-derives from the pure
   * pace fold (≥ 100 ACHIEVED, below pace AT_RISK, else ACTIVE). */
  @Post("goals/:id/progress")
  @RequirePermissions("hr.performance.review")
  async updateProgress(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = progressBody.parse(body);
    const actingEmployeeId = await this.requireOwnEmployeeId(identity.userId);
    return envelope(
      await this.goals.updateOwnGoalProgress({
        goalId: id,
        actingEmployeeId,
        ...(input.kriActual === undefined ? {} : { kriActual: input.kriActual }),
        progressPct: input.progressPct,
        actorId: identity.userId,
      }),
    );
  }

  // -- BR-089's explicit check (the drafting read) -------------------------------------

  @Get("goals/validate")
  @RequirePermissions("hr.performance.view")
  async validate(@Req() request: Request, @Query("cycleId") cycleId: string, @Query("employeeId") employeeId: string) {
    requireIdentity(request);
    return envelope(
      await this.goals.validateGoalWeights(UUID.parse(cycleId), UUID.parse(employeeId)),
    );
  }
}
