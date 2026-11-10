import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * Distribution store (PHASE-017 T7/T8): the ONLY writer of `routes`,
 * `route_customers`, `route_visits` and `van_stocks`, plus the VAN slice of
 * `warehouses` (type='VAN' + rep binding — see insertVanWarehouse for the
 * ownership note). Every statement runs in the caller's ambient tenant UoW
 * so a failure anywhere rolls the whole business operation back.
 *
 * Planning data NEVER posts journals here (CAPABILITY_MATRIX §2.4) — this
 * store touches no GL tables at all. Van stock is a read-model mirror:
 * `stock_moves` stays the source of truth (INV-010, inventory-owned) and
 * refreshVanStockMirror recomputes it inside the owning transaction.
 *
 * Cross-module reads (partners, sales_reps, sales_invoices, credit_notes,
 * receipts, warehouses) are read-only SELECTs on published tables — the
 * sanctioned §6 read precedent (the same ambient-tx shape inventory.store
 * exposes as inventoryTx()); distribution never writes another module's
 * rows except the documented VAN slice below.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("distribution access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- routes -----------------------------------------------------------------------

export interface RouteRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  salesRepId: string | null;
  salesRepCode: string | null;
  salesRepName: string | null;
  vanWarehouseId: string | null;
  vanWarehouseCode: string | null;
  dayPattern: string[];
  status: string;
  note: string | null;
  noteAr: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const ROUTE_COLUMNS = sql`r.id, r.code, r.name, r.name_ar AS "nameAr",
  r.sales_rep_id AS "salesRepId", rep.code AS "salesRepCode", rep.name AS "salesRepName",
  r.van_warehouse_id AS "vanWarehouseId", van.code AS "vanWarehouseCode",
  r.day_pattern AS "dayPattern", r.status, r.note, r.note_ar AS "noteAr",
  r.created_at::text AS "createdAt", r.updated_at::text AS "updatedAt", r.version`;
const ROUTE_FROM = sql`routes r
  LEFT JOIN sales_reps rep ON rep.id = r.sales_rep_id AND rep.tenant_id = r.tenant_id
  LEFT JOIN warehouses van ON van.id = r.van_warehouse_id AND van.tenant_id = r.tenant_id`;

export async function findRouteById(id: string): Promise<RouteRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ROUTE_COLUMNS} FROM ${ROUTE_FROM} WHERE r.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as RouteRow[])[0];
}

export async function findRouteByCode(code: string): Promise<RouteRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ROUTE_COLUMNS} FROM ${ROUTE_FROM} WHERE r.code = ${code} LIMIT 1
  `);
  return (rows.rows as unknown as RouteRow[])[0];
}

export async function listRoutes(filter: { status?: string; limit: number }): Promise<RouteRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ROUTE_COLUMNS} FROM ${ROUTE_FROM}
    WHERE (${filter.status ?? null}::text IS NULL OR r.status = ${filter.status ?? null})
    ORDER BY r.code
    LIMIT ${Math.min(filter.limit, 500)}
  `);
  return rows.rows as unknown as RouteRow[];
}

export async function insertRoute(input: {
  code: string;
  name: string;
  nameAr: string | null;
  salesRepId: string | null;
  vanWarehouseId: string | null;
  dayPattern: string[];
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
}): Promise<RouteRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO routes (id, tenant_id, created_by, code, name, name_ar, sales_rep_id,
                        van_warehouse_id, day_pattern, status, note, note_ar)
    VALUES (${id}, erp.current_tenant_id(), ${input.createdBy}, ${input.code}, ${input.name},
            ${input.nameAr}, ${input.salesRepId}, ${input.vanWarehouseId},
            ${JSON.stringify(input.dayPattern)}::jsonb, 'ACTIVE', ${input.note}, ${input.noteAr})
  `);
  return (await findRouteById(id))!;
}

export async function updateRoute(
  id: string,
  patch: {
    name?: string;
    nameAr?: string | null;
    salesRepId?: string | null;
    vanWarehouseId?: string | null;
    dayPattern?: string[];
    status?: string;
    note?: string | null;
    noteAr?: string | null;
  },
): Promise<RouteRow | undefined> {
  const sets = [
    sql`name = COALESCE(${patch.name ?? null}, name)`,
    sql`name_ar = CASE WHEN ${patch.nameAr === undefined} THEN name_ar ELSE ${patch.nameAr ?? null} END`,
    sql`sales_rep_id = CASE WHEN ${patch.salesRepId === undefined} THEN sales_rep_id ELSE ${patch.salesRepId ?? null} END`,
    sql`van_warehouse_id = CASE WHEN ${patch.vanWarehouseId === undefined} THEN van_warehouse_id ELSE ${patch.vanWarehouseId ?? null} END`,
    sql`day_pattern = COALESCE(${patch.dayPattern === undefined ? null : JSON.stringify(patch.dayPattern)}::jsonb, day_pattern)`,
    sql`status = COALESCE(${patch.status ?? null}, status)`,
    sql`note = CASE WHEN ${patch.note === undefined} THEN note ELSE ${patch.note ?? null} END`,
    sql`note_ar = CASE WHEN ${patch.noteAr === undefined} THEN note_ar ELSE ${patch.noteAr ?? null} END`,
    sql`updated_at = now(), version = version + 1`,
  ];
  await tenantTx().execute(sql`
    UPDATE routes SET ${sql.join(sets, sql`, `)} WHERE id = ${id}
  `);
  return findRouteById(id);
}

// -- route composition ------------------------------------------------------------

export interface RouteCustomerRow {
  id: string;
  routeId: string;
  customerId: string;
  customerCode: string | null;
  customerName: string | null;
  customerNameAr: string | null;
  visitOrder: number;
  isPinned: boolean;
}

export async function listRouteCustomers(routeId: string): Promise<RouteCustomerRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT rc.id, rc.route_id AS "routeId", rc.customer_id AS "customerId",
      p.code AS "customerCode", p.name AS "customerName", p.name_ar AS "customerNameAr",
      rc.visit_order AS "visitOrder", rc.is_pinned AS "isPinned"
    FROM route_customers rc
    LEFT JOIN partners p ON p.id = rc.customer_id AND p.tenant_id = rc.tenant_id
    WHERE rc.route_id = ${routeId}
    ORDER BY rc.visit_order, rc.created_at
  `);
  return rows.rows as unknown as RouteCustomerRow[];
}

/** Full-replace of the route's customer set (DELETE + INSERT — route_customers
 * is one of the two distribution tables granted DELETE for exactly this). */
export async function replaceRouteCustomers(
  routeId: string,
  customers: { customerId: string; visitOrder: number; isPinned: boolean }[],
  createdBy: string | null,
): Promise<void> {
  const tx = tenantTx();
  await tx.execute(sql`DELETE FROM route_customers WHERE route_id = ${routeId}`);
  for (const customer of customers) {
    await tx.execute(sql`
      INSERT INTO route_customers (id, tenant_id, created_by, route_id, customer_id,
                                   visit_order, is_pinned)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${createdBy}, ${routeId},
              ${customer.customerId}, ${customer.visitOrder}, ${customer.isPinned})
    `);
  }
}

// -- route visits -----------------------------------------------------------------

export interface VisitRow {
  id: string;
  routeId: string;
  routeCode: string | null;
  customerId: string;
  customerCode: string | null;
  customerName: string | null;
  customerNameAr: string | null;
  plannedDate: string;
  status: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  salesInvoiceId: string | null;
  creditNoteId: string | null;
  receiptId: string | null;
  salesRepId: string | null;
  note: string | null;
  noteAr: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const VISIT_COLUMNS = sql`v.id, v.route_id AS "routeId", r.code AS "routeCode",
  v.customer_id AS "customerId", p.code AS "customerCode", p.name AS "customerName",
  p.name_ar AS "customerNameAr", v.planned_date::text AS "plannedDate", v.status,
  v.checked_in_at::text AS "checkedInAt", v.checked_out_at::text AS "checkedOutAt",
  v.sales_invoice_id AS "salesInvoiceId", v.credit_note_id AS "creditNoteId",
  v.receipt_id AS "receiptId", v.sales_rep_id AS "salesRepId", v.note, v.note_ar AS "noteAr",
  v.created_at::text AS "createdAt", v.updated_at::text AS "updatedAt", v.version`;
const VISIT_FROM = sql`route_visits v
  JOIN routes r ON r.id = v.route_id AND r.tenant_id = v.tenant_id
  LEFT JOIN partners p ON p.id = v.customer_id AND p.tenant_id = v.tenant_id`;

export async function findVisitById(id: string): Promise<VisitRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${VISIT_COLUMNS} FROM ${VISIT_FROM} WHERE v.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as VisitRow[])[0];
}

export async function listVisits(filter: {
  date?: string;
  routeId?: string;
  status?: string;
  limit: number;
}): Promise<VisitRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${VISIT_COLUMNS} FROM ${VISIT_FROM}
    WHERE (${filter.date ?? null}::date IS NULL OR v.planned_date = ${filter.date ?? null})
      AND (${filter.routeId ?? null}::uuid IS NULL OR v.route_id = ${filter.routeId ?? null})
      AND (${filter.status ?? null}::text IS NULL OR v.status = ${filter.status ?? null})
    ORDER BY v.planned_date, r.code, p.name, v.created_at
    LIMIT ${Math.min(filter.limit, 500)}
  `);
  return rows.rows as unknown as VisitRow[];
}

export async function insertVisits(
  rows: { id: string; routeId: string; customerId: string; plannedDate: string; salesRepId: string | null; createdBy: string | null }[],
): Promise<void> {
  const tx = tenantTx();
  for (const visit of rows) {
    await tx.execute(sql`
      INSERT INTO route_visits (id, tenant_id, created_by, route_id, customer_id,
                                planned_date, status, sales_rep_id)
      VALUES (${visit.id}, erp.current_tenant_id(), ${visit.createdBy}, ${visit.routeId},
              ${visit.customerId}, ${visit.plannedDate}, 'PLANNED', ${visit.salesRepId})
    `);
  }
}

/** Conditional check-in flip — exactly-once (double check-in returns false). */
export async function checkInVisit(
  id: string,
  patch: { salesRepId: string | null; note: string | null },
): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    UPDATE route_visits SET
      checked_in_at = now(),
      sales_rep_id = COALESCE(${patch.salesRepId}, sales_rep_id),
      note = COALESCE(${patch.note}, note),
      updated_at = now(), version = version + 1
    WHERE id = ${id} AND status = 'PLANNED' AND checked_in_at IS NULL
    RETURNING id
  `);
  return rows.rows.length > 0;
}

/** Conditional completion flip — PLANNED → COMPLETED exactly once; provided
 * document links only ever fill (COALESCE), never clear. */
export async function completeVisit(
  id: string,
  patch: {
    salesInvoiceId: string | null;
    creditNoteId: string | null;
    receiptId: string | null;
    note: string | null;
  },
): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    UPDATE route_visits SET
      status = 'COMPLETED', checked_out_at = now(),
      sales_invoice_id = COALESCE(${patch.salesInvoiceId}, sales_invoice_id),
      credit_note_id = COALESCE(${patch.creditNoteId}, credit_note_id),
      receipt_id = COALESCE(${patch.receiptId}, receipt_id),
      note = COALESCE(${patch.note}, note),
      updated_at = now(), version = version + 1
    WHERE id = ${id} AND status = 'PLANNED'
    RETURNING id
  `);
  return rows.rows.length > 0;
}

/** Conditional skip flip — PLANNED → SKIPPED exactly once. */
export async function skipVisit(id: string, note: string | null): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    UPDATE route_visits SET status = 'SKIPPED', note = COALESCE(${note}, note),
      updated_at = now(), version = version + 1
    WHERE id = ${id} AND status = 'PLANNED'
    RETURNING id
  `);
  return rows.rows.length > 0;
}

/** The stale-visit sweep (report hygiene): every PLANNED visit before
 * `beforeDate` with no check-in flips to MISSED — returns the flipped ids. */
export async function markVisitsMissed(beforeDate: string): Promise<string[]> {
  const rows = await tenantTx().execute(sql`
    UPDATE route_visits SET status = 'MISSED', updated_at = now(), version = version + 1
    WHERE status = 'PLANNED' AND planned_date < ${beforeDate}::date AND checked_in_at IS NULL
    RETURNING id
  `);
  return rows.rows.map((row) => (row as unknown as { id: string }).id);
}

// -- vans (the VAN slice of warehouses) ---------------------------------------------

export interface VanRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  type: string;
  branchId: string;
  branchCode: string | null;
  branchName: string | null;
  salesRepId: string | null;
  salesRepCode: string | null;
  salesRepName: string | null;
  isActive: boolean;
  note: string | null;
}

const VAN_COLUMNS = sql`w.id, w.code, w.name, w.name_ar AS "nameAr", w.type,
  w.branch_id AS "branchId", b.code AS "branchCode", b.name AS "branchName",
  w.rep_id AS "salesRepId", rep.code AS "salesRepCode", rep.name AS "salesRepName",
  w.is_active AS "isActive", w.note`;
const VAN_FROM = sql`warehouses w
  LEFT JOIN branches b ON b.id = w.branch_id AND b.tenant_id = w.tenant_id
  LEFT JOIN sales_reps rep ON rep.id = w.rep_id AND rep.tenant_id = w.tenant_id`;

export async function listVans(filter: { limit: number }): Promise<VanRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${VAN_COLUMNS} FROM ${VAN_FROM}
    WHERE w.type = 'VAN'
    ORDER BY w.code
    LIMIT ${Math.min(filter.limit, 200)}
  `);
  return rows.rows as unknown as VanRow[];
}

/** The van lookup for validations — returns the warehouse row WHATEVER its
 * type (the caller decides VAN-ness), with `type` on the row. */
export async function findVanByWarehouseId(id: string): Promise<VanRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${VAN_COLUMNS} FROM ${VAN_FROM} WHERE w.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as VanRow[])[0];
}

/** The one-van-per-rep probe (uq_warehouses_tenant_rep pre-check). */
export async function findVanByRepId(repId: string): Promise<VanRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${VAN_COLUMNS} FROM ${VAN_FROM}
    WHERE w.type = 'VAN' AND w.rep_id = ${repId}
    LIMIT 1
  `);
  return (rows.rows as unknown as VanRow[])[0];
}

/**
 * VAN-slice exception (documented ownership note): inventory's
 * insertWarehouse predates migration 0025's additive `type` + `rep_id`
 * columns and stays unaware of them; distribution owns the VAN slice of
 * `warehouses` and inserts it directly (still through the ambient tenant
 * UoW + erp.current_tenant_id(), still granted to erp_app). STANDARD
 * warehouses remain inventory's exclusively.
 */
export async function insertVanWarehouse(input: {
  code: string;
  name: string;
  nameAr: string | null;
  branchId: string;
  repId: string | null;
  note: string | null;
  createdBy: string | null;
}): Promise<VanRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO warehouses (id, tenant_id, branch_id, code, name, name_ar,
                            inventory_account_id, note, created_by, type, rep_id)
    VALUES (${id}, erp.current_tenant_id(), ${input.branchId}, ${input.code}, ${input.name},
            ${input.nameAr}, NULL, ${input.note}, ${input.createdBy}, 'VAN', ${input.repId})
  `);
  return (await findVanByWarehouseId(id))!;
}

/** Rebind a van's rep (the one-van-per-rep uq still guards at the DB). */
export async function updateVanRep(warehouseId: string, repId: string | null): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE warehouses SET rep_id = ${repId}, updated_at = now(), version = version + 1
    WHERE id = ${warehouseId}
  `);
}

// -- van stock (read-model mirror of stock_moves) ------------------------------------

export interface VanStockRow {
  id: string;
  warehouseId: string;
  warehouseCode: string;
  itemId: string;
  sku: string;
  itemName: string;
  itemNameAr: string | null;
  batchId: string | null;
  qty: string;
  value: string;
  refreshedAt: string;
}

export async function vanWarehouseIds(): Promise<string[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id FROM warehouses WHERE type = 'VAN' ORDER BY code
  `);
  return rows.rows.map((row) => (row as unknown as { id: string }).id);
}

/**
 * Recompute the van_stocks mirror from stock_moves (the source of truth)
 * inside the ambient transaction: DELETE the scoped slice, then INSERT the
 * fresh SUM(signed qty/value) per (warehouse, item, batch), skipping zero
 * rows. Scoped to VAN warehouses by the join — a non-VAN id in the list is
 * simply a no-op for it. An empty/absent list means "every VAN warehouse".
 */
export async function refreshVanStockMirror(warehouseIds?: string[]): Promise<number> {
  if (warehouseIds !== undefined && warehouseIds.length === 0) return 0;
  const scope =
    warehouseIds === undefined
      ? sql`TRUE`
      : sql`m.warehouse_id IN (${sql.join(
          warehouseIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;
  const deleteScope =
    warehouseIds === undefined
      ? sql`TRUE`
      : sql`warehouse_id IN (${sql.join(
          warehouseIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;
  const tx = tenantTx();
  await tx.execute(sql`DELETE FROM van_stocks WHERE ${deleteScope}`);
  const computed = await tx.execute<{ warehouseId: string; itemId: string; batchId: string | null; qty: string; value: string }>(sql`
    SELECT m.warehouse_id AS "warehouseId", m.item_id AS "itemId", m.batch_id AS "batchId",
      SUM(CASE WHEN m.direction = 'IN' THEN m.qty ELSE -m.qty END)::text AS qty,
      SUM(CASE WHEN m.direction = 'IN' THEN m.value_amount ELSE -m.value_amount END)::text AS value
    FROM stock_moves m
    JOIN warehouses w ON w.id = m.warehouse_id AND w.tenant_id = m.tenant_id
    WHERE w.type = 'VAN' AND ${scope}
    GROUP BY m.warehouse_id, m.item_id, m.batch_id
    HAVING SUM(CASE WHEN m.direction = 'IN' THEN m.qty ELSE -m.qty END) <> 0
  `);
  const rows = computed.rows as unknown as {
    warehouseId: string;
    itemId: string;
    batchId: string | null;
    qty: string;
    value: string;
  }[];
  for (const row of rows) {
    await tx.execute(sql`
      INSERT INTO van_stocks (id, tenant_id, warehouse_id, item_id, batch_id, qty,
                              value, refreshed_at)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${row.warehouseId}, ${row.itemId},
              ${row.batchId}, ${row.qty}, ${row.value}, now())
    `);
  }
  return rows.length;
}

export async function listVanStock(filter: {
  warehouseId?: string;
  itemId?: string;
  limit: number;
}): Promise<VanStockRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT vs.id, vs.warehouse_id AS "warehouseId", w.code AS "warehouseCode",
      vs.item_id AS "itemId", i.sku, i.name AS "itemName", i.name_ar AS "itemNameAr",
      vs.batch_id AS "batchId", vs.qty::text AS qty, vs.value::text AS value,
      vs.refreshed_at::text AS "refreshedAt"
    FROM van_stocks vs
    JOIN warehouses w ON w.id = vs.warehouse_id AND w.tenant_id = vs.tenant_id
    JOIN items i ON i.id = vs.item_id AND i.tenant_id = vs.tenant_id
    WHERE (${filter.warehouseId ?? null}::uuid IS NULL OR vs.warehouse_id = ${filter.warehouseId ?? null})
      AND (${filter.itemId ?? null}::uuid IS NULL OR vs.item_id = ${filter.itemId ?? null})
    ORDER BY w.code, i.sku
    LIMIT ${Math.min(filter.limit, 500)}
  `);
  return rows.rows as unknown as VanStockRow[];
}

export interface VanStockTotalRow {
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  totalQty: string;
  totalValue: string;
  refreshedAt: string;
}

/** Per-van totals off the mirror (the balances screen / settlement tie-in). */
export async function vanStockTotals(filter: {
  warehouseId?: string;
}): Promise<VanStockTotalRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT vs.warehouse_id AS "warehouseId", w.code AS "warehouseCode", w.name AS "warehouseName",
      COALESCE(SUM(vs.qty), 0)::text AS "totalQty",
      COALESCE(SUM(vs.value), 0)::text AS "totalValue",
      max(vs.refreshed_at)::text AS "refreshedAt"
    FROM van_stocks vs
    JOIN warehouses w ON w.id = vs.warehouse_id AND w.tenant_id = vs.tenant_id
    WHERE (${filter.warehouseId ?? null}::uuid IS NULL OR vs.warehouse_id = ${filter.warehouseId ?? null})
    GROUP BY vs.warehouse_id, w.code, w.name
    ORDER BY w.code
  `);
  return rows.rows as unknown as VanStockTotalRow[];
}

// -- read-only cross-module reads (§6 read precedent) --------------------------------

/** Customer reference check for route composition (partners-owned table,
 * read-only): existence + kind; the service enforces CUSTOMER/BOTH. */
export async function findCustomerRef(
  id: string,
): Promise<{ id: string; code: string; name: string; kind: string; status: string } | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, code, name, kind, status FROM partners WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as { id: string; code: string; name: string; kind: string; status: string }[])[0];
}

/** Sales-rep reference check (sales-owned table, read-only). */
export async function findSalesRepRef(
  id: string,
): Promise<{ id: string; code: string; name: string; status: string } | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, code, name, status FROM sales_reps WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as { id: string; code: string; name: string; status: string }[])[0];
}

/** Warehouse code reference check (inventory-owned table, read-only). */
export async function findWarehouseCodeRef(
  code: string,
): Promise<{ id: string; code: string } | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, code FROM warehouses WHERE code = ${code} LIMIT 1
  `);
  return (rows.rows as unknown as { id: string; code: string }[])[0];
}

/** EXISTS-validation for visit completion links (read-only, fixed tables). */
export async function salesInvoiceExists(id: string): Promise<boolean> {
  const rows = await tenantTx().execute(sql`SELECT 1 AS one FROM sales_invoices WHERE id = ${id} LIMIT 1`);
  return rows.rows.length > 0;
}

export async function creditNoteExists(id: string): Promise<boolean> {
  const rows = await tenantTx().execute(sql`SELECT 1 AS one FROM credit_notes WHERE id = ${id} LIMIT 1`);
  return rows.rows.length > 0;
}

export async function receiptExists(id: string): Promise<boolean> {
  const rows = await tenantTx().execute(sql`SELECT 1 AS one FROM receipts WHERE id = ${id} LIMIT 1`);
  return rows.rows.length > 0;
}

// -- rep settlements (T10; STL- series; variance always posts BR-021) ---------------
//
// The ONLY writer of `rep_settlements` + `rep_settlement_lines`, through the
// ambient tenant UoW exactly like the route/visit/van slices above. Money
// legs (variance journal, bank deposit) are NOT posted here — the service
// orchestrates them through PostingService (ADR-0007) and treasury's
// insertCashMovement (INV-019; the 0025-widened 'rep_settlement' source).
//
// Grant reality (migration 0025): erp_app carries SELECT/INSERT/UPDATE on
// rep_settlement_lines but NO DELETE ("status-lifecycled — no tombstone
// deletes"; only route_customers/van_stocks carry DELETE). Line
// "replacement" is therefore an upsert-by-(settlement, line_no) plus a
// zeroed stale tail — never a DELETE — see replaceSettlementLines.

export interface SettlementRow {
  id: string;
  settlementNo: string | null;
  salesRepId: string;
  salesRepCode: string | null;
  salesRepName: string | null;
  vanWarehouseId: string | null;
  vanWarehouseCode: string | null;
  shiftId: string | null;
  shiftNo: string | null;
  settlementDate: string;
  status: string;
  openingCash: string;
  cashSales: string;
  collections: string;
  cashRefunds: string;
  repExpenses: string;
  expectedCash: string;
  countedCash: string | null;
  variance: string | null;
  varianceDirection: string | null;
  varianceReason: string | null;
  varianceJournalId: string | null;
  depositAccountId: string | null;
  depositAmount: string | null;
  depositJournalId: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  postedBy: string | null;
  postedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const SETTLEMENT_COLUMNS = sql`s.id, s.settlement_no AS "settlementNo",
  s.sales_rep_id AS "salesRepId", rep.code AS "salesRepCode", rep.name AS "salesRepName",
  s.van_warehouse_id AS "vanWarehouseId", van.code AS "vanWarehouseCode",
  s.shift_id AS "shiftId", sh.shift_no AS "shiftNo",
  s.settlement_date::text AS "settlementDate", s.status,
  s.opening_cash::text AS "openingCash", s.cash_sales::text AS "cashSales",
  s.collections::text AS "collections", s.cash_refunds::text AS "cashRefunds",
  s.rep_expenses::text AS "repExpenses", s.expected_cash::text AS "expectedCash",
  s.counted_cash::text AS "countedCash", s.variance::text AS "variance",
  s.variance_direction AS "varianceDirection", s.variance_reason AS "varianceReason",
  s.variance_journal_id::text AS "varianceJournalId",
  s.deposit_account_id::text AS "depositAccountId", s.deposit_amount::text AS "depositAmount",
  s.deposit_journal_id::text AS "depositJournalId",
  s.approved_by::text AS "approvedBy", s.approved_at::text AS "approvedAt",
  s.posted_by::text AS "postedBy", s.posted_at::text AS "postedAt",
  s.cancelled_at::text AS "cancelledAt", s.cancel_reason AS "cancelReason",
  s.note, s.note_ar AS "noteAr", s.created_by AS "createdBy",
  s.created_at::text AS "createdAt", s.updated_at::text AS "updatedAt", s.version`;
const SETTLEMENT_FROM = sql`rep_settlements s
  LEFT JOIN sales_reps rep ON rep.id = s.sales_rep_id AND rep.tenant_id = s.tenant_id
  LEFT JOIN warehouses van ON van.id = s.van_warehouse_id AND van.tenant_id = s.tenant_id
  LEFT JOIN cashier_shifts sh ON sh.id = s.shift_id AND sh.tenant_id = s.tenant_id`;

export async function findSettlementById(id: string): Promise<SettlementRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${SETTLEMENT_COLUMNS} FROM ${SETTLEMENT_FROM} WHERE s.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as SettlementRow[])[0];
}

export async function listSettlements(filter: {
  status?: string;
  repId?: string;
  date?: string;
  limit: number;
}): Promise<SettlementRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${SETTLEMENT_COLUMNS} FROM ${SETTLEMENT_FROM}
    WHERE (${filter.status ?? null}::text IS NULL OR s.status = ${filter.status ?? null})
      AND (${filter.repId ?? null}::uuid IS NULL OR s.sales_rep_id = ${filter.repId ?? null})
      AND (${filter.date ?? null}::date IS NULL OR s.settlement_date = ${filter.date ?? null})
    ORDER BY s.settlement_date DESC, s.created_at DESC
    LIMIT ${Math.min(filter.limit, 200)}
  `);
  return rows.rows as unknown as SettlementRow[];
}

/** The live-settlement probe for the day lock (uq_rep_settlements_rep_day
 * pre-check): any non-CANCELLED settlement for (rep, date) locks the day. */
export async function findLiveSettlementForRepDay(
  repId: string,
  date: string,
): Promise<SettlementRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${SETTLEMENT_COLUMNS} FROM ${SETTLEMENT_FROM}
    WHERE s.sales_rep_id = ${repId} AND s.settlement_date = ${date}::date
      AND s.status <> 'CANCELLED'
    LIMIT 1
  `);
  return (rows.rows as unknown as SettlementRow[])[0];
}

export async function insertSettlement(input: {
  salesRepId: string;
  vanWarehouseId: string | null;
  shiftId: string | null;
  settlementDate: string;
  openingCash: string;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
}): Promise<SettlementRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO rep_settlements (id, tenant_id, created_by, sales_rep_id, van_warehouse_id,
                                 shift_id, settlement_date, status, opening_cash, note, note_ar)
    VALUES (${id}, erp.current_tenant_id(), ${input.createdBy}, ${input.salesRepId},
            ${input.vanWarehouseId}, ${input.shiftId}, ${input.settlementDate}, 'DRAFT',
            ${input.openingCash}, ${input.note}, ${input.noteAr})
  `);
  return (await findSettlementById(id))!;
}

/**
 * Status transitions + stamped fields in one dynamic UPDATE (the
 * updateExpenseStatus pattern): undefined fields stay untouched, nullable
 * fields may be explicitly cleared with null, and the APPROVED/POSTED/
 * CANCELLED stamps land exactly when the status flips to them.
 */
export async function patchSettlement(
  id: string,
  patch: {
    status?: string;
    settlementNo?: string | null;
    cashSales?: string;
    collections?: string;
    cashRefunds?: string;
    repExpenses?: string;
    expectedCash?: string;
    countedCash?: string | null;
    variance?: string | null;
    varianceDirection?: string | null;
    varianceReason?: string | null;
    varianceJournalId?: string | null;
    depositAccountId?: string | null;
    depositAmount?: string | null;
    depositJournalId?: string | null;
    cancelReason?: string | null;
    actorId?: string | null;
  },
): Promise<SettlementRow | undefined> {
  const sets = [
    sql`status = COALESCE(${patch.status ?? null}, status)`,
    sql`settlement_no = CASE WHEN ${patch.settlementNo === undefined} THEN settlement_no ELSE ${patch.settlementNo ?? null} END`,
    sql`cash_sales = COALESCE(${patch.cashSales ?? null}, cash_sales)`,
    sql`collections = COALESCE(${patch.collections ?? null}, collections)`,
    sql`cash_refunds = COALESCE(${patch.cashRefunds ?? null}, cash_refunds)`,
    sql`rep_expenses = COALESCE(${patch.repExpenses ?? null}, rep_expenses)`,
    sql`expected_cash = COALESCE(${patch.expectedCash ?? null}, expected_cash)`,
    sql`counted_cash = CASE WHEN ${patch.countedCash === undefined} THEN counted_cash ELSE ${patch.countedCash ?? null} END`,
    sql`variance = CASE WHEN ${patch.variance === undefined} THEN variance ELSE ${patch.variance ?? null} END`,
    sql`variance_direction = CASE WHEN ${patch.varianceDirection === undefined} THEN variance_direction ELSE ${patch.varianceDirection ?? null} END`,
    sql`variance_reason = CASE WHEN ${patch.varianceReason === undefined} THEN variance_reason ELSE ${patch.varianceReason ?? null} END`,
    sql`variance_journal_id = CASE WHEN ${patch.varianceJournalId === undefined} THEN variance_journal_id ELSE ${patch.varianceJournalId ?? null} END`,
    sql`deposit_account_id = CASE WHEN ${patch.depositAccountId === undefined} THEN deposit_account_id ELSE ${patch.depositAccountId ?? null} END`,
    sql`deposit_amount = CASE WHEN ${patch.depositAmount === undefined} THEN deposit_amount ELSE ${patch.depositAmount ?? null} END`,
    sql`deposit_journal_id = CASE WHEN ${patch.depositJournalId === undefined} THEN deposit_journal_id ELSE ${patch.depositJournalId ?? null} END`,
    sql`cancel_reason = CASE WHEN ${patch.cancelReason === undefined} THEN cancel_reason ELSE ${patch.cancelReason ?? null} END`,
    sql`approved_at = CASE WHEN ${patch.status ?? null}::text = 'APPROVED' THEN now() ELSE approved_at END`,
    sql`approved_by = CASE WHEN ${patch.status ?? null}::text = 'APPROVED' THEN ${patch.actorId ?? null} ELSE approved_by END`,
    sql`posted_at = CASE WHEN ${patch.status ?? null}::text = 'POSTED' THEN now() ELSE posted_at END`,
    sql`posted_by = CASE WHEN ${patch.status ?? null}::text = 'POSTED' THEN ${patch.actorId ?? null} ELSE posted_by END`,
    sql`cancelled_at = CASE WHEN ${patch.status ?? null}::text = 'CANCELLED' THEN now() ELSE cancelled_at END`,
    sql`updated_at = now(), version = version + 1`,
  ];
  await tenantTx().execute(sql`
    UPDATE rep_settlements SET ${sql.join(sets, sql`, `)} WHERE id = ${id}
  `);
  return findSettlementById(id);
}

// -- settlement lines ---------------------------------------------------------------

export interface SettlementLineRow {
  id: string;
  settlementId: string;
  lineNo: number;
  component: string;
  amount: string;
  sourceType: string | null;
  sourceId: string | null;
  description: string | null;
  descriptionAr: string | null;
}

export async function listSettlementLines(settlementId: string): Promise<SettlementLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, settlement_id AS "settlementId", line_no AS "lineNo", component,
      amount::text AS amount, source_type AS "sourceType", source_id AS "sourceId",
      description, description_ar AS "descriptionAr"
    FROM rep_settlement_lines
    WHERE settlement_id = ${settlementId}
    ORDER BY line_no
  `);
  return rows.rows as unknown as SettlementLineRow[];
}

/**
 * Upsert ONE component line at its (settlement, line_no) slot — the
 * grant-honest primitive under the no-DELETE policy on rep_settlement_lines.
 */
export async function upsertSettlementLine(input: {
  settlementId: string;
  lineNo: number;
  component: string;
  amount: string;
  sourceType: string | null;
  sourceId: string | null;
  description: string | null;
  descriptionAr: string | null;
  createdBy: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    INSERT INTO rep_settlement_lines (id, tenant_id, created_by, settlement_id, line_no,
                                      component, amount, source_type, source_id,
                                      description, description_ar)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.createdBy}, ${input.settlementId},
            ${input.lineNo}, ${input.component}, ${input.amount}, ${input.sourceType},
            ${input.sourceId}, ${input.description}, ${input.descriptionAr})
    ON CONFLICT ("tenant_id", "settlement_id", "line_no") DO UPDATE SET
      component = EXCLUDED.component,
      amount = EXCLUDED.amount,
      source_type = EXCLUDED.source_type,
      source_id = EXCLUDED.source_id,
      description = EXCLUDED.description,
      description_ar = EXCLUDED.description_ar,
      updated_at = now(), version = rep_settlement_lines.version + 1
  `);
}

/** Zero the stale tail a recount leaves behind (no DELETE grant — the
 * superseded rows stay as visible 0.0000 tombstones, never polluting Σ). */
export async function supersedeSettlementLinesAfter(
  settlementId: string,
  fromLineNo: number,
): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE rep_settlement_lines SET
      amount = 0, source_type = NULL, source_id = NULL,
      description = 'superseded by recount', description_ar = 'ملغى بإعادة الجرد',
      updated_at = now(), version = version + 1
    WHERE settlement_id = ${settlementId} AND line_no >= ${fromLineNo}
  `);
}

/**
 * Full-replace of the settlement's component lines — the store contract the
 * service expects. Implemented as upsert-by-line_no + zeroed stale tail
 * because erp_app holds NO DELETE on rep_settlement_lines (migration 0025
 * grants: only route_customers/van_stocks carry DELETE).
 */
export async function replaceSettlementLines(
  settlementId: string,
  lines: {
    lineNo: number;
    component: string;
    amount: string;
    sourceType: string | null;
    sourceId: string | null;
    description: string | null;
    descriptionAr: string | null;
  }[],
  createdBy: string | null,
): Promise<void> {
  for (const line of lines) {
    await upsertSettlementLine({ ...line, settlementId, createdBy });
  }
  const maxLineNo = lines.reduce((max, line) => Math.max(max, line.lineNo), 0);
  await supersedeSettlementLinesAfter(settlementId, maxLineNo + 1);
}

// -- expected-cash read models (§6 read precedent — own SQL on published tables) ------

export interface RepDayCashSaleRow {
  invoiceId: string;
  invoiceNo: string | null;
  amount: string;
}

/**
 * Σ cash-tender portions of the rep's POSTED CASH invoices for the date —
 * mirrors the invoice posting's own cash-portion rule exactly (POS tenders
 * contribute only their CASH part; standard CASH invoices the gross).
 */
export async function repDayCashSales(repId: string, date: string): Promise<RepDayCashSaleRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT si.id AS "invoiceId", si.invoice_no AS "invoiceNo",
      CASE
        WHEN si.tenders IS NOT NULL AND jsonb_typeof(si.tenders) = 'array'
             AND jsonb_array_length(si.tenders) > 0
        THEN COALESCE((
          SELECT SUM((tender->>'amount')::numeric)
          FROM jsonb_array_elements(si.tenders) AS tender
          WHERE tender->>'method' = 'CASH'
        ), 0)
        ELSE si.total_gross
      END::text AS amount
    FROM sales_invoices si
    WHERE si.sales_rep_id = ${repId}::uuid
      AND si.invoice_date = ${date}::date
      AND si.status = 'POSTED'
      AND si.kind = 'CASH'
    ORDER BY si.created_at, si.id
  `);
  return rows.rows as unknown as RepDayCashSaleRow[];
}

export interface RepDayCollectionRow {
  receiptId: string;
  receiptNo: string | null;
  amount: string;
}

/**
 * Collections = POSTED receipts paid INTO the rep cash account that date
 * (the honest attribution model — receipts carry no rep column; the money's
 * destination IS the attribution).
 */
export async function repDayCollections(
  cashAccountId: string,
  date: string,
): Promise<RepDayCollectionRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT r.id AS "receiptId", r.receipt_no AS "receiptNo", r.amount::text AS amount
    FROM receipts r
    WHERE r.cash_account_id = ${cashAccountId}::uuid
      AND r.value_date = ${date}::date
      AND r.status = 'POSTED'
    ORDER BY r.created_at, r.id
  `);
  return rows.rows as unknown as RepDayCollectionRow[];
}

export interface RepDayCashRefundRow {
  creditNoteId: string;
  noteNo: string | null;
  amount: string;
}

/** Cash refunds = POSTED credit notes by the rep on the date whose ORIGINAL
 * invoice was a cash sale (the money went back out of the rep's drawer). */
export async function repDayCashRefunds(repId: string, date: string): Promise<RepDayCashRefundRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT cn.id AS "creditNoteId", cn.note_no AS "noteNo", cn.total_gross::text AS amount
    FROM credit_notes cn
    JOIN sales_invoices si ON si.id = cn.invoice_id AND si.tenant_id = cn.tenant_id
    WHERE cn.sales_rep_id = ${repId}::uuid
      AND cn.note_date = ${date}::date
      AND cn.status = 'POSTED'
      AND si.kind = 'CASH'
    ORDER BY cn.created_at, cn.id
  `);
  return rows.rows as unknown as RepDayCashRefundRow[];
}

export interface RepDayExpenseRow {
  expenseId: string;
  expenseNo: string | null;
  amount: string;
}

/** Approved rep expenses = POSTED treasury expenses paid FROM the rep cash
 * account that date (posted = the money actually left the drawer). */
export async function repDayExpenses(
  cashAccountId: string,
  date: string,
): Promise<RepDayExpenseRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT e.id AS "expenseId", e.expense_no AS "expenseNo", e.amount::text AS amount
    FROM expenses e
    WHERE e.cash_account_id = ${cashAccountId}::uuid
      AND e.value_date = ${date}::date
      AND e.status = 'POSTED'
    ORDER BY e.created_at, e.id
  `);
  return rows.rows as unknown as RepDayExpenseRow[];
}

export interface RepPendingCounts {
  salesInvoices: number;
  creditNotes: number;
  receipts: number;
}

/** The close gate: DRAFT/PENDING_APPROVAL documents still attributed to the
 * rep's day — invoices + credit notes by rep attribution, receipts into the
 * rep cash account (the same attribution model as the read models above). */
export async function repPendingDocuments(
  repId: string,
  cashAccountId: string,
  date: string,
): Promise<RepPendingCounts> {
  const rows = await tenantTx().execute(sql`
    SELECT
      (SELECT count(*)::int FROM sales_invoices
        WHERE sales_rep_id = ${repId}::uuid AND invoice_date = ${date}::date
          AND status IN ('DRAFT', 'PENDING_APPROVAL')) AS "salesInvoices",
      (SELECT count(*)::int FROM credit_notes
        WHERE sales_rep_id = ${repId}::uuid AND note_date = ${date}::date
          AND status IN ('DRAFT', 'PENDING_APPROVAL')) AS "creditNotes",
      (SELECT count(*)::int FROM receipts
        WHERE cash_account_id = ${cashAccountId}::uuid AND value_date = ${date}::date
          AND status IN ('DRAFT', 'PENDING_APPROVAL')) AS receipts
  `);
  return (rows.rows as unknown as RepPendingCounts[])[0]!;
}

// -- customer tiers (T11; BR-003 tier price lists) ---------------------------------
//
// The ONLY writer of `customer_tiers`. The partner-side assignment lives on
// partners.customer_tier_id (migration 0025) and is written through the
// partners store's additive updatePartnerTier — the documented tier-slice
// exception (partners owns partners rows; distribution owns the tier rows).
// Reads of partners here are read-only SELECTs (§6 read precedent).

export interface TierRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  priceListId: string | null;
  priceListName: string | null;
  discountCapPct: string | null;
  visitFrequencyDays: number | null;
  status: string;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const TIER_COLUMNS = sql`t.id, t.code, t.name, t.name_ar AS "nameAr",
  t.price_list_id AS "priceListId", pl.name AS "priceListName",
  t.discount_cap_pct::text AS "discountCapPct",
  t.visit_frequency_days AS "visitFrequencyDays", t.status,
  t.note, t.note_ar AS "noteAr", t.created_by AS "createdBy",
  t.created_at::text AS "createdAt", t.updated_at::text AS "updatedAt", t.version`;
const TIER_FROM = sql`customer_tiers t
  LEFT JOIN price_lists pl ON pl.id = t.price_list_id AND pl.tenant_id = t.tenant_id`;

export async function findTierById(id: string): Promise<TierRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TIER_COLUMNS} FROM ${TIER_FROM} WHERE t.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as TierRow[])[0];
}

export async function findTierByCode(code: string): Promise<TierRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TIER_COLUMNS} FROM ${TIER_FROM} WHERE t.code = ${code} LIMIT 1
  `);
  return (rows.rows as unknown as TierRow[])[0];
}

export async function listTiers(filter: { status?: string; limit: number }): Promise<TierRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TIER_COLUMNS} FROM ${TIER_FROM}
    WHERE (${filter.status ?? null}::text IS NULL OR t.status = ${filter.status ?? null})
    ORDER BY t.code
    LIMIT ${Math.min(filter.limit, 500)}
  `);
  return rows.rows as unknown as TierRow[];
}

export async function insertTier(input: {
  code: string;
  name: string;
  nameAr: string | null;
  priceListId: string | null;
  discountCapPct: string | null;
  visitFrequencyDays: number | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
}): Promise<TierRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO customer_tiers (id, tenant_id, created_by, code, name, name_ar,
                                price_list_id, discount_cap_pct, visit_frequency_days,
                                status, note, note_ar)
    VALUES (${id}, erp.current_tenant_id(), ${input.createdBy}, ${input.code}, ${input.name},
            ${input.nameAr}, ${input.priceListId}, ${input.discountCapPct},
            ${input.visitFrequencyDays}, 'ACTIVE', ${input.note}, ${input.noteAr})
  `);
  return (await findTierById(id))!;
}

/** Dynamic SET with undefined=keep / null=clear semantics (updateRoute
 * pattern) — name is NOT NULL so it only updates when provided. */
export async function updateTier(
  id: string,
  patch: {
    name?: string;
    nameAr?: string | null;
    priceListId?: string | null;
    discountCapPct?: string | null;
    visitFrequencyDays?: number | null;
    status?: string;
    note?: string | null;
    noteAr?: string | null;
  },
): Promise<TierRow | undefined> {
  const sets = [
    sql`name = COALESCE(${patch.name ?? null}, name)`,
    sql`name_ar = CASE WHEN ${patch.nameAr === undefined} THEN name_ar ELSE ${patch.nameAr ?? null} END`,
    sql`price_list_id = CASE WHEN ${patch.priceListId === undefined} THEN price_list_id ELSE ${patch.priceListId ?? null} END`,
    sql`discount_cap_pct = CASE WHEN ${patch.discountCapPct === undefined} THEN discount_cap_pct ELSE ${patch.discountCapPct ?? null} END`,
    sql`visit_frequency_days = CASE WHEN ${patch.visitFrequencyDays === undefined} THEN visit_frequency_days ELSE ${patch.visitFrequencyDays ?? null} END`,
    sql`status = COALESCE(${patch.status ?? null}, status)`,
    sql`note = CASE WHEN ${patch.note === undefined} THEN note ELSE ${patch.note ?? null} END`,
    sql`note_ar = CASE WHEN ${patch.noteAr === undefined} THEN note_ar ELSE ${patch.noteAr ?? null} END`,
    sql`updated_at = now(), version = version + 1`,
  ];
  await tenantTx().execute(sql`
    UPDATE customer_tiers SET ${sql.join(sets, sql`, `)} WHERE id = ${id}
  `);
  return findTierById(id);
}

/**
 * BR-003 level-2 read (read-only partners read, §6 precedent): the customer's
 * assigned tier row via partners.customer_tier_id. Returns whatever tier is
 * linked (ACTIVE or not — the pricing seam and the UI decide); undefined
 * when the partner or its tier link does not exist.
 */
export async function findPartnerTier(partnerId: string): Promise<TierRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TIER_COLUMNS} FROM ${TIER_FROM}
    WHERE t.id = (SELECT customer_tier_id FROM partners WHERE id = ${partnerId} LIMIT 1)
    LIMIT 1
  `);
  return (rows.rows as unknown as TierRow[])[0];
}

export interface PartnerTierGroupRow {
  tierId: string | null;
  tierCode: string | null;
  tierName: string | null;
  tierStatus: string | null;
  partnerCount: number;
}

/** Partners grouped by tier for the tier editor UI (read-only partners
 * read): one row per tier plus the unassigned (tierId null) row; counts
 * live (non-ARCHIVED) customer-kind partners only. */
export async function listPartnerTiers(): Promise<PartnerTierGroupRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT t.id AS "tierId", t.code AS "tierCode", t.name AS "tierName", t.status AS "tierStatus",
           count(p.id)::int AS "partnerCount"
      FROM customer_tiers t
      LEFT JOIN partners p ON p.customer_tier_id = t.id AND p.tenant_id = t.tenant_id
           AND p.deleted_at IS NULL AND p.kind IN ('CUSTOMER', 'BOTH')
     GROUP BY t.id, t.code, t.name, t.status
     ORDER BY t.code
  `);
  const grouped = rows.rows as unknown as PartnerTierGroupRow[];
  const unassigned = await tenantTx().execute(sql`
    SELECT count(*)::int AS "partnerCount" FROM partners
     WHERE customer_tier_id IS NULL AND deleted_at IS NULL AND kind IN ('CUSTOMER', 'BOTH')
  `);
  grouped.push({
    tierId: null,
    tierCode: null,
    tierName: null,
    tierStatus: null,
    partnerCount: (unassigned.rows as unknown as { partnerCount: number }[])[0]!.partnerCount,
  });
  return grouped;
}

// -- free goods rules (T11; BR-008 buy-X-get-Y zero-price FOC lines) ----------------
//
// The ONLY writer of `free_goods_rules`. The rules NEVER post anything
// themselves: the sale-time application (FreeGoodsService.evaluate /
// appendFocLines) computes zero-price FOC lines that the caller adds to a
// sales document — the document then issues stock and posts COGS through
// the ordinary invoice path (revenue side stays zero — BR-008).

export interface FreeGoodsRuleRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  ruleType: string;
  buyItemId: string;
  buyItemSku: string | null;
  buyQty: string;
  getItemId: string;
  getItemSku: string | null;
  getQty: string;
  perMultiple: boolean;
  maxFreePerOrder: string | null;
  tierId: string | null;
  tierCode: string | null;
  reasonCode: string;
  validFrom: string | null;
  validTo: string | null;
  status: string;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const FGR_COLUMNS = sql`f.id, f.code, f.name, f.name_ar AS "nameAr", f.rule_type AS "ruleType",
  f.buy_item_id AS "buyItemId", bi.sku AS "buyItemSku", f.buy_qty::text AS "buyQty",
  f.get_item_id AS "getItemId", gi.sku AS "getItemSku", f.get_qty::text AS "getQty",
  f.per_multiple AS "perMultiple", f.max_free_per_order::text AS "maxFreePerOrder",
  f.tier_id AS "tierId", t.code AS "tierCode", f.reason_code AS "reasonCode",
  f.valid_from::text AS "validFrom", f.valid_to::text AS "validTo", f.status,
  f.note, f.note_ar AS "noteAr", f.created_by AS "createdBy",
  f.created_at::text AS "createdAt", f.updated_at::text AS "updatedAt", f.version`;
const FGR_FROM = sql`free_goods_rules f
  LEFT JOIN items bi ON bi.id = f.buy_item_id AND bi.tenant_id = f.tenant_id
  LEFT JOIN items gi ON gi.id = f.get_item_id AND gi.tenant_id = f.tenant_id
  LEFT JOIN customer_tiers t ON t.id = f.tier_id AND t.tenant_id = f.tenant_id`;

export async function findFreeGoodsRuleById(id: string): Promise<FreeGoodsRuleRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${FGR_COLUMNS} FROM ${FGR_FROM} WHERE f.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as FreeGoodsRuleRow[])[0];
}

export async function findFreeGoodsRuleByCode(code: string): Promise<FreeGoodsRuleRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${FGR_COLUMNS} FROM ${FGR_FROM} WHERE f.code = ${code} LIMIT 1
  `);
  return (rows.rows as unknown as FreeGoodsRuleRow[])[0];
}

export async function listFreeGoodsRules(filter: {
  status?: string;
  tierId?: string;
  limit: number;
}): Promise<FreeGoodsRuleRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${FGR_COLUMNS} FROM ${FGR_FROM}
    WHERE (${filter.status ?? null}::text IS NULL OR f.status = ${filter.status ?? null})
      AND (${filter.tierId ?? null}::uuid IS NULL OR f.tier_id = ${filter.tierId ?? null})
    ORDER BY f.code
    LIMIT ${Math.min(filter.limit, 500)}
  `);
  return rows.rows as unknown as FreeGoodsRuleRow[];
}

export async function insertFreeGoodsRule(input: {
  code: string;
  name: string;
  nameAr: string | null;
  buyItemId: string;
  buyQty: string;
  getItemId: string;
  getQty: string;
  perMultiple: boolean;
  maxFreePerOrder: string | null;
  tierId: string | null;
  reasonCode: string;
  validFrom: string | null;
  validTo: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
}): Promise<FreeGoodsRuleRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO free_goods_rules (id, tenant_id, created_by, code, name, name_ar,
                                  rule_type, buy_item_id, buy_qty, get_item_id, get_qty,
                                  per_multiple, max_free_per_order, tier_id, reason_code,
                                  valid_from, valid_to, status, note, note_ar)
    VALUES (${id}, erp.current_tenant_id(), ${input.createdBy}, ${input.code}, ${input.name},
            ${input.nameAr}, 'BUY_X_GET_Y', ${input.buyItemId}, ${input.buyQty},
            ${input.getItemId}, ${input.getQty}, ${input.perMultiple}, ${input.maxFreePerOrder},
            ${input.tierId}, ${input.reasonCode}, ${input.validFrom}, ${input.validTo},
            'ACTIVE', ${input.note}, ${input.noteAr})
  `);
  return (await findFreeGoodsRuleById(id))!;
}

/** Dynamic SET with undefined=keep / null=clear semantics (updateTier pattern). */
export async function updateFreeGoodsRule(
  id: string,
  patch: {
    name?: string;
    nameAr?: string | null;
    buyItemId?: string;
    buyQty?: string;
    getItemId?: string;
    getQty?: string;
    perMultiple?: boolean;
    maxFreePerOrder?: string | null;
    tierId?: string | null;
    reasonCode?: string;
    validFrom?: string | null;
    validTo?: string | null;
    status?: string;
    note?: string | null;
    noteAr?: string | null;
  },
): Promise<FreeGoodsRuleRow | undefined> {
  const sets = [
    sql`name = COALESCE(${patch.name ?? null}, name)`,
    sql`name_ar = CASE WHEN ${patch.nameAr === undefined} THEN name_ar ELSE ${patch.nameAr ?? null} END`,
    sql`buy_item_id = COALESCE(${patch.buyItemId ?? null}, buy_item_id)`,
    sql`buy_qty = COALESCE(${patch.buyQty ?? null}, buy_qty)`,
    sql`get_item_id = COALESCE(${patch.getItemId ?? null}, get_item_id)`,
    sql`get_qty = COALESCE(${patch.getQty ?? null}, get_qty)`,
    sql`per_multiple = COALESCE(${patch.perMultiple ?? null}, per_multiple)`,
    sql`max_free_per_order = CASE WHEN ${patch.maxFreePerOrder === undefined} THEN max_free_per_order ELSE ${patch.maxFreePerOrder ?? null} END`,
    sql`tier_id = CASE WHEN ${patch.tierId === undefined} THEN tier_id ELSE ${patch.tierId ?? null} END`,
    sql`reason_code = COALESCE(${patch.reasonCode ?? null}, reason_code)`,
    sql`valid_from = CASE WHEN ${patch.validFrom === undefined} THEN valid_from ELSE ${patch.validFrom ?? null} END`,
    sql`valid_to = CASE WHEN ${patch.validTo === undefined} THEN valid_to ELSE ${patch.validTo ?? null} END`,
    sql`status = COALESCE(${patch.status ?? null}, status)`,
    sql`note = CASE WHEN ${patch.note === undefined} THEN note ELSE ${patch.note ?? null} END`,
    sql`note_ar = CASE WHEN ${patch.noteAr === undefined} THEN note_ar ELSE ${patch.noteAr ?? null} END`,
    sql`updated_at = now(), version = version + 1`,
  ];
  await tenantTx().execute(sql`
    UPDATE free_goods_rules SET ${sql.join(sets, sql`, `)} WHERE id = ${id}
  `);
  return findFreeGoodsRuleById(id);
}

/** The engine's rule feed: ACTIVE rules whose validity window covers the
 * date (NULL bounds are open-ended). Ordering by code keeps evaluation
 * deterministic. */
export async function activeFreeGoodsRules(date: string): Promise<FreeGoodsRuleRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${FGR_COLUMNS} FROM ${FGR_FROM}
    WHERE f.status = 'ACTIVE'
      AND (f.valid_from IS NULL OR f.valid_from <= ${date}::date)
      AND (f.valid_to IS NULL OR f.valid_to >= ${date}::date)
    ORDER BY f.code
  `);
  return rows.rows as unknown as FreeGoodsRuleRow[];
}
