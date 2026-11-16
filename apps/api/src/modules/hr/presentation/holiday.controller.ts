import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";

import { RequirePermissions } from "../../../infra/auth/require-permissions.decorator";
import { identityOf, type SessionContext } from "../../../infra/context/session-context";
import { envelope } from "../../../infra/http/envelope";
import { UnauthenticatedError } from "../../identity/api/identity";
import { HolidayService } from "../application/holiday-service";

/**
 * PHASE-045 (T-08) — the holiday-calendars routes: per-jurisdiction
 * calendars + their dated rows. The permission mapping (matrix §3.23,
 * the 0086-seeded keys): the calendars feed the ATTENDANCE register's
 * absence derivation (HOLIDAY, never ABSENT) and the overtime HOLIDAY
 * tier — the surface rides `hr.attendance` (the register's key; no
 * dedicated key was seeded and none is invented).
 */
function requireIdentity(request: Request): SessionContext {
  const identity = identityOf(request);
  if (identity === undefined) {
    throw new UnauthenticatedError();
  }
  return identity;
}

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date (YYYY-MM-DD)");
const JURISDICTION = z.string().regex(/^[A-Za-z0-9]{2,8}$/, "2–8 letters/digits");
const TEXT = z.string().min(1).max(500).nullable().optional();

const calendarBody = z.object({
  jurisdictionCode: JURISDICTION,
  name: z.string().min(1).max(120),
  nameAr: TEXT,
  note: TEXT,
  noteAr: TEXT,
});

const calendarPatch = z.object({
  name: z.string().min(1).max(120).optional(),
  nameAr: TEXT,
  note: TEXT,
  noteAr: TEXT,
});

const holidayBody = z.object({
  holidayDate: DATE,
  name: z.string().min(1).max(120),
  nameAr: TEXT,
});

@Controller("api/v1/hr")
export class HolidayController {
  constructor(@Inject(HolidayService) private readonly holidays: HolidayService) {}

  @Post("holiday-calendars")
  @RequirePermissions("hr.attendance")
  async createCalendar(@Req() request: Request, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = calendarBody.parse(body);
    return envelope(
      await this.holidays.createCalendar({
        jurisdictionCode: input.jurisdictionCode,
        name: input.name,
        nameAr: input.nameAr ?? null,
        note: input.note ?? null,
        noteAr: input.noteAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Get("holiday-calendars")
  @RequirePermissions("hr.attendance")
  async listCalendars(@Req() request: Request, @Query("active") active?: string) {
    requireIdentity(request);
    const activeFilter =
      active === undefined || active === "" ? undefined : active === "true";
    return envelope(
      await this.holidays.listCalendars(activeFilter === undefined ? {} : { active: activeFilter }),
    );
  }

  @Put("holiday-calendars/:id")
  @RequirePermissions("hr.attendance")
  async updateCalendar(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const patch = calendarPatch.parse(body);
    return envelope(
      await this.holidays.updateCalendar(
        id,
        {
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.nameAr === undefined ? {} : { nameAr: patch.nameAr }),
          ...(patch.note === undefined ? {} : { note: patch.note }),
          ...(patch.noteAr === undefined ? {} : { noteAr: patch.noteAr }),
        },
        identity.userId,
      ),
    );
  }

  @Post("holiday-calendars/:id/activate")
  @RequirePermissions("hr.attendance")
  async activateCalendar(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.holidays.setCalendarActive(id, true, identity.userId));
  }

  @Post("holiday-calendars/:id/deactivate")
  @RequirePermissions("hr.attendance")
  async deactivateCalendar(@Req() request: Request, @Param("id") id: string) {
    const identity = requireIdentity(request);
    return envelope(await this.holidays.setCalendarActive(id, false, identity.userId));
  }

  @Post("holiday-calendars/:id/holidays")
  @RequirePermissions("hr.attendance")
  async upsertHoliday(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    const identity = requireIdentity(request);
    const input = holidayBody.parse(body);
    return envelope(
      await this.holidays.upsertHoliday({
        calendarId: id,
        holidayDate: input.holidayDate,
        name: input.name,
        nameAr: input.nameAr ?? null,
        actorId: identity.userId,
      }),
    );
  }

  @Delete("holiday-calendars/:id/holidays/:holidayId")
  @RequirePermissions("hr.attendance")
  async removeHoliday(@Req() request: Request, @Param("id") _id: string, @Param("holidayId") holidayId: string) {
    const identity = requireIdentity(request);
    return envelope(await this.holidays.removeHoliday(holidayId, identity.userId));
  }

  @Get("holidays")
  @RequirePermissions("hr.attendance")
  async listHolidays(
    @Req() request: Request,
    @Query("calendarId") calendarId?: string,
    @Query("from") from: string = "2000-01-01",
    @Query("to") to: string = "2100-12-31",
  ) {
    requireIdentity(request);
    return envelope(
      await this.holidays.listHolidays({
        ...(calendarId === undefined || calendarId === "" ? {} : { calendarId }),
        from,
        to,
      }),
    );
  }
}
