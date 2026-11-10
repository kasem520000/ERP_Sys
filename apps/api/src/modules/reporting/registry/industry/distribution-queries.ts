import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { Decimal } from "@erp/domain-core";

import { requireTenantContext } from "../../../../infra/db/tenant-context";
import { type TenantDb } from "../../../../infra/db/client";
import * as journal from "../../../accounting/infrastructure/journal.store";

/**
 * PHASE-017 T8-a · the distribution report queries (industries/reports/README
 * PHASE-017 rows — the queries behind `distribution.rep_settlement`,
 * `distribution.route_visit_compliance`, `distribution.van_stock_balances`,
 * `sales.discount_management_effectiveness` and `sales.commissions_due`):
 * reporting-facing, read-only, executed inside the ambient tenant
 * transaction exactly like the PHASE-015 `industry-queries.ts` precedent
 * (ADR-0011 — module-owned query surfaces; the reporting service locator
 * constructs them directly).
 *
 * Money discipline (ADR-0009): every monetary figure is the exact 4-decimal
 * quantum the posting chain already carries (settlement components, invoice
 * nets/issue values, commission amounts) — no parallel math, tolerance 0.
 * The `van_stocks` mirror is read AS PERSISTED (the van services refresh it
 * inside their owning transactions); the `van-conservation-tie` assertion
 * compares it to Σ signed stock_moves and flags drift.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("distribution report query requires an ambient tenant scope");
  }
  return context.tx;
}

function idsScopeSql(
  ids: readonly string[] | null | undefined,
  column: string,
): ReturnType<typeof sql> {
  if (ids === null || ids === undefined || ids.length === 0) {
    return sql`TRUE`;
  }
  return sql`${sql.raw(column)} IN (${sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;
}

// -- distribution.rep_settlement ---------------------------------------------------

/** One rep-day settlement row (STL- document with its counted/expected cash). */
export interface RepSettlementReportRow {
  settlementId: string;
  settlementNo: string | null;
  settlementDate: string;
  repCode: string | null;
  repName: string | null;
  vanCode: string | null;
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
  depositAmount: string | null;
  /** Σ qty/value loaded onto the van that day (IN moves to the van warehouse). */
  loadOutQty: string;
  loadOutValue: string;
  varianceJournalNo: string | null;
  depositJournalNo: string | null;
  /** The settlement's component-line count (rep_settlement_lines ledger). */
  componentLineCount: number;
  /** Σ signed component lines — the service's identity: counted − deposit. */
  componentLinesTotal: string;
}

// -- distribution.route_visit_compliance --------------------------------------------

/** Planned vs actual visits per route with the sales per completed visit. */
export interface RouteComplianceRow {
  routeId: string;
  routeCode: string;
  routeName: string;
  repCode: string | null;
  repName: string | null;
  plannedCount: number;
  completedCount: number;
  skippedCount: number;
  missedCount: number;
  pendingCount: number;
  salesInvoiceCount: number;
  /** Σ total_gross of the POSTED invoices linked to completed visits (4dp). */
  salesTotal: string;
  /** Derived: salesTotal ÷ completedCount (4dp; 0 when none completed). */
  salesPerVisit: string;
}

// -- distribution.van_stock_balances -------------------------------------------------

/** One van (warehouse, item, batch) mirror row with ageing + expiry risk. */
export interface VanStockBalanceRow {
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  repCode: string | null;
  repName: string | null;
  itemId: string;
  sku: string;
  itemName: string;
  itemNameAr: string | null;
  batchId: string | null;
  batchNo: string | null;
  expiryDate: string | null;
  daysToExpiry: number | null;
  qty: string;
  value: string;
  /** The oldest inbound move date for this (van, item, batch) — ageing base. */
  oldestInbound: string | null;
  ageDays: number | null;
}

// -- sales.discount_management_effectiveness ------------------------------------------

/** FOC lines given vs the paid sales alongside, per reason × customer. */
export interface FocEffectivenessRow {
  reasonCode: string;
  customerCode: string | null;
  customerName: string | null;
  focLineCount: number;
  focQty: string;
  /** FOC lines are zero-price: their net revenue is 0 by construction. */
  focRevenue: string;
  /** The cost of the goods given away (Σ the FOC lines' issue values). */
  focCostValue: string;
  pairedInvoiceCount: number;
  pairedSalesQty: string;
  pairedSalesNet: string;
}

// -- sales.commissions_due ------------------------------------------------------------

/** One commission run line joined with its run and rep (payout state). */
export interface CommissionsDueRow {
  runId: string;
  periodFrom: string;
  periodTo: string;
  basis: string;
  runStatus: string;
  repCode: string;
  repName: string;
  baseAmount: string;
  rateApplied: string;
  commissionAmount: string;
  payoutStatus: string;
}

@Injectable()
export class DistributionQueriesService {
  /**
   * `distribution.rep_settlement`: every non-cancelled settlement in the
   * window with its expected-cash components, counted cash, BR-021
   * variance, the bank deposit leg, and the day's van load-out (Σ IN moves
   * to the settlement's van warehouse on the settlement date). The money
   * columns read the settlement header — the exact figures the GL tie
   * reconciles — while the component-lines ledger (rep_settlement_lines,
   * signed: Σ lines = counted − deposit) is exposed as the audit detail
   * (line count + signed total) so a stale line set is visible next to the
   * tied header numbers.
   */
  async repSettlement(input: {
    fromDate: string;
    toDate: string;
    repIds?: readonly string[] | null;
  }): Promise<RepSettlementReportRow[]> {
    const rows = await tenantTx().execute(sql`
      SELECT s.id AS "settlementId", s.settlement_no AS "settlementNo",
             s.settlement_date::text AS "settlementDate",
             rep.code AS "repCode", rep.name AS "repName", van.code AS "vanCode",
             s.status,
             s.opening_cash::text AS "openingCash", s.cash_sales::text AS "cashSales",
             s.collections::text AS "collections", s.cash_refunds::text AS "cashRefunds",
             s.rep_expenses::text AS "repExpenses", s.expected_cash::text AS "expectedCash",
             s.counted_cash::text AS "countedCash", s.variance::text AS "variance",
             s.variance_direction AS "varianceDirection", s.variance_reason AS "varianceReason",
             s.deposit_amount::text AS "depositAmount",
             COALESCE(load.qty, 0)::numeric(19,6)::text AS "loadOutQty",
             COALESCE(load.value, 0)::numeric(19,4)::text AS "loadOutValue",
             vje.entry_no AS "varianceJournalNo", dje.entry_no AS "depositJournalNo",
             COALESCE(comps.line_count, 0)::int AS "componentLineCount",
             COALESCE(comps.lines_total, 0)::numeric(19,4)::text AS "componentLinesTotal"
      FROM rep_settlements s
      LEFT JOIN sales_reps rep ON rep.id = s.sales_rep_id AND rep.tenant_id = s.tenant_id
      LEFT JOIN warehouses van ON van.id = s.van_warehouse_id AND van.tenant_id = s.tenant_id
      LEFT JOIN journal_entries vje ON vje.id = s.variance_journal_id AND vje.tenant_id = s.tenant_id
      LEFT JOIN journal_entries dje ON dje.id = s.deposit_journal_id AND dje.tenant_id = s.tenant_id
      LEFT JOIN LATERAL (
        SELECT SUM(m.qty) AS qty, SUM(m.value_amount) AS value
        FROM stock_moves m
        WHERE m.warehouse_id = s.van_warehouse_id
          AND m.direction = 'IN' AND m.moved_at = s.settlement_date
      ) load ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::int AS line_count, SUM(l.amount) AS lines_total
        FROM rep_settlement_lines l
        WHERE l.settlement_id = s.id
      ) comps ON true
      WHERE s.settlement_date BETWEEN ${input.fromDate} AND ${input.toDate}
        AND s.status <> 'CANCELLED'
        AND ${idsScopeSql(input.repIds, "s.sales_rep_id")}
      ORDER BY s.settlement_date, rep.code, s.created_at
      LIMIT 500
    `);
    return rows.rows as unknown as RepSettlementReportRow[];
  }

  /**
   * The `settlement-gl-tie`: register side (Σ |variance| + Σ deposits over
   * the window's settlements) vs GL side (Σ DEBITS of the same
   * settlements' variance + deposit journals — each variance journal's
   * debit leg is exactly |variance|, the deposit journal's debit leg
   * exactly the deposit). BR-021 discipline: the variance always posts,
   * never netted, so the tie catches any drift at tolerance 0.
   */
  async settlementGlTie(input: {
    fromDate: string;
    toDate: string;
    repIds?: readonly string[] | null;
  }): Promise<{ registerSide: string; glSide: string }> {
    const registerRows = await tenantTx().execute(sql`
      SELECT (COALESCE(SUM(ABS(s.variance)), 0) + COALESCE(SUM(s.deposit_amount), 0))::numeric(19,4)::text AS total
      FROM rep_settlements s
      WHERE s.settlement_date BETWEEN ${input.fromDate} AND ${input.toDate}
        AND s.status = 'POSTED'
        AND ${idsScopeSql(input.repIds, "s.sales_rep_id")}
    `);
    const glRows = await tenantTx().execute(sql`
      SELECT COALESCE(SUM(l.amount), 0)::numeric(19,4)::text AS total
      FROM journal_lines l
      JOIN journal_entries e ON e.id = l.journal_entry_id AND e.tenant_id = l.tenant_id
      WHERE e.source_type = 'rep_settlement' AND e.operation IN ('variance', 'deposit')
        AND e.status = 'POSTED'
        AND e.entry_date BETWEEN ${input.fromDate} AND ${input.toDate}
        AND l.direction = 'DEBIT'
        AND e.source_id IN (
          SELECT s.id FROM rep_settlements s
          WHERE s.settlement_date BETWEEN ${input.fromDate} AND ${input.toDate}
            AND s.status = 'POSTED'
            AND ${idsScopeSql(input.repIds, "s.sales_rep_id")}
        )
    `);
    return {
      registerSide: (registerRows.rows[0] as { total: string }).total,
      glSide: (glRows.rows[0] as { total: string }).total,
    };
  }

  /**
   * `distribution.route_visit_compliance`: planned vs actual visits per
   * route over the window (by planned_date) with the sales generated by the
   * completed visits (Σ total_gross of their linked POSTED invoices).
   * Planning data only — CAPABILITY_MATRIX §2.4; no GL assertion applies
   * (the README rule-2 note: the invoice figures themselves are the ones
   * the sales reports reconcile).
   */
  async routeVisitCompliance(input: {
    fromDate: string;
    toDate: string;
    routeIds?: readonly string[] | null;
  }): Promise<RouteComplianceRow[]> {
    const rows = await tenantTx().execute(sql`
      SELECT r.id AS "routeId", r.code AS "routeCode", r.name AS "routeName",
             rep.code AS "repCode", rep.name AS "repName",
             count(*)::int AS "plannedCount",
             count(*) FILTER (WHERE v.status = 'COMPLETED')::int AS "completedCount",
             count(*) FILTER (WHERE v.status = 'SKIPPED')::int AS "skippedCount",
             count(*) FILTER (WHERE v.status = 'MISSED')::int AS "missedCount",
             count(*) FILTER (WHERE v.status = 'PLANNED')::int AS "pendingCount",
             count(v.sales_invoice_id)::int AS "salesInvoiceCount",
             COALESCE(SUM(si.total_gross), 0)::numeric(19,4)::text AS "salesTotal"
      FROM route_visits v
      JOIN routes r ON r.id = v.route_id AND r.tenant_id = v.tenant_id
      LEFT JOIN sales_reps rep ON rep.id = r.sales_rep_id AND rep.tenant_id = r.tenant_id
      LEFT JOIN sales_invoices si
        ON si.id = v.sales_invoice_id AND si.tenant_id = v.tenant_id AND si.status = 'POSTED'
      WHERE v.planned_date BETWEEN ${input.fromDate} AND ${input.toDate}
        AND ${idsScopeSql(input.routeIds, "v.route_id")}
      GROUP BY r.id, r.code, r.name, rep.code, rep.name
      ORDER BY r.code
      LIMIT 200
    `);
    const raw = rows.rows as unknown as Omit<RouteComplianceRow, "salesPerVisit">[];
    return raw.map((row) => ({
      ...row,
      salesPerVisit: divideExact(row.salesTotal, row.completedCount),
    }));
  }

  /**
   * `distribution.van_stock_balances`: the van_stocks mirror per (van,
   * item, batch) joined with the batch expiry (risk) and the oldest
   * inbound move date (ageing). Read AS PERSISTED — the van services
   * refresh the mirror inside their owning transactions; the
   * `van-conservation-tie` assertion is the drift check.
   */
  async vanStockBalances(input: {
    warehouseIds?: readonly string[] | null;
  }): Promise<VanStockBalanceRow[]> {
    const rows = await tenantTx().execute(sql`
      SELECT vs.warehouse_id AS "warehouseId", w.code AS "warehouseCode", w.name AS "warehouseName",
             rep.code AS "repCode", rep.name AS "repName",
             vs.item_id AS "itemId", i.sku, i.name AS "itemName", i.name_ar AS "itemNameAr",
             vs.batch_id AS "batchId", b.batch_no AS "batchNo", b.expiry_date::text AS "expiryDate",
             CASE WHEN b.expiry_date IS NULL THEN NULL
                  ELSE (b.expiry_date - CURRENT_DATE)::int END AS "daysToExpiry",
             vs.qty::text AS qty, vs.value::text AS value,
             age.oldest::text AS "oldestInbound",
             CASE WHEN age.oldest IS NULL THEN NULL
                  ELSE (CURRENT_DATE - age.oldest)::int END AS "ageDays"
      FROM van_stocks vs
      JOIN warehouses w ON w.id = vs.warehouse_id AND w.tenant_id = vs.tenant_id AND w.type = 'VAN'
      LEFT JOIN sales_reps rep ON rep.id = w.rep_id AND rep.tenant_id = w.tenant_id
      JOIN items i ON i.id = vs.item_id AND i.tenant_id = vs.tenant_id
      LEFT JOIN item_batches b ON b.id = vs.batch_id AND b.tenant_id = vs.tenant_id
      LEFT JOIN LATERAL (
        SELECT MIN(m.moved_at) AS oldest
        FROM stock_moves m
        WHERE m.warehouse_id = vs.warehouse_id AND m.item_id = vs.item_id
          AND m.direction = 'IN'
          AND (m.batch_id = vs.batch_id OR (m.batch_id IS NULL AND vs.batch_id IS NULL))
      ) age ON true
      WHERE ${idsScopeSql(input.warehouseIds, "vs.warehouse_id")}
      ORDER BY w.code, i.sku, b.batch_no NULLS FIRST
      LIMIT 1000
    `);
    return rows.rows as unknown as VanStockBalanceRow[];
  }

  /**
   * The `van-conservation-tie`: Σ mirror qty over the (scoped) VAN
   * warehouses vs Σ signed stock_moves qty over the same warehouses — the
   * INV-010-shaped conservation check (stock_moves is the source of truth;
   * the mirror must net to exactly the same quantity).
   */
  async vanConservationTie(input: {
    warehouseIds?: readonly string[] | null;
  }): Promise<{ mirrorSide: string; movesSide: string }> {
    const mirrorRows = await tenantTx().execute(sql`
      SELECT COALESCE(SUM(vs.qty), 0)::numeric(19,6)::text AS total
      FROM van_stocks vs
      JOIN warehouses w ON w.id = vs.warehouse_id AND w.tenant_id = vs.tenant_id AND w.type = 'VAN'
      WHERE ${idsScopeSql(input.warehouseIds, "vs.warehouse_id")}
    `);
    const movesRows = await tenantTx().execute(sql`
      SELECT COALESCE(SUM(CASE WHEN m.direction = 'IN' THEN m.qty ELSE -m.qty END), 0)::numeric(19,6)::text AS total
      FROM stock_moves m
      JOIN warehouses w ON w.id = m.warehouse_id AND w.tenant_id = m.tenant_id AND w.type = 'VAN'
      WHERE ${idsScopeSql(input.warehouseIds, "m.warehouse_id")}
    `);
    return {
      mirrorSide: (mirrorRows.rows[0] as { total: string }).total,
      movesSide: (movesRows.rows[0] as { total: string }).total,
    };
  }

  /**
   * `sales.discount_management_effectiveness`: FOC lines given (by
   * foc_reason_code × customer) against the paid sales alongside — the
   * paired figures aggregate the non-FOC lines of the very invoices that
   * carried the FOC lines, so the uplift comparison is per promotion and
   * per customer. BR-008: FOC lines are zero-price (net 0) but still issue
   * stock and post COGS — focCostValue is that cost.
   */
  async discountEffectiveness(input: {
    fromDate: string;
    toDate: string;
  }): Promise<FocEffectivenessRow[]> {
    const rows = await tenantTx().execute(sql`
      WITH foc AS (
        SELECT sil.foc_reason_code AS reason, si.customer_id,
               count(*)::int AS "focLineCount",
               SUM(sil.qty)::numeric(19,6)::text AS "focQty",
               COALESCE(SUM(sil.net_amount), 0)::numeric(19,4)::text AS "focRevenue",
               COALESCE(SUM(sil.issue_value), 0)::numeric(19,4)::text AS "focCostValue",
               array_agg(DISTINCT si.id) AS invoice_ids
        FROM sales_invoice_lines sil
        JOIN sales_invoices si ON si.id = sil.invoice_id AND si.tenant_id = sil.tenant_id
        WHERE sil.foc_reason_code IS NOT NULL
          AND si.status = 'POSTED'
          AND si.invoice_date BETWEEN ${input.fromDate} AND ${input.toDate}
        GROUP BY sil.foc_reason_code, si.customer_id
      )
      SELECT f.reason AS "reasonCode",
             p.code AS "customerCode", p.name AS "customerName",
             f."focLineCount", f."focQty", f."focRevenue", f."focCostValue",
             COALESCE(paid.invoice_count, 0)::int AS "pairedInvoiceCount",
             COALESCE(paid.paired_qty, 0)::numeric(19,6)::text AS "pairedSalesQty",
             COALESCE(paid.paired_net, 0)::numeric(19,4)::text AS "pairedSalesNet"
      FROM foc f
      LEFT JOIN partners p ON p.id = f.customer_id
      LEFT JOIN LATERAL (
        SELECT count(DISTINCT si2.id)::int AS invoice_count,
               COALESCE(SUM(sil2.qty), 0)::numeric(19,6) AS paired_qty,
               COALESCE(SUM(sil2.net_amount), 0)::numeric(19,4) AS paired_net
        FROM sales_invoices si2
        JOIN sales_invoice_lines sil2 ON sil2.invoice_id = si2.id AND sil2.tenant_id = si2.tenant_id
        WHERE si2.id IN (SELECT unnest(f.invoice_ids))
          AND (sil2.foc_reason_code IS NULL OR sil2.foc_reason_code <> f.reason)
      ) paid ON true
      ORDER BY f.reason, p.code
      LIMIT 500
    `);
    return rows.rows as unknown as FocEffectivenessRow[];
  }

  /**
   * `sales.commissions_due`: every commission run line of the non-cancelled
   * runs whose period ends in the window, joined with the run (basis,
   * status) and the rep — the payout-state statement. DRAFT runs show as
   * computed-but-unaccrued; the total tie covers the POSTED ones.
   */
  async commissionsDue(input: {
    fromDate: string;
    toDate: string;
  }): Promise<CommissionsDueRow[]> {
    const rows = await tenantTx().execute(sql`
      SELECT r.id AS "runId", r.period_from::text AS "periodFrom", r.period_to::text AS "periodTo",
             r.basis, r.status AS "runStatus",
             rep.code AS "repCode", rep.name AS "repName",
             l.base_amount::text AS "baseAmount", l.rate_applied::text AS "rateApplied",
             l.commission_amount::text AS "commissionAmount", l.payout_status AS "payoutStatus"
      FROM commission_run_lines l
      JOIN commission_runs r ON r.id = l.run_id AND r.tenant_id = l.tenant_id
      JOIN sales_reps rep ON rep.id = l.sales_rep_id AND rep.tenant_id = l.tenant_id
      WHERE r.status <> 'CANCELLED'
        AND r.period_to BETWEEN ${input.fromDate} AND ${input.toDate}
      ORDER BY r.period_from, rep.code
      LIMIT 1000
    `);
    return rows.rows as unknown as CommissionsDueRow[];
  }

  /**
   * The `commissions-total-tie`: register side (Σ commission_amount of the
   * POSTED runs' lines whose period ends in the window) vs GL side (Σ
   * DEBITS on the COMMISSION_EXPENSE accounts of the same runs' accrual
   * journals — one debit per earning rep, entry_date = the run's
   * period_to). Exact at tolerance 0.
   */
  async commissionsTotalTie(input: {
    fromDate: string;
    toDate: string;
  }): Promise<{ registerSide: string; glSide: string }> {
    const registerRows = await tenantTx().execute(sql`
      SELECT COALESCE(SUM(l.commission_amount), 0)::numeric(19,4)::text AS total
      FROM commission_run_lines l
      JOIN commission_runs r ON r.id = l.run_id AND r.tenant_id = l.tenant_id
      WHERE r.status = 'POSTED'
        AND r.period_to BETWEEN ${input.fromDate} AND ${input.toDate}
    `);
    const expenseAccounts = await journal.accountsForPurposes(["COMMISSION_EXPENSE"]);
    let gl = "0.0000";
    if (expenseAccounts.length > 0) {
      const glRows = await tenantTx().execute(sql`
        SELECT COALESCE(SUM(l.amount), 0)::numeric(19,4)::text AS total
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l.journal_entry_id AND e.tenant_id = l.tenant_id
        WHERE e.source_type = 'commission_run' AND e.operation = 'accrual'
          AND e.status = 'POSTED'
          AND e.entry_date BETWEEN ${input.fromDate} AND ${input.toDate}
          AND l.direction = 'DEBIT'
          AND l.account_id IN (${sql.join(
            expenseAccounts.map((a) => sql`${a.accountId}`),
            sql`, `,
          )})
      `);
      gl = (glRows.rows[0] as { total: string }).total;
    }
    return {
      registerSide: (registerRows.rows[0] as { total: string }).total,
      glSide: gl,
    };
  }
}

/** salesTotal ÷ completedCount at 4dp (0 when no completed visit). */
function divideExact(total: string, completedCount: number): string {
  if (completedCount <= 0) return "0.0000";
  return new Decimal(total).div(new Decimal(completedCount)).toDecimalPlaces(4).toFixed(4);
}
