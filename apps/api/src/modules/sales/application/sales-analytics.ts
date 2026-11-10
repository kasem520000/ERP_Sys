import { Injectable } from "@nestjs/common";

/**
 * PHASE-013 · sales analytics query service (REPORT_CATALOG §3
 * `salesAnalytics.*` — the module-owned authorized query surface the
 * reporting contracts consume; ADR-0011: read-only, posted data only,
 * base amounts at the stored posting rate (INV-008 — never re-converted).
 */
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

export interface ItemRevenueRow {
  itemId: string;
  sku: string;
  itemName: string;
  itemNameAr: string | null;
  categoryId: string | null;
  qtySold: string;
  grossSales: string;
  discounts: string;
  netSales: string;
  taxAmount: string;
  cogs: string;
}

export interface CustomerRevenueRow {
  customerId: string;
  partnerName: string;
  partnerNameAr: string | null;
  documentCount: number;
  netSales: string;
  taxAmount: string;
  grossSales: string;
}

export interface RepRevenueRow {
  repId: string | null;
  repName: string;
  repNameAr: string | null;
  documentCount: number;
  netSales: string;
  grossSales: string;
}

export interface PaymentMethodRow {
  kind: string;
  documentCount: number;
  amount: string;
}

export interface BranchRevenueRow {
  branchId: string | null;
  branchName: string;
  branchNameAr: string | null;
  documentCount: number;
  netSales: string;
  grossSales: string;
}

export interface PipelineRow {
  stage: string;
  documentCount: number;
  totalNet: string;
}

export interface SalesGlTie {
  documentSide: string;
  glSide: string;
};

@Injectable()
export class SalesAnalyticsService {
  /** Revenue + COGS by item over POSTED invoices minus POSTED credit notes. */
  async itemRevenue(input: {
    fromDate: string;
    toDate: string;
    branchIds: readonly string[] | null;
  }): Promise<ItemRevenueRow[]> {
    const rows = await tenantTx().execute(sql`
      WITH inv AS (
        SELECT l.item_id,
               SUM(l.qty) AS qty,
               SUM(l.qty * l.unit_price) AS gross,
               SUM(l.discount_amount) AS disc,
               SUM(l.net_amount) AS net,
               SUM(l.tax_amount) AS tax,
               SUM(l.issue_value) AS cogs
        FROM sales_invoices i JOIN sales_invoice_lines l ON l.invoice_id = i.id
        WHERE i.status = 'POSTED' AND i.invoice_date BETWEEN ${input.fromDate} AND ${input.toDate}
          AND ${branchScopeFilter(input.branchIds, sql`i.branch_id`)}
        GROUP BY l.item_id
      ), cn AS (
        SELECT l.item_id,
               SUM(-l.qty) AS qty, SUM(-l.qty * l.unit_price) AS gross,
               SUM(-l.discount_amount) AS disc, SUM(-l.net_amount) AS net,
               SUM(-l.tax_amount) AS tax, SUM(-l.reentry_value) AS cogs
        FROM credit_notes n JOIN credit_note_lines l ON l.note_id = n.id
        WHERE n.status = 'POSTED' AND n.note_date BETWEEN ${input.fromDate} AND ${input.toDate}
          AND ${branchScopeFilter(input.branchIds, sql`n.branch_id`)}
        GROUP BY l.item_id
      )
      SELECT it.id AS "itemId", it.sku, it.name AS "itemName", it.name_ar AS "itemNameAr",
             it.category_id AS "categoryId",
             (COALESCE(inv.qty, 0) + COALESCE(cn.qty, 0))::text AS "qtySold",
             (COALESCE(inv.gross, 0) + COALESCE(cn.gross, 0))::text AS "grossSales",
             (COALESCE(inv.disc, 0) + COALESCE(cn.disc, 0))::text AS "discounts",
             (COALESCE(inv.net, 0) + COALESCE(cn.net, 0))::text AS "netSales",
             (COALESCE(inv.tax, 0) + COALESCE(cn.tax, 0))::text AS "taxAmount",
             (COALESCE(inv.cogs, 0) + COALESCE(cn.cogs, 0))::text AS "cogs"
      FROM items it
      JOIN (SELECT item_id FROM inv UNION SELECT item_id FROM cn) x ON x.item_id = it.id
      LEFT JOIN inv ON inv.item_id = it.id
      LEFT JOIN cn ON cn.item_id = it.id
      ORDER BY it.sku
    `);
    return rows.rows as unknown as ItemRevenueRow[];
  }

  /** Revenue by customer (invoices − credit notes, base at stored rate). */
  async customerRevenue(input: {
    fromDate: string;
    toDate: string;
    branchIds: readonly string[] | null;
  }): Promise<CustomerRevenueRow[]> {
    const rows = await tenantTx().execute(sql`
      WITH inv AS (
        SELECT i.customer_id, COUNT(*) AS cnt,
               SUM(i.total_net * i.exchange_rate) AS net,
               SUM(i.total_tax * i.exchange_rate) AS tax,
               SUM(i.total_gross * i.exchange_rate) AS gross
        FROM sales_invoices i
        WHERE i.status = 'POSTED' AND i.invoice_date BETWEEN ${input.fromDate} AND ${input.toDate}
          AND ${branchScopeFilter(input.branchIds, sql`i.branch_id`)}
        GROUP BY i.customer_id
      ), cn AS (
        SELECT n.customer_id, -COUNT(*) AS cnt,
               SUM(-n.total_net * n.exchange_rate) AS net,
               SUM(-n.total_tax * n.exchange_rate) AS tax,
               SUM(-n.total_gross * n.exchange_rate) AS gross
        FROM credit_notes n
        WHERE n.status = 'POSTED' AND n.note_date BETWEEN ${input.fromDate} AND ${input.toDate}
          AND ${branchScopeFilter(input.branchIds, sql`n.branch_id`)}
        GROUP BY n.customer_id
      )
      SELECT p.id AS "customerId", p.name AS "partnerName", p.name_ar AS "partnerNameAr",
             (COALESCE(inv.cnt, 0) + COALESCE(cn.cnt, 0))::int AS "documentCount",
             (COALESCE(inv.net, 0) + COALESCE(cn.net, 0))::text AS "netSales",
             (COALESCE(inv.tax, 0) + COALESCE(cn.tax, 0))::text AS "taxAmount",
             (COALESCE(inv.gross, 0) + COALESCE(cn.gross, 0))::text AS "grossSales"
      FROM partners p
      JOIN (SELECT customer_id FROM inv UNION SELECT customer_id FROM cn) x ON x.customer_id = p.id
      LEFT JOIN inv ON inv.customer_id = p.id
      LEFT JOIN cn ON cn.customer_id = p.id
      ORDER BY p.name
    `);
    return rows.rows as unknown as CustomerRevenueRow[];
  }

  /** Revenue by sales rep (rep attribution on the documents). */
  async repRevenue(input: {
    fromDate: string;
    toDate: string;
    branchIds: readonly string[] | null;
  }): Promise<RepRevenueRow[]> {
    const rows = await tenantTx().execute(sql`
      WITH inv AS (
        SELECT i.sales_rep_id AS rep_id, COUNT(*) AS cnt,
               SUM(i.total_net * i.exchange_rate) AS net,
               SUM(i.total_gross * i.exchange_rate) AS gross
        FROM sales_invoices i
        WHERE i.status = 'POSTED' AND i.sales_rep_id IS NOT NULL
          AND i.invoice_date BETWEEN ${input.fromDate} AND ${input.toDate}
          AND ${branchScopeFilter(input.branchIds, sql`i.branch_id`)}
        GROUP BY i.sales_rep_id
      ), cn AS (
        SELECT n.sales_rep_id AS rep_id, -COUNT(*) AS cnt,
               SUM(-n.total_net * n.exchange_rate) AS net,
               SUM(-n.total_gross * n.exchange_rate) AS gross
        FROM credit_notes n
        WHERE n.status = 'POSTED' AND n.sales_rep_id IS NOT NULL
          AND n.note_date BETWEEN ${input.fromDate} AND ${input.toDate}
          AND ${branchScopeFilter(input.branchIds, sql`n.branch_id`)}
        GROUP BY n.sales_rep_id
      )
      SELECT r.id AS "repId", r.name AS "repName", r.name_ar AS "repNameAr",
             (COALESCE(inv.cnt, 0) + COALESCE(cn.cnt, 0))::int AS "documentCount",
             (COALESCE(inv.net, 0) + COALESCE(cn.net, 0))::text AS "netSales",
             (COALESCE(inv.gross, 0) + COALESCE(cn.gross, 0))::text AS "grossSales"
      FROM sales_reps r
      JOIN (SELECT rep_id FROM inv UNION SELECT rep_id FROM cn) x ON x.rep_id = r.id
      LEFT JOIN inv ON inv.rep_id = r.id
      LEFT JOIN cn ON cn.rep_id = r.id
      ORDER BY r.name
    `);
    return rows.rows as unknown as RepRevenueRow[];
  }

  /**
   * Payment-method split: the G-02 cash-sale counter payments are cash by
   * construction (cash_account_id); credit invoices settle via receipts —
   * the split counts invoice kinds + receipt methods (documented basis).
   */
  async paymentMethodSplit(input: {
    fromDate: string;
    toDate: string;
    branchIds: readonly string[] | null;
  }): Promise<PaymentMethodRow[]> {
    const rows = await tenantTx().execute(sql`
      SELECT kind, SUM(amount)::text AS amount, COUNT(*)::int AS "documentCount" FROM (
        SELECT i.kind, (i.total_gross * i.exchange_rate) AS amount
        FROM sales_invoices i
        WHERE i.status = 'POSTED' AND i.kind = 'CASH'
          AND i.invoice_date BETWEEN ${input.fromDate} AND ${input.toDate}
          AND ${branchScopeFilter(input.branchIds, sql`i.branch_id`)}
        UNION ALL
        SELECT 'CREDIT_SETTLED', (r.amount * r.exchange_rate) AS amount
        FROM receipts r
        WHERE r.status = 'POSTED'
          AND r.value_date BETWEEN ${input.fromDate} AND ${input.toDate}
      ) u GROUP BY kind ORDER BY kind
    `);
    return rows.rows as unknown as PaymentMethodRow[];
  }

  /** The quote→order→delivery→invoice pipeline conversion counts. */
  async pipelineConversion(input: {
    fromDate: string;
    toDate: string;
  }): Promise<PipelineRow[]> {
    const rows = await tenantTx().execute(sql`
      SELECT 'quotations' AS stage, COUNT(*)::int AS "documentCount",
             COALESCE(SUM(total_net * exchange_rate), 0)::text AS "totalNet"
      FROM quotations WHERE quote_date BETWEEN ${input.fromDate} AND ${input.toDate}
      UNION ALL
      SELECT 'orders', COUNT(*), COALESCE(SUM(total_net * exchange_rate), 0)::text
      FROM sales_orders WHERE order_date BETWEEN ${input.fromDate} AND ${input.toDate}
      UNION ALL
      SELECT 'deliveries', COUNT(*), COALESCE(SUM(total_net), 0)::text
      FROM delivery_notes WHERE delivery_date BETWEEN ${input.fromDate} AND ${input.toDate}
      UNION ALL
      SELECT 'invoices', COUNT(*), COALESCE(SUM(total_net * exchange_rate), 0)::text
      FROM sales_invoices WHERE invoice_date BETWEEN ${input.fromDate} AND ${input.toDate}
        AND status = 'POSTED'
    `);
    return rows.rows as unknown as PipelineRow[];
  }

  /** Revenue by branch (consolidation view). */
  async branchRevenue(input: {
    fromDate: string;
    toDate: string;
  }): Promise<BranchRevenueRow[]> {
    const rows = await tenantTx().execute(sql`
      WITH inv AS (
        SELECT i.branch_id, COUNT(*) AS cnt,
               SUM(i.total_net * i.exchange_rate) AS net,
               SUM(i.total_gross * i.exchange_rate) AS gross
        FROM sales_invoices i
        WHERE i.status = 'POSTED' AND i.invoice_date BETWEEN ${input.fromDate} AND ${input.toDate}
        GROUP BY i.branch_id
      ), cn AS (
        SELECT n.branch_id, -COUNT(*) AS cnt,
               SUM(-n.total_net * n.exchange_rate) AS net,
               SUM(-n.total_gross * n.exchange_rate) AS gross
        FROM credit_notes n
        WHERE n.status = 'POSTED' AND n.note_date BETWEEN ${input.fromDate} AND ${input.toDate}
        GROUP BY n.branch_id
      )
      SELECT b.id AS "branchId", b.name AS "branchName", b.name_ar AS "branchNameAr",
             (COALESCE(inv.cnt, 0) + COALESCE(cn.cnt, 0))::int AS "documentCount",
             (COALESCE(inv.net, 0) + COALESCE(cn.net, 0))::text AS "netSales",
             (COALESCE(inv.gross, 0) + COALESCE(cn.gross, 0))::text AS "grossSales"
      FROM branches b
      LEFT JOIN inv ON inv.branch_id = b.id
      LEFT JOIN cn ON cn.branch_id = b.id
      WHERE inv.branch_id IS NOT NULL OR cn.branch_id IS NOT NULL
      ORDER BY b.name
    `);
    return rows.rows as unknown as BranchRevenueRow[];
  }

  /**
   * PHASE-014 · day-grouped net revenue over POSTED invoices minus POSTED
   * credit notes (base at the stored posting rate, INV-008) — the
   * `sales.daily-revenue` contract the dashboard "sales today" widget binds
   * to with pinned parameters (REPORT_CATALOG §14).
   */
  async dailyRevenue(input: {
    fromDate: string;
    toDate: string;
  }): Promise<
    ReadonlyArray<{
      flowDate: string;
      invoiceCount: number;
      noteCount: number;
      netSales: string;
      taxAmount: string;
    }>
  > {
    const rows = await tenantTx().execute(sql`
      WITH inv AS (
        SELECT invoice_date AS d, COUNT(*)::int AS c,
               SUM(total_net * exchange_rate) AS net, SUM(total_tax * exchange_rate) AS tax
        FROM sales_invoices
        WHERE status = 'POSTED' AND invoice_date BETWEEN ${input.fromDate} AND ${input.toDate}
        GROUP BY invoice_date
      ), cn AS (
        SELECT note_date AS d, COUNT(*)::int AS c,
               SUM(-(total_net * exchange_rate)) AS net, SUM(-(total_tax * exchange_rate)) AS tax
        FROM credit_notes
        WHERE status = 'POSTED' AND note_date BETWEEN ${input.fromDate} AND ${input.toDate}
        GROUP BY note_date
      )
      SELECT days.d::text AS "flowDate",
             (COALESCE(inv.c, 0))::int AS "invoiceCount",
             (COALESCE(cn.c, 0))::int AS "noteCount",
             (COALESCE(inv.net, 0) + COALESCE(cn.net, 0))::text AS "netSales",
             (COALESCE(inv.tax, 0) + COALESCE(cn.tax, 0))::text AS "taxAmount"
      FROM (SELECT d FROM inv UNION SELECT d FROM cn) days
      LEFT JOIN inv ON inv.d = days.d
      LEFT JOIN cn ON cn.d = days.d
      ORDER BY days.d
    `);
    return rows.rows as unknown as {
      flowDate: string;
      invoiceCount: number;
      noteCount: number;
      netSales: string;
      taxAmount: string;
    }[];
  }

  /**
   * The sales→GL ledger tie (`sales-gl-tie`): Σ posted invoice/note base
   * gross == Σ journal-line amounts on REVENUE/VAT accounts from
   * sales-document entries in the same window (exact decimals).
   */
  async salesGlTie(input: {
    fromDate: string;
    toDate: string;
  }): Promise<SalesGlTie> {
    const docRows = await tenantTx().execute(sql`
      SELECT COALESCE(SUM(base), 0)::text AS total FROM (
        SELECT (total_gross * exchange_rate) AS base FROM sales_invoices
        WHERE status = 'POSTED' AND invoice_date BETWEEN ${input.fromDate} AND ${input.toDate}
        UNION ALL
        SELECT (-total_gross * exchange_rate) AS base FROM credit_notes
        WHERE status = 'POSTED' AND note_date BETWEEN ${input.fromDate} AND ${input.toDate}
      ) u
    `);
    const glRows = await tenantTx().execute(sql`
      SELECT COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l.base_amount ELSE -l.base_amount END), 0)::text AS total
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.journal_entry_id
      JOIN accounts a ON a.id = l.account_id
      WHERE e.source_type IN ('sales_invoice', 'credit_note')
        AND e.entry_date BETWEEN ${input.fromDate} AND ${input.toDate}
        AND (
          a.type = 'REVENUE'
          OR EXISTS (
            SELECT 1 FROM account_purposes ap
            WHERE ap.account_id = a.id AND ap.active_to IS NULL AND ap.purpose_key = 'VAT_PAYABLE'
          )
        )
    `);
    return {
      documentSide: (docRows.rows[0] as { total: string }).total,
      glSide: (glRows.rows[0] as { total: string }).total,
    };
  }
}


/** Branch scope fragment: null = all, empty = nothing, else an IN list. */
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
