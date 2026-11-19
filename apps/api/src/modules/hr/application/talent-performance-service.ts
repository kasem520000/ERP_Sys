import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import {
  CompetencyLevelNotFoundError,
  CompetencyNotFoundError,
  CycleStateConflictError,
  FeedbackBelowThresholdError,
  GoalWeightsInvalidError,
  ReviewAlreadySubmittedError,
  TalentCycleNotFoundError,
  TalentCodeTakenError,
  TalentInvalidError,
} from "../domain/talent-errors";
import {
  aggregate360,
  goalWeightSum,
  rollupGoalProgress,
  visible360,
  weightsExactly100,
  type Aggregate360Result,
  type FeedbackKind,
} from "../domain/talent-math";
import * as store from "../infrastructure/talent.store";
import { lockTalentCycle } from "../infrastructure/atomic";
import type { PerformanceCycleRow, PerformanceReviewRow } from "../infrastructure/talent.store";

/**
 * PHASE-047 (W-2 — T-05) — the performance engine: the cycle lifecycle
 * (DRAFT→ACTIVE→CALIBRATION→CLOSED, one-way, CAS on the state), the
 * review submission (the reviewer is ALWAYS the acting user's linked
 * employee — the own-rows law, never a client-supplied reviewer id),
 * the 360 aggregation (D-08: the PURE fold + BR-090's ≥ 3 threshold —
 * an attributed source NEVER leaves this service), and the calibration
 * act. The competency framework's master-data CRUD rides the same
 * engine (the 0095 performance cluster's own dictionary — the
 * shifts/eosb_rules precedent: master data with typed service guards).
 *
 * THE LAWS:
 *
 * - THE LIFECYCLE (the one-way ladder): DRAFT→ACTIVE→CALIBRATION→
 *   CLOSED; exactly one forward edge per state; every transition is
 *   the CAS conditional UPDATE under the cycle's T-20 gate
 *   (lockTalentCycle — the check-then-write window closes; a raced or
 *   stale move is the typed CycleStateConflictError, and a CLOSED
 *   cycle is immutable history).
 * - THE REVIEW WINDOW: reviews submit only while the cycle is ACTIVE;
 *   the calibration act runs only while the cycle is CALIBRATION; a
 *   SUBMITTED review is immutable until calibration (the upsert's
 *   WHERE + the submit CAS — both conditional writes).
 * - THE SCOPE LAW: a submission's reviewee must be IN the cycle's
 *   participant scope (empty scope = the tenant's ACTIVE workforce; a
 *   scoped cycle = the employees whose position sits in a scoped org
 *   unit — the honest out-of-scope refusal, typed).
 * - BR-090 (the 360 anonymity law): the 360 read returns ONLY the
 *   per-relationship aggregates at ≥ 3 SUBMITTED responses; a below-
 *   threshold relationship is absent from the payload, and an
 *   EXPLICIT request for one is the typed FeedbackBelowThresholdError.
 *   The SELF relationship can never reach 3 (the natural key pins the
 *   reviewee as the reviewer) — the law's uniform price, documented:
 *   the self-assessment is the reviewee's own row (the own-rows read)
 *   and never surfaces to the reviewer attributed.
 * - BR-089 (the weight-sum law, the submission's gate): a MANAGER
 *   submission folds the reviewee's active goals — a non-empty set
 *   must sum to EXACTLY 100% (the typed GoalWeightsInvalidError BEFORE
 *   any write, zero residue); an empty goal set is the honest no-goal
 *   axis (the rollup stays null). The rollup itself is the pure
 *   Σ(weight/100 × progress) with ONE rounding point.
 * - THE SCORECARD LAW: every competency key is the tenant's ACTIVE
 *   competency; every level value is the tenant's configured 1–5 row
 *   (the scale is DATA — a deleted level is the typed
 *   CompetencyLevelNotFoundError, never a silent pass).
 *
 * Ledger-free by design (D-05): no posting, no journal, no invariant —
 * the talent plane never touches the books.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CODE_RE = /^[\w\-. ]{1,64}$/;
/** The 2-dp decimal-string law (exact, never float — ADR-0009's
 * discipline extended to the percent fields). */
const PCT_RE = /^\d{1,3}(\.\d{1,2})?$/;
const UUID_RE = /^[0-9a-fA-F-]{36}$/;

const CYCLE_ACTIONS = {
  activate: { from: "DRAFT", to: "ACTIVE" },
  calibrate: { from: "ACTIVE", to: "CALIBRATION" },
  close: { from: "CALIBRATION", to: "CLOSED" },
} as const;

export type CycleAction = keyof typeof CYCLE_ACTIONS;

function isoDate(value: string, what: string): string {
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new TalentInvalidError(`${what} must be an ISO date (YYYY-MM-DD): ${value}`);
  }
  return value;
}

function pctString(value: unknown, what: string, max = 100): string {
  if (typeof value !== "string" || !PCT_RE.test(value)) {
    throw new TalentInvalidError(`${what} must be a decimal string like "87.50": ${String(value)}`);
  }
  const [whole, fraction = ""] = value.split(".");
  const scaled = Number.parseInt(whole + fraction.padEnd(2, "0"), 10);
  if (scaled < 0 || scaled > max * 100) {
    throw new TalentInvalidError(`${what} must be within [0 … ${max}]: ${value}`);
  }
  return value;
}

function requireUuid(value: string, what: string): string {
  if (!UUID_RE.test(value)) {
    throw new TalentInvalidError(`${what} must be a uuid: ${value}`);
  }
  return value;
}

/** The visible 360 payload — BR-090's only shape. */
export interface Aggregate360View {
  cycleId: string;
  revieweeEmployeeId: string;
  aggregates: Aggregate360Result;
}

@Injectable()
export class TalentPerformanceService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  // ── the cycle lifecycle ─────────────────────────────────────────────────

  async createCycle(input: {
    name: string;
    nameAr: string | null;
    periodStart: string;
    periodEnd: string;
    reviewDueDate: string | null;
    scopeOrgUnitIds: readonly string[];
    actorId: string | null;
  }): Promise<PerformanceCycleRow> {
    if (input.name.trim().length < 1 || input.name.length > 120) {
      throw new TalentInvalidError("the cycle name must be 1–120 characters");
    }
    const periodStart = isoDate(input.periodStart, "periodStart");
    const periodEnd = isoDate(input.periodEnd, "periodEnd");
    const reviewDueDate =
      input.reviewDueDate === null ? null : isoDate(input.reviewDueDate, "reviewDueDate");
    if (periodEnd < periodStart) {
      throw new TalentInvalidError(
        `the period window is inverted: ${periodStart} → ${periodEnd} (periodEnd must be ≥ periodStart)`,
      );
    }
    if (reviewDueDate !== null && reviewDueDate < periodStart) {
      throw new TalentInvalidError(
        `reviewDueDate ${reviewDueDate} precedes the period start ${periodStart}`,
      );
    }
    const scope: string[] = [];
    for (const unitId of input.scopeOrgUnitIds) {
      const unit = requireUuid(unitId, "scopeOrgUnitIds entry");
      if (!scope.includes(unit)) scope.push(unit);
    }
    // The scope's org units must exist (typed per unit — the honest
    // refusal names the first unknown unit).
    for (const unitId of scope) {
      if (!(await store.orgUnitExists(unitId))) {
        throw new TalentInvalidError(
          `the cycle scope references org unit ${unitId} which does not exist in this tenant`,
        );
      }
    }
    const created = await store.insertCycle({
      name: input.name.trim(),
      nameAr: input.nameAr,
      periodStart,
      periodEnd,
      reviewDueDate,
      scopeOrgUnitIds: scope,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "hr.cycle_created",
      entityType: "performance_cycle",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        name: created.name,
        periodStart,
        periodEnd,
        status: "DRAFT",
        scopeOrgUnitIds: scope,
      },
    });
    return created;
  }

  async getCycle(cycleId: string): Promise<PerformanceCycleRow> {
    const cycle = await store.findCycleById(requireUuid(cycleId, "cycleId"));
    if (cycle === undefined) throw new TalentCycleNotFoundError(cycleId);
    return cycle;
  }

  async listCycles(filter: { status?: string; limit?: number }): Promise<PerformanceCycleRow[]> {
    const STATUSES = new Set(["DRAFT", "ACTIVE", "CALIBRATION", "CLOSED"]);
    if (filter.status !== undefined && !STATUSES.has(filter.status)) {
      throw new TalentInvalidError(
        `status must be one of DRAFT/ACTIVE/CALIBRATION/CLOSED: ${filter.status}`,
      );
    }
    return store.listCycles({
      ...(filter.status === undefined ? {} : { status: filter.status }),
      limit: Math.min(Math.max(filter.limit ?? 50, 1), 200),
    });
  }

  /**
   * THE LIFECYCLE CAS: the T-20 cycle gate closes the check-then-write
   * window, the read renders the typed 404/stale-state refusals, and
   * the ONE conditional UPDATE is the state machine's truth — zero
   * rows = the raced/stale move (re-read, typed
   * CycleStateConflictError with the ACTUAL current state).
   */
  async transitionCycle(
    cycleId: string,
    action: CycleAction,
    actorId: string | null,
  ): Promise<PerformanceCycleRow> {
    const id = requireUuid(cycleId, "cycleId");
    await lockTalentCycle(id);
    const edge = CYCLE_ACTIONS[action];
    const cycle = await store.findCycleById(id);
    if (cycle === undefined) throw new TalentCycleNotFoundError(cycleId);
    if (cycle.status !== edge.from) {
      throw new CycleStateConflictError(cycleId, cycle.status, edge.to);
    }
    const updated = await store.casTransitionCycle(id, edge.from, edge.to, actorId);
    if (updated === undefined) {
      // The CAS lost a race (or the state moved between read and
      // write) — re-read for the honest current-state refusal.
      const current = await store.findCycleById(id);
      throw new CycleStateConflictError(cycleId, current?.status ?? edge.from, edge.to);
    }
    await this.audit.record({
      action: `hr.cycle_${action === "calibrate" ? "calibration_opened" : action === "close" ? "closed" : "activated"}`,
      entityType: "performance_cycle",
      entityId: id,
      actorId: actorId ?? undefined,
      before: { status: edge.from },
      after: { status: edge.to },
    });
    return updated;
  }

  // ── the review submission (the own-rows law) ────────────────────────────

  /**
   * Save (or re-save) the ACTING reviewer's DRAFT review — the reviewer
   * identity is the caller's own resolution (the bridge), never a
   * client-supplied id. A SUBMITTED/CALIBRATED natural-key row refuses
   * the re-save typed (immutable until calibration).
   */
  async saveReviewDraft(input: {
    reviewerEmployeeId: string;
    cycleId: string;
    revieweeEmployeeId: string;
    kind: "MANAGER" | FeedbackKind;
    overallScore: string | null;
    competencyScores: Record<string, number>;
    comments: string | null;
    actorId: string | null;
  }): Promise<PerformanceReviewRow> {
    const cycleId = requireUuid(input.cycleId, "cycleId");
    await lockTalentCycle(cycleId);
    const cycle = await this.getCycle(cycleId);
    if (cycle.status !== "ACTIVE") {
      throw new CycleStateConflictError(
        cycleId,
        cycle.status,
        "save a review draft (reviews submit only while the cycle is ACTIVE)",
      );
    }
    await this.validateReviewPayload(cycle, input);
    const draft = await store.upsertReviewDraft({
      cycleId,
      reviewerEmployeeId: input.reviewerEmployeeId,
      revieweeEmployeeId: input.revieweeEmployeeId,
      kind: input.kind,
      overallScore: input.overallScore,
      competencyScores: input.competencyScores,
      comments: input.comments,
      actorId: input.actorId,
    });
    if (draft === undefined) {
      throw new ReviewAlreadySubmittedError(
        `${cycleId}:${input.revieweeEmployeeId}:${input.reviewerEmployeeId}:${input.kind}`,
      );
    }
    await this.audit.record({
      action: "hr.review_draft_saved",
      entityType: "performance_review",
      entityId: draft.id,
      actorId: input.actorId ?? undefined,
      after: { cycleId, kind: input.kind, revieweeEmployeeId: input.revieweeEmployeeId },
    });
    return draft;
  }

  /**
   * THE SUBMISSION: validation FIRST (the cycle window, the scope law,
   * the scorecard law, BR-089's weight-sum gate — every refusal lands
   * BEFORE any write, zero residue), then the draft upsert, then the
   * DRAFT→SUBMITTED CAS. A MANAGER submission carries the goal rollup
   * (the pure fold over the reviewee's ACTIVE goals).
   */
  async submitReview(input: {
    reviewerEmployeeId: string;
    cycleId: string;
    revieweeEmployeeId: string;
    kind: "MANAGER" | FeedbackKind;
    overallScore: string | null;
    competencyScores: Record<string, number>;
    comments: string | null;
    actorId: string | null;
  }): Promise<PerformanceReviewRow> {
    const cycleId = requireUuid(input.cycleId, "cycleId");
    await lockTalentCycle(cycleId);
    const cycle = await this.getCycle(cycleId);
    if (cycle.status !== "ACTIVE") {
      throw new CycleStateConflictError(
        cycleId,
        cycle.status,
        "submit a review (reviews submit only while the cycle is ACTIVE)",
      );
    }
    await this.validateReviewPayload(cycle, input);

    // BR-089's gate — BEFORE the draft write (zero residue): a MANAGER
    // submission folds the reviewee's active goal set; a non-empty set
    // must sum to EXACTLY 100%.
    let goalRollup: string | null = null;
    if (input.kind === "MANAGER") {
      const goals = await store.listActiveGoalsForReviewee(cycleId, input.revieweeEmployeeId);
      if (goals.length > 0) {
        const sum = goalWeightSum(goals.map((goal) => goal.weight));
        if (!weightsExactly100(sum)) {
          throw new GoalWeightsInvalidError(input.revieweeEmployeeId, cycleId, sum);
        }
        goalRollup = rollupGoalProgress(
          goals.map((goal) => ({ weight: goal.weight, progressPct: goal.progressPct })),
        );
      }
    }

    const draft = await store.upsertReviewDraft({
      cycleId,
      reviewerEmployeeId: input.reviewerEmployeeId,
      revieweeEmployeeId: input.revieweeEmployeeId,
      kind: input.kind,
      overallScore: input.overallScore,
      competencyScores: input.competencyScores,
      comments: input.comments,
      actorId: input.actorId,
    });
    if (draft === undefined) {
      throw new ReviewAlreadySubmittedError(
        `${cycleId}:${input.revieweeEmployeeId}:${input.reviewerEmployeeId}:${input.kind}`,
      );
    }
    const submitted = await store.casSubmitReview(draft.id, goalRollup, input.actorId);
    if (submitted === undefined) {
      throw new ReviewAlreadySubmittedError(draft.id);
    }
    await this.audit.record({
      action: "hr.review_submitted",
      entityType: "performance_review",
      entityId: submitted.id,
      actorId: input.actorId ?? undefined,
      after: {
        cycleId,
        kind: submitted.kind,
        revieweeEmployeeId: input.revieweeEmployeeId,
        goalRollup,
      },
    });
    return submitted;
  }

  /** The reviewer's OWN rows (never anyone else's — the own-rows law). */
  async listOwnReviews(
    reviewerEmployeeId: string,
    cycleId?: string,
  ): Promise<PerformanceReviewRow[]> {
    return store.listOwnReviews(
      reviewerEmployeeId,
      cycleId === undefined ? undefined : requireUuid(cycleId, "cycleId"),
    );
  }

  /** The manage-side read: a cycle's whole review set (the calibration
   * view's data — hr.performance.view). */
  async listCycleReviews(cycleId: string): Promise<PerformanceReviewRow[]> {
    await this.getCycle(requireUuid(cycleId, "cycleId"));
    return store.listReviewsForCycle(cycleId);
  }

  /**
   * PHASE-047 (W-5 — T-14, the 360 extension's trend read): the
   * employee's MANAGER reviews across every cycle, each carrying its
   * cycle's metadata for the trend axis. BR-090 BY CONSTRUCTION: the
   * read selects ONLY the MANAGER rows (the review proper) — the
   * SELF/PEER/SUBORDINATE substrate never rides this surface (the
   * aggregate-360 read is the 360's own plane); the trend shows
   * overall scores per cycle, never per-source values (D-08's law).
   */
  async listReviewsForEmployee(employeeId: string): Promise<{
    employeeId: string;
    reviews: ReadonlyArray<
      PerformanceReviewRow & {
        cycleName: string;
        cycleNameAr: string | null;
        cycleStatus: string;
        cyclePeriodStart: string;
        cyclePeriodEnd: string;
      }
    >;
  }> {
    const id = requireUuid(employeeId, "employeeId");
    const [managerReviews, cycles] = await Promise.all([
      store.listManagerReviewsForReviewee(id),
      store.listCycles({ limit: 200 }),
    ]);
    const cyclesById = new Map(cycles.map((cycle) => [cycle.id, cycle]));
    const reviews = managerReviews.flatMap((review) => {
      const cycle = cyclesById.get(review.cycleId);
      // An orphaned review (its cycle deleted out-of-band) is not a
      // trend point; the cycles table has no DELETE in this phase, so
      // this arm is structural honesty, not an expected path.
      if (cycle === undefined) {
        return [];
      }
      return [
        {
          ...review,
          cycleName: cycle.name,
          cycleNameAr: cycle.nameAr,
          cycleStatus: cycle.status,
          cyclePeriodStart: cycle.periodStart,
          cyclePeriodEnd: cycle.periodEnd,
        },
      ];
    });
    return { employeeId: id, reviews };
  }

  /**
   * THE 360 AGGREGATE READ (BR-090, both ways): the SUBMITTED 360
   * inputs fold through the pure aggregate360 and surface through
   * visible360 — only the ≥ 3 relationships, count + stats, never an
   * attributed source. An EXPLICIT `requestKind` below the threshold
   * is the typed FeedbackBelowThresholdError (the 422 proof the law
   * exists at the boundary, not just in the payload shape).
   */
  async getAggregate360(
    cycleId: string,
    revieweeEmployeeId: string,
    requestKind?: FeedbackKind,
  ): Promise<Aggregate360View> {
    const id = requireUuid(cycleId, "cycleId");
    const employeeId = requireUuid(revieweeEmployeeId, "revieweeEmployeeId");
    await this.getCycle(id);
    const inputs = await store.listSubmitted360Inputs(id, employeeId);
    const aggregates = visible360(
      aggregate360(
        inputs.map((row) => ({
          kind: row.kind as FeedbackKind,
          overallScore: row.overallScore ?? "0.00",
        })),
      ),
    );
    if (requestKind !== undefined) {
      const raw = inputs.filter((row) => row.kind === requestKind);
      const visible = aggregates[requestKind];
      if (visible === null) {
        throw new FeedbackBelowThresholdError(requestKind, raw.length);
      }
    }
    return { cycleId: id, revieweeEmployeeId: employeeId, aggregates };
  }

  /**
   * THE CALIBRATION ACT: the cycle must be CALIBRATION; the target is
   * the reviewee's MANAGER review; the act overwrites the calibrated
   * overall score + comments and stamps CALIBRATED (the rollup stays
   * the submission's fold — the goals are frozen the moment the cycle
   * leaves ACTIVE, so the submitted rollup IS the calibrated rollup).
   */
  async calibrateReview(input: {
    cycleId: string;
    revieweeEmployeeId: string;
    overallScore: string | null;
    comments: string | null;
    actorId: string | null;
  }): Promise<PerformanceReviewRow> {
    const cycleId = requireUuid(input.cycleId, "cycleId");
    const revieweeId = requireUuid(input.revieweeEmployeeId, "revieweeEmployeeId");
    await lockTalentCycle(cycleId);
    const cycle = await this.getCycle(cycleId);
    if (cycle.status !== "CALIBRATION") {
      throw new CycleStateConflictError(
        cycleId,
        cycle.status,
        "calibrate a review (the calibration act runs only while the cycle is CALIBRATION)",
      );
    }
    // The calibration target is the reviewee's MANAGER review (the
    // review proper — located by reviewee + kind, never by a
    // client-supplied reviewer id).
    const managerRow = (await store.listReviewsForCycle(cycleId)).find(
      (row) => row.revieweeEmployeeId === revieweeId && row.kind === "MANAGER",
    );
    if (managerRow === undefined) {
      throw new TalentInvalidError(
        `reviewee ${revieweeId} has no MANAGER review in cycle ${cycleId} — the calibration act targets the manager review`,
      );
    }
    const overallScore =
      input.overallScore === null ? null : pctString(input.overallScore, "overallScore");
    const calibrated = await store.calibrateReview({
      reviewId: managerRow.id,
      overallScore,
      comments: input.comments,
      actorId: input.actorId,
    });
    if (calibrated === undefined) {
      throw new TalentCycleNotFoundError(cycleId);
    }
    await this.audit.record({
      action: "hr.review_calibrated",
      entityType: "performance_review",
      entityId: calibrated.id,
      actorId: input.actorId ?? undefined,
      before: { overallScore: managerRow.overallScore },
      after: { overallScore: calibrated.overallScore },
    });
    return calibrated;
  }

  // ── the competency framework (the performance cluster's master data) ─────

  async createCompetency(input: {
    code: string;
    name: string;
    nameAr: string | null;
    category: string | null;
    actorId: string | null;
  }): Promise<store.CompetencyRow> {
    if (!CODE_RE.test(input.code)) {
      throw new TalentInvalidError(
        `the competency code must be 1–64 chars (letters, digits, dash, dot, space): ${input.code}`,
      );
    }
    if (input.name.trim().length < 1 || input.name.length > 120) {
      throw new TalentInvalidError("the competency name must be 1–120 characters");
    }
    if ((await store.findCompetencyByCode(input.code)) !== undefined) {
      throw new TalentCodeTakenError("competency", input.code);
    }
    const created = await store.insertCompetency({
      code: input.code,
      name: input.name.trim(),
      nameAr: input.nameAr,
      category: input.category,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "hr.competency_created",
      entityType: "competency",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { code: created.code, name: created.name },
    });
    return created;
  }

  async listCompetencies(filter: {
    active?: boolean;
    limit?: number;
  }): Promise<store.CompetencyRow[]> {
    return store.listCompetencies({
      ...(filter.active === undefined ? {} : { active: filter.active }),
      limit: Math.min(Math.max(filter.limit ?? 100, 1), 500),
    });
  }

  async updateCompetency(input: {
    id: string;
    name?: string;
    nameAr?: string | null;
    category?: string | null;
    actorId: string | null;
  }): Promise<store.CompetencyRow> {
    const id = requireUuid(input.id, "competencyId");
    const current = await store.findCompetencyById(id);
    if (current === undefined) throw new CompetencyNotFoundError(id);
    const updated = await store.patchCompetency({
      id,
      ...(input.name === undefined ? {} : { name: input.name.trim() }),
      ...(input.nameAr === undefined ? {} : { nameAr: input.nameAr }),
      ...(input.category === undefined ? {} : { category: input.category }),
    });
    if (updated === undefined) throw new CompetencyNotFoundError(id);
    await this.audit.record({
      action: "hr.competency_updated",
      entityType: "competency",
      entityId: id,
      actorId: input.actorId ?? undefined,
      before: { name: current.name, category: current.category },
      after: { name: updated.name, category: updated.category },
    });
    return updated;
  }

  async setCompetencyActive(
    id: string,
    active: boolean,
    actorId: string | null,
  ): Promise<store.CompetencyRow> {
    const competencyId = requireUuid(id, "competencyId");
    const updated = await store.setCompetencyActive(competencyId, active);
    if (updated === undefined) throw new CompetencyNotFoundError(id);
    await this.audit.record({
      action: active ? "hr.competency_activated" : "hr.competency_deactivated",
      entityType: "competency",
      entityId: competencyId,
      actorId: actorId ?? undefined,
      after: { active },
    });
    return updated;
  }

  async listCompetencyLevels(): Promise<store.CompetencyLevelRow[]> {
    return store.listCompetencyLevels();
  }

  /** The scale is tenant DATA (BR-055): the descriptors are the
   * tenant's own calibration; the 1–5 band is the CHECK floor. */
  async updateCompetencyLevel(input: {
    level: number;
    name?: string;
    nameAr?: string;
    descriptor?: string;
    descriptorAr?: string;
    actorId: string | null;
  }): Promise<store.CompetencyLevelRow> {
    if (!Number.isInteger(input.level) || input.level < 1 || input.level > 5) {
      throw new CompetencyLevelNotFoundError(input.level);
    }
    const updated = await store.patchCompetencyLevel({
      level: input.level,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.nameAr === undefined ? {} : { nameAr: input.nameAr }),
      ...(input.descriptor === undefined ? {} : { descriptor: input.descriptor }),
      ...(input.descriptorAr === undefined ? {} : { descriptorAr: input.descriptorAr }),
    });
    if (updated === undefined) throw new CompetencyLevelNotFoundError(input.level);
    await this.audit.record({
      action: "hr.competency_level_updated",
      entityType: "competency_level",
      entityId: updated.id,
      actorId: input.actorId ?? undefined,
      after: { level: input.level, descriptor: updated.descriptor },
    });
    return updated;
  }

  // ── the shared payload validation (fail-closed, before any write) ───────

  private async validateReviewPayload(
    cycle: PerformanceCycleRow,
    input: {
      reviewerEmployeeId: string;
      revieweeEmployeeId: string;
      kind: "MANAGER" | FeedbackKind;
      overallScore: string | null;
      competencyScores: Record<string, number>;
    },
  ): Promise<void> {
    const revieweeId = requireUuid(input.revieweeEmployeeId, "revieweeEmployeeId");
    const reviewerId = requireUuid(input.reviewerEmployeeId, "reviewerEmployeeId");
    if (input.kind === "SELF" && reviewerId !== revieweeId) {
      throw new TalentInvalidError(
        "a SELF review's reviewer IS the reviewee (the natural key's law — the 0095 CHECK is the structural floor)",
      );
    }
    if (input.kind !== "SELF" && reviewerId === revieweeId) {
      throw new TalentInvalidError(
        `a ${input.kind} review requires reviewer ≠ reviewee (the 0095 CHECK is the structural floor)`,
      );
    }
    // The scope law: the reviewee must be in the cycle's participant
    // scope (typed — the honest out-of-scope refusal).
    if (!(await store.employeeInCycleScope(cycle.scopeOrgUnitIds, revieweeId))) {
      throw new TalentInvalidError(
        `reviewee ${revieweeId} is not in cycle ${cycle.id}'s participant scope (an empty scope is the tenant's ACTIVE workforce; a scoped cycle covers the employees whose position sits in a scoped org unit)`,
      );
    }
    // The 360 kinds aggregate over the overall score — it is REQUIRED
    // on their rows (BR-090's input contract); the MANAGER review may
    // submit without one (the calibration act finalizes it).
    if (input.kind !== "MANAGER" && input.overallScore === null) {
      throw new TalentInvalidError(
        `a ${input.kind} input carries an overallScore — it is the 360 aggregate's input contract`,
      );
    }
    if (input.overallScore !== null) {
      pctString(input.overallScore, "overallScore");
    }
    // The scorecard law: every key is the tenant's ACTIVE competency,
    // every value is the tenant's configured level row.
    for (const [competencyId, level] of Object.entries(input.competencyScores)) {
      const competency = await store.findCompetencyById(requireUuid(competencyId, "competencyScores key"));
      if (competency === undefined) {
        throw new CompetencyNotFoundError(competencyId);
      }
      if (!competency.active) {
        throw new CompetencyNotFoundError(competencyId);
      }
      if (!Number.isInteger(level) || level < 1 || level > 5) {
        throw new CompetencyLevelNotFoundError(level);
      }
      if ((await store.findCompetencyLevel(level)) === undefined) {
        throw new CompetencyLevelNotFoundError(level);
      }
    }
  }
}
