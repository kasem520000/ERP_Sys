import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { envelope } from "../../../infra/http/envelope";
import { UnauthenticatedError } from "../../identity/api/identity";
import { SelfServiceService } from "../application/self-service-service";

/**
 * PHASE-045 (T-14) — the employee self-service routes: the OWN-ROWS
 * plane (own attendance calendar, own leave request + balance, own
 * roster — the plan's self-service tabs).
 *
 * THE PERMISSION SHAPE (matrix §3.23 + the 0086 seed note): every route
 * rides `hr.self_service` marked `self: true` — the key is
 * runtime-granted to EVERY authenticated user (the SELF_SCOPE_KEYS
 * mechanism, the identity.mfa.manage precedent), and the OWNERSHIP
 * boundary is the identity bridge itself: the employee scope is
 * resolved from the acting user, never from a client-supplied id. A
 * user with no link is nobody's employee here — the summary renders
 * `employee: null` (the honest empty state) and every scoped route
 * refuses with HR_SELF_NOT_LINKED (422). NO hr management key guards
 * this plane (an employee needs no hr.leave to see their own balance)
 * and this plane grants NO management surface (the SoD law's read-side
 * twin — the 0086 seed comment's "application boundary" grant).
 *
 * The ONE write surface is deliberately narrow: create-own-request and
 * cancel-own-PENDING — approve/reject stay on /hr/leave under
 * hr.leave (the simple-approval chain, PHASE-052's upgrade path).
 */
function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date (YYYY-MM-DD)");
const UUID = z.string().uuid();

/** The own-request create body — NOTE: NO employeeId (the scope law:
 * the employee is resolved from the acting user through the bridge; a
 * client-supplied id would be someone else's leave). */
export const selfLeaveRequestBody = z.object({
  leaveTypeId: UUID,
  startDate: DATE,
  endDate: DATE,
  note: z.string().min(1).max(500).nullable().optional(),
});

@Controller("api/v1/hr/self")
export class SelfServiceController {
  constructor(@Inject(SelfServiceService) private readonly self: SelfServiceService) {}

  @Get("summary")
  @RequirePermissions("hr.self_service", { self: true })
  async summary(@Req() request: Request) {
    const identity = requireIdentity(request);
    return envelope(await this.self.summary(identity.userId));
  }

  @Get("attendance")
  @RequirePermissions("hr.self_service", { self: true })
  async attendance(@Req() request: Request, @Query("from") from: string, @Query("to") to: string) {
    const identity = requireIdentity(request);
    return envelope(await this.self.attendance(identity.userId, { from, to }));
  }

  @Get("roster")
  @RequirePermissions("hr.self_service", { self: true })
  async roster(
    @Req() request: Request,
    @Query("from") from: string,
    @Query("to") to: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    const identity = requireIdentity(request);
    return envelope(
      await this.self.roster(identity.userId, {
        from,
        to,
        ...(page === undefined || page === "" ? {} : { page: Number(page) }),
        ...(pageSize === undefined || pageSize === "" ? {} : { pageSize: Number(pageSize) }),
      }),
    );
  }

  @Get("leave/types")
  @RequirePermissions("hr.self_service", { self: true })
  async leaveTypes(@Req() request: Request) {
    const identity = requireIdentity(request);
    return envelope(await this.self.leaveTypes(identity.userId));
  }

  @Get("leave/balances")
  @RequirePermissions("hr.self_service", { self: true })
  async leaveBalances(@Req() request: Request, @Query("year") year?: string) {
    const identity = requireIdentity(request);
    return envelope(
      await this.self.leaveBalances(
        identity.userId,
        year === undefined || year === "" ? undefined : Number(year),
      ),
    );
  }

  @Get("leave/requests")
  @RequirePermissions("hr.self_service", { self: true })
  async leaveRequests(
    @Req() request: Request,
    @Query("from") from: string,
    @Query("to") to: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    const identity = requireIdentity(request);
    return envelope(
      await this.self.leaveRequests(identity.userId, {
        from,
        to,
        ...(page === undefined || page === "" ? {} : { page: Number(page) }),
        ...(pageSize === undefined || pageSize === "" ? {} : { pageSize: Number(pageSize) }),
      }),
    );
  }

  /** The own-request create — the body carries NO employeeId (the
   * scope law above; the typed 422 names the absent field never —
   * the resolver simply ignores any such attempt at the schema). */
  @Post("leave/requests")
  @RequirePermissions("hr.self_service", { self: true })
  async createLeaveRequest(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = selfLeaveRequestBody.parse(body);
    return envelope(
      await this.self.createLeaveRequest(identity.userId, {
        leaveTypeId: input.leaveTypeId,
        startDate: input.startDate,
        endDate: input.endDate,
        note: input.note ?? null,
      }),
    );
  }

  /** Cancel the OWN pending request (the one decision an employee
   * owns). */
  @Post("leave/requests/:id/cancel")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("hr.self_service", { self: true })
  async cancelLeaveRequest(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z.object({ note: z.string().min(1).max(500).nullable().optional() }).parse(body);
    return envelope(await this.self.cancelLeaveRequest(identity.userId, UUID.parse(id), input.note ?? null));
  }
}
