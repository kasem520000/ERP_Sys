import { sql } from "drizzle-orm";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-047 (W-4 — T-10, D-07) — the external HR bridges store: the
 * READ-ONLY queries under the three export contracts (employee
 * master, employment history + org snapshot, appraisal results) + the
 * import paths' code-axis resolution. All reads run under the ambient
 * tenant UoW (RLS); the exports read the frozen employees substrate
 * READ-ONLY (D-01's law — the talent plane never writes it) and the
 * 0095/0097 talent tables.
 *
 * THE PII LAW (amendment A-4, made structural in domain/talent-bridge):
 * the SELECT lists project EXACTLY the documented contract columns —
 * the forbidden axes (national_id, bank fields, nationality,
 * probation_end, document numbers, free-form notes, money) are never
 * read into an export row. The unit spec pins the column lists; the DB
 * spec pins the rendered payloads.
 *
 * BR-090's posture at the bridge: the appraisal query reads the
 * MANAGER reviews only (the appraisal proper) with NO reviewer column
 * — the 360 input rows never enter an export and no attributed source
 * leaves the platform.
 *
 * The row ceiling (10,000 per export) is the bounded-file law (the
 * reporting contracts' LIMIT discipline): a bigger tenant export is a
 * deliberate migration, not a bridge pull.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("hr access requires an ambient tenant scope");
  }
  return context.tx;
}

/** The bridge exports' bounded-row ceiling (the reporting contracts'
 * LIMIT discipline — a bigger pull is a migration, not a bridge). */
export const BRIDGE_EXPORT_MAX_ROWS = 10_000;

export interface EmployeeMasterExportRow {
  employeeCode: string;
  employeeName: string;
  employeeNameAr: string | null;
  contractType: string;
  employmentStatus: string;
  hireDate: string;
  terminationDate: string | null;
}

/** Contract 1 (`hr.employee-master`): the person + employment master —
 * one row per employee, the documented seven columns only. */
export async function listEmployeeMasterRows(): Promise<EmployeeMasterExportRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT e.code AS "employeeCode", e.name AS "employeeName", e.name_ar AS "employeeNameAr",
           e.contract_type AS "contractType", e.status AS "employmentStatus",
           e.hire_date::text AS "hireDate", e.termination_date::text AS "terminationDate"
    FROM employees e
    ORDER BY e.code
    LIMIT ${BRIDGE_EXPORT_MAX_ROWS}
  `);
  return rows.rows as unknown as EmployeeMasterExportRow[];
}

export interface EmploymentOrgSnapshotExportRow {
  employeeCode: string;
  employeeName: string;
  hireDate: string;
  terminationDate: string | null;
  employmentStatus: string;
  positionCode: string | null;
  positionTitle: string | null;
  positionTitleAr: string | null;
  positionGrade: string | null;
  positionStatus: string | null;
  orgUnitCode: string | null;
  orgUnitName: string | null;
  orgUnitNameAr: string | null;
  orgUnitPath: string | null;
  orgUnitActive: boolean | null;
  reportsToPositionCode: string | null;
}

/** Contract 2 (`hr.employment-org-snapshot`): the employment record
 * enriched with the D-01 placement extension + the org snapshot axes —
 * one row per employee; a position-less employee ships with empty
 * placement columns (the master stays valid, D-01's own law). */
export async function listEmploymentOrgSnapshotRows(): Promise<EmploymentOrgSnapshotExportRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT e.code AS "employeeCode", e.name AS "employeeName",
           e.hire_date::text AS "hireDate", e.termination_date::text AS "terminationDate",
           e.status AS "employmentStatus",
           p.code AS "positionCode", p.title AS "positionTitle", p.title_ar AS "positionTitleAr",
           p.grade AS "positionGrade", p.status AS "positionStatus",
           ou.code AS "orgUnitCode", ou.name AS "orgUnitName", ou.name_ar AS "orgUnitNameAr",
           ou.path AS "orgUnitPath", ou.active AS "orgUnitActive",
           rp.code AS "reportsToPositionCode"
    FROM employees e
    LEFT JOIN positions p ON p.id = e.position_id
    LEFT JOIN org_units ou ON ou.id = p.org_unit_id
    LEFT JOIN positions rp ON rp.id = p.reports_to
    ORDER BY e.code
    LIMIT ${BRIDGE_EXPORT_MAX_ROWS}
  `);
  return rows.rows as unknown as EmploymentOrgSnapshotExportRow[];
}

export interface AppraisalResultsExportRow {
  cycleId: string;
  cycleName: string;
  cyclePeriodStart: string;
  cyclePeriodEnd: string;
  cycleStatus: string;
  employeeCode: string;
  employeeName: string;
  overallScore: string | null;
  goalRollup: string | null;
  reviewStatus: string;
}

/** Contract 3 (`hr.appraisal-results`): the appraisal OUTCOMES — one
 * row per (cycle × reviewee) MANAGER review in SUBMITTED/CALIBRATED
 * state (a DRAFT is not a result); no reviewer axis, no 360 input
 * rows, no scorecard detail (BR-090's posture + the v1 boundary). */
export async function listAppraisalResultsRows(
  cycleId?: string,
): Promise<AppraisalResultsExportRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT c.id::text AS "cycleId", c.name AS "cycleName",
           c.period_start::text AS "cyclePeriodStart", c.period_end::text AS "cyclePeriodEnd",
           c.status AS "cycleStatus",
           e.code AS "employeeCode", e.name AS "employeeName",
           r.overall_score::text AS "overallScore", r.goal_rollup::text AS "goalRollup",
           r.status AS "reviewStatus"
    FROM performance_reviews r
    JOIN performance_cycles c ON c.id = r.cycle_id
    JOIN employees e ON e.id = r.reviewee_employee_id
    WHERE r.kind = 'MANAGER' AND r.status IN ('SUBMITTED', 'CALIBRATED')
      AND (${cycleId ?? null}::uuid IS NULL OR r.cycle_id = ${cycleId ?? null}::uuid)
    ORDER BY c.period_start DESC, c.name, e.code
    LIMIT ${BRIDGE_EXPORT_MAX_ROWS}
  `);
  return rows.rows as unknown as AppraisalResultsExportRow[];
}

// ── the import paths' code-axis resolution (the attendance import's
// employeeIdsByCodes precedent — batch, tenant-RLS'd, unknown and
// foreign codes both miss: A7 parity by construction) ───────────────────────

/** Map employee CODES → ids under RLS (the imports' code axis —
 * external files identify people by their printed code; the
 * attendance-import store's exact IN-join shape). */
export async function employeeIdsByCodes(codes: readonly string[]): Promise<Map<string, string>> {
  if (codes.length === 0) return new Map();
  const distinct = [...new Set(codes)];
  const rows = await tenantTx().execute<{ code: string; id: string }>(sql`
    SELECT code, id::text AS id FROM employees
    WHERE code IN (${sql.join(
      distinct.map((code) => sql`${code}`),
      sql`, `,
    )})
  `);
  return new Map(rows.rows.map((row) => [row.code, row.id]));
}

export interface ProgramBrief {
  id: string;
  code: string;
  status: string;
}

/** Map training program CODES → briefs under RLS (the training import's
 * code axis; the RETIRED gate rides the status). */
export async function programsByCodes(codes: readonly string[]): Promise<Map<string, ProgramBrief>> {
  if (codes.length === 0) return new Map();
  const distinct = [...new Set(codes)];
  const rows = await tenantTx().execute<{ id: string; code: string; status: string }>(sql`
    SELECT id::text AS id, code, status FROM training_programs
    WHERE code IN (${sql.join(
      distinct.map((code) => sql`${code}`),
      sql`, `,
    )})
  `);
  return new Map(rows.rows.map((row) => [row.code, row as ProgramBrief]));
}
