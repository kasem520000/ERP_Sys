import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { AuditService } from "../../../audit/api/audit";
import { EMAIL_SERVICE, type EmailService } from "../../../notifications/notifications.module";
import { InboxService } from "../../../notifications/application/inbox-service";
import { publishTenancyEvent } from "../../../configuration/api";
import { requireTenantContext, withTenant } from "../../../../infra/db/tenant-context";
import { childLogger } from "../../../../infra/observability/logger";
import { env } from "../../../../config/env";
import {
  CheckoutSessionNotFoundError,
  CheckoutSessionSettledError,
  DowngradeBlockedError,
  InvalidSubscriptionTransitionError,
  ManualPaymentNotAllowedError,
  ManualPaymentReasonRequiredError,
  PlanUnchangedError,
  WebhookReplayError,
  WebhookSignatureInvalidError,
  SubscriptionInvoiceNotFoundError,
} from "../../domain/subscription-errors";
import { PlanNotFoundError } from "../../domain/tenancy-errors";
import {
  SandboxProviderAdapter,
  verifyWebhookSignatureWithRotation,
  type ProviderAdapterPort,
  type WebhookEventPayload,
} from "./provider-adapter";
import * as store from "../../infrastructure/billing.store";
import * as tenancyStore from "../../infrastructure/tenancy.store";
import { GRACE_DAYS, MAX_DUNNING_STEPS, INVOICE_DUE_DAYS, plusDays, limitOf } from "./billing-config";
import { LifecycleService } from "../lifecycle-service";

const log = childLogger({ module: "billing-subscriptions" });

/**
 * PHASE-014 subscription + billing service (PHASE-014 §2.1–§2.4, §5 T1–T4;
 * SUBSCRIPTION §7–§10; A-009): the lifecycle state machine, the sandbox
 * checkout flow, the webhook ingest pipeline (signature + replay + typed
 * settlement), the manual-invoicing fallback, and the daily pass.
 *
 * Both payment paths converge on `settleFromInvoice` — identical
 * entitlement materialization, identical billing history; only `paid_via`
 * differs (provider_webhook vs manual_recorded). The phase's hard rule:
 * sandbox + manual ship together or the phase does not complete.
 *
 * Read-only grace is a first-class product state: postings fail with the
 * typed `tenancy/subscription-read-only` error (the interceptor enforces);
 * reports, exports, printing, dashboards continue. Suspension goes through
 * the PHASE-004 LifecycleService semantics (sessions die, admin console
 * stays reachable) — never a parallel implementation.
 */

export interface ChangePlanOutcome {
  action: "checkout_created" | "downgrade_scheduled";
  planKey: string;
  checkoutUrl?: string;
  invoiceNumber?: string;
  message: { ar: string; en: string };
}

@Injectable()
export class SubscriptionService {
  readonly provider: ProviderAdapterPort;

  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(InboxService) private readonly inbox: InboxService,
    @Inject(EMAIL_SERVICE) private readonly email: EmailService,
    @Inject(LifecycleService) private readonly lifecycle: LifecycleService,
  ) {
    this.provider = new SandboxProviderAdapter({ webBaseUrl: env.WEB_BASE_URL });
  }

  // -------------------------------------------------------------------------
  // Trial start (registration hook; runs inside the registration UoW)

  async startTrial(input: {
    planKey: "business";
    trialDays: number;
  }): Promise<{ subscriptionId: string; trialEndsAt: string }> {
    const plan = await store.findBillingPlanByKey(input.planKey);
    if (plan === undefined) {
      throw new PlanNotFoundError(input.planKey);
    }
    const trialEndsAt = plusDays(new Date(), input.trialDays);
    const periodStart = new Date().toISOString().slice(0, 10);
    const subscription = await store.insertSubscriptionRow({
      planId: plan.id,
      status: "TRIAL",
      periodStart,
      periodEnd: trialEndsAt.toISOString().slice(0, 10),
      trialEndsAt: trialEndsAt.toISOString(),
    });
    await store.recordBillingEvent({
      type: "trial.started",
      payload: {
        plan: plan.key,
        trialDays: input.trialDays,
        trialEndsAt: trialEndsAt.toISOString(),
      },
    });
    // §7.2: trial entitlements are materialized EXACTLY like paid ones —
    // source TRIAL with expiry, no parallel code path, no trial-mode flags.
    for (const featureKey of plan.featureKeys) {
      await tenancyStore.insertEntitlement({
        featureKey,
        source: "TRIAL",
        expiresAt: trialEndsAt.toISOString(),
      });
    }
    return { subscriptionId: subscription.id, trialEndsAt: trialEndsAt.toISOString() };
  }

  // -------------------------------------------------------------------------
  // Change plan (tenant plane; owner)

  async changePlan(input: { planKey: string; periodMonths?: number }): Promise<ChangePlanOutcome> {
    const current = await store.currentSubscriptionRow();
    if (current === undefined) {
      throw new InvalidSubscriptionTransitionError("NONE", "change_plan");
    }
    if (current.status === "SUSPENDED") {
      throw new InvalidSubscriptionTransitionError(current.status, "change_plan");
    }
    const target = await store.findBillingPlanByKey(input.planKey);
    if (target === undefined || !target.isActive) {
      throw new PlanNotFoundError(input.planKey);
    }
    const currentPlan = await store.findBillingPlanById(current.planId);
    const currentKey = currentPlan?.key ?? "unknown";
    if (target.id === current.planId && current.pendingPlanId === null) {
      throw new PlanUnchangedError(target.key);
    }
    if (target.sortOrder > (currentPlan?.sortOrder ?? 0) || current.status === "TRIAL") {
      // Upgrade (or first paid step out of trial): immediate checkout —
      // proration policy is PLACEHOLDER ⚠ OQ-002; upgrades apply on payment.
      const session = await this.createCheckoutSession(target, current, input.periodMonths ?? 1);
      await store.recordBillingEvent({
        type: "plan.change.requested",
        payload: { from: currentKey, to: target.key, direction: "upgrade", session: session.ref },
      });
      return {
        action: "checkout_created",
        planKey: target.key,
        checkoutUrl: session.url,
        invoiceNumber: session.invoiceNumber,
        message: {
          ar: `تم إنشاء جلسة دفع لخطة ${target.nameAr} — أكمل الدفع لتفعيل الترقية.`,
          en: `A checkout session for plan ${target.name} was created — complete payment to activate the upgrade.`,
        },
      };
    }
    // Downgrade: the §8 gate — current usage vs the TARGET plan limits; the
    // tenant is told exactly what blocks it. Scheduled for period end.
    const blockers = await this.downgradeBlockers(target);
    if (blockers.length > 0) {
      await store.recordBillingEvent({
        type: "downgrade.blocked",
        payload: { from: currentKey, to: target.key, blockers },
      });
      throw new DowngradeBlockedError(blockers);
    }
    await store.setPendingDowngrade(current.id, target.id);
    await store.recordBillingEvent({
      type: "plan.change.requested",
      payload: { from: currentKey, to: target.key, direction: "downgrade", at: "period_end" },
    });
    return {
      action: "downgrade_scheduled",
      planKey: target.key,
      message: {
        ar: `سيتم تطبيق خطة ${target.nameAr} في نهاية الدورة الحالية (${current.periodEnd}).`,
        en: `Plan ${target.name} will apply at the end of the current period (${current.periodEnd}).`,
      },
    };
  }

  /** The §8 downgrade gate: current usage vs the target plan's limits. */
  async downgradeBlockers(
    target: store.BillingPlanRow,
  ): Promise<ReadonlyArray<{ limit: string; usage: number; limitValue: number }>> {
    const context = requireTenantContext();
    const snapshot = await store.billingSnapshot(context.tenantId);
    const checks: ReadonlyArray<{ key: "users" | "branches" | "warehouses"; usage: number }> = [
      { key: "users", usage: snapshot.usage.users },
      { key: "branches", usage: snapshot.usage.branches },
      { key: "warehouses", usage: snapshot.usage.warehouses },
    ];
    const blockers: { limit: string; usage: number; limitValue: number }[] = [];
    for (const check of checks) {
      const limitValue = limitOf(target.limits, check.key);
      if (limitValue !== "unlimited" && check.usage > limitValue) {
        blockers.push({ limit: check.key, usage: check.usage, limitValue });
      }
    }
    return blockers;
  }

  // -------------------------------------------------------------------------
  // Checkout (sandbox provider)

  async createCheckoutSession(
    plan: store.BillingPlanRow,
    current: store.SubscriptionRow,
    periodMonths: number,
  ): Promise<{ ref: string; url: string; invoiceNumber: string; expiresAt: string }> {
    const context = requireTenantContext();
    const periodStart = new Date().toISOString().slice(0, 10);
    const periodEnd = plusDays(new Date(), periodMonths * 30).toISOString().slice(0, 10);
    const session = await this.provider.createCheckoutSession({
      tenantId: context.tenantId,
      planKey: plan.key,
      invoiceNumber: "PENDING",
      amount: plan.priceAmount,
      currencyCode: plan.currencyCode,
      periodStart,
      periodEnd,
    });
    const number = await store.nextInvoiceNumber();
    const dueDate = plusDays(new Date(), INVOICE_DUE_DAYS).toISOString().slice(0, 10);
    const invoice = await store.insertSubscriptionInvoice({
      subscriptionId: current.id,
      number,
      planKey: plan.key,
      periodStart,
      periodEnd,
      amount: plan.priceAmount,
      currencyCode: plan.currencyCode,
      source: "checkout",
      providerRef: session.ref,
      dueDate,
      placeholderPrice: true,
    });
    await store.updateSubscriptionRow(current.id, {
      provider: this.provider.id,
      providerCheckoutRef: session.ref,
    });
    await store.recordBillingEvent({
      type: "checkout.created",
      payload: { session: session.ref, invoice: number, plan: plan.key, amount: plan.priceAmount },
    });
    return {
      ref: session.ref,
      url: session.url,
      invoiceNumber: invoice.number,
      expiresAt: session.expiresAt,
    };
  }

  /** The tenant-plane sandbox completion: settle → signed webhook → ingest. */
  async completeCheckout(input: {
    sessionRef: string;
    outcome?: "succeeded" | "failed";
  }): Promise<{ processed: string; subscriptionStatus?: string; invoiceStatus?: string }> {
    const invoice = await store.findInvoiceByProviderRef(input.sessionRef);
    if (invoice === undefined) {
      throw new CheckoutSessionNotFoundError(input.sessionRef);
    }
    if (invoice.status !== "OPEN") {
      throw new CheckoutSessionSettledError(input.sessionRef, invoice.status);
    }
    const context = requireTenantContext();
    const settled = this.provider.settleCheckout({
      sessionRef: input.sessionRef,
      outcome: input.outcome ?? "succeeded",
      tenantId: context.tenantId,
      invoiceNumber: invoice.number,
      amount: invoice.amount,
      currency: invoice.currencyCode,
    });
    return this.ingestWebhook(settled.rawBody, settled.signature);
  }

  // -------------------------------------------------------------------------
  // Webhook ingest (the single pipeline: external route + sandbox completion)

  async ingestWebhook(rawBody: string, signature: string): Promise<{
    processed: "payment.succeeded" | "payment.failed" | "duplicate" | "no-op";
    subscriptionStatus?: string;
    invoiceStatus?: string;
  }> {
    // Unix-seconds arithmetic (not money — ADR-0009 targets money math).
    const now = (Date.now() / 1000) | 0;
    // PHASE-024 T6 (S-11 dual-secret window): current secret first, then
    // the previous one while WEBHOOK_SIGNING_SECRET_PREVIOUS is set —
    // provider-coordinated zero-downtime rotation (SECRETS_MANAGEMENT §3).
    const verdict = verifyWebhookSignatureWithRotation(rawBody, signature, now);
    if (!verdict.ok) {
      if (verdict.reason === "stale") {
        throw new WebhookReplayError(0, 300);
      }
      throw new WebhookSignatureInvalidError(verdict.reason);
    }
    let event: WebhookEventPayload;
    try {
      event = JSON.parse(rawBody) as WebhookEventPayload;
    } catch {
      throw new WebhookSignatureInvalidError("unparsable body");
    }
    if (
      typeof event.id !== "string" ||
      (event.type !== "payment.succeeded" && event.type !== "payment.failed") ||
      typeof event.data?.session_ref !== "string" ||
      typeof event.data?.tenant_id !== "string"
    ) {
      throw new WebhookSignatureInvalidError("event shape");
    }
    // Resolve the target tenant from the signed session_ref (the anonymous
    // external route has no session; the signature is the authority).
    const probe = await store.findInvoiceByProviderRefPlatform(event.data.session_ref);
    if (probe === undefined) {
      throw new CheckoutSessionNotFoundError(event.data.session_ref);
    }
    return withTenant(probe.tenantId, async () => {
      // Idempotency gate: the billing event row is the replay guard — a
      // duplicate delivery is an idempotent no-op (INV-013 discipline).
      const gate = await store.recordBillingEvent({
        type: event.type,
        payload: { ...event.data, eventId: event.id, provider: "sandbox" },
        idempotencyKey: `webhook:${event.id}`,
      });
      if (!gate.inserted) {
        return { processed: "duplicate" as const };
      }
      const invoice = await store.findInvoiceByProviderRef(event.data.session_ref);
      if (invoice === undefined) {
        throw new CheckoutSessionNotFoundError(event.data.session_ref);
      }
      if (invoice.status !== "OPEN") {
        throw new CheckoutSessionSettledError(event.data.session_ref, invoice.status);
      }
      if (event.type === "payment.succeeded") {
        const outcome = await this.settleFromInvoice(invoice, "provider_webhook", event.id, null, null);
        return {
          processed: "payment.succeeded" as const,
          subscriptionStatus: outcome.status,
          invoiceStatus: "PAID",
        };
      }
      const status = await this.handlePaymentFailed(invoice);
      return {
        processed: "payment.failed" as const,
        subscriptionStatus: status,
        invoiceStatus: invoice.status,
      };
    });
  }

  // -------------------------------------------------------------------------
  // Actor resolution (the daily pass + webhook path have no session; the
  // tenant's owner is the recorded actor — a real users row, never a
  // synthetic id that would violate the audit FK).
  private async ownerActorId(): Promise<string> {
    // Runs inside the ambient tenant scope (GUC set on the tx): the
    // roles RLS policy resolves, memberships/roles join the owner row.
    const rows = await txOfScope().execute(sql`
      SELECT u.id AS "userId"
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      JOIN roles r ON r.id = m.role_id AND r.tenant_id = m.tenant_id
      WHERE r.key = 'owner' AND m.status = 'ACTIVE'
      ORDER BY m.created_at LIMIT 1
    `);
    const row = (rows.rows as unknown as { userId: string }[])[0];
    return row?.userId ?? "00000000-0000-0000-0000-000000000000";
  }

  // -------------------------------------------------------------------------
  // Settlement core (both paths converge here — A-009 parity)

  async settleFromInvoice(
    invoice: store.SubscriptionInvoiceRow,
    paidVia: "provider_webhook" | "manual_recorded",
    paidReference: string,
    recordedBy: string | null,
    reason: string | null,
  ): Promise<{ subscriptionId: string; status: string }> {
    const paid = await store.markInvoicePaid({
      id: invoice.id,
      paidVia,
      paidReference,
      recordedBy,
      reason,
    });
    if (paid === undefined) {
      throw new ManualPaymentNotAllowedError(invoice.number, invoice.status);
    }
    const plan = await store.findBillingPlanByKey(invoice.planKey);
    if (plan === undefined) {
      throw new PlanNotFoundError(invoice.planKey);
    }
    // Supersede prior rows, insert the ACTIVE row with the invoice window.
    await tenancyStore.supersedeSubscriptions();
    const subscription = await store.insertSubscriptionRow({
      planId: plan.id,
      status: "ACTIVE",
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      provider: this.provider.id,
      providerCheckoutRef: invoice.providerRef,
      providerSubscriptionRef: `sub_sbx_${invoice.providerRef ?? invoice.number}`,
    });
    // Entitlements re-materialize transactionally with the subscription
    // record (§10.2 — never mid-state): plan-source upserts + stale-key
    // cleanup — the same building blocks EntitlementsService.assignPlan
    // uses (§4 resolution pipeline).
    await tenancyStore.deleteExpiredEntitlements();
    for (const featureKey of plan.featureKeys) {
      await tenancyStore.upsertPlanEntitlement({ featureKey, expiresAt: null });
    }
    await tenancyStore.deleteStalePlanEntitlements(plan.featureKeys);
    await store.recordBillingEvent({
      type: "plan.changed",
      payload: { plan: plan.key, via: paidVia, invoice: invoice.number, instant: "upgrade" },
    });
    publishTenancyEvent({ type: "plan.changed", tenantId: subscription.tenantId, planKey: plan.key });
    for (const key of plan.featureKeys) {
      publishTenancyEvent({
        type: "entitlements.changed",
        tenantId: subscription.tenantId,
        featureKey: key,
        change: "granted",
      });
    }
    const tenant = await tenancyStore.getOwnTenant();
    await this.audit.record({
      action: "subscription.activated",
      entityType: "subscription",
      entityId: subscription.id,
      after: { plan: plan.key, invoice: invoice.number, paidVia, paidReference },
    });
    await this.inbox.notifyOwner(this.email, {
      category: "subscription",
      severity: "info",
      title: { ar: "تم تفعيل الاشتراك", en: "Subscription activated" },
      body: {
        ar: `تم سداد الفاتورة ${invoice.number} وتفعيل خطة ${plan.nameAr} حتى ${invoice.periodEnd}.`,
        en: `Invoice ${invoice.number} was paid; plan ${plan.name} is active through ${invoice.periodEnd}.`,
      },
      actionLabel: { ar: "عرض الفاتورة", en: "View invoice" },
      actionUrl: "/billing",
      dedupeKey: `activated:${subscription.id}`,
      emailTemplate: "subscription_state",
      emailVariables: {
        tenantName: tenant.name,
        state: "ACTIVE",
        detail: `Invoice ${invoice.number} paid; plan ${plan.name} active through ${invoice.periodEnd}.`,
        action: "Thank you — no action needed.",
      },
    });
    log.info({ invoice: invoice.number, paid_via: paidVia }, "subscription activated");
    // §8 "Suspension lift | Payment received": if the TENANT was suspended
    // (billing), the settlement restores it through the PHASE-004 lifecycle
    // semantics (sessions re-establish by re-login — never zombie revival).
    if (tenant.status === "SUSPENDED") {
      await this.lifecycle.restore(
        recordedBy ?? (await this.ownerActorId()),
        subscription.tenantId,
        `billing: payment received for invoice ${invoice.number}`,
      );
      await store.recordBillingEvent({
        type: "subscription.restored",
        payload: { reason: "payment received", invoice: invoice.number },
        actorId: recordedBy,
        viaPlatformAdmin: recordedBy !== null,
      });
    }
    return { subscriptionId: subscription.id, status: "ACTIVE" };
  }

  /** payment.failed: dunning advance → grace after the final step (§8). */
  async handlePaymentFailed(invoice: store.SubscriptionInvoiceRow): Promise<string> {
    const subscription = await store.currentSubscriptionRow();
    if (subscription === undefined) {
      throw new CheckoutSessionNotFoundError(invoice.providerRef ?? "");
    }
    const nextStep = subscription.dunningStep + 1;
    const tenant = await tenancyStore.getOwnTenant();
    if (nextStep >= MAX_DUNNING_STEPS) {
      const graceEndsAt = plusDays(new Date(), GRACE_DAYS);
      await store.updateSubscriptionRow(subscription.id, {
        status: "GRACE_READ_ONLY",
        dunningStep: nextStep,
        graceEndsAt: graceEndsAt.toISOString(),
      });
      await store.recordBillingEvent({
        type: "grace.entered",
        payload: {
          reason: "dunning_exhausted",
          invoice: invoice.number,
          graceEndsAt: graceEndsAt.toISOString(),
        },
      });
      // Entitlements survive the lapse for the grace window (the product
      // stays usable read-only — re-materialized with the grace expiry).
      const plan = await store.findBillingPlanById(subscription.planId);
      if (plan !== undefined) {
        for (const key of plan.featureKeys) {
          await tenancyStore.upsertPlanEntitlement({ featureKey: key, expiresAt: graceEndsAt.toISOString() });
        }
      }
      await this.audit.record({
        action: "subscription.grace_entered",
        entityType: "subscription",
        entityId: subscription.id,
        after: {
          invoice: invoice.number,
          graceEndsAt: graceEndsAt.toISOString(),
          dunningStep: nextStep,
        },
      });
      await this.inbox.notifyOwner(this.email, {
        category: "subscription",
        severity: "critical",
        title: { ar: "بدأت فترة السماح (قراءة فقط)", en: "Read-only grace period started" },
        body: {
          ar: `تعذّر تحصيل الدفعة للفاتورة ${invoice.number}. الترحيل متوقف مؤقتًا؛ تظل التقارير والتصدير والطباعة متاحة.`,
          en: `Payment for invoice ${invoice.number} failed. Posting is paused; reports, export, and printing stay available.`,
        },
        actionLabel: { ar: "الدفع الآن", en: "Pay now" },
        actionUrl: "/billing",
        dedupeKey: `grace:${subscription.id}`,
        emailTemplate: "subscription_state",
        emailVariables: {
          tenantName: tenant.name,
          state: "GRACE_READ_ONLY",
          detail: `Payment for invoice ${invoice.number} failed; the read-only grace started.`,
          action: "Pay to restore posting — reports, export, and printing stay available.",
        },
      });
      log.warn({ tenant_id: subscription.tenantId, invoice: invoice.number }, "billing grace entered");
      return "GRACE_READ_ONLY";
    }
    await store.updateSubscriptionRow(subscription.id, { status: "PAST_DUE", dunningStep: nextStep });
    await store.recordBillingEvent({
      type: "dunning.warned",
      payload: { invoice: invoice.number, step: nextStep, max: MAX_DUNNING_STEPS },
    });
    await this.inbox.notifyOwner(this.email, {
      category: "subscription",
      severity: "warning",
      title: { ar: "تعذّر تحصيل الدفعة", en: "Payment collection failed" },
      body: {
        ar: `تعذّر تحصيل الدفعة للفاتورة ${invoice.number} (محاولة ${nextStep} من ${MAX_DUNNING_STEPS}).`,
        en: `Payment for invoice ${invoice.number} failed (attempt ${nextStep} of ${MAX_DUNNING_STEPS}).`,
      },
      actionLabel: { ar: "الدفع الآن", en: "Pay now" },
      actionUrl: "/billing",
      dedupeKey: `dunning:${subscription.id}:${nextStep}`,
      emailTemplate: "subscription_state",
      emailVariables: {
        tenantName: tenant.name,
        state: "PAST_DUE",
        detail: `Payment for invoice ${invoice.number} failed (attempt ${nextStep}/${MAX_DUNNING_STEPS}).`,
        action: "Pay to avoid the read-only grace.",
      },
    });
    return "PAST_DUE";
  }

  // -------------------------------------------------------------------------
  // Manual invoicing fallback (platform plane; A-009)

  async recordManualPayment(input: {
    invoiceId: string;
    via: "bank_transfer" | "cash" | "cheque";
    reference: string;
    reason: string;
    staffActorId: string;
  }): Promise<{ invoiceNumber: string; subscriptionStatus: string }> {
    if (input.reason.trim().length < 3 || input.reference.trim().length < 3) {
      throw new ManualPaymentReasonRequiredError();
    }
    const invoice = await store.findInvoiceById(input.invoiceId);
    if (invoice === undefined) {
      throw new SubscriptionInvoiceNotFoundError(input.invoiceId);
    }
    if (invoice.status !== "OPEN") {
      throw new ManualPaymentNotAllowedError(invoice.number, invoice.status);
    }
    const outcome = await this.settleFromInvoice(
      invoice,
      "manual_recorded",
      input.reference,
      input.staffActorId,
      input.reason,
    );
    await store.recordBillingEvent({
      type: "manual_payment.recorded",
      payload: { invoice: invoice.number, via: input.via, reference: input.reference },
      actorId: input.staffActorId,
      viaPlatformAdmin: true,
      idempotencyKey: `manual:${invoice.id}:${input.reference}`,
    });
    return { invoiceNumber: invoice.number, subscriptionStatus: outcome.status };
  }

  // -------------------------------------------------------------------------
  // Billing suspension / restore (subscription-driven; PHASE-004 semantics)

  async suspendForBilling(input: {
    subscriptionId: string;
    actorId: string | null;
    reason: string;
  }): Promise<{ tenantId: string; killedSessions: number }> {
    const subscription = await store.findSubscriptionRowById(input.subscriptionId);
    if (subscription === undefined) {
      throw new SubscriptionInvoiceNotFoundError(input.subscriptionId);
    }
    if (subscription.status === "SUSPENDED") {
      throw new InvalidSubscriptionTransitionError("SUSPENDED", "suspend");
    }
    await store.updateSubscriptionRow(subscription.id, { status: "SUSPENDED" });
    await store.recordBillingEvent({
      type: "suspension.executed",
      payload: { reason: input.reason, subscription: subscription.id },
      actorId: input.actorId,
      viaPlatformAdmin: input.actorId !== null,
    });
    const outcome = await this.lifecycle.suspend(
      input.actorId ?? "00000000-0000-0000-0000-000000000000",
      subscription.tenantId,
      input.reason,
    );
    return { tenantId: subscription.tenantId, killedSessions: outcome.killedSessions };
  }

  async restoreFromBilling(input: {
    subscriptionId: string;
    actorId: string | null;
    reason: string;
  }): Promise<{ tenantId: string }> {
    const subscription = await store.findSubscriptionRowById(input.subscriptionId);
    if (subscription === undefined) {
      throw new SubscriptionInvoiceNotFoundError(input.subscriptionId);
    }
    if (subscription.status !== "SUSPENDED" && subscription.status !== "GRACE_READ_ONLY") {
      throw new InvalidSubscriptionTransitionError(subscription.status, "restore");
    }
    await store.updateSubscriptionRow(subscription.id, {
      status: "ACTIVE",
      graceEndsAt: null,
      dunningStep: 0,
    });
    await store.recordBillingEvent({
      type: "subscription.restored",
      payload: { reason: input.reason, subscription: subscription.id },
      actorId: input.actorId,
      viaPlatformAdmin: input.actorId !== null,
    });
    // Entitlements back on the plan without expiry (paid posture).
    const plan = await store.findBillingPlanById(subscription.planId);
    if (plan !== undefined) {
      for (const key of plan.featureKeys) {
        await tenancyStore.upsertPlanEntitlement({ featureKey: key, expiresAt: null });
      }
    }
    await this.lifecycle.restore(
      input.actorId ?? "00000000-0000-0000-0000-000000000000",
      subscription.tenantId,
      input.reason,
    );
    return { tenantId: subscription.tenantId };
  }

  // -------------------------------------------------------------------------
  // Daily pass (trial expiry, grace expiry, pending downgrades, overdue)

  async runDailyPass(input: {
    runMode: "NIGHTLY" | "ON_DEMAND";
    actorId: string | null;
  }): Promise<{
    trialsExpired: number;
    suspensions: number;
    downgradesApplied: number;
    downgradesBlocked: number;
    overdueInvoices: number;
    documentsReconciled: number;
  }> {
    const today = new Date().toISOString().slice(0, 10);
    const nowIso = new Date().toISOString();
    const rows = await store.platformListSubscriptionsNeedingAttention();
    let trialsExpired = 0;
    let suspensions = 0;
    let downgradesApplied = 0;
    let downgradesBlocked = 0;
    let overdueInvoices = 0;
    let documentsReconciled = 0;
    for (const row of rows) {
      await withTenant(row.tenantId, async () => {
        // 1) trial expiry without payment → read-only grace (§7.3).
        if (row.status === "TRIAL" && row.trialEndsAt !== null && row.trialEndsAt <= nowIso) {
          const graceEndsAt = plusDays(new Date(), GRACE_DAYS);
          await store.updateSubscriptionRow(row.subscriptionId, {
            status: "GRACE_READ_ONLY",
            graceEndsAt: graceEndsAt.toISOString(),
          });
          await store.recordBillingEvent({
            type: "trial.expired",
            payload: { subscription: row.subscriptionId, graceEndsAt: graceEndsAt.toISOString() },
          });
          const plan = await store.findBillingPlanById(row.planId);
          if (plan !== undefined) {
            for (const key of plan.featureKeys) {
              await tenancyStore.upsertPlanEntitlement({
                featureKey: key,
                expiresAt: graceEndsAt.toISOString(),
              });
            }
          }
          trialsExpired += 1;
          return;
        }
        // 2) grace expiry → suspension (PHASE-004 semantics; sessions die).
        if (
          row.status === "GRACE_READ_ONLY" &&
          row.graceEndsAt !== null &&
          row.graceEndsAt <= nowIso
        ) {
          await store.updateSubscriptionRow(row.subscriptionId, { status: "SUSPENDED" });
          await store.recordBillingEvent({
            type: "suspension.executed",
            payload: { reason: "grace_expired", subscription: row.subscriptionId },
          });
          await this.lifecycle.suspend(
            input.actorId ?? (await this.ownerActorId()),
            row.tenantId,
            "billing: grace expired without payment",
          );
          suspensions += 1;
          return;
        }
        // 3) pending downgrade at period end (re-validated against usage).
        if (row.cancelAtPeriodEnd && row.pendingPlanId !== null && row.periodEnd <= today) {
          const target = await store.findBillingPlanById(row.pendingPlanId);
          if (target === undefined) {
            return;
          }
          const blockers = await this.downgradeBlockers(target);
          if (blockers.length > 0) {
            await store.recordBillingEvent({
              type: "downgrade.blocked",
              payload: { subscription: row.subscriptionId, blockers, at: "period_end" },
            });
            downgradesBlocked += 1;
            return;
          }
          await tenancyStore.supersedeSubscriptions();
          const nextStart = today;
          const nextEnd = plusDays(new Date(), 30).toISOString().slice(0, 10);
          await store.insertSubscriptionRow({
            planId: target.id,
            status: "ACTIVE",
            periodStart: nextStart,
            periodEnd: nextEnd,
          });
          await tenancyStore.deleteExpiredEntitlements();
          for (const key of target.featureKeys) {
            await tenancyStore.upsertPlanEntitlement({ featureKey: key, expiresAt: null });
          }
          await tenancyStore.deleteStalePlanEntitlements(target.featureKeys);
          await store.recordBillingEvent({
            type: "plan.changed",
            payload: { plan: target.key, via: "period_end_downgrade" },
          });
          publishTenancyEvent({ type: "plan.changed", tenantId: row.tenantId, planKey: target.key });
          downgradesApplied += 1;
          return;
        }
        // 5) documents/month counter reconcile (journal_entries is the
        // durable truth; the event-driven bump is the fast path, this is
        // the repair — usage-service semantics inlined per tenant).
        const period = new Date().toISOString().slice(0, 7);
        const truth = await store.countJournalEntriesForPeriod(period);
        await store.upsertUsageCounter({ counterKey: "documents_per_month", period, value: truth });
        documentsReconciled += 1;
        // 4) overdue OPEN subscription invoices → owner notice (once each).
        const open = await store.listInvoices(50);
        for (const invoice of open) {
          if (invoice.status === "OPEN" && invoice.dueDate < today) {
            overdueInvoices += 1;
            const tenant = await tenancyStore.getOwnTenant();
            await this.inbox.notifyOwner(this.email, {
              category: "subscription",
              severity: "warning",
              title: { ar: "فاتورة اشتراك متأخرة", en: "Overdue subscription invoice" },
              body: {
                ar: `الفاتورة ${invoice.number} تجاوزت تاريخ الاستحقاق (${invoice.dueDate}).`,
                en: `Invoice ${invoice.number} is past due (${invoice.dueDate}).`,
              },
              actionLabel: { ar: "الدفع الآن", en: "Pay now" },
              actionUrl: "/billing",
              dedupeKey: `sub-invoice-overdue:${invoice.id}`,
              emailTemplate: "subscription_state",
              emailVariables: {
                tenantName: tenant.name,
                state: "PAST_DUE",
                detail: `Subscription invoice ${invoice.number} is past due (${invoice.dueDate}).`,
                action: "Pay to avoid the read-only grace.",
              },
            });
          }
        }
      });
    }
    return {
      trialsExpired,
      suspensions,
      downgradesApplied,
      downgradesBlocked,
      overdueInvoices,
      documentsReconciled,
    };
  }
}

/** The ambient tenant transaction for owner-actor resolution. */
function txOfScope() {
  return requireTenantContext().tx!;
}
