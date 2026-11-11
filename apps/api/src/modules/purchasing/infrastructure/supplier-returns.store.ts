import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import {
  supplierReturnAuthorizationLines,
  supplierReturnAuthorizations,
} from "../../../db/schema";
import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * Supplier-returns store (PHASE-039 0059): the ONLY writer of the
 * return-to-vendor pair (supplier_return_authorizations,
 * supplier_return_authorization_lines) — the customer returns.store mirror
 * over the purchasing side. Ambient tenant UoW only (the sourcing.store
 * discipline over the drizzle schema tables); erp.current_tenant_id()
 * stamps every INSERT.
 *
 * Line replacement is delete+insert (replaceSupplierRmaLines — the
 * replace-on-DRAFT-edit precedent; DELETE is granted on the lines table
 * only).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("supplier-returns access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- supplier_return_authorizations -------------------------------------------------

export interface SupplierRmaRow {
  id: string;
  branchId: string;
  srmaNo: string | null;
  supplierId: string;
  purchaseOrderId: string;
  reasonCode: string;
  reason: string | null;
  reasonAr: string | null;
  status: string;
  currencyCode: string;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  requestedAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
  shippedAt: string | null;
  shippedBy: string | null;
  creditedAt: string | null;
  creditedBy: string | null;
  debitNoteId: string | null;
  postedJournalId: string | null;
  entryNo: string | null;
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

const SRMA_COLUMNS = {
  id: supplierReturnAuthorizations.id,
  branchId: supplierReturnAuthorizations.branchId,
  srmaNo: supplierReturnAuthorizations.srmaNo,
  supplierId: supplierReturnAuthorizations.supplierId,
  purchaseOrderId: supplierReturnAuthorizations.purchaseOrderId,
  reasonCode: supplierReturnAuthorizations.reasonCode,
  reason: supplierReturnAuthorizations.reason,
  reasonAr: supplierReturnAuthorizations.reasonAr,
  status: supplierReturnAuthorizations.status,
  currencyCode: supplierReturnAuthorizations.currencyCode,
  totalNet: supplierReturnAuthorizations.totalNet,
  totalTax: supplierReturnAuthorizations.totalTax,
  totalGross: supplierReturnAuthorizations.totalGross,
  requestedAt: supplierReturnAuthorizations.requestedAt,
  approvedAt: supplierReturnAuthorizations.approvedAt,
  approvedBy: supplierReturnAuthorizations.approvedBy,
  shippedAt: supplierReturnAuthorizations.shippedAt,
  shippedBy: supplierReturnAuthorizations.shippedBy,
  creditedAt: supplierReturnAuthorizations.creditedAt,
  creditedBy: supplierReturnAuthorizations.creditedBy,
  debitNoteId: supplierReturnAuthorizations.debitNoteId,
  postedJournalId: supplierReturnAuthorizations.postedJournalId,
  entryNo: supplierReturnAuthorizations.entryNo,
  cancelledAt: supplierReturnAuthorizations.cancelledAt,
  cancelledBy: supplierReturnAuthorizations.cancelledBy,
  cancelReason: supplierReturnAuthorizations.cancelReason,
  note: supplierReturnAuthorizations.note,
  noteAr: supplierReturnAuthorizations.noteAr,
  createdBy: supplierReturnAuthorizations.createdBy,
  createdAt: supplierReturnAuthorizations.createdAt,
  updatedAt: supplierReturnAuthorizations.updatedAt,
  version: supplierReturnAuthorizations.version,
} as const;

export async function insertSupplierRma(input: {
  branchId: string;
  supplierId: string;
  purchaseOrderId: string;
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
    .insert(supplierReturnAuthorizations)
    .values({
      id,
      tenantId: sql`erp.current_tenant_id()`,
      createdBy: input.actorId,
      branchId: input.branchId,
      supplierId: input.supplierId,
      purchaseOrderId: input.purchaseOrderId,
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

export async function findSupplierRmaById(id: string): Promise<SupplierRmaRow | undefined> {
  const rows = await tenantTx()
    .select(SRMA_COLUMNS)
    .from(supplierReturnAuthorizations)
    .where(eq(supplierReturnAuthorizations.id, id))
    .limit(1);
  return (rows as SupplierRmaRow[])[0];
}

export async function listSupplierRmas(filter: {
  status?: string;
  supplierId?: string;
  limit: number;
}): Promise<SupplierRmaRow[]> {
  const conditions = [];
  if (filter.status !== undefined && filter.status !== "") {
    conditions.push(eq(supplierReturnAuthorizations.status, filter.status));
  }
  if (filter.supplierId !== undefined && filter.supplierId !== "") {
    conditions.push(eq(supplierReturnAuthorizations.supplierId, filter.supplierId));
  }
  const rows = await tenantTx()
    .select(SRMA_COLUMNS)
    .from(supplierReturnAuthorizations)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(supplierReturnAuthorizations.createdAt))
    .limit(filter.limit);
  return rows as SupplierRmaRow[];
}

export async function updateSupplierRma(
  id: string,
  patch: {
    status?: string;
    srmaNo?: string;
    approvedAt?: string | null;
    approvedBy?: string | null;
    shippedAt?: string | null;
    shippedBy?: string | null;
    creditedAt?: string | null;
    creditedBy?: string | null;
    debitNoteId?: string | null;
    postedJournalId?: string | null;
    entryNo?: string | null;
    cancelledAt?: string | null;
    cancelledBy?: string | null;
    cancelReason?: string | null;
  },
): Promise<void> {
  await tenantTx()
    .update(supplierReturnAuthorizations)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(supplierReturnAuthorizations.id, id));
}

// -- supplier_return_authorization_lines ---------------------------------------------

export interface SupplierRmaLineRow {
  id: string;
  srmaId: string;
  lineNo: number;
  poLineId: string;
  itemId: string | null;
  qty: string;
  unitCost: string;
  netAmount: string;
  note: string | null;
}

const SRMA_LINE_COLUMNS = {
  id: supplierReturnAuthorizationLines.id,
  srmaId: supplierReturnAuthorizationLines.srmaId,
  lineNo: supplierReturnAuthorizationLines.lineNo,
  poLineId: supplierReturnAuthorizationLines.poLineId,
  itemId: supplierReturnAuthorizationLines.itemId,
  qty: supplierReturnAuthorizationLines.qty,
  unitCost: supplierReturnAuthorizationLines.unitCost,
  netAmount: supplierReturnAuthorizationLines.netAmount,
  note: supplierReturnAuthorizationLines.note,
} as const;

export async function insertSupplierRmaLines(
  srmaId: string,
  lines: readonly {
    poLineId: string;
    itemId: string | null;
    qty: string;
    unitCost: string;
    netAmount: string;
    note: string | null;
  }[],
): Promise<void> {
  const tx = tenantTx();
  let lineNo = 0;
  for (const line of lines) {
    lineNo += 1;
    await tx.insert(supplierReturnAuthorizationLines).values({
      id: generateUuidV7(),
      tenantId: sql`erp.current_tenant_id()`,
      srmaId,
      lineNo,
      poLineId: line.poLineId,
      itemId: line.itemId,
      qty: line.qty,
      unitCost: line.unitCost,
      netAmount: line.netAmount,
      note: line.note,
    });
  }
}

export async function deleteSupplierRmaLines(srmaId: string): Promise<void> {
  await tenantTx()
    .delete(supplierReturnAuthorizationLines)
    .where(eq(supplierReturnAuthorizationLines.srmaId, srmaId));
}

/** Replace-on-edit: delete + insert in one ambient UoW (the rfq_lines path). */
export async function replaceSupplierRmaLines(
  srmaId: string,
  lines: readonly Parameters<typeof insertSupplierRmaLines>[1][number][],
): Promise<void> {
  await deleteSupplierRmaLines(srmaId);
  await insertSupplierRmaLines(srmaId, lines);
}

export async function listSupplierRmaLines(srmaId: string): Promise<SupplierRmaLineRow[]> {
  const rows = await tenantTx()
    .select(SRMA_LINE_COLUMNS)
    .from(supplierReturnAuthorizationLines)
    .where(eq(supplierReturnAuthorizationLines.srmaId, srmaId))
    .orderBy(asc(supplierReturnAuthorizationLines.lineNo));
  return rows as SupplierRmaLineRow[];
}

/**
 * The returned-qty fold: lines of every NON-CANCELLED supplier RMA on the
 * PO. Unlike the customer side there is NO credited-qty twin (debit notes
 * reference supplier-invoice lines, not PO lines), so CREDITED rows stay
 * in the fold — a credited return is still returned qty; only a
 * cancellation frees it.
 */
export async function listOpenSupplierRmaLinesByPo(poId: string): Promise<SupplierRmaLineRow[]> {
  const rows = await tenantTx()
    .select(SRMA_LINE_COLUMNS)
    .from(supplierReturnAuthorizationLines)
    .innerJoin(
      supplierReturnAuthorizations,
      eq(supplierReturnAuthorizations.id, supplierReturnAuthorizationLines.srmaId),
    )
    .where(
      and(
        eq(supplierReturnAuthorizations.purchaseOrderId, poId),
        ne(supplierReturnAuthorizations.status, "CANCELLED"),
        inArray(supplierReturnAuthorizations.status, [
          "REQUESTED",
          "APPROVED",
          "SHIPPED",
          "CREDITED",
        ]),
      ),
    )
    .orderBy(asc(supplierReturnAuthorizationLines.lineNo));
  return rows as SupplierRmaLineRow[];
}

// -- the DN reference (0059's debit_note_id requires a real DN row) ---------------------

/**
 * The PO's supplier invoice — the debit-note reference (debit_notes.
 * ref_invoice_id is NOT NULL with a composite FK): POSTED first, then any
 * live invoice, earliest date. Returns undefined when the PO never carried
 * an invoice (the service's typed rejection).
 */
export async function findPoSupplierInvoice(
  poId: string,
): Promise<{ id: string; status: string; invoiceNo: string | null } | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, status, invoice_no AS "invoiceNo"
    FROM supplier_invoices
    WHERE po_id = ${poId} AND status <> 'CANCELLED'
    ORDER BY (status = 'POSTED') DESC, invoice_date, created_at
    LIMIT 1
  `);
  return (rows.rows as unknown as { id: string; status: string; invoiceNo: string | null }[])[0];
}
