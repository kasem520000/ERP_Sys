import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-045 (T-08) — the holiday-calendars store: the per-jurisdiction
 * calendars (one per jurisdiction per tenant — the uq) and their dated
 * rows (ONE per calendar+date). Master data (0084's grants:
 * SELECT/INSERT/UPDATE/DELETE — a holiday row is fully editable until
 * the period closes). The INTEGRATION READS (the attendance
 * derivation's HOLIDAY law and the overtime HOLIDAY tier) consume the
 * ACTIVE calendars whose jurisdiction matches the tenant's country —
 * the law this store's `listHolidayDates` carries.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("hr access requires an ambient tenant scope");
  }
  return context.tx;
}

export interface HolidayCalendarRow {
  id: string;
  jurisdictionCode: string;
  name: string;
  nameAr: string | null;
  active: boolean;
  note: string | null;
  noteAr: string | null;
}

export interface HolidayRow {
  id: string;
  calendarId: string;
  calendarJurisdiction: string;
  holidayDate: string;
  name: string;
  nameAr: string | null;
}

const CALENDAR_COLUMNS = sql`
  id, jurisdiction_code AS "jurisdictionCode", name, name_ar AS "nameAr",
  active, note, note_ar AS "noteAr"
`;

// -- the calendars ----------------------------------------------------------------------

export async function insertHolidayCalendar(input: {
  jurisdictionCode: string;
  name: string;
  nameAr: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
}): Promise<HolidayCalendarRow> {
  await tenantTx().execute(sql`
    INSERT INTO holiday_calendars (id, tenant_id, jurisdiction_code, name, name_ar, note, note_ar, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.jurisdictionCode}, ${input.name},
            ${input.nameAr}, ${input.note}, ${input.noteAr}, ${input.createdBy})
  `);
  const found = await findHolidayCalendarByJurisdiction(input.jurisdictionCode);
  return found!;
}

export async function findHolidayCalendarById(id: string): Promise<HolidayCalendarRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${CALENDAR_COLUMNS} FROM holiday_calendars WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as HolidayCalendarRow[])[0];
}

export async function findHolidayCalendarByJurisdiction(code: string): Promise<HolidayCalendarRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${CALENDAR_COLUMNS} FROM holiday_calendars WHERE jurisdiction_code = ${code} LIMIT 1
  `);
  return (rows.rows as unknown as HolidayCalendarRow[])[0];
}

export async function listHolidayCalendars(filter: { active?: boolean }): Promise<HolidayCalendarRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${CALENDAR_COLUMNS} FROM holiday_calendars
    WHERE (${filter.active ?? null}::boolean IS NULL OR active = ${filter.active ?? null})
    ORDER BY jurisdiction_code
  `);
  return rows.rows as unknown as HolidayCalendarRow[];
}

export async function patchHolidayCalendar(input: {
  id: string;
  name?: string;
  nameAr?: string | null;
  note?: string | null;
  noteAr?: string | null;
}): Promise<HolidayCalendarRow | undefined> {
  await tenantTx().execute(sql`
    UPDATE holiday_calendars SET
      name = COALESCE(${input.name ?? null}, name),
      name_ar = COALESCE(${input.nameAr ?? null}, name_ar),
      note = COALESCE(${input.note ?? null}, note),
      note_ar = COALESCE(${input.noteAr ?? null}, note_ar),
      updated_at = now(), version = version + 1
    WHERE id = ${input.id}
  `);
  return findHolidayCalendarById(input.id);
}

export async function setHolidayCalendarActive(id: string, active: boolean): Promise<HolidayCalendarRow | undefined> {
  await tenantTx().execute(sql`
    UPDATE holiday_calendars SET active = ${active}, updated_at = now(), version = version + 1
    WHERE id = ${id}
  `);
  return findHolidayCalendarById(id);
}

// -- the dated rows ------------------------------------------------------------------------

/** Upsert ONE holiday per (calendar, date) — an edit REPLACES the
 * row's names (the uq cell law; never a duplicate). */
export async function upsertHoliday(input: {
  calendarId: string;
  holidayDate: string;
  name: string;
  nameAr: string | null;
  createdBy: string | null;
}): Promise<HolidayRow> {
  await tenantTx().execute(sql`
    INSERT INTO holidays (id, tenant_id, calendar_id, holiday_date, name, name_ar, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.calendarId},
            ${input.holidayDate}::date, ${input.name}, ${input.nameAr}, ${input.createdBy})
    ON CONFLICT ("tenant_id", "calendar_id", "holiday_date") DO UPDATE SET
      name = EXCLUDED.name, name_ar = EXCLUDED.name_ar, updated_at = now(), version = holidays.version + 1
  `);
  const rows = await tenantTx().execute(sql`
    SELECT h.id, h.calendar_id::text AS "calendarId", c.jurisdiction_code AS "calendarJurisdiction",
           h.holiday_date::text AS "holidayDate", h.name, h.name_ar AS "nameAr"
    FROM holidays h JOIN holiday_calendars c ON c.id = h.calendar_id
    WHERE h.calendar_id = ${input.calendarId} AND h.holiday_date = ${input.holidayDate}::date
    LIMIT 1
  `);
  return (rows.rows as unknown as HolidayRow[])[0]!;
}

export async function findHolidayById(id: string): Promise<HolidayRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT h.id, h.calendar_id::text AS "calendarId", c.jurisdiction_code AS "calendarJurisdiction",
           h.holiday_date::text AS "holidayDate", h.name, h.name_ar AS "nameAr"
    FROM holidays h JOIN holiday_calendars c ON c.id = h.calendar_id
    WHERE h.id = ${id}
    LIMIT 1
  `);
  return (rows.rows as unknown as HolidayRow[])[0];
}

export async function deleteHoliday(id: string): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    DELETE FROM holidays WHERE id = ${id} RETURNING id
  `);
  return (rows.rows as unknown as { id: string }[]).length > 0;
}

export async function listHolidays(filter: {
  calendarId?: string;
  from: string;
  to: string;
}): Promise<HolidayRow[]> {
  const calendarFilter = filter.calendarId === undefined ? sql`true` : sql`h.calendar_id = ${filter.calendarId}::uuid`;
  const rows = await tenantTx().execute(sql`
    SELECT h.id, h.calendar_id::text AS "calendarId", c.jurisdiction_code AS "calendarJurisdiction",
           h.holiday_date::text AS "holidayDate", h.name, h.name_ar AS "nameAr"
    FROM holidays h JOIN holiday_calendars c ON c.id = h.calendar_id
    WHERE ${calendarFilter}
      AND h.holiday_date >= ${filter.from}::date AND h.holiday_date <= ${filter.to}::date
    ORDER BY h.holiday_date, c.jurisdiction_code
  `);
  return rows.rows as unknown as HolidayRow[];
}

/** THE INTEGRATION READ (the attendance derivation's HOLIDAY law and
 * the overtime HOLIDAY tier ride this): the holiday dates of the
 * ACTIVE calendars whose jurisdiction matches the tenant's country —
 * the operating jurisdiction. */
export async function listTenantJurisdictionHolidayDates(from: string, to: string): Promise<Set<string>> {
  const rows = await tenantTx().execute<{ holidayDate: string }>(sql`
    SELECT h.holiday_date::text AS "holidayDate"
    FROM holidays h
    JOIN holiday_calendars c ON c.id = h.calendar_id
    WHERE c.active AND c.jurisdiction_code = (SELECT country_code FROM tenants WHERE id = erp.current_tenant_id())
      AND h.holiday_date >= ${from}::date AND h.holiday_date <= ${to}::date
  `);
  return new Set(rows.rows.map((row) => row.holidayDate));
}
