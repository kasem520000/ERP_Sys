import { sql } from "drizzle-orm";

import { requireTenantContext } from "../../../../infra/db/tenant-context";

/**
 * PHASE-045 T-16 · the hr query surface for the report contracts
 * (REPORT_CATALOG §9's PHASE-045 rows): `hr.attendance-register`,
 * `hr.leave-balances`, `hr.overtime-summary` — the workforce truth as
 * reports over the module-owned tables. Read-only over the ambient
 * tenant transaction (the registry query-service convention); all
 * quantity math is SQL NUMERIC crossing as DECIMAL STRINGS (ADR-0009).
 *
 * The registers ride the module's own read permissions per
 * REPORT_CATALOG §12 (the §3.23 matrix rows): hr.attendance,
 * hr.leave, hr.overtime — the same keys the /hr routes ride.
 */

/** The derivation's status vocabulary (the T-04 law — six verdicts). */
export const ATTENDANCE_STATUSES = [
  "PRESENT",
  "LATE",
  "ABSENT",
  "MISSING_PUNCH",
  "HOLIDAY",
  "ON_LEAVE",
] as const;

export interface AttendanceRegisterRow {
  recordId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  workDate: string;
  shiftCode: string | null;
  checkIn: string | null;
  checkOut: string | null;
  source: string;
  deviceRef: string | null;
  derivedStatus: string | null;
  lateMinutes: number | null;
  earlyLeaveMinutes: number | null;
  workedMinutes: number | null;
  overtimeMinutes: number | null;
  isException: boolean;
}

export interface LeaveBalanceRow {
  balanceId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  leaveTypeId: string;
  leaveTypeCode: string;
  leaveTypeNameAr: string | null;
  leaveTypeName: string;
  year: number;
  entitlementDays: string;
  carriedForwardDays: string;
  usedDays: string;
  remainingDays: string;
  pendingDays: string;
}

export interface OvertimeSummaryRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  ruleId: string;
  ruleCode: string;
  tier: string;
  multiplier: string;
  preApprovalRequired: boolean;
  entryCount: number;
  approvedHours: string;
  pendingFeedingHours: string;
  exceptionHours: string;
  rejectedHours: string;
  multipliedFeedingHours: string;
  exceptionCount: number;
}

export class HrQueriesService {
  /**
   * The attendance register: one row per punch session in the window
   * (the ABSENT marker rows are the (null, null) sessions the
   * derivation synthesizes — they render like any other row), with the
   * day's derived verdict and the minute facts. Newest date first,
   * then employee code.
   */
  async attendanceRegister(params: {
    dateFrom: string;
    dateTo: string;
    employeeId?: string;
    status?: (typeof ATTENDANCE_STATUSES)[number];
    exceptionsOnly?: boolean;
  }): Promise<AttendanceRegisterRow[]> {
    const context = requireTenantContext();
    if (context.tx === undefined) {
      throw new Error("hr report access requires an ambient tenant scope");
    }
    const rows = await context.tx.execute(sql`
      SELECT a.id::text AS "recordId", a.employee_id::text AS "employeeId",
             e.code AS "employeeCode", e.name AS "employeeName",
             a.work_date::text AS "workDate", s.code AS "shiftCode",
             a.check_in::text AS "checkIn", a.check_out::text AS "checkOut",
             a.source, a.device_ref AS "deviceRef",
             a.derived_status AS "derivedStatus",
             a.late_minutes AS "lateMinutes", a.early_leave_minutes AS "earlyLeaveMinutes",
             a.worked_minutes AS "workedMinutes", a.overtime_minutes AS "overtimeMinutes",
             a.is_exception AS "isException"
      FROM attendance_records a
      JOIN employees e ON e.id = a.employee_id
      LEFT JOIN shifts s ON s.id = a.shift_id
      WHERE a.work_date >= ${params.dateFrom}::date
        AND a.work_date <= ${params.dateTo}::date
        AND (${params.employeeId ?? null}::uuid IS NULL OR a.employee_id = ${params.employeeId ?? null}::uuid)
        AND (${params.status ?? null}::text IS NULL OR a.derived_status = ${params.status ?? null}::text)
        AND (${params.exceptionsOnly ?? false}::boolean IS FALSE OR a.is_exception = TRUE)
      ORDER BY a.work_date DESC, e.code, a.check_in NULLS FIRST
      LIMIT 5000`);
    return rows.rows as unknown as AttendanceRegisterRow[];
  }

  /**
   * The leave balances register: one row per (employee, type, year)
   * balance cell — entitlement, carried-forward, used, the
   * SQL-computed remaining (never three reads stitched in JS), and the
   * PENDING request days (the reviewer's visibility into uncommitted
   * spans — PENDING never charges a cell, INV-031's law counts only
   * approved days).
   */
  async leaveBalances(params: {
    year: number;
    employeeId?: string;
    leaveTypeId?: string;
  }): Promise<LeaveBalanceRow[]> {
    const context = requireTenantContext();
    if (context.tx === undefined) {
      throw new Error("hr report access requires an ambient tenant scope");
    }
    const rows = await context.tx.execute(sql`
      SELECT b.id::text AS "balanceId", b.employee_id::text AS "employeeId",
             e.code AS "employeeCode", e.name AS "employeeName",
             t.id::text AS "leaveTypeId", t.code AS "leaveTypeCode",
             COALESCE(t.name_ar, t.name) AS "leaveTypeNameAr", t.name AS "leaveTypeName",
             b.year,
             b.entitlement_days::text AS "entitlementDays",
             b.carried_forward_days::text AS "carriedForwardDays",
             b.used_days::text AS "usedDays",
             (b.entitlement_days + b.carried_forward_days - b.used_days)::numeric(7,2)::text AS "remainingDays",
             COALESCE((
               SELECT SUM(r.days)::numeric(7,2)::text
               FROM leave_requests r
               WHERE r.employee_id = b.employee_id
                 AND r.leave_type_id = b.leave_type_id
                 AND r.status = 'PENDING'
                 AND EXTRACT(YEAR FROM r.start_date) = b.year
             ), '0.00') AS "pendingDays"
      FROM leave_balances b
      JOIN employees e ON e.id = b.employee_id
      JOIN leave_types t ON t.id = b.leave_type_id
      WHERE b.year = ${params.year}
        AND (${params.employeeId ?? null}::uuid IS NULL OR b.employee_id = ${params.employeeId ?? null}::uuid)
        AND (${params.leaveTypeId ?? null}::uuid IS NULL OR b.leave_type_id = ${params.leaveTypeId ?? null}::uuid)
      ORDER BY e.code, t.code
      LIMIT 5000`);
    return rows.rows as unknown as LeaveBalanceRow[];
  }

  /**
   * The overtime summary: per (employee, rule) folds over the window —
   * the feeding law rendered as columns (BR-084): feeding hours =
   * APPROVED + PENDING-on-rules-without-pre-approval; the
   * pre-approval-required PENDING hours are the EXCEPTION column (never
   * fed); REJECTED never feeds. The multiplied hours ride the feeding
   * entries only (hours × multiplier in SQL NUMERIC — the pay-relevant
   * product, ADR-0009).
   */
  async overtimeSummary(params: {
    dateFrom: string;
    dateTo: string;
    employeeId?: string;
    tier?: "WEEKDAY" | "WEEKEND" | "HOLIDAY";
  }): Promise<OvertimeSummaryRow[]> {
    const context = requireTenantContext();
    if (context.tx === undefined) {
      throw new Error("hr report access requires an ambient tenant scope");
    }
    const rows = await context.tx.execute(sql`
      SELECT o.employee_id::text AS "employeeId", e.code AS "employeeCode",
             e.name AS "employeeName", r.id::text AS "ruleId", r.code AS "ruleCode",
             r.tier, r.multiplier::text AS "multiplier", r.pre_approval_required AS "preApprovalRequired",
             COUNT(*)::int AS "entryCount",
             COALESCE(SUM(o.hours) FILTER (WHERE o.status = 'APPROVED'), 0)::numeric(12,2)::text AS "approvedHours",
             COALESCE(SUM(o.hours) FILTER (WHERE o.status = 'PENDING' AND r.pre_approval_required = false), 0)::numeric(12,2)::text AS "pendingFeedingHours",
             COALESCE(SUM(o.hours) FILTER (WHERE o.status = 'PENDING' AND r.pre_approval_required = true), 0)::numeric(12,2)::text AS "exceptionHours",
             COALESCE(SUM(o.hours) FILTER (WHERE o.status = 'REJECTED'), 0)::numeric(12,2)::text AS "rejectedHours",
             COALESCE(SUM(o.hours * r.multiplier) FILTER (
               WHERE o.status = 'APPROVED' OR (o.status = 'PENDING' AND r.pre_approval_required = false)
             ), 0)::numeric(12,2)::text AS "multipliedFeedingHours",
             COUNT(*) FILTER (WHERE o.is_exception = true)::int AS "exceptionCount"
      FROM overtime_entries o
      JOIN employees e ON e.id = o.employee_id
      JOIN overtime_rules r ON r.id = o.rule_id
      WHERE o.work_date >= ${params.dateFrom}::date
        AND o.work_date <= ${params.dateTo}::date
        AND (${params.employeeId ?? null}::uuid IS NULL OR o.employee_id = ${params.employeeId ?? null}::uuid)
        AND (${params.tier ?? null}::text IS NULL OR r.tier = ${params.tier ?? null}::text)
      GROUP BY o.employee_id, e.code, e.name, r.id, r.code, r.tier, r.multiplier, r.pre_approval_required
      ORDER BY e.code, r.code
      LIMIT 5000`);
    return rows.rows as unknown as OvertimeSummaryRow[];
  }
}
