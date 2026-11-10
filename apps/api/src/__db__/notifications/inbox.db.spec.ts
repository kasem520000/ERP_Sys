import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@erp/domain-core";

import { ensureTestDb, superuserClient } from "../test-db";
import { reloadEnv } from "../../config/env";
import { closeDb } from "../../infra/db/client";
import { startBoss, stopBoss, JobsService } from "../../infra/jobs/boss";
import { withTenant } from "../../infra/db/tenant-context";
import { EmailService, EMAIL_QUEUE } from "../../modules/notifications/application/email-service";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import { AppModule } from "../../app.module";

/**
 * PHASE-014 T10 db evidence (PHASE-014 §6 "Notifications tests"): the
 * billing-critical event set flows into the in-app inbox + the owner
 * email queue; preferences suppress correctly (per channel); unread
 * counts + mark-read are accurate; tenant rows stay isolated. The SMTP
 * delivery itself (rendering, queue coalescing) is proven by the
 * PHASE-003 suite — this spec pins the CENTER's contract.
 */

const TENANT_NI = "51515151-5151-5151-5151-515151515151";
const TENANT_NI_OTHER = "52525252-5252-5252-5252-525252525252";
const OWNER_NI = "4e4e4e4e-0000-4000-8000-00000000004e";

let inbox: InboxService;
let email: EmailService;
let httpBase = "";
let shutdown: (() => Promise<void>) | undefined;
let ownerToken = "";
let viewerToken = "";
let viewerId = "";

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

  const su = await superuserClient();
  for (const [id, name] of [
    [TENANT_NI, "Tenant NI (notifications inbox)"],
    [TENANT_NI_OTHER, "Tenant NI-other (isolation probe)"],
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
     VALUES ($1, 'ni-owner@fixture.test', 'NI Owner', $2, 'ACTIVE', 'ar')
     ON CONFLICT (id) DO NOTHING`,
    [OWNER_NI, await passwords.hashFromNewPassword("inbox-owner-passphrase-11")],
  );
  viewerId = generateUuidV7();
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status, locale)
     VALUES ($1, 'ni-viewer@fixture.test', 'NI Viewer', $2, 'ACTIVE', 'en')
     ON CONFLICT (id) DO NOTHING`,
    [viewerId, await passwords.hashFromNewPassword("inbox-viewer-passphrase-22")],
  );
  const ownerTemplate = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id IS NULL AND key = 'owner'`,
  );
  const viewerTemplate = await su.query<{ id: string }>(
    `SELECT id FROM roles WHERE tenant_id IS NULL AND key = 'viewer'`,
  );
  for (const [key, tmpl, userId] of [
    ["owner", ownerTemplate.rows[0]!.id, OWNER_NI] as const,
    ["viewer", viewerTemplate.rows[0]!.id, viewerId] as const,
  ]) {
    const roleId = generateUuidV7();
    await su.query(
      `INSERT INTO roles (id, tenant_id, key, name, name_ar, is_system)
       VALUES ($1, $2, $3, $3, $3, false)`,
      [roleId, TENANT_NI, key],
    );
    await su.query(
      `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
       SELECT $1, $2, rp.permission_id FROM role_permissions rp
        JOIN roles r ON r.id = rp.role_id WHERE r.id = $3`,
      [roleId, TENANT_NI, tmpl],
    );
    await su.query(
      `INSERT INTO memberships (id, tenant_id, user_id, role_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [generateUuidV7(), TENANT_NI, userId, roleId],
    );
  }
  const otherOwner = generateUuidV7();
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status)
     VALUES ($1, 'ni-other@fixture.test', 'NI Other', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [otherOwner],
  );
  const otherRoleId = generateUuidV7();
  await su.query(
    `INSERT INTO roles (id, tenant_id, key, name, name_ar, is_system)
     VALUES ($1, $2, 'owner', 'Owner', 'المالك', false)`,
    [otherRoleId, TENANT_NI_OTHER],
  );
  await su.query(
    `INSERT INTO role_permissions (role_id, tenant_id, permission_id)
     SELECT $1, $2, rp.permission_id FROM role_permissions rp
      JOIN roles r ON r.id = rp.role_id WHERE r.id = $3`,
    [otherRoleId, TENANT_NI_OTHER, ownerTemplate.rows[0]!.id],
  );
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [generateUuidV7(), TENANT_NI_OTHER, otherOwner, otherRoleId],
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
  const login = async (emailAddress: string, password: string) => {
    const response = await request("POST", "/api/v1/identity/sessions", {
      email: emailAddress,
      password,
    });
    return (response.body.data as { token: string }).token;
  };
  ownerToken = await login("ni-owner@fixture.test", "inbox-owner-passphrase-11");
  viewerToken = await login("ni-viewer@fixture.test", "inbox-viewer-passphrase-22");
}, 120_000);

afterAll(async () => {
  if (shutdown !== undefined) {
    await shutdown();
  }
  await stopBoss();
  await closeDb();
});

describe("notifications center (T10)", () => {
  it("events produce owner-targeted inbox rows + the email job (both channels on by default)", async () => {
    const outcome = await withTenant(TENANT_NI, () =>
      inbox.notifyOwner(email, {
        category: "limits",
        severity: "warning",
        title: { ar: "المستخدمون: 80% من الخطة", en: "Users: 80% of plan" },
        body: { ar: "8 من 10", en: "8 of 10" },
        actionLabel: { ar: "مراجعة", en: "Review" },
        actionUrl: "/billing",
        dedupeKey: "limit:users:CURRENT:0.8",
        emailTemplate: "limit_warning",
        emailVariables: {
          tenantName: "NI",
          counter: "Users",
          usage: "8",
          limit: "10",
          level: "80%",
          note: "note",
          usageUrl: "http://localhost:3000/billing",
        },
      }),
    );
    expect(outcome.inbox).toBe(true);
    expect(outcome.email).toBe(true);
    const rows = await withTenant(TENANT_NI, () => inbox.listForUser(OWNER_NI, { limit: 10 }));
    const row = rows.find((entry) => entry.title.en === "Users: 80% of plan");
    expect(row?.userId).toBe(OWNER_NI);
    expect(row?.severity).toBe("warning");
    expect(row?.actionUrl).toBe("/billing");
    expect(row?.readAt).toBeNull();
    const su = await superuserClient();
    const queued = await su.query(
      `SELECT count(*)::int AS n FROM boss.job j
        WHERE j.name = $1 AND j.data->'email'->>'template' = 'limit_warning'`,
      [EMAIL_QUEUE],
    );
    expect((queued.rows[0] as { n: number }).n).toBeGreaterThanOrEqual(1);
    await su.end();
  });

  it("dedupe: re-emitting the same event is a no-op (once per dedupe key)", async () => {
    const again = await withTenant(TENANT_NI, () =>
      inbox.notifyOwner(email, {
        category: "limits",
        severity: "warning",
        title: { ar: "المستخدمون: 80% من الخطة", en: "Users: 80% of plan" },
        body: { ar: "8 من 10", en: "8 of 10" },
        actionLabel: { ar: "مراجعة", en: "Review" },
        actionUrl: "/billing",
        dedupeKey: "limit:users:CURRENT:0.8",
        emailTemplate: "limit_warning",
        emailVariables: {},
      }),
    );
    expect(again.inbox).toBe(false);
    const rows = await withTenant(TENANT_NI, () => inbox.listForUser(OWNER_NI, { limit: 10 }));
    expect(rows.filter((entry) => entry.title.en === "Users: 80% of plan").length).toBe(1);
  });

  it("preferences suppress per channel — the owner's rows respect their own prefs", async () => {
    // Turn the OWNER's in-app channel OFF for 'limits' — the next limits
    // event creates NO row but the email still queues (email ON).
    await withTenant(TENANT_NI, () =>
      inbox.upsertPref(OWNER_NI, { category: "limits", inApp: false, email: true }),
    );
    const before = await withTenant(TENANT_NI, () => inbox.listForUser(OWNER_NI, { limit: 50 }));
    const suppressed = await withTenant(TENANT_NI, () =>
      inbox.notifyOwner(email, {
        category: "limits",
        severity: "info",
        title: { ar: "فحص القناة", en: "Channel probe" },
        body: { ar: "", en: "" },
        dedupeKey: "limit:probe:channel:1",
        emailTemplate: "limit_warning",
        emailVariables: {},
      }),
    );
    expect(suppressed.inbox).toBe(false);
    expect(suppressed.email).toBe(true);
    const after = await withTenant(TENANT_NI, () => inbox.listForUser(OWNER_NI, { limit: 50 }));
    expect(after.length).toBe(before.length);
    // Restore the preference (both on) for the later tests.
    await withTenant(TENANT_NI, () =>
      inbox.upsertPref(OWNER_NI, { category: "limits", inApp: true, email: true }),
    );
  });

  it("unread counts + mark-read through the HTTP surface", async () => {
    const count = await request("GET", "/api/v1/notifications/unread-count", undefined, {
      "x-session-token": ownerToken,
    });
    const before = (count.body.data as { count: number }).count;
    expect(before).toBeGreaterThanOrEqual(1);
    const list = await request("GET", "/api/v1/notifications?limit=50", undefined, {
      "x-session-token": ownerToken,
    });
    const rows = list.body.data as { id: string; readAt: string | null }[];
    const unread = rows.find((entry) => entry.readAt === null);
    expect(unread).toBeDefined();
    const marked = await request("PATCH", `/api/v1/notifications/${unread!.id}/read`, {}, {
      "x-session-token": ownerToken,
      "idempotency-key": generateUuidV7(),
    });
    expect(marked.status).toBe(200);
    const after = await request("GET", "/api/v1/notifications/unread-count", undefined, {
      "x-session-token": ownerToken,
    });
    expect((after.body.data as { count: number }).count).toBe(before - 1);
    const again = await request("PATCH", `/api/v1/notifications/${unread!.id}/read`, {}, {
      "x-session-token": ownerToken,
      "idempotency-key": generateUuidV7(),
    });
    expect((again.body.data as { read: boolean }).read).toBe(false);
  });

  it("preferences: PUT through HTTP persists + the list reflects it", async () => {
    const put = await request(
      "PUT",
      "/api/v1/notifications/preferences",
      { category: "invoice_overdue", inApp: false, email: true },
      { "x-session-token": viewerToken, "idempotency-key": generateUuidV7() },
    );
    expect(put.status).toBe(200);
    const list = await request("GET", "/api/v1/notifications/preferences", undefined, {
      "x-session-token": viewerToken,
    });
    const prefs = list.body.data as { category: string; inApp: boolean; email: boolean }[];
    const invoiceOverdue = prefs.find((entry) => entry.category === "invoice_overdue");
    expect(invoiceOverdue?.inApp).toBe(false);
    expect(invoiceOverdue?.email).toBe(true);
  });

  it("isolation: the other tenant's rows never appear (RLS + row filtering)", async () => {
    await withTenant(TENANT_NI_OTHER, () =>
      inbox.record({
        category: "subscription",
        severity: "info",
        title: { ar: "أخرى", en: "Other tenant event" },
        body: { ar: "", en: "" },
        dedupeKey: "other:1",
      }),
    );
    const rows = await request("GET", "/api/v1/notifications?limit=50", undefined, {
      "x-session-token": ownerToken,
    });
    const list = rows.body.data as { title: { en: string } }[];
    expect(list.some((entry) => entry.title.en === "Other tenant event")).toBe(false);
    const count = await request("GET", "/api/v1/notifications/unread-count", undefined, {
      "x-session-token": ownerToken,
    });
    const list2 = await request("GET", "/api/v1/notifications?unread=true&limit=50", undefined, {
      "x-session-token": ownerToken,
    });
    const unreadList = list2.body.data as unknown[];
    expect((count.body.data as { count: number }).count).toBe(unreadList.length);
  });
});

describe("PHASE-015 generalization — stock + templates categories (T10)", () => {
  it("a stock-category event lands in the inbox, deduped once per key", async () => {
    const first = await withTenant(TENANT_NI, () =>
      inbox.record({
        category: "stock",
        severity: "warning",
        title: { ar: "أصناف بلغت حد إعادة الطلب (2)", en: "2 item(s) at or below reorder level" },
        body: {
          ar: "هذا تنبيه فقط — لا يتم إنشاء أوامر شراء تلقائيًا (BR-019).",
          en: "Alert only — no purchase orders are created automatically (BR-019).",
        },
        actionLabel: { ar: "مراجعة مقترحات التزويد", en: "Review replenishment suggestions" },
        actionUrl: "/inventory/below-reorder",
        dedupeKey: "stock.below_reorder:probe-window",
        userId: OWNER_NI,
      }),
    );
    expect(first.inserted).toBe(true);
    expect(first.row?.category).toBe("stock");
    expect(first.row?.severity).toBe("warning");

    const rows = await withTenant(TENANT_NI, () => inbox.listForUser(OWNER_NI, { limit: 50 }));
    const row = rows.find((entry) => entry.category === "stock");
    expect(row).toBeDefined();
    expect(row!.userId).toBe(OWNER_NI);
    expect(row!.actionUrl).toBe("/inventory/below-reorder");

    // The once-per-event discipline holds for the new category too.
    const again = await withTenant(TENANT_NI, () =>
      inbox.record({
        category: "stock",
        severity: "warning",
        title: { ar: "مكرر", en: "Duplicate probe" },
        body: { ar: "", en: "" },
        dedupeKey: "stock.below_reorder:probe-window",
      }),
    );
    expect(again.inserted).toBe(false);
    const after = await withTenant(TENANT_NI, () => inbox.listForUser(OWNER_NI, { limit: 50 }));
    expect(after.filter((entry) => entry.category === "stock").length).toBe(1);
  });

  it("prefs suppress the stock category per channel; the templates category persists via HTTP", async () => {
    // in-app OFF + email OFF for 'stock': a notifyOwner emits NEITHER.
    await withTenant(TENANT_NI, () =>
      inbox.upsertPref(OWNER_NI, { category: "stock", inApp: false, email: false }),
    );
    const suppressed = await withTenant(TENANT_NI, () =>
      inbox.notifyOwner(email, {
        category: "stock",
        severity: "warning",
        title: { ar: "قمع", en: "Suppressed probe" },
        body: { ar: "", en: "" },
        dedupeKey: "stock:probe:suppressed:1",
        emailTemplate: "limit_warning",
        emailVariables: {},
      }),
    );
    expect(suppressed.inbox).toBe(false);
    expect(suppressed.email).toBe(false);

    // The 'templates' category (upgrade offers) accepts prefs through the
    // HTTP surface and reads them back.
    const put = await request(
      "PUT",
      "/api/v1/notifications/preferences",
      { category: "templates", inApp: true, email: false },
      { "x-session-token": viewerToken, "idempotency-key": generateUuidV7() },
    );
    expect(put.status).toBe(200);
    const list = await request("GET", "/api/v1/notifications/preferences", undefined, {
      "x-session-token": viewerToken,
    });
    const prefs = list.body.data as { category: string; inApp: boolean; email: boolean }[];
    const templates = prefs.find((entry) => entry.category === "templates");
    expect(templates?.inApp).toBe(true);
    expect(templates?.email).toBe(false);

    // And a templates-category row records through the same inbox path.
    const offer = await withTenant(TENANT_NI, () =>
      inbox.record({
        category: "templates",
        severity: "info",
        title: { ar: "تحديث قالب متاح", en: "Template upgrade available" },
        body: { ar: "إصدار جديد 1.1.0", en: "A new version 1.1.0 is available" },
        dedupeKey: "templates:upgrade:industry.grocery:1.1.0",
      }),
    );
    expect(offer.inserted).toBe(true);
    expect(offer.row?.category).toBe("templates");
  });
});
