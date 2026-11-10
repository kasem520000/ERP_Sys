import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * Installments store (PHASE-027 T8/T9/T10): the ONLY writer of
 * `installment_plans` + `installment_lines`. Line DELETE exists solely for
 * the DRAFT-plan edit path (the wizard restructures a draft; the service
 * never deletes an activated plan's lines — the immutability is
 * service-enforced + audited). Every statement runs in the caller's ambient
 * tenant UoW. Journals are NEVER written here (ADR-0007).
 *
 * Cross-module READ refs (sanctioned §4 — never written here):
 * sales_invoices + supplier open items (source validation, attribution),
 * service_contracts + contract_billing_schedule + contract_invoices
 * (contract-plan sources), treasury_allocations + receipts (attribution).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("installments access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- plans ---------------------------------------------------------------------------

export interface InstallmentPlanRow {
  id: string;
  partnerId: string;
  sourceType: "sales_invoice" | "service_contract";
  sourceId: string;
  sourceNo: string | null;
  totalAmount: string;
  downPayment: string;
  lineCount: number;
  startDate: string;
  frequency: string;
  lateFeePolicy: {
    rate: string;
    cap: string;
    grace_days: number;
    auto_charge: boolean;
    defaulted_after_lines: number;
  };
  status: string | null;
  activatedAt: string | null;
  activatedBy: string | null;
  closedAt: string | null;
  defaultedAt: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
}

const PLAN_SELECT = sql`
  SELECT id, partner_id AS "partnerId", source_type AS "sourceType", source_id AS "sourceId",
    source_no AS "sourceNo", total_amount::text AS "totalAmount", down_payment::text AS "downPayment",
    line_count AS "lineCount", start_date::text AS "startDate", frequency,
    late_fee_policy::jsonb AS "lateFeePolicy", status, activated_at::text AS "activatedAt",
    activated_by AS "activatedBy", closed_at::text AS "closedAt", defaulted_at::text AS "defaultedAt",
    note, note_ar AS "noteAr", created_by AS "createdBy", created_at AS "createdAt"
  FROM installment_plans`;

export async function insertPlan(input: {
  partnerId: string;
  sourceType: "sales_invoice" | "service_contract";
  sourceId: string;
  sourceNo: string | null;
  totalAmount: string;
  downPayment: string;
  lineCount: number;
  startDate: string;
  frequency: string;
  lateFeePolicy: InstallmentPlanRow["lateFeePolicy"];
  note?: string | null;
  noteAr?: string | null;
  createdBy: string | null;
}): Promise<InstallmentPlanRow> {
  const id = generateUuidV7();
  const rows = await tenantTx().execute(sql`
    INSERT INTO installment_plans (id, tenant_id, created_by, partner_id, source_type, source_id,
      source_no, total_amount, down_payment, line_count, start_date, frequency, late_fee_policy,
      status, note, note_ar)
    VALUES (${id}, ${requireTenantContext().tenantId}, ${input.createdBy}, ${input.partnerId},
      ${input.sourceType}, ${input.sourceId}, ${input.sourceNo}, ${input.totalAmount},
      ${input.downPayment}, ${input.lineCount}, ${input.startDate}, ${input.frequency},
      ${JSON.stringify(input.lateFeePolicy)}::jsonb, NULL, ${input.note ?? null}, ${input.noteAr ?? null})
    RETURNING id, partner_id AS "partnerId", source_type AS "sourceType", source_id AS "sourceId",
      source_no AS "sourceNo", total_amount::text AS "totalAmount", down_payment::text AS "downPayment",
      line_count AS "lineCount", start_date::text AS "startDate", frequency,
      late_fee_policy::jsonb AS "lateFeePolicy", status, activated_at::text AS "activatedAt",
      activated_by AS "activatedBy", closed_at::text AS "closedAt", defaulted_at::text AS "defaultedAt",
      note, note_ar AS "noteAr", created_by AS "createdBy", created_at AS "createdAt"
  `);
  return (rows.rows as unknown as InstallmentPlanRow[])[0]!;
}

export async function findPlanById(id: string): Promise<InstallmentPlanRow | undefined> {
  const rows = await tenantTx().execute(sql`${PLAN_SELECT} WHERE id = ${id} LIMIT 1`);
  return (rows.rows as unknown as InstallmentPlanRow[])[0];
}

export async function listPlans(filter: {
  partnerId?: string;
  status?: string | null;
  sourceType?: string;
  limit: number;
}): Promise<InstallmentPlanRow[]> {
  const statusClause =
    filter.status === undefined
      ? sql`TRUE`
      : filter.status === null
        ? sql`status IS NULL`
        : sql`status = ${filter.status}`;
  const rows = await tenantTx().execute(sql`
    ${PLAN_SELECT}
    WHERE (${filter.partnerId ?? null}::uuid IS NULL OR partner_id = ${filter.partnerId ?? null})
      AND (${filter.sourceType ?? null}::text IS NULL OR source_type = ${filter.sourceType ?? null})
      AND ${statusClause}
    ORDER BY created_at DESC, id
    LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as InstallmentPlanRow[];
}

export async function updatePlanActivation(
  id: string,
  actorId: string | null,
): Promise<InstallmentPlanRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE installment_plans SET status = 'ACTIVE', activated_at = now(), activated_by = ${actorId},
      version = version + 1, updated_at = now()
    WHERE id = ${id}
    RETURNING id, partner_id AS "partnerId", source_type AS "sourceType", source_id AS "sourceId",
      source_no AS "sourceNo", total_amount::text AS "totalAmount", down_payment::text AS "downPayment",
      line_count AS "lineCount", start_date::text AS "startDate", frequency,
      late_fee_policy::jsonb AS "lateFeePolicy", status, activated_at::text AS "activatedAt",
      activated_by AS "activatedBy", closed_at::text AS "closedAt", defaulted_at::text AS "defaultedAt",
      note, note_ar AS "noteAr", created_by AS "createdBy", created_at AS "createdAt"
  `);
  return (rows.rows as unknown as InstallmentPlanRow[])[0];
}

export async function updatePlanStatus(
  id: string,
  status: "CLOSED" | "DEFAULTED",
): Promise<InstallmentPlanRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE installment_plans SET
      status = ${status},
      closed_at = CASE WHEN ${status} = 'CLOSED' THEN now() ELSE closed_at END,
      defaulted_at = CASE WHEN ${status} = 'DEFAULTED' THEN now() ELSE defaulted_at END,
      version = version + 1, updated_at = now()
    WHERE id = ${id}
    RETURNING id, partner_id AS "partnerId", source_type AS "sourceType", source_id AS "sourceId",
      source_no AS "sourceNo", total_amount::text AS "totalAmount", down_payment::text AS "downPayment",
      line_count AS "lineCount", start_date::text AS "startDate", frequency,
      late_fee_policy::jsonb AS "lateFeePolicy", status, activated_at::text AS "activatedAt",
      activated_by AS "activatedBy", closed_at::text AS "closedAt", defaulted_at::text AS "defaultedAt",
      note, note_ar AS "noteAr", created_by AS "createdBy", created_at AS "createdAt"
  `);
  return (rows.rows as unknown as InstallmentPlanRow[])[0];
}

/** Draft-only restructure inputs (count/frequency/start/down + policy). */
export async function updatePlanDraft(
  id: string,
  patch: {
    totalAmount?: string;
    downPayment?: string;
    lineCount?: number;
    startDate?: string;
    frequency?: string;
    lateFeePolicy?: InstallmentPlanRow["lateFeePolicy"];
    note?: string | null;
    noteAr?: string | null;
  },
): Promise<InstallmentPlanRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE installment_plans SET
      total_amount = COALESCE(${patch.totalAmount ?? null}::numeric, total_amount),
      down_payment = COALESCE(${patch.downPayment ?? null}::numeric, down_payment),
      line_count = COALESCE(${patch.lineCount ?? null}::int, line_count),
      start_date = COALESCE(${patch.startDate ?? null}::date, start_date),
      frequency = COALESCE(${patch.frequency ?? null}::text, frequency),
      late_fee_policy = COALESCE(${patch.lateFeePolicy ? JSON.stringify(patch.lateFeePolicy) : null}::jsonb, late_fee_policy),
      note = COALESCE(${patch.note ?? null}::text, note),
      note_ar = COALESCE(${patch.noteAr ?? null}::text, note_ar),
      version = version + 1, updated_at = now()
    WHERE id = ${id} AND status IS NULL
    RETURNING id, partner_id AS "partnerId", source_type AS "sourceType", source_id AS "sourceId",
      source_no AS "sourceNo", total_amount::text AS "totalAmount", down_payment::text AS "downPayment",
      line_count AS "lineCount", start_date::text AS "startDate", frequency,
      late_fee_policy::jsonb AS "lateFeePolicy", status, activated_at::text AS "activatedAt",
      activated_by AS "activatedBy", closed_at::text AS "closedAt", defaulted_at::text AS "defaultedAt",
      note, note_ar AS "noteAr", created_by AS "createdBy", created_at AS "createdAt"
  `);
  return (rows.rows as unknown as InstallmentPlanRow[])[0];
}

// -- lines --------------------------------------------------------------------------

export interface InstallmentLineRow {
  id: string;
  planId: string;
  seq: number;
  dueDate: string;
  amount: string;
  status: "PENDING" | "DUE" | "PAID" | "OVERDUE" | "WAIVED";
  receiptRefs: { receiptId: string; receiptNo: string | null; amount: string; valueDate: string }[] | null;
  collectedAmount: string;
  waivedAt: string | null;
  waivedBy: string | null;
  waiveReason: string | null;
  lateFeeAmount: string | null;
  lateFeeEntryId: string | null;
  lateFeeChargedAt: string | null;
}

const LINE_SELECT = sql`
  SELECT id, plan_id AS "planId", seq, due_date::text AS "dueDate", amount::text AS amount,
    status, receipt_refs::jsonb AS "receiptRefs", collected_amount::text AS "collectedAmount",
    waived_at::text AS "waivedAt", waived_by AS "waivedBy", waive_reason AS "waiveReason",
    late_fee_amount::text AS "lateFeeAmount", late_fee_entry_id AS "lateFeeEntryId",
    late_fee_charged_at::text AS "lateFeeChargedAt"
  FROM installment_lines`;

export async function insertLines(
  planId: string,
  lines: readonly { seq: number; dueDate: string; amount: string }[],
  createdBy: string | null,
): Promise<void> {
  const tenantId = requireTenantContext().tenantId;
  for (const line of lines) {
    await tenantTx().execute(sql`
      INSERT INTO installment_lines (id, tenant_id, created_by, plan_id, seq, due_date, amount, status)
      VALUES (${generateUuidV7()}, ${tenantId}, ${createdBy}, ${planId}, ${line.seq},
        ${line.dueDate}, ${line.amount}, 'PENDING')
    `);
  }
}

export async function deleteLinesByPlan(planId: string): Promise<void> {
  await tenantTx().execute(sql`DELETE FROM installment_lines WHERE plan_id = ${planId}`);
}

export async function listLinesByPlan(planId: string): Promise<InstallmentLineRow[]> {
  const rows = await tenantTx().execute(sql`
    ${LINE_SELECT} WHERE plan_id = ${planId} ORDER BY seq
  `);
  return rows.rows as unknown as InstallmentLineRow[];
}

export async function findLineById(id: string): Promise<InstallmentLineRow | undefined> {
  const rows = await tenantTx().execute(sql`${LINE_SELECT} WHERE id = ${id} LIMIT 1`);
  return (rows.rows as unknown as InstallmentLineRow[])[0];
}

export async function updateLine(input: {
  id: string;
  status?: InstallmentLineRow["status"];
  receiptRefs?: InstallmentLineRow["receiptRefs"];
  collectedAmount?: string;
  lateFeeAmount?: string | null;
  lateFeeEntryId?: string | null;
  waivedAt?: string;
  waivedBy?: string | null;
  waiveReason?: string | null;
}): Promise<InstallmentLineRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE installment_lines SET
      status = COALESCE(${input.status ?? null}::text, status),
      receipt_refs = COALESCE(${input.receiptRefs === undefined ? null : JSON.stringify(input.receiptRefs)}::jsonb, receipt_refs),
      collected_amount = COALESCE(${input.collectedAmount ?? null}::numeric, collected_amount),
      late_fee_amount = COALESCE(${input.lateFeeAmount === undefined ? null : input.lateFeeAmount}::numeric, late_fee_amount),
      late_fee_entry_id = COALESCE(${input.lateFeeEntryId === undefined ? null : input.lateFeeEntryId}::uuid, late_fee_entry_id),
      late_fee_charged_at = CASE WHEN ${input.lateFeeEntryId === undefined ? null : input.lateFeeEntryId}::uuid IS NOT NULL
        THEN now() ELSE late_fee_charged_at END,
      waived_at = COALESCE(${input.waivedAt ?? null}::timestamptz, waived_at),
      waived_by = COALESCE(${input.waivedBy ?? null}::uuid, waived_by),
      waive_reason = COALESCE(${input.waiveReason ?? null}::text, waive_reason),
      version = version + 1, updated_at = now()
    WHERE id = ${input.id}
    RETURNING id, plan_id AS "planId", seq, due_date::text AS "dueDate", amount::text AS amount,
      status, receipt_refs::jsonb AS "receiptRefs", collected_amount::text AS "collectedAmount",
      waived_at::text AS "waivedAt", waived_by AS "waivedBy", waive_reason AS "waiveReason",
      late_fee_amount::text AS "lateFeeAmount", late_fee_entry_id AS "lateFeeEntryId",
      late_fee_charged_at::text AS "lateFeeChargedAt"
  `);
  return (rows.rows as unknown as InstallmentLineRow[])[0];
}

// -- source validation + attribution reads (sanctioned §4 read refs) ------------------

export interface PlanSourceInvoiceRow {
  id: string;
  invoiceNo: string | null;
  customerId: string;
  kind: string;
  status: string;
  currencyCode: string;
  totalGross: string;
}

export async function findPlanSourceInvoice(id: string): Promise<PlanSourceInvoiceRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, invoice_no AS "invoiceNo", customer_id AS "customerId", kind, status,
      currency_code AS "currencyCode", total_gross::text AS "totalGross"
    FROM sales_invoices WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as PlanSourceInvoiceRow[])[0];
}

export interface PlanSourceContractRow {
  id: string;
  contractNo: string | null;
  partnerId: string;
  status: string;
  currencyCode: string;
  /** Σ schedule amounts (PLANNED + INVOICED, SKIPPED excluded; NULL-amount entries contribute 0). */
  scheduleTotal: string;
}

export async function findPlanSourceContract(id: string): Promise<PlanSourceContractRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT c.id, c.contract_no AS "contractNo", c.partner_id AS "partnerId", c.status,
      c.currency_code AS "currencyCode",
      COALESCE((SELECT SUM(s.amount) FROM contract_billing_schedule s
        WHERE s.contract_id = c.id AND s.status IN ('PLANNED', 'INVOICED')), 0)::text AS "scheduleTotal"
    FROM service_contracts c WHERE c.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as PlanSourceContractRow[])[0];
}

/** The plan's source open items (invoice plans: that item; contract plans: the contract's posted invoices' items). */
export async function sourceOpenItemIdsForPlan(plan: {
  sourceType: string;
  sourceId: string;
}): Promise<string[]> {
  if (plan.sourceType === "sales_invoice") {
    const rows = await tenantTx().execute(sql`
      SELECT s.id FROM partner_subledger_entries s
      WHERE s.source_type = 'sales_invoice' AND s.source_id = ${plan.sourceId} AND s.direction = 'DEBIT'
    `);
    return (rows.rows as unknown as { id: string }[]).map((row) => row.id);
  }
  const rows = await tenantTx().execute(sql`
    SELECT s.id FROM partner_subledger_entries s
    WHERE s.source_type = 'sales_invoice' AND s.direction = 'DEBIT'
      AND s.source_id IN (
        SELECT ci.invoice_id FROM contract_invoices ci
        WHERE ci.contract_id = ${plan.sourceId}
      )
  `);
  return (rows.rows as unknown as { id: string }[]).map((row) => row.id);
}

/** Posted receipt allocations on a set of open items — the attribution source. */
export async function postedAllocationsForItems(
  openItemIds: readonly string[],
): Promise<{ receiptId: string; receiptNo: string | null; openItemId: string; amount: string; valueDate: string }[]> {
  if (openItemIds.length === 0) return [];
  const ids = sql.join(
    openItemIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = await tenantTx().execute(sql`
    SELECT a.receipt_id AS "receiptId", r.receipt_no AS "receiptNo", a.open_item_id AS "openItemId",
      a.amount::text AS amount, r.value_date::text AS "valueDate"
    FROM treasury_allocations a
    JOIN receipts r ON r.id = a.receipt_id AND r.tenant_id = a.tenant_id AND r.status = 'POSTED'
    WHERE a.open_item_id IN (${ids})
    ORDER BY r.value_date, a.created_at
  `);
  return rows.rows as unknown as {
    receiptId: string;
    receiptNo: string | null;
    openItemId: string;
    amount: string;
    valueDate: string;
  }[];
}

// -- reporting reads (PHASE-027 wave E — append-only, read-only) -----------------------

/** One uncollected line joined to its plan + partner (the installments-aging grain). */
export interface InstallmentAgingLineRow {
  lineId: string;
  planId: string;
  seq: number;
  dueDate: string;
  amount: string;
  status: InstallmentLineRow["status"];
  collectedAmount: string;
  /** amount − collected (the outstanding the aging buckets carry). */
  residualAmount: string;
  lateFeeAmount: string | null;
  partnerId: string;
  partnerName: string | null;
  partnerNameAr: string | null;
  planSourceNo: string | null;
  planSourceType: string;
  planSourceId: string;
  planStatus: string;
  frequency: string;
  lateFeePolicy: InstallmentPlanRow["lateFeePolicy"];
}

/**
 * The installments-aging read (REPORT_CATALOG §9 row 235): UNCOLLECTED lines
 * (status PENDING/DUE/OVERDUE — PAID lines are collected, WAIVED lines are
 * cancelled) of plans in their activated, un-closed lifecycle (ACTIVE +
 * DEFAULTED) that were activated as-of (activated_at::date <= asOf — the
 * as-of population anchor; drafts carry NULL activated_at and never appear).
 *
 * AS-OF RULE (documented in the contract): collections attribution is
 * job-derived and time-varying, so the lines render their CURRENT states
 * (the plan register owns them — collected_amount/status/receipt_refs) with
 * the asOf anchoring the population + the due-date buckets. Residual is the
 * exact SQL subtract at the 4dp money scale. Read-only; never written here.
 */
export async function listLinesForAging(filter: {
  asOf: string;
  partnerId?: string;
  limit: number;
}): Promise<InstallmentAgingLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT l.id AS "lineId", l.plan_id AS "planId", l.seq, l.due_date::text AS "dueDate",
      l.amount::text AS amount, l.status, l.collected_amount::text AS "collectedAmount",
      (l.amount - l.collected_amount)::numeric(19,4)::text AS "residualAmount",
      l.late_fee_amount::text AS "lateFeeAmount",
      p.partner_id AS "partnerId", pt.name AS "partnerName", pt.name_ar AS "partnerNameAr",
      p.source_no AS "planSourceNo", p.source_type AS "planSourceType", p.source_id AS "planSourceId",
      p.status AS "planStatus", p.frequency,
      p.late_fee_policy::jsonb AS "lateFeePolicy"
    FROM installment_lines l
    JOIN installment_plans p ON p.id = l.plan_id
    LEFT JOIN partners pt ON pt.id = p.partner_id AND pt.tenant_id = p.tenant_id
    WHERE p.status IN ('ACTIVE', 'DEFAULTED')
      AND p.activated_at::date <= ${filter.asOf}
      AND l.status IN ('PENDING', 'DUE', 'OVERDUE')
      AND (${filter.partnerId ?? null}::uuid IS NULL OR p.partner_id = ${filter.partnerId ?? null})
    ORDER BY l.due_date, p.id, l.seq
    LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as InstallmentAgingLineRow[];
}

/** Σ collected_amount over ALL lines per plan (the INV-016 tie's line side). */
export async function collectedTotalsByPlan(
  planIds: readonly string[],
): Promise<{ planId: string; collected: string }[]> {
  if (planIds.length === 0) return [];
  const ids = sql.join(
    planIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = await tenantTx().execute(sql`
    SELECT plan_id AS "planId", COALESCE(SUM(collected_amount), 0)::numeric(19,4)::text AS collected
    FROM installment_lines
    WHERE plan_id IN (${ids})
    GROUP BY plan_id
  `);
  return rows.rows as unknown as { planId: string; collected: string }[];
}
