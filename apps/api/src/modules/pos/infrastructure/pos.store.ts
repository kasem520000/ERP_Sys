import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("pos access requires an ambient tenant scope");
  }
  return context.tx;
}

/**
 * PHASE-016 pos module store (terminals, floor plan, checks, kitchen
 * tickets). All queries run inside the tenant-context UoW (RLS via
 * `erp.current_tenant_id()`); the pos module owns ONLY these tables —
 * sales/treasury writes go through their published services
 * (MODULE_BOUNDARIES).
 */

export interface PosTerminalRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  branchId: string;
  deviceId: string | null;
  cashAccountId: string;
  warehouseId: string | null;
  receiptSize: "80mm" | "58mm";
  status: "ACTIVE" | "INACTIVE";
  quickKeys: Record<string, unknown> | null;
  lastSeenAt: string | null;
  activatedAt: string | null;
  deactivatedAt: string | null;
  offlineSeq: number;
}

const TERMINAL_COLUMNS = sql`t.id, t.code, t.name, t.name_ar AS "nameAr", t.branch_id AS "branchId",
  t.device_id AS "deviceId", t.cash_account_id AS "cashAccountId", t.warehouse_id AS "warehouseId",
  t.receipt_size AS "receiptSize", t.status, t.quick_keys AS "quickKeys", t.last_seen_at AS "lastSeenAt",
  t.activated_at AS "activatedAt", t.deactivated_at AS "deactivatedAt", t.offline_seq AS "offlineSeq"`;

export async function insertTerminal(input: {
  code: string;
  name: string;
  nameAr: string | null;
  branchId: string;
  cashAccountId: string;
  warehouseId: string | null;
  receiptSize: "80mm" | "58mm";
  createdBy: string | null;
}): Promise<PosTerminalRow> {
  const id = generateUuidV7();
  const tx = tenantTx();
  await tx.execute(sql`
    INSERT INTO pos_terminals (id, tenant_id, code, name, name_ar, branch_id, cash_account_id,
                               warehouse_id, receipt_size, status, activated_at, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.code}, ${input.name}, ${input.nameAr},
            ${input.branchId}, ${input.cashAccountId}, ${input.warehouseId}, ${input.receiptSize},
            'ACTIVE', now(), ${input.createdBy})
  `);
  return findTerminalById(id) as Promise<PosTerminalRow>;
}

export async function findTerminalById(id: string): Promise<PosTerminalRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TERMINAL_COLUMNS} FROM pos_terminals t WHERE t.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as PosTerminalRow[])[0];
}

export async function findTerminalByCode(code: string): Promise<PosTerminalRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TERMINAL_COLUMNS} FROM pos_terminals t WHERE t.code = ${code} LIMIT 1
  `);
  return (rows.rows as unknown as PosTerminalRow[])[0];
}

export async function listTerminals(filter: {
  branchId?: string;
  status?: string;
  limit: number;
}): Promise<PosTerminalRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TERMINAL_COLUMNS} FROM pos_terminals t
    WHERE (${filter.branchId ?? null}::uuid IS NULL OR t.branch_id = ${filter.branchId ?? null})
      AND (${filter.status ?? null}::text IS NULL OR t.status = ${filter.status ?? null})
    ORDER BY t.code LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as PosTerminalRow[];
}

export async function updateTerminalStatus(input: {
  id: string;
  status: "ACTIVE" | "INACTIVE";
}): Promise<PosTerminalRow> {
  await tenantTx().execute(sql`
    UPDATE pos_terminals SET
      status = ${input.status},
      activated_at = CASE WHEN ${input.status} = 'ACTIVE' THEN now() ELSE activated_at END,
      deactivated_at = CASE WHEN ${input.status} = 'INACTIVE' THEN now() ELSE deactivated_at END,
      updated_at = now(), version = version + 1
    WHERE id = ${input.id}
  `);
  return findTerminalById(input.id) as Promise<PosTerminalRow>;
}

export async function bindTerminalDevice(input: {
  terminalId: string;
  deviceId: string | null;
}): Promise<PosTerminalRow> {
  await tenantTx().execute(sql`
    UPDATE pos_terminals SET device_id = ${input.deviceId}, updated_at = now(), version = version + 1
    WHERE id = ${input.terminalId}
  `);
  return findTerminalById(input.terminalId) as Promise<PosTerminalRow>;
}

export async function updateQuickKeys(input: {
  terminalId: string;
  quickKeys: Record<string, unknown>;
}): Promise<PosTerminalRow> {
  await tenantTx().execute(sql`
    UPDATE pos_terminals SET quick_keys = ${JSON.stringify(input.quickKeys)}::jsonb,
      updated_at = now(), version = version + 1
    WHERE id = ${input.terminalId}
  `);
  return findTerminalById(input.terminalId) as Promise<PosTerminalRow>;
}

/** Reserve the next per-terminal OFF- sequence (BR-030/A-010): the
 * terminal-scoped offline receipt number source — monotone, one row-lock. */
export async function nextOfflineSeq(terminalId: string): Promise<number> {
  const rows = await tenantTx().execute(sql`
    UPDATE pos_terminals SET offline_seq = offline_seq + 1, updated_at = now()
    WHERE id = ${terminalId} RETURNING offline_seq AS seq
  `);
  return Number((rows.rows as unknown as { seq: number }[])[0]!.seq);
}

export async function touchTerminalSeen(terminalId: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE pos_terminals SET last_seen_at = now() WHERE id = ${terminalId}
  `);
}

// -- floor plan (T6) --------------------------------------------------------------

export interface PosTableRow {
  id: string;
  branchId: string;
  zone: string;
  zoneAr: string | null;
  label: string;
  seats: number;
  status: "FREE" | "OCCUPIED" | "RESERVED" | "OUT_OF_SERVICE";
  sortKey: number;
}

export async function insertTable(input: {
  branchId: string;
  zone: string;
  zoneAr: string | null;
  label: string;
  seats: number;
  sortKey: number;
  createdBy: string | null;
}): Promise<PosTableRow> {
  const id = generateUuidV7();
  const tx = tenantTx();
  await tx.execute(sql`
    INSERT INTO pos_tables (id, tenant_id, branch_id, zone, zone_ar, label, seats, sort_key, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.branchId}, ${input.zone}, ${input.zoneAr},
            ${input.label}, ${input.seats}, ${input.sortKey}, ${input.createdBy})
  `);
  const rows = await tx.execute(sql`
    SELECT id, branch_id AS "branchId", zone, zone_ar AS "zoneAr", label, seats, status,
           sort_key AS "sortKey" FROM pos_tables WHERE id = ${id}
  `);
  return (rows.rows as unknown as PosTableRow[])[0]!;
}

export async function listTables(branchId: string): Promise<PosTableRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, branch_id AS "branchId", zone, zone_ar AS "zoneAr", label, seats, status,
           sort_key AS "sortKey" FROM pos_tables
    WHERE branch_id = ${branchId} ORDER BY zone, sort_key, label
  `);
  return rows.rows as unknown as PosTableRow[];
}

export async function findTableById(id: string): Promise<PosTableRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, branch_id AS "branchId", zone, zone_ar AS "zoneAr", label, seats, status,
           sort_key AS "sortKey" FROM pos_tables WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as PosTableRow[])[0];
}

export async function updateTableStatus(input: {
  id: string;
  status: PosTableRow["status"];
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE pos_tables SET status = ${input.status}, updated_at = now(), version = version + 1
    WHERE id = ${input.id}
  `);
}

// -- guest checks (T6) ------------------------------------------------------------

export interface CheckLine {
  lineNo: number;
  itemId: string;
  name: string;
  nameAr: string | null;
  qty: string;
  unitPrice: string;
  note: string | null;
  sentToKitchen: boolean;
}

export interface PosCheckRow {
  id: string;
  branchId: string;
  checkNo: string;
  tableId: string | null;
  orderType: "DINE_IN" | "TAKEAWAY" | "DELIVERY" | "COUNTER";
  guestCount: number;
  status: "OPEN" | "PAID" | "CANCELLED";
  lines: CheckLine[];
  openedBy: string | null;
  openedAt: string;
  closedAt: string | null;
  invoiceId: string | null;
  note: string | null;
}

const CHECK_COLUMNS = sql`c.id, c.branch_id AS "branchId", c.check_no AS "checkNo",
  c.table_id AS "tableId", c.order_type AS "orderType", c.guest_count AS "guestCount",
  c.status, c.lines, c.opened_by AS "openedBy", c.opened_at AS "openedAt",
  c.closed_at AS "closedAt", c.invoice_id AS "invoiceId", c.note`;

function mapCheck(row: Record<string, unknown>): PosCheckRow {
  return { ...(row as unknown as PosCheckRow), lines: (row.lines as CheckLine[]) ?? [] };
}

export async function insertCheck(input: {
  branchId: string;
  tableId: string | null;
  orderType: PosCheckRow["orderType"];
  guestCount: number;
  lines: CheckLine[];
  note: string | null;
  actorId: string | null;
}): Promise<PosCheckRow> {
  const id = generateUuidV7();
  const tx = tenantTx();
  const checkNo = `CHK-${Date.now().toString(36).toUpperCase()}-${id.slice(-6).toUpperCase()}`;
  await tx.execute(sql`
    INSERT INTO pos_checks (id, tenant_id, branch_id, check_no, table_id, order_type,
                            guest_count, status, lines, opened_by, note)
    VALUES (${id}, erp.current_tenant_id(), ${input.branchId}, ${checkNo}, ${input.tableId},
            ${input.orderType}, ${input.guestCount}, 'OPEN',
            ${JSON.stringify(input.lines)}::jsonb, ${input.actorId}, ${input.note})
  `);
  const rows = await tx.execute(sql`SELECT ${CHECK_COLUMNS} FROM pos_checks c WHERE c.id = ${id}`);
  return mapCheck((rows.rows as unknown as Record<string, unknown>[])[0]!);
}

export async function findCheckById(id: string): Promise<PosCheckRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${CHECK_COLUMNS} FROM pos_checks c WHERE c.id = ${id} LIMIT 1
  `);
  const row = (rows.rows as unknown as Record<string, unknown>[])[0];
  return row === undefined ? undefined : mapCheck(row);
}

export async function listChecks(filter: {
  branchId: string;
  status?: string;
  limit: number;
}): Promise<PosCheckRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${CHECK_COLUMNS} FROM pos_checks c
    WHERE c.branch_id = ${filter.branchId}
      AND (${filter.status ?? null}::text IS NULL OR c.status = ${filter.status ?? null})
    ORDER BY c.opened_at DESC LIMIT ${filter.limit}
  `);
  return (rows.rows as unknown as Record<string, unknown>[]).map(mapCheck);
}

export async function updateCheckLines(input: {
  id: string;
  lines: CheckLine[];
}): Promise<PosCheckRow> {
  await tenantTx().execute(sql`
    UPDATE pos_checks SET lines = ${JSON.stringify(input.lines)}::jsonb,
      updated_at = now(), version = version + 1
    WHERE id = ${input.id}
  `);
  return findCheckById(input.id) as Promise<PosCheckRow>;
}

export async function updateCheckTable(input: { id: string; tableId: string | null }): Promise<PosCheckRow> {
  await tenantTx().execute(sql`
    UPDATE pos_checks SET table_id = ${input.tableId}, updated_at = now(), version = version + 1
    WHERE id = ${input.id}
  `);
  return findCheckById(input.id) as Promise<PosCheckRow>;
}

export async function closeCheck(input: {
  id: string;
  status: "PAID" | "CANCELLED";
  invoiceId: string | null;
}): Promise<PosCheckRow> {
  await tenantTx().execute(sql`
    UPDATE pos_checks SET status = ${input.status}, closed_at = now(),
      invoice_id = ${input.invoiceId}, updated_at = now(), version = version + 1
    WHERE id = ${input.id}
  `);
  return findCheckById(input.id) as Promise<PosCheckRow>;
}

export async function countOpenChecks(branchId: string): Promise<number> {
  const rows = await tenantTx().execute(sql`
    SELECT count(*)::int AS n FROM pos_checks WHERE branch_id = ${branchId} AND status = 'OPEN'
  `);
  return Number((rows.rows as unknown as { n: number }[])[0]!.n);
}

// -- kitchen tickets (T6) ----------------------------------------------------------

export interface KitchenTicketRow {
  id: string;
  checkId: string;
  ticketNo: string;
  items: CheckLine[];
  status: "PRINTED" | "VOID";
  printedAt: string;
}

export async function insertKitchenTicket(input: {
  checkId: string;
  items: CheckLine[];
  actorId: string | null;
}): Promise<KitchenTicketRow> {
  const id = generateUuidV7();
  const tx = tenantTx();
  const ticketNo = `KT-${Date.now().toString(36).toUpperCase()}-${id.slice(-6).toUpperCase()}`;
  await tx.execute(sql`
    INSERT INTO pos_kitchen_tickets (id, tenant_id, check_id, ticket_no, items, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.checkId}, ${ticketNo},
            ${JSON.stringify(input.items)}::jsonb, ${input.actorId})
  `);
  const rows = await tx.execute(sql`
    SELECT id, check_id AS "checkId", ticket_no AS "ticketNo", items, status,
           printed_at AS "printedAt" FROM pos_kitchen_tickets WHERE id = ${id}
  `);
  return (rows.rows as unknown as KitchenTicketRow[])[0]!;
}

export async function listKitchenTickets(checkId: string): Promise<KitchenTicketRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, check_id AS "checkId", ticket_no AS "ticketNo", items, status,
           printed_at AS "printedAt" FROM pos_kitchen_tickets
    WHERE check_id = ${checkId} ORDER BY printed_at
  `);
  return rows.rows as unknown as KitchenTicketRow[];
}
