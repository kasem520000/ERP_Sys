import { sql } from "drizzle-orm";

import { generateUuidV7 } from "@erp/domain-core";

import { type TenantDb } from "../../../infra/db/client";
import { requireTenantContext } from "../../../infra/db/tenant-context";

/**
 * PHASE-048 (W-11 — T-10 + T-11 + T-12) — the contracting store: the
 * ONLY writer for the 0103-contracting family's rows this wave owns
 * (subcontractor_agreements + subcontractor_certificates +
 * retention_accounts + progress_certificates + the certificates'
 * generated sales invoices — the projects.store/change-order.store
 * precedents: one store per wave's family). All reads run under the
 * ambient tenant UoW (RLS); every numeric field crosses the boundary
 * as an EXACT decimal string (::text, never a JS number — ADR-0009's
 * law).
 *
 * THE WRITE SHAPES:
 *
 * - THE CAS LADDERS: `casSubcontractAgreementStatus` (DRAFT → ACTIVE →
 *   CLOSED / DRAFT|ACTIVE → CANCELLED — the lifecycle stamps
 *   activated_at/closed_at/cancel_reason land in the SAME guarded
 *   statement, satisfying 0103's lifecycle CHECK atomically),
 *   `casSubcontractCertificateStatus` (DRAFT → APPROVED/VOID — the
 *   approval stamps atomic), `casProgressCertificateStatus` (DRAFT →
 *   SUBMITTED → APPROVED / DRAFT|SUBMITTED → VOID — the verdict stamps
 *   atomic, 0103's approval-link CHECK) — each ONE UPDATE … WHERE id
 *   AND status = ${from}; zero rows = the raced/stale move (the
 *   talent/budget/change-order CAS precedents).
 * - THE SINGLE-CONSUMPTION STAMPS: `stampSubCertificateApJournal`
 *   (the AP linkage's journal — guarded on the NULL stamp, the
 *   D-07/effect_applied_at precedent) and `stampCertificateInvoice`
 *   (the generated invoice — guarded on the NULL sales_invoice_id).
 * - THE RETENTION LEDGER: the CUSTOMER register (the commercial spine
 *   + the contract's customer, 0104's column) and the SUBCONTRACTOR
 *   rows (one per agreement, the terms read from the agreement — the
 *   0103 side law); `accrueRetention` (the hold) and
 *   `casReleaseRetention` (G-56's single-use release — status ACTIVE →
 *   RELEASED with released_amount = the accrued balance, in the SAME
 *   guarded statement).
 * - THE AMORTIZATION STATE: `applyAdvanceAmount` folds the apply
 *   slices into `advance_applied_amount` (0104's column; the table's
 *   own CHECK (applied ≤ gross, ADVANCE-only) is the structural
 *   floor).
 * - THE CERTIFICATE INVOICE: `insertCertificateInvoice` writes the
 *   generated billing document directly in its POSTED shape (the
 *   certificate's approval IS the approval — the posting is the G-57
 *   journal minted through the REAL PostingService by the service;
 *   this row is the billing evidence, `posted_journal_id` = that
 *   entry; the 0018 posted-shape CHECK satisfied atomically).
 *
 * THE READS (each names its consumer): the agreement + its partner
 * (the AP stamp + the sub terms — BR-092 per agreement), the
 * certificates' rows, the register (the ceiling base + the customer +
 * the release gates — W-10's gate reads the same row through its own
 * narrower projection), the sub retention row, the APPROVED gross sum
 * (BR-093's ceiling read — the 0103 partial index is this path), and
 * the open advances (the amortization's oldest-first read).
 */

function tenantTx(): TenantDb {
  const context = requireTenantContext();
  if (context.tx === undefined) {
    throw new Error("projects-plane access requires an ambient tenant scope");
  }
  return context.tx;
}

// ── the row shapes ─────────────────────────────────────────────────────────

export interface SubcontractAgreementRow {
  id: string;
  projectId: string;
  partnerId: string;
  agreementNo: string;
  title: string;
  titleAr: string | null;
  scope: string | null;
  agreementValue: string;
  currencyCode: string;
  retentionPercent: string;
  startDate: string | null;
  endDate: string | null;
  status: string;
  activatedAt: string | null;
  closedAt: string | null;
  cancelReason: string | null;
  note: string | null;
  noteAr: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const AGREEMENT_COLUMNS = sql`
  id, project_id AS "projectId", partner_id AS "partnerId", agreement_no AS "agreementNo",
  title, title_ar AS "titleAr", scope, agreement_value::text AS "agreementValue",
  currency_code AS "currencyCode", retention_percent::text AS "retentionPercent",
  start_date::text AS "startDate", end_date::text AS "endDate", status,
  activated_at::text AS "activatedAt", closed_at::text AS "closedAt",
  cancel_reason AS "cancelReason", note, note_ar AS "noteAr",
  version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
`;

export interface SubcontractCertificateRow {
  id: string;
  agreementId: string;
  certificateNo: string | null;
  certificateDate: string;
  progressPercent: string;
  grossValue: string;
  retentionWithheld: string;
  netPayable: string;
  status: string;
  approvedAt: string | null;
  apJournalEntryId: string | null;
  note: string | null;
  noteAr: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const SUB_CERTIFICATE_COLUMNS = sql`
  id, agreement_id AS "agreementId", certificate_no AS "certificateNo",
  certificate_date::text AS "certificateDate", progress_percent::text AS "progressPercent",
  gross_value::text AS "grossValue", retention_withheld::text AS "retentionWithheld",
  net_payable::text AS "netPayable", status, approved_at::text AS "approvedAt",
  ap_journal_entry_id AS "apJournalEntryId", note, note_ar AS "noteAr",
  version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
`;

export interface RetentionAccountRow {
  id: string;
  projectId: string;
  kind: string;
  subcontractorAgreementId: string | null;
  customerId: string | null;
  contractValue: string | null;
  currencyCode: string | null;
  holdPercent: string | null;
  accruedBalance: string;
  releasedAmount: string;
  takingOverDate: string | null;
  defectLiabilityDate: string | null;
  status: string;
  releasedAt: string | null;
  note: string | null;
  noteAr: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const RETENTION_COLUMNS = sql`
  id, project_id AS "projectId", kind, subcontractor_agreement_id AS "subcontractorAgreementId",
  customer_id AS "customerId", contract_value::text AS "contractValue",
  currency_code AS "currencyCode", hold_percent::text AS "holdPercent",
  accrued_balance::text AS "accruedBalance", released_amount::text AS "releasedAmount",
  taking_over_date::text AS "takingOverDate", defect_liability_date::text AS "defectLiabilityDate",
  status, released_at::text AS "releasedAt", note, note_ar AS "noteAr",
  version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
`;

export interface ProgressCertificateRow {
  id: string;
  projectId: string;
  certificateNo: string | null;
  certificateDate: string;
  kind: string;
  cumulativePercent: string;
  grossValue: string;
  retentionAmount: string;
  netValue: string;
  currencyCode: string;
  status: string;
  submittedAt: string | null;
  approvedAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  salesInvoiceId: string | null;
  advanceAppliedAmount: string;
  note: string | null;
  noteAr: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

const PROGRESS_CERTIFICATE_COLUMNS = sql`
  id, project_id AS "projectId", certificate_no AS "certificateNo",
  certificate_date::text AS "certificateDate", kind,
  cumulative_percent::text AS "cumulativePercent", gross_value::text AS "grossValue",
  retention_amount::text AS "retentionAmount", net_value::text AS "netValue",
  currency_code AS "currencyCode", status, submitted_at::text AS "submittedAt",
  approved_at::text AS "approvedAt", voided_at::text AS "voidedAt", void_reason AS "voidReason",
  sales_invoice_id AS "salesInvoiceId", advance_applied_amount::text AS "advanceAppliedAmount",
  note, note_ar AS "noteAr", version, created_at::text AS "createdAt", updated_at::text AS "updatedAt"
`;

// ── T-10: the subcontractor agreements (D-08) ──────────────────────────────

export async function insertSubcontractAgreement(input: {
  projectId: string;
  partnerId: string;
  agreementNo: string;
  title: string;
  titleAr: string | null;
  scope: string | null;
  agreementValue: string;
  currencyCode: string;
  retentionPercent: string;
  startDate: string | null;
  endDate: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<SubcontractAgreementRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO subcontractor_agreements (id, tenant_id, created_by, project_id, partner_id,
                                           agreement_no, title, title_ar, scope, agreement_value,
                                           currency_code, retention_percent, start_date, end_date,
                                           note, note_ar)
    VALUES (${id}, erp.current_tenant_id(), ${input.actorId}, ${input.projectId}, ${input.partnerId},
            ${input.agreementNo}, ${input.title}, ${input.titleAr}, ${input.scope},
            ${input.agreementValue}, ${input.currencyCode}, ${input.retentionPercent},
            ${input.startDate}, ${input.endDate}, ${input.note}, ${input.noteAr})
  `);
  const rows = await tx.execute(sql`
    SELECT ${AGREEMENT_COLUMNS} FROM subcontractor_agreements WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as SubcontractAgreementRow[])[0]!;
}

export async function findSubcontractAgreementById(
  id: string,
): Promise<SubcontractAgreementRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${AGREEMENT_COLUMNS} FROM subcontractor_agreements WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as SubcontractAgreementRow[])[0];
}

export async function listSubcontractAgreements(
  projectId: string,
): Promise<SubcontractAgreementRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${AGREEMENT_COLUMNS} FROM subcontractor_agreements
    WHERE project_id = ${projectId}
    ORDER BY created_at, id
  `);
  return rows.rows as unknown as SubcontractAgreementRow[];
}

/**
 * The agreement lifecycle CAS (the talent/budget/change-order
 * precedents): ONE UPDATE guarded by the from-status; the lifecycle
 * stamps (activated_at / closed_at / cancel_reason) land in the SAME
 * statement — 0103's lifecycle CHECK is satisfied atomically. The
 * service owns the legal ladder (DRAFT→ACTIVE · ACTIVE→CLOSED ·
 * DRAFT|ACTIVE→CANCELLED with the mandatory reason).
 */
export async function casSubcontractAgreementStatus(input: {
  id: string;
  from: string;
  to: string;
  actorId: string | null;
  cancelReason?: string;
}): Promise<SubcontractAgreementRow | undefined> {
  const toActive = input.to === "ACTIVE";
  const toClosed = input.to === "CLOSED";
  const toCancelled = input.to === "CANCELLED";
  const rows = await tenantTx().execute(sql`
    UPDATE subcontractor_agreements SET
      status = ${input.to},
      activated_at = CASE WHEN ${toActive} THEN now() ELSE activated_at END,
      closed_at = CASE WHEN ${toClosed} THEN now() ELSE closed_at END,
      cancel_reason = CASE WHEN ${toCancelled} THEN ${input.cancelReason ?? null}
                           ELSE cancel_reason END,
      version = version + 1, updated_at = now(), updated_by = ${input.actorId}
    WHERE id = ${input.id} AND status = ${input.from}
    RETURNING id
  `);
  if (rows.rows.length === 0) return undefined;
  return findSubcontractAgreementById(input.id);
}

// ── T-10: the subcontractor certificates (D-08 — the sub مستخلص) ───────────

export async function insertSubcontractCertificate(input: {
  agreementId: string;
  certificateNo: string | null;
  certificateDate: string;
  progressPercent: string;
  grossValue: string;
  retentionWithheld: string;
  netPayable: string;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<SubcontractCertificateRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO subcontractor_certificates (id, tenant_id, created_by, agreement_id,
                                             certificate_no, certificate_date, progress_percent,
                                             gross_value, retention_withheld, net_payable,
                                             note, note_ar)
    VALUES (${id}, erp.current_tenant_id(), ${input.actorId}, ${input.agreementId},
            ${input.certificateNo}, ${input.certificateDate}, ${input.progressPercent},
            ${input.grossValue}, ${input.retentionWithheld}, ${input.netPayable},
            ${input.note}, ${input.noteAr})
  `);
  const rows = await tx.execute(sql`
    SELECT ${SUB_CERTIFICATE_COLUMNS} FROM subcontractor_certificates WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as SubcontractCertificateRow[])[0]!;
}

export async function findSubcontractCertificateById(
  id: string,
): Promise<SubcontractCertificateRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${SUB_CERTIFICATE_COLUMNS} FROM subcontractor_certificates WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as SubcontractCertificateRow[])[0];
}

export async function listSubcontractCertificates(
  agreementId: string,
): Promise<SubcontractCertificateRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${SUB_CERTIFICATE_COLUMNS} FROM subcontractor_certificates
    WHERE agreement_id = ${agreementId}
    ORDER BY certificate_date, created_at, id
  `);
  return rows.rows as unknown as SubcontractCertificateRow[];
}

/** DRAFT → APPROVED/VOID — the verdict stamps (approved_at/approved_by)
 * land in the SAME guarded CAS (0103's approval-link CHECK). */
export async function casSubcontractCertificateStatus(input: {
  id: string;
  from: string;
  to: string;
  actorId: string | null;
}): Promise<SubcontractCertificateRow | undefined> {
  const toApproved = input.to === "APPROVED";
  const rows = await tenantTx().execute(sql`
    UPDATE subcontractor_certificates SET
      status = ${input.to},
      approved_at = CASE WHEN ${toApproved} THEN now() ELSE approved_at END,
      approved_by = CASE WHEN ${toApproved} THEN ${input.actorId} ELSE approved_by END,
      version = version + 1, updated_at = now(), updated_by = ${input.actorId}
    WHERE id = ${input.id} AND status = ${input.from}
    RETURNING id
  `);
  if (rows.rows.length === 0) return undefined;
  return findSubcontractCertificateById(input.id);
}

/**
 * THE AP LINKAGE'S SINGLE-CONSUMPTION STAMP (0104): the journal that
 * drove the certificate's obligation into AP — written ONLY after the
 * postings succeeded, in the same ambient transaction; the guarded
 * UPDATE refuses a second linkage (the effect_applied_at precedent).
 */
export async function stampSubCertificateApJournal(
  id: string,
  journalEntryId: string,
): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    UPDATE subcontractor_certificates SET
      ap_journal_entry_id = ${journalEntryId},
      version = version + 1, updated_at = now()
    WHERE id = ${id} AND status = 'APPROVED' AND ap_journal_entry_id IS NULL
    RETURNING id
  `);
  return rows.rows.length > 0;
}

// ── T-11: the retention ledger (D-09 — G-55/G-56's rows) ───────────────────

export async function insertCustomerRetentionRegister(input: {
  projectId: string;
  customerId: string;
  contractValue: string;
  currencyCode: string;
  holdPercent: string;
  takingOverDate: string | null;
  defectLiabilityDate: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<RetentionAccountRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO retention_accounts (id, tenant_id, created_by, project_id, kind, customer_id,
                                    contract_value, currency_code, hold_percent,
                                    taking_over_date, defect_liability_date, note, note_ar)
    VALUES (${id}, erp.current_tenant_id(), ${input.actorId}, ${input.projectId}, 'CUSTOMER',
            ${input.customerId}, ${input.contractValue}, ${input.currencyCode}, ${input.holdPercent},
            ${input.takingOverDate}, ${input.defectLiabilityDate}, ${input.note}, ${input.noteAr})
  `);
  const rows = await tx.execute(sql`
    SELECT ${RETENTION_COLUMNS} FROM retention_accounts WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as RetentionAccountRow[])[0]!;
}

/** The CUSTOMER register — the contract's commercial spine (the
 * ceiling's base + the contract's customer + the release schedule).
 * W-10's gate reads the same row through its own narrower projection. */
export async function findCustomerRetentionRegister(
  projectId: string,
): Promise<RetentionAccountRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${RETENTION_COLUMNS} FROM retention_accounts
    WHERE project_id = ${projectId} AND kind = 'CUSTOMER'
    LIMIT 1
  `);
  return (rows.rows as unknown as RetentionAccountRow[])[0];
}

/** The patchable terms (the hold % + the release schedule + the
 * notes) — the immutable core (value/currency/customer) is refused at
 * the SERVICE (the gate is the only re-planning path). */
export async function patchRetentionRegister(input: {
  id: string;
  holdPercent: string | null;
  takingOverDate: string | null;
  defectLiabilityDate: string | null;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<RetentionAccountRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE retention_accounts SET
      hold_percent = COALESCE(${input.holdPercent}, hold_percent),
      taking_over_date = COALESCE(${input.takingOverDate}, taking_over_date),
      defect_liability_date = COALESCE(${input.defectLiabilityDate}, defect_liability_date),
      note = COALESCE(${input.note}, note),
      note_ar = COALESCE(${input.noteAr}, note_ar),
      version = version + 1, updated_at = now(), updated_by = ${input.actorId}
    WHERE id = ${input.id} AND status = 'ACTIVE'
    RETURNING id
  `);
  if (rows.rows.length === 0) return undefined;
  const after = await tenantTx().execute(sql`
    SELECT ${RETENTION_COLUMNS} FROM retention_accounts WHERE id = ${input.id} LIMIT 1
  `);
  return (after.rows as unknown as RetentionAccountRow[])[0];
}

/** The SUBCONTRACTOR row at agreement ACTIVATION — the SAME retention
 * ledger (D-08's law); the commercial columns stay NULL (the terms
 * read from the agreement — the 0103 side law). */
export async function insertSubcontractorRetentionRow(input: {
  projectId: string;
  agreementId: string;
  note: string | null;
  actorId: string | null;
}): Promise<RetentionAccountRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO retention_accounts (id, tenant_id, created_by, project_id, kind,
                                    subcontractor_agreement_id, note)
    VALUES (${id}, erp.current_tenant_id(), ${input.actorId}, ${input.projectId},
            'SUBCONTRACTOR', ${input.agreementId}, ${input.note})
  `);
  const rows = await tx.execute(sql`
    SELECT ${RETENTION_COLUMNS} FROM retention_accounts WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as RetentionAccountRow[])[0]!;
}

export async function findSubcontractorRetentionRow(
  agreementId: string,
): Promise<RetentionAccountRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${RETENTION_COLUMNS} FROM retention_accounts
    WHERE subcontractor_agreement_id = ${agreementId} AND kind = 'SUBCONTRACTOR'
    LIMIT 1
  `);
  return (rows.rows as unknown as RetentionAccountRow[])[0];
}

export async function findRetentionAccountById(
  id: string,
): Promise<RetentionAccountRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${RETENTION_COLUMNS} FROM retention_accounts WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as RetentionAccountRow[])[0];
}

/** The whole ledger view for a project (the customer register + every
 * sub row — the W-13 screen's read). */
export async function listRetentionLedger(projectId: string): Promise<RetentionAccountRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${RETENTION_COLUMNS} FROM retention_accounts
    WHERE project_id = ${projectId}
    ORDER BY kind DESC, created_at, id
  `);
  return rows.rows as unknown as RetentionAccountRow[];
}

/** G-55's accrual: the withheld retention lands on the ledger row
 * (inside the certificate's approval transaction — the CAS above is
 * the single-consumption guard). */
export async function accrueRetention(id: string, amount: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE retention_accounts SET
      accrued_balance = accrued_balance + ${amount},
      version = version + 1, updated_at = now()
    WHERE id = ${id}
  `);
}

/**
 * G-56's single-use release CAS: status ACTIVE → RELEASED with
 * released_amount = the accrued balance and released_at in the SAME
 * guarded statement — a second release reads zero rows (the typed
 * refusal at the service). Called ONLY after the release posting
 * succeeded, inside the same ambient transaction.
 */
export async function casReleaseRetention(input: {
  id: string;
  actorId: string | null;
}): Promise<RetentionAccountRow | undefined> {
  const rows = await tenantTx().execute(sql`
    UPDATE retention_accounts SET
      status = 'RELEASED',
      released_amount = accrued_balance,
      released_at = now(),
      version = version + 1, updated_at = now(), updated_by = ${input.actorId}
    WHERE id = ${input.id} AND status = 'ACTIVE'
    RETURNING id
  `);
  if (rows.rows.length === 0) return undefined;
  const after = await tenantTx().execute(sql`
    SELECT ${RETENTION_COLUMNS} FROM retention_accounts WHERE id = ${input.id} LIMIT 1
  `);
  return (after.rows as unknown as RetentionAccountRow[])[0];
}

// ── T-12: the progress certificates (D-10 — the customer billing) ──────────

export async function insertProgressCertificate(input: {
  projectId: string;
  certificateNo: string | null;
  certificateDate: string;
  kind: string;
  cumulativePercent: string;
  grossValue: string;
  retentionAmount: string;
  netValue: string;
  currencyCode: string;
  note: string | null;
  noteAr: string | null;
  actorId: string | null;
}): Promise<ProgressCertificateRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO progress_certificates (id, tenant_id, created_by, project_id, certificate_no,
                                       certificate_date, kind, cumulative_percent, gross_value,
                                       retention_amount, net_value, currency_code, note, note_ar)
    VALUES (${id}, erp.current_tenant_id(), ${input.actorId}, ${input.projectId},
            ${input.certificateNo}, ${input.certificateDate}, ${input.kind},
            ${input.cumulativePercent}, ${input.grossValue}, ${input.retentionAmount},
            ${input.netValue}, ${input.currencyCode}, ${input.note}, ${input.noteAr})
  `);
  const rows = await tx.execute(sql`
    SELECT ${PROGRESS_CERTIFICATE_COLUMNS} FROM progress_certificates WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ProgressCertificateRow[])[0]!;
}

export async function findProgressCertificateById(
  id: string,
): Promise<ProgressCertificateRow | undefined> {
  const rows = await tenantTx().execute(sql`
    SELECT ${PROGRESS_CERTIFICATE_COLUMNS} FROM progress_certificates WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as ProgressCertificateRow[])[0];
}

export async function listProgressCertificates(
  projectId: string,
): Promise<ProgressCertificateRow[]> {
  const rows = await tenantTx().execute(sql`
    SELECT ${PROGRESS_CERTIFICATE_COLUMNS} FROM progress_certificates
    WHERE project_id = ${projectId}
    ORDER BY certificate_date, created_at, id
  `);
  return rows.rows as unknown as ProgressCertificateRow[];
}

/** DRAFT → SUBMITTED → APPROVED / DRAFT|SUBMITTED → VOID — the verdict
 * stamps land in the SAME guarded CAS (0103's approval-link + the
 * submission CHECKs). */
export async function casProgressCertificateStatus(input: {
  id: string;
  from: string;
  to: string;
  actorId: string | null;
  voidReason?: string;
}): Promise<ProgressCertificateRow | undefined> {
  const toSubmitted = input.to === "SUBMITTED";
  const toApproved = input.to === "APPROVED";
  const toVoid = input.to === "VOID";
  const rows = await tenantTx().execute(sql`
    UPDATE progress_certificates SET
      status = ${input.to},
      submitted_at = CASE WHEN ${toSubmitted} THEN now() ELSE submitted_at END,
      submitted_by = CASE WHEN ${toSubmitted} THEN ${input.actorId} ELSE submitted_by END,
      approved_at = CASE WHEN ${toApproved} THEN now() ELSE approved_at END,
      approved_by = CASE WHEN ${toApproved} THEN ${input.actorId} ELSE approved_by END,
      voided_at = CASE WHEN ${toVoid} THEN now() ELSE voided_at END,
      void_reason = CASE WHEN ${toVoid} THEN ${input.voidReason ?? null} ELSE void_reason END,
      version = version + 1, updated_at = now(), updated_by = ${input.actorId}
    WHERE id = ${input.id} AND status = ${input.from}
    RETURNING id
  `);
  if (rows.rows.length === 0) return undefined;
  return findProgressCertificateById(input.id);
}

/**
 * BR-093's ceiling read: Σ the APPROVED certificates' gross (ALL kinds
 * — the advances bill against the same contract) — the 0103 partial
 * index (tenant, project) WHERE status='APPROVED' is this path; the
 * DRAFT/SUBMITTED/VOID rows never enter.
 */
export async function approvedGrossSum(projectId: string): Promise<{
  count: number;
  grossSum: string;
}> {
  const rows = await tenantTx().execute<{ n: number; gross: string }>(sql`
    SELECT count(*)::int AS n, COALESCE(SUM(gross_value), 0)::numeric(19,4)::text AS gross
    FROM progress_certificates
    WHERE project_id = ${projectId} AND status = 'APPROVED'
  `);
  const row = rows.rows[0];
  return { count: row?.n ?? 0, grossSum: row?.gross ?? "0.0000" };
}

/** THE INVOICE STAMP (single-consumption): the generated invoice lands
 * ONLY on the approved path, guarded on the NULL stamp (0103's
 * invoice_gated CHECK floor; a second generation refuses). */
export async function stampCertificateInvoice(
  id: string,
  invoiceId: string,
): Promise<boolean> {
  const rows = await tenantTx().execute(sql`
    UPDATE progress_certificates SET
      sales_invoice_id = ${invoiceId},
      version = version + 1, updated_at = now()
    WHERE id = ${id} AND status = 'APPROVED' AND sales_invoice_id IS NULL
    RETURNING id
  `);
  return rows.rows.length > 0;
}

/** The amortization's read: the project's APPROVED ADVANCE rows with
 * their remaining balances, OLDEST-FIRST (certificate_date, then id —
 * the deterministic order the pure fold consumes). */
export async function listOpenAdvances(projectId: string): Promise<
  ReadonlyArray<{ id: string; grossValue: string; advanceAppliedAmount: string }>
> {
  const rows = await tenantTx().execute(sql`
    SELECT id, gross_value::text AS "grossValue",
           advance_applied_amount::text AS "advanceAppliedAmount"
    FROM progress_certificates
    WHERE project_id = ${projectId} AND kind = 'ADVANCE' AND status = 'APPROVED'
    ORDER BY certificate_date, id
  `);
  return rows.rows as unknown as {
    id: string;
    grossValue: string;
    advanceAppliedAmount: string;
  }[];
}

/** The apply fold's write: one slice lands on its advance (the table's
 * own CHECK — applied ≤ gross, ADVANCE-only — is the structural
 * floor; the pure plan already bounded every slice). */
export async function applyAdvanceAmount(id: string, amount: string): Promise<void> {
  await tenantTx().execute(sql`
    UPDATE progress_certificates SET
      advance_applied_amount = advance_applied_amount + ${amount},
      version = version + 1, updated_at = now()
    WHERE id = ${id} AND kind = 'ADVANCE' AND status = 'APPROVED'
  `);
}

// ── T-12: the generated certificate invoice (the billing evidence) ─────────

export interface CertificateInvoiceRow {
  id: string;
  invoiceNo: string;
  branchId: string;
  customerId: string;
  kind: string;
  invoiceDate: string;
  dueDate: string;
  currencyCode: string;
  status: string;
  totalNet: string;
  totalTax: string;
  totalGross: string;
  postedJournalId: string;
  projectId: string | null;
  note: string | null;
}

/**
 * The certificate's generated billing document, written directly in
 * its POSTED shape: the certificate's approval IS the approval (the
 * privileged act — projects.certificates.approve), the accounting is
 * the G-57 journal minted through the REAL PostingService by the
 * service, and this row is the evidence (posted_journal_id = that
 * entry; the 0018 posted-shape CHECK satisfied atomically — the
 * generated-in-transaction law, D-10).
 */
export async function insertCertificateInvoice(input: {
  invoiceNo: string;
  branchId: string;
  customerId: string;
  invoiceDate: string;
  dueDate: string;
  currencyCode: string;
  totalNet: string;
  lineAccountId: string;
  lineDescription: string;
  lineDescriptionAr: string;
  postedJournalId: string;
  projectId: string;
  note: string | null;
  actorId: string | null;
}): Promise<CertificateInvoiceRow> {
  const tx = tenantTx();
  const id = generateUuidV7();
  await tx.execute(sql`
    INSERT INTO sales_invoices (id, tenant_id, created_by, branch_id, customer_id, kind,
                                invoice_no, invoice_date, due_date, currency_code,
                                total_net, total_tax, total_gross, note, status,
                                posting_date, posted_by, posted_at, posted_journal_id, project_id)
    VALUES (${id}, erp.current_tenant_id(), ${input.actorId}, ${input.branchId}, ${input.customerId},
            'CREDIT', ${input.invoiceNo}, ${input.invoiceDate}, ${input.dueDate},
            ${input.currencyCode}, ${input.totalNet}, '0.0000', ${input.totalNet}, ${input.note},
            'POSTED', ${input.invoiceDate}, ${input.actorId}, now(), ${input.postedJournalId},
            ${input.projectId})
  `);
  await tx.execute(sql`
    INSERT INTO sales_invoice_lines (id, tenant_id, invoice_id, line_no, item_id, account_id,
                                     delivery_line_id, description, description_ar, qty,
                                     unit_price, discount_amount, tax_code_id, net_amount,
                                     tax_amount)
    VALUES (${generateUuidV7()}, erp.current_tenant_id(), ${id}, 1, NULL, ${input.lineAccountId},
            NULL, ${input.lineDescription}, ${input.lineDescriptionAr}, '1', ${input.totalNet},
            '0.0000', NULL, ${input.totalNet}, '0.0000')
  `);
  const rows = await tx.execute(sql`
    SELECT id, invoice_no AS "invoiceNo", branch_id AS "branchId", customer_id AS "customerId",
           kind, invoice_date::text AS "invoiceDate", due_date::text AS "dueDate",
           currency_code AS "currencyCode", status, total_net::text AS "totalNet",
           total_tax::text AS "totalTax", total_gross::text AS "totalGross",
           posted_journal_id AS "postedJournalId", project_id AS "projectId", note
    FROM sales_invoices WHERE id = ${id} LIMIT 1
  `);
  return (rows.rows as unknown as CertificateInvoiceRow[])[0]!;
}
