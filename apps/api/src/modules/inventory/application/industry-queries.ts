import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { requireTenantContext } from "../../../infra/db/tenant-context";
import { type TenantDb } from "../../../infra/db/client";
import * as journal from "../../accounting/infrastructure/journal.store";

/**
 * PHASE-015 T10 · industry report queries (industries/reports/README
 * PHASE-015 rows — the queries behind `inventory.expiry_list`,
 * `grocery.expiry_writeoff`, `retail.imei_register`): reporting-facing,
 * read-only, executed inside the ambient tenant transaction exactly like
 * `inventory-queries.ts` (ADR-0011 — module-owned query surfaces; the
 * reporting service locator constructs them directly).
 *
 * Valuation discipline (INV-010/ADR-0009): every money figure is the
 * 4-decimal journal quantum the append-only move ledger already carries
 * (Σ signed value_amount) — the same valuation source the stock-valuation
 * report reads; no parallel math, tolerance 0.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("industry report query requires an ambient tenant scope");
  }
  return context.tx;
}

/** Write-off reason codes the register covers (stock-service §2.17). */
export const WRITEOFF_REASONS = ["EXPIRED", "DAMAGE"] as const;

export interface ExpiryListRow {
  batchId: string;
  batchNo: string;
  expiryDate: string;
  itemId: string;
  sku: string;
  itemName: string;
  itemNameAr: string | null;
  warehouseId: string;
  warehouseCode: string;
  qty: string;
  value: string;
  daysToExpiry: number;
  /** FEFO pick suggestion: 1 = earliest expiry of the item in the warehouse. */
  fefoRank: number;
}

export interface WriteoffRow {
  moveId: string;
  movedAt: string;
  itemId: string;
  itemSku: string;
  itemName: string;
  itemNameAr: string | null;
  warehouseCode: string;
  batchNo: string | null;
  qty: string;
  valueAmount: string;
  reason: string;
  moveKind: string;
  sourceType: string;
  sourceRef: string | null;
}

export interface ImeiRegisterRow {
  serialId: string;
  serialNo: string;
  imei: string | null;
  itemId: string;
  itemSku: string;
  itemName: string;
  itemNameAr: string | null;
  status: string;
  currentOwner: string | null;
  receivedAt: string | null;
  grnId: string | null;
  grnRef: string | null;
  saleId: string | null;
  saleRef: string | null;
  soldAt: string | null;
  returnId: string | null;
  returnRef: string | null;
  returnedAt: string | null;
  inCount: number;
  outCount: number;
}

function warehouseFilterSql(
  warehouseIds: readonly string[] | undefined,
  column: "m.warehouse_id" | "w.id",
): ReturnType<typeof sql> {
  if (warehouseIds === undefined || warehouseIds.length === 0) {
    return sql`true`;
  }
  return sql`${sql.raw(column)} IN (${sql.join(
    warehouseIds.map((id) => sql`${id}`),
    sql`, `,
  )})`;
}

@Injectable()
export class IndustryInventoryQueriesService {
  /**
   * `inventory.expiry_list`: on-hand batches (qty > 0, expiry set) at an
   * as-of date with their carrying value (value at risk) and the FEFO pick
   * rank per (item, warehouse) — earliest expiry first.
   */
  async expiryList(input: {
    asOf: string;
    warehouseIds?: readonly string[];
  }): Promise<ExpiryListRow[]> {
    const rows = await tenantTx().execute(sql`
      WITH batch_stock AS (
        SELECT m.batch_id, m.warehouse_id,
               SUM(CASE WHEN m.direction = 'IN' THEN m.qty ELSE -m.qty END) AS qty,
               SUM(CASE WHEN m.direction = 'IN' THEN m.value_amount ELSE -m.value_amount END) AS value
        FROM stock_moves m
        WHERE m.moved_at <= ${input.asOf}
          AND ${warehouseFilterSql(input.warehouseIds, "m.warehouse_id")}
        GROUP BY m.batch_id, m.warehouse_id
        HAVING SUM(CASE WHEN m.direction = 'IN' THEN m.qty ELSE -m.qty END) > 0
      )
      SELECT b.id AS "batchId", b.batch_no AS "batchNo", b.expiry_date::text AS "expiryDate",
             it.id AS "itemId", it.sku, it.name AS "itemName", it.name_ar AS "itemNameAr",
             w.id AS "warehouseId", w.code AS "warehouseCode",
             bs.qty::text AS qty, bs.value::text AS value,
             (b.expiry_date - ${input.asOf}::date)::int AS "daysToExpiry",
             ROW_NUMBER() OVER (
               PARTITION BY b.item_id, bs.warehouse_id
               ORDER BY b.expiry_date, b.batch_no
             )::int AS "fefoRank"
      FROM batch_stock bs
      JOIN item_batches b ON b.id = bs.batch_id AND b.expiry_date IS NOT NULL
      JOIN items it ON it.id = b.item_id
      JOIN warehouses w ON w.id = bs.warehouse_id
      ORDER BY it.sku, w.code, b.expiry_date, b.batch_no
      LIMIT 2000
    `);
    return rows.rows as unknown as ExpiryListRow[];
  }

  /**
   * `grocery.expiry_writeoff` register: OUT moves with reason EXPIRED or
   * DAMAGE in the window (manual issues + posted adjustment losses), each
   * with its batch, cost value, and source document reference (the
   * adjustment number, else the journal entry number).
   */
  async writeoffRegister(input: {
    fromDate: string;
    toDate: string;
    warehouseIds?: readonly string[];
  }): Promise<WriteoffRow[]> {
    const rows = await tenantTx().execute(sql`
      SELECT m.id AS "moveId", m.moved_at::text AS "movedAt",
             it.id AS "itemId", it.sku AS "itemSku", it.name AS "itemName",
             it.name_ar AS "itemNameAr", w.code AS "warehouseCode",
             b.batch_no AS "batchNo",
             m.qty::text AS qty, m.value_amount::text AS "valueAmount",
             m.reason, m.move_kind AS "moveKind", m.source_type AS "sourceType",
             CASE
               WHEN m.source_type = 'stock_adjustment' THEN
                 (SELECT a.adjustment_no FROM stock_adjustments a
                   WHERE a.id = m.source_id AND a.tenant_id = m.tenant_id)
               ELSE (SELECT e.entry_no FROM journal_entries e WHERE e.id = m.posted_journal_id)
             END AS "sourceRef"
      FROM stock_moves m
      JOIN items it ON it.id = m.item_id
      JOIN warehouses w ON w.id = m.warehouse_id
      LEFT JOIN item_batches b ON b.id = m.batch_id AND b.tenant_id = m.tenant_id
      WHERE m.direction = 'OUT'
        AND m.reason IN ('EXPIRED', 'DAMAGE')
        AND m.moved_at BETWEEN ${input.fromDate} AND ${input.toDate}
        AND ${warehouseFilterSql(input.warehouseIds, "m.warehouse_id")}
      ORDER BY m.moved_at, m.id
      LIMIT 5000
    `);
    return rows.rows as unknown as WriteoffRow[];
  }

  /**
   * The write-off GL tie (the grocery.expiry_writeoff assertion): Σ
   * register values == Σ (debit − credit) on the INVENTORY_SHRINKAGE
   * accounts over the write-off postings' journal lines in the same
   * window — exact, tolerance 0 (the INV-010 tie's movement-shaped
   * sibling; catches an unposted/double-posted write-off drift).
   */
  async writeoffGlTie(input: {
    fromDate: string;
    toDate: string;
  }): Promise<{ registerSide: string; glSide: string }> {
    const registerRows = await tenantTx().execute(sql`
      SELECT COALESCE(SUM(m.value_amount), 0)::numeric(19,4)::text AS total
      FROM stock_moves m
      WHERE m.direction = 'OUT'
        AND m.reason IN ('EXPIRED', 'DAMAGE')
        AND m.moved_at BETWEEN ${input.fromDate} AND ${input.toDate}
    `);
    const shrinkageAccounts = await journal.accountsForPurposes(["INVENTORY_SHRINKAGE"]);
    let gl = "0.0000";
    if (shrinkageAccounts.length > 0) {
      const glRows = await tenantTx().execute(sql`
        SELECT COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.base_amount ELSE -l.base_amount END), 0)::numeric(19,4)::text AS total
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l.journal_entry_id
        WHERE l.account_id IN (${sql.join(
          shrinkageAccounts.map((a) => sql`${a.accountId}`),
          sql`, `,
        )})
          AND e.entry_date BETWEEN ${input.fromDate} AND ${input.toDate}
          AND e.id IN (
            SELECT DISTINCT m.posted_journal_id FROM stock_moves m
            WHERE m.reason IN ('EXPIRED', 'DAMAGE') AND m.posted_journal_id IS NOT NULL
          )
      `);
      gl = (glRows.rows[0] as { total: string }).total;
    }
    return {
      registerSide: (registerRows.rows[0] as { total: string }).total,
      glSide: gl,
    };
  }

  /**
   * `retail.imei_register`: the per-device in/out ledger. Linkage follows
   * the engine's own shape (BR-017/018): goods-in resolves through the GRN
   * line's serial_ids registry (a receipt move anchors its line — the
   * per-unit truth lives on the line), the sale through the per-serial OUT
   * move (issues slice one move per unit), and the return through the
   * credit-note line's serial_ids (returned units re-shelve as in_stock —
   * the original sale stays in the move ledger's history). The window
   * applies to the device's goods-in date; without a window every serial
   * is listed.
   */
  async imeiRegister(input: {
    dateFrom?: string;
    dateTo?: string;
    itemId?: string;
  }): Promise<ImeiRegisterRow[]> {
    const rows = await tenantTx().execute(sql`
      SELECT s.id AS "serialId", s.serial_no AS "serialNo", s.imei,
             it.id AS "itemId", it.sku AS "itemSku", it.name AS "itemName",
             it.name_ar AS "itemNameAr", s.status, s.current_owner AS "currentOwner",
             grn.received_at AS "receivedAt", grn.grn_id AS "grnId", grn.receipt_no AS "grnRef",
             sal.invoice_id AS "saleId", sal.invoice_no AS "saleRef", sal.moved_at AS "soldAt",
             ret.note_id AS "returnId", ret.note_no AS "returnRef", ret.note_date AS "returnedAt",
             (SELECT count(*)::int FROM stock_moves x
               WHERE x.serial_id = s.id AND x.direction = 'IN') AS "inCount",
             (SELECT count(*)::int FROM stock_moves x
               WHERE x.serial_id = s.id AND x.direction = 'OUT') AS "outCount"
      FROM item_serials s
      JOIN items it ON it.id = s.item_id
      LEFT JOIN LATERAL (
        SELECT gr.receipt_date::text AS received_at, gr.id AS grn_id, gr.receipt_no AS receipt_no
        FROM goods_receipt_lines gl
        JOIN goods_receipts gr ON gr.id = gl.receipt_id AND gr.tenant_id = gl.tenant_id
        WHERE gl.item_id = s.item_id AND gl.tenant_id = s.tenant_id
          AND gl.serial_ids @> to_jsonb(s.id::text)
        ORDER BY gr.receipt_date, gr.id
        LIMIT 1
      ) grn ON true
      LEFT JOIN LATERAL (
        SELECT si.id AS invoice_id, si.invoice_no AS invoice_no, m.moved_at::text AS moved_at
        FROM stock_moves m
        JOIN sales_invoices si
          ON m.source_type = 'sales_invoice' AND si.id = m.source_id AND si.tenant_id = m.tenant_id
        WHERE m.serial_id = s.id AND m.direction = 'OUT'
        ORDER BY m.moved_at DESC, m.id DESC
        LIMIT 1
      ) sal ON true
      LEFT JOIN LATERAL (
        SELECT cn.id AS note_id, cn.note_no AS note_no, cn.note_date::text AS note_date
        FROM credit_note_lines cl
        JOIN credit_notes cn ON cn.id = cl.note_id AND cl.tenant_id = cn.tenant_id
        WHERE cl.item_id = s.item_id AND cl.tenant_id = s.tenant_id
          AND cl.serial_ids @> to_jsonb(s.id::text)
        ORDER BY cn.note_date, cn.id
        LIMIT 1
      ) ret ON true
      WHERE (${input.itemId === undefined} OR s.item_id = ${input.itemId ?? null})
        AND (${input.dateFrom === undefined} OR grn.received_at >= ${input.dateFrom ?? null})
        AND (${input.dateTo === undefined} OR grn.received_at <= ${input.dateTo ?? null})
      ORDER BY it.sku, s.serial_no
      LIMIT 5000
    `);
    return rows.rows as unknown as ImeiRegisterRow[];
  }
}
