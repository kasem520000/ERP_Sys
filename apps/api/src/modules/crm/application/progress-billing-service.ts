import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { NumberingService } from "../../accounting/application/numbering-service";
import { PostingService } from "../../accounting/application/posting-service";
import { ProjectActualsService } from "./project-actuals-service";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import {
  advanceApplicationPlan,
  billingCeilingCheck,
  certificateAmounts,
} from "../domain/contracting-math";
import {
  BillingCeilingExceededError,
  CertificateInvoiceAlreadyGeneratedError,
  ContractingInputInvalidError,
  ProgressCertificateNotFoundError,
  ProgressCertificateStateError,
  ProjectPlaneNotFoundError,
  RetentionRegisterMissingError,
} from "../domain/projects-errors";
import * as store from "../infrastructure/contracting.store";
import type {
  CertificateInvoiceRow,
  ProgressCertificateRow,
  RetentionAccountRow,
} from "../infrastructure/contracting.store";
import { findProjectPlane } from "../infrastructure/projects.store";
import { ChangeOrderService } from "./change-order-service";

/**
 * PHASE-048 (W-11 — T-12) — the progress-certificate billing engine
 * (D-10, the L2-15 home): `progress_certificates`
 * (PROGRESS/ADVANCE/FINAL) — the customer billing event.
 *
 * THE LAWS:
 *
 * - **THE LIFECYCLE (0103's own shapes)**: DRAFT → SUBMITTED → APPROVED
 *   / DRAFT|SUBMITTED → VOID (the reason mandatory — 0103's columns).
 *   An APPROVED certificate is TERMINAL (0103's approval-link CHECK
 *   pins VOID to the never-approved path).
 * - **BR-092 (the retention % from the contract)**: the certificate's
 *   retention_amount / net_value pair is DERIVED by the engine from
 *   the CUSTOMER register's hold_percent (the contract's commercial
 *   spine — tenant DATA per contract, never a global constant, never
 *   caller-supplied); ADVANCE certificates carry NO retention (a
 *   دفعة مقدمة is pre-earning — retention withholds from EARNED
 *   billing only). A project with NO register cannot bill (the typed
 *   fail-closed refusal at authoring AND at approval).
 * - **BR-093 (the cumulative billing ceiling — the typed refusal, NO
 *   silent truncation)**: Σ the APPROVED certificates' gross (ALL
 *   kinds — the advances bill against the same contract) + THIS
 *   certificate's gross NEVER exceeds the effective contract value —
 *   the retention register + Σ the APPROVED change-order price deltas,
 *   read through the ChangeOrder gate's OWN ceiling read (ONE law,
 *   three engines: the EVM's BAC, the gate's ceiling, the billing
 *   ceiling — W-10's precedent). The check runs BEFORE the CAS, at
 *   the statute's own position (the approval IS the billing); the
 *   boundary cumulative = ceiling is LEGAL.
 * - **G-57 (the billing posting — the D-18 wording verbatim, the
 *   fused shape)**: at certificate approval, through the REAL engine:
 *   PROGRESS/FINAL → DR `AR_CONTROL` (the NET, partner-stamped) · DR
 *   `CONTRACT_RETENTION` (the HELD) · CR `CONTRACT_REVENUE` (the
 *   approved cumulative value — the gross); ADVANCE → DR `AR_CONTROL`
 *   (the gross, partner-stamped) · CR `CUSTOMER_ADVANCE` (the
 *   liability — the G-33 supplier-advance DISBURSE mirror on the
 *   customer side). **The sales invoice is generated IN-TRANSACTION**
 *   (the POSTED row, its journal = the G-57 entry — the certificate's
 *   approval IS the approval; 0103's invoice_gated CHECK floor).
 * - **THE ADVANCE AMORTIZATION (the G-33 APPLY mirror)**: each later
 *   PROGRESS/FINAL certificate's approval applies the remaining
 *   advances against its NET — oldest-first (certificate_date, then
 *   id), bounded by every remaining balance (the pure fold) —
 *   DR `CUSTOMER_ADVANCE` (the applied) · CR `AR_CONTROL` (the
 *   applied, partner-stamped): the advance settles the receivable.
 *   The apply lands on 0104's `advance_applied_amount` (the
 *   amortization state). No remaining advances → NO apply journal
 *   (the honest shape).
 * - **INV-033 AFTER EACH POSTING** (the owner's W-11 clause 4): the
 *   billing/amortization legs carry NO project stamps (revenue, AR,
 *   the retention receivable and the advance liability are not the
 *   cost carry) — the check runs after each posting and stays green
 *   by construction.
 * - **THE SINGLE-CONSUMPTION INVOICE STAMP**: `sales_invoice_id`
 *   writes ONLY after everything succeeded, in the SAME ambient
 *   transaction — a posting failure (PURPOSE_NOT_MAPPED, a closed
 *   period, the ceiling) rolls the whole approval back to SUBMITTED
 *   (all-or-nothing, the G-58 precedent).
 * - **FX AT POSTING (the engine's own law)**: the journals carry the
 *   REGISTER's currency; a non-base contract requires the explicit
 *   exchange rate at approval (the engine's fail-closed
 *   missingFxRate) — never a fabricated rate.
 * - **NO DELETE**; money is numeric(19,4) EXCLUSIVELY (ADR-0009).
 */

const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const MONEY_RE = /^\d+(\.\d{1,4})?$/;
const PCT_RE = /^\d+(\.\d{1,2})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SAL_FORMAT = { prefix: "SAL", format: "SAL-{YYYY}-{SEQ:6}", docType: "sales_invoice" } as const;

function isUniqueViolation(error: unknown): boolean {
  let candidate: unknown = error;
  for (let depth = 0; depth < 4 && candidate !== null && candidate !== undefined; depth += 1) {
    if (typeof candidate === "object" && (candidate as { code?: string }).code === "23505") {
      return true;
    }
    candidate = (candidate as { cause?: unknown }).cause;
  }
  return false;
}

function requireUuid(value: string, what: string): string {
  if (!UUID_RE.test(value)) {
    throw new ContractingInputInvalidError(`${what} must be a uuid: ${value}`);
  }
  return value;
}

export interface ProgressCertificateApproval {
  readonly certificate: ProgressCertificateRow;
  readonly billingJournalEntryId: string;
  /** The amortization's apply journal (null when no advance remained —
   * the honest shape). */
  readonly applyJournalEntryId: string | null;
  readonly totalAdvanceApplied: string;
  readonly invoice: CertificateInvoiceRow;
}

@Injectable()
export class ProgressBillingService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(NumberingService) private readonly numbering: NumberingService,
    @Inject(ProjectActualsService) private readonly actuals: ProjectActualsService,
    @Inject(ChangeOrderService) private readonly changeOrders: ChangeOrderService,
  ) {}

  // -- the authoring plane -----------------------------------------------------

  /** The certificate's authoring: the register MUST stand (the
   * contract's commercial spine — BR-092's fail-closed law: no
   * contract, no billing) and the amounts are DERIVED from its hold %
   * (never caller-supplied). */
  async createCertificate(input: {
    projectId: string;
    certificateNo: string | null;
    certificateDate: string;
    kind: "PROGRESS" | "ADVANCE" | "FINAL";
    cumulativePercent: string;
    grossValue: string;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
  }): Promise<ProgressCertificateRow> {
    const projectId = requireUuid(input.projectId, "projectId");
    const project = await findProjectPlane(projectId);
    if (project === undefined) throw new ProjectPlaneNotFoundError(projectId);
    if (!DATE_RE.test(input.certificateDate)) {
      throw new ContractingInputInvalidError("certificateDate must be an ISO date (YYYY-MM-DD)");
    }
    if (!PCT_RE.test(input.cumulativePercent) || Number(input.cumulativePercent) > 100) {
      throw new ContractingInputInvalidError(
        `cumulativePercent must be within [0, 100] (≤ 2dp): ${input.cumulativePercent}`,
      );
    }
    if (!MONEY_RE.test(input.grossValue)) {
      throw new ContractingInputInvalidError(
        `grossValue must be a non-negative decimal (≤ 4dp): ${input.grossValue}`,
      );
    }
    if (input.certificateNo !== null && (input.certificateNo.trim().length < 1 || input.certificateNo.length > 40)) {
      throw new ContractingInputInvalidError("certificateNo must be 1…40 characters when provided");
    }
    if (input.kind === "ADVANCE" && input.cumulativePercent !== "0.00") {
      throw new ContractingInputInvalidError(
        "an ADVANCE certificate carries no earned progress — cumulativePercent stays 0.00 (retention withholds from EARNED billing only)",
      );
    }
    // BR-092's fail-closed law: no register, no billing (the hold % is
    // tenant DATA per contract — never a guessed default).
    const register = await store.findCustomerRetentionRegister(projectId);
    if (register === undefined) {
      throw new RetentionRegisterMissingError(
        `project ${projectId} carries no CUSTOMER retention register — the certificate's retention terms come from the contract (BR-092); author the register first`,
        { projectId },
      );
    }
    // The engine derives the pair: PROGRESS/FINAL from the register's
    // hold %; ADVANCE carries no retention.
    const amounts =
      input.kind === "ADVANCE"
        ? { retention: "0.0000", net: input.grossValue }
        : certificateAmounts(input.grossValue, register.holdPercent ?? "0.00");
    let created: ProgressCertificateRow;
    try {
      created = await store.insertProgressCertificate({
        projectId,
        certificateNo: input.certificateNo,
        certificateDate: input.certificateDate,
        kind: input.kind,
        cumulativePercent: input.cumulativePercent,
        grossValue: input.grossValue,
        retentionAmount: amounts.retention,
        netValue: amounts.net,
        currencyCode: register.currencyCode ?? (await ownTenantBaseCurrency()),
        note: input.note,
        noteAr: input.noteAr,
        actorId: input.actorId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ContractingInputInvalidError(
          `a certificate numbered "${input.certificateNo}" already exists on this project — certificate_no is unique per project`,
        );
      }
      throw error;
    }
    await this.audit.record({
      action: "projects.progress_certificate_created",
      entityType: "progress_certificate",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        projectId,
        kind: created.kind,
        grossValue: created.grossValue,
        retentionAmount: created.retentionAmount,
        netValue: created.netValue,
        status: created.status,
      },
    });
    return created;
  }

  async list(projectId: string): Promise<ProgressCertificateRow[]> {
    await requireUuid(projectId, "projectId");
    const project = await findProjectPlane(projectId);
    if (project === undefined) throw new ProjectPlaneNotFoundError(projectId);
    return store.listProgressCertificates(projectId);
  }

  async get(id: string): Promise<ProgressCertificateRow> {
    const certificate = await store.findProgressCertificateById(
      requireUuid(id, "certificateId"),
    );
    if (certificate === undefined) throw new ProgressCertificateNotFoundError(id);
    return certificate;
  }

  /** DRAFT → SUBMITTED (the approval queue; 0103's submission CHECK
   * stamps submitted_at in the same CAS). */
  async submit(id: string, actorId: string | null): Promise<ProgressCertificateRow> {
    const certificateId = requireUuid(id, "certificateId");
    const current = await store.findProgressCertificateById(certificateId);
    if (current === undefined) throw new ProgressCertificateNotFoundError(certificateId);
    if (current.status !== "DRAFT") {
      throw new ProgressCertificateStateError(
        `certificate ${certificateId} is ${current.status} — only DRAFT certificates submit`,
        { certificateId, status: current.status },
      );
    }
    const moved = await store.casProgressCertificateStatus({
      id: certificateId,
      from: "DRAFT",
      to: "SUBMITTED",
      actorId,
    });
    if (moved === undefined) {
      throw new ProgressCertificateStateError(
        `certificate ${certificateId} left DRAFT concurrently — reload and retry (the CAS guard)`,
        { certificateId },
      );
    }
    await this.audit.record({
      action: "projects.progress_certificate_submitted",
      entityType: "progress_certificate",
      entityId: certificateId,
      actorId: actorId ?? undefined,
      before: { status: "DRAFT" },
      after: { status: "SUBMITTED" },
    });
    return moved;
  }

  /** DRAFT|SUBMITTED → VOID (the reason mandatory — 0103's columns; an
   * APPROVED certificate is terminal evidence). */
  async void(id: string, reason: string, actorId: string | null): Promise<ProgressCertificateRow> {
    const certificateId = requireUuid(id, "certificateId");
    if (reason.trim().length < 3 || reason.length > 500) {
      throw new ContractingInputInvalidError("a void carries its reason (3…500 characters) — 0103's CHECK");
    }
    const current = await store.findProgressCertificateById(certificateId);
    if (current === undefined) throw new ProgressCertificateNotFoundError(certificateId);
    if (current.status === "APPROVED") {
      throw new ProgressCertificateStateError(
        `certificate ${certificateId} is APPROVED — the approved history is terminal (no VOID, 0103's CHECK)`,
        { certificateId, status: current.status },
      );
    }
    if (current.status === "VOID") {
      throw new ProgressCertificateStateError(
        `certificate ${certificateId} is already VOID`,
        { certificateId, status: current.status },
      );
    }
    const moved = await store.casProgressCertificateStatus({
      id: certificateId,
      from: current.status,
      to: "VOID",
      actorId,
      voidReason: reason,
    });
    if (moved === undefined) {
      throw new ProgressCertificateStateError(
        `certificate ${certificateId} moved concurrently — reload and retry (the CAS guard)`,
        { certificateId },
      );
    }
    await this.audit.record({
      action: "projects.progress_certificate_voided",
      entityType: "progress_certificate",
      entityId: certificateId,
      actorId: actorId ?? undefined,
      before: { status: current.status },
      after: { status: "VOID", reason },
    });
    return moved;
  }

  // -- THE APPROVAL GATE (BR-093 + G-57 + the invoice + the amortization) -----

  /**
   * SUBMITTED → APPROVED + G-57's billing posting + the generated
   * invoice + the advance amortization in ONE ambient transaction:
   * the BR-092/093 checks BEFORE the CAS (the statute's position), the
   * verdict CAS, the posting(s) through the REAL engine, the retention
   * accrual, the amortization slices, and the single-use invoice
   * stamp — any failure rolls the whole approval back to SUBMITTED.
   */
  async approve(input: {
    id: string;
    exchangeRate?: string;
    actorId: string | null;
  }): Promise<ProgressCertificateApproval> {
    const certificateId = requireUuid(input.id, "certificateId");
    const current = await store.findProgressCertificateById(certificateId);
    if (current === undefined) throw new ProgressCertificateNotFoundError(certificateId);
    if (current.status !== "SUBMITTED") {
      throw new ProgressCertificateStateError(
        `certificate ${certificateId} is ${current.status} — only SUBMITTED certificates approve`,
        { certificateId, status: current.status },
      );
    }
    if (current.salesInvoiceId !== null) {
      throw new CertificateInvoiceAlreadyGeneratedError(
        `certificate ${certificateId} already generated its sales invoice — the stamp is single-use`,
        { certificateId, salesInvoiceId: current.salesInvoiceId },
      );
    }

    // BR-092 — the register read (fresh, at the approval): the hold %
    // + the contract's customer + the currency.
    const register = await store.findCustomerRetentionRegister(current.projectId);
    if (register === undefined) {
      throw new RetentionRegisterMissingError(
        `project ${current.projectId} carries no CUSTOMER retention register — the billing refuses (BR-092's fail-closed law)`,
        { projectId: current.projectId },
      );
    }
    if (register.customerId === null) {
      throw new RetentionRegisterMissingError(
        `the register on project ${current.projectId} carries no customer partner (a pre-W-11 row) — the AR stamp and the invoice require the contract's customer`,
        { projectId: current.projectId },
      );
    }

    // BR-093 — the ceiling at the statute's position (BEFORE the CAS):
    // the effective contract value through the ChangeOrder gate's OWN
    // read (ONE law, three engines — W-10's precedent).
    const ceiling = await this.changeOrders.ceiling(current.projectId);
    if (ceiling.effectiveContractValue === null) {
      throw new RetentionRegisterMissingError(
        `project ${current.projectId}'s effective contract value is absent — the billing ceiling refuses (BR-093's fail-closed law)`,
        { projectId: current.projectId },
      );
    }
    const billed = await store.approvedGrossSum(current.projectId);
    const verdict = billingCeilingCheck(billed.grossSum, current.grossValue, ceiling.effectiveContractValue);
    if (verdict.exceeded) {
      throw new BillingCeilingExceededError(
        `cumulative billing would reach ${verdict.cumulativeAfter} against the approved contract value ${ceiling.effectiveContractValue} — the certificate's full ${current.grossValue} exceeds the ceiling by ${verdict.overage} (BR-093: no silent truncation; approve a change order or reduce the certificate)`,
        {
          projectId: current.projectId,
          alreadyBilled: billed.grossSum,
          thisGross: current.grossValue,
          cumulativeAfter: verdict.cumulativeAfter,
          ceiling: ceiling.effectiveContractValue,
          overage: verdict.overage,
        },
      );
    }

    // The verdict CAS — one guarded UPDATE (a raced move refuses).
    const approved = await store.casProgressCertificateStatus({
      id: certificateId,
      from: "SUBMITTED",
      to: "APPROVED",
      actorId: input.actorId,
    });
    if (approved === undefined) {
      throw new ProgressCertificateStateError(
        `certificate ${certificateId} left SUBMITTED concurrently — reload and retry (the CAS guard)`,
        { certificateId },
      );
    }

    const entryDate = current.certificateDate;
    const currency = register.currencyCode ?? (await ownTenantBaseCurrency());
    const base = await ownTenantBaseCurrency();
    const fx = currency === base ? undefined : input.exchangeRate;
    const isAdvance = current.kind === "ADVANCE";

    // G-57 — the billing posting (the D-18 wording verbatim, fused):
    // PROGRESS/FINAL → DR AR (net) + DR CONTRACT_RETENTION (held) / CR
    // CONTRACT_REVENUE (gross); ADVANCE → DR AR (gross) / CR
    // CUSTOMER_ADVANCE (the liability — the G-33 DISBURSE mirror).
    const billingResult = await this.posting.post(
      {
        source: { docType: "progress_certificate", docId: certificateId, operation: "approve" },
        entryDate,
        description: {
          en: `Progress certificate ${current.certificateNo ?? certificateId} (${current.kind}) — G-57 billing`,
          ar: `المستخلص ${current.certificateNo ?? certificateId} (${current.kind}) — الفوترة G-57`,
        },
        currency,
        exchangeRate: fx,
        lines: isAdvance
          ? [
              {
                purpose: "AR_CONTROL",
                direction: "DEBIT",
                amount: current.grossValue,
                partnerId: register.customerId,
                memo: {
                  en: "G-57 advance billing — the customer advance (the G-33 mirror)",
                  ar: "فوترة الدفعة المقدمة G-57 — دفعة العميل (مرآة G-33)",
                },
              },
              {
                purpose: "CUSTOMER_ADVANCE",
                direction: "CREDIT",
                amount: current.grossValue,
                memo: {
                  en: "The customer advance liability",
                  ar: "التزام الدفعة المقدمة من العميل",
                },
              },
            ]
          : [
              {
                purpose: "AR_CONTROL",
                direction: "DEBIT",
                amount: current.netValue,
                partnerId: register.customerId,
                memo: {
                  en: "G-57 progress billing — the net receivable",
                  ar: "فوترة المستخلص G-57 — الصافي المستحق",
                },
              },
              {
                purpose: "CONTRACT_RETENTION",
                direction: "DEBIT",
                amount: current.retentionAmount,
                memo: {
                  en: "G-55's hold rides G-57 — the retention receivable",
                  ar: "حجز G-55 داخل G-57 — مستحق الاستقطاع",
                },
              },
              {
                purpose: "CONTRACT_REVENUE",
                direction: "CREDIT",
                amount: current.grossValue,
                memo: {
                  en: "G-57 — the revenue at the approved cumulative value",
                  ar: "G-57 — الإيراد بالقيمة المعتمدة تراكميًا",
                },
              },
            ],
      },
      { postedBy: input.actorId },
    );
    // INV-033 after the posting (the owner's W-11 clause 4): the
    // billing legs carry NO project stamps — green by construction.
    await this.actuals.inv033(current.projectId);

    // The retention accrual on the register (G-55's customer-side
    // hold — the fused leg's ledger state).
    if (!isAdvance && current.retentionAmount !== "0.0000") {
      await store.accrueRetention(register.id, current.retentionAmount);
    }

    // The amortization (the G-33 APPLY mirror): the remaining advances
    // apply against THIS certificate's net, oldest-first (the pure
    // fold); no remaining advances → no apply journal (the honest
    // shape).
    let applyJournalEntryId: string | null = null;
    let totalAdvanceApplied = "0.0000";
    if (!isAdvance && current.netValue !== "0.0000") {
      const advances = await store.listOpenAdvances(current.projectId);
      const plan = advanceApplicationPlan(
        advances.map((row) => ({
          id: row.id,
          gross: row.grossValue,
          applied: row.advanceAppliedAmount,
        })),
        current.netValue,
      );
      if (plan.totalApplied !== "0.0000") {
        const applyResult = await this.posting.post(
          {
            source: {
              docType: "progress_certificate",
              docId: certificateId,
              operation: "apply_advance",
            },
            entryDate,
            description: {
              en: `Progress certificate ${current.certificateNo ?? certificateId} — advance application ${plan.totalApplied}`,
              ar: `المستخلص ${current.certificateNo ?? certificateId} — تسوية الدفعة المقدمة ${plan.totalApplied}`,
            },
            currency,
            exchangeRate: fx,
            lines: [
              {
                purpose: "CUSTOMER_ADVANCE",
                direction: "DEBIT",
                amount: plan.totalApplied,
                memo: {
                  en: "The advance amortizes against this certificate (the G-33 APPLY mirror)",
                  ar: "تسوية الدفعة المقدمة ضد هذا المستخلص (مرآة G-33)",
                },
              },
              {
                purpose: "AR_CONTROL",
                direction: "CREDIT",
                amount: plan.totalApplied,
                partnerId: register.customerId,
                memo: {
                  en: "The advance settles the certificate's receivable",
                  ar: "الدفعة المقدمة تسدد مستحق المستخلص",
                },
              },
            ],
          },
          { postedBy: input.actorId },
        );
        // INV-033 after EACH posting (clause 4).
        await this.actuals.inv033(current.projectId);
        applyJournalEntryId = applyResult.journalEntryId;
        totalAdvanceApplied = plan.totalApplied;
        for (const slice of plan.slices) {
          await store.applyAdvanceAmount(slice.id, slice.apply);
        }
      }
    }

    // THE GENERATED INVOICE (in-transaction — D-10's own law): the
    // POSTED billing document, its journal = the G-57 entry; the
    // certificate's approval IS the approval. The line's account is
    // the same purpose-mapped account the posting credited (the
    // revenue for PROGRESS/FINAL; the advance liability for ADVANCE).
    const accountingStore = await import("../../accounting/infrastructure/accounting.store");
    const linePurpose = isAdvance ? "CUSTOMER_ADVANCE" : "CONTRACT_REVENUE";
    const lineMapping = await accountingStore.findActivePurpose(linePurpose);
    if (lineMapping === undefined) {
      throw new ContractingInputInvalidError(
        `the ${linePurpose} purpose is unmapped — the invoice's line account follows the posting's own mapping (fail-closed, the 038 discipline)`,
      );
    }
    const crmStore = await import("../infrastructure/crm.store");
    const branch = await crmStore.findMainBranchForCrm();
    if (branch === undefined) {
      throw new ContractingInputInvalidError(
        "the tenant has no MAIN branch — the certificate invoice requires one (resolve the branch first)",
      );
    }
    const year = entryDate.slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: SAL_FORMAT.docType,
      branchId: branch.id,
      periodKey: year,
      format: SAL_FORMAT.format,
      prefix: SAL_FORMAT.prefix,
      year,
    });
    const invoiceValue = isAdvance ? current.grossValue : current.netValue;
    const invoice = await store.insertCertificateInvoice({
      invoiceNo: acquired.number,
      branchId: branch.id,
      customerId: register.customerId,
      invoiceDate: entryDate,
      // No fabricated terms: the certificate's net is due at its own
      // date (the contract's collection terms are the treasury's
      // surface; due_date >= invoice_date is the 0018 floor).
      dueDate: entryDate,
      currencyCode: currency,
      totalNet: invoiceValue,
      lineAccountId: lineMapping.accountId,
      lineDescription: `Progress certificate ${current.certificateNo ?? certificateId} (${current.kind})`,
      lineDescriptionAr: `مستخلص رقم ${current.certificateNo ?? certificateId} (${current.kind})`,
      postedJournalId: billingResult.journalEntryId,
      projectId: current.projectId,
      note: `Generated from progress certificate ${current.certificateNo ?? certificateId}`,
      actorId: input.actorId,
    });
    await this.numbering.bind(SAL_FORMAT.docType, acquired.number, invoice.id);

    // THE SINGLE-USE INVOICE STAMP — only after everything succeeded,
    // in the same ambient transaction.
    const stamped = await store.stampCertificateInvoice(certificateId, invoice.id);
    if (!stamped) {
      throw new CertificateInvoiceAlreadyGeneratedError(
        `certificate ${certificateId} already carries its generated invoice — the stamp is single-use`,
        { certificateId },
      );
    }

    await this.audit.record({
      action: "projects.progress_certificate_approved",
      entityType: "progress_certificate",
      entityId: certificateId,
      actorId: input.actorId ?? undefined,
      before: { status: "SUBMITTED" },
      after: {
        status: "APPROVED",
        grossValue: current.grossValue,
        retentionAmount: current.retentionAmount,
        netValue: current.netValue,
        billingJournalEntryId: billingResult.journalEntryId,
        applyJournalEntryId,
        totalAdvanceApplied,
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
      },
    });

    const after = await store.findProgressCertificateById(certificateId);
    return {
      certificate: after ?? approved,
      billingJournalEntryId: billingResult.journalEntryId,
      applyJournalEntryId,
      totalAdvanceApplied,
      invoice,
    };
  }

  // -- the billing's own reads ---------------------------------------------------

  /** The cumulative billing state (the ceiling's own read — the same
   * law the approval enforces, surfaced for the screens). */
  async billingState(projectId: string): Promise<{
    register: RetentionAccountRow | null;
    approvedCertificates: number;
    cumulativeGross: string;
    effectiveContractValue: string | null;
    remaining: string | null;
  }> {
    await requireUuid(projectId, "projectId");
    const project = await findProjectPlane(projectId);
    if (project === undefined) throw new ProjectPlaneNotFoundError(projectId);
    const register = await store.findCustomerRetentionRegister(projectId);
    const billed = await store.approvedGrossSum(projectId);
    const ceiling = await this.changeOrders.ceiling(projectId);
    const remaining =
      ceiling.effectiveContractValue === null
        ? null
        : new Decimal(ceiling.effectiveContractValue)
            .minus(new Decimal(billed.grossSum))
            .toFixed(4);
    return {
      register: register ?? null,
      approvedCertificates: billed.count,
      cumulativeGross: billed.grossSum,
      effectiveContractValue: ceiling.effectiveContractValue,
      remaining,
    };
  }
}
