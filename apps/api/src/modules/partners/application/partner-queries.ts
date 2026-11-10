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
 * PHASE-013 · partner balance queries (REPORT_CATALOG §2 `partner.balances`):
 * per-partner AR/AP subledger sums derived from the immutable subledger
 * entries, with the INV-009 control tie (Σ subledger == AR/AP control
 * account balance) displayed as the footer badge.
 *
 * Boundary note (PHASE-006 master-data boundary, PHASE-007 seam): the
 * partners module owns the subledger table (migration 0011) and reads it —
 * plus its control-account resolution — through set-based SQL on the
 * ambient tenant transaction, exactly like `balances()`; it never imports
 * accounting-module code (the one sanctioned partners → accounting surface
 * remains the seam file `subledger-service.ts`).
 */

export interface PartnerBalanceRow {
  partnerId: string;
  code: string;
  name: string;
  nameAr: string | null;
  arBalance: string;
  apBalance: string;
}

export interface ControlTie {
  side: "AR" | "AP";
  subledgerTotal: string;
  glBalance: string;
}

@Injectable()
export class PartnerQueriesService {
  /** Partner balances from the subledger (AR + AP sides, base amounts). */
  async balances(filter: { role?: "CUSTOMER" | "SUPPLIER" } = {}): Promise<PartnerBalanceRow[]> {
    const rows = await tenantTx().execute(sql`
      WITH ar_acct AS (
        SELECT ap.account_id FROM account_purposes ap
        WHERE ap.purpose_key = 'AR_CONTROL' AND ap.active_to IS NULL
      ), ap_acct AS (
        SELECT ap.account_id FROM account_purposes ap
        WHERE ap.purpose_key = 'AP_CONTROL' AND ap.active_to IS NULL
      ), ar AS (
        SELECT s.partner_id,
               SUM(CASE WHEN s.direction = 'DEBIT' THEN s.base_amount ELSE -s.base_amount END) AS balance
        FROM partner_subledger_entries s
        JOIN journal_lines l ON l.id = s.journal_line_id
        WHERE l.account_id IN (SELECT account_id FROM ar_acct)
        GROUP BY s.partner_id
      ), ap AS (
        SELECT s.partner_id,
               SUM(CASE WHEN s.direction = 'CREDIT' THEN s.base_amount ELSE -s.base_amount END) AS balance
        FROM partner_subledger_entries s
        JOIN journal_lines l ON l.id = s.journal_line_id
        WHERE l.account_id IN (SELECT account_id FROM ap_acct)
        GROUP BY s.partner_id
      )
      SELECT p.id AS "partnerId", p.code, p.name, p.name_ar AS "nameAr",
             COALESCE(ar.balance, 0)::text AS "arBalance",
             COALESCE(ap.balance, 0)::text AS "apBalance"
      FROM partners p
      LEFT JOIN ar ON ar.partner_id = p.id
      LEFT JOIN ap ON ap.partner_id = p.id
      WHERE (${filter.role === undefined} OR p.kind = ${filter.role ?? null} OR p.kind = 'BOTH')
        AND p.deleted_at IS NULL
        AND (ar.partner_id IS NOT NULL OR ap.partner_id IS NOT NULL)
      ORDER BY p.name
      LIMIT 2000
    `);
    return rows.rows as unknown as PartnerBalanceRow[];
  }

  /**
   * The INV-009 control ties for the footer: Σ per-partner subledger ==
   * AR_CONTROL / AP_CONTROL account balance (exact decimals).
   */
  async controlTies(): Promise<ControlTie[]> {
    const ties: ControlTie[] = [];
    for (const [side, purpose] of [
      ["AR", "AR_CONTROL"],
      ["AP", "AP_CONTROL"],
    ] as const) {
      // One set-based pass (the same control join `balances()` uses): the
      // partners-owned subledger summed against the control account's GL
      // balance — AR control balances are debit-positive, AP credit-positive
      // (the presented AP figure is the sign-flipped GL balance).
      const rows = await tenantTx().execute<{ subledgerTotal: string; glBalance: string }>(sql`
        WITH control AS (
          SELECT ap.account_id
          FROM account_purposes ap
          WHERE ap.purpose_key = ${purpose} AND ap.active_to IS NULL
        ), sub AS (
          SELECT SUM(CASE WHEN s.direction = 'DEBIT' THEN s.base_amount ELSE -s.base_amount END) AS total
          FROM partner_subledger_entries s
          JOIN journal_lines l ON l.id = s.journal_line_id
          WHERE l.account_id IN (SELECT account_id FROM control)
        ), gl AS (
          SELECT SUM(CASE WHEN l.direction = 'DEBIT' THEN l.base_amount ELSE -l.base_amount END) AS total
          FROM journal_lines l
          WHERE l.account_id IN (SELECT account_id FROM control)
        )
        SELECT COALESCE(sub.total, 0)::numeric(20, 4)::text AS "subledgerTotal",
               CASE
                 WHEN ${side} = 'AR' THEN COALESCE(gl.total, 0)::text
                 ELSE (-COALESCE(gl.total, 0))::text
               END AS "glBalance"
        FROM sub, gl
      `);
      const row = rows.rows[0];
      if (row === undefined) continue;
      ties.push({ side, subledgerTotal: row.subledgerTotal, glBalance: row.glBalance });
    }
    return ties;
  }
}
