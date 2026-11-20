import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import { ProjectActualsService } from "./project-actuals-service";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import { certificateAmounts } from "../domain/contracting-math";
import {
  ContractingInputInvalidError,
  ProjectPlaneNotFoundError,
  RetentionStateError,
  SubcontractAgreementNotFoundError,
  SubcontractCertificateAlreadyApprovedError,
  SubcontractCertificateNotFoundError,
  SubcontractStateError,
} from "../domain/projects-errors";
import * as store from "../infrastructure/contracting.store";
import type { SubcontractAgreementRow, SubcontractCertificateRow } from "../infrastructure/contracting.store";
import { findProjectPlane, listProjectPlane } from "../infrastructure/projects.store";

/**
 * PHASE-048 (W-11 — T-10) — the subcontracting engine (D-08): the
 * agreements' lifecycle + the sub certificates (the sub مستخلص) + THE
 * AP LINKAGE — each APPROVED certificate drives its subcontractor
 * purchase obligation through the purchasing chain's AP leg.
 *
 * THE LAWS:
 *
 * - **THE LIFECYCLE (0103's own shapes)**: agreements
 *   DRAFT → ACTIVE → CLOSED / DRAFT|ACTIVE → CANCELLED (the reason
 *   mandatory) — ONE guarded CAS per move; certificates
 *   DRAFT → APPROVED / VOID. An APPROVED certificate is TERMINAL
 *   evidence (0103's approval-link CHECK pins VOID to the
 *   never-approved path — no reversal path in W-11; the credit-note
 *   surface is sales' own).
 * - **BR-092 PER AGREEMENT** (the retention % from the contract —
 *   tenant DATA per agreement, never a global constant): the
 *   certificate's retention_withheld / net_payable pair is DERIVED by
 *   the engine from the AGREEMENT's retention_percent (the pure
 *   `certificateAmounts` fold — ONE rounding, the 0103 arithmetic
 *   floor `retention + net = gross` holding by construction); the
 *   caller NEVER supplies them.
 * - **THE AP LINKAGE (the approval's first posting)**: the
 *   certificate's NET drives the obligation into AP through the REAL
 *   PostingService — DR the purpose-mapped `PROJECT_SUBCONTRACT_COST`
 *   (the net, PROJECT-STAMPED — the subcontractor actuals' own GL
 *   carry, so INV-033 holds against T-07's collector read: the
 *   APPROVED certificates' NETS, the W-9 pinned law) · CR `AP_CONTROL`
 *   (the net, PARTNER-STAMPED — INV-009). **The approved extracts are
 *   the SOLE source for subcontractor actuals — NO parallel
 *   calculation path** (the owner's W-11 clause 2): the collector
 *   reads the certificate rows; the GL leg lands exactly that read.
 * - **G-55 ON THE SUB SIDE (the retention hold — the SAME retention
 *   ledger, D-08's law)**: the withheld retention accrues on the
 *   agreement's SUBCONTRACTOR row (created at ACTIVATION — one row per
 *   agreement, the 0103 partial unique) and posts through the engine:
 *   DR the mapped subcontract-cost account (the held amount, NO
 *   project stamp — the cost family outside the actuals dimension; the
 *   W-9 net law keeps INV-033 green by construction) · CR the
 *   purpose-mapped `SUBCONTRACT_RETENTION` (the held amount,
 *   partner-stamped — the deferred liability G-56 releases into AP).
 *   A ZERO retention posts NO hold journal (the honest shape) and
 *   accrues nothing.
 * - **THE SINGLE-CONSUMPTION STAMP (0104)**: `ap_journal_entry_id`
 *   writes ONLY after BOTH postings succeeded, in the SAME ambient
 *   transaction — a posting failure (PURPOSE_NOT_MAPPED, a closed
 *   period…) rolls the whole approval back to DRAFT (all-or-nothing,
 *   the G-58 precedent); a second linkage is the typed refusal.
 * - **INV-033 AFTER EACH POSTING** (the owner's W-11 clause 4): the
 *   typed reconciliation runs after the AP linkage AND after the hold
 *   — the four-leg AC vs the GL project dimension, to the cent; any
 *   residual refuses the whole approval.
 * - **FX AT POSTING (the engine's own law)**: the journals carry the
 *   AGREEMENT's currency; a non-base contract requires the explicit
 *   exchange rate at approval (the engine's fail-closed
 *   missingFxRate) — the existing FX discipline, never a fabricated
 *   rate (red line 5).
 * - **NO DELETE** (0103's evidence discipline).
 * - Money is numeric(19,4) EXCLUSIVELY (ADR-0009).
 */

const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const MONEY_RE = /^\d+(\.\d{1,4})?$/;
const PCT_RE = /^\d+(\.\d{1,2})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 23505 = unique_violation (the bridge precedent's unwrapping). */
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

export interface SubcontractCertificateApproval {
  readonly certificate: SubcontractCertificateRow;
  /** The AP linkage's journal entry (0104's stamp target). */
  readonly apJournalEntryId: string;
  /** G-55's hold journal (null on a zero retention — the honest shape). */
  readonly holdJournalEntryId: string | null;
  /** The SUBCONTRACTOR retention row's accrued balance after the hold. */
  readonly retentionAccruedBalance: string;
}

@Injectable()
export class SubcontractService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(ProjectActualsService) private readonly actuals: ProjectActualsService,
  ) {}

  // -- the agreements (master data with the typed lifecycle guards) ----------

  async createAgreement(input: {
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
    const projectId = requireUuid(input.projectId, "projectId");
    const project = await findProjectPlane(projectId);
    if (project === undefined) throw new ProjectPlaneNotFoundError(projectId);
    requireUuid(input.partnerId, "partnerId");
    const partnersStore = await import("../../partners/infrastructure/partners.store");
    const partner = await partnersStore.findPartnerById(input.partnerId);
    if (partner === undefined || partner.kind === "CUSTOMER") {
      throw new ContractingInputInvalidError(
        `partner ${input.partnerId} is not a supplier — a subcontractor agreement binds a SUPPLIER (or BOTH) counterparty`,
      );
    }
    if (input.agreementNo.trim().length < 1 || input.agreementNo.length > 40) {
      throw new ContractingInputInvalidError("agreementNo must be 1…40 characters");
    }
    if (input.title.trim().length < 1 || input.title.length > 200) {
      throw new ContractingInputInvalidError("title must be 1…200 characters");
    }
    if (!MONEY_RE.test(input.agreementValue) || Number(input.agreementValue) <= 0) {
      throw new ContractingInputInvalidError(
        `agreementValue must be a positive decimal (≤ 4dp — 0103's CHECK): ${input.agreementValue}`,
      );
    }
    if (!PCT_RE.test(input.retentionPercent) || Number(input.retentionPercent) > 100) {
      throw new ContractingInputInvalidError(
        `retentionPercent must be within [0, 100] (≤ 2dp — BR-092's per-agreement tenant DATA): ${input.retentionPercent}`,
      );
    }
    if (input.currencyCode.length !== 3) {
      throw new ContractingInputInvalidError("currencyCode must be a 3-letter ISO code");
    }
    for (const [what, date] of [
      ["startDate", input.startDate],
      ["endDate", input.endDate],
    ] as const) {
      if (date !== null && !DATE_RE.test(date)) {
        throw new ContractingInputInvalidError(`${what} must be an ISO date (YYYY-MM-DD) or null`);
      }
    }
    if (input.startDate !== null && input.endDate !== null && input.endDate < input.startDate) {
      throw new ContractingInputInvalidError("endDate must not precede startDate (0103's CHECK)");
    }
    let created: SubcontractAgreementRow;
    try {
      created = await store.insertSubcontractAgreement({
        projectId,
        partnerId: input.partnerId,
        agreementNo: input.agreementNo,
        title: input.title,
        titleAr: input.titleAr,
        scope: input.scope,
        agreementValue: input.agreementValue,
        currencyCode: input.currencyCode,
        retentionPercent: input.retentionPercent,
        startDate: input.startDate,
        endDate: input.endDate,
        note: input.note,
        noteAr: input.noteAr,
        actorId: input.actorId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ContractingInputInvalidError(
          `an agreement numbered "${input.agreementNo}" already exists on this project — agreement_no is unique per project`,
        );
      }
      throw error;
    }
    await this.audit.record({
      action: "projects.subcontract_agreement_created",
      entityType: "subcontractor_agreement",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        projectId,
        agreementNo: created.agreementNo,
        agreementValue: created.agreementValue,
        retentionPercent: created.retentionPercent,
        status: created.status,
      },
    });
    return created;
  }

  async listAgreements(projectId: string): Promise<SubcontractAgreementRow[]> {
    await requireUuid(projectId, "projectId");
    const project = await findProjectPlane(projectId);
    if (project === undefined) throw new ProjectPlaneNotFoundError(projectId);
    return store.listSubcontractAgreements(projectId);
  }

  /** PHASE-048 (W-13 — T-15): the contracting screen's project pool —
   * the SAME one-store read the WBS board's pool rides (T-14's own
   * law), bound here on the CONTRACTING plane's own viewer key so the
   * screen renders for contracting-only sessions (the W-12 step-2
   * precedent, mirrored; zero parallel computation — one store read,
   * two plane keys). */
  async listProjects(): Promise<
    readonly { id: string; code: string; name: string; nameAr: string | null; status: string }[]
  > {
    return listProjectPlane();
  }

  async getAgreement(id: string): Promise<SubcontractAgreementRow> {
    const agreement = await store.findSubcontractAgreementById(
      requireUuid(id, "agreementId"),
    );
    if (agreement === undefined) throw new SubcontractAgreementNotFoundError(id);
    return agreement;
  }

  /** DRAFT → ACTIVE + the agreement's SUBCONTRACTOR retention row in
   * the SAME transaction (the SAME retention ledger — D-08's law; the
   * 0103 partial unique is the one-row-per-agreement floor). */
  async activateAgreement(id: string, actorId: string | null): Promise<{
    agreement: SubcontractAgreementRow;
    retentionAccountId: string;
  }> {
    const agreementId = requireUuid(id, "agreementId");
    const current = await store.findSubcontractAgreementById(agreementId);
    if (current === undefined) throw new SubcontractAgreementNotFoundError(agreementId);
    if (current.status !== "DRAFT") {
      throw new SubcontractStateError(
        `agreement ${agreementId} is ${current.status} — only DRAFT agreements activate`,
        { agreementId, status: current.status },
      );
    }
    const moved = await store.casSubcontractAgreementStatus({
      id: agreementId,
      from: "DRAFT",
      to: "ACTIVE",
      actorId,
    });
    if (moved === undefined) {
      throw new SubcontractStateError(
        `agreement ${agreementId} left DRAFT concurrently — reload and retry (the CAS guard)`,
        { agreementId },
      );
    }
    const retention = await store.findSubcontractorRetentionRow(agreementId);
    let retentionAccountId: string;
    if (retention === undefined) {
      const row = await store.insertSubcontractorRetentionRow({
        projectId: current.projectId,
        agreementId,
        note: `Agreement ${current.agreementNo} — sub retention ledger row`,
        actorId,
      });
      retentionAccountId = row.id;
    } else {
      retentionAccountId = retention.id;
    }
    await this.audit.record({
      action: "projects.subcontract_agreement_activated",
      entityType: "subcontractor_agreement",
      entityId: agreementId,
      actorId: actorId ?? undefined,
      before: { status: "DRAFT" },
      after: { status: "ACTIVE", retentionAccountId },
    });
    return { agreement: moved, retentionAccountId };
  }

  async closeAgreement(id: string, actorId: string | null): Promise<SubcontractAgreementRow> {
    const agreementId = requireUuid(id, "agreementId");
    const current = await store.findSubcontractAgreementById(agreementId);
    if (current === undefined) throw new SubcontractAgreementNotFoundError(agreementId);
    if (current.status !== "ACTIVE") {
      throw new SubcontractStateError(
        `agreement ${agreementId} is ${current.status} — only ACTIVE agreements close`,
        { agreementId, status: current.status },
      );
    }
    const moved = await store.casSubcontractAgreementStatus({
      id: agreementId,
      from: "ACTIVE",
      to: "CLOSED",
      actorId,
    });
    if (moved === undefined) {
      throw new SubcontractStateError(
        `agreement ${agreementId} left ACTIVE concurrently — reload and retry (the CAS guard)`,
        { agreementId },
      );
    }
    await this.audit.record({
      action: "projects.subcontract_agreement_closed",
      entityType: "subcontractor_agreement",
      entityId: agreementId,
      actorId: actorId ?? undefined,
      before: { status: "ACTIVE" },
      after: { status: "CLOSED" },
    });
    return moved;
  }

  async cancelAgreement(
    id: string,
    reason: string,
    actorId: string | null,
  ): Promise<SubcontractAgreementRow> {
    const agreementId = requireUuid(id, "agreementId");
    if (reason.trim().length < 3 || reason.length > 500) {
      throw new ContractingInputInvalidError(
        "a cancellation carries its reason (3…500 characters) — 0103's CHECK",
      );
    }
    const current = await store.findSubcontractAgreementById(agreementId);
    if (current === undefined) throw new SubcontractAgreementNotFoundError(agreementId);
    if (current.status !== "DRAFT" && current.status !== "ACTIVE") {
      throw new SubcontractStateError(
        `agreement ${agreementId} is ${current.status} — only DRAFT or ACTIVE agreements cancel`,
        { agreementId, status: current.status },
      );
    }
    const moved = await store.casSubcontractAgreementStatus({
      id: agreementId,
      from: current.status,
      to: "CANCELLED",
      actorId,
      cancelReason: reason,
    });
    if (moved === undefined) {
      throw new SubcontractStateError(
        `agreement ${agreementId} moved concurrently — reload and retry (the CAS guard)`,
        { agreementId },
      );
    }
    await this.audit.record({
      action: "projects.subcontract_agreement_cancelled",
      entityType: "subcontractor_agreement",
      entityId: agreementId,
      actorId: actorId ?? undefined,
      before: { status: current.status },
      after: { status: "CANCELLED", reason },
    });
    return moved;
  }

  // -- the sub certificates (the sub مستخلص) ---------------------------------

  /** The authoring: the amounts DERIVED from the agreement's own
   * retention terms (BR-092 per agreement — the caller supplies the
   * gross + the progress % only). */
  async createCertificate(input: {
    agreementId: string;
    certificateNo: string | null;
    certificateDate: string;
    progressPercent: string;
    grossValue: string;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
  }): Promise<SubcontractCertificateRow> {
    const agreementId = requireUuid(input.agreementId, "agreementId");
    if (!DATE_RE.test(input.certificateDate)) {
      throw new ContractingInputInvalidError("certificateDate must be an ISO date (YYYY-MM-DD)");
    }
    if (!PCT_RE.test(input.progressPercent) || Number(input.progressPercent) > 100) {
      throw new ContractingInputInvalidError(
        `progressPercent must be within [0, 100] (≤ 2dp): ${input.progressPercent}`,
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
    const agreement = await store.findSubcontractAgreementById(agreementId);
    if (agreement === undefined) throw new SubcontractAgreementNotFoundError(agreementId);
    if (agreement.status !== "ACTIVE") {
      throw new SubcontractStateError(
        `agreement ${agreementId} is ${agreement.status} — certificates ride ACTIVE agreements only`,
        { agreementId, status: agreement.status },
      );
    }
    // BR-092 per agreement: the engine derives the pair (never the caller).
    const amounts = certificateAmounts(input.grossValue, agreement.retentionPercent);
    let created: SubcontractCertificateRow;
    try {
      created = await store.insertSubcontractCertificate({
        agreementId,
        certificateNo: input.certificateNo,
        certificateDate: input.certificateDate,
        progressPercent: input.progressPercent,
        grossValue: input.grossValue,
        retentionWithheld: amounts.retention,
        netPayable: amounts.net,
        note: input.note,
        noteAr: input.noteAr,
        actorId: input.actorId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ContractingInputInvalidError(
          `a certificate numbered "${input.certificateNo}" already exists on this agreement — certificate_no is unique per agreement`,
        );
      }
      throw error;
    }
    await this.audit.record({
      action: "projects.subcontract_certificate_created",
      entityType: "subcontractor_certificate",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        agreementId,
        grossValue: created.grossValue,
        retentionWithheld: created.retentionWithheld,
        netPayable: created.netPayable,
        status: created.status,
      },
    });
    return created;
  }

  async listCertificates(agreementId: string): Promise<SubcontractCertificateRow[]> {
    await requireUuid(agreementId, "agreementId");
    await this.getAgreement(agreementId);
    return store.listSubcontractCertificates(agreementId);
  }

  async getCertificate(id: string): Promise<SubcontractCertificateRow> {
    const certificate = await store.findSubcontractCertificateById(
      requireUuid(id, "certificateId"),
    );
    if (certificate === undefined) throw new SubcontractCertificateNotFoundError(id);
    return certificate;
  }

  // -- THE APPROVAL GATE (the AP linkage + G-55's hold, all-or-nothing) -------

  /**
   * DRAFT → APPROVED + the AP linkage + G-55's sub-side hold in ONE
   * ambient transaction: the verdict CAS, the net obligation through
   * the REAL engine (PROJECT-STAMPED — the actuals' own GL carry), the
   * retention hold (UNPROJECTED cost + the liability), the ledger
   * accrual, and the single-use AP stamp — a posting failure rolls the
   * whole approval back to DRAFT; INV-033 runs after EACH posting (the
   * owner's W-11 clause 4).
   */
  async approveCertificate(input: {
    id: string;
    /** The agreement-currency FX rate at posting (required when the
     * agreement's currency ≠ the tenant base — the engine's own
     * fail-closed law; ignored at rate 1 for base contracts). */
    exchangeRate?: string;
    actorId: string | null;
  }): Promise<SubcontractCertificateApproval> {
    const certificateId = requireUuid(input.id, "certificateId");
    const current = await store.findSubcontractCertificateById(certificateId);
    if (current === undefined) throw new SubcontractCertificateNotFoundError(certificateId);
    if (current.status === "APPROVED") {
      throw new SubcontractCertificateAlreadyApprovedError(
        `certificate ${certificateId} is already APPROVED — the approved history is terminal (0103's CHECK); the AP stamp is single-use`,
        { certificateId },
      );
    }
    if (current.status !== "DRAFT") {
      throw new SubcontractStateError(
        `certificate ${certificateId} is ${current.status} — only DRAFT certificates approve`,
        { certificateId, status: current.status },
      );
    }
    const agreement = await store.findSubcontractAgreementById(current.agreementId);
    if (agreement === undefined) throw new SubcontractAgreementNotFoundError(current.agreementId);
    if (agreement.status !== "ACTIVE") {
      throw new SubcontractStateError(
        `agreement ${current.agreementId} is ${agreement.status} — an approval rides ACTIVE agreements only`,
        { agreementId: current.agreementId, status: agreement.status },
      );
    }
    const retentionRow = await store.findSubcontractorRetentionRow(current.agreementId);
    if (retentionRow === undefined) {
      throw new RetentionStateError(
        `the agreement ${current.agreementId} has no SUBCONTRACTOR retention row — the ledger row lands at the agreement's ACTIVATION (the same ledger, D-08)`,
        { agreementId: current.agreementId },
      );
    }

    // The verdict CAS — one guarded UPDATE (a raced move refuses).
    const approved = await store.casSubcontractCertificateStatus({
      id: certificateId,
      from: "DRAFT",
      to: "APPROVED",
      actorId: input.actorId,
    });
    if (approved === undefined) {
      throw new SubcontractStateError(
        `certificate ${certificateId} left DRAFT concurrently — reload and retry (the CAS guard)`,
        { certificateId },
      );
    }

    const entryDate = current.certificateDate;
    const currency =
      agreement.currencyCode === (await ownTenantBaseCurrency())
        ? await ownTenantBaseCurrency()
        : agreement.currencyCode;
    const fx = currency === (await ownTenantBaseCurrency()) ? undefined : input.exchangeRate;

    // Posting 1 — THE AP LINKAGE (the net obligation into the
    // purchasing chain's AP leg): DR the mapped subcontract cost (the
    // NET, PROJECT-STAMPED — the collector's own read lands in the GL
    // dimension, INV-033 by construction) · CR AP_CONTROL (the net,
    // partner-stamped — INV-009).
    const apResult = await this.posting.post(
      {
        source: { docType: "subcontractor_certificate", docId: certificateId, operation: "approve" },
        entryDate,
        description: {
          en: `Subcontractor certificate ${current.certificateNo ?? certificateId} — the AP linkage (net ${current.netPayable})`,
          ar: `مستخلص مقاول الباطن ${current.certificateNo ?? certificateId} — ربط الذمون الدائنة (الصافي ${current.netPayable})`,
        },
        currency,
        exchangeRate: fx,
        lines: [
          {
            purpose: "PROJECT_SUBCONTRACT_COST",
            direction: "DEBIT",
            amount: current.netPayable,
            projectId: agreement.projectId,
            memo: {
              en: "Subcontract certificate — net cost (the actuals' GL carry)",
              ar: "مستخلص باطن — التكلفة الصافية (حمل الأبعاد الفعلية)",
            },
          },
          {
            purpose: "AP_CONTROL",
            direction: "CREDIT",
            amount: current.netPayable,
            partnerId: agreement.partnerId,
            memo: {
              en: "Subcontract certificate — the net payable",
              ar: "مستخلص باطن — المستحق الصافي",
            },
          },
        ],
      },
      { postedBy: input.actorId },
    );
    // INV-033 after the posting (the owner's W-11 clause 4): the
    // four-leg AC vs the GL project dimension — to the cent.
    await this.actuals.inv033(agreement.projectId);

    // Posting 2 — G-55's sub-side hold (the SAME retention ledger):
    // the withheld retention accrues as the deferred liability; the
    // cost-family debit carries NO project stamp (the actuals law
    // reads the nets — W-9's pinned world; the unprojected hold is
    // the wave's documented presentation decision). A ZERO retention
    // posts NO hold journal (the honest shape).
    let holdJournalEntryId: string | null = null;
    if (current.retentionWithheld !== "0.0000") {
      const holdResult = await this.posting.post(
        {
          source: {
            docType: "subcontractor_certificate",
            docId: certificateId,
            operation: "hold_retention",
          },
          entryDate,
          description: {
            en: `Subcontractor certificate ${current.certificateNo ?? certificateId} — G-55 retention hold ${current.retentionWithheld}`,
            ar: `مستخلص مقاول الباطن ${current.certificateNo ?? certificateId} — حجز الاستقطاع G-55 ${current.retentionWithheld}`,
          },
          currency,
          exchangeRate: fx,
          lines: [
            {
              purpose: "PROJECT_SUBCONTRACT_COST",
              direction: "DEBIT",
              amount: current.retentionWithheld,
              memo: {
                en: "G-55 sub retention hold (the deferred cost, unprojected)",
                ar: "حجز استقطاع الباطن G-55 (التكلفة المؤجلة، بلا بُعد)",
              },
            },
            {
              purpose: "SUBCONTRACT_RETENTION",
              direction: "CREDIT",
              amount: current.retentionWithheld,
              partnerId: agreement.partnerId,
              memo: {
                en: "G-55 sub retention — the deferred liability",
                ar: "استقطاع الباطن G-55 — الالتزام المؤجل",
              },
            },
          ],
        },
        { postedBy: input.actorId },
      );
      holdJournalEntryId = holdResult.journalEntryId;
      // INV-033 after EACH posting (clause 4).
      await this.actuals.inv033(agreement.projectId);
      await store.accrueRetention(retentionRow.id, current.retentionWithheld);
    }

    // THE SINGLE-USE AP STAMP — only after both postings succeeded,
    // in the same ambient transaction (all-or-nothing with the
    // verdict and the journals).
    const stamped = await store.stampSubCertificateApJournal(certificateId, apResult.journalEntryId);
    if (!stamped) {
      throw new SubcontractCertificateAlreadyApprovedError(
        `certificate ${certificateId}'s AP linkage was already stamped — the stamp is single-use`,
        { certificateId },
      );
    }

    await this.audit.record({
      action: "projects.subcontract_certificate_approved",
      entityType: "subcontractor_certificate",
      entityId: certificateId,
      actorId: input.actorId ?? undefined,
      before: { status: "DRAFT" },
      after: {
        status: "APPROVED",
        netPayable: current.netPayable,
        retentionWithheld: current.retentionWithheld,
        apJournalEntryId: apResult.journalEntryId,
        holdJournalEntryId,
      },
    });

    const after = await store.findSubcontractCertificateById(certificateId);
    const ledger = await store.findSubcontractorRetentionRow(current.agreementId);
    return {
      certificate: after ?? approved,
      apJournalEntryId: apResult.journalEntryId,
      holdJournalEntryId,
      retentionAccruedBalance: ledger?.accruedBalance ?? "0.0000",
    };
  }

  /** DRAFT → VOID (the never-approved path only — 0103's CHECK pins
   * APPROVED as terminal; the sub certificates carry no reason column,
   * the note is the evidence surface). */
  async voidCertificate(
    id: string,
    reason: string,
    actorId: string | null,
  ): Promise<SubcontractCertificateRow> {
    const certificateId = requireUuid(id, "certificateId");
    if (reason.trim().length < 3 || reason.length > 500) {
      throw new ContractingInputInvalidError("a void carries its reason (3…500 characters)");
    }
    const current = await store.findSubcontractCertificateById(certificateId);
    if (current === undefined) throw new SubcontractCertificateNotFoundError(certificateId);
    if (current.status === "APPROVED") {
      throw new SubcontractCertificateAlreadyApprovedError(
        `certificate ${certificateId} is APPROVED — the approved history is terminal (no VOID, 0103's CHECK)`,
        { certificateId },
      );
    }
    if (current.status !== "DRAFT") {
      throw new SubcontractStateError(
        `certificate ${certificateId} is ${current.status} — only DRAFT certificates void`,
        { certificateId, status: current.status },
      );
    }
    const moved = await store.casSubcontractCertificateStatus({
      id: certificateId,
      from: "DRAFT",
      to: "VOID",
      actorId,
    });
    if (moved === undefined) {
      throw new SubcontractStateError(
        `certificate ${certificateId} left DRAFT concurrently — reload and retry (the CAS guard)`,
        { certificateId },
      );
    }
    await this.audit.record({
      action: "projects.subcontract_certificate_voided",
      entityType: "subcontractor_certificate",
      entityId: certificateId,
      actorId: actorId ?? undefined,
      before: { status: "DRAFT" },
      after: { status: "VOID", reason },
    });
    return moved;
  }
}
