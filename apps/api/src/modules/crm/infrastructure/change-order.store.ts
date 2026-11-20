import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-048 (W-10 — T-09 + D-11) — the gate + capitalization store: the
 * ONLY writer for the 0102/0103-partial family's rows this wave owns
 * (change_orders, ias23_capitalizations — the projects.store precedent:
 * one store per wave's family). All reads run under the ambient tenant
 * UoW (RLS); every numeric field crosses the boundary as an EXACT
 * decimal string (::text, never a JS number — ADR-0009's law).
 *
 * THE WRITE SHAPES:
 *
 * - THE CHANGE-ORDER CAS: `casChangeOrderStatus` is ONE UPDATE … WHERE
 *   id AND status = ${from} — zero rows = the raced/stale move (the
 *   talent/budget CAS precedents); the verdict stamps (submitted/
 *   approved/rejected + the mandatory rejection reason) land in the
 *   SAME statement, satisfying 0102's approval-link CHECK atomically.
 * - G-58's STAMP: `stampChangeOrderEffect` consumes `effect_applied_at`
 *   EXACTLY ONCE — the UPDATE guards on effect_applied_at IS NULL; zero
 *   rows = the single-use refusal (D-07's law).
 * - THE IAS-23 ROWS: `insertIas23Capitalization` rides the 0103 unique
 *   (tenant, budget_line, window_start) — the service checks the
 *   POSTED stamp BEFORE any write (the history is computation
 *   evidence, no delete).
 *
 * THE READS (each names its consumer): the approved-delta sum (the
 * ceiling recompute + BAC — BR-092/093/G-58), the latest APPROVED
 * progress certificate (the certificate EV discipline — D-06), the
 * CUSTOMER retention row (the ceiling's contract-value base — the
 * 0103 commercial register), and the ias23 rows (the stamp checks).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("projects-plane access requires an ambient tenant scope");
  }
  return context.tx;
}

// ── the row shapes ─────────────────────────────────────────────────────────

export interface ChangeOrderRow {
  id: string;
  projectId: string;
  coNo: string | null;
  title: string;
  titleAr: string | null;
  scopeDelta: string | null;
  scopeDeltaAr: string | null;
  /** SIGNED numeric(19,4) as a decimal string (a credit-side CO is legal). */
  priceDelta: string;
  scheduleDeltaDays: number | null;
  status: string;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  effectAppliedAt: string | null;
  note: string | null;
  noteAr: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const CHANGE_ORDER_COLUMNS = sql`
  id, project_id AS "projectId", co_no AS "coNo", title, title_ar AS "titleAr",
  scope_delta AS "scopeDelta", scope_delta_ar AS "scopeDeltaAr",
  price_delta::text AS "priceDelta", schedule_delta_days AS "scheduleDeltaDays",
  status, submitted_at::text AS "submittedAt", approved_at::text AS "approvedAt",
  rejected_at::text AS "rejectedAt", rejection_reason AS "rejectionReason",
  effect_applied_at::text AS "effectAppliedAt", note, note_ar AS "noteAr",
  version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
`;

export interface Ias23CapitalizationRow {
  id: string;
  projectId: string;
  budgetLineId: string;
  windowStart: string;
  windowEnd: string;
  expendituresAmount: string;
  capitalizedAmount: string;
  expensedAmount: string;
  rateSnapshot: string;
  status: string;
  postedAt: string | null;
  note: string | null;
}

const IAS23_COLUMNS = sql`
  id, project_id AS "projectId", budget_line_id AS "budgetLineId",
  window_start::text AS "windowStart", window_end::text AS "windowEnd",
  expenditures_amount::text AS "expendituresAmount",
  capitalized_amount::text AS "capitalizedAmount",
  expensed_amount::text AS "expensedAmount",
  rate_snapshot::text AS "rateSnapshot", status, posted_at::text AS "postedAt", note
`;

// ── T-09: the change orders (the gate's rows) ──────────────────────────────

export async function insertChangeOrder(input: {
  projectId: string;
  coNo: string | null;
  title: string;
  titleAr: string | null;
  scopeDelta: string | null;
  scopeDeltaAr: string | null;
  priceDelta: string;
  scheduleDeltaDays: number | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<ChangeOrderRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO change_orders (id, tenant_id, created_by, project_id, co_no, title, title_ar,
                               scope_delta, scope_delta_ar, price_delta, schedule_delta_days,
                               note, note_ar)
    VALUES (${id}, erp.current_tenant_id(), ${input.actorId}, ${input.projectId}, ${input.coNo},
            ${input.title}, ${input.titleAr}, ${input.scopeDelta}, ${input.scopeDeltaAr},
            ${input.priceDelta}, ${input.scheduleDeltaDays}, ${input.note}, ${input.noteAr})
  `);
  const rows = await tx.execute(sql`
    SELECT ${CHANGE_ORDER_COLUMNS} FROM change_orders WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ChangeOrderRow[])[0]!;
}

export async function findChangeOrderById(id: string): Promise<ChangeOrderRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${CHANGE_ORDER_COLUMNS} FROM change_orders WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ChangeOrderRow[])[0];
}

export async function listChangeOrders(projectId: string): Promise<ChangeOrderRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${CHANGE_ORDER_COLUMNS} FROM change_orders
    WHERE project_id = ${projectId}
    ORDER BY created_at, id
  `);
  return rows.rows as unknown as ChangeOrderRow[];
}

/**
 * The lifecycle CAS (the talent/budget precedents): ONE UPDATE guarded
 * by the from-status; zero rows = the raced/stale move. The verdict
 * stamps land in the SAME statement (0102's approval-link CHECK is
 * satisfied atomically — exactly one terminal verdict, the rejection
 * reason mandatory on REJECTED).
 */
export async function casChangeOrderStatus(input: {
  id: string;
  from: string;
  to: string;
  actorId: string | null;
  rejectionReason?: string;
}): Promise<ChangeOrderRow | undefined> {
  const toSubmitted = input.to === "SUBMITTED";
  const toApproved = input.to === "APPROVED";
  const toRejected = input.to === "REJECTED";
  const rows = await tenantTx().execute(sql`
    UPDATE change_orders SET
      status = ${input.to},
      submitted_at = CASE WHEN ${toSubmitted} THEN now() ELSE submitted_at END,
      submitted_by = CASE WHEN ${toSubmitted} THEN ${input.actorId} ELSE submitted_by END,
      approved_at = CASE WHEN ${toApproved} THEN now() ELSE approved_at END,
      approved_by = CASE WHEN ${toApproved} THEN ${input.actorId} ELSE approved_by END,
      rejected_at = CASE WHEN ${toRejected} THEN now() ELSE rejected_at END,
      rejected_by = CASE WHEN ${toRejected} THEN ${input.actorId} ELSE rejected_by END,
      rejection_reason = CASE WHEN ${toRejected} THEN ${input.rejectionReason ?? null}
                              ELSE rejection_reason END,
      version = version + 1, updated_at = now(), updated_by = ${input.actorId}
    WHERE id = ${input.id} AND status = ${input.from}
    RETURNING id
  `);
  if (rows.rows.length === 0) return undefined;
  return findChangeOrderById(input.id);
}

/**
 * G-58's exactly-once stamp (D-07): consumes `effect_applied_at` on the
 * APPROVED row — the UPDATE guards on the NULL stamp, so a second
 * application reads zero rows (the typed single-use refusal at the
 * service). Called ONLY after the posting succeeded, inside the same
 * ambient transaction (all-or-nothing with the journal entry).
 */
export async function stampChangeOrderEffect(id: string): Promise<string | undefined> {
  const rows = await tenantTx().execute<{ effectAppliedAt: string }>(sql`
    UPDATE change_orders SET
      effect_applied_at = now(), version = version + 1, updated_at = now()
    WHERE id = ${id} AND status = 'APPROVED' AND effect_applied_at IS NULL
    RETURNING effect_applied_at::text AS "effectAppliedAt"
  `);
  return rows.rows[0]?.effectAppliedAt;
}

/**
 * The ceiling recompute's read (BR-092/093/G-58): the APPROVED orders'
 * deltas ONLY — DRAFT/SUBMITTED/REJECTED never enter (BR-094's
 * inert-until-approved law; the 0102 partial index is this read path).
 */
export async function approvedDeltaSum(projectId: string): Promise<{
  count: number;
  priceDeltaSum: string;
  scheduleDeltaDaysSum: number;
}> {
  const rows = await tenantTx().execute<{ n: number; price: string; days: number }>(sql`
    SELECT count(*)::int AS n,
           COALESCE(SUM(price_delta), 0)::numeric(19,4)::text AS price,
           COALESCE(SUM(schedule_delta_days), 0)::int AS days
    FROM change_orders
    WHERE project_id = ${projectId} AND status = 'APPROVED'
  `);
  const row = rows.rows[0];
  return {
    count: row?.n ?? 0,
    priceDeltaSum: row?.price ?? "0.0000",
    scheduleDeltaDaysSum: row?.days ?? 0,
  };
}

// ── D-06: the certificate-EV discipline's read ─────────────────────────────

/** The latest APPROVED progress certificate (the customer-billing EV
 * percent — D-06's second discipline; ties broken by approved_at then
 * id, deterministic for the read). */
export async function latestApprovedProgressCertificate(projectId: string): Promise<
  | {
      id: string;
      certificateNo: string | null;
      certificateDate: string;
      kind: string;
      cumulativePercent: string;
      grossValue: string;
    }
  | undefined
> {
  const rows = await tenantTx().execute(sql`
    SELECT id, certificate_no AS "certificateNo", certificate_date::text AS "certificateDate",
           kind, cumulative_percent::text AS "cumulativePercent",
           gross_value::text AS "grossValue"
    FROM progress_certificates
    WHERE project_id = ${projectId} AND status = 'APPROVED'
    ORDER BY certificate_date DESC, approved_at DESC, id DESC
    LIMIT 1
  `);
  return (rows.rows as unknown as {
    id: string;
    certificateNo: string | null;
    certificateDate: string;
    kind: string;
    cumulativePercent: string;
    grossValue: string;
  }[])[0];
}

// ── the ceiling's contract-value base (the 0103 commercial register) ───────

/** The CUSTOMER retention row — the customer contract's commercial
 * register (contract value + currency + hold % — BR-092's tenant DATA
 * per contract; the retention ENGINE is W-11's, this is the ceiling's
 * read of the register). */
export async function findCustomerRetentionAccount(projectId: string): Promise<
  | { id: string; contractValue: string; currencyCode: string; holdPercent: string }
  | undefined
> {
  const rows = await tenantTx().execute(sql`
    SELECT id, contract_value::text AS "contractValue", currency_code AS "currencyCode",
           hold_percent::text AS "holdPercent"
    FROM retention_accounts
    WHERE project_id = ${projectId} AND kind = 'CUSTOMER'
    LIMIT 1
  `);
  return (rows.rows as unknown as {
    id: string;
    contractValue: string;
    currencyCode: string;
    holdPercent: string;
  }[])[0];
}

// ── D-11: the ias23_capitalizations rows ───────────────────────────────────

export async function listIas23Capitalizations(
  projectId: string,
): Promise<Ias23CapitalizationRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${IAS23_COLUMNS} FROM ias23_capitalizations
    WHERE project_id = ${projectId}
    ORDER BY window_start, budget_line_id
  `);
  return rows.rows as unknown as Ias23CapitalizationRow[];
}

/** The single-use stamp check: a POSTED row for this (line, slice
 * start) refuses re-capitalization (the history is computation
 * evidence — no delete, the 0103 law). */
export async function findIas23ByLineAndSliceStart(
  budgetLineId: string,
  windowStart: string,
): Promise<Ias23CapitalizationRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${IAS23_COLUMNS} FROM ias23_capitalizations
    WHERE budget_line_id = ${budgetLineId} AND window_start = ${windowStart}
    LIMIT 1
  `);
  return (rows.rows as unknown as Ias23CapitalizationRow[])[0];
}

/** Insert one POSTED scope row (the service checked the stamp first;
 * the unique (tenant, line, window_start) is the structural floor). */
export async function insertIas23Capitalization(input: {
  projectId: string;
  budgetLineId: string;
  windowStart: string;
  windowEnd: string;
  expendituresAmount: string;
  capitalizedAmount: string;
  expensedAmount: string;
  rateSnapshot: string;
  note: string | null;
}): Promise<Ias23CapitalizationRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO ias23_capitalizations (id, tenant_id, project_id, budget_line_id, window_start,
                                        window_end, expenditures_amount, capitalized_amount,
                                        expensed_amount, rate_snapshot, status, posted_at, note)
    VALUES (${id}, erp.current_tenant_id(), ${input.projectId}, ${input.budgetLineId},
            ${input.windowStart}, ${input.windowEnd}, ${input.expendituresAmount},
            ${input.capitalizedAmount}, ${input.expensedAmount}, ${input.rateSnapshot},
            'POSTED', now(), ${input.note})
  `);
  const rows = await tx.execute(sql`
    SELECT ${IAS23_COLUMNS} FROM ias23_capitalizations WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as Ias23CapitalizationRow[])[0]!;
}
