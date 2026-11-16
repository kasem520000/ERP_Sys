import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { envelope } from "../../../infra/http/envelope";
import { UnauthenticatedError } from "../../identity/api/identity";
import { LeaveService } from "../application/leave-service";

/**
 * PHASE-045 (T-07) — the leave routes: the type catalog, the balance
 * cells, the request lifecycle (the simple-approval chain — PHASE-052
 * is the upgrade path), the accrual policy run, and the carry-over
 * rollover. Every route rides `hr.leave` (matrix §3.23, the
 * 0086-seeded key). Foreign/unknown ids are 404-shaped (A7).
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
const CODE = z.string().regex(/^[\w\-. ]{1,32}$/, "1–32 chars (letters, digits, dash, dot, space)");
/** The decimal-string law (exact, never float — ADR-0009): days cross
 * the API as strings like "21.00". */
const DAYS = z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, 'a decimal string like "21.00"');
const TEXT = z.string().min(1).max(500).nullable().optional();

const typeBody = z.object({
  code: CODE,
  name: z.string().min(1).max(120),
  nameAr: TEXT,
  paid: z.boolean(),
  accrualDaysPerYear: DAYS,
  monthlyGrant: z.boolean(),
  prorateJoiners: z.boolean(),
  carryOverCapDays: DAYS,
  note: TEXT,
  noteAr: TEXT,
});

const typePatch = z.object({
  name: z.string().min(1).max(120).optional(),
  nameAr: TEXT,
  paid: z.boolean().optional(),
  accrualDaysPerYear: DAYS.optional(),
  monthlyGrant: z.boolean().optional(),
  prorateJoiners: z.boolean().optional(),
  carryOverCapDays: DAYS.optional(),
  note: TEXT,
  noteAr: TEXT,
});

const requestBody = z.object({
  employeeId: UUID,
  leaveTypeId: UUID,
  startDate: DATE,
  endDate: DATE,
  note: TEXT,
});

const accrualBody = z.object({
  leaveTypeId: UUID,
  year: z.number().int().min(2020).max(2100),
  asOfMonth: z.number().int().min(1).max(12).optional(),
});

const rolloverBody = z.object({
  leaveTypeId: UUID,
  fromYear: z.number().int().min(2020).max(2100),
  toYear: z.number().int().min(2020).max(2100),
});

@Controller("api/v1/hr")
export class LeaveController {
  constructor(@Inject(LeaveService) private readonly leave: LeaveService) {}

  // -- the type catalog ------------------------------------------------------------------

  @Post("leave/types")
  @RequirePermissions("hr.leave")
  async createType(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = typeBody.parse(body);
    return envelope(
      await this.leave.createType({
        code: input.code,
        name: input.name,
        nameAr: input.nameAr ?? null,
        paid: input.paid,
        accrualDaysPerYear: input.accrualDaysPerYear,
        monthlyGrant: input.monthlyGrant,
        prorateJoiners: input.prorateJoiners,
        carryOverCapDays: input.carryOverCapDays,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("leave/types")
  @RequirePermissions("hr.leave")
  async listTypes(
    @Req() request: Request,
    @Query("active") active?: string,
    @Query("limit") limit?: string,
  ) {
    requireIdentity(request);
    const activeFilter =
      active === undefined || active === "" ? undefined : active === "true";
    return envelope(
      await this.leave.listTypes({
        ...(activeFilter === undefined ? {} : { active: activeFilter }),
        limit: Math.min(Math.max(Number(limit ?? "100") || 100, 1), 500),
      }),
    );
  }

  @Put("leave/types/:id")
  @RequirePermissions("hr.leave")
  async updateType(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const patch = typePatch.parse(body);
    return envelope(
      await this.leave.updateType(
        id,
        {
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.nameAr === undefined ? {} : { nameAr: patch.nameAr }),
          ...(patch.paid === undefined ? {} : { paid: patch.paid }),
          ...(patch.accrualDaysPerYear === undefined ? {} : { accrualDaysPerYear: patch.accrualDaysPerYear }),
          ...(patch.monthlyGrant === undefined ? {} : { monthlyGrant: patch.monthlyGrant }),
          ...(patch.prorateJoiners === undefined ? {} : { prorateJoiners: patch.prorateJoiners }),
          ...(patch.carryOverCapDays === undefined ? {} : { carryOverCapDays: patch.carryOverCapDays }),
          ...(patch.note === undefined ? {} : { note: patch.note }),
          ...(patch.noteAr === undefined ? {} : { noteAr: patch.noteAr }),
        },
        identity.userId,
      ),
    );
  }

  @Post("leave/types/:id/activate")
  @RequirePermissions("hr.leave")
  async activateType(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.leave.setTypeActive(id, true, identity.userId));
  }

  @Post("leave/types/:id/deactivate")
  @RequirePermissions("hr.leave")
  async deactivateType(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.leave.setTypeActive(id, false, identity.userId));
  }

  // -- the balances ------------------------------------------------------------------------

  @Get("leave/balances")
  @RequirePermissions("hr.leave")
  async balances(
    @Req() request: Request,
    @Query("employeeId") employeeId?: string,
    @Query("year") year?: string,
  ) {
    requireIdentity(request);
    return envelope(
      await this.leave.balances({
        ...(employeeId === undefined || employeeId === "" ? {} : { employeeId }),
        ...(year === undefined || year === "" ? {} : { year: Number(year) }),
      }),
    );
  }

  // -- the request lifecycle ------------------------------------------------------------------

  @Post("leave/requests")
  @RequirePermissions("hr.leave")
  async createRequest(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = requestBody.parse(body);
    return envelope(
      await this.leave.createRequest({
        employeeId: input.employeeId,
        leaveTypeId: input.leaveTypeId,
        startDate: input.startDate,
        endDate: input.endDate,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("leave/requests/:id/approve")
  @RequirePermissions("hr.leave")
  async approve(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z.object({ note: TEXT }).parse(body);
    return envelope(await this.leave.approve(id, input.note ?? null, identity.userId));
  }

  @Post("leave/requests/:id/reject")
  @RequirePermissions("hr.leave")
  async reject(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z.object({ note: TEXT }).parse(body);
    return envelope(await this.leave.decideAgainst(id, "REJECTED", input.note ?? null, identity.userId));
  }

  @Post("leave/requests/:id/cancel")
  @RequirePermissions("hr.leave")
  async cancel(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z.object({ note: TEXT }).parse(body);
    return envelope(await this.leave.decideAgainst(id, "CANCELLED", input.note ?? null, identity.userId));
  }

  @Get("leave/requests")
  @RequirePermissions("hr.leave")
  async listRequests(
    @Req() request: Request,
    @Query("from") from: string,
    @Query("to") to: string,
    @Query("employeeId") employeeId?: string,
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    requireIdentity(request);
    const employeeIds =
      employeeId === undefined || employeeId === "" ? undefined : [employeeId];
    return envelope(
      await this.leave.listRequests({
        from,
        to,
        employeeIds,
        ...(status === undefined || status === "" ? {} : { status }),
        ...(page === undefined || page === "" ? {} : { page: Number(page) }),
        ...(pageSize === undefined || pageSize === "" ? {} : { pageSize: Number(pageSize) }),
      }),
    );
  }

  // -- the accrual run + the rollover -------------------------------------------------------------

  @Post("leave/accrual")
  @RequirePermissions("hr.leave")
  async runAccrual(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = accrualBody.parse(body);
    return envelope(
      await this.leave.runAccrual({
        leaveTypeId: input.leaveTypeId,
        year: input.year,
        ...(input.asOfMonth === undefined ? {} : { asOfMonth: input.asOfMonth }),
        actorId: identity.userId,
      }),
    );
  }

  @Post("leave/rollover")
  @RequirePermissions("hr.leave")
  async rollover(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = rolloverBody.parse(body);
    return envelope(
      await this.leave.rollover({
        leaveTypeId: input.leaveTypeId,
        fromYear: input.fromYear,
        toYear: input.toYear,
        actorId: identity.userId,
      }),
    );
  }
}
