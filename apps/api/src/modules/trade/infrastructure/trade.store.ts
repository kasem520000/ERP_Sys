import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-051 (W-34 — T-05 + T-06, 2026-11-25) THE TRADE STORE: the ONLY
 * writer of the W-34 plane's tables (letters_of_credit · lc_amendments ·
 * lc_documents — 0119). Every statement runs in the caller's ambient
 * tenant UoW so a failure anywhere rolls the whole business operation
 * back (INV-018; the lifecycle acts' all-or-nothing law — the G-64
 * journal, the treasury movement, and the single-use CAS stamp commit
 * together or not at all). journal_entries/journal_lines are NEVER
 * written here (ADR-0007 — the posting engine exclusively owns them);
 * cash_movements are written ONLY through the treasury store's own
 * insertCashMovement (the INV-019 discipline); the notifications ride
 * the inbox service's own writer (the structural dedupe).
 *
 * THE MACHINE'S CAS (the 0103/0105/0114 stamp law): every transition is
 * ONE guarded UPDATE — the status pins the from-state, the stamps land
 * in the SAME statement, and zero rows means the raced/stale move. The
 * issue additionally pins lc_no IS NULL (the register's number is
 * assigned exactly once, at issuance); the retirement pins the whole
 * settled pair together (the 0119 retirement-shape floor satisfied by
 * the same statement that consumes the stamp).
 *
 * THE CLOCK LAW (the owner's standing order): the sweep's probes and
 * the expiry transition derive every date from the DATABASE'S OWN
 * CURRENT_DATE inside the SQL — never a JS wall clock.
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("trade access requires an ambient tenant scope");
  }
  return context.tx;
}

/** Typed query over the ambient tenant transaction (the existing stores'
 * `as unknown as` shape, one helper — the drizzle generic demands an
 * index signature our row interfaces deliberately lack). */
async function query<T>(statement: Parameters<TenantDb["execute"]>[0]): Promise<T[]> {
  const result = await tenantTx().execute(statement);
  return result.rows as unknown as T[];
}

// ── the LC register (T-05 — the lifecycle rows) ─────────────────────────────

export interface LcRow {
  id: string;
  lcNo: string | null;
  purchaseOrderId: string | null;
  currency: string;
  amount: string;
  marginAmount: string;
  issuingBank: string;
  beneficiaryName: string;
  applicantName: string;
  issuedAt: string;
  expiryDate: string;
  status: string;
  marginJournalEntryId: string | null;
  settledAt: string | null;
  retirementJournalEntryId: string | null;
  note: string | null;
  noteAr: string | null;
  createdAt: string;
  updatedAt: string;
}

const LC_COLUMNS = sql`id, lc_no AS "lcNo", purchase_order_id AS "purchaseOrderId", currency,
  amount::text AS "amount", margin_amount::text AS "marginAmount", issuing_bank,
  beneficiary_name AS "beneficiaryName", applicant_name AS "applicantName",
  issued_at::text AS "issuedAt", expiry_date::text AS "expiryDate", status,
  margin_journal_entry_id AS "marginJournalEntryId", settled_at::text AS "settledAt",
  retirement_journal_entry_id AS "retirementJournalEntryId", note, note_ar AS "noteAr",
  created_at::text AS "createdAt", updated_at::text AS "updatedAt"`;

export interface InsertLcInput {
  lcNo: string;
  purchaseOrderId: string | null;
  currency: string;
  amount: string;
  marginAmount: string;
  issuingBank: string;
  beneficiaryName: string;
  applicantName: string;
  expiryDate: string;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}

export async function insertLc(input: InsertLcInput): Promise<LcRow> {
  const rows = await query<LcRow>(sql`
    INSERT INTO letters_of_credit
      (id, tenant_id, lc_no, purchase_order_id, currency, amount, margin_amount,
       issuing_bank, beneficiary_name, applicant_name, expiry_date, status,
       note, note_ar, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.lcNo},
            ${input.purchaseOrderId}, ${input.currency}, ${input.amount}, ${input.marginAmount},
            ${input.issuingBank}, ${input.beneficiaryName}, ${input.applicantName},
            ${input.expiryDate}, 'DRAFT', ${input.note}, ${input.noteAr}, ${input.actorId})
    RETURNING ${LC_COLUMNS}`);
  return rows[0]!;
}

export async function findLcById(id: string): Promise<LcRow | undefined> {
  const rows = await query<LcRow>(sql`
    SELECT ${LC_COLUMNS} FROM letters_of_credit WHERE id = ${id} LIMIT 1`);
  return rows[0];
}

export async function findLcByNo(lcNo: string): Promise<LcRow | undefined> {
  const rows = await query<LcRow>(sql`
    SELECT ${LC_COLUMNS} FROM letters_of_credit WHERE lc_no = ${lcNo} LIMIT 1`);
  return rows[0];
}

export async function listLcs(filter: {
  status?: string;
  limit?: number;
}): Promise<LcRow[]> {
  const status = filter.status ?? null;
  return query<LcRow>(sql`
    SELECT ${LC_COLUMNS} FROM letters_of_credit
    WHERE (${status}::text IS NULL OR status = ${status})
    ORDER BY created_at DESC, id
    LIMIT ${filter.limit ?? 200}`);
}

/**
 * THE ISSUE STAMP (the CAS — DRAFT pins the from-state; the margin
 * journal link lands in the SAME statement; the register's official
 * number was reserved at create (the NCR/INV-021 precedent — the row
 * is the audit trail from its first write) and rides unchanged).
 */
export async function stampLcIssued(input: {
  id: string;
  marginJournalEntryId: string | null;
  actorId: string | null;
}): Promise<LcRow | undefined> {
  const rows = await query<LcRow>(sql`
    UPDATE letters_of_credit
    SET status = 'ISSUED',
        margin_journal_entry_id = ${input.marginJournalEntryId},
        updated_at = now(), updated_by = ${input.actorId}, version = version + 1
    WHERE id = ${input.id} AND tenant_id = erp.current_tenant_id()
      AND status = 'DRAFT'
    RETURNING ${LC_COLUMNS}`);
  return rows[0];
}

/**
 * THE RETIREMENT STAMP (the CAS — the settled pair lands TOGETHER with
 * the status, from ISSUED or EXPIRED; the 0119 retirement-shape floor
 * is satisfied by the same statement that consumes the stamp).
 */
export async function stampLcRetired(input: {
  id: string;
  retirementJournalEntryId: string | null;
  settledAt: string;
  actorId: string | null;
}): Promise<LcRow | undefined> {
  const rows = await query<LcRow>(sql`
    UPDATE letters_of_credit
    SET status = 'RETIRED', settled_at = ${input.settledAt}::timestamptz,
        retirement_journal_entry_id = ${input.retirementJournalEntryId},
        updated_at = now(), updated_by = ${input.actorId}, version = version + 1
    WHERE id = ${input.id} AND tenant_id = erp.current_tenant_id()
      AND status IN ('ISSUED', 'EXPIRED')
      AND settled_at IS NULL AND retirement_journal_entry_id IS NULL
    RETURNING ${LC_COLUMNS}`);
  return rows[0];
}

/** THE CANCEL STAMP (the CAS — DRAFT or ISSUED pins the from-state). */
export async function stampLcCancelled(input: {
  id: string;
  actorId: string | null;
}): Promise<LcRow | undefined> {
  const rows = await query<LcRow>(sql`
    UPDATE letters_of_credit
    SET status = 'CANCELLED', updated_at = now(), updated_by = ${input.actorId},
        version = version + 1
    WHERE id = ${input.id} AND tenant_id = erp.current_tenant_id()
      AND status IN ('DRAFT', 'ISSUED') AND settled_at IS NULL
    RETURNING ${LC_COLUMNS}`);
  return rows[0];
}

/**
 * THE EXPIRE STAMP (the sweep's own CAS — ISSUED pins the from-state;
 * idempotent by construction: a re-run finds no ISSUED row and zero
 * rows means nothing; the DB's own clock decided — the transition
 * never fires from JS time).
 */
export async function stampLcExpired(id: string): Promise<LcRow | undefined> {
  const rows = await query<LcRow>(sql`
    UPDATE letters_of_credit
    SET status = 'EXPIRED', updated_at = now(), version = version + 1
    WHERE id = ${id} AND tenant_id = erp.current_tenant_id()
      AND status = 'ISSUED' AND expiry_date < CURRENT_DATE
    RETURNING ${LC_COLUMNS}`);
  return rows[0];
}

/**
 * THE AMENDMENT'S EFFECT (the CAS on the ISSUED row — the typed
 * dimension's own write: the amount, the expiry, and the margin land
 * together with version+1; the fold decided the legality, the stamp
 * makes it race-free).
 */
export async function applyLcAmendment(input: {
  id: string;
  amount: string | null;
  expiryDate: string | null;
  marginAmount: string | null;
  actorId: string | null;
}): Promise<LcRow | undefined> {
  const rows = await query<LcRow>(sql`
    UPDATE letters_of_credit
    SET amount = COALESCE(${input.amount}::numeric, amount),
        expiry_date = COALESCE(${input.expiryDate}::date, expiry_date),
        margin_amount = COALESCE(${input.marginAmount}::numeric, margin_amount),
        updated_at = now(), updated_by = ${input.actorId}, version = version + 1
    WHERE id = ${input.id} AND tenant_id = erp.current_tenant_id()
      AND status = 'ISSUED'
    RETURNING ${LC_COLUMNS}`);
  return rows[0];
}

// ── the amendments (the dated typed changes) ────────────────────────────────

export interface LcAmendmentRow {
  id: string;
  lcId: string;
  amendmentNo: number;
  changeType: string;
  valueFrom: string | null;
  valueTo: string | null;
  expiryFrom: string | null;
  expiryTo: string | null;
  documentsNote: string | null;
  summary: string | null;
  effectiveAt: string;
  note: string | null;
  createdAt: string;
}

export async function nextAmendmentNo(lcId: string): Promise<number> {
  const rows = await query<{ n: number }>(sql`
    SELECT COALESCE(MAX(amendment_no), 0) + 1 AS n FROM lc_amendments
    WHERE lc_id = ${lcId} AND tenant_id = erp.current_tenant_id()`);
  return rows[0]!.n;
}

export async function insertLcAmendment(input: {
  lcId: string;
  amendmentNo: number;
  changeType: string;
  valueFrom: string | null;
  valueTo: string | null;
  expiryFrom: string | null;
  expiryTo: string | null;
  documentsNote: string | null;
  summary: string | null;
  effectiveAt: string;
  note: string | null;
  actorId: string | null;
}): Promise<LcAmendmentRow> {
  const rows = await query<LcAmendmentRow>(sql`
    INSERT INTO lc_amendments
      (id, tenant_id, lc_id, amendment_no, change_type, value_from, value_to,
       expiry_from, expiry_to, documents_note, summary, effective_at, note, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.lcId}, ${input.amendmentNo},
            ${input.changeType}, ${input.valueFrom}, ${input.valueTo}, ${input.expiryFrom},
            ${input.expiryTo}, ${input.documentsNote}, ${input.summary},
            ${input.effectiveAt}::timestamptz, ${input.note}, ${input.actorId})
    RETURNING id, lc_id AS "lcId", amendment_no AS "amendmentNo", change_type AS "changeType",
      value_from::text AS "valueFrom", value_to::text AS "valueTo",
      expiry_from::text AS "expiryFrom", expiry_to::text AS "expiryTo",
      documents_note AS "documentsNote", summary, effective_at::text AS "effectiveAt",
      note, created_at::text AS "createdAt"`);
  return rows[0]!;
}

export async function listLcAmendments(lcId: string): Promise<LcAmendmentRow[]> {
  return query<LcAmendmentRow>(sql`
    SELECT id, lc_id AS "lcId", amendment_no AS "amendmentNo", change_type AS "changeType",
      value_from::text AS "valueFrom", value_to::text AS "valueTo",
      expiry_from::text AS "expiryFrom", expiry_to::text AS "expiryTo",
      documents_note AS "documentsNote", summary, effective_at::text AS "effectiveAt",
      note, created_at::text AS "createdAt"
    FROM lc_amendments
    WHERE lc_id = ${lcId} AND tenant_id = erp.current_tenant_id()
    ORDER BY amendment_no`);
}

// ── the documents checklist (BR-105's own anchor) ───────────────────────────

export interface LcDocumentRow {
  id: string;
  lcId: string;
  docType: string;
  presented: boolean;
  presentedAt: string | null;
  verified: boolean;
  verifiedAt: string | null;
  discrepancyNotes: string | null;
  note: string | null;
  noteAr: string | null;
  updatedAt: string;
}

const DOCUMENT_COLUMNS = sql`id, lc_id AS "lcId", doc_type AS "docType", presented,
  presented_at::text AS "presentedAt", verified, verified_at::text AS "verifiedAt",
  discrepancy_notes AS "discrepancyNotes", note, note_ar AS "noteAr",
  updated_at::text AS "updatedAt"`;

export async function findLcDocument(lcId: string, docType: string): Promise<LcDocumentRow | undefined> {
  const rows = await query<LcDocumentRow>(sql`
    SELECT ${DOCUMENT_COLUMNS} FROM lc_documents
    WHERE lc_id = ${lcId} AND doc_type = ${docType} LIMIT 1`);
  return rows[0];
}

export async function insertLcDocument(input: {
  lcId: string;
  docType: string;
  presented: boolean;
  presentedAt: string | null;
  verified: boolean;
  verifiedAt: string | null;
  discrepancyNotes: string | null;
  actorId: string | null;
}): Promise<LcDocumentRow> {
  const rows = await query<LcDocumentRow>(sql`
    INSERT INTO lc_documents
      (id, tenant_id, lc_id, doc_type, presented, presented_at, verified, verified_at,
       discrepancy_notes, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.lcId}, ${input.docType},
            ${input.presented}, ${input.presentedAt}::timestamptz, ${input.verified},
            ${input.verifiedAt}::timestamptz, ${input.discrepancyNotes}, ${input.actorId})
    RETURNING ${DOCUMENT_COLUMNS}`);
  return rows[0]!;
}

export async function updateLcDocument(input: {
  id: string;
  presented: boolean;
  presentedAt: string | null;
  verified: boolean;
  verifiedAt: string | null;
  discrepancyNotes: string | null;
  actorId: string | null;
}): Promise<LcDocumentRow | undefined> {
  const rows = await query<LcDocumentRow>(sql`
    UPDATE lc_documents
    SET presented = ${input.presented}, presented_at = ${input.presentedAt}::timestamptz,
        verified = ${input.verified}, verified_at = ${input.verifiedAt}::timestamptz,
        discrepancy_notes = ${input.discrepancyNotes},
        updated_at = now(), updated_by = ${input.actorId}, version = version + 1
    WHERE id = ${input.id} AND tenant_id = erp.current_tenant_id()
    RETURNING ${DOCUMENT_COLUMNS}`);
  return rows[0];
}

export async function listLcDocuments(lcId: string): Promise<LcDocumentRow[]> {
  return query<LcDocumentRow>(sql`
    SELECT ${DOCUMENT_COLUMNS} FROM lc_documents
    WHERE lc_id = ${lcId} AND tenant_id = erp.current_tenant_id()
    ORDER BY doc_type`);
}

/** The LC's OPEN discrepancies — the unverified documents carrying
 * notes (the sweep's discrepancy arm reads them; zero parallel
 * computation — the checklist rows are the one source). */
export async function countLcOpenDiscrepancies(lcId: string): Promise<number> {
  const rows = await query<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM lc_documents
    WHERE lc_id = ${lcId} AND tenant_id = erp.current_tenant_id()
      AND discrepancy_notes IS NOT NULL AND verified = false`);
  return rows[0]!.n;
}

// ── the fee sequence (T-06 — the `fee_{seq}` INV-013 source key) ────────────

/**
 * The next fee sequence for an LC (the INV-028 `op_<seq>` precedent):
 * the count of the LC's existing `fee_%` journals + 1. The journal's
 * unique source index is the race floor — a raced double-submit of the
 * same sequence gets ALREADY_POSTED semantics (INV-013's own law).
 */
export async function nextLcFeeSequence(lcId: string): Promise<number> {
  const rows = await query<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM journal_entries
    WHERE source_type = 'letters_of_credit' AND source_id = ${lcId}
      AND operation LIKE 'fee_%' AND tenant_id = erp.current_tenant_id()`);
  return rows[0]!.n + 1;
}

// ── the sweep's probes (T-06 — the DB's own clock) ──────────────────────────

export interface LcExpiryRow {
  lcId: string;
  lcNo: string | null;
  expiryDate: string;
  beneficiaryName: string;
  currency: string;
  amount: string;
  openDiscrepancies: number;
}

/**
 * THE EXPIRY PROBE (the clock law — every date derived from the
 * DATABASE'S OWN CURRENT_DATE inside this SQL; the derived step
 * `expiry_date <= CURRENT_DATE + toDays`): the LIVE instruments (ISSUED
 * or EXPIRED — an expired instrument still alerts inside the open
 * lower edge's band) inside the band, each with its OPEN discrepancy
 * count (the discrepancy arm's own data — one probe, both families).
 */
export async function scanLcExpiry(input: {
  band: { threshold: number; fromDays: number | null; toDays: number };
  limit: number;
}): Promise<LcExpiryRow[]> {
  return query<LcExpiryRow>(sql`
    SELECT lc.id AS "lcId", lc.lc_no AS "lcNo", lc.expiry_date::text AS "expiryDate",
      lc.beneficiary_name AS "beneficiaryName", lc.currency, lc.amount::text AS "amount",
      (
        SELECT count(*)::int FROM lc_documents d
        WHERE d.lc_id = lc.id AND d.tenant_id = lc.tenant_id
          AND d.discrepancy_notes IS NOT NULL AND d.verified = false
      ) AS "openDiscrepancies"
    FROM letters_of_credit lc
    WHERE lc.tenant_id = erp.current_tenant_id()
      AND lc.status IN ('ISSUED', 'EXPIRED')
      AND lc.expiry_date <= (CURRENT_DATE + ${input.band.toDays}::int)
      AND (${input.band.fromDays ?? null}::int IS NULL
        OR lc.expiry_date > (CURRENT_DATE + ${input.band.fromDays ?? null}::int))
    ORDER BY lc.expiry_date, lc.id
    LIMIT ${input.limit}`);
}

/**
 * THE EXPIRY TRANSITION'S POPULATION (the DB's own clock decides —
 * ISSUED instruments whose expiry_date is strictly past CURRENT_DATE;
 * the sweep CAS-stamps each one; a re-run finds none — idempotent).
 */
export async function scanExpiredLcs(limit: number): Promise<LcRow[]> {
  return query<LcRow>(sql`
    SELECT ${LC_COLUMNS} FROM letters_of_credit
    WHERE tenant_id = erp.current_tenant_id() AND status = 'ISSUED'
      AND expiry_date < CURRENT_DATE
    ORDER BY expiry_date, id
    LIMIT ${limit}`);
}

// ── the sweep's settings + seal (the calibration pattern) ───────────────────

export interface LcSweepSettingsRow {
  key: string;
  value: readonly unknown[];
  updatedAt: string;
}

export async function findLcSweepSetting(): Promise<LcSweepSettingsRow | undefined> {
  const rows = await query<LcSweepSettingsRow>(sql`
    SELECT key, value, updated_at::text AS "updatedAt"
    FROM tenant_settings WHERE key = 'trade.lc_expiry_sweep_thresholds' LIMIT 1`);
  return rows[0];
}

export async function upsertLcSweepSetting(input: {
  value: readonly number[];
  actorId: string | null;
}): Promise<void> {
  await query<{ key: string }>(sql`
    INSERT INTO tenant_settings (id, tenant_id, key, value, updated_by)
    VALUES (${generateUuidV7()}, ${requireTenantContext().tenantId},
            'trade.lc_expiry_sweep_thresholds',
            ${JSON.stringify(input.value)}::jsonb, ${input.actorId})
    ON CONFLICT ("tenant_id", "key") DO UPDATE SET
      value = EXCLUDED.value, updated_at = now(),
      version = tenant_settings.version + 1, updated_by = EXCLUDED.updated_by`);
}

export async function lastLcSweepRun(): Promise<{
  at: string;
  outcome: { windows: number[]; flagged: number; notified: number; expired: number };
} | undefined> {
  const rows = await query<{ at: string; after: { windows: number[]; flagged: number; notified: number; expired: number } }>(sql`
    SELECT at::text AS at, after
    FROM audit_events
    WHERE action = 'trade.lc_expiry_sweep_run'
    ORDER BY at DESC LIMIT 1`);
  const row = rows[0];
  return row === undefined ? undefined : { at: row.at, outcome: row.after };
}

// ── the documentary collections (T-07 — the D/P vs D/A register, 0119) ──────

export interface CollectionRow {
  id: string;
  collectionNo: string;
  purchaseOrderId: string | null;
  termsType: string;
  amount: string;
  currency: string;
  dueDate: string | null;
  documents: readonly string[];
  status: string;
  presentedAt: string | null;
  acceptedAt: string | null;
  paidAt: string | null;
  settledAt: string | null;
  settlementRef: string | null;
  note: string | null;
  noteAr: string | null;
  createdAt: string;
  updatedAt: string;
}

const COLLECTION_COLUMNS = sql`id, collection_no AS "collectionNo",
  purchase_order_id AS "purchaseOrderId", terms_type AS "termsType", amount::text AS "amount",
  currency, due_date::text AS "dueDate", documents, status,
  presented_at::text AS "presentedAt", accepted_at::text AS "acceptedAt", paid_at::text AS "paidAt",
  settled_at::text AS "settledAt", settlement_ref AS "settlementRef", note, note_ar AS "noteAr",
  created_at::text AS "createdAt", updated_at::text AS "updatedAt"`;

export async function insertCollection(input: {
  collectionNo: string;
  purchaseOrderId: string | null;
  termsType: string;
  amount: string;
  currency: string;
  dueDate: string | null;
  documents: readonly string[];
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<CollectionRow> {
  const rows = await query<CollectionRow>(sql`
    INSERT INTO documentary_collections
      (id, tenant_id, collection_no, purchase_order_id, terms_type, amount, currency, due_date,
       documents, status, note, note_ar, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.collectionNo},
            ${input.purchaseOrderId}, ${input.termsType}, ${input.amount}, ${input.currency},
            ${input.dueDate}, ${JSON.stringify(input.documents)}::jsonb, 'OPEN',
            ${input.note}, ${input.noteAr}, ${input.actorId})
    RETURNING ${COLLECTION_COLUMNS}`);
  return rows[0]!;
}

export async function findCollectionById(id: string): Promise<CollectionRow | undefined> {
  const rows = await query<CollectionRow>(sql`
    SELECT ${COLLECTION_COLUMNS} FROM documentary_collections WHERE id = ${id} LIMIT 1`);
  return rows[0];
}

export async function findCollectionByNo(collectionNo: string): Promise<CollectionRow | undefined> {
  const rows = await query<CollectionRow>(sql`
    SELECT ${COLLECTION_COLUMNS} FROM documentary_collections WHERE collection_no = ${collectionNo} LIMIT 1`);
  return rows[0];
}

export async function listCollections(filter: { status?: string; limit?: number }): Promise<CollectionRow[]> {
  const status = filter.status ?? null;
  return query<CollectionRow>(sql`
    SELECT ${COLLECTION_COLUMNS} FROM documentary_collections
    WHERE (${status}::text IS NULL OR status = ${status})
    ORDER BY created_at DESC, id
    LIMIT ${filter.limit ?? 200}`);
}

/**
 * THE PRESENT STAMP (the CAS — OPEN pins the from-state; the
 * presentation stamp lands in the SAME statement, satisfying the 0119
 * XOR floor by the same write that consumes the stamp).
 */
export async function stampCollectionPresented(input: {
  id: string;
  actorId: string | null;
}): Promise<CollectionRow | undefined> {
  const rows = await query<CollectionRow>(sql`
    UPDATE documentary_collections
    SET status = 'PRESENTED', presented_at = now(),
        updated_at = now(), updated_by = ${input.actorId}, version = version + 1
    WHERE id = ${input.id} AND tenant_id = erp.current_tenant_id()
      AND status = 'OPEN'
    RETURNING ${COLLECTION_COLUMNS}`);
  return rows[0];
}

/**
 * THE ACCEPT STAMP (the CAS — PRESENTED pins the from-state; the
 * acceptance stamp lands in the SAME statement; the D/A-only gate is
 * the fold's verdict rendered at the service floor — a D/P row never
 * reaches this write).
 */
export async function stampCollectionAccepted(input: {
  id: string;
  actorId: string | null;
}): Promise<CollectionRow | undefined> {
  const rows = await query<CollectionRow>(sql`
    UPDATE documentary_collections
    SET status = 'ACCEPTED', accepted_at = now(),
        updated_at = now(), updated_by = ${input.actorId}, version = version + 1
    WHERE id = ${input.id} AND tenant_id = erp.current_tenant_id()
      AND status = 'PRESENTED' AND accepted_at IS NULL
    RETURNING ${COLLECTION_COLUMNS}`);
  return rows[0];
}

/**
 * THE SETTLE STAMP (the CAS — the paid stamps land TOGETHER: paid_at
 * + the settled pair in the SAME statement from the window the fold
 * allowed (PRESENTED on D/P at sight · ACCEPTED on D/A), the 0119
 * XOR floors satisfied by the same write that consumes the stamp).
 *
 * THE AT-SIGHT ACCEPTANCE (the 0119 accepted_shape floor's own
 * reading, recorded at the claim site): a PAID row carries the FULL
 * ceremony — presented_at AND accepted_at AND paid_at (the 0119
 * author's "ACCEPTED+ the acceptance" ladder wording: every rung
 * carries the stamps below it). For a D/P collection settling at
 * sight, the drawee's acceptance of the documents and the payment are
 * ONE banking event — the acceptance stamp lands TOGETHER with the
 * payment (COALESCE preserves a D/A's earlier explicit acceptance
 * rung, the usance gap: accepted_at < paid_at; a D/P's at-sight
 * record shows accepted_at = paid_at — the register's own evidence
 * tells the terms apart).
 */
export async function stampCollectionSettled(input: {
  id: string;
  settlementRef: string;
  actorId: string | null;
}): Promise<CollectionRow | undefined> {
  const rows = await query<CollectionRow>(sql`
    UPDATE documentary_collections
    SET status = 'PAID', paid_at = now(), settled_at = now(),
        accepted_at = COALESCE(accepted_at, now()),
        settlement_ref = ${input.settlementRef},
        updated_at = now(), updated_by = ${input.actorId}, version = version + 1
    WHERE id = ${input.id} AND tenant_id = erp.current_tenant_id()
      AND status IN ('PRESENTED', 'ACCEPTED')
      AND paid_at IS NULL AND settled_at IS NULL AND settlement_ref IS NULL
    RETURNING ${COLLECTION_COLUMNS}`);
  return rows[0];
}

/** THE CANCEL STAMP (the CAS — OPEN pins the from-state; the stamp
 * law's OPEN-only exit: a CANCELLED row never carries a stamp). */
export async function stampCollectionCancelled(input: {
  id: string;
  actorId: string | null;
}): Promise<CollectionRow | undefined> {
  const rows = await query<CollectionRow>(sql`
    UPDATE documentary_collections
    SET status = 'CANCELLED',
        updated_at = now(), updated_by = ${input.actorId}, version = version + 1
    WHERE id = ${input.id} AND tenant_id = erp.current_tenant_id()
      AND status = 'OPEN'
    RETURNING ${COLLECTION_COLUMNS}`);
  return rows[0];
}

// ── the incoterms registry (T-08 — the tenant-extensible rows, 0120) ────────

export interface IncotermRow {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  carriageBySeller: boolean;
  insuranceBySeller: boolean;
  exportClearanceBySeller: boolean;
  importClearanceBySeller: boolean;
  importDutyBySeller: boolean;
  isActive: boolean;
  note: string | null;
  noteAr: string | null;
  createdAt: string;
  updatedAt: string;
}

const INCOTERM_COLUMNS = sql`id, code, name, name_ar AS "nameAr", carriage_by_seller AS "carriageBySeller",
  insurance_by_seller AS "insuranceBySeller", export_clearance_by_seller AS "exportClearanceBySeller",
  import_clearance_by_seller AS "importClearanceBySeller", import_duty_by_seller AS "importDutyBySeller",
  is_active AS "isActive", note, note_ar AS "noteAr",
  created_at::text AS "createdAt", updated_at::text AS "updatedAt"`;

export async function insertIncoterm(input: {
  code: string;
  name: string;
  nameAr: string;
  carriageBySeller: boolean;
  insuranceBySeller: boolean;
  exportClearanceBySeller: boolean;
  importClearanceBySeller: boolean;
  importDutyBySeller: boolean;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<IncotermRow> {
  const rows = await query<IncotermRow>(sql`
    INSERT INTO incoterms
      (id, tenant_id, code, name, name_ar, carriage_by_seller, insurance_by_seller,
       export_clearance_by_seller, import_clearance_by_seller, import_duty_by_seller, note, note_ar, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.code}, ${input.name}, ${input.nameAr},
            ${input.carriageBySeller}, ${input.insuranceBySeller}, ${input.exportClearanceBySeller},
            ${input.importClearanceBySeller}, ${input.importDutyBySeller}, ${input.note}, ${input.noteAr},
            ${input.actorId})
    RETURNING ${INCOTERM_COLUMNS}`);
  return rows[0]!;
}

export async function findIncotermByCode(code: string): Promise<IncotermRow | undefined> {
  const rows = await query<IncotermRow>(sql`
    SELECT ${INCOTERM_COLUMNS} FROM incoterms WHERE code = ${code} LIMIT 1`);
  return rows[0];
}

export async function listIncoterms(filter: { activeOnly?: boolean; limit?: number }): Promise<IncotermRow[]> {
  const activeOnly = filter.activeOnly ?? true;
  return query<IncotermRow>(sql`
    SELECT ${INCOTERM_COLUMNS} FROM incoterms
    WHERE (${activeOnly}::boolean IS FALSE OR is_active = true)
    ORDER BY code
    LIMIT ${filter.limit ?? 200}`);
}

/** The registry row's UPDATE surface (the code NEVER moves — the
 * identity; the names, the matrix booleans and the active flag ride). */
export async function updateIncoterm(input: {
  id: string;
  name: string | null;
  nameAr: string | null;
  carriageBySeller: boolean | null;
  insuranceBySeller: boolean | null;
  exportClearanceBySeller: boolean | null;
  importClearanceBySeller: boolean | null;
  importDutyBySeller: boolean | null;
  isActive: boolean | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<IncotermRow | undefined> {
  const rows = await query<IncotermRow>(sql`
    UPDATE incoterms
    SET name = COALESCE(${input.name}, name),
        name_ar = COALESCE(${input.nameAr}, name_ar),
        carriage_by_seller = COALESCE(${input.carriageBySeller}, carriage_by_seller),
        insurance_by_seller = COALESCE(${input.insuranceBySeller}, insurance_by_seller),
        export_clearance_by_seller = COALESCE(${input.exportClearanceBySeller}, export_clearance_by_seller),
        import_clearance_by_seller = COALESCE(${input.importClearanceBySeller}, import_clearance_by_seller),
        import_duty_by_seller = COALESCE(${input.importDutyBySeller}, import_duty_by_seller),
        is_active = COALESCE(${input.isActive}, is_active),
        note = COALESCE(${input.note}, note),
        note_ar = COALESCE(${input.noteAr}, note_ar),
        updated_at = now(), updated_by = ${input.actorId}, version = version + 1
    WHERE id = ${input.id} AND tenant_id = erp.current_tenant_id()
    RETURNING ${INCOTERM_COLUMNS}`);
  return rows[0];
}

/** The active-code probe the order gates consume (the selector's own
 * floor — one probe, zero parallel computation). */
export async function findActiveIncotermByCode(code: string): Promise<IncotermRow | undefined> {
  const rows = await query<IncotermRow>(sql`
    SELECT ${INCOTERM_COLUMNS} FROM incoterms WHERE code = ${code} AND is_active = true LIMIT 1`);
  return rows[0];
}

// ── the transport documents (T-09 — the bills of lading + the packing lists, 0120) ──

export interface BillOfLadingRow {
  id: string;
  blNo: string;
  docType: string;
  carrierName: string;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  containerRefs: readonly string[];
  purchaseOrderId: string | null;
  deliveryNoteId: string | null;
  shipmentStatus: string;
  issuedAt: string;
  note: string | null;
  noteAr: string | null;
  createdAt: string;
  updatedAt: string;
}

const BL_COLUMNS = sql`id, bl_no AS "blNo", doc_type AS "docType", carrier_name AS "carrierName",
  port_of_loading AS "portOfLoading", port_of_discharge AS "portOfDischarge", container_refs,
  purchase_order_id AS "purchaseOrderId", delivery_note_id AS "deliveryNoteId",
  shipment_status AS "shipmentStatus", issued_at::text AS "issuedAt", note, note_ar AS "noteAr",
  created_at::text AS "createdAt", updated_at::text AS "updatedAt"`;

export async function insertBl(input: {
  blNo: string;
  docType: string;
  carrierName: string;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  containerRefs: readonly string[];
  purchaseOrderId: string | null;
  deliveryNoteId: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<BillOfLadingRow> {
  const rows = await query<BillOfLadingRow>(sql`
    INSERT INTO bills_of_lading
      (id, tenant_id, bl_no, doc_type, carrier_name, port_of_loading, port_of_discharge,
       container_refs, purchase_order_id, delivery_note_id, shipment_status, note, note_ar, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.blNo}, ${input.docType},
            ${input.carrierName}, ${input.portOfLoading}, ${input.portOfDischarge},
            ${JSON.stringify(input.containerRefs)}::jsonb, ${input.purchaseOrderId},
            ${input.deliveryNoteId}, 'BOOKED', ${input.note}, ${input.noteAr}, ${input.actorId})
    RETURNING ${BL_COLUMNS}`);
  return rows[0]!;
}

export async function findBlById(id: string): Promise<BillOfLadingRow | undefined> {
  const rows = await query<BillOfLadingRow>(sql`
    SELECT ${BL_COLUMNS} FROM bills_of_lading WHERE id = ${id} LIMIT 1`);
  return rows[0];
}

export async function findBlByNo(blNo: string): Promise<BillOfLadingRow | undefined> {
  const rows = await query<BillOfLadingRow>(sql`
    SELECT ${BL_COLUMNS} FROM bills_of_lading WHERE bl_no = ${blNo} LIMIT 1`);
  return rows[0];
}

export async function listBls(filter: { docType?: string; shipmentStatus?: string; limit?: number }): Promise<BillOfLadingRow[]> {
  const docType = filter.docType ?? null;
  const status = filter.shipmentStatus ?? null;
  return query<BillOfLadingRow>(sql`
    SELECT ${BL_COLUMNS} FROM bills_of_lading
    WHERE (${docType}::text IS NULL OR doc_type = ${docType})
      AND (${status}::text IS NULL OR shipment_status = ${status})
    ORDER BY created_at DESC, id
    LIMIT ${filter.limit ?? 200}`);
}

export interface PackingListRow {
  id: string;
  plNo: string;
  billOfLadingId: string | null;
  receiptId: string | null;
  lines: readonly Record<string, unknown>[];
  shipmentStatus: string;
  issuedAt: string;
  note: string | null;
  noteAr: string | null;
  createdAt: string;
  updatedAt: string;
}

const PL_COLUMNS = sql`id, pl_no AS "plNo", bill_of_lading_id AS "billOfLadingId",
  receipt_id AS "receiptId", lines, shipment_status AS "shipmentStatus",
  issued_at::text AS "issuedAt", note, note_ar AS "noteAr",
  created_at::text AS "createdAt", updated_at::text AS "updatedAt"`;

export async function insertPackingList(input: {
  plNo: string;
  billOfLadingId: string;
  receiptId: string | null;
  lines: readonly Record<string, unknown>[];
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<PackingListRow> {
  const rows = await query<PackingListRow>(sql`
    INSERT INTO packing_lists
      (id, tenant_id, pl_no, bill_of_lading_id, receipt_id, lines, shipment_status, note, note_ar, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.plNo}, ${input.billOfLadingId},
            ${input.receiptId}, ${JSON.stringify(input.lines)}::jsonb, 'BOOKED',
            ${input.note}, ${input.noteAr}, ${input.actorId})
    RETURNING ${PL_COLUMNS}`);
  return rows[0]!;
}

export async function findPackingListByNo(plNo: string): Promise<PackingListRow | undefined> {
  const rows = await query<PackingListRow>(sql`
    SELECT ${PL_COLUMNS} FROM packing_lists WHERE pl_no = ${plNo} LIMIT 1`);
  return rows[0];
}

export async function listPackingLists(filter: { billOfLadingId?: string; limit?: number }): Promise<PackingListRow[]> {
  const blId = filter.billOfLadingId ?? null;
  return query<PackingListRow>(sql`
    SELECT ${PL_COLUMNS} FROM packing_lists
    WHERE (${blId}::uuid IS NULL OR bill_of_lading_id = ${blId})
    ORDER BY created_at DESC, id
    LIMIT ${filter.limit ?? 200}`);
}

// ── the shipment tracking events (T-13 — the append-only log, 0122) ─────────

export interface TrackingEventRow {
  id: string;
  billOfLadingId: string;
  declarationId: string | null;
  milestone: string;
  eventAt: string;
  carrierRef: string | null;
  location: string | null;
  note: string | null;
  noteAr: string | null;
  createdAt: string;
}

const EVENT_COLUMNS = sql`id, bill_of_lading_id AS "billOfLadingId", declaration_id AS "declarationId",
  milestone, event_at::text AS "eventAt", carrier_ref AS "carrierRef", location, note, note_ar AS "noteAr",
  created_at::text AS "createdAt"`;

export async function insertTrackingEvent(input: {
  billOfLadingId: string;
  declarationId: string | null;
  milestone: string;
  eventAt: string;
  carrierRef: string | null;
  location: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<TrackingEventRow> {
  const rows = await query<TrackingEventRow>(sql`
    INSERT INTO shipment_tracking_events
      (id, tenant_id, bill_of_lading_id, declaration_id, milestone, event_at, carrier_ref, location, note, note_ar, created_by)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${input.billOfLadingId}, ${input.declarationId},
            ${input.milestone}, ${input.eventAt}::timestamptz, ${input.carrierRef}, ${input.location},
            ${input.note}, ${input.noteAr}, ${input.actorId})
    RETURNING ${EVENT_COLUMNS}`);
  return rows[0]!;
}

export async function listTrackingEvents(filter: { billOfLadingId?: string; declarationId?: string; limit?: number }): Promise<TrackingEventRow[]> {
  const blId = filter.billOfLadingId ?? null;
  const declarationId = filter.declarationId ?? null;
  return query<TrackingEventRow>(sql`
    SELECT ${EVENT_COLUMNS} FROM shipment_tracking_events
    WHERE (${blId}::uuid IS NULL OR bill_of_lading_id = ${blId})
      AND (${declarationId}::uuid IS NULL OR declaration_id = ${declarationId})
    ORDER BY event_at, id
    LIMIT ${filter.limit ?? 200}`);
}

/**
 * THE DRIVE'S CAS STAMPS (D-14 — the fold's ADVANCE verdicts rendered as
 * race-free writes): each update pins the from-rung (the monotone law's
 * own protection — a raced status never regresses, the loser's zero
 * rows mean the fold's verdict is re-derived on the next event).
 */
export async function advanceBlShipmentStatus(input: {
  id: string;
  from: string;
  to: string;
}): Promise<BillOfLadingRow | undefined> {
  const rows = await query<BillOfLadingRow>(sql`
    UPDATE bills_of_lading
    SET shipment_status = ${input.to}, updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND tenant_id = erp.current_tenant_id()
      AND shipment_status = ${input.from}
    RETURNING ${BL_COLUMNS}`);
  return rows[0];
}

export async function advancePackingListShipmentStatus(input: {
  id: string;
  from: string;
  to: string;
}): Promise<PackingListRow | undefined> {
  const rows = await query<PackingListRow>(sql`
    UPDATE packing_lists
    SET shipment_status = ${input.to}, updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND tenant_id = erp.current_tenant_id()
      AND shipment_status = ${input.from}
    RETURNING ${PL_COLUMNS}`);
  return rows[0];
}

export async function advanceDeclarationShipmentStatus(input: {
  id: string;
  from: string;
  to: string;
}): Promise<{ id: string; shipmentStatus: string } | undefined> {
  const rows = await query<{ id: string; shipmentStatus: string }>(sql`
    UPDATE customs_declarations
    SET shipment_status = ${input.to}, updated_at = now(), version = version + 1
    WHERE id = ${input.id} AND tenant_id = erp.current_tenant_id()
      AND shipment_status = ${input.from}
    RETURNING id, shipment_status AS "shipmentStatus"`);
  return rows[0];
}

/** The event's declaration-link probe (the typed 404 surface — a
 * read-only check; the declarations ENGINE is W-37's own wave, this is
 * the tracking event's documented-contract read). */
export async function findDeclarationShipmentStatus(id: string): Promise<{ id: string; shipmentStatus: string } | undefined> {
  const rows = await query<{ id: string; shipmentStatus: string }>(sql`
    SELECT id, shipment_status AS "shipmentStatus" FROM customs_declarations
    WHERE id = ${id} LIMIT 1`);
  return rows[0];
}
