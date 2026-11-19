import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import type { SweepBand } from "../domain/talent-math";

/**
 * PHASE-047 (W-3 — T-09, D-06) — the hr-expiry-sweep store: the
 * hr_alert_jobs registration (the 044 inventory pattern — findAlertJob
 * / upsertAlertJob / stampAlertRun, the policies.store precedent) +
 * the FOUR PROBES (documents, certifications, probation end,
 * review-due windows), each a BANDED per-tenant walk over the
 * pre-built expiry indexes (0097's ix_*_tenant_expiry — the
 * index-driven law; the band predicate keeps every probe disjoint by
 * construction: `expiry <= today + toDays AND (fromDays IS NULL OR
 * expiry > today + fromDays)`).
 *
 * Every probe is READ-ONLY (D-06: "never a repair, only the alert" —
 * the sweep never writes a talent row; the notification + the run
 * stats + the audit event are the whole effect). The employees read
 * (the probation probe) rides the frozen substrate READ-ONLY (D-01).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("hr access requires an ambient tenant scope");
  }
  return context.tx;
}

// ── the config row (the 044 pattern) ───────────────────────────────────────

export interface HrAlertJobRow {
  id: string;
  jobKind: string;
  thresholds: readonly unknown[];
  isActive: boolean;
  lastRunAt: string | null;
  lastFlagged: number;
  note: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const JOB_COLUMNS = sql`
  id, job_kind AS "jobKind", thresholds AS "thresholds", is_active AS "isActive",
  last_run_at::text AS "lastRunAt", last_flagged AS "lastFlagged", note,
  version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
`;

/** The fail-closed read: undefined = the tenant registered NO row —
 * the service's documented defaults fire (an explicit is_active =
 * false row is the off switch; absent ≠ inactive — the inventory
 * law). */
export async function findAlertJob(jobKind: string): Promise<HrAlertJobRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${JOB_COLUMNS} FROM hr_alert_jobs WHERE job_kind = ${jobKind} LIMIT 1
  `);
  return (rows.rows as unknown as HrAlertJobRow[])[0];
}

/** The registration surface: ON CONFLICT (tenant, kind) DO UPDATE —
 * the config row is the register, the upsert is the update path. */
export async function upsertAlertJob(input: {
  jobKind: string;
  thresholds: readonly number[];
  isActive: boolean;
  note: string | null;
  createdBy: string | null;
}): Promise<HrAlertJobRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO hr_alert_jobs
      (id, tenant_id, job_kind, thresholds, is_active, note, created_by, updated_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.jobKind},
            ${JSON.stringify(input.thresholds)}::jsonb, ${input.isActive}, ${input.note},
            ${input.createdBy}, ${input.createdBy})
    ON CONFLICT ("tenant_id", "job_kind") DO UPDATE SET
      thresholds = EXCLUDED.thresholds, is_active = EXCLUDED.is_active,
      note = EXCLUDED.note, updated_at = now(), version = hr_alert_jobs.version + 1,
      updated_by = EXCLUDED.updated_by
    RETURNING ${JOB_COLUMNS}
  `);
  return (rows.rows as unknown as HrAlertJobRow[])[0]!;
}

/** The run-stats stamp (the stampAlertRun precedent): last_run_at +
 * last_flagged on the config row — a no-op when the tenant registered
 * no row (the defaults fire unregistered; nothing to stamp). */
export async function stampAlertRun(input: {
  jobKind: string;
  flagged: number;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE hr_alert_jobs SET
      last_run_at = now(), last_flagged = ${input.flagged}, updated_at = now(),
      version = version + 1
    WHERE job_kind = ${input.jobKind}
  `);
}

// ── the four probes (banded, bounded, index-driven) ────────────────────────

export interface ExpiringDocumentRow {
  id: string;
  employeeId: string;
  kind: string;
  expiresOn: string;
}

export interface ExpiringCertificationRow {
  id: string;
  employeeId: string;
  name: string;
  issuer: string;
  expiryDate: string;
}

export interface ProbationEndingRow {
  employeeId: string;
  probationEnd: string;
}

export interface ReviewDueCycleRow {
  id: string;
  name: string;
  reviewDueDate: string;
  status: string;
}

/** Probe 1 — employee documents (the hr.document-expiry windows):
 * the kind PASSPORT/IQAMA/… register's banded expiry walk. */
export async function scanExpiringDocuments(
  band: SweepBand,
  limit: number,
): Promise<ExpiringDocumentRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, employee_id AS "employeeId", kind, expires_on::text AS "expiresOn"
    FROM employee_documents
    WHERE expires_on IS NOT NULL
      AND expires_on <= (CURRENT_DATE + ${band.toDays}::int)
      AND (${band.fromDays ?? null}::int IS NULL OR expires_on > (CURRENT_DATE + ${band.fromDays ?? null}::int))
    ORDER BY expires_on, employee_id LIMIT ${limit}
  `);
  return rows.rows as unknown as ExpiringDocumentRow[];
}

/** Probe 2 — certifications (the hr.certification-expiry windows):
 * the register's banded expiry walk (NULL expiry = no window, ever). */
export async function scanExpiringCertifications(
  band: SweepBand,
  limit: number,
): Promise<ExpiringCertificationRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, employee_id AS "employeeId", name, issuer, expiry_date::text AS "expiryDate"
    FROM certifications
    WHERE expiry_date IS NOT NULL
      AND expiry_date <= (CURRENT_DATE + ${band.toDays}::int)
      AND (${band.fromDays ?? null}::int IS NULL OR expiry_date > (CURRENT_DATE + ${band.fromDays ?? null}::int))
    ORDER BY expiry_date, employee_id LIMIT ${limit}
  `);
  return rows.rows as unknown as ExpiringCertificationRow[];
}

/** Probe 3 — probation end (the hr.probation-end windows, amendment
 * A-1): the FAIL-OPEN substrate read — `probation_end IS NOT NULL` is
 * the whole skip law (NULL = not tracked, no alert ever fabricated). */
export async function scanProbationEnding(
  band: SweepBand,
  limit: number,
): Promise<ProbationEndingRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id AS "employeeId", probation_end::text AS "probationEnd"
    FROM employees
    WHERE probation_end IS NOT NULL
      AND probation_end <= (CURRENT_DATE + ${band.toDays}::int)
      AND (${band.fromDays ?? null}::int IS NULL OR probation_end > (CURRENT_DATE + ${band.fromDays ?? null}::int))
    ORDER BY probation_end, id LIMIT ${limit}
  `);
  return rows.rows as unknown as ProbationEndingRow[];
}

/** Probe 4 — review due (the hr.review-due windows): the LIVE cycles
 * (ACTIVE/CALIBRATION — the two states whose submissions are open)
 * with a review_due_date inside the band; DRAFT/CLOSED cycles never
 * alert (a draft has not opened; a closed cycle's window is history). */
export async function scanReviewDueCycles(
  band: SweepBand,
  limit: number,
): Promise<ReviewDueCycleRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, name, review_due_date::text AS "reviewDueDate", status
    FROM performance_cycles
    WHERE review_due_date IS NOT NULL AND status IN ('ACTIVE', 'CALIBRATION')
      AND review_due_date <= (CURRENT_DATE + ${band.toDays}::int)
      AND (${band.fromDays ?? null}::int IS NULL OR review_due_date > (CURRENT_DATE + ${band.fromDays ?? null}::int))
    ORDER BY review_due_date, id LIMIT ${limit}
  `);
  return rows.rows as unknown as ReviewDueCycleRow[];
}
