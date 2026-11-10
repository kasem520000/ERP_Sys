import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import { addExact } from "../../accounting/application/decimal-strings";

/**
 * Notes store (PHASE-027 T2): the ONLY writer of `notes` + `note_events` 🔒
 * (the register and the append-only custody log), and the notes-owned
 * allocation rows in `treasury_allocations` (the settle/restore substrate —
 * the sales realloc precedent: feature modules write their own allocation
 * rows; MODULE_BOUNDARIES sanctions it for treasury_allocations the same way
 * sales/purchasing realloc services do). Every statement runs in the
 * caller's ambient tenant UoW so a failure anywhere rolls the whole business
 * operation back. journal_entries/journal_lines are NEVER written here
 * (ADR-0007 — the posting engine exclusively owns them); note_events is
 * append-only (SELECT/INSERT grants + the erp.note_events_guard trigger).
 *
 * Cross-module READ refs (sanctioned §4 read refs — never written here):
 * sales_invoices / supplier_invoices (source validation),
 * partner_subledger_entries (the repoint-restore target lookup),
 * treasury open items (allocation validation reads the treasury store).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("notes access requires an ambient tenant scope");
  }
  return context.tx;
}

// -- the register -------------------------------------------------------------------

export interface NoteRow {
  id: string;
  kind: "CHEQUE" | "PROMISSORY_NOTE";
  direction: "RECEIVED" | "ISSUED";
  partnerId: string;
  number: string | null;
  issuingBank: string | null;
  amount: string;
  currency: string;
  exchangeRate: string;
  issueDate: string | null;
  maturityDate: string;
  status: string;
  sourceType: string | null;
  sourceId: string | null;
  cashAccountId: string | null;
  journalEntryId: string | null;
  note: string | null;
  noteAr: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const NOTE_SELECT = sql`
  SELECT id, kind, direction, partner_id AS "partnerId", number, issuing_bank AS "issuingBank",
    amount::text AS amount, currency, exchange_rate::text AS "exchangeRate",
    issue_date::text AS "issueDate", maturity_date::text AS "maturityDate", status,
    source_type AS "sourceType", source_id AS "sourceId", cash_account_id AS "cashAccountId",
    journal_entry_id AS "journalEntryId", note, note_ar AS "noteAr",
    created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", version
  FROM notes`;

export async function insertNote(input: {
  kind: "CHEQUE" | "PROMISSORY_NOTE";
  direction: "RECEIVED" | "ISSUED";
  partnerId: string;
  number?: string | null;
  issuingBank?: string | null;
  amount: string;
  currency: string;
  exchangeRate: string;
  issueDate?: string | null;
  maturityDate: string;
  sourceType?: string | null;
  sourceId?: string | null;
  note?: string | null;
  noteAr?: string | null;
  createdBy: string | null;
}): Promise<NoteRow> {
  const id = generateUuidV7();
  const rows = await tenantTx().execute(sql`
    INSERT INTO notes (id, tenant_id, created_by, kind, direction, partner_id, number,
      issuing_bank, amount, currency, exchange_rate, issue_date, maturity_date, status,
      source_type, source_id, note, note_ar)
    VALUES (${id}, ${requireTenantContext().tenantId}, ${input.createdBy}, ${input.kind},
      ${input.direction}, ${input.partnerId}, ${input.number ?? null}, ${input.issuingBank ?? null},
      ${input.amount}, ${input.currency}, ${input.exchangeRate}, ${input.issueDate ?? null},
      ${input.maturityDate}, 'IN_CUSTODY', ${input.sourceType ?? null}, ${input.sourceId ?? null},
      ${input.note ?? null}, ${input.noteAr ?? null})
    RETURNING id, kind, direction, partner_id AS "partnerId", number,
      issuing_bank AS "issuingBank", amount::text AS amount, currency,
      exchange_rate::text AS "exchangeRate", issue_date::text AS "issueDate",
      maturity_date::text AS "maturityDate", status, source_type AS "sourceType",
      source_id AS "sourceId", cash_account_id AS "cashAccountId",
      journal_entry_id AS "journalEntryId", note, note_ar AS "noteAr",
      created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", version
  `);
  return (rows.rows as unknown as NoteRow[])[0]!;
}

export async function findNoteById(id: string): Promise<NoteRow | undefined> {
  const rows = await tenantTx().execute(sql`${NOTE_SELECT} WHERE id = ${id} LIMIT 1`);
  return (rows.rows as unknown as NoteRow[])[0];
}

export interface ListNotesFilter {
  kind?: string;
  direction?: string;
  status?: string;
  partnerId?: string;
  issuingBank?: string;
  maturityFrom?: string;
  maturityTo?: string;
  limit: number;
}

export async function listNotes(filter: ListNotesFilter): Promise<NoteRow[]> {
  const rows = await tenantTx().execute(sql`
    ${NOTE_SELECT}
    WHERE (${filter.kind ?? null}::text IS NULL OR kind = ${filter.kind ?? null})
      AND (${filter.direction ?? null}::text IS NULL OR direction = ${filter.direction ?? null})
      AND (${filter.status ?? null}::text IS NULL OR status = ${filter.status ?? null})
      AND (${filter.partnerId ?? null}::uuid IS NULL OR partner_id = ${filter.partnerId ?? null})
      AND (${filter.maturityFrom ?? null}::date IS NULL OR maturity_date >= ${filter.maturityFrom ?? null})
      AND (${filter.maturityTo ?? null}::date IS NULL OR maturity_date <= ${filter.maturityTo ?? null})
    ORDER BY maturity_date, id
    LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as NoteRow[];
}

/** Live notes for the calendar + RC-11 fold (custody still unresolved). */
export async function listLiveNotes(limit: number): Promise<NoteRow[]> {
  const rows = await tenantTx().execute(sql`
    ${NOTE_SELECT}
    WHERE status IN ('IN_CUSTODY', 'ENDORSED_OUT', 'DEPOSITED')
    ORDER BY maturity_date, id
    LIMIT ${limit}
  `);
  return rows.rows as unknown as NoteRow[];
}

export async function updateNoteStatus(
  id: string,
  status: string,
  extra?: { cashAccountId?: string; journalEntryId?: string },
): Promise<NoteRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE notes SET status = ${status}, version = version + 1, updated_at = now(),
      cash_account_id = COALESCE(${extra?.cashAccountId ?? null}::uuid, cash_account_id),
      journal_entry_id = COALESCE(${extra?.journalEntryId ?? null}::uuid, journal_entry_id)
    WHERE id = ${id}
    RETURNING id, kind, direction, partner_id AS "partnerId", number,
      issuing_bank AS "issuingBank", amount::text AS amount, currency,
      exchange_rate::text AS "exchangeRate", issue_date::text AS "issueDate",
      maturity_date::text AS "maturityDate", status, source_type AS "sourceType",
      source_id AS "sourceId", cash_account_id AS "cashAccountId",
      journal_entry_id AS "journalEntryId", note, note_ar AS "noteAr",
      created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", version
  `);
  return (rows.rows as unknown as NoteRow[])[0];
}

/** RECLASSIFY (BR-047): metadata corrections only — no journal, no custody change. */
export async function updateNoteMetadata(
  id: string,
  patch: {
    number?: string | null;
    issuingBank?: string | null;
    maturityDate?: string;
    note?: string | null;
    noteAr?: string | null;
  },
): Promise<NoteRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE notes SET
      number = COALESCE(${patch.number ?? null}::text, number),
      issuing_bank = COALESCE(${patch.issuingBank ?? null}::text, issuing_bank),
      maturity_date = COALESCE(${patch.maturityDate ?? null}::date, maturity_date),
      note = COALESCE(${patch.note ?? null}::text, note),
      note_ar = COALESCE(${patch.noteAr ?? null}::text, note_ar),
      version = version + 1, updated_at = now()
    WHERE id = ${id}
    RETURNING id, kind, direction, partner_id AS "partnerId", number,
      issuing_bank AS "issuingBank", amount::text AS amount, currency,
      exchange_rate::text AS "exchangeRate", issue_date::text AS "issueDate",
      maturity_date::text AS "maturityDate", status, source_type AS "sourceType",
      source_id AS "sourceId", cash_account_id AS "cashAccountId",
      journal_entry_id AS "journalEntryId", note, note_ar AS "noteAr",
      created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt", version
  `);
  return (rows.rows as unknown as NoteRow[])[0];
}

// -- the custody log (append-only 🔒) ------------------------------------------------

export interface NoteEventRow {
  id: string;
  noteId: string;
  eventKind: string;
  eventDate: string;
  refs: unknown;
  journalEntryId: string | null;
  memo: string | null;
  memoAr: string | null;
  createdBy: string | null;
  createdAt: string;
}

export async function insertNoteEvent(input: {
  noteId: string;
  eventKind: string;
  eventDate: string;
  refs?: unknown;
  journalEntryId?: string | null;
  memo?: string | null;
  memoAr?: string | null;
  createdBy: string | null;
}): Promise<NoteEventRow> {
  const id = generateUuidV7();
  const rows = await tenantTx().execute(sql`
    INSERT INTO note_events (id, tenant_id, created_by, note_id, event_kind, event_date,
      refs, journal_entry_id, memo, memo_ar)
    VALUES (${id}, ${requireTenantContext().tenantId}, ${input.createdBy}, ${input.noteId},
      ${input.eventKind}, ${input.eventDate}, ${JSON.stringify(input.refs ?? {})}::jsonb,
      ${input.journalEntryId ?? null}, ${input.memo ?? null}, ${input.memoAr ?? null})
    RETURNING id, note_id AS "noteId", event_kind AS "eventKind", event_date::text AS "eventDate",
      refs, journal_entry_id AS "journalEntryId", memo, memo_ar AS "memoAr",
      created_by AS "createdBy", created_at AS "createdAt"
  `);
  return (rows.rows as unknown as NoteEventRow[])[0]!;
}

export async function listNoteEventsByNote(noteId: string): Promise<NoteEventRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, note_id AS "noteId", event_kind AS "eventKind", event_date::text AS "eventDate",
      refs, journal_entry_id AS "journalEntryId", memo, memo_ar AS "memoAr",
      created_by AS "createdBy", created_at AS "createdAt"
    FROM note_events WHERE note_id = ${noteId}
    ORDER BY event_date, created_at
  `);
  return rows.rows as unknown as NoteEventRow[];
}

// -- the settle/restore substrate (notes-owned treasury_allocations rows) --------------

export interface NoteAllocationRow {
  id: string;
  noteId: string;
  openItemId: string;
  amount: string;
}

export async function insertNoteAllocations(
  noteId: string,
  allocations: readonly { openItemId: string; amount: string }[],
  createdBy: string | null,
): Promise<void> {
  const tenantId = requireTenantContext().tenantId;
  for (const allocation of allocations) {
    await tenantTx().execute(sql`
      INSERT INTO treasury_allocations (id, tenant_id, created_by, note_id, open_item_id, amount)
      VALUES (${generateUuidV7()}, ${tenantId}, ${createdBy}, ${noteId},
        ${allocation.openItemId}, ${allocation.amount})
    `);
  }
}

export async function listNoteAllocations(noteId: string): Promise<NoteAllocationRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT id, note_id AS "noteId", open_item_id AS "openItemId", amount::text AS amount
    FROM treasury_allocations WHERE note_id = ${noteId}
    ORDER BY created_at, id
  `);
  return rows.rows as unknown as NoteAllocationRow[];
}

/**
 * The repoint-restore (G-26/RETURN, the critical mechanic): DELETE the
 * note's allocation rows and INSERT ONE consolidated row anchored at the
 * dishonor/return journal's NEW control debit subledger entry. The ORIGINAL
 * open item's outstanding comes back byte-equal (its row is untouched); the
 * new entry is anchored (outstanding 0) so the aging never double-counts.
 * Audited by the caller (before/after lists in the event refs + audit).
 */
export async function repointNoteAllocations(
  noteId: string,
  anchorSubledgerEntryId: string,
  createdBy: string | null,
): Promise<{ removed: NoteAllocationRow[]; anchored: NoteAllocationRow | null }> {
  const existing = await listNoteAllocations(noteId);
  if (existing.length === 0) {
    return { removed: [], anchored: null };
  }
  const tenantId = requireTenantContext().tenantId;
  await tenantTx().execute(sql`DELETE FROM treasury_allocations WHERE note_id = ${noteId}`);
  let total = "0.0000";
  for (const row of existing) {
    total = addExact(total, row.amount);
  }
  const anchoredId = generateUuidV7();
  await tenantTx().execute(sql`
    INSERT INTO treasury_allocations (id, tenant_id, created_by, note_id, open_item_id, amount)
    VALUES (${anchoredId}, ${tenantId}, ${createdBy}, ${noteId}, ${anchorSubledgerEntryId}, ${total})
  `);
  return {
    removed: existing,
    anchored: {
      id: anchoredId,
      noteId,
      openItemId: anchorSubledgerEntryId,
      amount: total,
    },
  };
}

/**
 * The repoint target: the control debit subledger entry created by the
 * dishonor/return journal (the AR/AP partner line — INV-009(a) requires the
 * partner on the line, so the engine always creates exactly one such entry
 * per G-26/RETURN journal).
 */
export async function findControlEntryForJournal(journalEntryId: string): Promise<
  | { id: string; partnerId: string; direction: "DEBIT" | "CREDIT"; amount: string; baseAmount: string }
  | undefined
> {
  const rows = await tenantTx().execute(sql`
    SELECT s.id, s.partner_id AS "partnerId", s.direction, s.amount::text AS amount,
      s.base_amount::text AS "baseAmount"
    FROM partner_subledger_entries s
    WHERE s.journal_entry_id = ${journalEntryId}
    ORDER BY s.created_at
    LIMIT 1
  `);
  return (rows.rows as unknown as {
    id: string;
    partnerId: string;
    direction: "DEBIT" | "CREDIT";
    amount: string;
    baseAmount: string;
  }[])[0];
}

// -- source validation reads (sanctioned §4 read refs — never written here) ------------

export interface SourceSalesInvoiceRow {
  id: string;
  invoiceNo: string | null;
  customerId: string;
  kind: string;
  status: string;
  currencyCode: string;
  totalGross: string;
}

export async function findSourceSalesInvoice(id: string): Promise<SourceSalesInvoiceRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, invoice_no AS "invoiceNo", customer_id AS "customerId", kind, status,
      currency_code AS "currencyCode", total_gross::text AS "totalGross"
    FROM sales_invoices WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as SourceSalesInvoiceRow[])[0];
}

export interface SourceSupplierInvoiceRow {
  id: string;
  invoiceNo: string;
  supplierId: string;
  status: string;
  currencyCode: string;
  totalGross: string;
}

export async function findSourceSupplierInvoice(
  id: string,
): Promise<SourceSupplierInvoiceRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT id, invoice_no AS "invoiceNo", supplier_id AS "supplierId", status,
      currency_code AS "currencyCode", total_gross::text AS "totalGross"
    FROM supplier_invoices WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as SourceSupplierInvoiceRow[])[0];
}

// -- RC-11 calendar feed (the maturity-calendar read model sources) --------------------

/** One partner/bank row in the calendar drill lists. */
export interface CalendarNoteView {
  id: string;
  direction: "RECEIVED" | "ISSUED";
  partnerId: string;
  partnerName: string | null;
  number: string | null;
  issuingBank: string | null;
  amount: string;
  currency: string;
  exchangeRate: string;
  maturityDate: string;
  status: string;
}

export async function listLiveNotesForCalendar(limit: number): Promise<CalendarNoteView[]> {
  const rows = await tenantTx().execute(sql`
    SELECT n.id, n.direction, n.partner_id AS "partnerId", p.name AS "partnerName",
      n.number, n.issuing_bank AS "issuingBank", n.amount::text AS amount, n.currency,
      n.exchange_rate::text AS "exchangeRate", n.maturity_date::text AS "maturityDate", n.status
    FROM notes n
    LEFT JOIN partners p ON p.id = n.partner_id AND p.tenant_id = n.tenant_id
    WHERE n.status IN ('IN_CUSTODY', 'ENDORSED_OUT', 'DEPOSITED')
    ORDER BY n.maturity_date, n.id
    LIMIT ${limit}
  `);
  return rows.rows as unknown as CalendarNoteView[];
}

/** Count of live notes (the volume probe for the 100k perf fixture + ops). */
export async function countLiveNotes(): Promise<number> {
  const rows = await tenantTx().execute(sql`
    SELECT COUNT(*)::int AS count FROM notes
    WHERE status IN ('IN_CUSTODY', 'ENDORSED_OUT', 'DEPOSITED')
  `);
  return (rows.rows as unknown as { count: number }[])[0]?.count ?? 0;
}

// -- reporting reads (PHASE-027 wave E — append-only, read-only) -----------------------

/** One DISHONOR event row joined to its note (the dishonored-register grain). */
export interface DishonoredNoteEventRow {
  eventId: string;
  noteId: string;
  eventDate: string;
  /** refs.reason (BR-046 — dishonor requires a reason). */
  reason: string | null;
  /** refs.bankFee (the BR-046 fee leg; "0.0000" when none). */
  bankFee: string | null;
  journalEntryId: string | null;
  /** refs.entryNo (the G-26 restore entry's number — the drill target). */
  entryNo: string | null;
  direction: "RECEIVED" | "ISSUED";
  partnerId: string;
  partnerName: string | null;
  number: string | null;
  issuingBank: string | null;
  amount: string;
  currency: string;
  maturityDate: string;
}

/**
 * The dishonored-notes register read (REPORT_CATALOG §9 row 233): DISHONOR
 * events with event_date in the window (the economic date — the same anchor
 * the as-of reconstruction uses), joined to their notes + partners, with the
 * G-26 provenance (journal_entry_id + refs entryNo/reason/bankFee). Read-only
 * reporting surface; the append-only log is never written here.
 */
export async function listDishonorEvents(filter: {
  dateFrom: string;
  dateTo: string;
  partnerId?: string;
  reasonContains?: string | null;
  limit: number;
}): Promise<DishonoredNoteEventRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT e.id AS "eventId", e.note_id AS "noteId", e.event_date::text AS "eventDate",
      e.refs->>'reason' AS reason,
      (e.refs->>'bankFee')::numeric(19,4)::text AS "bankFee",
      e.journal_entry_id AS "journalEntryId",
      COALESCE(e.refs->>'entryNo', je.entry_no) AS "entryNo",
      n.direction, n.partner_id AS "partnerId", p.name AS "partnerName",
      n.number, n.issuing_bank AS "issuingBank", n.amount::text AS amount, n.currency,
      n.maturity_date::text AS "maturityDate"
    FROM note_events e
    JOIN notes n ON n.id = e.note_id
    LEFT JOIN partners p ON p.id = n.partner_id AND p.tenant_id = n.tenant_id
    LEFT JOIN journal_entries je ON je.id = e.journal_entry_id
    WHERE e.event_kind = 'DISHONOR'
      AND e.event_date BETWEEN ${filter.dateFrom} AND ${filter.dateTo}
      AND (${filter.partnerId ?? null}::uuid IS NULL OR n.partner_id = ${filter.partnerId ?? null})
      AND (${filter.reasonContains ?? null}::text IS NULL
        OR e.refs->>'reason' ILIKE ${`%${filter.reasonContains ?? ""}%`})
    ORDER BY e.event_date, e.id
    LIMIT ${filter.limit}
  `);
  return rows.rows as unknown as DishonoredNoteEventRow[];
}
