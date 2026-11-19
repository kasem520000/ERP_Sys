import { sql } from "drizzle-orm";

import { requireTenantContext } from "../../../../infra/db/tenant-context";
import { normalizeSweepWindows, sweepBands } from "../../../hr/domain/talent-math";
import type { SweepBand } from "../../../hr/domain/talent-math";

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
 *
 * PHASE-047 (W-6, T-15) · the TALENT extension — the four report
 * contracts (REPORT_CATALOG §9's PHASE-047 rows, registry 106 → 110):
 * `hr.performance-cycle-results`, `hr.recruitment-pipeline`,
 * `hr.training-completions`, `hr.document-expiry`. The same §12
 * convention: hr.performance.view, hr.recruitment.view,
 * hr.training.view, hr.documents.manage (matrix §3.25 — the same keys
 * the /hr talent routes ride). The band laws (BR-091's windows) ride
 * the hr module's own talent-math — the SAME machinery the sweep
 * rides (one source of truth; red line 5's DATA-not-constants law),
 * reached through the registry's documented cross-module read surface
 * (the payroll-queries precedent).
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

/** PHASE-047 (W-6, T-15) · one appraisal-outcome row per (cycle ×
 * reviewee) MANAGER review in SUBMITTED/CALIBRATED state — BR-090's
 * posture at the report BY CONSTRUCTION (the W-4 appraisal-bridge
 * precedent): the 360 input rows (SELF/PEER/SUBORDINATE) never ship
 * and NO reviewer axis exists. */
export interface PerformanceCycleResultsRow {
  reviewId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  cycleId: string;
  cycleName: string;
  periodStart: string;
  periodEnd: string;
  reviewStatus: string;
  overallScore: string | null;
  goalRollup: string | null;
}

/** PHASE-047 (W-6, T-15) · one funnel row per vacancy — COUNTS ONLY
 * (amendment A-4: the applicant's personal data never crosses into
 * exports; the pipeline report is the aggregate view, the in-app
 * board under hr.recruitment.view remains the attributed surface). */
export interface RecruitmentPipelineRow {
  vacancyId: string;
  vacancyCode: string;
  vacancyTitle: string;
  headcount: number;
  status: string;
  openedAt: string | null;
  filledAt: string | null;
  newCount: number;
  screenCount: number;
  interviewCount: number;
  offerCount: number;
  hiredCount: number;
  rejectedCount: number;
  totalCount: number;
}

/** PHASE-047 (W-6, T-15) · one row per COMPLETED enrollment inside
 * the window — the immutable completed_at stamp (the W-3 law: the
 * COMPLETED edge stamps once, never re-stamps) with the result. */
export interface TrainingCompletionsRow {
  enrollmentId: string;
  programId: string;
  programCode: string;
  programName: string;
  programKind: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  attendancePct: string | null;
  completionPct: string | null;
  result: string | null;
  completedAt: string;
}

/** PHASE-047 (W-6, T-15) · one row per document inside the expiry
 * window — the HR-10 register's report twin. The document NUMBER
 * never ships (amendment A-4: never in exports — employee code +
 * name + kind + dates + band only). */
export interface DocumentExpiryRow {
  documentId: string;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  kind: string;
  issuedOn: string | null;
  expiresOn: string;
  daysRemaining: number;
  band: string;
}

/** The tenant's configured sweep windows for the band fold (the
 * fail-closed read over hr_alert_jobs — the sweep's own source; the
 * documented 30/7/0 default when no row is registered). */
export async function tenantSweepWindows(): Promise<number[]> {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("hr report access requires an ambient tenant scope");
  }
  const rows = await context.tx.execute<{ thresholds: unknown[] | null }>(sql`
    SELECT thresholds FROM hr_alert_jobs WHERE job_kind = 'EXPIRY_SWEEP' LIMIT 1
  `);
  const thresholds = (rows.rows as unknown as Array<{ thresholds: unknown[] | null }>)[0]
    ?.thresholds;
  return normalizeSweepWindows(thresholds ?? []);
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

  /**
   * PHASE-047 (W-6, T-15) · the appraisal outcomes of one cycle: one
   * row per (cycle × reviewee) MANAGER review in SUBMITTED/CALIBRATED
   * state — the W-4 appraisal-bridge posture verbatim: the 360 input
   * rows never enter the row universe (kind = 'MANAGER' is structural)
   * and no reviewer axis exists in the projection. Employee code asc.
   */
  async performanceCycleResults(params: {
    cycleId: string;
    employeeId?: string;
  }): Promise<PerformanceCycleResultsRow[]> {
    const context = requireTenantContext();
    if (context.tx === undefined) {
      throw new Error("hr report access requires an ambient tenant scope");
    }
    const rows = await context.tx.execute(sql`
      SELECT r.id::text AS "reviewId",
             r.reviewee_employee_id::text AS "employeeId",
             e.code AS "employeeCode", e.name AS "employeeName",
             c.id::text AS "cycleId", COALESCE(c.name_ar, c.name) AS "cycleName",
             c.period_start::text AS "periodStart", c.period_end::text AS "periodEnd",
             r.status AS "reviewStatus",
             r.overall_score::text AS "overallScore",
             r.goal_rollup::text AS "goalRollup"
      FROM performance_reviews r
      JOIN performance_cycles c ON c.id = r.cycle_id
      JOIN employees e ON e.id = r.reviewee_employee_id
      WHERE r.cycle_id = ${params.cycleId}::uuid
        AND r.kind = 'MANAGER'
        AND r.status IN ('SUBMITTED', 'CALIBRATED')
        AND (${params.employeeId ?? null}::uuid IS NULL OR r.reviewee_employee_id = ${params.employeeId ?? null}::uuid)
      ORDER BY e.code
      LIMIT 5000`);
    return rows.rows as unknown as PerformanceCycleResultsRow[];
  }

  /**
   * PHASE-047 (W-6, T-15) · the recruitment funnel: one row per
   * vacancy with BR-088's FIXED ladder as count columns — the
   * aggregate view (counts only; the applicant's personal data never
   * crosses into the report, amendment A-4). Every applicant appears
   * in EXACTLY ONE stage column (the stage is single-valued by the
   * 0096 CHECK floor); totalCount is the fold of the six.
   */
  async recruitmentPipeline(params: {
    vacancyId?: string;
    status?: string;
  }): Promise<RecruitmentPipelineRow[]> {
    const context = requireTenantContext();
    if (context.tx === undefined) {
      throw new Error("hr report access requires an ambient tenant scope");
    }
    const rows = await context.tx.execute(sql`
      SELECT v.id::text AS "vacancyId", v.code AS "vacancyCode",
             COALESCE(v.title_ar, v.title) AS "vacancyTitle",
             v.headcount, v.status,
             v.opened_at::text AS "openedAt", v.filled_at::text AS "filledAt",
             COUNT(a.id) FILTER (WHERE a.stage = 'NEW')::int AS "newCount",
             COUNT(a.id) FILTER (WHERE a.stage = 'SCREEN')::int AS "screenCount",
             COUNT(a.id) FILTER (WHERE a.stage = 'INTERVIEW')::int AS "interviewCount",
             COUNT(a.id) FILTER (WHERE a.stage = 'OFFER')::int AS "offerCount",
             COUNT(a.id) FILTER (WHERE a.stage = 'HIRED')::int AS "hiredCount",
             COUNT(a.id) FILTER (WHERE a.stage = 'REJECTED')::int AS "rejectedCount",
             COUNT(a.id)::int AS "totalCount"
      FROM vacancies v
      LEFT JOIN applicants a ON a.vacancy_id = v.id
      WHERE (${params.vacancyId ?? null}::uuid IS NULL OR v.id = ${params.vacancyId ?? null}::uuid)
        AND (${params.status ?? null}::text IS NULL OR v.status = ${params.status ?? null}::text)
      GROUP BY v.id, v.code, v.title_ar, v.title, v.headcount, v.status, v.opened_at, v.filled_at
      ORDER BY v.code
      LIMIT 5000`);
    return rows.rows as unknown as RecruitmentPipelineRow[];
  }

  /**
   * PHASE-047 (W-6, T-15) · the training completions inside the
   * window: one row per COMPLETED enrollment — completed_at stamped
   * once (the W-3 immutability law), the result in the PENDING/
   * PASSED/FAILED vocabulary, the program and employee axes. Newest
   * completion first, then employee code.
   */
  async trainingCompletions(params: {
    dateFrom: string;
    dateTo: string;
    programId?: string;
    employeeId?: string;
  }): Promise<TrainingCompletionsRow[]> {
    const context = requireTenantContext();
    if (context.tx === undefined) {
      throw new Error("hr report access requires an ambient tenant scope");
    }
    const rows = await context.tx.execute(sql`
      SELECT t.id::text AS "enrollmentId",
             p.id::text AS "programId", p.code AS "programCode",
             COALESCE(p.name_ar, p.name) AS "programName", p.kind AS "programKind",
             t.employee_id::text AS "employeeId",
             e.code AS "employeeCode", e.name AS "employeeName",
             t.attendance_pct::text AS "attendancePct",
             t.completion_pct::text AS "completionPct",
             t.result, t.completed_at::text AS "completedAt"
      FROM training_enrollments t
      JOIN training_programs p ON p.id = t.program_id
      JOIN employees e ON e.id = t.employee_id
      WHERE t.status = 'COMPLETED'
        AND t.completed_at IS NOT NULL
        AND t.completed_at::date >= ${params.dateFrom}::date
        AND t.completed_at::date <= ${params.dateTo}::date
        AND (${params.programId ?? null}::uuid IS NULL OR t.program_id = ${params.programId ?? null}::uuid)
        AND (${params.employeeId ?? null}::uuid IS NULL OR t.employee_id = ${params.employeeId ?? null}::uuid)
      ORDER BY t.completed_at DESC, e.code
      LIMIT 5000`);
    return rows.rows as unknown as TrainingCompletionsRow[];
  }

  /**
   * PHASE-047 (W-6, T-15) · the document expiry register inside the
   * window: one row per document with expires_on ≤ today + daysAhead
   * (NULL expiry never ships — the sweep's own law), the days
   * remaining computed in SQL, and the band folded from the TENANT'S
   * configured sweep windows (the same hr_alert_jobs source the sweep
   * reads — never an invented threshold; the documented 30/7/0
   * default fires when no row is registered). The document number
   * never enters the projection (amendment A-4). Expiry date first
   * (the most urgent rows lead), then employee code.
   */
  async documentExpiry(params: {
    daysAhead: number;
    employeeId?: string;
    kind?: string;
  }): Promise<DocumentExpiryRow[]> {
    const context = requireTenantContext();
    if (context.tx === undefined) {
      throw new Error("hr report access requires an ambient tenant scope");
    }
    const windows = await tenantSweepWindows();
    const bands = sweepBands(windows);
    // The band classification, evaluated WIDEST-FIRST (the descending
    // fold's order): each wider band is (fromDays, toDays]; the
    // TIGHTEST band's lower edge is open — it catches everything at or
    // past its date, the already-expired included (the sweep's own
    // law). A row past every configured band (the daysAhead parameter
    // can widen the window beyond the tenant's alert thresholds)
    // renders the honest BEYOND label.
    const bandSql = sql.join(
      bands.map((band: SweepBand) => {
        const label = `BAND_${band.threshold}`;
        const lower =
          band.fromDays === null
            ? sql`true`
            : sql`(d.expires_on - CURRENT_DATE) > ${band.fromDays}::int`;
        return sql`WHEN ${lower} AND (d.expires_on - CURRENT_DATE) <= ${band.toDays}::int THEN ${label}`;
      }),
      sql` `,
    );
    const rows = await context.tx.execute(sql`
      SELECT d.id::text AS "documentId",
             d.employee_id::text AS "employeeId",
             e.code AS "employeeCode", e.name AS "employeeName",
             d.kind, d.issued_on::text AS "issuedOn", d.expires_on::text AS "expiresOn",
             (d.expires_on - CURRENT_DATE) AS "daysRemaining",
             CASE ${bandSql} ELSE 'BEYOND' END AS "band"
      FROM employee_documents d
      JOIN employees e ON e.id = d.employee_id
      WHERE d.expires_on IS NOT NULL
        AND d.expires_on <= (CURRENT_DATE + ${params.daysAhead}::int)
        AND (${params.employeeId ?? null}::uuid IS NULL OR d.employee_id = ${params.employeeId ?? null}::uuid)
        AND (${params.kind ?? null}::text IS NULL OR d.kind = ${params.kind ?? null}::text)
      ORDER BY d.expires_on, e.code
      LIMIT 5000`);
    return rows.rows as unknown as DocumentExpiryRow[];
  }
}
