import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import { compareExact, subExact } from "../../accounting/application/decimal-strings";

/**
 * Treasury store (PHASE-008): the ONLY writer of cash_movements (INV-019's
 * append-only substrate — reached exclusively through the treasury
 * application services, which write it inside the same ambient transaction
 * as the posting-engine journal). Document rows (receipts/payments/
 * expenses/transfers/shifts/statements) follow the stores-before pattern:
 * every statement runs in the caller's tenant UoW so a failure anywhere
 * rolls the whole business operation back (§6: one journal + one movement
 * row + one source document, atomically).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("treasury access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- cash accounts -----------------------------------------------------------------

export interface CashAccountRow {
  id: string;
  name: string;
  nameAr: string | null;
  type: "CASH" | "BANK" | "PETTY";
  accountId: string;
  accountCode: string;
  branchId: string | null;
  currencyCode: string;
  status: "ACTIVE" | "CLOSED";
  openedAt: string;
  closedAt: string | null;
  closeReason: string | null;
  balance: string;
  movementCount: number;
}

const ACCOUNT_COLUMNS = sql`c.id, c.name, c.name_ar AS "nameAr", c.type, c.account_id AS "accountId",
  a.code AS "accountCode", c.branch_id AS "branchId", c.currency_code AS "currencyCode",
  c.status, c.opened_at AS "openedAt", c.closed_at AS "closedAt", c.close_reason AS "closeReason",
  COALESCE(m.balance, '0') AS balance, COALESCE(m.cnt, 0) AS "movementCount"`;

const ACCOUNT_FROM = sql`cash_accounts c
  JOIN accounts a ON a.id = c.account_id AND a.tenant_id = c.tenant_id
  LEFT JOIN (
    SELECT cash_account_id,
           SUM(CASE WHEN direction = 'IN' THEN base_amount ELSE -base_amount END) AS balance,
           COUNT(*) AS cnt
    FROM cash_movements GROUP BY cash_account_id
  ) m ON m.cash_account_id = c.id`;

export async function listCashAccounts(filter: {
  type?: string;
  status?: string;
}): Promise<CashAccountRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ACCOUNT_COLUMNS} FROM ${ACCOUNT_FROM}
    WHERE (${filter.type ?? null}::text IS NULL OR c.type = ${filter.type ?? null})
      AND (${filter.status ?? null}::text IS NULL OR c.status = ${filter.status ?? null})
    ORDER BY c.type, c.name
  `);
  return rows.rows as unknown as CashAccountRow[];
}

export async function findCashAccountById(id: string): Promise<CashAccountRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ACCOUNT_COLUMNS} FROM ${ACCOUNT_FROM} WHERE c.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as CashAccountRow[])[0];
}

export async function findCashAccountByGLAccountId(accountId: string): Promise<CashAccountRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${ACCOUNT_COLUMNS} FROM ${ACCOUNT_FROM} WHERE c.account_id = ${accountId} LIMIT 1
  `);
  return (rows.rows as unknown as CashAccountRow[])[0];
}

export async function insertCashAccount(input: {
  name: string;
  nameAr: string | null;
  type: "CASH" | "BANK" | "PETTY";
  accountId: string;
  branchId: string | null;
  currencyCode: string;
  createdBy: string | null;
}): Promise<CashAccountRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO cash_accounts (id, tenant_id, name, name_ar, type, account_id, branch_id, currency_code, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.name}, ${input.nameAr}, ${input.type},
            ${input.accountId}, ${input.branchId}, ${input.currencyCode}, ${input.createdBy})
  `);
  const row = await findCashAccountById(id);
  if (row === undefined) throw new Error("cash account insert failed");
  return row;
}

export async function closeCashAccount(input: {
  id: string;
  closedBy: string | null;
  reason: string;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE cash_accounts
    SET status = 'CLOSED', closed_at = now(), closed_by = ${input.closedBy},
        close_reason = ${input.reason}, updated_at = now(), version = version + 1
    WHERE id = ${input.id}
  `);
}

/** INV-019 read side: Σ signed base movements per account (as-of optional). */
export async function movementBalance(cashAccountId: string, asOf?: string): Promise<string> {
  const rows = await tenantTx().execute(sql`
    SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN base_amount ELSE -base_amount END), 0) AS balance
    FROM cash_movements
    WHERE cash_account_id = ${cashAccountId}
      AND (${asOf ?? null}::date IS NULL OR value_date <= ${asOf ?? null})
  `);
  const row = (rows.rows as unknown as { balance: string }[])[0]!;
  return row.balance;
}

/**
 * INV-019 GL side: the posted base balance of a GL account as-of a date
 * (reads the ledger through the standard tenant scope — RLS applies).
 */
export async function glBaseBalanceAsOf(accountId: string, asOf?: string): Promise<string> {
  const rows = await tenantTx().execute(sql`
    SELECT COALESCE(SUM(CASE WHEN l.direction = 'DEBIT' THEN l.base_amount ELSE -l.base_amount END), 0) AS balance
    FROM journal_lines l
    JOIN journal_entries e ON e.id = l.journal_entry_id
    WHERE l.account_id = ${accountId}
      AND (${asOf ?? null}::date IS NULL OR e.entry_date <= ${asOf ?? null})
  `);
  const row = (rows.rows as unknown as { balance: string }[])[0]!;
  return row.balance;
}

// -- cash movements (append-only; INV-019) --------------------------------------------

export interface CashMovementRow {
  id: string;
  cashAccountId: string;
  direction: "IN" | "OUT";
  amount: string;
  currencyCode: string;
  exchangeRate: string;
  baseAmount: string;
  sourceType: string;
  sourceId: string;
  valueDate: string;
  memo: string | null;
  memoAr: string | null;
}

const MOVEMENT_COLUMNS = sql`id, cash_account_id AS "cashAccountId", direction, amount,
  currency_code AS "currencyCode", exchange_rate AS "exchangeRate", base_amount AS "baseAmount",
  source_type AS "sourceType", source_id AS "sourceId", value_date AS "valueDate", memo, memo_ar AS "memoAr"`;

export async function insertCashMovement(input: {
  cashAccountId: string;
  direction: "IN" | "OUT";
  amount: string;
  currencyCode: string;
  exchangeRate: string;
  baseAmount: string;
  sourceType: string;
  sourceId: string;
  valueDate: string;
  memo?: string | null;
  memoAr?: string | null;
}): Promise<CashMovementRow> {
  const rows = await tenantTx().execute(sql`
    INSERT INTO cash_movements (id, tenant_id, cash_account_id, direction, amount, currency_code,
                                exchange_rate, base_amount, source_type, source_id, value_date, memo, memo_ar)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.cashAccountId}, ${input.direction},
            ${input.amount}, ${input.currencyCode}, ${input.exchangeRate}, ${input.baseAmount},
            ${input.sourceType}, ${input.sourceId}, ${input.valueDate}, ${input.memo ?? null}, ${input.memoAr ?? null})
    RETURNING ${MOVEMENT_COLUMNS}
  `);
  return (rows.rows as unknown as CashMovementRow[])[0]!;
}

export async function findMovementById(id: string): Promise<CashMovementRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${MOVEMENT_COLUMNS} FROM cash_movements WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as CashMovementRow[])[0];
}

export interface MovementFilter {
  cashAccountId?: string;
  fromDate?: string;
  toDate?: string;
  unmatchedOnly?: boolean;
  withinReconciledPeriod?: boolean;
  limit: number;
}

export async function listMovements(filter: MovementFilter): Promise<CashMovementRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${MOVEMENT_COLUMNS} FROM cash_movements m
    WHERE (${filter.cashAccountId ?? null}::uuid IS NULL OR m.cash_account_id = ${filter.cashAccountId ?? null})
      AND (${filter.fromDate ?? null}::date IS NULL OR m.value_date >= ${filter.fromDate ?? null})
      AND (${filter.toDate ?? null}::date IS NULL OR m.value_date <= ${filter.toDate ?? null})
      AND (${filter.unmatchedOnly ?? null}::boolean IS NULL
           OR ${filter.unmatchedOnly ?? null} = (NOT EXISTS (
             SELECT 1 FROM bank_statement_lines l
             WHERE l.matched_movement_id = m.id AND l.tenant_id = m.tenant_id)))
    ORDER BY m.value_date DESC, m.id DESC
    LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as CashMovementRow[];
}

/** Candidate movements for statement auto-match (same account, amount equal, date window, unmatched). */
export async function findMatchCandidates(input: {
  cashAccountId: string;
  amount: string;
  fromDate: string;
  toDate: string;
  reference?: string;
  limit: number;
}): Promise<CashMovementRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${MOVEMENT_COLUMNS} FROM cash_movements m
    WHERE m.cash_account_id = ${input.cashAccountId}
      AND m.amount = ${input.amount}
      AND m.value_date BETWEEN ${input.fromDate} AND ${input.toDate}
      AND NOT EXISTS (SELECT 1 FROM bank_statement_lines l
                      WHERE l.matched_movement_id = m.id AND l.tenant_id = m.tenant_id)
    ORDER BY
      CASE WHEN ${input.reference ?? null}::text IS NOT NULL
            AND m.memo ILIKE '%' || ${input.reference ?? null} || '%' THEN 0 ELSE 1 END,
      m.value_date, m.id
    LIMIT ${input.limit}
  `);
  return rows.rows as unknown as CashMovementRow[];
}

// -- receipts / payments ------------------------------------------------------------

export interface TreasuryDocRow {
  id: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "POSTED" | "CANCELLED";
  docNo: string | null;
  createdBy: string | null;
  cashAccountId: string;
  partnerId: string;
  method: string;
  counterpartyName: string | null;
  currencyCode: string;
  amount: string;
  exchangeRate: string | null;
  valueDate: string;
  reference: string | null;
  description: string | null;
  descriptionAr: string | null;
  allocatedAmount: string;
  fxGainLoss: string;
  postedJournalId: string | null;
  createdAt: string;
}

const RECEIPT_COLUMNS = sql`r.id, r.status, r.receipt_no AS "docNo", r.created_by AS "createdBy", r.cash_account_id AS "cashAccountId",
  r.partner_id AS "partnerId", r.method, r.payer_name AS "counterpartyName", r.currency_code AS "currencyCode",
  r.amount, r.exchange_rate AS "exchangeRate", r.value_date AS "valueDate", r.reference,
  r.description, r.description_ar AS "descriptionAr", r.allocated_amount AS "allocatedAmount",
  r.fx_gain_loss AS "fxGainLoss", r.posted_journal_id AS "postedJournalId", r.created_at AS "createdAt"`;

const PAYMENT_COLUMNS = sql`p.id, p.status, p.payment_no AS "docNo", p.created_by AS "createdBy", p.cash_account_id AS "cashAccountId",
  p.partner_id AS "partnerId", p.method, p.payee_name AS "counterpartyName", p.currency_code AS "currencyCode",
  p.amount, p.exchange_rate AS "exchangeRate", p.value_date AS "valueDate", p.reference,
  p.description, p.description_ar AS "descriptionAr", p.allocated_amount AS "allocatedAmount",
  p.fx_gain_loss AS "fxGainLoss", p.posted_journal_id AS "postedJournalId", p.created_at AS "createdAt"`;

export async function insertReceipt(input: {
  cashAccountId: string;
  partnerId: string;
  method: string;
  payerName: string | null;
  currencyCode: string;
  amount: string;
  exchangeRate: string | null;
  valueDate: string;
  reference: string | null;
  description: string | null;
  descriptionAr: string | null;
  createdBy: string | null;
}): Promise<TreasuryDocRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO receipts (id, tenant_id, cash_account_id, partner_id, method, payer_name, currency_code,
                          amount, exchange_rate, value_date, reference, description, description_ar, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.cashAccountId}, ${input.partnerId}, ${input.method},
            ${input.payerName}, ${input.currencyCode}, ${input.amount}, ${input.exchangeRate}, ${input.valueDate},
            ${input.reference}, ${input.description}, ${input.descriptionAr}, ${input.createdBy})
  `);
  return findReceiptById(id) as Promise<TreasuryDocRow>;
}

export async function insertPayment(input: {
  cashAccountId: string;
  partnerId: string;
  method: string;
  payeeName: string | null;
  currencyCode: string;
  amount: string;
  exchangeRate: string | null;
  valueDate: string;
  reference: string | null;
  description: string | null;
  descriptionAr: string | null;
  createdBy: string | null;
}): Promise<TreasuryDocRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO payments (id, tenant_id, cash_account_id, partner_id, method, payee_name, currency_code,
                          amount, exchange_rate, value_date, reference, description, description_ar, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.cashAccountId}, ${input.partnerId}, ${input.method},
            ${input.payeeName}, ${input.currencyCode}, ${input.amount}, ${input.exchangeRate}, ${input.valueDate},
            ${input.reference}, ${input.description}, ${input.descriptionAr}, ${input.createdBy})
  `);
  return findPaymentById(id) as Promise<TreasuryDocRow>;
}

export async function findReceiptById(id: string): Promise<TreasuryDocRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${RECEIPT_COLUMNS} FROM receipts r WHERE r.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as TreasuryDocRow[])[0];
}

export async function findPaymentById(id: string): Promise<TreasuryDocRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${PAYMENT_COLUMNS} FROM payments p WHERE p.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as TreasuryDocRow[])[0];
}

export async function listReceipts(filter: {
  status?: string;
  partnerId?: string;
  fromDate?: string;
  toDate?: string;
  limit: number;
}): Promise<TreasuryDocRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${RECEIPT_COLUMNS} FROM receipts r
    WHERE (${filter.status ?? null}::text IS NULL OR r.status = ${filter.status ?? null})
      AND (${filter.partnerId ?? null}::uuid IS NULL OR r.partner_id = ${filter.partnerId ?? null})
      AND (${filter.fromDate ?? null}::date IS NULL OR r.value_date >= ${filter.fromDate ?? null})
      AND (${filter.toDate ?? null}::date IS NULL OR r.value_date <= ${filter.toDate ?? null})
    ORDER BY r.value_date DESC, r.id DESC
    LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as TreasuryDocRow[];
}

export async function listPayments(filter: {
  status?: string;
  partnerId?: string;
  fromDate?: string;
  toDate?: string;
  limit: number;
}): Promise<TreasuryDocRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${PAYMENT_COLUMNS} FROM payments p
    WHERE (${filter.status ?? null}::text IS NULL OR p.status = ${filter.status ?? null})
      AND (${filter.partnerId ?? null}::uuid IS NULL OR p.partner_id = ${filter.partnerId ?? null})
      AND (${filter.fromDate ?? null}::date IS NULL OR p.value_date >= ${filter.fromDate ?? null})
      AND (${filter.toDate ?? null}::date IS NULL OR p.value_date <= ${filter.toDate ?? null})
    ORDER BY p.value_date DESC, p.id DESC
    LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as TreasuryDocRow[];
}

export async function updateReceiptStatus(input: {
  id: string;
  status: string;
  docNo?: string;
  postedJournalId?: string;
  allocatedAmount?: string;
  fxGainLoss?: string;
  actorId: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE receipts SET
      status = ${input.status},
      receipt_no = COALESCE(${input.docNo ?? null}, receipt_no),
      posted_journal_id = COALESCE(${input.postedJournalId ?? null}, posted_journal_id),
      allocated_amount = COALESCE(${input.allocatedAmount ?? null}, allocated_amount),
      fx_gain_loss = COALESCE(${input.fxGainLoss ?? null}, fx_gain_loss),
      posted_at = CASE WHEN ${input.status} = 'POSTED' THEN now() ELSE posted_at END,
      posted_by = CASE WHEN ${input.status} = 'POSTED' THEN ${input.actorId} ELSE posted_by END,
      submitted_at = CASE WHEN ${input.status} = 'PENDING_APPROVAL' THEN now() ELSE submitted_at END,
      submitted_by = CASE WHEN ${input.status} = 'PENDING_APPROVAL' THEN ${input.actorId} ELSE submitted_by END,
      approved_at = CASE WHEN ${input.status} = 'APPROVED' THEN now() ELSE approved_at END,
      approved_by = CASE WHEN ${input.status} = 'APPROVED' THEN ${input.actorId} ELSE approved_by END,
      updated_at = now(), version = version + 1
    WHERE id = ${input.id}
  `);
}

export async function updatePaymentStatus(input: {
  id: string;
  status: string;
  docNo?: string;
  postedJournalId?: string;
  allocatedAmount?: string;
  fxGainLoss?: string;
  actorId: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE payments SET
      status = ${input.status},
      payment_no = COALESCE(${input.docNo ?? null}, payment_no),
      posted_journal_id = COALESCE(${input.postedJournalId ?? null}, posted_journal_id),
      allocated_amount = COALESCE(${input.allocatedAmount ?? null}, allocated_amount),
      fx_gain_loss = COALESCE(${input.fxGainLoss ?? null}, fx_gain_loss),
      posted_at = CASE WHEN ${input.status} = 'POSTED' THEN now() ELSE posted_at END,
      posted_by = CASE WHEN ${input.status} = 'POSTED' THEN ${input.actorId} ELSE posted_by END,
      submitted_at = CASE WHEN ${input.status} = 'PENDING_APPROVAL' THEN now() ELSE submitted_at END,
      submitted_by = CASE WHEN ${input.status} = 'PENDING_APPROVAL' THEN ${input.actorId} ELSE submitted_by END,
      approved_at = CASE WHEN ${input.status} = 'APPROVED' THEN now() ELSE approved_at END,
      approved_by = CASE WHEN ${input.status} = 'APPROVED' THEN ${input.actorId} ELSE approved_by END,
      updated_at = now(), version = version + 1
    WHERE id = ${input.id}
  `);
}

export async function cancelReceipt(input: { id: string; actorId: string | null; reason: string }): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE receipts SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = ${input.actorId},
        cancel_reason = ${input.reason}, updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED')
  `);
}

export async function cancelPayment(input: { id: string; actorId: string | null; reason: string }): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE payments SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = ${input.actorId},
        cancel_reason = ${input.reason}, updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED')
  `);
}

export async function cancelExpense(input: { id: string; actorId: string | null; reason: string }): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE expenses SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = ${input.actorId},
        cancel_reason = ${input.reason}, updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED')
  `);
}

export async function cancelTransfer(input: { id: string; actorId: string | null; reason: string }): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE cash_transfers SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = ${input.actorId},
        cancel_reason = ${input.reason}, updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED')
  `);
}

// -- allocations (INV-016) -----------------------------------------------------------

export interface AllocationRow {
  id: string;
  receiptId: string | null;
  paymentId: string | null;
  openItemId: string;
  amount: string;
}

export async function listAllocationsForDoc(docType: "receipt" | "payment", docId: string): Promise<AllocationRow[]> {
  const column = docType === "receipt" ? sql`receipt_id` : sql`payment_id`;
  const rows = await tenantTx().execute(sql`
    SELECT id, receipt_id AS "receiptId", payment_id AS "paymentId",
           open_item_id AS "openItemId", amount
    FROM treasury_allocations
    WHERE ${column} = ${docId}
    ORDER BY created_at, id
  `);
  return rows.rows as unknown as AllocationRow[];
}

export async function replaceDraftAllocations(input: {
  docType: "receipt" | "payment";
  docId: string;
  allocations: readonly { openItemId: string; amount: string }[];
  actorId: string | null;
}): Promise<void> {
  const tx = tenantTx();
  const column = input.docType === "receipt" ? sql`receipt_id` : sql`payment_id`;
  await tx.execute(sql`DELETE FROM treasury_allocations WHERE ${column} = ${input.docId}`);
  for (const allocation of input.allocations) {
    await tx.execute(sql`
      INSERT INTO treasury_allocations (id, tenant_id, receipt_id, payment_id, open_item_id, amount, created_by)
      VALUES (${generateUuidV7()}, erp.current_tenant_id(),
              ${input.docType === "receipt" ? input.docId : null},
              ${input.docType === "payment" ? input.docId : null},
              ${allocation.openItemId}, ${allocation.amount}, ${input.actorId})
    `);
  }
}

/**
 * Effective (posted) allocations per open item: Σ amounts from allocation
 * rows whose owning document is POSTED. Serializes concurrent allocators
 * on a transaction-scoped advisory lock keyed by the open item (CC-02) —
 * partner_subledger_entries is append-only with no UPDATE grant (INV-009),
 * so SELECT … FOR UPDATE is impossible by design; the advisory lock plus
 * the post-lock recompute gives the identical never-exceed guarantee.
 */
export async function lockOpenItemAndSumPostedAllocations(openItemId: string): Promise<string> {
  const tx = tenantTx();
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${openItemId}::text, 0))
  `);
  const rows = await tx.execute(sql`
    SELECT COALESCE(SUM(a.amount), 0) AS total FROM treasury_allocations a
    WHERE a.open_item_id = ${openItemId}
      AND ((a.receipt_id IS NOT NULL AND EXISTS (SELECT 1 FROM receipts r
             WHERE r.id = a.receipt_id AND r.status = 'POSTED'))
        OR (a.payment_id IS NOT NULL AND EXISTS (SELECT 1 FROM payments p
             WHERE p.id = a.payment_id AND p.status = 'POSTED'))
        -- PHASE-027 (0038): note-owned allocations are effective by
        -- PRESENCE — rows only exist while the note create posted
        -- atomically with its G-24/G-27 entry, and dishonor/return
        -- repoints them (never leaves a stale effective row).
        OR (a.note_id IS NOT NULL))
  `);
  const row = (rows.rows as unknown as { total: string }[])[0]!;
  return row.total;
}

export interface OpenItemRow {
  id: string;
  partnerId: string;
  entryDate: string;
  direction: "DEBIT" | "CREDIT";
  amount: string;
  baseAmount: string;
  currencyCode: string;
  exchangeRate: string;
  controlAccountId: string;
  sourceType: string;
  sourceId: string | null;
  memo: string | null;
  settledAmount: string;
  outstanding: string;
}

/**
 * Partner open items (receivables/payables): the PHASE-007 subledger rows
 * minus effective (POSTED) settlement allocations — outstanding > 0 only,
 * oldest first (the FIFO suggestion base; RECEIVABLES_AND_PAYABLES §3).
 * `side` filters AR (control = AR mapping) vs AP.
 */
export async function findOpenItemById(id: string): Promise<OpenItemRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT s.id, s.partner_id AS "partnerId", s.entry_date AS "entryDate", s.direction, s.amount,
           s.base_amount AS "baseAmount", s.currency_code AS "currencyCode",
           COALESCE(j.exchange_rate, 1) AS "exchangeRate", l.account_id AS "controlAccountId",
           s.source_type AS "sourceType", s.source_id AS "sourceId", s.memo,
           COALESCE(settled.total, 0)::numeric(19,4)::text AS "settledAmount",
           (s.amount - COALESCE(settled.total, 0))::numeric(19,4)::text AS outstanding
    FROM partner_subledger_entries s
    JOIN journal_lines l ON l.id = s.journal_line_id
    JOIN journal_entries j ON j.id = s.journal_entry_id
    LEFT JOIN (
      SELECT a.open_item_id, SUM(a.amount) AS total FROM treasury_allocations a
      WHERE (a.receipt_id IS NOT NULL AND EXISTS (SELECT 1 FROM receipts r
               WHERE r.id = a.receipt_id AND r.status = 'POSTED'))
         OR (a.payment_id IS NOT NULL AND EXISTS (SELECT 1 FROM payments p
               WHERE p.id = a.payment_id AND p.status = 'POSTED'))
         -- PHASE-027 (0038): note-owned allocations are effective by
         -- presence (see lockOpenItemAndSumPostedAllocations).
         OR (a.note_id IS NOT NULL)
      GROUP BY a.open_item_id
    ) settled ON settled.open_item_id = s.id
    WHERE s.id = ${id}
    LIMIT 1
  `);
  return (rows.rows as unknown as OpenItemRow[])[0];
}
export async function listOpenItems(filter: {
  partnerId?: string;
  side: "AR" | "AP";
  openOnly?: boolean;
  limit: number;
}): Promise<OpenItemRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT s.id, s.partner_id AS "partnerId", s.entry_date AS "entryDate", s.direction, s.amount,
           s.base_amount AS "baseAmount", s.currency_code AS "currencyCode",
           COALESCE(j.exchange_rate, 1) AS "exchangeRate", l.account_id AS "controlAccountId",
           s.source_type AS "sourceType", s.source_id AS "sourceId", s.memo,
           COALESCE(settled.total, 0)::numeric(19,4)::text AS "settledAmount",
           (s.amount - COALESCE(settled.total, 0))::numeric(19,4)::text AS outstanding
    FROM partner_subledger_entries s
    JOIN journal_lines l ON l.id = s.journal_line_id
    JOIN journal_entries j ON j.id = s.journal_entry_id
    LEFT JOIN (
      SELECT a.open_item_id, SUM(a.amount) AS total FROM treasury_allocations a
      WHERE (a.receipt_id IS NOT NULL AND EXISTS (SELECT 1 FROM receipts r
               WHERE r.id = a.receipt_id AND r.status = 'POSTED'))
         OR (a.payment_id IS NOT NULL AND EXISTS (SELECT 1 FROM payments p
               WHERE p.id = a.payment_id AND p.status = 'POSTED'))
         -- PHASE-027 (0038): note-owned allocations are effective by
         -- presence (see lockOpenItemAndSumPostedAllocations).
         OR (a.note_id IS NOT NULL)
      GROUP BY a.open_item_id
    ) settled ON settled.open_item_id = s.id
    WHERE (${filter.partnerId ?? null}::uuid IS NULL OR s.partner_id = ${filter.partnerId ?? null})
      AND s.direction = ${filter.side === "AR" ? "DEBIT" : "CREDIT"}
    ORDER BY s.entry_date, s.id
    LIMIT ${filter.limit}
  `);
  const all = rows.rows as unknown as OpenItemRow[];
  if (filter.openOnly === false) return all;
  // The SQL casts outstanding to numeric(19,4)::text, so a fully settled row
  // reads "0.0000" — never "0" (the pre-PHASE-027 filter compared the wrong
  // literal and leaked settled rows into every openOnly consumer: the FIFO
  // suggestion, the notes/installments settle-target lookups, and the aging).
  // P27-G fix: compare the canonical 4dp zero; negatives (over-settled) stay
  // excluded exactly like before.
  return all.filter((row) => row.outstanding !== "0.0000" && !row.outstanding.startsWith("-"));
}

/** FIFO suggestion (§2.3): allocate up to `amount` across the partner's open items, oldest first. */
export async function fifoSuggestion(input: {
  partnerId: string;
  side: "AR" | "AP";
  amount: string;
}): Promise<{ openItemId: string; amount: string; entryDate: string; memo: string | null }[]> {
  const items = await listOpenItems({ partnerId: input.partnerId, side: input.side, openOnly: true, limit: 200 });
  let remaining = input.amount;
  const plan: { openItemId: string; amount: string; entryDate: string; memo: string | null }[] = [];
  for (const item of items) {
    if (remaining === "0.0000") break;
    const applied = compareExact(remaining, item.outstanding) <= 0 ? remaining : item.outstanding;
    plan.push({ openItemId: item.id, amount: applied, entryDate: item.entryDate, memo: item.memo });
    remaining = subExact(remaining, applied);
  }
  return plan;
}

// -- expense categories / expenses ----------------------------------------------------

export interface ExpenseCategoryRow {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  accountId: string;
  accountCode: string;
  approvalMode: "none" | "single-approver";
  isActive: boolean;
}

export async function listExpenseCategories(includeInactive: boolean): Promise<ExpenseCategoryRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT c.id, c.code, c.name, c.name_ar AS "nameAr", c.account_id AS "accountId",
           a.code AS "accountCode", c.approval_mode AS "approvalMode", c.is_active AS "isActive"
    FROM expense_categories c JOIN accounts a ON a.id = c.account_id AND a.tenant_id = c.tenant_id
    WHERE (${includeInactive} OR c.is_active)
    ORDER BY c.code
  `);
  return rows.rows as unknown as ExpenseCategoryRow[];
}

export async function findExpenseCategoryById(id: string): Promise<ExpenseCategoryRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT c.id, c.code, c.name, c.name_ar AS "nameAr", c.account_id AS "accountId",
           a.code AS "accountCode", c.approval_mode AS "approvalMode", c.is_active AS "isActive"
    FROM expense_categories c JOIN accounts a ON a.id = c.account_id AND a.tenant_id = c.tenant_id
    WHERE c.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ExpenseCategoryRow[])[0];
}

export async function insertExpenseCategory(input: {
  code: string;
  name: string;
  nameAr: string;
  accountId: string;
  approvalMode: "none" | "single-approver";
  createdBy: string | null;
}): Promise<ExpenseCategoryRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO expense_categories (id, tenant_id, code, name, name_ar, account_id, approval_mode, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.code}, ${input.name}, ${input.nameAr},
            ${input.accountId}, ${input.approvalMode}, ${input.createdBy})
  `);
  return findExpenseCategoryById(id) as Promise<ExpenseCategoryRow>;
}

export interface ExpenseRow {
  id: string;
  status: string;
  expenseNo: string | null;
  categoryId: string;
  categoryCode: string;
  cashAccountId: string;
  payeeName: string;
  currencyCode: string;
  amount: string;
  exchangeRate: string | null;
  taxCodeId: string | null;
  receiptFileId: string | null;
  valueDate: string;
  description: string | null;
  descriptionAr: string | null;
  postedJournalId: string | null;
  createdBy: string | null;
}

const EXPENSE_COLUMNS = sql`e.id, e.status, e.expense_no AS "expenseNo", e.category_id AS "categoryId",
  c.code AS "categoryCode", e.cash_account_id AS "cashAccountId", e.payee_name AS "payeeName",
  e.currency_code AS "currencyCode", e.amount, e.exchange_rate AS "exchangeRate", e.tax_code_id AS "taxCodeId",
  e.receipt_file_id AS "receiptFileId", e.value_date AS "valueDate", e.description,
  e.description_ar AS "descriptionAr", e.posted_journal_id AS "postedJournalId", e.created_by AS "createdBy"`;

export async function insertExpense(input: {
  categoryId: string;
  cashAccountId: string;
  payeeName: string;
  currencyCode: string;
  amount: string;
  exchangeRate: string | null;
  taxCodeId: string | null;
  receiptFileId: string | null;
  valueDate: string;
  description: string | null;
  descriptionAr: string | null;
  createdBy: string | null;
}): Promise<ExpenseRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO expenses (id, tenant_id, category_id, cash_account_id, payee_name, currency_code, amount,
                          exchange_rate, tax_code_id, receipt_file_id, value_date, description, description_ar, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.categoryId}, ${input.cashAccountId}, ${input.payeeName},
            ${input.currencyCode}, ${input.amount}, ${input.exchangeRate}, ${input.taxCodeId},
            ${input.receiptFileId}, ${input.valueDate}, ${input.description}, ${input.descriptionAr},
            ${input.createdBy})
  `);
  return findExpenseById(id) as Promise<ExpenseRow>;
}

export async function findExpenseById(id: string): Promise<ExpenseRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${EXPENSE_COLUMNS} FROM expenses e
    JOIN expense_categories c ON c.id = e.category_id AND c.tenant_id = e.tenant_id
    WHERE e.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ExpenseRow[])[0];
}

export async function listExpenses(filter: {
  status?: string;
  categoryId?: string;
  fromDate?: string;
  toDate?: string;
  limit: number;
}): Promise<ExpenseRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${EXPENSE_COLUMNS} FROM expenses e
    JOIN expense_categories c ON c.id = e.category_id AND c.tenant_id = e.tenant_id
    WHERE (${filter.status ?? null}::text IS NULL OR e.status = ${filter.status ?? null})
      AND (${filter.categoryId ?? null}::uuid IS NULL OR e.category_id = ${filter.categoryId ?? null})
      AND (${filter.fromDate ?? null}::date IS NULL OR e.value_date >= ${filter.fromDate ?? null})
      AND (${filter.toDate ?? null}::date IS NULL OR e.value_date <= ${filter.toDate ?? null})
    ORDER BY e.value_date DESC, e.id DESC
    LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as ExpenseRow[];
}

export async function updateExpenseStatus(input: {
  id: string;
  status: string;
  expenseNo?: string;
  postedJournalId?: string;
  actorId: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE expenses SET
      status = ${input.status},
      expense_no = COALESCE(${input.expenseNo ?? null}, expense_no),
      posted_journal_id = COALESCE(${input.postedJournalId ?? null}, posted_journal_id),
      posted_at = CASE WHEN ${input.status} = 'POSTED' THEN now() ELSE posted_at END,
      posted_by = CASE WHEN ${input.status} = 'POSTED' THEN ${input.actorId} ELSE posted_by END,
      submitted_at = CASE WHEN ${input.status} = 'PENDING_APPROVAL' THEN now() ELSE submitted_at END,
      submitted_by = CASE WHEN ${input.status} = 'PENDING_APPROVAL' THEN ${input.actorId} ELSE submitted_by END,
      approved_at = CASE WHEN ${input.status} = 'APPROVED' THEN now() ELSE approved_at END,
      approved_by = CASE WHEN ${input.status} = 'APPROVED' THEN ${input.actorId} ELSE approved_by END,
      updated_at = now(), version = version + 1
    WHERE id = ${input.id}
  `);
}

// -- transfers -------------------------------------------------------------------------

export interface TransferRow {
  id: string;
  status: string;
  transferNo: string | null;
  fromAccountId: string;
  toAccountId: string;
  currencyCode: string;
  amount: string;
  feeAmount: string;
  exchangeRate: string | null;
  valueDate: string;
  reference: string | null;
  description: string | null;
  descriptionAr: string | null;
  postedJournalId: string | null;
}

const TRANSFER_COLUMNS = sql`t.id, t.status, t.transfer_no AS "transferNo", t.from_account_id AS "fromAccountId",
  t.to_account_id AS "toAccountId", t.currency_code AS "currencyCode", t.amount, t.fee_amount AS "feeAmount",
  t.exchange_rate AS "exchangeRate", t.value_date AS "valueDate", t.reference, t.description,
  t.description_ar AS "descriptionAr", t.posted_journal_id AS "postedJournalId"`;

export async function insertTransfer(input: {
  fromAccountId: string;
  toAccountId: string;
  currencyCode: string;
  amount: string;
  feeAmount: string;
  exchangeRate: string | null;
  valueDate: string;
  reference: string | null;
  description: string | null;
  descriptionAr: string | null;
  createdBy: string | null;
}): Promise<TransferRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO cash_transfers (id, tenant_id, from_account_id, to_account_id, currency_code, amount,
                                fee_amount, exchange_rate, value_date, reference, description,
                                description_ar, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.fromAccountId}, ${input.toAccountId}, ${input.currencyCode},
            ${input.amount}, ${input.feeAmount}, ${input.exchangeRate}, ${input.valueDate}, ${input.reference},
            ${input.description}, ${input.descriptionAr}, ${input.createdBy})
  `);
  return findTransferById(id) as Promise<TransferRow>;
}

export async function findTransferById(id: string): Promise<TransferRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TRANSFER_COLUMNS} FROM cash_transfers t WHERE t.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as TransferRow[])[0];
}

export async function listTransfers(filter: {
  status?: string;
  fromDate?: string;
  toDate?: string;
  limit: number;
}): Promise<TransferRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${TRANSFER_COLUMNS} FROM cash_transfers t
    WHERE (${filter.status ?? null}::text IS NULL OR t.status = ${filter.status ?? null})
      AND (${filter.fromDate ?? null}::date IS NULL OR t.value_date >= ${filter.fromDate ?? null})
      AND (${filter.toDate ?? null}::date IS NULL OR t.value_date <= ${filter.toDate ?? null})
    ORDER BY t.value_date DESC, t.id DESC
    LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as TransferRow[];
}

export async function updateTransferStatus(input: {
  id: string;
  status: string;
  transferNo?: string;
  postedJournalId?: string;
  actorId: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE cash_transfers SET
      status = ${input.status},
      transfer_no = COALESCE(${input.transferNo ?? null}, transfer_no),
      posted_journal_id = COALESCE(${input.postedJournalId ?? null}, posted_journal_id),
      posted_at = CASE WHEN ${input.status} = 'POSTED' THEN now() ELSE posted_at END,
      posted_by = CASE WHEN ${input.status} = 'POSTED' THEN ${input.actorId} ELSE posted_by END,
      submitted_at = CASE WHEN ${input.status} = 'PENDING_APPROVAL' THEN now() ELSE submitted_at END,
      submitted_by = CASE WHEN ${input.status} = 'PENDING_APPROVAL' THEN ${input.actorId} ELSE submitted_by END,
      approved_at = CASE WHEN ${input.status} = 'APPROVED' THEN now() ELSE approved_at END,
      approved_by = CASE WHEN ${input.status} = 'APPROVED' THEN ${input.actorId} ELSE approved_by END,
      updated_at = now(), version = version + 1
    WHERE id = ${input.id}
  `);
}

// -- shifts ------------------------------------------------------------------------------

export interface ShiftRow {
  id: string;
  status: "OPEN" | "CLOSED" | "CANCELLED";
  shiftNo: string | null;
  cashAccountId: string;
  currencyCode: string;
  exchangeRate: string | null;
  openingAmount: string;
  capturedIn: string;
  capturedOut: string;
  expectedAmount: string | null;
  countedAmount: string | null;
  difference: string | null;
  variancePostedJournalId: string | null;
  supervisorId: string | null;
  closeReason: string | null;
  openedAt: string;
  closedAt: string | null;
}

const SHIFT_COLUMNS = sql`s.id, s.status, s.shift_no AS "shiftNo", s.cash_account_id AS "cashAccountId",
  s.currency_code AS "currencyCode", s.exchange_rate AS "exchangeRate", s.opening_amount AS "openingAmount",
  s.captured_in AS "capturedIn", s.captured_out AS "capturedOut", s.expected_amount AS "expectedAmount",
  s.counted_amount AS "countedAmount", s.difference, s.variance_posted_journal_id AS "variancePostedJournalId",
  s.supervisor_id AS "supervisorId", s.close_reason AS "closeReason", s.opened_at AS "openedAt",
  s.closed_at AS "closedAt"`;

export async function insertShift(input: {
  cashAccountId: string;
  currencyCode: string;
  openingAmount: string;
  createdBy: string | null;
}): Promise<ShiftRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO cashier_shifts (id, tenant_id, cash_account_id, currency_code, opening_amount, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.cashAccountId}, ${input.currencyCode},
            ${input.openingAmount}, ${input.createdBy})
  `);
  return findShiftById(id) as Promise<ShiftRow>;
}

export async function findShiftById(id: string): Promise<ShiftRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${SHIFT_COLUMNS} FROM cashier_shifts s WHERE s.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ShiftRow[])[0];
}

export async function listShifts(filter: { status?: string; limit: number }): Promise<ShiftRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${SHIFT_COLUMNS} FROM cashier_shifts s
    WHERE (${filter.status ?? null}::text IS NULL OR s.status = ${filter.status ?? null})
    ORDER BY s.opened_at DESC, s.id DESC
    LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as ShiftRow[];
}

export async function findOpenShiftForAccount(cashAccountId: string): Promise<ShiftRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${SHIFT_COLUMNS} FROM cashier_shifts s
    WHERE s.cash_account_id = ${cashAccountId} AND s.status = 'OPEN'
    LIMIT 1
  `);
  return (rows.rows as unknown as ShiftRow[])[0];
}

export async function captureShiftActivity(input: {
  id: string;
  cashIn: string;
  cashOut: string;
}): Promise<ShiftRow> {
  await tenantTx().execute(sql`
    UPDATE cashier_shifts
    SET captured_in = captured_in + ${input.cashIn}, captured_out = captured_out + ${input.cashOut},
        updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND status = 'OPEN'
  `);
  return findShiftById(input.id) as Promise<ShiftRow>;
}

export async function closeShiftRecord(input: {
  id: string;
  countedAmount: string;
  expectedAmount: string;
  difference: string;
  supervisorId: string | null;
  closeReason: string;
  variancePostedJournalId: string | null;
  actorId: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE cashier_shifts SET
      status = 'CLOSED',
      counted_amount = ${input.countedAmount},
      expected_amount = ${input.expectedAmount},
      difference = ${input.difference},
      supervisor_id = ${input.supervisorId},
      supervisor_verified_at = CASE WHEN ${input.supervisorId ?? null}::uuid IS NULL THEN supervisor_verified_at ELSE now() END,
      close_reason = ${input.closeReason},
      variance_posted_journal_id = COALESCE(${input.variancePostedJournalId ?? null}, variance_posted_journal_id),
      closed_at = now(), closed_by = ${input.actorId},
      updated_at = now(), version = version + 1
    WHERE id = ${input.id}
  `);
}

export async function cancelShift(input: { id: string; actorId: string | null; reason: string }): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE cashier_shifts SET
      status = 'CANCELLED', closed_at = now(), closed_by = ${input.actorId},
      close_reason = ${input.reason}, updated_at = now(), version = version + 1
    WHERE id = ${input.id}
  `);
}

// -- bank statements ------------------------------------------------------------------------

export interface StatementRow {
  id: string;
  status: "IMPORTED" | "RECONCILED";
  cashAccountId: string;
  periodStart: string;
  periodEnd: string;
  fileName: string;
  fileHash: string;
  adapterId: string;
  openingBalance: string | null;
  closingBalance: string | null;
  lineCount: number;
  importedAt: string;
  reconciledAt: string | null;
}

export async function insertStatement(input: {
  cashAccountId: string;
  periodStart: string;
  periodEnd: string;
  fileName: string;
  fileHash: string;
  adapterId: string;
  openingBalance: string | null;
  closingBalance: string | null;
  lineCount: number;
  createdBy: string | null;
}): Promise<StatementRow> {
  const id = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO bank_statements (id, tenant_id, cash_account_id, period_start, period_end, file_name,
                                 file_hash, adapter_id, opening_balance, closing_balance, line_count, created_by)
    VALUES (${id}, erp.current_tenant_id(), ${input.cashAccountId}, ${input.periodStart}, ${input.periodEnd},
            ${input.fileName}, ${input.fileHash}, ${input.adapterId}, ${input.openingBalance},
            ${input.closingBalance}, ${input.lineCount}, ${input.createdBy})
  `);
  return findStatementById(id) as Promise<StatementRow>;
}

export async function findStatementById(id: string): Promise<StatementRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, status, cash_account_id AS "cashAccountId", period_start AS "periodStart",
           period_end AS "periodEnd", file_name AS "fileName", file_hash AS "fileHash",
           adapter_id AS "adapterId", opening_balance AS "openingBalance", closing_balance AS "closingBalance",
           line_count AS "lineCount", imported_at AS "importedAt", reconciled_at AS "reconciledAt"
    FROM bank_statements WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as StatementRow[])[0];
}

export async function findStatementByHash(fileHash: string): Promise<StatementRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, status, cash_account_id AS "cashAccountId", period_start AS "periodStart",
           period_end AS "periodEnd", file_name AS "fileName", file_hash AS "fileHash",
           adapter_id AS "adapterId", opening_balance AS "openingBalance", closing_balance AS "closingBalance",
           line_count AS "lineCount", imported_at AS "importedAt", reconciled_at AS "reconciledAt"
    FROM bank_statements WHERE file_hash = ${fileHash} LIMIT 1
  `);
  return (rows.rows as unknown as StatementRow[])[0];
}

export async function listStatements(filter: {
  cashAccountId?: string;
  status?: string;
  limit: number;
}): Promise<StatementRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, status, cash_account_id AS "cashAccountId", period_start AS "periodStart",
           period_end AS "periodEnd", file_name AS "fileName", file_hash AS "fileHash",
           adapter_id AS "adapterId", opening_balance AS "openingBalance", closing_balance AS "closingBalance",
           line_count AS "lineCount", imported_at AS "importedAt", reconciled_at AS "reconciledAt"
    FROM bank_statements
    WHERE (${filter.cashAccountId ?? null}::uuid IS NULL OR cash_account_id = ${filter.cashAccountId ?? null})
      AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
    ORDER BY period_start DESC, id DESC
    LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as StatementRow[];
}

export async function markStatementReconciled(input: { id: string; actorId: string | null }): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE bank_statements SET status = 'RECONCILED', reconciled_at = now(), reconciled_by = ${input.actorId},
        updated_at = now(), version = version + 1
    WHERE id = ${input.id}
  `);
}

/** BR-022 lock probe: any RECONCILED statement of this account overlapping the date? */
export async function isAccountPeriodReconciled(cashAccountId: string, date: string): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    SELECT 1 FROM bank_statements
    WHERE cash_account_id = ${cashAccountId} AND status = 'RECONCILED'
      AND ${date} BETWEEN period_start AND period_end
    LIMIT 1
  `);
  return rows.rows.length > 0;
}

export interface StatementLineRow {
  id: string;
  bankStatementId: string;
  lineNo: number;
  lineDate: string;
  amount: string;
  reference: string | null;
  description: string | null;
  matchedMovementId: string | null;
  matchedAt: string | null;
  matchMode: string | null;
  ageDays: number | null;
}

export async function insertStatementLine(input: {
  bankStatementId: string;
  lineNo: number;
  lineDate: string;
  amount: string;
  reference: string | null;
  description: string | null;
}): Promise<void> {
  await tenantTx().execute(sql`
    INSERT INTO bank_statement_lines (id, tenant_id, bank_statement_id, line_no, line_date, amount,
                                      reference, description)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.bankStatementId}, ${input.lineNo},
            ${input.lineDate}, ${input.amount}, ${input.reference}, ${input.description})
  `);
}

export async function listStatementLines(bankStatementId: string): Promise<StatementLineRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT l.id, l.bank_statement_id AS "bankStatementId", l.line_no AS "lineNo", l.line_date AS "lineDate",
           l.amount, l.reference, l.description, l.matched_movement_id AS "matchedMovementId",
           l.matched_at AS "matchedAt", l.match_mode AS "matchMode",
           (CURRENT_DATE - l.line_date) AS "ageDays"
    FROM bank_statement_lines l
    WHERE l.bank_statement_id = ${bankStatementId}
    ORDER BY l.line_no
  `);
  return rows.rows as unknown as StatementLineRow[];
}

export async function findStatementLineById(id: string): Promise<StatementLineRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT l.id, l.bank_statement_id AS "bankStatementId", l.line_no AS "lineNo", l.line_date AS "lineDate",
           l.amount, l.reference, l.description, l.matched_movement_id AS "matchedMovementId",
           l.matched_at AS "matchedAt", l.match_mode AS "matchMode",
           (CURRENT_DATE - l.line_date) AS "ageDays"
    FROM bank_statement_lines l WHERE l.id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as StatementLineRow[])[0];
}

export async function setLineMatch(input: {
  lineId: string;
  matchedMovementId: string | null;
  actorId: string | null;
  mode: "AUTO" | "MANUAL";
}): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE bank_statement_lines SET
      matched_movement_id = ${input.matchedMovementId},
      matched_at = CASE WHEN ${input.matchedMovementId ?? null}::uuid IS NULL THEN NULL ELSE now() END,
      matched_by = CASE WHEN ${input.matchedMovementId ?? null}::uuid IS NULL THEN NULL ELSE ${input.actorId}::uuid END,
      match_mode = CASE WHEN ${input.matchedMovementId ?? null}::uuid IS NULL THEN NULL ELSE ${input.mode}::text END,
      updated_at = now(), version = version + 1
    WHERE id = ${input.lineId}
  `);
}
