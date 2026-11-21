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

/** The task's CARRIED-step count (the delete's pre-check — the FK stays
 * the raced floor; the pre-check refuses BEFORE any statement fails so
 * the transaction stays usable). */
export async function countCarriedSteps(taskId: string): Promise<number> {
  const rows = await query<{ n: string }>(sql`
    SELECT COUNT(*)::text AS n FROM maintenance_work_order_steps
    WHERE source_task_id = ${taskId}`);
  return Number.parseInt(rows[0]?.n ?? "0", 10);
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

// ═══ W-18 (T-08/T-09/T-10) — the meters + spares + transfers plane ══════════
//
// The store stays the ONLY writer of the CMMS plane's tables (0106/0107):
// every statement runs in the caller's ambient tenant UoW so the reading's
// event-driven evaluation, the transfer's approval act (the G-61 entry, the
// branch flip, the seals) and the BOM's lifecycle commit together or not at
// all (INV-018). journal_entries/journal_lines are NEVER written here
// (ADR-0007 — the posting engine exclusively); item_stock/stock_moves are
// written only through the inventory movement core (the REAL WMS path).

// ── the meters + the readings log (0106 — D-07, R-10) ───────────────────────

export interface MeterRow {
  id: string;
  assetId: string;
  name: string;
  nameAr: string | null;
  type: string;
  unit: string;
  isOdometer: boolean;
  lastValue: string;
  lastReadingAt: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const METER_SELECT = sql`
  SELECT id, asset_id AS "assetId", name, name_ar AS "nameAr", type, unit,
    is_odometer AS "isOdometer", last_value::text AS "lastValue",
    last_reading_at AS "lastReadingAt", note, note_ar AS "noteAr",
    created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", version
  FROM asset_meters`;

export async function insertMeter(input: {
  assetId: string;
  name: string;
  nameAr: string | null;
  type: "HOURS" | "KM" | "PRODUCTION" | "CUSTOM";
  unit: string;
  isOdometer: boolean;
  lastValue: string;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
}): Promise<MeterRow> {
  const id = generateUuidV7();
  const rows = await query<{ id: string }>(sql`
    INSERT INTO asset_meters (id, tenant_id, created_by, asset_id, name, name_ar,
      type, unit, is_odometer, last_value, note, note_ar)
    VALUES (${id}, ${requireTenantContext().tenantId}, ${input.createdBy}, ${input.assetId},
      ${input.name}, ${input.nameAr}, ${input.type}, ${input.unit}, ${input.isOdometer},
      ${input.lastValue}, ${input.note}, ${input.noteAr})
    RETURNING id`);
  return findMeterById(rows[0]!.id) as Promise<MeterRow>;
}

export async function findMeterById(id: string): Promise<MeterRow | undefined> {
  const rows = await query<MeterRow>(sql`
    ${METER_SELECT} WHERE id = ${id} LIMIT 1`);
  return rows[0];
}

export async function listMeters(filter: {
  assetId?: string;
  limit?: number;
}): Promise<MeterRow[]> {
  const rows = await query<MeterRow>(sql`
    ${METER_SELECT}
    WHERE (${filter.assetId ?? null}::uuid IS NULL OR asset_id = ${filter.assetId ?? null})
    ORDER BY created_at DESC
    LIMIT ${filter.limit ?? 200}`);
  return rows;
}

/** Patch the meter's own descriptive fields + the odometer designation
 * (R-10's write path — the KM gate and the one-per-asset law are the
 * service's typed first lines; the 0106 CHECK/partial unique the floor). */
export async function patchMeter(input: {
  meterId: string;
  name?: string;
  nameAr?: string | null;
  unit?: string;
  isOdometer?: boolean;
  note?: string | null;
  noteAr?: string | null;
  actorId: string | null;
}): Promise<MeterRow | undefined> {
  const rows = await query<{ id: string }>(sql`
    UPDATE asset_meters SET
      name = COALESCE(${input.name ?? null}, name),
      name_ar = COALESCE(${input.nameAr ?? null}, name_ar),
      unit = COALESCE(${input.unit ?? null}, unit),
      is_odometer = COALESCE(${input.isOdometer ?? null}, is_odometer),
      note = COALESCE(${input.note ?? null}, note),
      note_ar = COALESCE(${input.noteAr ?? null}, note_ar),
      updated_at = now(),
      updated_by = ${input.actorId},
      version = version + 1
    WHERE id = ${input.meterId}
    RETURNING id`);
  if (rows[0] === undefined) return undefined;
  return findMeterById(input.meterId);
}

/** R-10's one-per-asset read: the asset's CURRENT odometer designation
 * (excluding the meter being patched) — the typed first line before the
 * 0106 partial unique's raced floor. */
export async function findOdometerDesignation(
  assetId: string,
  excludeMeterId: string | null,
): Promise<MeterRow | undefined> {
  const rows = await query<MeterRow>(sql`
    ${METER_SELECT}
    WHERE asset_id = ${assetId} AND is_odometer
      AND (${excludeMeterId ?? null}::uuid IS NULL OR id <> ${excludeMeterId ?? null})
    LIMIT 1`);
  return rows[0];
}

export interface ReadingRow {
  id: string;
  meterId: string;
  value: string;
  effectiveDate: string;
  source: string;
  workOrderId: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
}

const READING_SELECT = sql`
  SELECT id, meter_id AS "meterId", value::text AS value,
    effective_date::text AS "effectiveDate", source,
    work_order_id AS "workOrderId", note, note_ar AS "noteAr",
    created_by AS "createdBy", created_at AS "createdAt"
  FROM asset_meter_readings`;

export async function insertReading(input: {
  meterId: string;
  value: string;
  effectiveDate: string;
  source: "MANUAL" | "JOB" | "IMPORT";
  workOrderId: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
}): Promise<ReadingRow> {
  const id = generateUuidV7();
  const rows = await query<{ id: string }>(sql`
    INSERT INTO asset_meter_readings (id, tenant_id, created_by, meter_id, value,
      effective_date, source, work_order_id, note, note_ar)
    VALUES (${id}, ${requireTenantContext().tenantId}, ${input.createdBy}, ${input.meterId},
      ${input.value}, ${input.effectiveDate}, ${input.source}, ${input.workOrderId},
      ${input.note}, ${input.noteAr})
    RETURNING id`);
  const found = await query<ReadingRow>(sql`
    ${READING_SELECT} WHERE id = ${rows[0]!.id} LIMIT 1`);
  return found[0]!;
}

export async function listReadings(meterId: string, limit = 200): Promise<ReadingRow[]> {
  const rows = await query<ReadingRow>(sql`
    ${READING_SELECT} WHERE meter_id = ${meterId}
    ORDER BY effective_date DESC, created_at DESC
    LIMIT ${limit}`);
  return rows;
}

/**
 * D-07's snapshot law: last_value recomputed to the MAX (a back-dated-but-
 * higher reading is LEGAL and moves it; a lower one was already refused by
 * the service's monotonic law) — one guarded UPDATE in the reading's own
 * transaction.
 */
export async function advanceMeterSnapshot(input: {
  meterId: string;
  value: string;
  at: string;
  actorId: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE asset_meters SET
      last_value = GREATEST(last_value, ${input.value}::numeric),
      last_reading_at = ${input.at},
      updated_at = now(),
      updated_by = ${input.actorId},
      version = version + 1
    WHERE id = ${input.meterId}`);
}

/** The event-driven wiring's plan read: the ACTIVE METER plans bound to a
 * meter (T-08 — the reading's own transaction evaluates exactly these). */
export async function activePlansByMeter(
  meterId: string,
): Promise<{ id: string }[]> {
  const rows = await query<{ id: string }>(sql`
    SELECT id FROM maintenance_plans
    WHERE meter_id = ${meterId} AND is_active
    ORDER BY created_at`);
  return rows;
}

// ── the spare-parts BOM (0106 — D-05, BR-099) ───────────────────────────────

export interface SpareRow {
  id: string;
  assetId: string;
  itemId: string;
  qty: string;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const SPARE_SELECT = sql`
  SELECT id, asset_id AS "assetId", item_id AS "itemId", qty::text AS qty,
    note, note_ar AS "noteAr", created_by AS "createdBy",
    created_at AS "createdAt", updated_at AS "updatedAt", version
  FROM asset_spares`;

export async function insertSpare(input: {
  assetId: string;
  itemId: string;
  qty: string;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
}): Promise<SpareRow> {
  const id = generateUuidV7();
  const rows = await query<{ id: string }>(sql`
    INSERT INTO asset_spares (id, tenant_id, created_by, asset_id, item_id, qty, note, note_ar)
    VALUES (${id}, ${requireTenantContext().tenantId}, ${input.createdBy}, ${input.assetId},
      ${input.itemId}, ${input.qty}, ${input.note}, ${input.noteAr})
    RETURNING id`);
  const found = await query<SpareRow>(sql`
    ${SPARE_SELECT} WHERE id = ${rows[0]!.id} LIMIT 1`);
  return found[0]!;
}

export async function findSpareById(id: string): Promise<SpareRow | undefined> {
  const rows = await query<SpareRow>(sql`
    ${SPARE_SELECT} WHERE id = ${id} LIMIT 1`);
  return rows[0];
}

export async function listSpares(filter: {
  assetId?: string;
  limit?: number;
}): Promise<SpareRow[]> {
  const rows = await query<SpareRow>(sql`
    ${SPARE_SELECT}
    WHERE (${filter.assetId ?? null}::uuid IS NULL OR asset_id = ${filter.assetId ?? null})
    ORDER BY created_at DESC
    LIMIT ${filter.limit ?? 200}`);
  return rows;
}

export async function patchSpare(input: {
  spareId: string;
  qty?: string;
  note?: string | null;
  noteAr?: string | null;
  actorId: string | null;
}): Promise<SpareRow | undefined> {
  const rows = await query<{ id: string }>(sql`
    UPDATE asset_spares SET
      qty = COALESCE(${input.qty ?? null}, qty),
      note = COALESCE(${input.note ?? null}, note),
      note_ar = COALESCE(${input.noteAr ?? null}, note_ar),
      updated_at = now(),
      updated_by = ${input.actorId},
      version = version + 1
    WHERE id = ${input.spareId}
    RETURNING id`);
  if (rows[0] === undefined) return undefined;
  return findSpareById(input.spareId);
}

export async function deleteSpare(spareId: string): Promise<void> {
  await tenantTx().execute(sql`DELETE FROM asset_spares WHERE id = ${spareId}`);
}

/** The BOM's item-master read (the phase doc's own drift mitigation): the
 * item's existence + its discontinued flag — the typed refusal's input. */
export async function findItemLite(
  itemId: string,
): Promise<{ id: string; status: string; sku: string } | undefined> {
  const rows = await query<{ id: string; status: string; sku: string }>(sql`
    SELECT id, status, sku FROM items WHERE id = ${itemId} LIMIT 1`);
  return rows[0];
}

// ── the transfers ladder (0107 — D-06, BR-100/G-61) ─────────────────────────

export interface TransferRow {
  id: string;
  assetId: string;
  fromBranchId: string;
  toBranchId: string;
  reason: string;
  reasonAr: string | null;
  status: string;
  submittedAt: string | null;
  submittedBy: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  rejectedAt: string | null;
  rejectedBy: string | null;
  rejectReason: string | null;
  journalEntryId: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const TRANSFER_SELECT = sql`
  SELECT id, asset_id AS "assetId", from_branch_id AS "fromBranchId",
    to_branch_id AS "toBranchId", reason, reason_ar AS "reasonAr", status,
    submitted_at AS "submittedAt", submitted_by AS "submittedBy",
    approved_at AS "approvedAt", approved_by AS "approvedBy",
    rejected_at AS "rejectedAt", rejected_by AS "rejectedBy",
    reject_reason AS "rejectReason", journal_entry_id AS "journalEntryId",
    note, note_ar AS "noteAr", created_by AS "createdBy",
    created_at AS "createdAt", updated_at AS "updatedAt", version
  FROM asset_transfers`;

export async function insertTransfer(input: {
  assetId: string;
  fromBranchId: string;
  toBranchId: string;
  reason: string;
  reasonAr: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
}): Promise<TransferRow> {
  const id = generateUuidV7();
  const rows = await query<{ id: string }>(sql`
    INSERT INTO asset_transfers (id, tenant_id, created_by, asset_id, from_branch_id,
      to_branch_id, reason, reason_ar, note, note_ar)
    VALUES (${id}, ${requireTenantContext().tenantId}, ${input.createdBy}, ${input.assetId},
      ${input.fromBranchId}, ${input.toBranchId}, ${input.reason}, ${input.reasonAr},
      ${input.note}, ${input.noteAr})
    RETURNING id`);
  return findTransferById(rows[0]!.id) as Promise<TransferRow>;
}

export async function findTransferById(id: string): Promise<TransferRow | undefined> {
  const rows = await query<TransferRow>(sql`
    ${TRANSFER_SELECT} WHERE id = ${id} LIMIT 1`);
  return rows[0];
}

export async function listTransfers(filter: {
  assetId?: string;
  status?: string;
  limit?: number;
}): Promise<TransferRow[]> {
  const rows = await query<TransferRow>(sql`
    ${TRANSFER_SELECT}
    WHERE (${filter.assetId ?? null}::uuid IS NULL OR asset_id = ${filter.assetId ?? null})
      AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
    ORDER BY created_at DESC
    LIMIT ${filter.limit ?? 100}`);
  return rows;
}

/** DRAFT → SUBMITTED — ONE guarded CAS (the submission stamps land in the
 * same statement; zero rows = raced/stale, surfaced BY NAME). */
export async function casSubmitTransfer(input: {
  id: string;
  submittedAt: string;
  actorId: string | null;
}): Promise<TransferRow | undefined> {
  const rows = await query<{ id: string }>(sql`
    UPDATE asset_transfers SET
      status = 'SUBMITTED',
      submitted_at = ${input.submittedAt},
      submitted_by = ${input.actorId},
      updated_at = now(),
      updated_by = ${input.actorId},
      version = version + 1
    WHERE id = ${input.id} AND status = 'DRAFT'
    RETURNING id`);
  if (rows[0] === undefined) return undefined;
  return findTransferById(input.id);
}

/**
 * THE APPROVAL'S CAS + SEALS (BR-100's exactly-once floor): the verdict
 * stamps and — on the NBV>0 path — the journal link land in ONE guarded
 * UPDATE pinning status = 'SUBMITTED' AND approved_at IS NULL AND
 * journal_entry_id IS NULL (the single consumption); the G-61 entry and
 * the branch flip have ALREADY succeeded in the same ambient transaction
 * when this statement runs (the seals land AFTER the operation, D-06 —
 * the 0105 completion-stamp precedent). The zero-NBV path passes
 * journalEntryId NULL (the 0107 gate's own allowance).
 */
export async function sealTransferApproved(input: {
  id: string;
  journalEntryId: string | null;
  approvedAt: string;
  actorId: string | null;
}): Promise<TransferRow | undefined> {
  const rows = await query<{ id: string }>(sql`
    UPDATE asset_transfers SET
      status = 'APPROVED',
      approved_at = ${input.approvedAt},
      approved_by = ${input.actorId},
      journal_entry_id = ${input.journalEntryId},
      updated_at = now(),
      updated_by = ${input.actorId},
      version = version + 1
    WHERE id = ${input.id}
      AND status = 'SUBMITTED'
      AND approved_at IS NULL
      AND rejected_at IS NULL
      AND journal_entry_id IS NULL
    RETURNING id`);
  if (rows[0] === undefined) return undefined;
  return findTransferById(input.id);
}

/** SUBMITTED → REJECTED — the verdict XOR's other side (the reason is
 * never silent; one guarded CAS). */
export async function sealTransferRejected(input: {
  id: string;
  rejectedAt: string;
  rejectReason: string;
  actorId: string | null;
}): Promise<TransferRow | undefined> {
  const rows = await query<{ id: string }>(sql`
    UPDATE asset_transfers SET
      status = 'REJECTED',
      rejected_at = ${input.rejectedAt},
      rejected_by = ${input.actorId},
      reject_reason = ${input.rejectReason},
      updated_at = now(),
      updated_by = ${input.actorId},
      version = version + 1
    WHERE id = ${input.id}
      AND status = 'SUBMITTED'
      AND approved_at IS NULL
      AND rejected_at IS NULL
    RETURNING id`);
  if (rows[0] === undefined) return undefined;
  return findTransferById(input.id);
}

/** The branch flip — the approval act's own second guarded statement in
 * the SAME ambient transaction (the asset's cost/accumulated columns are
 * NEVER touched — D-01: the branch dimension carries the move; the
 * register's own column family has no updated_by — the 0037 shape). */
export async function flipAssetBranch(input: {
  assetId: string;
  toBranchId: string;
  actorId: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE assets SET
      branch_id = ${input.toBranchId},
      updated_at = now(),
      version = version + 1
    WHERE id = ${input.assetId}`);
}

/** The approval act's register read: the asset's branch + status + the
 * NBV's own inputs (cost + the live accumulated — opening + Σ posted
 * unreversed depreciation lines, the INV-023 read model's shape). The
 * ARITHMETIC is the pure fold's (netBookValue) — never a parallel sum. */
export async function findAssetTransferBasis(
  assetId: string,
): Promise<
  | {
      id: string;
      status: string;
      branchId: string;
      cost: string;
      accumulated: string;
    }
  | undefined
> {
  const rows = await query<{
    id: string;
    status: string;
    branchId: string;
    cost: string;
    accumulated: string;
  }>(sql`
    SELECT a.id, a.status, a.branch_id AS "branchId", a.cost::text AS cost,
      (COALESCE(a.opening_accumulated, 0) + COALESCE((
        SELECT SUM(dl.period_amount) FROM depreciation_lines dl
        JOIN depreciation_runs r ON r.id = dl.run_id
        WHERE dl.asset_id = ${assetId} AND r.status = 'POSTED' AND r.reversed_at IS NULL
      ), 0))::text AS accumulated
    FROM assets a WHERE a.id = ${assetId} LIMIT 1`);
  return rows[0];
}

/** The branch read (the ladder's own subject — existence + code, the
 * derived purpose key's input). */
export async function findBranchLite(
  branchId: string,
): Promise<{ id: string; code: string; name: string; isActive: boolean } | undefined> {
  const rows = await query<{ id: string; code: string; name: string; isActive: boolean }>(sql`
    SELECT id, code, name, is_active AS "isActive" FROM branches WHERE id = ${branchId} LIMIT 1`);
  return rows[0];
}

// ═══════════════════════════════════════════════════════════════════════════
// PHASE-049 (W-19 — T-11/T-12): the tags + the expiry sweep + the fleet-light
// register + the sweep's settings surface. Every statement rides the caller's
// ambient tenant UoW; the tags' CAS is the same guarded-UPDATE law as the
// machine's; the sweep's probes derive their dates from the database's own
// CURRENT_DATE (the derived step — NO JS wall-clock arithmetic anywhere in
// the sweep's path, the owner's W-19 clock law).
// ═══════════════════════════════════════════════════════════════════════════

// ── the signed tags (D-09 — 0106's asset_tags) ─────────────────────────────

export interface TagRow {
  id: string;
  assetId: string;
  code: string;
  printedAt: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const TAG_SELECT = sql`
  SELECT id, asset_id AS "assetId", code, printed_at::text AS "printedAt",
    note, note_ar AS "noteAr", created_by AS "createdBy",
    created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
  FROM asset_tags`;

/** Insert one generated code — the structural uq_asset_tags_tenant_code is
 * the uniqueness floor (a 2^-256 collision surfaces as the no-rows return;
 * the service's bounded regeneration loop is the honest non-event). */
export async function insertTag(input: {
  assetId: string;
  code: string;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
}): Promise<TagRow | undefined> {
  const id = generateUuidV7();
  const rows = await query<{ id: string }>(sql`
    INSERT INTO asset_tags (id, tenant_id, created_by, asset_id, code, note, note_ar)
    VALUES (${id}, ${requireTenantContext().tenantId}, ${input.createdBy}, ${input.assetId},
      ${input.code}, ${input.note}, ${input.noteAr})
    ON CONFLICT ("tenant_id", "code") DO NOTHING
    RETURNING id`);
  if (rows[0] === undefined) return undefined;
  return findTagById(id);
}

export async function findTagById(tagId: string): Promise<TagRow | undefined> {
  const rows = await query<TagRow>(sql`${TAG_SELECT} WHERE id = ${tagId} LIMIT 1`);
  return rows[0];
}

/** The RLS-scoped resolution read — the scan surface's ONLY lookup (a
 * foreign tenant's row is invisible here by policy: the typed 404's
 * substrate, never a cross-tenant oracle). */
export async function findTagByCode(code: string): Promise<TagRow | undefined> {
  const rows = await query<TagRow>(sql`${TAG_SELECT} WHERE code = ${code} LIMIT 1`);
  return rows[0];
}

export async function listTags(filter: { assetId?: string }): Promise<TagRow[]> {
  const assetClause =
    filter.assetId === undefined ? sql`` : sql` WHERE asset_id = ${filter.assetId}`;
  return query<TagRow>(sql`${TAG_SELECT}${assetClause} ORDER BY created_at, id`);
}

/**
 * THE PRINTED STAMP'S CAS (the single-consumption seal — the 0105
 * completion-stamp precedent's tags sibling): ONE guarded UPDATE pinning
 * `printed_at IS NULL`; zero rows means the already-printed (or raced)
 * tag — the service's TAG_ALREADY_PRINTED names it with the standing
 * stamp. A re-print is the honest refusal: print a NEW tag instead (the
 * old label's code dies with its row; the scan 404s thereafter).
 */
export async function stampTagPrinted(input: {
  tagId: string;
  printedAt: string;
  actorId: string | null;
}): Promise<TagRow | undefined> {
  const rows = await query<{ id: string }>(sql`
    UPDATE asset_tags SET
      printed_at = ${input.printedAt},
      updated_at = now(),
      updated_by = ${input.actorId},
      version = version + 1
    WHERE id = ${input.tagId} AND printed_at IS NULL
    RETURNING id`);
  if (rows[0] === undefined) return undefined;
  return findTagById(input.tagId);
}

/** The register-hygiene delete (the 0106 DELETE grant's service law): a
 * mistyped batch's cleanup or a retired physical label — the code stops
 * resolving the moment the row dies (the audit carries the before). */
export async function deleteTag(tagId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(sql`
    DELETE FROM asset_tags WHERE id = ${tagId} RETURNING id`);
  return rows[0] !== undefined;
}

/** The pending print sheet's batch — the UNPRINTED tags for one asset
 * (one sheet per tag batch — the payload the W-21 print plane renders
 * deterministically with `bi()`; ZERO parallel accounting: the batch is
 * DERIVED from the rows, never a stored list). */
export async function listUnprintedTags(assetId: string): Promise<TagRow[]> {
  return query<TagRow>(sql`
    ${TAG_SELECT} WHERE asset_id = ${assetId} AND printed_at IS NULL
    ORDER BY created_at, id`);
}

// ── the asset card's resolution payload (the scan surface, D-09/D-11) ──────

export interface AssetCardRow {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  branchId: string;
  branchCode: string;
  branchName: string;
  status: string;
  custodianUserId: string | null;
  warrantyExpiry: string | null;
  insuranceExpiry: string | null;
  licenseExpiry: string | null;
  inspectionExpiry: string | null;
  parentAssetId: string | null;
  costCenterId: string | null;
}

export async function findAssetCard(assetId: string): Promise<AssetCardRow | undefined> {
  const rows = await query<AssetCardRow>(sql`
    SELECT a.id, a.code, a.name, a.name_ar AS "nameAr",
      a.category_id AS "categoryId", c.code AS "categoryCode",
      c.name AS "categoryName", a.branch_id AS "branchId", b.code AS "branchCode",
      b.name AS "branchName", a.status, a.custodian_user_id AS "custodianUserId",
      a.warranty_expiry::text AS "warrantyExpiry",
      a.insurance_expiry::text AS "insuranceExpiry",
      a.license_expiry::text AS "licenseExpiry",
      a.inspection_expiry::text AS "inspectionExpiry",
      a.parent_asset_id AS "parentAssetId", a.cost_center_id AS "costCenterId"
    FROM assets a
    JOIN asset_categories c ON c.id = a.category_id
    JOIN branches b ON b.id = a.branch_id
    WHERE a.id = ${assetId} LIMIT 1`);
  return rows[0];
}

/** The card's maintenance context: the OPEN work orders + the ACTIVE plans
 * (the service-history timeline's live head — the chronology itself is
 * W-21's surface; the counts are the card's honest summary). */
export async function assetMaintenanceSummary(assetId: string): Promise<{
  openWorkOrders: number;
  activePlans: number;
}> {
  const rows = await query<{ openOrders: string; activePlans: string }>(sql`
    SELECT
      (SELECT count(*) FROM maintenance_work_orders
        WHERE asset_id = ${assetId} AND status <> 'COMPLETED')::text AS "openOrders",
      (SELECT count(*) FROM maintenance_plans
        WHERE asset_id = ${assetId} AND is_active)::text AS "activePlans"`);
  return {
    openWorkOrders: Number(rows[0]?.openOrders ?? 0),
    activePlans: Number(rows[0]?.activePlans ?? 0),
  };
}

/** The card's odometer binding (R-10): the asset's ONE designated KM meter
 * with its live snapshot — NULL when the tenant tracks none. */
export async function findAssetOdometer(
  assetId: string,
): Promise<
  | { meterId: string; name: string; nameAr: string | null; unit: string; lastValue: string }
  | undefined
> {
  const rows = await query<{
    meterId: string;
    name: string;
    nameAr: string | null;
    unit: string;
    lastValue: string;
  }>(sql`
    SELECT id AS "meterId", name, name_ar AS "nameAr", unit,
      last_value::text AS "lastValue"
    FROM asset_meters
    WHERE asset_id = ${assetId} AND is_odometer AND type = 'KM'
    LIMIT 1`);
  return rows[0];
}

// ── the expiry sweep's probes (D-10 — the derived-step clock law) ───────────

export interface ExpiringAssetRow {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  expiry: string;
}

/**
 * ONE class's banded probe — ACTIVE assets only (a disposed/written-off
 * asset left the register: no alerts — D-01's status-guard spirit). THE
 * DERIVED STEP: the band edges resolve against the database's own
 * CURRENT_DATE inside the statement — the whole sweep's clock law (no
 * Date.now()+delta anywhere in JS; the band arithmetic is the pure fold's,
 * the date arithmetic is the database's own).
 */
export async function scanExpiringAssets(input: {
  assetExpiryClass: "warranty" | "insurance" | "license" | "inspection";
  band: { threshold: number; fromDays: number | null; toDays: number };
  limit: number;
}): Promise<ExpiringAssetRow[]> {
  const column =
    input.assetExpiryClass === "warranty"
      ? sql`warranty_expiry`
      : input.assetExpiryClass === "insurance"
        ? sql`insurance_expiry`
        : input.assetExpiryClass === "license"
          ? sql`license_expiry`
          : sql`inspection_expiry`;
  return query<ExpiringAssetRow>(sql`
    SELECT id, code, name, name_ar AS "nameAr", ${column}::text AS expiry
    FROM assets
    WHERE status = 'ACTIVE'
      AND ${column} IS NOT NULL
      AND ${column} <= (CURRENT_DATE + ${input.band.toDays}::int)
      AND (${input.band.fromDays ?? null}::int IS NULL
        OR ${column} > (CURRENT_DATE + ${input.band.fromDays ?? null}::int))
    ORDER BY ${column}, id
    LIMIT ${input.limit}`);
}

// ── the fleet-light register (R-10 — the view over the substrate) ──────────

export interface FleetLightRow {
  assetId: string;
  code: string;
  name: string;
  nameAr: string;
  status: string;
  categoryId: string;
  categoryCode: string;
  categoryName: string;
  branchCode: string;
  branchName: string;
  warrantyExpiry: string | null;
  warrantyDays: number | null;
  insuranceExpiry: string | null;
  insuranceDays: number | null;
  licenseExpiry: string | null;
  licenseDays: number | null;
  inspectionExpiry: string | null;
  inspectionDays: number | null;
  odometerMeterId: string | null;
  odometerName: string | null;
  odometerUnit: string | null;
  odometerValue: string | null;
}

/**
 * THE FLEET-LIGHT REGISTER (R-10, the owner's CR-50 light-only decision):
 * a READ MODEL over the substrate — every asset with its four expiry
 * chips (the days-to-expiry derived from the database's own CURRENT_DATE
 * — the same derived-step law) + the odometer binding (the ONE designated
 * KM meter's snapshot). ZERO new tables, ZERO parallel accounting (the
 * register derives from assets + asset_meters alone); the vehicle-class
 * grouping is the CALLER's category filter (categories are tenant data —
 * the platform never hard-codes which category is a "vehicle"; full
 * fuel/violations management stays the recorded sectoral non-goal).
 */
export async function fleetLightRegister(filter: {
  categoryIds?: readonly string[];
  limit: number;
}): Promise<FleetLightRow[]> {
  const categoryClause =
    filter.categoryIds === undefined || filter.categoryIds.length === 0
      ? sql``
      : sql` AND a.category_id IN (${sql.join(
          filter.categoryIds.map((id) => sql`${id}`),
          sql`, `,
        )})`;
  return query<FleetLightRow>(sql`
    SELECT a.id AS "assetId", a.code, a.name, a.name_ar AS "nameAr", a.status,
      a.category_id AS "categoryId", c.code AS "categoryCode", c.name AS "categoryName",
      b.code AS "branchCode", b.name AS "branchName",
      a.warranty_expiry::text AS "warrantyExpiry",
      (a.warranty_expiry - CURRENT_DATE)::int AS "warrantyDays",
      a.insurance_expiry::text AS "insuranceExpiry",
      (a.insurance_expiry - CURRENT_DATE)::int AS "insuranceDays",
      a.license_expiry::text AS "licenseExpiry",
      (a.license_expiry - CURRENT_DATE)::int AS "licenseDays",
      a.inspection_expiry::text AS "inspectionExpiry",
      (a.inspection_expiry - CURRENT_DATE)::int AS "inspectionDays",
      m.id AS "odometerMeterId", m.name AS "odometerName", m.unit AS "odometerUnit",
      m.last_value::text AS "odometerValue"
    FROM assets a
    JOIN asset_categories c ON c.id = a.category_id
    JOIN branches b ON b.id = a.branch_id
    LEFT JOIN asset_meters m ON m.asset_id = a.id AND m.is_odometer AND m.type = 'KM'
    WHERE a.status = 'ACTIVE'${categoryClause}
    ORDER BY c.code, a.code
    LIMIT ${filter.limit}`);
}

// ── the sweep's settings surface (the first 049 settings keys) ─────────────

export interface SweepSettingsRow {
  key: string;
  value: unknown;
  updatedAt: string;
}

/** The stored row read (undefined = no stored row — the registry default
 * fires; the reader's stored ∪ default posture). */
export async function findSweepSetting(): Promise<SweepSettingsRow | undefined> {
  const rows = await query<SweepSettingsRow>(sql`
    SELECT key, value, updated_at::text AS "updatedAt"
    FROM tenant_settings WHERE key = 'assets.expiry_sweep_thresholds' LIMIT 1`);
  return rows[0];
}

/**
 * The thresholds write — THE SAME single settings home the generic tenancy
 * surface writes (tenant_settings' structural unique on (tenant, key) is
 * the one-row-per-key floor; ZERO parallel accounting: no second store,
 * the typed surface and the generic surface write the SAME row). The
 * invalidation event rides the configuration module's exported
 * publishTenancyEvent — the SAME bus the SettingsService uses (the
 * cachedTenantSettings cache invalidates identically from either path).
 */
export async function upsertSweepSetting(input: {
  value: readonly number[];
  actorId: string | null;
}): Promise<SweepSettingsRow> {
  const id = generateUuidV7();
  const rows = await query<{ key: string }>(sql`
    INSERT INTO tenant_settings (id, tenant_id, key, value, updated_by)
    VALUES (${id}, ${requireTenantContext().tenantId}, 'assets.expiry_sweep_thresholds',
      ${JSON.stringify(input.value)}::jsonb, ${input.actorId})
    ON CONFLICT ("tenant_id", "key") DO UPDATE SET
      value = EXCLUDED.value, updated_at = now(),
      version = tenant_settings.version + 1, updated_by = EXCLUDED.updated_by
    RETURNING key`);
  const saved = rows[0];
  if (saved === undefined) {
    return findSweepSetting() as Promise<SweepSettingsRow>;
  }
  const after = await findSweepSetting();
  return after as SweepSettingsRow;
}

/** The sweep's LAST-RUN SEAL read — the latest audit record of the run
 * action (the audit plane IS the job log; no parallel stats row — the
 * sales.store's action-keyed audit read precedent). */
export async function lastSweepRun(): Promise<
  { at: string; outcome: { windows: number[]; flagged: number; notified: number } } | undefined
> {
  const rows = await query<{ at: string; after: { windows: number[]; flagged: number; notified: number } }>(sql`
    SELECT at::text AS at, after
    FROM audit_events
    WHERE action = 'assets.expiry_sweep_run'
    ORDER BY at DESC LIMIT 1`);
  const row = rows[0];
  return row === undefined ? undefined : { at: row.at, outcome: row.after };
}
