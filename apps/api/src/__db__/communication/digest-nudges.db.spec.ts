import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { withTenant } from "../../infra/db/tenant-context";
import { getDb } from "../../infra/db/client";
import { superuserClient } from "../test-db";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import { OutboxService } from "../../modules/communication/application/outbox/outbox-service";
import { ProviderConfigService } from "../../modules/communication/application/provider-config.service";
import { TemplateService } from "../../modules/communication/application/template-service";
import { PreferencesService } from "../../modules/communication/application/preferences-service";
import {
  DigestService,
  NudgeService,
} from "../../modules/communication/application/digest-service";
import {
  S_ACTOR,
  S_SALES,
  TENANT_S,
  salesInvoices,
  setupSalesFixture,
  type SalesFixture,
} from "../sales/fixtures";

/**
 * PHASE-041 · the digest + nudge DB suite (T-07; acceptance §6.5/§6.6):
 * the fixture-based daily digest renders the per-user "needs attention
 * today" set (overdue invoices, pending approvals, low stock, expiring
 * warranties) in AR/EN from templates honoring preferences; the proactive
 * nudge fires EXACTLY ONCE at the configured lead time — early/late/
 * duplicate firings fail the spec.
 */

const inbox = new InboxService();
const providers = new ProviderConfigService();
const templates = new TemplateService();
const outbox = new OutboxService(providers, inbox);
const preferences = new PreferencesService(outbox, templates, inbox);
const digest = new DigestService(preferences);
const nudges = new NudgeService(preferences, templates, outbox);

let fixture: SalesFixture;
let nudgeCustomerId = "";
let digestUserId = "";
const DIGEST_EMAIL = "digest-user@comm.test";

function isoDate(offsetDays: number): string {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() + offsetDays);
  return now.toISOString().slice(0, 10);
}

async function seedDigestUser(): Promise<string> {
  const su = await superuserClient();
  const existing = (
    await su.query<{ id: string }>(
      `SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1`,
      [DIGEST_EMAIL],
    )
  ).rows[0];
  const id =
    existing?.id ??
    (
      await su.query<{ id: string }>(
        `INSERT INTO users (id, email, full_name, password_hash, status, locale)
         VALUES (gen_random_uuid(), $1, 'Digest User', 'x', 'ACTIVE', 'ar')
         RETURNING id`,
        [DIGEST_EMAIL],
      )
    ).rows[0]!.id;
  // The membership FK is composite — a TENANT-scoped role row
  // (find-or-create, the provisioning clone pattern).
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

beforeAll(async () => {
  fixture = await setupSalesFixture();
  await withTenant(TENANT_S, async () => {
    const { findPartnerByCode, insertPartner, insertPartnerContact } = await import(
      "../../modules/partners/infrastructure/partners.store"
    );
    const existing = await findPartnerByCode("S-CUST-NUDGE");
    nudgeCustomerId =
      existing?.id ??
      (
        await insertPartner({
          kind: "CUSTOMER",
          code: "S-CUST-NUDGE",
          name: "Nudge Customer",
          nameAr: "عميل التنبيهات",
          taxNumber: null,
          creditLimit: null,
          creditTermsId: null,
          priceListId: null,
        })
      ).id;
    await insertPartnerContact({
      partnerId: nudgeCustomerId,
      name: "Nudge AP",
      phone: "+966501110003",
      email: "ap@nudge-customer.test",
      role: null,
      isPrimary: true,
    });
  });
  digestUserId = await seedDigestUser();
  await withTenant(TENANT_S, () => preferences.ensureDefaults());
});

async function postedInvoice(
  note: string,
  amount: string,
  dueDate: string,
): Promise<string> {
  const created = await withTenant(TENANT_S, () =>
    salesInvoices.create({
      branchId: fixture.branchId,
      customerId: nudgeCustomerId,
      salesRepId: null,
      kind: "CREDIT",
      invoiceDate: isoDate(-10),
      dueDate,
      currencyCode: "SAR",
      exchangeRate: null,
      orderId: null,
      deliveryId: null,
      warehouseId: null,
      cashAccountId: null,
      note,
      noteAr: null,
      actorId: S_SALES,
      lines: [
        {
          itemId: null,
          accountId: fixture.gl.serviceAccount,
          deliveryLineId: null,
          description: "nudge substrate charge",
          descriptionAr: null,
          qty: "1",
          unitPrice: amount,
          discountAmount: null,
          taxCodeId: fixture.taxCodeIds.notSubject,
          batchId: null,
          serialIds: null,
          note: null,
        },
      ],
    }),
  );
  await withTenant(TENANT_S, () => salesInvoices.submit(created.id, S_SALES));
  await withTenant(TENANT_S, () => salesInvoices.approve(created.id, S_ACTOR, false));
  await withTenant(TENANT_S, () => salesInvoices.post(created.id, S_ACTOR));
  return created.id;
}

// -- (a) the daily digest (PP-13, acceptance §6.5) ------------------------------

describe("PHASE-041 digest — the per-user needs-attention set (AR from templates)", () => {
  it("renders the four aggregates and delivers through the preference-aware resolver", async () => {
    // One OVERDUE invoice drives the overdue count (the other fixture
    // invoices add more — the assertion is a floor, not an exact count).
    await postedInvoice("digest-overdue", "120.00", isoDate(-5));

    const counts = await withTenant(TENANT_S, () => digest.attentionCounts());
    expect(counts.overdueInvoices).toBeGreaterThanOrEqual(1);
    expect(counts.pendingApprovals).toBeGreaterThanOrEqual(0);
    expect(counts.lowStockItems).toBeGreaterThanOrEqual(0);
    expect(counts.expiringWarranties).toBeGreaterThanOrEqual(0);

    const before = await withTenant(TENANT_S, async (tx) => {
      const rows = await tx.execute(
        sql`SELECT count(*)::int AS n FROM outbound_messages
            WHERE source_type = 'DIGEST' AND recipient = ${DIGEST_EMAIL}`,
      );
      return (rows.rows as unknown as { n: number }[])[0]!.n;
    });
    const outcome = await withTenant(TENANT_S, () => digest.runDigest());
    expect(outcome.delivered).toBeGreaterThanOrEqual(1);
    const after = await withTenant(TENANT_S, async (tx) => {
      const rows = await tx.execute(
        sql`SELECT count(*)::int AS n, max(body_snapshot) AS body
            FROM outbound_messages
            WHERE source_type = 'DIGEST' AND recipient = ${DIGEST_EMAIL}`,
      );
      return (rows.rows as unknown as { n: number; body: string }[])[0]!;
    });
    expect(after!.n).toBe(before + 1);
    // The AR render (the user's locale) carries the counts.
    expect(after!.body).toContain("فواتير متأخرة");
  });

  it("a user opting out of digest×EMAIL receives NOTHING (the preference contract)", async () => {
    await withTenant(TENANT_S, () =>
      preferences.upsertSelf(digestUserId, {
        module: "digest",
        channel: "EMAIL",
        enabled: false,
      }),
    );
    const before = await withTenant(TENANT_S, async (tx) => {
      const rows = await tx.execute(
        sql`SELECT count(*)::int AS n FROM outbound_messages
            WHERE source_type = 'DIGEST' AND recipient = ${DIGEST_EMAIL}`,
      );
      return (rows.rows as unknown as { n: number }[])[0]!.n;
    });
    const outcome = await withTenant(TENANT_S, () => digest.runDigest());
    expect(outcome.delivered).toBe(0);
    const after = await withTenant(TENANT_S, async (tx) => {
      const rows = await tx.execute(
        sql`SELECT count(*)::int AS n FROM outbound_messages
            WHERE source_type = 'DIGEST' AND recipient = ${DIGEST_EMAIL}`,
      );
      return (rows.rows as unknown as { n: number }[])[0]!.n;
    });
    expect(after).toBe(before);
  });
});

// -- (b) the proactive nudges (PP-15, acceptance §6.6) ---------------------------

describe("PHASE-041 nudges — exactly once at the configured lead time", () => {
  it("fires the invoice-due nudge ONCE at the lead time; early and duplicate firings never happen", async () => {
    // Configure the lead time: 3 days (the tenant setting).
    await withTenant(TENANT_S, async (tx) => {
      await tx.execute(sql`
        INSERT INTO tenant_settings (id, tenant_id, key, value, updated_by)
        VALUES (gen_random_uuid(), erp.current_tenant_id(), 'communication.nudges',
                ${JSON.stringify({ invoiceDue: 3, taskDue: 1, contractRenewal: 30 })}::jsonb, ${S_ACTOR})
        ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value`);
    });
    const lead = await withTenant(TENANT_S, () => nudges.leadTimes());
    expect(lead.invoiceDue).toBe(3);

    // The due-in-exactly-3-days invoice + the not-yet-due (5 days) control.
    const dueInvoiceId = await postedInvoice("nudge-due-3d", "80.00", isoDate(3));
    const earlyInvoiceId = await postedInvoice("nudge-due-5d", "90.00", isoDate(5));

    const run1 = await withTenant(TENANT_S, () => nudges.runInvoiceDueNudges());
    expect(run1.fired).toBeGreaterThanOrEqual(1);

    const rows = await withTenant(TENANT_S, async (tx) => {
      const result = await tx.execute(
        sql`SELECT source_id AS "sourceId" FROM outbound_messages WHERE source_type = 'NUDGE'`,
      );
      return result.rows as unknown as { sourceId: string }[];
    });
    const nudgedIds = new Set(rows.map((row) => row.sourceId));
    expect(nudgedIds.has(dueInvoiceId)).toBe(true); // exactly at the lead time
    expect(nudgedIds.has(earlyInvoiceId)).toBe(false); // EARLY firing never happens
    expect(nudgedIds.size).toBe(new Set(rows.map((r) => r.sourceId)).size);

    // DUPLICATE firing never happens (the source-linkage probe).
    const run2 = await withTenant(TENANT_S, () => nudges.runInvoiceDueNudges());
    expect(run2.fired).toBe(0);
    expect(run2.skipped).toBeGreaterThanOrEqual(1);
    const count = await withTenant(TENANT_S, async (tx) => {
      const result = await tx.execute(
        sql`SELECT count(*)::int AS n FROM outbound_messages
            WHERE source_type = 'NUDGE' AND source_id = ${dueInvoiceId}`,
      );
      return (result.rows as unknown as { n: number }[])[0]!.n;
    });
    expect(count).toBe(1);
  });

  it("task-due nudges reach the assignee through the preference-aware resolver (once per task)", async () => {
    // Re-enable digest user's crm EMAIL (default on) + seed a task due in
    // exactly 1 day assigned to the digest user.
    await withTenant(TENANT_S, async (tx) => {
      await tx.execute(sql`
        INSERT INTO crm_tasks (id, tenant_id, title, related_type, related_id,
                               assignee_user_id, due_date, status)
        VALUES (gen_random_uuid(), erp.current_tenant_id(), 'متابعة تجديد العقد',
                'PARTNER', ${nudgeCustomerId}, ${digestUserId}, current_date + 1, 'OPEN')
        RETURNING id`);
    });
    const run1 = await withTenant(TENANT_S, () => nudges.runTaskDueNudges());
    expect(run1.fired).toBeGreaterThanOrEqual(1);
    const run2 = await withTenant(TENANT_S, () => nudges.runTaskDueNudges());
    expect(run2.fired).toBe(0);
  });
});
