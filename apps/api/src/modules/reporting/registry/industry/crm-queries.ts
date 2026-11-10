import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { requireTenantContext } from "../../../../infra/db/tenant-context";
import { type TenantDb } from "../../../../infra/db/client";
import * as journal from "../../../accounting/infrastructure/journal.store";

/**
 * PHASE-019 T49 · the CRM report queries (industries/reports/README
 * PHASE-019 rows — the queries behind `services.contract_revenue_schedule`
 * and `services.time_billing_summary`): reporting-facing, read-only,
 * executed inside the ambient tenant transaction exactly like the
 * PHASE-015…018 industry-queries precedents (ADR-0011 — module-owned query
 * surfaces; the reporting service locator constructs them directly; nothing
 * imports from the crm module — the published tables are the contract).
 *
 * Money discipline (ADR-0009): every monetary figure is the exact
 * 4-decimal quantum the source rows already carry (schedule amounts,
 * invoice totals, subledger amounts) — no parallel math, tolerance 0.
 * Hours are the canonical 6-decimal strings; time amounts are
 * hours × the snapshotted unitRate (§6 — never recomputed), cast 4dp.
 *
 * The reconciliation joins (the T47 handoff, binding):
 * - contracted  = contract_billing_schedule.amount per entry (PLANNED +
 *   INVOICED + SKIPPED alike — the grid is frozen at activation; HOURLY
 *   rows carry NULL amount and report their generated invoices only);
 * - invoiced    = contract_invoices ⋈ sales_invoices with status POSTED
 *   (net/VAT/gross straight off the invoice row), linked per entry via
 *   period_key (RETAINER_PERIOD/HOURLY_PERIOD) or milestone_schedule_id
 *   (MILESTONE) — the same two partial-unique keys the billing run guards;
 * - draft       = the same join with status DRAFT/PENDING_APPROVAL/APPROVED
 *   (CANCELLED drafts are honestly excluded; a POSTED invoice never changes
 *   status — correction is a credit note, INV-003/BR-031);
 * - backlog     = contracted − invoiced − draft (NULL where contracted is
 *   NULL — the HOURLY operational labeling);
 * - overdue     = the posted invoices' AR open items past due at asOf:
 *   the partner_subledger DEBIT row of source sales_invoice (joined via
 *   posted_journal_id), outstanding net of treasury_allocations — the
 *   EXACT arOpenItemsAsOf settled lateral, so the bucket matches ar.aging
 *   for the same asOf (BR-028 determinism). The J-DEF reclass debit row
 *   (T47 deviation 9) is NOT netted in: it is not a contract-invoice row —
 *   the advance-held exposure stays visible on the ar.aging/statement
 *   surfaces; the J-REL release allocations ARE picked up by the settled
 *   lateral (invoice open = gross − released, by construction).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("crm report queries require an ambient tenant transaction");
  }
  return context.tx;
}

// -- services.contract_revenue_schedule ----------------------------------------------

/** One contract × period/milestone row of the revenue schedule (the report's grain). */
export interface ContractRevenueScheduleRow {
  contractId: string;
  contractNo: string | null;
  partnerId: string;
  partnerName: string;
  partnerNameAr: string | null;
  projectId: string | null;
  projectCode: string | null;
  projectName: string | null;
  scheduleEntryId: string;
  entryType: string;
  periodKey: string | null;
  milestoneLabel: string | null;
  billDate: string;
  entryStatus: string;
  /** The frozen schedule amount (NULL on HOURLY_PERIOD — operational rows). */
  contracted: string | null;
  invoicedNet: string;
  invoicedVat: string;
  invoicedGross: string;
  draftNet: string;
  /** contracted − invoiced − draft (NULL where contracted is NULL). */
  backlog: string | null;
  /** The row's posted invoices' AR open amounts past due at asOf (gross basis). */
  overdue: string;
}

/**
 * The schedule-entry ⇄ contract_invoices link predicate: the same two keys
 * the billing run guards (period_key for RETAINER_PERIOD/HOURLY_PERIOD,
 * milestone_schedule_id for MILESTONE).
 */
const INVOICE_LINK = sql`(
  (ci.period_key IS NOT NULL AND ci.period_key = s.period_key)
  OR (ci.milestone_schedule_id IS NOT NULL AND ci.milestone_schedule_id = s.id)
)`;

@Injectable()
export class CrmQueriesService {
  /**
   * `services.contract_revenue_schedule`: one row per contract × schedule
   * entry with billDate in the window (optional single-contract scope),
   * carrying the reconciliation quartet (contracted / invoiced / draft /
   * backlog) plus the overdue AR open-item bucket at asOf. All money is the
   * exact posted/frozen quantum; overdue is the ar.aging formula scoped to
   * the row's posted contract invoices.
   */
  async contractRevenueSchedule(input: {
    fromDate: string;
    toDate: string;
    asOf: string;
    contractId?: string | null;
  }): Promise<ContractRevenueScheduleRow[]> {
    const contractId = input.contractId ?? null;
    const rows = await tenantTx().execute(sql`
      SELECT c.id AS "contractId", c.contract_no AS "contractNo",
             p.id AS "partnerId", p.name AS "partnerName", p.name_ar AS "partnerNameAr",
             pr.id AS "projectId", pr.code AS "projectCode", pr.name AS "projectName",
             s.id AS "scheduleEntryId", s.entry_type AS "entryType",
             s.period_key AS "periodKey", s.milestone_label AS "milestoneLabel",
             s.bill_date::text AS "billDate", s.status AS "entryStatus",
             s.amount::text AS "contracted",
             COALESCE(posted.net, 0)::numeric(19,4)::text AS "invoicedNet",
             COALESCE(posted.vat, 0)::numeric(19,4)::text AS "invoicedVat",
             COALESCE(posted.gross, 0)::numeric(19,4)::text AS "invoicedGross",
             COALESCE(draft.net, 0)::numeric(19,4)::text AS "draftNet",
             CASE WHEN s.amount IS NOT NULL
                  THEN (s.amount - COALESCE(posted.net, 0) - COALESCE(draft.net, 0))
                       ::numeric(19,4)::text
                  ELSE NULL END AS "backlog",
             COALESCE(overdue.total, 0)::numeric(19,4)::text AS "overdue"
      FROM contract_billing_schedule s
      JOIN service_contracts c ON c.id = s.contract_id AND c.tenant_id = s.tenant_id
      JOIN partners p ON p.id = c.partner_id AND p.tenant_id = c.tenant_id
      LEFT JOIN projects pr ON pr.id = c.project_id AND pr.tenant_id = c.tenant_id
      LEFT JOIN LATERAL (
        SELECT SUM(i.total_net) AS net, SUM(i.total_tax) AS vat, SUM(i.total_gross) AS gross
        FROM contract_invoices ci
        JOIN sales_invoices i ON i.id = ci.invoice_id AND i.tenant_id = ci.tenant_id
        WHERE ci.contract_id = s.contract_id
          AND ${INVOICE_LINK}
          AND i.status = 'POSTED'
      ) posted ON true
      LEFT JOIN LATERAL (
        SELECT SUM(i.total_net) AS net
        FROM contract_invoices ci
        JOIN sales_invoices i ON i.id = ci.invoice_id AND i.tenant_id = ci.tenant_id
        WHERE ci.contract_id = s.contract_id
          AND ${INVOICE_LINK}
          AND i.status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED')
      ) draft ON true
      LEFT JOIN LATERAL (
        SELECT SUM(open.outstanding) AS total
        FROM (
          SELECT (sub.amount - COALESCE(settled.total, 0)) AS outstanding
          -- openOnly semantics (arOpenItemsAsOf): only POSITIVE outstanding
          -- rows are open items on the aging surface.
          FROM contract_invoices ci
          JOIN sales_invoices i ON i.id = ci.invoice_id AND i.tenant_id = ci.tenant_id
          JOIN partner_subledger_entries sub
            ON sub.journal_entry_id = i.posted_journal_id
           AND sub.source_type = 'sales_invoice'
           AND sub.source_id = i.id
           AND sub.direction = 'DEBIT'
          LEFT JOIN LATERAL (
            SELECT SUM(a.amount) AS total FROM treasury_allocations a
            WHERE a.open_item_id = sub.id
              AND ((a.receipt_id IS NOT NULL AND EXISTS (SELECT 1 FROM receipts r
                       WHERE r.id = a.receipt_id AND r.status = 'POSTED'))
                OR (a.payment_id IS NOT NULL AND EXISTS (SELECT 1 FROM payments pay
                       WHERE pay.id = a.payment_id AND pay.status = 'POSTED')))
          ) settled ON true
          WHERE ci.contract_id = s.contract_id
            AND ${INVOICE_LINK}
            AND i.status = 'POSTED'
            AND i.due_date < ${input.asOf}
            AND sub.entry_date <= ${input.asOf}
        ) open
        WHERE open.outstanding > 0
      ) overdue ON true
      WHERE s.bill_date BETWEEN ${input.fromDate} AND ${input.toDate}
        AND (${contractId}::uuid IS NULL OR c.id = ${contractId}::uuid)
      ORDER BY c.contract_no NULLS LAST, s.bill_date, s.id
      LIMIT 1000
    `);
    return rows.rows as unknown as ContractRevenueScheduleRow[];
  }

  /**
   * The `contract-revenue-gl-tie`: register side (Σ total_net of the POSTED
   * contract invoices linked to in-window schedule entries) vs GL side (Σ
   * CREDIT journal_lines on the SERVICE_REVENUE/SALES_REVENUE purpose
   * accounts of those same invoices' posted journals). Both sides scope to
   * the identical invoice id set — the posting engine credits revenue
   * exactly total_net, so the tie catches any drift at tolerance 0 (the
   * commissionsTotalTie pattern: no revenue account mapped → the GL side is
   * an honest 0.0000).
   */
  async contractRevenueGlTie(input: {
    fromDate: string;
    toDate: string;
    contractId?: string | null;
  }): Promise<{ registerSide: string; glSide: string }> {
    const contractId = input.contractId ?? null;
    const registerRows = await tenantTx().execute(sql`
      SELECT COALESCE(SUM(i.total_net), 0)::numeric(19,4)::text AS total
      FROM sales_invoices i
      JOIN contract_invoices ci ON ci.invoice_id = i.id AND ci.tenant_id = i.tenant_id
      JOIN contract_billing_schedule s ON s.contract_id = ci.contract_id AND s.tenant_id = ci.tenant_id
        AND ${INVOICE_LINK}
      WHERE i.status = 'POSTED'
        AND s.bill_date BETWEEN ${input.fromDate} AND ${input.toDate}
        AND (${contractId}::uuid IS NULL OR s.contract_id = ${contractId}::uuid)
    `);
    const revenueAccounts = await journal.accountsForPurposes([
      "SERVICE_REVENUE",
      "SALES_REVENUE",
    ]);
    let gl = "0.0000";
    if (revenueAccounts.length > 0) {
      const glRows = await tenantTx().execute(sql`
        SELECT COALESCE(SUM(l.amount), 0)::numeric(19,4)::text AS total
        FROM journal_lines l
        JOIN journal_entries e ON e.id = l.journal_entry_id AND e.tenant_id = l.tenant_id
        WHERE e.status = 'POSTED'
          AND l.direction = 'CREDIT'
          AND l.account_id IN (${sql.join(
            revenueAccounts.map((a) => sql`${a.accountId}`),
            sql`, `,
          )})
          AND l.journal_entry_id IN (
            SELECT i.posted_journal_id
            FROM sales_invoices i
            JOIN contract_invoices ci ON ci.invoice_id = i.id AND ci.tenant_id = i.tenant_id
            JOIN contract_billing_schedule s ON s.contract_id = ci.contract_id
              AND s.tenant_id = ci.tenant_id
              AND ${INVOICE_LINK}
            WHERE i.status = 'POSTED'
              AND i.posted_journal_id IS NOT NULL
              AND s.bill_date BETWEEN ${input.fromDate} AND ${input.toDate}
              AND (${contractId}::uuid IS NULL OR s.contract_id = ${contractId}::uuid)
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
   * `services.time_billing_summary`: one row per project × fee-earner over
   * the window (optional project scope) — recorded (non-VOID), billable
   * (the flag), invoiced (billedInvoiceId set) hours and their amounts
   * (hours × the snapshotted unitRate — §6 determinism, never recomputed).
   * Operational surface (industries/reports rule 2): no GL assertion.
   */
  async timeBillingSummary(input: {
    fromDate: string;
    toDate: string;
    projectId?: string | null;
  }): Promise<TimeBillingSummaryRow[]> {
    const projectId = input.projectId ?? null;
    const rows = await tenantTx().execute(sql`
      SELECT t.project_id AS "projectId", pr.code AS "projectCode", pr.name AS "projectName",
             t.fee_earner_user_id AS "feeEarnerUserId", u.full_name AS "feeEarnerName",
             SUM(t.hours)::numeric(19,6)::text AS "recordedHours",
             SUM(CASE WHEN t.billable THEN t.hours ELSE 0 END)::numeric(19,6)::text AS "billableHours",
             SUM(CASE WHEN t.billed_invoice_id IS NOT NULL THEN t.hours ELSE 0 END)
               ::numeric(19,6)::text AS "invoicedHours",
             SUM(t.hours * t.unit_rate)::numeric(19,4)::text AS "recordedAmount",
             SUM(CASE WHEN t.billable THEN t.hours * t.unit_rate ELSE 0 END)
               ::numeric(19,4)::text AS "billableAmount",
             SUM(CASE WHEN t.billed_invoice_id IS NOT NULL THEN t.hours * t.unit_rate ELSE 0 END)
               ::numeric(19,4)::text AS "invoicedAmount",
             COUNT(*)::int AS "entryCount"
      FROM crm_time_entries t
      LEFT JOIN projects pr ON pr.id = t.project_id AND pr.tenant_id = t.tenant_id
      LEFT JOIN users u ON u.id = t.fee_earner_user_id
      WHERE t.status <> 'VOID'
        AND t.entry_date BETWEEN ${input.fromDate} AND ${input.toDate}
        AND (${projectId}::uuid IS NULL OR t.project_id = ${projectId}::uuid)
      GROUP BY t.project_id, pr.code, pr.name, t.fee_earner_user_id, u.full_name
      ORDER BY pr.code NULLS LAST, u.full_name NULLS LAST, t.fee_earner_user_id
      LIMIT 500
    `);
    return rows.rows as unknown as TimeBillingSummaryRow[];
  }
}

/** One project × fee-earner row of the time-billing summary. */
export interface TimeBillingSummaryRow {
  projectId: string | null;
  projectCode: string | null;
  projectName: string | null;
  feeEarnerUserId: string | null;
  feeEarnerName: string | null;
  recordedHours: string;
  billableHours: string;
  invoicedHours: string;
  recordedAmount: string;
  billableAmount: string;
  invoicedAmount: string;
  entryCount: number;
}
