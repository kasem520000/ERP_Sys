import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { envelope } from "../../../infra/http/envelope";
import { UnauthenticatedError } from "../../identity/api/identity";
import { WbsService } from "../application/wbs-service";

/**
 * PHASE-048 (W-9 — T-05) — the WBS routes (BR-095/D-03): the tree with
 * the leaf-recomputed rollup on every read, the node-by-node rollup
 * read (acceptance #2's reconciliation arm), and the authoring +
 * MOVE path (the ONLY way a parent or predecessor edge ever changes —
 * the cycle guards run before every write). Permissions: matrix §3.26's
 * projects.wbs.view/manage (the W-8 keys); the entitlement plane rides
 * the projects.wbs feature flag (the entitlement/authorization
 * separation — D-16).
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
const CODE = z.string().regex(/^[A-Za-z0-9._/-]{1,40}$/, "expected a WBS code");
const WEIGHT = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,4})?$/, "expected a decimal (≤ 4dp)")
  .nullable();
const PCT = z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, 'expected a decimal string like "55.50"');
const TEXT = z.string().min(1).max(500).nullable().optional();

const createTaskSchema = z.object({
  parentTaskId: UUID.nullable().optional(),
  predecessorTaskId: UUID.nullable().optional(),
  wbsCode: CODE,
  name: z.string().min(1).max(200),
  nameAr: TEXT,
  isMilestone: z.boolean().optional(),
  startDate: DATE.nullable().optional(),
  endDate: DATE.nullable().optional(),
  weight: WEIGHT.optional(),
  percentComplete: PCT.optional(),
  note: TEXT,
  noteAr: TEXT,
});

const updateTaskSchema = z.object({
  parentTaskId: UUID.nullable().optional(),
  predecessorTaskId: UUID.nullable().optional(),
  wbsCode: CODE.optional(),
  name: z.string().min(1).max(200).optional(),
  nameAr: TEXT,
  isMilestone: z.boolean().optional(),
  startDate: DATE.nullable().optional(),
  endDate: DATE.nullable().optional(),
  weight: WEIGHT.optional(),
  percentComplete: PCT.optional(),
  note: TEXT,
  noteAr: TEXT,
});

@Controller("api/v1/projects")
export class ProjectsWbsController {
  constructor(@Inject(WbsService) private readonly wbs: WbsService) {}

  /** The tree — every node carries its leaf-recomputed rollup (BR-095:
   * recomputed on EVERY read, never a stored stale sum). */
  @Get(":projectId/wbs")
  @RequirePermissions("projects.wbs.view")
  @RequireFeature("projects.wbs")
  async tree(@Param("projectId") projectId: string) {
    return envelope(await this.wbs.tree(projectId));
  }

  /** The node-by-node rollup (acceptance #2's reconciliation arm). */
  @Get(":projectId/wbs/rollup")
  @RequirePermissions("projects.wbs.view")
  @RequireFeature("projects.wbs")
  async rollup(@Param("projectId") projectId: string) {
    return envelope(await this.wbs.rollup(projectId));
  }

  @Post(":projectId/wbs/tasks")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("projects.wbs.manage")
  @RequireFeature("projects.wbs")
  async createTask(
    @Req() request: Request,
    @Param("projectId") projectId: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = createTaskSchema.parse(body);
    return envelope(
      await this.wbs.createTask({
        projectId,
        parentTaskId: input.parentTaskId ?? null,
        predecessorTaskId: input.predecessorTaskId ?? null,
        wbsCode: input.wbsCode,
        name: input.name,
        nameAr: input.nameAr ?? null,
        isMilestone: input.isMilestone ?? false,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        weight: input.weight === undefined ? null : input.weight,
        percentComplete: input.percentComplete ?? "0.00",
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  /** The MOVE path — the API is the ONLY way an edge changes (D-03);
   * both cycle guards re-run on every write. */
  @Patch("wbs/tasks/:id")
  @RequirePermissions("projects.wbs.manage")
  @RequireFeature("projects.wbs")
  async updateTask(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = updateTaskSchema.parse(body ?? {});
    return envelope(
      await this.wbs.updateTask(id, {
        parentTaskId: input.parentTaskId,
        predecessorTaskId: input.predecessorTaskId,
        wbsCode: input.wbsCode,
        name: input.name,
        nameAr: input.nameAr,
        isMilestone: input.isMilestone,
        startDate: input.startDate,
        endDate: input.endDate,
        weight: input.weight,
        percentComplete: input.percentComplete,
        note: input.note,
        noteAr: input.noteAr,
        actorId: identity.userId,
      }),
    );
  }

  /** Children-first (the RESTRICT edges' typed guard). */
  @Delete("wbs/tasks/:id")
  @RequirePermissions("projects.wbs.manage")
  @RequireFeature("projects.wbs")
  async deleteTask(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    await this.wbs.deleteTask(id, identity.userId);
    return envelope({ deleted: true, id });
  }
}
