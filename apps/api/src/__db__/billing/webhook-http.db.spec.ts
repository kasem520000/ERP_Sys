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
import { SandboxProviderAdapter } from "../../modules/tenancy/application/billing/provider-adapter";
import { signWebhook, webhookSecret } from "../../modules/tenancy/application/billing/provider-adapter";
import * as billingStore from "../../modules/tenancy/infrastructure/billing.store";
import * as tenancyStore from "../../modules/tenancy/infrastructure/tenancy.store";
import { AppModule } from "../../app.module";

/**
 * PHASE-014 T2/T3 db evidence (PHASE-014 §6 "Checkout/billing tests"): the
 * webhook pipeline over the REAL HTTP route (POST
 * /api/v1/platform/billing/webhook — anonymous, signature-verified),
 * duplicate-delivery idempotency (INV-013 discipline), forged/stale
 * rejection, and the A-009 parity proof: a webhook-paid tenant and a
 * manually-paid tenant end with IDENTICAL entitlement sets and identical
 * billing-history shapes — only `paid_via` differs.
 */

const TENANT_W = "46464646-4646-4646-4646-464646464646"; // webhook-paid
const TENANT_M = "47474747-4747-4747-4747-474747474747"; // manually-paid
const OWNER_W = "4b4b4b4b-0000-4000-8000-00000000004b";

const audit = new AuditService(new DrizzleAuditStore());
let subscriptions: SubscriptionService;
let httpBase = "";
let shutdown: (() => Promise<void>) | undefined;

interface ApiResponse {
  status: number;
  body: { data?: unknown; error?: { code: string; details?: unknown } };
}

async function request(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResponse> {
  const hasBody = body !== undefined && method !== "GET" && method !== "HEAD";
  const response = await fetch(`${httpBase}${path}`, {
    method,
    headers: {
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: hasBody ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text === "" ? {} : (JSON.parse(text) as ApiResponse["body"]),
  };
}

async function ensureTenant(tenantId: string, name: string): Promise<void> {
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone)
     VALUES ($1, $2, $2, 'SAR', 'SA', 'Asia/Riyadh') ON CONFLICT (id) DO NOTHING`,
    [tenantId, name],
  );
  const existing = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id = $1 AND key = 'owner'`,
    [tenantId],
  );
  if (existing.rows.length === 0) {
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
      [generateUuidV7(), tenantId, OWNER_W, roleId],
    );
  }
  await su.end();
}

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

  // The shared owner user first (the memberships FK requires it).
  const suUsers = await superuserClient();
  await suUsers.query(
    `INSERT INTO users (id, email, full_name, password_hash, status, locale)
     VALUES ($1, 'webhook-owner@fixture.test', 'Webhook Owner', 'x', 'ACTIVE', 'ar')
     ON CONFLICT (id) DO NOTHING`,
    [OWNER_W],
  );
  await suUsers.end();
  await ensureTenant(TENANT_W, "Tenant W (webhook-paid)");
  await ensureTenant(TENANT_M, "Tenant M (manually-paid)");
  // Both tenants start as BUSINESS trials (the parity baseline).
  await withTenant(TENANT_W, () => subscriptions.startTrial({ planKey: "business", trialDays: 14 }));
  await withTenant(TENANT_M, () => subscriptions.startTrial({ planKey: "business", trialDays: 14 }));

  const { NestFactory } = await import("@nestjs/core");
  const server = await NestFactory.create(AppModule, { logger: ["error", "warn"] });
  await server.listen(0);
  const httpServer = server.getHttpServer() as import("node:http").Server;
  const port = (httpServer.address() as import("node:net").AddressInfo).port;
  httpBase = `http://127.0.0.1:${port}`;
  shutdown = async () => {
    await server.close();
  };
}, 120_000);

afterAll(async () => {
  if (shutdown !== undefined) {
    await shutdown();
  }
  await stopBoss();
  await closeDb();
});

/** Create an OPEN enterprise checkout on a tenant and return its session. */
async function openEnterpriseCheckout(tenantId: string): Promise<{ ref: string; invoiceId: string }> {
  return withTenant(tenantId, async () => {
    const current = await billingStore.currentSubscriptionRow();
    const plan = await billingStore.findBillingPlanByKey("enterprise");
    const session = await subscriptions.createCheckoutSession(plan!, current!, 1);
    const invoice = await billingStore.findInvoiceByProviderRef(session.ref);
    return { ref: session.ref, invoiceId: invoice!.id };
  });
}

describe("webhook pipeline over the real HTTP route (T2)", () => {
  it("rejects a forged signature with 400 billing/webhook-signature-invalid", async () => {
    const session = await openEnterpriseCheckout(TENANT_W);
    const provider = new SandboxProviderAdapter({ webBaseUrl: "http://localhost:3000" });
    const settled = provider.settleCheckout({
      sessionRef: session.ref,
      outcome: "succeeded",
      tenantId: TENANT_W,
      invoiceNumber: "PROBE",
      amount: "0.0000",
      currency: "SAR",
    });
    // A CURRENT timestamp with a wrong HMAC: passes the replay window,
    // fails the constant-time compare → signature-invalid (not replay).
    const nowSig = `t=${(Date.now() / 1000) | 0},v1=${"0".repeat(64)}`;
    const response = await request("POST", "/api/v1/platform/billing/webhook", JSON.parse(settled.rawBody), {
      "billing-signature": nowSig,
    });
    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe("billing/webhook-signature-invalid");
  });

  it("rejects a stale timestamp with 400 billing/webhook-replay", async () => {
    const session = await openEnterpriseCheckout(TENANT_W);
    const provider = new SandboxProviderAdapter({ webBaseUrl: "http://localhost:3000" });
    const settled = provider.settleCheckout({
      sessionRef: session.ref,
      outcome: "succeeded",
      tenantId: TENANT_W,
      invoiceNumber: "PROBE",
      amount: "0.0000",
      currency: "SAR",
    });
    const staleAt = (Date.now() / 1000 - 3600) | 0;
    const body = JSON.parse(settled.rawBody) as { created_unix: number };
    body.created_unix = staleAt;
    const raw = JSON.stringify(body);
    const signature = signWebhook(raw, staleAt, webhookSecret());
    const response = await request("POST", "/api/v1/platform/billing/webhook", body, {
      "billing-signature": signature,
    });
    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe("billing/webhook-replay");
  });

  it("processes a valid delivery: invoice PAID + subscription ACTIVE (payment.succeeded)", async () => {
    const session = await openEnterpriseCheckout(TENANT_W);
    const provider = new SandboxProviderAdapter({ webBaseUrl: "http://localhost:3000" });
    const settled = provider.settleCheckout({
      sessionRef: session.ref,
      outcome: "succeeded",
      tenantId: TENANT_W,
      invoiceNumber: "REAL",
      amount: "0.0000",
      currency: "SAR",
    });
    const response = await request(
      "POST",
      "/api/v1/platform/billing/webhook",
      JSON.parse(settled.rawBody),
      { "billing-signature": settled.signature },
    );
    expect(response.status).toBe(200);
    expect((response.body.data as { processed: string }).processed).toBe("payment.succeeded");
    const invoice = await withTenant(TENANT_W, () => billingStore.findInvoiceById(session.invoiceId));
    expect(invoice?.status).toBe("PAID");
    expect(invoice?.paidVia).toBe("provider_webhook");
    const subscription = await withTenant(TENANT_W, () => billingStore.currentSubscriptionRow());
    expect(subscription?.status).toBe("ACTIVE");
  });

  it("a duplicate delivery of the SAME event is an idempotent no-op (INV-013)", async () => {
    const before = await withTenant(TENANT_W, () => billingStore.listInvoices(50));
    const paidCount = before.filter((row) => row.status === "PAID").length;
    const eventsBefore = await withTenant(TENANT_W, () => billingStore.listBillingEvents(200));

    // Rebuild the LAST settled event deterministically: replay the exact
    // bytes the previous test sent (same session + succeeded) — a provider
    // redelivery of the same event id.
    // Use the stored billing event's id (webhook:{id}) to rebuild the same
    // payload shape: grab the last payment.succeeded webhook event row.
    const lastWebhook = eventsBefore
      .filter((row) => row.idempotencyKey?.startsWith("webhook:"))
      .at(-1);
    expect(lastWebhook).toBeDefined();
    const payload = lastWebhook!.payload as {
      session_ref: string;
      tenant_id: string;
      invoice_number: string;
      amount: string;
      currency: string;
    };
    const eventId = lastWebhook!.idempotencyKey!.slice("webhook:".length);
    const at = (Date.now() / 1000) | 0;
    const event = {
      id: eventId,
      type: "payment.succeeded" as const,
      created_unix: at,
      data: {
        session_ref: payload.session_ref,
        tenant_id: payload.tenant_id,
        invoice_number: payload.invoice_number,
        amount: payload.amount,
        currency: payload.currency,
      },
    };
    const raw = JSON.stringify(event);
    const signature = signWebhook(raw, at, webhookSecret());
    const duplicate = await request("POST", "/api/v1/platform/billing/webhook", event, {
      "billing-signature": signature,
    });
    expect(duplicate.status).toBe(200);
    expect((duplicate.body.data as { processed: string }).processed).toBe("duplicate");

    // No double activation: exactly the same paid count + one billing event
    // per logical delivery (the dedupe key refused the second insert).
    const after = await withTenant(TENANT_W, () => billingStore.listInvoices(50));
    expect(after.filter((row) => row.status === "PAID").length).toBe(paidCount);
    const eventsAfter = await withTenant(TENANT_W, () => billingStore.listBillingEvents(200));
    expect(eventsAfter.length).toBe(eventsBefore.length);
  });

  it("an unknown session ref is 404 billing/checkout-session-not-found", async () => {
    const at = (Date.now() / 1000) | 0;
    const event = {
      id: `evt_${generateUuidV7().replace(/-/g, "").slice(0, 24)}`,
      type: "payment.succeeded" as const,
      created_unix: at,
      data: {
        session_ref: "cs_sbx_unknown_ref",
        tenant_id: TENANT_W,
        invoice_number: "BI-0000",
        amount: "0.0000",
        currency: "SAR",
      },
    };
    const signature = signWebhook(JSON.stringify(event), at, webhookSecret());
    const response = await request("POST", "/api/v1/platform/billing/webhook", event, {
      "billing-signature": signature,
    });
    expect(response.status).toBe(404);
    expect(response.body.error?.code).toBe("billing/checkout-session-not-found");
  });
});

describe("A-009 parity: webhook path vs manual path (T3)", () => {
  it("both paths produce IDENTICAL entitlement sets and billing-history shapes", async () => {
    // The webhook tenant is already paid (enterprise via webhook). The
    // manual tenant: open an enterprise checkout, then record a manual
    // payment as platform staff.
    const manualSession = await openEnterpriseCheckout(TENANT_M);
    const paid = await withTenant(TENANT_M, () =>
      subscriptions.recordManualPayment({
        invoiceId: manualSession.invoiceId,
        via: "bank_transfer",
        reference: "TRF-M-777",
        reason: "monthly transfer per contract",
        staffActorId: OWNER_W,
      }),
    );
    expect(paid.subscriptionStatus).toBe("ACTIVE");

    // Entitlement sets: identical keys, identical sources, no expiry.
    const entW = await withTenant(TENANT_W, async () => {
      const rows = await tenancyStore.listActiveEntitlements();
      return new Map(rows.map((row) => [row.featureKey, `${row.source}:${row.expiresAt ?? "-"}`]));
    });
    const entM = await withTenant(TENANT_M, async () => {
      const rows = await tenancyStore.listActiveEntitlements();
      return new Map(rows.map((row) => [row.featureKey, `${row.source}:${row.expiresAt ?? "-"}`]));
    });
    expect(entM.size).toBe(entW.size);
    for (const [key, value] of entW) {
      expect(entM.get(key)).toBe(value);
    }

    // Billing history: both PAID with the same plan/period/amount shape;
    // only paid_via differs (provider_webhook vs manual_recorded).
    const invoiceW = (await withTenant(TENANT_W, () => billingStore.listInvoices(10))).find(
      (row) => row.status === "PAID",
    );
    const invoiceM = (await withTenant(TENANT_M, () => billingStore.listInvoices(10))).find(
      (row) => row.status === "PAID",
    );
    expect(invoiceM?.planKey).toBe(invoiceW?.planKey);
    expect(invoiceM?.amount).toBe(invoiceW?.amount);
    expect(invoiceM?.currencyCode).toBe(invoiceW?.currencyCode);
    expect(invoiceM?.paidVia).toBe("manual_recorded");
    expect(invoiceW?.paidVia).toBe("provider_webhook");
    expect(invoiceM?.paidReference).toBe("TRF-M-777");
    expect(invoiceM?.recordedBy).toBe(OWNER_W);

    // Subscriptions: identical status + period shape.
    const subW = await withTenant(TENANT_W, () => billingStore.currentSubscriptionRow());
    const subM = await withTenant(TENANT_M, () => billingStore.currentSubscriptionRow());
    expect(subM?.status).toBe(subW?.status);
    expect(subM?.status).toBe("ACTIVE");
    expect(subM?.periodStart).toBe(subW?.periodStart);
    expect(subM?.trialEndsAt).toBeNull();
    expect(subW?.trialEndsAt).toBeNull();
  });

  it("manual payment requires reason + reference (422) and rejects non-OPEN invoices", async () => {
    const fresh = await openEnterpriseCheckout(TENANT_M);
    const tooShort = await withTenant(TENANT_M, () =>
      subscriptions
        .recordManualPayment({
          invoiceId: fresh.invoiceId,
          via: "cash",
          reference: "X",
          reason: "X",
          staffActorId: OWNER_W,
        })
        .catch((error: unknown) => error),
    );
    expect((tooShort as { message?: string }).message).toContain("requires a reason");

    // Non-OPEN: the already-paid invoice from the parity test.
    const paidInvoice = (await withTenant(TENANT_M, () => billingStore.listInvoices(10))).find(
      (row) => row.status === "PAID",
    )!;
    const notOpen = await withTenant(TENANT_M, () =>
      subscriptions
        .recordManualPayment({
          invoiceId: paidInvoice.id,
          via: "cash",
          reference: "REF-OK",
          reason: "valid reason",
          staffActorId: OWNER_W,
        })
        .catch((error: unknown) => error),
    );
    expect((notOpen as { message?: string }).message).toContain("not OPEN");
  });
});
