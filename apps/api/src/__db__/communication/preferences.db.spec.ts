import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { withTenant } from "../../infra/db/tenant-context";
import { superuserClient } from "../test-db";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import { OutboxService } from "../../modules/communication/application/outbox/outbox-service";
import { ProviderConfigService } from "../../modules/communication/application/provider-config.service";
import { TemplateService } from "../../modules/communication/application/template-service";
import {
  CODE_DEFAULTS,
  PreferencesService,
} from "../../modules/communication/application/preferences-service";
import { S_ACTOR, TENANT_S, setupSalesFixture } from "../sales/fixtures";

/**
 * PHASE-041 · the preference-matrix + dispatch-resolver DB suite (T-06;
 * acceptance §6.4): the resolver honors the matrix end-to-end on real
 * PostgreSQL — a user opting OUT of a module×channel receives NOTHING on
 * that channel while identical events still deliver on opted-in channels.
 * Also pins: the lazy tenant-default materialization (tenants provisioned
 * after migration 0064), the user→default→code resolution chain, and the
 * tenant-default upsert plane.
 */

const inbox = new InboxService();
const providers = new ProviderConfigService();
const templates = new TemplateService();
const outbox = new OutboxService(providers, inbox);
const preferences = new PreferencesService(outbox, templates, inbox);

const OPTOUT_EMAIL = "prefs-optout@comm.test";
const OPTIN_EMAIL = "prefs-optin@comm.test";
let optoutUserId = "";
let optinUserId = "";

async function seedUserWithMembership(email: string, phone: string): Promise<string> {
  const su = await superuserClient();
  // The users email uniqueness is a lower(email) INDEX (no constraint) —
  // find-or-insert instead of ON CONFLICT.
  const existing = (
    await su.query<{ id: string }>(`SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1`, [
      email,
    ])
  ).rows[0];
  const id =
    existing?.id ??
    (
      await su.query<{ id: string }>(
        `INSERT INTO users (id, email, full_name, password_hash, status, locale, phone)
         VALUES (gen_random_uuid(), $1, $2, 'x', 'ACTIVE', 'ar', $3)
         RETURNING id`,
        [email, email.split("@")[0]!, phone],
      )
    ).rows[0]!.id;
  // The membership FK is composite (role_id, tenant_id) — a TENANT-scoped
  // role row (the provisioning flow clones system templates per tenant;
  // here a dedicated find-or-create mirrors it).
  const existingRole = (
    await su.query<{ id: string }>(
      `SELECT id FROM roles WHERE tenant_id = $1 AND key = 'sales' LIMIT 1`,
      [TENANT_S],
    )
  ).rows[0];
  const roleId =
    existingRole?.id ??
    (
      await su.query<{ id: string }>(
        `INSERT INTO roles (id, tenant_id, key, name, name_ar, is_system)
         VALUES (gen_random_uuid(), $1, 'sales', 'Sales', 'المبيعات', false)
         RETURNING id`,
        [TENANT_S],
      )
    ).rows[0]!.id;
  await su.query(
    `INSERT INTO memberships (id, tenant_id, user_id, role_id, status)
     VALUES (gen_random_uuid(), $1, $2, $3, 'ACTIVE')
     ON CONFLICT DO NOTHING`,
    [TENANT_S, id, roleId],
  );
  await su.end();
  return id;
}

async function outboxCount(filter: { recipient: string; channel?: string }): Promise<number> {
  return withTenant(TENANT_S, async (tx) => {
    const rows = await tx.execute(
      sql`SELECT count(*)::int AS n FROM outbound_messages
          WHERE recipient = ${filter.recipient}
            AND (${filter.channel ?? null}::text IS NULL OR channel = ${filter.channel ?? null}::text)`,
    );
    return (rows.rows as unknown as { n: number }[])[0]!.n;
  });
}

async function inboxCount(userId: string, category: string): Promise<number> {
  return withTenant(TENANT_S, async (tx) => {
    const rows = await tx.execute(
      sql`SELECT count(*)::int AS n FROM notifications
          WHERE user_id = ${userId} AND category = ${category}`,
    );
    return (rows.rows as unknown as { n: number }[])[0]!.n;
  });
}

beforeAll(async () => {
  await setupSalesFixture();
  optoutUserId = await seedUserWithMembership(OPTOUT_EMAIL, "+966501234599");
  optinUserId = await seedUserWithMembership(OPTIN_EMAIL, "+966501234598");
});

describe("PHASE-041 preferences — the tenant defaults", () => {
  it("materializes lazily for tenants provisioned after 0064 (15 modules × 4 channels, paid channels off)", async () => {
    await withTenant(TENANT_S, () => preferences.ensureDefaults());
    const defaults = await withTenant(TENANT_S, () => preferences.listDefaults());
    expect(defaults.length).toBe(60);
    const digestEmail = defaults.find((row) => row.module === "digest" && row.channel === "EMAIL");
    expect(digestEmail?.enabled).toBe(true);
    const digestSms = defaults.find((row) => row.module === "digest" && row.channel === "SMS");
    expect(digestSms?.enabled).toBe(false);
  });

  it("upserts tenant-default rows (the defaults plane) and the resolver honors them", async () => {
    await withTenant(TENANT_S, () =>
      preferences.upsertDefault(S_ACTOR, { module: "digest", channel: "EMAIL", enabled: false }),
    );
    const decision = await withTenant(TENANT_S, () =>
      preferences.resolveChannels(optinUserId, "digest"),
    );
    expect(decision.EMAIL).toBe(false); // the tenant default overrides the code default
    // Restore for the later dispatch tests.
    await withTenant(TENANT_S, () =>
      preferences.upsertDefault(S_ACTOR, { module: "digest", channel: "EMAIL", enabled: true }),
    );
  });
});

describe("PHASE-041 preferences — the dispatch resolver honors the matrix (acceptance §6.4)", () => {
  it("an opted-OUT user receives NOTHING on that channel while identical events deliver on opted-in channels", async () => {
    // User A opts out of invoice_overdue × EMAIL (the self plane).
    await withTenant(TENANT_S, () =>
      preferences.upsertSelf(optoutUserId, {
        module: "invoice_overdue",
        channel: "EMAIL",
        enabled: false,
      }),
    );

    const dispatch = (userId: string) =>
      withTenant(TENANT_S, () =>
        preferences.dispatchUserNotification({
          userId,
          module: "invoice_overdue",
          templateKey: "nudge.invoice_due",
          severity: "warning",
          title: { ar: "اقترب استحقاق الفاتورة", en: "Invoice due soon" },
          dedupeKey: `prefs-spec:${userId}`,
          variables: {
            customer_name: "شركة الأمل",
            invoice_number: "INV-PREFS-1",
            amount_due: "250.00 SAR",
            due_date: "2026-11-20",
            body_ar: "الفاتورة INV-PREFS-1 تستحق قريباً",
            body_en: "Invoice INV-PREFS-1 is due soon",
          },
          sourceType: "NOTIFICATION",
        }),
      );

    // The opted-out user: EMAIL suppressed; IN_APP still delivers (the
    // opt-out was EMAIL only — identical events ride opted-in channels).
    const outcomeA = await dispatch(optoutUserId);
    expect(outcomeA.email).toBe("suppressed");
    expect(outcomeA.inApp).toBe(true);
    expect(await outboxCount({ recipient: OPTOUT_EMAIL, channel: "EMAIL" })).toBe(0);
    expect(await inboxCount(optoutUserId, "invoice_overdue")).toBe(1);

    // The opted-in user (defaults): EMAIL enqueued through the port +
    // IN_APP delivered.
    const outcomeB = await dispatch(optinUserId);
    expect(outcomeB.email).toBe("enqueued");
    expect(outcomeB.inApp).toBe(true);
    expect(await outboxCount({ recipient: OPTIN_EMAIL, channel: "EMAIL" })).toBe(1);
    expect(await inboxCount(optinUserId, "invoice_overdue")).toBe(1);

    // The enqueued EMAIL row carries the rendered template + source.
    const row = await withTenant(TENANT_S, async (tx) => {
      const rows = await tx.execute(
        sql`SELECT status, subject, source_type AS "sourceType",
                   recipient_user_id AS "recipientUserId"
            FROM outbound_messages
            WHERE recipient = ${OPTIN_EMAIL}
            ORDER BY created_at DESC LIMIT 1`,
      );
      return (rows.rows as unknown as Record<string, string | null>[])[0];
    });
    expect(row).toMatchObject({
      status: "QUEUED",
      sourceType: "NOTIFICATION",
      recipientUserId: optinUserId,
    });
    expect(row!.subject).toContain("INV-PREFS-1");
  });

  it("the matrix read exposes the explicit user rows (the UI shape)", async () => {
    const matrix = await withTenant(TENANT_S, () => preferences.matrixForUser(optoutUserId));
    const invoiceRow = matrix.find((row) => row.module === "invoice_overdue");
    expect(invoiceRow).toBeDefined();
    expect(invoiceRow!.channels.EMAIL).toBe(false);
    expect(invoiceRow!.channels.IN_APP).toBe(true);
    expect(invoiceRow!.explicit).toBe(true);
    // The code default shows through where no row exists (SMS off — the
    // paid-channels-off discipline).
    expect(invoiceRow!.channels.SMS).toBe(CODE_DEFAULTS.SMS);
  });
});
