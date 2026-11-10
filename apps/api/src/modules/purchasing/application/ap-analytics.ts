import { Injectable } from "@nestjs/common";
import { sql, type SQL } from "drizzle-orm";

import { requireTenantContext } from "../../../infra/db/tenant-context";
import { type TenantDb } from "../../../infra/db/client";

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("query requires an ambient tenant scope");
  }
  return context.tx;
}

/**
 * PHASE-013 · purchasing analytics query service (REPORT_CATALOG §3):
 * supplier/item spend, PO status board, three-way-match exceptions — the
 * module-owned authorized query surface for the reporting contracts.
 * Posted data only; base amounts at the stored posting rate (INV-008).
 */

function branchScopeFilter(ids: readonly string[] | null, column: SQL): SQL {
  if (ids === null) {
    return sql`TRUE`;
  }
  if (ids.length === 0) {
    return sql`FALSE`;
  }
  return sql`${column} IN (${sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  )})`;
}

export interface SupplierSpendRow {
  supplierId: string;
  supplierName: string;
  supplierNameAr: string | null;
  invoiceCount: number;
  netSpend: string;
  taxAmount: string;
  grossSpend: string;
}

export interface ItemSpendRow {
  itemId: string;
  sku: string;
  itemName: string;
  itemNameAr: string | null;
  qty: string;
  netSpend: string;
}

export interface PoStatusRow {
  poId: string;
  orderNo: string;
  orderDate: string;
  status: string;
  supplierName: string;
  totalNet: string;
  receivedValue: string;
  invoicedValue: string;
}

export interface MatchingExceptionRow {
  invoiceId: string;
  internalNo: string | null;
  invoiceNo: string;
  supplierName: string;
  matchStatus: string;
  exception: string;
}

@Injectable()
export class ApAnalyticsService {
  /** Spend by supplier over POSTED supplier invoices (base at stored rate). */
  async supplierSpend(input: {
    fromDate: string;
    toDate: string;
    branchIds: readonly string[] | null;
  }): Promise<SupplierSpendRow[]> {
    const rows = await tenantTx().execute(sql`
      SELECT s.id AS "supplierId", s.name AS "supplierName", s.name_ar AS "supplierNameAr",
             COUNT(*)::int AS "invoiceCount",
             SUM(i.total_net * i.exchange_rate)::text AS "netSpend",
             SUM(i.total_tax * i.exchange_rate)::text AS "taxAmount",
             SUM(i.total_gross * i.exchange_rate)::text AS "grossSpend"
      FROM supplier_invoices i JOIN partners s ON s.id = i.supplier_id
      WHERE i.status = 'POSTED' AND i.invoice_date BETWEEN ${input.fromDate} AND ${input.toDate}
        AND ${branchScopeFilter(input.branchIds, sql`i.branch_id`)}
      GROUP BY s.id, s.name, s.name_ar
      ORDER BY s.name
    `);
    return rows.rows as unknown as SupplierSpendRow[];
  }

  /** Spend by item over POSTED supplier invoice lines. */
  async itemSpend(input: {
    fromDate: string;
    toDate: string;
    branchIds: readonly string[] | null;
  }): Promise<ItemSpendRow[]> {
    const rows = await tenantTx().execute(sql`
      SELECT it.id AS "itemId", it.sku, it.name AS "itemName", it.name_ar AS "itemNameAr",
             SUM(l.qty)::text AS qty,
             SUM(l.net_amount * i.exchange_rate)::text AS "netSpend"
      FROM supplier_invoices i
      JOIN supplier_invoice_lines l ON l.invoice_id = i.id
      JOIN items it ON it.id = l.item_id
      WHERE i.status = 'POSTED' AND i.invoice_date BETWEEN ${input.fromDate} AND ${input.toDate}
        AND ${branchScopeFilter(input.branchIds, sql`i.branch_id`)}
      GROUP BY it.id, it.sku, it.name, it.name_ar
      ORDER BY it.sku
    `);
    return rows.rows as unknown as ItemSpendRow[];
  }

  /** PO status board: ordered vs received vs invoiced per open/period PO. */
  async poStatus(input: {
    fromDate: string;
    toDate: string;
    openOnly: boolean;
  }): Promise<PoStatusRow[]> {
    const rows = await tenantTx().execute(sql`
      SELECT po.id AS "poId", po.order_no AS "orderNo", po.order_date AS "orderDate",
             po.status, s.name AS "supplierName",
             (po.total_net * po.exchange_rate)::text AS "totalNet",
             COALESCE((SELECT SUM(g.value_amount * po2.exchange_rate)
               FROM goods_receipts g JOIN purchase_orders po2 ON po2.id = g.po_id
               WHERE g.po_id = po.id AND g.status = 'POSTED'), 0)::text AS "receivedValue",
             COALESCE((SELECT SUM(si.total_net * si.exchange_rate)
               FROM supplier_invoices si WHERE si.po_id = po.id AND si.status = 'POSTED'), 0)::text AS "invoicedValue"
      FROM purchase_orders po JOIN partners s ON s.id = po.supplier_id
      WHERE po.order_date BETWEEN ${input.fromDate} AND ${input.toDate}
        AND (${input.openOnly} OR po.status NOT IN ('CLOSED', 'CANCELLED'))
      ORDER BY po.order_date DESC, po.order_no
      LIMIT 500
    `);
    return rows.rows as unknown as PoStatusRow[];
  }

  /** Three-way-match exceptions: invoices with non-clean match results. */
  async matchingExceptions(input: {
    fromDate: string;
    toDate: string;
  }): Promise<MatchingExceptionRow[]> {
    const rows = await tenantTx().execute(sql`
      SELECT i.id AS "invoiceId", i.internal_no AS "internalNo", i.invoice_no AS "invoiceNo",
             s.name AS "supplierName", i.match_status AS "matchStatus",
             COALESCE(
               (i.match_result ->> 'exception')
               , (i.match_result ->> 'outcome'), i.match_status) AS exception
      FROM supplier_invoices i JOIN partners s ON s.id = i.supplier_id
      WHERE i.invoice_date BETWEEN ${input.fromDate} AND ${input.toDate}
        AND i.match_status IS NOT NULL AND i.match_status <> 'CLEAN'
      ORDER BY i.invoice_date DESC
      LIMIT 500
    `);
    return rows.rows as unknown as MatchingExceptionRow[];
  }

  /**
   * The purchasing→GL ledger tie (`purchasing-gl-tie`): Σ posted supplier
   * invoice gross (base) == Σ journal-line credit amounts on EXPENSE/
   * INVENTORY/GRNI/VAT-recoverable accounts from purchasing entries in the
   * same window (exact decimals).
   */
  async purchasingGlTie(input: {
    fromDate: string;
    toDate: string;
  }): Promise<{ documentSide: string; glSide: string }> {
    const docRows = await tenantTx().execute(sql`
      SELECT COALESCE(SUM(total_gross * exchange_rate), 0)::text AS total
      FROM supplier_invoices
      WHERE status = 'POSTED' AND invoice_date BETWEEN ${input.fromDate} AND ${input.toDate}
    `);
    const glRows = await tenantTx().execute(sql`
      SELECT COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.base_amount ELSE -l.base_amount END), 0)::text AS total
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.journal_entry_id
      JOIN accounts a ON a.id = l.account_id
      WHERE e.source_type = 'supplier_invoice'
        AND e.entry_date BETWEEN ${input.fromDate} AND ${input.toDate}
        AND (
          a.type IN ('EXPENSE', 'ASSET')
          OR EXISTS (
            SELECT 1 FROM account_purposes ap
            WHERE ap.account_id = a.id AND ap.active_to IS NULL
              AND ap.purpose_key IN ('GRNI', 'VAT_RECOVERABLE')
          )
        )
    `);
    return {
      documentSide: (docRows.rows[0] as { total: string }).total,
      glSide: (glRows.rows[0] as { total: string }).total,
    };
  }
}
