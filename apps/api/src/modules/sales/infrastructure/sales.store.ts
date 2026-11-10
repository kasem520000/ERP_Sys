import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * Sales store (PHASE-012): the ONLY writer of the sales document tables
 * (sales_reps, quotations/lines, sales_orders/lines, delivery_notes/lines,
 * sales_invoices/lines, credit_notes/lines, sales_reallocations/lines).
 * Every statement runs in the caller's ambient tenant UoW so a failure
 * anywhere rolls the whole business operation back — delivery notes and
 * with-goods invoices compose the PHASE-010 movement core + the posting
 * engine in ONE transaction (INV-018 discipline); credit notes post the
 * G-04 pair the same way. stock_moves/stock_layers/item_stock are NEVER
 * written here (MODULE_BOUNDARIES — inventory exclusively owns them);
 * journal rows flow only through PostingEngine.post (ADR-0007).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("sales access requires an ambient tenant scope");
  }
  return context.tx;
}

/** Ambient-transaction read surface (the overdue job's owner lookup). */
export function salesTx(): TenantDb {
  return tenantTx();
}

// -- partners / items / settings (read ports over sibling modules) ----------------

export interface CustomerRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  kind: string;
  creditTermId: string | null;
  creditLimit: string | null;
  priceListId: string | null;
  status: string;
}

export async function findCustomerById(id: string): Promise<CustomerRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, code, name, name_ar AS "nameAr", kind, credit_terms_id AS "creditTermId",
           credit_limit AS "creditLimit", price_list_id AS "priceListId", status
    FROM partners WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as CustomerRow[])[0];
}

export async function readSetting<T>(key: string): Promise<T | undefined> {
  const { readEffectiveSetting } = await import("../../../infra/settings/setting-reader");
  return readEffectiveSetting<T>(key);
}

// -- sales reps -------------------------------------------------------------------

export interface SalesRepRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  note: string | null;
  noteAr: string | null;
}

const REP_COLUMNS = sql`id, code, name, name_ar AS "nameAr", email, phone, status, note, note_ar AS "noteAr"`;

export async function insertSalesRep(input: {
  code: string;
  name: string;
  nameAr: string | null;
  email: string | null;
  phone: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<SalesRepRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO sales_reps (id, tenant_id, code, name, name_ar, email, phone, note, note_ar, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.code}, ${input.name}, ${input.nameAr},
            ${input.email}, ${input.phone}, ${input.note}, ${input.noteAr}, ${input.actorId})
  `);
  return findSalesRepById(id) as Promise<SalesRepRow>;
}

export async function findSalesRepById(id: string): Promise<SalesRepRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${REP_COLUMNS} FROM sales_reps WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as SalesRepRow[])[0];
}

export async function listSalesReps(filter: { status?: string; limit: number }): Promise<SalesRepRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${REP_COLUMNS} FROM sales_reps
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
    ORDER BY code LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as SalesRepRow[];
}

export async function updateSalesRepStatus(input: {
  id: string;
  status: string;
  actorId: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE sales_reps SET status = ${input.status}, version = version + 1, updated_at = now()
    WHERE id = ${input.id}
  `);
}

// -- quotations -------------------------------------------------------------------

export interface QuotationRow {
  id: string;
  branchId: string;
  customerId: string;
  salesRepId: string | null;
  quoteNo: string | null;
  quoteDate: string;
  validUntil: string;
  currencyCode: string;
  exchangeRate: string | null;
  status: string;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  convertedOrderId: string | null;
}

const QUOTATION_COLUMNS = sql`id, branch_id AS "branchId", customer_id AS "customerId",
  sales_rep_id AS "salesRepId", quote_no AS "quoteNo", quote_date AS "quoteDate",
  valid_until AS "validUntil", currency_code AS "currencyCode", exchange_rate AS "exchangeRate",
  status, total_net AS "totalNet", total_tax AS "totalTax", total_gross AS "totalGross",
  note, note_ar AS "noteAr", created_by AS "createdBy", converted_order_id AS "convertedOrderId"`;

export async function insertQuotation(input: {
  branchId: string;
  customerId: string;
  salesRepId: string | null;
  quoteDate: string;
  validUntil: string;
  currencyCode: string;
  exchangeRate: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  lines: readonly {
    itemId: string;
    description: string | null;
    descriptionAr: string | null;
    qty: string;
    unitPrice: string;
    discountAmount: string;
    taxCodeId: string | null;
    netAmount: string;
    taxAmount: string;
    note: string | null;
  }[];
}): Promise<QuotationRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO quotations (id, tenant_id, branch_id, customer_id, sales_rep_id, quote_date,
                            valid_until, currency_code, exchange_rate, total_net, total_tax,
                            total_gross, note, note_ar, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.branchId}, ${input.customerId}, ${input.salesRepId},
            ${input.quoteDate}, ${input.validUntil}, ${input.currencyCode}, ${input.exchangeRate},
            ${input.totalNet}, ${input.totalTax}, ${input.totalGross}, ${input.note}, ${input.noteAr}, ${input.actorId})
  `);
  let lineNo = 0;
  for (const line of input.lines) {
    lineNo += 1;
    await tx.execute(sql`
      INSERT INTO quotation_lines (id, tenant_id, quotation_id, line_no, item_id, description,
                                   description_ar, qty, unit_price, discount_amount, tax_code_id,
                                   net_amount, tax_amount, note)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${id}, ${lineNo}, ${line.itemId},
              ${line.description}, ${line.descriptionAr}, ${line.qty}, ${line.unitPrice},
              ${line.discountAmount}, ${line.taxCodeId}, ${line.netAmount}, ${line.taxAmount}, ${line.note})
    `);
  }
  return findQuotationById(id) as Promise<QuotationRow>;
}

export async function findQuotationById(id: string): Promise<QuotationRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${QUOTATION_COLUMNS} FROM quotations WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as QuotationRow[])[0];
}

export async function listQuotations(filter: {
  status?: string;
  customerId?: string;
  limit: number;
}): Promise<QuotationRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${QUOTATION_COLUMNS} FROM quotations
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.customerId ?? null}::uuid IS NULL OR customer_id = ${filter.customerId ?? null})
    ORDER BY created_at DESC LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as QuotationRow[];
}

export interface QuotationLineRow {
  id: string;
  lineNo: number;
  itemId: string;
  description: string | null;
  descriptionAr: string | null;
  qty: string;
  unitPrice: string;
  discountAmount: string;
  taxCodeId: string | null;
  netAmount: string;
  taxAmount: string;
}

export async function listQuotationLines(quotationId: string): Promise<QuotationLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, line_no AS "lineNo", item_id AS "itemId", description, description_ar AS "descriptionAr",
           qty::text AS qty, unit_price::text AS "unitPrice", discount_amount::text AS "discountAmount",
           tax_code_id AS "taxCodeId", net_amount::text AS "netAmount", tax_amount::text AS "taxAmount"
    FROM quotation_lines WHERE quotation_id = ${quotationId} ORDER BY line_no
  `);
  return rows.rows as unknown as QuotationLineRow[];
}

export async function updateQuotationStatus(input: {
  id: string;
  status: string;
  actorId: string | null;
  quoteNo?: string | null;
  convertedOrderId?: string | null;
  rejectionReason?: string | null;
  cancelReason?: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE quotations SET
      status = ${input.status},
      quote_no = COALESCE(${input.quoteNo ?? null}, quote_no),
      converted_order_id = COALESCE(${input.convertedOrderId ?? null}, converted_order_id),
      rejection_reason = CASE WHEN ${input.status} = 'REJECTED' THEN ${input.rejectionReason ?? null} ELSE rejection_reason END,
      cancel_reason = CASE WHEN ${input.status} = 'CANCELLED' THEN ${input.cancelReason ?? null} ELSE cancel_reason END,
      sent_at = CASE WHEN ${input.status} = 'SENT' THEN now() ELSE sent_at END,
      sent_by = CASE WHEN ${input.status} = 'SENT' THEN ${input.actorId} ELSE sent_by END,
      accepted_at = CASE WHEN ${input.status} = 'ACCEPTED' THEN now() ELSE accepted_at END,
      accepted_by = CASE WHEN ${input.status} = 'ACCEPTED' THEN ${input.actorId} ELSE accepted_by END,
      rejected_at = CASE WHEN ${input.status} = 'REJECTED' THEN now() ELSE rejected_at END,
      rejected_by = CASE WHEN ${input.status} = 'REJECTED' THEN ${input.actorId} ELSE rejected_by END,
      cancelled_at = CASE WHEN ${input.status} = 'CANCELLED' THEN now() ELSE cancelled_at END,
      cancelled_by = CASE WHEN ${input.status} = 'CANCELLED' THEN ${input.actorId} ELSE cancelled_by END,
      version = version + 1, updated_at = now()
    WHERE id = ${input.id}
  `);
}

/** BR-006 housekeeping: flip lapsed SENT quotations to EXPIRED. */
export async function expireLapsedQuotations(): Promise<number> {
  const rows = await tenantTx().execute(sql`
    UPDATE quotations SET status = 'EXPIRED', version = version + 1, updated_at = now()
    WHERE status = 'SENT' AND valid_until < CURRENT_DATE RETURNING id
  `);
  return rows.rows.length;
}

// -- sales orders -------------------------------------------------------------------

export interface SalesOrderRow {
  id: string;
  branchId: string;
  customerId: string;
  salesRepId: string | null;
  warehouseId: string;
  quotationId: string | null;
  orderNo: string | null;
  orderDate: string;
  expectedDate: string | null;
  currencyCode: string;
  exchangeRate: string | null;
  status: string;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
}

const ORDER_COLUMNS = sql`id, branch_id AS "branchId", customer_id AS "customerId",
  sales_rep_id AS "salesRepId", warehouse_id AS "warehouseId", quotation_id AS "quotationId",
  order_no AS "orderNo", order_date AS "orderDate", expected_date AS "expectedDate",
  currency_code AS "currencyCode", exchange_rate AS "exchangeRate", status,
  total_net AS "totalNet", total_tax AS "totalTax", total_gross AS "totalGross",
  note, note_ar AS "noteAr", created_by AS "createdBy"`;

export async function insertSalesOrder(input: {
  branchId: string;
  customerId: string;
  salesRepId: string | null;
  warehouseId: string;
  quotationId: string | null;
  orderDate: string;
  expectedDate: string | null;
  currencyCode: string;
  exchangeRate: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  lines: readonly {
    itemId: string;
    description: string | null;
    descriptionAr: string | null;
    qty: string;
    unitPrice: string;
    discountAmount: string;
    taxCodeId: string | null;
    netAmount: string;
    taxAmount: string;
    note: string | null;
  }[];
}): Promise<SalesOrderRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO sales_orders (id, tenant_id, branch_id, customer_id, sales_rep_id, warehouse_id,
                              quotation_id, order_date, expected_date, currency_code, exchange_rate,
                              total_net, total_tax, total_gross, note, note_ar, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.branchId}, ${input.customerId}, ${input.salesRepId},
            ${input.warehouseId}, ${input.quotationId}, ${input.orderDate}, ${input.expectedDate},
            ${input.currencyCode}, ${input.exchangeRate}, ${input.totalNet}, ${input.totalTax},
            ${input.totalGross}, ${input.note}, ${input.noteAr}, ${input.actorId})
  `);
  let lineNo = 0;
  for (const line of input.lines) {
    lineNo += 1;
    await tx.execute(sql`
      INSERT INTO sales_order_lines (id, tenant_id, order_id, line_no, item_id, description,
                                     description_ar, qty, unit_price, discount_amount, tax_code_id,
                                     net_amount, tax_amount, note)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${id}, ${lineNo}, ${line.itemId},
              ${line.description}, ${line.descriptionAr}, ${line.qty}, ${line.unitPrice},
              ${line.discountAmount}, ${line.taxCodeId}, ${line.netAmount}, ${line.taxAmount}, ${line.note})
    `);
  }
  return findSalesOrderById(id) as Promise<SalesOrderRow>;
}

export async function findSalesOrderById(id: string): Promise<SalesOrderRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ORDER_COLUMNS} FROM sales_orders WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as SalesOrderRow[])[0];
}

export async function listSalesOrders(filter: {
  status?: string;
  customerId?: string;
  limit: number;
}): Promise<SalesOrderRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ORDER_COLUMNS} FROM sales_orders
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.customerId ?? null}::uuid IS NULL OR customer_id = ${filter.customerId ?? null})
    ORDER BY created_at DESC LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as SalesOrderRow[];
}

export interface SalesOrderLineRow {
  id: string;
  lineNo: number;
  itemId: string;
  description: string | null;
  descriptionAr: string | null;
  qty: string;
  unitPrice: string;
  discountAmount: string;
  taxCodeId: string | null;
  netAmount: string;
  taxAmount: string;
  reservationId: string | null;
}

export async function listSalesOrderLines(orderId: string): Promise<SalesOrderLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, line_no AS "lineNo", item_id AS "itemId", description, description_ar AS "descriptionAr",
           qty::text AS qty, unit_price::text AS "unitPrice", discount_amount::text AS "discountAmount",
           tax_code_id AS "taxCodeId", net_amount::text AS "netAmount", tax_amount::text AS "taxAmount",
           reservation_id AS "reservationId"
    FROM sales_order_lines WHERE order_id = ${orderId} ORDER BY line_no
  `);
  return rows.rows as unknown as SalesOrderLineRow[];
}

export async function updateSalesOrderStatus(input: {
  id: string;
  status: string;
  actorId: string | null;
  orderNo?: string | null;
  cancelReason?: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE sales_orders SET
      status = ${input.status},
      order_no = COALESCE(${input.orderNo ?? null}, order_no),
      cancel_reason = CASE WHEN ${input.status} = 'CANCELLED' THEN ${input.cancelReason ?? null} ELSE cancel_reason END,
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
      version = version + 1, updated_at = now()
    WHERE id = ${input.id}
  `);
}

export async function setOrderLineReservation(lineId: string, reservationId: string | null): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE sales_order_lines SET reservation_id = ${reservationId}, updated_at = now()
    WHERE id = ${lineId}
  `);
}

// -- delivery notes -------------------------------------------------------------------

export interface DeliveryNoteRow {
  id: string;
  branchId: string;
  customerId: string;
  salesRepId: string | null;
  orderId: string | null;
  warehouseId: string;
  deliveryNo: string | null;
  deliveryDate: string;
  currencyCode: string;
  status: string;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  cogsValue: string;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  postedJournalId: string | null;
  convertedInvoiceId: string | null;
}

const DELIVERY_COLUMNS = sql`id, branch_id AS "branchId", customer_id AS "customerId",
  sales_rep_id AS "salesRepId", order_id AS "orderId", warehouse_id AS "warehouseId",
  delivery_no AS "deliveryNo", delivery_date AS "deliveryDate", currency_code AS "currencyCode",
  status, total_net AS "totalNet", total_tax AS "totalTax", total_gross AS "totalGross",
  cogs_value AS "cogsValue", note, note_ar AS "noteAr", created_by AS "createdBy",
  posted_journal_id AS "postedJournalId", converted_invoice_id AS "convertedInvoiceId"`;

export async function insertDeliveryNote(input: {
  branchId: string;
  customerId: string;
  salesRepId: string | null;
  orderId: string | null;
  warehouseId: string;
  deliveryDate: string;
  currencyCode: string;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  lines: readonly {
    orderLineId: string | null;
    itemId: string;
    description: string | null;
    descriptionAr: string | null;
    qty: string;
    unitPrice: string;
    discountAmount: string;
    netAmount: string;
    batchId: string | null;
    serialIds: string[] | null;
    note: string | null;
  }[];
}): Promise<DeliveryNoteRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO delivery_notes (id, tenant_id, branch_id, customer_id, sales_rep_id, order_id,
                                warehouse_id, delivery_date, currency_code, total_net, total_tax,
                                total_gross, note, note_ar, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.branchId}, ${input.customerId}, ${input.salesRepId},
            ${input.orderId}, ${input.warehouseId}, ${input.deliveryDate}, ${input.currencyCode},
            ${input.totalNet}, ${input.totalTax}, ${input.totalGross}, ${input.note}, ${input.noteAr}, ${input.actorId})
  `);
  let lineNo = 0;
  for (const line of input.lines) {
    lineNo += 1;
    await tx.execute(sql`
      INSERT INTO delivery_note_lines (id, tenant_id, delivery_id, line_no, order_line_id, item_id,
                                       description, description_ar, qty, unit_price, discount_amount,
                                       net_amount, batch_id, serial_ids, note)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${id}, ${lineNo}, ${line.orderLineId},
              ${line.itemId}, ${line.description}, ${line.descriptionAr}, ${line.qty}, ${line.unitPrice},
              ${line.discountAmount}, ${line.netAmount}, ${line.batchId},
              ${line.serialIds === null ? null : JSON.stringify(line.serialIds)}::jsonb, ${line.note})
    `);
  }
  return findDeliveryNoteById(id) as Promise<DeliveryNoteRow>;
}

export async function findDeliveryNoteById(id: string): Promise<DeliveryNoteRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${DELIVERY_COLUMNS} FROM delivery_notes WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as DeliveryNoteRow[])[0];
}

export async function listDeliveryNotes(filter: {
  status?: string;
  customerId?: string;
  orderId?: string;
  limit: number;
}): Promise<DeliveryNoteRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${DELIVERY_COLUMNS} FROM delivery_notes
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.customerId ?? null}::uuid IS NULL OR customer_id = ${filter.customerId ?? null})
      AND (${filter.orderId ?? null}::uuid IS NULL OR order_id = ${filter.orderId ?? null})
    ORDER BY created_at DESC LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as DeliveryNoteRow[];
}

export interface DeliveryNoteLineRow {
  id: string;
  lineNo: number;
  orderLineId: string | null;
  itemId: string;
  description: string | null;
  descriptionAr: string | null;
  qty: string;
  unitPrice: string;
  discountAmount: string;
  netAmount: string;
  batchId: string | null;
  serialIds: string[] | null;
  issueUnitCost: string | null;
  issueValue: string | null;
  note: string | null;
}

export async function listDeliveryNoteLines(deliveryId: string): Promise<DeliveryNoteLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, line_no AS "lineNo", order_line_id AS "orderLineId", item_id AS "itemId",
           description, description_ar AS "descriptionAr", qty::text AS qty,
           unit_price::text AS "unitPrice", discount_amount::text AS "discountAmount",
           net_amount::text AS "netAmount", batch_id AS "batchId", serial_ids AS "serialIds",
           issue_unit_cost::text AS "issueUnitCost", issue_value::text AS "issueValue", note
    FROM delivery_note_lines WHERE delivery_id = ${deliveryId} ORDER BY line_no
  `);
  return rows.rows as unknown as DeliveryNoteLineRow[];
}

export async function updateDeliveryNoteStatus(input: {
  id: string;
  status: string;
  actorId: string | null;
  deliveryNo?: string | null;
  postingDate?: string | null;
  postedJournalId?: string | null;
  cogsValue?: string | null;
  cancelReason?: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE delivery_notes SET
      status = ${input.status},
      delivery_no = COALESCE(${input.deliveryNo ?? null}, delivery_no),
      posting_date = COALESCE(${input.postingDate ?? null}, posting_date),
      posted_journal_id = COALESCE(${input.postedJournalId ?? null}, posted_journal_id),
      cogs_value = COALESCE(${input.cogsValue ?? null}, cogs_value),
      cancel_reason = CASE WHEN ${input.status} = 'CANCELLED' THEN ${input.cancelReason ?? null} ELSE cancel_reason END,
      posted_at = CASE WHEN ${input.status} = 'POSTED' THEN now() ELSE posted_at END,
      posted_by = CASE WHEN ${input.status} = 'POSTED' THEN ${input.actorId} ELSE posted_by END,
      cancelled_at = CASE WHEN ${input.status} = 'CANCELLED' THEN now() ELSE cancelled_at END,
      cancelled_by = CASE WHEN ${input.status} = 'CANCELLED' THEN ${input.actorId} ELSE cancelled_by END,
      version = version + 1, updated_at = now()
    WHERE id = ${input.id}
  `);
}

/** Persist the per-line issue quanta at post (the W-3 provenance). */
export async function markDeliveryLineIssued(input: {
  lineId: string;
  issueUnitCost: string;
  issueValue: string;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE delivery_note_lines SET issue_unit_cost = ${input.issueUnitCost}, issue_value = ${input.issueValue},
      updated_at = now()
    WHERE id = ${input.lineId}
  `);
}

export async function setDeliveryConvertedInvoice(deliveryId: string, invoiceId: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE delivery_notes SET converted_invoice_id = ${invoiceId}, version = version + 1, updated_at = now()
    WHERE id = ${deliveryId}
  `);
}

/** Σ invoiced qty per delivery line (the invoicing bound, INV-016 shape). */
export async function deliveryLineInvoicedQty(): Promise<Map<string, string>> {
  const rows = await tenantTx().execute(sql`
    SELECT l.delivery_line_id AS "deliveryLineId", SUM(l.qty)::text AS qty
    FROM sales_invoice_lines l
    JOIN sales_invoices i ON i.id = l.invoice_id
    WHERE l.delivery_line_id IS NOT NULL AND i.status = 'POSTED'
    GROUP BY l.delivery_line_id
  `);
  return new Map((rows.rows as unknown as { deliveryLineId: string; qty: string }[]).map((r) => [r.deliveryLineId, r.qty]));
}

// -- sales invoices -------------------------------------------------------------------

export interface SalesInvoiceRow {
  id: string;
  branchId: string;
  customerId: string;
  salesRepId: string | null;
  kind: string;
  invoiceNo: string | null;
  invoiceDate: string;
  dueDate: string;
  currencyCode: string;
  exchangeRate: string | null;
  orderId: string | null;
  deliveryId: string | null;
  warehouseId: string | null;
  cashAccountId: string | null;
  status: string;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  cogsValue: string;
  taxSummary: Record<string, unknown> | null;
  creditCheck: Record<string, unknown> | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  postedJournalId: string | null;
  postedCogsJournalId: string | null;
  // PHASE-016 POS channel columns (0024).
  channel: string;
  posTerminalId: string | null;
  orderType: string | null;
  posTableId: string | null;
  offlineReceiptNo: string | null;
  tenders: PosTender[] | null;
  // PHASE-017 (0025): the job-card provenance pair — which workshop card
  // produced this invoice, and for which vehicle (per-vehicle history).
  jobCardId: string | null;
  vehicleId: string | null;
  // PHASE-019 (0027): the service-billing provenance trio — contract
  // (recurring-billing link), service order (work-order invoice), project
  // (analytical stamp carried onto the post + COGS journal lines).
  contractId: string | null;
  serviceOrderId: string | null;
  projectId: string | null;
  // PHASE-031 (0042): the external insurer claim reference (the healthcare
  // shell's single additive column) — non-null = a CLAIM (insured) invoice
  // billed to the insurance-company partner; null = SELF-PAY (دفع مباشر)
  // billed to the patient. Metadata only: never a document number
  // (ADR-0006) and never a journal-line rider (INV-022).
  claimRef: string | null;
}

/** PHASE-016: a POS tender split line (jsonb on sales_invoices). */
export interface PosTender {
  method: "CASH" | "CARD";
  amount: string;
  reference?: string | null;
}

const INVOICE_COLUMNS = sql`id, branch_id AS "branchId", customer_id AS "customerId",
  sales_rep_id AS "salesRepId", kind, invoice_no AS "invoiceNo", invoice_date AS "invoiceDate",
  due_date AS "dueDate", currency_code AS "currencyCode", exchange_rate AS "exchangeRate",
  order_id AS "orderId", delivery_id AS "deliveryId", warehouse_id AS "warehouseId",
  cash_account_id AS "cashAccountId", status, total_net AS "totalNet", total_tax AS "totalTax",
  total_gross AS "totalGross", cogs_value AS "cogsValue", tax_summary AS "taxSummary",
  credit_check AS "creditCheck", note, note_ar AS "noteAr", created_by AS "createdBy",
  approved_by AS "approvedBy", posted_journal_id AS "postedJournalId",
  posted_cogs_journal_id AS "postedCogsJournalId",
  channel, pos_terminal_id AS "posTerminalId", order_type AS "orderType",
  pos_table_id AS "posTableId", offline_receipt_no AS "offlineReceiptNo", tenders,
  job_card_id AS "jobCardId", vehicle_id AS "vehicleId",
  contract_id AS "contractId", service_order_id AS "serviceOrderId", project_id AS "projectId",
  claim_ref AS "claimRef"`;

export async function insertSalesInvoice(input: {
  /** PHASE-016: the offline-sync client id (ADR-0006) — same id across
   * replays makes the posting-engine source key exactly-once (INV-013). */
  id?: string;
  branchId: string;
  customerId: string;
  salesRepId: string | null;
  kind: "CASH" | "CREDIT";
  invoiceDate: string;
  dueDate: string;
  currencyCode: string;
  exchangeRate: string | null;
  orderId: string | null;
  deliveryId: string | null;
  warehouseId: string | null;
  cashAccountId: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  taxSummary: Record<string, unknown> | null;
  creditCheck: Record<string, unknown> | null;
  /** PHASE-016 POS channel context (T5; 0024 columns). */
  channel?: "STANDARD" | "POS";
  posTerminalId?: string | null;
  orderType?: string | null;
  posTableId?: string | null;
  offlineReceiptNo?: string | null;
  tenders?: readonly PosTender[] | null;
  /** PHASE-017 (0025): the originating job card + vehicle (no FK beyond
   * existence — the callers validate; sales-owned provenance only). */
  jobCardId?: string | null;
  vehicleId?: string | null;
  /** PHASE-019 (0027): the service-billing provenance trio (composite FKs
   * in the migration; existence validated at the application layer — the
   * contract-billing port can replace the contract read). */
  contractId?: string | null;
  serviceOrderId?: string | null;
  projectId?: string | null;
  /** PHASE-031 (0042): the external insurer claim reference — non-null =
   * a claim (insured) invoice, null = self-pay (validated + normalized at
   * the application layer before this write; metadata only, INV-022). */
  claimRef?: string | null;
  lines: readonly {
    itemId: string | null;
    accountId: string | null;
    deliveryLineId: string | null;
    description: string | null;
    descriptionAr: string | null;
    qty: string;
    unitPrice: string;
    discountAmount: string;
    taxCodeId: string | null;
    netAmount: string;
    taxAmount: string;
    taxSnapshot: Record<string, unknown> | null;
    batchId: string | null;
    serialIds: string[] | null;
    /** PHASE-017 (0025): BR-008 zero-price FOC lines carry their reason. */
    focReasonCode?: string | null;
    note: string | null;
  }[];
}): Promise<SalesInvoiceRow> {
  const tx = tenantTx();
  const id = input.id ?? generateUuidV7();
  await tx.execute(sql`
    INSERT INTO sales_invoices (id, tenant_id, branch_id, customer_id, sales_rep_id, kind, invoice_date,
                                due_date, currency_code, exchange_rate, order_id, delivery_id,
                                warehouse_id, cash_account_id, total_net, total_tax, total_gross,
                                tax_summary, credit_check, note, note_ar, created_by,
                                channel, pos_terminal_id, order_type, pos_table_id,
                                offline_receipt_no, tenders, job_card_id, vehicle_id,
                                contract_id, service_order_id, project_id, claim_ref)
    VALUES (${id}, erp.current_tenant_id(), ${input.branchId}, ${input.customerId}, ${input.salesRepId},
            ${input.kind}, ${input.invoiceDate}, ${input.dueDate}, ${input.currencyCode}, ${input.exchangeRate},
            ${input.orderId}, ${input.deliveryId}, ${input.warehouseId}, ${input.cashAccountId},
            ${input.totalNet}, ${input.totalTax}, ${input.totalGross},
            ${JSON.stringify(input.taxSummary)}::jsonb, ${JSON.stringify(input.creditCheck)}::jsonb,
            ${input.note}, ${input.noteAr}, ${input.actorId},
            ${input.channel ?? "STANDARD"}, ${input.posTerminalId ?? null}, ${input.orderType ?? null},
            ${input.posTableId ?? null}, ${input.offlineReceiptNo ?? null},
            ${input.tenders === undefined || input.tenders === null ? null : JSON.stringify(input.tenders)}::jsonb,
            ${input.jobCardId ?? null}, ${input.vehicleId ?? null},
            ${input.contractId ?? null}, ${input.serviceOrderId ?? null}, ${input.projectId ?? null},
            ${input.claimRef ?? null})
  `);
  let lineNo = 0;
  for (const line of input.lines) {
    lineNo += 1;
    await tx.execute(sql`
      INSERT INTO sales_invoice_lines (id, tenant_id, invoice_id, line_no, item_id, account_id,
                                       delivery_line_id, description, description_ar, qty, unit_price,
                                       discount_amount, tax_code_id, net_amount, tax_amount, tax_snapshot,
                                       batch_id, serial_ids, foc_reason_code, note)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${id}, ${lineNo}, ${line.itemId},
              ${line.accountId}, ${line.deliveryLineId}, ${line.description}, ${line.descriptionAr},
              ${line.qty}, ${line.unitPrice}, ${line.discountAmount}, ${line.taxCodeId}, ${line.netAmount},
              ${line.taxAmount}, ${JSON.stringify(line.taxSnapshot)}::jsonb, ${line.batchId},
              ${line.serialIds === null ? null : JSON.stringify(line.serialIds)}::jsonb,
              ${line.focReasonCode ?? null}, ${line.note})
    `);
  }
  return findSalesInvoiceById(id) as Promise<SalesInvoiceRow>;
}

/** PHASE-016: offline dedupe — the OFF- receipt number is unique per
 * terminal; a replayed push finds the already-posted invoice here and
 * replays the original result (zero additional ledger effects, INV-013). */
export async function findPosInvoiceByOfflineNo(
  terminalId: string,
  offlineReceiptNo: string,
): Promise<SalesInvoiceRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${INVOICE_COLUMNS} FROM sales_invoices
    WHERE pos_terminal_id = ${terminalId} AND offline_receipt_no = ${offlineReceiptNo}
      AND channel = 'POS'
    LIMIT 1
  `);
  return (rows.rows as unknown as SalesInvoiceRow[])[0];
}

export async function findSalesInvoiceById(id: string): Promise<SalesInvoiceRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${INVOICE_COLUMNS} FROM sales_invoices WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as SalesInvoiceRow[])[0];
}

export async function listSalesInvoices(filter: {
  status?: string;
  customerId?: string;
  orderId?: string;
  kind?: string;
  limit: number;
}): Promise<SalesInvoiceRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${INVOICE_COLUMNS} FROM sales_invoices
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.customerId ?? null}::uuid IS NULL OR customer_id = ${filter.customerId ?? null})
      AND (${filter.orderId ?? null}::uuid IS NULL OR order_id = ${filter.orderId ?? null})
      AND (${filter.kind ?? null}::text IS NULL OR kind = ${filter.kind ?? null})
    ORDER BY created_at DESC LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as SalesInvoiceRow[];
}

// PHASE-019 (0027): infrastructure-level existence reads for the
// service-billing provenance trio. These are SALES-OWNED, read-only probes
// into the crm-owned tables (the composite FKs in the migration guarantee
// referential shape; these probes give the application layer its typed
// not-found errors BEFORE the insert). The contract-billing port
// (SalesInvoiceService.setContractBillingPort) can replace the contract
// read with the crm module's richer validateContract.
export async function findContractExists(contractId: string): Promise<boolean> {
  const rows = await tenantTx().execute<{ ok: boolean }>(sql`
    SELECT true AS ok FROM service_contracts WHERE id = ${contractId} LIMIT 1
  `);
  return (rows.rows[0] as { ok: boolean } | undefined)?.ok === true;
}

export async function findServiceOrderExists(serviceOrderId: string): Promise<boolean> {
  const rows = await tenantTx().execute<{ ok: boolean }>(sql`
    SELECT true AS ok FROM service_orders WHERE id = ${serviceOrderId} LIMIT 1
  `);
  return (rows.rows[0] as { ok: boolean } | undefined)?.ok === true;
}

export interface SalesInvoiceLineRow {
  id: string;
  lineNo: number;
  itemId: string | null;
  accountId: string | null;
  deliveryLineId: string | null;
  description: string | null;
  descriptionAr: string | null;
  qty: string;
  unitPrice: string;
  discountAmount: string;
  taxCodeId: string | null;
  netAmount: string;
  taxAmount: string;
  taxSnapshot: Record<string, unknown> | null;
  batchId: string | null;
  serialIds: string[] | null;
  issueUnitCost: string | null;
  issueValue: string | null;
  focReasonCode: string | null;
  note: string | null;
}

export async function listSalesInvoiceLines(invoiceId: string): Promise<SalesInvoiceLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, line_no AS "lineNo", item_id AS "itemId", account_id AS "accountId",
           delivery_line_id AS "deliveryLineId", description, description_ar AS "descriptionAr",
           qty::text AS qty, unit_price::text AS "unitPrice", discount_amount::text AS "discountAmount",
           tax_code_id AS "taxCodeId", net_amount::text AS "netAmount", tax_amount::text AS "taxAmount",
           tax_snapshot AS "taxSnapshot", batch_id AS "batchId", serial_ids AS "serialIds",
           issue_unit_cost::text AS "issueUnitCost", issue_value::text AS "issueValue",
           foc_reason_code AS "focReasonCode", note
    FROM sales_invoice_lines WHERE invoice_id = ${invoiceId} ORDER BY line_no
  `);
  return rows.rows as unknown as SalesInvoiceLineRow[];
}

export async function updateSalesInvoiceStatus(input: {
  id: string;
  status: string;
  actorId: string | null;
  invoiceNo?: string | null;
  postingDate?: string | null;
  postedJournalId?: string | null;
  postedCogsJournalId?: string | null;
  cogsValue?: string | null;
  approvedByPolicy?: boolean;
  creditCheck?: Record<string, unknown> | null;
  cancelReason?: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE sales_invoices SET
      status = ${input.status},
      invoice_no = COALESCE(${input.invoiceNo ?? null}, invoice_no),
      posting_date = COALESCE(${input.postingDate ?? null}, posting_date),
      posted_journal_id = COALESCE(${input.postedJournalId ?? null}, posted_journal_id),
      posted_cogs_journal_id = COALESCE(${input.postedCogsJournalId ?? null}, posted_cogs_journal_id),
      cogs_value = COALESCE(${input.cogsValue ?? null}, cogs_value),
      credit_check = COALESCE(${JSON.stringify(input.creditCheck ?? null)}::jsonb, credit_check),
      cancel_reason = CASE WHEN ${input.status} = 'CANCELLED' THEN ${input.cancelReason ?? null} ELSE cancel_reason END,
      submitted_at = CASE WHEN ${input.status} = 'PENDING_APPROVAL' THEN now() ELSE submitted_at END,
      submitted_by = CASE WHEN ${input.status} = 'PENDING_APPROVAL' THEN ${input.actorId} ELSE submitted_by END,
      approved_at = CASE WHEN ${input.status} IN ('APPROVED', 'POSTED') AND approved_at IS NULL THEN now() ELSE approved_at END,
      approved_by = CASE WHEN approved_by IS NULL AND ${input.status} IN ('APPROVED', 'POSTED')
                         THEN ${input.actorId} ELSE approved_by END,
      posted_at = CASE WHEN ${input.status} = 'POSTED' THEN now() ELSE posted_at END,
      posted_by = CASE WHEN ${input.status} = 'POSTED' THEN ${input.actorId} ELSE posted_by END,
      cancelled_at = CASE WHEN ${input.status} = 'CANCELLED' THEN now() ELSE cancelled_at END,
      cancelled_by = CASE WHEN ${input.status} = 'CANCELLED' THEN ${input.actorId} ELSE cancelled_by END,
      version = version + 1, updated_at = now()
    WHERE id = ${input.id}
  `);
}

/** Persist the per-line issue quanta at post (the W-3 provenance, flow B). */
export async function markInvoiceLineIssued(input: {
  lineId: string;
  issueUnitCost: string;
  issueValue: string;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE sales_invoice_lines SET issue_unit_cost = ${input.issueUnitCost}, issue_value = ${input.issueValue},
      updated_at = now()
    WHERE id = ${input.lineId}
  `);
}

// -- credit notes -------------------------------------------------------------------

export interface CreditNoteRow {
  id: string;
  branchId: string;
  customerId: string;
  salesRepId: string | null;
  invoiceId: string;
  noteNo: string | null;
  noteDate: string;
  currencyCode: string;
  exchangeRate: string | null;
  status: string;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  reentryValue: string;
  taxSummary: Record<string, unknown> | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  postedJournalId: string | null;
  /** PHASE-017 (0025): the warranty credit note's originating job card. */
  jobCardId: string | null;
}

const CREDIT_COLUMNS = sql`id, branch_id AS "branchId", customer_id AS "customerId",
  sales_rep_id AS "salesRepId", invoice_id AS "invoiceId", note_no AS "noteNo",
  note_date AS "noteDate", currency_code AS "currencyCode", exchange_rate AS "exchangeRate",
  status, total_net AS "totalNet", total_tax AS "totalTax", total_gross AS "totalGross",
  reentry_value AS "reentryValue", tax_summary AS "taxSummary", note, note_ar AS "noteAr",
  created_by AS "createdBy", posted_journal_id AS "postedJournalId", job_card_id AS "jobCardId"`;

export async function insertCreditNote(input: {
  branchId: string;
  customerId: string;
  salesRepId: string | null;
  invoiceId: string;
  noteDate: string;
  currencyCode: string;
  exchangeRate: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  reentryValue: string;
  taxSummary: Record<string, unknown> | null;
  /** PHASE-017 (0025): the originating job card (warranty corrections). */
  jobCardId?: string | null;
  lines: readonly {
    invoiceLineId: string;
    itemId: string | null;
    description: string | null;
    descriptionAr: string | null;
    qty: string;
    unitPrice: string;
    discountAmount: string;
    taxCodeId: string | null;
    netAmount: string;
    taxAmount: string;
    taxSnapshot: Record<string, unknown> | null;
    returnToStock: boolean;
    batchId: string | null;
    serialIds: string[] | null;
    reentryUnitCost: string | null;
    reentryValue: string | null;
    note: string | null;
  }[];
}): Promise<CreditNoteRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO credit_notes (id, tenant_id, branch_id, customer_id, sales_rep_id, invoice_id,
                              note_date, currency_code, exchange_rate, total_net, total_tax,
                              total_gross, reentry_value, tax_summary, note, note_ar, created_by,
                              job_card_id)
    VALUES (${id}, erp.current_tenant_id(), ${input.branchId}, ${input.customerId}, ${input.salesRepId},
            ${input.invoiceId}, ${input.noteDate}, ${input.currencyCode}, ${input.exchangeRate},
            ${input.totalNet}, ${input.totalTax}, ${input.totalGross}, ${input.reentryValue},
            ${JSON.stringify(input.taxSummary)}::jsonb, ${input.note}, ${input.noteAr}, ${input.actorId},
            ${input.jobCardId ?? null})
  `);
  let lineNo = 0;
  for (const line of input.lines) {
    lineNo += 1;
    await tx.execute(sql`
      INSERT INTO credit_note_lines (id, tenant_id, note_id, line_no, invoice_line_id, item_id,
                                     description, description_ar, qty, unit_price, discount_amount,
                                     tax_code_id, net_amount, tax_amount, tax_snapshot, return_to_stock,
                                     batch_id, serial_ids, reentry_unit_cost, reentry_value, note)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${id}, ${lineNo}, ${line.invoiceLineId},
              ${line.itemId}, ${line.description}, ${line.descriptionAr}, ${line.qty}, ${line.unitPrice},
              ${line.discountAmount}, ${line.taxCodeId}, ${line.netAmount}, ${line.taxAmount},
              ${JSON.stringify(line.taxSnapshot)}::jsonb, ${line.returnToStock}, ${line.batchId},
              ${line.serialIds === null ? null : JSON.stringify(line.serialIds)}::jsonb,
              ${line.reentryUnitCost}, ${line.reentryValue}, ${line.note})
    `);
  }
  return findCreditNoteById(id) as Promise<CreditNoteRow>;
}

export async function findCreditNoteById(id: string): Promise<CreditNoteRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${CREDIT_COLUMNS} FROM credit_notes WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as CreditNoteRow[])[0];
}

export async function listCreditNotes(filter: {
  status?: string;
  customerId?: string;
  invoiceId?: string;
  limit: number;
}): Promise<CreditNoteRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${CREDIT_COLUMNS} FROM credit_notes
    WHERE (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.customerId ?? null}::uuid IS NULL OR customer_id = ${filter.customerId ?? null})
      AND (${filter.invoiceId ?? null}::uuid IS NULL OR invoice_id = ${filter.invoiceId ?? null})
    ORDER BY created_at DESC LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as CreditNoteRow[];
}

export interface CreditNoteLineRow {
  id: string;
  lineNo: number;
  invoiceLineId: string;
  itemId: string | null;
  description: string | null;
  descriptionAr: string | null;
  qty: string;
  unitPrice: string;
  discountAmount: string;
  taxCodeId: string | null;
  netAmount: string;
  taxAmount: string;
  taxSnapshot: Record<string, unknown> | null;
  returnToStock: boolean;
  batchId: string | null;
  serialIds: string[] | null;
  reentryUnitCost: string | null;
  reentryValue: string | null;
  note: string | null;
}

export async function listCreditNoteLines(noteId: string): Promise<CreditNoteLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, line_no AS "lineNo", invoice_line_id AS "invoiceLineId", item_id AS "itemId",
           description, description_ar AS "descriptionAr", qty::text AS qty,
           unit_price::text AS "unitPrice", discount_amount::text AS "discountAmount",
           tax_code_id AS "taxCodeId", net_amount::text AS "netAmount", tax_amount::text AS "taxAmount",
           tax_snapshot AS "taxSnapshot", return_to_stock AS "returnToStock", batch_id AS "batchId",
           serial_ids AS "serialIds", reentry_unit_cost::text AS "reentryUnitCost",
           reentry_value::text AS "reentryValue", note
    FROM credit_note_lines WHERE note_id = ${noteId} ORDER BY line_no
  `);
  return rows.rows as unknown as CreditNoteLineRow[];
}

export async function updateCreditNoteStatus(input: {
  id: string;
  status: string;
  actorId: string | null;
  noteNo?: string | null;
  postingDate?: string | null;
  postedJournalId?: string | null;
  cancelReason?: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE credit_notes SET
      status = ${input.status},
      note_no = COALESCE(${input.noteNo ?? null}, note_no),
      posting_date = COALESCE(${input.postingDate ?? null}, posting_date),
      posted_journal_id = COALESCE(${input.postedJournalId ?? null}, posted_journal_id),
      cancel_reason = CASE WHEN ${input.status} = 'CANCELLED' THEN ${input.cancelReason ?? null} ELSE cancel_reason END,
      submitted_at = CASE WHEN ${input.status} = 'PENDING_APPROVAL' THEN now() ELSE submitted_at END,
      submitted_by = CASE WHEN ${input.status} = 'PENDING_APPROVAL' THEN ${input.actorId} ELSE submitted_by END,
      approved_at = CASE WHEN ${input.status} IN ('APPROVED', 'POSTED') AND approved_at IS NULL THEN now() ELSE approved_at END,
      approved_by = CASE WHEN approved_by IS NULL AND ${input.status} IN ('APPROVED', 'POSTED') THEN ${input.actorId} ELSE approved_by END,
      posted_at = CASE WHEN ${input.status} = 'POSTED' THEN now() ELSE posted_at END,
      posted_by = CASE WHEN ${input.status} = 'POSTED' THEN ${input.actorId} ELSE posted_by END,
      cancelled_at = CASE WHEN ${input.status} = 'CANCELLED' THEN now() ELSE cancelled_at END,
      cancelled_by = CASE WHEN ${input.status} = 'CANCELLED' THEN ${input.actorId} ELSE cancelled_by END,
      version = version + 1, updated_at = now()
    WHERE id = ${input.id}
  `);
}

// -- AR queries (open items as-of, statements, GL balance) ----------------------------

export interface ArOpenItemRow {
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
}

export async function arOpenItemsAsOf(input: {
  customerId?: string;
  asOf: string;
  openOnly: boolean;
  limit: number;
  /** "DEBIT" = AR receivable open items (receipts/statement surface); "ALL" =
   *  every subledger row on the AR account (the INV-009 verification). */
  side?: "DEBIT" | "ALL";
}): Promise<ArOpenItemRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT s.id, s.partner_id AS "partnerId", s.entry_date AS "entryDate", s.direction,
           s.amount::text AS amount, s.base_amount::text AS "baseAmount",
           s.currency_code AS "currencyCode", COALESCE(j.exchange_rate, 1)::text AS "exchangeRate",
           s.source_type AS "sourceType", s.source_id AS "sourceId", s.memo,
           COALESCE(settled.total, 0)::numeric(19,4)::text AS "settledAmount",
           (s.amount - COALESCE(settled.total, 0))::numeric(19,4)::text AS outstanding,
           CASE WHEN i.id IS NOT NULL THEN i.due_date
                WHEN c.id IS NOT NULL THEN c.note_date
                ELSE NULL END::text AS "dueDate"
    FROM partner_subledger_entries s
    JOIN journal_lines l ON l.id = s.journal_line_id
    JOIN journal_entries j ON j.id = s.journal_entry_id
    LEFT JOIN sales_invoices i ON i.posted_journal_id = s.journal_entry_id
    LEFT JOIN credit_notes c ON c.posted_journal_id = s.journal_entry_id
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
      AND (${input.customerId ?? null}::uuid IS NULL OR s.partner_id = ${input.customerId ?? null})
      AND (${input.side ?? "DEBIT"}::text = 'ALL' OR s.direction = 'DEBIT')
      AND l.account_id = (SELECT account_id FROM account_purposes
                          WHERE purpose_key = 'AR_CONTROL' AND active_to IS NULL LIMIT 1)
    ORDER BY s.entry_date, s.id
    LIMIT ${input.limit}
  `);
  const all = rows.rows as unknown as ArOpenItemRow[];
  if (!input.openOnly) return all;
  return all.filter((row) => Number(row.outstanding) > 0);
}

/**
 * PHASE-031 (0042 — the healthcare claim grouping read model): the open
 * AR claim slices — one row per (partner, claim_ref, currency) over the
 * OPEN DEBIT subledger items of claim (insured) invoices (claim_ref IS NOT
 * NULL; self-pay and non-invoice items never appear). The bounded query
 * rides the partial ix_sales_invoices_tenant_claim index and reconciles by
 * CONSTRUCTION: the slices are a partition of the partner's open items, so
 * Σ slices + Σ self-pay/non-invoice open items = the partner's AR open
 * total (INV-009/012 — asserted by the claim-lifecycle spec at every step).
 */
export interface ClaimSliceRow {
  customerId: string;
  customerCode: string;
  customerName: string;
  customerNameAr: string | null;
  claimRef: string;
  currencyCode: string;
  itemCount: number;
  outstandingTotal: string;
}

export async function arClaimSlicesAsOf(input: {
  customerId?: string;
  asOf: string;
}): Promise<ClaimSliceRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT s.partner_id AS "customerId", p.code AS "customerCode",
           p.name AS "customerName", p.name_ar AS "customerNameAr",
           i.claim_ref AS "claimRef", s.currency_code AS "currencyCode",
           count(*)::int AS "itemCount",
           SUM(s.amount - COALESCE(settled.total, 0))::numeric(19,4)::text AS "outstandingTotal"
    FROM partner_subledger_entries s
    JOIN journal_lines l ON l.id = s.journal_line_id
    JOIN sales_invoices i ON i.posted_journal_id = s.journal_entry_id AND i.claim_ref IS NOT NULL
    JOIN partners p ON p.id = s.partner_id
    LEFT JOIN LATERAL (
      SELECT SUM(a.amount) AS total FROM treasury_allocations a
      WHERE a.open_item_id = s.id
        AND ((a.receipt_id IS NOT NULL AND EXISTS (SELECT 1 FROM receipts r
                 WHERE r.id = a.receipt_id AND r.status = 'POSTED'))
          OR (a.payment_id IS NOT NULL AND EXISTS (SELECT 1 FROM payments pm
                 WHERE pm.id = a.payment_id AND pm.status = 'POSTED'))
          -- PHASE-027 (0038): note-owned allocations are effective by
          -- presence (see lockOpenItemAndSumPostedAllocations).
          OR (a.note_id IS NOT NULL))
    ) settled ON true
    WHERE s.entry_date <= ${input.asOf}
      AND (${input.customerId ?? null}::uuid IS NULL OR s.partner_id = ${input.customerId ?? null})
      AND s.direction = 'DEBIT'
      AND l.account_id = (SELECT account_id FROM account_purposes
                          WHERE purpose_key = 'AR_CONTROL' AND active_to IS NULL LIMIT 1)
      AND (s.amount - COALESCE(settled.total, 0)) > 0
    GROUP BY s.partner_id, p.code, p.name, p.name_ar, i.claim_ref, s.currency_code
    ORDER BY s.partner_id, i.claim_ref, s.currency_code
  `);
  return rows.rows as unknown as ClaimSliceRow[];
}

/** Customers with AR activity as-of (statement listing). */
export async function customersWithArActivity(asOf: string, limit: number): Promise<
  { customerId: string; code: string; name: string; nameAr: string | null }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT DISTINCT p.id AS "customerId", p.code, p.name, p.name_ar AS "nameAr"
    FROM partners p
    JOIN partner_subledger_entries s ON s.partner_id = p.id
    JOIN journal_lines l ON l.id = s.journal_line_id
    WHERE s.entry_date <= ${asOf}
      AND l.account_id = (SELECT account_id FROM account_purposes
                          WHERE purpose_key = 'AR_CONTROL' AND active_to IS NULL LIMIT 1)
    ORDER BY p.code LIMIT ${limit}
  `);
  return rows.rows as unknown as { customerId: string; code: string; name: string; nameAr: string | null }[];
}

/** Partner statement rows as-of (both control sides + allocations detail). */
export async function partnerArStatementEntries(input: {
  customerId: string;
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
    /** PHASE-031 (0042): the source sales invoice's claim ref (null for
     *  non-invoice entries + self-pay invoices) — the group-by-claim
     *  grouping key on the per-insurer statement view. */
    claimRef: string | null;
    settledAmount: string;
    outstanding: string;
  }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT s.id, s.entry_date AS "entryDate", s.direction, s.amount::text AS amount,
           s.base_amount::text AS "baseAmount", s.currency_code AS "currencyCode",
           s.source_type AS "sourceType", s.source_id AS "sourceId", s.memo,
           COALESCE(i.invoice_no, c.note_no)::text AS "docRef",
           i.claim_ref AS "claimRef",
           COALESCE(settled.total, 0)::numeric(19,4)::text AS "settledAmount",
           (s.amount - COALESCE(settled.total, 0))::numeric(19,4)::text AS outstanding
    FROM partner_subledger_entries s
    JOIN journal_lines l ON l.id = s.journal_line_id
    LEFT JOIN sales_invoices i ON i.posted_journal_id = s.journal_entry_id
    LEFT JOIN credit_notes c ON c.posted_journal_id = s.journal_entry_id
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
      AND s.partner_id = ${input.customerId}
      AND l.account_id IN (
        SELECT account_id FROM account_purposes
        WHERE purpose_key IN ('AR_CONTROL', 'AP_CONTROL') AND active_to IS NULL
      )
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
    claimRef: string | null;
    settledAmount: string;
    outstanding: string;
  }[];
}

/** A GL account's balance (DEBIT − CREDIT) as-of (the INV-009/RC checks). */
export async function glBalanceAsOf(accountId: string, asOf: string): Promise<string> {
  const rows = await tenantTx().execute(sql`
    SELECT COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.base_amount ELSE -l.base_amount END), 0)::text AS balance
    FROM journal_lines l
    JOIN journal_entries e ON e.id = l.journal_entry_id
    WHERE l.account_id = ${accountId} AND e.entry_date <= ${asOf} AND e.status = 'POSTED'
  `);
  return (rows.rows as unknown as { balance: string }[])[0]!.balance;
}

/** Opening AR items (allocatable from entry #1; the G-16 AR side). */
export async function openingArItems(): Promise<ArOpenItemRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT s.id, s.partner_id AS "partnerId", s.entry_date AS "entryDate", s.direction,
           s.amount::text AS amount, s.base_amount::text AS "baseAmount",
           s.currency_code AS "currencyCode", COALESCE(j.exchange_rate, 1)::text AS "exchangeRate",
           s.source_type AS "sourceType", s.source_id AS "sourceId", s.memo,
           '0.0000' AS "settledAmount", s.amount::text AS outstanding, NULL::text AS "dueDate"
    FROM partner_subledger_entries s
    JOIN journal_lines l ON l.id = s.journal_line_id
    JOIN journal_entries j ON j.id = s.journal_entry_id
    WHERE s.source_type = 'opening_balances' AND s.direction = 'DEBIT'
      AND l.account_id = (SELECT account_id FROM account_purposes
                          WHERE purpose_key = 'AR_CONTROL' AND active_to IS NULL LIMIT 1)
  `);
  return rows.rows as unknown as ArOpenItemRow[];
}

/** The partner's open AR balance in base currency (the BR-001 check input). */
export async function partnerArOpenBalanceBase(customerId: string): Promise<string> {
  const rows = await tenantTx().execute(sql`
    SELECT COALESCE(SUM(CASE WHEN s.direction = 'DEBIT' THEN s.base_amount ELSE -s.base_amount END), 0)::text AS balance
    FROM partner_subledger_entries s
    JOIN journal_lines l ON l.id = s.journal_line_id
    WHERE s.partner_id = ${customerId}
      AND l.account_id = (SELECT account_id FROM account_purposes
                          WHERE purpose_key = 'AR_CONTROL' AND active_to IS NULL LIMIT 1)
  `);
  return (rows.rows as unknown as { balance: string }[])[0]!.balance;
}

/** Overdue candidates: POSTED credit invoices past due with outstanding AR. */
export async function overdueInvoiceCandidates(asOf: string): Promise<
  { invoiceId: string; invoiceNo: string | null; customerId: string; dueDate: string; outstanding: string; currencyCode: string }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT i.id AS "invoiceId", i.invoice_no AS "invoiceNo", i.customer_id AS "customerId",
           i.due_date::text AS "dueDate", o.outstanding, i.currency_code AS "currencyCode"
    FROM sales_invoices i
    JOIN LATERAL (
      SELECT s.id AS entry_id, (s.amount - COALESCE((
        SELECT SUM(a.amount) FROM treasury_allocations a
        WHERE a.open_item_id = s.id
          AND ((a.receipt_id IS NOT NULL AND EXISTS (SELECT 1 FROM receipts r
                   WHERE r.id = a.receipt_id AND r.status = 'POSTED'))
            OR (a.payment_id IS NOT NULL AND EXISTS (SELECT 1 FROM payments p
                   WHERE p.id = a.payment_id AND p.status = 'POSTED'))
            -- PHASE-027 (0038): note-owned allocations effective by presence.
            OR (a.note_id IS NOT NULL))), 0))::numeric(19,4) AS outstanding
      FROM partner_subledger_entries s
      WHERE s.source_type = 'sales_invoice' AND s.source_id = i.id AND s.direction = 'DEBIT'
    ) o ON o.outstanding > 0
    WHERE i.status = 'POSTED' AND i.kind = 'CREDIT' AND i.due_date < ${asOf}
      AND NOT EXISTS (
        SELECT 1 FROM audit_events e
        WHERE e.entity_type = 'sales_invoice' AND e.entity_id = i.id AND e.action = 'sales.invoice_overdue'
      )
    ORDER BY i.due_date LIMIT 500
  `);
  return rows.rows as unknown as {
    invoiceId: string;
    invoiceNo: string | null;
    customerId: string;
    dueDate: string;
    outstanding: string;
    currencyCode: string;
  }[];
}

// -- sales re-allocations (audited documents, BR-027/INV-016) --------------------------

export interface SalesReallocationRow {
  id: string;
  docNo: string;
  receiptId: string;
  customerId: string;
  reason: string;
  totalAmount: string;
  executedAt: string;
}

export async function insertSalesReallocation(input: {
  receiptId: string;
  customerId: string;
  reason: string;
  actorId: string | null;
  totalAmount: string;
  docNo: string;
  lines: readonly { fromOpenItemId: string | null; toOpenItemId: string | null; amount: string }[];
}): Promise<SalesReallocationRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO sales_reallocations (id, tenant_id, doc_no, receipt_id, customer_id, reason,
                                     total_amount, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.docNo}, ${input.receiptId}, ${input.customerId},
            ${input.reason}, ${input.totalAmount}, ${input.actorId})
  `);
  let lineNo = 0;
  for (const line of input.lines) {
    lineNo += 1;
    await tx.execute(sql`
      INSERT INTO sales_reallocation_lines (id, tenant_id, reallocation_id, line_no,
                                            from_open_item_id, to_open_item_id, amount)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${id}, ${lineNo},
              ${line.fromOpenItemId}, ${line.toOpenItemId}, ${line.amount})
    `);
  }
  return findSalesReallocationById(id) as Promise<SalesReallocationRow>;
}

export async function findSalesReallocationById(id: string): Promise<SalesReallocationRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, doc_no AS "docNo", receipt_id AS "receiptId", customer_id AS "customerId",
           reason, total_amount::text AS "totalAmount", executed_at::text AS "executedAt"
    FROM sales_reallocations WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as SalesReallocationRow[])[0];
}

export async function listSalesReallocations(filter: {
  receiptId?: string;
  customerId?: string;
  limit: number;
}): Promise<SalesReallocationRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, doc_no AS "docNo", receipt_id AS "receiptId", customer_id AS "customerId",
           reason, total_amount::text AS "totalAmount", executed_at::text AS "executedAt"
    FROM sales_reallocations
    WHERE (${filter.receiptId ?? null}::uuid IS NULL OR receipt_id = ${filter.receiptId ?? null})
      AND (${filter.customerId ?? null}::uuid IS NULL OR customer_id = ${filter.customerId ?? null})
    ORDER BY created_at DESC LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as SalesReallocationRow[];
}

/** The receipt's posted allocation rows (the set a re-allocation rewrites). */
export async function receiptPostedAllocations(receiptId: string): Promise<
  { openItemId: string; amount: string }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT open_item_id AS "openItemId", amount::text AS amount
    FROM treasury_allocations WHERE receipt_id = ${receiptId}
  `);
  return rows.rows as unknown as { openItemId: string; amount: string }[];
}

/** Rewrite the receipt's allocation rows (the sanctioned re-allocation path).
 * The receipt's denormalized allocated_amount stays in sync (the list
 * surface never shows a stale total). */
export async function replacePostedReceiptAllocations(input: {
  receiptId: string;
  allocations: readonly { openItemId: string | null; amount: string }[];
  actorId: string | null;
}): Promise<void> {
  const tx = tenantTx();
  await tx.execute(sql`DELETE FROM treasury_allocations WHERE receipt_id = ${input.receiptId}`);
  for (const allocation of input.allocations) {
    if (allocation.openItemId === null) continue; // on-account remainder — no row
    await tx.execute(sql`
      INSERT INTO treasury_allocations (id, tenant_id, receipt_id, payment_id, open_item_id, amount, created_by)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.receiptId}, NULL,
              ${allocation.openItemId}, ${allocation.amount}, ${input.actorId})
    `);
  }
  // Keep the receipt's denormalized allocated_amount exact (Σ new rows).
  await tx.execute(sql`
    UPDATE receipts SET allocated_amount = COALESCE((
      SELECT SUM(amount) FROM treasury_allocations WHERE receipt_id = ${input.receiptId}
    ), 0), updated_at = now()
    WHERE id = ${input.receiptId}
  `);
}

// ---------------------------------------------------------------------------
// PHASE-013 · allocations feed (REPORT_CATALOG ar.allocations): receipt
// allocation rows for a window with their per-receipt allocated amounts
// (the Σ tie the report asserts).
// ---------------------------------------------------------------------------

export async function allocationsFeed(input: {
  fromDate: string;
  toDate: string;
}): Promise<
  readonly {
    id: string;
    receiptNo: string;
    docRef: string | null;
    allocatedAt: string;
    amount: string;
    receiptAllocated: string;
  }[]
> {
  const rows = await tenantTx().execute(sql`
    SELECT a.id, r.receipt_no AS "receiptNo",
           COALESCE(si.invoice_no, cn.note_no, e.source_type) AS "docRef",
           r.approved_at::text AS "allocatedAt",
           a.amount::text AS amount,
           r.allocated_amount::text AS "receiptAllocated"
    FROM treasury_allocations a
    JOIN receipts r ON r.id = a.receipt_id
    JOIN partner_subledger_entries se ON se.id = a.open_item_id
    JOIN journal_entries e ON e.id = se.journal_entry_id
    LEFT JOIN sales_invoices si ON si.id = e.source_id AND e.source_type = 'sales_invoice'
    LEFT JOIN credit_notes cn ON cn.id = e.source_id AND e.source_type = 'credit_note'
    WHERE r.status = 'POSTED'
      AND r.value_date BETWEEN ${input.fromDate} AND ${input.toDate}
    ORDER BY r.value_date, r.receipt_no
    LIMIT 5000
  `);
  return rows.rows as unknown as {
    id: string;
    receiptNo: string;
    docRef: string | null;
    allocatedAt: string;
    amount: string;
    receiptAllocated: string;
  }[];
}
