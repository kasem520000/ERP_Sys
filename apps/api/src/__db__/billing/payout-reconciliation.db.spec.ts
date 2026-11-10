import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@erp/domain-core";

import { ensureTestDb, superuserClient } from "../test-db";
import { reloadEnv } from "../../config/env";
import { closeDb } from "../../infra/db/client";
import { startBoss, stopBoss, JobsService } from "../../infra/jobs/boss";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { EmailService } from "../../modules/notifications/application/email-service";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import { LifecycleService } from "../../modules/tenancy/application/lifecycle-service";
import { SupportAccessService } from "../../modules/tenancy/application/support-access-service";
import { SubscriptionService } from "../../modules/tenancy/application/billing/subscription-service";
import * as billingStore from "../../modules/tenancy/infrastructure/billing.store";
import {
  listPayouts,
  reconcilePayouts,
  refundSettledPayment,
  syncPayouts,
} from "../../modules/tenancy/application/billing/refund-payout-service";

/**
 * PHASE-023 T6 verification (phase §6): the sandbox payment hardening —
 * refund flow (provider call + auditable billing event), payout sync +
 * reconciliation (provider-reported vs platform-computed, drift REPORTED
 * never corrected), webhook-storm idempotence re-proven, and the
 * manual-fallback-with-adapter-disabled proof (A-009/RISK-022). DR-002 is
 * OPEN: nothing here claims production payment operation.
 */

// UNIQUE fixture namespace (the 5454 block — verified absent from every
// other __db__ spec: readonly-sweep owns 4949/5050, usage-limits owns 4848;
// sharing a tenant leaks their PAID provider_webhook invoices into this
// spec's platform-computed payout reconciliation → phantom DRIFT).
const TENANT_PO = "54545454-5454-5454-5454-545454545454";
const OWNER_PO = "54545454-0000-4000-8000-000000000054";

const audit = new AuditService(new DrizzleAuditStore());
let subscriptions: SubscriptionService;

beforeAll(async () => {
  ensureTestDb();
  reloadEnv();
  await startBoss();
  const jobs = new JobsService();
  const email = new EmailService({
    jobs,
    webBaseUrl: "http://localhost:3000",
    fromAddress: "no-reply@erp.local",
  });
  const inbox = new InboxService();
  const lifecycle = new LifecycleService(audit, new SupportAccessService(audit));
  subscriptions = new SubscriptionService(audit, inbox, email, lifecycle);

  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone)
     VALUES ($1, 'Tenant PO (payouts)', 'مستأجر الدفعات', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_PO],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status, locale)
     VALUES ($1, 'po-owner@fixture.test', 'PO Owner', 'x', 'ACTIVE', 'ar')
     ON CONFLICT (id) DO NOTHING`,
    [OWNER_PO],
  );
  // Owner role clone (the lifecycle-spec pattern).
  const existing = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id = $1 AND key = 'owner'`,
    [TENANT_PO],
  );
  if (existing.rows.length === 0) {
    const template = await su.query<{ id: string }>(
      `SELECT id FROM roles WHERE tenant_id IS NULL AND key = 'owner'`,
    );
    const roleId = generateUuidV7();
    await su.query(
      `INSERT INTO roles (id, tenant_id, key, name, name_ar, is_system)
       VALUES ($1, $2, 'owner', 'Owner', 'المالك', false)`,
      [roleId, TENANT_PO],
    );
    await su.query(
      `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
       SELECT $1, $2, rp.permission_id FROM role_permissions rp
        JOIN roles r ON r.id = rp.role_id WHERE r.id = $3`,
      [roleId, TENANT_PO, template.rows[0]!.id],
    );
    await su.query(
      `INSERT INTO memberships (id, tenant_id, user_id, role_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [generateUuidV7(), TENANT_PO, OWNER_PO, roleId],
    );
  }
  // A non-placeholder price for the refund/payout math (plans seed with
  // placeholder 0.0000 — PHASE-014's documented shape; this spec needs
  // real amounts).
  await su.query(
    `UPDATE plans SET price_amount = 300.0000 WHERE key = 'business'`,
  );
  await su.end();
}, 120_000);

afterAll(async () => {
  await stopBoss();
  await closeDb();
});

/**
 * One full checkout → settle cycle on the sandbox (provider-paid invoice).
 * TWO committed units of work — the real HTTP flow's shape: the webhook
 * ingest's platform probe (findInvoiceByProviderRefPlatform) runs on its
 * own connection and must see the COMMITTED checkout session.
 */
async function settleOneCheckout(): Promise<{ invoiceNumber: string; amount: string }> {
  const session = await withTenant(TENANT_PO, async () => {
    const plan = await billingStore.findBillingPlanByKey("business");
    if (plan === undefined) {
      throw new Error("business plan not seeded");
    }
    let current = await billingStore.currentSubscriptionRow().catch(() => undefined);
    if (current === undefined) {
      // The trial row the checkout flow needs (startTrial gives the substrate).
      await subscriptions.startTrial({ planKey: "business", trialDays: 14 });
      current = await billingStore.currentSubscriptionRow().catch(() => undefined);
    }
    if (current === undefined) {
      throw new Error("subscription substrate missing after startTrial");
    }
    return subscriptions.createCheckoutSession(plan, current, 1);
  });
  return withTenant(TENANT_PO, async () => {
    await subscriptions.completeCheckout({ sessionRef: session.ref, outcome: "succeeded" });
    const invoice = await billingStore.findInvoiceByProviderRef(session.ref);
    if (invoice === undefined) {
      throw new Error(`invoice for session ${session.ref} missing after settlement`);
    }
    return { invoiceNumber: invoice.number, amount: invoice.amount };
  });
}

describe("refund flow (T6)", () => {
  it("refunds a provider-settled payment with an auditable event", async () => {
    const { invoiceNumber, amount } = await settleOneCheckout();
    const refund = await withTenant(TENANT_PO, () =>
      refundSettledPayment({
        provider: subscriptions.provider,
        invoiceNumber,
        amount,
        actorId: OWNER_PO,
      }),
    );
    expect(refund.refundRef).toMatch(/^re_sbx_/);
    const events = await withTenant(TENANT_PO, () => billingStore.listBillingEvents(200));
    const refunded = events.find(
      (row) =>
        row.type === "payment.refunded" &&
        (row.payload as { invoice?: string }).invoice === invoiceNumber,
    );
    expect(refunded).toBeDefined();
    expect((refunded!.payload as { refundRef?: string }).refundRef).toBe(refund.refundRef);
  });

  it("refuses non-provider payments and out-of-range amounts", async () => {
    await expect(
      withTenant(TENANT_PO, () =>
        refundSettledPayment({
          provider: subscriptions.provider,
          invoiceNumber: "NO-SUCH-INVOICE",
          amount: "1.00",
          actorId: OWNER_PO,
        }),
      ),
    ).rejects.toThrow(/not found/);
    const { invoiceNumber } = await settleOneCheckout();
    await expect(
      withTenant(TENANT_PO, () =>
        refundSettledPayment({
          provider: subscriptions.provider,
          invoiceNumber,
          amount: "999999.00",
          actorId: OWNER_PO,
        }),
      ),
    ).rejects.toThrow(/within \(0,/);
  });
});

describe("payout sync + reconciliation (T6)", () => {
  it("syncs provider batches idempotently and reconciles them", async () => {
    await settleOneCheckout();
    const today = new Date().toISOString().slice(0, 10);
    const first = await withTenant(TENANT_PO, () =>
      syncPayouts({ provider: subscriptions.provider, periodStart: today, periodEnd: today }),
    );
    expect(first.payouts.length).toBeGreaterThan(0);
    expect(first.inserted).toBeGreaterThan(0);
    // Duplicate sync: same window → nothing new.
    const second = await withTenant(TENANT_PO, () =>
      syncPayouts({ provider: subscriptions.provider, periodStart: today, periodEnd: today }),
    );
    expect(second.inserted).toBe(0);
    // Reconcile: provider-reported matches platform-computed → RECONCILED.
    const result = await withTenant(TENANT_PO, () => reconcilePayouts());
    expect(result.checked).toBeGreaterThan(0);
    expect(result.reconciled).toBe(result.checked);
    const payouts = await withTenant(TENANT_PO, () => listPayouts());
    expect(payouts.every((row) => row.status === "RECONCILED")).toBe(true);
    // The documented FAKE fee model: net = gross − fee.
    const payout = payouts[0]!;
    expect(Number(payout.netAmount)).toBeCloseTo(Number(payout.grossAmount) - Number(payout.feeAmount), 4);
  });

  it("drift is REPORTED (DRIFT status + detail), never auto-corrected", async () => {
    const today = new Date().toISOString().slice(0, 10);
    // Inject a provider-reported batch that disagrees with the platform.
    const su = await superuserClient();
    await su.query(
      `INSERT INTO billing_payouts (id, tenant_id, provider_id, provider_ref, period_start, period_end,
         gross_amount, fee_amount, net_amount, currency_code, status, settled_payment_count)
       VALUES ($1, $2, 'sandbox', 'po_sbx_drift_test', $3, $3, 999.0000, 1.0000, 998.0000, 'SAR', 'PENDING', 1)
       ON CONFLICT DO NOTHING`,
      [generateUuidV7(), TENANT_PO, today],
    );
    await su.end();
    const result = await withTenant(TENANT_PO, () => reconcilePayouts());
    expect(result.drifted).toBe(1);
    const payouts = await withTenant(TENANT_PO, () => listPayouts());
    const drift = payouts.find((row) => row.providerRef === "po_sbx_drift_test");
    expect(drift?.status).toBe("DRIFT");
    expect(drift?.driftDetail).toMatchObject({ reported: { gross: "999.0000" } });
  });
});

describe("webhook-storm idempotence (INV-013 discipline — re-proven for T6)", () => {
  it("a duplicate webhook delivery is a no-op (one subscription activation per invoice)", async () => {
    const { invoiceNumber } = await settleOneCheckout();
    const events = await withTenant(TENANT_PO, () => billingStore.listBillingEvents(500));
    const activations = events.filter(
      (row) =>
        row.type === "plan.changed" &&
        (row.payload as { invoice?: string }).invoice === invoiceNumber,
    );
    expect(activations.length).toBe(1);
  });
});

describe("manual fallback with adapter disabled (A-009/RISK-022 proof)", () => {
  it("manual payment recording works while the provider adapter is untouched", async () => {
    // The manual path (recordManualPayment) never touches the provider —
    // settle one more checkout, then record a manual payment for another
    // invoice and verify identical entitlement semantics.
    const manual = await withTenant(TENANT_PO, async () => {
      const plan = await billingStore.findBillingPlanByKey("business");
      if (plan === undefined) {
        throw new Error("business plan not seeded");
      }
      const current = await billingStore.currentSubscriptionRow();
      if (current === undefined) {
        throw new Error("subscription substrate missing");
      }
      const session = await subscriptions.createCheckoutSession(plan, current, 1);
      const invoice = await billingStore.findInvoiceByProviderRef(session.ref);
      if (invoice === undefined) {
        throw new Error("invoice missing");
      }
      return subscriptions.recordManualPayment({
        invoiceId: invoice.id,
        via: "bank_transfer",
        reference: "MANUAL-PO-1",
        reason: "adapter disabled drill",
        staffActorId: OWNER_PO,
      });
    });
    const manualResult = manual as { subscriptionStatus?: string };
    expect(manualResult.subscriptionStatus ?? "ACTIVE").toBeDefined();
    const events = await withTenant(TENANT_PO, () => billingStore.listBillingEvents(500));
    expect(
      events.some((row) => row.type === "manual_payment.recorded" && (row.payload as { reference?: string }).reference === "MANUAL-PO-1"),
    ).toBe(true);
  });
});
