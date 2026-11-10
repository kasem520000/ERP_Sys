import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * Job-card store (PHASE-017 T3): the ONLY writer of the sales-owned
 * `job_cards` + `job_card_lines` tables (migration 0025; drizzle exports
 * `jobCards`/`jobCardLines`). Every statement runs in the caller's ambient
 * tenant UoW so a failure anywhere rolls the whole business operation back
 * — approvals compose the inventory reservation service, invoicing (T4)
 * composes the posting engine, all in ONE transaction (INV-018
 * discipline). stock_moves/journal rows are NEVER written here
 * (MODULE_BOUNDARIES — inventory/accounting exclusively own them); the
 * job-card service only links ids (reservation/issue/invoice linkage).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("job-card access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- cards ------------------------------------------------------------------------

export interface JobCardRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  branchId: string;
  cardNo: string | null;
  customerId: string;
  vehicleId: string | null;
  status: string;
  partsIssueMode: string;
  warehouseId: string;
  complaints: string | null;
  complaintsAr: string | null;
  diagnosis: string | null;
  diagnosisAr: string | null;
  odometerKm: string | null;
  checkedInAt: string | null;
  approvedAt: string | null;
  completedAt: string | null;
  invoicedAt: string | null;
  cancelledAt: string | null;
  quotationId: string | null;
  invoiceId: string | null;
  creditNoteId: string | null;
  laborHoursTotal: string;
  note: string | null;
  noteAr: string | null;
}

const JOB_CARD_COLUMNS = sql`id, created_at::text AS "createdAt", updated_at::text AS "updatedAt",
  created_by AS "createdBy", branch_id AS "branchId", card_no AS "cardNo", customer_id AS "customerId",
  vehicle_id AS "vehicleId", status, parts_issue_mode AS "partsIssueMode", warehouse_id AS "warehouseId",
  complaints, complaints_ar AS "complaintsAr", diagnosis, diagnosis_ar AS "diagnosisAr",
  odometer_km::text AS "odometerKm", checked_in_at::text AS "checkedInAt", approved_at::text AS "approvedAt",
  completed_at::text AS "completedAt", invoiced_at::text AS "invoicedAt", cancelled_at::text AS "cancelledAt",
  quotation_id AS "quotationId", invoice_id AS "invoiceId", credit_note_id AS "creditNoteId",
  labor_hours_total::text AS "laborHoursTotal", note, note_ar AS "noteAr"`;

/** A line as the store persists it (the service normalizes decimals first). */
export interface JobCardLineInsert {
  /** Preserved id on a DRAFT full-replace (PUT); omitted → generated. */
  id?: string | null;
  jobCardId: string;
  lineNo: number;
  lineType: string;
  itemId: string;
  description: string | null;
  descriptionAr: string | null;
  qty: string;
  unitPrice: string;
  /** LABOR only (the billed quantity); NULL for PARTS lines. */
  estimatedHours: string | null;
  loggedHours?: string;
  discountAmount: string;
  taxCodeId: string | null;
  status?: string;
  reservationId?: string | null;
  issueUnitCost?: string | null;
  issueValue?: string | null;
  issueJournalId?: string | null;
  invoiceLineId?: string | null;
  note: string | null;
  createdBy: string | null;
}

export async function insertJobCard(input: {
  branchId: string;
  cardNo: string | null;
  customerId: string;
  vehicleId: string | null;
  partsIssueMode: string;
  warehouseId: string;
  complaints: string | null;
  complaintsAr: string | null;
  diagnosis: string | null;
  diagnosisAr: string | null;
  odometerKm: string | null;
  checkedInAt: string | null;
  laborHoursTotal: string;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
  lines: readonly Omit<JobCardLineInsert, "jobCardId" | "lineNo" | "createdBy">[];
}): Promise<JobCardRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO job_cards (id, tenant_id, branch_id, card_no, customer_id, vehicle_id,
                            parts_issue_mode, warehouse_id, complaints, complaints_ar,
                            diagnosis, diagnosis_ar, odometer_km, checked_in_at,
                            labor_hours_total, note, note_ar, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.branchId}, ${input.cardNo}, ${input.customerId},
            ${input.vehicleId}, ${input.partsIssueMode}, ${input.warehouseId}, ${input.complaints},
            ${input.complaintsAr}, ${input.diagnosis}, ${input.diagnosisAr}, ${input.odometerKm},
            ${input.checkedInAt === null ? null : sql`${input.checkedInAt}::timestamptz`},
            ${input.laborHoursTotal}, ${input.note}, ${input.noteAr}, ${input.actorId})
  `);
  let lineNo = 0;
  for (const line of input.lines) {
    lineNo += 1;
    await insertJobCardLine({ ...line, jobCardId: id, lineNo, createdBy: input.actorId });
  }
  return findJobCardById(id) as Promise<JobCardRow>;
}

export async function findJobCardById(id: string): Promise<JobCardRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${JOB_CARD_COLUMNS} FROM job_cards WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as JobCardRow[])[0];
}

export async function listJobCards(filter: {
  status?: string;
  customerId?: string;
  vehicleId?: string;
  limit: number;
}): Promise<JobCardRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${JOB_CARD_COLUMNS} FROM job_cards
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.customerId ?? null}::uuid IS NULL OR customer_id = ${filter.customerId ?? null})
      AND (${filter.vehicleId ?? null}::uuid IS NULL OR vehicle_id = ${filter.vehicleId ?? null})
    ORDER BY created_at DESC LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as JobCardRow[];
}

/**
 * The single card mutation point (status transitions + field patches).
 * `null`/absent values leave the column untouched (COALESCE semantics,
 * updateQuotationStatus-style); the state timestamps stamp via CASE on the
 * target status so approved_at/completed_at/invoiced_at/cancelled_at are
 * written exactly once, with the transition.
 */
export async function patchJobCard(input: {
  id: string;
  status?: string;
  complaints?: string | null;
  complaintsAr?: string | null;
  diagnosis?: string | null;
  diagnosisAr?: string | null;
  note?: string | null;
  noteAr?: string | null;
  odometerKm?: string | null;
  quotationId?: string | null;
  invoiceId?: string | null;
  laborHoursTotal?: string;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE job_cards SET
      status = COALESCE(${input.status ?? null}, status),
      complaints = COALESCE(${input.complaints ?? null}, complaints),
      complaints_ar = COALESCE(${input.complaintsAr ?? null}, complaints_ar),
      diagnosis = COALESCE(${input.diagnosis ?? null}, diagnosis),
      diagnosis_ar = COALESCE(${input.diagnosisAr ?? null}, diagnosis_ar),
      note = COALESCE(${input.note ?? null}, note),
      note_ar = COALESCE(${input.noteAr ?? null}, note_ar),
      odometer_km = COALESCE(${input.odometerKm ?? null}, odometer_km),
      quotation_id = COALESCE(${input.quotationId ?? null}, quotation_id),
      invoice_id = COALESCE(${input.invoiceId ?? null}, invoice_id),
      labor_hours_total = COALESCE(${input.laborHoursTotal ?? null}, labor_hours_total),
      approved_at = CASE WHEN ${input.status ?? null} = 'IN_PROGRESS' THEN now() ELSE approved_at END,
      completed_at = CASE WHEN ${input.status ?? null} = 'COMPLETED' THEN now() ELSE completed_at END,
      invoiced_at = CASE WHEN ${input.status ?? null} = 'INVOICED' THEN now() ELSE invoiced_at END,
      cancelled_at = CASE WHEN ${input.status ?? null} = 'CANCELLED' THEN now() ELSE cancelled_at END,
      version = version + 1, updated_at = now()
    WHERE id = ${input.id}
  `);
}

// -- lines ------------------------------------------------------------------------

export interface JobCardLineRow {
  id: string;
  jobCardId: string;
  lineNo: number;
  lineType: string;
  itemId: string;
  description: string | null;
  descriptionAr: string | null;
  qty: string;
  unitPrice: string;
  estimatedHours: string | null;
  loggedHours: string;
  discountAmount: string;
  taxCodeId: string | null;
  status: string;
  reservationId: string | null;
  issueUnitCost: string | null;
  issueValue: string | null;
  issueJournalId: string | null;
  invoiceLineId: string | null;
  note: string | null;
  createdBy: string | null;
}

const JOB_CARD_LINE_COLUMNS = sql`id, job_card_id AS "jobCardId", line_no AS "lineNo",
  line_type AS "lineType", item_id AS "itemId", description, description_ar AS "descriptionAr",
  qty::text AS qty, unit_price::text AS "unitPrice", estimated_hours::text AS "estimatedHours",
  logged_hours::text AS "loggedHours", discount_amount::text AS "discountAmount",
  tax_code_id AS "taxCodeId", status, reservation_id AS "reservationId",
  issue_unit_cost::text AS "issueUnitCost", issue_value::text AS "issueValue",
  issue_journal_id AS "issueJournalId", invoice_line_id AS "invoiceLineId",
  note, created_by AS "createdBy"`;

export async function insertJobCardLine(line: JobCardLineInsert): Promise<void> {
  await tenantTx().execute(sql`
    INSERT INTO job_card_lines (id, tenant_id, job_card_id, line_no, line_type, item_id,
                                description, description_ar, qty, unit_price, estimated_hours,
                                logged_hours, discount_amount, tax_code_id, status,
                                reservation_id, issue_unit_cost, issue_value, issue_journal_id,
                                invoice_line_id, note, created_by)
    VALUES (${line.id ?? generateUuidV7()}, erp.current_tenant_id(), ${line.jobCardId}, ${line.lineNo},
            ${line.lineType}, ${line.itemId}, ${line.description}, ${line.descriptionAr}, ${line.qty},
            ${line.unitPrice}, ${line.estimatedHours}, ${line.loggedHours ?? "0"}, ${line.discountAmount},
            ${line.taxCodeId}, ${line.status ?? "PENDING"}, ${line.reservationId ?? null},
            ${line.issueUnitCost ?? null}, ${line.issueValue ?? null}, ${line.issueJournalId ?? null},
            ${line.invoiceLineId ?? null}, ${line.note}, ${line.createdBy})
  `);
}

export async function listJobCardLines(cardId: string): Promise<JobCardLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${JOB_CARD_LINE_COLUMNS} FROM job_card_lines
    WHERE job_card_id = ${cardId} ORDER BY line_no
  `);
  return rows.rows as unknown as JobCardLineRow[];
}

export async function findJobCardLineById(id: string): Promise<JobCardLineRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${JOB_CARD_LINE_COLUMNS} FROM job_card_lines WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as JobCardLineRow[])[0];
}

/**
 * The single line mutation point: lifecycle status, the reservation link
 * (approve under `reserve`), the issue linkage (T4 `issue_immediate`:
 * unit cost/value/journal), the invoice-line link (T4 invoicing), logged
 * hours, and the DRAFT full-replace field updates. Absent fields leave the
 * column untouched (COALESCE semantics).
 */
export async function patchJobCardLine(input: {
  id: string;
  lineNo?: number;
  status?: string;
  reservationId?: string | null;
  issueUnitCost?: string | null;
  issueValue?: string | null;
  issueJournalId?: string | null;
  invoiceLineId?: string | null;
  loggedHours?: string;
  qty?: string;
  unitPrice?: string;
  estimatedHours?: string | null;
  discountAmount?: string;
  taxCodeId?: string | null;
  description?: string | null;
  descriptionAr?: string | null;
  note?: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE job_card_lines SET
      line_no = COALESCE(${input.lineNo ?? null}, line_no),
      status = COALESCE(${input.status ?? null}, status),
      reservation_id = COALESCE(${input.reservationId ?? null}, reservation_id),
      issue_unit_cost = COALESCE(${input.issueUnitCost ?? null}, issue_unit_cost),
      issue_value = COALESCE(${input.issueValue ?? null}, issue_value),
      issue_journal_id = COALESCE(${input.issueJournalId ?? null}, issue_journal_id),
      invoice_line_id = COALESCE(${input.invoiceLineId ?? null}, invoice_line_id),
      logged_hours = COALESCE(${input.loggedHours ?? null}, logged_hours),
      qty = COALESCE(${input.qty ?? null}, qty),
      unit_price = COALESCE(${input.unitPrice ?? null}, unit_price),
      estimated_hours = COALESCE(${input.estimatedHours ?? null}, estimated_hours),
      discount_amount = COALESCE(${input.discountAmount ?? null}, discount_amount),
      tax_code_id = COALESCE(${input.taxCodeId ?? null}, tax_code_id),
      description = COALESCE(${input.description ?? null}, description),
      description_ar = COALESCE(${input.descriptionAr ?? null}, description_ar),
      note = COALESCE(${input.note ?? null}, note),
      version = version + 1, updated_at = now()
    WHERE id = ${input.id}
  `);
}

/**
 * DRAFT full-replace (PUT :id): the provided array IS the live line set —
 * lines carrying an `id` keep that row id and are patched in place with
 * the new fields at their input position; lines without ids insert; OLD
 * lines not mentioned are tombstoned `status = CANCELLED`, never deleted
 * (the 0025 grant model is status-lifecycled — erp_app holds no DELETE on
 * job_card_lines). Renumbering runs through a negation park: every
 * existing row first flips to `-line_no` so the unique (tenant, card,
 * line_no) index never collides while rows move to their final positions
 * (tombstones stay parked negative; the live set ends up 1..n).
 */
export async function replaceJobCardLines(
  cardId: string,
  lines: readonly Omit<JobCardLineInsert, "jobCardId" | "lineNo">[],
): Promise<void> {
  const tx = tenantTx();
  await tx.execute(sql`
    UPDATE job_card_lines SET line_no = -line_no, version = version + 1, updated_at = now()
    WHERE job_card_id = ${cardId}
  `);
  const keepIds = new Set<string>();
  for (const line of lines) {
    if (line.id !== null && line.id !== undefined) keepIds.add(line.id);
  }
  const existing = await listJobCardLines(cardId);
  for (const row of existing) {
    if (row.status !== "CANCELLED" && !keepIds.has(row.id)) {
      await patchJobCardLine({ id: row.id, status: "CANCELLED" });
    }
  }
  let lineNo = 0;
  for (const line of lines) {
    lineNo += 1;
    if (line.id !== null && line.id !== undefined) {
      await patchJobCardLine({
        id: line.id,
        lineNo,
        status: line.status ?? "PENDING",
        qty: line.qty,
        unitPrice: line.unitPrice,
        estimatedHours: line.estimatedHours,
        discountAmount: line.discountAmount,
        taxCodeId: line.taxCodeId,
        description: line.description,
        descriptionAr: line.descriptionAr,
        note: line.note,
      });
    } else {
      await insertJobCardLine({ ...line, jobCardId: cardId, lineNo });
    }
  }
}
