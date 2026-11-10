import { beforeAll, afterAll, describe, expect, it } from "vitest";

import { generateUuidV7 } from "@erp/domain-core";

import { ensureTestDb, superuserClient, appClient } from "../test-db";
import { closeDb } from "../../infra/db/client";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PartnerService } from "../../modules/partners/application/partner-service";
import { PartnerNotFoundError } from "../../modules/partners/domain/partner-errors";
import { LeadService } from "../../modules/crm/application/lead-service";
import { ActivityService } from "../../modules/crm/application/activity-service";
import {
  LeadConvertedError,
  LeadLostReasonRequiredError,
  LeadMergeTargetRequiredError,
  LeadNotFoundError,
} from "../../modules/crm/domain/crm-errors";
import type { Client } from "pg";

/**
 * PHASE-019 T45 db evidence (MASTER-PLAN §2): the lead lifecycle —
 * create/PUT (NEW/QUALIFIED only), qualify, lose (reason required), and the
 * conversion flow both ways (NEW_PARTNER creates the partner through
 * PartnerService with BR-025 auto code + the contact carried; MERGE links a
 * validated existing partner) — the converted lead is immutable (typed
 * LEAD_CONVERTED on every further mutation, zero residue), all audited, no
 * ledger effects anywhere (§2: leads are not documents). The timeline read
 * (activities per lead, occurredAt DESC) and the dashboard summary (§13)
 * pin the operational reads.
 *
 * Dedicated tenant 64646464 (SAR): the leads suite owns it end to end
 * (verified unused across the repo before adoption).
 */

const TENANT_LEADS = "64646464-6464-6464-6464-646464646464";
const LEADS_ACTOR = "64646464-0000-4000-8000-000000000641";
const LEADS_OTHER_OWNER = "64646464-0000-4000-8000-000000000642";

const audit = new AuditService(new DrizzleAuditStore());
const partners = new PartnerService(audit);
const leads = new LeadService(audit, partners);
const activities = new ActivityService(audit);

/** The tenant-scoped app client (RLS world) for read assertions. */
async function leadsClient(): Promise<Client> {
  const client = await appClient();
  await client.query("SELECT set_config('erp.tenant_id', $1, false)", [TENANT_LEADS]);
  return client;
}

beforeAll(async () => {
  ensureTestDb();
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone) VALUES
       ($1, 'Tenant C45L (crm leads)', 'المستأجر ر', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_LEADS],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES
       ($1, 'c45-leads@fixture.test', 'C45 Leads Actor', 'x', 'ACTIVE'),
       ($2, 'c45-other@fixture.test', 'C45 Other Owner', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [LEADS_ACTOR, LEADS_OTHER_OWNER],
  );
  await su.end();
  // The tenant's master-data basics (UOMs) for the dashboard fixture's fee
  // item — idempotent per tenant.
  await withTenant(TENANT_LEADS, async () => {
    const { seedMasterDataBasics } = await import(
      "../../modules/tenancy/infrastructure/tenancy.store"
    );
    await seedMasterDataBasics();
  });
});

afterAll(async () => {
  await closeDb();
});

describe("lead lifecycle (MASTER-PLAN §2)", () => {
  let leadQualified: string;
  let leadLost: string;

  it("create → NEW with the intake fields; audited", async () => {
    const lead = await withTenant(TENANT_LEADS, () =>
      leads.create({
        name: "ACME Trading",
        nameAr: "شركة أكمة",
        phone: "+966500000001",
        email: "buyer@acme.test",
        company: "ACME Holding",
        source: "WEBSITE",
        ownerUserId: LEADS_ACTOR,
        note: "Inbound from the website form",
        noteAr: null,
        actorId: LEADS_ACTOR,
      }),
    );
    leadQualified = lead.id;
    expect(lead.status).toBe("NEW");
    expect(lead.source).toBe("WEBSITE");
    expect(lead.partnerId).toBeNull();
    expect(lead.convertedAt).toBeNull();

    const client = await leadsClient();
    const events = await client.query<{ action: string; actor_id: string | null }>(
      `SELECT action, actor_id FROM audit_events
        WHERE entity_type = 'lead' AND entity_id = $1 ORDER BY at`,
      [lead.id],
    );
    await client.end();
    expect(events.rows.map((row) => row.action)).toEqual(["crm.lead.created"]);
    expect(events.rows[0]!.actor_id).toBe(LEADS_ACTOR);
  });

  it("PUT edits fields while NEW; qualify → QUALIFIED (replay is a no-op)", async () => {
    const updated = await withTenant(TENANT_LEADS, () =>
      leads.update(leadQualified, { company: "ACME Holding Group" }, LEADS_ACTOR),
    );
    expect(updated.company).toBe("ACME Holding Group");
    expect(updated.status).toBe("NEW");

    const qualified = await withTenant(TENANT_LEADS, () =>
      leads.qualify(leadQualified, LEADS_ACTOR),
    );
    expect(qualified.status).toBe("QUALIFIED");

    // INV-013 legal replay: re-qualifying returns the stored row unchanged.
    const replay = await withTenant(TENANT_LEADS, () =>
      leads.qualify(leadQualified, LEADS_ACTOR),
    );
    expect(replay.status).toBe("QUALIFIED");
    expect(replay.updatedAt).toBe(qualified.updatedAt);

    // Fields stay editable while QUALIFIED (§2).
    const stillEditable = await withTenant(TENANT_LEADS, () =>
      leads.update(leadQualified, { note: "Budget confirmed" }, LEADS_ACTOR),
    );
    expect(stillEditable.note).toBe("Budget confirmed");
  });

  it("list filters: status + ownerUserId", async () => {
    const other = await withTenant(TENANT_LEADS, () =>
      leads.create({
        name: "Blue Harbor",
        nameAr: null,
        phone: null,
        email: null,
        company: null,
        source: "REFERRAL",
        ownerUserId: LEADS_OTHER_OWNER,
        note: null,
        noteAr: null,
        actorId: LEADS_ACTOR,
      }),
    );

    const byStatus = await withTenant(TENANT_LEADS, () =>
      leads.list({ status: "NEW", limit: 50 }),
    );
    expect(byStatus.map((row) => row.id)).toContain(other.id);
    expect(byStatus.find((row) => row.id === leadQualified)).toBeUndefined();

    const byOwner = await withTenant(TENANT_LEADS, () =>
      leads.list({ ownerUserId: LEADS_OTHER_OWNER, limit: 50 }),
    );
    expect(byOwner.map((row) => row.id)).toEqual([other.id]);
  });

  it("lose: reason required (typed); with reason → LOST; LOST leads are closed", async () => {
    const lost = await withTenant(TENANT_LEADS, () =>
      leads.create({
        name: "Ghost Prospects",
        nameAr: null,
        phone: null,
        email: null,
        company: null,
        source: "CALL",
        ownerUserId: null,
        note: null,
        noteAr: null,
        actorId: LEADS_ACTOR,
      }),
    );
    leadLost = lost.id;

    await expect(
      withTenant(TENANT_LEADS, () => leads.lose(leadLost, "", LEADS_ACTOR)),
    ).rejects.toMatchObject({ code: "LEAD_LOST_REASON_REQUIRED" });
    await expect(
      withTenant(TENANT_LEADS, () => leads.lose(leadLost, "x".repeat(201), LEADS_ACTOR)),
    ).rejects.toBeInstanceOf(LeadLostReasonRequiredError);

    const after = await withTenant(TENANT_LEADS, () =>
      leads.lose(leadLost, "Chose a competitor", LEADS_ACTOR),
    );
    expect(after.status).toBe("LOST");
    expect(after.lostReason).toBe("Chose a competitor");

    // LOST is closed for every guarded operation (typed LEAD_CONVERTED —
    // the stable contract; the message names the actual status).
    await expect(
      withTenant(TENANT_LEADS, () => leads.update(leadLost, { name: "X" }, LEADS_ACTOR)),
    ).rejects.toMatchObject({ code: "LEAD_CONVERTED" });
    await expect(
      withTenant(TENANT_LEADS, () =>
        leads.convert(leadLost, { mode: "NEW_PARTNER", kind: "CUSTOMER", actorId: LEADS_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(LeadConvertedError);
    await expect(
      withTenant(TENANT_LEADS, () => leads.lose(leadLost, "again", LEADS_ACTOR)),
    ).rejects.toBeInstanceOf(LeadConvertedError);
  });

  it("convert NEW_PARTNER: partner created (P-xxxxxx, contact carried), lead CONVERTED + linked + immutable, zero residue", async () => {
    const lead = await withTenant(TENANT_LEADS, () =>
      leads.create({
        name: "Sunrise Cafés",
        nameAr: "مقاهي الشروق",
        phone: "+966501112233",
        email: "ops@sunrise.test",
        company: "Sunrise Group",
        source: "CAMPAIGN",
        ownerUserId: LEADS_ACTOR,
        note: null,
        noteAr: null,
        actorId: LEADS_ACTOR,
      }),
    );
    await withTenant(TENANT_LEADS, () => leads.qualify(lead.id, LEADS_ACTOR));

    const converted = await withTenant(TENANT_LEADS, () =>
      leads.convert(lead.id, { mode: "NEW_PARTNER", kind: "CUSTOMER", actorId: LEADS_ACTOR }),
    );
    expect(converted.status).toBe("CONVERTED");
    expect(converted.partnerId).toBeTruthy();
    expect(converted.convertedAt).toBeTruthy();
    expect(converted.lostReason).toBeNull();

    // The partner: BR-025 auto code shape + the lead's identity + contact.
    const partner = await withTenant(TENANT_LEADS, () => partners.get(converted.partnerId!));
    expect(partner.code).toMatch(/^P-\d{6}$/);
    expect(partner.name).toBe("Sunrise Cafés");
    expect(partner.nameAr).toBe("مقاهي الشروق");
    expect(partner.kind).toBe("CUSTOMER");
    const contacts = await withTenant(TENANT_LEADS, () => partners.listContacts(partner.id));
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.phone).toBe("+966501112233");
    expect(contacts[0]!.email).toBe("ops@sunrise.test");
    expect(contacts[0]!.isPrimary).toBe(true);

    // Immutability: every further mutation is the typed LEAD_CONVERTED —
    // and leaves zero residue (the row is byte-identical after the throw).
    const frozen = await withTenant(TENANT_LEADS, () => leads.find(lead.id));
    await expect(
      withTenant(TENANT_LEADS, () => leads.update(lead.id, { name: "Nope" }, LEADS_ACTOR)),
    ).rejects.toMatchObject({ code: "LEAD_CONVERTED" });
    await expect(
      withTenant(TENANT_LEADS, () =>
        leads.convert(lead.id, { mode: "MERGE", partnerId: partner.id, kind: "BOTH", actorId: LEADS_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(LeadConvertedError);
    await expect(
      withTenant(TENANT_LEADS, () => leads.lose(lead.id, "late", LEADS_ACTOR)),
    ).rejects.toBeInstanceOf(LeadConvertedError);
    const afterThrows = await withTenant(TENANT_LEADS, () => leads.find(lead.id));
    expect(afterThrows.updatedAt).toBe(frozen.updatedAt);
    expect(afterThrows.convertedAt).toBe(frozen.convertedAt);
    expect(afterThrows.partnerId).toBe(frozen.partnerId);

    // The conversion is audited with mode + partnerId in the after-state.
    const client = await leadsClient();
    const events = await client.query<{ action: string; after: { mode?: string; partnerId?: string } }>(
      `SELECT action, after FROM audit_events
        WHERE entity_type = 'lead' AND entity_id = $1 AND action = 'crm.lead.converted'`,
      [lead.id],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]!.after.mode).toBe("NEW_PARTNER");
    expect(events.rows[0]!.after.partnerId).toBe(partner.id);
    // Zero ledger effects (§2): the whole flow touched no GL row.
    const journals = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM journal_lines WHERE tenant_id = $1`,
      [TENANT_LEADS],
    );
    expect(journals.rows[0]!.n).toBe(0);
    await client.end();
  });

  it("convert MERGE: links the validated partner (audited); unknown/supplier targets rejected", async () => {
    // A supplier-only partner is not a sales conversion target.
    const supplier = await withTenant(TENANT_LEADS, () =>
      partners.create(LEADS_ACTOR, {
        kind: "SUPPLIER",
        name: "Raw Materials Co",
        nameAr: null,
        taxNumber: null,
        creditLimit: null,
        creditTermsId: null,
        priceListId: null,
      }),
    );
    const customer = await withTenant(TENANT_LEADS, () =>
      partners.create(LEADS_ACTOR, {
        kind: "CUSTOMER",
        name: "Delta Retail",
        nameAr: null,
        taxNumber: null,
        creditLimit: null,
        creditTermsId: null,
        priceListId: null,
      }),
    );

    const lead = await withTenant(TENANT_LEADS, () =>
      leads.create({
        name: "Delta Branch 7",
        nameAr: null,
        phone: null,
        email: null,
        company: null,
        source: "WALK_IN",
        ownerUserId: null,
        note: null,
        noteAr: null,
        actorId: LEADS_ACTOR,
      }),
    );
    await withTenant(TENANT_LEADS, () => leads.qualify(lead.id, LEADS_ACTOR));

    // Unknown partner (A7: foreign/unknown identical) and supplier-kind
    // targets are both the typed merge-target error.
    await expect(
      withTenant(TENANT_LEADS, () =>
        leads.convert(lead.id, {
          mode: "MERGE",
          partnerId: "99999999-9999-4999-8999-999999999999",
          kind: "CUSTOMER",
          actorId: LEADS_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "LEAD_MERGE_TARGET_REQUIRED" });
    await expect(
      withTenant(TENANT_LEADS, () =>
        leads.convert(lead.id, { mode: "MERGE", partnerId: supplier.id, kind: "CUSTOMER", actorId: LEADS_ACTOR }),
      ),
    ).rejects.toBeInstanceOf(LeadMergeTargetRequiredError);
    // The failed attempts left the lead mutable + unconverted (no residue).
    expect((await withTenant(TENANT_LEADS, () => leads.find(lead.id))).status).toBe("QUALIFIED");

    const converted = await withTenant(TENANT_LEADS, () =>
      leads.convert(lead.id, { mode: "MERGE", partnerId: customer.id, kind: "CUSTOMER", actorId: LEADS_ACTOR }),
    );
    expect(converted.status).toBe("CONVERTED");
    expect(converted.partnerId).toBe(customer.id);
    expect(converted.convertedAt).toBeTruthy();

    const client = await leadsClient();
    const events = await client.query<{ after: { mode?: string; partnerId?: string } }>(
      `SELECT after FROM audit_events
        WHERE entity_type = 'lead' AND entity_id = $1 AND action = 'crm.lead.converted'`,
      [lead.id],
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]!.after.mode).toBe("MERGE");
    expect(events.rows[0]!.after.partnerId).toBe(customer.id);
    await client.end();
  });

  it("timeline: activities on the lead, occurredAt DESC; dangling anchors rejected", async () => {
    const lead = await withTenant(TENANT_LEADS, () =>
      leads.create({
        name: "Timeline Prospects",
        nameAr: null,
        phone: null,
        email: null,
        company: null,
        source: "OTHER",
        ownerUserId: null,
        note: null,
        noteAr: null,
        actorId: LEADS_ACTOR,
      }),
    );
    const base = Date.parse("2026-03-01T10:00:00Z");
    for (const [index, kind] of ["CALL", "MEETING", "EMAIL"].entries()) {
      await withTenant(TENANT_LEADS, () =>
        activities.create({
          kind,
          relatedType: "LEAD",
          relatedId: lead.id,
          occurredAt: new Date(base + index * 3_600_000).toISOString(),
          summary: `Interaction ${index + 1}`,
          durationMinutes: index * 10,
          actorUserId: LEADS_ACTOR,
          createdBy: LEADS_ACTOR,
        }),
      );
    }
    const timeline = await withTenant(TENANT_LEADS, () =>
      activities.list({ relatedType: "LEAD", relatedId: lead.id, limit: 50 }),
    );
    expect(timeline.map((row) => row.kind)).toEqual(["EMAIL", "MEETING", "CALL"]);
    expect(timeline.map((row) => row.summary)).toEqual(["Interaction 3", "Interaction 2", "Interaction 1"]);

    // Dangling anchors: unknown LEAD / PARTNER ids are 404-shaped typed
    // errors; the kind/related enums are the 422 policy class.
    await expect(
      withTenant(TENANT_LEADS, () =>
        activities.create({
          kind: "NOTE",
          relatedType: "LEAD",
          relatedId: "99999999-9999-4999-8999-999999999998",
          occurredAt: new Date().toISOString(),
          summary: "dangling",
          durationMinutes: null,
          actorUserId: null,
          createdBy: LEADS_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "LEAD_NOT_FOUND" });
    await expect(
      withTenant(TENANT_LEADS, () =>
        activities.create({
          kind: "NOTE",
          relatedType: "PARTNER",
          relatedId: "99999999-9999-4999-8999-999999999997",
          occurredAt: new Date().toISOString(),
          summary: "dangling partner",
          durationMinutes: null,
          actorUserId: null,
          createdBy: LEADS_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(PartnerNotFoundError);
    await expect(
      withTenant(TENANT_LEADS, () =>
        activities.create({
          kind: "FAX",
          relatedType: "LEAD",
          relatedId: lead.id,
          occurredAt: new Date().toISOString(),
          summary: "bad kind",
          durationMinutes: null,
          actorUserId: null,
          createdBy: LEADS_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "ACTIVITY_INPUT_INVALID" });

    // Unknown lead id on the read path is the same typed not-found.
    await expect(
      withTenant(TENANT_LEADS, () => leads.find("99999999-9999-4999-8999-999999999996")),
    ).rejects.toBeInstanceOf(LeadNotFoundError);
  });

  it("dashboard-summary: pipeline counts + follow-ups + expiring contracts + upcoming billing (§13)", async () => {
    // Seed the contract/billing side directly (T46 owns the services; the
    // tables exist from 0027): two ACTIVE contracts inside the 30d horizon
    // (one already past end — ACTIVE-until-derived-expiry counts), one
    // ACTIVE beyond it, one DRAFT inside it (not counted).
    const partnerRow = await withTenant(TENANT_LEADS, () =>
      partners.create(LEADS_ACTOR, {
        kind: "CUSTOMER",
        name: "Dashboard Fixture Customer",
        nameAr: null,
        taxNumber: null,
        creditLimit: null,
        creditTermsId: null,
        priceListId: null,
      }),
    );
    const itemsStore = await import("../../modules/items/infrastructure/items.store");
    const uoms = await withTenant(TENANT_LEADS, () => itemsStore.listUoms());
    const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
    const feeItem = await withTenant(TENANT_LEADS, () =>
      itemsStore.insertItem({
        sku: "FEE-DASH-45",
        name: "Dashboard fee item",
        nameAr: null,
        kind: "SERVICE",
        uomId: pcs.id,
        categoryId: null,
        taxCodeId: null,
        costingMethod: "WAC",
        trackBatch: false,
        trackSerial: false,
        trackImei: false,
        hasExpiry: false,
        reorderLevel: null,
        reorderQty: null,
        basePrice: null,
      }),
    );

    const su = await superuserClient();
    const insertContract = async (status: string, endOffsetDays: number): Promise<string> => {
      const id = generateUuidV7();
      await su.query(
        `INSERT INTO service_contracts (id, tenant_id, partner_id, title, fee_model,
                                        start_date, end_date, currency_code, status)
         VALUES ($1, $2, $3, $4, 'RETAINER', CURRENT_DATE - 30, CURRENT_DATE + $5::int, 'SAR', $6)`,
        [id, TENANT_LEADS, partnerRow.id, `Contract ${id.slice(-4)}`, endOffsetDays, status],
      );
      return id;
    };
    const expiring = await insertContract("ACTIVE", 10);
    await insertContract("ACTIVE", 60);
    await insertContract("DRAFT", 5);
    await insertContract("ACTIVE", -5); // effectively expired, still ACTIVE
    const scheduleRows: Array<[string, number]> = [
      ["PLANNED", 3], // inside the 7d window → counted
      ["PLANNED", 20], // outside → not counted
      ["INVOICED", 3], // not PLANNED → not counted
    ];
    for (const [status, offset] of scheduleRows) {
      await su.query(
        `INSERT INTO contract_billing_schedule (id, tenant_id, contract_id, entry_type,
                                                 bill_date, amount, fee_item_id, status)
         VALUES (gen_random_uuid(), $1, $2, 'RETAINER_PERIOD', CURRENT_DATE + $3::int, 1000, $4, $5)`,
        [TENANT_LEADS, expiring, offset, feeItem.id, status],
      );
    }
    await su.end();

    const summary = await withTenant(TENANT_LEADS, () => leads.dashboardSummary());
    // Pipeline: NEW=2 (Blue Harbor + Timeline Prospects), QUALIFIED=1
    // (ACME), CONVERTED=2 (Sunrise + Delta), LOST=1 (Ghost) — this spec's
    // whole history.
    expect(summary.pipeline).toEqual({ NEW: 2, QUALIFIED: 1, CONVERTED: 2, LOST: 1 });
    // No tasks in the leads tenant → both follow-up counters are zero.
    expect(summary.followUpsDueToday).toBe(0);
    expect(summary.followUpsOverdue).toBe(0);
    expect(summary.contractsExpiringIn30d).toBe(2);
    expect(summary.upcomingBillingEntries).toBe(1);
  });
});
