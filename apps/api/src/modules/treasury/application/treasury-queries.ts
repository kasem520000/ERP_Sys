import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

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
 * PHASE-013 · treasury report queries (REPORT_CATALOG §5): daily cash
 * flow, receipts/payments registers, petty cash, expenses, shifts, bank
 * reconciliation status, FX differences — plus the per-account INV-019
 * tie (cash account GL balance == Σ cash movements) the cash reports
 * assert in the footer.
 */

export interface DailyFlowRow {
  flowDate: string;
  cashAccountCode: string;
  inflow: string;
  outflow: string;
  net: string;
}

export interface RegisterRow {
  docId: string;
  docNo: string;
  valueDate: string;
  partnerName: string | null;
  method: string;
  currencyCode: string;
  amount: string;
  baseAmount: string;
  allocatedAmount: string;
  status: string;
}

export interface ShiftReportRow {
  shiftId: string;
  shiftNo: string;
  cashAccountCode: string;
  status: string;
  openingAmount: string;
  expectedAmount: string;
  countedAmount: string;
  difference: string;
  openedAt: string;
  closedAt: string | null;
}

export interface BankReconRow {
  statementId: string;
  cashAccountCode: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  lineCount: number;
  reconciledAt: string | null;
}

export interface CashTieRow {
  accountId: string;
  accountCode: string;
  glBalance: string;
  movementsTotal: string;
}

@Injectable()
export class TreasuryQueriesService {
  /** Daily cash flow per account over POSTED receipts/payments/expenses. */
  async dailyFlow(input: {
    fromDate: string;
    toDate: string;
  }): Promise<DailyFlowRow[]> {
    const rows = await tenantTx().execute(sql`
      WITH flows AS (
        SELECT r.value_date AS d, ca.account_id AS acct,
               (r.amount * r.exchange_rate) AS amt, 'IN' AS dir
        FROM receipts r JOIN cash_accounts ca ON ca.id = r.cash_account_id
        WHERE r.status = 'POSTED' AND r.value_date BETWEEN ${input.fromDate} AND ${input.toDate}
        UNION ALL
        SELECT p.value_date, ca.account_id, (p.amount * p.exchange_rate), 'OUT'
        FROM payments p JOIN cash_accounts ca ON ca.id = p.cash_account_id
        WHERE p.status = 'POSTED' AND p.value_date BETWEEN ${input.fromDate} AND ${input.toDate}
        UNION ALL
        SELECT e.value_date, ca.account_id, (e.amount * e.exchange_rate), 'OUT'
        FROM expenses e JOIN cash_accounts ca ON ca.id = e.cash_account_id
        WHERE e.status = 'POSTED' AND e.value_date BETWEEN ${input.fromDate} AND ${input.toDate}
      )
      SELECT f.d::text AS "flowDate", a.code AS "cashAccountCode",
             SUM(CASE WHEN f.dir = 'IN' THEN f.amt ELSE 0 END)::text AS inflow,
             SUM(CASE WHEN f.dir = 'OUT' THEN f.amt ELSE 0 END)::text AS outflow,
             SUM(CASE WHEN f.dir = 'IN' THEN f.amt ELSE -f.amt END)::text AS net
      FROM flows f JOIN accounts a ON a.id = f.acct
      GROUP BY f.d, a.code
      ORDER BY f.d, a.code
    `);
    return rows.rows as unknown as DailyFlowRow[];
  }

  /** Receipts register (the AR money leg). */
  async receiptsRegister(input: {
    fromDate: string;
    toDate: string;
  }): Promise<RegisterRow[]> {
    const rows = await tenantTx().execute(sql`
      SELECT r.id AS "docId", r.receipt_no AS "docNo", r.value_date::text AS "valueDate",
             p.name AS "partnerName", r.method, r.currency_code AS "currencyCode",
             r.amount::text AS amount, (r.amount * r.exchange_rate)::text AS "baseAmount",
             r.allocated_amount::text AS "allocatedAmount", r.status
      FROM receipts r LEFT JOIN partners p ON p.id = r.partner_id
      WHERE r.value_date BETWEEN ${input.fromDate} AND ${input.toDate}
      ORDER BY r.value_date, r.receipt_no
      LIMIT 5000
    `);
    return rows.rows as unknown as RegisterRow[];
  }

  /** Payments register (the AP money leg). */
  async paymentsRegister(input: {
    fromDate: string;
    toDate: string;
  }): Promise<RegisterRow[]> {
    const rows = await tenantTx().execute(sql`
      SELECT p.id AS "docId", p.payment_no AS "docNo", p.value_date::text AS "valueDate",
             pt.name AS "partnerName", p.method, p.currency_code AS "currencyCode",
             p.amount::text AS amount, (p.amount * p.exchange_rate)::text AS "baseAmount",
             p.allocated_amount::text AS "allocatedAmount", p.status
      FROM payments p LEFT JOIN partners pt ON pt.id = p.partner_id
      WHERE p.value_date BETWEEN ${input.fromDate} AND ${input.toDate}
      ORDER BY p.value_date, p.payment_no
      LIMIT 5000
    `);
    return rows.rows as unknown as RegisterRow[];
  }

  /** Petty-cash account flows (the BR-020 fund scope). */
  async pettyCash(input: {
    fromDate: string;
    toDate: string;
  }): Promise<DailyFlowRow[]> {
    const rows = await tenantTx().execute(sql`
      WITH flows AS (
        SELECT r.value_date AS d, ca.account_id AS acct,
               (r.amount * r.exchange_rate) AS amt, 'IN' AS dir
        FROM receipts r JOIN cash_accounts ca ON ca.id = r.cash_account_id
        WHERE ca.type = 'PETTY' AND r.status = 'POSTED'
          AND r.value_date BETWEEN ${input.fromDate} AND ${input.toDate}
        UNION ALL
        SELECT p.value_date, ca.account_id, (p.amount * p.exchange_rate), 'OUT'
        FROM payments p JOIN cash_accounts ca ON ca.id = p.cash_account_id
        WHERE ca.type = 'PETTY' AND p.status = 'POSTED'
          AND p.value_date BETWEEN ${input.fromDate} AND ${input.toDate}
        UNION ALL
        SELECT e.value_date, ca.account_id, (e.amount * e.exchange_rate), 'OUT'
        FROM expenses e JOIN cash_accounts ca ON ca.id = e.cash_account_id
        WHERE ca.type = 'PETTY' AND e.status = 'POSTED'
          AND e.value_date BETWEEN ${input.fromDate} AND ${input.toDate}
      )
      SELECT f.d::text AS "flowDate", a.code AS "cashAccountCode",
             SUM(CASE WHEN f.dir = 'IN' THEN f.amt ELSE 0 END)::text AS inflow,
             SUM(CASE WHEN f.dir = 'OUT' THEN f.amt ELSE 0 END)::text AS outflow,
             SUM(CASE WHEN f.dir = 'IN' THEN f.amt ELSE -f.amt END)::text AS net
      FROM flows f JOIN accounts a ON a.id = f.acct
      GROUP BY f.d, a.code
      ORDER BY f.d, a.code
    `);
    return rows.rows as unknown as DailyFlowRow[];
  }

  /** Expenses analysis by category over POSTED expenses. */
  async expenses(input: {
    fromDate: string;
    toDate: string;
  }): Promise<
    { categoryId: string | null; categoryName: string; categoryNameAr: string | null; count: number; total: string }[]
  > {
    const rows = await tenantTx().execute(sql`
      SELECT e.category_id AS "categoryId", c.name AS "categoryName", c.name_ar AS "categoryNameAr",
             COUNT(*)::int AS count, SUM(e.amount * e.exchange_rate)::text AS total
      FROM expenses e LEFT JOIN expense_categories c ON c.id = e.category_id
      WHERE e.status = 'POSTED' AND e.value_date BETWEEN ${input.fromDate} AND ${input.toDate}
      GROUP BY e.category_id, c.name, c.name_ar
      ORDER BY SUM(e.amount * e.exchange_rate) DESC
    `);
    return rows.rows as unknown as {
      categoryId: string | null;
      categoryName: string;
      categoryNameAr: string | null;
      count: number;
      total: string;
    }[];
  }

  /** Shifts report (BR-021 variance surface). */
  async shifts(input: {
    fromDate: string;
    toDate: string;
  }): Promise<ShiftReportRow[]> {
    const rows = await tenantTx().execute(sql`
      SELECT s.id AS "shiftId", s.shift_no AS "shiftNo", a.code AS "cashAccountCode",
             s.status, s.opening_amount::text AS "openingAmount",
             s.expected_amount::text AS "expectedAmount",
             s.counted_amount::text AS "countedAmount", s.difference::text AS difference,
             s.opened_at::text AS openedAt, s.closed_at::text AS closedAt
      FROM cashier_shifts s JOIN cash_accounts ca ON ca.id = s.cash_account_id
      JOIN accounts a ON a.id = ca.account_id
      WHERE s.opened_at::date BETWEEN ${input.fromDate} AND ${input.toDate}
      ORDER BY s.opened_at DESC
      LIMIT 1000
    `);
    return rows.rows as unknown as ShiftReportRow[];
  }

  /** Bank reconciliation status per statement. */
  async bankReconStatus(input: {
    fromDate: string;
    toDate: string;
  }): Promise<BankReconRow[]> {
    const rows = await tenantTx().execute(sql`
      SELECT b.id AS "statementId", a.code AS "cashAccountCode",
             b.period_start::text AS "periodStart", b.period_end::text AS "periodEnd",
             b.status, b.line_count::int AS "lineCount", b.reconciled_at::text AS "reconciledAt"
      FROM bank_statements b JOIN cash_accounts ca ON ca.id = b.cash_account_id
      JOIN accounts a ON a.id = ca.account_id
      WHERE b.period_end BETWEEN ${input.fromDate} AND ${input.toDate}
      ORDER BY b.period_end DESC
      LIMIT 500
    `);
    return rows.rows as unknown as BankReconRow[];
  }

  /**
   * The per-account INV-019 tie: each cash/bank account's GL balance ==
   * Σ its POSTED money-document movements (base, exact decimals).
   */
  async cashTies(input: { asOf: string }): Promise<CashTieRow[]> {
    const rows = await tenantTx().execute(sql`
      WITH acct AS (
        SELECT ca.id, ca.account_id FROM cash_accounts ca WHERE ca.status = 'ACTIVE'
      ), mov AS (
        SELECT a.account_id AS gl_account_id,
               SUM(CASE WHEN r.status = 'POSTED' AND r.value_date <= ${input.asOf}
                 THEN (r.amount * r.exchange_rate) ELSE 0 END) AS inflow
        FROM acct a LEFT JOIN receipts r ON r.cash_account_id = a.id
        GROUP BY a.account_id
      ), pay AS (
        SELECT a.account_id AS gl_account_id,
               SUM(CASE WHEN p.status = 'POSTED' AND p.value_date <= ${input.asOf}
                 THEN (p.amount * p.exchange_rate) ELSE 0 END) AS outflow
        FROM acct a LEFT JOIN payments p ON p.cash_account_id = a.id
        GROUP BY a.account_id
      ), exp AS (
        SELECT a.account_id AS gl_account_id,
               SUM(CASE WHEN e.status = 'POSTED' AND e.value_date <= ${input.asOf}
                 THEN (e.amount * e.exchange_rate) ELSE 0 END) AS expensed
        FROM acct a LEFT JOIN expenses e ON e.cash_account_id = a.id
        GROUP BY a.account_id
      )
      SELECT g.id AS "accountId", g.code AS "accountCode",
             bal.balance::text AS "glBalance",
             (COALESCE(mov.inflow, 0) - COALESCE(pay.outflow, 0) - COALESCE(exp.expensed, 0))::text AS "movementsTotal"
      FROM accounts g
      JOIN mov ON mov.gl_account_id = g.id
      JOIN pay ON pay.gl_account_id = g.id
      JOIN exp ON exp.gl_account_id = g.id
      LEFT JOIN LATERAL (
        SELECT SUM(CASE WHEN l.direction = 'DEBIT' THEN l.base_amount ELSE -l.base_amount END) AS balance
        FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
        WHERE l.account_id = g.id AND e.entry_date <= ${input.asOf}
      ) bal ON TRUE
      ORDER BY g.code
    `);
    return rows.rows as unknown as CashTieRow[];
  }
}
