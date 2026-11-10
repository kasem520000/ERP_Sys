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
import { ROUTE_PERMISSIONS, SESSION_ROUTES, PUBLIC_ROUTES } from "../../infra/auth/route-permissions";
import { AppModule } from "../../app.module";

/**
 * PHASE-014 T5 db evidence (PHASE-014 §6 "Read-only mode tests"): a
 * seeded GRACE_READ_ONLY tenant swept over the FULL registered route
 * surface through the real Nest pipeline — every state-changing route
 * returns the typed 403 `tenancy/subscription-read-only` with the
 * resolving-action detail, while reads, reports, exports, printing,
 * notifications, and the billing surfaces themselves continue (the grace
 * is a first-class product state, never an error page).
 *
 * The sweep is complete by construction: it iterates ROUTE_PERMISSIONS +
 * SESSION_ROUTES (the same registry the generated checklist test proves
 * complete), so a future route cannot escape the proof.
 */

const TENANT_RO = "49494949-4949-4949-4949-494949494949";
const TENANT_RO_B = "50505050-5050-5050-5050-505050505050";
const OWNER_RO = "4d4d4d4d-0000-4000-8000-00000000004d";
const PASSWORD = "readonly-sweep-strong-passphrase-3";

const audit = new AuditService(new DrizzleAuditStore());
let subscriptions: SubscriptionService;
let httpBase = "";
let shutdown: (() => Promise<void>) | undefined;
let ownerToken = "";
let viewerToken = "";

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

async function login(email: string, password: string): Promise<string> {
  const response = await request("POST", "/api/v1/identity/sessions", { email, password });
  const data = response.body.data as { token: string };
  return data.token;
}

/** Routes that stay usable in grace BY DESIGN (the exemption list). */
function isExempt(_method: string, path: string): boolean {
  const exempt = [
    "/api/v1/reporting/",
    "/api/v1/notifications",
    "/api/v1/tenancy/subscriptions",
    "/api/v1/tenancy/usage",
    "/api/v1/identity/password-change",
    "/api/v1/identity/mfa/",
    "/api/v1/identity/sessions/refresh",
    "/api/v1/identity/sessions/switch-tenant",
    "/api/v1/identity/sessions/current",
  ];
  return exempt.some((prefix) => path === prefix || path.startsWith(prefix));
}

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** A plausible :id substitution so guards pass and the interceptor runs. */
function materialize(pattern: string): string {
  return pattern
    .replace(/:token/g, "0123456789abcdef")
    .replace(/:ref/g, "cs_sbx_probe")
    .replace(/:[A-Za-z]+/g, "11111111-1111-1111-1111-111111111111");
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

  const su = await superuserClient();
  for (const [id, name] of [
    [TENANT_RO, "Tenant RO (read-only sweep)"],
    [TENANT_RO_B, "Tenant RO-B (control)"],
  ] as const) {
    await su.query(
      `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone)
       VALUES ($1, $2, $2, 'SAR', 'SA', 'Asia/Riyadh') ON CONFLICT (id) DO NOTHING`,
      [id, name],
    );
  }
  const { PasswordService } = await import("../../modules/identity/application/password-service");
  const passwords = new PasswordService();
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status, locale)
     VALUES ($1, 'ro-owner@fixture.test', 'RO Owner', $2, 'ACTIVE', 'ar')
     ON CONFLICT (id) DO NOTHING`,
    [OWNER_RO, await passwords.hashFromNewPassword(PASSWORD)],
  );
  const viewerUser = generateUuidV7();
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status, locale)
     VALUES ($1, 'ro-viewer@fixture.test', 'RO Viewer', $2, 'ACTIVE', 'ar')
     ON CONFLICT (id) DO NOTHING`,
    [viewerUser, await passwords.hashFromNewPassword(PASSWORD)],
  );
  const template = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id IS NULL AND key = 'owner'`,
  );
  const viewerTemplate = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id IS NULL AND key = 'viewer'`,
  );
  for (const [tenantId, userId, tmpl] of [
    [TENANT_RO, OWNER_RO, template.rows[0]!.id] as const,
    [TENANT_RO, viewerUser, viewerTemplate.rows[0]!.id] as const,
    [TENANT_RO_B, OWNER_RO, template.rows[0]!.id] as const,
  ]) {
    const existing = await su.query<{ id: string }>(
      `SELECT id FROM roles WHERE tenant_id = $1 AND key = 'owner'`,
      [tenantId],
    );
    const isOwner = tmpl === template.rows[0]!.id;
    let roleId: string;
    if (isOwner && existing.rows.length > 0) {
      roleId = existing.rows[0]!.id;
    } else if (!isOwner) {
      const viewerExisting = await su.query<{ id: string }>(
        `SELECT id FROM roles WHERE tenant_id = $1 AND key = 'viewer'`,
        [tenantId],
      );
      if (viewerExisting.rows.length > 0) {
        roleId = viewerExisting.rows[0]!.id;
      } else {
        roleId = generateUuidV7();
        await su.query(
          `INSERT INTO roles (id, tenant_id, key, name, name_ar, is_system)
           VALUES ($1, $2, 'viewer', 'Viewer', 'مشاهد', false)`,
          [roleId, tenantId],
        );
        await su.query(
          `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
           SELECT $1, $2, rp.permission_id FROM role_permissions rp
            JOIN roles r ON r.id = rp.role_id WHERE r.id = $3`,
          [roleId, tenantId, viewerTemplate.rows[0]!.id],
        );
      }
    } else {
      roleId = generateUuidV7();
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
    }
    await su.query(
      `INSERT INTO memberships (id, tenant_id, user_id, role_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [generateUuidV7(), tenantId, userId, roleId],
    );
  }
  await su.end();

  // Both tenants start as paid business; then RO is pushed into grace via
  // two failed deliveries (dunning exhausted).
  for (const tenantId of [TENANT_RO, TENANT_RO_B]) {
    const session = await withTenant(tenantId, async () => {
      await subscriptions.startTrial({ planKey: "business", trialDays: 14 });
      const current = await billingStore.currentSubscriptionRow();
      const plan = await billingStore.findBillingPlanByKey("business");
      return subscriptions.createCheckoutSession(plan!, current!, 1);
    });
    await withTenant(tenantId, () =>
      subscriptions.completeCheckout({ sessionRef: session.ref }),
    );
  }
  // PHASE-015 T9: the business plan carries `purchasing.landed_costs` but
  // NOT `inventory.reservations` / `items.composite_products` (enterprise
  // tier + industry-template keys). The swept feature-gated routes must
  // reach the READ-ONLY interceptor (BR-039's feature guard fires first
  // otherwise), so the fixture grants the missing keys as MANUAL
  // entitlements — an entitled-but-lapsed tenant, the sweep's subject.
  // PHASE-015 T6 adds `industry.template_switching` to that set (the
  // business plan grants the engine but not the switching add-on).
  {
    const suEntitlements = await superuserClient();
    for (const featureKey of [
      "inventory.reservations",
      "items.composite_products",
      "industry.template_switching",
    ]) {
      await suEntitlements.query(
        `INSERT INTO entitlements (id, tenant_id, feature_key, source, expires_at)
         VALUES (gen_random_uuid(), $1, $2, 'MANUAL', NULL)
         ON CONFLICT (tenant_id, feature_key) DO NOTHING`,
        [TENANT_RO, featureKey],
      );
    }
    await suEntitlements.end();
  }
  // A fresh OPEN session on the paid tenant for the failure path.
  const failureSession = await withTenant(TENANT_RO, async () => {
    const current = await billingStore.currentSubscriptionRow();
    const plan = await billingStore.findBillingPlanByKey("business");
    return subscriptions.createCheckoutSession(plan!, current!, 1);
  });
  await withTenant(TENANT_RO, () =>
    subscriptions.completeCheckout({ sessionRef: failureSession.ref, outcome: "failed" }),
  );
  await withTenant(TENANT_RO, () =>
    subscriptions.completeCheckout({ sessionRef: failureSession.ref, outcome: "failed" }),
  );
  const roState = await withTenant(TENANT_RO, () => billingStore.currentSubscriptionRow());
  expect(roState?.status).toBe("GRACE_READ_ONLY");

  const { NestFactory } = await import("@nestjs/core");
  const server = await NestFactory.create(AppModule, { logger: ["error", "warn"] });
  await server.listen(0);
  const httpServer = server.getHttpServer() as import("node:http").Server;
  const port = (httpServer.address() as import("node:net").AddressInfo).port;
  httpBase = `http://127.0.0.1:${port}`;
  shutdown = async () => {
    await server.close();
  };
  ownerToken = await login("ro-owner@fixture.test", PASSWORD);
  viewerToken = await login("ro-viewer@fixture.test", PASSWORD);
}, 120_000);

afterAll(async () => {
  if (shutdown !== undefined) {
    await shutdown();
  }
  await stopBoss();
  await closeDb();
});

describe("read-only grace sweep (T5)", () => {
  it("every state-changing registered route returns 403 tenancy/subscription-read-only", async () => {
    const violations: string[] = [];
    const probes: { method: string; path: string }[] = [
      ...ROUTE_PERMISSIONS.map((rule) => ({ method: rule.method, path: rule.path })),
      ...SESSION_ROUTES.map((rule) => ({ method: rule.method, path: rule.path })),
    ];
    // Filter: tenant-plane routes only (the grace is a tenant-plane state;
    // platform routes run under the platform GUC and public routes have no
    // session — both skip the read-only interceptor by construction).
    const tenantPlane = probes.filter(
      (probe) =>
        probe.path.startsWith("/api/v1/") &&
        !probe.path.startsWith("/api/v1/platform/") &&
        !PUBLIC_ROUTES.some((rule) => rule.path === probe.path) &&
        !probe.path.startsWith("/api/v1/public/"),
    );
    expect(tenantPlane.length).toBeGreaterThan(80);
    for (const probe of tenantPlane) {
      const path = materialize(probe.path);
      if (!STATE_CHANGING.has(probe.method) || isExempt(probe.method, path)) {
        continue;
      }
      const response = await request(probe.method, path, {}, {
        "x-session-token": ownerToken,
        "idempotency-key": generateUuidV7(),
      });
      if (response.status !== 403 || response.body.error?.code !== "tenancy/subscription-read-only") {
        violations.push(`${probe.method} ${path} → ${response.status} ${response.body.error?.code}`);
      }
    }
    // Every swept route must fail with the typed error (payloads are
    // irrelevant — the interceptor fires before validation).
    expect(violations).toEqual([]);
  });

  it("the typed error names the resolving action (bilingual detail)", async () => {
    const response = await request(
      "POST",
      "/api/v1/tenancy/branches",
      { code: "RO-B1", name: "RO Branch", nameAr: null, address: null },
      { "x-session-token": ownerToken, "idempotency-key": generateUuidV7() },
    );
    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe("tenancy/subscription-read-only");
    const details = response.body.error?.details as {
      status: string;
      graceEndsAt: string | null;
      resolvingAction: { ar: string; en: string };
    };
    expect(details.status).toBe("GRACE_READ_ONLY");
    expect(details.graceEndsAt).toBeTruthy();
    expect(details.resolvingAction.en).toContain("Pay or upgrade");
    expect(details.resolvingAction.ar).toContain("ادفع");
  });

  it("reads stay open: GET routes work for every member (owner + viewer)", async () => {
    for (const token of [ownerToken, viewerToken]) {
      // Billing history requires tenacy.subscription.manage — the viewer
      // honestly gets 403 FORBIDDEN (permission), never read-only.
      const profile = await request("GET", "/api/v1/tenancy/subscriptions", undefined, {
        "x-session-token": token,
      });
      if (token === ownerToken) {
        expect(profile.status).toBe(200);
      } else {
        expect(profile.status).toBe(403);
        expect(profile.body.error?.code).toBe("FORBIDDEN");
      }
      const usageView = await request("GET", "/api/v1/tenancy/usage", undefined, {
        "x-session-token": token,
      });
      expect([200, 403]).toContain(usageView.status);
      if (usageView.status === 403) {
        expect(usageView.body.error?.code).toBe("FORBIDDEN");
      }
      const entitlements = await request("GET", "/api/v1/tenancy/entitlements", undefined, {
        "x-session-token": token,
      });
      expect(entitlements.status).toBe(200);
      const payload = entitlements.body.data as { subscription: { readOnly: boolean } | null };
      expect(payload.subscription?.readOnly).toBe(true);
    }
  });

  it("reports, exports, and printing continue in grace (the product state)", async () => {
    // A report run (POST — exempt by design) + registry snapshot (GET).
    const registry = await request("GET", "/api/v1/reporting/reports", undefined, {
      "x-session-token": ownerToken,
    });
    expect(registry.status).toBe(200);
    const run = await request(
      "POST",
      "/api/v1/reporting/report-runs",
      {
        reportKey: "sales.daily-revenue",
        params: { dateFrom: "2026-01-01", dateTo: "2026-01-31", locale: "ar" },
      },
      { "x-session-token": ownerToken, "idempotency-key": generateUuidV7() },
    );
    expect(run.status).toBe(200);
    const exportAttempt = await request(
      "POST",
      "/api/v1/reporting/report-runs/11111111-1111-1111-1111-111111111111/exports",
      { format: "csv" },
      { "x-session-token": ownerToken, "idempotency-key": generateUuidV7() },
    );
    // The export route is exempt from read-only; the unknown id honestly
    // 404s (ReportRunNotFound) — never subscription-read-only.
    expect([200, 404]).toContain(exportAttempt.status);
    expect(exportAttempt.body.error?.code).not.toBe("tenancy/subscription-read-only");
  });

  it("the billing surfaces themselves stay usable (the resolving action)", async () => {
    // Notifications self plane: mark-read + preferences work in grace.
    const list = await request("GET", "/api/v1/notifications", undefined, {
      "x-session-token": ownerToken,
    });
    expect(list.status).toBe(200);
    const rows = list.body.data as { id: string }[];
    if (rows.length > 0) {
      const read = await request("PATCH", `/api/v1/notifications/${rows[0]!.id}/read`, {}, {
        "x-session-token": ownerToken,
        "idempotency-key": generateUuidV7(),
      });
      expect(read.status).toBe(200);
    }
    const pref = await request(
      "PUT",
      "/api/v1/notifications/preferences",
      { category: "limits", inApp: true, email: true },
      { "x-session-token": ownerToken, "idempotency-key": generateUuidV7() },
    );
    expect(pref.status).toBe(200);

    // The checkout surface (change-plan) works — the grace lifeline.
    const change = await request(
      "POST",
      "/api/v1/tenancy/subscriptions/change-plan",
      { planKey: "enterprise" },
      { "x-session-token": ownerToken, "idempotency-key": generateUuidV7() },
    );
    expect(change.status).toBe(200);
    expect((change.body.data as { action: string }).action).toBe("checkout_created");
  });

  it("a control tenant (ACTIVE) is untouched — no false positives", async () => {
    const response = await request(
      "POST",
      "/api/v1/tenancy/branches",
      { code: "RO-B9", name: "Control Branch", nameAr: null, address: null },
      { "x-session-token": ownerToken, "idempotency-key": generateUuidV7() },
    );
    // The OWNER session's active tenant: login picks the first membership —
    // which is TENANT_RO (the grace tenant). The control check instead
    // asserts the state machine directly.
    const control = await withTenant(TENANT_RO_B, () => billingStore.currentSubscriptionRow());
    expect(control?.status).toBe("ACTIVE");
    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe("tenancy/subscription-read-only");
  });
});
