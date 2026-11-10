import { sql } from "drizzle-orm";

import { Decimal, generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * Commissions store (PHASE-017 T7-a; migration 0025): the ONLY writer of
 * `commission_runs` + `commission_run_lines` and the only updater of the
 * sales_reps commission-rule columns. Every statement runs in the caller's
 * ambient tenant UoW so a run + its accrual journal commit atomically or
 * not at all (INV-018 discipline). Journal rows flow ONLY through
 * PostingEngine.post (ADR-0007 — never written here); the base read
 * (`repCommissionBase`) is a pure read over the POSTED sales/AR surfaces.
 *
 * Runs carry NO number series (INV-021 does not apply — commission_runs
 * has no number column by design; the id is the reference).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("commissions access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- commission runs ---------------------------------------------------------------

export interface CommissionRunRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  periodFrom: string;
  periodTo: string;
  basis: "INVOICED" | "COLLECTED";
  status: "DRAFT" | "POSTED" | "CANCELLED";
  totalBase: string;
  totalCommission: string;
  journalEntryId: string | null;
  computedAt: string | null;
  postedAt: string | null;
  postedBy: string | null;
  note: string | null;
  noteAr: string | null;
}

const RUN_COLUMNS = sql`id, created_at::text AS "createdAt", updated_at::text AS "updatedAt",
  created_by AS "createdBy", period_from::text AS "periodFrom", period_to::text AS "periodTo",
  basis, status, total_base::text AS "totalBase", total_commission::text AS "totalCommission",
  journal_entry_id AS "journalEntryId", computed_at::text AS "computedAt",
  posted_at::text AS "postedAt", posted_by AS "postedBy", note, note_ar AS "noteAr"`;

export async function insertCommissionRun(input: {
  periodFrom: string;
  periodTo: string;
  basis: "INVOICED" | "COLLECTED";
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<CommissionRunRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO commission_runs (id, tenant_id, period_from, period_to, basis, status, note, note_ar, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.periodFrom}, ${input.periodTo}, ${input.basis},
            'DRAFT', ${input.note}, ${input.noteAr}, ${input.actorId})
  `);
  return findCommissionRunById(id) as Promise<CommissionRunRow>;
}

export async function findCommissionRunById(id: string): Promise<CommissionRunRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${RUN_COLUMNS} FROM commission_runs WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as CommissionRunRow[])[0];
}

export async function listCommissionRuns(filter: {
  status?: string;
  limit: number;
}): Promise<CommissionRunRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${RUN_COLUMNS} FROM commission_runs
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
    ORDER BY period_from DESC, created_at DESC
    LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as CommissionRunRow[];
}

/** Targeted run patch (status flip, totals, computed/posted stamps). */
export async function patchCommissionRun(input: {
  id: string;
  status?: "DRAFT" | "POSTED" | "CANCELLED";
  totalBase?: string;
  totalCommission?: string;
  journalEntryId?: string;
  stampComputedAt?: boolean;
  stampPostedAt?: boolean;
  postedBy?: string | null;
}): Promise<void> {
  const sets = [sql`updated_at = now(), version = version + 1`];
  if (input.status !== undefined) sets.push(sql`status = ${input.status}`);
  if (input.totalBase !== undefined) sets.push(sql`total_base = ${input.totalBase}`);
  if (input.totalCommission !== undefined) sets.push(sql`total_commission = ${input.totalCommission}`);
  if (input.journalEntryId !== undefined) sets.push(sql`journal_entry_id = ${input.journalEntryId}`);
  if (input.stampComputedAt === true) sets.push(sql`computed_at = now()`);
  if (input.stampPostedAt === true) sets.push(sql`posted_at = now()`);
  if (input.postedBy !== undefined) sets.push(sql`posted_by = ${input.postedBy}`);
  await tenantTx().execute(sql`
    UPDATE commission_runs SET ${sql.join(sets, sql`, `)} WHERE id = ${input.id}
  `);
}

// -- commission run lines ----------------------------------------------------------

/** A run line joined with its rep (the sales.commissions_due read model). */
export interface CommissionRunLineRow {
  id: string;
  runId: string;
  salesRepId: string;
  repCode: string;
  repName: string;
  baseAmount: string;
  rateApplied: string;
  commissionAmount: string;
  detail: Record<string, unknown> | null;
  payoutStatus: "ACCRUED" | "PAID";
  paymentId: string | null;
}

/** A line as the service persists it (detail is the jsonb payload). */
export interface CommissionRunLineInsert {
  salesRepId: string;
  baseAmount: string;
  rateApplied: string;
  commissionAmount: string;
  detail: Record<string, unknown> | null;
}

/** Full line-set sync per run — compute is repeatable on DRAFT runs (a
 * recompute replaces the lines' content). The 0025 grant model is
 * status-lifecycled (erp_app holds NO DELETE on commission_run_lines —
 * the job_card_lines precedent): the (run, rep) unique key is the line
 * identity, so the sync is per-rep UPSERT — existing rows update in
 * place, new reps insert, and reps that dropped out of the computation
 * (e.g. a later credit note zeroed their base) are zeroed with a
 * `dropped` detail note instead of deleted. payout_state/payment linkage
 * is never touched by a recompute. */
export async function replaceCommissionRunLines(
  runId: string,
  lines: readonly CommissionRunLineInsert[],
  actorId: string | null,
): Promise<void> {
  const tx = tenantTx();
  const existing = await listCommissionRunLines(runId);
  const existingByRep = new Map(existing.map((row) => [row.salesRepId, row]));
  const kept = new Set<string>();

  for (const line of lines) {
    kept.add(line.salesRepId);
    const detail = line.detail === null ? null : JSON.stringify(line.detail);
    const current = existingByRep.get(line.salesRepId);
    if (current === undefined) {
      await tx.execute(sql`
        INSERT INTO commission_run_lines (id, tenant_id, created_by, run_id, sales_rep_id,
                                          base_amount, rate_applied, commission_amount, detail, payout_status)
        VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${actorId}, ${runId}, ${line.salesRepId},
                ${line.baseAmount}, ${line.rateApplied}, ${line.commissionAmount}, ${detail}::jsonb, 'ACCRUED')
      `);
      continue;
    }
    await tx.execute(sql`
      UPDATE commission_run_lines SET base_amount = ${line.baseAmount},
        rate_applied = ${line.rateApplied}, commission_amount = ${line.commissionAmount},
        detail = ${detail}::jsonb, version = version + 1, updated_at = now()
      WHERE id = ${current.id}
    `);
  }

  // Dropped reps: zeroed tombstones (never deleted — the grant model).
  for (const row of existing) {
    if (kept.has(row.salesRepId)) continue;
    const tombstone = JSON.stringify({
      dropped: true,
      note: "recompute removed this rep from the run (base no longer qualifies)",
    });
    await tx.execute(sql`
      UPDATE commission_run_lines SET base_amount = 0, rate_applied = 0, commission_amount = 0,
        detail = ${tombstone}::jsonb, version = version + 1, updated_at = now()
      WHERE id = ${row.id}
    `);
  }
}

export async function listCommissionRunLines(runId: string): Promise<CommissionRunLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT l.id, l.run_id AS "runId", l.sales_rep_id AS "salesRepId",
           r.code AS "repCode", r.name AS "repName",
           l.base_amount::text AS "baseAmount", l.rate_applied::text AS "rateApplied",
           l.commission_amount::text AS "commissionAmount", l.detail,
           l.payout_status AS "payoutStatus", l.payment_id AS "paymentId"
    FROM commission_run_lines l
    JOIN sales_reps r ON r.id = l.sales_rep_id
    WHERE l.run_id = ${runId}
    ORDER BY r.code
  `);
  return rows.rows as unknown as CommissionRunLineRow[];
}

// -- per-rep commission base (the honest posted, non-reversed surface) --------------

export interface RepCommissionBase {
  base: string;
  detail: {
    invoicedNet: string;
    creditedNet: string;
    collectedNet: string;
  };
}

/**
 * The rep's commission base over [from, to] for the given basis:
 *
 * - INVOICED: Σ total_net of POSTED sales invoices attributed to the rep,
 *   MINUS Σ total_net of POSTED credit notes attributed to the rep — the
 *   honest "posted, non-reversed" base (a reversed/credited sale reduces
 *   the base by exactly its credited net; SALES_RETURNS is the reversal
 *   channel, never an invoice mutation).
 * - COLLECTED: Σ allocation amounts of POSTED receipts against that rep's
 *   invoice open items (treasury_allocations → partner_subledger_entries →
 *   sales_invoices), receipt value_date within the window.
 *
 * All three components are returned for the line detail jsonb regardless of
 * basis (uniform statement shape); `base` picks per the basis. Amounts are
 * document-currency sums (the phase's single-currency runs; ADR-0009
 * strings throughout).
 */
export async function repCommissionBase(
  repId: string,
  from: string,
  to: string,
  basis: "INVOICED" | "COLLECTED",
): Promise<RepCommissionBase> {
  const rows = await tenantTx().execute(sql`
    WITH inv AS (
      SELECT COALESCE(SUM(si.total_net), 0) AS net
      FROM sales_invoices si
      WHERE si.sales_rep_id = ${repId} AND si.status = 'POSTED'
        AND si.invoice_date BETWEEN ${from} AND ${to}
    ), cn AS (
      SELECT COALESCE(SUM(c.total_net), 0) AS net
      FROM credit_notes c
      WHERE c.sales_rep_id = ${repId} AND c.status = 'POSTED'
        AND c.note_date BETWEEN ${from} AND ${to}
    ), col AS (
      SELECT COALESCE(SUM(a.amount), 0) AS net
      FROM treasury_allocations a
      JOIN receipts r ON r.id = a.receipt_id AND r.status = 'POSTED'
      JOIN partner_subledger_entries se ON se.id = a.open_item_id
      JOIN sales_invoices si ON si.id = se.source_id AND se.source_type = 'sales_invoice'
      WHERE si.sales_rep_id = ${repId} AND r.value_date BETWEEN ${from} AND ${to}
    )
    SELECT inv.net::numeric(19,4)::text AS "invoicedNet",
           cn.net::numeric(19,4)::text AS "creditedNet",
           col.net::numeric(19,4)::text AS "collectedNet"
    FROM inv, cn, col
  `);
  const row = (rows.rows as unknown as RepCommissionBase["detail"][])[0]!;
  const base =
    basis === "INVOICED"
      ? new Decimal(row.invoicedNet).minus(new Decimal(row.creditedNet)).toFixed(4)
      : new Decimal(row.collectedNet).toFixed(4);
  return { base, detail: row };
}

// -- per-rep commission rules (sales_reps commission columns) ------------------------

/** One tiered band: the rate applies to the base PORTION within the band
 * (upTo is the band's exclusive upper bound; null = the open last band). */
export interface CommissionTier {
  upTo: string | null;
  rate: string;
}

export interface RepCommissionRuleRow {
  repId: string;
  code: string;
  name: string;
  status: string;
  method: "NONE" | "PERCENTAGE";
  rate: string;
  basis: "INVOICED" | "COLLECTED";
  tiers: CommissionTier[] | null;
}

const RULE_COLUMNS = sql`id AS "repId", code, name, status,
  commission_method AS "method", commission_rate::text AS "rate",
  commission_basis AS "basis", commission_tiers AS "tiers"`;

export async function getRepCommissionRule(repId: string): Promise<RepCommissionRuleRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${RULE_COLUMNS} FROM sales_reps WHERE id = ${repId} LIMIT 1
  `);
  return (rows.rows as unknown as RepCommissionRuleRow[])[0];
}

export async function setRepCommissionRule(input: {
  repId: string;
  method: "NONE" | "PERCENTAGE";
  rate: string;
  basis: "INVOICED" | "COLLECTED";
  tiers: CommissionTier[] | null;
  actorId: string | null;
}): Promise<RepCommissionRuleRow> {
  const tiers = input.tiers === null ? null : JSON.stringify(input.tiers);
  await tenantTx().execute(sql`
    UPDATE sales_reps SET commission_method = ${input.method}, commission_rate = ${input.rate},
      commission_basis = ${input.basis}, commission_tiers = ${tiers}::jsonb,
      version = version + 1, updated_at = now()
    WHERE id = ${input.repId}
  `);
  return getRepCommissionRule(input.repId) as Promise<RepCommissionRuleRow>;
}

export async function listRepsWithRules(filter: {
  status?: string;
  limit: number;
}): Promise<RepCommissionRuleRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${RULE_COLUMNS} FROM sales_reps
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
    ORDER BY code
    LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as RepCommissionRuleRow[];
}
