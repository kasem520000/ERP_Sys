import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-045 (T-03) — the HR store: the shift templates (HR-04) + the
 * employee × date roster grid. The employees substrate is the 029
 * payroll baseline — this store READS it (the manufacturing-store
 * precedent for cross-module table reads under RLS; hr never writes
 * payroll tables). The roster's ONE-row-per-cell law is the table's
 * `uq_shift_rotations_cell` unique — edits REPLACE, never duplicate.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("hr access requires an ambient tenant scope");
  }
  return context.tx;
}

export interface ShiftRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  breakMinutes: number;
  isNight: boolean;
  active: boolean;
  note: string | null;
  noteAr: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RosterCellRow {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  workDate: string;
  shiftId: string | null;
  shiftCode: string | null;
  shiftName: string | null;
  startTime: string | null;
  endTime: string | null;
  isNight: boolean | null;
  source: string;
  note: string | null;
}

const SHIFT_COLUMNS = sql`
  id, code, name, name_ar AS "nameAr", start_time::text AS "startTime",
  end_time::text AS "endTime", grace_minutes AS "graceMinutes",
  break_minutes AS "breakMinutes", is_night AS "isNight", active,
  note, note_ar AS "noteAr", created_at::text AS "createdAt",
  updated_at::text AS "updatedAt"
`;

function mapShift(row: Record<string, unknown>): ShiftRow {
  return {
    id: row.id as string,
    code: row.code as string,
    name: row.name as string,
    nameAr: (row.nameAr as string | null) ?? null,
    startTime: String(row.startTime).slice(0, 8),
    endTime: String(row.endTime).slice(0, 8),
    graceMinutes: Number(row.graceMinutes),
    breakMinutes: Number(row.breakMinutes),
    isNight: Boolean(row.isNight),
    active: Boolean(row.active),
    note: (row.note as string | null) ?? null,
    noteAr: (row.noteAr as string | null) ?? null,
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt),
  };
}

// -- shifts -----------------------------------------------------------------------

export async function insertShift(input: {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  breakMinutes: number;
  isNight: boolean;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
}): Promise<ShiftRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO shifts (id, tenant_id, code, name, name_ar, start_time, end_time,
                        grace_minutes, break_minutes, is_night, note, note_ar, created_by)
    VALUES (${input.id}, erp.current_tenant_id(), ${input.code}, ${input.name},
            ${input.nameAr}, ${input.startTime}::time, ${input.endTime}::time,
            ${input.graceMinutes}, ${input.breakMinutes}, ${input.isNight},
            ${input.note}, ${input.noteAr}, ${input.createdBy})
    RETURNING ${SHIFT_COLUMNS}
  `);
  return mapShift((rows.rows as unknown as Record<string, unknown>[])[0]!);
}

export async function findShiftById(id: string): Promise<ShiftRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${SHIFT_COLUMNS} FROM shifts WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as Record<string, unknown>[])[0] === undefined
    ? undefined
    : mapShift((rows.rows as unknown as Record<string, unknown>[])[0]!);
}

export async function findShiftByCode(code: string): Promise<ShiftRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${SHIFT_COLUMNS} FROM shifts WHERE code = ${code} LIMIT 1
  `);
  return (rows.rows as unknown as Record<string, unknown>[])[0] === undefined
    ? undefined
    : mapShift((rows.rows as unknown as Record<string, unknown>[])[0]!);
}

export async function listShifts(filter: {
  active?: boolean;
  limit: number;
}): Promise<ShiftRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${SHIFT_COLUMNS} FROM shifts
    WHERE (${filter.active ?? null}::boolean IS NULL OR active = ${filter.active ?? null})
    ORDER BY code LIMIT ${filter.limit}
  `);
  return (rows.rows as unknown as Record<string, unknown>[]).map(mapShift);
}

export async function patchShift(input: {
  id: string;
  code?: string;
  name?: string;
  nameAr?: string | null;
  startTime?: string;
  endTime?: string;
  graceMinutes?: number;
  breakMinutes?: number;
  isNight?: boolean;
  note?: string | null;
  noteAr?: string | null;
}): Promise<ShiftRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE shifts SET
      code = COALESCE(${input.code ?? null}, code),
      name = COALESCE(${input.name ?? null}, name),
      name_ar = COALESCE(${input.nameAr ?? null}, name_ar),
      start_time = COALESCE(${input.startTime ?? null}::time, start_time),
      end_time = COALESCE(${input.endTime ?? null}::time, end_time),
      grace_minutes = COALESCE(${input.graceMinutes ?? null}, grace_minutes),
      break_minutes = COALESCE(${input.breakMinutes ?? null}, break_minutes),
      is_night = COALESCE(${input.isNight ?? null}, is_night),
      note = COALESCE(${input.note ?? null}, note),
      note_ar = COALESCE(${input.noteAr ?? null}, note_ar),
      updated_at = now(), version = version + 1
    WHERE id = ${input.id}
    RETURNING ${SHIFT_COLUMNS}
  `);
  return (rows.rows as unknown as Record<string, unknown>[])[0] === undefined
    ? undefined
    : mapShift((rows.rows as unknown as Record<string, unknown>[])[0]!);
}

export async function setShiftActive(id: string, active: boolean): Promise<ShiftRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE shifts SET active = ${active}, updated_at = now(), version = version + 1
    WHERE id = ${id}
    RETURNING ${SHIFT_COLUMNS}
  `);
  return (rows.rows as unknown as Record<string, unknown>[])[0] === undefined
    ? undefined
    : mapShift((rows.rows as unknown as Record<string, unknown>[])[0]!);
}

// -- the employees substrate (READ-ONLY — the 029 payroll baseline) ------------------

export async function employeeExists(id: string): Promise<boolean> {
  const rows = await tenantTx().execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM employees WHERE id = ${id} AND status = 'ACTIVE'
  `);
  return rows.rows[0]!.n > 0;
}

// -- the roster grid (ONE row per employee × date — edits replace) -------------------

const ROSTER_COLUMNS = sql`
  r.id, r.employee_id AS "employeeId", e.code AS "employeeCode", e.name AS "employeeName",
  r.work_date::text AS "workDate", r.shift_id AS "shiftId",
  s.code AS "shiftCode", s.name AS "shiftName",
  s.start_time::text AS "startTime", s.end_time::text AS "endTime",
  s.is_night AS "isNight", r.source, r.note
`;

export async function listRosterCells(filter: {
  from: string;
  to: string;
  employeeIds?: readonly string[];
  limit: number;
}): Promise<RosterCellRow[]> {
  const employeeFilter =
    filter.employeeIds === undefined || filter.employeeIds.length === 0
      ? sql`true`
      : sql`r.employee_id IN (${sql.join(
          filter.employeeIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;
  const rows = await tenantTx().execute(sql`
    SELECT ${ROSTER_COLUMNS}
    FROM shift_rotations r
    JOIN employees e ON e.id = r.employee_id
    LEFT JOIN shifts s ON s.id = r.shift_id
    WHERE r.work_date >= ${filter.from}::date AND r.work_date <= ${filter.to}::date
      AND ${employeeFilter}
    ORDER BY r.work_date, e.code
    LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as RosterCellRow[];
}

/** The editor's cell write: INSERT-or-REPLACE, source = MANUAL (a
 * human's explicit edit always wins — including over a ROTATION row). */
export async function upsertManualCell(input: {
  employeeId: string;
  workDate: string;
  shiftId: string | null;
  note: string | null;
  createdBy: string | null;
}): Promise<RosterCellRow | undefined> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO shift_rotations (id, tenant_id, employee_id, work_date, shift_id, source, note, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.employeeId},
            ${input.workDate}::date, ${input.shiftId}, 'MANUAL', ${input.note}, ${input.createdBy})
    ON CONFLICT ("tenant_id", "employee_id", "work_date") DO UPDATE SET
      shift_id = EXCLUDED.shift_id, source = 'MANUAL', note = EXCLUDED.note,
      updated_at = now(), version = shift_rotations.version + 1
    RETURNING id
  `);
  if ((rows.rows as unknown as { id: string }[])[0] === undefined) return undefined;
  const single = await listRosterCells({
    from: input.workDate,
    to: input.workDate,
    employeeIds: [input.employeeId],
    limit: 2,
  });
  return single[0];
}

export async function deleteRosterCell(employeeId: string, workDate: string): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    DELETE FROM shift_rotations
    WHERE employee_id = ${employeeId} AND work_date = ${workDate}::date
    RETURNING id
  `);
  return (rows.rows as unknown as { id: string }[]).length > 0;
}

/** The rotation generator's bulk write: source = ROTATION, and an
 * existing MANUAL cell is PRESERVED (the DO UPDATE's WHERE arm — the
 * human's explicit edit beats the pattern). Returns the ids actually
 * written; the caller derives the preserved count. */
export async function bulkUpsertRotationCells(
  cells: readonly {
    employeeId: string;
    workDate: string;
    shiftId: string | null;
    createdBy: string | null;
  }[],
): Promise<string[]> {
  if (cells.length === 0) return [];
  const values = cells.map(
    (cell) => sql`(${generateUuidV7()}, erp.current_tenant_id(), ${cell.employeeId},
                   ${cell.workDate}::date, ${cell.shiftId}, 'ROTATION', NULL, ${cell.createdBy})`,
  );
  const rows = await tenantTx().execute<{ id: string }>(sql`
    INSERT INTO shift_rotations (id, tenant_id, employee_id, work_date, shift_id, source, note, created_by)
    VALUES ${sql.join(values, sql`, `)}
    ON CONFLICT ("tenant_id", "employee_id", "work_date") DO UPDATE SET
      shift_id = EXCLUDED.shift_id, source = 'ROTATION', updated_at = now(),
      version = shift_rotations.version + 1
    WHERE shift_rotations.source <> 'MANUAL'
    RETURNING id
  `);
  return rows.rows.map((row) => row.id);
}
