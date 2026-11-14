import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { envelope } from "../../../infra/http/envelope";
import { UnauthenticatedError } from "../../identity/api/identity";
import { ShiftService } from "../application/shift-service";

/**
 * PHASE-045 (T-03) — the HR shifts/roster routes. Permission mapping
 * (matrix §3.24 — the six hr.* keys seeded by 0086): every route here
 * rides `hr.shifts` (the shift + roster surface); the attendance routes
 * (T-04/T-05) will ride `hr.attendance` / `hr.attendance.import`.
 * Foreign/unknown ids are 404-shaped (A7 — RLS parity).
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
const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, "24h time (HH:MM or HH:MM:SS)");
const CODE = z.string().regex(/^[\w\-. ]{1,32}$/, "1–32 chars (letters, digits, dash, dot, space)");
const TEXT = z.string().min(1).max(500).nullable().optional();

const shiftBody = z.object({
  code: CODE,
  name: z.string().min(1).max(120),
  nameAr: TEXT,
  startTime: TIME,
  endTime: TIME,
  graceMinutes: z.number().int().min(0).max(240),
  breakMinutes: z.number().int().min(0).max(480),
  isNight: z.boolean(),
  note: TEXT,
  noteAr: TEXT,
});

const shiftPatch = z.object({
  code: CODE.optional(),
  name: z.string().min(1).max(120).optional(),
  nameAr: TEXT,
  startTime: TIME.optional(),
  endTime: TIME.optional(),
  graceMinutes: z.number().int().min(0).max(240).optional(),
  breakMinutes: z.number().int().min(0).max(480).optional(),
  isNight: z.boolean().optional(),
  note: TEXT,
  noteAr: TEXT,
});

const rotationBody = z.object({
  employeeIds: z.array(UUID).min(1).max(200),
  pattern: z.array(UUID.nullable()).length(7),
  startDate: DATE,
  endDate: DATE,
});

@Controller("api/v1/hr")
export class HrController {
  constructor(@Inject(ShiftService) private readonly shifts: ShiftService) {}

  // -- shift templates -----------------------------------------------------------

  @Post("shifts")
  @RequirePermissions("hr.shifts")
  @HttpCode(HttpStatus.CREATED)
  createShift(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = shiftBody.parse(body);
    return envelope(
      this.shifts.create({
        code: input.code,
        name: input.name,
        nameAr: input.nameAr ?? null,
        startTime: input.startTime,
        endTime: input.endTime,
        graceMinutes: input.graceMinutes,
        breakMinutes: input.breakMinutes,
        isNight: input.isNight,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("shifts")
  @RequirePermissions("hr.shifts")
  listShifts(
    @Req() request: Request,
    @Query("active") active?: string,
    @Query("limit") limit?: string,
  ) {
    requireIdentity(request);
    const activeFilter =
      active === undefined || active === "" ? undefined : active === "true";
    return envelope(
      this.shifts.list({
        ...(activeFilter === undefined ? {} : { active: activeFilter }),
        limit: Math.min(Math.max(Number(limit ?? "100") || 100, 1), 500),
      }),
    );
  }

  @Get("shifts/:id")
  @RequirePermissions("hr.shifts")
  findShift(@Req() request: Request, @Param("id") id: string) {
    requireIdentity(request);
    return envelope(this.shifts.find(id));
  }

  @Put("shifts/:id")
  @RequirePermissions("hr.shifts")
  updateShift(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const patch = shiftPatch.parse(body);
    return envelope(
      this.shifts.update(
        id,
        {
          ...(patch.code === undefined ? {} : { code: patch.code }),
          ...(patch.name === undefined ? {} : { name: patch.name }),
          nameAr: patch.nameAr ?? null,
          ...(patch.startTime === undefined ? {} : { startTime: patch.startTime }),
          ...(patch.endTime === undefined ? {} : { endTime: patch.endTime }),
          ...(patch.graceMinutes === undefined ? {} : { graceMinutes: patch.graceMinutes }),
          ...(patch.breakMinutes === undefined ? {} : { breakMinutes: patch.breakMinutes }),
          ...(patch.isNight === undefined ? {} : { isNight: patch.isNight }),
          note: patch.note ?? null,
          noteAr: patch.noteAr ?? null,
        },
        identity.userId,
      ),
    );
  }

  @Post("shifts/:id/activate")
  @RequirePermissions("hr.shifts")
  activateShift(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(this.shifts.setActive(id, true, identity.userId));
  }

  @Post("shifts/:id/deactivate")
  @RequirePermissions("hr.shifts")
  deactivateShift(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(this.shifts.setActive(id, false, identity.userId));
  }

  // -- the roster grid -----------------------------------------------------------

  @Get("roster")
  @RequirePermissions("hr.shifts")
  readGrid(
    @Req() request: Request,
    @Query("from") from: string,
    @Query("to") to: string,
    @Query("employeeId") employeeId?: string,
  ) {
    requireIdentity(request);
    const employeeIds =
      employeeId === undefined || employeeId === "" ? undefined : [employeeId];
    return envelope(this.shifts.readGrid({ from, to, employeeIds }));
  }

  @Put("roster/cell")
  @RequirePermissions("hr.shifts")
  setCell(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z
      .object({
        employeeId: UUID,
        workDate: DATE,
        shiftId: UUID.nullable(),
        note: TEXT,
      })
      .parse(body);
    return envelope(
      this.shifts.setRosterCell({
        employeeId: input.employeeId,
        workDate: input.workDate,
        shiftId: input.shiftId,
        note: input.note ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Post("roster/cell/clear")
  @RequirePermissions("hr.shifts")
  clearCell(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = z
      .object({ employeeId: UUID, workDate: DATE })
      .parse(body);
    return envelope(
      this.shifts.clearRosterCell(input.employeeId, input.workDate, identity.userId),
    );
  }

  @Post("roster/rotation")
  @RequirePermissions("hr.shifts")
  applyRotation(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = rotationBody.parse(body);
    return envelope(this.shifts.applyRotation({ ...input, actorId: identity.userId }));
  }
}
