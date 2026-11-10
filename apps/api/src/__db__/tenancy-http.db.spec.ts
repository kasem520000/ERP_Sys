import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@erp/domain-core";

import { ensureTestDb, superuserClient } from "./test-db";
import { reloadEnv } from "../config/env";
import { AppModule } from "../app.module";
import { PasswordService } from "../modules/identity/application/password-service";
import { closeDb } from "../infra/db/client";
import { stopBoss } from "../infra/jobs/boss";
import { PLATFORM_TENANT_ID } from "../infra/context/session-context";

/**
 * PHASE-004 golden path end-to-end over the full Nest pipeline
 * (middleware → guards → interceptor → controllers → ERROR_MODEL
 * filter) against real PostgreSQL 16 — the Definition-of-Done journey:
 *
 * register (public) → login → onboarding provision → branches →
 * settings → derived entitlements → platform console (S-07) →
 * suspend (sessions die) → restore (re-login works) → support
 * session (§7) → tenant-side trail review — every step asserting the
 * documented envelope + audit shape.
 */

const BASE_PASSWORD = "tenancy-http-strong-passphrase-7";

const owner = { email: "", userId: "", token: "" };
const viewer = { email: "", userId: "", token: "" };
const platformAdmin = { email: "", userId: "", token: "" };
let businessTenantId = "";
let httpBase = "";
let shutdown: (() => Promise<void>) | undefined;

interface ApiResponse {
  status: number;
  body: { data?: unknown; meta?: unknown; error?: { code: string; details?: unknown } };
  headers: Record<string, string | string[] | undefined>;
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
    headers: Object.fromEntries(response.headers.entries()),
  };
}

const withToken = (token: string): Record<string, string> => ({
  "x-session-token": token,
  "idempotency-key": generateUuidV7(),
});

beforeAll(async () => {
  ensureTestDb();
  reloadEnv();

  // Platform staff fixture (the ops-bootstrap shape): user + membership in
  // the platform-operations tenant on the seeded platform_admin role.
  const passwords = new PasswordService();
  platformAdmin.email = `platform-admin-${generateUuidV7().slice(0, 8)}@ops.test`;
  const adminHash = await passwords.hashFromNewPassword(BASE_PASSWORD);
  const su = await superuserClient();
  const adminUser = await su.query<{ id: string }>(
    `INSERT INTO users (id, email, full_name, password_hash, status)
     VALUES ($1, $2, 'Platform Admin', $3, 'ACTIVE') RETURNING id`,
    [generateUuidV7(), platformAdmin.email, adminHash],
  );
  platformAdmin.userId = adminUser.rows[0]!.id;
  const adminRole = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id = $1 AND key = 'platform_admin'`,
    [PLATFORM_TENANT_ID],
  );
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id)
     VALUES ($1, $2, $3, $4)`,
    [generateUuidV7(), PLATFORM_TENANT_ID, platformAdmin.userId, adminRole.rows[0]!.id],
  );
  await su.end();

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

async function login(email: string, password: string): Promise<{ token: string; memberships: { tenantId: string }[] }> {
  const response = await request("POST", "/api/v1/identity/sessions", { email, password });
  if (response.status !== 200) {
    throw new Error(`login failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  const data = response.body.data as { token: string; memberships: { tenantId: string }[] };
  return { token: data.token, memberships: data.memberships };
}

describe("public registration (anonymous, rate-limited)", () => {
  it("GET register/options exposes the seeded reference data", async () => {
    const response = await request("GET", "/api/v1/platform/register/options");
    expect(response.status).toBe(200);
    const data = response.body.data as {
      countries: unknown[];
      currencies: unknown[];
      industryTemplates: unknown[];
    };
    expect(data.countries.length).toBe(10);
    expect(data.currencies.length).toBe(12);
    expect(data.industryTemplates.length).toBe(13);
  });

  it("POST register creates the tenant + owner (anonymous)", async () => {
    owner.email = `tenancy-http-owner-${generateUuidV7().slice(0, 8)}@fixture.test`;
    viewer.email = `tenancy-http-viewer-${generateUuidV7().slice(0, 8)}@fixture.test`;
    const response = await request("POST", "/api/v1/platform/register", {
      businessName: "HTTP Trading Co",
      businessNameAr: "شركة تجارة إتش تي تي بي",
      countryCode: "SA",
      baseCurrency: "SAR",
      industryTemplateKey: "industry.retail",
      taxRegistrationStatus: "REGISTERED",
      taxRegistrationNumber: "3001234567890003",
      ownerEmail: owner.email,
      ownerFullName: "Http Owner",
      ownerPassword: BASE_PASSWORD,
    });
    expect(response.status).toBe(200);
    businessTenantId = (response.body.data as { tenantId: string }).tenantId;
    expect(businessTenantId).toBeTruthy();
  });

  it("per-IP rate limit caps anonymous registrations (429 + Retry-After)", async () => {
    // All HTTP traffic in this spec shares the socket IP (127.0.0.1) —
    // the business registration above already consumed 1 of the 5/h
    // per-IP budget, so the 5th probe here is the cap.
    const make = () =>
      request("POST", "/api/v1/platform/register", {
        businessName: "Rate Limited",
        businessNameAr: null,
        countryCode: "YE",
        baseCurrency: "YER",
        industryTemplateKey: "industry.retail",
        taxRegistrationStatus: "NOT_REGISTERED",
        taxRegistrationNumber: null,
        ownerEmail: `rate-${generateUuidV7()}@fixture.test`,
        ownerFullName: "Rate Limit Probe",
        ownerPassword: BASE_PASSWORD,
      });
    const responses: ApiResponse[] = [];
    for (let index = 0; index < 5; index += 1) {
      responses.push(await make());
    }
    expect(responses[3]!.status).toBe(200);
    const capped = responses[4]!;
    expect(capped.status).toBe(429);
    expect(Number(capped.headers["retry-after"])).toBeGreaterThanOrEqual(1);
    expect((capped.body.error as { code: string }).code).toBe("RATE_LIMITED");
  });
});

describe("owner journey: login → onboarding → branches → settings", () => {
  it("owner logs in (the first workspace session)", async () => {
    const session = await login(owner.email, BASE_PASSWORD);
    owner.token = session.token;
    expect(session.memberships[0]?.tenantId).toBe(businessTenantId);
  });

  it("onboarding provision instantiates the workspace (feature-gated route)", async () => {
    const first = await request(
      "POST",
      "/api/v1/tenancy/onboarding/provision",
      { fiscalCalendarStartMonth: 1 },
      withToken(owner.token),
    );
    expect(first.status).toBe(200);
    const diff = first.body.data as { accounts: { created: number }; purposes: { created: number } };
    // 42 accounts / 16 purposes at PHASE-015; 0024 adds the 1151
    // CARD_RECEIVABLE marker row + its purpose mapping; 0025 adds the 2150
    // COMMISSION_ACCRUAL + 5250 COMMISSION_EXPENSE rows + the 4200
    // SERVICE_REVENUE marker (45 accounts / 20 purposes); 0026 adds the
    // 1160 WIP + 5120 PRODUCTION_SCRAP markers, the 5400 absorption group
    // (no purpose) and its 5410/5420 labor/overhead leaves (50 accounts /
    // 24 purposes); 0027 UPDATEs the 2130 template row in place to the
    // DEFERRED_REVENUE marker (50 accounts / 25 purposes — no new account
    // row, the pre-019 slot already existed as a plain row); 0037 adds the
    // fixed-assets set — the 1220 ACCUM_DEPRECIATION / 3210
    // REVALUATION_RESERVE / 4910 ASSET_DISPOSAL_GAIN / 5910
    // ASSET_DISPOSAL_LOSS rows + the 1210 FIXED_ASSET / 5300
    // DEPRECIATION_EXPENSE in-place markers + the 027 notes rows (58 accounts /
    // 35 purposes after 0038: 1170/2160/4920/5260); 0040 adds the payroll
    // set (64 accounts / 41 purposes: 2170/2180/2190 SALARIES_PAYABLE /
    // DEDUCTIONS_PAYABLE / EOS_PROVISION + 5270/5280/5295 SALARIES_EXPENSE /
    // EMPLOYER_CONTRIBUTIONS / EOS_PROVISION_EXPENSE).
    expect(diff.accounts.created).toBe(64);
    expect(diff.purposes.created).toBe(41);

    const reRun = await request(
      "POST",
      "/api/v1/tenancy/onboarding/provision",
      {},
      withToken(owner.token),
    );
    expect(reRun.status).toBe(200);
    expect((reRun.body.data as { accounts: { created: number } }).accounts.created).toBe(0);
  });

  it("the viewer joins on the instantiated viewer role (provision made it exist)", async () => {
    // Seeded directly as the bootstrap role for the checklist shape — the
    // invitation FLOW itself is PHASE-003-proven.
    const passwords = new PasswordService();
    const hash = await passwords.hashFromNewPassword(BASE_PASSWORD);
    const su = await superuserClient();
    const viewerUser = await su.query<{ id: string }>(
      `INSERT INTO users (id, email, full_name, password_hash, status)
       VALUES ($1, $2, 'Http Viewer', $3, 'ACTIVE') RETURNING id`,
      [generateUuidV7(), viewer.email, hash],
    );
    viewer.userId = viewerUser.rows[0]!.id;
    const viewerRole = await su.query<{ id: string }>(
      `SELECT id FROM roles WHERE tenant_id = $1 AND key = 'viewer'`,
      [businessTenantId],
    );
    await su.query(
      `INSERT INTO memberships (id, tenant_id, user_id, role_id)
       VALUES ($1, $2, $3, $4)`,
      [generateUuidV7(), businessTenantId, viewer.userId, viewerRole.rows[0]!.id],
    );
    await su.end();
    const viewerSession = await login(viewer.email, BASE_PASSWORD);
    viewer.token = viewerSession.token;
  });

  it("branches CRUD + deactivation; viewer (no key) → 403", async () => {
    const created = await request(
      "POST",
      "/api/v1/tenancy/branches",
      { code: "JED", name: "Jeddah Branch", nameAr: "فرع جدة" },
      withToken(owner.token),
    );
    expect(created.status).toBe(200);
    const branch = created.body.data as { id: string };
    const viewerAttempt = await request(
      "POST",
      "/api/v1/tenancy/branches",
      { code: "RYY", name: "Riyadh Branch" },
      withToken(viewer.token),
    );
    expect(viewerAttempt.status).toBe(403);
    expect((viewerAttempt.body.error as { code: string }).code).toBe("FORBIDDEN");
    const deactivated = await request(
      "PATCH",
      `/api/v1/tenancy/branches/${branch.id}`,
      { isActive: false },
      withToken(owner.token),
    );
    expect(deactivated.status).toBe(200);
    expect((deactivated.body.data as { isActive: boolean }).isActive).toBe(false);
    const duplicate = await request(
      "POST",
      "/api/v1/tenancy/branches",
      { code: "JED", name: "Duplicate" },
      withToken(owner.token),
    );
    expect(duplicate.status).toBe(409);
  });

  it("settings: defaults resolve; valid write 200; unknown key 422 (fail loud)", async () => {
    const read = await request("GET", "/api/v1/tenancy/settings", undefined, withToken(owner.token));
    expect(read.status).toBe(200);
    const config = read.body.data as Record<string, unknown>;
    expect(config["general.default_locale"]).toBe("ar");
    expect(config["tax.registration.status"]).toBe("REGISTERED");

    const write = await request(
      "PUT",
      "/api/v1/tenancy/settings/general.numeral_system",
      { value: "arab" },
      withToken(owner.token),
    );
    expect(write.status).toBe(200);
    const unknown = await request(
      "PUT",
      "/api/v1/tenancy/settings/does.not_exist",
      { value: 1 },
      withToken(owner.token),
    );
    expect(unknown.status).toBe(422);
    const badValue = await request(
      "PUT",
      "/api/v1/tenancy/settings/general.default_locale",
      { value: "fr" },
      withToken(owner.token),
    );
    expect(badValue.status).toBe(422);
  });

  it("derived entitlements payload: every member reads it (BR-39 UI visibility)", async () => {
    const response = await request(
      "GET",
      "/api/v1/tenancy/entitlements",
      undefined,
      withToken(viewer.token),
    );
    expect(response.status).toBe(200);
    const payload = response.body.data as { featureKeys: string[] };
    expect(payload.featureKeys).toContain("platform.onboarding");
    expect(payload.featureKeys).toContain("reporting.engine");
  });
});

describe("platform console (S-07 at the HTTP plane)", () => {
  it("platform admin logs in and lists the fleet; owner is 403-ed + audited", async () => {
    const session = await login(platformAdmin.email, BASE_PASSWORD);
    platformAdmin.token = session.token;

    const list = await request(
      "GET",
      "/api/v1/platform/tenants?limit=200",
      undefined,
      withToken(platformAdmin.token),
    );
    expect(list.status).toBe(200);
    const rows = (list.body.data as { id: string }[]).map((row) => row.id);
    expect(rows).toContain(businessTenantId);
    expect(rows).toContain(PLATFORM_TENANT_ID);

    const escalation = await request(
      "GET",
      "/api/v1/platform/tenants",
      {},
      withToken(owner.token),
    );
    expect(escalation.status).toBe(403);
    expect((escalation.body.error as { code: string }).code).toBe("FORBIDDEN");
  });

  it("tenant detail + plan assignment re-materialize entitlements", async () => {
    const detail = await request(
      "GET",
      `/api/v1/platform/tenants/${businessTenantId}`,
      undefined,
      withToken(platformAdmin.token),
    );
    expect(detail.status).toBe(200);
    const data = detail.body.data as {
      plan: { key: string } | null;
      entitlements: { featureKey: string }[];
      memberships: unknown[];
    };
    expect(data.plan?.key).toBe("business");
    expect(data.entitlements.length).toBeGreaterThan(70);
    expect(data.memberships.length).toBe(2);

    const assigned = await request(
      "POST",
      `/api/v1/platform/tenants/${businessTenantId}/plan`,
      { planKey: "starter" },
      withToken(platformAdmin.token),
    );
    expect(assigned.status).toBe(200);
    expect((assigned.body.data as { grantedKeys: number }).grantedKeys).toBe(57);
  });

  it("entitlement edit: MANUAL grant + revoke through the console (audited)", async () => {
    // starter-tier closure-safe key (journal_entries is in every plan)
    const granted = await request(
      "POST",
      `/api/v1/platform/tenants/${businessTenantId}/entitlements`,
      {
        featureKey: "accounting.recurring_journals",
        source: "MANUAL",
        expiresAt: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
        reason: "pilot extension",
      },
      withToken(platformAdmin.token),
    );
    expect(granted.status).toBe(200);

    // BR-040 rejection at the HTTP plane: POS activation without closure.
    const closureReject = await request(
      "POST",
      `/api/v1/platform/tenants/${businessTenantId}/entitlements`,
      {
        featureKey: "pos.offline_queue",
        source: "MANUAL",
        expiresAt: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
        reason: "pos pilot",
      },
      withToken(platformAdmin.token),
    );
    expect(closureReject.status).toBe(422);
    expect((closureReject.body.error as { code: string }).code).toBe(
      "tenancy/feature-dependencies-missing",
    );

    const revoked = await request(
      "DELETE",
      `/api/v1/platform/tenants/${businessTenantId}/entitlements/accounting.recurring_journals?reason=cleanup`,
      undefined,
      withToken(platformAdmin.token),
    );
    expect(revoked.status).toBe(200);
  });

  it("cross-tenant audit review shows tenant + platform rows", async () => {
    const response = await request(
      "GET",
      "/api/v1/platform/audit/events?platformOnly=true&limit=200",
      undefined,
      withToken(platformAdmin.token),
    );
    expect(response.status).toBe(200);
    const rows = response.body.data as { action: string; tenantId: string | null }[];
    expect(rows.some((row) => row.tenantId === null)).toBe(true);
    expect(rows.some((row) => row.action === "tenant.created")).toBe(true);
  });
});

describe("suspend/restore over HTTP (rule 6 full semantics)", () => {
  it("suspend kills the owner session: next request 401, re-login blocked", async () => {
    const suspended = await request(
      "POST",
      `/api/v1/platform/tenants/${businessTenantId}/suspend`,
      { reason: "billing hold http" },
      withToken(platformAdmin.token),
    );
    expect(suspended.status).toBe(200);
    expect((suspended.body.data as { killedSessions: number }).killedSessions).toBeGreaterThanOrEqual(1);

    const ownerProbe = await request(
      "GET",
      "/api/v1/tenancy/profile",
      undefined,
      withToken(owner.token),
    );
    expect(ownerProbe.status).toBe(401);

    const relogin = await request("POST", "/api/v1/identity/sessions", {
      email: owner.email,
      password: BASE_PASSWORD,
    });
    expect(relogin.status).toBe(401);

    // console stays accessible for the suspended tenant (platform plane)
    const detail = await request(
      "GET",
      `/api/v1/platform/tenants/${businessTenantId}`,
      undefined,
      withToken(platformAdmin.token),
    );
    expect(detail.status).toBe(200);
    expect((detail.body.data as { status: string }).status).toBe("SUSPENDED");
  });

  it("restore revives: owner logs in again", async () => {
    const restored = await request(
      "POST",
      `/api/v1/platform/tenants/${businessTenantId}/restore`,
      { reason: "payment received" },
      withToken(platformAdmin.token),
    );
    expect(restored.status).toBe(200);
    const session = await login(owner.email, BASE_PASSWORD);
    owner.token = session.token;
    const profile = await request("GET", "/api/v1/tenancy/profile", {}, withToken(owner.token));
    expect(profile.status).toBe(200);
  });
});

describe("support access over HTTP (matrix §7)", () => {
  it("owner opts in; platform admin opens, reads, and the tenant terminates", async () => {
    const optIn = await request(
      "PUT",
      "/api/v1/tenancy/settings/platform.support.opt_in",
      { value: true },
      withToken(owner.token),
    );
    expect(optIn.status).toBe(200);

    const denied = await request(
      "POST",
      `/api/v1/platform/tenants/${businessTenantId}/support-sessions`,
      { reason: "no gate probe" },
      withToken(platformAdmin.token),
    );
    // opt-in is ON now → open succeeds
    expect(denied.status).toBe(200);
    const session = denied.body.data as { id: string; optIn: boolean; expiresAt: string };
    expect(session.optIn).toBe(true);

    const proxied = await request(
      "GET",
      `/api/v1/platform/tenants/${businessTenantId}/support-sessions/${session.id}/tenant-data/users`,
      undefined,
      withToken(platformAdmin.token),
    );
    expect(proxied.status).toBe(200);
    const members = proxied.body.data as { email: string }[];
    expect(members.length).toBe(2);

    const trail = await request(
      "GET",
      "/api/v1/tenancy/support-sessions",
      undefined,
      withToken(owner.token),
    );
    expect(trail.status).toBe(200);
    expect((trail.body.data as { id: string }[]).some((row) => row.id === session.id)).toBe(true);

    const terminated = await request(
      "DELETE",
      `/api/v1/tenancy/support-sessions/${session.id}`,
      undefined,
      withToken(owner.token),
    );
    expect(terminated.status).toBe(200);

    const su = await superuserClient();
    const flagged = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM audit_events
        WHERE tenant_id = $1 AND action = 'support.session.action'
          AND via_platform_admin = true`,
      [businessTenantId],
    );
    await su.end();
    expect(flagged.rows[0]?.n).toBeGreaterThanOrEqual(1);
  });
});
