import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-048 (W-9 — T-05 + T-06 + T-07) — the projects plane store: the
 * ONLY writer for the 0100/0101 family's rows (project_wbs_tasks,
 * project_budgets, project_budget_lines,
 * project_resource_allocations — the talent.store precedent: one store
 * per family). All reads run under the ambient tenant UoW (RLS); every
 * numeric field crosses the boundary as an EXACT decimal string
 * (::text, never a JS number — ADR-0009's law).
 *
 * THE WRITE SHAPES:
 *
 * - THE WBS TREE: plain guarded writes — the cycle laws are the PURE
 *   layer's (projects-math detectDependencyCycle /
 *   wouldCreateParentCycle), enforced by the SERVICE before any write;
 *   the 0100 composite FKs + CHECKs are the structural floor (the
 *   parent/predecessor RESTRICT edges enforce the children-first
 *   delete order; the service's in-use guard surfaces it typed).
 * - THE BUDGET CAS: `casBudgetStatus` is ONE UPDATE … WHERE id AND
 *   status = ${from} — zero rows = the raced/stale move (the talent
 *   cycle CAS precedent). The DRAFT bulk-replace deletes + reinserts
 *   the lines in ONE ambient transaction (the 028 budget_lines
 *   precedent — the service never replaces a non-DRAFT parent's lines).
 * - THE ALLOCATIONS: plain guarded writes (planning data — DELETE
 *   granted per 0101); the over-allocation WARNING is a READ-side
 *   signal computed by the service (never a write refusal — 0101's
 *   recorded law).
 *
 * THE ACTUAL COLLECTORS (T-07/D-05) are READ-ONLY over other modules'
 * tables — crm_time_entries (the 0100 WBS dimension), the payroll
 * salary structures (D-01: read-only, never a payroll write), the WMS
 * stock_moves issue paths (the 044 surfaces), the 0103 subcontractor
 * certificates, and the GL journal_lines project dimension (INV-033's
 * reconciliation target). No collector writes anything.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("projects-plane access requires an ambient tenant scope");
  }
  return context.tx;
}

// ── the row shapes ─────────────────────────────────────────────────────────

export interface WbsTaskRow {
  id: string;
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
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectBudgetRow {
  id: string;
  projectId: string;
  name: string;
  nameAr: string | null;
  status: string;
  approvedAt: string | null;
  closedAt: string | null;
  note: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetLineRow {
  id: string;
  budgetId: string;
  costType: string;
  wbsTaskId: string | null;
  periodStart: string;
  periodEnd: string;
  plannedAmount: string;
  note: string | null;
}

export interface AllocationRow {
  id: string;
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
  version: number;
  createdAt: string;
  updatedAt: string;
}

const WBS_TASK_COLUMNS = sql`
  id, project_id AS "projectId", parent_task_id AS "parentTaskId",
  predecessor_task_id AS "predecessorTaskId", wbs_code AS "wbsCode",
  name, name_ar AS "nameAr", is_milestone AS "isMilestone",
  start_date::text AS "startDate", end_date::text AS "endDate",
  weight::text AS "weight", percent_complete::text AS "percentComplete",
  note, note_ar AS "noteAr", version, created_at::text AS "createdAt",
  updated_at::text AS "updatedAt"
`;

const BUDGET_COLUMNS = sql`
  id, project_id AS "projectId", name, name_ar AS "nameAr", status,
  approved_at::text AS "approvedAt", closed_at::text AS "closedAt",
  note, version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
`;

const BUDGET_LINE_COLUMNS = sql`
  id, budget_id AS "budgetId", cost_type AS "costType",
  wbs_task_id AS "wbsTaskId", period_start::text AS "periodStart",
  period_end::text AS "periodEnd", planned_amount::text AS "plannedAmount", note
`;

const ALLOCATION_COLUMNS = sql`
  id, project_id AS "projectId", wbs_task_id AS "wbsTaskId",
  resource_kind AS "resourceKind", employee_id AS "employeeId",
  asset_id AS "assetId", start_date::text AS "startDate",
  end_date::text AS "endDate", allocation_percent::text AS "allocationPercent",
  note, note_ar AS "noteAr", version, created_at::text AS "createdAt",
  updated_at::text AS "updatedAt"
`;

// ── T-05: the WBS tree ─────────────────────────────────────────────────────

export async function listWbsTasks(projectId: string): Promise<WbsTaskRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${WBS_TASK_COLUMNS} FROM project_wbs_tasks
    WHERE project_id = ${projectId}
    ORDER BY wbs_code
  `);
  return rows.rows as unknown as WbsTaskRow[];
}

export async function findWbsTaskById(id: string): Promise<WbsTaskRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${WBS_TASK_COLUMNS} FROM project_wbs_tasks WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as WbsTaskRow[])[0];
}

/** The tree's edge set for the pure cycle guards (one read, both laws). */
export async function listWbsEdges(projectId: string): Promise<
  ReadonlyArray<{ id: string; parentTaskId: string | null; predecessorTaskId: string | null }>
> {
  const rows = await tenantTx().execute<{ id: string; parentTaskId: string | null; predecessorTaskId: string | null }>(sql`
    SELECT id, parent_task_id AS "parentTaskId", predecessor_task_id AS "predecessorTaskId"
    FROM project_wbs_tasks WHERE project_id = ${projectId}
  `);
  return rows.rows;
}

/** The dependents count: children + successors naming this task as their
 * predecessor (the RESTRICT edges' in-use guard — children first). */
export async function countWbsDependents(id: string): Promise<number> {
  const rows = await tenantTx().execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM project_wbs_tasks
    WHERE parent_task_id = ${id} OR predecessor_task_id = ${id}
  `);
  return rows.rows[0]?.n ?? 0;
}

export async function insertWbsTask(input: {
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
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO project_wbs_tasks (id, tenant_id, created_by, project_id, parent_task_id,
                                   predecessor_task_id, wbs_code, name, name_ar, is_milestone,
                                   start_date, end_date, weight, percent_complete, note, note_ar)
    VALUES (${id}, erp.current_tenant_id(), ${input.actorId}, ${input.projectId},
            ${input.parentTaskId}, ${input.predecessorTaskId}, ${input.wbsCode}, ${input.name},
            ${input.nameAr}, ${input.isMilestone}, ${input.startDate}, ${input.endDate},
            ${input.weight}, ${input.percentComplete}, ${input.note}, ${input.noteAr})
  `);
  const rows = await tx.execute(sql`
    SELECT ${WBS_TASK_COLUMNS} FROM project_wbs_tasks WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as WbsTaskRow[])[0]!;
}

export async function patchWbsTask(input: {
  id: string;
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
}): Promise<WbsTaskRow | undefined> {
  await tenantTx().execute(sql`
    UPDATE project_wbs_tasks SET
      parent_task_id = CASE WHEN ${input.parentTaskId === undefined} THEN parent_task_id
                            ELSE ${input.parentTaskId ?? null} END,
      predecessor_task_id = CASE WHEN ${input.predecessorTaskId === undefined} THEN predecessor_task_id
                                  ELSE ${input.predecessorTaskId ?? null} END,
      wbs_code = COALESCE(${input.wbsCode ?? null}, wbs_code),
      name = COALESCE(${input.name ?? null}, name),
      name_ar = CASE WHEN ${input.nameAr === undefined} THEN name_ar ELSE ${input.nameAr ?? null} END,
      is_milestone = COALESCE(${input.isMilestone ?? null}, is_milestone),
      start_date = CASE WHEN ${input.startDate === undefined} THEN start_date ELSE ${input.startDate ?? null} END,
      end_date = CASE WHEN ${input.endDate === undefined} THEN end_date ELSE ${input.endDate ?? null} END,
      weight = CASE WHEN ${input.weight === undefined} THEN weight ELSE ${input.weight ?? null} END,
      percent_complete = COALESCE(${input.percentComplete ?? null}, percent_complete),
      note = CASE WHEN ${input.note === undefined} THEN note ELSE ${input.note ?? null} END,
      note_ar = CASE WHEN ${input.noteAr === undefined} THEN note_ar ELSE ${input.noteAr ?? null} END,
      version = version + 1, updated_at = now(), updated_by = ${input.actorId}
    WHERE id = ${input.id}
  `);
  return findWbsTaskById(input.id);
}

export async function deleteWbsTask(id: string): Promise<void> {
  await tenantTx().execute(sql`
    DELETE FROM project_wbs_tasks WHERE id = ${id}
  `);
}

// ── T-06: the budgets ──────────────────────────────────────────────────────

export async function insertProjectBudget(input: {
  projectId: string;
  name: string;
  nameAr: string | null;
  note: string | null;
  actorId: string | null;
}): Promise<ProjectBudgetRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO project_budgets (id, tenant_id, created_by, project_id, name, name_ar, note)
    VALUES (${id}, erp.current_tenant_id(), ${input.actorId}, ${input.projectId},
            ${input.name}, ${input.nameAr}, ${input.note})
  `);
  const rows = await tx.execute(sql`
    SELECT ${BUDGET_COLUMNS} FROM project_budgets WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ProjectBudgetRow[])[0]!;
}

export async function findProjectBudgetById(id: string): Promise<ProjectBudgetRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${BUDGET_COLUMNS} FROM project_budgets WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ProjectBudgetRow[])[0];
}

export async function listProjectBudgets(projectId: string): Promise<ProjectBudgetRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${BUDGET_COLUMNS} FROM project_budgets
    WHERE project_id = ${projectId}
    ORDER BY created_at, id
  `);
  return rows.rows as unknown as ProjectBudgetRow[];
}

/** The lifecycle CAS (the talent cycle precedent): ONE UPDATE guarded by
 * the from-status; zero rows = the raced/stale move (the service's
 * typed BudgetStateError). Approval/closure stamp their evidence. */
export async function casBudgetStatus(input: {
  id: string;
  from: string;
  to: string;
  actorId: string | null;
}): Promise<ProjectBudgetRow | undefined> {
  const approved = input.to === "APPROVED";
  const closed = input.to === "CLOSED";
  const rows = await tenantTx().execute(sql`
    UPDATE project_budgets SET
      status = ${input.to},
      approved_at = CASE WHEN ${approved} THEN now() ELSE approved_at END,
      approved_by = CASE WHEN ${approved} THEN ${input.actorId} ELSE approved_by END,
      closed_at = CASE WHEN ${closed} THEN now() ELSE closed_at END,
      version = version + 1, updated_at = now(), updated_by = ${input.actorId}
    WHERE id = ${input.id} AND status = ${input.from}
    RETURNING id
  `);
  if (rows.rows.length === 0) return undefined;
  return findProjectBudgetById(input.id);
}

export async function listBudgetLines(budgetId: string): Promise<BudgetLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${BUDGET_LINE_COLUMNS} FROM project_budget_lines
    WHERE budget_id = ${budgetId}
    ORDER BY period_start, cost_type, wbs_task_id
  `);
  return rows.rows as unknown as BudgetLineRow[];
}

/** The APPROVED curve alone (D-04: the curve PV reads is the approved
 * one ONLY — DRAFT is authoring, CLOSED stops accruing future reads). */
export async function listApprovedBudgetLines(projectId: string): Promise<BudgetLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT l.id, l.budget_id AS "budgetId", l.cost_type AS "costType",
           l.wbs_task_id AS "wbsTaskId", l.period_start::text AS "periodStart",
           l.period_end::text AS "periodEnd", l.planned_amount::text AS "plannedAmount", l.note
    FROM project_budget_lines l
    JOIN project_budgets b ON b.id = l.budget_id
    WHERE b.project_id = ${projectId} AND b.status = 'APPROVED'
    ORDER BY l.period_start, l.cost_type, l.wbs_task_id
  `);
  return rows.rows as unknown as BudgetLineRow[];
}

export async function replaceBudgetLines(
  budgetId: string,
  lines: ReadonlyArray<{
    costType: string;
    wbsTaskId: string | null;
    periodStart: string;
    periodEnd: string;
    plannedAmount: string;
    note: string | null;
  }>,
): Promise<void> {
  const tx = tenantTx();
  await tx.execute(sql`
    DELETE FROM project_budget_lines WHERE budget_id = ${budgetId}
  `);
  for (const line of lines) {
    await tx.execute(sql`
      INSERT INTO project_budget_lines (id, tenant_id, budget_id, cost_type, wbs_task_id,
                                        period_start, period_end, planned_amount, note)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${budgetId}, ${line.costType},
              ${line.wbsTaskId}, ${line.periodStart}, ${line.periodEnd}, ${line.plannedAmount},
              ${line.note})
    `);
  }
}

// ── T-06: the resource allocations ─────────────────────────────────────────

export async function insertAllocation(input: {
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
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO project_resource_allocations (id, tenant_id, created_by, project_id, wbs_task_id,
                                               resource_kind, employee_id, asset_id, start_date,
                                               end_date, allocation_percent, note, note_ar)
    VALUES (${id}, erp.current_tenant_id(), ${input.actorId}, ${input.projectId},
            ${input.wbsTaskId}, ${input.resourceKind}, ${input.employeeId}, ${input.assetId},
            ${input.startDate}, ${input.endDate}, ${input.allocationPercent}, ${input.note},
            ${input.noteAr})
  `);
  const rows = await tx.execute(sql`
    SELECT ${ALLOCATION_COLUMNS} FROM project_resource_allocations WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as AllocationRow[])[0]!;
}

export async function listAllocations(projectId: string): Promise<AllocationRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ALLOCATION_COLUMNS} FROM project_resource_allocations
    WHERE project_id = ${projectId}
    ORDER BY start_date, resource_kind, id
  `);
  return rows.rows as unknown as AllocationRow[];
}

/** The over-allocation WARNING's read: every allocation touching the
 * employee across ALL the tenant's projects (the read-side signal
 * spans projects — one person's calendar is one pool). */
export async function listEmployeeAllocations(
  employeeId: string,
): Promise<AllocationRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ALLOCATION_COLUMNS} FROM project_resource_allocations
    WHERE employee_id = ${employeeId}
    ORDER BY start_date, id
  `);
  return rows.rows as unknown as AllocationRow[];
}

export async function listAssetAllocations(assetId: string): Promise<AllocationRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ALLOCATION_COLUMNS} FROM project_resource_allocations
    WHERE asset_id = ${assetId}
    ORDER BY start_date, id
  `);
  return rows.rows as unknown as AllocationRow[];
}

export async function findAllocationById(id: string): Promise<AllocationRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ALLOCATION_COLUMNS} FROM project_resource_allocations WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as AllocationRow[])[0];
}

export async function deleteAllocation(id: string): Promise<void> {
  await tenantTx().execute(sql`
    DELETE FROM project_resource_allocations WHERE id = ${id}
  `);
}

// ── T-07: the actual collectors (READ-ONLY — D-01/D-05) ────────────────────

/** The labor collector's source: the APPROVED-class time entries on the
 * project's WBS dimension (BILLED is the post-invoice terminal of an
 * approved entry — excluding it would fabricate a cost drop at billing;
 * DRAFT/VOID never cost). Joins the employee bridge for the cost rate. */
export async function listLaborEntryRows(projectId: string): Promise<
  ReadonlyArray<{
    id: string;
    entryDate: string;
    hours: string;
    wbsTaskId: string | null;
    feeEarnerUserId: string | null;
    employeeId: string | null;
    employeeBasicSalary: string | null;
  }>
> {
  const rows = await tenantTx().execute(sql`
    SELECT te.id, te.entry_date::text AS "entryDate", te.hours::text AS "hours",
           te.wbs_task_id AS "wbsTaskId", te.fee_earner_user_id AS "feeEarnerUserId",
           e.id AS "employeeId", e.basic_salary::text AS "employeeBasicSalary"
    FROM crm_time_entries te
    LEFT JOIN project_wbs_tasks t ON t.id = te.wbs_task_id
    LEFT JOIN employees e ON e.user_id = te.fee_earner_user_id
    WHERE te.status IN ('APPROVED', 'BILLED')
      AND te.wbs_task_id IS NOT NULL
      AND t.project_id = ${projectId}
    ORDER BY te.entry_date, te.id
  `);
  return rows.rows as unknown as {
    id: string;
    entryDate: string;
    hours: string;
    wbsTaskId: string | null;
    feeEarnerUserId: string | null;
    employeeId: string | null;
    employeeBasicSalary: string | null;
  }[];
}

/** The employee's ACTIVE salary structure components (payroll READ-ONLY
 * — D-01: 048 never writes a payroll table; the rate is snapshotted at
 * valuation). */
export async function listEmployeeSalaryComponents(
  employeeId: string,
): Promise<
  ReadonlyArray<{
    kind: string;
    calc: string;
    amount: string | null;
    rate: string | null;
  }>
> {
  const rows = await tenantTx().execute(sql`
    SELECT sc.kind, sc.calc, sc.amount::text AS "amount", sc.rate::text AS "rate"
    FROM salary_components sc
    JOIN salary_structures ss ON ss.id = sc.structure_id
    JOIN employees e ON e.salary_structure_id = ss.id
    WHERE e.id = ${employeeId} AND ss.status = 'ACTIVE'
    ORDER BY sc.seq, sc.key
  `);
  return rows.rows as unknown as { kind: string; calc: string; amount: string | null; rate: string | null }[];
}

/** The materials collector's source: the WMS issue moves (the 044
 * paths — direction OUT, kind issue) whose POSTING carries the project
 * stamp on any line. Valued at the MOVE's own value (the WMS source,
 * never re-derived from the GL — INV-033's materials leg stays
 * independent of its GL target). When nothing ties, the honest zero. */
export async function listProjectIssueMoves(projectId: string): Promise<
  ReadonlyArray<{
    id: string;
    movedAt: string;
    sourceType: string;
    valueAmount: string;
  }>
> {
  const rows = await tenantTx().execute(sql`
    SELECT sm.id, sm.moved_at::text AS "movedAt", sm.source_type AS "sourceType",
           sm.value_amount::text AS "valueAmount"
    FROM stock_moves sm
    WHERE sm.direction = 'OUT' AND sm.move_kind = 'issue'
      AND sm.posted_journal_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM journal_lines jl
        WHERE jl.journal_entry_id = sm.posted_journal_id AND jl.project_id = ${projectId}
      )
    ORDER BY sm.moved_at, sm.id
  `);
  return rows.rows as unknown as { id: string; movedAt: string; sourceType: string; valueAmount: string }[];
}

/** The subcontract collector's source: the APPROVED certificates' net
 * values (the owner's T-07 wording — the net مستخلص; the retention leg
 * is the W-11 retention engine's world). */
export async function listApprovedSubCertificates(projectId: string): Promise<
  ReadonlyArray<{
    id: string;
    certificateDate: string;
    certificateNo: string | null;
    netPayable: string;
  }>
> {
  const rows = await tenantTx().execute(sql`
    SELECT c.id, c.certificate_date::text AS "certificateDate", c.certificate_no AS "certificateNo",
           c.net_payable::text AS "netPayable"
    FROM subcontractor_certificates c
    JOIN subcontractor_agreements a ON a.id = c.agreement_id
    WHERE a.project_id = ${projectId} AND c.status = 'APPROVED'
    ORDER BY c.certificate_date, c.id
  `);
  return rows.rows as unknown as { id: string; certificateDate: string; certificateNo: string | null; netPayable: string }[];
}

/** INV-033's reconciliation target: the GL project dimension — the net
 * DEBIT carry of every journal line stamped with the project (the
 * trial-balance shape: Σ debit − Σ credit, base amounts). */
export async function glProjectDimension(
  projectId: string,
): Promise<{ debit: string; credit: string; net: string }> {
  const rows = await tenantTx().execute<{ debit: string; credit: string; net: string }>(sql`
    SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN base_amount ELSE 0 END), 0)::text AS debit,
           COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN base_amount ELSE 0 END), 0)::text AS credit,
           COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN base_amount ELSE -base_amount END), 0)::text AS net
    FROM journal_lines
    WHERE project_id = ${projectId}
  `);
  return rows.rows[0] ?? { debit: "0.0000", credit: "0.0000", net: "0.0000" };
}

/** The overhead distributor's pool read: the net DEBIT carry of the
 * configured pool accounts (the tenant's indirect-cost registers —
 * these lines carry NO project stamp in the coherent world; the
 * allocation postings do). */
export async function glAccountsNet(accountIds: readonly string[]): Promise<string> {
  if (accountIds.length === 0) return "0.0000";
  const rows = await tenantTx().execute<{ net: string }>(sql`
    SELECT COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN base_amount ELSE -base_amount END), 0)::text AS net
    FROM journal_lines
    WHERE account_id IN (${sql.join(
      accountIds.map((id) => sql`${id}`),
      sql`, `,
    )})
  `);
  return rows.rows[0]?.net ?? "0.0000";
}

/** The overhead driver — the LABOR_HOURS arm: the tenant's per-project
 * approved-class WBS-dimensioned hours (cast to the 4-dp driver scale —
 * the pure fold's minor-unit parse; PG's numeric cast rounds half-up). */
export async function laborHoursByProject(): Promise<
  ReadonlyArray<{ projectId: string; hours: string }>
> {
  const rows = await tenantTx().execute<{ projectId: string; hours: string }>(sql`
    SELECT t.project_id AS "projectId", SUM(te.hours)::numeric(19,4)::text AS "hours"
    FROM crm_time_entries te
    JOIN project_wbs_tasks t ON t.id = te.wbs_task_id
    WHERE te.status IN ('APPROVED', 'BILLED') AND te.wbs_task_id IS NOT NULL
    GROUP BY t.project_id
  `);
  return rows.rows;
}

/** The tenant-wide labor source (the overhead DIRECT_COST driver's arm —
 * the same APPROVED-class read across every project). */
export async function listAllLaborEntryRows(): Promise<
  ReadonlyArray<{
    projectId: string;
    id: string;
    entryDate: string;
    hours: string;
    wbsTaskId: string | null;
    feeEarnerUserId: string | null;
    employeeId: string | null;
    employeeBasicSalary: string | null;
  }>
> {
  const rows = await tenantTx().execute(sql`
    SELECT t.project_id AS "projectId", te.id, te.entry_date::text AS "entryDate",
           te.hours::text AS "hours", te.wbs_task_id AS "wbsTaskId",
           te.fee_earner_user_id AS "feeEarnerUserId", e.id AS "employeeId",
           e.basic_salary::text AS "employeeBasicSalary"
    FROM crm_time_entries te
    JOIN project_wbs_tasks t ON t.id = te.wbs_task_id
    LEFT JOIN employees e ON e.user_id = te.fee_earner_user_id
    WHERE te.status IN ('APPROVED', 'BILLED') AND te.wbs_task_id IS NOT NULL
    ORDER BY te.entry_date, te.id
  `);
  return rows.rows as unknown as {
    projectId: string;
    id: string;
    entryDate: string;
    hours: string;
    wbsTaskId: string | null;
    feeEarnerUserId: string | null;
    employeeId: string | null;
    employeeBasicSalary: string | null;
  }[];
}

/** The tenant-wide WMS issue paths grouped by project (the DIRECT_COST
 * driver's materials arm — the same project-stamped posting tie). */
export async function listAllProjectIssueMoves(): Promise<
  ReadonlyArray<{ projectId: string; id: string; movedAt: string; valueAmount: string }>
> {
  const rows = await tenantTx().execute(sql`
    SELECT jl.project_id AS "projectId", sm.id, sm.moved_at::text AS "movedAt",
           sm.value_amount::text AS "valueAmount"
    FROM stock_moves sm
    JOIN journal_lines jl ON jl.journal_entry_id = sm.posted_journal_id
    WHERE sm.direction = 'OUT' AND sm.move_kind = 'issue'
      AND sm.posted_journal_id IS NOT NULL
      AND jl.project_id IS NOT NULL
    ORDER BY sm.moved_at, sm.id
  `);
  return rows.rows as unknown as { projectId: string; id: string; movedAt: string; valueAmount: string }[];
}

/** The tenant-wide APPROVED sub certificates grouped by project (the
 * DIRECT_COST driver's subcontract arm). */
export async function listAllApprovedSubCertificates(): Promise<
  ReadonlyArray<{ projectId: string; id: string; netPayable: string }>
> {
  const rows = await tenantTx().execute(sql`
    SELECT a.project_id AS "projectId", c.id, c.net_payable::text AS "netPayable"
    FROM subcontractor_certificates c
    JOIN subcontractor_agreements a ON a.id = c.agreement_id
    WHERE c.status = 'APPROVED'
    ORDER BY c.certificate_date, c.id
  `);
  return rows.rows as unknown as { projectId: string; id: string; netPayable: string }[];
}

/** The project-existence read for the plane's guards (A7-indistinguishable). */
export async function findProjectPlane(projectId: string): Promise<
  | { id: string; code: string; name: string; status: string }
  | undefined
> {
  const rows = await tenantTx().execute<{ id: string; code: string; name: string; status: string }>(sql`
    SELECT id, code, name, status FROM projects WHERE id = ${projectId} LIMIT 1
  `);
  return rows.rows[0];
}

/** The WBS task's project — the time-entry write-time coherence read
 * (0100's recorded law: the task ∈ the entry's project at write). */
export async function findWbsTaskProject(
  taskId: string,
): Promise<{ id: string; projectId: string } | undefined> {
  const rows = await tenantTx().execute<{ id: string; projectId: string }>(sql`
    SELECT id, project_id AS "projectId" FROM project_wbs_tasks WHERE id = ${taskId} LIMIT 1
  `);
  return rows.rows[0];
}
