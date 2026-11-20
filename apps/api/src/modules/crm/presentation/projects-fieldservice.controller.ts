import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { envelope } from "../../../infra/http/envelope";
import { UnauthenticatedError } from "../../identity/api/identity";
import { FieldserviceService } from "../application/fieldservice-service";

/**
 * PHASE-048 (W-12 — T-13) — the field-service routes (D-12 — PR-13/14/15,
 * BR-096): the dispatch board on the EXISTING service_orders (never a new
 * order surface). The status machine's transitions + the SLA pause states
 * are the dispatch key's write surface (matrix §3.26's own wording); the
 * board + the visit reads + THE SINGLE CLOCK's evaluation ride the view
 * key. The entitlement plane rides the projects.fieldservice feature flag
 * (D-16) on every route.
 *
 * The envelope law (the T-14 repair): every site awaits its service call
 * INSIDE envelope(...).
 */

function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const TIMESTAMP = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/,
    "an ISO-8601 timestamp with offset",
  );
const UUID = z.string().uuid();
const TEXT = z.string().max(4000).nullable().optional();

const visitCreateSchema = z.object({
  serviceOrderId: UUID,
  technicianEmployeeId: UUID.nullable().optional(),
  scheduledStart: TIMESTAMP,
  scheduledEnd: TIMESTAMP,
  note: z.string().max(2000).nullable().optional(),
  noteAr: z.string().max(2000).nullable().optional(),
});

const visitScheduleSchema = z.object({
  scheduledStart: TIMESTAMP,
  scheduledEnd: TIMESTAMP,
  technicianEmployeeId: UUID.nullable().optional(),
});

const visitDispatchSchema = z.object({
  technicianEmployeeId: UUID.nullable().optional(),
});

const visitCompleteSchema = z.object({
  completionNotes: TEXT,
  completionNotesAr: TEXT,
  /** Issue the order's pending PARTS lines through the service-order
   * line issue path at completion (the WMS movement core). */
  issueParts: z.boolean().optional(),
});

const listQuerySchema = z.object({
  serviceOrderId: UUID.optional(),
  technicianEmployeeId: UUID.optional(),
  status: z
    .enum(["NEW", "SCHEDULED", "DISPATCHED", "IN_PROGRESS", "COMPLETED", "CLOSED"])
    .optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

@Controller("api/v1/projects")
export class ProjectsFieldserviceController {
  constructor(
    @Inject(FieldserviceService) private readonly fieldservice: FieldserviceService,
  ) {}

  // -- the board (the view key) -------------------------------------------------

  @Get("fieldservice/visits")
  @RequirePermissions("projects.fieldservice.view")
  @RequireFeature("projects.fieldservice")
  async board(@Query() query: unknown) {
    const filter = listQuerySchema.parse(query ?? {});
    return envelope(await this.fieldservice.board(filter));
  }

  @Get("fieldservice/visits/:id")
  @RequirePermissions("projects.fieldservice.view")
  @RequireFeature("projects.fieldservice")
  async getVisit(@Param("id") id: string) {
    return envelope(await this.fieldservice.find(id));
  }

  /** THE SINGLE CLOCK'S EVALUATION — both SLA clocks (pause-aware) +
   * BR-096's escalation (the deduped inbox notification fires on this
   * surface; the board listing stays a pure read). */
  @Get("fieldservice/visits/:id/sla")
  @RequirePermissions("projects.fieldservice.view")
  @RequireFeature("projects.fieldservice")
  async sla(@Param("id") id: string) {
    return envelope(await this.fieldservice.slaEvaluation(id));
  }

  // -- the machine (the dispatch key — the write surface) ------------------------

  @Post("fieldservice/visits")
  @RequirePermissions("projects.fieldservice.dispatch")
  @RequireFeature("projects.fieldservice")
  async createVisit(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = visitCreateSchema.parse(body);
    return envelope(
      await this.fieldservice.createVisit({
        serviceOrderId: input.serviceOrderId,
        technicianEmployeeId: input.technicianEmployeeId ?? null,
        scheduledStart: input.scheduledStart,
        scheduledEnd: input.scheduledEnd,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  /** NEW → SCHEDULED (the window + an optional technician); a SCHEDULED
   * visit may re-schedule — the planning plane ends at dispatch. */
  @Post("fieldservice/visits/:id/schedule")
  @RequirePermissions("projects.fieldservice.dispatch")
  @RequireFeature("projects.fieldservice")
  @HttpCode(HttpStatus.OK)
  async scheduleVisit(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = visitScheduleSchema.parse(body);
    return envelope(
      await this.fieldservice.schedule(id, {
        scheduledStart: input.scheduledStart,
        scheduledEnd: input.scheduledEnd,
        technicianEmployeeId: input.technicianEmployeeId ?? null,
        actorId: identity.userId,
      }),
    );
  }

  /** → DISPATCHED — the technician becomes required (the board's law);
   * the SLA clocks start at the dispatch stamp. */
  @Post("fieldservice/visits/:id/dispatch")
  @RequirePermissions("projects.fieldservice.dispatch")
  @RequireFeature("projects.fieldservice")
  @HttpCode(HttpStatus.OK)
  async dispatchVisit(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = visitDispatchSchema.parse(body ?? {});
    return envelope(
      await this.fieldservice.dispatch(id, {
        technicianEmployeeId: input.technicianEmployeeId ?? null,
        actorId: identity.userId,
      }),
    );
  }

  /** The SLA response event — idempotent (the first response stamps the
   * clock's end; replays return the row unchanged). */
  @Post("fieldservice/visits/:id/respond")
  @RequirePermissions("projects.fieldservice.dispatch")
  @RequireFeature("projects.fieldservice")
  @HttpCode(HttpStatus.OK)
  async respondVisit(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.fieldservice.respond(id, { actorId: identity.userId }));
  }

  @Post("fieldservice/visits/:id/start")
  @RequirePermissions("projects.fieldservice.dispatch")
  @RequireFeature("projects.fieldservice")
  @HttpCode(HttpStatus.OK)
  async startVisit(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.fieldservice.start(id, { actorId: identity.userId }));
  }

  /** The pause — the in-progress plane only; the event lands on the
   * append-only audit trail (the single clock's raw input). */
  @Post("fieldservice/visits/:id/pause")
  @RequirePermissions("projects.fieldservice.dispatch")
  @RequireFeature("projects.fieldservice")
  @HttpCode(HttpStatus.OK)
  async pauseVisit(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.fieldservice.pause(id, { actorId: identity.userId }));
  }

  @Post("fieldservice/visits/:id/resume")
  @RequirePermissions("projects.fieldservice.dispatch")
  @RequireFeature("projects.fieldservice")
  @HttpCode(HttpStatus.OK)
  async resumeVisit(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.fieldservice.resume(id, { actorId: identity.userId }));
  }

  /** IN_PROGRESS → COMPLETED — the notes land on the visit; the parts
   * used ride the service-order line issue path (the WMS movement core)
   * in the same transaction (all-or-nothing). */
  @Post("fieldservice/visits/:id/complete")
  @RequirePermissions("projects.fieldservice.dispatch")
  @RequireFeature("projects.fieldservice")
  @HttpCode(HttpStatus.OK)
  async completeVisit(
    @Req() request: Request,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const identity = requireIdentity(request);
    const input = visitCompleteSchema.parse(body ?? {});
    return envelope(
      await this.fieldservice.complete(id, {
        completionNotes: input.completionNotes ?? null,
        completionNotesAr: input.completionNotesAr ?? null,
        issueParts: input.issueParts === true,
        actorId: identity.userId,
      }),
    );
  }

  /** COMPLETED → CLOSED — terminal. */
  @Post("fieldservice/visits/:id/close")
  @RequirePermissions("projects.fieldservice.dispatch")
  @RequireFeature("projects.fieldservice")
  @HttpCode(HttpStatus.OK)
  async closeVisit(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.fieldservice.close(id, { actorId: identity.userId }));
  }
}
