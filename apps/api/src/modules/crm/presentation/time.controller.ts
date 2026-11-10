import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { UnauthenticatedError } from "../../identity/api/identity";
import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { RequireFeature } from "../../../infra/auth/require-feature.decorator";
import { envelope } from "../../../infra/http/envelope";
import { TimeEntryService } from "../application/time-entry-service";

/**
 * Time-entry routes (PHASE-019 §11 rows 32–36; MASTER-PLAN §6): timeslips
 * (SERVICE fee items, rate snapshotted at recording) + the weekly
 * timesheet review (the batch DRAFT → APPROVED flip that gates billing).
 * Permission `crm.contracts.manage`, BR-039 feature `crm.service_contracts`
 * (the time surface rides the contracts entitlement). Time feeds billing
 * ONLY — no payroll, no staff cost.
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
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
const QTY6 = z.string().regex(/^\d+(\.\d{1,6})?$/, "expected a decimal (≤ 6dp)");

const createSchema = z.object({
  entryDate: DATE,
  hours: QTY6,
  feeItemId: UUID,
  projectId: UUID.nullable().optional(),
  contractId: UUID.nullable().optional(),
  feeEarnerUserId: UUID.nullable().optional(),
  unitRate: QTY6.nullable().optional(),
  narrative: z.string().min(1).max(2000).nullable().optional(),
  billable: z.boolean().optional(),
});

const updateSchema = z.object({
  entryDate: DATE.optional(),
  hours: QTY6.optional(),
  feeItemId: UUID.optional(),
  projectId: UUID.nullable().optional(),
  contractId: UUID.nullable().optional(),
  feeEarnerUserId: UUID.nullable().optional(),
  unitRate: QTY6.optional(),
  narrative: z.string().min(1).max(2000).nullable().optional(),
  billable: z.boolean().optional(),
});

/** {weekStart} — a Monday ISO date (the service enforces Monday-ness). */
const reviewSchema = z.object({ weekStart: DATE });

@Controller("api/v1/crm")
export class TimeController {
  constructor(@Inject(TimeEntryService) private readonly time: TimeEntryService) {}

  @Get("time-entries")
  @RequirePermissions("crm.contracts.manage")
  @RequireFeature("crm.service_contracts")
  async list(
    @Req() request: Request,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("projectId") projectId?: string,
    @Query("mine") mine?: string,
    @Query("limit") limit?: string,
  ) {
    const identity = requireIdentity(request);
    return envelope(
      await this.time.list({
        fromDate: from && DATE.safeParse(from).success ? from : undefined,
        toDate: to && DATE.safeParse(to).success ? to : undefined,
        projectId: projectId && UUID.safeParse(projectId).success ? projectId : undefined,
        feeEarnerUserId: mine === "true" ? identity.userId : undefined,
        limit: LIMIT.parse(limit ?? 100),
      }),
    );
  }

  @Post("time-entries")
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions("crm.contracts.manage")
  @RequireFeature("crm.service_contracts")
  async create(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = createSchema.parse(body);
    return envelope(
      await this.time.create({
        entryDate: input.entryDate,
        hours: input.hours,
        feeItemId: input.feeItemId,
        projectId: input.projectId ?? null,
        contractId: input.contractId ?? null,
        feeEarnerUserId: input.feeEarnerUserId ?? null,
        unitRate: input.unitRate ?? null,
        narrative: input.narrative ?? null,
        billable: input.billable ?? true,
        actorId: identity.userId,
      }),
    );
  }

  @Put("time-entries/:id")
  @RequirePermissions("crm.contracts.manage")
  @RequireFeature("crm.service_contracts")
  async update(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = updateSchema.parse(body ?? {});
    return envelope(
      await this.time.update(id, {
        entryDate: input.entryDate,
        hours: input.hours,
        feeItemId: input.feeItemId,
        projectId: input.projectId,
        contractId: input.contractId,
        feeEarnerUserId: input.feeEarnerUserId,
        unitRate: input.unitRate,
        narrative: input.narrative,
        billable: input.billable,
        actorId: identity.userId,
      }),
    );
  }

  @Post("time-entries/:id/void")
  @RequirePermissions("crm.contracts.manage")
  @RequireFeature("crm.service_contracts")
  async void(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.time.void(id, identity.userId));
  }

  /** Row 36 — the weekly review (Monday weekStart; the batch flip). */
  @Post("time/timesheets/review")
  @RequirePermissions("crm.contracts.manage")
  @RequireFeature("crm.service_contracts")
  async reviewTimesheet(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const { weekStart } = reviewSchema.parse(body);
    return envelope(
      await this.time.reviewTimesheet({ weekStart, actorId: identity.userId }),
    );
  }
}
