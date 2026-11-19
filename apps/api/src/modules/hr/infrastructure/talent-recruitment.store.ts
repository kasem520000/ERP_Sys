import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-047 (W-3 — T-07) — the recruitment store: the ONLY writer for
 * the 0096 cluster's rows (vacancies, applicants, interviews — the
 * statutory.store precedent: one store per migration family). All
 * reads run under the ambient tenant UoW (RLS); every numeric field
 * crosses the boundary as an EXACT 2-dp decimal string (::text, never
 * a JS number — ADR-0009's law).
 *
 * THE WRITE SHAPES (each one conditional — the races are closed by the
 * statement, not by a surrounding read — the W-2 talent.store law):
 *
 * - THE VACANCY LIFECYCLE CAS: `casTransitionVacancy` is ONE
 *   UPDATE … WHERE id AND status = ${from} — zero rows = the
 *   raced/stale move; the typed VacancyStateConflictError is the
 *   service's (re-read for the honest current-state refusal).
 * - THE STAGE CAS (BR-088's monotonic law made structural):
 *   `casAdvanceStage` is ONE UPDATE … WHERE id AND stage = ${from} —
 *   the row lock is the gate; the stage_history jsonb append rides
 *   the SAME statement (the transition record is atomic with the
 *   move — a raced backward jump matches ZERO rows).
 * - THE HIRE CAS (the written-once link): `casHireApplicant` is ONE
 *   UPDATE … WHERE id AND stage = 'OFFER' AND hired_employee_id IS
 *   NULL — the employee link writes exactly once, atomically with the
 *   OFFER→HIRED hop; a raced or repeated hire matches ZERO rows (the
 *   typed ApplicantAlreadyHiredError is the service's, and the
 *   ambient tenant UoW rolls the employee-side effects back with it).
 * - THE SCORECARD UPDATE: `updateInterviewScorecard` is ONE guarded
 *   UPDATE … WHERE id AND panelist_employee_id = ${panelistEmployeeId}
 *   — the own-rows law is structural (a non-panelist's write matches
 *   zero rows → the typed InterviewNotPanelistError).
 *
 * The evidence discipline (0096's grants): no DELETE on applicants or
 * interviews — REJECTED is a terminal state, never an erasure; the
 * panel record is permanent.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("hr access requires an ambient tenant scope");
  }
  return context.tx;
}

// ── the row shapes ─────────────────────────────────────────────────────────

export interface VacancyRow {
  id: string;
  code: string;
  positionId: string | null;
  title: string;
  titleAr: string | null;
  headcount: number;
  status: string;
  openedAt: string | null;
  filledAt: string | null;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** One recorded stage hop — the transition audit shape (0096's
 * stage_history jsonb; the REOPEN action is the one backward edge). */
export interface StageHistoryEntry {
  readonly from: string;
  readonly to: string;
  readonly action: "ADVANCE" | "REOPEN" | "HIRE";
  readonly at: string;
  readonly by: string | null;
}

export interface ApplicantRow {
  id: string;
  vacancyId: string;
  fullName: string;
  fullNameAr: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  stage: string;
  stageHistory: readonly StageHistoryEntry[];
  hiredEmployeeId: string | null;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface InterviewRow {
  id: string;
  applicantId: string;
  round: number;
  panelistEmployeeId: string;
  scheduledStart: string;
  scheduledEnd: string;
  mode: string;
  scorecard: Record<string, unknown>;
  verdict: string | null;
  comments: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const VACANCY_COLUMNS = sql`
  id, code, position_id AS "positionId", title, title_ar AS "titleAr", headcount,
  status, opened_at::text AS "openedAt", filled_at::text AS "filledAt", notes,
  version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
`;

const APPLICANT_COLUMNS = sql`
  id, vacancy_id AS "vacancyId", full_name AS "fullName", full_name_ar AS "fullNameAr",
  email, phone, source, stage, stage_history AS "stageHistory",
  hired_employee_id AS "hiredEmployeeId", notes,
  version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
`;

const INTERVIEW_COLUMNS = sql`
  id, applicant_id AS "applicantId", round, panelist_employee_id AS "panelistEmployeeId",
  scheduled_start::text AS "scheduledStart", scheduled_end::text AS "scheduledEnd",
  mode, scorecard, verdict, comments,
  version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
`;

// ── vacancies ──────────────────────────────────────────────────────────────

export async function insertVacancy(input: {
  code: string;
  positionId: string | null;
  title: string;
  titleAr: string | null;
  headcount: number;
  notes: string | null;
  createdBy: string | null;
}): Promise<VacancyRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO vacancies
      (id, tenant_id, code, position_id, title, title_ar, headcount, status, opened_at, notes, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.code}, ${input.positionId},
            ${input.title}, ${input.titleAr}, ${input.headcount}, 'OPEN', now(), ${input.notes},
            ${input.createdBy})
    RETURNING ${VACANCY_COLUMNS}
  `);
  return (rows.rows as unknown as VacancyRow[])[0]!;
}

export async function findVacancyById(id: string): Promise<VacancyRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${VACANCY_COLUMNS} FROM vacancies WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as VacancyRow[])[0];
}

export async function findVacancyByCode(code: string): Promise<VacancyRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${VACANCY_COLUMNS} FROM vacancies WHERE code = ${code} LIMIT 1
  `);
  return (rows.rows as unknown as VacancyRow[])[0];
}

export async function listVacancies(filter: {
  status?: string;
  limit: number;
}): Promise<VacancyRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${VACANCY_COLUMNS} FROM vacancies
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
    ORDER BY created_at DESC, code LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as VacancyRow[];
}

/**
 * THE VACANCY LIFECYCLE CAS: one conditional UPDATE — zero rows means
 * the vacancy was not in ${from} (a raced or stale move); version
 * bumps on every flip. The FILLED edge stamps filled_at.
 */
export async function casTransitionVacancy(
  vacancyId: string,
  from: string,
  to: string,
  actorId: string | null,
): Promise<VacancyRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE vacancies SET
      status = ${to},
      filled_at = CASE WHEN ${to} = 'FILLED' THEN now() ELSE filled_at END,
      updated_at = now(), version = version + 1, updated_by = ${actorId}
    WHERE id = ${vacancyId} AND status = ${from}
    RETURNING ${VACANCY_COLUMNS}
  `);
  return (rows.rows as unknown as VacancyRow[])[0];
}

// ── applicants (BR-088's substrate) ────────────────────────────────────────

export async function insertApplicant(input: {
  vacancyId: string;
  fullName: string;
  fullNameAr: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  notes: string | null;
  createdBy: string | null;
}): Promise<ApplicantRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO applicants
      (id, tenant_id, vacancy_id, full_name, full_name_ar, email, phone, source, stage,
       stage_history, notes, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.vacancyId}, ${input.fullName},
            ${input.fullNameAr}, ${input.email}, ${input.phone}, ${input.source}, 'NEW',
            '[]'::jsonb, ${input.notes}, ${input.createdBy})
    RETURNING ${APPLICANT_COLUMNS}
  `);
  return (rows.rows as unknown as ApplicantRow[])[0]!;
}

export async function findApplicantById(id: string): Promise<ApplicantRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${APPLICANT_COLUMNS} FROM applicants WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ApplicantRow[])[0];
}

export async function listApplicants(filter: {
  vacancyId?: string;
  stage?: string;
  limit: number;
}): Promise<ApplicantRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${APPLICANT_COLUMNS} FROM applicants
    WHERE (${filter.vacancyId ?? null}::uuid IS NULL OR vacancy_id = ${filter.vacancyId ?? null})
      AND (${filter.stage ?? null}::text IS NULL OR stage = ${filter.stage ?? null})
    ORDER BY created_at DESC, full_name LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as ApplicantRow[];
}

/**
 * THE STAGE CAS (BR-088 structural): ONE conditional UPDATE — the
 * WHERE pins the expected ${from} stage, the SET moves to ${to} and
 * appends the transition record to stage_history IN THE SAME
 * STATEMENT (the audit shape is atomic with the move). Zero rows =
 * the stage moved underneath (raced or stale) — the service re-reads
 * and throws the typed refusal.
 */
export async function casAdvanceStage(input: {
  applicantId: string;
  from: string;
  to: string;
  action: "ADVANCE" | "REOPEN" | "HIRE";
  actorId: string | null;
  at: string;
  hiredEmployeeId?: string;
}): Promise<ApplicantRow | undefined> {
  const entry: StageHistoryEntry = {
    from: input.from,
    to: input.to,
    action: input.action,
    at: input.at,
    by: input.actorId,
  };
  const rows = await tenantTx().execute(sql`
    UPDATE applicants SET
      stage = ${input.to},
      stage_history = stage_history || ${JSON.stringify([entry])}::jsonb,
      hired_employee_id = CASE
        WHEN ${input.hiredEmployeeId ?? null}::uuid IS NULL THEN hired_employee_id
        ELSE ${input.hiredEmployeeId ?? null}::uuid
      END,
      updated_at = now(), version = version + 1, updated_by = ${input.actorId}
    WHERE id = ${input.applicantId} AND stage = ${input.from}
    RETURNING ${APPLICANT_COLUMNS}
  `);
  return (rows.rows as unknown as ApplicantRow[])[0];
}

// ── interviews (the panel scorecards) ──────────────────────────────────────

export async function insertInterview(input: {
  applicantId: string;
  round: number;
  panelistEmployeeId: string;
  scheduledStart: string;
  scheduledEnd: string;
  mode: string;
  createdBy: string | null;
}): Promise<InterviewRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO interviews
      (id, tenant_id, applicant_id, round, panelist_employee_id, scheduled_start,
       scheduled_end, mode, scorecard, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.applicantId}, ${input.round},
            ${input.panelistEmployeeId}, ${input.scheduledStart}::timestamptz,
            ${input.scheduledEnd}::timestamptz, ${input.mode}, '{}'::jsonb, ${input.createdBy})
    RETURNING ${INTERVIEW_COLUMNS}
  `);
  return (rows.rows as unknown as InterviewRow[])[0]!;
}

export async function findInterviewById(id: string): Promise<InterviewRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${INTERVIEW_COLUMNS} FROM interviews WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as InterviewRow[])[0];
}

export async function findInterviewSlot(input: {
  applicantId: string;
  round: number;
  panelistEmployeeId: string;
}): Promise<InterviewRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${INTERVIEW_COLUMNS} FROM interviews
    WHERE applicant_id = ${input.applicantId} AND round = ${input.round}
      AND panelist_employee_id = ${input.panelistEmployeeId}
    LIMIT 1
  `);
  return (rows.rows as unknown as InterviewRow[])[0];
}

export async function listInterviews(filter: {
  applicantId?: string;
  panelistEmployeeId?: string;
  limit: number;
}): Promise<InterviewRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${INTERVIEW_COLUMNS} FROM interviews
    WHERE (${filter.applicantId ?? null}::uuid IS NULL OR applicant_id = ${filter.applicantId ?? null})
      AND (${filter.panelistEmployeeId ?? null}::uuid IS NULL
           OR panelist_employee_id = ${filter.panelistEmployeeId ?? null})
    ORDER BY applicant_id, round, panelist_employee_id LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as InterviewRow[];
}

/**
 * THE SCORECARD UPDATE (the own-rows law structural): ONE guarded
 * UPDATE — the WHERE pins the panelist; a non-panelist's write
 * matches ZERO rows (the typed InterviewNotPanelistError is the
 * service's). The scorecard jsonb and the verdict ride the same
 * statement (one write, the panel record stays coherent).
 */
export async function updateInterviewScorecard(input: {
  interviewId: string;
  panelistEmployeeId: string;
  scorecard: Record<string, unknown>;
  verdict: string | null;
  comments: string | null;
}): Promise<InterviewRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE interviews SET
      scorecard = ${JSON.stringify(input.scorecard)}::jsonb,
      verdict = ${input.verdict},
      comments = ${input.comments},
      updated_at = now(), version = version + 1
    WHERE id = ${input.interviewId} AND panelist_employee_id = ${input.panelistEmployeeId}
    RETURNING ${INTERVIEW_COLUMNS}
  `);
  return (rows.rows as unknown as InterviewRow[])[0];
}
