import { Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { Decimal } from "@erp/domain-core";

import { requireTenantContext } from "../../../../infra/db/tenant-context";
import { type TenantDb } from "../../../../infra/db/client";
import * as journal from "../../../accounting/infrastructure/journal.store";

/**
 * PHASE-017 T8-a · the automotive report queries (industries/reports/README
 * PHASE-017 rows — the queries behind `automotive.job_card_profitability`
 * and `automotive.vehicle_service_history`): reporting-facing, read-only,
 * executed inside the ambient tenant transaction exactly like the
 * PHASE-015 `industry-queries.ts` precedent (ADR-0011 — module-owned query
 * surfaces; the reporting service locator constructs them directly).
 *
 * Money discipline (ADR-0009/INV-010): every monetary figure is the exact
 * 4-decimal quantum the posting chain already carries — parts revenue is
 * the invoice lines' net snapshots, parts COGS the invoice lines'
 * issue-value snapshots netted by the warranty credit notes' re-entry
 * values (the same numbers the COGS journals posted) — no parallel math,
 * tolerance 0 (the `jc-parts-cogs-tie` assertion compares the register to
 * the journal lines).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("automotive report query requires an ambient tenant scope");
  }
  return context.tx;
}

/** The card-line nature of a line, with the item-kind fallback. */
const NATURE_PARTS_SQL = (lineTypeColumn: string, kindColumn: string) =>
  sql.raw(`COALESCE(${lineTypeColumn}, CASE WHEN ${kindColumn} = 'STOCK' THEN 'PARTS' ELSE 'LABOR' END)`);

/** One job-card profitability row (per card, revenue net of warranty notes). */
export interface JobCardProfitabilityRow {
  cardId: string;
  cardNo: string | null;
  customerCode: string | null;
  customerName: string | null;
  /** "Make Model" of the serviced vehicle — null when the card has none. */
  vehicleLabel: string | null;
  plateNo: string | null;
  status: string;
  /** Σ parts invoice-line net − Σ parts warranty-CN net (4dp). */
  partsRevenue: string;
  /** Σ parts invoice-line issue_value − Σ parts warranty-CN re-entry (4dp). */
  partsCogs: string;
  partsMargin: string;
  /** Σ labor invoice-line net − Σ labor warranty-CN net (4dp). */
  laborRevenue: string;
  /** The card's logged labor hours total (6dp). */
  laborHours: string;
  /** Whole days from check-in (or creation) to completion/invoice. */
  daysOpen: number | null;
  invoiceNo: string | null;
  invoiceStatus: string | null;
}

/** A vehicle service-history timeline entry (the partners read-model shape). */
export interface VehicleServiceHistoryEntry {
  kind: "JOB_CARD" | "INVOICE" | "CREDIT_NOTE";
  id: string;
  docNo: string | null;
  /** ISO calendar date (YYYY-MM-DD); job cards use check-in (UTC date). */
  date: string;
  status: string;
  /** Decimal string; job cards carry no document total (null). */
  total: string | null;
}

function branchScopeSql(
  branchIds: readonly string[] | null | undefined,
  column: string,
): ReturnType<typeof sql> {
  if (branchIds === null || branchIds === undefined || branchIds.length === 0) {
    return sql`TRUE`;
  }
  return sql`${sql.raw(column)} IN (${sql.join(
    branchIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;
}

@Injectable()
export class AutomotiveQueriesService {
  /**
   * `automotive.job_card_profitability`: per-card parts margin, labor
   * revenue, duration, and invoice status over a window (the card's
   * business date = its invoice date when invoiced, else the check-in
   * date). Revenue/COGS net the warranty credit notes linked to the card
   * (cn.job_card_id) — the honest realized margin; the nature split rides
   * the card-line ↔ invoice-line mapping the T4 posting port stamps, with
   * the item kind as the fallback.
   */
  async jobCardProfitability(input: {
    fromDate: string;
    toDate: string;
    branchIds?: readonly string[] | null;
  }): Promise<JobCardProfitabilityRow[]> {
    const rows = await tenantTx().execute(sql`
      WITH card_set AS (
        SELECT jc.tenant_id, jc.id, jc.card_no, jc.status, jc.labor_hours_total, jc.vehicle_id,
               p.code AS "customerCode", p.name AS "customerName",
               ((COALESCE(jc.completed_at, jc.invoiced_at, now()) AT TIME ZONE 'UTC')::date
                 - (COALESCE(jc.checked_in_at, jc.created_at) AT TIME ZONE 'UTC')::date) AS "daysOpen",
               inv.invoice_no AS "invoiceNo", inv.status AS "invoiceStatus"
        FROM job_cards jc
        LEFT JOIN sales_invoices inv ON inv.id = jc.invoice_id
        LEFT JOIN partners p ON p.id = jc.customer_id AND p.tenant_id = jc.tenant_id
        WHERE COALESCE(inv.invoice_date, (jc.created_at AT TIME ZONE 'UTC')::date)
                BETWEEN ${input.fromDate} AND ${input.toDate}
          AND ${branchScopeSql(input.branchIds, "jc.branch_id")}
      ),
      line_natures AS (
        SELECT cs.id AS card_id,
               ${NATURE_PARTS_SQL("jcl.line_type", "it.kind")} AS nature,
               sil.net_amount AS net_amount,
               sil.issue_value AS cogs_amount
        FROM card_set cs
        JOIN sales_invoices si ON si.job_card_id = cs.id AND si.status = 'POSTED'
        JOIN sales_invoice_lines sil ON sil.invoice_id = si.id
        LEFT JOIN job_card_lines jcl ON jcl.invoice_line_id = sil.id AND jcl.job_card_id = cs.id
        LEFT JOIN items it ON it.id = sil.item_id
        UNION ALL
        SELECT cs.id AS card_id,
               ${NATURE_PARTS_SQL("jcl2.line_type", "it2.kind")} AS nature,
               -cnl.net_amount AS net_amount,
               -COALESCE(cnl.reentry_value, 0) AS cogs_amount
        FROM card_set cs
        JOIN credit_notes cn ON cn.job_card_id = cs.id AND cn.status = 'POSTED'
        JOIN credit_note_lines cnl ON cnl.note_id = cn.id
        LEFT JOIN job_card_lines jcl2 ON jcl2.invoice_line_id = cnl.invoice_line_id AND jcl2.job_card_id = cs.id
        LEFT JOIN items it2 ON it2.id = cnl.item_id
      )
      SELECT cs.id AS "cardId", cs.card_no AS "cardNo",
             cs."customerCode", cs."customerName",
             CASE WHEN v.id IS NULL THEN NULL
                  ELSE trim(concat_ws(' ', v.make, v.model)) END AS "vehicleLabel",
             v.plate_no AS "plateNo",
             cs.status,
             COALESCE(SUM(CASE WHEN ln.nature = 'PARTS' THEN ln.net_amount ELSE 0 END), 0)::numeric(19,4)::text AS "partsRevenue",
             COALESCE(SUM(CASE WHEN ln.nature = 'PARTS' THEN ln.cogs_amount ELSE 0 END), 0)::numeric(19,4)::text AS "partsCogs",
             COALESCE(SUM(CASE WHEN ln.nature = 'LABOR' THEN ln.net_amount ELSE 0 END), 0)::numeric(19,4)::text AS "laborRevenue",
             cs.labor_hours_total::text AS "laborHours",
             cs."daysOpen"::int AS "daysOpen",
             cs."invoiceNo", cs."invoiceStatus"
      FROM card_set cs
      LEFT JOIN line_natures ln ON ln.card_id = cs.id
      LEFT JOIN vehicles v ON v.id = cs.vehicle_id AND v.tenant_id = cs.tenant_id
      GROUP BY cs.id, cs.card_no, cs."customerCode", cs."customerName", v.id, v.make, v.model,
               v.plate_no, cs.status, cs.labor_hours_total, cs."daysOpen", cs."invoiceNo", cs."invoiceStatus"
      ORDER BY cs."invoiceNo" NULLS LAST, cs.card_no, cs.id
      LIMIT 1000
    `);
    const raw = rows.rows as unknown as Omit<JobCardProfitabilityRow, "partsMargin">[];
    return raw.map((row) => ({
      ...row,
      partsMargin: new Decimal(row.partsRevenue).minus(new Decimal(row.partsCogs)).toFixed(4),
    }));
  }

  /**
   * The `jc-parts-cogs-tie`: register side (Σ the report rows' per-card
   * parts COGS — invoice issue-value snapshots net of warranty re-entries)
   * vs GL side (Σ net COGS-purpose journal-line amounts over the postings
   * backing the listed cards: the invoices' own cogs journals
   * `sales_invoice:cogs`, the approval-time issue journals
   * `job_card:issue_parts`, and the warranty re-entry journals
   * `credit_note:reentry`). The document-set shape — the postings of
   * exactly the cards the window lists — keeps the tie exact at tolerance 0
   * whatever date skew exists between approval and invoice.
   */
  async jobCardPartsCogsTie(input: {
    fromDate: string;
    toDate: string;
    branchIds?: readonly string[] | null;
  }): Promise<{ registerSide: string; glSide: string }> {
    const registerRows = await tenantTx().execute(sql`
      SELECT COALESCE(SUM(per_card.parts_cogs), 0)::numeric(19,4)::text AS total
      FROM (
        SELECT jc.id,
          COALESCE((
            SELECT SUM(COALESCE(sil.issue_value, 0))
            FROM sales_invoices si
            JOIN sales_invoice_lines sil ON sil.invoice_id = si.id
            LEFT JOIN job_card_lines jcl ON jcl.invoice_line_id = sil.id AND jcl.job_card_id = jc.id
            LEFT JOIN items it ON it.id = sil.item_id
            WHERE si.job_card_id = jc.id AND si.status = 'POSTED'
              AND ${NATURE_PARTS_SQL("jcl.line_type", "it.kind")} = 'PARTS'
          ), 0)
          - COALESCE((
            SELECT SUM(COALESCE(cnl.reentry_value, 0))
            FROM credit_notes cn
            JOIN credit_note_lines cnl ON cnl.note_id = cn.id
            LEFT JOIN job_card_lines jcl2 ON jcl2.invoice_line_id = cnl.invoice_line_id AND jcl2.job_card_id = jc.id
            LEFT JOIN items it2 ON it2.id = cnl.item_id
            WHERE cn.job_card_id = jc.id AND cn.status = 'POSTED'
              AND ${NATURE_PARTS_SQL("jcl2.line_type", "it2.kind")} = 'PARTS'
          ), 0) AS parts_cogs
        FROM job_cards jc
        LEFT JOIN sales_invoices inv ON inv.id = jc.invoice_id
        WHERE COALESCE(inv.invoice_date, (jc.created_at AT TIME ZONE 'UTC')::date)
                BETWEEN ${input.fromDate} AND ${input.toDate}
          AND ${branchScopeSql(input.branchIds, "jc.branch_id")}
      ) per_card
    `);
    const cogsAccounts = await journal.accountsForPurposes(["COGS"]);
    let gl = "0.0000";
    if (cogsAccounts.length > 0) {
      const glRows = await tenantTx().execute(sql`
        SELECT COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.base_amount ELSE -l.base_amount END), 0)::numeric(19,4)::text AS total
        FROM journal_lines l
        WHERE l.account_id IN (${sql.join(
          cogsAccounts.map((a) => sql`${a.accountId}`),
          sql`, `,
        )})
          AND l.journal_entry_id IN (
            SELECT si.posted_cogs_journal_id FROM sales_invoices si
              JOIN job_cards jc ON jc.id = si.job_card_id
              WHERE si.posted_cogs_journal_id IS NOT NULL
                AND COALESCE(si.invoice_date, (jc.created_at AT TIME ZONE 'UTC')::date)
                    BETWEEN ${input.fromDate} AND ${input.toDate}
            UNION
            SELECT jcl.issue_journal_id FROM job_card_lines jcl
              JOIN job_cards jc ON jc.id = jcl.job_card_id
              WHERE jcl.issue_journal_id IS NOT NULL
                AND COALESCE((SELECT i2.invoice_date FROM sales_invoices i2 WHERE i2.id = jc.invoice_id),
                             (jc.created_at AT TIME ZONE 'UTC')::date)
                    BETWEEN ${input.fromDate} AND ${input.toDate}
            UNION
            SELECT e.id FROM journal_entries e
              JOIN credit_notes cn ON cn.id = e.source_id
              JOIN job_cards jc ON jc.id = cn.job_card_id
              WHERE e.source_type = 'credit_note' AND e.operation = 'reentry' AND e.status = 'POSTED'
                AND COALESCE((SELECT i3.invoice_date FROM sales_invoices i3 WHERE i3.id = jc.invoice_id),
                             (jc.created_at AT TIME ZONE 'UTC')::date)
                    BETWEEN ${input.fromDate} AND ${input.toDate}
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
   * `automotive.vehicle_service_history`: the per-vehicle timeline read
   * model — job cards (by vehicle_id), invoices (by vehicle_id), warranty
   * credit notes (via the job-card link) — newest first. The partners
   * store's `findVehicleServiceHistory` twin, read through the same
   * documented MODULE_BOUNDARIES read precedent (read-only SQL over the
   * published tables inside the ambient tenant transaction).
   */
  async vehicleServiceHistory(input: {
    vehicleId: string;
  }): Promise<VehicleServiceHistoryEntry[]> {
    const rows = await tenantTx().execute(sql`
      SELECT timeline.kind, timeline.id, timeline."docNo", timeline."date"::text AS "date",
             timeline.status, timeline.total::text AS total
      FROM (
        SELECT 'JOB_CARD'::text AS kind, jc.id AS id, jc.card_no AS "docNo",
               (COALESCE(jc.checked_in_at, jc.created_at) AT TIME ZONE 'UTC')::date AS "date",
               jc.status AS status, NULL::numeric AS total
        FROM job_cards jc
        WHERE jc.vehicle_id = ${input.vehicleId}
        UNION ALL
        SELECT 'INVOICE'::text, si.id, si.invoice_no, si.invoice_date, si.status, si.total_gross
        FROM sales_invoices si
        WHERE si.vehicle_id = ${input.vehicleId}
        UNION ALL
        SELECT 'CREDIT_NOTE'::text, cn.id, cn.note_no, cn.note_date, cn.status, cn.total_gross
        FROM credit_notes cn
        JOIN job_cards jc2 ON jc2.id = cn.job_card_id AND jc2.tenant_id = cn.tenant_id
        WHERE jc2.vehicle_id = ${input.vehicleId}
      ) AS timeline
      ORDER BY timeline."date" DESC, timeline.kind ASC, timeline.id ASC
    `);
    return rows.rows as unknown as VehicleServiceHistoryEntry[];
  }
}
