import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import { withTenant } from "../../infra/db/tenant-context";
import { superuserClient } from "../test-db";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import { OutboxService } from "../../modules/communication/application/outbox/outbox-service";
import { ProviderConfigService } from "../../modules/communication/application/provider-config.service";
import { TemplateService } from "../../modules/communication/application/template-service";
import { DunningService } from "../../modules/sales/application/dunning";
import * as partnersStore from "../../modules/partners/infrastructure/partners.store";
import * as distributionStore from "../../modules/distribution/infrastructure/distribution.store";
import {
  S_ACTOR,
  S_SALES,
  TENANT_S,
  salesInvoices,
  setupSalesFixture,
  type SalesFixture,
} from "../sales/fixtures";

/**
 * PHASE-041 · the outbound pipeline DB suite (T-05; acceptance §6.3 + the
 * 036/039 dunning handoff): every send is a row on real PostgreSQL through
 * the app-role services —
 *
 * - the SANDBOX end-to-end (BR-067): a WhatsApp template-message send
 *   walks QUEUED → DELIVERED with provider reference, cost, and the
 *   communication_log projection;
 * - the retry/backoff path exactly per policy (1 → 5 minute backoff,
 *   attempts counting, terminal FAILED on exhaustion);
 * - non-retryable rejections fail immediately (the register never lies);
 * - the send-cost hard cap (typed rejection);
 * - the DUNNING HANDOFF: the 036 WHATSAP/SMS QUEUED letters now flow
 *   through the port — the sweep enqueues (letter QUEUED), the outbox
 *   delivers (SANDBOX), and the registered source handler flips the
 *   letter SENT; EMAIL letters (ladder step 2) keep the 039
 *   mark-SENT-in-step semantics backed by a REAL ledger row.
 */

const D_INVOICE_DATE = "2026-04-01";
const D_DUE_DATE = "2026-04-25";
const D_AS_OF = "2026-11-11"; // 200 days overdue → step 1 then step 2

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const inbox = new InboxService();
const providers = new ProviderConfigService();
const templates = new TemplateService();
const outbox = new OutboxService(providers, inbox);
// The PHASE-041 wiring: the dunning engine WITH the outbox + template
// service (the 036/039 handoff consumers).
const dunning = new DunningService(audit, posting, inbox, salesInvoices, outbox, templates);

let fixture: SalesFixture;
let commCustomerId = "";
let commTierId = "";

/** A scripted fake port for the retry-path injections. */
function scriptedPort(
  results: Array<{ ok: boolean; retryable?: boolean; error?: string; delivered?: boolean }>,
) {
  let call = 0;
  return {
    id: "fake-scripted",
    kind: "WHATSAPP" as const,
    send: async () => {
      const result = results[Math.min(call, results.length - 1)]!;
      call += 1;
      return result;
    },
  };
}

beforeAll(async () => {
  fixture = await setupSalesFixture();
  await withTenant(TENANT_S, async () => {
    // A DEDICATED customer (the shared dunning partners stay untouched —
    // the 039 spec's discipline) with BOTH an email and a phone contact.
    const existing = await partnersStore.findPartnerByCode("S-CUST-COMM");
    commCustomerId =
      existing?.id ??
      (
        await partnersStore.insertPartner({
          kind: "CUSTOMER",
          code: "S-CUST-COMM",
          name: "Communications Customer",
          nameAr: "عميل الاتصالات",
          taxNumber: null,
          creditLimit: null,
          creditTermsId: null,
          priceListId: null,
        })
      ).id;
    await partnersStore.insertPartnerContact({
      partnerId: commCustomerId,
      name: "Communications AP",
      phone: "+966501110002",
      email: "ap@comm-customer.test",
      role: null,
      isPrimary: true,
    });
    const existingTier = await distributionStore.findTierByCode("S-TIER-COMM");
    commTierId =
      existingTier?.id ??
      (
        await distributionStore.insertTier({
          code: "S-TIER-COMM",
          name: "Communications test tier",
          nameAr: "فئة اختبار الاتصالات",
          priceListId: null,
          discountCapPct: null,
          visitFrequencyDays: null,
          note: null,
          noteAr: null,
          createdBy: S_ACTOR,
        })
      ).id;
    await partnersStore.updatePartnerTier(commCustomerId, commTierId);
  });
});

/** A freshly POSTED overdue invoice on the dedicated customer. */
async function postedOverdueInvoice(note: string, amount: string): Promise<string> {
  const created = await withTenant(TENANT_S, () =>
    salesInvoices.create({
      branchId: fixture.branchId,
      customerId: commCustomerId,
      salesRepId: null,
      kind: "CREDIT",
      invoiceDate: D_INVOICE_DATE,
      dueDate: D_DUE_DATE,
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
          description: "communications substrate charge",
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

async function outboxRow(id: string): Promise<Record<string, unknown> | undefined> {
  return withTenant(TENANT_S, async (tx) => {
    const rows = await tx.execute(
      sql`SELECT id, channel, status, recipient, provider, provider_ref AS "providerRef",
                 cost_amount AS "costAmount", cost_currency AS "costCurrency", attempts,
                 next_attempt_at AS "nextAttemptAt", last_error AS "lastError",
                 sent_at AS "sentAt", delivered_at AS "deliveredAt",
                 source_type AS "sourceType", source_id AS "sourceId"
          FROM outbound_messages WHERE id = ${id}`,
    );
    return (rows.rows as unknown as Record<string, unknown>[])[0];
  });
}

// -- (a) the SANDBOX end-to-end (BR-067, acceptance §6.3) ----------------------

describe("PHASE-041 outbox — the SANDBOX end-to-end", () => {
  it("walks QUEUED → DELIVERED with provider ref, cost, and the communication_log projection", async () => {
    const sourceEvents: string[] = [];
    outbox.registerSourceHandler("MANUAL", (event) => {
      sourceEvents.push(`${event.status}:${event.sourceId}`);
      return Promise.resolve();
    });
    const { id } = await withTenant(TENANT_S, () =>
      outbox.enqueue({
        channel: "WHATSAPP",
        recipient: "+966501234567",
        locale: "ar",
        templateKey: "dunning.step1",
        module: "collections",
        body: "مرحباً شركة الأمل، تذكير بمستحقاتكم.",
        partnerId: commCustomerId,
        sourceType: "MANUAL",
        sourceId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0001",
        whatsappTemplateName: "dunning.step1",
        whatsappTemplateParams: ["شركة الأمل", "INV-1", "100.00 SAR"],
      }),
    );
    let row = await outboxRow(id);
    expect(row).toMatchObject({ status: "QUEUED", channel: "WHATSAPP", attempts: 0 });

    const processed = await withTenant(TENANT_S, () => outbox.processDue());
    expect(processed.processed).toBeGreaterThanOrEqual(1);
    expect(processed.delivered).toBeGreaterThanOrEqual(1);

    row = await outboxRow(id);
    expect(row).toMatchObject({
      status: "DELIVERED",
      provider: "sandbox",
      attempts: 1,
    });
    expect(String(row!.providerRef)).toMatch(/^sandbox-[0-9a-f-]{36}$/);
    expect(row!.costAmount).toBe("0.0000");
    expect(row!.costCurrency).toBe("SAR");
    expect(row!.sentAt).not.toBeNull();
    expect(row!.deliveredAt).not.toBeNull();

    // The source handler fired on the terminal transition.
    expect(sourceEvents).toContain("DELIVERED:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeee0001");

    // The communication_log projection (the unified inbox's timeline entry).
    const logRows = await withTenant(TENANT_S, async (tx) => {
      const rows = await tx.execute(
        sql`SELECT kind, direction, channel, partner_id AS "partnerId",
                   outbound_message_id AS "outboundMessageId"
            FROM communication_log WHERE outbound_message_id = ${id}`,
      );
      return rows.rows as unknown as Record<string, unknown>[];
    });
    expect(logRows).toHaveLength(1);
    expect(logRows[0]).toMatchObject({
      kind: "MESSAGE",
      direction: "OUTBOUND",
      channel: "WHATSAPP",
      partnerId: commCustomerId,
    });
  });

  it("validates recipients and the WhatsApp template-message requirement (fail-closed)", async () => {
    await expect(
      withTenant(TENANT_S, () =>
        outbox.enqueue({
          channel: "SMS",
          recipient: "0501234567",
          locale: "ar",
          templateKey: "dunning.step1",
          module: "collections",
          body: "x",
        }),
      ),
    ).rejects.toMatchObject({ code: "communication/outbox-recipient-invalid" });
    await expect(
      withTenant(TENANT_S, () =>
        outbox.enqueue({
          channel: "WHATSAPP",
          recipient: "+966501234567",
          locale: "ar",
          templateKey: "dunning.step1",
          module: "collections",
          body: "x",
        }),
      ),
    ).rejects.toMatchObject({ code: "communication/outbox-whatsapp-template-required" });
  });
});

// -- (b) the retry/backoff path (acceptance §6.3's FAILED injection) -----------

describe("PHASE-041 outbox — retry with backoff", () => {
  it("requeues retryable failures with the 1→5 minute backoff, then delivers on recovery", async () => {
    // ONE scripted port instance across attempts (the counter must
    // persist across the three processDue calls).
    const port = scriptedPort([
      { ok: false, retryable: true, error: "whatsapp-http-503:upstream" },
      { ok: false, retryable: true, error: "whatsapp-http-503:upstream" },
      { ok: true, delivered: true },
    ]);
    const scripted = new OutboxService(
      {
        resolveChannelPort: async () => port,
        dailySendCap: async () => undefined,
      } as unknown as ProviderConfigService,
      null,
    );
    const { id } = await withTenant(TENANT_S, () =>
      outbox.enqueue({
        channel: "WHATSAPP",
        recipient: "+966501234568",
        locale: "ar",
        templateKey: "dunning.step1",
        module: "collections",
        body: "retry probe",
        whatsappTemplateName: "dunning.step1",
        whatsappTemplateParams: [],
      }),
    );

    // Attempt 1: retryable failure → QUEUED + the 1-minute backoff.
    await withTenant(TENANT_S, () => scripted.processDue(10));
    let row = await outboxRow(id);
    expect(row).toMatchObject({
      status: "QUEUED",
      attempts: 1,
      lastError: "whatsapp-http-503:upstream",
    });
    expect(row!.nextAttemptAt).not.toBeNull();

    // Not due yet (next_attempt_at in the future): the sweep skips it.
    const idle = await withTenant(TENANT_S, () => scripted.processDue(10));
    expect(idle.processed).toBe(0);

    // Simulate elapsed time: force-due, attempt 2 → the 5-minute backoff.
    await withTenant(TENANT_S, (tx) =>
      tx.execute(
        sql`UPDATE outbound_messages SET next_attempt_at = now() - interval '1 second' WHERE id = ${id}`,
      ),
    );
    await withTenant(TENANT_S, () => scripted.processDue(10));
    row = await outboxRow(id);
    expect(row).toMatchObject({ status: "QUEUED", attempts: 2 });

    // Attempt 3: recovery → DELIVERED (attempts 3, evidence stamped).
    await withTenant(TENANT_S, (tx) =>
      tx.execute(
        sql`UPDATE outbound_messages SET next_attempt_at = now() - interval '1 second' WHERE id = ${id}`,
      ),
    );
    await withTenant(TENANT_S, () => scripted.processDue(10));
    row = await outboxRow(id);
    expect(row).toMatchObject({ status: "DELIVERED", attempts: 3, provider: "fake-scripted" });
  });

  it("non-retryable rejections fail IMMEDIATELY (the register never lies)", async () => {
    const scripted = new OutboxService(
      {
        resolveChannelPort: async () =>
          scriptedPort([{ ok: false, retryable: false, error: "whatsapp-http-400:template not found" }]),
        dailySendCap: async () => undefined,
      } as unknown as ProviderConfigService,
      null,
    );
    const { id } = await withTenant(TENANT_S, () =>
      outbox.enqueue({
        channel: "WHATSAPP",
        recipient: "+966501234569",
        locale: "ar",
        templateKey: "dunning.step1",
        module: "collections",
        body: "rejection probe",
        whatsappTemplateName: "dunning.step1",
        whatsappTemplateParams: [],
      }),
    );
    await withTenant(TENANT_S, () => scripted.processDue(10));
    const row = await outboxRow(id);
    expect(row).toMatchObject({
      status: "FAILED",
      attempts: 1,
      lastError: "whatsapp-http-400:template not found",
    });
    expect(row!.sentAt).toBeNull();
  });

  it("exhausted retries end FAILED with the last error (maxAttempts respected)", async () => {
    const scripted = new OutboxService(
      {
        resolveChannelPort: async () =>
          scriptedPort([{ ok: false, retryable: true, error: "whatsapp-network:ECONNRESET" }]),
        dailySendCap: async () => undefined,
      } as unknown as ProviderConfigService,
      null,
    );
    const { id } = await withTenant(TENANT_S, () =>
      outbox.enqueue({
        channel: "WHATSAPP",
        recipient: "+966501234570",
        locale: "ar",
        templateKey: "dunning.step1",
        module: "collections",
        body: "exhaustion probe",
        maxAttempts: 2,
        whatsappTemplateName: "dunning.step1",
        whatsappTemplateParams: [],
      }),
    );
    // Attempt 1 → requeued; attempt 2 → exhausted → FAILED.
    await withTenant(TENANT_S, () => scripted.processDue(10));
    await withTenant(TENANT_S, (tx) =>
      tx.execute(
        sql`UPDATE outbound_messages SET next_attempt_at = now() - interval '1 second' WHERE id = ${id}`,
      ),
    );
    await withTenant(TENANT_S, () => scripted.processDue(10));
    const row = await outboxRow(id);
    expect(row).toMatchObject({
      status: "FAILED",
      attempts: 2,
      lastError: "whatsapp-network:ECONNRESET",
    });
  });
});

// -- (c) the send-cost hard cap -------------------------------------------------

describe("PHASE-041 outbox — the daily send cap", () => {
  it("rejects past the configured cap with the typed error", async () => {
    // Configure a cap of exactly today's count + 1 via the real settings
    // service (the sealed write path), then overflow it.
    const todayCount = await withTenant(TENANT_S, async (tx) => {
      const rows = await tx.execute(
        sql`SELECT count(*)::int AS n FROM outbound_messages
            WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')`,
      );
      return (rows.rows as unknown as { n: number }[])[0]!.n;
    });
    await withTenant(TENANT_S, () =>
      providers.updateConfig(S_ACTOR, { sendCap: { dailyHardCap: todayCount + 1 } }),
    );
    // Fill to the cap.
    await withTenant(TENANT_S, () =>
      outbox.enqueue({
        channel: "SMS",
        recipient: "+966501234571",
        locale: "ar",
        templateKey: "dunning.step1",
        module: "collections",
        body: "cap probe",
      }),
    );
    // One past the cap → typed rejection.
    await expect(
      withTenant(TENANT_S, () =>
        outbox.enqueue({
          channel: "SMS",
          recipient: "+966501234572",
          locale: "ar",
          templateKey: "dunning.step1",
          module: "collections",
          body: "cap overflow probe",
        }),
      ),
    ).rejects.toMatchObject({ code: "communication/send-cap-exceeded" });
    // Cleanup: clear the cap so later suites run uncapped.
    await withTenant(TENANT_S, () =>
      providers.updateConfig(S_ACTOR, { sendCap: { dailyHardCap: null } }),
    );
  });
});

// -- (d) the 036/039 DUNNING HANDOFF (the phase's first live consumer) ----------

describe("PHASE-041 dunning — the letters ride the port (the 036/039 handoff)", () => {
  it("WHATSAPP step 1: sweep enqueues (letter QUEUED) → outbox delivers → the hook flips the letter SENT; EMAIL step 2 keeps the 039 in-step semantics with a REAL ledger row", async () => {
    // A tier-scoped WHATSAPP→EMAIL ladder on the dedicated customer.
    const policy = await withTenant(TENANT_S, () =>
      dunning.createPolicy({
        name: "Communications — WhatsApp ladder",
        nameAr: "الاتصالات — سلّم واتساب",
        partnerTierIds: [commTierId],
        isDefault: false,
        steps: [
          { stepNo: 1, daysOverdue: 7, channel: "WHATSAPP", templateKey: "dunning.step1" },
          { stepNo: 2, daysOverdue: 30, channel: "EMAIL", templateKey: "dunning.step2" },
        ],
        lateFeeMode: "DISABLED",
        lateFeeRatePct: null,
        lateFeeGraceDays: 0,
        lateFeeMaxAmount: null,
        lateFeeSource: null,
        note: null,
        noteAr: null,
        actorId: S_ACTOR,
      }),
    );
    await withTenant(TENANT_S, () => dunning.activatePolicy(policy.id, S_ACTOR));
    const invoiceId = await postedOverdueInvoice("comm-handoff", "75.00");

    // Sweep 1: letter 1 fires on the WHATSAPP channel (letter QUEUED —
    // the 036 semantics) + the outbox row exists (the 041 delivery).
    const sweep1 = await withTenant(TENANT_S, () => dunning.runSweep({ asOf: D_AS_OF }));
    expect(sweep1.lettersFired).toBeGreaterThanOrEqual(1);
    const step1 = await withTenant(TENANT_S, async (tx) => {
      const rows = await tx.execute(
        sql`SELECT l.id, l.channel, l.status, o.id AS "outboundId", o.status AS "outboundStatus"
            FROM dunning_letters l
            LEFT JOIN outbound_messages o
              ON o.source_type = 'DUNNING_LETTER' AND o.source_id = l.id
            WHERE l.invoice_id = ${invoiceId} AND l.step_no = 1`,
      );
      return (rows.rows as unknown as Record<string, string>[])[0];
    });
    expect(step1).toMatchObject({
      channel: "WHATSAPP",
      status: "QUEUED",
      outboundStatus: "QUEUED",
    });

    // The outbox sweep (SANDBOX default): the letter flips SENT via the
    // registered source handler.
    await withTenant(TENANT_S, () => outbox.processDue(20));
    const step1After = await withTenant(TENANT_S, async (tx) => {
      const rows = await tx.execute(
        sql`SELECT l.status AS "letterStatus", o.status AS "outboundStatus",
                   o.provider_ref AS "providerRef"
            FROM dunning_letters l
            JOIN outbound_messages o
              ON o.source_type = 'DUNNING_LETTER' AND o.source_id = l.id
            WHERE l.invoice_id = ${invoiceId} AND l.step_no = 1`,
      );
      return (rows.rows as unknown as Record<string, string>[])[0];
    });
    expect(step1After).toMatchObject({
      letterStatus: "SENT",
      outboundStatus: "DELIVERED",
    });
    expect(step1After!.providerRef).toMatch(/^sandbox-/);

    // Sweep 2 (same asOf): BR-065 advances ONE step — letter 2 on EMAIL
    // (the 039 semantics: SENT in-step) + the REAL ledger row.
    const sweep2 = await withTenant(TENANT_S, () => dunning.runSweep({ asOf: D_AS_OF }));
    expect(sweep2.lettersFired).toBeGreaterThanOrEqual(1);
    const step2 = await withTenant(TENANT_S, async (tx) => {
      const rows = await tx.execute(
        sql`SELECT l.id, l.channel, l.status, l.email_to AS "emailTo",
                   o.id AS "outboundId", o.status AS "outboundStatus",
                   o.recipient AS "outboundRecipient", o.subject AS "outboundSubject"
            FROM dunning_letters l
            JOIN outbound_messages o
              ON o.source_type = 'DUNNING_LETTER' AND o.source_id = l.id
            WHERE l.invoice_id = ${invoiceId} AND l.step_no = 2`,
      );
      return (rows.rows as unknown as Record<string, string>[])[0];
    });
    expect(step2).toMatchObject({
      channel: "EMAIL",
      status: "SENT", // the 039 in-step semantics — backed by the ledger row
      emailTo: "ap@comm-customer.test",
      outboundStatus: "QUEUED", // the outbox row awaits its own sweep
      outboundRecipient: "ap@comm-customer.test",
    });
    expect(step2!.outboundSubject).toContain("فاتورة");

    // Sweep 3: nothing re-fires (BR-065 — the register holds).
    const sweep3 = await withTenant(TENANT_S, () => dunning.runSweep({ asOf: D_AS_OF }));
    expect(sweep3.lettersFired).toBe(0);
  });
});

// -- (e) RLS: the ledger is tenant-isolated (A-series spot check) ---------------

describe("PHASE-041 outbox — tenant isolation (spot check)", () => {
  it("a foreign tenant's app scope sees ZERO outbound rows", async () => {
    const su = await superuserClient();
    const other = await su.query<{ tenant_id: string }>(
      "SELECT id AS tenant_id FROM tenants WHERE id <> $1 LIMIT 1",
      [TENANT_S],
    );
    await su.end();
    const foreignTenant = other.rows[0]?.tenant_id ?? "11111111-1111-1111-1111-111111111111";
    const visible = await withTenant(foreignTenant, async (tx) => {
      const rows = await tx.execute(sql`SELECT count(*)::int AS n FROM outbound_messages`);
      return (rows.rows as unknown as { n: number }[])[0]!.n;
    });
    expect(visible).toBe(0);
  });
});
