import { DomainError } from "@erp/domain-core";

/**
 * PHASE-014 subscription/billing domain errors (ERROR_MODEL §2: codes are
 * contracts, messages are display-only; HTTP statuses mapped once in the
 * ErrorModelFilter). The phase doc's conceptual names map to wire codes per
 * the repo convention: `subscription_read_only` →
 * `tenancy/subscription-read-only`, `limit_exceeded` →
 * `tenancy/limit-exceeded`, `webhook` failures → `billing/*`.
 */

/**
 * 403 subscription_read_only — SUBSCRIPTION §8: the tenant is in the
 * read-only grace period; state-changing business actions fail with the
 * typed error naming the resolving action (pay / upgrade / contact admin).
 * Reads, reports, exports, and printing continue.
 */
export class SubscriptionReadOnlyError extends DomainError {
  constructor(detail: {
    status: string;
    graceEndsAt: string | null;
    resolvingAction: { ar: string; en: string };
  }) {
    super("tenancy/subscription-read-only", "Subscription is in the read-only grace period", {
      ...detail,
    });
  }
}

/**
 * 422 limit_exceeded — SUBSCRIPTION §6 hard blocks (creation actions only:
 * invite user, create branch/warehouse, device/terminal activation in later
 * phases). The details name the limit, the plan ceiling, current usage, and
 * the resolving action. NEVER fired for documents/month (INV-022: no limit
 * behavior may block posting or touch posted data).
 */
export class LimitExceededError extends DomainError {
  constructor(detail: {
    limit: string;
    limitValue: number | "unlimited";
    usage: number;
    resolvingAction: { ar: string; en: string };
  }) {
    super("tenancy/limit-exceeded", "Plan limit reached for this creation action", detail);
  }
}

/**
 * 422 downgrade_blocked — SUBSCRIPTION §8: the downgrade is refused while
 * current usage exceeds the target plan's limits; the details list every
 * blocking counter with its exact usage vs ceiling (the tenant is told
 * exactly what blocks it).
 */
export class DowngradeBlockedError extends DomainError {
  constructor(
    blockers: ReadonlyArray<{
      limit: string;
      usage: number;
      limitValue: number;
    }>,
  ) {
    super("tenancy/downgrade-blocked", "Downgrade blocked while usage exceeds the target plan limits", {
      blockers,
    });
  }
}

/** 400 — webhook signature verification failed (forged or malformed). */
export class WebhookSignatureInvalidError extends DomainError {
  constructor(reason: string) {
    super("billing/webhook-signature-invalid", "Webhook signature verification failed", {
      reason,
    });
  }
}

/** 400 — webhook timestamp outside the replay tolerance window. */
export class WebhookReplayError extends DomainError {
  constructor(ageSeconds: number, toleranceSeconds: number) {
    super("billing/webhook-replay", "Webhook timestamp is outside the replay tolerance", {
      ageSeconds,
      toleranceSeconds,
    });
  }
}

/** 404 — checkout session ref does not resolve to an OPEN invoice. */
export class CheckoutSessionNotFoundError extends DomainError {
  constructor(sessionRef: string) {
    super("billing/checkout-session-not-found", `Unknown checkout session: ${sessionRef}`, {
      sessionRef,
    });
  }
}

/** 422 — checkout session already settled (terminal state). */
export class CheckoutSessionSettledError extends DomainError {
  constructor(sessionRef: string, status: string) {
    super("billing/checkout-session-settled", "Checkout session is already settled", {
      sessionRef,
      status,
    });
  }
}

/** 422 — manual payment targets an invoice that is not OPEN. */
export class ManualPaymentNotAllowedError extends DomainError {
  constructor(invoiceNumber: string, status: string) {
    super("billing/manual-payment-not-allowed", `Invoice ${invoiceNumber} is ${status}, not OPEN`, {
      invoiceNumber,
      status,
    });
  }
}

/** 422 — manual payment requires the mandatory reason + reference. */
export class ManualPaymentReasonRequiredError extends DomainError {
  constructor() {
    super(
      "billing/manual-payment-reason-required",
      "Manual payment recording requires a reason and a payment reference",
    );
  }
}

/** 409 — invalid subscription lifecycle transition. */
export class InvalidSubscriptionTransitionError extends DomainError {
  constructor(current: string, attempted: string) {
    super("tenancy/invalid-subscription-transition", `Cannot ${attempted} from ${current}`, {
      current,
      attempted,
    });
  }
}

/** 422 — same-plan change requests are a no-op (nothing to do). */
export class PlanUnchangedError extends DomainError {
  constructor(planKey: string) {
    super("tenancy/plan-unchanged", `Subscription is already on plan ${planKey}`, { planKey });
  }
}

/** 404 — subscription invoice not found for this tenant. */
export class SubscriptionInvoiceNotFoundError extends DomainError {
  constructor(id: string) {
    super("billing/subscription-invoice-not-found", `Unknown subscription invoice: ${id}`, { id });
  }
}
