import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * CRM store (PHASE-019 T45): the ONLY writer of the crm-owned `leads`,
 * `crm_tasks` and `crm_activities` tables (migration 0027; drizzle exports
 * `leads`/`crmTasks`/`crmActivities`). Every statement runs in the caller's
 * ambient tenant UoW so a failure anywhere rolls the whole business
 * operation back (INV-018 discipline). None of these rows ever posts a
 * journal — leads are intake pipeline data, tasks/activities operational
 * rows (MASTER-PLAN §2/§3; CAPABILITY_MATRIX §2.6 note).
 *
 * Cross-module reads (partners, tenants, and — for the dashboard summary —
 * the 0027 service_contracts/contract_billing_schedule tables) are
 * read-only SELECTs on published tables — the sanctioned §6 read precedent
 * (the same ambient-tx shape sales.store's findCustomerById exposes); crm
 * never writes another module's rows.
 *
 * Organization: leads → tasks (+ reminder sweep substrate) → activities →
 * dashboard reads → cross-module reads. T46/T48 append the contract/time/
 * service-order slices banner-style, keeping this file the single
 * crm-owned writer (the manufacturing.store organization).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("crm access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- leads (T45; the NEW → QUALIFIED → CONVERTED/LOST pipeline) -----------

export interface LeadRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  name: string;
  nameAr: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  source: string;
  status: string;
  lostReason: string | null;
  ownerUserId: string | null;
  partnerId: string | null;
  convertedAt: string | null;
  note: string | null;
  noteAr: string | null;
}

const LEAD_COLUMNS = sql`id, created_at::text AS "createdAt", updated_at::text AS "updatedAt",
  created_by AS "createdBy", name, name_ar AS "nameAr", phone, email, company, source, status,
  lost_reason AS "lostReason", owner_user_id AS "ownerUserId", partner_id AS "partnerId",
  converted_at::text AS "convertedAt", note, note_ar AS "noteAr"`;

export interface LeadInsert {
  name: string;
  nameAr: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  source: string;
  ownerUserId: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}

export async function insertLead(input: LeadInsert): Promise<LeadRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO leads (id, tenant_id, created_by, name, name_ar, phone, email, company,
                       source, status, owner_user_id, note, note_ar)
    VALUES (${id}, erp.current_tenant_id(), ${input.actorId}, ${input.name}, ${input.nameAr},
            ${input.phone}, ${input.email}, ${input.company}, ${input.source}, 'NEW',
            ${input.ownerUserId}, ${input.note}, ${input.noteAr})
  `);
  return (await findLeadById(id))!;
}

export async function findLeadById(id: string): Promise<LeadRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${LEAD_COLUMNS} FROM leads WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as LeadRow[])[0];
}

export async function listLeads(filter: {
  status?: string;
  ownerUserId?: string;
  limit: number;
}): Promise<LeadRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${LEAD_COLUMNS} FROM leads
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.ownerUserId ?? null}::uuid IS NULL OR owner_user_id = ${filter.ownerUserId ?? null})
    ORDER BY created_at DESC, id
    LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as LeadRow[];
}

/**
 * Field patches while NEW/QUALIFIED (the service owns the immutability
 * guard). Absent values leave the column untouched (COALESCE semantics);
 * explicit nulls clear (the CASE undefined-detection of patchBom).
 */
export async function patchLead(input: {
  id: string;
  name?: string;
  nameAr?: string | null;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
  source?: string;
  ownerUserId?: string | null;
  note?: string | null;
  noteAr?: string | null;
  status?: string;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE leads SET
      name = COALESCE(${input.name ?? null}, name),
      name_ar = CASE WHEN ${input.nameAr === undefined} THEN name_ar ELSE ${input.nameAr ?? null} END,
      phone = CASE WHEN ${input.phone === undefined} THEN phone ELSE ${input.phone ?? null} END,
      email = CASE WHEN ${input.email === undefined} THEN email ELSE ${input.email ?? null} END,
      company = CASE WHEN ${input.company === undefined} THEN company ELSE ${input.company ?? null} END,
      source = COALESCE(${input.source ?? null}, source),
      owner_user_id = CASE WHEN ${input.ownerUserId === undefined} THEN owner_user_id
                           ELSE ${input.ownerUserId ?? null} END,
      note = CASE WHEN ${input.note === undefined} THEN note ELSE ${input.note ?? null} END,
      note_ar = CASE WHEN ${input.noteAr === undefined} THEN note_ar ELSE ${input.noteAr ?? null} END,
      status = COALESCE(${input.status ?? null}, status),
      version = version + 1, updated_at = now()
    WHERE id = ${input.id}
  `);
}

/** The conversion flip: status + partner link + timestamp in one UPDATE
 * (ck_leads_converted_shape is the belt; the link is forever — provenance). */
export async function setLeadConverted(id: string, partnerId: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE leads SET status = 'CONVERTED', partner_id = ${partnerId}, converted_at = now(),
      version = version + 1, updated_at = now()
    WHERE id = ${id}
  `);
}

/** The lost flip (reason already validated 1..200 by the service). */
export async function setLeadLost(id: string, reason: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE leads SET status = 'LOST', lost_reason = ${reason},
      version = version + 1, updated_at = now()
    WHERE id = ${id}
  `);
}

/** Pipeline counts by status (dashboard-summary §13; zeros included). */
export async function countLeadsByStatus(): Promise<Record<"NEW" | "QUALIFIED" | "CONVERTED" | "LOST", number>> {
  const rows = await tenantTx().execute(sql`
    SELECT status, count(*)::int AS n FROM leads GROUP BY status
  `);
  const counts = { NEW: 0, QUALIFIED: 0, CONVERTED: 0, LOST: 0 } as Record<
    "NEW" | "QUALIFIED" | "CONVERTED" | "LOST",
    number
  >;
  for (const row of rows.rows as unknown as { status: string; n: number }[]) {
    if (row.status === "NEW" || row.status === "QUALIFIED" || row.status === "CONVERTED" || row.status === "LOST") {
      counts[row.status] = row.n;
    }
  }
  return counts;
}

// -- crm_tasks (T45; future work + the reminder-sweep substrate) ----------

export interface TaskRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  title: string;
  relatedType: string;
  relatedId: string;
  assigneeUserId: string | null;
  dueDate: string | null;
  remindAt: string | null;
  notifiedAt: string | null;
  status: string;
  note: string | null;
  noteAr: string | null;
}

const TASK_COLUMNS = sql`id, created_at::text AS "createdAt", updated_at::text AS "updatedAt",
  created_by AS "createdBy", title, related_type AS "relatedType", related_id AS "relatedId",
  assignee_user_id AS "assigneeUserId", due_date::text AS "dueDate", remind_at::text AS "remindAt",
  notified_at::text AS "notifiedAt", status, note, note_ar AS "noteAr"`;

export interface TaskInsert {
  title: string;
  relatedType: string;
  relatedId: string;
  assigneeUserId: string | null;
  dueDate: string | null;
  remindAt: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}

export async function insertTask(input: TaskInsert): Promise<TaskRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO crm_tasks (id, tenant_id, created_by, title, related_type, related_id,
                           assignee_user_id, due_date, remind_at, status, note, note_ar)
    VALUES (${id}, erp.current_tenant_id(), ${input.actorId}, ${input.title}, ${input.relatedType},
            ${input.relatedId}, ${input.assigneeUserId}, ${input.dueDate}, ${input.remindAt},
            'OPEN', ${input.note}, ${input.noteAr})
  `);
  return (await findTaskById(id))!;
}

export async function findTaskById(id: string): Promise<TaskRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TASK_COLUMNS} FROM crm_tasks WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as TaskRow[])[0];
}

export async function listTasks(filter: {
  status?: string;
  relatedType?: string;
  relatedId?: string;
  limit: number;
}): Promise<TaskRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TASK_COLUMNS} FROM crm_tasks
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.relatedType ?? null}::text IS NULL OR related_type = ${filter.relatedType ?? null})
      AND (${filter.relatedId ?? null}::uuid IS NULL OR related_id = ${filter.relatedId ?? null})
    ORDER BY created_at DESC, id
    LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as TaskRow[];
}

/**
 * Field patches while OPEN (the service owns the state guard). Carrying
 * remindAt RE-ARMS the reminder (notified_at := NULL) so a postponed
 * reminder can fire again under a fresh dedupe key — the sweep's
 * idempotency is the (notifiedAt IS NULL) predicate + the dedupe key
 * `crm-task-reminder:<taskId>:<remindAt>`.
 */
export async function patchTask(input: {
  id: string;
  title?: string;
  assigneeUserId?: string | null;
  dueDate?: string | null;
  remindAt?: string | null;
  note?: string | null;
  noteAr?: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE crm_tasks SET
      title = COALESCE(${input.title ?? null}, title),
      assignee_user_id = CASE WHEN ${input.assigneeUserId === undefined} THEN assignee_user_id
                              ELSE ${input.assigneeUserId ?? null} END,
      due_date = CASE WHEN ${input.dueDate === undefined} THEN due_date ELSE ${input.dueDate ?? null} END,
      remind_at = CASE WHEN ${input.remindAt === undefined} THEN remind_at ELSE ${input.remindAt ?? null} END,
      notified_at = CASE WHEN ${input.remindAt === undefined} THEN notified_at ELSE NULL END,
      note = CASE WHEN ${input.note === undefined} THEN note ELSE ${input.note ?? null} END,
      note_ar = CASE WHEN ${input.noteAr === undefined} THEN note_ar ELSE ${input.noteAr ?? null} END,
      version = version + 1, updated_at = now()
    WHERE id = ${input.id}
  `);
}

/** OPEN → DONE (guard inside the UPDATE; the service decides replays). */
export async function completeTask(id: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE crm_tasks SET status = 'DONE', version = version + 1, updated_at = now()
    WHERE id = ${id} AND status = 'OPEN'
  `);
}

/** OPEN → CANCELLED (guard inside the UPDATE; the service decides replays). */
export async function cancelTask(id: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE crm_tasks SET status = 'CANCELLED', version = version + 1, updated_at = now()
    WHERE id = ${id} AND status = 'OPEN'
  `);
}

/** The sweep's idempotency stamp — once set, the task never re-notifies
 * for the same remindAt (a postponed remindAt clears it via patchTask). */
export async function markTaskNotified(id: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE crm_tasks SET notified_at = now(), version = version + 1, updated_at = now()
    WHERE id = ${id}
  `);
}

/**
 * The 05:30 sweep's scan slice (MASTER-PLAN §3): OPEN tasks whose reminder
 * is due (remind_at <= now, boundary inclusive — remindAt == now bills) and
 * not yet notified. Mirrors the ix_crm_tasks_pending_reminders partial index.
 */
export async function listDueTaskReminders(now: Date): Promise<TaskRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TASK_COLUMNS} FROM crm_tasks
    WHERE status = 'OPEN' AND remind_at IS NOT NULL AND remind_at <= ${now} AND notified_at IS NULL
    ORDER BY remind_at, id
  `);
  return rows.rows as unknown as TaskRow[];
}

/** Dashboard follow-up counts (§13): OPEN tasks due today / overdue. */
export async function countFollowUps(): Promise<{ dueToday: number; overdue: number }> {
  const rows = await tenantTx().execute(sql`
    SELECT
      count(*) FILTER (WHERE due_date = CURRENT_DATE)::int AS "dueToday",
      count(*) FILTER (WHERE due_date < CURRENT_DATE)::int AS "overdue"
    FROM crm_tasks WHERE status = 'OPEN' AND due_date IS NOT NULL
  `);
  const row = (rows.rows as unknown as { dueToday: number; overdue: number }[])[0];
  return { dueToday: row?.dueToday ?? 0, overdue: row?.overdue ?? 0 };
}

// -- crm_activities (T45; the logged-past timeline) ------------------------

export interface ActivityRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  kind: string;
  relatedType: string;
  relatedId: string;
  occurredAt: string;
  summary: string;
  durationMinutes: number | null;
  actorUserId: string | null;
}

const ACTIVITY_COLUMNS = sql`id, created_at::text AS "createdAt", updated_at::text AS "updatedAt",
  created_by AS "createdBy", kind, related_type AS "relatedType", related_id AS "relatedId",
  occurred_at::text AS "occurredAt", summary, duration_minutes AS "durationMinutes",
  actor_user_id AS "actorUserId"`;

export interface ActivityInsert {
  kind: string;
  relatedType: string;
  relatedId: string;
  occurredAt: string;
  summary: string;
  durationMinutes: number | null;
  actorUserId: string | null;
  createdBy: string | null;
}

export async function insertActivity(input: ActivityInsert): Promise<ActivityRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO crm_activities (id, tenant_id, created_by, kind, related_type, related_id,
                                occurred_at, summary, duration_minutes, actor_user_id)
    VALUES (${id}, erp.current_tenant_id(), ${input.createdBy}, ${input.kind}, ${input.relatedType},
            ${input.relatedId}, ${input.occurredAt}, ${input.summary}, ${input.durationMinutes},
            ${input.actorUserId})
  `);
  const rows = await tx.execute(sql`
    SELECT ${ACTIVITY_COLUMNS} FROM crm_activities WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ActivityRow[])[0]!;
}

/** The timeline read: one related record's activities, newest first (§3). */
export async function listActivities(filter: {
  relatedType?: string;
  relatedId?: string;
  limit: number;
}): Promise<ActivityRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ACTIVITY_COLUMNS} FROM crm_activities
    WHERE (${filter.relatedType ?? null}::text IS NULL OR related_type = ${filter.relatedType ?? null})
      AND (${filter.relatedId ?? null}::uuid IS NULL OR related_id = ${filter.relatedId ?? null})
    ORDER BY occurred_at DESC, id
    LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as ActivityRow[];
}

// -- dashboard-summary reads (T45 §11 row 17; read-only on the 0027 tables) -

/** ACTIVE contracts with end_date <= today + horizonDays (§13 — includes
 * the effectively-expired ACTIVE ones; expiry is derived, never flipped). */
export async function countActiveContractsExpiringWithin(horizonDays: number): Promise<number> {
  const rows = await tenantTx().execute(sql`
    SELECT count(*)::int AS n FROM service_contracts
    WHERE status = 'ACTIVE' AND end_date <= (CURRENT_DATE + ${horizonDays}::int)
  `);
  return (rows.rows as unknown as { n: number }[])[0]?.n ?? 0;
}

/** PLANNED schedule entries billing within the horizon (§13's "next billing
 * preview count" — bill_date <= today + horizonDays). */
export async function countPlannedBillingEntriesWithin(horizonDays: number): Promise<number> {
  const rows = await tenantTx().execute(sql`
    SELECT count(*)::int AS n FROM contract_billing_schedule
    WHERE status = 'PLANNED' AND bill_date <= (CURRENT_DATE + ${horizonDays}::int)
  `);
  return (rows.rows as unknown as { n: number }[])[0]?.n ?? 0;
}

// -- cross-module reads (§6 sanctioned read-only probes) -------------------

/**
 * The partner existence probe for MERGE conversion + PARTNER-related
 * tasks/activities — the sales.store.findCustomerById precedent (read-only
 * SELECT on the published partners table through the ambient tenant UoW).
 */
export interface PartnerProbeRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  kind: string;
  status: string;
  deletedAt: string | null;
}

export async function findPartnerForCrm(id: string): Promise<PartnerProbeRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, code, name, name_ar AS "nameAr", kind, status, deleted_at::text AS "deletedAt"
    FROM partners WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as PartnerProbeRow[])[0];
}

/**
 * The own-tenant display name (the task_reminder email's tenantName
 * variable) — read inside the ambient scope (tenancy.store's getOwnTenant
 * shape, kept local so crm never imports another module's store).
 */
export async function readTenantName(): Promise<string> {
  const rows = await tenantTx().execute(sql`
    SELECT name FROM tenants LIMIT 1
  `);
  return (rows.rows as unknown as { name: string }[])[0]?.name ?? "";
}

// -- service contracts (T46; MASTER-PLAN §4 — DRAFT → ACTIVE/CANCELLED/RENEWED)

export interface ContractRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  contractNo: string | null;
  partnerId: string;
  projectId: string | null;
  title: string;
  titleAr: string | null;
  scope: string | null;
  feeModel: string;
  startDate: string;
  endDate: string;
  monthlyAmount: string | null;
  currencyCode: string;
  status: string;
  renewedToContractId: string | null;
  cancelReason: string | null;
  note: string | null;
  noteAr: string | null;
  activatedAt: string | null;
  cancelledAt: string | null;
}

const CONTRACT_COLUMNS = sql`id, created_at::text AS "createdAt", updated_at::text AS "updatedAt",
  created_by AS "createdBy", contract_no AS "contractNo", partner_id AS "partnerId",
  project_id AS "projectId", title, title_ar AS "titleAr", scope, fee_model AS "feeModel",
  start_date::text AS "startDate", end_date::text AS "endDate", monthly_amount AS "monthlyAmount",
  currency_code AS "currencyCode", status, renewed_to_contract_id AS "renewedToContractId",
  cancel_reason AS "cancelReason", note, note_ar AS "noteAr",
  activated_at::text AS "activatedAt", cancelled_at::text AS "cancelledAt"`;

export interface ContractInsert {
  partnerId: string;
  projectId: string | null;
  title: string;
  titleAr: string | null;
  scope: string | null;
  feeModel: string;
  startDate: string;
  endDate: string;
  monthlyAmount: string | null;
  currencyCode: string;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}

export async function insertContract(input: ContractInsert): Promise<ContractRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO service_contracts (id, tenant_id, created_by, partner_id, project_id, title,
                                   title_ar, scope, fee_model, start_date, end_date,
                                   monthly_amount, currency_code, status, note, note_ar)
    VALUES (${id}, erp.current_tenant_id(), ${input.actorId}, ${input.partnerId}, ${input.projectId},
            ${input.title}, ${input.titleAr}, ${input.scope}, ${input.feeModel}, ${input.startDate},
            ${input.endDate}, ${input.monthlyAmount}, ${input.currencyCode}, 'DRAFT', ${input.note}, ${input.noteAr})
  `);
  return (await findContractById(id))!;
}

export async function findContractById(id: string): Promise<ContractRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${CONTRACT_COLUMNS} FROM service_contracts WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ContractRow[])[0];
}

export async function listContracts(filter: {
  status?: string;
  partnerId?: string;
  limit: number;
}): Promise<ContractRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${CONTRACT_COLUMNS} FROM service_contracts
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.partnerId ?? null}::uuid IS NULL OR partner_id = ${filter.partnerId ?? null})
    ORDER BY created_at DESC, id
    LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as ContractRow[];
}

/**
 * Field patches on a contract (the service owns every state guard). Absent
 * values leave the column untouched; explicit nulls clear. The status/
 * stamp columns (contractNo, activatedAt, …) ride the same COALESCE shape —
 * each lifecycle step passes exactly what it owns.
 */
export async function patchContract(input: {
  id: string;
  title?: string;
  titleAr?: string | null;
  scope?: string | null;
  projectId?: string | null;
  startDate?: string;
  endDate?: string;
  monthlyAmount?: string | null;
  note?: string | null;
  noteAr?: string | null;
  status?: string;
  contractNo?: string;
  activatedAt?: Date;
  cancelledAt?: Date;
  cancelReason?: string | null;
  renewedToContractId?: string;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE service_contracts SET
      title = COALESCE(${input.title ?? null}, title),
      title_ar = CASE WHEN ${input.titleAr === undefined} THEN title_ar ELSE ${input.titleAr ?? null} END,
      scope = CASE WHEN ${input.scope === undefined} THEN scope ELSE ${input.scope ?? null} END,
      project_id = CASE WHEN ${input.projectId === undefined} THEN project_id ELSE ${input.projectId ?? null} END,
      start_date = COALESCE(${input.startDate ?? null}, start_date),
      end_date = COALESCE(${input.endDate ?? null}, end_date),
      monthly_amount = CASE WHEN ${input.monthlyAmount === undefined} THEN monthly_amount
                            ELSE ${input.monthlyAmount ?? null} END,
      note = CASE WHEN ${input.note === undefined} THEN note ELSE ${input.note ?? null} END,
      note_ar = CASE WHEN ${input.noteAr === undefined} THEN note_ar ELSE ${input.noteAr ?? null} END,
      status = COALESCE(${input.status ?? null}, status),
      contract_no = COALESCE(${input.contractNo ?? null}, contract_no),
      activated_at = COALESCE(${input.activatedAt ?? null}, activated_at),
      cancelled_at = COALESCE(${input.cancelledAt ?? null}, cancelled_at),
      cancel_reason = CASE WHEN ${input.cancelReason === undefined} THEN cancel_reason
                           ELSE ${input.cancelReason ?? null} END,
      renewed_to_contract_id = COALESCE(${input.renewedToContractId ?? null}, renewed_to_contract_id),
      version = version + 1, updated_at = now()
    WHERE id = ${input.id}
  `);
}

// -- contract billing schedule (T46; the §4 expanded grid — additive) -------

export interface ScheduleEntryRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  contractId: string;
  entryType: string;
  periodKey: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  billDate: string;
  amount: string | null;
  feeItemId: string;
  milestoneLabel: string | null;
  milestoneLabelAr: string | null;
  status: string;
  invoiceId: string | null;
}

const SCHEDULE_COLUMNS = sql`id, created_at::text AS "createdAt", updated_at::text AS "updatedAt",
  contract_id AS "contractId", entry_type AS "entryType", period_key AS "periodKey",
  period_start::text AS "periodStart", period_end::text AS "periodEnd", bill_date::text AS "billDate",
  amount, fee_item_id AS "feeItemId", milestone_label AS "milestoneLabel",
  milestone_label_ar AS "milestoneLabelAr", status, invoice_id AS "invoiceId"`;

export interface ScheduleEntryInsert {
  contractId: string;
  entryType: "RETAINER_PERIOD" | "MILESTONE" | "HOURLY_PERIOD";
  periodKey: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  billDate: string;
  amount: string | null;
  feeItemId: string;
  milestoneLabel: string | null;
  milestoneLabelAr: string | null;
}

export async function insertScheduleEntry(input: ScheduleEntryInsert): Promise<ScheduleEntryRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO contract_billing_schedule (id, tenant_id, contract_id, entry_type, period_key,
                                            period_start, period_end, bill_date, amount, fee_item_id,
                                            milestone_label, milestone_label_ar, status)
    VALUES (${id}, erp.current_tenant_id(), ${input.contractId}, ${input.entryType}, ${input.periodKey},
            ${input.periodStart}, ${input.periodEnd}, ${input.billDate}, ${input.amount},
            ${input.feeItemId}, ${input.milestoneLabel}, ${input.milestoneLabelAr}, 'PLANNED')
  `);
  const rows = await tx.execute(sql`
    SELECT ${SCHEDULE_COLUMNS} FROM contract_billing_schedule WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ScheduleEntryRow[])[0]!;
}

export async function findScheduleEntryById(id: string): Promise<ScheduleEntryRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${SCHEDULE_COLUMNS} FROM contract_billing_schedule WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ScheduleEntryRow[])[0];
}

/** The whole grid of one contract, stable order (period/milestone, billDate). */
export async function listScheduleByContract(contractId: string): Promise<ScheduleEntryRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${SCHEDULE_COLUMNS} FROM contract_billing_schedule
    WHERE contract_id = ${contractId}
    ORDER BY entry_type, COALESCE(period_key, milestone_label), bill_date
  `);
  return rows.rows as unknown as ScheduleEntryRow[];
}

/**
 * PLANNED-row patches for the additive reconcile (amounts/windows/fee item
 * moves) + the INVOICED flip the billing run stamps (status + invoiceId).
 * INVOICED rows are never amount-patched (posted history stays).
 */
export async function patchScheduleEntry(input: {
  id: string;
  amount?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  billDate?: string;
  feeItemId?: string;
  milestoneLabelAr?: string | null;
  status?: string;
  invoiceId?: string;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE contract_billing_schedule SET
      amount = CASE WHEN ${input.amount === undefined} THEN amount ELSE ${input.amount ?? null} END,
      period_start = CASE WHEN ${input.periodStart === undefined} THEN period_start
                          ELSE ${input.periodStart ?? null} END,
      period_end = CASE WHEN ${input.periodEnd === undefined} THEN period_end
                        ELSE ${input.periodEnd ?? null} END,
      bill_date = COALESCE(${input.billDate ?? null}, bill_date),
      fee_item_id = COALESCE(${input.feeItemId ?? null}, fee_item_id),
      milestone_label_ar = CASE WHEN ${input.milestoneLabelAr === undefined} THEN milestone_label_ar
                                ELSE ${input.milestoneLabelAr ?? null} END,
      status = COALESCE(${input.status ?? null}, status),
      invoice_id = COALESCE(${input.invoiceId ?? null}, invoice_id),
      version = version + 1, updated_at = now()
    WHERE id = ${input.id}
  `);
}

/**
 * The lesson-1 resolution substrate: the first grid row's fee item — the
 * STORED contract-level default. `entryType` filters (MILESTONES resolves
 * from the first stored MILESTONE row; RETAINER/HOURLY from any grid row).
 */
export async function findScheduleGridFeeItem(
  contractId: string,
  entryType?: "RETAINER_PERIOD" | "MILESTONE" | "HOURLY_PERIOD",
): Promise<string | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT fee_item_id AS "feeItemId" FROM contract_billing_schedule
    WHERE contract_id = ${contractId}
      AND (${entryType ?? null}::text IS NULL OR entry_type = ${entryType ?? null})
    ORDER BY created_at, id
    LIMIT 1
  `);
  return (rows.rows as unknown as { feeItemId: string }[])[0]?.feeItemId;
}

// -- contract invoices (T46 store slice; the T47 billing run is the writer) -

export interface ContractInvoiceRow {
  id: string;
  createdAt: string;
  contractId: string;
  invoiceId: string;
  periodKey: string | null;
  milestoneScheduleId: string | null;
  status: string;
}

const CONTRACT_INVOICE_COLUMNS = sql`id, created_at::text AS "createdAt",
  contract_id AS "contractId", invoice_id AS "invoiceId", period_key AS "periodKey",
  milestone_schedule_id AS "milestoneScheduleId", status`;

/**
 * The idempotency-guard insert: the two partial uniques
 * (tenant, contract, periodKey) / (tenant, contract, milestoneScheduleId)
 * make concurrent double-fire a constraint violation ⇒ the caller skips
 * gracefully (INV-013 discipline; §4).
 */
export async function insertContractInvoice(input: {
  contractId: string;
  invoiceId: string;
  periodKey: string | null;
  milestoneScheduleId: string | null;
  actorId: string | null;
}): Promise<ContractInvoiceRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO contract_invoices (id, tenant_id, created_by, contract_id, invoice_id,
                                   period_key, milestone_schedule_id, status)
    VALUES (${id}, erp.current_tenant_id(), ${input.actorId}, ${input.contractId}, ${input.invoiceId},
            ${input.periodKey}, ${input.milestoneScheduleId}, 'GENERATED')
  `);
  const rows = await tx.execute(sql`
    SELECT ${CONTRACT_INVOICE_COLUMNS} FROM contract_invoices WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ContractInvoiceRow[])[0]!;
}

export async function listContractInvoices(filter: {
  contractId?: string;
  status?: string;
  limit: number;
}): Promise<ContractInvoiceRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${CONTRACT_INVOICE_COLUMNS} FROM contract_invoices
    WHERE (${filter.contractId ?? null}::uuid IS NULL OR contract_id = ${filter.contractId ?? null})
      AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
    ORDER BY created_at DESC, id
    LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as ContractInvoiceRow[];
}

// -- contract advances (T46; on-account receipts tagged to a contract) ------

export interface ContractAdvanceRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  contractId: string;
  receiptId: string;
  amount: string;
  status: string;
  deferJournalId: string | null;
  releasedJournalId: string | null;
  releasedInvoiceId: string | null;
  note: string | null;
  noteAr: string | null;
}

const ADVANCE_COLUMNS = sql`id, created_at::text AS "createdAt", updated_at::text AS "updatedAt",
  contract_id AS "contractId", receipt_id AS "receiptId", amount, status,
  defer_journal_id AS "deferJournalId", released_journal_id AS "releasedJournalId",
  released_invoice_id AS "releasedInvoiceId", note, note_ar AS "noteAr"`;

export async function insertContractAdvance(input: {
  contractId: string;
  receiptId: string;
  amount: string;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<ContractAdvanceRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO contract_advances (id, tenant_id, created_by, contract_id, receipt_id, amount,
                                   status, note, note_ar)
    VALUES (${id}, erp.current_tenant_id(), ${input.actorId}, ${input.contractId}, ${input.receiptId},
            ${input.amount}, 'HELD', ${input.note}, ${input.noteAr})
  `);
  const rows = await tx.execute(sql`
    SELECT ${ADVANCE_COLUMNS} FROM contract_advances WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ContractAdvanceRow[])[0]!;
}

export async function findContractAdvanceById(id: string): Promise<ContractAdvanceRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ADVANCE_COLUMNS} FROM contract_advances WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ContractAdvanceRow[])[0];
}

export async function listContractAdvances(contractId: string): Promise<ContractAdvanceRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ADVANCE_COLUMNS} FROM contract_advances
    WHERE contract_id = ${contractId}
    ORDER BY created_at, id
  `);
  return rows.rows as unknown as ContractAdvanceRow[];
}

/** The duplicate-tag guard's scan slice: HELD advances on one receipt. */
export async function listHeldAdvancesForReceipt(receiptId: string): Promise<ContractAdvanceRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ADVANCE_COLUMNS} FROM contract_advances
    WHERE receipt_id = ${receiptId} AND status = 'HELD'
    ORDER BY created_at, id
  `);
  return rows.rows as unknown as ContractAdvanceRow[];
}

/**
 * Σ tagged advances on a receipt (ALL statuses — a HELD advance holds the
 * on-account credit, a RELEASED one consumed it against an invoice; both
 * reduce what is still taggable). Feeds the unallocated-on-account check.
 */
export async function sumTaggedAdvancesForReceipt(receiptId: string): Promise<string> {
  const rows = await tenantTx().execute(sql`
    SELECT COALESCE(sum(amount), 0)::text AS total FROM contract_advances WHERE receipt_id = ${receiptId}
  `);
  return (rows.rows as unknown as { total: string }[])[0]?.total ?? "0";
}

/**
 * The journal/release stamps: deferJournalId (the J-DEF at tagging, policy
 * ON) + the T47 release stamps (status RELEASED, releasedJournalId,
 * releasedInvoiceId at the releasing invoice's post — §1 row 5).
 */
export async function patchContractAdvance(input: {
  id: string;
  deferJournalId?: string;
  status?: string;
  releasedJournalId?: string;
  releasedInvoiceId?: string;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE contract_advances SET
      defer_journal_id = COALESCE(${input.deferJournalId ?? null}, defer_journal_id),
      status = COALESCE(${input.status ?? null}, status),
      released_journal_id = COALESCE(${input.releasedJournalId ?? null}, released_journal_id),
      released_invoice_id = COALESCE(${input.releasedInvoiceId ?? null}, released_invoice_id),
      version = version + 1, updated_at = now()
    WHERE id = ${input.id}
  `);
}

// -- time entries (T46; timeslips — MASTER-PLAN §6) --------------------------

export interface TimeEntryRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  entryDate: string;
  hours: string;
  feeItemId: string;
  projectId: string | null;
  contractId: string | null;
  feeEarnerUserId: string | null;
  unitRate: string;
  narrative: string | null;
  billable: boolean;
  status: string;
  billedInvoiceId: string | null;
}

const TIME_ENTRY_COLUMNS = sql`id, created_at::text AS "createdAt", updated_at::text AS "updatedAt",
  created_by AS "createdBy", entry_date::text AS "entryDate", hours, fee_item_id AS "feeItemId",
  project_id AS "projectId", contract_id AS "contractId", fee_earner_user_id AS "feeEarnerUserId",
  unit_rate AS "unitRate", narrative, billable, status, billed_invoice_id AS "billedInvoiceId"`;

export interface TimeEntryInsert {
  entryDate: string;
  hours: string;
  feeItemId: string;
  projectId: string | null;
  contractId: string | null;
  feeEarnerUserId: string | null;
  unitRate: string;
  narrative: string | null;
  billable: boolean;
  actorId: string | null;
}

export async function insertTimeEntry(input: TimeEntryInsert): Promise<TimeEntryRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO crm_time_entries (id, tenant_id, created_by, entry_date, hours, fee_item_id,
                                  project_id, contract_id, fee_earner_user_id, unit_rate,
                                  narrative, billable, status)
    VALUES (${id}, erp.current_tenant_id(), ${input.actorId}, ${input.entryDate}, ${input.hours},
            ${input.feeItemId}, ${input.projectId}, ${input.contractId}, ${input.feeEarnerUserId},
            ${input.unitRate}, ${input.narrative}, ${input.billable}, 'DRAFT')
  `);
  const rows = await tx.execute(sql`
    SELECT ${TIME_ENTRY_COLUMNS} FROM crm_time_entries WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as TimeEntryRow[])[0]!;
}

export async function findTimeEntryById(id: string): Promise<TimeEntryRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TIME_ENTRY_COLUMNS} FROM crm_time_entries WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as TimeEntryRow[])[0];
}

export async function listTimeEntries(filter: {
  fromDate?: string;
  toDate?: string;
  projectId?: string;
  contractId?: string;
  feeEarnerUserId?: string;
  limit: number;
}): Promise<TimeEntryRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TIME_ENTRY_COLUMNS} FROM crm_time_entries
    WHERE (${filter.fromDate ?? null}::date IS NULL OR entry_date >= ${filter.fromDate ?? null})
      AND (${filter.toDate ?? null}::date IS NULL OR entry_date <= ${filter.toDate ?? null})
      AND (${filter.projectId ?? null}::uuid IS NULL OR project_id = ${filter.projectId ?? null})
      AND (${filter.contractId ?? null}::uuid IS NULL OR contract_id = ${filter.contractId ?? null})
      AND (${filter.feeEarnerUserId ?? null}::uuid IS NULL OR fee_earner_user_id = ${filter.feeEarnerUserId ?? null})
    ORDER BY entry_date DESC, created_at DESC, id
    LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as TimeEntryRow[];
}

/** Field patches while DRAFT (the service owns the state guard). */
export async function patchTimeEntry(input: {
  id: string;
  entryDate?: string;
  hours?: string;
  feeItemId?: string;
  projectId?: string | null;
  contractId?: string | null;
  feeEarnerUserId?: string | null;
  unitRate?: string;
  narrative?: string | null;
  billable?: boolean;
  status?: string;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE crm_time_entries SET
      entry_date = COALESCE(${input.entryDate ?? null}, entry_date),
      hours = COALESCE(${input.hours ?? null}, hours),
      fee_item_id = COALESCE(${input.feeItemId ?? null}, fee_item_id),
      project_id = CASE WHEN ${input.projectId === undefined} THEN project_id ELSE ${input.projectId ?? null} END,
      contract_id = CASE WHEN ${input.contractId === undefined} THEN contract_id ELSE ${input.contractId ?? null} END,
      fee_earner_user_id = CASE WHEN ${input.feeEarnerUserId === undefined} THEN fee_earner_user_id
                                ELSE ${input.feeEarnerUserId ?? null} END,
      unit_rate = COALESCE(${input.unitRate ?? null}, unit_rate),
      narrative = CASE WHEN ${input.narrative === undefined} THEN narrative ELSE ${input.narrative ?? null} END,
      billable = CASE WHEN ${input.billable === undefined} THEN billable ELSE ${input.billable ?? null} END,
      status = COALESCE(${input.status ?? null}, status),
      version = version + 1, updated_at = now()
    WHERE id = ${input.id}
  `);
}

/**
 * The weekly review flip: the week's DRAFT entries → APPROVED in one
 * UPDATE; returns the flipped ids (0 rows ⇒ the caller raises
 * TIMESHEET_EMPTY). The ids anchor the batch audit event (entity_id is a
 * NOT NULL uuid — the reservations-swept precedent).
 */
export async function approveWeekTimeEntries(weekStart: string, weekEnd: string): Promise<string[]> {
  const rows = await tenantTx().execute(sql`
    UPDATE crm_time_entries SET status = 'APPROVED', version = version + 1, updated_at = now()
    WHERE status = 'DRAFT' AND entry_date >= ${weekStart} AND entry_date <= ${weekEnd}
    RETURNING id
  `);
  return (rows.rows as unknown as { id: string }[]).map((row) => row.id);
}

/**
 * The billing-pull substrate (§5 + §6): APPROVED, not yet billed, billable,
 * linked to the contract, entryDate within the period window — the exact
 * set the billing run pulls (mirrors ix_crm_time_entries_pullable).
 */
export async function listPullableTimeEntries(input: {
  contractId: string;
  fromDate: string;
  toDate: string;
}): Promise<TimeEntryRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TIME_ENTRY_COLUMNS} FROM crm_time_entries
    WHERE contract_id = ${input.contractId}
      AND status = 'APPROVED'
      AND billed_invoice_id IS NULL
      AND billable = true
      AND entry_date >= ${input.fromDate}
      AND entry_date <= ${input.toDate}
    ORDER BY entry_date, created_at, id
  `);
  return rows.rows as unknown as TimeEntryRow[];
}

// -- cross-module reads for the T46 slice (§6 sanctioned read-only probes) --

/**
 * The receipt probe for advance tagging — a READ-ONLY replica of the
 * treasury on-account read (AllocationService.onAccountRemainder computes
 * `amount − allocated_amount` over store.findReceiptById; the sales
 * realloc service reads the same row). Kept local so crm never imports
 * another module's store (the findPartnerForCrm precedent); the SERVICE
 * layer subtracts already-tagged advances on top.
 */
export interface ReceiptProbeRow {
  id: string;
  status: string;
  partnerId: string;
  currencyCode: string;
  amount: string;
  allocatedAmount: string;
  valueDate: string;
}

export async function findReceiptForCrm(id: string): Promise<ReceiptProbeRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, status, partner_id AS "partnerId", currency_code AS "currencyCode",
           amount, allocated_amount AS "allocatedAmount", value_date::text AS "valueDate"
    FROM receipts WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ReceiptProbeRow[])[0];
}

/**
 * The fee-item probe for the SERVICE-kind mirror (the job-card LABOR
 * validation reads items.kind; replicated read-only here — §6 precedent).
 * T48 appended `status` (the job-card ACTIVE gate needs it — additive).
 */
export interface ItemProbeRow {
  id: string;
  sku: string;
  kind: string;
  status: string;
  deletedAt: string | null;
}

export async function findItemForCrm(id: string): Promise<ItemProbeRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, sku, kind, status, deleted_at::text AS "deletedAt" FROM items WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ItemProbeRow[])[0];
}

// -- T47 slice (billing runs + the deferral release — MASTER-PLAN §5 + §1 row 5) -
//
// Read-only probes (the §6 sanctioned precedent — crm never imports another
// module's store) + the two sanctioned writes the release owns by design:
// the receipt→invoice treasury allocation (the replacePostedReceiptAllocations
// mirror — §1 row 5 "the advance application") and the time-entry BILLED
// stamps. Lesson 3 compliance: findInvoiceArOpenItem mirrors the REAL
// partner_subledger_entries schema + the arOpenItemsAsOf open-item shape
// (verified against 0011 DDL + the PartnerSubledgerService writer).

/** The run's branch resolution (the sales-fixture MAIN convention): the
 * MAIN-coded branch, else the tenant's earliest branch. */
export async function findMainBranchForCrm(): Promise<{ id: string; code: string } | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, code FROM branches
    WHERE is_active = true
    ORDER BY (code = 'MAIN') DESC, created_at, id
    LIMIT 1
  `);
  return (rows.rows as unknown as { id: string; code: string }[])[0];
}

/** The fee item's stored tax code (the job-card line pattern — the source
 * row's tax code rides the generated invoice line; §15's 15% golden). */
export async function findItemTaxCodeForCrm(id: string): Promise<string | null | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT tax_code_id AS "taxCodeId" FROM items WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as { taxCodeId: string | null }[])[0]?.taxCodeId;
}

/** The sales-invoice read the release needs (gross + the posting posture). */
export interface InvoiceProbeRow {
  id: string;
  status: string;
  customerId: string;
  contractId: string | null;
  projectId: string | null;
  invoiceDate: string;
  currencyCode: string;
  totalGross: string;
}

export async function findInvoiceForCrm(id: string): Promise<InvoiceProbeRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, status, customer_id AS "customerId", contract_id AS "contractId",
           project_id AS "projectId", invoice_date::text AS "invoiceDate",
           currency_code AS "currencyCode", total_gross::text AS "totalGross"
    FROM sales_invoices WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as InvoiceProbeRow[])[0];
}

/**
 * The posted CREDIT invoice's AR open item (§18 lesson 3 — verified against
 * the 0011 DDL + the posting-service writer): the partner-carrying DEBIT
 * subledger row of the `sales_invoice:post` journal on the ACTIVE
 * AR_CONTROL account, with its allocation-settled amount and outstanding
 * (the arOpenItemsAsOf settled lateral, mirrored). Exactly one row exists
 * per posted CREDIT invoice (the single G-01 DR leg).
 */
export interface InvoiceArOpenItemRow {
  id: string;
  partnerId: string;
  entryDate: string;
  amount: string;
  settledAmount: string;
  outstanding: string;
}

export async function findInvoiceArOpenItem(invoiceId: string): Promise<InvoiceArOpenItemRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT s.id, s.partner_id AS "partnerId", s.entry_date::text AS "entryDate",
           s.amount::text AS amount,
           COALESCE(settled.total, 0)::numeric(19,4)::text AS "settledAmount",
           (s.amount - COALESCE(settled.total, 0))::numeric(19,4)::text AS outstanding
    FROM partner_subledger_entries s
    JOIN journal_lines l ON l.id = s.journal_line_id
    LEFT JOIN LATERAL (
      SELECT SUM(a.amount) AS total FROM treasury_allocations a
      WHERE a.open_item_id = s.id
        AND a.receipt_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM receipts r WHERE r.id = a.receipt_id AND r.status = 'POSTED')
    ) settled ON true
    WHERE s.source_type = 'sales_invoice'
      AND s.source_id = ${invoiceId}
      AND s.direction = 'DEBIT'
      AND l.account_id = (SELECT account_id FROM account_purposes
                          WHERE purpose_key = 'AR_CONTROL' AND active_to IS NULL LIMIT 1)
    ORDER BY s.created_at, s.id
    LIMIT 1
  `);
  return (rows.rows as unknown as InvoiceArOpenItemRow[])[0];
}

/**
 * The receipt→invoice allocation write (§1 row 5 — "the advance
 * application"): the replacePostedReceiptAllocations mirror, AGGREGATING on
 * (receipt, open item) — the partial unique uq_treasury_allocations_receipt_
 * item makes the pair singular, so a repeat release against the same
 * (receipt, invoice) adds onto the stored row. The receipt's denormalized
 * allocated_amount is recomputed exactly (Σ rows) so the ar.allocations tie
 * (Σ allocations == Σ receipts.allocated_amount) holds by construction.
 */
export async function upsertReceiptAllocation(input: {
  receiptId: string;
  openItemId: string;
  addAmount: string;
  actorId: string | null;
}): Promise<void> {
  const tx = tenantTx();
  const existing = await tx.execute(sql`
    SELECT id, amount::text AS amount FROM treasury_allocations
    WHERE receipt_id = ${input.receiptId} AND open_item_id = ${input.openItemId}
    LIMIT 1
  `);
  const prior = (existing.rows as unknown as { id: string; amount: string }[])[0];
  if (prior === undefined) {
    await tx.execute(sql`
      INSERT INTO treasury_allocations (id, tenant_id, receipt_id, payment_id, open_item_id, amount, created_by)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.receiptId}, NULL,
              ${input.openItemId}, ${input.addAmount}, ${input.actorId})
    `);
  } else {
    await tx.execute(sql`
      UPDATE treasury_allocations SET amount = amount + ${input.addAmount}
      WHERE id = ${prior.id}
    `);
  }
  // The exact recompute (the replacePostedReceiptAllocations tail, verbatim).
  await tx.execute(sql`
    UPDATE receipts SET allocated_amount = COALESCE((
      SELECT SUM(amount) FROM treasury_allocations WHERE receipt_id = ${input.receiptId}
    ), 0), updated_at = now()
    WHERE id = ${input.receiptId}
  `);
}

/** The HOURLY run's pulled-entry stamps: status BILLED + the invoice link
 * (§6 — only APPROVED-unbilled entries were pulled, so the flip is exact). */
export async function markTimeEntryBilled(input: {
  id: string;
  billedInvoiceId: string;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE crm_time_entries
    SET status = 'BILLED', billed_invoice_id = ${input.billedInvoiceId},
        version = version + 1, updated_at = now()
    WHERE id = ${input.id}
  `);
}

// -- service orders (T48; MASTER-PLAN §7 — the job-card generalization) -----
//
// The job-cards.store shape mirrored onto the 0027 DDL (read the exact
// column names there — binding): service_orders has NO invoice_id column
// (the linkage is inverted — sales_invoices.service_order_id carries the
// provenance) and NO labor_hours_total (logged hours live on the lines);
// service_order_lines has NO discount/tax columns (invoice lines resolve
// their tax code from the ITEM row — the T47 billing-run precedent) and
// tombstones are VOID (0027's status set), not CANCELLED. Every statement
// runs in the caller's ambient tenant UoW (INV-018); stock/journal rows
// are NEVER written here (MODULE_BOUNDARIES) — the service only links ids.

export interface ServiceOrderRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  branchId: string;
  orderNo: string | null;
  partnerId: string;
  contractId: string | null;
  warehouseId: string;
  status: string;
  note: string | null;
  noteAr: string | null;
  cancelReason: string | null;
  approvedAt: string | null;
  completedAt: string | null;
  invoicedAt: string | null;
  cancelledAt: string | null;
}

const SERVICE_ORDER_COLUMNS = sql`id, created_at::text AS "createdAt", updated_at::text AS "updatedAt",
  created_by AS "createdBy", branch_id AS "branchId", order_no AS "orderNo", partner_id AS "partnerId",
  contract_id AS "contractId", warehouse_id AS "warehouseId", status, note, note_ar AS "noteAr",
  cancel_reason AS "cancelReason", approved_at::text AS "approvedAt", completed_at::text AS "completedAt",
  invoiced_at::text AS "invoicedAt", cancelled_at::text AS "cancelledAt"`;

/** A line as the store persists it (the service normalizes decimals first). */
export interface ServiceOrderLineInsert {
  /** Preserved id on a DRAFT full-replace (PUT); omitted → generated. */
  id?: string | null;
  orderId: string;
  lineNo: number;
  lineType: string;
  itemId: string;
  description: string | null;
  descriptionAr: string | null;
  /** SERVICE only (the billed quantity); NULL for PARTS lines. */
  estimatedHours: string | null;
  unitPrice: string;
  /** PARTS: the parts quantity. SERVICE: 1 (the line count — billing rides
   * estimatedHours, the job-card LABOR convention). */
  qty: string;
  loggedHours?: string;
  status?: string;
  reservationId?: string | null;
  issueUnitCost?: string | null;
  issueValue?: string | null;
  issueJournalId?: string | null;
  invoiceLineId?: string | null;
  note: string | null;
  createdBy: string | null;
}

export async function insertServiceOrder(input: {
  branchId: string;
  orderNo: string | null;
  partnerId: string;
  contractId: string | null;
  warehouseId: string;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
  lines: readonly Omit<ServiceOrderLineInsert, "orderId" | "lineNo" | "createdBy">[];
}): Promise<ServiceOrderRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO service_orders (id, tenant_id, created_by, branch_id, order_no, partner_id,
                                contract_id, warehouse_id, status, note, note_ar)
    VALUES (${id}, erp.current_tenant_id(), ${input.actorId}, ${input.branchId}, ${input.orderNo},
            ${input.partnerId}, ${input.contractId}, ${input.warehouseId}, 'DRAFT', ${input.note}, ${input.noteAr})
  `);
  let lineNo = 0;
  for (const line of input.lines) {
    lineNo += 1;
    await insertServiceOrderLine({ ...line, orderId: id, lineNo, createdBy: input.actorId });
  }
  return (await findServiceOrderById(id))!;
}

export async function findServiceOrderById(id: string): Promise<ServiceOrderRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${SERVICE_ORDER_COLUMNS} FROM service_orders WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ServiceOrderRow[])[0];
}

export async function listServiceOrders(filter: {
  status?: string;
  contractId?: string;
  limit: number;
}): Promise<ServiceOrderRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${SERVICE_ORDER_COLUMNS} FROM service_orders
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.contractId ?? null}::uuid IS NULL OR contract_id = ${filter.contractId ?? null})
    ORDER BY created_at DESC, id
    LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as ServiceOrderRow[];
}

/**
 * The single order mutation point. Absent values leave the column untouched
 * (COALESCE semantics); the state timestamps stamp via CASE on the target
 * status exactly once, with the transition (the patchJobCard shape). The
 * cancel reason rides the dedicated cancel_reason column (0027 gave the
 * SO table what job cards emulated on note).
 */
export async function patchServiceOrder(input: {
  id: string;
  status?: string;
  note?: string | null;
  noteAr?: string | null;
  cancelReason?: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE service_orders SET
      status = COALESCE(${input.status ?? null}, status),
      note = COALESCE(${input.note ?? null}, note),
      note_ar = COALESCE(${input.noteAr ?? null}, note_ar),
      cancel_reason = COALESCE(${input.cancelReason ?? null}, cancel_reason),
      approved_at = CASE WHEN ${input.status ?? null} = 'IN_PROGRESS' THEN now() ELSE approved_at END,
      completed_at = CASE WHEN ${input.status ?? null} = 'COMPLETED' THEN now() ELSE completed_at END,
      invoiced_at = CASE WHEN ${input.status ?? null} = 'INVOICED' THEN now() ELSE invoiced_at END,
      cancelled_at = CASE WHEN ${input.status ?? null} = 'CANCELLED' THEN now() ELSE cancelled_at END,
      version = version + 1, updated_at = now()
    WHERE id = ${input.id}
  `);
}

export interface ServiceOrderLineRow {
  id: string;
  orderId: string;
  lineNo: number;
  lineType: string;
  itemId: string;
  description: string | null;
  descriptionAr: string | null;
  estimatedHours: string | null;
  unitPrice: string;
  qty: string;
  loggedHours: string;
  status: string;
  reservationId: string | null;
  issueUnitCost: string | null;
  issueValue: string | null;
  issueJournalId: string | null;
  invoiceLineId: string | null;
  note: string | null;
  createdBy: string | null;
}

const SERVICE_ORDER_LINE_COLUMNS = sql`id, order_id AS "orderId", line_no AS "lineNo",
  line_type AS "lineType", item_id AS "itemId", description, description_ar AS "descriptionAr",
  estimated_hours::text AS "estimatedHours", unit_price::text AS "unitPrice",
  qty::text AS qty, logged_hours::text AS "loggedHours", status,
  reservation_id AS "reservationId", issue_unit_cost::text AS "issueUnitCost",
  issue_value::text AS "issueValue", issue_journal_id AS "issueJournalId",
  invoice_line_id AS "invoiceLineId", note, created_by AS "createdBy"`;

export async function insertServiceOrderLine(line: ServiceOrderLineInsert): Promise<void> {
  await tenantTx().execute(sql`
    INSERT INTO service_order_lines (id, tenant_id, order_id, line_no, line_type, item_id,
                                     description, description_ar, estimated_hours, unit_price,
                                     qty, logged_hours, status, reservation_id, issue_unit_cost,
                                     issue_value, issue_journal_id, invoice_line_id, note, created_by)
    VALUES (${line.id ?? generateUuidV7()}, erp.current_tenant_id(), ${line.orderId}, ${line.lineNo},
            ${line.lineType}, ${line.itemId}, ${line.description}, ${line.descriptionAr},
            ${line.estimatedHours}, ${line.unitPrice}, ${line.qty}, ${line.loggedHours ?? "0"},
            ${line.status ?? "PENDING"}, ${line.reservationId ?? null}, ${line.issueUnitCost ?? null},
            ${line.issueValue ?? null}, ${line.issueJournalId ?? null}, ${line.invoiceLineId ?? null},
            ${line.note}, ${line.createdBy})
  `);
}

export async function listServiceOrderLines(orderId: string): Promise<ServiceOrderLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${SERVICE_ORDER_LINE_COLUMNS} FROM service_order_lines
    WHERE order_id = ${orderId} ORDER BY line_no
  `);
  return rows.rows as unknown as ServiceOrderLineRow[];
}

export async function findServiceOrderLineById(id: string): Promise<ServiceOrderLineRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${SERVICE_ORDER_LINE_COLUMNS} FROM service_order_lines WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ServiceOrderLineRow[])[0];
}

/**
 * The single line mutation point: lifecycle status, the reservation link
 * (approve under `reserve`), the issue linkage (`issue_immediate`), the
 * invoice-line link (the port's positional mapping), logged hours, and the
 * DRAFT full-replace field updates. Absent fields leave the column
 * untouched (COALESCE semantics).
 */
export async function patchServiceOrderLine(input: {
  id: string;
  lineNo?: number;
  status?: string;
  reservationId?: string | null;
  issueUnitCost?: string | null;
  issueValue?: string | null;
  issueJournalId?: string | null;
  invoiceLineId?: string | null;
  loggedHours?: string;
  qty?: string;
  unitPrice?: string;
  estimatedHours?: string | null;
  description?: string | null;
  descriptionAr?: string | null;
  note?: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE service_order_lines SET
      line_no = COALESCE(${input.lineNo ?? null}, line_no),
      status = COALESCE(${input.status ?? null}, status),
      reservation_id = COALESCE(${input.reservationId ?? null}, reservation_id),
      issue_unit_cost = COALESCE(${input.issueUnitCost ?? null}, issue_unit_cost),
      issue_value = COALESCE(${input.issueValue ?? null}, issue_value),
      issue_journal_id = COALESCE(${input.issueJournalId ?? null}, issue_journal_id),
      invoice_line_id = COALESCE(${input.invoiceLineId ?? null}, invoice_line_id),
      logged_hours = COALESCE(${input.loggedHours ?? null}, logged_hours),
      qty = COALESCE(${input.qty ?? null}, qty),
      unit_price = COALESCE(${input.unitPrice ?? null}, unit_price),
      estimated_hours = COALESCE(${input.estimatedHours ?? null}, estimated_hours),
      description = COALESCE(${input.description ?? null}, description),
      description_ar = COALESCE(${input.descriptionAr ?? null}, description_ar),
      note = COALESCE(${input.note ?? null}, note),
      version = version + 1, updated_at = now()
    WHERE id = ${input.id}
  `);
}

/**
 * DRAFT full-replace (PUT :id): the job-card replaceJobCardLines shape —
 * the provided array IS the live line set; lines carrying an `id` keep that
 * row id and are patched in place at their input position; lines without
 * ids insert; OLD lines not mentioned are tombstoned `status = 'VOID'`
 * (0027's tombstone value — job cards' CANCELLED), never deleted (no
 * DELETE grant). Renumbering runs through the negation park so the unique
 * (tenant, order, line_no) index never collides while rows move.
 */
export async function replaceServiceOrderLines(
  orderId: string,
  lines: readonly Omit<ServiceOrderLineInsert, "orderId" | "lineNo">[],
): Promise<void> {
  const tx = tenantTx();
  await tx.execute(sql`
    UPDATE service_order_lines SET line_no = -line_no, version = version + 1, updated_at = now()
    WHERE order_id = ${orderId}
  `);
  const keepIds = new Set<string>();
  for (const line of lines) {
    if (line.id !== null && line.id !== undefined) keepIds.add(line.id);
  }
  const existing = await listServiceOrderLines(orderId);
  for (const row of existing) {
    if (row.status !== "VOID" && !keepIds.has(row.id)) {
      await patchServiceOrderLine({ id: row.id, status: "VOID" });
    }
  }
  let lineNo = 0;
  for (const line of lines) {
    lineNo += 1;
    if (line.id !== null && line.id !== undefined) {
      await patchServiceOrderLine({
        id: line.id,
        lineNo,
        status: line.status ?? "PENDING",
        qty: line.qty,
        unitPrice: line.unitPrice,
        estimatedHours: line.estimatedHours,
        description: line.description,
        descriptionAr: line.descriptionAr,
        note: line.note,
      });
    } else {
      await insertServiceOrderLine({ ...line, orderId, lineNo });
    }
  }
}
