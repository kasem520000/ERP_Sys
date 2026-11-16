import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { envelope } from "../../../infra/http/envelope";
import { UnauthenticatedError } from "../../identity/api/identity";
import { OvertimeService } from "../application/overtime-service";

/**
 * PHASE-045 (T-06) — the overtime routes: the tier rules, the tier
 * match, the weekend setting, and the entries' simple-approval
 * lifecycle. Every route rides `hr.overtime` (matrix §3.23, the
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
/** The decimal-string law (exact, never float — ADR-0009): hours and
 * multipliers cross the API as strings like "2.50". */
const DECIMAL = z.string().regex(/^\d{1,3}(\.\d{1,2})?$/, "a decimal string like \"2.50\"");
const TEXT = z.string().min(1).max(500).nullable().optional();

const ruleBody = z.object({
  code: CODE,
  name: z.string().min(1).max(120),
  nameAr: TEXT,
  tier: z.enum(["WEEKDAY", "WEEKEND", "HOLIDAY"]),
  multiplier: DECIMAL,
  preApprovalRequired: z.boolean(),
  maxHoursPerDay: DECIMAL.nullable(),
  note: TEXT,
  noteAr: TEXT,
});

const rulePatch = z.object({
  name: z.string().min(1).max(120).optional(),
  nameAr: TEXT,
  multiplier: DECIMAL.optional(),
  preApprovalRequired: z.boolean().optional(),
  maxHoursPerDay: DECIMAL.nullable(),
  note: TEXT,
  noteAr: TEXT,
});

const weekendBody = z.object({
  weekendDays: z.array(z.number().int().min(0).max(6)).max(7),
});

const entryBody = z.object({
  employeeId: UUID,
  workDate: DATE,
  hours: DECIMAL,
  ruleId: UUID.nullable(),
  note: TEXT,
});

@Controller("api/v1/hr")
export class OvertimeController {
  constructor(@Inject(OvertimeService) private readonly overtime: OvertimeService) {}

  // -- the rules ------------------------------------------------------------------------

  @Post("overtime/rules")
  @RequirePermissions("hr.overtime")
  async createRule(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = ruleBody.parse(body);
    return envelope(
      await this.overtime.createRule({
        code: input.code,
        name: input.name,
        nameAr: input.nameAr ?? null,
        tier: input.tier,
        multiplier: input.multiplier,
        preApprovalRequired: input.preApprovalRequired,
        maxHoursPerDay: input.maxHoursPerDay ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("overtime/rules")
  @RequirePermissions("hr.overtime")
  async listRules(
    @Req() request: Request,
    @Query("active") active?: string,
    @Query("limit") limit?: string,
  ) {
    requireIdentity(request);
    const activeFilter =
      active === undefined || active === "" ? undefined : active === "true";
    return envelope(
      await this.overtime.listRules({
        ...(activeFilter === undefined ? {} : { active: activeFilter }),
        limit: Math.min(Math.max(Number(limit ?? "100") || 100, 1), 500),
      }),
    );
  }

  @Put("overtime/rules/:id")
  @RequirePermissions("hr.overtime")
  async updateRule(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const patch = rulePatch.parse(body);
    return envelope(
      await this.overtime.updateRule(
        id,
        {
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.nameAr === undefined ? {} : { nameAr: patch.nameAr }),
          ...(patch.multiplier === undefined ? {} : { multiplier: patch.multiplier }),
          ...(patch.preApprovalRequired === undefined ? {} : { preApprovalRequired: patch.preApprovalRequired }),
          maxHoursPerDay: patch.maxHoursPerDay === null ? null : patch.maxHoursPerDay,
          ...(patch.note === undefined ? {} : { note: patch.note }),
          ...(patch.noteAr === undefined ? {} : { noteAr: patch.noteAr }),
        },
        identity.userId,
      ),
    );
  }

  @Post("overtime/rules/:id/activate")
  @RequirePermissions("hr.overtime")
  async activateRule(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.overtime.setRuleActive(id, true, identity.userId));
  }

  @Post("overtime/rules/:id/deactivate")
  @RequirePermissions("hr.overtime")
  async deactivateRule(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.overtime.setRuleActive(id, false, identity.userId));
  }

  // -- the tier match + the weekend setting ------------------------------------------------

  @Get("overtime/tier")
  @RequirePermissions("hr.overtime")
  async resolveTier(@Req() request: Request, @Query("date") date: string) {
    requireIdentity(request);
    return envelope(await this.overtime.resolveTier(date));
  }

  @Get("overtime/weekend")
  @RequirePermissions("hr.overtime")
  async weekend(@Req() request: Request) {
    requireIdentity(request);
    return envelope(await this.overtime.weekendDays());
  }

  @Put("overtime/weekend")
  @RequirePermissions("hr.overtime")
  async saveWeekend(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = weekendBody.parse(body);
    return envelope(await this.overtime.saveWeekendDays(input.weekendDays, identity.userId));
  }

  // -- the entries --------------------------------------------------------------------------

  @Post("overtime/entries")
  @RequirePermissions("hr.overtime")
  async createEntry(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = entryBody.parse(body);
    return envelope(
      await this.overtime.createEntry({
        employeeId: input.employeeId,
        workDate: input.workDate,
        hours: input.hours,
        ruleId: input.ruleId ?? null,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("overtime/entries/:id/approve")
  @RequirePermissions("hr.overtime")
  async approve(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z.object({ note: TEXT }).parse(body);
    return envelope(
      await this.overtime.decide(id, { approve: true, note: input.note ?? null, actorId: identity.userId }),
    );
  }

  @Post("overtime/entries/:id/reject")
  @RequirePermissions("hr.overtime")
  async reject(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z.object({ note: TEXT }).parse(body);
    return envelope(
      await this.overtime.decide(id, { approve: false, note: input.note ?? null, actorId: identity.userId }),
    );
  }

  @Get("overtime/entries")
  @RequirePermissions("hr.overtime")
  async listEntries(
    @Req() request: Request,
    @Query("from") from: string,
    @Query("to") to: string,
    @Query("employeeId") employeeId?: string,
    @Query("status") status?: string,
    @Query("exceptions") exceptions?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    requireIdentity(request);
    const employeeIds =
      employeeId === undefined || employeeId === "" ? undefined : [employeeId];
    return envelope(
      await this.overtime.listEntries({
        from,
        to,
        employeeIds,
        ...(status === undefined || status === "" ? {} : { status }),
        ...(exceptions === "true" ? { onlyExceptions: true } : {}),
        ...(page === undefined || page === "" ? {} : { page: Number(page) }),
        ...(pageSize === undefined || pageSize === "" ? {} : { pageSize: Number(pageSize) }),
      }),
    );
  }
}
