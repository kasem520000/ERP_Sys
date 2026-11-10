import { and, desc, eq, sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import * as schema from "../../../db/schema";
import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * Vehicle registry data access (PHASE-017 §2 item 3; DEPENDENCY_RULES §1
 * infrastructure layer): pure storage inside the ambient tenant
 * transaction, no business rules. RLS confines every statement to the
 * caller's tenant (A1–A10 green).
 *
 * `findVehicleServiceHistory` is a documented MODULE_BOUNDARIES read
 * precedent: it SELECTs sales-owned `job_cards` / `sales_invoices` /
 * `credit_notes` (read-only, via the same tenant transaction + RLS) to
 * build the per-vehicle timeline — exactly how sales.store reads
 * partners-owned tables (`findCustomerById`). Zero cross-module writes:
 * partners never inserts/updates sales rows and vice versa.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("vehicles access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- vehicles ----------------------------------------------------------------

export interface VehicleRow {
  id: string;
  tenantId: string;
  createdBy: string | null;
  partnerId: string;
  make: string;
  model: string;
  modelYear: number | null;
  chassisNo: string | null;
  plateNo: string | null;
  color: string | null;
  engineNo: string | null;
  odometerKm: string | null;
  odometerAt: string | null;
  status: string;
  note: string | null;
  noteAr: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface VehicleListFilter {
  partnerId?: string;
  q?: string;
  status?: string;
}

const VEHICLE_COLUMNS = {
  id: schema.vehicles.id,
  tenantId: schema.vehicles.tenantId,
  createdBy: schema.vehicles.createdBy,
  partnerId: schema.vehicles.partnerId,
  make: schema.vehicles.make,
  model: schema.vehicles.model,
  modelYear: schema.vehicles.modelYear,
  chassisNo: schema.vehicles.chassisNo,
  plateNo: schema.vehicles.plateNo,
  color: schema.vehicles.color,
  engineNo: schema.vehicles.engineNo,
  odometerKm: schema.vehicles.odometerKm,
  odometerAt: schema.vehicles.odometerAt,
  status: schema.vehicles.status,
  note: schema.vehicles.note,
  noteAr: schema.vehicles.noteAr,
  createdAt: schema.vehicles.createdAt,
  updatedAt: schema.vehicles.updatedAt,
  version: schema.vehicles.version,
} as const;

export interface VehicleInsertInput {
  partnerId: string;
  make: string;
  model: string;
  modelYear: number | null;
  chassisNo: string | null;
  plateNo: string | null;
  color: string | null;
  engineNo: string | null;
  odometerKm: string | null;
  odometerAt: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
}

/**
 * Insert; chassis uniqueness is the caller's pre-check + the
 * `uq_vehicles_tenant_chassis` 23505 race backstop (the service maps both).
 */
export async function insertVehicle(input: VehicleInsertInput): Promise<VehicleRow> {
  const tx = tenantTx();
  const rows = await tx
    .insert(schema.vehicles)
    .values({
      id: generateUuidV7(),
      ...input,
      tenantId: sql`erp.current_tenant_id()`,
      updatedAt: sql`now()`,
    })
    .returning(VEHICLE_COLUMNS);
  return rows[0] as VehicleRow;
}

export async function findVehicleById(id: string): Promise<VehicleRow | undefined> {
  const tx = tenantTx();
  const rows = await tx.select(VEHICLE_COLUMNS).from(schema.vehicles).where(eq(schema.vehicles.id, id)).limit(1);
  return (rows as VehicleRow[])[0];
}

/** Tenant-scoped by RLS; hits `uq_vehicles_tenant_chassis` (partial, non-NULL). */
export async function findVehicleByChassis(chassisNo: string): Promise<VehicleRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .select(VEHICLE_COLUMNS)
    .from(schema.vehicles)
    .where(eq(schema.vehicles.chassisNo, chassisNo))
    .limit(1);
  return (rows as VehicleRow[])[0];
}

const LIST_MAX = 100;

/** Registry list: newest first (uuidv7 ids keep the order total). */
export async function listVehicles(filter: VehicleListFilter, limit: number): Promise<VehicleRow[]> {
  const tx = tenantTx();
  const clamped = Math.min(Math.max(limit, 1), LIST_MAX);
  const conditions = [];
  if (filter.partnerId !== undefined) {
    conditions.push(eq(schema.vehicles.partnerId, filter.partnerId));
  }
  if (filter.status !== undefined) {
    conditions.push(eq(schema.vehicles.status, filter.status));
  }
  if (filter.q !== undefined && filter.q !== "") {
    const like = `%${filter.q}%`;
    conditions.push(
      sql`(plate_no ILIKE ${like} OR chassis_no ILIKE ${like} OR make ILIKE ${like} OR model ILIKE ${like})`,
    );
  }
  const rows = await tx
    .select(VEHICLE_COLUMNS)
    .from(schema.vehicles)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.vehicles.createdAt), desc(schema.vehicles.id))
    .limit(clamped);
  return rows as VehicleRow[];
}

export interface VehicleUpdatePatch {
  make?: string;
  model?: string;
  modelYear?: number | null;
  chassisNo?: string | null;
  plateNo?: string | null;
  color?: string | null;
  engineNo?: string | null;
  odometerKm?: string | null;
  odometerAt?: string | null;
  note?: string | null;
  noteAr?: string | null;
  version?: number;
}

export async function updateVehicle(id: string, patch: VehicleUpdatePatch): Promise<VehicleRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .update(schema.vehicles)
    .set({
      ...(patch.make !== undefined ? { make: patch.make } : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.modelYear !== undefined ? { modelYear: patch.modelYear } : {}),
      ...(patch.chassisNo !== undefined ? { chassisNo: patch.chassisNo } : {}),
      ...(patch.plateNo !== undefined ? { plateNo: patch.plateNo } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.engineNo !== undefined ? { engineNo: patch.engineNo } : {}),
      ...(patch.odometerKm !== undefined ? { odometerKm: patch.odometerKm } : {}),
      ...(patch.odometerAt !== undefined ? { odometerAt: patch.odometerAt } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.noteAr !== undefined ? { noteAr: patch.noteAr } : {}),
      ...(patch.version !== undefined ? { version: patch.version + 1 } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(schema.vehicles.id, id))
    .returning(VEHICLE_COLUMNS);
  return (rows as VehicleRow[])[0];
}

/** ACTIVE → ARCHIVED only (registry rows are never deleted); the
 * status guard makes a concurrent double-archive return undefined. */
export async function archiveVehicle(id: string): Promise<VehicleRow | undefined> {
  const tx = tenantTx();
  const rows = await tx
    .update(schema.vehicles)
    .set({ status: "ARCHIVED", updatedAt: sql`now()` })
    .where(and(eq(schema.vehicles.id, id), eq(schema.vehicles.status, "ACTIVE")))
    .returning(VEHICLE_COLUMNS);
  return (rows as VehicleRow[])[0];
}

// -- per-vehicle service history (read model) ---------------------------------

export interface VehicleServiceHistoryEntry {
  kind: "JOB_CARD" | "INVOICE" | "CREDIT_NOTE";
  id: string;
  docNo: string | null;
  /** ISO calendar date (YYYY-MM-DD); job cards use check-in (UTC date). */
  date: string;
  status: string;
  /** Decimal string; job cards carry no document total (null). */
  total: string | null;
}

/**
 * The `automotive.vehicle_service_history` source data: a UNION ALL read
 * model over sales-owned tables — job cards (by vehicle_id), invoices (by
 * vehicle_id), warranty credit notes (via the job-card link) — newest
 * first. MODULE_BOUNDARIES precedent: partners reads sales exactly the
 * way sales.store reads partners (read-only SQL inside the ambient tenant
 * transaction, RLS-enforced); no cross-module writes exist in either
 * direction.
 */
export async function findVehicleServiceHistory(vehicleId: string): Promise<VehicleServiceHistoryEntry[]> {
  const tx = tenantTx();
  const result = await tx.execute(sql`
    SELECT timeline.kind, timeline.id, timeline."docNo", timeline."date"::text AS "date",
           timeline.status, timeline.total::text AS total
    FROM (
      SELECT 'JOB_CARD'::text AS kind, jc.id AS id, jc.card_no AS "docNo",
             (COALESCE(jc.checked_in_at, jc.created_at) AT TIME ZONE 'UTC')::date AS "date",
             jc.status AS status, NULL::numeric AS total
      FROM job_cards jc
      WHERE jc.vehicle_id = ${vehicleId}
      UNION ALL
      SELECT 'INVOICE'::text, si.id, si.invoice_no, si.invoice_date, si.status, si.total_gross
      FROM sales_invoices si
      WHERE si.vehicle_id = ${vehicleId}
      UNION ALL
      SELECT 'CREDIT_NOTE'::text, cn.id, cn.note_no, cn.note_date, cn.status, cn.total_gross
      FROM credit_notes cn
      JOIN job_cards jc2 ON jc2.id = cn.job_card_id AND jc2.tenant_id = cn.tenant_id
      WHERE jc2.vehicle_id = ${vehicleId}
    ) AS timeline
    ORDER BY timeline."date" DESC, timeline.kind ASC, timeline.id ASC
  `);
  return result.rows as unknown as VehicleServiceHistoryEntry[];
}
