import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { envelope } from "../../../infra/http/envelope";
import { UnauthenticatedError } from "../../identity/api/identity";
import { LeavePostingService } from "../application/leave-posting-service";

/**
 * PHASE-045 (T-11) — the goldens G-50/G-51 routes: the leave family's
 * ONLY ledger surfaces. The permission mapping (matrix §3.23's dated
 * note): both are POSTING acts — they ride `payroll.runs.post` (the
 * ledger-writing key of the payroll family, the SoD three-way split:
 * create ≠ approve ≠ post; never grantable below owner/accountant
 * tiers), never an hr.* management key.
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
const DAYS = z.string().regex(/^\d+(\.\d{1,2})?$/, "decimal days like \"2.50\"");

const accrualBody = z.object({
  leaveTypeId: UUID,
  periodId: UUID,
});

const encashBody = z.object({
  employeeId: UUID,
  leaveTypeId: UUID,
  days: DAYS,
  cashAccountId: UUID,
  entryDate: DATE.optional(),
});

@Controller("api/v1/hr/leave")
export class LeavePostingController {
  constructor(@Inject(LeavePostingService) private readonly postings: LeavePostingService) {}

  /** G-50 — the period-end leave-accrual posting (policy-gated). */
  @Post("accrual/posting")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("payroll.runs.post")
  postAccrual(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = accrualBody.parse(body);
    return envelope(
      this.postings.postAccrual({
        leaveTypeId: input.leaveTypeId,
        periodId: input.periodId,
        actorId: identity.userId,
      }),
    );
  }

  /** G-51 — the leave encashment settlement (the payout machinery). */
  @Post("encashment")
  @HttpCode(HttpStatus.OK)
  @RequirePermissions("payroll.runs.post")
  encash(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = encashBody.parse(body);
    return envelope(
      this.postings.encash({
        employeeId: input.employeeId,
        leaveTypeId: input.leaveTypeId,
        days: input.days,
        cashAccountId: input.cashAccountId,
        ...(input.entryDate === undefined ? {} : { entryDate: input.entryDate }),
        actorId: identity.userId,
      }),
    );
  }
}
