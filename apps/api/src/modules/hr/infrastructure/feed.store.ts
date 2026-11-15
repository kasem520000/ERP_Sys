import { sql } from "drizzle-orm";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-045 (T-10) — the payroll variable-feed store: the per-period
 * aggregates PHASE-046's statutory engine consumes as variable lines —
 * the OVERTIME feed (BR-084's feeding law: APPROVED entries +
 * PENDING entries on rules WITHOUT the pre-approval requirement;
 * REJECTED never; a required rule's PENDING is the exception, never
 * fed), the ABSENCE/LATE feed (the attendance derivation's verdicts:
 * ABSENT days counted, LATE minutes summed — MISSING_PUNCH is its own
 * exception status, never an absence; HOLIDAY/ON_LEAVE are not
 * absences), and the LEAVE BALANCE SNAPSHOT (the per-year cells at
 * period close — rows, not views: reconstructable by construction).
 *
 * ALL money/quantity math is SQL NUMERIC (ADR-0009 — the feed crosses
 * the API as DECIMAL STRINGS, never float).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("hr access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- the overtime feed ---------------------------------------------------------------------

export interface OvertimeFeedLine {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  ruleId: string;
  ruleCode: string;
  tier: string;
  multiplier: string;
  /** SUM(hours) over the feeding entries — numeric(12,2) string. */
  hours: string;
  /** SUM(hours × multiplier) — the exact SQL NUMERIC product, numeric(12,2) string. */
  multipliedHours: string;
  entryCount: number;
}

/** THE OVERTIME FEED: per (employee, rule) sums over the period's
 * feeding entries — BR-084's law at the feed boundary. */
export async function overtimeFeedLines(from: string, to: string): Promise<OvertimeFeedLine[]> {
  const rows = await tenantTx().execute(sql`
    SELECT e.employee_id::text AS "employeeId", emp.code AS "employeeCode", emp.name AS "employeeName",
           r.id::text AS "ruleId", r.code AS "ruleCode", r.tier, r.multiplier::text AS "multiplier",
           SUM(e.hours)::numeric(12,2)::text AS "hours",
           SUM(e.hours * r.multiplier)::numeric(12,2)::text AS "multipliedHours",
           COUNT(*)::int AS "entryCount"
    FROM overtime_entries e
    JOIN employees emp ON emp.id = e.employee_id
    JOIN overtime_rules r ON r.id = e.rule_id
    WHERE e.work_date >= ${from}::date AND e.work_date <= ${to}::date
      AND (e.status = 'APPROVED'
           OR (e.status = 'PENDING' AND r.pre_approval_required = false))
    GROUP BY e.employee_id, emp.code, emp.name, r.id, r.code, r.tier, r.multiplier
    ORDER BY emp.code, r.code
  `);
  return rows.rows as unknown as OvertimeFeedLine[];
}

// -- the absence / late feed ----------------------------------------------------------------

export interface AbsenceLateFeedRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  /** COUNT of derived-ABSENT days in the period — the derivation's
   * verdict (a rostered past punchless day), never a raw-punch guess. */
  absenceDays: number;
  /** COUNT of derived-MISSING_PUNCH days (surfaced for the payroll
   * reviewer — its own exception class, NEVER folded into absence). */
  missingPunchDays: number;
  /** SUM(late_minutes) over the period — the exact minute facts. */
  lateMinutes: number;
}

/** THE ABSENCE/LATE FEED: per-employee aggregates over the derivation's
 * verdicts in the period. */
export async function absenceLateFeedRows(from: string, to: string): Promise<AbsenceLateFeedRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT a.employee_id::text AS "employeeId", emp.code AS "employeeCode", emp.name AS "employeeName",
           COUNT(*) FILTER (WHERE a.derived_status = 'ABSENT')::int AS "absenceDays",
           COUNT(*) FILTER (WHERE a.derived_status = 'MISSING_PUNCH')::int AS "missingPunchDays",
           COALESCE(SUM(a.late_minutes) FILTER (WHERE a.late_minutes > 0), 0)::int AS "lateMinutes"
    FROM attendance_records a
    JOIN employees emp ON emp.id = a.employee_id
    WHERE a.work_date >= ${from}::date AND a.work_date <= ${to}::date
    GROUP BY a.employee_id, emp.code, emp.name
    ORDER BY emp.code
  `);
  return rows.rows as unknown as AbsenceLateFeedRow[];
}

// -- the leave balance snapshot ---------------------------------------------------------------

export interface LeaveSnapshotCell {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  year: number;
  entitlementDays: string;
  usedDays: string;
  carriedForwardDays: string;
  /** entitlement + carried − used — the SQL-computed remaining (never
   * three reads stitched in JS). */
  remainingDays: string;
}

/** THE LEAVE BALANCE SNAPSHOT at period close: the per-year cells for
 * the snapshot year — the exact inputs PHASE-046's statutory engine
 * consumes (INV-031's shape holds by construction: used ≤ entitlement +
 * carried on every cell). */
export async function leaveSnapshotCells(year: number): Promise<LeaveSnapshotCell[]> {
  const rows = await tenantTx().execute(sql`
    SELECT b.employee_id::text AS "employeeId", emp.code AS "employeeCode", emp.name AS "employeeName",
           t.id::text AS "leaveTypeId", t.code AS "leaveTypeCode", b.year,
           b.entitlement_days::text AS "entitlementDays", b.used_days::text AS "usedDays",
           b.carried_forward_days::text AS "carriedForwardDays",
           (b.entitlement_days + b.carried_forward_days - b.used_days)::numeric(7,2)::text AS "remainingDays"
    FROM leave_balances b
    JOIN employees emp ON emp.id = b.employee_id
    JOIN leave_types t ON t.id = b.leave_type_id
    WHERE b.year = ${year}
    ORDER BY emp.code, t.code
  `);
  return rows.rows as unknown as LeaveSnapshotCell[];
}
