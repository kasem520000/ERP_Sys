import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import {
  CycleStateConflictError,
  OrgCycleError,
  TalentCycleNotFoundError,
  TalentInvalidError,
} from "../domain/talent-errors";
import {
  expectedPctThrough,
  goalWeightSum,
  triageKriProgress,
  weightsExactly100,
  wouldCreateCycle,
} from "../domain/talent-math";
import { lockTalentCycle } from "../infrastructure/atomic";
import * as store from "../infrastructure/talent.store";
import type { GoalRow, PerformanceCycleRow } from "../infrastructure/talent.store";

/**
 * PHASE-047 (W-2 — T-06) — the goals engine: the cascade tree (the
 * parent–child chain org → team → employee, cycle-safe by the pure
 * D-09 guard), BR-089's weight-sum law (the explicit check + the
 * submission-side gate in the performance engine), and the KRI
 * progress triage (the pure pace fold + the derived status).
 *
 * THE LAWS:
 *
 * - THE CYCLE WINDOW: goals write only while the cycle is DRAFT or
 *   ACTIVE — CALIBRATION is the assessment freeze (the rollup being
 *   calibrated reads a frozen goal set) and CLOSED is immutable
 *   history. Every write takes the cycle's T-20 gate before its guard
 *   read.
 * - THE CASCADE LAW: a parent is a SAME-CYCLE goal (a cross-cycle
 *   parent is refused typed — the cascade lives inside one cycle's
 *   world), and a re-parent that would close a loop is refused BEFORE
 *   any write (the pure wouldCreateCycle over the cycle's edge set —
 *   D-09's law; the illegal state never saves).
 * - THE NATURAL KEY: (cycle, owner, title) is unique — the duplicate
 *   title is the typed refusal (the 0095 UNIQUE is the structural
 *   floor).
 * - THE STATUS LADDER: ACTIVE/AT_RISK/ACHIEVED are the re-derivable
 *   progress states; CANCELLED is the terminal human decision (the
 *   evidence discipline's soft state — no DELETE anywhere; a CANCELLED
 *   goal refuses every further write).
 * - THE KRI TRIAGE: a progress update recomputes the goal's status
 *   from the pure fold — ≥ 100 ACHIEVED, below the expected pace
 *   AT_RISK, otherwise ACTIVE. The pace window is the cycle period,
 *   narrowed by the goal's own due date when one is set. The clock
 *   stays at the boundary (Date.now()); the fold itself is pure.
 * - BR-089 (the explicit check): `validateGoalWeights` is the read
 *   managers call while drafting — the law's enforcement point is the
 *   review submission (the performance engine's gate); partial sums
 *   are the honest drafting state here, never a refusal.
 *
 * Ledger-free by design (D-05).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PCT_RE = /^\d{1,3}(\.\d{1,2})?$/;
const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const GOAL_STATUSES = new Set(["ACTIVE", "AT_RISK", "ACHIEVED", "CANCELLED"]);

function isoDate(value: string, what: string): string {
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new TalentInvalidError(`${what} must be an ISO date (YYYY-MM-DD): ${value}`);
  }
  return value;
}

function pctString(value: unknown, what: string, max = 100): string {
  if (typeof value !== "string" || !PCT_RE.test(value)) {
    throw new TalentInvalidError(`${what} must be a decimal string like "55.50": ${String(value)}`);
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

/** The cascade tree's node — the flat goal row plus its children. */
export interface GoalTreeNode extends GoalRow {
  readonly children: GoalTreeNode[];
}

@Injectable()
export class TalentGoalsService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /** The cycle guard read (typed 404) — every writer's first step. */
  private async cycleForWrite(cycleId: string): Promise<PerformanceCycleRow> {
    const id = requireUuid(cycleId, "cycleId");
    const cycle = await store.findCycleById(id);
    if (cycle === undefined) throw new TalentCycleNotFoundError(cycleId);
    if (cycle.status !== "DRAFT" && cycle.status !== "ACTIVE") {
      throw new CycleStateConflictError(
        cycleId,
        cycle.status,
        "write a goal (goals write only while the cycle is DRAFT or ACTIVE — CALIBRATION freezes the goal set, CLOSED is immutable history)",
      );
    }
    return cycle;
  }

  async createGoal(input: {
    cycleId: string;
    ownerEmployeeId: string;
    parentGoalId: string | null;
    title: string;
    titleAr: string | null;
    weight: string;
    kriTarget: string | null;
    dueDate: string | null;
    actorId: string | null;
  }): Promise<GoalRow> {
    const cycleId = requireUuid(input.cycleId, "cycleId");
    await lockTalentCycle(cycleId);
    await this.cycleForWrite(cycleId);
    const ownerEmployeeId = requireUuid(input.ownerEmployeeId, "ownerEmployeeId");
    if (input.title.trim().length < 1 || input.title.length > 200) {
      throw new TalentInvalidError("the goal title must be 1–200 characters");
    }
    const weight = pctString(input.weight, "weight");
    const dueDate = input.dueDate === null ? null : isoDate(input.dueDate, "dueDate");

    let parentGoalId: string | null = null;
    if (input.parentGoalId !== null) {
      parentGoalId = requireUuid(input.parentGoalId, "parentGoalId");
      const parent = await store.findGoalById(parentGoalId);
      if (parent === undefined) {
        throw new TalentInvalidError(
          `the parent goal ${parentGoalId} does not exist in this tenant (A7: unknown and foreign ids are indistinguishable)`,
        );
      }
      if (parent.cycleId !== cycleId) {
        throw new TalentInvalidError(
          `the parent goal ${parentGoalId} belongs to another cycle — the cascade lives inside one cycle's world`,
        );
      }
      // A FRESH node cannot close a loop — it has no children, so no
      // walk from the parent can reach it (D-09's guard is the
      // RE-PARENT path's law; the self-parent floor is the 0095
      // CHECK). No cycle check runs here, by construction.
    }
    // The natural key (cycle, owner, title) — the typed duplicate
    // refusal (the 0095 UNIQUE is the structural floor; the check
    // covers ALL the owner's rows in the cycle — a CANCELLED goal
    // still holds its title slot, the evidence discipline's price).
    if (await store.goalTitleExists(cycleId, ownerEmployeeId, input.title.trim())) {
      throw new TalentInvalidError(
        `the goal title "${input.title.trim()}" is already used for this employee in this cycle — the (cycle, employee, title) natural key`,
      );
    }
    const created = await store.insertGoal({
      cycleId,
      ownerEmployeeId,
      parentGoalId,
      title: input.title.trim(),
      titleAr: input.titleAr,
      weight,
      kriTarget: input.kriTarget,
      dueDate,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "hr.goal_created",
      entityType: "goal",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        cycleId,
        ownerEmployeeId,
        title: created.title,
        weight,
        parentGoalId,
      },
    });
    return created;
  }

  /** The manage-side edit (hr.performance.manage): title/weight/
   * re-parent/KRI target/due date/status. The window law + the D-09
   * guard + the terminal-CANCELLED law all apply. */
  async updateGoal(input: {
    goalId: string;
    title?: string;
    titleAr?: string | null;
    weight?: string;
    parentGoalId?: string | null;
    kriTarget?: string | null;
    dueDate?: string | null;
    status?: string;
    actorId: string | null;
  }): Promise<GoalRow> {
    const goalId = requireUuid(input.goalId, "goalId");
    const current = await store.findGoalById(goalId);
    if (current === undefined) {
      throw new TalentInvalidError(
        `goal ${goalId} does not exist in this tenant (A7: unknown and foreign ids are indistinguishable)`,
      );
    }
    await lockTalentCycle(current.cycleId);
    await this.cycleForWrite(current.cycleId);
    if (current.status === "CANCELLED") {
      throw new TalentInvalidError(
        `goal ${goalId} is CANCELLED — the terminal state (the evidence discipline's soft delete); no further writes`,
      );
    }
    if (input.status !== undefined && !GOAL_STATUSES.has(input.status)) {
      throw new TalentInvalidError(
        `status must be one of ACTIVE/AT_RISK/ACHIEVED/CANCELLED: ${input.status}`,
      );
    }
    // The natural key on a title CHANGE — the same typed duplicate
    // refusal as creation (covers ALL the owner's rows in the cycle).
    if (
      input.title !== undefined &&
      input.title.trim() !== current.title &&
      (await store.goalTitleExists(current.cycleId, current.ownerEmployeeId, input.title.trim()))
    ) {
      throw new TalentInvalidError(
        `the goal title "${input.title.trim()}" is already used for this employee in this cycle — the (cycle, employee, title) natural key`,
      );
    }
    const weight = input.weight === undefined ? undefined : pctString(input.weight, "weight");
    const dueDate = input.dueDate === undefined ? undefined : input.dueDate === null ? null : isoDate(input.dueDate, "dueDate");

    if (input.parentGoalId !== undefined && input.parentGoalId !== null) {
      const parentId = requireUuid(input.parentGoalId, "parentGoalId");
      if (parentId !== current.parentGoalId) {
        const parent = await store.findGoalById(parentId);
        if (parent === undefined) {
          throw new TalentInvalidError(
            `the parent goal ${parentId} does not exist in this tenant (A7: unknown and foreign ids are indistinguishable)`,
          );
        }
        if (parent.cycleId !== current.cycleId) {
          throw new TalentInvalidError(
            `the parent goal ${parentId} belongs to another cycle — the cascade lives inside one cycle's world`,
          );
        }
        // D-09's guard over the cycle's CURRENT edge set (under the
        // T-20 gate — two racing re-parents serialize; the second sees
        // the first's committed edges and refuses).
        const edges = (await store.listGoalsByCycle(current.cycleId)).map((goal) => ({
          id: goal.id,
          parentId: goal.parentGoalId,
        }));
        if (wouldCreateCycle(edges, goalId, parentId)) {
          throw new OrgCycleError("goal", goalId, parentId);
        }
      }
    }
    const updated = await store.updateGoal({
      id: goalId,
      ...(input.title === undefined ? {} : { title: input.title.trim() }),
      ...(input.titleAr === undefined ? {} : { titleAr: input.titleAr }),
      ...(weight === undefined ? {} : { weight }),
      ...(input.parentGoalId === undefined ? {} : { parentGoalId: input.parentGoalId }),
      ...(input.kriTarget === undefined ? {} : { kriTarget: input.kriTarget }),
      ...(dueDate === undefined ? {} : { dueDate }),
      ...(input.status === undefined ? {} : { status: input.status }),
    });
    if (updated === undefined) {
      throw new TalentInvalidError(
        `goal ${goalId} does not exist in this tenant (A7: unknown and foreign ids are indistinguishable)`,
      );
    }
    await this.audit.record({
      action: "hr.goal_updated",
      entityType: "goal",
      entityId: goalId,
      actorId: input.actorId ?? undefined,
      before: {
        title: current.title,
        weight: current.weight,
        parentGoalId: current.parentGoalId,
        status: current.status,
      },
      after: {
        title: updated.title,
        weight: updated.weight,
        parentGoalId: updated.parentGoalId,
        status: updated.status,
      },
    });
    return updated;
  }

  /**
   * THE KRI PROGRESS TRIAGE (the own-rows act — hr.performance.review):
   * the acting employee updates their OWN goal's KRI actual + progress;
   * the status re-derives from the pure fold (≥ 100 ACHIEVED, below
   * the expected pace AT_RISK, otherwise ACTIVE). CANCELLED refuses
   * typed (terminal); a foreign goal refuses typed (the own-rows law
   * at the service boundary).
   */
  async updateOwnGoalProgress(input: {
    goalId: string;
    actingEmployeeId: string;
    kriActual?: string | null;
    progressPct: string;
    actorId: string | null;
  }): Promise<GoalRow> {
    const goalId = requireUuid(input.goalId, "goalId");
    const actingEmployeeId = requireUuid(input.actingEmployeeId, "actingEmployeeId");
    const current = await store.findGoalById(goalId);
    if (current === undefined) {
      throw new TalentInvalidError(
        `goal ${goalId} does not exist in this tenant (A7: unknown and foreign ids are indistinguishable)`,
      );
    }
    if (current.ownerEmployeeId !== actingEmployeeId) {
      throw new TalentInvalidError(
        `goal ${goalId} is not the acting employee's own goal — the own-rows law (a client-supplied id would be someone else's evidence)`,
      );
    }
    await lockTalentCycle(current.cycleId);
    const cycle = await this.cycleForWrite(current.cycleId);
    if (current.status === "CANCELLED") {
      throw new TalentInvalidError(
        `goal ${goalId} is CANCELLED — the terminal state; no further writes`,
      );
    }
    const progressPct = pctString(input.progressPct, "progressPct");
    // The pace window: the cycle period, narrowed by the goal's own
    // due date when one is set (the pure fold takes ms — the clock
    // stays at this boundary).
    const startMs = Date.parse(`${cycle.periodStart}T00:00:00Z`);
    const endMs = Date.parse(
      `${current.dueDate ?? cycle.periodEnd}T00:00:00Z`,
    );
    const expected = expectedPctThrough({ startMs, endMs, todayMs: Date.now() });
    const status = triageKriProgress(progressPct, expected);
    const updated = await store.updateGoal({
      id: goalId,
      ...(input.kriActual === undefined ? {} : { kriActual: input.kriActual }),
      progressPct,
      status,
    });
    if (updated === undefined) {
      throw new TalentInvalidError(
        `goal ${goalId} does not exist in this tenant (A7: unknown and foreign ids are indistinguishable)`,
      );
    }
    await this.audit.record({
      action: "hr.goal_progress_updated",
      entityType: "goal",
      entityId: goalId,
      actorId: input.actorId ?? undefined,
      before: { progressPct: current.progressPct, status: current.status },
      after: { progressPct, status, expectedPct: expected },
    });
    return updated;
  }

  /** The cascade tree: the cycle's goals nested parent → children
   * (roots first; orphans — a parent row outside the read — surface as
   * roots, never silently dropped). */
  async listGoalTree(cycleId: string): Promise<{ cycleId: string; roots: GoalTreeNode[] }> {
    const id = requireUuid(cycleId, "cycleId");
    const cycle = await store.findCycleById(id);
    if (cycle === undefined) throw new TalentCycleNotFoundError(cycleId);
    const goals = await store.listGoalsByCycle(id);
    const byId = new Map<string, GoalTreeNode>(
      goals.map((goal) => [goal.id, { ...goal, children: [] }]),
    );
    const roots: GoalTreeNode[] = [];
    for (const node of byId.values()) {
      const parent = node.parentGoalId === null ? undefined : byId.get(node.parentGoalId);
      if (parent === undefined) {
        roots.push(node);
      } else {
        parent.children.push(node);
      }
    }
    return { cycleId: id, roots };
  }

  /** The employee's own goals (the own-rows read — any cycle state). */
  async listOwnGoals(employeeId: string, cycleId?: string): Promise<GoalRow[]> {
    return store.listGoalsForOwner(
      requireUuid(employeeId, "employeeId"),
      cycleId === undefined ? undefined : requireUuid(cycleId, "cycleId"),
    );
  }

  /**
   * PHASE-047 (W-5 — T-14, the 360 extension's goals panel): any
   * employee's goals (the manage-side read — hr.performance.view; the
   * OWN plane stays `listOwnGoals` on hr.performance.review). The
   * 360's "active goals" filter is the caller's (the surface renders
   * the ACTIVE/AT_RISK subset and the honest empty state).
   */
  async listGoalsForEmployee(employeeId: string, cycleId?: string): Promise<GoalRow[]> {
    return store.listGoalsForOwner(
      requireUuid(employeeId, "employeeId"),
      cycleId === undefined ? undefined : requireUuid(cycleId, "cycleId"),
    );
  }

  /**
   * BR-089's explicit check (the drafting read): the reviewee's active
   * weight sum + the verdict. The LAW's enforcement point is the
   * review submission (the performance engine's typed gate) — this is
   * the check managers call while composing the goal set.
   */
  async validateGoalWeights(
    cycleId: string,
    employeeId: string,
  ): Promise<{
    cycleId: string;
    employeeId: string;
    sum: string;
    valid: boolean;
    activeGoals: number;
  }> {
    const id = requireUuid(cycleId, "cycleId");
    const employee = requireUuid(employeeId, "employeeId");
    const cycle = await store.findCycleById(id);
    if (cycle === undefined) throw new TalentCycleNotFoundError(cycleId);
    const goals = await store.listActiveGoalsForReviewee(id, employee);
    const sum = goalWeightSum(goals.map((goal) => goal.weight));
    return {
      cycleId: id,
      employeeId: employee,
      sum,
      valid: weightsExactly100(sum),
      activeGoals: goals.length,
    };
  }
}
