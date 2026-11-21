import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-049 (W-17 — T-05/T-06/T-07) CMMS store: the ONLY writer of the
 * work-order plane's tables (maintenance_work_orders ·
 * maintenance_cost_lines · maintenance_work_order_steps ·
 * maintenance_plans · maintenance_plan_tasks — 0105/0109). Every
 * statement runs in the caller's ambient tenant UoW so a failure anywhere
 * rolls the whole business operation back (INV-018; the completion act's
 * all-or-nothing law — the G-59 journal, the parts issues, the totals and
 * the single-use stamp commit together or not at all).
 * journal_entries/journal_lines are NEVER written here (ADR-0007 — the
 * posting engine exclusively owns them); item_stock/stock_moves are
 * written only through the inventory movement core (the REAL WMS issue
 * path — D-05).
 *
 * THE MACHINE'S CAS (the 0103/0105 stamp law + the change-order CAS
 * precedent): every transition is ONE guarded UPDATE — the status pins
 * the from-state, the stamps land in the SAME statement, and zero rows
 * means the raced/stale move. The completion's CAS additionally pins
 * completed_at IS NULL (the single-use stamp) and writes the totals +
 * the journal link together (the 0105 journal gate satisfied by the same
 * statement that consumes the stamp).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("cmms access requires an ambient tenant scope");
  }
  return context.tx;
}

/** Typed query over the ambient tenant transaction (the existing stores'
 * `as unknown as` shape, one helper — the drizzle generic demands an
 * index signature our row interfaces deliberately lack). */
async function query<T>(statement: Parameters<TenantDb["execute"]>[0]): Promise<T[]> {
  const result = await tenantTx().execute(statement);
  return result.rows as unknown as T[];
}

// ── the work-order rows ─────────────────────────────────────────────────────

export interface WorkOrderRow {
  id: string;
  assetId: string;
  orderNo: string;
  problem: string;
  problemAr: string | null;
  solution: string | null;
  solutionAr: string | null;
  priority: string;
  technicianEmployeeId: string | null;
  status: string;
  planId: string | null;
  plannedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  laborTotal: string;
  partsTotal: string;
  externalTotal: string;
  journalEntryId: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const ORDER_SELECT = sql`
  SELECT id, asset_id AS "assetId", order_no AS "orderNo", problem,
    problem_ar AS "problemAr", solution, solution_ar AS "solutionAr", priority,
    technician_employee_id AS "technicianEmployeeId", status, plan_id AS "planId",
    planned_at AS "plannedAt", started_at AS "startedAt", completed_at AS "completedAt",
    labor_total AS "laborTotal", parts_total AS "partsTotal",
    external_total AS "externalTotal", journal_entry_id AS "journalEntryId",
    note, note_ar AS "noteAr", created_by AS "createdBy",
    created_at AS "createdAt", updated_at AS "updatedAt", version
  FROM maintenance_work_orders`;

export interface InsertWorkOrderInput {
  assetId: string;
  orderNo: string;
  problem: string;
  problemAr: string | null;
  priority: string;
  technicianEmployeeId: string | null;
  status: "REQUESTED" | "PLANNED";
  planId: string | null;
  plannedAt: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
}

export async function insertWorkOrder(input: InsertWorkOrderInput): Promise<WorkOrderRow> {
  const id = generateUuidV7();
  const rows = await query<WorkOrderRow>(sql`
    INSERT INTO maintenance_work_orders (id, tenant_id, created_by, asset_id, order_no,
      problem, problem_ar, priority, technician_employee_id, status, plan_id, planned_at,
      note, note_ar)
    VALUES (${id}, ${requireTenantContext().tenantId}, ${input.createdBy}, ${input.assetId},
      ${input.orderNo}, ${input.problem}, ${input.problemAr}, ${input.priority},
      ${input.technicianEmployeeId}, ${input.status}, ${input.planId}, ${input.plannedAt},
      ${input.note}, ${input.noteAr})
    RETURNING id`);
  return findWorkOrderById(rows[0]!.id) as Promise<WorkOrderRow>;
}

export async function findWorkOrderById(id: string): Promise<WorkOrderRow | undefined> {
  const rows = await query<WorkOrderRow>(sql`
    ${ORDER_SELECT} WHERE id = ${id} LIMIT 1`);
  return rows[0];
}

export async function listWorkOrders(filter: {
  assetId?: string;
  status?: string;
  planId?: string;
  limit?: number;
}): Promise<WorkOrderRow[]> {
  const rows = await query<WorkOrderRow>(sql`
    ${ORDER_SELECT}
    WHERE (${filter.assetId ?? null}::uuid IS NULL OR asset_id = ${filter.assetId ?? null})
      AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.planId ?? null}::uuid IS NULL OR plan_id = ${filter.planId ?? null})
    ORDER BY created_at DESC
    LIMIT ${filter.limit ?? 100}`);
  return rows;
}

/** The asset's register row (the D-01 operability guard's read). */
export async function findAssetStatus(
  assetId: string,
): Promise<{ id: string; status: string; code: string } | undefined> {
  const rows = await query<{ id: string; status: string; code: string }>(sql`
    SELECT id, status, code FROM assets WHERE id = ${assetId} LIMIT 1`);
  return rows[0];
}

export interface CasTransitionInput {
  id: string;
  from: readonly string[];
  to: string;
  /** The stamp columns the target state's stamp law demands (already
   * computed by the service — the machine never invents a clock value). */
  plannedAt?: string | null;
  startedAt?: string | null;
  actorId: string | null;
}

/**
 * THE MACHINE'S CAS: ONE guarded UPDATE pinning the from-state; the
 * stamps land in the same statement (0105's stamp law satisfied
 * atomically); zero rows = the raced/stale move (undefined).
 */
export async function casWorkOrderStatus(
  input: CasTransitionInput,
): Promise<WorkOrderRow | undefined> {
  const fromList = sql.join(
    input.from.map((status) => sql`${status}`),
    sql`, `,
  );
  const rows = await query<{ id: string }>(sql`
    UPDATE maintenance_work_orders SET
      status = ${input.to},
      planned_at = COALESCE(${input.plannedAt ?? null}, planned_at),
      started_at = COALESCE(${input.startedAt ?? null}, started_at),
      updated_at = now(),
      updated_by = ${input.actorId},
      version = version + 1
    WHERE id = ${input.id} AND status IN (${fromList})
    RETURNING id`);
  if (rows[0] === undefined) return undefined;
  return findWorkOrderById(input.id);
}

/**
 * THE COMPLETION'S CAS (the single-use stamp + the totals + the journal
 * link in ONE statement — the 0105 journal gate and the stamp law both
 * satisfied by the same guarded UPDATE; completed_at IS NULL pins the
 * single use; the completable from-states pin the ladder).
 */
export async function completeWorkOrderStamp(input: {
  id: string;
  journalEntryId: string;
  laborTotal: string;
  partsTotal: string;
  externalTotal: string;
  completedAt: string;
  actorId: string | null;
}): Promise<WorkOrderRow | undefined> {
  const rows = await query<{ id: string }>(sql`
    UPDATE maintenance_work_orders SET
      status = 'COMPLETED',
      completed_at = ${input.completedAt},
      journal_entry_id = ${input.journalEntryId},
      labor_total = ${input.laborTotal},
      parts_total = ${input.partsTotal},
      external_total = ${input.externalTotal},
      updated_at = now(),
      updated_by = ${input.actorId},
      version = version + 1
    WHERE id = ${input.id}
      AND status IN ('IN_PROGRESS', 'ON_HOLD')
      AND completed_at IS NULL
    RETURNING id`);
  if (rows[0] === undefined) return undefined;
  return findWorkOrderById(input.id);
}

/** BR-097's window read: the OPEN generated order for (asset, plan), if
 * any (the partial unique's typed first line — the generation checks
 * BEFORE the insert and surfaces the name on the raced path too). */
export async function findOpenGeneratedOrder(
  assetId: string,
  planId: string,
): Promise<WorkOrderRow | undefined> {
  const rows = await query<WorkOrderRow>(sql`
    ${ORDER_SELECT}
    WHERE asset_id = ${assetId} AND plan_id = ${planId}
      AND status IN ('REQUESTED', 'PLANNED', 'IN_PROGRESS', 'ON_HOLD')
    LIMIT 1`);
  return rows[0];
}

// ── the cost lines (0109) ───────────────────────────────────────────────────

export interface CostLineRow {
  id: string;
  workOrderId: string;
  lineNo: number;
  legType: string;
  employeeId: string | null;
  hours: string | null;
  unitRate: string | null;
  itemId: string | null;
  warehouseId: string | null;
  qty: string | null;
  partnerId: string | null;
  amount: string | null;
  description: string | null;
  descriptionAr: string | null;
  issueUnitCost: string | null;
  issuedAt: string | null;
  note: string | null;
  noteAr: string | null;
}

const LINE_SELECT = sql`
  SELECT id, work_order_id AS "workOrderId", line_no AS "lineNo", leg_type AS "legType",
    employee_id AS "employeeId", hours, unit_rate AS "unitRate", item_id AS "itemId",
    warehouse_id AS "warehouseId", qty, partner_id AS "partnerId", amount, description,
    description_ar AS "descriptionAr", issue_unit_cost AS "issueUnitCost",
    issued_at AS "issuedAt", note, note_ar AS "noteAr"
  FROM maintenance_cost_lines`;

export async function listCostLines(workOrderId: string): Promise<CostLineRow[]> {
  const rows = await query<CostLineRow>(sql`
    ${LINE_SELECT} WHERE work_order_id = ${workOrderId} ORDER BY line_no`);
  return rows;
}

export async function findCostLine(
  workOrderId: string,
  lineId: string,
): Promise<CostLineRow | undefined> {
  const rows = await query<CostLineRow>(sql`
    ${LINE_SELECT} WHERE id = ${lineId} AND work_order_id = ${workOrderId} LIMIT 1`);
  return rows[0];
}

export interface InsertCostLineInput {
  workOrderId: string;
  legType: "LABOR" | "PARTS" | "EXTERNAL";
  employeeId: string | null;
  hours: string | null;
  unitRate: string | null;
  itemId: string | null;
  warehouseId: string | null;
  qty: string | null;
  partnerId: string | null;
  amount: string | null;
  description: string | null;
  descriptionAr: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
}

export async function insertCostLine(input: InsertCostLineInput): Promise<CostLineRow> {
  const id = generateUuidV7();
  const rows = await query<{ id: string }>(sql`
    INSERT INTO maintenance_cost_lines (id, tenant_id, created_by, work_order_id, line_no,
      leg_type, employee_id, hours, unit_rate, item_id, warehouse_id, qty, partner_id,
      amount, description, description_ar, note, note_ar)
    VALUES (${id}, ${requireTenantContext().tenantId}, ${input.createdBy},
      ${input.workOrderId},
      (SELECT COALESCE(MAX(line_no), 0) + 1 FROM maintenance_cost_lines
         WHERE work_order_id = ${input.workOrderId} AND tenant_id = ${requireTenantContext().tenantId}),
      ${input.legType}, ${input.employeeId}, ${input.hours}, ${input.unitRate},
      ${input.itemId}, ${input.warehouseId}, ${input.qty}, ${input.partnerId},
      ${input.amount}, ${input.description}, ${input.descriptionAr},
      ${input.note}, ${input.noteAr})
    RETURNING id`);
  return findCostLine(input.workOrderId, rows[0]!.id) as Promise<CostLineRow>;
}

/** Price an UNPRICED line (the NULL→value transition only — the snapshot
 * law; a priced line's rate/amount is frozen). */
export async function priceCostLine(input: {
  lineId: string;
  unitRate: string | null;
  amount: string | null;
  actorId: string | null;
}): Promise<CostLineRow | undefined> {
  const rows = await query<{ id: string }>(sql`
    UPDATE maintenance_cost_lines SET
      unit_rate = ${input.unitRate},
      amount = ${input.amount},
      updated_at = now(),
      updated_by = ${input.actorId},
      version = version + 1
    WHERE id = ${input.lineId} AND amount IS NULL AND unit_rate IS NULL
    RETURNING id`);
  if (rows[0] === undefined) return undefined;
  const line = await findCostLineById(input.lineId);
  return line;
}

async function findCostLineById(lineId: string): Promise<CostLineRow | undefined> {
  const rows = await query<CostLineRow>(sql`
    ${LINE_SELECT} WHERE id = ${lineId} LIMIT 1`);
  return rows[0];
}

export async function deleteCostLine(lineId: string): Promise<void> {
  await tenantTx().execute(sql`DELETE FROM maintenance_cost_lines WHERE id = ${lineId}`);
}

/** The order's unissued parts claims on (item, warehouse) — the
 * line-creation availability floor's read (D-05: the current line joins
 * its siblings' claims before the on-hand comparison). */
export async function pendingPartsClaims(
  workOrderId: string,
  excludeLineId: string | null,
): Promise<{ itemId: string; warehouseId: string; qty: string }[]> {
  const rows = await query<{ itemId: string; warehouseId: string; qty: string }>(sql`
    SELECT item_id AS "itemId", warehouse_id AS "warehouseId",
      SUM(qty)::text AS qty
    FROM maintenance_cost_lines
    WHERE work_order_id = ${workOrderId} AND leg_type = 'PARTS'
      AND issued_at IS NULL
      AND (${excludeLineId ?? null}::uuid IS NULL OR id <> ${excludeLineId ?? null})
    GROUP BY item_id, warehouse_id`);
  return rows;
}

/** The on-hand position per (item, warehouse) — a plain read; the issue
 * itself re-asserts through the movement core's own guard. */
export async function onHandQuantities(
  claims: readonly { itemId: string; warehouseId: string }[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const claim of claims) {
    const rows = await query<{ qty: string }>(sql`
      SELECT COALESCE(qty, 0)::text AS qty FROM item_stock
      WHERE item_id = ${claim.itemId} AND warehouse_id = ${claim.warehouseId}`);
    map.set(`${claim.itemId}:${claim.warehouseId}`, rows[0]?.qty ?? "0");
  }
  return map;
}

/** The completion act's per-line issue stamps (the W-3 provenance). */
export async function stampCostLineIssued(input: {
  lineId: string;
  amount: string;
  issueUnitCost: string;
  issuedAt: string;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE maintenance_cost_lines SET
      amount = ${input.amount},
      issue_unit_cost = ${input.issueUnitCost},
      issued_at = ${input.issuedAt},
      updated_at = now(),
      version = version + 1
    WHERE id = ${input.lineId}`);
}

// ── the carried steps (0109) ────────────────────────────────────────────────

export interface StepRow {
  id: string;
  workOrderId: string;
  sourceTaskId: string;
  seq: number;
  title: string;
  titleAr: string | null;
  instruction: string | null;
  instructionAr: string | null;
  result: string | null;
  resultNote: string | null;
  resultNoteAr: string | null;
  recordedAt: string | null;
  recordedBy: string | null;
}

const STEP_SELECT = sql`
  SELECT id, work_order_id AS "workOrderId", source_task_id AS "sourceTaskId", seq,
    title, title_ar AS "titleAr", instruction, instruction_ar AS "instructionAr",
    result, result_note AS "resultNote", result_note_ar AS "resultNoteAr",
    recorded_at AS "recordedAt", recorded_by AS "recordedBy"
  FROM maintenance_work_order_steps`;

export async function listOrderSteps(workOrderId: string): Promise<StepRow[]> {
  const rows = await query<StepRow>(sql`
    ${STEP_SELECT} WHERE work_order_id = ${workOrderId} ORDER BY seq`);
  return rows;
}

export async function findOrderStep(
  workOrderId: string,
  stepId: string,
): Promise<StepRow | undefined> {
  const rows = await query<StepRow>(sql`
    ${STEP_SELECT} WHERE id = ${stepId} AND work_order_id = ${workOrderId} LIMIT 1`);
  return rows[0];
}

export async function recordStepResult(input: {
  stepId: string;
  result: "PASS" | "FAIL";
  resultNote: string | null;
  resultNoteAr: string | null;
  recordedAt: string;
  recordedBy: string | null;
}): Promise<StepRow | undefined> {
  const rows = await query<{ id: string }>(sql`
    UPDATE maintenance_work_order_steps SET
      result = ${input.result},
      result_note = ${input.resultNote},
      result_note_ar = ${input.resultNoteAr},
      recorded_at = ${input.recordedAt},
      recorded_by = ${input.recordedBy},
      updated_at = now(),
      version = version + 1
    WHERE id = ${input.stepId}
    RETURNING id`);
  if (rows[0] === undefined) return undefined;
  const rows2 = await query<StepRow>(sql`
    ${STEP_SELECT} WHERE id = ${input.stepId} LIMIT 1`);
  return rows2[0];
}

/** The carry-over's bulk insert (the generation act copies the plan's
 * ACTIVE tasks — the snapshot law at write time). */
export async function insertOrderSteps(
  input: readonly {
    workOrderId: string;
    sourceTaskId: string;
    seq: number;
    title: string;
    titleAr: string | null;
    instruction: string | null;
    instructionAr: string | null;
    createdBy: string | null;
  }[],
): Promise<void> {
  for (const step of input) {
    const id = generateUuidV7();
    await tenantTx().execute(sql`
      INSERT INTO maintenance_work_order_steps (id, tenant_id, created_by, work_order_id,
        source_task_id, seq, title, title_ar, instruction, instruction_ar)
      VALUES (${id}, ${requireTenantContext().tenantId}, ${step.createdBy},
        ${step.workOrderId}, ${step.sourceTaskId}, ${step.seq}, ${step.title},
        ${step.titleAr}, ${step.instruction}, ${step.instructionAr})`);
  }
}

// ── the plans (0105) ────────────────────────────────────────────────────────

export interface PlanRow {
  id: string;
  assetId: string;
  name: string;
  nameAr: string | null;
  description: string | null;
  descriptionAr: string | null;
  triggerType: string;
  intervalDays: number | null;
  nextDueDate: string | null;
  meterId: string | null;
  thresholdDelta: string | null;
  lastAnchorValue: string | null;
  lastGeneratedAt: string | null;
  isActive: boolean;
  note: string | null;
  noteAr: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const PLAN_SELECT = sql`
  SELECT id, asset_id AS "assetId", name, name_ar AS "nameAr", description,
    description_ar AS "descriptionAr", trigger_type AS "triggerType",
    interval_days AS "intervalDays", next_due_date AS "nextDueDate",
    meter_id AS "meterId", threshold_delta AS "thresholdDelta",
    last_anchor_value AS "lastAnchorValue", last_generated_at AS "lastGeneratedAt",
    is_active AS "isActive", note, note_ar AS "noteAr",
    created_at AS "createdAt", updated_at AS "updatedAt", version
  FROM maintenance_plans`;

export async function insertPlan(input: {
  assetId: string;
  name: string;
  nameAr: string | null;
  description: string | null;
  descriptionAr: string | null;
  triggerType: "CALENDAR" | "METER";
  intervalDays: number | null;
  nextDueDate: string | null;
  meterId: string | null;
  thresholdDelta: string | null;
  lastAnchorValue: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
}): Promise<PlanRow> {
  const id = generateUuidV7();
  const rows = await query<{ id: string }>(sql`
    INSERT INTO maintenance_plans (id, tenant_id, created_by, asset_id, name, name_ar,
      description, description_ar, trigger_type, interval_days, next_due_date, meter_id,
      threshold_delta, last_anchor_value, note, note_ar)
    VALUES (${id}, ${requireTenantContext().tenantId}, ${input.createdBy}, ${input.assetId},
      ${input.name}, ${input.nameAr}, ${input.description}, ${input.descriptionAr},
      ${input.triggerType}, ${input.intervalDays}, ${input.nextDueDate}, ${input.meterId},
      ${input.thresholdDelta}, ${input.lastAnchorValue}, ${input.note}, ${input.noteAr})
    RETURNING id`);
  return findPlanById(rows[0]!.id) as Promise<PlanRow>;
}

export async function findPlanById(id: string): Promise<PlanRow | undefined> {
  const rows = await query<PlanRow>(sql`
    ${PLAN_SELECT} WHERE id = ${id} LIMIT 1`);
  return rows[0];
}

export async function listPlans(filter: {
  assetId?: string;
  activeOnly?: boolean;
  limit?: number;
}): Promise<PlanRow[]> {
  const rows = await query<PlanRow>(sql`
    ${PLAN_SELECT}
    WHERE (${filter.assetId ?? null}::uuid IS NULL OR asset_id = ${filter.assetId ?? null})
      AND (${filter.activeOnly ?? false}::boolean IS FALSE OR is_active)
    ORDER BY created_at DESC
    LIMIT ${filter.limit ?? 200}`);
  return rows;
}

/** The meter's snapshot (the METER authoring baseline + the evaluation
 * reads). */
export async function findMeterSnapshot(
  meterId: string,
): Promise<{ id: string; assetId: string; lastValue: string; type: string } | undefined> {
  const rows = await query<{
    id: string;
    assetId: string;
    lastValue: string;
    type: string;
  }>(sql`
    SELECT id, asset_id AS "assetId", last_value::text AS "lastValue", type
    FROM asset_meters WHERE id = ${meterId} LIMIT 1`);
  return rows[0];
}

/** The generation act's plan stamp: the anchor (the GENERATION's own
 * reading stamp for METER; untouched for CALENDAR), the next due (the
 * strict cadence), and last_generated_at — one guarded UPDATE. */
export async function stampPlanGenerated(input: {
  planId: string;
  nextDueDate: string | null;
  lastAnchorValue: string | null;
  generatedAt: string;
}): Promise<PlanRow | undefined> {
  await tenantTx().execute(sql`
    UPDATE maintenance_plans SET
      next_due_date = COALESCE(${input.nextDueDate}, next_due_date),
      last_anchor_value = COALESCE(${input.lastAnchorValue}, last_anchor_value),
      last_generated_at = ${input.generatedAt},
      updated_at = now(),
      version = version + 1
    WHERE id = ${input.planId}`);
  return findPlanById(input.planId);
}

export async function patchPlan(input: {
  planId: string;
  name?: string;
  nameAr?: string | null;
  description?: string | null;
  descriptionAr?: string | null;
  isActive?: boolean;
  intervalDays?: number | null;
  nextDueDate?: string | null;
  thresholdDelta?: string | null;
  note?: string | null;
  noteAr?: string | null;
  actorId: string | null;
}): Promise<PlanRow | undefined> {
  await tenantTx().execute(sql`
    UPDATE maintenance_plans SET
      name = COALESCE(${input.name ?? null}, name),
      name_ar = COALESCE(${input.nameAr ?? null}, name_ar),
      description = COALESCE(${input.description ?? null}, description),
      description_ar = COALESCE(${input.descriptionAr ?? null}, description_ar),
      is_active = COALESCE(${input.isActive ?? null}, is_active),
      interval_days = COALESCE(${input.intervalDays ?? null}, interval_days),
      next_due_date = COALESCE(${input.nextDueDate ?? null}, next_due_date),
      threshold_delta = COALESCE(${input.thresholdDelta ?? null}, threshold_delta),
      note = COALESCE(${input.note ?? null}, note),
      note_ar = COALESCE(${input.noteAr ?? null}, note_ar),
      updated_at = now(),
      updated_by = ${input.actorId},
      version = version + 1
    WHERE id = ${input.planId}`);
  return findPlanById(input.planId);
}

// ── the plan tasks (the checklist template — 0105) ──────────────────────────

export interface PlanTaskRow {
  id: string;
  planId: string;
  seq: number;
  title: string;
  titleAr: string | null;
  instruction: string | null;
  instructionAr: string | null;
  isActive: boolean;
}

const TASK_SELECT = sql`
  SELECT id, plan_id AS "planId", seq, title, title_ar AS "titleAr", instruction,
    instruction_ar AS "instructionAr", is_active AS "isActive"
  FROM maintenance_plan_tasks`;

export async function insertPlanTask(input: {
  planId: string;
  seq: number;
  title: string;
  titleAr: string | null;
  instruction: string | null;
  instructionAr: string | null;
  createdBy: string | null;
}): Promise<PlanTaskRow> {
  const id = generateUuidV7();
  const rows = await query<{ id: string }>(sql`
    INSERT INTO maintenance_plan_tasks (id, tenant_id, created_by, plan_id, seq, title,
      title_ar, instruction, instruction_ar)
    VALUES (${id}, ${requireTenantContext().tenantId}, ${input.createdBy}, ${input.planId},
      ${input.seq}, ${input.title}, ${input.titleAr}, ${input.instruction},
      ${input.instructionAr})
    RETURNING id`);
  const rows2 = await query<PlanTaskRow>(sql`
    ${TASK_SELECT} WHERE id = ${rows[0]!.id} LIMIT 1`);
  return rows2[0]!;
}

export async function listPlanTasks(planId: string): Promise<PlanTaskRow[]> {
  const rows = await query<PlanTaskRow>(sql`
    ${TASK_SELECT} WHERE plan_id = ${planId} ORDER BY seq`);
  return rows;
}

export async function patchPlanTask(input: {
  taskId: string;
  title?: string;
  titleAr?: string | null;
  instruction?: string | null;
  instructionAr?: string | null;
  isActive?: boolean;
  actorId: string | null;
}): Promise<PlanTaskRow | undefined> {
  await tenantTx().execute(sql`
    UPDATE maintenance_plan_tasks SET
      title = COALESCE(${input.title ?? null}, title),
      title_ar = COALESCE(${input.titleAr ?? null}, title_ar),
      instruction = COALESCE(${input.instruction ?? null}, instruction),
      instruction_ar = COALESCE(${input.instructionAr ?? null}, instruction_ar),
      is_active = COALESCE(${input.isActive ?? null}, is_active),
      updated_at = now(),
      updated_by = ${input.actorId},
      version = version + 1
    WHERE id = ${input.taskId}`);
  const rows = await query<PlanTaskRow>(sql`
    ${TASK_SELECT} WHERE id = ${input.taskId} LIMIT 1`);
  return rows[0];
}

export async function deletePlanTask(taskId: string): Promise<void> {
  await tenantTx().execute(sql`DELETE FROM maintenance_plan_tasks WHERE id = ${taskId}`);
}

/** The latest reading at or before a date (the METER evaluation's input
 * at the generation moment — W-18 wires the event-driven insert; the
 * explicit evaluation reads the log's own truth). */
export async function latestMeterReadings(
  meterIds: readonly string[],
): Promise<Map<string, { value: string; effectiveDate: string }>> {
  const map = new Map<string, { value: string; effectiveDate: string }>();
  for (const meterId of meterIds) {
    const rows = await query<{ value: string; effectiveDate: string }>(sql`
      SELECT value::text AS value, effective_date::text AS "effectiveDate"
      FROM asset_meter_readings
      WHERE meter_id = ${meterId}
      ORDER BY effective_date DESC, created_at DESC
      LIMIT 1`);
    if (rows[0] !== undefined) {
      map.set(meterId, rows[0]);
    }
  }
  return map;
}

/** The technician's HR READ (D-03: employees are reads — 049 never
 * writes an HR table; the read validates existence for the named
 * refusal, the FK stays the floor). */
export async function findEmployeeLite(
  employeeId: string,
): Promise<{ id: string; status: string } | undefined> {
  const rows = await query<{ id: string; status: string }>(sql`
    SELECT id, status FROM employees WHERE id = ${employeeId} LIMIT 1`);
  return rows[0];
}

/** The supplier partner read (the EXTERNAL leg's own subject). */
export async function findPartnerLite(
  partnerId: string,
): Promise<{ id: string } | undefined> {
  const rows = await query<{ id: string }>(sql`
    SELECT id FROM partners WHERE id = ${partnerId} LIMIT 1`);
  return rows[0];
}
