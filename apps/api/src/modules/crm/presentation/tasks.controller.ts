import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { TaskService } from "../application/task-service";
import { ActivityService } from "../application/activity-service";

/**
 * Task + activity routes (PHASE-019 §11 rows 10–16; matrix §3.8): future
 * work (crm_tasks — the OPEN → DONE/CANCELLED lifecycle) and the logged
 * past (crm_activities — the timeline). Task routes are permission-guarded
 * on the seeded `crm.tasks.manage` key, activity routes on
 * `crm.activities.manage`, both BR-039 feature-gated on
 * `crm.tasks_activities`, Idempotency-Key'd by the global POST guard, and
 * success-enveloped. Foreign or unknown ids are 404-shaped (A7). No money,
 * no numbering, no ledger effects (MASTER-PLAN §3).
 *
 * Shares the `api/v1/crm` prefix with LeadsController so the registered
 * route-permissions rows match byte-for-byte.
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
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date (YYYY-MM-DD)");
const DATETIME = z.string().datetime();
const NOTE = z.string().min(1).max(500).nullable().optional();
const RELATED_TYPE = z.enum(["LEAD", "PARTNER", "CONTRACT", "SERVICE_ORDER"]);

const taskCreateSchema = z.object({
  title: z.string().min(1).max(200),
  relatedType: RELATED_TYPE,
  relatedId: UUID,
  assigneeUserId: UUID.nullable().optional(),
  dueDate: DATE.nullable().optional(),
  remindAt: DATETIME.nullable().optional(),
  note: NOTE,
  noteAr: NOTE,
});

const taskUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  assigneeUserId: UUID.nullable().optional(),
  dueDate: DATE.nullable().optional(),
  remindAt: DATETIME.nullable().optional(),
  note: NOTE,
  noteAr: NOTE,
});

const activityCreateSchema = z.object({
  kind: z.enum(["CALL", "MEETING", "EMAIL", "NOTE"]),
  relatedType: RELATED_TYPE,
  relatedId: UUID,
  occurredAt: DATETIME,
  summary: z.string().min(1).max(2000),
  durationMinutes: z.coerce.number().int().min(0).nullable().optional(),
  actorUserId: UUID.nullable().optional(),
});

@Controller("api/v1/crm")
export class TasksController {
  constructor(
    @Inject(TaskService) private readonly tasks: TaskService,
    @Inject(ActivityService) private readonly activities: ActivityService,
  ) {}

  @Get("tasks")
  @RequirePermissions("crm.tasks.manage")
  @RequireFeature("crm.tasks_activities")
  async list(
    @Query("status") status?: string,
    @Query("relatedType") relatedType?: string,
    @Query("relatedId") relatedId?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.tasks.list({
        status,
        relatedType: relatedType && RELATED_TYPE.safeParse(relatedType).success ? relatedType : undefined,
        relatedId: relatedId && UUID.safeParse(relatedId).success ? relatedId : undefined,
        limit: LIMIT.parse(limit ?? 100),
      }),
    );
  }

  @Post("tasks")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("crm.tasks.manage")
  @RequireFeature("crm.tasks_activities")
  async create(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = taskCreateSchema.parse(body);
    return envelope(
      await this.tasks.create({
        title: input.title,
        relatedType: input.relatedType,
        relatedId: input.relatedId,
        assigneeUserId: input.assigneeUserId ?? null,
        dueDate: input.dueDate ?? null,
        remindAt: input.remindAt ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Put("tasks/:id")
  @RequirePermissions("crm.tasks.manage")
  @RequireFeature("crm.tasks_activities")
  async update(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = taskUpdateSchema.parse(body ?? {});
    return envelope(
      await this.tasks.update(
        id,
        {
          title: input.title,
          assigneeUserId: input.assigneeUserId,
          dueDate: input.dueDate,
          remindAt: input.remindAt,
          note: input.note,
          noteAr: input.noteAr,
        },
        identity.userId,
      ),
    );
  }

  @Post("tasks/:id/complete")
  @RequirePermissions("crm.tasks.manage")
  @RequireFeature("crm.tasks_activities")
  async complete(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.tasks.complete(id, identity.userId));
  }

  @Post("tasks/:id/cancel")
  @RequirePermissions("crm.tasks.manage")
  @RequireFeature("crm.tasks_activities")
  async cancel(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.tasks.cancel(id, identity.userId));
  }

  @Get("activities")
  @RequirePermissions("crm.activities.manage")
  @RequireFeature("crm.tasks_activities")
  async listActivities(
    @Query("relatedType") relatedType?: string,
    @Query("relatedId") relatedId?: string,
    @Query("limit") limit?: string,
  ) {
    return envelope(
      await this.activities.list({
        relatedType: relatedType && RELATED_TYPE.safeParse(relatedType).success ? relatedType : undefined,
        relatedId: relatedId && UUID.safeParse(relatedId).success ? relatedId : undefined,
        limit: LIMIT.parse(limit ?? 100),
      }),
    );
  }

  @Post("activities")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("crm.activities.manage")
  @RequireFeature("crm.tasks_activities")
  async logActivity(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = activityCreateSchema.parse(body);
    return envelope(
      await this.activities.create({
        kind: input.kind,
        relatedType: input.relatedType,
        relatedId: input.relatedId,
        occurredAt: input.occurredAt,
        summary: input.summary,
        durationMinutes: input.durationMinutes ?? null,
        actorUserId: input.actorUserId ?? null,
        createdBy: identity.userId,
      }),
    );
  }
}
