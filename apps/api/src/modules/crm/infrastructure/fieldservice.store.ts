import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-048 (W-12 — T-13) — the field-service store: the ONLY writer for
 * the 0103 family's `service_visits` rows (the projects.store/
 * contracting.store precedent: one store per family). All reads run
 * under the ambient tenant UoW (RLS); the technicians' read on
 * `employees` follows the crm.store foreign-read precedent (partners/
 * items) — a guarded SELECT, never a payroll write.
 *
 * THE WRITE SHAPES:
 *
 * - THE STATUS MACHINE is ONE CAS UPDATE per move — `casVisitStatus`
 *   writes `WHERE id AND status = ${from}` with the 0103 stamp floors
 *   landed by the same statement (dispatched_at / started_at +
 *   first_responded_at catch-up / completed_at + is_paused release /
 *   closed_at — zero rows = the raced/stale move, the typed refusal
 *   upstream). The 0103 CHECKs are the structural floor beneath.
 * - THE SCHEDULING writes (schedule/reschedule) are guarded by the
 *   service's NEW/SCHEDULED law; the store's patch is plain but only
 *   ever reaches pre-dispatch rows (the service's own gate).
 * - THE PAUSE FLIP is a guarded patch on the in-progress plane (the
 *   0103 CHECK gates is_paused to IN_PROGRESS); the pause HISTORY rides
 *   the append-only audit trail (`crm.service_visit.paused` /
 *   `.resumed` — the clock service's raw input, the manufacturing
 *   operation precedent), never a table of our own.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("fieldservice-plane access requires an ambient tenant scope");
  }
  return context.tx;
}

// ── the row shapes ─────────────────────────────────────────────────────────

export interface ServiceVisitRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  serviceOrderId: string;
  technicianEmployeeId: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  status: string;
  dispatchedAt: string | null;
  firstRespondedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
  isPaused: boolean;
  completionNotes: string | null;
  completionNotesAr: string | null;
  note: string | null;
  noteAr: string | null;
  version: number;
}

export interface TechnicianRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  status: string;
  terminationDate: string | null;
}

const VISIT_COLUMNS = sql`id, created_at::text AS "createdAt", updated_at::text AS "updatedAt",
  created_by AS "createdBy", updated_by AS "updatedBy", service_order_id AS "serviceOrderId",
  technician_employee_id AS "technicianEmployeeId", scheduled_start::text AS "scheduledStart",
  scheduled_end::text AS "scheduledEnd", status, dispatched_at::text AS "dispatchedAt",
  first_responded_at::text AS "firstRespondedAt", started_at::text AS "startedAt",
  completed_at::text AS "completedAt", closed_at::text AS "closedAt", is_paused AS "isPaused",
  completion_notes AS "completionNotes", completion_notes_ar AS "completionNotesAr",
  note, note_ar AS "noteAr", version`;

// ── the reads ──────────────────────────────────────────────────────────────

export async function findServiceVisitById(id: string): Promise<ServiceVisitRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${VISIT_COLUMNS} FROM service_visits WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ServiceVisitRow[])[0];
}

export async function listServiceVisits(filter: {
  serviceOrderId?: string;
  technicianEmployeeId?: string;
  status?: string;
  limit: number;
}): Promise<ServiceVisitRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${VISIT_COLUMNS} FROM service_visits
    WHERE (${filter.serviceOrderId ?? null}::uuid IS NULL OR service_order_id = ${filter.serviceOrderId ?? null})
      AND (${filter.technicianEmployeeId ?? null}::uuid IS NULL OR technician_employee_id = ${filter.technicianEmployeeId ?? null})
      AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
    ORDER BY scheduled_start ASC, id ASC
    LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as ServiceVisitRow[];
}

/** The technician read (the crm.store partners/items precedent — a
 * guarded SELECT on the employees table, never a payroll write). */
export async function findTechnicianForFieldservice(
  employeeId: string,
): Promise<TechnicianRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, code, name, name_ar AS "nameAr", status, termination_date::text AS "terminationDate"
    FROM employees WHERE id = ${employeeId} LIMIT 1
  `);
  return (rows.rows as unknown as TechnicianRow[])[0];
}

// ── the writes ─────────────────────────────────────────────────────────────

export async function insertServiceVisit(input: {
  serviceOrderId: string;
  technicianEmployeeId: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<ServiceVisitRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO service_visits (id, tenant_id, created_by, service_order_id,
                                technician_employee_id, scheduled_start, scheduled_end,
                                status, note, note_ar)
    VALUES (${id}, erp.current_tenant_id(), ${input.actorId}, ${input.serviceOrderId},
            ${input.technicianEmployeeId}, ${input.scheduledStart}, ${input.scheduledEnd},
            'NEW', ${input.note}, ${input.noteAr})
  `);
  return (await findServiceVisitById(id))!;
}

/**
 * The SCHEDULE move (NEW → SCHEDULED) + the pre-dispatch reschedule: the
 * window (and an optional technician) land in ONE guarded statement on a
 * row still sitting in NEW/SCHEDULED. Zero rows = the row moved on (the
 * service's typed state refusal upstream).
 */
export async function scheduleServiceVisit(input: {
  id: string;
  toScheduled: boolean;
  technicianEmployeeId: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  actorId: string | null;
}): Promise<ServiceVisitRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE service_visits SET
      status = CASE WHEN ${input.toScheduled} THEN 'SCHEDULED' ELSE status END,
      technician_employee_id = ${input.technicianEmployeeId},
      scheduled_start = ${input.scheduledStart},
      scheduled_end = ${input.scheduledEnd},
      version = version + 1, updated_at = now(), updated_by = ${input.actorId}
    WHERE id = ${input.id} AND status IN ('NEW', 'SCHEDULED')
    RETURNING id
  `);
  if (rows.rows.length === 0) return undefined;
  return findServiceVisitById(input.id);
}

/**
 * THE MACHINE'S CAS LADDER — one UPDATE per move with the 0103 stamp
 * floors in the same statement:
 *   DISPATCHED  stamps dispatched_at (and may set the technician).
 *   IN_PROGRESS stamps started_at AND first_responded_at when still NULL
 *               (the catch-up law: starting the work IS a response).
 *   COMPLETED   stamps completed_at, releases is_paused (the 0103 CHECK
 *               gates the flag to IN_PROGRESS) and lands the notes.
 *   CLOSED      stamps closed_at (terminal).
 */
export async function casVisitStatus(input: {
  id: string;
  from: string;
  to: string;
  actorId: string | null;
  technicianEmployeeId?: string | null;
  completionNotes?: string | null;
  completionNotesAr?: string | null;
}): Promise<ServiceVisitRow | undefined> {
  const toDispatched = input.to === "DISPATCHED";
  const toInProgress = input.to === "IN_PROGRESS";
  const toCompleted = input.to === "COMPLETED";
  const toClosed = input.to === "CLOSED";
  const rows = await tenantTx().execute(sql`
    UPDATE service_visits SET
      status = ${input.to},
      dispatched_at = CASE WHEN ${toDispatched} THEN now() ELSE dispatched_at END,
      technician_employee_id = CASE WHEN ${toDispatched} AND ${input.technicianEmployeeId !== undefined}
                               THEN ${input.technicianEmployeeId ?? null}
                               ELSE technician_employee_id END,
      started_at = CASE WHEN ${toInProgress} THEN now() ELSE started_at END,
      first_responded_at = CASE WHEN ${toInProgress} AND first_responded_at IS NULL
                            THEN now() ELSE first_responded_at END,
      completed_at = CASE WHEN ${toCompleted} THEN now() ELSE completed_at END,
      is_paused = CASE WHEN ${toCompleted} THEN false ELSE is_paused END,
      completion_notes = CASE WHEN ${toCompleted} THEN ${input.completionNotes ?? null}
                              ELSE completion_notes END,
      completion_notes_ar = CASE WHEN ${toCompleted} THEN ${input.completionNotesAr ?? null}
                                 ELSE completion_notes_ar END,
      closed_at = CASE WHEN ${toClosed} THEN now() ELSE closed_at END,
      version = version + 1, updated_at = now(), updated_by = ${input.actorId}
    WHERE id = ${input.id} AND status = ${input.from}
    RETURNING id
  `);
  if (rows.rows.length === 0) return undefined;
  return findServiceVisitById(input.id);
}

/** The SLA response event's stamp — idempotent by COALESCE (the service
 * short-circuits an already-responded visit before ever calling). */
export async function stampFirstResponse(input: {
  id: string;
  actorId: string | null;
}): Promise<ServiceVisitRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE service_visits SET
      first_responded_at = COALESCE(first_responded_at, now()),
      version = version + 1, updated_at = now(), updated_by = ${input.actorId}
    WHERE id = ${input.id}
    RETURNING id
  `);
  if (rows.rows.length === 0) return undefined;
  return findServiceVisitById(input.id);
}

/** The pause flip — the in-progress plane only (the 0103 CHECK's own
 * gate; the service checks the state first for the typed refusal). */
export async function setVisitPaused(input: {
  id: string;
  paused: boolean;
  actorId: string | null;
}): Promise<ServiceVisitRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE service_visits SET
      is_paused = ${input.paused},
      version = version + 1, updated_at = now(), updated_by = ${input.actorId}
    WHERE id = ${input.id} AND status = 'IN_PROGRESS'
    RETURNING id
  `);
  if (rows.rows.length === 0) return undefined;
  return findServiceVisitById(input.id);
}
