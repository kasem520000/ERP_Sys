import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-047 (W-2 — T-05 + T-06) — the talent store: the ONLY writer
 * for the 0095 performance cluster's rows (performance_cycles,
 * performance_reviews, competencies, competency_levels, goals — the
 * statutory.store precedent: one store per family). All reads run
 * under the ambient tenant UoW (RLS); every numeric field crosses the
 * boundary as an EXACT 2-dp decimal string (::text, never a JS
 * number — ADR-0009's law extended to the percent fields).
 *
 * THE WRITE SHAPES (each one conditional — the races are closed by the
 * statement, not by a surrounding read):
 *
 * - THE CYCLE CAS: `casTransitionCycle` is ONE UPDATE … WHERE id AND
 *   status = ${from} — the row lock the UPDATE takes is the gate (the
 *   bridge conditional-write precedent); zero rows = the raced/stale
 *   move, the typed CycleStateConflictError is the service's.
 * - THE REVIEW UPSERT: `upsertReviewDraft` is ONE INSERT … ON CONFLICT
 *   (the natural key) DO UPDATE … WHERE status = 'DRAFT' — a submitted
 *   or calibrated row is IMMUTABLE (the WHERE refuses silently; no row
 *   returned = the service's ReviewAlreadySubmittedError).
 * - THE REVIEW SUBMIT CAS: `casSubmitReview` is ONE UPDATE … WHERE id
 *   AND status = 'DRAFT' — double submits and raced submits converge
 *   on one flip; the loser reads zero rows.
 * - Goals/competencies: plain guarded writes (the natural keys + the
 *   CHECK floors are structural); no DELETE anywhere on reviews/goals
 *   (the 0095 evidence discipline — CANCELLED is the terminal soft
 *   state).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("hr access requires an ambient tenant scope");
  }
  return context.tx;
}

// ── the row shapes ─────────────────────────────────────────────────────────

export interface PerformanceCycleRow {
  id: string;
  name: string;
  nameAr: string | null;
  periodStart: string;
  periodEnd: string;
  status: string;
  reviewDueDate: string | null;
  scopeOrgUnitIds: readonly string[];
  /** The optimistic-concurrency counter — every CAS flip bumps it. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface PerformanceReviewRow {
  id: string;
  cycleId: string;
  reviewerEmployeeId: string;
  revieweeEmployeeId: string;
  kind: string;
  status: string;
  overallScore: string | null;
  competencyScores: Record<string, number>;
  goalRollup: string | null;
  comments: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompetencyRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  category: string | null;
  active: boolean;
}

export interface CompetencyLevelRow {
  id: string;
  level: number;
  name: string;
  nameAr: string;
  descriptor: string;
  descriptorAr: string;
}

export interface GoalRow {
  id: string;
  cycleId: string;
  ownerEmployeeId: string;
  parentGoalId: string | null;
  title: string;
  titleAr: string | null;
  weight: string;
  kriTarget: string | null;
  kriActual: string | null;
  progressPct: string | null;
  status: string;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

const CYCLE_COLUMNS = sql`
  id, name, name_ar AS "nameAr", period_start::text AS "periodStart", period_end::text AS "periodEnd",
  status, review_due_date::text AS "reviewDueDate", scope_org_unit_ids AS "scopeOrgUnitIds",
  version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
`;

const REVIEW_COLUMNS = sql`
  id, cycle_id AS "cycleId", reviewer_employee_id AS "reviewerEmployeeId",
  reviewee_employee_id AS "revieweeEmployeeId", kind, status,
  overall_score::text AS "overallScore", competency_scores AS "competencyScores",
  goal_rollup::text AS "goalRollup", comments,
  created_at::text AS "createdAt", updated_at::text AS "updatedAt"
`;

const COMPETENCY_COLUMNS = sql`
  id, code, name, name_ar AS "nameAr", category, active
`;

const LEVEL_COLUMNS = sql`
  id, level, name, name_ar AS "nameAr", descriptor, descriptor_ar AS "descriptorAr"
`;

const GOAL_COLUMNS = sql`
  id, cycle_id AS "cycleId", owner_employee_id AS "ownerEmployeeId",
  parent_goal_id AS "parentGoalId", title, title_ar AS "titleAr", weight::text AS "weight",
  kri_target AS "kriTarget", kri_actual AS "kriActual", progress_pct::text AS "progressPct",
  status, due_date::text AS "dueDate", created_at::text AS "createdAt", updated_at::text AS "updatedAt"
`;

// ── cycles ─────────────────────────────────────────────────────────────────

export async function insertCycle(input: {
  name: string;
  nameAr: string | null;
  periodStart: string;
  periodEnd: string;
  reviewDueDate: string | null;
  scopeOrgUnitIds: readonly string[];
  createdBy: string | null;
}): Promise<PerformanceCycleRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO performance_cycles
      (id, tenant_id, name, name_ar, period_start, period_end, status, review_due_date,
       scope_org_unit_ids, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.name}, ${input.nameAr},
            ${input.periodStart}::date, ${input.periodEnd}::date, 'DRAFT',
            ${input.reviewDueDate === null ? null : sql`${input.reviewDueDate}::date`},
            ${JSON.stringify(input.scopeOrgUnitIds)}::jsonb, ${input.createdBy})
    RETURNING ${CYCLE_COLUMNS}
  `);
  return (rows.rows as unknown as PerformanceCycleRow[])[0]!;
}

export async function findCycleById(id: string): Promise<PerformanceCycleRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${CYCLE_COLUMNS} FROM performance_cycles WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as PerformanceCycleRow[])[0];
}

export async function listCycles(filter: {
  status?: string;
  limit: number;
}): Promise<PerformanceCycleRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${CYCLE_COLUMNS} FROM performance_cycles
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
    ORDER BY period_start DESC, created_at DESC LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as PerformanceCycleRow[];
}

/**
 * THE LIFECYCLE CAS (T-05): one conditional UPDATE — the row lock the
 * UPDATE takes is the serialization gate; zero rows means the cycle
 * was not in ${from} (a raced or stale move) and the caller throws the
 * typed CycleStateConflictError. version bumps on every flip.
 */
export async function casTransitionCycle(
  cycleId: string,
  from: string,
  to: string,
  actorId: string | null,
): Promise<PerformanceCycleRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE performance_cycles SET
      status = ${to}, updated_at = now(), version = version + 1, updated_by = ${actorId}
    WHERE id = ${cycleId} AND status = ${from}
    RETURNING ${CYCLE_COLUMNS}
  `);
  return (rows.rows as unknown as PerformanceCycleRow[])[0];
}

// ── reviews ────────────────────────────────────────────────────────────────

/**
 * THE DRAFT UPSERT: INSERT … ON CONFLICT (the natural key) DO UPDATE
 * … WHERE status = 'DRAFT'. A row returned = the draft (fresh or
 * updated); NO row = the natural key already holds a SUBMITTED or
 * CALIBRATED review (immutable — the caller throws the typed
 * ReviewAlreadySubmittedError; the WHERE refused, nothing was
 * written).
 */
export async function upsertReviewDraft(input: {
  cycleId: string;
  reviewerEmployeeId: string;
  revieweeEmployeeId: string;
  kind: string;
  overallScore: string | null;
  competencyScores: Record<string, number>;
  comments: string | null;
  actorId: string | null;
}): Promise<PerformanceReviewRow | undefined> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO performance_reviews
      (id, tenant_id, cycle_id, reviewer_employee_id, reviewee_employee_id, kind, status,
       overall_score, competency_scores, comments, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.cycleId}, ${input.reviewerEmployeeId},
            ${input.revieweeEmployeeId}, ${input.kind}, 'DRAFT',
            ${input.overallScore === null ? null : sql`${input.overallScore}::numeric(5,2)`},
            ${JSON.stringify(input.competencyScores)}::jsonb, ${input.comments}, ${input.actorId})
    ON CONFLICT ("tenant_id", "cycle_id", "reviewee_employee_id", "reviewer_employee_id", "kind")
    DO UPDATE SET
      updated_at = now(), version = performance_reviews.version + 1,
      overall_score = EXCLUDED.overall_score,
      competency_scores = EXCLUDED.competency_scores,
      comments = EXCLUDED.comments, updated_by = EXCLUDED.updated_by
    WHERE performance_reviews.status = 'DRAFT'
    RETURNING ${REVIEW_COLUMNS}
  `);
  return (rows.rows as unknown as PerformanceReviewRow[])[0];
}

/**
 * THE SUBMIT CAS: DRAFT → SUBMITTED — one conditional UPDATE; zero
 * rows = the review was not a DRAFT (a raced or repeat submit — the
 * caller throws the typed refusal).
 */
export async function casSubmitReview(
  reviewId: string,
  goalRollup: string | null,
  actorId: string | null,
): Promise<PerformanceReviewRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE performance_reviews SET
      status = 'SUBMITTED', goal_rollup = ${goalRollup === null ? null : sql`${goalRollup}::numeric(7,2)`},
      updated_at = now(), version = version + 1, updated_by = ${actorId}
    WHERE id = ${reviewId} AND status = 'DRAFT'
    RETURNING ${REVIEW_COLUMNS}
  `);
  return (rows.rows as unknown as PerformanceReviewRow[])[0];
}

/** The calibration act (the cycle is in CALIBRATION — the service's
 * check): overwrites the calibrated scores on the MANAGER review and
 * stamps CALIBRATED. */
export async function calibrateReview(input: {
  reviewId: string;
  overallScore: string | null;
  comments: string | null;
  actorId: string | null;
}): Promise<PerformanceReviewRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE performance_reviews SET
      overall_score = COALESCE(${input.overallScore === null ? null : sql`${input.overallScore}::numeric(5,2)`}, overall_score),
      comments = COALESCE(${input.comments}, comments),
      status = 'CALIBRATED', updated_at = now(), version = version + 1, updated_by = ${input.actorId}
    WHERE id = ${input.reviewId}
    RETURNING ${REVIEW_COLUMNS}
  `);
  return (rows.rows as unknown as PerformanceReviewRow[])[0];
}

export async function findReviewByNaturalKey(input: {
  cycleId: string;
  reviewerEmployeeId: string;
  revieweeEmployeeId: string;
  kind: string;
}): Promise<PerformanceReviewRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${REVIEW_COLUMNS} FROM performance_reviews
    WHERE cycle_id = ${input.cycleId} AND reviewer_employee_id = ${input.reviewerEmployeeId}
      AND reviewee_employee_id = ${input.revieweeEmployeeId} AND kind = ${input.kind}
    LIMIT 1
  `);
  return (rows.rows as unknown as PerformanceReviewRow[])[0];
}

export async function findReviewById(id: string): Promise<PerformanceReviewRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${REVIEW_COLUMNS} FROM performance_reviews WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as PerformanceReviewRow[])[0];
}

/** The manage-side read (hr.performance.view/manage): a cycle's whole
 * review set, reviewee-attributed — the calibration view's data. */
export async function listReviewsForCycle(cycleId: string): Promise<PerformanceReviewRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${REVIEW_COLUMNS} FROM performance_reviews
    WHERE cycle_id = ${cycleId}
    ORDER BY reviewee_employee_id, kind, reviewer_employee_id
  `);
  return rows.rows as unknown as PerformanceReviewRow[];
}

/** The reviewer's OWN rows (hr.performance.review — the own-rows law:
 * the acting reviewer sees their own inputs, never anyone else's). */
export async function listOwnReviews(
  reviewerEmployeeId: string,
  cycleId?: string,
): Promise<PerformanceReviewRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${REVIEW_COLUMNS} FROM performance_reviews
    WHERE reviewer_employee_id = ${reviewerEmployeeId}
      AND (${cycleId ?? null}::uuid IS NULL OR cycle_id = ${cycleId ?? null})
    ORDER BY updated_at DESC
  `);
  return rows.rows as unknown as PerformanceReviewRow[];
}

/**
 * THE 360 RAW SUBSTRATE (BR-090): the reviewee's SUBMITTED 360 input
 * rows, per source — the SERVICE folds them through the pure
 * aggregate360/visible360 and returns ONLY the ≥ 3 aggregates; an
 * attributed source NEVER leaves the service boundary (this function
 * is the engine's private read, never a route's data).
 */
export async function listSubmitted360Inputs(
  cycleId: string,
  revieweeEmployeeId: string,
): Promise<PerformanceReviewRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${REVIEW_COLUMNS} FROM performance_reviews
    WHERE cycle_id = ${cycleId} AND reviewee_employee_id = ${revieweeEmployeeId}
      AND kind IN ('SELF', 'PEER', 'SUBORDINATE') AND status IN ('SUBMITTED', 'CALIBRATED')
    ORDER BY kind, reviewer_employee_id
  `);
  return rows.rows as unknown as PerformanceReviewRow[];
}

/**
 * PHASE-047 (W-5 — T-14, the 360 extension's trend read): the
 * reviewee's MANAGER reviews across every cycle — the review PROPER,
 * never the 360 input rows (BR-090 by construction: this read cannot
 * ship an attributed source because it never selects one; the
 * SELF/PEER/SUBORDINATE substrate stays behind the aggregate read).
 * The service joins the cycle metadata for the trend's axis.
 */
export async function listManagerReviewsForReviewee(
  revieweeEmployeeId: string,
): Promise<PerformanceReviewRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${REVIEW_COLUMNS} FROM performance_reviews
    WHERE reviewee_employee_id = ${revieweeEmployeeId} AND kind = 'MANAGER'
    ORDER BY cycle_id, created_at
  `);
  return rows.rows as unknown as PerformanceReviewRow[];
}

// ── competencies ───────────────────────────────────────────────────────────

export async function insertCompetency(input: {
  code: string;
  name: string;
  nameAr: string | null;
  category: string | null;
  createdBy: string | null;
}): Promise<CompetencyRow> {
  await tenantTx().execute(sql`
    INSERT INTO competencies (id, tenant_id, code, name, name_ar, category, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.code}, ${input.name},
            ${input.nameAr}, ${input.category}, ${input.createdBy})
  `);
  return (await findCompetencyByCode(input.code))!;
}

export async function findCompetencyById(id: string): Promise<CompetencyRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${COMPETENCY_COLUMNS} FROM competencies WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as CompetencyRow[])[0];
}

export async function findCompetencyByCode(code: string): Promise<CompetencyRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${COMPETENCY_COLUMNS} FROM competencies WHERE code = ${code} LIMIT 1
  `);
  return (rows.rows as unknown as CompetencyRow[])[0];
}

export async function listCompetencies(filter: {
  active?: boolean;
  limit: number;
}): Promise<CompetencyRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${COMPETENCY_COLUMNS} FROM competencies
    WHERE (${filter.active ?? null}::boolean IS NULL OR active = ${filter.active ?? null})
    ORDER BY code LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as CompetencyRow[];
}

export async function patchCompetency(input: {
  id: string;
  name?: string;
  nameAr?: string | null;
  category?: string | null;
}): Promise<CompetencyRow | undefined> {
  await tenantTx().execute(sql`
    UPDATE competencies SET
      name = COALESCE(${input.name ?? null}, name),
      name_ar = COALESCE(${input.nameAr ?? null}, name_ar),
      category = COALESCE(${input.category ?? null}, category),
      updated_at = now(), version = version + 1
    WHERE id = ${input.id}
  `);
  return findCompetencyById(input.id);
}

export async function setCompetencyActive(
  id: string,
  active: boolean,
): Promise<CompetencyRow | undefined> {
  await tenantTx().execute(sql`
    UPDATE competencies SET active = ${active}, updated_at = now(), version = version + 1
    WHERE id = ${id}
  `);
  return findCompetencyById(id);
}

export async function listCompetencyLevels(): Promise<CompetencyLevelRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${LEVEL_COLUMNS} FROM competency_levels ORDER BY level
  `);
  return rows.rows as unknown as CompetencyLevelRow[];
}

export async function findCompetencyLevel(level: number): Promise<CompetencyLevelRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${LEVEL_COLUMNS} FROM competency_levels WHERE level = ${level} LIMIT 1
  `);
  return (rows.rows as unknown as CompetencyLevelRow[])[0];
}

/** The scale is tenant DATA (BR-055's law): the descriptors are the
 * tenant's own calibration; the 1–5 band is the CHECK floor and is
 * never editable here. */
export async function patchCompetencyLevel(input: {
  level: number;
  name?: string;
  nameAr?: string;
  descriptor?: string;
  descriptorAr?: string;
}): Promise<CompetencyLevelRow | undefined> {
  await tenantTx().execute(sql`
    UPDATE competency_levels SET
      name = COALESCE(${input.name ?? null}, name),
      name_ar = COALESCE(${input.nameAr ?? null}, name_ar),
      descriptor = COALESCE(${input.descriptor ?? null}, descriptor),
      descriptor_ar = COALESCE(${input.descriptorAr ?? null}, descriptor_ar),
      updated_at = now(), version = version + 1
    WHERE level = ${input.level}
  `);
  return findCompetencyLevel(input.level);
}

// ── goals ──────────────────────────────────────────────────────────────────

export async function insertGoal(input: {
  cycleId: string;
  ownerEmployeeId: string;
  parentGoalId: string | null;
  title: string;
  titleAr: string | null;
  weight: string;
  kriTarget: string | null;
  dueDate: string | null;
  createdBy: string | null;
}): Promise<GoalRow> {
  await tenantTx().execute(sql`
    INSERT INTO goals
      (id, tenant_id, cycle_id, owner_employee_id, parent_goal_id, title, title_ar, weight,
       kri_target, due_date, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.cycleId}, ${input.ownerEmployeeId},
            ${input.parentGoalId}, ${input.title}, ${input.titleAr}, ${input.weight}::numeric(5,2),
            ${input.kriTarget},
            ${input.dueDate === null ? null : sql`${input.dueDate}::date`}, ${input.createdBy})
  `);
  const found = await findGoalByNaturalKey(input.cycleId, input.ownerEmployeeId, input.title);
  return found!;
}

async function findGoalByNaturalKey(
  cycleId: string,
  ownerEmployeeId: string,
  title: string,
): Promise<GoalRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${GOAL_COLUMNS} FROM goals
    WHERE cycle_id = ${cycleId} AND owner_employee_id = ${ownerEmployeeId} AND title = ${title}
    LIMIT 1
  `);
  return (rows.rows as unknown as GoalRow[])[0];
}

export async function findGoalById(id: string): Promise<GoalRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${GOAL_COLUMNS} FROM goals WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as GoalRow[])[0];
}

/** The natural key's typed-check read: does the owner already hold
 * this title in this cycle? Covers ALL rows (a CANCELLED goal still
 * holds its title slot — the 0095 UNIQUE spans every status). */
export async function goalTitleExists(
  cycleId: string,
  ownerEmployeeId: string,
  title: string,
): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    SELECT 1 FROM goals
    WHERE cycle_id = ${cycleId} AND owner_employee_id = ${ownerEmployeeId} AND title = ${title}
    LIMIT 1
  `);
  return rows.rows.length > 0;
}

export async function updateGoal(input: {
  id: string;
  title?: string;
  titleAr?: string | null;
  weight?: string;
  /** Tri-state: undefined = keep, null = move to root, uuid = re-parent. */
  parentGoalId?: string | null;
  kriTarget?: string | null;
  kriActual?: string | null;
  /** Tri-state: undefined = keep, null = clear, decimal string = set. */
  progressPct?: string | null;
  status?: string;
  dueDate?: string | null;
}): Promise<GoalRow | undefined> {
  // Nullable columns need the tri-state law (undefined = keep, null =
  // clear) — the COALESCE idiom cannot express "set to NULL", so the
  // SET list is composed arm by arm (always ≥1 arm: the timestamps).
  const arms: ReturnType<typeof sql>[] = [sql`updated_at = now()`, sql`version = version + 1`];
  if (input.title !== undefined) arms.push(sql`title = ${input.title}`);
  if (input.titleAr !== undefined) arms.push(sql`title_ar = ${input.titleAr}`);
  if (input.weight !== undefined) arms.push(sql`weight = ${input.weight}::numeric(5,2)`);
  if (input.parentGoalId !== undefined) {
    arms.push(sql`parent_goal_id = ${input.parentGoalId}`);
  }
  if (input.kriTarget !== undefined) arms.push(sql`kri_target = ${input.kriTarget}`);
  if (input.kriActual !== undefined) arms.push(sql`kri_actual = ${input.kriActual}`);
  if (input.progressPct !== undefined) {
    arms.push(
      input.progressPct === null
        ? sql`progress_pct = NULL`
        : sql`progress_pct = ${input.progressPct}::numeric(5,2)`,
    );
  }
  if (input.status !== undefined) arms.push(sql`status = ${input.status}`);
  if (input.dueDate !== undefined) {
    arms.push(
      input.dueDate === null ? sql`due_date = NULL` : sql`due_date = ${input.dueDate}::date`,
    );
  }
  await tenantTx().execute(sql`
    UPDATE goals SET ${sql.join(arms, sql`, `)}
    WHERE id = ${input.id}
  `);
  return findGoalById(input.id);
}

/** The cycle's whole goal set — the cascade tree's flat read (the
 * service nests it; the D-09 walk reads the same rows). */
export async function listGoalsByCycle(cycleId: string): Promise<GoalRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${GOAL_COLUMNS} FROM goals
    WHERE cycle_id = ${cycleId}
    ORDER BY parent_goal_id NULLS FIRST, created_at, title
  `);
  return rows.rows as unknown as GoalRow[];
}

/** BR-089's substrate: the reviewee's ACTIVE goals in the cycle — the
 * exact rows the weight-sum law folds and the rollup prices. */
export async function listActiveGoalsForReviewee(
  cycleId: string,
  employeeId: string,
): Promise<GoalRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${GOAL_COLUMNS} FROM goals
    WHERE cycle_id = ${cycleId} AND owner_employee_id = ${employeeId} AND status <> 'CANCELLED'
    ORDER BY created_at, title
  `);
  return rows.rows as unknown as GoalRow[];
}

export async function listGoalsForOwner(
  employeeId: string,
  cycleId?: string,
): Promise<GoalRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${GOAL_COLUMNS} FROM goals
    WHERE owner_employee_id = ${employeeId}
      AND (${cycleId ?? null}::uuid IS NULL OR cycle_id = ${cycleId ?? null})
    ORDER BY cycle_id, created_at, title
  `);
  return rows.rows as unknown as GoalRow[];
}

// ── the scope resolution (the cycle's participant law) ─────────────────────

export async function orgUnitExists(id: string): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    SELECT 1 FROM org_units WHERE id = ${id} LIMIT 1
  `);
  return rows.rows.length > 0;
}

/**
 * The participant-scope law: an EMPTY scope is the whole tenant's
 * ACTIVE payroll-status workforce; a NON-EMPTY scope is the employees
 * whose position sits inside one of the scoped org units (an employee
 * without a position is honestly OUT of a scoped cycle — the userId
 * bridge's precedent: absence is a valid state, never an error).
 */
export async function employeeInCycleScope(
  scopeOrgUnitIds: readonly string[],
  employeeId: string,
): Promise<boolean> {
  if (scopeOrgUnitIds.length === 0) {
    const rows = await tenantTx().execute(sql`
      SELECT 1 FROM employees WHERE id = ${employeeId} AND status = 'ACTIVE' LIMIT 1
    `);
    return rows.rows.length > 0;
  }
  const rows = await tenantTx().execute(sql`
    SELECT 1
    FROM employees e
    JOIN positions p ON p.id = e.position_id
    WHERE e.id = ${employeeId} AND e.status = 'ACTIVE'
      AND p.org_unit_id IN (${sql.join(
        scopeOrgUnitIds.map((unitId) => sql`${unitId}`),
        sql`, `,
      )})
    LIMIT 1
  `);
  return rows.rows.length > 0;
}
