import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-045 (T-07) — the leave store: the type catalog (HR-02), the
 * per-(employee, type, YEAR) balance cells (INV-031's home — rows, not
 * views, so the period-close snapshot is reconstructable), and the
 * request lifecycle (PENDING → APPROVED/REJECTED/CANCELLED, the
 * simple-approval chain). All day arithmetic is EXACT DECIMAL-STRING
 * math (numeric(7,2) in SQL, scaled integers in TS — never float;
 * ADR-0009).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("hr access requires an ambient tenant scope");
  }
  return context.tx;
}

export interface LeaveTypeRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  paid: boolean;
  accrualDaysPerYear: string;
  monthlyGrant: boolean;
  prorateJoiners: boolean;
  carryOverCapDays: string;
  active: boolean;
  note: string | null;
  noteAr: string | null;
}

export interface LeaveBalanceRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  year: number;
  entitlementDays: string;
  usedDays: string;
  carriedForwardDays: string;
  /** entitlement + carried − used (SQL numeric — exact). */
  remainingDays: string;
}

export interface LeaveRequestRow {
  id: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  startDate: string;
  endDate: string;
  days: string;
  status: string;
  requestedBy: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  note: string | null;
}

const TYPE_COLUMNS = sql`
  id, code, name, name_ar AS "nameAr", paid,
  accrual_days_per_year::text AS "accrualDaysPerYear", monthly_grant AS "monthlyGrant",
  prorate_joiners AS "prorateJoiners", carry_over_cap_days::text AS "carryOverCapDays",
  active, note, note_ar AS "noteAr"
`;

const BALANCE_COLUMNS = sql`
  b.employee_id AS "employeeId", e.code AS "employeeCode", e.name AS "employeeName",
  b.leave_type_id AS "leaveTypeId", t.code AS "leaveTypeCode", b.year,
  b.entitlement_days::text AS "entitlementDays", b.used_days::text AS "usedDays",
  b.carried_forward_days::text AS "carriedForwardDays",
  (b.entitlement_days + b.carried_forward_days - b.used_days)::text AS "remainingDays"
`;

const REQUEST_COLUMNS = sql`
  r.id, r.employee_id AS "employeeId", e.code AS "employeeCode", e.name AS "employeeName",
  r.leave_type_id AS "leaveTypeId", t.code AS "leaveTypeCode",
  r.start_date::text AS "startDate", r.end_date::text AS "endDate", r.days::text AS "days",
  r.status, r.requested_by::text AS "requestedBy", r.decided_by::text AS "decidedBy",
  r.decided_at::text AS "decidedAt", r.decision_note AS "decisionNote", r.note
`;

// -- the type catalog ------------------------------------------------------------------

export async function insertLeaveType(input: {
  code: string;
  name: string;
  nameAr: string | null;
  paid: boolean;
  accrualDaysPerYear: string;
  monthlyGrant: boolean;
  prorateJoiners: boolean;
  carryOverCapDays: string;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
}): Promise<LeaveTypeRow> {
  await tenantTx().execute(sql`
    INSERT INTO leave_types (id, tenant_id, code, name, name_ar, paid, accrual_days_per_year,
                             monthly_grant, prorate_joiners, carry_over_cap_days, note, note_ar, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.code}, ${input.name}, ${input.nameAr},
            ${input.paid}, ${input.accrualDaysPerYear}::numeric(7,2), ${input.monthlyGrant},
            ${input.prorateJoiners}, ${input.carryOverCapDays}::numeric(7,2),
            ${input.note}, ${input.noteAr}, ${input.createdBy})
  `);
  const found = await findLeaveTypeByCode(input.code);
  return found!;
}

export async function findLeaveTypeById(id: string): Promise<LeaveTypeRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TYPE_COLUMNS} FROM leave_types WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as LeaveTypeRow[])[0];
}

export async function findLeaveTypeByCode(code: string): Promise<LeaveTypeRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TYPE_COLUMNS} FROM leave_types WHERE code = ${code} LIMIT 1
  `);
  return (rows.rows as unknown as LeaveTypeRow[])[0];
}

export async function listLeaveTypes(filter: { active?: boolean; limit: number }): Promise<LeaveTypeRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TYPE_COLUMNS} FROM leave_types
    WHERE (${filter.active ?? null}::boolean IS NULL OR active = ${filter.active ?? null})
    ORDER BY code LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as LeaveTypeRow[];
}

export async function patchLeaveType(input: {
  id: string;
  name?: string;
  nameAr?: string | null;
  paid?: boolean;
  accrualDaysPerYear?: string;
  monthlyGrant?: boolean;
  prorateJoiners?: boolean;
  carryOverCapDays?: string;
  note?: string | null;
  noteAr?: string | null;
}): Promise<LeaveTypeRow | undefined> {
  await tenantTx().execute(sql`
    UPDATE leave_types SET
      name = COALESCE(${input.name ?? null}, name),
      name_ar = COALESCE(${input.nameAr ?? null}, name_ar),
      paid = COALESCE(${input.paid ?? null}, paid),
      accrual_days_per_year = COALESCE(${input.accrualDaysPerYear === undefined ? null : sql`${input.accrualDaysPerYear}::numeric(7,2)`}, accrual_days_per_year),
      monthly_grant = COALESCE(${input.monthlyGrant ?? null}, monthly_grant),
      prorate_joiners = COALESCE(${input.prorateJoiners ?? null}, prorate_joiners),
      carry_over_cap_days = COALESCE(${input.carryOverCapDays === undefined ? null : sql`${input.carryOverCapDays}::numeric(7,2)`}, carry_over_cap_days),
      note = COALESCE(${input.note ?? null}, note),
      note_ar = COALESCE(${input.noteAr ?? null}, note_ar),
      updated_at = now(), version = version + 1
    WHERE id = ${input.id}
  `);
  return findLeaveTypeById(input.id);
}

export async function setLeaveTypeActive(id: string, active: boolean): Promise<LeaveTypeRow | undefined> {
  await tenantTx().execute(sql`
    UPDATE leave_types SET active = ${active}, updated_at = now(), version = version + 1
    WHERE id = ${id}
  `);
  return findLeaveTypeById(id);
}

// -- the balance cells -------------------------------------------------------------------

export async function findBalanceCell(employeeId: string, leaveTypeId: string, year: number): Promise<LeaveBalanceRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${BALANCE_COLUMNS}
    FROM leave_balances b
    JOIN employees e ON e.id = b.employee_id
    JOIN leave_types t ON t.id = b.leave_type_id
    WHERE b.employee_id = ${employeeId} AND b.leave_type_id = ${leaveTypeId} AND b.year = ${year}
    LIMIT 1
  `);
  return (rows.rows as unknown as LeaveBalanceRow[])[0];
}

/** Ensure the (employee, type, year) cell exists (all zeros) — the
 * get-or-create arm every balance write rides. */
export async function ensureBalanceCell(employeeId: string, leaveTypeId: string, year: number): Promise<void> {
  await tenantTx().execute(sql`
    INSERT INTO leave_balances (id, tenant_id, employee_id, leave_type_id, year)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${employeeId}, ${leaveTypeId}, ${year})
    ON CONFLICT ("tenant_id", "employee_id", "leave_type_id", "year") DO NOTHING
  `);
}

export async function listBalances(filter: {
  employeeId?: string;
  year?: number;
}): Promise<LeaveBalanceRow[]> {
  const employeeFilter = filter.employeeId === undefined ? sql`true` : sql`b.employee_id = ${filter.employeeId}::uuid`;
  const yearFilter = filter.year === undefined ? sql`true` : sql`b.year = ${filter.year}`;
  const rows = await tenantTx().execute(sql`
    SELECT ${BALANCE_COLUMNS}
    FROM leave_balances b
    JOIN employees e ON e.id = b.employee_id
    JOIN leave_types t ON t.id = b.leave_type_id
    WHERE ${employeeFilter} AND ${yearFilter}
    ORDER BY e.code, t.code, b.year
  `);
  return rows.rows as unknown as LeaveBalanceRow[];
}

/** The balance decrement at the approve boundary (INV-031's write —
 * the service verified the cap BEFORE this; the ambient transaction
 * keeps the request + the decrement atomic). */
export async function incrementUsedDays(employeeId: string, leaveTypeId: string, year: number, days: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE leave_balances SET
      used_days = used_days + ${days}::numeric(7,2), updated_at = now(), version = version + 1
    WHERE employee_id = ${employeeId} AND leave_type_id = ${leaveTypeId} AND year = ${year}
  `);
}

/** The accrual run's entitlement write (the bulk recompute — the
 * entitlement is RECOMPUTED, never incremented; used stays). */
export async function bulkUpsertEntitlements(rows: readonly {
  employeeId: string;
  entitlementDays: string;
}[], leaveTypeId: string, year: number): Promise<number> {
  if (rows.length === 0) return 0;
  const values = rows.map(
    (row) => sql`(${generateUuidV7()}, erp.current_tenant_id(), ${row.employeeId}, ${leaveTypeId}, ${year}, ${row.entitlementDays}::numeric(7,2))`,
  );
  const written = await tenantTx().execute<{ id: string }>(sql`
    INSERT INTO leave_balances (id, tenant_id, employee_id, leave_type_id, year, entitlement_days)
    VALUES ${sql.join(values, sql`, `)}
    ON CONFLICT ("tenant_id", "employee_id", "leave_type_id", "year") DO UPDATE SET
      entitlement_days = EXCLUDED.entitlement_days, updated_at = now(), version = leave_balances.version + 1
    RETURNING id
  `);
  return written.rows.length;
}

/** The rollover's carry write: the toYear cell's carried_forward is
 * SET (the rollover is the year's opening state — re-running the same
 * rollover is idempotent). */
export async function bulkUpsertCarryForwards(rows: readonly {
  employeeId: string;
  carriedForwardDays: string;
}[], leaveTypeId: string, year: number): Promise<number> {
  if (rows.length === 0) return 0;
  const values = rows.map(
    (row) => sql`(${generateUuidV7()}, erp.current_tenant_id(), ${row.employeeId}, ${leaveTypeId}, ${year}, ${row.carriedForwardDays}::numeric(7,2))`,
  );
  const written = await tenantTx().execute<{ id: string }>(sql`
    INSERT INTO leave_balances (id, tenant_id, employee_id, leave_type_id, year, carried_forward_days)
    VALUES ${sql.join(values, sql`, `)}
    ON CONFLICT ("tenant_id", "employee_id", "leave_type_id", "year") DO UPDATE SET
      carried_forward_days = EXCLUDED.carried_forward_days, updated_at = now(), version = leave_balances.version + 1
    RETURNING id
  `);
  return written.rows.length;
}

/** The ACTIVE employees' employment-months-in-year (the proration
 * axis): 12 for pre-year hires, 0 for future hires, else the months
 * from the hire month to December (the hire month counts fully — the
 * documented convention). */
export async function employmentMonthsInYear(year: number): Promise<{ employeeId: string; months: number }[]> {
  const rows = await tenantTx().execute<{ employeeId: string; months: number }>(sql`
    SELECT id::text AS "employeeId",
           CASE
             WHEN hire_date < make_date(${year}, 1, 1) THEN 12
             WHEN hire_date > make_date(${year}, 12, 31) THEN 0
             ELSE 13 - EXTRACT(MONTH FROM hire_date)::int
           END AS months
    FROM employees
    WHERE status = 'ACTIVE'
    ORDER BY code
  `);
  return rows.rows;
}

// -- the requests ---------------------------------------------------------------------------

export async function insertLeaveRequest(input: {
  employeeId: string;
  leaveTypeId: string;
  startDate: string;
  endDate: string;
  days: string;
  note: string | null;
  requestedBy: string | null;
  createdBy: string | null;
}): Promise<LeaveRequestRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO leave_requests (id, tenant_id, employee_id, leave_type_id, start_date, end_date,
                                days, status, note, requested_by, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.employeeId}, ${input.leaveTypeId},
            ${input.startDate}::date, ${input.endDate}::date, ${input.days}::numeric(7,2),
            'PENDING', ${input.note}, ${input.requestedBy}, ${input.createdBy})
  `);
  const found = await findLeaveRequestById(id);
  return found!;
}

export async function findLeaveRequestById(id: string): Promise<LeaveRequestRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${REQUEST_COLUMNS}
    FROM leave_requests r
    JOIN employees e ON e.id = r.employee_id
    JOIN leave_types t ON t.id = r.leave_type_id
    WHERE r.id = ${id}
    LIMIT 1
  `);
  return (rows.rows as unknown as LeaveRequestRow[])[0];
}

/** A PENDING-or-APPROVED span of this employee overlapping [from, to]
 * (the two-leaves-at-once law's read). `excludeId` spares the request
 * being approved — its own span always overlaps itself (the
 * approve-boundary re-check, T-20). */
export async function findOverlappingLeave(
  employeeId: string,
  from: string,
  to: string,
  excludeId?: string,
): Promise<LeaveRequestRow | undefined> {
  const excludeFilter = excludeId === undefined ? sql`true` : sql`r.id <> ${excludeId}::uuid`;
  const rows = await tenantTx().execute(sql`
    SELECT ${REQUEST_COLUMNS}
    FROM leave_requests r
    JOIN employees e ON e.id = r.employee_id
    JOIN leave_types t ON t.id = r.leave_type_id
    WHERE r.employee_id = ${employeeId} AND r.status IN ('PENDING', 'APPROVED')
      AND r.start_date <= ${to}::date AND r.end_date >= ${from}::date
      AND ${excludeFilter}
    ORDER BY r.start_date
    LIMIT 1
  `);
  return (rows.rows as unknown as LeaveRequestRow[])[0];
}

export async function decideLeaveRequest(input: {
  id: string;
  status: "APPROVED" | "REJECTED" | "CANCELLED";
  decidedBy: string | null;
  decisionNote: string | null;
}): Promise<LeaveRequestRow | undefined> {
  const rows = await tenantTx().execute<{ id: string }>(sql`
    UPDATE leave_requests SET
      status = ${input.status}::text, decided_by = ${input.decidedBy}, decided_at = now(),
      decision_note = ${input.decisionNote}, updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status = 'PENDING'
    RETURNING id
  `);
  if ((rows.rows as unknown as { id: string }[])[0] === undefined) return undefined;
  return findLeaveRequestById(input.id);
}

export async function listLeaveRequests(filter: {
  from: string;
  to: string;
  employeeIds?: readonly string[];
  status?: string;
  limit: number;
  offset: number;
}): Promise<LeaveRequestRow[]> {
  const employeeFilter =
    filter.employeeIds === undefined || filter.employeeIds.length === 0
      ? sql`true`
      : sql`r.employee_id IN (${sql.join(
          filter.employeeIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;
  const statusFilter = filter.status === undefined ? sql`true` : sql`r.status = ${filter.status}::text`;
  const rows = await tenantTx().execute(sql`
    SELECT ${REQUEST_COLUMNS}
    FROM leave_requests r
    JOIN employees e ON e.id = r.employee_id
    JOIN leave_types t ON t.id = r.leave_type_id
    WHERE r.start_date <= ${filter.to}::date AND r.end_date >= ${filter.from}::date
      AND ${employeeFilter} AND ${statusFilter}
    ORDER BY r.start_date, e.code
    LIMIT ${filter.limit} OFFSET ${filter.offset}
  `);
  return rows.rows as unknown as LeaveRequestRow[];
}

export async function countLeaveRequests(filter: {
  from: string;
  to: string;
  employeeIds?: readonly string[];
  status?: string;
}): Promise<number> {
  const employeeFilter =
    filter.employeeIds === undefined || filter.employeeIds.length === 0
      ? sql`true`
      : sql`r.employee_id IN (${sql.join(
          filter.employeeIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;
  const statusFilter = filter.status === undefined ? sql`true` : sql`r.status = ${filter.status}::text`;
  const rows = await tenantTx().execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM leave_requests r
    WHERE r.start_date <= ${filter.to}::date AND r.end_date >= ${filter.from}::date
      AND ${employeeFilter} AND ${statusFilter}
  `);
  return rows.rows[0]!.n;
}

// -- the golden G-50/G-51 reads (T-11) --------------------------------------------

/** The accrual ROSTER (G-50): every employee who earns the period's
 * monthly slice — hired on or before the period's END (the hire month
 * counts fully — the T-07 convention), not terminated before the
 * period's START (TERMINATED is terminal; a termination inside the
 * period earns its month — the same hire-month symmetry), carrying the
 * basic salary for the daily-rate valuation. */
export async function listAccrualRoster(periodStart: string, periodEnd: string): Promise<
  { id: string; code: string; name: string; basicSalary: string; status: string }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT id, code, name, basic_salary::text AS "basicSalary", status
    FROM employees
    WHERE hire_date <= ${periodEnd}::date
      AND (termination_date IS NULL OR termination_date >= ${periodStart}::date)
      AND status IN ('ACTIVE', 'SUSPENDED')
    ORDER BY code
  `);
  return rows.rows as unknown as {
    id: string;
    code: string;
    name: string;
    basicSalary: string;
    status: string;
  }[];
}

/** The encashment's employee read (G-51): the ACTIVE employee with the
 * basic salary for the daily-rate valuation (TERMINATED employees
 * encash through the EOS machinery — the 029 G-31 world, never here). */
export async function findEncashableEmployee(
  id: string,
): Promise<{ id: string; code: string; name: string; basicSalary: string; status: string } | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, code, name, basic_salary::text AS "basicSalary", status
    FROM employees WHERE id = ${id}::uuid LIMIT 1
  `);
  return (rows.rows as unknown as {
    id: string;
    code: string;
    name: string;
    basicSalary: string;
    status: string;
  }[])[0];
}
