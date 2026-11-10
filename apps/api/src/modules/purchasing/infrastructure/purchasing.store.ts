import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * Purchasing store (PHASE-011): the ONLY writer of the purchasing document
 * tables (purchase_requests/orders/lines, goods_receipts/lines,
 * supplier_invoices/lines, debit_notes/lines, landed_costs/allocations,
 * purchase_reallocations/lines). Every statement runs in the caller's
 * ambient tenant UoW so a failure anywhere rolls the whole business
 * operation back — goods receipts compose the PHASE-010 movement core +
 * the posting engine in ONE transaction (INV-018 discipline), supplier
 * invoices post G-08 the same way. stock_moves/stock_layers/item_stock are
 * NEVER written here (MODULE_BOUNDARIES — inventory exclusively owns them).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("purchasing access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- partners / items / settings (read ports over sibling modules) ----------------

export interface SupplierRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  kind: string;
  creditTermId: string | null;
  priceListId: string | null;
  status: string;
}

export async function findSupplierById(id: string): Promise<SupplierRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, code, name, name_ar AS "nameAr", kind, credit_terms_id AS "creditTermId",
           price_list_id AS "priceListId", status
    FROM partners WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as SupplierRow[])[0];
}

export async function readSetting<T>(key: string): Promise<T | undefined> {
  const { readEffectiveSetting } = await import("../../../infra/settings/setting-reader");
  return readEffectiveSetting<T>(key);
}

// -- purchase requests --------------------------------------------------------------

export interface PurchaseRequestRow {
  id: string;
  branchId: string;
  requestNo: string | null;
  neededBy: string | null;
  status: string;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  convertedOrderId: string | null;
  cancelReason: string | null;
}

export interface PurchaseRequestLineRow {
  id: string;
  requestId: string;
  lineNo: number;
  itemId: string;
  qty: string;
  note: string | null;
}

export async function insertPurchaseRequest(input: {
  branchId: string;
  neededBy: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
  lines: readonly { itemId: string; qty: string; note: string | null }[];
}): Promise<PurchaseRequestRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO purchase_requests (id, tenant_id, branch_id, needed_by, note, note_ar, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.branchId}, ${input.neededBy},
            ${input.note}, ${input.noteAr}, ${input.actorId})
  `);
  await insertPurchaseRequestLines(id, input.lines);
  return findPurchaseRequestById(id) as Promise<PurchaseRequestRow>;
}

async function insertPurchaseRequestLines(
  requestId: string,
  lines: readonly { itemId: string; qty: string; note: string | null }[],
): Promise<void> {
  const tx = tenantTx();
  let lineNo = 0;
  for (const line of lines) {
    lineNo += 1;
    await tx.execute(sql`
      INSERT INTO purchase_request_lines (id, tenant_id, request_id, line_no, item_id, qty, note)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${requestId}, ${lineNo},
              ${line.itemId}, ${line.qty}, ${line.note})
    `);
  }
}

export async function findPurchaseRequestById(id: string): Promise<PurchaseRequestRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, branch_id AS "branchId", request_no AS "requestNo", needed_by AS "neededBy",
           status, note, note_ar AS "noteAr", created_by AS "createdBy",
           created_at AS "createdAt", approved_by AS "approvedBy", approved_at AS "approvedAt",
           converted_order_id AS "convertedOrderId", cancel_reason AS "cancelReason"
    FROM purchase_requests WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as PurchaseRequestRow[])[0];
}

export async function listPurchaseRequestLines(requestId: string): Promise<PurchaseRequestLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, request_id AS "requestId", line_no AS "lineNo", item_id AS "itemId", qty, note
    FROM purchase_request_lines WHERE request_id = ${requestId} ORDER BY line_no
  `);
  return rows.rows as unknown as PurchaseRequestLineRow[];
}

export async function listPurchaseRequests(filter: {
  status?: string;
  limit: number;
}): Promise<PurchaseRequestRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, branch_id AS "branchId", request_no AS "requestNo", needed_by AS "neededBy",
           status, note, note_ar AS "noteAr", created_by AS "createdBy",
           created_at AS "createdAt", approved_by AS "approvedBy", approved_at AS "approvedAt",
           converted_order_id AS "convertedOrderId", cancel_reason AS "cancelReason"
    FROM purchase_requests
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
    ORDER BY created_at DESC LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as PurchaseRequestRow[];
}

export async function updatePurchaseRequestStatus(input: {
  id: string;
  status: string;
  actorId: string | null;
  requestNo?: string | null;
  rejectionReason?: string | null;
  convertedOrderId?: string | null;
  cancelReason?: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE purchase_requests SET
      status = ${input.status},
      request_no = COALESCE(${input.requestNo ?? null}, request_no),
      version = version + 1, updated_at = now(),
      submitted_at = CASE WHEN ${input.status} = 'PENDING_APPROVAL' THEN now() ELSE submitted_at END,
      submitted_by = CASE WHEN ${input.status} = 'PENDING_APPROVAL' THEN ${input.actorId} ELSE submitted_by END,
      approved_at = CASE WHEN ${input.status} = 'APPROVED' THEN now() ELSE approved_at END,
      approved_by = CASE WHEN ${input.status} = 'APPROVED' THEN ${input.actorId} ELSE approved_by END,
      rejected_at = CASE WHEN ${input.status} = 'REJECTED' THEN now() ELSE rejected_at END,
      rejected_by = CASE WHEN ${input.status} = 'REJECTED' THEN ${input.actorId} ELSE rejected_by END,
      rejection_reason = CASE WHEN ${input.status} = 'REJECTED' THEN ${input.rejectionReason ?? null} ELSE rejection_reason END,
      converted_order_id = COALESCE(${input.convertedOrderId ?? null}, converted_order_id),
      cancelled_at = CASE WHEN ${input.status} = 'CANCELLED' THEN now() ELSE cancelled_at END,
      cancelled_by = CASE WHEN ${input.status} = 'CANCELLED' THEN ${input.actorId} ELSE cancelled_by END,
      cancel_reason = CASE WHEN ${input.status} = 'CANCELLED' THEN ${input.cancelReason ?? null} ELSE cancel_reason END
    WHERE id = ${input.id}
  `);
}

// -- purchase orders ----------------------------------------------------------------

export interface PurchaseOrderRow {
  id: string;
  branchId: string;
  supplierId: string;
  orderNo: string | null;
  orderDate: string;
  expectedDate: string | null;
  currencyCode: string;
  exchangeRate: string | null;
  revisionOfId: string | null;
  revisionNo: number;
  status: string;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  issuedAt: string | null;
  closedAt: string | null;
  cancelReason: string | null;
}

export interface PurchaseOrderLineRow {
  id: string;
  orderId: string;
  lineNo: number;
  itemId: string;
  qty: string;
  unitPrice: string;
  taxCodeId: string | null;
  netAmount: string;
  taxAmount: string;
  priceSource: string;
  requestLineId: string | null;
  note: string | null;
}

export async function insertPurchaseOrder(input: {
  branchId: string;
  supplierId: string;
  orderDate: string;
  expectedDate: string | null;
  currencyCode: string;
  exchangeRate: string | null;
  revisionOfId: string | null;
  revisionNo: number;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  taxSummary: Record<string, unknown> | null;
  lines: readonly {
    itemId: string;
    qty: string;
    unitPrice: string;
    taxCodeId: string | null;
    netAmount: string;
    taxAmount: string;
    priceSource: string;
    requestLineId: string | null;
    note: string | null;
  }[];
}): Promise<PurchaseOrderRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO purchase_orders (id, tenant_id, branch_id, supplier_id, order_date, expected_date,
                                 currency_code, exchange_rate, revision_of_id, revision_no,
                                 total_net, total_tax, total_gross, tax_summary, note, note_ar, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.branchId}, ${input.supplierId}, ${input.orderDate},
            ${input.expectedDate}, ${input.currencyCode}, ${input.exchangeRate}, ${input.revisionOfId},
            ${input.revisionNo}, ${input.totalNet}, ${input.totalTax}, ${input.totalGross},
            ${JSON.stringify(input.taxSummary)}::jsonb, ${input.note}, ${input.noteAr}, ${input.actorId})
  `);
  let lineNo = 0;
  for (const line of input.lines) {
    lineNo += 1;
    await tx.execute(sql`
      INSERT INTO purchase_order_lines (id, tenant_id, order_id, line_no, item_id, qty, unit_price,
                                        tax_code_id, net_amount, tax_amount, price_source, request_line_id, note)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${id}, ${lineNo}, ${line.itemId}, ${line.qty},
              ${line.unitPrice}, ${line.taxCodeId}, ${line.netAmount}, ${line.taxAmount},
              ${line.priceSource}, ${line.requestLineId}, ${line.note})
    `);
  }
  return findPurchaseOrderById(id) as Promise<PurchaseOrderRow>;
}

export async function findPurchaseOrderById(id: string): Promise<PurchaseOrderRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, branch_id AS "branchId", supplier_id AS "supplierId", order_no AS "orderNo",
           order_date AS "orderDate", expected_date AS "expectedDate", currency_code AS "currencyCode",
           exchange_rate::text AS "exchangeRate", revision_of_id AS "revisionOfId",
           revision_no AS "revisionNo", status,
           total_net::text AS "totalNet", total_tax::text AS "totalTax", total_gross::text AS "totalGross",
           note, note_ar AS "noteAr", created_by AS "createdBy", created_at AS "createdAt",
           issued_at AS "issuedAt", closed_at AS "closedAt", cancel_reason AS "cancelReason"
    FROM purchase_orders WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as PurchaseOrderRow[])[0];
}

export async function listPurchaseOrders(filter: {
  status?: string;
  supplierId?: string;
  limit: number;
}): Promise<PurchaseOrderRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, branch_id AS "branchId", supplier_id AS "supplierId", order_no AS "orderNo",
           order_date AS "orderDate", expected_date AS "expectedDate", currency_code AS "currencyCode",
           exchange_rate::text AS "exchangeRate", revision_of_id AS "revisionOfId",
           revision_no AS "revisionNo", status,
           total_net::text AS "totalNet", total_tax::text AS "totalTax", total_gross::text AS "totalGross",
           note, note_ar AS "noteAr", created_by AS "createdBy", created_at AS "createdAt",
           issued_at AS "issuedAt", closed_at AS "closedAt", cancel_reason AS "cancelReason"
    FROM purchase_orders
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.supplierId ?? null}::uuid IS NULL OR supplier_id = ${filter.supplierId ?? null})
    ORDER BY created_at DESC LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as PurchaseOrderRow[];
}

export async function listPurchaseOrderLines(orderId: string): Promise<PurchaseOrderLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, order_id AS "orderId", line_no AS "lineNo", item_id AS "itemId", qty,
           unit_price::text AS "unitPrice", tax_code_id AS "taxCodeId",
           net_amount::text AS "netAmount", tax_amount::text AS "taxAmount",
           price_source AS "priceSource", request_line_id AS "requestLineId", note
    FROM purchase_order_lines WHERE order_id = ${orderId} ORDER BY line_no
  `);
  return rows.rows as unknown as PurchaseOrderLineRow[];
}

export async function updatePurchaseOrderStatus(input: {
  id: string;
  status: string;
  actorId: string | null;
  orderNo?: string | null;
  cancelReason?: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE purchase_orders SET
      status = ${input.status},
      order_no = COALESCE(${input.orderNo ?? null}, order_no),
      version = version + 1, updated_at = now(),
      submitted_at = CASE WHEN ${input.status} = 'PENDING_APPROVAL' THEN now() ELSE submitted_at END,
      submitted_by = CASE WHEN ${input.status} = 'PENDING_APPROVAL' THEN ${input.actorId} ELSE submitted_by END,
      approved_at = CASE WHEN ${input.status} = 'APPROVED' THEN now() ELSE approved_at END,
      approved_by = CASE WHEN ${input.status} = 'APPROVED' THEN ${input.actorId} ELSE approved_by END,
      issued_at = CASE WHEN ${input.status} = 'ISSUED' THEN now() ELSE issued_at END,
      issued_by = CASE WHEN ${input.status} = 'ISSUED' THEN ${input.actorId} ELSE issued_by END,
      closed_at = CASE WHEN ${input.status} = 'CLOSED' THEN now() ELSE closed_at END,
      closed_by = CASE WHEN ${input.status} = 'CLOSED' THEN ${input.actorId} ELSE closed_by END,
      cancelled_at = CASE WHEN ${input.status} = 'CANCELLED' THEN now() ELSE cancelled_at END,
      cancelled_by = CASE WHEN ${input.status} = 'CANCELLED' THEN ${input.actorId} ELSE cancelled_by END,
      cancel_reason = CASE WHEN ${input.status} = 'CANCELLED' THEN ${input.cancelReason ?? null} ELSE cancel_reason END
    WHERE id = ${input.id}
  `);
}

/** Received qty per PO line from POSTED GRN lines (the match + over-receipt guard base). */
export async function poLineReceivedQty(): Promise<Map<string, string>> {
  const rows = await tenantTx().execute(sql`
    SELECT l.po_line_id AS "poLineId", SUM(l.qty)::numeric(19,6)::text AS qty
    FROM goods_receipt_lines l
    JOIN goods_receipts g ON g.id = l.receipt_id AND g.tenant_id = l.tenant_id
    WHERE l.po_line_id IS NOT NULL AND g.status = 'POSTED'
    GROUP BY l.po_line_id
  `);
  return new Map((rows.rows as unknown as { poLineId: string; qty: string }[]).map((r) => [r.poLineId, r.qty]));
}

// -- goods receipts -------------------------------------------------------------------

export interface GoodsReceiptRow {
  id: string;
  branchId: string;
  supplierId: string;
  poId: string | null;
  warehouseId: string;
  receiptNo: string | null;
  receiptDate: string;
  status: string;
  poLessReason: string | null;
  totalValue: string;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  postingDate: string | null;
  postedJournalId: string | null;
  cancelReason: string | null;
}

export interface GoodsReceiptLineRow {
  id: string;
  receiptId: string;
  lineNo: number;
  poLineId: string | null;
  itemId: string;
  qty: string;
  unitCost: string;
  valueAmount: string;
  accountId: string | null;
  batchNo: string | null;
  batchExpiry: string | null;
  serialIds: string[] | null;
  note: string | null;
}

export async function insertGoodsReceipt(input: {
  branchId: string;
  supplierId: string;
  poId: string | null;
  warehouseId: string;
  receiptDate: string;
  poLessReason: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
  totalValue: string;
  lines: readonly {
    poLineId: string | null;
    itemId: string;
    qty: string;
    unitCost: string;
    valueAmount: string;
    accountId: string | null;
    batchNo: string | null;
    batchExpiry: string | null;
    serialIds: string[] | null;
    note: string | null;
  }[];
}): Promise<GoodsReceiptRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO goods_receipts (id, tenant_id, branch_id, supplier_id, po_id, warehouse_id,
                                receipt_date, po_less_reason, total_value, note, note_ar, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.branchId}, ${input.supplierId}, ${input.poId},
            ${input.warehouseId}, ${input.receiptDate}, ${input.poLessReason}, ${input.totalValue},
            ${input.note}, ${input.noteAr}, ${input.actorId})
  `);
  let lineNo = 0;
  for (const line of input.lines) {
    lineNo += 1;
    await tx.execute(sql`
      INSERT INTO goods_receipt_lines (id, tenant_id, receipt_id, line_no, po_line_id, item_id, qty,
                                       unit_cost, value_amount, account_id, batch_no, batch_expiry, serial_ids, note)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${id}, ${lineNo}, ${line.poLineId},
              ${line.itemId}, ${line.qty}, ${line.unitCost}, ${line.valueAmount}, ${line.accountId},
              ${line.batchNo}, ${line.batchExpiry},
              ${line.serialIds === null ? null : JSON.stringify(line.serialIds)}::jsonb, ${line.note})
    `);
  }
  return findGoodsReceiptById(id) as Promise<GoodsReceiptRow>;
}

export async function findGoodsReceiptById(id: string): Promise<GoodsReceiptRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, branch_id AS "branchId", supplier_id AS "supplierId", po_id AS "poId",
           warehouse_id AS "warehouseId", receipt_no AS "receiptNo", receipt_date AS "receiptDate",
           status, po_less_reason AS "poLessReason", total_value::text AS "totalValue",
           note, note_ar AS "noteAr", created_by AS "createdBy", created_at AS "createdAt",
           posting_date AS "postingDate", posted_journal_id AS "postedJournalId",
           cancel_reason AS "cancelReason"
    FROM goods_receipts WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as GoodsReceiptRow[])[0];
}

export async function listGoodsReceipts(filter: {
  status?: string;
  supplierId?: string;
  poId?: string;
  limit: number;
}): Promise<GoodsReceiptRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, branch_id AS "branchId", supplier_id AS "supplierId", po_id AS "poId",
           warehouse_id AS "warehouseId", receipt_no AS "receiptNo", receipt_date AS "receiptDate",
           status, po_less_reason AS "poLessReason", total_value::text AS "totalValue",
           note, note_ar AS "noteAr", created_by AS "createdBy", created_at AS "createdAt",
           posting_date AS "postingDate", posted_journal_id AS "postedJournalId",
           cancel_reason AS "cancelReason"
    FROM goods_receipts
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.supplierId ?? null}::uuid IS NULL OR supplier_id = ${filter.supplierId ?? null})
      AND (${filter.poId ?? null}::uuid IS NULL OR po_id = ${filter.poId ?? null})
    ORDER BY created_at DESC LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as GoodsReceiptRow[];
}

export async function listGoodsReceiptLines(receiptId: string): Promise<GoodsReceiptLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, receipt_id AS "receiptId", line_no AS "lineNo", po_line_id AS "poLineId",
           item_id AS "itemId", qty, unit_cost::text AS "unitCost", value_amount::text AS "valueAmount",
           account_id AS "accountId", batch_no AS "batchNo", batch_expiry AS "batchExpiry",
           serial_ids AS "serialIds", note
    FROM goods_receipt_lines WHERE receipt_id = ${receiptId} ORDER BY line_no
  `);
  return rows.rows as unknown as GoodsReceiptLineRow[];
}

export async function updateGoodsReceiptStatus(input: {
  id: string;
  status: string;
  actorId: string | null;
  receiptNo?: string | null;
  postingDate?: string | null;
  postedJournalId?: string | null;
  cancelReason?: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE goods_receipts SET
      status = ${input.status},
      receipt_no = COALESCE(${input.receiptNo ?? null}, receipt_no),
      posting_date = COALESCE(${input.postingDate ?? null}, posting_date),
      posted_journal_id = COALESCE(${input.postedJournalId ?? null}, posted_journal_id),
      posted_at = CASE WHEN ${input.status} = 'POSTED' THEN now() ELSE posted_at END,
      posted_by = CASE WHEN ${input.status} = 'POSTED' THEN ${input.actorId} ELSE posted_by END,
      cancelled_at = CASE WHEN ${input.status} = 'CANCELLED' THEN now() ELSE cancelled_at END,
      cancelled_by = CASE WHEN ${input.status} = 'CANCELLED' THEN ${input.actorId} ELSE cancelled_by END,
      cancel_reason = CASE WHEN ${input.status} = 'CANCELLED' THEN ${input.cancelReason ?? null} ELSE cancel_reason END,
      version = version + 1, updated_at = now()
    WHERE id = ${input.id}
  `);
}

// -- supplier invoices ------------------------------------------------------------------

export interface SupplierInvoiceRow {
  id: string;
  branchId: string;
  supplierId: string;
  invoiceNo: string;
  internalNo: string | null;
  invoiceDate: string;
  dueDate: string;
  currencyCode: string;
  exchangeRate: string | null;
  poId: string | null;
  status: string;
  matchStatus: string;
  matchResult: Record<string, unknown> | null;
  duplicateWarning: Record<string, unknown> | null;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  taxSummary: Record<string, unknown> | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  postingDate: string | null;
  postedJournalId: string | null;
  cancelReason: string | null;
}

export interface SupplierInvoiceLineRow {
  id: string;
  invoiceId: string;
  lineNo: number;
  grnLineId: string | null;
  poLineId: string | null;
  itemId: string | null;
  accountId: string | null;
  description: string | null;
  descriptionAr: string | null;
  qty: string;
  unitPrice: string;
  taxCodeId: string | null;
  vatRecoverable: boolean;
  netAmount: string;
  taxAmount: string;
  taxSnapshot: Record<string, unknown> | null;
  grniClearedValue: string;
  stockRevalueValue: string;
  note: string | null;
}

export async function insertSupplierInvoice(input: {
  branchId: string;
  supplierId: string;
  invoiceNo: string;
  invoiceDate: string;
  dueDate: string;
  currencyCode: string;
  exchangeRate: string | null;
  poId: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  taxSummary: Record<string, unknown> | null;
  duplicateWarning: Record<string, unknown> | null;
  lines: readonly {
    grnLineId: string | null;
    poLineId: string | null;
    itemId: string | null;
    accountId: string | null;
    description: string | null;
    descriptionAr: string | null;
    qty: string;
    unitPrice: string;
    taxCodeId: string | null;
    vatRecoverable: boolean;
    netAmount: string;
    taxAmount: string;
    taxSnapshot: Record<string, unknown> | null;
    grniClearedValue: string;
    stockRevalueValue: string;
    note: string | null;
  }[];
}): Promise<SupplierInvoiceRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO supplier_invoices (id, tenant_id, branch_id, supplier_id, invoice_no, invoice_date,
                                   due_date, currency_code, exchange_rate, po_id, total_net, total_tax,
                                   total_gross, tax_summary, duplicate_warning, note, note_ar, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.branchId}, ${input.supplierId}, ${input.invoiceNo},
            ${input.invoiceDate}, ${input.dueDate}, ${input.currencyCode}, ${input.exchangeRate},
            ${input.poId}, ${input.totalNet}, ${input.totalTax}, ${input.totalGross},
            ${JSON.stringify(input.taxSummary)}::jsonb, ${JSON.stringify(input.duplicateWarning)}::jsonb,
            ${input.note}, ${input.noteAr}, ${input.actorId})
  `);
  let lineNo = 0;
  for (const line of input.lines) {
    lineNo += 1;
    await tx.execute(sql`
      INSERT INTO supplier_invoice_lines (id, tenant_id, invoice_id, line_no, grn_line_id, po_line_id,
                                          item_id, account_id, description, description_ar, qty, unit_price,
                                          tax_code_id, vat_recoverable, net_amount, tax_amount, tax_snapshot,
                                          grni_cleared_value, stock_revalue_value, note)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${id}, ${lineNo}, ${line.grnLineId},
              ${line.poLineId}, ${line.itemId}, ${line.accountId}, ${line.description}, ${line.descriptionAr},
              ${line.qty}, ${line.unitPrice}, ${line.taxCodeId}, ${line.vatRecoverable}, ${line.netAmount},
              ${line.taxAmount}, ${JSON.stringify(line.taxSnapshot)}::jsonb, ${line.grniClearedValue},
              ${line.stockRevalueValue}, ${line.note})
    `);
  }
  return findSupplierInvoiceById(id) as Promise<SupplierInvoiceRow>;
}

export async function findSupplierInvoiceById(id: string): Promise<SupplierInvoiceRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, branch_id AS "branchId", supplier_id AS "supplierId", invoice_no AS "invoiceNo",
           internal_no AS "internalNo", invoice_date AS "invoiceDate", due_date AS "dueDate",
           currency_code AS "currencyCode", exchange_rate::text AS "exchangeRate", po_id AS "poId",
           status, match_status AS "matchStatus", match_result AS "matchResult",
           duplicate_warning AS "duplicateWarning",
           total_net::text AS "totalNet", total_tax::text AS "totalTax", total_gross::text AS "totalGross",
           tax_summary AS "taxSummary", note, note_ar AS "noteAr", created_by AS "createdBy",
           created_at AS "createdAt", posting_date AS "postingDate",
           posted_journal_id AS "postedJournalId", cancel_reason AS "cancelReason"
    FROM supplier_invoices WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as SupplierInvoiceRow[])[0];
}

export async function listSupplierInvoices(filter: {
  status?: string;
  supplierId?: string;
  limit: number;
}): Promise<SupplierInvoiceRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, branch_id AS "branchId", supplier_id AS "supplierId", invoice_no AS "invoiceNo",
           internal_no AS "internalNo", invoice_date AS "invoiceDate", due_date AS "dueDate",
           currency_code AS "currencyCode", exchange_rate::text AS "exchangeRate", po_id AS "poId",
           status, match_status AS "matchStatus", match_result AS "matchResult",
           duplicate_warning AS "duplicateWarning",
           total_net::text AS "totalNet", total_tax::text AS "totalTax", total_gross::text AS "totalGross",
           tax_summary AS "taxSummary", note, note_ar AS "noteAr", created_by AS "createdBy",
           created_at AS "createdAt", posting_date AS "postingDate",
           posted_journal_id AS "postedJournalId", cancel_reason AS "cancelReason"
    FROM supplier_invoices
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.supplierId ?? null}::uuid IS NULL OR supplier_id = ${filter.supplierId ?? null})
    ORDER BY created_at DESC LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as SupplierInvoiceRow[];
}

export async function listSupplierInvoiceLines(invoiceId: string): Promise<SupplierInvoiceLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, invoice_id AS "invoiceId", line_no AS "lineNo", grn_line_id AS "grnLineId",
           po_line_id AS "poLineId", item_id AS "itemId", account_id AS "accountId",
           description, description_ar AS "descriptionAr", qty, unit_price::text AS "unitPrice",
           tax_code_id AS "taxCodeId", vat_recoverable AS "vatRecoverable",
           net_amount::text AS "netAmount", tax_amount::text AS "taxAmount",
           tax_snapshot AS "taxSnapshot", grni_cleared_value::text AS "grniClearedValue",
           stock_revalue_value::text AS "stockRevalueValue", note
    FROM supplier_invoice_lines WHERE invoice_id = ${invoiceId} ORDER BY line_no
  `);
  return rows.rows as unknown as SupplierInvoiceLineRow[];
}

export async function updateSupplierInvoiceStatus(input: {
  id: string;
  status?: string;
  actorId: string | null;
  matchStatus?: string | null;
  matchResult?: Record<string, unknown> | null;
  internalNo?: string | null;
  postingDate?: string | null;
  postedJournalId?: string | null;
  cancelReason?: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE supplier_invoices SET
      status = COALESCE(${input.status ?? null}, status),
      match_status = COALESCE(${input.matchStatus ?? null}, match_status),
      match_result = COALESCE(${input.matchResult === undefined ? null : JSON.stringify(input.matchResult)}::jsonb, match_result),
      internal_no = COALESCE(${input.internalNo ?? null}, internal_no),
      posting_date = COALESCE(${input.postingDate ?? null}, posting_date),
      posted_journal_id = COALESCE(${input.postedJournalId ?? null}, posted_journal_id),
      posted_at = CASE WHEN ${input.status ?? ""} = 'POSTED' THEN now() ELSE posted_at END,
      posted_by = CASE WHEN ${input.status ?? ""} = 'POSTED' THEN ${input.actorId} ELSE posted_by END,
      submitted_at = CASE WHEN ${input.status ?? ""} = 'PENDING_APPROVAL' THEN now() ELSE submitted_at END,
      submitted_by = CASE WHEN ${input.status ?? ""} = 'PENDING_APPROVAL' THEN ${input.actorId} ELSE submitted_by END,
      approved_at = CASE WHEN ${input.status ?? ""} = 'APPROVED' THEN now() ELSE approved_at END,
      approved_by = CASE WHEN ${input.status ?? ""} = 'APPROVED' THEN ${input.actorId} ELSE approved_by END,
      cancelled_at = CASE WHEN ${input.status ?? ""} = 'CANCELLED' THEN now() ELSE cancelled_at END,
      cancelled_by = CASE WHEN ${input.status ?? ""} = 'CANCELLED' THEN ${input.actorId} ELSE cancelled_by END,
      cancel_reason = CASE WHEN ${input.status ?? ""} = 'CANCELLED' THEN ${input.cancelReason ?? null} ELSE cancel_reason END,
      version = version + 1, updated_at = now()
    WHERE id = ${input.id}
  `);
}

/** BR-011 duplicate scan: same (supplier, number, amount) anywhere, or same (supplier, number). */
export async function findInvoiceDuplicate(input: {
  supplierId: string;
  invoiceNo: string;
  totalGross: string;
}): Promise<
  | { kind: "triple"; existingId: string; existingAmount: string; existingDate: string }
  | { kind: "number"; existingId: string; existingAmount: string; existingDate: string }
  | undefined
> {
  const rows = await tenantTx().execute(sql`
    SELECT id, total_gross::text AS amount, invoice_date AS "documentDate",
           (total_gross = ${input.totalGross}::numeric) AS same_amount
    FROM supplier_invoices
    WHERE supplier_id = ${input.supplierId} AND invoice_no = ${input.invoiceNo}
      AND status <> 'CANCELLED'
    ORDER BY created_at LIMIT 1
  `);
  const row = (rows.rows as unknown as { id: string; amount: string; documentDate: string; same_amount: boolean }[])[0];
  if (row === undefined) return undefined;
  return row.same_amount
    ? { kind: "triple", existingId: row.id, existingAmount: row.amount, existingDate: row.documentDate }
    : { kind: "number", existingId: row.id, existingAmount: row.amount, existingDate: row.documentDate };
}

/** Posted invoice qty per GRN line (the GRNI remaining + over-invoice guard base). */
export async function grnLineInvoicedQty(): Promise<Map<string, string>> {
  const rows = await tenantTx().execute(sql`
    SELECT l.grn_line_id AS "grnLineId", SUM(l.qty)::numeric(19,6)::text AS qty
    FROM supplier_invoice_lines l
    JOIN supplier_invoices i ON i.id = l.invoice_id AND i.tenant_id = l.tenant_id
    WHERE l.grn_line_id IS NOT NULL AND i.status = 'POSTED'
    GROUP BY l.grn_line_id
  `);
  return new Map((rows.rows as unknown as { grnLineId: string; qty: string }[]).map((r) => [r.grnLineId, r.qty]));
}

/** Direct GRN-line lookup with its receipt + PO context (the match triple base). */
export async function findGrnLinesByIds(
  ids: readonly string[],
): Promise<
  { id: string; qty: string; unitCost: string; poLineId: string | null; receiptStatus: string; receiptSupplier: string }[]
> {
  if (ids.length === 0) return [];
  const rows = await tenantTx().execute(sql`
    SELECT l.id, l.qty::text AS qty, l.unit_cost::text AS "unitCost", l.po_line_id AS "poLineId",
           g.status AS "receiptStatus", g.supplier_id AS "receiptSupplier"
    FROM goods_receipt_lines l
    JOIN goods_receipts g ON g.id = l.receipt_id AND g.tenant_id = l.tenant_id
    WHERE l.id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
  `);
  return rows.rows as unknown as {
    id: string;
    qty: string;
    unitCost: string;
    poLineId: string | null;
    receiptStatus: string;
    receiptSupplier: string;
  }[];
}

/** Direct PO-line lookup (the match triple base). */
export async function findPoLinesByIds(
  ids: readonly string[],
): Promise<{ id: string; qty: string; unitPrice: string }[]> {
  if (ids.length === 0) return [];
  const rows = await tenantTx().execute(sql`
    SELECT id, qty::text AS qty, unit_price::text AS "unitPrice"
    FROM purchase_order_lines
    WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
  `);
  return rows.rows as unknown as { id: string; qty: string; unitPrice: string }[];
}

// -- debit notes -------------------------------------------------------------------------

export interface DebitNoteRow {
  id: string;
  branchId: string;
  supplierId: string;
  refInvoiceId: string;
  noteNo: string | null;
  noteDate: string;
  currencyCode: string;
  exchangeRate: string | null;
  status: string;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  taxSummary: Record<string, unknown> | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  postingDate: string | null;
  postedJournalId: string | null;
  cancelReason: string | null;
}

export interface DebitNoteLineRow {
  id: string;
  noteId: string;
  lineNo: number;
  invoiceLineId: string | null;
  itemId: string | null;
  accountId: string | null;
  description: string | null;
  qty: string;
  unitPrice: string;
  taxCodeId: string | null;
  vatRecoverable: boolean;
  netAmount: string;
  taxAmount: string;
  taxSnapshot: Record<string, unknown> | null;
  note: string | null;
}

export async function insertDebitNote(input: {
  branchId: string;
  supplierId: string;
  refInvoiceId: string;
  noteDate: string;
  currencyCode: string;
  exchangeRate: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  taxSummary: Record<string, unknown> | null;
  lines: readonly {
    invoiceLineId: string | null;
    itemId: string | null;
    accountId: string | null;
    description: string | null;
    qty: string;
    unitPrice: string;
    taxCodeId: string | null;
    vatRecoverable: boolean;
    netAmount: string;
    taxAmount: string;
    taxSnapshot: Record<string, unknown> | null;
    note: string | null;
  }[];
}): Promise<DebitNoteRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO debit_notes (id, tenant_id, branch_id, supplier_id, ref_invoice_id, note_date,
                             currency_code, exchange_rate, total_net, total_tax, total_gross,
                             tax_summary, note, note_ar, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.branchId}, ${input.supplierId}, ${input.refInvoiceId},
            ${input.noteDate}, ${input.currencyCode}, ${input.exchangeRate}, ${input.totalNet},
            ${input.totalTax}, ${input.totalGross}, ${JSON.stringify(input.taxSummary)}::jsonb,
            ${input.note}, ${input.noteAr}, ${input.actorId})
  `);
  let lineNo = 0;
  for (const line of input.lines) {
    lineNo += 1;
    await tx.execute(sql`
      INSERT INTO debit_note_lines (id, tenant_id, note_id, line_no, invoice_line_id, item_id, account_id,
                                    description, qty, unit_price, tax_code_id, vat_recoverable,
                                    net_amount, tax_amount, tax_snapshot, note)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${id}, ${lineNo}, ${line.invoiceLineId},
              ${line.itemId}, ${line.accountId}, ${line.description}, ${line.qty}, ${line.unitPrice},
              ${line.taxCodeId}, ${line.vatRecoverable}, ${line.netAmount}, ${line.taxAmount},
              ${JSON.stringify(line.taxSnapshot)}::jsonb, ${line.note})
    `);
  }
  return findDebitNoteById(id) as Promise<DebitNoteRow>;
}

export async function findDebitNoteById(id: string): Promise<DebitNoteRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, branch_id AS "branchId", supplier_id AS "supplierId", ref_invoice_id AS "refInvoiceId",
           note_no AS "noteNo", note_date AS "noteDate", currency_code AS "currencyCode",
           exchange_rate::text AS "exchangeRate", status,
           total_net::text AS "totalNet", total_tax::text AS "totalTax", total_gross::text AS "totalGross",
           tax_summary AS "taxSummary", note, note_ar AS "noteAr", created_by AS "createdBy",
           created_at AS "createdAt", posting_date AS "postingDate",
           posted_journal_id AS "postedJournalId", cancel_reason AS "cancelReason"
    FROM debit_notes WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as DebitNoteRow[])[0];
}

export async function listDebitNotes(filter: {
  status?: string;
  supplierId?: string;
  limit: number;
}): Promise<DebitNoteRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, branch_id AS "branchId", supplier_id AS "supplierId", ref_invoice_id AS "refInvoiceId",
           note_no AS "noteNo", note_date AS "noteDate", currency_code AS "currencyCode",
           exchange_rate::text AS "exchangeRate", status,
           total_net::text AS "totalNet", total_tax::text AS "totalTax", total_gross::text AS "totalGross",
           tax_summary AS "taxSummary", note, note_ar AS "noteAr", created_by AS "createdBy",
           created_at AS "createdAt", posting_date AS "postingDate",
           posted_journal_id AS "postedJournalId", cancel_reason AS "cancelReason"
    FROM debit_notes
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.supplierId ?? null}::uuid IS NULL OR supplier_id = ${filter.supplierId ?? null})
    ORDER BY created_at DESC LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as DebitNoteRow[];
}

export async function listDebitNoteLines(noteId: string): Promise<DebitNoteLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, note_id AS "noteId", line_no AS "lineNo", invoice_line_id AS "invoiceLineId",
           item_id AS "itemId", account_id AS "accountId", description, qty,
           unit_price::text AS "unitPrice", tax_code_id AS "taxCodeId",
           vat_recoverable AS "vatRecoverable", net_amount::text AS "netAmount",
           tax_amount::text AS "taxAmount", tax_snapshot AS "taxSnapshot", note
    FROM debit_note_lines WHERE note_id = ${noteId} ORDER BY line_no
  `);
  return rows.rows as unknown as DebitNoteLineRow[];
}

export async function updateDebitNoteStatus(input: {
  id: string;
  status?: string;
  actorId: string | null;
  noteNo?: string | null;
  postingDate?: string | null;
  postedJournalId?: string | null;
  cancelReason?: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE debit_notes SET
      status = COALESCE(${input.status ?? null}, status),
      note_no = COALESCE(${input.noteNo ?? null}, note_no),
      posting_date = COALESCE(${input.postingDate ?? null}, posting_date),
      posted_journal_id = COALESCE(${input.postedJournalId ?? null}, posted_journal_id),
      posted_at = CASE WHEN ${input.status ?? ""} = 'POSTED' THEN now() ELSE posted_at END,
      posted_by = CASE WHEN ${input.status ?? ""} = 'POSTED' THEN ${input.actorId} ELSE posted_by END,
      submitted_at = CASE WHEN ${input.status ?? ""} = 'PENDING_APPROVAL' THEN now() ELSE submitted_at END,
      submitted_by = CASE WHEN ${input.status ?? ""} = 'PENDING_APPROVAL' THEN ${input.actorId} ELSE submitted_by END,
      approved_at = CASE WHEN ${input.status ?? ""} = 'APPROVED' THEN now() ELSE approved_at END,
      approved_by = CASE WHEN ${input.status ?? ""} = 'APPROVED' THEN ${input.actorId} ELSE approved_by END,
      cancelled_at = CASE WHEN ${input.status ?? ""} = 'CANCELLED' THEN now() ELSE cancelled_at END,
      cancelled_by = CASE WHEN ${input.status ?? ""} = 'CANCELLED' THEN ${input.actorId} ELSE cancelled_by END,
      cancel_reason = CASE WHEN ${input.status ?? ""} = 'CANCELLED' THEN ${input.cancelReason ?? null} ELSE cancel_reason END,
      version = version + 1, updated_at = now()
    WHERE id = ${input.id}
  `);
}

// -- landed costs -------------------------------------------------------------------------

export interface LandedCostRow {
  id: string;
  grnId: string;
  costNo: string | null;
  costType: string;
  vendorId: string | null;
  amount: string;
  allocationMethod: string;
  chargeAccountId: string;
  status: string;
  allocatedToStock: string;
  allocatedToCogs: string;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  postingDate: string | null;
  postedJournalId: string | null;
}

export async function insertLandedCost(input: {
  grnId: string;
  costType: string;
  vendorId: string | null;
  amount: string;
  allocationMethod: string;
  chargeAccountId: string;
  note: string | null;
  actorId: string | null;
}): Promise<LandedCostRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO landed_costs (id, tenant_id, grn_id, cost_type, vendor_id, amount, allocation_method,
                              charge_account_id, note, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.grnId}, ${input.costType}, ${input.vendorId},
            ${input.amount}, ${input.allocationMethod}, ${input.chargeAccountId}, ${input.note},
            ${input.actorId})
  `);
  return findLandedCostById(id) as Promise<LandedCostRow>;
}

export async function findLandedCostById(id: string): Promise<LandedCostRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, grn_id AS "grnId", cost_no AS "costNo", cost_type AS "costType", vendor_id AS "vendorId",
           amount::text AS amount, allocation_method AS "allocationMethod",
           charge_account_id AS "chargeAccountId", status,
           allocated_to_stock::text AS "allocatedToStock", allocated_to_cogs::text AS "allocatedToCogs",
           note, created_by AS "createdBy", created_at AS "createdAt",
           posting_date AS "postingDate", posted_journal_id AS "postedJournalId"
    FROM landed_costs WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as LandedCostRow[])[0];
}

export async function listLandedCosts(filter: { grnId?: string; limit: number }): Promise<LandedCostRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, grn_id AS "grnId", cost_no AS "costNo", cost_type AS "costType", vendor_id AS "vendorId",
           amount::text AS amount, allocation_method AS "allocationMethod",
           charge_account_id AS "chargeAccountId", status,
           allocated_to_stock::text AS "allocatedToStock", allocated_to_cogs::text AS "allocatedToCogs",
           note, created_by AS "createdBy", created_at AS "createdAt",
           posting_date AS "postingDate", posted_journal_id AS "postedJournalId"
    FROM landed_costs
    WHERE (${filter.grnId ?? null}::uuid IS NULL OR grn_id = ${filter.grnId ?? null})
    ORDER BY created_at DESC LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as LandedCostRow[];
}

export async function updateLandedCostStatus(input: {
  id: string;
  status: string;
  actorId: string | null;
  costNo?: string | null;
  postingDate?: string | null;
  postedJournalId?: string | null;
  allocatedToStock?: string | null;
  allocatedToCogs?: string | null;
  cancelReason?: string | null;
  allocations?: readonly {
    grnLineId: string;
    itemId: string;
    warehouseId: string;
    qtyAtAllocation: string;
    remainingQty: string;
    allocatedAmount: string;
    cogsAdjustmentAmount: string;
  }[];
}): Promise<void> {
  const tx = tenantTx();
  await tx.execute(sql`
    UPDATE landed_costs SET
      status = ${input.status},
      cost_no = COALESCE(${input.costNo ?? null}, cost_no),
      posting_date = COALESCE(${input.postingDate ?? null}, posting_date),
      posted_journal_id = COALESCE(${input.postedJournalId ?? null}, posted_journal_id),
      allocated_to_stock = COALESCE(${input.allocatedToStock ?? null}, allocated_to_stock),
      allocated_to_cogs = COALESCE(${input.allocatedToCogs ?? null}, allocated_to_cogs),
      posted_at = CASE WHEN ${input.status} = 'POSTED' THEN now() ELSE posted_at END,
      posted_by = CASE WHEN ${input.status} = 'POSTED' THEN ${input.actorId} ELSE posted_by END,
      cancelled_at = CASE WHEN ${input.status} = 'CANCELLED' THEN now() ELSE cancelled_at END,
      cancelled_by = CASE WHEN ${input.status} = 'CANCELLED' THEN ${input.actorId} ELSE cancelled_by END,
      cancel_reason = CASE WHEN ${input.status} = 'CANCELLED' THEN ${input.cancelReason ?? null} ELSE cancel_reason END,
      version = version + 1, updated_at = now()
    WHERE id = ${input.id}
  `);
  if (input.allocations !== undefined) {
    for (const allocation of input.allocations) {
      await tx.execute(sql`
        INSERT INTO landed_cost_allocations (id, tenant_id, landed_cost_id, grn_line_id, item_id,
                                             warehouse_id, qty_at_allocation, remaining_qty,
                                             allocated_amount, cogs_adjustment_amount, revalue_applied_at)
        VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.id}, ${allocation.grnLineId},
                ${allocation.itemId}, ${allocation.warehouseId}, ${allocation.qtyAtAllocation},
                ${allocation.remainingQty}, ${allocation.allocatedAmount},
                ${allocation.cogsAdjustmentAmount}, now())
      `);
    }
  }
}

export async function listLandedCostAllocations(landedCostId: string): Promise<
  {
    id: string;
    grnLineId: string;
    itemId: string;
    warehouseId: string;
    qtyAtAllocation: string;
    remainingQty: string;
    allocatedAmount: string;
    cogsAdjustmentAmount: string;
  }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT id, grn_line_id AS "grnLineId", item_id AS "itemId", warehouse_id AS "warehouseId",
           qty_at_allocation::text AS "qtyAtAllocation", remaining_qty::text AS "remainingQty",
           allocated_amount::text AS "allocatedAmount",
           cogs_adjustment_amount::text AS "cogsAdjustmentAmount"
    FROM landed_cost_allocations WHERE landed_cost_id = ${landedCostId} ORDER BY grn_line_id
  `);
  return rows.rows as unknown as {
    id: string;
    grnLineId: string;
    itemId: string;
    warehouseId: string;
    qtyAtAllocation: string;
    remainingQty: string;
    allocatedAmount: string;
    cogsAdjustmentAmount: string;
  }[];
}

// -- purchase re-allocations ---------------------------------------------------------------

export interface PurchaseReallocationRow {
  id: string;
  docNo: string;
  paymentId: string;
  supplierId: string;
  reason: string;
  status: string;
  totalAmount: string;
  createdAt: string;
  createdBy: string | null;
}

export async function insertPurchaseReallocation(input: {
  paymentId: string;
  supplierId: string;
  reason: string;
  actorId: string | null;
  totalAmount: string;
  docNo: string;
  lines: readonly { fromOpenItemId: string | null; toOpenItemId: string | null; amount: string }[];
}): Promise<PurchaseReallocationRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO purchase_reallocations (id, tenant_id, doc_no, payment_id, supplier_id, reason,
                                        status, total_amount, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.docNo}, ${input.paymentId}, ${input.supplierId},
            ${input.reason}, 'POSTED', ${input.totalAmount}, ${input.actorId})
  `);
  let lineNo = 0;
  for (const line of input.lines) {
    lineNo += 1;
    await tx.execute(sql`
      INSERT INTO purchase_reallocation_lines (id, tenant_id, reallocation_id, line_no,
                                               from_open_item_id, to_open_item_id, amount)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${id}, ${lineNo},
              ${line.fromOpenItemId}, ${line.toOpenItemId}, ${line.amount})
    `);
  }
  return {
    id,
    docNo: input.docNo,
    paymentId: input.paymentId,
    supplierId: input.supplierId,
    reason: input.reason,
    status: "POSTED",
    totalAmount: input.totalAmount,
    createdAt: new Date().toISOString(),
    createdBy: input.actorId,
  };
}

export async function listPurchaseReallocations(filter: {
  paymentId?: string;
  limit: number;
}): Promise<PurchaseReallocationRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, doc_no AS "docNo", payment_id AS "paymentId", supplier_id AS "supplierId",
           reason, status, total_amount::text AS "totalAmount", created_at AS "createdAt",
           created_by AS "createdBy"
    FROM purchase_reallocations
    WHERE (${filter.paymentId ?? null}::uuid IS NULL OR payment_id = ${filter.paymentId ?? null})
    ORDER BY created_at DESC LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as PurchaseReallocationRow[];
}

// -- GRNI register + AP queries (deterministic as-of recomputations) -------------------------

/**
 * The GRNI register (§2.9; RC-09): per GRN line, received value − value
 * cleared by POSTED supplier-invoice lines. Deterministic recomputation
 * from immutable rows at the as-of date (BR-028 discipline).
 */
export async function grniRegister(asOf: string): Promise<
  {
    grnId: string;
    receiptNo: string | null;
    receiptDate: string;
    supplierId: string;
    grnLineId: string;
    itemId: string;
    receivedQty: string;
    receivedValue: string;
    invoicedQty: string;
    invoicedValue: string;
  }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT g.id AS "grnId", g.receipt_no AS "receiptNo", g.receipt_date AS "receiptDate",
           g.supplier_id AS "supplierId", l.id AS "grnLineId", l.item_id AS "itemId",
           l.qty::text AS "receivedQty", l.value_amount::text AS "receivedValue",
           COALESCE(inv.qty, '0')::numeric(19,6)::text AS "invoicedQty",
           COALESCE(inv.value, '0')::numeric(19,4)::text AS "invoicedValue"
    FROM goods_receipt_lines l
    JOIN goods_receipts g ON g.id = l.receipt_id AND g.tenant_id = l.tenant_id
    LEFT JOIN LATERAL (
      SELECT SUM(il.qty) AS qty, SUM(il.grni_cleared_value) AS value
      FROM supplier_invoice_lines il
      JOIN supplier_invoices i ON i.id = il.invoice_id AND i.tenant_id = il.tenant_id
      WHERE il.grn_line_id = l.id AND i.status = 'POSTED'
        AND i.invoice_date <= ${asOf}
    ) inv ON true
    WHERE g.status = 'POSTED' AND g.receipt_date <= ${asOf}
    ORDER BY g.receipt_date, g.id, l.line_no
  `);
  return rows.rows as unknown as {
    grnId: string;
    receiptNo: string | null;
    receiptDate: string;
    supplierId: string;
    grnLineId: string;
    itemId: string;
    receivedQty: string;
    receivedValue: string;
    invoicedQty: string;
    invoicedValue: string;
  }[];
}

/** GL balance of an account as-of (signed journal base amounts). */
export async function glBalanceAsOf(accountId: string, asOf: string): Promise<string> {
  const rows = await tenantTx().execute(sql`
    SELECT COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.base_amount ELSE -l.base_amount END), 0)::numeric(19,4)::text AS balance
    FROM journal_lines l
    JOIN journal_entries e ON e.id = l.journal_entry_id AND e.tenant_id = l.tenant_id
    WHERE l.account_id = ${accountId} AND e.entry_date <= ${asOf}
      AND e.status <> 'CANCELLED'
  `);
  return (rows.rows as unknown as { balance: string }[])[0]!.balance;
}

/** The GRNI account's active mapping (fail-closed upstream). */
export async function findActiveGrniAccount(): Promise<{ accountId: string } | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT account_id AS "accountId" FROM account_purposes
    WHERE purpose_key = 'GRNI' AND active_to IS NULL LIMIT 1
  `);
  return (rows.rows as unknown as { accountId: string }[])[0];
}

/**
 * AP open items as-of (BR-028 determinism): the partner subledger's CREDIT
 * AP-control rows with effective settled amounts, filtered to the as-of
 * date — statements/aging recompute from these immutable entries.
 */
export async function apOpenItemsAsOf(input: {
  supplierId?: string;
  asOf: string;
  openOnly: boolean;
  limit: number;
  /** "CREDIT" = AP payable open items (payments/statement surface); "ALL" =
   *  every subledger row on the AP account (the INV-009 verification). */
  side?: "CREDIT" | "ALL";
}): Promise<
  {
    id: string;
    partnerId: string;
    entryDate: string;
    direction: "DEBIT" | "CREDIT";
    amount: string;
    baseAmount: string;
    currencyCode: string;
    exchangeRate: string;
    sourceType: string;
    sourceId: string | null;
    memo: string | null;
    settledAmount: string;
    outstanding: string;
    dueDate: string | null;
  }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT s.id, s.partner_id AS "partnerId", s.entry_date AS "entryDate", s.direction,
           s.amount::text AS amount, s.base_amount::text AS "baseAmount",
           s.currency_code AS "currencyCode", COALESCE(j.exchange_rate, 1)::text AS "exchangeRate",
           s.source_type AS "sourceType", s.source_id AS "sourceId", s.memo,
           COALESCE(settled.total, 0)::numeric(19,4)::text AS "settledAmount",
           (s.amount - COALESCE(settled.total, 0))::numeric(19,4)::text AS outstanding,
           CASE WHEN i.id IS NOT NULL THEN i.due_date
                WHEN d.id IS NOT NULL THEN d.note_date
                ELSE NULL END::text AS "dueDate"
    FROM partner_subledger_entries s
    JOIN journal_lines l ON l.id = s.journal_line_id
    JOIN journal_entries j ON j.id = s.journal_entry_id
    LEFT JOIN supplier_invoices i ON i.posted_journal_id = s.journal_entry_id
    LEFT JOIN debit_notes d ON d.posted_journal_id = s.journal_entry_id
    LEFT JOIN LATERAL (
      SELECT SUM(a.amount) AS total FROM treasury_allocations a
      WHERE a.open_item_id = s.id
        AND ((a.receipt_id IS NOT NULL AND EXISTS (SELECT 1 FROM receipts r
                 WHERE r.id = a.receipt_id AND r.status = 'POSTED'))
          OR (a.payment_id IS NOT NULL AND EXISTS (SELECT 1 FROM payments p
                 WHERE p.id = a.payment_id AND p.status = 'POSTED'))
          -- PHASE-027 (0038): note-owned allocations are effective by
          -- presence (see lockOpenItemAndSumPostedAllocations).
          OR (a.note_id IS NOT NULL))
    ) settled ON true
    WHERE s.entry_date <= ${input.asOf}
      AND (${input.supplierId ?? null}::uuid IS NULL OR s.partner_id = ${input.supplierId ?? null})
      AND (${input.side ?? "CREDIT"}::text = 'ALL' OR s.direction = 'CREDIT')
      AND l.account_id = (SELECT account_id FROM account_purposes
                          WHERE purpose_key = 'AP_CONTROL' AND active_to IS NULL LIMIT 1)
    ORDER BY s.entry_date, s.id
    LIMIT ${input.limit}
  `);
  const all = rows.rows as unknown as {
    id: string;
    partnerId: string;
    entryDate: string;
    direction: "DEBIT" | "CREDIT";
    amount: string;
    baseAmount: string;
    currencyCode: string;
    exchangeRate: string;
    sourceType: string;
    sourceId: string | null;
    memo: string | null;
    settledAmount: string;
    outstanding: string;
    dueDate: string | null;
  }[];
  if (!input.openOnly) return all;
  return all.filter((row) => Number(row.outstanding) > 0);
}

/** Suppliers with AP activity as-of (statement listing). */
export async function suppliersWithApActivity(asOf: string, limit: number): Promise<
  { supplierId: string; code: string; name: string; nameAr: string | null }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT DISTINCT p.id AS "supplierId", p.code, p.name, p.name_ar AS "nameAr"
    FROM partners p
    JOIN partner_subledger_entries s ON s.partner_id = p.id
    JOIN journal_lines l ON l.id = s.journal_line_id
    WHERE s.entry_date <= ${asOf}
      AND l.account_id = (SELECT account_id FROM account_purposes
                          WHERE purpose_key = 'AP_CONTROL' AND active_to IS NULL LIMIT 1)
    ORDER BY p.code LIMIT ${limit}
  `);
  return rows.rows as unknown as { supplierId: string; code: string; name: string; nameAr: string | null }[];
}

/** Partner statement rows as-of (both control sides + allocations detail). */
export async function partnerApStatementEntries(input: {
  supplierId: string;
  asOf: string;
}): Promise<
  {
    id: string;
    entryDate: string;
    direction: "DEBIT" | "CREDIT";
    amount: string;
    baseAmount: string;
    currencyCode: string;
    sourceType: string;
    sourceId: string | null;
    memo: string | null;
    docRef: string | null;
    settledAmount: string;
    outstanding: string;
  }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT s.id, s.entry_date AS "entryDate", s.direction, s.amount::text AS amount,
           s.base_amount::text AS "baseAmount", s.currency_code AS "currencyCode",
           s.source_type AS "sourceType", s.source_id AS "sourceId", s.memo,
           COALESCE(i.invoice_no, i.internal_no, d.note_no)::text AS "docRef",
           COALESCE(settled.total, 0)::numeric(19,4)::text AS "settledAmount",
           (s.amount - COALESCE(settled.total, 0))::numeric(19,4)::text AS outstanding
    FROM partner_subledger_entries s
    JOIN journal_lines l ON l.id = s.journal_line_id
    LEFT JOIN supplier_invoices i ON i.posted_journal_id = s.journal_entry_id
    LEFT JOIN debit_notes d ON d.posted_journal_id = s.journal_entry_id
    LEFT JOIN LATERAL (
      SELECT SUM(a.amount) AS total FROM treasury_allocations a
      WHERE a.open_item_id = s.id
        AND ((a.receipt_id IS NOT NULL AND EXISTS (SELECT 1 FROM receipts r
                 WHERE r.id = a.receipt_id AND r.status = 'POSTED'))
          OR (a.payment_id IS NOT NULL AND EXISTS (SELECT 1 FROM payments p
                 WHERE p.id = a.payment_id AND p.status = 'POSTED'))
          -- PHASE-027 (0038): note-owned allocations are effective by
          -- presence (see lockOpenItemAndSumPostedAllocations).
          OR (a.note_id IS NOT NULL))
    ) settled ON true
    WHERE s.partner_id = ${input.supplierId}
      AND s.entry_date <= ${input.asOf}
      AND l.account_id = (SELECT account_id FROM account_purposes
                          WHERE purpose_key = 'AP_CONTROL' AND active_to IS NULL LIMIT 1)
    ORDER BY s.entry_date, s.id
  `);
  return rows.rows as unknown as {
    id: string;
    entryDate: string;
    direction: "DEBIT" | "CREDIT";
    amount: string;
    baseAmount: string;
    currencyCode: string;
    sourceType: string;
    sourceId: string | null;
    memo: string | null;
    docRef: string | null;
    settledAmount: string;
    outstanding: string;
  }[];
}

/** The payment's settled open items (posted allocations only) — the re-allocation source view. */
export async function paymentPostedAllocations(paymentId: string): Promise<
  { openItemId: string; amount: string }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT a.open_item_id AS "openItemId", a.amount::text AS amount
    FROM treasury_allocations a
    WHERE a.payment_id = ${paymentId}
      AND EXISTS (SELECT 1 FROM payments p WHERE p.id = ${paymentId} AND p.status = 'POSTED')
    ORDER BY a.created_at, a.id
  `);
  return rows.rows as unknown as { openItemId: string; amount: string }[];
}

/** Rewrite the payment's allocation rows (the sanctioned re-allocation path). */
export async function replacePostedAllocations(input: {
  paymentId: string;
  allocations: readonly { openItemId: string | null; amount: string }[];
  actorId: string | null;
}): Promise<void> {
  const tx = tenantTx();
  await tx.execute(sql`DELETE FROM treasury_allocations WHERE payment_id = ${input.paymentId}`);
  for (const allocation of input.allocations) {
    if (allocation.openItemId === null) continue; // on-account remainder — no row
    await tx.execute(sql`
      INSERT INTO treasury_allocations (id, tenant_id, receipt_id, payment_id, open_item_id, amount, created_by)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), NULL, ${input.paymentId},
              ${allocation.openItemId}, ${allocation.amount}, ${input.actorId})
    `);
  }
}

// -- opening AP verification (T12) ---------------------------------------------------------

/** Opening partner-balance subledger rows (G-16 AP side) — allocatable from entry #1. */
export async function openingApItems(): Promise<
  { id: string; partnerId: string; amount: string; baseAmount: string; currencyCode: string }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT s.id, s.partner_id AS "partnerId", s.amount::text AS amount,
           s.base_amount::text AS "baseAmount", s.currency_code AS "currencyCode"
    FROM partner_subledger_entries s
    JOIN journal_entries j ON j.id = s.journal_entry_id
    WHERE s.source_type = 'opening_balances' AND s.direction = 'CREDIT'
    ORDER BY s.entry_date, s.id
  `);
  return rows.rows as unknown as {
    id: string;
    partnerId: string;
    amount: string;
    baseAmount: string;
    currencyCode: string;
  }[];
}
