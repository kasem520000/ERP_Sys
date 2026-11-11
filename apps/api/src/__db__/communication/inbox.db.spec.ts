import { beforeAll, describe, expect, it } from "vitest";

import { withTenant } from "../../infra/db/tenant-context";
import { InboxService } from "../../modules/notifications/application/inbox-service";
import { OutboxService } from "../../modules/communication/application/outbox/outbox-service";
import { ProviderConfigService } from "../../modules/communication/application/provider-config.service";
import { UnifiedInboxService } from "../../modules/communication/application/inbox-service";
import { CallLogInvalidError } from "../../modules/communication/domain/communication-errors";
import { S_ACTOR, TENANT_S, setupSalesFixture } from "../sales/fixtures";

/**
 * PHASE-041 · the unified inbox DB suite (T-08; acceptance §6.7):
 * messages and logged calls list per partner with filters (kind/channel/
 * direction/date); a logged call persists outcome/duration and links
 * partner + user; entries are editable by their logger only (log
 * semantics — no deletes).
 */

const notifications = new InboxService();
const providers = new ProviderConfigService();
const outbox = new OutboxService(providers, notifications);
const inbox = new UnifiedInboxService();

let partnerA = "";
let partnerB = "";

beforeAll(async () => {
  await setupSalesFixture();
  await withTenant(TENANT_S, async () => {
    const { findPartnerByCode, insertPartner } = await import(
      "../../modules/partners/infrastructure/partners.store"
    );
    for (const [code, name] of [
      ["S-CUST-INBX-A", "Inbox Partner A"],
      ["S-CUST-INBX-B", "Inbox Partner B"],
    ] as const) {
      const existing = await findPartnerByCode(code);
      const id =
        existing?.id ??
        (
          await insertPartner({
            kind: "CUSTOMER",
            code,
            name,
            nameAr: null,
            taxNumber: null,
            creditLimit: null,
            creditTermsId: null,
            priceListId: null,
          })
        ).id;
      if (code.endsWith("A")) {
        partnerA = id;
      } else {
        partnerB = id;
      }
    }
  });
});

describe("PHASE-041 unified inbox — the per-partner timeline with filters", () => {
  it("mixes outbound messages and logged calls per partner, ordered newest-first", async () => {
    // One outbound EMAIL message (projected into the log at enqueue) +
    // one logged call for partner A.
    await withTenant(TENANT_S, () =>
      outbox.enqueue({
        channel: "EMAIL",
        recipient: "inbox-a@comm.test",
        locale: "ar",
        templateKey: "dunning.step1",
        module: "collections",
        subject: "تذكير",
        body: "محتوى الرسالة",
        partnerId: partnerA,
        sourceType: "MANUAL",
      }),
    );
    const call = await withTenant(TENANT_S, () =>
      inbox.logCall({
        actorId: S_ACTOR,
        partnerId: partnerA,
        direction: "INBOUND",
        outcome: "COMPLETED",
        summary: "مكالمة متابعة",
        body: "وعد بالسداد خلال أسبوع",
        durationMinutes: 12,
      }),
    );
    expect(call).toMatchObject({
      kind: "CALL",
      direction: "INBOUND",
      channel: "CALL",
      partnerId: partnerA,
      userId: S_ACTOR,
      outcome: "COMPLETED",
      durationMinutes: 12,
      summary: "مكالمة متابعة",
    });

    const timeline = await withTenant(TENANT_S, () => inbox.list({ partnerId: partnerA }));
    expect(timeline.length).toBeGreaterThanOrEqual(2);
    const kinds = new Set(timeline.map((entry) => entry.kind));
    expect(kinds.has("MESSAGE")).toBe(true);
    expect(kinds.has("CALL")).toBe(true);

    // The filters: kind=CALL narrows to the call; direction=OUTBOUND to
    // the message; partner scoping excludes B entirely.
    const callsOnly = await withTenant(TENANT_S, () =>
      inbox.list({ partnerId: partnerA, kind: "CALL" }),
    );
    expect(callsOnly).toHaveLength(1);
    expect(callsOnly[0]!.id).toBe(call.id);
    const outboundOnly = await withTenant(TENANT_S, () =>
      inbox.list({ partnerId: partnerA, direction: "OUTBOUND" }),
    );
    expect(outboundOnly.every((entry) => entry.direction === "OUTBOUND")).toBe(true);
    expect(outboundOnly.some((entry) => entry.kind === "MESSAGE")).toBe(true);

    // Partner B's timeline sees none of A's interactions (RLS + scoping).
    const timelineB = await withTenant(TENANT_S, () => inbox.list({ partnerId: partnerB }));
    expect(timelineB).toHaveLength(0);
  });

  it("validates the call-entry shape (typed errors, never silent)", async () => {
    await expect(
      withTenant(TENANT_S, () =>
        inbox.logCall({
          actorId: S_ACTOR,
          partnerId: partnerA,
          direction: "INBOUND",
          outcome: "COMPLETED",
          summary: "   ",
        }),
      ),
    ).rejects.toMatchObject({ code: "communication/call-log-invalid" });
    await expect(
      withTenant(TENANT_S, () =>
        inbox.logCall({
          actorId: S_ACTOR,
          partnerId: partnerA,
          direction: "INBOUND",
          outcome: "COMPLETED",
          summary: "x",
          durationMinutes: 5000,
        }),
      ),
    ).rejects.toBeInstanceOf(CallLogInvalidError);
  });

  it("entries are editable by their LOGGER only (log semantics, no deletes)", async () => {
    const entry = await withTenant(TENANT_S, () =>
      inbox.logCall({
        actorId: S_ACTOR,
        partnerId: partnerA,
        direction: "OUTBOUND",
        outcome: "NO_ANSWER",
        summary: "محاولة اتصال أولى",
        durationMinutes: null,
      }),
    );
    const updated = await withTenant(TENANT_S, () =>
      inbox.updateCall(entry.id, S_ACTOR, {
        outcome: "COMPLETED",
        summary: "تم التواصل",
        durationMinutes: 5,
      }),
    );
    expect(updated).toMatchObject({
      id: entry.id,
      outcome: "COMPLETED",
      summary: "تم التواصل",
      durationMinutes: 5,
    });
    // A different user cannot edit another logger's entry.
    await expect(
      withTenant(TENANT_S, () =>
        inbox.updateCall(entry.id, "00000000-0000-4000-8000-000000000999", {
          summary: "تلاعب",
        }),
      ),
    ).rejects.toMatchObject({ code: "communication/call-log-invalid" });
  });
});
