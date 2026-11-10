import { sql, type SQL } from "drizzle-orm";

import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-016 T12 · the POS query surface consumed by the report contracts
 * (`pos.sales_by_terminal`, `pos.sales_by_hour`,
 * `treasury.shift_cash_reconciliation`): read-only derivations over
 * POSTED POS invoices + the shift record — the Z report's report-contract
 * twins. Every figure ties to journal lines through the invoice chain
 * (the same GL tie-out the sales reports assert).
 */

export interface PosByTerminalRow {
  terminalId: string;
  terminalCode: string;
  invoiceCount: number;
  totalNet: string;
  totalTax: string;
  totalGross: string;
}

export interface PosByHourRow {
  hour: string;
  invoiceCount: number;
  totalGross: string;
}

export interface ShiftCashRow {
  shiftId: string;
  shiftNo: string | null;
  terminalCode: string | null;
  status: string;
  openingAmount: string;
  capturedIn: string;
  capturedOut: string;
  expectedAmount: string | null;
  countedAmount: string | null;
  difference: string | null;
  posGross: string;
  posInvoiceCount: number;
}

function branchScopeFilter(ids: readonly string[] | null, column: SQL): SQL {
  if (ids === null || ids === undefined) {
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

export class PosQueriesService {
  /** Sales by terminal for a window (channel='POS', POSTED only). */
  async salesByTerminal(input: {
    fromDate: string;
    toDate: string;
    branchIds?: readonly string[] | null;
  }): Promise<PosByTerminalRow[]> {
    const tx = requireTenantContext().tx!;
    const rows = await tx.execute(sql`
      SELECT i.pos_terminal_id AS "terminalId", COALESCE(t.code, '—') AS "terminalCode",
             count(*)::int AS "invoiceCount",
             COALESCE(SUM(i.total_net), 0)::text AS "totalNet",
             COALESCE(SUM(i.total_tax), 0)::text AS "totalTax",
             COALESCE(SUM(i.total_gross), 0)::text AS "totalGross"
      FROM sales_invoices i
      LEFT JOIN pos_terminals t ON t.id = i.pos_terminal_id AND t.tenant_id = i.tenant_id
      WHERE i.channel = 'POS' AND i.status = 'POSTED'
        AND i.invoice_date BETWEEN ${input.fromDate} AND ${input.toDate}
        AND ${branchScopeFilter(input.branchIds ?? null, sql`i.branch_id`)}
      GROUP BY i.pos_terminal_id, t.code
      ORDER BY t.code NULLS LAST
    `);
    return rows.rows as unknown as PosByTerminalRow[];
  }

  /**
   * The GL tie-out (the report assertion input): the POS document side is
   * Σ total_gross of posted POS invoices; the GL side is Σ debits on the
   * settlement legs (till cash + CARD_RECEIVABLE) of the same postings.
   */
  async terminalTotalsGlTie(input: {
    fromDate: string;
    toDate: string;
  }): Promise<{ documentSide: string; glSide: string }> {
    const tx = requireTenantContext().tx!;
    const documentRows = await tx.execute(sql`
      SELECT COALESCE(SUM(i.total_gross), 0)::text AS total
      FROM sales_invoices i
      WHERE i.channel = 'POS' AND i.status = 'POSTED'
        AND i.invoice_date BETWEEN ${input.fromDate} AND ${input.toDate}
    `);
    const glRows = await tx.execute(sql`
      SELECT COALESCE(SUM(jl.amount), 0)::text AS total
      FROM journal_lines jl
      JOIN journal_entries je ON je.id = jl.journal_entry_id AND je.tenant_id = jl.tenant_id
      WHERE je.source_type = 'sales_invoice' AND je.operation = 'post'
        AND je.status = 'POSTED'
        AND je.entry_date BETWEEN ${input.fromDate} AND ${input.toDate}
        AND jl.direction = 'DEBIT'
        AND EXISTS (
          SELECT 1 FROM sales_invoices i
          WHERE i.posted_journal_id = je.id AND i.channel = 'POS'
        )
    `);
    return {
      documentSide: String((documentRows.rows as unknown as { total: string }[])[0]?.total ?? "0"),
      glSide: String((glRows.rows as unknown as { total: string }[])[0]?.total ?? "0"),
    };
  }

  /** Sales by hour-of-day (created_at hour, server clock). */
  async salesByHour(input: {
    fromDate: string;
    toDate: string;
    branchIds?: readonly string[] | null;
  }): Promise<PosByHourRow[]> {
    const tx = requireTenantContext().tx!;
    const rows = await tx.execute(sql`
      SELECT to_char(i.created_at, 'HH24') AS hour,
             count(*)::int AS "invoiceCount",
             COALESCE(SUM(i.total_gross), 0)::text AS "totalGross"
      FROM sales_invoices i
      WHERE i.channel = 'POS' AND i.status = 'POSTED'
        AND i.invoice_date BETWEEN ${input.fromDate} AND ${input.toDate}
        AND ${branchScopeFilter(input.branchIds ?? null, sql`i.branch_id`)}
      GROUP BY hour ORDER BY hour
    `);
    return rows.rows as unknown as PosByHourRow[];
  }

  /** Shift cash reconciliation: every shift in the window joined with the
   * POS gross that flowed through its till (the Z report's tie-out twin —
   * the difference column is the BR-021 variance, never netted). */
  async shiftCashReconciliation(input: {
    fromDate: string;
    toDate: string;
  }): Promise<ShiftCashRow[]> {
    const tx = requireTenantContext().tx!;
    const rows = await tx.execute(sql`
      SELECT s.id AS "shiftId", s.shift_no AS "shiftNo", t.code AS "terminalCode",
             s.status,
             s.opening_amount::text AS "openingAmount",
             s.captured_in::text AS "capturedIn",
             s.captured_out::text AS "capturedOut",
             s.expected_amount::text AS "expectedAmount",
             s.counted_amount::text AS "countedAmount",
             s.difference::text AS difference,
             COALESCE(p.gross, 0)::text AS "posGross",
             COALESCE(p.cnt, 0)::int AS "posInvoiceCount"
      FROM cashier_shifts s
      LEFT JOIN pos_terminals t ON t.id = s.pos_terminal_id AND t.tenant_id = s.tenant_id
      LEFT JOIN (
        SELECT i.cash_account_id AS acct,
               SUM(i.total_gross) AS gross,
               count(*) AS cnt
        FROM sales_invoices i
        WHERE i.channel = 'POS' AND i.status = 'POSTED'
          AND i.invoice_date BETWEEN ${input.fromDate} AND ${input.toDate}
        GROUP BY i.cash_account_id
      ) p ON p.acct = s.cash_account_id
      WHERE s.opened_at::date BETWEEN ${input.fromDate} AND ${input.toDate}
      ORDER BY s.opened_at DESC
      LIMIT 200
    `);
    return rows.rows as unknown as ShiftCashRow[];
  }
}
