import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import {
  AllocationInputInvalidError,
  AllocationNotFoundError,
  BudgetInputInvalidError,
  BudgetStateError,
  ProjectBudgetNotFoundError,
  ProjectPlaneNotFoundError,
  WbsCrossProjectError,
} from "../domain/projects-errors";
import { accruedThrough, type CurveCell } from "../domain/projects-math";
import * as store from "../infrastructure/projects.store";
import type { AllocationRow, BudgetLineRow, ProjectBudgetRow } from "../infrastructure/projects.store";
import { ProjectActualsService } from "./project-actuals-service";

/**
 * PHASE-048 (W-9 — T-06) — the budget engine (D-04): the project cost
 * plan's lifecycle (DRAFT→APPROVED→CLOSED, the 028 register's shape),
 * the cost-curve construction (the APPROVED curve ALONE is the one PV
 * reads — the plan's own wording), the vs-actual rollup by cost type
 * and by WBS node, and the resource allocations with their
 * over-allocation WARNING.
 *
 * THE LAWS:
 *
 * - THE LIFECYCLE (the 028 discipline): lines are replaceable while
 *   DRAFT only (the bulk-replace path — the service NEVER deletes a
 *   non-DRAFT parent's lines); APPROVAL stamps its evidence (the CAS
 *   UPDATE guards the from-status — a raced move reads zero rows and
 *   surfaces the typed conflict); APPROVED is the variance truth and
 *   CLOSED is readable history. NO delete anywhere on budgets (0101's
 *   grant discipline).
 * - THE ONE-APPROVED LAW (D-07's re-baseline ruling): a project holds
 *   AT MOST ONE APPROVED budget — the project plane re-baselines
 *   through change orders (W-10's gate), never through a supersedes
 *   chain; a second approval while one stands is the typed refusal.
 * - THE CELL LAW (0101's partial uniques): one planned amount per
 *   (budget × cost type × WBS node × period start) — the duplicate
 *   cell is the typed refusal (23505 unwrapped, the bridge precedent).
 * - THE PROJECT BOUNDARY: a line's WBS node must belong to the
 *   budget's project (WbsCrossProjectError — the same guard as the
 *   tree's).
 * - MONEY IS numeric(19,4) EXCLUSIVELY (ADR-0009): every amount
 *   crosses as an exact decimal string; the curve's interpolation is
 *   the pure exact fold (ONE rounding at the total).
 * - THE OVER-ALLOCATION WARNING IS A READ SIGNAL (0101's recorded law):
   * the engine NEVER refuses a write for over-allocation — the warning
   * is computed on read (the overlapping-window sweep across ALL the
   * tenant's projects for the same resource — one person's calendar is
   * one pool).
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const MONEY_RE = /^\d+(\.\d{1,4})?$/;
const PCT_RE = /^\d{1,3}(\.\d{1,2})?$/;
const COST_TYPES = ["LABOR", "MATERIAL", "SUBCONTRACT", "OVERHEAD"] as const;
type CostType = (typeof COST_TYPES)[number];

function isoDate(value: string, what: string): string {
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new BudgetInputInvalidError(`${what} must be an ISO date (YYYY-MM-DD): ${value}`);
  }
  return value;
}

function requireUuid(value: string, what: string): string {
  if (!UUID_RE.test(value)) {
    throw new BudgetInputInvalidError(`${what} must be a uuid: ${value}`);
  }
  return value;
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

export interface BudgetLineInput {
  costType: string;
  wbsTaskId: string | null;
  periodStart: string;
  periodEnd: string;
  plannedAmount: string;
  note: string | null;
}

export interface CurveBucket {
  costType: CostType;
  wbsTaskId: string | null;
  periodStart: string;
  periodEnd: string;
  plannedAmount: string;
}

export interface CurveRead {
  projectId: string;
  budgetId: string;
  buckets: CurveBucket[];
  totalPlanned: string;
  /** The point-in-time accrual per cost type (the pure exact fold). */
  accruedByType: ReadonlyArray<{ costType: CostType; accrued: string }>;
  accruedTotal: string;
}

export interface OverAllocationWarning {
  resourceKind: "EMPLOYEE" | "ASSET";
  resourceId: string;
  onDate: string;
  totalPercent: string;
  allocationIds: string[];
}

@Injectable()
export class ProjectBudgetService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ProjectActualsService) private readonly actuals: ProjectActualsService,
  ) {}

  private async requireBudget(budgetId: string): Promise<ProjectBudgetRow> {
    const budget = await store.findProjectBudgetById(budgetId);
    if (budget === undefined) throw new ProjectBudgetNotFoundError(budgetId);
    return budget;
  }

  private async requireOpenProject(projectId: string): Promise<void> {
    const project = await store.findProjectPlane(projectId);
    if (project === undefined) throw new ProjectPlaneNotFoundError(projectId);
    if (project.status !== "OPEN") {
      throw new BudgetInputInvalidError(
        `project ${projectId} is ${project.status} — budget writes land on OPEN projects only (frozen history otherwise)`,
      );
    }
  }

  // -- the budget lifecycle ---------------------------------------------------------

  async createBudget(input: {
    projectId: string;
    name: string;
    nameAr: string | null;
    note: string | null;
    actorId: string | null;
  }): Promise<ProjectBudgetRow> {
    const projectId = requireUuid(input.projectId, "projectId");
    await this.requireOpenProject(projectId);
    if (input.name.trim().length < 1 || input.name.length > 120) {
      throw new BudgetInputInvalidError("budget name must be 1…120 characters");
    }
    let created: ProjectBudgetRow;
    try {
      created = await store.insertProjectBudget({
        projectId,
        name: input.name,
        nameAr: input.nameAr,
        note: input.note,
        actorId: input.actorId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new BudgetInputInvalidError(
          `a budget named "${input.name}" already exists on this project — names are unique per project`,
        );
      }
      throw error;
    }
    await this.audit.record({
      action: "projects.budget_created",
      entityType: "project_budget",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: { projectId, name: created.name, status: created.status },
    });
    return created;
  }

  /** The DRAFT bulk-replace (the 028 budget_lines precedent) — the
   * service NEVER replaces a non-DRAFT parent's lines. */
  async replaceLines(
    budgetId: string,
    lines: ReadonlyArray<BudgetLineInput>,
    actorId: string | null,
  ): Promise<BudgetLineRow[]> {
    const budget = await this.requireBudget(requireUuid(budgetId, "budgetId"));
    if (budget.status !== "DRAFT") {
      throw new BudgetStateError(
        `budget ${budgetId} is ${budget.status} — lines are replaceable while DRAFT only (APPROVED is the variance truth, CLOSED is history)`,
        { budgetId, status: budget.status },
      );
    }
    await this.requireOpenProject(budget.projectId);
    const taskProject = new Map<string, string>();
    for (const line of lines) {
      if (!COST_TYPES.includes(line.costType as CostType)) {
        throw new BudgetInputInvalidError(
          `costType must be one of LABOR/MATERIAL/SUBCONTRACT/OVERHEAD: ${line.costType}`,
        );
      }
      const periodStart = isoDate(line.periodStart, "periodStart");
      const periodEnd = isoDate(line.periodEnd, "periodEnd");
      if (periodEnd < periodStart) {
        throw new BudgetInputInvalidError(
          `periodEnd ${periodEnd} precedes periodStart ${periodStart}`,
        );
      }
      if (!MONEY_RE.test(line.plannedAmount)) {
        throw new BudgetInputInvalidError(
          `plannedAmount must be a non-negative decimal (≤ 4dp): ${line.plannedAmount}`,
        );
      }
      if (line.wbsTaskId !== null) {
        requireUuid(line.wbsTaskId, "wbsTaskId");
        let known = taskProject.get(line.wbsTaskId);
        if (known === undefined) {
          const task = await store.findWbsTaskById(line.wbsTaskId);
          if (task === undefined) {
            throw new BudgetInputInvalidError(
              `WBS task ${line.wbsTaskId} does not exist in this tenant`,
            );
          }
          known = task.projectId;
          taskProject.set(line.wbsTaskId, known);
        }
        if (known !== budget.projectId) {
          throw new WbsCrossProjectError(
            `WBS task ${line.wbsTaskId} belongs to another project — budget lines never cross projects`,
            { wbsTaskId: line.wbsTaskId, projectId: budget.projectId },
          );
        }
      }
    }
    try {
      await store.replaceBudgetLines(budgetId, lines);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new BudgetInputInvalidError(
          "duplicate budget cell — one planned amount per (cost type × WBS node × period start) within a budget",
        );
      }
      throw error;
    }
    const after = await store.listBudgetLines(budgetId);
    await this.audit.record({
      action: "projects.budget_lines_replaced",
      entityType: "project_budget",
      entityId: budgetId,
      actorId: actorId ?? undefined,
      before: { lineCount: 0 },
      after: { lineCount: after.length },
    });
    return after;
  }

  /** DRAFT → APPROVED (the CAS + the ONE-APPROVED law — D-07). */
  async approve(budgetId: string, actorId: string | null): Promise<ProjectBudgetRow> {
    const budget = await this.requireBudget(requireUuid(budgetId, "budgetId"));
    if (budget.status !== "DRAFT") {
      throw new BudgetStateError(
        `budget ${budgetId} is ${budget.status} — only DRAFT budgets approve`,
        { budgetId, status: budget.status },
      );
    }
    await this.requireOpenProject(budget.projectId);
    const approved = await store.listProjectBudgets(budget.projectId);
    const standingApproved = approved.find((row) => row.status === "APPROVED");
    if (standingApproved !== undefined) {
      throw new BudgetStateError(
        `project ${budget.projectId} already holds the APPROVED budget ${standingApproved.id} (${standingApproved.name}) — the project plane re-baselines through change orders, never a second approval (D-07)`,
        { budgetId, standingApprovedId: standingApproved.id },
      );
    }
    const moved = await store.casBudgetStatus({ id: budgetId, from: "DRAFT", to: "APPROVED", actorId });
    if (moved === undefined) {
      throw new BudgetStateError(
        `budget ${budgetId} left DRAFT concurrently — reload and retry (the CAS guard)`,
        { budgetId },
      );
    }
    await this.audit.record({
      action: "projects.budget_approved",
      entityType: "project_budget",
      entityId: budgetId,
      actorId: actorId ?? undefined,
      before: { status: budget.status },
      after: { status: moved.status, approvedAt: moved.approvedAt },
    });
    return moved;
  }

  /** APPROVED → CLOSED (the CAS; readable history stays). */
  async close(budgetId: string, actorId: string | null): Promise<ProjectBudgetRow> {
    const budget = await this.requireBudget(requireUuid(budgetId, "budgetId"));
    if (budget.status !== "APPROVED") {
      throw new BudgetStateError(
        `budget ${budgetId} is ${budget.status} — only APPROVED budgets close`,
        { budgetId, status: budget.status },
      );
    }
    const moved = await store.casBudgetStatus({ id: budgetId, from: "APPROVED", to: "CLOSED", actorId });
    if (moved === undefined) {
      throw new BudgetStateError(
        `budget ${budgetId} left APPROVED concurrently — reload and retry (the CAS guard)`,
        { budgetId },
      );
    }
    await this.audit.record({
      action: "projects.budget_closed",
      entityType: "project_budget",
      entityId: budgetId,
      actorId: actorId ?? undefined,
      before: { status: budget.status },
      after: { status: moved.status },
    });
    return moved;
  }

  async listBudgets(projectId: string): Promise<ProjectBudgetRow[]> {
    await this.requireProjectReadable(requireUuid(projectId, "projectId"));
    return store.listProjectBudgets(projectId);
  }

  async listLines(budgetId: string): Promise<BudgetLineRow[]> {
    await this.requireBudget(requireUuid(budgetId, "budgetId"));
    return store.listBudgetLines(budgetId);
  }

  // -- the cost curve (the APPROVED one ALONE — D-04) -------------------------------

  async curve(projectId: string, asOf: string): Promise<CurveRead> {
    await this.requireProjectReadable(requireUuid(projectId, "projectId"));
    const asOfDate = isoDate(asOf, "asOf");
    const budgets = await store.listProjectBudgets(projectId);
    const approved = budgets.find((row) => row.status === "APPROVED");
    if (approved === undefined) {
      throw new BudgetStateError(
        `project ${projectId} holds no APPROVED budget — the cost curve is the APPROVED one alone (D-04); author and approve a budget first`,
        { projectId },
      );
    }
    const lines = await store.listApprovedBudgetLines(projectId);
    const buckets: CurveBucket[] = lines.map((line) => ({
      costType: line.costType as CostType,
      wbsTaskId: line.wbsTaskId,
      periodStart: line.periodStart,
      periodEnd: line.periodEnd,
      plannedAmount: line.plannedAmount,
    }));
    const accruedByType = COST_TYPES.map((costType) => ({
      costType,
      accrued: accruedThrough(
        buckets.filter((bucket) => bucket.costType === costType).map(toCurveCell),
        asOfDate,
      ),
    }));
    return {
      projectId,
      budgetId: approved.id,
      buckets,
      totalPlanned: buckets
        .reduce((acc, bucket) => new Decimal(acc).plus(bucket.plannedAmount), new Decimal("0.0000"))
        .toFixed(4),
      accruedByType,
      accruedTotal: accruedThrough(buckets.map(toCurveCell), asOfDate),
    };
  }

  // -- the vs-actual rollup (by type + by node — D-04) ------------------------------

  /** Planned (the APPROVED curve) vs actual (the four collectors) per
   * cost type and per WBS node — the labor leg is node-dimensioned
   * (the 0100 dimension); materials/subcontract/overhead roll at the
   * project level (their sources carry no node dimension — the honest
   * shape, never a fabricated node split). */
  async vsActual(projectId: string, asOf: string): Promise<{
    projectId: string;
    asOf: string;
    byType: ReadonlyArray<{
      costType: CostType;
      planned: string;
      actual: string;
      variance: string;
    }>;
    byNode: ReadonlyArray<{
      wbsTaskId: string;
      plannedLabor: string;
      actualLabor: string;
      variance: string;
    }>;
    totals: { planned: string; actual: string; variance: string };
  }> {
    const breakdown = await this.actuals.breakdown(projectId);
    const curve = await this.curve(projectId, asOf);
    const plannedByType = new Map<CostType, Decimal>();
    for (const bucket of curve.buckets) {
      plannedByType.set(
        bucket.costType,
        (plannedByType.get(bucket.costType) ?? new Decimal("0.0000")).plus(bucket.plannedAmount),
      );
    }
    const actualByType = new Map<CostType, string>([
      ["LABOR", breakdown.labor.total],
      ["MATERIAL", breakdown.materials.total],
      ["SUBCONTRACT", breakdown.subcontract.total],
      ["OVERHEAD", breakdown.overhead.allocated],
    ]);
    const byType = COST_TYPES.map((costType) => {
      const planned = (plannedByType.get(costType) ?? new Decimal("0.0000")).toFixed(4);
      const actual = actualByType.get(costType)!;
      return {
        costType,
        planned,
        actual,
        variance: new Decimal(planned).minus(actual).toFixed(4),
      };
    });
    // The node arm: the labor leg's nodes vs the curve's node-bound
    // LABOR cells (the only node-dimensioned pair — D-04/D-05).
    const plannedLaborByNode = new Map<string, Decimal>();
    for (const bucket of curve.buckets) {
      if (bucket.costType !== "LABOR" || bucket.wbsTaskId === null) continue;
      plannedLaborByNode.set(
        bucket.wbsTaskId,
        (plannedLaborByNode.get(bucket.wbsTaskId) ?? new Decimal("0.0000")).plus(bucket.plannedAmount),
      );
    }
    const nodeIds = new Set<string>([
      ...plannedLaborByNode.keys(),
      ...breakdown.labor.byNode.map((node) => node.wbsTaskId),
    ]);
    const byNode = [...nodeIds].map((wbsTaskId) => {
      const plannedLabor = (plannedLaborByNode.get(wbsTaskId) ?? new Decimal("0.0000")).toFixed(4);
      const actualLabor =
        breakdown.labor.byNode.find((node) => node.wbsTaskId === wbsTaskId)?.amount ?? "0.0000";
      return {
        wbsTaskId,
        plannedLabor,
        actualLabor,
        variance: new Decimal(plannedLabor).minus(actualLabor).toFixed(4),
      };
    });
    const plannedTotal = curve.totalPlanned;
    return {
      projectId,
      asOf,
      byType,
      byNode,
      totals: {
        planned: plannedTotal,
        actual: breakdown.acTotal,
        variance: new Decimal(plannedTotal).minus(breakdown.acTotal).toFixed(4),
      },
    };
  }

  // -- the resource allocations (+ the READ-side warning) ---------------------------

  async createAllocation(input: {
    projectId: string;
    wbsTaskId: string | null;
    resourceKind: string;
    employeeId: string | null;
    assetId: string | null;
    startDate: string;
    endDate: string;
    allocationPercent: string;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
  }): Promise<AllocationRow> {
    const projectId = requireUuid(input.projectId, "projectId");
    await this.requireOpenProject(projectId);
    if (input.resourceKind !== "EMPLOYEE" && input.resourceKind !== "ASSET") {
      throw new AllocationInputInvalidError(
        `resourceKind must be EMPLOYEE or ASSET: ${input.resourceKind}`,
      );
    }
    if (input.resourceKind === "EMPLOYEE" && input.employeeId === null) {
      throw new AllocationInputInvalidError("an EMPLOYEE allocation requires employeeId");
    }
    if (input.resourceKind === "ASSET" && input.assetId === null) {
      throw new AllocationInputInvalidError("an ASSET allocation requires assetId");
    }
    if (input.employeeId !== null && input.assetId !== null) {
      throw new AllocationInputInvalidError(
        "an allocation targets exactly one resource — employee XOR asset (the 0101 CHECK's shape)",
      );
    }
    if (input.wbsTaskId !== null) {
      requireUuid(input.wbsTaskId, "wbsTaskId");
      const task = await store.findWbsTaskById(input.wbsTaskId);
      if (task === undefined || task.projectId !== projectId) {
        throw new WbsCrossProjectError(
          `WBS task ${input.wbsTaskId} does not belong to project ${projectId}`,
          { wbsTaskId: input.wbsTaskId, projectId },
        );
      }
    }
    const startDate = isoDate(input.startDate, "startDate");
    const endDate = isoDate(input.endDate, "endDate");
    if (endDate < startDate) {
      throw new AllocationInputInvalidError(`endDate ${endDate} precedes startDate ${startDate}`);
    }
    if (!PCT_RE.test(input.allocationPercent) || Number.parseFloat(input.allocationPercent) > 100) {
      throw new AllocationInputInvalidError(
        `allocationPercent must be a decimal in (0 … 100] with ≤ 2dp: ${input.allocationPercent}`,
      );
    }
    if (Number.parseFloat(input.allocationPercent) <= 0) {
      throw new AllocationInputInvalidError("allocationPercent must be greater than 0");
    }
    // NOTE (0101's recorded law): an over-allocation is NEVER a write
    // refusal — the warning is the read-side signal below.
    const created = await store.insertAllocation({
      projectId,
      wbsTaskId: input.wbsTaskId,
      resourceKind: input.resourceKind,
      employeeId: input.employeeId,
      assetId: input.assetId,
      startDate,
      endDate,
      allocationPercent: input.allocationPercent,
      note: input.note,
      noteAr: input.noteAr,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "projects.allocation_created",
      entityType: "project_resource_allocation",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        projectId,
        resourceKind: created.resourceKind,
        startDate: created.startDate,
        endDate: created.endDate,
        allocationPercent: created.allocationPercent,
      },
    });
    return created;
  }

  async listAllocations(projectId: string): Promise<AllocationRow[]> {
    await this.requireProjectReadable(requireUuid(projectId, "projectId"));
    return store.listAllocations(projectId);
  }

  async deleteAllocation(id: string, actorId: string | null): Promise<void> {
    const allocationId = requireUuid(id, "allocationId");
    const current = await store.findAllocationById(allocationId);
    if (current === undefined) throw new AllocationNotFoundError(allocationId);
    await store.deleteAllocation(allocationId);
    await this.audit.record({
      action: "projects.allocation_deleted",
      entityType: "project_resource_allocation",
      entityId: allocationId,
      actorId: actorId ?? undefined,
      before: { projectId: current.projectId, allocationPercent: current.allocationPercent },
    });
  }

  /**
   * THE OVER-ALLOCATION WARNING (the read-side signal — 0101's law):
   * for every resource allocated on this project, sweep its windows
   * across ALL the tenant's projects; any date where the active rows'
   * percents sum above 100 is the warning. NEVER a write refusal.
   */
  async overAllocationWarnings(projectId: string): Promise<OverAllocationWarning[]> {
    await this.requireProjectReadable(requireUuid(projectId, "projectId"));
    const own = await store.listAllocations(projectId);
    const warnings: OverAllocationWarning[] = [];
    const employeeIds = [...new Set(own.map((row) => row.employeeId).filter((id): id is string => id !== null))];
    const assetIds = [...new Set(own.map((row) => row.assetId).filter((id): id is string => id !== null))];
    for (const employeeId of employeeIds) {
      warnings.push(...sweepWindows("EMPLOYEE", employeeId, await store.listEmployeeAllocations(employeeId)));
    }
    for (const assetId of assetIds) {
      warnings.push(...sweepWindows("ASSET", assetId, await store.listAssetAllocations(assetId)));
    }
    return warnings;
  }

  private async requireProjectReadable(projectId: string): Promise<void> {
    const project = await store.findProjectPlane(projectId);
    if (project === undefined) throw new ProjectPlaneNotFoundError(projectId);
  }
}

function toCurveCell(bucket: CurveBucket): CurveCell {
  return {
    periodStart: bucket.periodStart,
    periodEnd: bucket.periodEnd,
    plannedAmount: bucket.plannedAmount,
  };
}

/** The overlapping-window sweep: every boundary date is a probe — the
 * Σ of the active rows' percents above 100 is the warning (the pure
 * read; exact 2-dp arithmetic). */
function sweepWindows(
  resourceKind: "EMPLOYEE" | "ASSET",
  resourceId: string,
  rows: ReadonlyArray<AllocationRow>,
): OverAllocationWarning[] {
  const warnings: OverAllocationWarning[] = [];
  const probes = [...new Set(rows.flatMap((row) => [row.startDate, row.endDate]))].sort();
  for (const probe of probes) {
    const active = rows.filter((row) => row.startDate <= probe && probe <= row.endDate);
    const total = active.reduce(
      (acc, row) => new Decimal(acc).plus(row.allocationPercent),
      new Decimal("0.00"),
    );
    if (total.greaterThan(100)) {
      warnings.push({
        resourceKind,
        resourceId,
        onDate: probe,
        totalPercent: total.toFixed(2),
        allocationIds: active.map((row) => row.id),
      });
    }
  }
  return warnings;
}
