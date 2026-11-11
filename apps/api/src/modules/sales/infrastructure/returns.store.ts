import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import {
  returnAuthorizationLines,
  returnAuthorizations,
  warrantyRegistrations,
} from "../../../db/schema";
import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * Returns store (PHASE-039 0055): the ONLY writer of the customer-RMA pair
 * (return_authorizations, return_authorization_lines) and the warranty
 * register (warranty_registrations). Every statement runs in the caller's
 * ambient tenant UoW (the tenant-context interceptor opens the transaction
 * and sets the RLS GUC; erp.current_tenant_id() stamps every INSERT) — the
 * sourcing.store discipline over the drizzle schema tables.
 *
 * Line replacement is delete+insert (replaceRmaLines — the rfq_lines
 * replace-on-edit precedent; DELETE is granted on the lines table only).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("returns access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- return_authorizations ---------------------------------------------------------

export interface RmaRow {
  id: string;
  branchId: string;
  rmaNo: string | null;
  partnerId: string;
  invoiceId: string;
  reasonCode: string;
  reason: string | null;
  reasonAr: string | null;
  status: string;
  disposition: string | null;
  currencyCode: string;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  requestedAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  receivedAt: string | null;
  receivedBy: string | null;
  inspectedAt: string | null;
  inspectedBy: string | null;
  inspectionNote: string | null;
  completedAt: string | null;
  completedBy: string | null;
  creditNoteId: string | null;
  postedJournalId: string | null;
  entryNo: string | null;
  refundCashAccountId: string | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const RMA_COLUMNS = {
  id: returnAuthorizations.id,
  branchId: returnAuthorizations.branchId,
  rmaNo: returnAuthorizations.rmaNo,
  partnerId: returnAuthorizations.partnerId,
  invoiceId: returnAuthorizations.invoiceId,
  reasonCode: returnAuthorizations.reasonCode,
  reason: returnAuthorizations.reason,
  reasonAr: returnAuthorizations.reasonAr,
  status: returnAuthorizations.status,
  disposition: returnAuthorizations.disposition,
  currencyCode: returnAuthorizations.currencyCode,
  totalNet: returnAuthorizations.totalNet,
  totalTax: returnAuthorizations.totalTax,
  totalGross: returnAuthorizations.totalGross,
  requestedAt: returnAuthorizations.requestedAt,
  approvedAt: returnAuthorizations.approvedAt,
  approvedBy: returnAuthorizations.approvedBy,
  receivedAt: returnAuthorizations.receivedAt,
  receivedBy: returnAuthorizations.receivedBy,
  inspectedAt: returnAuthorizations.inspectedAt,
  inspectedBy: returnAuthorizations.inspectedBy,
  inspectionNote: returnAuthorizations.inspectionNote,
  completedAt: returnAuthorizations.completedAt,
  completedBy: returnAuthorizations.completedBy,
  creditNoteId: returnAuthorizations.creditNoteId,
  postedJournalId: returnAuthorizations.postedJournalId,
  entryNo: returnAuthorizations.entryNo,
  refundCashAccountId: returnAuthorizations.refundCashAccountId,
  cancelledAt: returnAuthorizations.cancelledAt,
  cancelledBy: returnAuthorizations.cancelledBy,
  cancelReason: returnAuthorizations.cancelReason,
  note: returnAuthorizations.note,
  noteAr: returnAuthorizations.noteAr,
  createdBy: returnAuthorizations.createdBy,
  createdAt: returnAuthorizations.createdAt,
  updatedAt: returnAuthorizations.updatedAt,
  version: returnAuthorizations.version,
} as const;

export async function insertRma(input: {
  branchId: string;
  partnerId: string;
  invoiceId: string;
  reasonCode: string;
  reason: string | null;
  reasonAr: string | null;
  currencyCode: string;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<string> {
  const id = generateUuidV7();
  await tenantTx()
    .insert(returnAuthorizations)
    .values({
      id,
      tenantId: sql`erp.current_tenant_id()`,
      createdBy: input.actorId,
      branchId: input.branchId,
      partnerId: input.partnerId,
      invoiceId: input.invoiceId,
      reasonCode: input.reasonCode,
      reason: input.reason,
      reasonAr: input.reasonAr,
      status: "REQUESTED",
      currencyCode: input.currencyCode,
      totalNet: input.totalNet,
      totalTax: input.totalTax,
      totalGross: input.totalGross,
      note: input.note,
      noteAr: input.noteAr,
    });
  return id;
}

export async function findRmaById(id: string): Promise<RmaRow | undefined> {
  const rows = await tenantTx()
    .select(RMA_COLUMNS)
    .from(returnAuthorizations)
    .where(eq(returnAuthorizations.id, id))
    .limit(1);
  return (rows as RmaRow[])[0];
}

export async function listRmas(filter: {
  status?: string;
  partnerId?: string;
  limit: number;
}): Promise<RmaRow[]> {
  const conditions = [];
  if (filter.status !== undefined && filter.status !== "") {
    conditions.push(eq(returnAuthorizations.status, filter.status));
  }
  if (filter.partnerId !== undefined && filter.partnerId !== "") {
    conditions.push(eq(returnAuthorizations.partnerId, filter.partnerId));
  }
  const rows = await tenantTx()
    .select(RMA_COLUMNS)
    .from(returnAuthorizations)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(returnAuthorizations.createdAt))
    .limit(filter.limit);
  return rows as RmaRow[];
}

export async function updateRma(
  id: string,
  patch: {
    status?: string;
    rmaNo?: string;
    disposition?: string;
    inspectionNote?: string | null;
    approvedAt?: string | null;
    approvedBy?: string | null;
    receivedAt?: string | null;
    receivedBy?: string | null;
    inspectedAt?: string | null;
    inspectedBy?: string | null;
    completedAt?: string | null;
    completedBy?: string | null;
    creditNoteId?: string | null;
    postedJournalId?: string | null;
    entryNo?: string | null;
    refundCashAccountId?: string | null;
    cancelledAt?: string | null;
    cancelledBy?: string | null;
    cancelReason?: string | null;
  },
): Promise<void> {
  await tenantTx()
    .update(returnAuthorizations)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(returnAuthorizations.id, id));
}

// -- return_authorization_lines ----------------------------------------------------

export interface RmaLineRow {
  id: string;
  rmaId: string;
  lineNo: number;
  invoiceLineId: string;
  itemId: string | null;
  qty: string;
  unitPrice: string;
  discountAmount: string;
  taxCodeId: string | null;
  netAmount: string;
  taxAmount: string;
  note: string | null;
}

const RMA_LINE_COLUMNS = {
  id: returnAuthorizationLines.id,
  rmaId: returnAuthorizationLines.rmaId,
  lineNo: returnAuthorizationLines.lineNo,
  invoiceLineId: returnAuthorizationLines.invoiceLineId,
  itemId: returnAuthorizationLines.itemId,
  qty: returnAuthorizationLines.qty,
  unitPrice: returnAuthorizationLines.unitPrice,
  discountAmount: returnAuthorizationLines.discountAmount,
  taxCodeId: returnAuthorizationLines.taxCodeId,
  netAmount: returnAuthorizationLines.netAmount,
  taxAmount: returnAuthorizationLines.taxAmount,
  note: returnAuthorizationLines.note,
} as const;

export async function insertRmaLines(
  rmaId: string,
  lines: readonly {
    invoiceLineId: string;
    itemId: string | null;
    qty: string;
    unitPrice: string;
    discountAmount: string;
    taxCodeId: string | null;
    netAmount: string;
    taxAmount: string;
    note: string | null;
  }[],
): Promise<void> {
  const tx = tenantTx();
  let lineNo = 0;
  for (const line of lines) {
    lineNo += 1;
    await tx.insert(returnAuthorizationLines).values({
      id: generateUuidV7(),
      tenantId: sql`erp.current_tenant_id()`,
      rmaId,
      lineNo,
      invoiceLineId: line.invoiceLineId,
      itemId: line.itemId,
      qty: line.qty,
      unitPrice: line.unitPrice,
      discountAmount: line.discountAmount,
      taxCodeId: line.taxCodeId,
      netAmount: line.netAmount,
      taxAmount: line.taxAmount,
      note: line.note,
    });
  }
}

export async function deleteRmaLines(rmaId: string): Promise<void> {
  await tenantTx().delete(returnAuthorizationLines).where(eq(returnAuthorizationLines.rmaId, rmaId));
}

/** Replace-on-edit: delete + insert in one ambient UoW (the rfq_lines path). */
export async function replaceRmaLines(
  rmaId: string,
  lines: readonly Parameters<typeof insertRmaLines>[1][number][],
): Promise<void> {
  await deleteRmaLines(rmaId);
  await insertRmaLines(rmaId, lines);
}

export async function listRmaLines(rmaId: string): Promise<RmaLineRow[]> {
  const rows = await tenantTx()
    .select(RMA_LINE_COLUMNS)
    .from(returnAuthorizationLines)
    .where(eq(returnAuthorizationLines.rmaId, rmaId))
    .orderBy(asc(returnAuthorizationLines.lineNo));
  return rows as RmaLineRow[];
}

/**
 * The open-RMA fold: lines of every NON-TERMINAL, non-cancelled RMA on the
 * invoice (REQUESTED/APPROVED/RECEIVED/INSPECTED). Terminal RMAs are NOT
 * here — their qty flows back through creditedQtyByInvoiceLine via the
 * completion credit note (counting both would double-subtract).
 */
export async function listOpenRmaLinesByInvoice(invoiceId: string): Promise<RmaLineRow[]> {
  const rows = await tenantTx()
    .select(RMA_LINE_COLUMNS)
    .from(returnAuthorizationLines)
    .innerJoin(returnAuthorizations, eq(returnAuthorizations.id, returnAuthorizationLines.rmaId))
    .where(
      and(
        eq(returnAuthorizations.invoiceId, invoiceId),
        inArray(returnAuthorizations.status, ["REQUESTED", "APPROVED", "RECEIVED", "INSPECTED"]),
      ),
    )
    .orderBy(asc(returnAuthorizationLines.lineNo));
  return rows as RmaLineRow[];
}

/**
 * Σ credited qty per invoice line — the credit-notes.ts fold (POSTED +
 * APPROVED notes only), collapsed into one GROUP BY over the same rows the
 * service iterates.
 */
export async function creditedQtyByInvoiceLine(invoiceId: string): Promise<Map<string, string>> {
  const rows = await tenantTx().execute(sql`
    SELECT l.invoice_line_id AS "invoiceLineId", SUM(l.qty)::text AS qty
    FROM credit_note_lines l
    JOIN credit_notes n ON n.id = l.note_id
    WHERE n.invoice_id = ${invoiceId} AND n.status IN ('POSTED', 'APPROVED')
    GROUP BY l.invoice_line_id
  `);
  const map = new Map<string, string>();
  for (const row of rows.rows as unknown as { invoiceLineId: string; qty: string }[]) {
    map.set(row.invoiceLineId, row.qty);
  }
  return map;
}

// -- warranty_registrations --------------------------------------------------------

export interface WarrantyRow {
  id: string;
  partnerId: string;
  itemId: string;
  serialNo: string | null;
  invoiceId: string | null;
  jobCardId: string | null;
  terms: Record<string, unknown>;
  startDate: string;
  endDate: string;
  status: string;
  lastNotifiedAt: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const WARRANTY_COLUMNS = {
  id: warrantyRegistrations.id,
  partnerId: warrantyRegistrations.partnerId,
  itemId: warrantyRegistrations.itemId,
  serialNo: warrantyRegistrations.serialNo,
  invoiceId: warrantyRegistrations.invoiceId,
  jobCardId: warrantyRegistrations.jobCardId,
  terms: warrantyRegistrations.terms,
  startDate: warrantyRegistrations.startDate,
  endDate: warrantyRegistrations.endDate,
  status: warrantyRegistrations.status,
  lastNotifiedAt: warrantyRegistrations.lastNotifiedAt,
  note: warrantyRegistrations.note,
  noteAr: warrantyRegistrations.noteAr,
  createdBy: warrantyRegistrations.createdBy,
  createdAt: warrantyRegistrations.createdAt,
  updatedAt: warrantyRegistrations.updatedAt,
  version: warrantyRegistrations.version,
} as const;

export async function insertWarranty(input: {
  partnerId: string;
  itemId: string;
  serialNo: string | null;
  invoiceId: string | null;
  jobCardId: string | null;
  terms: Record<string, unknown>;
  startDate: string;
  endDate: string;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<string> {
  const id = generateUuidV7();
  await tenantTx().insert(warrantyRegistrations).values({
    id,
    tenantId: sql`erp.current_tenant_id()`,
    createdBy: input.actorId,
    partnerId: input.partnerId,
    itemId: input.itemId,
    serialNo: input.serialNo,
    invoiceId: input.invoiceId,
    jobCardId: input.jobCardId,
    terms: input.terms,
    startDate: input.startDate,
    endDate: input.endDate,
    status: "ACTIVE",
    note: input.note,
    noteAr: input.noteAr,
  });
  return id;
}

export async function findWarrantyById(id: string): Promise<WarrantyRow | undefined> {
  const rows = await tenantTx()
    .select(WARRANTY_COLUMNS)
    .from(warrantyRegistrations)
    .where(eq(warrantyRegistrations.id, id))
    .limit(1);
  return (rows as WarrantyRow[])[0];
}

export async function listWarranties(filter: {
  partnerId?: string;
  status?: string;
  limit: number;
}): Promise<WarrantyRow[]> {
  const conditions = [];
  if (filter.partnerId !== undefined && filter.partnerId !== "") {
    conditions.push(eq(warrantyRegistrations.partnerId, filter.partnerId));
  }
  if (filter.status !== undefined && filter.status !== "") {
    conditions.push(eq(warrantyRegistrations.status, filter.status));
  }
  const rows = await tenantTx()
    .select(WARRANTY_COLUMNS)
    .from(warrantyRegistrations)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(warrantyRegistrations.createdAt))
    .limit(filter.limit);
  return rows as WarrantyRow[];
}

/**
 * The sweep workset: ACTIVE warranties whose end date falls inside the
 * window (today .. today + withinDays, inclusive) and that were NOT already
 * notified today — the per-window dedupe key makes each (warranty, window)
 * fire once ever; the date gate keeps the nightly re-run a no-op.
 */
export async function expiringWarranties(input: {
  withinDays: number;
  limit: number;
}): Promise<WarrantyRow[]> {
  const rows = await tenantTx()
    .select(WARRANTY_COLUMNS)
    .from(warrantyRegistrations)
    .where(
      and(
        eq(warrantyRegistrations.status, "ACTIVE"),
        gte(warrantyRegistrations.endDate, sql`CURRENT_DATE`),
        lte(warrantyRegistrations.endDate, sql`CURRENT_DATE + ${input.withinDays}`),
        // Not already notified today — the per-window dedupe key makes each
        // (warranty, window) fire once ever; this keeps the nightly re-run
        // and the wider windows of the SAME run a no-op after the tightest
        // window has notified.
        sql`(${warrantyRegistrations.lastNotifiedAt} IS NULL OR ${warrantyRegistrations.lastNotifiedAt}::date < CURRENT_DATE)`,
      ),
    )
    .orderBy(asc(warrantyRegistrations.endDate))
    .limit(input.limit);
  return rows as WarrantyRow[];
}

export async function markWarrantyNotified(id: string): Promise<void> {
  await tenantTx()
    .update(warrantyRegistrations)
    .set({ lastNotifiedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(warrantyRegistrations.id, id));
}

export async function voidWarranty(id: string): Promise<void> {
  await tenantTx()
    .update(warrantyRegistrations)
    .set({ status: "VOID", updatedAt: sql`now()` })
    .where(eq(warrantyRegistrations.id, id));
}
