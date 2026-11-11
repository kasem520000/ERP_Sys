import { sql } from "drizzle-orm";

import type { TenantDb } from "../../../../infra/db/client";
import { requireTenantContext } from "../../../../infra/db/tenant-context";

/**
 * PHASE-039 · the returns + collections query surface for the report
 * contracts (REPORT_CATALOG §3 additions): the unified RMA register (BOTH
 * families — customer 0055 + supplier 0059 — one row per authorization,
 * completion document numbers + cycle days) and the dunning status report
 * (every overdue open item with its ladder position, policy, fee register
 * and referral state — the collections worklist). Read-only over the
 * ambient tenant transaction (the registry query-service convention).
 */

export interface RmaRegisterRow {
  rmaId: string;
  rmaNo: string | null;
  rmaDate: string;
  partner: string;
  family: "CUSTOMER" | "SUPPLIER";
  status: string;
  disposition: string | null;
  lines: number;
  net: string;
  total: string;
  currencyCode: string;
  docNo: string | null;
  cycleDays: number | null;
}

export interface DunningStatusRow {
  invoiceId: string;
  invoiceNo: string | null;
  partner: string;
  dueDate: string;
  daysOverdue: number;
  outstanding: string;
  currencyCode: string;
  dunningStep: number | null;
  policyName: string | null;
  feeCharged: string;
  feeWaived: number;
  referralStatus: string | null;
}

export class ReturnsDunningQueriesService {
  /** The unified RMA register (customer + supplier families, windowed by
   * the request date; family ALL folds both). */
  async rmaRegister(params: {
    dateFrom: string;
    dateTo: string;
    family: "CUSTOMER" | "SUPPLIER" | "ALL";
  }): Promise<RmaRegisterRow[]> {
    const tx = tenantTx();
    const family = params.family;
    const customer =
      family === "ALL" || family === "CUSTOMER"
        ? await tx.execute(sql`
            SELECT r.id AS "rmaId", r.rma_no AS "rmaNo", r.requested_at::date::text AS "rmaDate",
                   p.code || ' — ' || p.name AS partner, 'CUSTOMER' AS family, r.status,
                   r.disposition,
                   (SELECT count(*)::int FROM return_authorization_lines l WHERE l.rma_id = r.id) AS lines,
                   r.total_net::text AS net, r.total_gross::text AS total, r.currency_code AS "currencyCode",
                   cn.note_no AS "docNo",
                   CASE WHEN r.completed_at IS NULL THEN NULL
                        ELSE (r.completed_at::date - r.requested_at::date)::int END AS "cycleDays"
            FROM return_authorizations r
            JOIN partners p ON p.id = r.partner_id
            LEFT JOIN credit_notes cn ON cn.id = r.credit_note_id
            WHERE r.requested_at::date BETWEEN ${params.dateFrom} AND ${params.dateTo}
            ORDER BY r.requested_at, r.id
          `)
        : { rows: [] };
    const supplier =
      family === "ALL" || family === "SUPPLIER"
        ? await tx.execute(sql`
            SELECT s.id AS "rmaId", s.srma_no AS "rmaNo", s.requested_at::date::text AS "rmaDate",
                   p.code || ' — ' || p.name AS partner, 'SUPPLIER' AS family, s.status,
                   NULL AS disposition,
                   (SELECT count(*)::int FROM supplier_return_authorization_lines l WHERE l.srma_id = s.id) AS lines,
                   s.total_net::text AS net, s.total_gross::text AS total, s.currency_code AS "currencyCode",
                   dn.note_no AS "docNo",
                   CASE WHEN s.credited_at IS NULL THEN NULL
                        ELSE (s.credited_at::date - s.requested_at::date)::int END AS "cycleDays"
            FROM supplier_return_authorizations s
            JOIN partners p ON p.id = s.supplier_id
            LEFT JOIN debit_notes dn ON dn.id = s.debit_note_id
            WHERE s.requested_at::date BETWEEN ${params.dateFrom} AND ${params.dateTo}
            ORDER BY s.requested_at, s.id
          `)
        : { rows: [] };
    return [
      ...(customer.rows as unknown as RmaRegisterRow[]),
      ...(supplier.rows as unknown as RmaRegisterRow[]),
    ].sort((a, b) =>
      a.rmaDate === b.rmaDate ? (a.rmaId < b.rmaId ? -1 : 1) : a.rmaDate < b.rmaDate ? -1 : 1,
    );
  }

  /** The collections worklist: every overdue open item with its ladder
   * position (max step + the policy that fired it), the late-fee register
   * totals, and the latest referral state per invoice. */
  async dunningStatus(asOf: string): Promise<DunningStatusRow[]> {
    const tx = tenantTx();
    const rows = await tx.execute(sql`
      SELECT i.id AS "invoiceId", i.invoice_no AS "invoiceNo",
             p.code || ' — ' || p.name AS partner,
             i.due_date::text AS "dueDate",
             (${asOf}::date - i.due_date::date)::int AS "daysOverdue",
             o.outstanding::text, i.currency_code AS "currencyCode",
             ladder.step AS "dunningStep", ladder.policy_name AS "policyName",
             COALESCE(fees.charged, 0)::numeric(19,4)::text AS "feeCharged",
             COALESCE(fees.waived, 0)::int AS "feeWaived",
             referral.status AS "referralStatus"
      FROM sales_invoices i
      JOIN partners p ON p.id = i.customer_id
      JOIN LATERAL (
        SELECT (s.amount - COALESCE((
          SELECT SUM(a.amount) FROM treasury_allocations a
          WHERE a.open_item_id = s.id
            AND ((a.receipt_id IS NOT NULL AND EXISTS (SELECT 1 FROM receipts r
                     WHERE r.id = a.receipt_id AND r.status = 'POSTED'))
              OR (a.payment_id IS NOT NULL AND EXISTS (SELECT 1 FROM payments pay
                     WHERE pay.id = a.payment_id AND pay.status = 'POSTED'))
              OR (a.note_id IS NOT NULL))), 0))::numeric(19,4) AS outstanding
        FROM partner_subledger_entries s
        WHERE s.source_type = 'sales_invoice' AND s.source_id = i.id AND s.direction = 'DEBIT'
      ) o ON o.outstanding > 0
      LEFT JOIN LATERAL (
        SELECT MAX(l.step_no)::int AS step,
               (SELECT pol.name FROM dunning_letters l2
                 JOIN dunning_policies pol ON pol.id = l2.policy_id
                WHERE l2.invoice_id = i.id ORDER BY l2.step_no DESC LIMIT 1) AS policy_name
        FROM dunning_letters l WHERE l.invoice_id = i.id
      ) ladder ON true
      LEFT JOIN LATERAL (
        SELECT SUM(l3.fee_amount) AS charged,
               count(*) FILTER (WHERE l3.fee_waived_at IS NOT NULL)::int AS waived
        FROM dunning_letters l3
        WHERE l3.invoice_id = i.id AND l3.fee_amount IS NOT NULL
      ) fees ON true
      LEFT JOIN LATERAL (
        SELECT r.status FROM collection_referrals r
        WHERE r.invoice_id = i.id ORDER BY r.created_at DESC LIMIT 1
      ) referral ON true
      WHERE i.status = 'POSTED' AND i.kind = 'CREDIT' AND i.due_date < ${asOf}
      ORDER BY i.due_date, i.id
      LIMIT 1000
    `);
    return rows.rows as unknown as DunningStatusRow[];
  }
}

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("returns/collections report reads require an ambient tenant scope");
  }
  return context.tx;
}
