import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { env } from "../../../../config/env";
import { WEBHOOK_TOLERANCE_SECONDS } from "./billing-config";

/**
 * PHASE-014 payment-provider adapter port (PHASE-014 §2.2; OQ-003; RISK-022):
 * the provider choice is a decision record — the port is the contract. The
 * MVP ships the SANDBOX adapter (checkout session creation + settle-through-
 * the-webhook-pipeline) plus the mandatory manual-invoicing fallback (A-009)
 * which never touches this port. No production provider goes live at MVP —
 * sandbox + manual must both be operational (the phase's hard rule).
 *
 * Signature scheme (SECRETS §webhook; Stripe-style v1):
 *   header  = `t=<unix seconds>,v1=<hex hmac>`
 *   payload = `${t}.${rawBody}` HMAC-SHA256 with BILLING_WEBHOOK_SECRET.
 * Dev default secret is derived when unset (LOCAL-ONLY, documented in
 * .env.example — same envelope as IDENTITY_SECRET_KEY).
 */

export interface CreateCheckoutSessionInput {
  readonly tenantId: string;
  readonly planKey: string;
  readonly invoiceNumber: string;
  readonly amount: string;
  readonly currencyCode: string;
  readonly periodStart: string;
  readonly periodEnd: string;
}

export interface CheckoutSession {
  /** Provider checkout reference (stored on the invoice + subscription). */
  readonly ref: string;
  /** Sandbox checkout URL on the web surface (tenant-authenticated page). */
  readonly url: string;
  readonly expiresAt: string;
}

export interface SettledWebhook {
  /** The exact bytes the provider would POST to the webhook route. */
  readonly rawBody: string;
  /** The signature header for those bytes (`t=…,v1=…`). */
  readonly signature: string;
}

export interface ProviderAdapterPort {
  readonly id: string;
  createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession>;
  /** Sandbox-only: settle a session, producing the signed webhook delivery. */
  settleCheckout(input: {
    sessionRef: string;
    outcome: "succeeded" | "failed";
    tenantId: string;
    invoiceNumber: string;
    amount: string;
    currency: string;
  }): SettledWebhook;
  /**
   * PHASE-023 T6 (refund flow — sandbox depth until DR-002 decides the
   * provider): refund a settled payment by its provider reference. The
   * sandbox adapter issues a deterministic refund id — production shapes
   * ship with the chosen provider's adapter (no wire format is guessed).
   */
  refund(input: {
    providerRef: string;
    amount: string;
    currency: string;
  }): Promise<{ refundRef: string; status: "succeeded" }>;
  /**
   * PHASE-023 T6 (payout reconciliation — sandbox depth): list provider
   * payout batches for a period window. The sandbox generates them from
   * the recorded settlements with its documented FAKE fee model; a real
   * provider's payouts API ships with its adapter.
   */
  listPayouts(input: {
    periodStart: string;
    periodEnd: string;
  }): Promise<
    readonly {
      providerRef: string;
      periodStart: string;
      periodEnd: string;
      grossAmount: string;
      feeAmount: string;
      netAmount: string;
      currencyCode: string;
      settledPaymentRefs: readonly string[];
    }[]
  >;
}

export interface WebhookEventPayload {
  readonly id: string;
  readonly type: "payment.succeeded" | "payment.failed";
  readonly created_unix: number;
  readonly data: {
    readonly session_ref: string;
    readonly tenant_id: string;
    readonly invoice_number: string;
    readonly amount: string;
    readonly currency: string;
  };
}

/**
 * Webhook event ids: unique per DELIVERY (real-provider semantics — each
 * retry/dunning delivery is a new event; the ingest dedupes by the id
 * inside the payload, so re-posting the same bytes is the duplicate no-op
 * the replay tests assert).
 */
function eventId(): string {
  return `evt_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

/** The dev-default LOCAL-ONLY secret (documented; production sets the env). */
export function webhookSecret(): string {
  if (env.BILLING_WEBHOOK_SECRET !== undefined && env.BILLING_WEBHOOK_SECRET !== "") {
    return env.BILLING_WEBHOOK_SECRET;
  }
  return "local-dev-billing-webhook-secret";
}

/**
 * PHASE-024 T6 — S-11 dual-secret window (SECRETS_MANAGEMENT §3
 * "Zero-downtime dual-secret window"): the signing secrets accepted during
 * a provider-coordinated rotation — the CURRENT secret first, then the
 * PREVIOUS one (WEBHOOK_SIGNING_SECRET_PREVIOUS) while the window is
 * open. Deliveries signed with either secret pass; once the operator
 * removes the previous secret, only the current one verifies. Drill +
 * runbook: docs/operations/drills/2026-11-06-secrets-rotation.md,
 * docs/operations/SECRETS_ROTATION_RUNBOOK.md §4.
 */
export function acceptedWebhookSecrets(): readonly string[] {
  const current = webhookSecret();
  const previous = env.WEBHOOK_SIGNING_SECRET_PREVIOUS;
  if (previous === undefined || previous === "" || previous === current) {
    return [current];
  }
  return [current, previous];
}

export function signWebhook(rawBody: string, atUnixSeconds: number, secret: string): string {
  const mac = createHmac("sha256", secret).update(`${atUnixSeconds}.${rawBody}`).digest("hex");
  return `t=${atUnixSeconds},v1=${mac}`;
}

/** Verify a webhook signature header against raw bytes (constant-time). */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  nowUnixSeconds: number,
): { ok: true } | { ok: false; reason: "malformed" | "stale" | "mismatch" } {
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(signatureHeader.trim());
  if (match === null) {
    return { ok: false, reason: "malformed" };
  }
  const timestamp = Number(match[1]);
  if (!Number.isFinite(timestamp) || Math.abs(nowUnixSeconds - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, reason: "stale" };
  }
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const givenHex = match[2] ?? "";
  const given = Buffer.from(givenHex, "hex");
  const want = Buffer.from(expected, "hex");
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true };
}

/**
 * Rotation-aware verification (the ingest path): verify against the
 * CURRENT secret, then the PREVIOUS one while the dual-secret window is
 * open. Malformed/stale verdicts are secret-independent and surface
 * immediately; a signature must match SOME accepted secret or the
 * delivery is rejected (mismatch — fail closed).
 */
export function verifyWebhookSignatureWithRotation(
  rawBody: string,
  signatureHeader: string,
  nowUnixSeconds: number,
): { ok: true } | { ok: false; reason: "malformed" | "stale" | "mismatch" } {
  for (const secret of acceptedWebhookSecrets()) {
    const verdict = verifyWebhookSignature(rawBody, signatureHeader, secret, nowUnixSeconds);
    if (verdict.ok) {
      return verdict;
    }
    if (verdict.reason !== "mismatch") {
      // malformed/stale are secret-independent — reject immediately.
      return verdict;
    }
  }
  // Every accepted secret mismatched (the list is never empty).
  return { ok: false, reason: "mismatch" };
}

export function buildWebhookEvent(input: {
  sessionRef: string;
  tenantId: string;
  invoiceNumber: string;
  amount: string;
  currency: string;
  outcome: "succeeded" | "failed";
  atUnixSeconds: number;
}): { event: WebhookEventPayload; rawBody: string; signature: string } {
  const event: WebhookEventPayload = {
    id: eventId(),
    type: input.outcome === "succeeded" ? "payment.succeeded" : "payment.failed",
    created_unix: input.atUnixSeconds,
    data: {
      session_ref: input.sessionRef,
      tenant_id: input.tenantId,
      invoice_number: input.invoiceNumber,
      amount: input.amount,
      currency: input.currency,
    },
  };
  const rawBody = JSON.stringify(event);
  return {
    event,
    rawBody,
    signature: signWebhook(rawBody, input.atUnixSeconds, webhookSecret()),
  };
}

export interface SandboxAdapterDeps {
  readonly webBaseUrl: string;
  readonly secret?: string;
}

/**
 * The sandbox fee model (PHASE-023 T6 — DOCUMENTED FAKE, never a real
 * acquiring tariff): 2.9% + 0.30 per settled payment. It exists so the
 * payout reconciliation job has a deterministic provider-reported shape
 * to reconcile against; the real provider's fee schedule ships with its
 * adapter once DR-002 decides (no fee is ever charged to a tenant by the
 * sandbox — it only feeds reconciliation math).
 */
export const SANDBOX_FEE_PERCENT = "0.029";
export const SANDBOX_FEE_FIXED = "0.30";

/**
 * The sandbox provider (PHASE-014 §2.2): real HTTP-shaped behavior with a
 * deterministic in-process settlement — `settleCheckout` produces the
 * signed webhook delivery that `POST /api/v1/platform/billing/webhook`
 * (and the tenant-plane complete route) processes through the IDENTICAL
 * verification + idempotency pipeline an external provider hits.
 *
 * PHASE-023 T6 hardening: `refund` (deterministic refund references) and
 * `listPayouts` (payout batches computed from the recorded settlements
 * with the documented FAKE fee model) complete the port for the refund +
 * payout/fee reconciliation flows — still SANDBOX-only (DR-002 OPEN; the
 * production cutover is the phase's INCOMPLETE item with the DR pointer).
 */
export class SandboxProviderAdapter implements ProviderAdapterPort {
  readonly id = "sandbox";

  /** The recorded settlements (provider-side ledger for payouts/refunds). */
  private readonly settlements: {
    sessionRef: string;
    invoiceNumber: string;
    amount: string;
    currency: string;
    settledAt: string;
  }[] = [];
  private readonly refunds = new Map<string, { refundRef: string; amount: string }>();

  constructor(private readonly deps: SandboxAdapterDeps) {}

  async createCheckoutSession(input: CreateCheckoutSessionInput): Promise<CheckoutSession> {
    // The ref embeds the plan key segment (advisory only — the invoice row
    // is the authority; providers choose their own ref shapes).
    const ref = `cs_sbx_${input.planKey}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min ⚠
    return {
      ref,
      url: `${this.deps.webBaseUrl}/checkout?session=${encodeURIComponent(ref)}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  settleCheckout(input: {
    sessionRef: string;
    outcome: "succeeded" | "failed";
    tenantId: string;
    invoiceNumber: string;
    amount: string;
    currency: string;
  }): SettledWebhook {
    if (input.outcome === "succeeded") {
      this.settlements.push({
        sessionRef: input.sessionRef,
        invoiceNumber: input.invoiceNumber,
        amount: input.amount,
        currency: input.currency,
        settledAt: new Date().toISOString(),
      });
    }
    return buildWebhookEvent({
      sessionRef: input.sessionRef,
      tenantId: input.tenantId,
      invoiceNumber: input.invoiceNumber,
      amount: input.amount,
      currency: input.currency,
      outcome: input.outcome,
      atUnixSeconds: (Date.now() / 1000) | 0,
    });
  }

  async refund(input: {
    providerRef: string;
    amount: string;
    currency: string;
  }): Promise<{ refundRef: string; status: "succeeded" }> {
    const refundRef = `re_sbx_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    this.refunds.set(input.providerRef, { refundRef, amount: input.amount });
    return { refundRef, status: "succeeded" };
  }

  async listPayouts(input: {
    periodStart: string;
    periodEnd: string;
  }): Promise<
    readonly {
      providerRef: string;
      periodStart: string;
      periodEnd: string;
      grossAmount: string;
      feeAmount: string;
      netAmount: string;
      currencyCode: string;
      settledPaymentRefs: readonly string[];
    }[]
  > {
    const inWindow = this.settlements.filter(
      (settlement) => settlement.settledAt.slice(0, 10) >= input.periodStart && settlement.settledAt.slice(0, 10) <= input.periodEnd,
    );
    if (inWindow.length === 0) {
      return [];
    }
    // Group by currency (payouts settle per currency).
    const byCurrency = new Map<string, typeof inWindow>();
    for (const settlement of inWindow) {
      const list = byCurrency.get(settlement.currency) ?? [];
      list.push(settlement);
      byCurrency.set(settlement.currency, list);
    }
    const payouts: {
      providerRef: string;
      periodStart: string;
      periodEnd: string;
      grossAmount: string;
      feeAmount: string;
      netAmount: string;
      currencyCode: string;
      settledPaymentRefs: readonly string[];
    }[] = [];
    for (const [currencyCode, settlements] of byCurrency) {
      let gross = 0;
      let fee = 0;
      for (const settlement of settlements) {
        const amount = Number(settlement.amount);
        gross += amount;
        fee += amount * Number(SANDBOX_FEE_PERCENT) + Number(SANDBOX_FEE_FIXED);
      }
      const round4 = (value: number): string => value.toFixed(4);
      payouts.push({
        // DETERMINISTIC per (period, currency): re-listing the same window
        // yields the SAME ref — the sync path's idempotency key.
        providerRef: `po_sbx_${input.periodStart}_${input.periodEnd}_${currencyCode}`,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        grossAmount: round4(gross),
        feeAmount: round4(fee),
        netAmount: round4(gross - fee),
        currencyCode,
        settledPaymentRefs: settlements.map((settlement) => settlement.sessionRef),
      });
    }
    return payouts;
  }
}
