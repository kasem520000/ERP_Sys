import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import {
  ProjectPlaneNotFoundError,
  WbsCrossProjectError,
  WbsCycleError,
  WbsInputInvalidError,
  WbsTaskInUseError,
  WbsTaskNotFoundError,
} from "../domain/projects-errors";
import {
  detectDependencyCycle,
  rollupWeightedPercent,
  wouldCreateParentCycle,
  type RollupNodeResult,
} from "../domain/projects-math";
import * as store from "../infrastructure/projects.store";
import type { WbsTaskRow } from "../infrastructure/projects.store";

/**
 * PHASE-048 (W-9 — T-05) — the WBS engine (BR-095 / D-03): the
 * work-breakdown tree with milestones, the single-predecessor
 * dependency edge, and the weighted %-complete rollup.
 *
 * THE LAWS:
 *
 * - THE CYCLE LAWS, VALIDATED AT WRITE TIME (D-03 — the 047 D-09
 *   precedent): every parent move and every predecessor edge is checked
 *   by the PURE guards (wouldCreateParentCycle /
 *   detectDependencyCycle) over the project's CURRENT edge set BEFORE
 *   any write — the illegal state never saves. The API is the ONLY
 *   move path (no bulk SQL surface, no store helper moves a task).
 * - THE PROJECT BOUNDARY: a parent and a predecessor must belong to the
 *   SAME project as the task (the composite tenant FK protects the
 *   tenant; this guard protects the project — WbsCrossProjectError).
 * - THE OPEN-WINDOW LAW: WBS writes land on OPEN projects only (a
 *   CLOSED project is frozen history — the PROJECT_CLOSED discipline);
 *   reads serve both.
 * - BR-095 (the rollup law): the weighted %-complete is RECOMPUTED FROM
 *   THE LEAVES on every read of the aggregate (the pure fold) — never a
 *   stored stale sum; the stored percent_complete is the task's OWN
 *   report only. The tree read carries every node's rollup and the
 *   node-by-node reconciliation is the fold's construction (acceptance
 *   #2's API arm).
 * - THE CHILDREN-FIRST LAW: the 0100 RESTRICT edges mean a task with
 *   children or dependents refuses deletion until they move away (the
 *   typed WbsTaskInUseError — the evidence order).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const CODE_RE = /^[A-Za-z0-9._/-]{1,40}$/;
const WEIGHT_RE = /^\d{1,3}(\.\d{1,4})?$/;
const PCT_RE = /^\d{1,3}(\.\d{1,2})?$/;

function isoDateOrNull(value: string | null, what: string): string | null {
  if (value === null) return null;
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new WbsInputInvalidError(`${what} must be an ISO date (YYYY-MM-DD): ${value}`);
  }
  return value;
}

function requireUuid(value: string, what: string): string {
  if (!UUID_RE.test(value)) {
    throw new WbsInputInvalidError(`${what} must be a uuid: ${value}`);
  }
  return value;
}

function weightString(value: string | null): string | null {
  if (value === null) return null;
  if (!WEIGHT_RE.test(value) || Number.parseFloat(value) > 100) {
    throw new WbsInputInvalidError(
      `weight must be a decimal string in [0 … 100] with ≤ 4dp (or null): ${value}`,
    );
  }
  return value;
}

function pctString(value: string, what: string): string {
  if (!PCT_RE.test(value) || Number.parseFloat(value) > 100) {
    throw new WbsInputInvalidError(
      `${what} must be a decimal string in [0 … 100] with ≤ 2dp: ${value}`,
    );
  }
  return value;
}

/** The tree node the API serves — the row plus the leaf-recomputed
 * rollup (BR-095: recomputed on EVERY read, never stored). */
export interface WbsTreeNode extends WbsTaskRow {
  readonly rolledPercent: string;
  readonly leafCount: number;
  readonly weightSum: string;
  readonly children: WbsTreeNode[];
}

@Injectable()
export class WbsService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  /** The project guard — writes need OPEN (the frozen-history law). */
  private async requireOpenProject(projectId: string): Promise<void> {
    const project = await store.findProjectPlane(projectId);
    if (project === undefined) throw new ProjectPlaneNotFoundError(projectId);
    if (project.status !== "OPEN") {
      throw new WbsInputInvalidError(
        `project ${projectId} is ${project.status} — the WBS writes land on OPEN projects only (frozen history otherwise)`,
      );
    }
  }

  /** The edge-set read + BOTH cycle guards + the project-boundary
   * guard — the shared pre-write step of create and the move path. */
  private async guardEdges(input: {
    projectId: string;
    taskId: string | null;
    parentTaskId: string | null;
    predecessorTaskId: string | null;
  }): Promise<void> {
    if (input.parentTaskId !== null) {
      const parent = await store.findWbsTaskById(input.parentTaskId);
      if (parent === undefined) throw new WbsTaskNotFoundError(input.parentTaskId);
      if (parent.projectId !== input.projectId) {
        throw new WbsCrossProjectError(
          `parent task ${input.parentTaskId} belongs to another project — the WBS tree never crosses projects`,
          { parentTaskId: input.parentTaskId, projectId: input.projectId },
        );
      }
      if (input.taskId !== null) {
        const edges = await store.listWbsEdges(input.projectId);
        const parentOf = new Map(edges.map((edge) => [edge.id, edge.parentTaskId]));
        if (wouldCreateParentCycle(input.taskId, input.parentTaskId, parentOf)) {
          throw new WbsCycleError(
            `re-parenting task ${input.taskId} under ${input.parentTaskId} would close a parent loop`,
            { cyclePath: [input.parentTaskId, input.taskId] },
          );
        }
      }
    }
    if (input.predecessorTaskId !== null) {
      const predecessor = await store.findWbsTaskById(input.predecessorTaskId);
      if (predecessor === undefined) throw new WbsTaskNotFoundError(input.predecessorTaskId);
      if (predecessor.projectId !== input.projectId) {
        throw new WbsCrossProjectError(
          `predecessor task ${input.predecessorTaskId} belongs to another project — dependencies never cross projects`,
          { predecessorTaskId: input.predecessorTaskId, projectId: input.projectId },
        );
      }
      if (input.predecessorTaskId === input.taskId) {
        throw new WbsCycleError(`task ${input.taskId} cannot be its own predecessor`, {
          cyclePath: [input.taskId],
        });
      }
      if (input.taskId !== null) {
        const edges = await store.listWbsEdges(input.projectId);
        const existing = edges
          .filter((edge) => edge.predecessorTaskId !== null && edge.id !== input.taskId)
          .map((edge) => ({ taskId: edge.id, predecessorId: edge.predecessorTaskId! }));
        const cycle = detectDependencyCycle(existing, {
          taskId: input.taskId,
          predecessorId: input.predecessorTaskId,
        });
        if (cycle !== null) {
          throw new WbsCycleError(
            `the dependency edge ${input.predecessorTaskId} → ${input.taskId} would close a loop: ${cycle.join(" → ")}`,
            { cyclePath: cycle },
          );
        }
      }
    }
  }

  // -- the writes ------------------------------------------------------------------

  async createTask(input: {
    projectId: string;
    parentTaskId: string | null;
    predecessorTaskId: string | null;
    wbsCode: string;
    name: string;
    nameAr: string | null;
    isMilestone: boolean;
    startDate: string | null;
    endDate: string | null;
    weight: string | null;
    percentComplete: string;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
  }): Promise<WbsTaskRow> {
    const projectId = requireUuid(input.projectId, "projectId");
    await this.requireOpenProject(projectId);
    if (!CODE_RE.test(input.wbsCode)) {
      throw new WbsInputInvalidError(
        `wbsCode must match ^[A-Za-z0-9._/-]{1,40}$: ${input.wbsCode}`,
      );
    }
    if (input.name.trim().length < 1 || input.name.length > 200) {
      throw new WbsInputInvalidError("name must be 1…200 characters");
    }
    const startDate = isoDateOrNull(input.startDate, "startDate");
    const endDate = isoDateOrNull(input.endDate, "endDate");
    if (startDate !== null && endDate !== null && endDate < startDate) {
      throw new WbsInputInvalidError(`endDate ${endDate} precedes startDate ${startDate}`);
    }
    const weight = weightString(input.weight);
    const percentComplete = pctString(input.percentComplete, "percentComplete");
    await this.guardEdges({
      projectId,
      taskId: null,
      parentTaskId: input.parentTaskId,
      predecessorTaskId: input.predecessorTaskId,
    });
    let created: WbsTaskRow;
    try {
      created = await store.insertWbsTask({
        projectId,
        parentTaskId: input.parentTaskId,
        predecessorTaskId: input.predecessorTaskId,
        wbsCode: input.wbsCode,
        name: input.name,
        nameAr: input.nameAr,
        isMilestone: input.isMilestone,
        startDate,
        endDate,
        weight,
        percentComplete,
        note: input.note,
        noteAr: input.noteAr,
        actorId: input.actorId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new WbsInputInvalidError(
          `wbsCode ${input.wbsCode} is already taken in this project — codes are unique per project`,
        );
      }
      throw error;
    }
    await this.audit.record({
      action: "projects.wbs_task_created",
      entityType: "project_wbs_task",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        projectId,
        wbsCode: created.wbsCode,
        parentTaskId: created.parentTaskId,
        predecessorTaskId: created.predecessorTaskId,
        isMilestone: created.isMilestone,
        weight: created.weight,
        percentComplete: created.percentComplete,
      },
    });
    return created;
  }

  /** The MOVE path — the ONLY way a task's parent or predecessor ever
   * changes (D-03); every edge change re-runs both cycle guards. */
  async updateTask(
    id: string,
    patch: {
      parentTaskId?: string | null;
      predecessorTaskId?: string | null;
      wbsCode?: string;
      name?: string;
      nameAr?: string | null;
      isMilestone?: boolean;
      startDate?: string | null;
      endDate?: string | null;
      weight?: string | null;
      percentComplete?: string;
      note?: string | null;
      noteAr?: string | null;
      actorId: string | null;
    },
  ): Promise<WbsTaskRow> {
    const taskId = requireUuid(id, "taskId");
    const current = await store.findWbsTaskById(taskId);
    if (current === undefined) throw new WbsTaskNotFoundError(taskId);
    await this.requireOpenProject(current.projectId);
    if (patch.wbsCode !== undefined && !CODE_RE.test(patch.wbsCode)) {
      throw new WbsInputInvalidError(`wbsCode must match ^[A-Za-z0-9._/-]{1,40}$: ${patch.wbsCode}`);
    }
    if (patch.name !== undefined && (patch.name.trim().length < 1 || patch.name.length > 200)) {
      throw new WbsInputInvalidError("name must be 1…200 characters");
    }
    const startDate =
      patch.startDate === undefined ? undefined : isoDateOrNull(patch.startDate, "startDate");
    const endDate =
      patch.endDate === undefined ? undefined : isoDateOrNull(patch.endDate, "endDate");
    const effectiveStart = startDate === undefined ? current.startDate : startDate;
    const effectiveEnd = endDate === undefined ? current.endDate : endDate;
    if (effectiveStart !== null && effectiveEnd !== null && effectiveEnd < effectiveStart) {
      throw new WbsInputInvalidError(`endDate ${effectiveEnd} precedes startDate ${effectiveStart}`);
    }
    const weight = patch.weight === undefined ? undefined : weightString(patch.weight);
    const percentComplete =
      patch.percentComplete === undefined
        ? undefined
        : pctString(patch.percentComplete, "percentComplete");
    await this.guardEdges({
      projectId: current.projectId,
      taskId,
      parentTaskId: patch.parentTaskId === undefined ? current.parentTaskId : patch.parentTaskId,
      predecessorTaskId:
        patch.predecessorTaskId === undefined
          ? current.predecessorTaskId
          : patch.predecessorTaskId,
    });
    let updated: WbsTaskRow | undefined;
    try {
      updated = await store.patchWbsTask({
        id: taskId,
        parentTaskId: patch.parentTaskId,
        predecessorTaskId: patch.predecessorTaskId,
        wbsCode: patch.wbsCode,
        name: patch.name,
        nameAr: patch.nameAr,
        isMilestone: patch.isMilestone,
        startDate,
        endDate,
        weight,
        percentComplete,
        note: patch.note,
        noteAr: patch.noteAr,
        actorId: patch.actorId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new WbsInputInvalidError(
          `wbsCode ${patch.wbsCode} is already taken in this project — codes are unique per project`,
        );
      }
      throw error;
    }
    if (updated === undefined) throw new WbsTaskNotFoundError(taskId);
    await this.audit.record({
      action: "projects.wbs_task_updated",
      entityType: "project_wbs_task",
      entityId: taskId,
      actorId: patch.actorId ?? undefined,
      before: {
        parentTaskId: current.parentTaskId,
        predecessorTaskId: current.predecessorTaskId,
        weight: current.weight,
        percentComplete: current.percentComplete,
      },
      after: {
        parentTaskId: updated.parentTaskId,
        predecessorTaskId: updated.predecessorTaskId,
        weight: updated.weight,
        percentComplete: updated.percentComplete,
      },
    });
    return updated;
  }

  /** Children-first: the RESTRICT edges' typed guard. */
  async deleteTask(id: string, actorId: string | null): Promise<void> {
    const taskId = requireUuid(id, "taskId");
    const current = await store.findWbsTaskById(taskId);
    if (current === undefined) throw new WbsTaskNotFoundError(taskId);
    const dependents = await store.countWbsDependents(taskId);
    if (dependents > 0) {
      throw new WbsTaskInUseError(
        `WBS task ${taskId} has ${dependents} child/dependent task(s) — move or delete them first (the children-first law)`,
        { dependents },
      );
    }
    await store.deleteWbsTask(taskId);
    await this.audit.record({
      action: "projects.wbs_task_deleted",
      entityType: "project_wbs_task",
      entityId: taskId,
      actorId: actorId ?? undefined,
      before: { wbsCode: current.wbsCode, projectId: current.projectId },
    });
  }

  // -- the reads (BR-095: the rollup recomputed on EVERY read) ---------------------

  /** The WBS board's project pool (T-14's own read — rides the plane's
   * wbs.view key, never the accounting module's project-list key). */
  async listProjects(): Promise<
    readonly { id: string; code: string; name: string; nameAr: string | null; status: string }[]
  > {
    return store.listProjectPlane();
  }

  /** The flat node-by-node rollup — acceptance #2's reconciliation arm. */
  async rollup(projectId: string): Promise<{
    projectId: string;
    nodes: ReadonlyArray<RollupNodeResult & { wbsCode: string }>;
  }> {
    const project = await store.findProjectPlane(projectId);
    if (project === undefined) throw new ProjectPlaneNotFoundError(projectId);
    const tasks = await store.listWbsTasks(projectId);
    const folded = rollupWeightedPercent(
      tasks.map((task) => ({
        id: task.id,
        parentTaskId: task.parentTaskId,
        weight: task.weight,
        percentComplete: task.percentComplete,
      })),
    );
    return {
      projectId,
      nodes: tasks.map((task) => {
        const roll = folded.get(task.id);
        return {
          id: task.id,
          wbsCode: task.wbsCode,
          rolledPercent: roll?.rolledPercent ?? task.percentComplete,
          leafCount: roll?.leafCount ?? 1,
          weightSum: roll?.weightSum ?? "1.0000",
        };
      }),
    };
  }

  /** The tree — every node carries its leaf-recomputed rollup. */
  async tree(projectId: string): Promise<WbsTreeNode[]> {
    const project = await store.findProjectPlane(projectId);
    if (project === undefined) throw new ProjectPlaneNotFoundError(projectId);
    const tasks = await store.listWbsTasks(projectId);
    const folded = rollupWeightedPercent(
      tasks.map((task) => ({
        id: task.id,
        parentTaskId: task.parentTaskId,
        weight: task.weight,
        percentComplete: task.percentComplete,
      })),
    );
    const nodes = new Map<string, WbsTreeNode>();
    const roots: WbsTreeNode[] = [];
    for (const task of tasks) {
      const roll = folded.get(task.id);
      nodes.set(task.id, {
        ...task,
        rolledPercent: roll?.rolledPercent ?? task.percentComplete,
        leafCount: roll?.leafCount ?? 1,
        weightSum: roll?.weightSum ?? "1.0000",
        children: [],
      });
    }
    for (const task of tasks) {
      const node = nodes.get(task.id)!;
      if (task.parentTaskId !== null && nodes.has(task.parentTaskId)) {
        nodes.get(task.parentTaskId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }
}

/** 23505 = unique_violation (the bridge precedent's unwrapping). */
function isUniqueViolation(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4 && candidate !== null && candidate !== undefined; depth += 1) {
    if (typeof candidate === "object" && (candidate as { code?: string }).code === "23505") {
      return true;
    }
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return false;
}
