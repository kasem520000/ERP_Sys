import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import type { TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * Collaboration store (PHASE-038): the ONLY writer of the supplier-
 * collaboration, CAPEX and tender tables (blanket_orders,
 * blanket_releases, supplier_ratings, approved_supplier_items,
 * supplier_advances, early_payment_discount_terms, capex_requests,
 * tender_intakes). Raw parameterized sql templates per the house store
 * convention; erp.current_tenant_id() stamps every INSERT.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("collaboration access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- blanket orders ---------------------------------------------------------------

export interface BlanketOrderRow {
  id: string;
  branchId: string;
  blanketNo: string;
  supplierId: string;
  contractId: string | null;
  title: string;
  titleAr: string | null;
  currencyCode: string;
  status: string;
  validFrom: string;
  validTo: string;
  minCommitment: string;
  maxCommitment: string;
  releasedAmount: string;
  priceLock: { itemId: string; unitPrice: string; note?: string }[];
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

const BLANKET_SELECT = sql`
  SELECT id, branch_id AS "branchId", blanket_no AS "blanketNo", supplier_id AS "supplierId",
         contract_id AS "contractId", title, title_ar AS "titleAr",
         currency_code AS "currencyCode", status,
         valid_from::text AS "validFrom", valid_to::text AS "validTo",
         min_commitment::text AS "minCommitment", max_commitment::text AS "maxCommitment",
         released_amount::text AS "releasedAmount", price_lock AS "priceLock",
         closed_at::text AS "closedAt", closed_by AS "closedBy",
         cancel_reason AS "cancelReason", note, note_ar AS "noteAr",
         created_by AS "createdBy", created_at::text AS "createdAt",
         updated_at::text AS "updatedAt", version
  FROM blanket_orders`;

export async function insertBlanketOrder(input: {
  branchId: string;
  supplierId: string;
  contractId: string | null;
  title: string;
  titleAr: string | null;
  currencyCode: string;
  validFrom: string;
  validTo: string;
  minCommitment: string;
  maxCommitment: string;
  priceLock: readonly { itemId: string; unitPrice: string; note?: string }[];
  blanketNo: string;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<string> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO blanket_orders (id, tenant_id, branch_id, blanket_no, supplier_id, contract_id,
                                title, title_ar, currency_code, status, valid_from, valid_to,
                                min_commitment, max_commitment, released_amount, price_lock,
                                note, note_ar, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.branchId}, ${input.blanketNo}, ${input.supplierId},
            ${input.contractId}, ${input.title}, ${input.titleAr}, ${input.currencyCode}, 'ACTIVE',
            ${input.validFrom}, ${input.validTo}, ${input.minCommitment}, ${input.maxCommitment}, 0,
            ${JSON.stringify(input.priceLock)}::jsonb, ${input.note}, ${input.noteAr}, ${input.actorId})
  `);
  return id;
}

export async function findBlanketOrderById(id: string): Promise<BlanketOrderRow | undefined> {
  const rows = await tenantTx().execute(sql`${BLANKET_SELECT} WHERE id = ${id} LIMIT 1`);
  return (rows.rows as unknown as BlanketOrderRow[])[0];
}

export async function listBlanketOrders(filter: {
  status?: string;
  supplierId?: string;
  limit: number;
}): Promise<BlanketOrderRow[]> {
  const conditions = [sql`1 = 1`];
  if (filter.status !== undefined && filter.status !== "") {
    conditions.push(sql`status = ${filter.status}`);
  }
  if (filter.supplierId !== undefined && filter.supplierId !== "") {
    conditions.push(sql`supplier_id = ${filter.supplierId}`);
  }
  const rows = await tenantTx().execute(sql`
    ${BLANKET_SELECT} WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY created_at DESC LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as BlanketOrderRow[];
}

export async function updateBlanketOrder(
  id: string,
  patch: {
    title?: string;
    titleAr?: string | null;
    validFrom?: string;
    validTo?: string;
    minCommitment?: string;
    maxCommitment?: string;
    priceLock?: readonly { itemId: string; unitPrice: string; note?: string }[];
    status?: string;
    closedAt?: string;
    closedBy?: string | null;
    cancelReason?: string;
    contractId?: string | null;
  },
): Promise<void> {
  const sets = [sql`updated_at = now()`];
  if (patch.title !== undefined) sets.push(sql`title = ${patch.title}`);
  if (patch.titleAr !== undefined) sets.push(sql`title_ar = ${patch.titleAr}`);
  if (patch.validFrom !== undefined) sets.push(sql`valid_from = ${patch.validFrom}`);
  if (patch.validTo !== undefined) sets.push(sql`valid_to = ${patch.validTo}`);
  if (patch.minCommitment !== undefined) sets.push(sql`min_commitment = ${patch.minCommitment}`);
  if (patch.maxCommitment !== undefined) sets.push(sql`max_commitment = ${patch.maxCommitment}`);
  if (patch.priceLock !== undefined) {
    sets.push(sql`price_lock = ${JSON.stringify(patch.priceLock)}::jsonb`);
  }
  if (patch.status !== undefined) sets.push(sql`status = ${patch.status}`);
  if (patch.closedAt !== undefined) sets.push(sql`closed_at = ${patch.closedAt}`);
  if (patch.closedBy !== undefined) sets.push(sql`closed_by = ${patch.closedBy}`);
  if (patch.cancelReason !== undefined) sets.push(sql`cancel_reason = ${patch.cancelReason}`);
  if (patch.contractId !== undefined) sets.push(sql`contract_id = ${patch.contractId}`);
  await tenantTx().execute(sql`
    UPDATE blanket_orders SET ${sql.join(sets, sql`, `)} WHERE id = ${id}
  `);
}

/** The release step: append the ledger row AND advance the parent's
 * released_amount in ONE statement against the max — the conditional
 * UPDATE is the over-release race floor (the CHECK + the service typed
 * rejection carry the rest). Returns the release ledger id + the parent
 * row state after the move (undefined = the guard rejected: remaining <
 * requested). */
export async function releaseBlanketCommitment(input: {
  blanketId: string;
  amount: string;
  release: {
    releaseNo: string;
    releaseDate: string;
    lines: readonly { itemId: string; qty: string; unitPrice: string }[];
    purchaseOrderId: string;
    note: string | null;
    actorId: string | null;
  };
}): Promise<{ releaseId: string; blanket: BlanketOrderRow } | undefined> {
  const tx = tenantTx();
  const releaseId = generateUuidV7();
  const advanced = await tx.execute(sql`
    UPDATE blanket_orders SET
      released_amount = released_amount + ${input.amount},
      updated_at = now(), version = version + 1
    WHERE id = ${input.blanketId}
      AND status = 'ACTIVE'
      AND valid_to >= CURRENT_DATE
      AND released_amount + ${input.amount} <= max_commitment
    RETURNING id
  `);
  if ((advanced.rows as unknown as { id: string }[]).length === 0) {
    return undefined;
  }
  await tx.execute(sql`
    INSERT INTO blanket_releases (id, tenant_id, blanket_id, release_no, release_date,
                                  lines, amount, purchase_order_id, note, created_by)
    VALUES (${releaseId}, erp.current_tenant_id(), ${input.blanketId}, ${input.release.releaseNo},
            ${input.release.releaseDate}, ${JSON.stringify(input.release.lines)}::jsonb,
            ${input.amount}, ${input.release.purchaseOrderId}, ${input.release.note},
            ${input.release.actorId})
  `);
  const blanket = await findBlanketOrderById(input.blanketId);
  if (blanket === undefined) return undefined;
  return { releaseId, blanket };
}

export interface BlanketReleaseRow {
  id: string;
  blanketId: string;
  releaseNo: string;
  releaseDate: string;
  lines: { itemId: string; qty: string; unitPrice: string }[];
  amount: string;
  purchaseOrderId: string;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

export async function listBlanketReleases(blanketId: string): Promise<BlanketReleaseRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, blanket_id AS "blanketId", release_no AS "releaseNo",
           release_date::text AS "releaseDate", lines, amount::text AS amount,
           purchase_order_id AS "purchaseOrderId", note, created_by AS "createdBy",
           created_at::text AS "createdAt"
    FROM blanket_releases WHERE blanket_id = ${blanketId} ORDER BY release_date, created_at
  `);
  return rows.rows as unknown as BlanketReleaseRow[];
}

// -- supplier ratings (scorecards) -------------------------------------------------

export interface SupplierRatingRow {
  id: string;
  supplierId: string;
  windowStart: string;
  windowEnd: string;
  deliveryScore: string;
  qualityScore: string;
  priceScore: string;
  overallScore: string;
  sampleSize: number;
  detail: Record<string, unknown>;
  computedBy: string | null;
  computedAt: string;
}

export async function upsertSupplierRating(input: {
  supplierId: string;
  windowStart: string;
  windowEnd: string;
  deliveryScore: string;
  qualityScore: string;
  priceScore: string;
  overallScore: string;
  sampleSize: number;
  detail: Record<string, unknown>;
  computedBy: string | null;
}): Promise<void> {
  const tx = tenantTx();
  const existing = await tx.execute(sql`
    SELECT id FROM supplier_ratings WHERE supplier_id = ${input.supplierId} LIMIT 1
  `);
  const detail = JSON.stringify(input.detail);
  if ((existing.rows as unknown as { id: string }[]).length > 0) {
    await tx.execute(sql`
      UPDATE supplier_ratings SET
        window_start = ${input.windowStart}, window_end = ${input.windowEnd},
        delivery_score = ${input.deliveryScore}, quality_score = ${input.qualityScore},
        price_score = ${input.priceScore}, overall_score = ${input.overallScore},
        sample_size = ${input.sampleSize}, detail = ${detail}::jsonb,
        computed_by = ${input.computedBy}, computed_at = now(), updated_at = now()
      WHERE supplier_id = ${input.supplierId}
    `);
    return;
  }
  await tx.execute(sql`
    INSERT INTO supplier_ratings (id, tenant_id, supplier_id, window_start, window_end,
                                  delivery_score, quality_score, price_score, overall_score,
                                  sample_size, detail, computed_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.supplierId},
            ${input.windowStart}, ${input.windowEnd}, ${input.deliveryScore},
            ${input.qualityScore}, ${input.priceScore}, ${input.overallScore},
            ${input.sampleSize}, ${detail}::jsonb, ${input.computedBy})
  `);
}

export async function findSupplierRating(supplierId: string): Promise<SupplierRatingRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, supplier_id AS "supplierId", window_start::text AS "windowStart",
           window_end::text AS "windowEnd", delivery_score::text AS "deliveryScore",
           quality_score::text AS "qualityScore", price_score::text AS "priceScore",
           overall_score::text AS "overallScore", sample_size AS "sampleSize",
           detail, computed_by AS "computedBy", computed_at::text AS "computedAt"
    FROM supplier_ratings WHERE supplier_id = ${supplierId} LIMIT 1
  `);
  return (rows.rows as unknown as SupplierRatingRow[])[0];
}

export async function listSupplierRatings(limit: number): Promise<SupplierRatingRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, supplier_id AS "supplierId", window_start::text AS "windowStart",
           window_end::text AS "windowEnd", delivery_score::text AS "deliveryScore",
           quality_score::text AS "qualityScore", price_score::text AS "priceScore",
           overall_score::text AS "overallScore", sample_size AS "sampleSize",
           detail, computed_by AS "computedBy", computed_at::text AS "computedAt"
    FROM supplier_ratings ORDER BY overall_score ASC LIMIT ${limit}
  `);
  return rows.rows as unknown as SupplierRatingRow[];
}

// -- approved supplier items --------------------------------------------------------

export interface ApprovedSupplierItemRow {
  id: string;
  supplierId: string;
  itemId: string;
  status: string;
  approvedBy: string | null;
  approvedAt: string;
  expiresAt: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function upsertApprovedSupplierItem(input: {
  supplierId: string;
  itemId: string;
  status: string;
  approvedBy: string | null;
  expiresAt: string | null;
  note: string | null;
}): Promise<string> {
  const tx = tenantTx();
  const existing = await tx.execute(sql`
    SELECT id FROM approved_supplier_items
    WHERE supplier_id = ${input.supplierId} AND item_id = ${input.itemId} LIMIT 1
  `);
  if ((existing.rows as unknown as { id: string }[]).length > 0) {
    const id = (existing.rows as unknown as { id: string }[])[0]!.id;
    await tx.execute(sql`
      UPDATE approved_supplier_items SET status = ${input.status},
        approved_by = ${input.approvedBy}, approved_at = now(),
        expires_at = ${input.expiresAt}, note = ${input.note}, updated_at = now()
      WHERE id = ${id}
    `);
    return id;
  }
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO approved_supplier_items (id, tenant_id, supplier_id, item_id, status,
                                         approved_by, expires_at, note)
    VALUES (${id}, erp.current_tenant_id(), ${input.supplierId}, ${input.itemId},
            ${input.status}, ${input.approvedBy}, ${input.expiresAt}, ${input.note})
  `);
  return id;
}

export async function findApprovedSupplierItem(id: string): Promise<ApprovedSupplierItemRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, supplier_id AS "supplierId", item_id AS "itemId", status,
           approved_by AS "approvedBy", approved_at::text AS "approvedAt",
           expires_at::text AS "expiresAt", note,
           created_at::text AS "createdAt", updated_at::text AS "updatedAt"
    FROM approved_supplier_items WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ApprovedSupplierItemRow[])[0];
}

export async function listApprovedSupplierItems(filter: {
  supplierId?: string;
  itemId?: string;
  limit: number;
}): Promise<ApprovedSupplierItemRow[]> {
  const conditions = [sql`1 = 1`];
  if (filter.supplierId !== undefined && filter.supplierId !== "") {
    conditions.push(sql`supplier_id = ${filter.supplierId}`);
  }
  if (filter.itemId !== undefined && filter.itemId !== "") {
    conditions.push(sql`item_id = ${filter.itemId}`);
  }
  const rows = await tenantTx().execute(sql`
    SELECT id, supplier_id AS "supplierId", item_id AS "itemId", status,
           approved_by AS "approvedBy", approved_at::text AS "approvedAt",
           expires_at::text AS "expiresAt", note,
           created_at::text AS "createdAt", updated_at::text AS "updatedAt"
    FROM approved_supplier_items
    WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY created_at DESC LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as ApprovedSupplierItemRow[];
}

/** The gate read (P-04): is this supplier approved for this item right
 * now? APPROVED + not expired (expires_at IS NULL OR >= today). */
export async function isSupplierApprovedForItem(supplierId: string, itemId: string): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    SELECT 1 FROM approved_supplier_items
    WHERE supplier_id = ${supplierId} AND item_id = ${itemId} AND status = 'APPROVED'
      AND (expires_at IS NULL OR expires_at >= CURRENT_DATE)
    LIMIT 1
  `);
  return (rows.rows as unknown as unknown[]).length > 0;
}

// -- supplier advances (G-33) ----------------------------------------------------------

export interface SupplierAdvanceRow {
  id: string;
  supplierId: string;
  advanceNo: string | null;
  currencyCode: string;
  amount: string;
  status: string;
  appliedAmount: string;
  approvedBy: string | null;
  approvedAt: string | null;
  cashAccountId: string | null;
  entryDate: string | null;
  postedJournalId: string | null;
  entryNo: string | null;
  disbursedAt: string | null;
  disbursedBy: string | null;
  cancelReason: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const ADVANCE_SELECT = sql`
  SELECT id, supplier_id AS "supplierId", advance_no AS "advanceNo",
         currency_code AS "currencyCode", amount::text AS amount, status,
         applied_amount::text AS "appliedAmount", approved_by AS "approvedBy",
         approved_at::text AS "approvedAt", cash_account_id AS "cashAccountId",
         entry_date::text AS "entryDate", posted_journal_id AS "postedJournalId",
         entry_no AS "entryNo", disbursed_at::text AS "disbursedAt",
         disbursed_by AS "disbursedBy", cancel_reason AS "cancelReason",
         note, note_ar AS "noteAr", created_by AS "createdBy",
         created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
  FROM supplier_advances`;

export async function insertSupplierAdvance(input: {
  supplierId: string;
  currencyCode: string;
  amount: string;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<string> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO supplier_advances (id, tenant_id, supplier_id, currency_code, amount,
                                   status, note, note_ar, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.supplierId}, ${input.currencyCode},
            ${input.amount}, 'DRAFT', ${input.note}, ${input.noteAr}, ${input.actorId})
  `);
  return id;
}

export async function findSupplierAdvanceById(id: string): Promise<SupplierAdvanceRow | undefined> {
  const rows = await tenantTx().execute(sql`${ADVANCE_SELECT} WHERE id = ${id} LIMIT 1`);
  return (rows.rows as unknown as SupplierAdvanceRow[])[0];
}

export async function listSupplierAdvances(filter: {
  supplierId?: string;
  status?: string;
  limit: number;
}): Promise<SupplierAdvanceRow[]> {
  const conditions = [sql`1 = 1`];
  if (filter.supplierId !== undefined && filter.supplierId !== "") {
    conditions.push(sql`supplier_id = ${filter.supplierId}`);
  }
  if (filter.status !== undefined && filter.status !== "") {
    conditions.push(sql`status = ${filter.status}`);
  }
  const rows = await tenantTx().execute(sql`
    ${ADVANCE_SELECT} WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY created_at DESC LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as SupplierAdvanceRow[];
}

export async function updateSupplierAdvance(
  id: string,
  patch: {
    status?: string;
    approvedBy?: string | null;
    approvedAt?: string;
    advanceNo?: string;
    cashAccountId?: string;
    entryDate?: string;
    postedJournalId?: string;
    entryNo?: string | null;
    disbursedAt?: string;
    disbursedBy?: string | null;
    appliedAmount?: string;
    cancelReason?: string;
  },
): Promise<void> {
  const sets = [sql`updated_at = now()`];
  if (patch.status !== undefined) sets.push(sql`status = ${patch.status}`);
  if (patch.approvedBy !== undefined) sets.push(sql`approved_by = ${patch.approvedBy}`);
  if (patch.approvedAt !== undefined) sets.push(sql`approved_at = ${patch.approvedAt}`);
  if (patch.advanceNo !== undefined) sets.push(sql`advance_no = ${patch.advanceNo}`);
  if (patch.cashAccountId !== undefined) sets.push(sql`cash_account_id = ${patch.cashAccountId}`);
  if (patch.entryDate !== undefined) sets.push(sql`entry_date = ${patch.entryDate}`);
  if (patch.postedJournalId !== undefined) sets.push(sql`posted_journal_id = ${patch.postedJournalId}`);
  if (patch.entryNo !== undefined) sets.push(sql`entry_no = ${patch.entryNo}`);
  if (patch.disbursedAt !== undefined) sets.push(sql`disbursed_at = ${patch.disbursedAt}`);
  if (patch.disbursedBy !== undefined) sets.push(sql`disbursed_by = ${patch.disbursedBy}`);
  if (patch.appliedAmount !== undefined) sets.push(sql`applied_amount = ${patch.appliedAmount}`);
  if (patch.cancelReason !== undefined) sets.push(sql`cancel_reason = ${patch.cancelReason}`);
  await tenantTx().execute(sql`
    UPDATE supplier_advances SET ${sql.join(sets, sql`, `)} WHERE id = ${id}
  `);
}

// -- early payment discount terms (G-34) ------------------------------------------------

export interface DiscountTermsRow {
  id: string;
  supplierId: string;
  discountPct: string;
  discountDays: number;
  minInvoiceAmount: string;
  status: string;
  approvedBy: string | null;
  approvedAt: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function upsertDiscountTerms(input: {
  supplierId: string;
  discountPct: string;
  discountDays: number;
  minInvoiceAmount: string;
  status: string;
  note: string | null;
  actorId: string | null;
}): Promise<string> {
  const tx = tenantTx();
  const existing = await tx.execute(sql`
    SELECT id FROM early_payment_discount_terms WHERE supplier_id = ${input.supplierId} LIMIT 1
  `);
  if ((existing.rows as unknown as { id: string }[]).length > 0) {
    const id = (existing.rows as unknown as { id: string }[])[0]!.id;
    await tx.execute(sql`
      UPDATE early_payment_discount_terms SET discount_pct = ${input.discountPct},
        discount_days = ${input.discountDays}, min_invoice_amount = ${input.minInvoiceAmount},
        status = ${input.status}, note = ${input.note},
        approved_by = NULL, approved_at = NULL, updated_at = now()
      WHERE id = ${id}
    `);
    return id;
  }
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO early_payment_discount_terms (id, tenant_id, supplier_id, discount_pct,
                                              discount_days, min_invoice_amount, status,
                                              note, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.supplierId}, ${input.discountPct},
            ${input.discountDays}, ${input.minInvoiceAmount}, ${input.status},
            ${input.note}, ${input.actorId})
  `);
  return id;
}

export async function findDiscountTermsById(id: string): Promise<DiscountTermsRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, supplier_id AS "supplierId", discount_pct::text AS "discountPct",
           discount_days AS "discountDays", min_invoice_amount::text AS "minInvoiceAmount",
           status, approved_by AS "approvedBy", approved_at::text AS "approvedAt",
           note, created_by AS "createdBy", created_at::text AS "createdAt",
           updated_at::text AS "updatedAt"
    FROM early_payment_discount_terms WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as DiscountTermsRow[])[0];
}

export async function findDiscountTermsBySupplier(supplierId: string): Promise<DiscountTermsRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, supplier_id AS "supplierId", discount_pct::text AS "discountPct",
           discount_days AS "discountDays", min_invoice_amount::text AS "minInvoiceAmount",
           status, approved_by AS "approvedBy", approved_at::text AS "approvedAt",
           note, created_by AS "createdBy", created_at::text AS "createdAt",
           updated_at::text AS "updatedAt"
    FROM early_payment_discount_terms WHERE supplier_id = ${supplierId} LIMIT 1
  `);
  return (rows.rows as unknown as DiscountTermsRow[])[0];
}

export async function listDiscountTerms(limit: number): Promise<DiscountTermsRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, supplier_id AS "supplierId", discount_pct::text AS "discountPct",
           discount_days AS "discountDays", min_invoice_amount::text AS "minInvoiceAmount",
           status, approved_by AS "approvedBy", approved_at::text AS "approvedAt",
           note, created_by AS "createdBy", created_at::text AS "createdAt",
           updated_at::text AS "updatedAt"
    FROM early_payment_discount_terms ORDER BY created_at DESC LIMIT ${limit}
  `);
  return rows.rows as unknown as DiscountTermsRow[];
}

export async function approveDiscountTerms(id: string, approvedBy: string | null): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE early_payment_discount_terms SET approved_by = ${approvedBy}, approved_at = now(),
      status = 'ACTIVE', updated_at = now()
    WHERE id = ${id}
  `);
}

// -- CAPEX requests -----------------------------------------------------------------------

export interface CapexRequestRow {
  id: string;
  branchId: string;
  requestNo: string | null;
  title: string;
  titleAr: string | null;
  description: string | null;
  accountId: string;
  costCenterId: string | null;
  projectId: string | null;
  estimatedAmount: string;
  currencyCode: string;
  neededBy: string | null;
  status: string;
  submittedAt: string | null;
  submittedBy: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  cancelReason: string | null;
  convertedOrderId: string | null;
  budgetEvaluation: Record<string, unknown> | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const CAPEX_SELECT = sql`
  SELECT id, branch_id AS "branchId", request_no AS "requestNo", title, title_ar AS "titleAr",
         description, account_id AS "accountId", cost_center_id AS "costCenterId",
         project_id AS "projectId", estimated_amount::text AS "estimatedAmount",
         currency_code AS "currencyCode", needed_by::text AS "neededBy", status,
         submitted_at::text AS "submittedAt", submitted_by AS "submittedBy",
         approved_by AS "approvedBy", approved_at::text AS "approvedAt",
         rejection_reason AS "rejectionReason", cancel_reason AS "cancelReason",
         converted_order_id AS "convertedOrderId", budget_evaluation AS "budgetEvaluation",
         created_by AS "createdBy", created_at::text AS "createdAt",
         updated_at::text AS "updatedAt", version
  FROM capex_requests`;

export async function insertCapexRequest(input: {
  branchId: string;
  title: string;
  titleAr: string | null;
  description: string | null;
  accountId: string;
  costCenterId: string | null;
  projectId: string | null;
  estimatedAmount: string;
  currencyCode: string;
  neededBy: string | null;
  actorId: string | null;
}): Promise<string> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO capex_requests (id, tenant_id, branch_id, title, title_ar, description,
                                account_id, cost_center_id, project_id, estimated_amount,
                                currency_code, needed_by, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.branchId}, ${input.title}, ${input.titleAr},
            ${input.description}, ${input.accountId}, ${input.costCenterId}, ${input.projectId},
            ${input.estimatedAmount}, ${input.currencyCode}, ${input.neededBy}, ${input.actorId})
  `);
  return id;
}

export async function findCapexRequestById(id: string): Promise<CapexRequestRow | undefined> {
  const rows = await tenantTx().execute(sql`${CAPEX_SELECT} WHERE id = ${id} LIMIT 1`);
  return (rows.rows as unknown as CapexRequestRow[])[0];
}

export async function listCapexRequests(filter: {
  status?: string;
  branchId?: string;
  limit: number;
}): Promise<CapexRequestRow[]> {
  const conditions = [sql`1 = 1`];
  if (filter.status !== undefined && filter.status !== "") {
    conditions.push(sql`status = ${filter.status}`);
  }
  if (filter.branchId !== undefined && filter.branchId !== "") {
    conditions.push(sql`branch_id = ${filter.branchId}`);
  }
  const rows = await tenantTx().execute(sql`
    ${CAPEX_SELECT} WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY created_at DESC LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as CapexRequestRow[];
}

export async function updateCapexRequest(
  id: string,
  patch: {
    title?: string;
    titleAr?: string | null;
    description?: string | null;
    accountId?: string;
    costCenterId?: string | null;
    projectId?: string | null;
    estimatedAmount?: string;
    neededBy?: string | null;
    status?: string;
    requestNo?: string;
    submittedAt?: string;
    submittedBy?: string | null;
    approvedBy?: string | null;
    approvedAt?: string;
    rejectionReason?: string;
    cancelReason?: string;
    convertedOrderId?: string;
    budgetEvaluation?: Record<string, unknown> | null;
  },
): Promise<void> {
  const sets = [sql`updated_at = now()`];
  if (patch.title !== undefined) sets.push(sql`title = ${patch.title}`);
  if (patch.titleAr !== undefined) sets.push(sql`title_ar = ${patch.titleAr}`);
  if (patch.description !== undefined) sets.push(sql`description = ${patch.description}`);
  if (patch.accountId !== undefined) sets.push(sql`account_id = ${patch.accountId}`);
  if (patch.costCenterId !== undefined) sets.push(sql`cost_center_id = ${patch.costCenterId}`);
  if (patch.projectId !== undefined) sets.push(sql`project_id = ${patch.projectId}`);
  if (patch.estimatedAmount !== undefined) sets.push(sql`estimated_amount = ${patch.estimatedAmount}`);
  if (patch.neededBy !== undefined) sets.push(sql`needed_by = ${patch.neededBy}`);
  if (patch.status !== undefined) sets.push(sql`status = ${patch.status}`);
  if (patch.requestNo !== undefined) sets.push(sql`request_no = ${patch.requestNo}`);
  if (patch.submittedAt !== undefined) sets.push(sql`submitted_at = ${patch.submittedAt}`);
  if (patch.submittedBy !== undefined) sets.push(sql`submitted_by = ${patch.submittedBy}`);
  if (patch.approvedBy !== undefined) sets.push(sql`approved_by = ${patch.approvedBy}`);
  if (patch.approvedAt !== undefined) sets.push(sql`approved_at = ${patch.approvedAt}`);
  if (patch.rejectionReason !== undefined) sets.push(sql`rejection_reason = ${patch.rejectionReason}`);
  if (patch.cancelReason !== undefined) sets.push(sql`cancel_reason = ${patch.cancelReason}`);
  if (patch.convertedOrderId !== undefined) sets.push(sql`converted_order_id = ${patch.convertedOrderId}`);
  if (patch.budgetEvaluation !== undefined) {
    sets.push(sql`budget_evaluation = ${JSON.stringify(patch.budgetEvaluation)}::jsonb`);
  }
  await tenantTx().execute(sql`
    UPDATE capex_requests SET ${sql.join(sets, sql`, `)} WHERE id = ${id}
  `);
}

// -- tender intakes -------------------------------------------------------------------------

export interface TenderIntakeRow {
  id: string;
  intakeNo: string;
  title: string;
  titleAr: string | null;
  announcingAuthority: string;
  tenderRefNo: string | null;
  publishedAt: string | null;
  submissionDeadline: string | null;
  estimatedValue: string | null;
  currencyCode: string | null;
  ourDecision: string;
  decidedAt: string | null;
  decisionNote: string | null;
  govRegistrationNo: string | null;
  govRegistrationExpiry: string | null;
  classificationCode: string | null;
  sourceUrl: string | null;
  status: string;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const TENDER_SELECT = sql`
  SELECT id, intake_no AS "intakeNo", title, title_ar AS "titleAr",
         announcing_authority AS "announcingAuthority", tender_ref_no AS "tenderRefNo",
         published_at::text AS "publishedAt",
         submission_deadline::text AS "submissionDeadline",
         estimated_value::text AS "estimatedValue", currency_code AS "currencyCode",
         our_decision AS "ourDecision", decided_at::text AS "decidedAt",
         decision_note AS "decisionNote", gov_registration_no AS "govRegistrationNo",
         gov_registration_expiry::text AS "govRegistrationExpiry",
         classification_code AS "classificationCode", source_url AS "sourceUrl",
         status, note, note_ar AS "noteAr", created_by AS "createdBy",
         created_at::text AS "createdAt", updated_at::text AS "updatedAt", version
  FROM tender_intakes`;

export async function insertTenderIntake(input: {
  intakeNo: string;
  title: string;
  titleAr: string | null;
  announcingAuthority: string;
  tenderRefNo: string | null;
  publishedAt: string | null;
  submissionDeadline: string | null;
  estimatedValue: string | null;
  currencyCode: string | null;
  govRegistrationNo: string | null;
  govRegistrationExpiry: string | null;
  classificationCode: string | null;
  sourceUrl: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<string> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO tender_intakes (id, tenant_id, intake_no, title, title_ar,
                                announcing_authority, tender_ref_no, published_at,
                                submission_deadline, estimated_value, currency_code,
                                gov_registration_no, gov_registration_expiry,
                                classification_code, source_url, note, note_ar, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.intakeNo}, ${input.title}, ${input.titleAr},
            ${input.announcingAuthority}, ${input.tenderRefNo}, ${input.publishedAt},
            ${input.submissionDeadline}, ${input.estimatedValue}, ${input.currencyCode},
            ${input.govRegistrationNo}, ${input.govRegistrationExpiry},
            ${input.classificationCode}, ${input.sourceUrl}, ${input.note}, ${input.noteAr},
            ${input.actorId})
  `);
  return id;
}

export async function findTenderIntakeById(id: string): Promise<TenderIntakeRow | undefined> {
  const rows = await tenantTx().execute(sql`${TENDER_SELECT} WHERE id = ${id} LIMIT 1`);
  return (rows.rows as unknown as TenderIntakeRow[])[0];
}

export async function listTenderIntakes(filter: {
  status?: string;
  ourDecision?: string;
  limit: number;
}): Promise<TenderIntakeRow[]> {
  const conditions = [sql`1 = 1`];
  if (filter.status !== undefined && filter.status !== "") {
    conditions.push(sql`status = ${filter.status}`);
  }
  if (filter.ourDecision !== undefined && filter.ourDecision !== "") {
    conditions.push(sql`our_decision = ${filter.ourDecision}`);
  }
  const rows = await tenantTx().execute(sql`
    ${TENDER_SELECT} WHERE ${sql.join(conditions, sql` AND `)}
    ORDER BY created_at DESC LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as TenderIntakeRow[];
}

export async function updateTenderIntake(
  id: string,
  patch: {
    title?: string;
    titleAr?: string | null;
    announcingAuthority?: string;
    tenderRefNo?: string | null;
    publishedAt?: string | null;
    submissionDeadline?: string | null;
    estimatedValue?: string | null;
    currencyCode?: string | null;
    ourDecision?: string;
    decidedAt?: string;
    decisionNote?: string | null;
    govRegistrationNo?: string | null;
    govRegistrationExpiry?: string | null;
    classificationCode?: string | null;
    sourceUrl?: string | null;
    status?: string;
    note?: string | null;
    noteAr?: string | null;
  },
): Promise<void> {
  const sets = [sql`updated_at = now()`];
  if (patch.title !== undefined) sets.push(sql`title = ${patch.title}`);
  if (patch.titleAr !== undefined) sets.push(sql`title_ar = ${patch.titleAr}`);
  if (patch.announcingAuthority !== undefined) sets.push(sql`announcing_authority = ${patch.announcingAuthority}`);
  if (patch.tenderRefNo !== undefined) sets.push(sql`tender_ref_no = ${patch.tenderRefNo}`);
  if (patch.publishedAt !== undefined) sets.push(sql`published_at = ${patch.publishedAt}`);
  if (patch.submissionDeadline !== undefined) sets.push(sql`submission_deadline = ${patch.submissionDeadline}`);
  if (patch.estimatedValue !== undefined) sets.push(sql`estimated_value = ${patch.estimatedValue}`);
  if (patch.currencyCode !== undefined) sets.push(sql`currency_code = ${patch.currencyCode}`);
  if (patch.ourDecision !== undefined) sets.push(sql`our_decision = ${patch.ourDecision}`);
  if (patch.decidedAt !== undefined) sets.push(sql`decided_at = ${patch.decidedAt}`);
  if (patch.decisionNote !== undefined) sets.push(sql`decision_note = ${patch.decisionNote}`);
  if (patch.govRegistrationNo !== undefined) sets.push(sql`gov_registration_no = ${patch.govRegistrationNo}`);
  if (patch.govRegistrationExpiry !== undefined) sets.push(sql`gov_registration_expiry = ${patch.govRegistrationExpiry}`);
  if (patch.classificationCode !== undefined) sets.push(sql`classification_code = ${patch.classificationCode}`);
  if (patch.sourceUrl !== undefined) sets.push(sql`source_url = ${patch.sourceUrl}`);
  if (patch.status !== undefined) sets.push(sql`status = ${patch.status}`);
  if (patch.note !== undefined) sets.push(sql`note = ${patch.note}`);
  if (patch.noteAr !== undefined) sets.push(sql`note_ar = ${patch.noteAr}`);
  await tenantTx().execute(sql`
    UPDATE tender_intakes SET ${sql.join(sets, sql`, `)} WHERE id = ${id}
  `);
}

// -- scorecard aggregation reads (the live-document window) --------------------------------

export interface ScorecardWindowSample {
  grnCount: number;
  onTimeCount: number;
  invoiceCount: number;
  debitNoteCount: number;
  priceVariancePct: string | null;
}

/**
 * The rolling-window sample for one supplier, computed from LIVE
 * documents: GRNs received against the supplier's POs (on-time = received
 * on/before the PO's expected date), POSTED supplier invoices vs their
 * PO line prices (the weighted price variance), and the debit notes
 * (quality drag). One round-trip per leg; deterministic; no writes.
 */
export async function readScorecardWindow(supplierId: string, windowStart: string, windowEnd: string): Promise<ScorecardWindowSample> {
  const tx = tenantTx();
  const grnRows = await tx.execute(sql`
    SELECT count(*)::int AS n,
           count(*) FILTER (
             WHERE g.receipt_date <= COALESCE(po.expected_date, g.receipt_date))::int AS "onTime"
    FROM goods_receipts g
    JOIN purchase_orders po ON po.id = g.po_id AND po.tenant_id = g.tenant_id
    WHERE po.supplier_id = ${supplierId}
      AND g.status = 'POSTED'
      AND g.receipt_date BETWEEN ${windowStart} AND ${windowEnd}
  `);
  const grn = (grnRows.rows as unknown as { n: number; onTime: number }[])[0]!;

  const invoiceRows = await tx.execute(sql`
    SELECT count(*)::int AS n
    FROM supplier_invoices i
    WHERE i.supplier_id = ${supplierId} AND i.status = 'POSTED'
      AND i.invoice_date BETWEEN ${windowStart} AND ${windowEnd}
  `);
  const invoice = (invoiceRows.rows as unknown as { n: number }[])[0]!;

  const debitRows = await tx.execute(sql`
    SELECT count(*)::int AS n
    FROM debit_notes d
    WHERE d.supplier_id = ${supplierId} AND d.status = 'POSTED'
      AND d.note_date BETWEEN ${windowStart} AND ${windowEnd}
  `);
  const debit = (debitRows.rows as unknown as { n: number }[])[0]!;

  // Price variance: POSTED invoice lines vs their PO line unit prices
  // (qty-weighted mean of |invoice − PO| / PO, %) over the window.
  const varianceRows = await tx.execute(sql`
    SELECT CASE WHEN SUM(il.qty) > 0 THEN
        (SUM(il.qty * ABS(il.unit_price - pl.unit_price)) / SUM(il.qty * pl.unit_price) * 100)
      ELSE NULL END::text AS "priceVariancePct"
    FROM supplier_invoice_lines il
    JOIN supplier_invoices i ON i.id = il.invoice_id AND i.tenant_id = il.tenant_id
    JOIN goods_receipt_lines gl ON gl.id = il.grn_line_id AND gl.tenant_id = il.tenant_id
    JOIN purchase_order_lines pl ON pl.id = gl.po_line_id AND pl.tenant_id = gl.tenant_id
    WHERE i.supplier_id = ${supplierId} AND i.status = 'POSTED'
      AND i.invoice_date BETWEEN ${windowStart} AND ${windowEnd}
      AND il.grn_line_id IS NOT NULL AND gl.po_line_id IS NOT NULL
      AND pl.unit_price > 0
  `);
  const variance = (varianceRows.rows as unknown as { priceVariancePct: string | null }[])[0]!;

  return {
    grnCount: grn.n,
    onTimeCount: grn.onTime,
    invoiceCount: invoice.n,
    debitNoteCount: debit.n,
    priceVariancePct: variance.priceVariancePct,
  };
}

// -- G-34 capture reads (treasury allocation + open-item surface) ---------------------------

export interface DiscountCaptureProbe {
  paymentStatus: string | null;
  paymentDate: string | null;
  allocatedAmount: string | null;
  invoicePostedJournalId: string | null;
}

/**
 * The G-34 capture probe: the treasury payment's status/value_date, the
 * allocated amount ONTO this invoice's AP open item, and the invoice's
 * posted journal linkage. Cross-table read (treasury_allocations +
 * partner_subledger_entries + supplier_invoices) — the same surface the
 * AP open-items query reads; zero writes.
 */
export async function readDiscountCaptureProbe(input: {
  invoiceId: string;
  paymentId: string;
}): Promise<DiscountCaptureProbe> {
  const rows = await tenantTx().execute(sql`
    SELECT p.status AS "paymentStatus", p.value_date::text AS "paymentDate",
           a.amount::text AS "allocatedAmount", i.posted_journal_id AS "invoicePostedJournalId"
    FROM supplier_invoices i
    LEFT JOIN payments p ON p.id = ${input.paymentId}
    LEFT JOIN partner_subledger_entries se ON se.journal_entry_id = i.posted_journal_id
      AND se.direction = 'CREDIT'
    LEFT JOIN treasury_allocations a ON a.open_item_id = se.id AND a.payment_id = p.id
    WHERE i.id = ${input.invoiceId}
    LIMIT 1
  `);
  return (rows.rows as unknown as DiscountCaptureProbe[])[0] ?? {
    paymentStatus: null,
    paymentDate: null,
    allocatedAmount: null,
    invoicePostedJournalId: null,
  };
}
