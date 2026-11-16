import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-045 (T-04) — the attendance store: the punch sessions
 * (attendance_records, migration 0081) — capture, the one-shot checkout
 * (BR-082's only punch-mutating arm), the derivation write (status
 * fields ONLY — never punch fields), and the derivation window's
 * context loads (roster cells with tz-computed shift instants, the
 * tenant-jurisdiction holidays, the APPROVED leave spans).
 *
 * TIME ARITHMETIC LAW (ADR-0009's spirit): the derivation compares
 * instants as INTEGER milliseconds extracted in SQL
 * (EXTRACT(EPOCH …) * 1000) — never float-parsed date strings; the
 * minute facts are exact floor divisions of exact integer differences.
 *
 * RLS: every statement rides the ambient tenant transaction (the
 * app role + the tenant GUC — the hr.store precedent); the employees
 * substrate stays a cross-module READ (never a write).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("hr access requires an ambient tenant scope");
  }
  return context.tx;
}

export interface AttendanceRecordRow {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  workDate: string;
  checkIn: string | null;
  checkOut: string | null;
  source: string;
  deviceRef: string | null;
  geoLat: number | null;
  geoLng: number | null;
  shiftId: string | null;
  shiftCode: string | null;
  derivedStatus: string | null;
  lateMinutes: number | null;
  earlyLeaveMinutes: number | null;
  workedMinutes: number | null;
  overtimeMinutes: number | null;
  isException: boolean;
  importBatchId: string | null;
  note: string | null;
}

/** The derivation-internal shape: the day's rows with their punch
 * instants as integer milliseconds (the arithmetic law above) plus the
 * CURRENT derivation fields (the idempotent re-derive compares before
 * it writes — no version churn on an unchanged verdict). */
export type DerivationRow = {
  id: string;
  employeeId: string;
  workDate: string;
  checkInMs: number | null;
  checkOutMs: number | null;
  shiftId: string | null;
  derivedStatus: string | null;
  lateMinutes: number | null;
  earlyLeaveMinutes: number | null;
  workedMinutes: number | null;
  overtimeMinutes: number | null;
  isException: boolean;
};

/** A roster cell's shift facts for one (employee, work_date), with the
 * shift's START/END instants computed in the TENANT's timezone (a
 * night shift's end lands on work_date + 1 — the crossing is declared
 * on the template, applied here). */
export interface RosterShiftFacts {
  shiftId: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  breakMinutes: number;
  isNight: boolean;
  shiftStartMs: number;
  shiftEndMs: number;
}

export interface DerivationWindow {
  /** Today's date in the TENANT's timezone (the absent-synthesis guard:
   * only a day that has already happened can be absent). */
  today: string;
  /** key `${employeeId}|${workDate}` → the rostered shift's facts. */
  roster: Map<string, RosterShiftFacts>;
  /** The tenant-jurisdiction holiday dates in the window (active
   * calendars whose jurisdiction matches the tenant's country). */
  holidays: Set<string>;
  /** The APPROVED leave spans intersecting the window. */
  leaves: { employeeId: string; startDate: string; endDate: string }[];
}

const ATTENDANCE_COLUMNS = sql`
  a.id, a.employee_id AS "employeeId", e.code AS "employeeCode", e.name AS "employeeName",
  a.work_date::text AS "workDate",
  a.check_in::text AS "checkIn", a.check_out::text AS "checkOut",
  a.source, a.device_ref AS "deviceRef",
  a.geo_lat AS "geoLat", a.geo_lng AS "geoLng",
  a.shift_id AS "shiftId", s.code AS "shiftCode",
  a.derived_status AS "derivedStatus",
  a.late_minutes AS "lateMinutes", a.early_leave_minutes AS "earlyLeaveMinutes",
  a.worked_minutes AS "workedMinutes", a.overtime_minutes AS "overtimeMinutes",
  a.is_exception AS "isException", a.import_batch_id AS "importBatchId", a.note
`;

// -- capture ----------------------------------------------------------------------

export async function insertAttendanceRecord(input: {
  employeeId: string;
  workDate: string;
  checkIn: string;
  checkOut: string | null;
  source: "MANUAL" | "DEVICE";
  deviceRef: string | null;
  geoLat: number | null;
  geoLng: number | null;
  note: string | null;
  createdBy: string | null;
}): Promise<AttendanceRecordRow> {
  await tenantTx().execute(sql`
    INSERT INTO attendance_records (id, tenant_id, employee_id, work_date, check_in, check_out,
                                    source, device_ref, geo_lat, geo_lng, note, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.employeeId},
            ${input.workDate}::date, ${input.checkIn}::timestamptz,
            ${input.checkOut === null ? null : sql`${input.checkOut}::timestamptz`},
            ${input.source}::text, ${input.deviceRef}, ${input.geoLat}, ${input.geoLng},
            ${input.note}, ${input.createdBy})
  `);
  const rows = await tenantTx().execute(sql`
    SELECT ${ATTENDANCE_COLUMNS}
    FROM attendance_records a
    JOIN employees e ON e.id = a.employee_id
    LEFT JOIN shifts s ON s.id = a.shift_id
    WHERE a.employee_id = ${input.employeeId} AND a.work_date = ${input.workDate}::date
      AND a.check_in = ${input.checkIn}::timestamptz
    ORDER BY a.created_at DESC
    LIMIT 1
  `);
  return (rows.rows as unknown as AttendanceRecordRow[])[0]!;
}

export async function findAttendanceRecordById(id: string): Promise<AttendanceRecordRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ATTENDANCE_COLUMNS}
    FROM attendance_records a
    JOIN employees e ON e.id = a.employee_id
    LEFT JOIN shifts s ON s.id = a.shift_id
    WHERE a.id = ${id}
    LIMIT 1
  `);
  return (rows.rows as unknown as AttendanceRecordRow[])[0];
}

// -- the one-shot checkout (BR-082's only punch-mutating arm) -----------------------

/** Fill the session's check_out EXACTLY ONCE: the WHERE check_out IS
 * NULL arm is the law's floor — a second fill touches zero rows and
 * the caller renders the typed BR-082 refusal. */
export async function fillAttendanceCheckOut(
  id: string,
  checkOut: string,
): Promise<AttendanceRecordRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE attendance_records SET
      check_out = ${checkOut}::timestamptz, updated_at = now(), version = version + 1
    WHERE id = ${id} AND check_out IS NULL
    RETURNING id
  `);
  if ((rows.rows as unknown as { id: string }[])[0] === undefined) return undefined;
  return findAttendanceRecordById(id);
}

// -- the derivation write (status fields ONLY — never punch fields) -----------------

export async function updateAttendanceDerivation(input: {
  id: string;
  shiftId: string | null;
  derivedStatus: string;
  lateMinutes: number | null;
  earlyLeaveMinutes: number | null;
  workedMinutes: number | null;
  overtimeMinutes: number | null;
  isException: boolean;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE attendance_records SET
      shift_id = ${input.shiftId},
      derived_status = ${input.derivedStatus}::text,
      late_minutes = ${input.lateMinutes},
      early_leave_minutes = ${input.earlyLeaveMinutes},
      worked_minutes = ${input.workedMinutes},
      overtime_minutes = ${input.overtimeMinutes},
      is_exception = ${input.isException},
      updated_at = now(), version = version + 1
    WHERE id = ${input.id}
  `);
}

/** The synthesized ABSENCE row (BR-082's append-only discipline): a
 * rostered day that already happened and captured NO punch is recorded
 * as a (null, null) session — source MANUAL is the only shape the
 * 0081 CHECK family allows for a synthesized row (DEVICE demands a
 * device_ref, IMPORT demands a batch); the note names it DERIVED so
 * the register never mistakes it for a human capture. If a real punch
 * later arrives the row stays (append-only) and its derivation fields
 * follow the day's verdict like every other row of the day. */
export async function insertDerivedAbsenceRow(input: {
  employeeId: string;
  workDate: string;
  shiftId: string | null;
  createdBy: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    INSERT INTO attendance_records (id, tenant_id, employee_id, work_date, check_in, check_out,
                                    source, device_ref, shift_id, derived_status, is_exception, note, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.employeeId},
            ${input.workDate}::date, NULL, NULL,
            'MANUAL', NULL, ${input.shiftId}, 'ABSENT', true, 'DERIVED_ABSENT', ${input.createdBy})
  `);
}

// -- the derivation window's context loads ------------------------------------------

export async function loadDerivationWindow(input: {
  from: string;
  to: string;
  employeeIds?: readonly string[];
}): Promise<DerivationWindow> {
  const employeeFilter =
    input.employeeIds === undefined || input.employeeIds.length === 0
      ? sql`true`
      : sql`r.employee_id IN (${sql.join(
          input.employeeIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;

  // The roster cells with their shift facts, the shift instants computed
  // in the TENANT's timezone (work_date + start_time; +1 day for a
  // declared night crossing).
  const rosterRows = await tenantTx().execute<{
    employeeId: string;
    workDate: string;
    shiftId: string;
    startTime: string;
    endTime: string;
    graceMinutes: number;
    breakMinutes: number;
    isNight: boolean;
    shiftStartMs: string;
    shiftEndMs: string;
  }>(sql`
    SELECT r.employee_id::text AS "employeeId", r.work_date::text AS "workDate",
           s.id::text AS "shiftId", s.start_time::text AS "startTime", s.end_time::text AS "endTime",
           s.grace_minutes AS "graceMinutes", s.break_minutes AS "breakMinutes",
           s.is_night AS "isNight",
           (EXTRACT(EPOCH FROM ((r.work_date::text || ' ' || s.start_time::text)::timestamp
             AT TIME ZONE t.timezone)) * 1000)::bigint::text AS "shiftStartMs",
           (EXTRACT(EPOCH FROM (((r.work_date + CASE WHEN s.is_night THEN 1 ELSE 0 END)::text
             || ' ' || s.end_time::text)::timestamp
             AT TIME ZONE t.timezone)) * 1000)::bigint::text AS "shiftEndMs"
    FROM shift_rotations r
    JOIN shifts s ON s.id = r.shift_id
    CROSS JOIN (SELECT timezone FROM tenants WHERE id = erp.current_tenant_id()) t
    WHERE r.work_date >= ${input.from}::date AND r.work_date <= ${input.to}::date
      AND ${employeeFilter}
  `);
  const roster = new Map<string, RosterShiftFacts>();
  for (const row of rosterRows.rows) {
    roster.set(`${row.employeeId}|${row.workDate}`, {
      shiftId: row.shiftId,
      startTime: row.startTime,
      endTime: row.endTime,
      graceMinutes: Number(row.graceMinutes),
      breakMinutes: Number(row.breakMinutes),
      isNight: Boolean(row.isNight),
      shiftStartMs: Number(row.shiftStartMs),
      shiftEndMs: Number(row.shiftEndMs),
    });
  }

  // The tenant-jurisdiction holidays: an ACTIVE calendar whose
  // jurisdiction matches the tenant's country (the operating
  // jurisdiction — the full multi-jurisdiction integration is T-08).
  const holidayRows = await tenantTx().execute<{ holidayDate: string }>(sql`
    SELECT h.holiday_date::text AS "holidayDate"
    FROM holidays h
    JOIN holiday_calendars c ON c.id = h.calendar_id
    WHERE c.active AND c.jurisdiction_code = (SELECT country_code FROM tenants WHERE id = erp.current_tenant_id())
      AND h.holiday_date >= ${input.from}::date AND h.holiday_date <= ${input.to}::date
  `);
  const holidays = new Set(holidayRows.rows.map((row) => row.holidayDate));

  // The APPROVED leave spans intersecting the window.
  const leaveRows = await tenantTx().execute<{
    employeeId: string;
    startDate: string;
    endDate: string;
  }>(sql`
    SELECT employee_id::text AS "employeeId", start_date::text AS "startDate", end_date::text AS "endDate"
    FROM leave_requests
    WHERE status = 'APPROVED'
      AND start_date <= ${input.to}::date AND end_date >= ${input.from}::date
  `);

  const todayRows = await tenantTx().execute<{ today: string }>(sql`
    SELECT (now() AT TIME ZONE (SELECT timezone FROM tenants WHERE id = erp.current_tenant_id()))::date::text AS today
  `);

  return {
    today: todayRows.rows[0]!.today,
    roster,
    holidays,
    leaves: leaveRows.rows,
  };
}

export async function listDerivationRows(input: {
  from: string;
  to: string;
  employeeIds?: readonly string[];
}): Promise<DerivationRow[]> {
  const employeeFilter =
    input.employeeIds === undefined || input.employeeIds.length === 0
      ? sql`true`
      : sql`employee_id IN (${sql.join(
          input.employeeIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;
  const rows = await tenantTx().execute<DerivationRow>(sql`
    SELECT id, employee_id::text AS "employeeId", work_date::text AS "workDate",
           (EXTRACT(EPOCH FROM check_in) * 1000)::bigint::text AS "checkInMs",
           (EXTRACT(EPOCH FROM check_out) * 1000)::bigint::text AS "checkOutMs",
           shift_id::text AS "shiftId", derived_status AS "derivedStatus",
           late_minutes AS "lateMinutes", early_leave_minutes AS "earlyLeaveMinutes",
           worked_minutes AS "workedMinutes", overtime_minutes AS "overtimeMinutes",
           is_exception AS "isException"
    FROM attendance_records
    WHERE work_date >= ${input.from}::date AND work_date <= ${input.to}::date
      AND ${employeeFilter}
  `);
  return rows.rows.map((row) => ({
    ...row,
    checkInMs: row.checkInMs === null ? null : Number(row.checkInMs),
    checkOutMs: row.checkOutMs === null ? null : Number(row.checkOutMs),
  }));
}

// -- the reads (the daily register + the exception board) ---------------------------

export async function listRegisterRows(date: string): Promise<AttendanceRecordRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ATTENDANCE_COLUMNS}
    FROM attendance_records a
    JOIN employees e ON e.id = a.employee_id
    LEFT JOIN shifts s ON s.id = a.shift_id
    WHERE a.work_date = ${date}::date
    ORDER BY e.code, a.check_in NULLS FIRST, a.created_at
  `);
  return rows.rows as unknown as AttendanceRecordRow[];
}

/** The self-service calendar read (T-14): ONE employee's rows over a
 * range — the register's columns, the employee's own days only (the
 * bridge resolver hands the id; a client NEVER supplies it), ordered
 * for a calendar walk (date, then punch order). */
export async function listOwnCalendarRows(filter: {
  employeeId: string;
  from: string;
  to: string;
}): Promise<AttendanceRecordRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ATTENDANCE_COLUMNS}
    FROM attendance_records a
    JOIN employees e ON e.id = a.employee_id
    LEFT JOIN shifts s ON s.id = a.shift_id
    WHERE a.employee_id = ${filter.employeeId}::uuid
      AND a.work_date >= ${filter.from}::date AND a.work_date <= ${filter.to}::date
    ORDER BY a.work_date, a.check_in NULLS FIRST, a.created_at
  `);
  return rows.rows as unknown as AttendanceRecordRow[];
}

export async function listExceptionRows(filter: {
  from: string;
  to: string;
  employeeIds?: readonly string[];
  limit: number;
  offset: number;
}): Promise<AttendanceRecordRow[]> {
  const employeeFilter =
    filter.employeeIds === undefined || filter.employeeIds.length === 0
      ? sql`true`
      : sql`a.employee_id IN (${sql.join(
          filter.employeeIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;
  const rows = await tenantTx().execute(sql`
    SELECT ${ATTENDANCE_COLUMNS}
    FROM attendance_records a
    JOIN employees e ON e.id = a.employee_id
    LEFT JOIN shifts s ON s.id = a.shift_id
    WHERE a.is_exception AND a.work_date >= ${filter.from}::date AND a.work_date <= ${filter.to}::date
      AND ${employeeFilter}
    ORDER BY a.work_date, e.code
    LIMIT ${filter.limit} OFFSET ${filter.offset}
  `);
  return rows.rows as unknown as AttendanceRecordRow[];
}

export async function countExceptionRows(filter: {
  from: string;
  to: string;
  employeeIds?: readonly string[];
}): Promise<number> {
  const employeeFilter =
    filter.employeeIds === undefined || filter.employeeIds.length === 0
      ? sql`true`
      : sql`a.employee_id IN (${sql.join(
          filter.employeeIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;
  const rows = await tenantTx().execute<{ n: number }>(sql`
    SELECT count(*)::int AS n
    FROM attendance_records a
    WHERE a.is_exception AND a.work_date >= ${filter.from}::date AND a.work_date <= ${filter.to}::date
      AND ${employeeFilter}
  `);
  return rows.rows[0]!.n;
}

// -- the punch-envelope sanity check -------------------------------------------------

/** The punch envelope: a punch timestamp must fall on the work date or
 * the day after it (the tenant's timezone — a declared night shift
 * ends on work_date + 1); a timestamp far from the operational day is
 * a data error, refused typed before any write. */
export async function timestampInEnvelope(
  at: string,
  workDate: string,
): Promise<boolean> {
  const rows = await tenantTx().execute<{ ok: boolean }>(sql`
    SELECT (((${at}::timestamptz) AT TIME ZONE
               (SELECT timezone FROM tenants WHERE id = erp.current_tenant_id()))::date
              BETWEEN ${workDate}::date AND (${workDate}::date + 1)) AS ok
  `);
  return Boolean(rows.rows[0]!.ok);
}
