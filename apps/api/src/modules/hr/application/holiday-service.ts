import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import {
  HolidayCalendarInvalidError,
  HolidayCalendarNotFoundError,
  HolidayInvalidError,
  HolidayNotFoundError,
} from "../domain/holiday-errors";
import * as store from "../infrastructure/holiday.store";

/**
 * PHASE-045 (T-08) — the holiday-calendars service: per-jurisdiction
 * public-holiday calendars (bilingual names, the active flag) and
 * their dated rows — the master-data surface that feeds the ABSENCE
 * DERIVATION (a holiday day derives HOLIDAY, never ABSENT — T-04),
 * the overtime HOLIDAY tier (T-06), and the leave charge rules
 * (PHASE-046's statutory regime — nothing fabricated here).
 *
 * THE JURISDICTION LAW: one calendar per jurisdiction per tenant (the
 * uq — a second calendar for the same jurisdiction is the typed
 * refusal); the INTEGRATION READS consume the ACTIVE calendars whose
 * jurisdiction matches the TENANT'S COUNTRY (the operating
 * jurisdiction — the attendance derivation's and the overtime tier's
 * existing law; a multi-jurisdiction workforce's per-employee
 * calendars are PHASE-047's org-structure world, never fabricated
 * here).
 *
 * THE ROW LAW: ONE holiday per (calendar, date) — an edit REPLACES
 * the names (the uq cell); the row is fully editable master data
 * (0084's DELETE grant — a wrongly-entered date is removed, never
 * silently kept).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const JURISDICTION_RE = /^[A-Za-z0-9]{2,8}$/;

function isoDate(date: string, what: string): string {
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new HolidayInvalidError(`${what} must be an ISO date (YYYY-MM-DD): ${date}`);
  }
  return date;
}

@Injectable()
export class HolidayService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  // -- the calendars -----------------------------------------------------------------------

  async createCalendar(input: {
    jurisdictionCode: string;
    name: string;
    nameAr: string | null;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
  }): Promise<store.HolidayCalendarRow> {
    if (!JURISDICTION_RE.test(input.jurisdictionCode)) {
      throw new HolidayCalendarInvalidError(
        `jurisdictionCode must be 2–8 letters/digits (an ISO-3166-1 alpha-2 code or a subdivision code): ${input.jurisdictionCode}`,
      );
    }
    if (input.name.length < 1 || input.name.length > 120) {
      throw new HolidayCalendarInvalidError(`calendar name must be 1–120 chars: ${input.name}`);
    }
    if ((await store.findHolidayCalendarByJurisdiction(input.jurisdictionCode)) !== undefined) {
      throw new HolidayCalendarInvalidError(
        `a calendar for jurisdiction '${input.jurisdictionCode}' already exists in this tenant — ONE calendar per jurisdiction (the uq law)`,
      );
    }
    const created = await store.insertHolidayCalendar({
      jurisdictionCode: input.jurisdictionCode,
      name: input.name,
      nameAr: input.nameAr,
      note: input.note,
      noteAr: input.noteAr,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "hr.holiday_calendar_created",
      entityType: "holiday_calendar",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { jurisdictionCode: created.jurisdictionCode, name: created.name },
    });
    return created;
  }

  async listCalendars(filter: { active?: boolean }): Promise<store.HolidayCalendarRow[]> {
    return store.listHolidayCalendars(filter);
  }

  async updateCalendar(
    id: string,
    patch: { name?: string; nameAr?: string | null; note?: string | null; noteAr?: string | null },
    actorId: string | null,
  ): Promise<store.HolidayCalendarRow> {
    const current = await store.findHolidayCalendarById(id);
    if (current === undefined) throw new HolidayCalendarNotFoundError(id);
    if (patch.name !== undefined && (patch.name.length < 1 || patch.name.length > 120)) {
      throw new HolidayCalendarInvalidError(`calendar name must be 1–120 chars: ${patch.name}`);
    }
    const updated = await store.patchHolidayCalendar({
      id,
      ...(patch.name === undefined ? {} : { name: patch.name }),
      ...(patch.nameAr === undefined ? {} : { nameAr: patch.nameAr }),
      ...(patch.note === undefined ? {} : { note: patch.note }),
      ...(patch.noteAr === undefined ? {} : { noteAr: patch.noteAr }),
    });
    if (updated === undefined) throw new HolidayCalendarNotFoundError(id);
    await this.audit.record({
      action: "hr.holiday_calendar_updated",
      entityType: "holiday_calendar",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { name: current.name },
      after: { name: updated.name },
    });
    return updated;
  }

  /** The activation gate: an INACTIVE calendar is invisible to the
   * absence derivation AND the overtime tier (the integration law). */
  async setCalendarActive(id: string, active: boolean, actorId: string | null): Promise<store.HolidayCalendarRow> {
    const current = await store.findHolidayCalendarById(id);
    if (current === undefined) throw new HolidayCalendarNotFoundError(id);
    const updated = await store.setHolidayCalendarActive(id, active);
    if (updated === undefined) throw new HolidayCalendarNotFoundError(id);
    await this.audit.record({
      action: active ? "hr.holiday_calendar_activated" : "hr.holiday_calendar_deactivated",
      entityType: "holiday_calendar",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { jurisdictionCode: updated.jurisdictionCode, active },
    });
    return updated;
  }

  // -- the dated rows ------------------------------------------------------------------------

  async upsertHoliday(input: {
    calendarId: string;
    holidayDate: string;
    name: string;
    nameAr: string | null;
    actorId: string | null;
  }): Promise<store.HolidayRow> {
    const holidayDate = isoDate(input.holidayDate, "holidayDate");
    if (input.name.length < 1 || input.name.length > 120) {
      throw new HolidayInvalidError(`holiday name must be 1–120 chars: ${input.name}`);
    }
    const calendar = await store.findHolidayCalendarById(input.calendarId);
    if (calendar === undefined) throw new HolidayCalendarNotFoundError(input.calendarId);
    const upserted = await store.upsertHoliday({
      calendarId: input.calendarId,
      holidayDate,
      name: input.name,
      nameAr: input.nameAr,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "hr.holiday_upserted",
      entityType: "holiday",
      entityId: upserted.id,
      actorId: input.actorId ?? undefined,
      after: { calendar: calendar.jurisdictionCode, holidayDate, name: input.name },
    });
    return upserted;
  }

  async removeHoliday(id: string, actorId: string | null): Promise<{ removed: boolean }> {
    const holiday = await store.findHolidayById(id);
    if (holiday === undefined) throw new HolidayNotFoundError(id);
    const removed = await store.deleteHoliday(id);
    if (removed) {
      await this.audit.record({
        action: "hr.holiday_removed",
        entityType: "holiday",
        entityId: id,
        actorId: actorId ?? undefined,
        before: { calendar: holiday.calendarJurisdiction, holidayDate: holiday.holidayDate, name: holiday.name },
      });
    }
    return { removed };
  }

  async listHolidays(filter: {
    calendarId?: string;
    from: string;
    to: string;
  }): Promise<store.HolidayRow[]> {
    const from = isoDate(filter.from, "from");
    const to = isoDate(filter.to, "to");
    if (to < from) {
      throw new HolidayInvalidError(`the range is inverted: ${from} → ${to}`);
    }
    if (filter.calendarId !== undefined && (await store.findHolidayCalendarById(filter.calendarId)) === undefined) {
      throw new HolidayCalendarNotFoundError(filter.calendarId);
    }
    return store.listHolidays({
      ...(filter.calendarId === undefined ? {} : { calendarId: filter.calendarId }),
      from,
      to,
    });
  }

  /** The integration read (the spec's integration arm + any future
   * consumer): the tenant-jurisdiction holiday dates in a range. */
  async tenantJurisdictionHolidays(from: string, to: string): Promise<Set<string>> {
    return store.listTenantJurisdictionHolidayDates(isoDate(from, "from"), isoDate(to, "to"));
  }
}
