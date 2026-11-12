import { Inject, Injectable, Optional } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import type { JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { InboxService } from "../../notifications/application/inbox-service";
import { OutboxService } from "../../communication/application/outbox/outbox-service";
import type { RenderedTemplate } from "../../communication/application/template-service";
import { TemplateService } from "../../communication/application/template-service";
import { ambientTx } from "../../../infra/db/tenant-context";
import { readEffectiveSetting, ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import * as salesStore from "../infrastructure/sales.store";
import * as store from "../infrastructure/dunning.store";
import {
  AgencyTokenInvalidError,
  CollectionAgencyNotFoundError,
  CommissionAccountUnmappedError,
  CreditReviewInvalidError,
  DunningPolicyNotFoundError,
  DunningPolicyStepsInvalidError,
  LateFeeAlreadyChargedError,
  LateFeeConfigInvalidError,
  LateFeeNotWaivableError,
  ReferralNotFoundError,
  ReferralStateInvalidError,
  SalesDocumentStateError,
  SalesInvoiceNotFoundError,
} from "../domain/sales-errors";
import { SalesInvoiceService } from "./invoices";

/**
 * Dunning service (PHASE-039 T-06..T-10; migrations 0056/0057/0058): the
 * collections ladder — BR-065 MONOTONIC (steps advance one per run, never
 * skip, never regress; the dunning_letters UNIQUE (tenant, invoice, step)
 * is the re-fire guard), the late-fee register (L1-12) riding the letter
 * that invoked the charge, the collection-agency terminal action (L1-11)
 * and the periodic partner credit reviews (L1-10).
 *
 * G-39 — the collection-commission journal (implementation-bound, the next
 * free after G-38): at referral settlement the agency's commission posts
 * through the engine exactly once:
 *
 *   DR sales.collection_commission_account (readEffectiveSetting —
 *      fail-closed: unmapped → CommissionAccountUnmappedError BEFORE any
 *      ledger work, zero partial writes)
 *   CR AP_CONTROL (partnerId = the AGENCY's partner — the payable the
 *      treasury later pays)
 *
 * INV-013: the source key {docType: "collection_referral", docId,
 * operation: "commission"} makes the posting exactly-once; the referral's
 * COMMISSION_POSTED stamp + journal columns carry the evidence.
 *
 * The fee invoice (L1-12): a late fee is charged by CREATING + POSTING a
 * sales invoice (kind CREDIT, channel STANDARD) with ONE line — the item
 * from readEffectiveSetting("sales.late_fee_item") (unmapped → fail-closed
 * zero-partial), qty 1, unitPrice = the fee; VAT flows through the
 * invoice's own tax machinery (the item's tax code resolves + re-verifies
 * at post like every line). Actor-arm decision (documented): the fee
 * invoice is created with actorId NULL (system provenance — the letter
 * invoked the charge, so the approve-step SoD can never fire) and
 * approved with the invoice service's documented override arm
 * (approve(id, actor, override=true) — the charging actor already holds
 * sales.late-fees.manage at the controller; blocking the fee on the very
 * delinquency it remedies would be circular, and the override is audited
 * as sales.credit_check_overridden inside the invoice service).
 *
 * Email delivery decision (documented): the EmailService template union is
 * CLOSED (limit_warning | subscription_state | invoice_overdue |
 * task_reminder) — a dunning template cannot ride it. EMAIL letters
 * therefore store the deterministic bilingual snapshot + the contact
 * email on the letter row and are marked SENT: the register IS the
 * delivery evidence (0056's letter columns exist for exactly this).
 * WHATSAPP/SMS letters persist QUEUED — delivered post-041 through the
 * channel port (the phase doc's explicit deferral).
 */

// -- the ladder (pure — unit-tested) -----------------------------------------------------

export interface DunningStep {
  stepNo: number;
  daysOverdue: number;
  channel: "EMAIL" | "WHATSAPP" | "SMS";
  templateKey: string;
  escalate: boolean;
  referToAgency: boolean;
}

const STEP_CHANNELS: ReadonlySet<string> = new Set(["EMAIL", "WHATSAPP", "SMS"]);

/** The ladder's hard bound (a runaway ladder is a config error). */
export const DUNNING_MAX_STEPS = 20;

/**
 * Ladder validation (throwing — the create/update gate): non-empty,
 * stepNo 1..N ascending contiguous, daysOverdue strictly ascending > 0,
 * channel in the vocabulary, templateKey non-empty, and referToAgency only
 * on the TERMINAL step (the ladder's last escalation is the agency handoff).
 */
export function validateDunningSteps(raw: readonly Record<string, unknown>[]): DunningStep[] {
  if (raw.length === 0) {
    throw new DunningPolicyStepsInvalidError("a dunning policy must carry at least one step");
  }
  if (raw.length > DUNNING_MAX_STEPS) {
    throw new DunningPolicyStepsInvalidError(`a dunning policy carries at most ${DUNNING_MAX_STEPS} steps`);
  }
  const steps: DunningStep[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const entry = raw[index]!;
    const where = `steps[${index}]`;
    const stepNo = entry.stepNo;
    const daysOverdue = entry.daysOverdue;
    const channel = entry.channel;
    const templateKey = entry.templateKey;
    if (typeof stepNo !== "number" || !Number.isInteger(stepNo)) {
      throw new DunningPolicyStepsInvalidError(`${where}.stepNo must be an integer (got ${String(stepNo)})`);
    }
    if (stepNo !== index + 1) {
      throw new DunningPolicyStepsInvalidError(
        `steps must number 1..N in order — ${where}.stepNo is ${stepNo}, expected ${index + 1}`,
      );
    }
    if (typeof daysOverdue !== "number" || !Number.isInteger(daysOverdue) || daysOverdue <= 0) {
      throw new DunningPolicyStepsInvalidError(
        `${where}.daysOverdue must be a positive integer (got ${String(daysOverdue)})`,
      );
    }
    if (index > 0 && daysOverdue <= steps[index - 1]!.daysOverdue) {
      throw new DunningPolicyStepsInvalidError(
        `daysOverdue must ascend strictly — ${where}.daysOverdue ${daysOverdue} follows ${steps[index - 1]!.daysOverdue}`,
      );
    }
    if (typeof channel !== "string" || !STEP_CHANNELS.has(channel)) {
      throw new DunningPolicyStepsInvalidError(
        `${where}.channel must be EMAIL|WHATSAPP|SMS (got ${String(channel)})`,
      );
    }
    if (
      typeof templateKey !== "string" ||
      templateKey.trim().length === 0 ||
      templateKey.length > 120
    ) {
      throw new DunningPolicyStepsInvalidError(
        `${where}.templateKey must be a non-empty key (≤ 120 chars, got ${String(templateKey)})`,
      );
    }
    const referToAgency = entry.referToAgency === true;
    if (referToAgency && index !== raw.length - 1) {
      throw new DunningPolicyStepsInvalidError(
        "referToAgency marks the ladder's TERMINAL step — it may only appear on the last step",
      );
    }
    steps.push({
      stepNo,
      daysOverdue,
      // The STEP_CHANNELS guard above proved the vocabulary membership.
      channel: channel as DunningStep["channel"],
      templateKey,
      escalate: entry.escalate === true,
      referToAgency,
    });
  }
  return steps;
}

/**
 * The step daysOverdue has EARNED (BR-065's read side): the highest step
 * whose daysOverdue threshold the item has passed, null before step 1.
 * The sweep then caps it: target = min(resolveCurrentStep, lastStep + 1).
 */
export function resolveCurrentStep(steps: readonly DunningStep[], daysOverdue: number): number | null {
  let current: number | null = null;
  for (const step of steps) {
    if (daysOverdue >= step.daysOverdue) {
      current = step.stepNo;
    }
  }
  return current;
}

/**
 * BR-065's write side: at most ONE step per run — the next step after the
 * last fired one, clamped at the ladder's top (never skips, never
 * regresses; the re-fire guard is the letters UNIQUE constraint).
 */
export function advanceStep(steps: readonly DunningStep[], lastStep: number): number {
  return Math.min(lastStep + 1, steps.length);
}

/**
 * The late-fee rules' REQUIRES_VERIFICATION arm (L1-12), re-verified at
 * CHARGE time: CONTRACT_RATE needs its positive rate; STATUTORY_CAP needs
 * the positive rate AND its jurisdiction source citation (3..500 chars —
 * the verified evidence the fee may lean on). DISABLED carries nothing.
 */
export function validateLateFeeConfig(
  mode: string,
  ratePct: number | string | null,
  source: string | null,
): void {
  if (mode === "DISABLED") return;
  const rate = ratePct === null ? null : Number(ratePct);
  if (mode === "CONTRACT_RATE") {
    if (rate === null || !(rate > 0) || rate > 100) {
      throw new LateFeeConfigInvalidError(
        `late_fee_mode CONTRACT_RATE requires a positive rate pct ≤ 100 (got ${String(ratePct)})`,
      );
    }
    return;
  }
  if (mode === "STATUTORY_CAP") {
    if (rate === null || !(rate > 0) || rate > 100) {
      throw new LateFeeConfigInvalidError(
        `late_fee_mode STATUTORY_CAP requires a positive rate pct ≤ 100 (got ${String(ratePct)})`,
      );
    }
    if (source === null || source.trim().length < 3 || source.length > 500) {
      throw new LateFeeConfigInvalidError(
        "late_fee_mode STATUTORY_CAP requires its jurisdiction source citation (3..500 chars, REQUIRES_VERIFICATION — a statutory cap without verified source evidence refuses to charge)",
      );
    }
    return;
  }
  throw new LateFeeConfigInvalidError(`late_fee_mode must be DISABLED|CONTRACT_RATE|STATUTORY_CAP (got ${mode})`);
}

/** The deterministic bilingual letter render (register evidence — the
 * snapshot is byte-identical for identical inputs, RC-10 style). */
/** PHASE-041: the amount-due string for the outbox template variables. */
function formatAmountDue(outstanding: string, currencyCode: string): string {
  return `${outstanding} ${currencyCode}`;
}

function renderLetter(input: {
  templateKey: string;
  partnerName: string;
  invoiceNo: string;
  dueDate: string;
  daysOverdue: number;
  outstanding: string;
  currencyCode: string;
}): { subject: string; body: string } {
  const final = /final/i.test(input.templateKey);
  const subjectEn = final
    ? `Final notice — invoice ${input.invoiceNo}`
    : `Payment reminder — invoice ${input.invoiceNo}`;
  const subjectAr = final
    ? `إشعار نهائي — فاتورة ${input.invoiceNo}`
    : `تذكير سداد — فاتورة ${input.invoiceNo}`;
  const bodyEn =
    `Dear ${input.partnerName},\n\n` +
    `Invoice ${input.invoiceNo} was due on ${input.dueDate} and is now ${input.daysOverdue} day(s) overdue. ` +
    `Outstanding amount: ${input.outstanding} ${input.currencyCode}.\n\n` +
    `Please arrange payment at your earliest convenience.` +
    (final ? `\n\nThis is the final notice before the account is referred for collection.` : "") +
    `\n\nThank you.`;
  const bodyAr =
    `عميلنا الكريم ${input.partnerName}،\n\n` +
    `فاتورتكم رقم ${input.invoiceNo} كانت مستحقة في ${input.dueDate} وقد تجاوزت ${input.daysOverdue} يومًا. ` +
    `المبلغ المستحق: ${input.outstanding} ${input.currencyCode}.\n\n` +
    `نرجو ترتيب السداد في أقرب وقت.` +
    (final ? `\n\nهذا إشعار نهائي قبل إحالة الحساب إلى جهة التحصيل.` : "") +
    `\n\nشكرًا لكم.`;
  return {
    subject: `${subjectEn} | ${subjectAr}`,
    body: `${bodyEn}\n\n---\n\n${bodyAr}`,
  };
}

function isUniqueViolation(error: unknown): boolean {
  const probe = error as { code?: string; cause?: { code?: string } };
  return probe?.code === "23505" || probe?.cause?.code === "23505";
}

function addDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

@Injectable()
export class DunningService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PostingService) private readonly posting: PostingService,
    @Inject(InboxService) private readonly inbox: InboxService,
    @Inject(SalesInvoiceService) private readonly invoices: SalesInvoiceService,
    /**
     * PHASE-041 (the 036/039 handoff): the outbound pipeline the letters
     * ride — optional at construction (legacy specs construct the service
     * without it) but REQUIRED for channel delivery: WHATSAPP/SMS letters
     * enqueue and stay QUEUED until the outbox reaches terminal status
     * (the registered source handler below flips them SENT); EMAIL
     * letters enqueue + mark SENT in the same step (the 039
     * register-as-evidence semantics, now backed by a REAL ledger row).
     * @Optional: legacy specs construct the service without the pipeline
     * (the register-only paths still work); the real module graph always
     * provides it (CommunicationModule).
     */
    @Optional()
    @Inject(OutboxService)
    private readonly outbox?: OutboxService | null,
    @Inject(TemplateService) private readonly templates?: TemplateService | null,
  ) {
    if (this.outbox !== undefined && this.outbox !== null) {
      this.outbox.registerSourceHandler("DUNNING_LETTER", async (event) => {
        if (event.status === "SENT" || event.status === "DELIVERED") {
          await store.markLetterSent(event.sourceId!, event.recipient);
        }
        // FAILED: the letter STAYS QUEUED — the error lives on the ledger
        // row (last_error), retries continue per policy; the register
        // never fabricates a send.
      });
    }
  }

  // -- policies ---------------------------------------------------------------------------

  async listPolicies(filter: { status?: string; limit: number }) {
    return store.listPolicies(filter);
  }

  async findPolicy(id: string) {
    const policy = await store.findPolicyById(id);
    if (policy === undefined) throw new DunningPolicyNotFoundError(id);
    return policy;
  }

  /**
   * Create a DRAFT policy. The ladder validates here (typed
   * DunningPolicyStepsInvalidError); the late-fee RATE shape validates here
   * while the STATUTORY_CAP source citation rides the DB CHECK
   * (ck_dunning_policies_late_fee_shape) — the source is evidence, and the
   * charge path re-verifies REQUIRES_VERIFICATION anyway.
   */
  async createPolicy(input: {
    name: string;
    nameAr: string | null;
    partnerTierIds: string[];
    isDefault: boolean;
    steps: Record<string, unknown>[];
    lateFeeMode: string;
    lateFeeRatePct: string | null;
    lateFeeGraceDays: number;
    lateFeeMaxAmount: string | null;
    lateFeeSource: string | null;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
  }) {
    const steps = validateDunningSteps(input.steps);
    if (input.lateFeeMode !== "DISABLED" && input.lateFeeMode !== "CONTRACT_RATE" && input.lateFeeMode !== "STATUTORY_CAP") {
      throw new LateFeeConfigInvalidError(
        `late_fee_mode must be DISABLED|CONTRACT_RATE|STATUTORY_CAP (got ${input.lateFeeMode})`,
      );
    }
    if (input.lateFeeMode !== "DISABLED") {
      const rate = input.lateFeeRatePct === null ? null : Number(input.lateFeeRatePct);
      if (rate === null || !(rate > 0) || rate > 100) {
        throw new LateFeeConfigInvalidError(
          `late_fee_mode ${input.lateFeeMode} requires a positive rate pct ≤ 100 (got ${String(input.lateFeeRatePct)})`,
        );
      }
    }
    if (!Number.isInteger(input.lateFeeGraceDays) || input.lateFeeGraceDays < 0 || input.lateFeeGraceDays > 365) {
      throw new LateFeeConfigInvalidError(
        `late_fee_grace_days must be 0..365 (got ${String(input.lateFeeGraceDays)})`,
      );
    }
    if (input.lateFeeMaxAmount !== null && !(Number(input.lateFeeMaxAmount) > 0)) {
      throw new LateFeeConfigInvalidError("late_fee_max_amount, when set, must be positive");
    }
    if (input.isDefault && input.partnerTierIds.length > 0) {
      throw new DunningPolicyStepsInvalidError(
        "the DEFAULT policy applies tenant-wide — it cannot also scope partner tiers",
      );
    }

    const id = await store.insertPolicy({
      name: input.name,
      nameAr: input.nameAr,
      status: "DRAFT",
      partnerTierIds: input.partnerTierIds,
      // A DRAFT may CLAIM the default flag, but only ACTIVATION enforces
      // the one-ACTIVE-default invariant (demoteOtherDefaults below).
      isDefault: input.isDefault,
      steps: steps as unknown as Record<string, unknown>[],
      lateFeeMode: input.lateFeeMode,
      lateFeeRatePct: input.lateFeeRatePct,
      lateFeeGraceDays: input.lateFeeGraceDays,
      lateFeeMaxAmount: input.lateFeeMaxAmount,
      lateFeeSource: input.lateFeeSource,
      note: input.note,
      noteAr: input.noteAr,
      actorId: input.actorId,
    });
    // The default flag lands only at ACTIVATION (one ACTIVE default per
    // tenant) — a DRAFT never claims it.
    await this.audit.record({
      action: "sales.dunning_policy_created",
      entityType: "dunning_policy",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: { name: input.name, steps: steps.length, lateFeeMode: input.lateFeeMode },
    });
    return this.findPolicy(id);
  }

  /** Edit a DRAFT/ACTIVE policy (the ladder + fee rules re-validate; the
   * default flag demotes every other default when claimed on ACTIVE). */
  async updatePolicy(
    id: string,
    patch: {
      name?: string;
      nameAr?: string | null;
      partnerTierIds?: string[];
      isDefault?: boolean;
      steps?: Record<string, unknown>[];
      lateFeeMode?: string;
      lateFeeRatePct?: string | null;
      lateFeeGraceDays?: number;
      lateFeeMaxAmount?: string | null;
      lateFeeSource?: string | null;
      note?: string | null;
      noteAr?: string | null;
    },
    actorId: string | null,
  ) {
    const policy = await this.findPolicy(id);
    if (policy.status === "ARCHIVED") {
      throw new SalesDocumentStateError(
        `dunning policy ${id} is ARCHIVED — archived policies are read-only (ladder history)`,
      );
    }
    if (patch.steps !== undefined) {
      validateDunningSteps(patch.steps);
    }
    if (patch.isDefault === true && policy.status !== "ACTIVE") {
      throw new SalesDocumentStateError(
        `dunning policy ${id} is ${policy.status} — activate it before claiming the default flag`,
      );
    }
    if (patch.isDefault === true && patch.partnerTierIds !== undefined && patch.partnerTierIds.length > 0) {
      throw new DunningPolicyStepsInvalidError(
        "the DEFAULT policy applies tenant-wide — it cannot also scope partner tiers",
      );
    }
    if (patch.lateFeeMode !== undefined && patch.lateFeeMode !== "DISABLED") {
      const rate = patch.lateFeeRatePct ?? policy.lateFeeRatePct;
      const rateNum = rate === null ? null : Number(rate);
      if (rateNum === null || !(rateNum > 0) || rateNum > 100) {
        throw new LateFeeConfigInvalidError(
          `late_fee_mode ${patch.lateFeeMode} requires a positive rate pct ≤ 100 (got ${String(rate)})`,
        );
      }
    }
    if (
      patch.lateFeeGraceDays !== undefined &&
      (!Number.isInteger(patch.lateFeeGraceDays) || patch.lateFeeGraceDays < 0 || patch.lateFeeGraceDays > 365)
    ) {
      throw new LateFeeConfigInvalidError(
        `late_fee_grace_days must be 0..365 (got ${String(patch.lateFeeGraceDays)})`,
      );
    }
    if (patch.lateFeeMaxAmount !== undefined && patch.lateFeeMaxAmount !== null && !(Number(patch.lateFeeMaxAmount) > 0)) {
      throw new LateFeeConfigInvalidError("late_fee_max_amount, when set, must be positive");
    }
    await store.updatePolicy(id, patch);
    if (patch.isDefault === true) {
      await store.demoteOtherDefaults(id);
    }
    await this.audit.record({
      action: "sales.dunning_policy_updated",
      entityType: "dunning_policy",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { patched: Object.keys(patch) },
    });
    return this.findPolicy(id);
  }

  /** DRAFT/ARCHIVED → ACTIVE; an ACTIVE default demotes every other default. */
  async activatePolicy(id: string, actorId: string | null) {
    const policy = await this.findPolicy(id);
    if (policy.status === "ACTIVE") return this.findPolicy(id);
    if (policy.status !== "DRAFT" && policy.status !== "ARCHIVED") {
      throw new SalesDocumentStateError(
        `dunning policy ${id} is ${policy.status} — only DRAFT/ARCHIVED policies activate`,
      );
    }
    await store.setPolicyStatus(id, "ACTIVE");
    if (policy.isDefault) {
      await store.demoteOtherDefaults(id);
    }
    await this.audit.record({
      action: "sales.dunning_policy_activated",
      entityType: "dunning_policy",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { isDefault: policy.isDefault },
    });
    return this.findPolicy(id);
  }

  async archivePolicy(id: string, actorId: string | null) {
    const policy = await this.findPolicy(id);
    if (policy.status !== "ACTIVE" && policy.status !== "DRAFT") {
      throw new SalesDocumentStateError(
        `dunning policy ${id} is ${policy.status} — only DRAFT/ACTIVE policies archive`,
      );
    }
    await store.setPolicyStatus(id, "ARCHIVED");
    await this.audit.record({
      action: "sales.dunning_policy_archived",
      entityType: "dunning_policy",
      entityId: id,
      actorId: actorId ?? undefined,
    });
    return this.findPolicy(id);
  }

  /** Policy resolution: the partner's tier first (partners.customer_tier_id
   * ∈ policy.partner_tier_ids among ACTIVE), else the ACTIVE default. */
  async resolvePolicyForPartner(partnerId: string): Promise<store.DunningPolicyRow | null> {
    const partner = await store.findPartnerCreditRisk(partnerId);
    const active = await store.listActivePolicies(500);
    if (partner !== undefined && partner.customerTierId !== null) {
      const scoped = active.find(
        (policy) =>
          Array.isArray(policy.partnerTierIds) &&
          policy.partnerTierIds.includes(partner.customerTierId!),
      );
      if (scoped !== undefined) return scoped;
    }
    return active.find((policy) => policy.isDefault) ?? null;
  }

  // -- the sweep (BR-065 monotonic) ---------------------------------------------------------

  /**
   * One dunning pass at an as-of date: per overdue open item → policy →
   * daysOverdue (whole UTC) → target = min(resolveCurrentStep,
   * advanceStep(lastStep)) — ONE step per run, never skip/regress. The
   * letters UNIQUE (tenant, invoice, step) is the re-fire guard (a unique
   * violation skips the item, the register already holds the evidence).
   */
  async runSweep(input: { asOf?: string; limit?: number } = {}) {
    const asOf = input.asOf ?? new Date().toISOString().slice(0, 10);
    const limit = input.limit ?? 200;
    const items = await store.overdueArItems({ asOf, limit });

    const policyByPartner = new Map<string, store.DunningPolicyRow | null>();
    const nameByPartner = new Map<string, string>();
    let lettersFired = 0;
    let escalated = 0;

    for (const item of items) {
      let policy = policyByPartner.get(item.partnerId);
      if (policy === undefined) {
        policy = await this.resolvePolicyForPartner(item.partnerId);
        policyByPartner.set(item.partnerId, policy);
      }
      if (policy === null || policy === undefined) continue;

      const daysOverdue = store.wholeDaysBetween(item.dueDate, asOf);
      if (daysOverdue <= 0) continue;
      const steps = validateDunningSteps(policy.steps as Record<string, unknown>[]);
      const resolved = resolveCurrentStep(steps, daysOverdue);
      if (resolved === null) continue;

      const lastStep = await store.maxLetterStepForInvoice(item.invoiceId);
      const target = Math.min(resolved, advanceStep(steps, lastStep));
      if (target <= lastStep) continue; // at the ladder's top — no re-fire

      const step = steps[target - 1]!;
      let partnerName = nameByPartner.get(item.partnerId);
      if (partnerName === undefined) {
        const partner = await store.findPartnerCreditRisk(item.partnerId);
        partnerName = partner?.name ?? item.partnerId;
        nameByPartner.set(item.partnerId, partnerName);
      }
      const rendered = renderLetter({
        templateKey: step.templateKey,
        partnerName,
        invoiceNo: item.invoiceNo ?? item.invoiceId,
        dueDate: item.dueDate,
        daysOverdue,
        outstanding: item.outstanding,
        currencyCode: item.currencyCode,
      });

      // Per-item SAVEPOINT (the crm deferral-service discipline): under a
      // concurrent-sweep race the losing INSERT trips
      // uq_dunning_letters_invoice_step and would otherwise POISON the
      // ambient transaction (every later statement 25P02) — the savepoint
      // contains the item so the "skip, the register holds the evidence"
      // contract below is actually true.
      const tx = ambientTx();
      await tx?.execute(sql`SAVEPOINT dunning_letter_step`);
      let letterId: string;
      try {
        letterId = await store.insertLetter({
          policyId: policy.id,
          partnerId: item.partnerId,
          invoiceId: item.invoiceId,
          stepNo: target,
          daysOverdue,
          letterDate: asOf,
          channel: step.channel,
          templateKey: step.templateKey,
          emailTo: null,
          subject: rendered.subject,
          bodySnapshot: rendered.body,
        });
        // PHASE-041 (the 036/039 handoff delivered): every channel now
        // rides the outbound pipeline through the channel port (BR-067).
        // - EMAIL: enqueue + mark SENT in the same step — the 039
        //   register-as-evidence semantics, now backed by a REAL ledger
        //   row (source_type DUNNING_LETTER, source_id = the letter).
        // - WHATSAPP/SMS: enqueue + the letter STAYS QUEUED; the outbox's
        //   terminal hook (registered at construction) flips it SENT when
        //   the port delivers. No contact on file FAILS the letter (the
        //   step stays consumed — the register never lies about delivery).
        const sentTo = await this.dispatchLetterThroughOutbox({
          letterId,
          channel: step.channel,
          templateKey: step.templateKey,
          partnerId: item.partnerId,
          partnerName,
          invoiceNo: item.invoiceNo ?? item.invoiceId,
          amountDue: formatAmountDue(item.outstanding, item.currencyCode),
          rendered,
        });
        if (sentTo === null) {
          const missing =
            step.channel === "EMAIL"
              ? "no contact email on file — update the partner's contacts"
              : "no contact phone on file — update the partner's contacts";
          await store.markLetterFailed(letterId, missing);
        } else if (step.channel === "EMAIL") {
          await store.markLetterSent(letterId, sentTo);
        }
        // WHATSAPP/SMS letters stay QUEUED here — the outbox hook decides.
      } catch (error) {
        // ROLLBACK TO also destroys the savepoint — no RELEASE after this.
        await tx?.execute(sql`ROLLBACK TO SAVEPOINT dunning_letter_step`).catch(() => undefined);
        // BR-065 re-fire guard: the step already fired for this invoice.
        if (isUniqueViolation(error)) continue;
        throw error;
      }
      await tx?.execute(sql`RELEASE SAVEPOINT dunning_letter_step`);
      lettersFired += 1;
      // WHATSAPP/SMS stay QUEUED — delivered post-041 through the port.

      if (step.escalate) {
        escalated += 1;
        await this.inbox
          .record({
            category: "collections",
            severity: "warning",
            title: {
              en: `Dunning escalated — invoice ${item.invoiceNo ?? item.invoiceId}`,
              ar: `تصعيد تحصيل — فاتورة ${item.invoiceNo ?? item.invoiceId}`,
            },
            body: {
              en: `Invoice ${item.invoiceNo ?? item.invoiceId} is ${daysOverdue} day(s) overdue and moved to dunning step ${target} of ${policy.name}.`,
              ar: `فاتورة ${item.invoiceNo ?? item.invoiceId} متأخرة ${daysOverdue} يومًا وانتقلت إلى خطوة التحصيل ${target} من سياسة ${policy.name}.`,
            },
            dedupeKey: `dunning-escalation:${item.invoiceId}:${target}`,
          })
          .catch(() => undefined);
      }
    }
    return { asOf, scanned: items.length, lettersFired, escalated };
  }

  /**
   * PHASE-041 — the per-letter outbox dispatch (the 036/039 handoff):
   * resolve the recipient, render the channel template when one exists
   * (WHATSAPP requires the approved-template shape + positional params),
   * and enqueue through the port. Returns the recipient address/phone or
   * null when no contact is on file.
   *
   * Fallback semantics (documented): when the step's templateKey does not
   * resolve for the channel, EMAIL/SMS fall back to the letter's own
   * deterministic bilingual snapshot (the 039 register shape — those
   * channels carry free-form text); WHATSAPP FAILS CLOSED (the adapter
   * only sends approved template messages — a missing template is a
   * configuration error the letter row records, never a silent no-op).
   */
  private async dispatchLetterThroughOutbox(input: {
    letterId: string;
    channel: "EMAIL" | "WHATSAPP" | "SMS";
    templateKey: string;
    partnerId: string;
    partnerName: string;
    invoiceNo: string;
    amountDue: string;
    rendered: { subject: string | null; body: string };
  }): Promise<string | null> {
    if (this.outbox === undefined || this.outbox === null) {
      // Legacy construction (pre-041 specs): keep the 039 behavior —
      // EMAIL resolves its recipient for the register; WHATSAPP/SMS
      // report no delivery (the letter stays QUEUED).
      if (input.channel === "EMAIL") {
        return store.findPartnerContactEmail(input.partnerId);
      }
      return null;
    }
    const recipient =
      input.channel === "EMAIL"
        ? await store.findPartnerContactEmail(input.partnerId)
        : await store.findPartnerContactPhone(input.partnerId);
    if (recipient === null) {
      return null;
    }

    let templateRender: RenderedTemplate | null = null;
    if (this.templates !== undefined && this.templates !== null) {
      templateRender = await this.templates
        .render(input.templateKey, input.channel, "ar", {
          customer_name: input.partnerName,
          invoice_number: input.invoiceNo,
          amount_due: input.amountDue,
        })
        .catch(() => null);
    }

    await this.outbox.enqueue({
      channel: input.channel,
      recipient,
      locale: "ar",
      templateKey: input.templateKey,
      module: "collections",
      subject: templateRender?.subject ?? input.rendered.subject,
      body: templateRender?.body ?? input.rendered.body,
      partnerId: input.partnerId,
      sourceType: "DUNNING_LETTER",
      sourceId: input.letterId,
      whatsappTemplateName:
        input.channel === "WHATSAPP"
          ? (templateRender !== null ? input.templateKey : null)
          : null,
      whatsappTemplateParams: templateRender?.whatsappParams ?? null,
    });
    return recipient;
  }

  // -- letters ------------------------------------------------------------------

  async listLetters(filter: { partnerId?: string; invoiceId?: string; limit: number }) {
    return store.listLetters(filter);
  }

  // -- late fees (L1-12) ----------------------------------------------------------------------

  /**
   * Charge the late fee on an invoice: the fee rides the CURRENT max-step
   * letter, computes outstanding × ratePct/100 (4dp, capped by
   * lateFeeMaxAmount), re-verifies REQUIRES_VERIFICATION for statutory
   * caps, and creates + approves (override arm) + posts the fee invoice
   * through the invoice service itself — ONE ambient UoW, zero residue on
   * any typed rejection.
   */
  async chargeLateFee(input: { invoiceId: string; actorId: string | null; entryDate?: string }) {
    const invoice = await salesStore.findSalesInvoiceById(input.invoiceId);
    if (invoice === undefined) throw new SalesInvoiceNotFoundError(input.invoiceId);
    if (invoice.status !== "POSTED") {
      throw new SalesDocumentStateError(
        `invoice ${input.invoiceId} is ${invoice.status} — late fees ride POSTED invoices only`,
      );
    }

    // The fee register rides the current max-step letter.
    const letters = await store.listLetters({ invoiceId: invoice.id, limit: 100 });
    if (letters.length === 0) {
      throw new SalesDocumentStateError(
        `invoice ${input.invoiceId} carries no dunning letter — run the sweep first (the late-fee register rides the letter that invoked the charge, L1-12)`,
      );
    }
    const letter = letters.reduce((max, row) => (row.stepNo > max.stepNo ? row : max), letters[0]!);
    const policy = await this.findPolicy(letter.policyId);

    if (policy.lateFeeMode === "DISABLED") {
      throw new LateFeeConfigInvalidError(
        `dunning policy ${policy.name} has late fees DISABLED — nothing to charge (L1-12)`,
      );
    }
    // REQUIRES_VERIFICATION, re-verified at charge (the pure arm).
    validateLateFeeConfig(policy.lateFeeMode, policy.lateFeeRatePct, policy.lateFeeSource);

    const alreadyCharged = letters.find((row) => row.feeAmount !== null);
    if (alreadyCharged !== undefined) {
      throw new LateFeeAlreadyChargedError({
        invoiceId: invoice.id,
        letterId: alreadyCharged.id,
        feeAmount: alreadyCharged.feeAmount!,
      });
    }

    const entryDate = input.entryDate ?? new Date().toISOString().slice(0, 10);
    const daysOverdue = store.wholeDaysBetween(invoice.dueDate, entryDate);
    if (daysOverdue <= policy.lateFeeGraceDays) {
      throw new LateFeeConfigInvalidError(
        `invoice ${input.invoiceId} is ${daysOverdue} day(s) overdue — inside the policy's ${policy.lateFeeGraceDays}-day grace window (nothing to charge yet)`,
      );
    }

    const outstanding = await store.invoiceArOutstanding(invoice.id);
    const outstandingNum = Number(outstanding);
    if (!(outstandingNum > 0)) {
      throw new SalesDocumentStateError(
        `invoice ${input.invoiceId} has no outstanding AR — a late fee charges the outstanding balance`,
      );
    }

    let fee = new Decimal(outstanding)
      .times(new Decimal(policy.lateFeeRatePct!))
      .div(new Decimal(100))
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    if (policy.lateFeeMaxAmount !== null) {
      const cap = new Decimal(policy.lateFeeMaxAmount);
      if (fee.gt(cap)) fee = cap;
    }
    const feeAmount = fee.toFixed(4);
    if (!(Number(feeAmount) > 0)) {
      throw new LateFeeConfigInvalidError(
        `the computed late fee rounds to zero (${outstanding} × ${policy.lateFeeRatePct}%/100) — nothing to charge`,
      );
    }

    // The fee invoice: ONE line on the tenant-mapped fee item; VAT flows
    // through the invoice's own tax machinery. Fail-closed on the unmapped
    // item BEFORE any ledger work.
    const lateFeeItemId = await readEffectiveSetting<string | null>("sales.late_fee_item");
    if (lateFeeItemId === null || lateFeeItemId === undefined) {
      throw new LateFeeConfigInvalidError(
        "sales.late_fee_item is unmapped — the fee invoice has no line item to charge on (fail-closed: map the setting and retry; zero partial writes)",
      );
    }
    const itemsStore = await import("../../items/infrastructure/items.store");
    const feeItem = await itemsStore.findItemById(lateFeeItemId);
    if (feeItem === undefined) {
      throw new LateFeeConfigInvalidError(
        `sales.late_fee_item resolves to item ${lateFeeItemId} which does not exist in this tenant`,
      );
    }

    const created = await this.invoices.create({
      branchId: invoice.branchId,
      customerId: invoice.customerId,
      salesRepId: null,
      kind: "CREDIT",
      invoiceDate: entryDate,
      dueDate: null,
      currencyCode: invoice.currencyCode,
      exchangeRate: invoice.exchangeRate,
      orderId: null,
      deliveryId: null,
      warehouseId: null,
      cashAccountId: null,
      note: `Late fee — invoice ${invoice.invoiceNo ?? invoice.id} (L1-12)`,
      noteAr: `غرامة تأخير — فاتورة ${invoice.invoiceNo ?? invoice.id}`,
      // System provenance (the letter invoked the charge) — the approve
      // step's SoD gate can never fire on a system-created document.
      actorId: null,
      lines: [
        {
          itemId: lateFeeItemId,
          accountId: null,
          deliveryLineId: null,
          description: `Late payment fee — invoice ${invoice.invoiceNo ?? invoice.id}`,
          descriptionAr: `غرامة تأخير سداد — فاتورة ${invoice.invoiceNo ?? invoice.id}`,
          qty: "1",
          unitPrice: feeAmount,
          discountAmount: null,
          taxCodeId: feeItem.taxCodeId,
          batchId: null,
          serialIds: null,
          note: null,
        },
      ],
    });
    // The documented override arm: the charging actor holds
    // sales.late-fees.manage at the controller; the invoice service records
    // sales.credit_check_overridden for the BLOCK→WARN conversion.
    await this.invoices.approve(created.id, input.actorId, true);
    const posted = await this.invoices.post(created.id, input.actorId);

    await store.stampLetterFee(letter.id, { feeAmount, feeInvoiceId: posted.invoice.id });
    await this.audit.record({
      action: "sales.late_fee_charged",
      entityType: "dunning_letter",
      entityId: letter.id,
      actorId: input.actorId ?? undefined,
      after: {
        invoiceId: invoice.id,
        feeInvoiceId: posted.invoice.id,
        feeInvoiceNo: posted.invoiceNo,
        feeAmount,
        ratePct: policy.lateFeeRatePct,
        mode: policy.lateFeeMode,
        daysOverdue,
        outstanding,
      },
    });
    return {
      letterId: letter.id,
      stepNo: letter.stepNo,
      feeAmount,
      feeInvoiceId: posted.invoice.id,
      feeInvoiceNo: posted.invoiceNo,
      totalGross: posted.invoice.totalGross,
    };
  }

  /** Waive a charged, unwaived fee — the trio stamp (the waiver path marks,
   * never posts; the fee invoice itself stays as evidence). */
  async waiveFee(input: { letterId: string; reason: string; actorId: string | null }) {
    const letter = await store.findLetterById(input.letterId);
    if (letter === undefined) {
      throw new LateFeeNotWaivableError(`dunning letter ${input.letterId} does not exist in this tenant`);
    }
    if (letter.feeAmount === null) {
      throw new LateFeeNotWaivableError(
        `dunning letter ${input.letterId} carries no charged fee — nothing to waive`,
      );
    }
    if (letter.feeWaivedAt !== null) {
      throw new LateFeeNotWaivableError(
        `the fee on dunning letter ${input.letterId} was already waived on ${letter.feeWaivedAt}`,
      );
    }
    await store.waiveLetterFee(input.letterId, {
      waivedAt: new Date().toISOString(),
      waivedBy: input.actorId,
      reason: input.reason,
    });
    await this.audit.record({
      action: "sales.late_fee_waived",
      entityType: "dunning_letter",
      entityId: input.letterId,
      actorId: input.actorId ?? undefined,
      after: { feeAmount: letter.feeAmount, reason: input.reason, feeInvoiceId: letter.feeInvoiceId },
    });
    return store.findLetterById(input.letterId);
  }

  // -- collection actions -----------------------------------------------------------------------

  /** Insert a logged action (the ladder's working memory, never a posting).
   * PROMISE_TO_PAY requires its promisedDate (the DB CHECK + this typed
   * pre-flight so the client sees a 422, never a driver error). */
  async recordAction(input: {
    partnerId: string;
    invoiceId: string | null;
    policyId: string | null;
    actionType: string;
    actionDate: string;
    outcome: string;
    promisedDate: string | null;
    followUpDate: string | null;
    amount: string | null;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
  }) {
    if (input.actionType === "PROMISE_TO_PAY" && (input.promisedDate === null || input.promisedDate === undefined)) {
      throw new SalesDocumentStateError(
        "a PROMISE_TO_PAY action requires its promisedDate (the promise carries its date)",
      );
    }
    const id = await store.insertAction(input);
    await this.audit.record({
      action: "sales.collection_action_recorded",
      entityType: "collection_action",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: { actionType: input.actionType, outcome: input.outcome, partnerId: input.partnerId },
    });
    return store.findActionById(id);
  }

  async listActions(filter: { partnerId?: string; invoiceId?: string; limit: number }) {
    return store.listActions(filter);
  }

  // -- collection agencies (L1-11) -------------------------------------------------------------------

  async listAgencies(filter: { status?: string; limit: number }) {
    return store.listAgencies(filter);
  }

  async findAgency(id: string) {
    const agency = await store.findAgencyById(id);
    if (agency === undefined) throw new CollectionAgencyNotFoundError(id);
    return agency;
  }

  async createAgency(input: {
    partnerId: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    commissionMode: "PCT_OF_COLLECTED" | "FLAT_FEE";
    commissionPct: string | null;
    flatFee: string | null;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
  }) {
    const partner = await store.findPartnerCreditRisk(input.partnerId);
    if (partner === undefined) {
      throw new SalesDocumentStateError(
        `partner ${input.partnerId} does not exist in this tenant — the agency register is partner-linked`,
      );
    }
    if (input.commissionMode === "PCT_OF_COLLECTED" && !(Number(input.commissionPct) > 0)) {
      throw new SalesDocumentStateError("PCT_OF_COLLECTED agencies require a positive commission pct");
    }
    if (input.commissionMode === "FLAT_FEE" && !(Number(input.flatFee) > 0)) {
      throw new SalesDocumentStateError("FLAT_FEE agencies require a positive flat fee");
    }
    const id = await store.insertAgency(input);
    await this.audit.record({
      action: "sales.collection_agency_created",
      entityType: "collection_agency",
      entityId: id,
      actorId: input.actorId ?? undefined,
      after: { partnerId: input.partnerId, commissionMode: input.commissionMode },
    });
    return this.findAgency(id);
  }

  async setAgencyStatus(id: string, status: "ACTIVE" | "SUSPENDED", actorId: string | null) {
    await this.findAgency(id);
    await store.setAgencyStatus(id, status);
    await this.audit.record({
      action: status === "ACTIVE" ? "sales.collection_agency_activated" : "sales.collection_agency_suspended",
      entityType: "collection_agency",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { status },
    });
    return this.findAgency(id);
  }

  /**
   * Issue the agency's callback token (the 038 portal discipline): a
   * 256-bit random hex value; ONLY sha256(token) + the issued-at stamp
   * persist. The raw token is returned ONCE — never stored, never shown
   * again (re-issuing rotates it).
   */
  async issueAgencyToken(id: string, actorId: string | null): Promise<{ token: string }> {
    await this.findAgency(id);
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    await store.setAgencyToken(id, tokenHash);
    await this.audit.record({
      action: "sales.agency_token_issued",
      entityType: "collection_agency",
      entityId: id,
      actorId: actorId ?? undefined,
      after: { tokenHash },
    });
    return { token };
  }

  // -- referrals (L1-11) ------------------------------------------------------------------------------

  async listReferrals(filter: { agencyId?: string; partnerId?: string; limit: number }) {
    return store.listReferrals(filter);
  }

  async findReferral(id: string) {
    const referral = await store.findReferralById(id);
    if (referral === undefined) throw new ReferralNotFoundError(id);
    return referral;
  }

  /** Refer a partner (or one invoice) to an ACTIVE agency: the referral
   * snapshots the agency's commission terms + logs the AGENCY_REFERRAL
   * action that evidences the handoff. */
  async referToAgency(input: {
    agencyId: string;
    partnerId: string;
    invoiceId: string | null;
    referredAmount: string;
    referralDate: string;
    note: string | null;
    noteAr: string | null;
    actorId: string | null;
  }) {
    const agency = await this.findAgency(input.agencyId);
    if (agency.status !== "ACTIVE") {
      throw new SalesDocumentStateError(
        `collection agency ${input.agencyId} is ${agency.status} — only ACTIVE agencies receive referrals`,
      );
    }
    if (!(Number(input.referredAmount) > 0)) {
      throw new SalesDocumentStateError("the referred amount must be positive");
    }
    let currencyCode = await ownTenantBaseCurrency();
    if (input.invoiceId !== null) {
      const invoice = await salesStore.findSalesInvoiceById(input.invoiceId);
      if (invoice === undefined) throw new SalesInvoiceNotFoundError(input.invoiceId);
      currencyCode = invoice.currencyCode;
    }
    const actionId = await store.insertAction({
      partnerId: input.partnerId,
      invoiceId: input.invoiceId,
      policyId: null,
      actionType: "AGENCY_REFERRAL",
      actionDate: input.referralDate,
      outcome: "ESCALATED",
      promisedDate: null,
      followUpDate: null,
      amount: input.referredAmount,
      note: input.note,
      noteAr: input.noteAr,
      actorId: input.actorId,
    });
    const referralId = await store.insertReferral({
      agencyId: agency.id,
      partnerId: input.partnerId,
      invoiceId: input.invoiceId,
      actionId,
      currencyCode,
      referralDate: input.referralDate,
      referredAmount: input.referredAmount,
      commissionMode: agency.commissionMode,
      commissionPct: agency.commissionPct,
      flatFee: agency.flatFee,
      note: input.note,
      noteAr: input.noteAr,
      actorId: input.actorId,
    });
    await this.audit.record({
      action: "sales.collection_referral_created",
      entityType: "collection_referral",
      entityId: referralId,
      actorId: input.actorId ?? undefined,
      after: {
        agencyId: agency.id,
        partnerId: input.partnerId,
        invoiceId: input.invoiceId,
        referredAmount: input.referredAmount,
        currencyCode,
      },
    });
    return this.findReferral(referralId);
  }

  /** Settlement report: the CUMULATIVE amount the agency collected so far
   * (a re-report of the same total is idempotent) — PARTIAL below the
   * referred amount, SETTLED at it. */
  async settleReferral(input: { referralId: string; settledAmount: string; actorId: string | null }) {
    const referral = await this.findReferral(input.referralId);
    if (!["REFERRED", "ACKNOWLEDGED", "PARTIAL"].includes(referral.status)) {
      throw new ReferralStateInvalidError({ current: referral.status, attempted: "settle" });
    }
    const settled = Number(input.settledAmount);
    if (!(settled > 0)) {
      throw new SalesDocumentStateError("the settled amount must be positive");
    }
    if (settled > Number(referral.referredAmount)) {
      throw new SalesDocumentStateError(
        `settled ${input.settledAmount} exceeds the referred ${referral.referredAmount} on referral ${input.referralId}`,
      );
    }
    const status = settled >= Number(referral.referredAmount) ? "SETTLED" : "PARTIAL";
    await store.setReferralStatus(input.referralId, {
      status,
      settledAmount: new Decimal(input.settledAmount).toFixed(4),
      settledAt: new Date().toISOString(),
    });
    await this.audit.record({
      action: "sales.collection_referral_settled",
      entityType: "collection_referral",
      entityId: input.referralId,
      actorId: input.actorId ?? undefined,
      after: { status, settledAmount: input.settledAmount, referredAmount: referral.referredAmount },
    });
    return this.findReferral(input.referralId);
  }

  /**
   * G-39 at settlement: commission = PCT_OF_COLLECTED ? settled × pct/100
   * (4dp) : the flat fee — DR the mapped commission expense · CR AP_CONTROL
   * on the agency's partner. Exactly-once (INV-013 source key); the
   * unmapped account rejects BEFORE any ledger work (zero partial).
   */
  async postCommission(input: { referralId: string; actorId: string | null; entryDate?: string }) {
    const referral = await this.findReferral(input.referralId);
    if (referral.status !== "SETTLED" && referral.status !== "PARTIAL") {
      throw new ReferralStateInvalidError({ current: referral.status, attempted: "post-commission" });
    }
    const commissionAccount = await readEffectiveSetting<string | null>("sales.collection_commission_account");
    if (commissionAccount === null || commissionAccount === undefined) {
      throw new CommissionAccountUnmappedError();
    }
    const agency = await this.findAgency(referral.agencyId);

    let commission = new Decimal(0);
    if (referral.commissionMode === "PCT_OF_COLLECTED") {
      commission = new Decimal(referral.settledAmount)
        .times(new Decimal(referral.commissionPct!))
        .div(new Decimal(100))
        .toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    } else {
      commission = new Decimal(referral.flatFee!).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
    }
    const commissionAmount = commission.toFixed(4);
    if (!(Number(commissionAmount) > 0)) {
      throw new SalesDocumentStateError(
        `the computed commission rounds to zero (${referral.settledAmount} × ${String(referral.commissionPct)}%/100) — nothing to post`,
      );
    }

    const entryDate = input.entryDate ?? new Date().toISOString().slice(0, 10);
    const base = await ownTenantBaseCurrency();
    let exchangeRate: string | undefined;
    if (referral.currencyCode !== base && referral.invoiceId !== null) {
      const invoice = await salesStore.findSalesInvoiceById(referral.invoiceId);
      exchangeRate = invoice?.exchangeRate ?? undefined;
    }
    const spec: JournalSpec = {
      source: { docType: "collection_referral", docId: referral.id, operation: "commission" },
      entryDate,
      description: {
        en: `Collection agency commission (G-39) — referral ${referral.id}`,
        ar: `عمولة وكالة تحصيل (G-39) — إحالة ${referral.id}`,
      },
      currency: referral.currencyCode,
      exchangeRate,
      lines: [
        {
          accountId: commissionAccount,
          direction: "DEBIT",
          amount: commissionAmount,
          memo: {
            en: `Collection commission expense — referral ${referral.id}`,
            ar: `مصروف عمولة تحصيل — إحالة ${referral.id}`,
          },
        },
        {
          purpose: "AP_CONTROL",
          direction: "CREDIT",
          amount: commissionAmount,
          partnerId: agency.partnerId,
          memo: {
            en: `Agency payable — ${agency.id} (G-39)`,
            ar: `التزام لوكالة التحصيل — ${agency.id} (G-39)`,
          },
        },
      ],
    };
    const result = await this.posting.post(spec, { postedBy: input.actorId });

    await store.setReferralStatus(referral.id, {
      status: "COMMISSION_POSTED",
      commissionAmount,
      commissionJournalId: result.journalEntryId,
      commissionEntryNo: result.entryNo,
    });
    await this.audit.record({
      action: "sales.collection_commission_posted",
      entityType: "collection_referral",
      entityId: referral.id,
      actorId: input.actorId ?? undefined,
      after: {
        commissionAmount,
        journalEntryId: result.journalEntryId,
        entryNo: result.entryNo,
        settledAmount: referral.settledAmount,
      },
    });
    return this.findReferral(referral.id);
  }

  /** COMMISSION_POSTED → CLOSED (the terminal bookkeeping state). */
  async closeReferral(input: { referralId: string; actorId: string | null }) {
    const referral = await this.findReferral(input.referralId);
    if (referral.status !== "COMMISSION_POSTED") {
      throw new ReferralStateInvalidError({ current: referral.status, attempted: "close" });
    }
    await store.setReferralStatus(input.referralId, { status: "CLOSED", closedAt: new Date().toISOString() });
    await this.audit.record({
      action: "sales.collection_referral_closed",
      entityType: "collection_referral",
      entityId: input.referralId,
      actorId: input.actorId ?? undefined,
    });
    return this.findReferral(input.referralId);
  }

  /**
   * The agency callback port (the controller resolved the tenant pre-GUC
   * through erp.portal_resolve_agency_token; this re-validates the SAME
   * token under RLS inside the tenant scope — the portal.controller
   * discipline). The agency identity comes ONLY from the token hash; a
   * referral outside the agency's own book is the SAME typed rejection as
   * an unknown token (no oracle).
   */
  async agencyCallback(input: {
    token: string;
    referralId: string;
    status: "ACKNOWLEDGED" | "PARTIAL" | "SETTLED";
    settledAmount: string | null;
  }) {
    const tokenHash = createHash("sha256").update(input.token).digest("hex");
    const agency = await store.findAgencyByTokenHash(tokenHash);
    if (agency === undefined) {
      throw new AgencyTokenInvalidError();
    }
    const referral = await store.findReferralById(input.referralId);
    if (referral === undefined || referral.agencyId !== agency.id) {
      throw new AgencyTokenInvalidError();
    }

    if (input.status === "ACKNOWLEDGED") {
      if (referral.status !== "REFERRED") {
        throw new ReferralStateInvalidError({ current: referral.status, attempted: "acknowledge" });
      }
      await store.setReferralStatus(referral.id, { status: "ACKNOWLEDGED" });
    } else {
      if (!["REFERRED", "ACKNOWLEDGED", "PARTIAL"].includes(referral.status)) {
        throw new ReferralStateInvalidError({ current: referral.status, attempted: input.status.toLowerCase() });
      }
      if (input.settledAmount === null || !(Number(input.settledAmount) > 0)) {
        throw new SalesDocumentStateError(
          `a ${input.status} callback requires its settledAmount (the cumulative collected total)`,
        );
      }
      if (Number(input.settledAmount) > Number(referral.referredAmount)) {
        throw new SalesDocumentStateError(
          `settled ${input.settledAmount} exceeds the referred ${referral.referredAmount}`,
        );
      }
      await store.setReferralStatus(referral.id, {
        status: input.status,
        settledAmount: new Decimal(input.settledAmount).toFixed(4),
        settledAt: new Date().toISOString(),
      });
    }
    await this.audit.record({
      action: "sales.agency_callback_recorded",
      entityType: "collection_referral",
      entityId: referral.id,
      after: { status: input.status, settledAmount: input.settledAmount, agencyId: agency.id },
    });
    return this.findReferral(referral.id);
  }

  // -- credit reviews (L1-10) ---------------------------------------------------------------------------

  async listDueReviews(input: { asOf: string; limit?: number }) {
    return store.partnersDueForReview({ asOf: input.asOf, limit: input.limit ?? 500 });
  }

  /** The credit-risk register (GET credit-reviews without ?due=1). */
  async listCreditRiskRegister() {
    return store.partnersWithCreditProfile(500);
  }

  /**
   * Record one review outcome: the class (A–D, validated), the next review
   * date (explicit, or the partner's frequency clock), and the note —
   * stamped on the partner + audited (the audit event IS the outcome
   * history, the 0057 decision). A review landing on the tenant's blocked
   * class raises the collections notification.
   */
  async recordReview(input: {
    partnerId: string;
    scoreClass: string | null | undefined;
    nextReviewAt: string | null | undefined;
    note: string | null;
    actorId: string | null;
  }) {
    const partner = await store.findPartnerCreditRisk(input.partnerId);
    if (partner === undefined) {
      throw new CreditReviewInvalidError(`partner ${input.partnerId} does not exist in this tenant`);
    }
    if (input.scoreClass !== undefined && input.scoreClass !== null && !["A", "B", "C", "D"].includes(input.scoreClass)) {
      throw new CreditReviewInvalidError(
        `scoreClass must be A|B|C|D (got ${String(input.scoreClass)}) — never an external scoring claim`,
      );
    }
    const reviewDate = new Date().toISOString().slice(0, 10);
    let nextReviewAt = input.nextReviewAt ?? null;
    if (nextReviewAt === null && partner.creditReviewFrequencyDays !== null) {
      // The clock ticks from the review: today + frequency (≥ 7 by the
      // 0057 CHECK — a partner WITH a frequency always carries a next date.
      nextReviewAt = addDays(reviewDate, partner.creditReviewFrequencyDays);
    }
    if (nextReviewAt !== null && partner.creditReviewFrequencyDays === null) {
      throw new CreditReviewInvalidError(
        `partner ${input.partnerId} carries no review frequency — a nextCreditReviewAt cannot be scheduled without one (credit_review_frequency_days, 0057 shape)`,
      );
    }

    const newClass = input.scoreClass === undefined ? partner.creditScoreClass : input.scoreClass;
    await store.setPartnerCreditRisk(input.partnerId, {
      ...(input.scoreClass === undefined ? {} : { creditScoreClass: input.scoreClass }),
      nextCreditReviewAt: nextReviewAt,
      lastCreditReviewAt: reviewDate,
      lastCreditReviewBy: input.actorId,
      creditReviewNote: input.note,
    });
    await this.audit.record({
      action: "sales.credit_review_recorded",
      entityType: "partner",
      entityId: input.partnerId,
      actorId: input.actorId ?? undefined,
      after: { scoreClass: newClass, nextReviewAt, note: input.note },
    });

    if (newClass !== null) {
      const blockedClass =
        (await salesStore.readSetting<string>("sales.credit_block_class")) ?? "D";
      if (newClass === blockedClass) {
        await this.inbox
          .record({
            category: "collections",
            severity: "warning",
            title: {
              en: `Credit class blocked — ${partner.code} ${partner.name}`,
              ar: `فئة ائتمانية محظورة — ${partner.code} ${partner.name}`,
            },
            body: {
              en: `Partner ${partner.name} was reviewed to class ${newClass} — the tenant's blocked class (${blockedClass}); new credit documents will hit the BR-001 block posture.`,
              ar: `تمت مراجعة ${partner.name} إلى الفئة ${newClass} — الفئة المحظورة للمستأجر (${blockedClass})؛ ستخضع مستندات الائتمان الجديدة لوضع الحظر BR-001.`,
            },
            dedupeKey: `credit-class-blocked:${input.partnerId}:${newClass}`,
          })
          .catch(() => undefined);
      }
    }
    return store.findPartnerCreditRisk(input.partnerId);
  }

  /** The review-due sweep: notify (never mutate) — the dedupe key makes
   * each (partner, as-of date) fire once, so the nightly re-run converges. */
  async runCreditReviewSweep(input: { asOf?: string; limit?: number } = {}) {
    const asOf = input.asOf ?? new Date().toISOString().slice(0, 10);
    const due = await store.partnersDueForReview({ asOf, limit: input.limit ?? 200 });
    let notified = 0;
    for (const partner of due) {
      const outcome = await this.inbox
        .record({
          category: "collections",
          severity: "info",
          title: {
            en: `Credit review due — ${partner.code} ${partner.name}`,
            ar: `مراجعة ائتمانية مستحقة — ${partner.code} ${partner.name}`,
          },
          body: {
            en: `Partner ${partner.name} (class ${partner.creditScoreClass ?? "—"}) is due for its periodic credit review (scheduled ${partner.nextCreditReviewAt}).`,
            ar: `الشريك ${partner.name} (الفئة ${partner.creditScoreClass ?? "—"}) مستحق لمراجعته الائتمانية الدورية (الموعد ${partner.nextCreditReviewAt}).`,
          },
          dedupeKey: `credit-review-due:${partner.partnerId}:${asOf}`,
        })
        .catch(() => ({ inserted: false }));
      if (outcome.inserted) notified += 1;
    }
    return { asOf, due: due.length, notified };
  }
}
