import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { envelope } from "../../../infra/http/envelope";
import { UnauthenticatedError } from "../../identity/api/identity";
import { ProjectBudgetService } from "../application/project-budget-service";

/**
 * PHASE-048 (W-9 — T-06) — the budget + allocation routes (D-04): the
 * DRAFT→APPROVED→CLOSED lifecycle (the CAS transitions), the DRAFT
 * bulk-replace of the curve's cells, the APPROVED cost curve + the
 * vs-actual rollup (by cost type and by node), and the resource
 * allocations with their over-allocation WARNING — the READ-side
 * signal (0101's recorded law: never a write refusal). Permissions:
 * matrix §3.26's projects.budget.view/manage +
 * projects.allocation.manage (the W-8 keys); the entitlement plane
 * rides the projects.wbs feature flag (the cost plan is the WBS
 * plane's — D-16).
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
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const MONEY4 = z.string().regex(/^\d+(\.\d{1,4})?$/, "expected a decimal (≤ 4dp)");
const PCT = z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, 'expected a decimal string like "55.50"');
const TEXT = z.string().min(1).max(500).nullable().optional();

const createBudgetSchema = z.object({
  name: z.string().min(1).max(120),
  nameAr: TEXT,
  note: TEXT,
});

const lineSchema = z.object({
  costType: z.enum(["LABOR", "MATERIAL", "SUBCONTRACT", "OVERHEAD"]),
  wbsTaskId: UUID.nullable().optional(),
  periodStart: DATE,
  periodEnd: DATE,
  plannedAmount: MONEY4,
  note: TEXT,
});

const replaceLinesSchema = z.object({ lines: z.array(lineSchema).max(2000) });

const allocationSchema = z.object({
  wbsTaskId: UUID.nullable().optional(),
  resourceKind: z.enum(["EMPLOYEE", "ASSET"]),
  employeeId: UUID.nullable().optional(),
  assetId: UUID.nullable().optional(),
  startDate: DATE,
  endDate: DATE,
  allocationPercent: PCT,
  note: TEXT,
  noteAr: TEXT,
});

@Controller("api/v1/projects")
export class ProjectsBudgetsController {
  constructor(@Inject(ProjectBudgetService) private readonly budgets: ProjectBudgetService) {}

  // -- the budget lifecycle -----------------------------------------------------------

  @Get(":projectId/budgets")
  @RequirePermissions("projects.budget.view")
  @RequireFeature("projects.wbs")
  async listBudgets(@Param("projectId") projectId: string) {
    return envelope(await this.budgets.listBudgets(projectId));
  }

  @Post(":projectId/budgets")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("projects.budget.manage")
  @RequireFeature("projects.wbs")
  async createBudget(
    @Req() request: Request,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = createBudgetSchema.parse(body);
    return envelope(
      await this.budgets.createBudget({
        projectId,
        name: input.name,
        nameAr: input.nameAr ?? null,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("budgets/:id/lines")
  @RequirePermissions("projects.budget.view")
  @RequireFeature("projects.wbs")
  async listLines(@Param("id") id: string) {
    return envelope(await this.budgets.listLines(id));
  }

  /** The DRAFT bulk-replace (the 028 precedent — the service refuses a
   * non-DRAFT parent). */
  @Put("budgets/:id/lines")
  @RequirePermissions("projects.budget.manage")
  @RequireFeature("projects.wbs")
  async replaceLines(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = replaceLinesSchema.parse(body ?? {});
    return envelope(
      await this.budgets.replaceLines(
        id,
        input.lines.map((line) => ({
          costType: line.costType,
          wbsTaskId: line.wbsTaskId ?? null,
          periodStart: line.periodStart,
          periodEnd: line.periodEnd,
          plannedAmount: line.plannedAmount,
          note: line.note ?? null,
        })),
        identity.userId,
      ),
    );
  }

  @Post("budgets/:id/approve")
  @RequirePermissions("projects.budget.manage")
  @RequireFeature("projects.wbs")
  async approve(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.budgets.approve(id, identity.userId));
  }

  @Post("budgets/:id/close")
  @RequirePermissions("projects.budget.manage")
  @RequireFeature("projects.wbs")
  async close(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.budgets.close(id, identity.userId));
  }

  // -- the cost curve + the vs-actual rollup (D-04) ------------------------------------

  /** The APPROVED curve alone (the one PV reads — the plan's wording);
   * the point-in-time accrual is the pure exact fold. */
  @Get(":projectId/budget-curve")
  @RequirePermissions("projects.budget.view")
  @RequireFeature("projects.wbs")
  async curve(@Param("projectId") projectId: string, @Query("asOf") asOf?: string) {
    return envelope(await this.budgets.curve(projectId, asOf ?? new Date().toISOString().slice(0, 10)));
  }

  /** Planned (the APPROVED curve) vs actual (the four collectors) by
   * cost type and by WBS node. */
  @Get(":projectId/budget-vs-actual")
  @RequirePermissions("projects.budget.view")
  @RequireFeature("projects.wbs")
  async vsActual(@Param("projectId") projectId: string, @Query("asOf") asOf?: string) {
    return envelope(
      await this.budgets.vsActual(projectId, asOf ?? new Date().toISOString().slice(0, 10)),
    );
  }

  // -- the resource allocations (+ the READ-side warning) -------------------------------

  @Get(":projectId/allocations")
  @RequirePermissions("projects.allocation.manage")
  @RequireFeature("projects.wbs")
  async listAllocations(@Param("projectId") projectId: string) {
    return envelope(await this.budgets.listAllocations(projectId));
  }

  @Post(":projectId/allocations")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("projects.allocation.manage")
  @RequireFeature("projects.wbs")
  async createAllocation(
    @Req() request: Request,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = allocationSchema.parse(body);
    return envelope(
      await this.budgets.createAllocation({
        projectId,
        wbsTaskId: input.wbsTaskId ?? null,
        resourceKind: input.resourceKind,
        employeeId: input.employeeId ?? null,
        assetId: input.assetId ?? null,
        startDate: input.startDate,
        endDate: input.endDate,
        allocationPercent: input.allocationPercent,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Delete("allocations/:id")
  @RequirePermissions("projects.allocation.manage")
  @RequireFeature("projects.wbs")
  async deleteAllocation(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    await this.budgets.deleteAllocation(id, identity.userId);
    return envelope({ deleted: true, id });
  }

  /** The over-allocation WARNING — a read signal, never a write
   * refusal (0101's recorded law). */
  @Get(":projectId/allocation-warnings")
  @RequirePermissions("projects.allocation.manage")
  @RequireFeature("projects.wbs")
  async allocationWarnings(@Param("projectId") projectId: string) {
    return envelope(await this.budgets.overAllocationWarnings(projectId));
  }
}
