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
import * as tenancyStore from "../../modules/tenancy/infrastructure/tenancy.store";

/**
 * PHASE-014 T4 db evidence (PHASE-014 §6 "Lifecycle tests"): the full
 * subscription state machine against real PostgreSQL 16 —
 * TRIAL (registration model) → upgrade checkout → webhook activation
 * (payment.succeeded) → payment failure ×2 (dunning → PAST_DUE →
 * read-only grace) → grace expiry (daily pass → suspension through the
 * PHASE-004 semantics) → manual payment while suspended (A-009) →
 * restore. Plus the trial-expiry path and the §8 downgrade gate. Every
 * transition asserts: the subscriptions row, billing_events, audit_events,
 * the entitlement state, and the owner inbox notification.
 */

const TENANT_BL = "44444444-4444-4444-4444-444444444444";
const TENANT_BL2 = "45454545-4545-4545-4545-454545454545";
const OWNER = "4a4a4a4a-0000-4000-8000-00000000004a";

const audit = new AuditService(new DrizzleAuditStore());
let email: EmailService;
let inbox: InboxService;
let subscriptions: SubscriptionService;

/** Idempotent owner role + membership for a fixture tenant. */
async function ensureOwnerRole(tenantId: string, su: import("pg").Client): Promise<string> {
  const existing = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id = $1 AND key = 'owner'`,
    [tenantId],
  );
  if (existing.rows.length > 0) {
    return existing.rows[0]!.id;
  }
  const template = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id IS NULL AND key = 'owner'`,
  );
  const roleId = generateUuidV7();
  await su.query(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar, is_system)
     VALUES ($1, $2, 'owner', 'Owner', 'المالك', false)`,
    [roleId, tenantId],
  );
  await su.query(
    `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
     SELECT $1, $2, rp.permission_id FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id WHERE r.id = $3`,
    [roleId, tenantId, template.rows[0]!.id],
  );
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [generateUuidV7(), tenantId, OWNER, roleId],
  );
  return roleId;
}

beforeAll(async () => {
  ensureTestDb();
  reloadEnv();
  await startBoss();
  const jobs = new JobsService();
  email = new EmailService({
    jobs,
    webBaseUrl: "http://localhost:3000",
    fromAddress: "no-reply@erp.local",
  });
  inbox = new InboxService();
  const support = new SupportAccessService(audit);
  const lifecycle = new LifecycleService(audit, support);
  subscriptions = new SubscriptionService(audit, inbox, email, lifecycle);

  const su = await superuserClient();
  for (const [id, name] of [
    [TENANT_BL, "Tenant BL (billing lifecycle)"],
    [TENANT_BL2, "Tenant BL2 (trial expiry)"],
  ] as const) {
    await su.query(
      `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone)
       VALUES ($1, $2, $2, 'SAR', 'SA', 'Asia/Riyadh') ON CONFLICT (id) DO NOTHING`,
      [id, name],
    );
  }
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status, locale)
     VALUES ($1, 'bl-owner@fixture.test', 'BL Owner', 'x', 'ACTIVE', 'ar')
     ON CONFLICT (id) DO NOTHING`,
    [OWNER],
  );
  await ensureOwnerRole(TENANT_BL, su);
  await ensureOwnerRole(TENANT_BL2, su);
  await su.end();
}, 120_000);

afterAll(async () => {
  await stopBoss();
  await closeDb();
});

async function eventsOf(type: string): Promise<ReadonlyArray<{ payload: Record<string, unknown> }>> {
  const rows = await withTenant(TENANT_BL, () => billingStore.listBillingEvents(200));
  return rows.filter((row) => row.type === type);
}

async function entitlementState(
  tenantId: string,
): Promise<Map<string, { source: string; expiresAt: string | null }>> {
  return withTenant(tenantId, async () => {
    const rows = await tenancyStore.listActiveEntitlements();
    return new Map(rows.map((row) => [row.featureKey, { source: row.source, expiresAt: row.expiresAt }]));
  });
}

describe("PHASE-014 subscription lifecycle (T4)", () => {
  it("registers a TRIAL subscription (PHASE-014 model) + the billing event", async () => {
    const outcome = await withTenant(TENANT_BL, () =>
      subscriptions.startTrial({ planKey: "business", trialDays: 14 }),
    );
    expect(outcome.subscriptionId).toBeTruthy();
    const events = await eventsOf("trial.started");
    expect(events.length).toBe(1);
    const subscription = await withTenant(TENANT_BL, () => billingStore.currentSubscriptionRow());
    expect(subscription?.status).toBe("TRIAL");
    expect(subscription?.trialEndsAt).not.toBeNull();
    // Trial entitlements: business keys, source TRIAL, expiry set (§7.2 —
    // materialized exactly like paid ones; no parallel code path).
    const state = await entitlementState(TENANT_BL);
    expect(state.get("accounting.multi_currency")?.source).toBe("TRIAL");
    expect(state.get("accounting.multi_currency")?.expiresAt).not.toBeNull();
    expect(state.get("reporting.dashboards")?.source).toBe("TRIAL");
  });

  it("change-plan upgrade creates an OPEN checkout invoice (sandbox provider)", async () => {
    const outcome = await withTenant(TENANT_BL, () =>
      subscriptions.changePlan({ planKey: "enterprise" }),
    );
    expect(outcome.action).toBe("checkout_created");
    expect(outcome.planKey).toBe("enterprise");
    expect(outcome.invoiceNumber).toMatch(/^BI-\d{4}-\d{4}$/);
    expect(outcome.checkoutUrl).toContain("/checkout?session=");
    const events = await eventsOf("checkout.created");
    expect(events.length).toBe(1);
    const session = (events[0]!.payload as { session: string }).session;
    const invoice = await withTenant(TENANT_BL, () => billingStore.findInvoiceByProviderRef(session));
    expect(invoice?.status).toBe("OPEN");
    expect(invoice?.source).toBe("checkout");
    expect(invoice?.planKey).toBe("enterprise");
    expect(invoice?.placeholderPrice).toBe(true);
  });

  it("payment.succeeded activates + re-materializes entitlements transactionally", async () => {
    const open = await withTenant(TENANT_BL, () => billingStore.listInvoices(10));
    const target = open.find((row) => row.status === "OPEN" && row.planKey === "enterprise");
    expect(target).toBeDefined();
    const outcome = await withTenant(TENANT_BL, () =>
      subscriptions.completeCheckout({ sessionRef: target!.providerRef! }),
    );
    expect(outcome.processed).toBe("payment.succeeded");
    expect(outcome.invoiceStatus).toBe("PAID");
    expect(outcome.subscriptionStatus).toBe("ACTIVE");

    const subscription = await withTenant(TENANT_BL, () => billingStore.currentSubscriptionRow());
    expect(subscription?.status).toBe("ACTIVE");
    expect(subscription?.trialEndsAt).toBeNull();
    // Entitlements re-materialized: source PLAN, NO expiry (paid posture).
    const state = await entitlementState(TENANT_BL);
    expect(state.get("crm.leads")?.source).toBe("PLAN"); // enterprise-only key
    expect(state.get("crm.leads")?.expiresAt).toBeNull();
    expect(state.get("accounting.projects")?.source).toBe("PLAN");
    expect(state.get("reporting.dashboards")?.source).toBe("PLAN");

    const planChanged = await eventsOf("plan.changed");
    expect(planChanged.length).toBe(1);
    const invoiceRow = await withTenant(TENANT_BL, () => billingStore.findInvoiceById(target!.id));
    expect(invoiceRow?.status).toBe("PAID");
    expect(invoiceRow?.paidVia).toBe("provider_webhook");
    expect(invoiceRow?.paidAt).not.toBeNull();
    const rows = await withTenant(TENANT_BL, () => inbox.listForUser(OWNER, { limit: 50 }));
    const activated = rows.find((row) => row.title.en === "Subscription activated");
    expect(activated?.severity).toBe("info");
    expect(activated?.category).toBe("subscription");
    const su = await superuserClient();
    const auditRows = await su.query(
      `SELECT count(*)::int AS n FROM audit_events WHERE tenant_id = $1 AND action = 'subscription.activated'`,
      [TENANT_BL],
    );
    expect(auditRows.rows[0]).toEqual({ n: 1 });
    await su.end();
  });

  it("payment failure advances dunning (PAST_DUE) with a warning notification", async () => {
    const subscription = await withTenant(TENANT_BL, () => billingStore.currentSubscriptionRow());
    const business = await withTenant(TENANT_BL, () => billingStore.findBillingPlanByKey("business"));
    const session = await withTenant(TENANT_BL, () =>
      subscriptions.createCheckoutSession(business!, subscription!, 1),
    );
    expect(session.invoiceNumber).toMatch(/^BI-\d{4}-\d{4}$/);
    const failed1 = await withTenant(TENANT_BL, () =>
      subscriptions.completeCheckout({ sessionRef: session.ref, outcome: "failed" }),
    );
    expect(failed1.processed).toBe("payment.failed");
    expect(failed1.subscriptionStatus).toBe("PAST_DUE");
    const after = await withTenant(TENANT_BL, () => billingStore.currentSubscriptionRow());
    expect(after?.dunningStep).toBe(1);
    expect((await eventsOf("dunning.warned")).length).toBe(1);
    const rows = await withTenant(TENANT_BL, () => inbox.listForUser(OWNER, { limit: 50 }));
    expect(
      rows.some((row) => row.title.en === "Payment collection failed" && row.severity === "warning"),
    ).toBe(true);
    // The session invoice is still OPEN (retryable).
    const invoice = await withTenant(TENANT_BL, () => billingStore.findInvoiceByProviderRef(session.ref));
    expect(invoice?.status).toBe("OPEN");
    return session.ref;
  });

  it("payment failure ×2 exhausts dunning → read-only grace (first-class state)", async () => {
    const open = await withTenant(TENANT_BL, () => billingStore.listInvoices(20));
    const target = open.find((row) => row.status === "OPEN" && row.source === "checkout");
    expect(target).toBeDefined();
    const failed2 = await withTenant(TENANT_BL, () =>
      subscriptions.completeCheckout({ sessionRef: target!.providerRef!, outcome: "failed" }),
    );
    expect(failed2.processed).toBe("payment.failed");
    expect(failed2.subscriptionStatus).toBe("GRACE_READ_ONLY");
    const subscription = await withTenant(TENANT_BL, () => billingStore.currentSubscriptionRow());
    expect(subscription?.status).toBe("GRACE_READ_ONLY");
    expect(subscription?.graceEndsAt).not.toBeNull();
    expect((await eventsOf("grace.entered")).length).toBe(1);
    // Entitlements survive the lapse for the grace window (re-materialized
    // with the grace expiry — the product stays usable read-only).
    const state = await entitlementState(TENANT_BL);
    expect(state.get("crm.leads")?.expiresAt).not.toBeNull();
    const rows = await withTenant(TENANT_BL, () => inbox.listForUser(OWNER, { limit: 50 }));
    expect(
      rows.some((row) => row.title.en === "Read-only grace period started" && row.severity === "critical"),
    ).toBe(true);
  });

  it("daily pass: grace expiry → suspension through the PHASE-004 semantics", async () => {
    const su = await superuserClient();
    await su.query(
      `UPDATE subscriptions SET grace_ends_at = now() - interval '1 hour'
       WHERE tenant_id = $1 AND status = 'GRACE_READ_ONLY'`,
      [TENANT_BL],
    );
    await su.end();
    const outcome = await subscriptions.runDailyPass({ runMode: "NIGHTLY", actorId: null });
    expect(outcome.suspensions).toBeGreaterThanOrEqual(1);
    const subscription = await withTenant(TENANT_BL, () => billingStore.currentSubscriptionRow());
    expect(subscription?.status).toBe("SUSPENDED");
    const su2 = await superuserClient();
    const tenantRow = await su2.query(`SELECT status FROM tenants WHERE id = $1`, [TENANT_BL]);
    expect(tenantRow.rows[0]).toEqual({ status: "SUSPENDED" });
    await su2.end();
    expect((await eventsOf("suspension.executed")).length).toBe(1);
  });

  it("manual payment while suspended (A-009) → restore re-enables everything", async () => {
    const open = await withTenant(TENANT_BL, () => billingStore.listInvoices(20));
    const target = open.find((row) => row.status === "OPEN" && row.source === "checkout");
    expect(target).toBeDefined();
    const paid = await withTenant(TENANT_BL, () =>
      subscriptions.recordManualPayment({
        invoiceId: target!.id,
        via: "bank_transfer",
        reference: "TRF-8899-1",
        reason: "offline bank transfer per customer request",
        staffActorId: OWNER,
      }),
    );
    expect(paid.invoiceNumber).toBe(target!.number);
    expect(paid.subscriptionStatus).toBe("ACTIVE");
    const invoiceRow = await withTenant(TENANT_BL, () => billingStore.findInvoiceById(target!.id));
    expect(invoiceRow?.status).toBe("PAID");
    expect(invoiceRow?.paidVia).toBe("manual_recorded");
    expect(invoiceRow?.paidReference).toBe("TRF-8899-1");
    expect(invoiceRow?.recordedBy).toBe(OWNER);
    const su = await superuserClient();
    const manual = await su.query(
      `SELECT via_platform_admin FROM billing_events WHERE tenant_id = $1 AND type = 'manual_payment.recorded'`,
      [TENANT_BL],
    );
    expect(manual.rows[0]).toEqual({ via_platform_admin: true });
    await su.end();
    // Restore went through the lifecycle service (tenant ACTIVE again).
    const su2 = await superuserClient();
    const tenantRow = await su2.query(`SELECT status FROM tenants WHERE id = $1`, [TENANT_BL]);
    expect(tenantRow.rows[0]).toEqual({ status: "ACTIVE" });
    await su2.end();
    expect((await eventsOf("subscription.restored")).length).toBe(1);
    // The invoice was for the BUSINESS plan — entitlements follow it.
    const state = await entitlementState(TENANT_BL);
    expect(state.get("reporting.dashboards")?.source).toBe("PLAN");
    expect(state.get("industry.addons")).toBeUndefined(); // enterprise-only key dropped (crm.leads joined business at 019 — 0027 plan grants)
  });

  it("trial expiry without payment → grace + entitlements with grace expiry", async () => {
    await withTenant(TENANT_BL2, async () => {
      await subscriptions.startTrial({ planKey: "business", trialDays: 14 });
      const before = await tenancyStore.listActiveEntitlements();
      expect(before.some((row) => row.source === "TRIAL")).toBe(true);
    });
    const su = await superuserClient();
    await su.query(
      `UPDATE subscriptions SET trial_ends_at = now() - interval '1 hour'
       WHERE tenant_id = $1 AND status = 'TRIAL'`,
      [TENANT_BL2],
    );
    await su.end();
    const outcome = await subscriptions.runDailyPass({ runMode: "NIGHTLY", actorId: null });
    expect(outcome.trialsExpired).toBeGreaterThanOrEqual(1);
    const subscription = await withTenant(TENANT_BL2, () => billingStore.currentSubscriptionRow());
    expect(subscription?.status).toBe("GRACE_READ_ONLY");
    expect(subscription?.graceEndsAt).not.toBeNull();
    const state = await entitlementState(TENANT_BL2);
    expect(state.get("accounting.multi_currency")?.expiresAt).not.toBeNull();
    const trialExpired = await withTenant(TENANT_BL2, async () => {
      const rows = await billingStore.listBillingEvents(50);
      return rows.filter((row) => row.type === "trial.expired");
    });
    expect(trialExpired.length).toBe(1);
  });

  it("downgrade blocked while usage exceeds the target plan (§8) with named blockers", async () => {
    // Two active branches on the business plan (its ceiling is 3).
    await withTenant(TENANT_BL, async () => {
      const { BranchService } = await import("../../modules/tenancy/application/branch-service");
      const branches = new BranchService(audit);
      await branches.create(OWNER, { code: "BL-B1", name: "BL Branch 1", nameAr: null, address: null });
      await branches.create(OWNER, { code: "BL-B2", name: "BL Branch 2", nameAr: null, address: null });
    });
    const before = await withTenant(TENANT_BL, () => billingStore.currentSubscriptionRow());
    const attempt = (await withTenant(TENANT_BL, () =>
      subscriptions.changePlan({ planKey: "starter" }).catch((error: unknown) => error),
    )) as { details?: { blockers?: unknown }; message?: string };
    expect(attempt.message).toContain("Downgrade blocked");
    expect(attempt.details?.blockers).toEqual([{ limit: "branches", usage: 2, limitValue: 1 }]);
    expect((await eventsOf("downgrade.blocked")).length).toBeGreaterThanOrEqual(1);
    const still = await withTenant(TENANT_BL, () => billingStore.currentSubscriptionRow());
    expect(still?.planId).toBe(before?.planId);
  });
});
