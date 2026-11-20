import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import { ProjectActualsService } from "./project-actuals-service";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import { releaseGatesSatisfied } from "../domain/contracting-math";
import {
  ProjectPlaneNotFoundError,
  RetentionAccountNotFoundError,
  RetentionInputInvalidError,
  RetentionRegisterExistsError,
  RetentionRegisterImmutableError,
  RetentionReleaseGateError,
  RetentionStateError,
  SubcontractAgreementNotFoundError,
} from "../domain/projects-errors";
import * as store from "../infrastructure/contracting.store";
import type { RetentionAccountRow } from "../infrastructure/contracting.store";
import { findProjectPlane } from "../infrastructure/projects.store";

/**
 * PHASE-048 (W-11 — T-11) — the retention ledger engine (D-09):
 * `retention_accounts` — ONE ledger, BOTH sides (the 0103 side law):
 * the CUSTOMER row per project IS the customer contract's commercial
 * register (contract value + currency + hold % + the contract's
 * CUSTOMER — BR-092's tenant DATA per contract), and the
 * SUBCONTRACTOR row per agreement (created at the agreement's
 * ACTIVATION by the subcontract engine — the terms read from the
 * agreement). G-55's holds accrue on these rows (the billing and sub
 * engines' own approvals); THIS engine owns the register's authoring
 * and **G-56 — the release at final acceptance**.
 *
 * THE LAWS:
 *
 * - **THE ONE-REGISTER-PER-PROJECT LAW** (0103's partial unique): a
 *   second CUSTOMER register for the same project is the typed 23505
 *   refusal — never a silent replace.
 * - **THE REGISTER'S IMMUTABLE CORE**: the contract value + currency +
 *   customer NEVER move after creation — the ONLY re-planning path is
 *   the approved change order (W-10's ruling; BR-093's ceiling base);
 *   the patchable terms are the hold % (the contract's own retention
 *   terms), the release schedule and the notes.
 * - **G-56 (the release)**: the release at final acceptance — the
 *   schedule's gates first (the taking-over date SET and ELAPSED; a
 *   contracted defect-liability date ALSO elapsed — the retention
 *   secures the DLP), then ONE ambient transaction: the release
 *   posting through the REAL engine + the single-use CAS (status
 *   ACTIVE → RELEASED, released_amount = the accrued balance in the
 *   SAME guarded statement). The two sides' shapes (the wave's
 *   documented presentation decision — the receivable presentation):
 *   - CUSTOMER side: DR `AR_CONTROL` (the released balance,
 *     partner-stamped — the customer now owes the released retention
 *     as ordinary AR) · CR `CONTRACT_RETENTION` (the retention
 *     receivable clears);
 *   - SUBCONTRACTOR side (the D-18 G-56 wording's literal shape): DR
 *     `SUBCONTRACT_RETENTION` (the deferred liability clears) · CR
 *     `AP_CONTROL` (the sub collects through AP, partner-stamped).
 * - **INV-033 AFTER THE POSTING** (the owner's W-11 clause 4): the
 *   release postings carry NO project stamps (the retention/AR/AP
 *   legs are not the cost carry) — the check runs and stays green by
 *   construction.
 * - **NO DELETE** (0103's evidence discipline: the ledger is the
 *   contract's financial history).
 * - Money is numeric(19,4) EXCLUSIVELY (ADR-0009).
 */

const UUID_RE = /^[0-9a-fA-F-]{36}$/;
const MONEY_RE = /^\d+(\.\d{1,4})?$/;
const PCT_RE = /^\d+(\.\d{1,2})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
    throw new RetentionInputInvalidError(`${what} must be a uuid: ${value}`);
  }
  return value;
}

function requireDate(value: string | null, what: string): string | null {
  if (value !== null && !DATE_RE.test(value)) {
    throw new RetentionInputInvalidError(`${what} must be an ISO date (YYYY-MM-DD) or null`);
  }
  return value;
}

export interface RetentionReleaseResult {
  readonly account: RetentionAccountRow;
  readonly releasedAmount: string;
  readonly journalEntryId: string;
}

@Injectable()
export class RetentionService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(ProjectActualsService) private readonly actuals: ProjectActualsService,
  ) {}

  // -- the CUSTOMER register (the contract's commercial spine) ----------------

  /** The register's authoring: the contract's value + currency + hold
   * % + the CUSTOMER — the G-57 billing's single source of truth (the
   * AR partner stamp + the invoice's customer + BR-092's hold %). */
  async createRegister(input: {
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
    const projectId = requireUuid(input.projectId, "projectId");
    const project = await findProjectPlane(projectId);
    if (project === undefined) throw new ProjectPlaneNotFoundError(projectId);
    requireUuid(input.customerId, "customerId");
    const partnersStore = await import("../../partners/infrastructure/partners.store");
    const partner = await partnersStore.findPartnerById(input.customerId);
    if (partner === undefined || partner.kind === "SUPPLIER") {
      throw new RetentionInputInvalidError(
        `partner ${input.customerId} is not a customer — the register binds the contract's CUSTOMER (or BOTH) counterparty`,
      );
    }
    if (!MONEY_RE.test(input.contractValue) || Number(input.contractValue) <= 0) {
      throw new RetentionInputInvalidError(
        `contractValue must be a positive decimal (≤ 4dp — 0103's CHECK): ${input.contractValue}`,
      );
    }
    if (!PCT_RE.test(input.holdPercent) || Number(input.holdPercent) > 100) {
      throw new RetentionInputInvalidError(
        `holdPercent must be within [0, 100] (≤ 2dp — BR-092's tenant DATA per contract): ${input.holdPercent}`,
      );
    }
    if (input.currencyCode.length !== 3) {
      throw new RetentionInputInvalidError("currencyCode must be a 3-letter ISO code");
    }
    requireDate(input.takingOverDate, "takingOverDate");
    requireDate(input.defectLiabilityDate, "defectLiabilityDate");
    const existing = await store.findCustomerRetentionRegister(projectId);
    if (existing !== undefined) {
      throw new RetentionRegisterExistsError(
        `project ${projectId} already carries its CUSTOMER retention register (the contract's commercial spine — ONE per project, 0103's partial unique); the re-planning path is the approved change order, never a second register`,
        { projectId, registerId: existing.id },
      );
    }
    let created: RetentionAccountRow;
    try {
      created = await store.insertCustomerRetentionRegister({
        projectId,
        customerId: input.customerId,
        contractValue: input.contractValue,
        currencyCode: input.currencyCode,
        holdPercent: input.holdPercent,
        takingOverDate: input.takingOverDate,
        defectLiabilityDate: input.defectLiabilityDate,
        note: input.note,
        noteAr: input.noteAr,
        actorId: input.actorId,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new RetentionRegisterExistsError(
          `project ${projectId} already carries its CUSTOMER retention register — ONE per project (0103's partial unique)`,
          { projectId },
        );
      }
      throw error;
    }
    await this.audit.record({
      action: "projects.retention_register_created",
      entityType: "retention_account",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        projectId,
        customerId: input.customerId,
        contractValue: created.contractValue,
        holdPercent: created.holdPercent,
      },
    });
    return created;
  }

  /** The register's read (the billing engine + the screens). */
  async register(projectId: string): Promise<RetentionAccountRow> {
    await requireUuid(projectId, "projectId");
    const row = await store.findCustomerRetentionRegister(projectId);
    if (row === undefined) {
      throw new RetentionStateError(
        `project ${projectId} carries no CUSTOMER retention register — the billing refuses (BR-092's fail-closed law)`,
        { projectId },
      );
    }
    return row;
  }

  /** The patchable terms ONLY: the hold % (the contract's own
   * retention terms), the release schedule and the notes. The
   * immutable core (value · currency · customer) is the typed refusal
   * — the ONLY re-planning path is the approved change order. */
  async patchRegister(input: {
    id: string;
    contractValue?: string;
    currencyCode?: string;
    customerId?: string;
    holdPercent?: string;
    takingOverDate?: string | null;
    defectLiabilityDate?: string | null;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<RetentionAccountRow> {
    const id = requireUuid(input.id, "retentionAccountId");
    if (input.contractValue !== undefined || input.currencyCode !== undefined || input.customerId !== undefined) {
      throw new RetentionRegisterImmutableError(
        "the register's contract value, currency and customer are IMMUTABLE — the only re-planning path is the approved change order (W-10's ruling; BR-093's ceiling base)",
        { retentionAccountId: id },
      );
    }
    if (input.holdPercent !== undefined && (!PCT_RE.test(input.holdPercent) || Number(input.holdPercent) > 100)) {
      throw new RetentionInputInvalidError(
        `holdPercent must be within [0, 100] (≤ 2dp): ${input.holdPercent}`,
      );
    }
    requireDate(input.takingOverDate ?? null, "takingOverDate");
    requireDate(input.defectLiabilityDate ?? null, "defectLiabilityDate");
    const patched = await store.patchRetentionRegister({
      id,
      holdPercent: input.holdPercent ?? null,
      takingOverDate: input.takingOverDate ?? null,
      defectLiabilityDate: input.defectLiabilityDate ?? null,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      actorId: input.actorId,
    });
    if (patched === undefined) {
      throw new RetentionStateError(
        `retention account ${id} is not ACTIVE (or does not exist) — a RELEASED ledger row never edits`,
        { retentionAccountId: id },
      );
    }
    await this.audit.record({
      action: "projects.retention_register_patched",
      entityType: "retention_account",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: {
        holdPercent: patched.holdPercent,
        takingOverDate: patched.takingOverDate,
        defectLiabilityDate: patched.defectLiabilityDate,
      },
    });
    return patched;
  }

  /** The whole ledger view for a project (the customer register + every
   * sub row — the W-13 screen's read). */
  async ledger(projectId: string): Promise<RetentionAccountRow[]> {
    await requireUuid(projectId, "projectId");
    const project = await findProjectPlane(projectId);
    if (project === undefined) throw new ProjectPlaneNotFoundError(projectId);
    return store.listRetentionLedger(projectId);
  }

  // -- G-56: the release at final acceptance ---------------------------------

  /**
   * THE RELEASE — the schedule's gates first (the pure fold), then ONE
   * ambient transaction: the G-56 posting through the REAL engine, the
   * single-use CAS (ACTIVE → RELEASED with released_amount = the
   * accrued balance), and the INV-033 check after the posting (the
   * owner's W-11 clause 4). The whole accrued balance releases at
   * once (the single-date 0103 shape — no tranche split).
   */
  async release(input: {
    id: string;
    exchangeRate?: string;
    actorId: string | null;
  }): Promise<RetentionReleaseResult> {
    const id = requireUuid(input.id, "retentionAccountId");
    const account = await store.findRetentionAccountById(id);
    if (account === undefined) throw new RetentionAccountNotFoundError(id);
    if (account.status !== "ACTIVE") {
      throw new RetentionStateError(
        `retention account ${id} is ${account.status} — a RELEASED ledger row never re-releases (the single-consumption CAS)`,
        { retentionAccountId: id, status: account.status },
      );
    }
    if (account.accruedBalance === "0.0000") {
      throw new RetentionStateError(
        `retention account ${id} carries a zero accrued balance — nothing to release (the honest refusal, never an empty posting)`,
        { retentionAccountId: id },
      );
    }

    // The schedule's gates (the documented law): taking-over SET and
    // elapsed; a contracted DLP ALSO elapsed.
    const today = new Date().toISOString().slice(0, 10);
    const gates = releaseGatesSatisfied({
      today,
      takingOverDate: account.takingOverDate,
      defectLiabilityDate: account.defectLiabilityDate,
    });
    if (!gates.satisfied) {
      throw new RetentionReleaseGateError(
        `retention account ${id}'s release gates are not satisfied (${gates.blocker}) — the release waits for the schedule (taking-over ${account.takingOverDate ?? "unset"} · defect-liability ${account.defectLiabilityDate ?? "not contracted"} · today ${today})`,
        {
          retentionAccountId: id,
          blocker: gates.blocker ?? "UNKNOWN",
          takingOverDate: account.takingOverDate ?? "unset",
          defectLiabilityDate: account.defectLiabilityDate ?? "not contracted",
          today,
        },
      );
    }

    // The counterparty + the currency per side (the side law: the
    // CUSTOMER row's own terms; the SUBCONTRACTOR row reads the
    // agreement).
    let partnerId: string;
    let currency: string;
    if (account.kind === "CUSTOMER") {
      if (account.customerId === null) {
        throw new RetentionStateError(
          `the CUSTOMER register ${id} carries no customer partner (a pre-W-11 row) — the release requires the contract's customer (0104's column; re-author the register)`,
          { retentionAccountId: id },
        );
      }
      partnerId = account.customerId;
      currency = account.currencyCode ?? (await ownTenantBaseCurrency());
    } else {
      const agreement = await store.findSubcontractAgreementById(account.subcontractorAgreementId!);
      if (agreement === undefined) {
        throw new SubcontractAgreementNotFoundError(account.subcontractorAgreementId!);
      }
      partnerId = agreement.partnerId;
      currency = agreement.currencyCode;
    }
    const base = await ownTenantBaseCurrency();
    const fx = currency === base ? undefined : input.exchangeRate;

    // The G-56 posting — the two sides' documented shapes.
    const released = account.accruedBalance;
    const result = await this.posting.post(
      {
        source: { docType: "retention_account", docId: id, operation: "release" },
        entryDate: today,
        description: {
          en: `Retention release (G-56) — ${account.kind} account, ${released}`,
          ar: `تسليم الاستقطاع (G-56) — حساب ${account.kind === "CUSTOMER" ? "العميل" : "مقاول الباطن"}، ${released}`,
        },
        currency,
        exchangeRate: fx,
        lines:
          account.kind === "CUSTOMER"
            ? [
                {
                  purpose: "AR_CONTROL",
                  direction: "DEBIT",
                  amount: released,
                  partnerId,
                  memo: {
                    en: "G-56 retention release — the customer owes the released balance",
                    ar: "تسليم الاستقطاع G-56 — المبلغ المسلّم على العميل",
                  },
                },
                {
                  purpose: "CONTRACT_RETENTION",
                  direction: "CREDIT",
                  amount: released,
                  memo: {
                    en: "G-56 retention release — the retention receivable clears",
                    ar: "تسليم الاستقطاع G-56 — تصفية مستحق الاستقطاع",
                  },
                },
              ]
            : [
                {
                  purpose: "SUBCONTRACT_RETENTION",
                  direction: "DEBIT",
                  amount: released,
                  partnerId,
                  memo: {
                    en: "G-56 sub retention release — the deferred liability clears",
                    ar: "تسليم استقطاع الباطن G-56 — تصفية الالتزام المؤجل",
                  },
                },
                {
                  purpose: "AP_CONTROL",
                  direction: "CREDIT",
                  amount: released,
                  partnerId,
                  memo: {
                    en: "G-56 sub retention release — the sub collects through AP",
                    ar: "تسليم استقطاع الباطن G-56 — التحصيل عبر الذمون الدائنة",
                  },
                },
              ],
      },
      { postedBy: input.actorId },
    );
    // INV-033 after the posting (clause 4): the release legs carry NO
    // project stamps — green by construction, checked anyway.
    await this.actuals.inv033(account.projectId);

    // THE SINGLE-USE RELEASE CAS — only after the posting succeeded,
    // in the same ambient transaction.
    const after = await store.casReleaseRetention({ id, actorId: input.actorId });
    if (after === undefined) {
      throw new RetentionStateError(
        `retention account ${id} left ACTIVE concurrently (or already released) — reload and retry (the single-consumption CAS)`,
        { retentionAccountId: id },
      );
    }

    await this.audit.record({
      action: "projects.retention_released",
      entityType: "retention_account",
      entityId: id,
      actorId: input.actorId ?? undefined,
      before: { status: "ACTIVE", accruedBalance: account.accruedBalance },
      after: {
        status: "RELEASED",
        releasedAmount: after.releasedAmount,
        journalEntryId: result.journalEntryId,
      },
    });
    return { account: after, releasedAmount: after.releasedAmount, journalEntryId: result.journalEntryId };
  }
}
