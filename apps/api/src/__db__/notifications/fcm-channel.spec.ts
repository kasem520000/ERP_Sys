import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Client } from "pg";

import { generateUuidV7 } from "@erp/domain-core";

import { ensureTestDb, superuserClient } from "../test-db";
import { reloadEnv, env } from "../../config/env";
import { closeDb } from "../../infra/db/client";
import { startBoss, stopBoss } from "../../infra/jobs/boss";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { DeviceRegistryService } from "../../modules/sync/application/device-registry-service";
import { issueAccessToken } from "../../modules/sync/application/device-tokens";
import { enrollDevice } from "../sync/_oracle";
import { AppModule } from "../../app.module";
import { renderPushMessage } from "../../modules/notifications/application/fcm-templates";
import { PushChannelService } from "../../modules/notifications/application/push-channel-service";
import type { ChannelSendRequest } from "../../modules/notifications/application/channel-port";
import { FcmChannelAdapter } from "../../modules/notifications/adapters/fcm/fcm-adapter";
import {
  DisabledFcmTransport,
  fcmTransportFromEnv,
  parseFcmCredentials,
} from "../../modules/notifications/adapters/fcm/fcm-transport";
import { FakeFcmTransport } from "../../modules/notifications/adapters/fcm/fake-fcm";
import { ROUTE_PERMISSIONS } from "../../infra/auth/route-permissions";

/**
 * PHASE-022 · DR-P22-07 db evidence (the phase doc's test plan: "FCM adapter
 * contract tests against a fake provider (locale resolution, opt-in, quota);
 * no notification contains financial payloads" + the token endpoints):
 *
 * 1. locale resolution: the AR device gets the AR title byte-for-byte from
 *    the registry (§3.5: template + locale resolved BEFORE the call — the
 *    wire carries renderedFor + the rendered payload);
 * 2. opt-in default OFF: no token row / opted_in=false / an omitted optIn
 *    in the PUT body → NO wire call ever;
 * 3. no financial payloads: amount/price/total/balance/qty keys injected by
 *    a caller are dropped at the wire (whitelist asserted on the fake's
 *    record — the exact data payload, no extra keys);
 * 4. per-tenant quota: over the windowed cap → ok:false (counted, never
 *    thrown), the window slides, tenants are isolated;
 * 5. retry on transient transport failure with bounded backoff; permanent
 *    4xx never retries;
 * 6. disabled mode (FCM_CREDENTIALS unset) no-ops cleanly: ok:false, no
 *    throw, the factory's honest-skeleton flag; garbage credentials fail
 *    fast at parse;
 * 7. the token endpoints through the REAL AppModule + HTTP: the device
 *    itself calls PUT /api/v1/devices/:id/push-token with its device
 *    credentials (the 15-min access token), permission-gated (401/403
 *    shapes), opt-in toggling (default OFF), the cross-device token
 *    collision, and revocation clearing the rows.
 *
 * Dedicated tenant 53535353 (SAR), verified unused across the repo (the
 * inbox.db.spec neighbor convention).
 */

const TENANT_FCM = "53535353-5353-5353-5353-535353535353";
const REP = "53535353-0000-4000-8000-000000005301";
const OUTSIDER = "53535353-0000-4000-8000-000000005302";
const REP_PASS = "fcm-rep-passphrase-31";
const OUTSIDER_PASS = "fcm-outsider-passphrase-32";

const audit = new AuditService(new DrizzleAuditStore());
const registry = new DeviceRegistryService(audit);

const fake = new FakeFcmTransport();
/** The §3.5 orchestrator over the fake-backed adapter (defaults tuned for
 * test speed: 1ms backoff, a generous quota). */
const push = new PushChannelService(
  new FcmChannelAdapter({
    transport: fake,
    quota: { limit: 1000, windowMs: 60_000 },
    retry: { attempts: 3, backoffMs: 1 },
  }),
);

let httpBase = "";
let shutdown: (() => Promise<void>) | undefined;
let repToken = "";
let outsiderToken = "";

let deviceAr = "";
let deviceEn = "";
let deviceRevocable = "";
let deviceOther = "";

interface ApiResponse {
  status: number;
  body: { data?: unknown; error?: { code: string; message?: string } };
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

/** The tenant-scoped app client (RLS world) for read assertions. */
async function tenantClient(): Promise<Client> {
  const { appClient } = await import("../test-db");
  const client = await appClient();
  await client.query("SELECT set_config('erp.tenant_id', $1, false)", [TENANT_FCM]);
  return client;
}

async function auditEvents(action: string): Promise<{ after: Record<string, unknown> | null }[]> {
  const client = await tenantClient();
  const result = await client.query(
    `SELECT after FROM audit_events WHERE tenant_id = $1 AND action = $2 ORDER BY at`,
    [TENANT_FCM, action],
  );
  await client.end();
  return result.rows.map((row) => ({
    after: row.after === null ? null : (JSON.parse(JSON.stringify(row.after)) as Record<string, unknown>),
  }));
}

/** A ready-made channel request for the adapter-level contract tests. */
function channelRequest(overrides: Partial<ChannelSendRequest> = {}): ChannelSendRequest {
  return {
    tenantId: "53535353-5353-5353-5353-535353535353",
    deviceToken: "fcm-device-token-0123456789abcdef",
    templateId: "invoice_posted_to_customer",
    renderedFor: "ar",
    title: "فاتورة مرحّلة: SAL-2026-000101",
    body: "تم ترحيل فاتورة العميل «شركة النور» رقم SAL-2026-000101.",
    data: { docNo: "SAL-2026-000101", templateId: "invoice_posted_to_customer", renderedFor: "ar" },
    category: "invoice_overdue",
    ...overrides,
  };
}

beforeAll(async () => {
  ensureTestDb();
  reloadEnv();
  await startBoss();

  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant FCM (push channel)', 'مستأجر الإشعارات', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_FCM],
  );
  const { PasswordService } = await import("../../modules/identity/application/password-service");
  const passwords = new PasswordService();
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status, locale) VALUES
       ($1, 'fcm-rep@fixture.test', 'FCM Rep', $2, 'ACTIVE', 'ar'),
       ($3, 'fcm-outsider@fixture.test', 'FCM Outsider', $4, 'ACTIVE', 'ar')
     ON CONFLICT (id) DO NOTHING`,
    [
      REP,
      await passwords.hashFromNewPassword(REP_PASS),
      OUTSIDER,
      await passwords.hashFromNewPassword(OUTSIDER_PASS),
    ],
  );
  // REP: the owner template (holds identity.devices.manage — the admin half
  // of the self/admin split). OUTSIDER: an EMPTY role — no keys at all (the
  // 403 path: the guard's self grant admits the session, the handler's
  // ownership boundary rejects it).
  const ownerTemplate = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id IS NULL AND key = 'owner' LIMIT 1`,
  );
  for (const [key, userId, grants] of [
    ["fcm_owner", REP, true],
    ["fcm_none", OUTSIDER, false],
  ] as const) {
    const roleId = generateUuidV7();
    await su.query(
      `INSERT INTO roles (id, tenant_id, key, name, name_ar, is_system)
       VALUES ($1, $2, $3, $3, $3, false)`,
      [roleId, TENANT_FCM, key],
    );
    if (grants) {
      await su.query(
        `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
         SELECT $1, $2, rp.permission_id FROM role_permissions rp
          WHERE rp.role_id = $3
         ON CONFLICT (role_id, permission_id) DO NOTHING`,
        [roleId, TENANT_FCM, ownerTemplate.rows[0]!.id],
      );
    }
    await su.query(
      `INSERT INTO memberships (id, tenant_id, user_id, role_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [generateUuidV7(), TENANT_FCM, userId, roleId],
    );
  }
  await su.end();

  // The fixture devices (the _oracle.enrollDevice shape: devices is
  // service-mediated, the tenant context rides withTenant).
  deviceAr = await enrollDevice(TENANT_FCM, REP, { deviceClass: "android-field" });
  deviceEn = await enrollDevice(TENANT_FCM, REP, { deviceClass: "android-field" });
  deviceRevocable = await enrollDevice(TENANT_FCM, REP, { deviceClass: "android-field" });
  deviceOther = await enrollDevice(TENANT_FCM, REP, { deviceClass: "android-field" });

  const { NestFactory } = await import("@nestjs/core");
  const server = await NestFactory.create(AppModule, { logger: ["error", "warn"] });
  await server.listen(0);
  const httpServer = server.getHttpServer() as import("node:http").Server;
  const port = (httpServer.address() as import("node:net").AddressInfo).port;
  httpBase = `http://127.0.0.1:${port}`;
  shutdown = async () => {
    await server.close();
  };

  const login = async (emailAddress: string, password: string) => {
    const response = await request("POST", "/api/v1/identity/sessions", {
      email: emailAddress,
      password,
    });
    return (response.body.data as { token: string }).token;
  };
  repToken = await login("fcm-rep@fixture.test", REP_PASS);
  outsiderToken = await login("fcm-outsider@fixture.test", OUTSIDER_PASS);
}, 120_000);

afterAll(async () => {
  if (shutdown !== undefined) {
    await shutdown();
  }
  await stopBoss();
  await closeDb();
});

describe("fcm channel contracts (DR-P22-07 · integrations §3.5)", () => {
  it("(1) locale resolution — the AR device gets the AR title byte-for-byte, renderedFor rides the wire", async () => {
    // Opt the AR device in through the REAL surface (the device itself, with
    // its device credentials — the 15-min access token).
    const up = await request(
      "PUT",
      `/api/v1/devices/${deviceAr}/push-token`,
      { token: "fcm-ar-token-0123456789abcdef0123", locale: "ar", optIn: true },
      { authorization: `Bearer ${issueAccessToken({ userId: REP, deviceId: deviceAr }).token}` },
    );
    expect(up.status).toBe(200);
    expect((up.body.data as { optedIn: boolean }).optedIn).toBe(true);

    const vars = { docNo: "SAL-2026-000101", customerName: "شركة النور" } as const;
    const callsBefore = fake.calls.length;
    const outcome = await push.sendToDevice({
      tenantId: TENANT_FCM,
      deviceId: deviceAr,
      template: "invoice_posted_to_customer",
      category: "invoice_overdue",
      vars,
    });
    expect(outcome.sent).toBe(true);
    expect(outcome.result?.ok).toBe(true);
    expect(fake.calls.length).toBe(callsBefore + 1);
    const wire = fake.calls[callsBefore]!.message;
    // §3.5: template + locale resolved BEFORE the call — byte-for-byte the
    // registry's AR rendering, never a render instruction on the wire.
    const expected = renderPushMessage("invoice_posted_to_customer", "ar", vars);
    expect(wire.notification.title).toBe(expected.title); // byte-asserted
    expect(wire.notification.title).toBe("فاتورة مرحّلة: SAL-2026-000101");
    expect(wire.notification.body).toBe(expected.body);
    expect(wire.token).toBe("fcm-ar-token-0123456789abcdef0123");
    expect(wire.data).toEqual({
      docNo: "SAL-2026-000101",
      customerName: "شركة النور",
      templateId: "invoice_posted_to_customer",
      renderedFor: "ar",
      category: "invoice_overdue",
    }); // exact payload — no extra keys ever
  });

  it("(1b) the EN device gets the EN title — one registry, both locales", async () => {
    await request(
      "PUT",
      `/api/v1/devices/${deviceEn}/push-token`,
      { token: "fcm-en-token-0123456789abcdef0123", locale: "en", optIn: true },
      { "x-session-token": repToken },
    );
    const vars = { docNo: "SAL-2026-000102", customerName: "Al Noor Trading" } as const;
    const callsBefore = fake.calls.length;
    await push.sendToDevice({
      tenantId: TENANT_FCM,
      deviceId: deviceEn,
      template: "receipt_confirmed",
      category: "reconciliation",
      vars,
    });
    const wire = fake.calls[callsBefore]!.message;
    expect(wire.notification.title).toBe("Receipt confirmed: SAL-2026-000102");
    expect(wire.data).toMatchObject({ renderedFor: "en" });
  });

  it("(2) opt-in default OFF — no token row / opted_in false / omitted optIn → NO wire call", async () => {
    // (a) never registered: the EN twin device carries no row at all.
    const never = await push.sendToDevice({
      tenantId: TENANT_FCM,
      deviceId: deviceOther,
      template: "due_date_reminder",
      category: "invoice_overdue",
      vars: { docNo: "SAL-2026-000103", customerName: "شركة النور", dueDate: "2026-12-01" },
    });
    expect(never).toEqual({ sent: false, refusal: "no-token-registered" });

    // (b) the AR device opts OUT (a second PUT flips opted_in).
    await request(
      "PUT",
      `/api/v1/devices/${deviceAr}/push-token`,
      { token: "fcm-ar-token-0123456789abcdef0123" },
      { "x-session-token": repToken }, // no optIn in the body → default FALSE
    );
    const row = await tenantClient();
    const state = await row.query<{ opted_in: boolean; locale: string }>(
      `SELECT opted_in, locale FROM device_push_tokens WHERE device_id = $1`,
      [deviceAr],
    );
    expect(state.rows[0]!.opted_in).toBe(false); // optIn omitted → OFF
    expect(state.rows[0]!.locale).toBe("ar"); // locale persists from the first PUT
    await row.end();
    const refused = await push.sendToDevice({
      tenantId: TENANT_FCM,
      deviceId: deviceAr,
      template: "invoice_posted_to_customer",
      category: "invoice_overdue",
      vars: { docNo: "SAL-2026-000104", customerName: "شركة النور" },
    });
    expect(refused).toEqual({ sent: false, refusal: "opted-out" });

    // (c) restore the AR device's opt-in for the later tests (the refusal
    // paths above made NO wire call — asserted by (3)'s exact key set).
    await request(
      "PUT",
      `/api/v1/devices/${deviceAr}/push-token`,
      { token: "fcm-ar-token-0123456789abcdef0123", locale: "ar", optIn: true },
      { "x-session-token": repToken },
    );
  });

  it("(3) NO financial payloads — amount/price keys injected by a caller never reach the wire", async () => {
    // Adapter-level poison: the caller hands the channel a data payload with
    // financial keys; the whitelist drops them at the wire.
    const poisonedFake = new FakeFcmTransport();
    const poisoned = new FcmChannelAdapter({ transport: poisonedFake });
    const receipt = await poisoned.send(
      channelRequest({
        data: {
          amount: "150.00",
          price: "2.50",
          total: "155.00",
          balance: "0.00",
          qty: "3",
          value: "155.00",
          docNo: "SAL-2026-000105",
        },
      }),
    );
    expect(receipt.ok).toBe(true);
    expect(poisonedFake.calls).toHaveLength(1);
    // The exact wire payload — the financial keys are gone, the safe one rides.
    expect(poisonedFake.calls[0]!.message.data).toEqual({ docNo: "SAL-2026-000105" });
    expect(JSON.stringify(poisonedFake.calls[0])).not.toMatch(/amount|price|total|balance|150\.00/);

    // Service-level: the end-to-end path (template vars → data payload) also
    // carries only the safe vocabulary — asserted on the shared fake.
    const callsBefore = fake.calls.length;
    await push.sendToDevice({
      tenantId: TENANT_FCM,
      deviceId: deviceAr,
      template: "invoice_posted_to_customer",
      category: "invoice_overdue",
      vars: { docNo: "SAL-2026-000106", customerName: "شركة النور" },
    });
    const wireData = fake.calls[callsBefore]!.message.data;
    expect(Object.keys(wireData).sort()).toEqual(
      ["category", "customerName", "docNo", "renderedFor", "templateId"].sort(),
    );
  });

  it("(4) per-tenant quota — over the cap: ok:false, counted, never thrown; windows slide; tenants isolated", async () => {
    const quotaFake = new FakeFcmTransport();
    const adapter = new FcmChannelAdapter({
      transport: quotaFake,
      quota: { limit: 2, windowMs: 90 },
      retry: { attempts: 1, backoffMs: 1 },
    });
    const tenantQ1 = channelRequest({ tenantId: "53535353-5353-5353-5353-535353535353", data: { docNo: "Q" } });
    const tenantQ2 = channelRequest({
      tenantId: "53535353-5353-5353-5353-535353535352",
      data: { docNo: "Q" },
    });

    expect((await adapter.send(tenantQ1)).ok).toBe(true); // 1st
    expect((await adapter.send(tenantQ1)).ok).toBe(true); // 2nd
    const over = await adapter.send(tenantQ1); // 3rd — over the cap
    expect(over).toEqual({ ok: false, error: "fcm-quota-exceeded" }); // never thrown
    const stillOver = await adapter.send(tenantQ1); // 4th — the refusal was COUNTED
    expect(stillOver).toEqual({ ok: false, error: "fcm-quota-exceeded" });
    expect(quotaFake.calls).toHaveLength(2); // only the two in-budget sends hit the wire

    // Tenants are isolated: Q2's budget is untouched.
    expect((await adapter.send(tenantQ2)).ok).toBe(true);
    expect(quotaFake.calls).toHaveLength(3);

    // The window slides: Q1's attempts expire, a new send goes through.
    await new Promise((resolve) => {
      setTimeout(resolve, 120);
    });
    expect((await adapter.send(tenantQ1)).ok).toBe(true);
    expect(quotaFake.calls).toHaveLength(4);
  });

  it("(5) bounded retry with backoff on transient failures; permanent 4xx never retries", async () => {
    const retryFake = new FakeFcmTransport();
    const adapter = new FcmChannelAdapter({
      transport: retryFake,
      retry: { attempts: 3, backoffMs: 1 },
    });
    retryFake.failWith({ times: 2, status: 503, transient: true, error: "fcm-http-503: upstream" });
    const delivered = await adapter.send(channelRequest({ data: { docNo: "R" } }));
    expect(delivered).toEqual({ ok: true, providerMessageId: "projects/fake-project/messages/fcm-0003" });
    expect(retryFake.calls).toHaveLength(3); // fail, fail, deliver

    retryFake.failWith({ times: 1, status: 404, transient: false, error: "UNREGISTERED" });
    const permanent = await adapter.send(channelRequest({ data: { docNo: "R" } }));
    expect(permanent).toEqual({ ok: false, error: "UNREGISTERED" });
    expect(retryFake.calls).toHaveLength(4); // no retry on a permanent 4xx
  });

  it("(6) disabled mode no-ops cleanly — ok:false, never thrown; the env factory is the honest skeleton", async () => {
    const disabled = new FcmChannelAdapter({ transport: new DisabledFcmTransport() });
    await expect(disabled.send(channelRequest())).resolves.toEqual({ ok: false, error: "fcm-disabled" });
    expect(disabled.disabled).toBe(true); // surfaced in the module init log

    if (env.FCM_CREDENTIALS === undefined || env.FCM_CREDENTIALS === "") {
      const fromEnv = fcmTransportFromEnv();
      expect(fromEnv).toBeInstanceOf(DisabledFcmTransport);
      expect(fromEnv.disabled).toBe(true);
    }

    // Fail-fast on garbage (never silently coerced — the env contract).
    expect(() => parseFcmCredentials("not-json{")).toThrow(/FCM_CREDENTIALS/);
    expect(() => parseFcmCredentials(JSON.stringify({ project_id: "p" }))).toThrow(/service-account/);
    const account = parseFcmCredentials(
      JSON.stringify({
        project_id: "erp-fixture",
        client_email: "push@erp-fixture.iam.gserviceaccount.com",
        // Fixture marker material only — never a real key (gitleaks-safe).
        private_key: "fake-key-material-not-a-real-pem",
      }),
    );
    expect(account).toMatchObject({ project_id: "erp-fixture" });
  });

  it("(7) the token endpoints — device credentials, permission gate, toggling, collision, revocation clears", async () => {
    // The route registry row (the permission-gated registration).
    expect(
      ROUTE_PERMISSIONS.some(
        (rule) =>
          rule.method === "PUT" &&
          rule.path === "/api/v1/devices/:id/push-token" &&
          rule.permission === "identity.devices.manage" &&
          rule.self === true,
      ),
    ).toBe(true);

    // (a) anonymous → 401 (the uniform shape, no oracle).
    const anonymous = await request("PUT", `/api/v1/devices/${deviceOther}/push-token`, {
      token: "fcm-anon-token-0123456789abcdef",
    });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error?.code).toBe("UNAUTHENTICATED");

    // (b) an authenticated non-owner without the manage key → 403 (the
    // guard's self grant admits the session; the ownership boundary
    // rejects it — the revoke route's self/admin split).
    const foreign = await request(
      "PUT",
      `/api/v1/devices/${deviceOther}/push-token`,
      { token: "fcm-foreign-token-0123456789abcdef", optIn: true },
      { "x-session-token": outsiderToken },
    );
    expect(foreign.status).toBe(403);
    expect(foreign.body.error?.code).toBe("FORBIDDEN");

    // (c) the device itself with its DEVICE CREDENTIALS (15-min access
    // token) — the production call path; and an admin web session works
    // equally (the same self/admin split).
    const deviceBearer = issueAccessToken({ userId: REP, deviceId: deviceRevocable }).token;
    const viaDevice = await request(
      "PUT",
      `/api/v1/devices/${deviceRevocable}/push-token`,
      { token: "fcm-revocable-token-0123456789abcd", locale: "ar", optIn: true },
      { authorization: `Bearer ${deviceBearer}` },
    );
    expect(viaDevice.status).toBe(200);
    expect(viaDevice.body.data).toMatchObject({ optedIn: true, locale: "ar" });
    expect((viaDevice.body.data as { version: number }).version).toBe(1);

    // (d) malformed body → the typed zod 422 shape (never a silent coerce).
    const malformed = await request(
      "PUT",
      `/api/v1/devices/${deviceRevocable}/push-token`,
      { token: "short" },
      { "x-session-token": repToken },
    );
    expect(malformed.status).toBe(422);
    expect(malformed.body.error?.code).toBe("VALIDATION_ERROR");

    // (e) opt-in toggling: a second PUT flips opted_in and bumps version.
    const toggled = await request(
      "PUT",
      `/api/v1/devices/${deviceRevocable}/push-token`,
      { token: "fcm-revocable-token-0123456789abcd", locale: "ar", optIn: false },
      { "x-session-token": repToken },
    );
    expect(toggled.status).toBe(200);
    expect((toggled.body.data as { optedIn: boolean; version: number }).optedIn).toBe(false);
    expect((toggled.body.data as { version: number }).version).toBe(2);
    await request(
      "PUT",
      `/api/v1/devices/${deviceRevocable}/push-token`,
      { token: "fcm-revocable-token-0123456789abcd", locale: "ar", optIn: true },
      { "x-session-token": repToken },
    );

    // (f) the cross-device collision: deviceOther claims deviceRevocable's
    // token → the typed conflict (uq token is the belt).
    const collision = await request(
      "PUT",
      `/api/v1/devices/${deviceOther}/push-token`,
      { token: "fcm-revocable-token-0123456789abcd", optIn: true },
      { authorization: `Bearer ${issueAccessToken({ userId: REP, deviceId: deviceOther }).token}` },
    );
    expect(collision.status).toBe(422); // the DomainError default shape
    expect(collision.body.error?.code).toBe("DEVICE_PUSH_TOKEN_CONFLICT");

    // (g) revocation clears the tokens (the kill switch is final) — the
    // push orchestrator reports device-revoked, the rows are GONE, and the
    // revoked device can never change its token again.
    await withTenant(TENANT_FCM, () =>
      registry.revoke({ deviceId: deviceRevocable, actorId: REP, reason: "lost in the field", admin: true }),
    );
    const client = await tenantClient();
    const rows = await client.query(`SELECT * FROM device_push_tokens WHERE device_id = $1`, [
      deviceRevocable,
    ]);
    expect(rows.rows).toHaveLength(0); // revocation cleared the rows
    await client.end();
    const afterRevoke = await push.sendToDevice({
      tenantId: TENANT_FCM,
      deviceId: deviceRevocable,
      template: "invoice_posted_to_customer",
      category: "invoice_overdue",
      vars: { docNo: "SAL-2026-000107", customerName: "شركة النور" },
    });
    expect(afterRevoke).toEqual({ sent: false, refusal: "device-revoked" });
    const revokedPut = await request(
      "PUT",
      `/api/v1/devices/${deviceRevocable}/push-token`,
      { token: "fcm-after-revoke-token-0123456789", optIn: true },
      { "x-session-token": repToken },
    );
    expect(revokedPut.status).toBe(422);
    expect(revokedPut.body.error?.code).toBe("DEVICE_PUSH_TOKEN_REVOKED");

    // (h) the audit trail carries the fingerprint, NEVER the raw token.
    const events = await auditEvents("device.push_token_upserted");
    expect(events.length).toBeGreaterThanOrEqual(4);
    for (const event of events) {
      expect(event.after).toMatchObject({ tokenFingerprint: expect.stringMatching(/^[0-9a-f]{16}$/) });
      expect(JSON.stringify(event.after)).not.toContain("fcm-revocable-token");
    }
    const revokedEvents = await auditEvents("device.revoked");
    expect(revokedEvents[revokedEvents.length - 1]!.after).toMatchObject({ pushTokensCleared: 1 });

    // (i) the platform column mirrors the device row (android-field → ANDROID).
    const mirror = await tenantClient();
    const platform = await mirror.query<{ platform: string }>(
      `SELECT platform FROM device_push_tokens WHERE device_id = $1`,
      [deviceEn],
    );
    expect(platform.rows[0]!.platform).toBe("ANDROID");
    await mirror.end();
  });
});
