import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import type { TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * Sourcing store (PHASE-038): the ONLY writer of the RFQ / supplier-quote
 * / comparison tables (rfqs, rfq_lines, supplier_quotes,
 * supplier_quotes_lines, quote_comparisons). Every statement runs in the
 * caller's ambient tenant UoW (the tenant-context interceptor opens the
 * transaction and sets the RLS GUC; erp.current_tenant_id() stamps every
 * INSERT). Raw parameterized sql templates per the house store convention.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("sourcing access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- rfqs -----------------------------------------------------------------------

export interface RfqRow {
  id: string;
  branchId: string;
  rfqNo: string | null;
  title: string;
  titleAr: string | null;
  mode: string;
  status: string;
  currencyCode: string;
  dueAt: string | null;
  invitedSuppliers: string[];
  portalInvites: RfqPortalInvite[];
  issuedAt: string | null;
  issuedBy: string | null;
  quotedAt: string | null;
  awardedAt: string | null;
  awardedBy: string | null;
  closedAt: string | null;
  closedBy: string | null;
  cancelReason: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** A scoped portal credential: the sha256 hash only — the plaintext
 * secret is shown ONCE at mint and never stored (the enrollment-secret
 * discipline). */
export interface RfqPortalInvite {
  supplierId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

const RFQ_SELECT = sql`
  SELECT id, branch_id AS "branchId", rfq_no AS "rfqNo", title, title_ar AS "titleAr",
         mode, status, currency_code AS "currencyCode",
         due_at::text AS "dueAt", invited_suppliers AS "invitedSuppliers",
         portal_invites AS "portalInvites",
         issued_at::text AS "issuedAt", issued_by AS "issuedBy",
         quoted_at::text AS "quotedAt", awarded_at::text AS "awardedAt", awarded_by AS "awardedBy",
         closed_at::text AS "closedAt", closed_by AS "closedBy",
         cancel_reason AS "cancelReason", note, note_ar AS "noteAr",
         created_by AS "createdBy", created_at::text AS "createdAt",
         updated_at::text AS "updatedAt", version
  FROM rfqs`;

export async function insertRfq(input: {
  branchId: string;
  title: string;
  titleAr: string | null;
  mode: string;
  currencyCode: string;
  dueAt: string | null;
  invitedSuppliers: readonly string[];
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<string> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO rfqs (id, tenant_id, branch_id, title, title_ar, mode, currency_code,
                      due_at, invited_suppliers, note, note_ar, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.branchId}, ${input.title}, ${input.titleAr},
            ${input.mode}, ${input.currencyCode}, ${input.dueAt},
            ${JSON.stringify(input.invitedSuppliers)}::jsonb,
            ${input.note}, ${input.noteAr}, ${input.actorId})
  `);
  return id;
}

export async function findRfqById(id: string): Promise<RfqRow | undefined> {
  const rows = await tenantTx().execute(sql`${RFQ_SELECT} WHERE id = ${id} LIMIT 1`);
  return (rows.rows as unknown as RfqRow[])[0];
}

export async function listRfqs(filter: {
  status?: string;
  branchId?: string;
  limit: number;
}): Promise<RfqRow[]> {
  const conditions = [sql`1 = 1`];
  if (filter.status !== undefined && filter.status !== "") {
    conditions.push(sql`status = ${filter.status}`);
  }
  if (filter.branchId !== undefined && filter.branchId !== "") {
    conditions.push(sql`branch_id = ${filter.branchId}`);
  }
  const rows = await tenantTx().execute(sql`
    ${RFQ_SELECT} WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY created_at DESC LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as RfqRow[];
}

export async function updateRfq(
  id: string,
  patch: {
    title?: string;
    titleAr?: string | null;
    mode?: string;
    currencyCode?: string;
    dueAt?: string | null;
    invitedSuppliers?: readonly string[];
    note?: string | null;
    noteAr?: string | null;
    status?: string;
    rfqNo?: string;
    issuedAt?: string;
    issuedBy?: string | null;
    quotedAt?: string;
    awardedAt?: string;
    awardedBy?: string | null;
    closedAt?: string;
    closedBy?: string | null;
    cancelReason?: string;
    portalInvites?: readonly RfqPortalInvite[];
    actorId?: string | null;
  },
): Promise<void> {
  const sets = [sql`updated_at = now()`];
  if (patch.title !== undefined) sets.push(sql`title = ${patch.title}`);
  if (patch.titleAr !== undefined) sets.push(sql`title_ar = ${patch.titleAr}`);
  if (patch.mode !== undefined) sets.push(sql`mode = ${patch.mode}`);
  if (patch.currencyCode !== undefined) sets.push(sql`currency_code = ${patch.currencyCode}`);
  if (patch.dueAt !== undefined) sets.push(sql`due_at = ${patch.dueAt}`);
  if (patch.invitedSuppliers !== undefined) {
    sets.push(sql`invited_suppliers = ${JSON.stringify(patch.invitedSuppliers)}::jsonb`);
  }
  if (patch.note !== undefined) sets.push(sql`note = ${patch.note}`);
  if (patch.noteAr !== undefined) sets.push(sql`note_ar = ${patch.noteAr}`);
  if (patch.status !== undefined) sets.push(sql`status = ${patch.status}`);
  if (patch.rfqNo !== undefined) sets.push(sql`rfq_no = ${patch.rfqNo}`);
  if (patch.issuedAt !== undefined) sets.push(sql`issued_at = ${patch.issuedAt}`);
  if (patch.issuedBy !== undefined) sets.push(sql`issued_by = ${patch.issuedBy}`);
  if (patch.quotedAt !== undefined) sets.push(sql`quoted_at = ${patch.quotedAt}`);
  if (patch.awardedAt !== undefined) sets.push(sql`awarded_at = ${patch.awardedAt}`);
  if (patch.awardedBy !== undefined) sets.push(sql`awarded_by = ${patch.awardedBy}`);
  if (patch.closedAt !== undefined) sets.push(sql`closed_at = ${patch.closedAt}`);
  if (patch.closedBy !== undefined) sets.push(sql`closed_by = ${patch.closedBy}`);
  if (patch.cancelReason !== undefined) sets.push(sql`cancel_reason = ${patch.cancelReason}`);
  if (patch.portalInvites !== undefined) {
    sets.push(sql`portal_invites = ${JSON.stringify(patch.portalInvites)}::jsonb`);
  }
  await tenantTx().execute(sql`
    UPDATE rfqs SET ${sql.join(sets, sql`, `)} WHERE id = ${id}
  `);
}

// -- rfq_lines ------------------------------------------------------------------

export interface RfqLineRow {
  id: string;
  rfqId: string;
  lineNo: number;
  itemId: string;
  qty: string;
  targetPrice: string | null;
  note: string | null;
  createdAt: string;
}

export async function insertRfqLines(
  rfqId: string,
  lines: readonly { itemId: string; qty: string; targetPrice: string | null; note: string | null }[],
): Promise<void> {
  const tx = tenantTx();
  let lineNo = 0;
  for (const line of lines) {
    lineNo += 1;
    await tx.execute(sql`
      INSERT INTO rfq_lines (id, tenant_id, rfq_id, line_no, item_id, qty, target_price, note)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${rfqId}, ${lineNo},
              ${line.itemId}, ${line.qty}, ${line.targetPrice}, ${line.note})
    `);
  }
}

export async function deleteRfqLines(rfqId: string): Promise<void> {
  await tenantTx().execute(sql`DELETE FROM rfq_lines WHERE rfq_id = ${rfqId}`);
}

export async function listRfqLines(rfqId: string): Promise<RfqLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, rfq_id AS "rfqId", line_no AS "lineNo", item_id AS "itemId",
           qty::text AS qty, target_price::text AS "targetPrice", note,
           created_at::text AS "createdAt"
    FROM rfq_lines WHERE rfq_id = ${rfqId} ORDER BY line_no
  `);
  return rows.rows as unknown as RfqLineRow[];
}

export async function findRfqLineById(id: string): Promise<RfqLineRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, rfq_id AS "rfqId", line_no AS "lineNo", item_id AS "itemId",
           qty::text AS qty, target_price::text AS "targetPrice", note,
           created_at::text AS "createdAt"
    FROM rfq_lines WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as RfqLineRow[])[0];
}

// -- supplier_quotes ------------------------------------------------------------

export interface SupplierQuoteRow {
  id: string;
  rfqId: string;
  supplierId: string;
  quoteRef: string | null;
  status: string;
  submittedVia: string;
  currencyCode: string;
  leadTimeDays: number | null;
  validUntil: string | null;
  paymentTerms: string | null;
  submittedAt: string;
  submittedBy: string | null;
  portalContact: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

const QUOTE_SELECT = sql`
  SELECT id, rfq_id AS "rfqId", supplier_id AS "supplierId", quote_ref AS "quoteRef",
         status, submitted_via AS "submittedVia", currency_code AS "currencyCode",
         lead_time_days AS "leadTimeDays", valid_until::text AS "validUntil",
         payment_terms AS "paymentTerms", submitted_at::text AS "submittedAt",
         submitted_by AS "submittedBy", portal_contact AS "portalContact", note,
         created_at::text AS "createdAt", updated_at::text AS "updatedAt"
  FROM supplier_quotes`;

export async function upsertSupplierQuote(input: {
  rfqId: string;
  supplierId: string;
  quoteRef: string | null;
  submittedVia: string;
  currencyCode: string;
  leadTimeDays: number | null;
  validUntil: string | null;
  paymentTerms: string | null;
  submittedBy: string | null;
  portalContact: string | null;
  note: string | null;
}): Promise<string> {
  const tx = tenantTx();
  // One quote per supplier per RFQ (uq_supplier_quotes_tenant_rfq_supplier):
  // a re-submission while the round is open REPLACES the header + lines —
  // the upsert keeps the original id/submitted_at stable for provenance.
  const existing = await tx.execute(sql`
    SELECT id FROM supplier_quotes WHERE rfq_id = ${input.rfqId} AND supplier_id = ${input.supplierId} LIMIT 1
  `);
  const existingId = (existing.rows as unknown as { id: string }[])[0]?.id;
  if (existingId !== undefined) {
    await tx.execute(sql`
      UPDATE supplier_quotes SET
        quote_ref = ${input.quoteRef}, status = 'SUBMITTED', submitted_via = ${input.submittedVia},
        currency_code = ${input.currencyCode}, lead_time_days = ${input.leadTimeDays},
        valid_until = ${input.validUntil}, payment_terms = ${input.paymentTerms},
        submitted_at = now(), submitted_by = ${input.submittedBy},
        portal_contact = ${input.portalContact}, note = ${input.note}, updated_at = now()
      WHERE id = ${existingId}
    `);
    return existingId;
  }
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO supplier_quotes (id, tenant_id, rfq_id, supplier_id, quote_ref, status,
                                 submitted_via, currency_code, lead_time_days, valid_until,
                                 payment_terms, submitted_by, portal_contact, note)
    VALUES (${id}, erp.current_tenant_id(), ${input.rfqId}, ${input.supplierId}, ${input.quoteRef},
            'SUBMITTED', ${input.submittedVia}, ${input.currencyCode}, ${input.leadTimeDays},
            ${input.validUntil}, ${input.paymentTerms}, ${input.submittedBy},
            ${input.portalContact}, ${input.note})
  `);
  return id;
}

export async function findSupplierQuoteById(id: string): Promise<SupplierQuoteRow | undefined> {
  const rows = await tenantTx().execute(sql`${QUOTE_SELECT} WHERE id = ${id} LIMIT 1`);
  return (rows.rows as unknown as SupplierQuoteRow[])[0];
}

export async function findSupplierQuote(rfqId: string, supplierId: string): Promise<SupplierQuoteRow | undefined> {
  const rows = await tenantTx().execute(sql`
    ${QUOTE_SELECT} WHERE rfq_id = ${rfqId} AND supplier_id = ${supplierId} LIMIT 1
  `);
  return (rows.rows as unknown as SupplierQuoteRow[])[0];
}

export async function listSupplierQuotes(rfqId: string): Promise<SupplierQuoteRow[]> {
  const rows = await tenantTx().execute(sql`
    ${QUOTE_SELECT} WHERE rfq_id = ${rfqId} ORDER BY submitted_at, id
  `);
  return rows.rows as unknown as SupplierQuoteRow[];
}

/** The BR-062 floor counts SUBMITTED quotes only. */
export async function countSubmittedQuotes(rfqId: string): Promise<number> {
  const rows = await tenantTx().execute(sql`
    SELECT count(*)::int AS n FROM supplier_quotes WHERE rfq_id = ${rfqId} AND status = 'SUBMITTED'
  `);
  return (rows.rows as unknown as { n: number }[])[0]!.n;
}

export async function withdrawSupplierQuote(id: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE supplier_quotes SET status = 'WITHDRAWN', updated_at = now() WHERE id = ${id}
  `);
}

// -- supplier_quotes_lines --------------------------------------------------------

export interface SupplierQuoteLineRow {
  id: string;
  quoteId: string;
  rfqLineId: string;
  lineNo: number;
  qty: string;
  unitPrice: string;
  leadTimeDays: number | null;
  note: string | null;
}

export async function insertQuoteLines(
  quoteId: string,
  lines: readonly {
    rfqLineId: string;
    qty: string;
    unitPrice: string;
    leadTimeDays: number | null;
    note: string | null;
  }[],
): Promise<void> {
  const tx = tenantTx();
  let lineNo = 0;
  for (const line of lines) {
    lineNo += 1;
    await tx.execute(sql`
      INSERT INTO supplier_quotes_lines (id, tenant_id, quote_id, rfq_line_id, line_no,
                                         qty, unit_price, lead_time_days, note)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${quoteId}, ${line.rfqLineId},
              ${lineNo}, ${line.qty}, ${line.unitPrice}, ${line.leadTimeDays}, ${line.note})
    `);
  }
}

export async function deleteQuoteLines(quoteId: string): Promise<void> {
  await tenantTx().execute(sql`DELETE FROM supplier_quotes_lines WHERE quote_id = ${quoteId}`);
}

export async function listQuoteLines(quoteId: string): Promise<SupplierQuoteLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, quote_id AS "quoteId", rfq_line_id AS "rfqLineId", line_no AS "lineNo",
           qty::text AS qty, unit_price::text AS "unitPrice",
           lead_time_days AS "leadTimeDays", note
    FROM supplier_quotes_lines WHERE quote_id = ${quoteId} ORDER BY line_no
  `);
  return rows.rows as unknown as SupplierQuoteLineRow[];
}

export async function findQuoteLineById(id: string): Promise<SupplierQuoteLineRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, quote_id AS "quoteId", rfq_line_id AS "rfqLineId", line_no AS "lineNo",
           qty::text AS qty, unit_price::text AS "unitPrice",
           lead_time_days AS "leadTimeDays", note
    FROM supplier_quotes_lines WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as SupplierQuoteLineRow[])[0];
}

// -- quote_comparisons ------------------------------------------------------------

export interface QuoteComparisonRow {
  id: string;
  rfqId: string;
  snapshot: Record<string, unknown>;
  status: string;
  award: Record<string, unknown> | null;
  awardedBy: string | null;
  awardedAt: string | null;
  awardNote: string | null;
  awardNoteAr: string | null;
  generatedDocs: { kind: string; id: string; supplierId: string; documentNo?: string | null }[] | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export async function insertComparison(input: {
  rfqId: string;
  snapshot: Record<string, unknown>;
  actorId: string | null;
}): Promise<string> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO quote_comparisons (id, tenant_id, rfq_id, snapshot, status, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.rfqId},
            ${JSON.stringify(input.snapshot)}::jsonb, 'PREPARED', ${input.actorId})
  `);
  return id;
}

export async function findComparisonById(id: string): Promise<QuoteComparisonRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, rfq_id AS "rfqId", snapshot, status, award, awarded_by AS "awardedBy",
           awarded_at::text AS "awardedAt", award_note AS "awardNote",
           award_note_ar AS "awardNoteAr", generated_docs AS "generatedDocs",
           created_by AS "createdBy", created_at::text AS "createdAt",
           updated_at::text AS "updatedAt", version
    FROM quote_comparisons WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as QuoteComparisonRow[])[0];
}

export async function findLiveComparisonByRfq(rfqId: string): Promise<QuoteComparisonRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, rfq_id AS "rfqId", snapshot, status, award, awarded_by AS "awardedBy",
           awarded_at::text AS "awardedAt", award_note AS "awardNote",
           award_note_ar AS "awardNoteAr", generated_docs AS "generatedDocs",
           created_by AS "createdBy", created_at::text AS "createdAt",
           updated_at::text AS "updatedAt", version
    FROM quote_comparisons WHERE rfq_id = ${rfqId} AND status <> 'CANCELLED' LIMIT 1
  `);
  return (rows.rows as unknown as QuoteComparisonRow[])[0];
}

export async function awardComparison(
  id: string,
  patch: {
    award: Record<string, unknown>;
    awardedBy: string | null;
    awardNote: string | null;
    awardNoteAr: string | null;
    generatedDocs: { kind: string; id: string; supplierId: string; documentNo?: string | null }[];
  },
): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE quote_comparisons SET
      snapshot = snapshot, status = 'AWARDED', award = ${JSON.stringify(patch.award)}::jsonb,
      awarded_by = ${patch.awardedBy}, awarded_at = now(),
      award_note = ${patch.awardNote}, award_note_ar = ${patch.awardNoteAr},
      generated_docs = ${JSON.stringify(patch.generatedDocs)}::jsonb, updated_at = now(),
      version = version + 1
    WHERE id = ${id}
  `);
}

export async function cancelComparison(id: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE quote_comparisons SET status = 'CANCELLED', updated_at = now(), version = version + 1
    WHERE id = ${id}
  `);
}

// -- settings ------------------------------------------------------------------------

export async function readSetting<T>(key: string): Promise<T | undefined> {
  const { readEffectiveSetting } = await import("../../../infra/settings/setting-reader");
  return readEffectiveSetting<T>(key);
}
