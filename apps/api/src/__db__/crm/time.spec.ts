import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ensureTestDb, superuserClient, appClient } from "../test-db";
import { reloadEnv } from "../../config/env";
import { closeDb } from "../../infra/db/client";
import { withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PeriodService } from "../../modules/accounting/application/period-service";
import { ResolveEffectiveConfigService } from "../../modules/configuration/application/resolve/resolve-service";
import { ConfigRepository } from "../../modules/configuration/infrastructure/config-repository";
import { ContractService } from "../../modules/crm/application/contract-service";
import { TimeEntryService } from "../../modules/crm/application/time-entry-service";
import {
  TimeEntryCaseRequiredError,
  TimeEntryInputInvalidError,
  TimeEntryNotFoundError,
  TimeEntryStateError,
  TimesheetEmptyError,
} from "../../modules/crm/domain/crm-errors";
import * as accountingStore from "../../modules/accounting/infrastructure/accounting.store";
import * as crmStore from "../../modules/crm/infrastructure/crm.store";
import * as itemsStore from "../../modules/items/infrastructure/items.store";
import * as partnersStore from "../../modules/partners/infrastructure/partners.store";
import type { Client } from "pg";

/**
 * PHASE-019 T46b db evidence (MASTER-PLAN §6 + §15 hourly chain): time
 * entries feed contract billing ONLY — the case policy
 * (`crm.time_entries_require_case`, typed TIME_ENTRY_CASE_REQUIRED), the
 * RATE SNAPSHOT at recording (the contract partner's price-list price via
 * the BR-003 seam — 250.000000/h FEE-HR — else manual input; never
 * recomputed), the weekly review (Monday weekStart flips the week's DRAFT
 * entries APPROVED, audited as the `crm.timesheet_reviewed` batch), the
 * void lifecycle (DRAFT/APPROVED only — BILLED is invoice history), and the
 * pullable set (§5's four criteria + billable) that the billing preview's
 * HOURLY branch surfaces (needsNarrative for narrative-less entries —
 * listed, never silently billed). Dedicated tenant 6b6b6b6b (SAR; verified
 * unused across the repo before adoption).
 */

const TENANT_T = "6b6b6b6b-6b6b-6b6b-6b6b-6b6b6b6b6b6b";
const ACTOR = "6b6b6b6b-0000-4000-8000-0000000006b1";

// -- the service graph (constructed manually — §18 lesson 6) ----------------

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const resolveConfig = new ResolveEffectiveConfigService(new ConfigRepository());
const contracts = new ContractService(audit, posting, numbering, resolveConfig);
const time = new TimeEntryService(audit, resolveConfig);
const periods = new PeriodService(audit);

// -- fixture ids (resolved in beforeAll) --------------------------------------

let PARTNER = "";
let CASE01 = "";
let FEE_HR = "";
let FEE_CONSULT = "";
let HOURLY_CONTRACT = "";

// the timeslip ids across the describes (sequential state):
let E1 = ""; // 2026-03-28 (March window) — "Research", 3h @ 250
let E2 = ""; // 2026-04-03 — "Drafting", 2h @ 250 (the §15 hourly chain)
let E3 = ""; // 2026-04-10 — NO narrative (the needsNarrative subject)
let E4 = ""; // 2026-04-08 — "Site visit", 0.5h @ 250 (APPROVED → VOID)

// -- helpers -------------------------------------------------------------------

/** The tenant-scoped app client (RLS world) for read assertions. */
async function tClient(): Promise<Client> {
  const client = await appClient();
  await client.query("SELECT set_config('erp.tenant_id', $1, false)", [TENANT_T]);
  return client;
}

/**
 * Upsert a tenant setting with `updated_at = now()` (the fingerprint bump
 * that makes a value flip visible to the resolve cache).
 */
async function setSetting(key: string, value: string | boolean): Promise<void> {
  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenant_settings (id, tenant_id, key, value)
     VALUES (gen_random_uuid(), $1, $2, $3::jsonb)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [TENANT_T, key, JSON.stringify(value)],
  );
  await su.end();
}

interface CreateEntry {
  entryDate: string;
  hours: string;
  narrative: string | null;
  projectId?: string | null;
  contractId?: string | null;
  unitRate?: string | null;
  feeItemId?: string;
  billable?: boolean;
}

/** The create-input builder (defaults: CASE-01 + the hourly contract). */
function slip(input: CreateEntry) {
  return {
    entryDate: input.entryDate,
    hours: input.hours,
    feeItemId: input.feeItemId ?? FEE_HR,
    projectId: input.projectId === undefined ? CASE01 : input.projectId,
    contractId: input.contractId === undefined ? HOURLY_CONTRACT : input.contractId,
    feeEarnerUserId: ACTOR,
    unitRate: input.unitRate === undefined ? null : input.unitRate,
    narrative: input.narrative,
    billable: input.billable ?? true,
    actorId: ACTOR,
  };
}

// -- bootstrap -------------------------------------------------------------------

beforeAll(async () => {
  ensureTestDb();
  reloadEnv();

  const su = await superuserClient();
  await su.query(
    `INSERT INTO tenants (id, name, name_ar, base_currency, country_code, timezone)
     VALUES ($1, 'Tenant T46T (time)', 'المستأجر ت٤٦', 'SAR', 'SA', 'Asia/Riyadh')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_T],
  );
  await su.query(
    `INSERT INTO users (id, email, full_name, password_hash, status)
     VALUES ($1, 'c46-time@fixture.test', 'C46 Time Actor', 'x', 'ACTIVE')
     ON CONFLICT (id) DO NOTHING`,
    [ACTOR],
  );
  await su.end();

  await withTenant(TENANT_T, async () => {
    const { seedMasterDataBasics } = await import(
      "../../modules/tenancy/infrastructure/tenancy.store"
    );
    await seedMasterDataBasics();

    // FY2026: the preview's period posture (OPEN months).
    if ((await accountingStore.findFiscalYearByName("FY2026")) === undefined) {
      await periods.createYear(ACTOR, { name: "FY2026", startDate: "2026-01-01", endDate: "2026-12-31" });
    }

    // The §15 project CASE-01.
    CASE01 = (
      await accountingStore.insertProject({ code: "CASE-01", name: "Advisory case 1", nameAr: null, parentId: null })
    ).id;

    // Fee items (SERVICE): FEE-HR (the §15 hourly consult) + FEE-CONSULT
    // (resolves NO price — the manual-rate-required subject).
    const uoms = await itemsStore.listUoms();
    const hr = uoms.find((u) => u.code === "HR") ?? uoms[0]!;
    FEE_HR = (
      await itemsStore.insertItem({
        sku: "FEE-HR",
        name: "Hourly consult",
        nameAr: "استشارة بالساعة",
        kind: "SERVICE",
        uomId: hr.id,
        categoryId: null,
        taxCodeId: null,
        costingMethod: "WAC",
        trackBatch: false,
        trackSerial: false,
        trackImei: false,
        hasExpiry: false,
        reorderLevel: null,
        reorderQty: null,
        basePrice: null, // NO base price — only the partner's list resolves
      })
    ).id;
    FEE_CONSULT = (
      await itemsStore.insertItem({
        sku: "FEE-CONSULT",
        name: "Specialist consult",
        nameAr: null,
        kind: "SERVICE",
        uomId: hr.id,
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
      })
    ).id;

    // The §15 rate fixture: a SALE price list @ 250.000000/h (minQty 1 —
    // the partial-free default tier; ck_price_list_items_min_qty > 0)
    // assigned to the contract partner.
    const list = await itemsStore.insertPriceList({
      name: "T46 advisory list",
      nameAr: null,
      kind: "SALE",
      currencyCode: "SAR",
      validFrom: null,
      validTo: null,
    });
    await itemsStore.insertPriceListItem({
      priceListId: list.id,
      itemId: FEE_HR,
      uomId: hr.id,
      unitPrice: "250.000000",
      minQty: "1",
    });
    const terms = await partnersStore.listCreditTerms();
    const net30 = terms.find((t) => t.days === 30) ?? terms[0]!;
    PARTNER = (
      await partnersStore.insertPartner({
        kind: "CUSTOMER",
        code: "P-000001",
        name: "Gulf Advisory Group",
        nameAr: null,
        taxNumber: null,
        creditLimit: null,
        creditTermsId: net30.id,
        priceListId: list.id,
      })
    ).id;
  });

  // The §9 mode gate: hourly contracts need the tenant's billing mode to
  // name them (the default retainer_or_milestones refuses HOURLY).
  await setSetting("crm.contract_billing_mode", "hourly");
  const created = await withTenant(TENANT_T, () =>
    contracts.create({
      partnerId: PARTNER,
      projectId: CASE01,
      title: "Hourly advisory 2026",
      titleAr: null,
      scope: null,
      feeModel: "HOURLY",
      startDate: "2026-03-01",
      endDate: "2026-06-30",
      monthlyAmount: null,
      feeItemId: FEE_HR,
      milestones: null,
      currencyCode: null,
      note: null,
      noteAr: null,
      actorId: ACTOR,
    }),
  );
  const activated = await withTenant(TENANT_T, () => contracts.activate(created.contract.id, ACTOR));
  HOURLY_CONTRACT = activated.contract.id;
  expect(activated.contract.status).toBe("ACTIVE");
  expect(activated.contract.contractNo).toMatch(/^CT-2026-\d{5}$/);
  // The HOURLY grid (§4 arrears): 4 entries Mar–Jun, billDate = period END.
  const grid = await withTenant(TENANT_T, () => contracts.listSchedule(HOURLY_CONTRACT));
  expect(grid.map((row) => [row.periodKey, row.billDate, row.amount])).toEqual([
    ["2026-03", "2026-03-31", null],
    ["2026-04", "2026-04-30", null],
    ["2026-05", "2026-05-31", null],
    ["2026-06", "2026-06-30", null],
  ]);
});

afterAll(async () => {
  await closeDb();
});

// ---------------------------------------------------------------------------

describe("time entries — the case policy (§6)", () => {
  it("no projectId → typed TIME_ENTRY_CASE_REQUIRED (zero residue); with a project → DRAFT + audited", async () => {
    const before = await withTenant(TENANT_T, () => crmStore.listTimeEntries({ limit: 500 }));
    await expect(
      withTenant(TENANT_T, () =>
        time.create(slip({ entryDate: "2026-04-05", hours: "1", narrative: "no case", projectId: null, unitRate: "180.000000" })),
      ),
    ).rejects.toMatchObject({ code: "TIME_ENTRY_CASE_REQUIRED" });
    await expect(
      withTenant(TENANT_T, () =>
        time.create(slip({ entryDate: "2026-04-05", hours: "1", narrative: "no case", projectId: null, unitRate: "180.000000" })),
      ),
    ).rejects.toBeInstanceOf(TimeEntryCaseRequiredError);
    // Zero residue: nothing landed (the empty-week probe also proves it below).
    const afterRejects = await withTenant(TENANT_T, () => crmStore.listTimeEntries({ limit: 500 }));
    expect(afterRejects.length).toBe(before.length);

    // With a project (and no contract): a manual rate is required — the
    // snapshot has nothing to resolve against (§6 determinism).
    const created = await withTenant(TENANT_T, () =>
      time.create(slip({ entryDate: "2026-04-05", hours: "1", narrative: "Case study", contractId: null, unitRate: "180.000000" })),
    );
    expect(created.status).toBe("DRAFT");
    expect(created.projectId).toBe(CASE01);
    expect(created.unitRate).toBe("180.000000"); // the manual snapshot
    expect(created.billedInvoiceId).toBeNull();

    const client = await tClient();
    const events = await client.query<{ action: string }>(
      `SELECT action FROM audit_events WHERE entity_type = 'time_entry' AND entity_id = $1`,
      [created.id],
    );
    await client.end();
    expect(events.rows.map((row) => row.action)).toEqual(["crm.time_entry.created"]);

    // The A7 not-found read.
    await expect(
      withTenant(TENANT_T, () => time.find("99999999-9999-4999-8999-999999999994")),
    ).rejects.toBeInstanceOf(TimeEntryNotFoundError);
  });
});

describe("time entries — the rate snapshot (§6: snapshotted at recording)", () => {
  it("the contract partner's price-list price resolves (250.000000/h); manual wins; unresolvable → typed input error", async () => {
    // E1 (March window) — resolved from the partner's SALE list.
    E1 = (
      await withTenant(TENANT_T, () =>
        time.create(slip({ entryDate: "2026-03-28", hours: "3", narrative: "Research" })),
      )
    ).id;
    const e1 = await withTenant(TENANT_T, () => time.find(E1));
    expect(e1.unitRate).toBe("250.000000"); // SALES_PRICE_LIST — never recomputed
    expect(e1.contractId).toBe(HOURLY_CONTRACT);
    expect(e1.feeItemId).toBe(FEE_HR);

    // E2 + E3 (the §15 hourly chain: 2h "Drafting" + the narrative-less 1.5h).
    E2 = (
      await withTenant(TENANT_T, () =>
        time.create(slip({ entryDate: "2026-04-03", hours: "2", narrative: "Drafting" })),
      )
    ).id;
    E3 = (
      await withTenant(TENANT_T, () =>
        time.create(slip({ entryDate: "2026-04-10", hours: "1.5", narrative: null })),
      )
    ).id;
    expect((await withTenant(TENANT_T, () => time.find(E3))).unitRate).toBe("250.000000");

    // E4 (an extra APPROVED→VOID subject in the April window).
    E4 = (
      await withTenant(TENANT_T, () =>
        time.create(slip({ entryDate: "2026-04-08", hours: "1", narrative: "Site visit" })),
      )
    ).id;

    // Manual input wins even when a list price would resolve.
    const manual = await withTenant(TENANT_T, () =>
      time.create(slip({ entryDate: "2026-04-22", hours: "1.25", narrative: "Expert review", unitRate: "300.000000" })),
    );
    expect(manual.unitRate).toBe("300.000000");

    // An item with NO resolvable price (not in the list, no base price) and
    // no manual rate → the typed 422 (the manual rate is REQUIRED).
    await expect(
      withTenant(TENANT_T, () =>
        time.create(slip({ entryDate: "2026-04-23", hours: "1", narrative: "specialist", feeItemId: FEE_CONSULT })),
      ),
    ).rejects.toMatchObject({ code: "TIME_ENTRY_INPUT_INVALID" });
    // …and WITH a manual rate the same item records fine.
    const consult = await withTenant(TENANT_T, () =>
      time.create(slip({ entryDate: "2026-04-23", hours: "1", narrative: "specialist", feeItemId: FEE_CONSULT, unitRate: "275.000000" })),
    );
    expect(consult.unitRate).toBe("275.000000");

    // No contract + no manual rate → the other typed shape (nothing to
    // resolve a price against).
    await expect(
      withTenant(TENANT_T, () =>
        time.create(slip({ entryDate: "2026-04-24", hours: "1", narrative: "ad hoc", contractId: null })),
      ),
    ).rejects.toBeInstanceOf(TimeEntryInputInvalidError);

    // A non-SERVICE item is refused (the job-card LABOR mirror).
    const stock = await withTenant(TENANT_T, async () => {
      const uoms = await itemsStore.listUoms();
      const pcs = uoms.find((u) => u.code === "PCS") ?? uoms[0]!;
      return itemsStore.insertItem({
        sku: "T46-PARTS",
        name: "Parts item",
        nameAr: null,
        kind: "STOCK",
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
      });
    });
    await expect(
      withTenant(TENANT_T, () =>
        time.create(slip({ entryDate: "2026-04-25", hours: "1", narrative: "parts", feeItemId: stock.id, unitRate: "10.000000" })),
      ),
    ).rejects.toMatchObject({ code: "TIME_ENTRY_INPUT_INVALID" });
  });
});

describe("the weekly review (§6 — the batch APPROVED flip)", () => {
  it("Monday weekStart flips that week's DRAFT entries; the counts + the batch audit row are exact", async () => {
    // Week 2026-03-23 (Mar 23–29): E1 only.
    const week1 = await withTenant(TENANT_T, () =>
      time.reviewTimesheet({ weekStart: "2026-03-23", actorId: ACTOR }),
    );
    expect(week1).toMatchObject({ weekStart: "2026-03-23", weekEnd: "2026-03-29", reviewed: 1 });
    expect((await withTenant(TENANT_T, () => time.find(E1))).status).toBe("APPROVED");

    // Week 2026-03-30 (Mar 30–Apr 5): E2 + the case-policy positive (Apr 5).
    const week2 = await withTenant(TENANT_T, () =>
      time.reviewTimesheet({ weekStart: "2026-03-30", actorId: ACTOR }),
    );
    expect(week2.reviewed).toBe(2);
    expect((await withTenant(TENANT_T, () => time.find(E2))).status).toBe("APPROVED");

    // Week 2026-04-06 (Apr 6–12): E3 (Apr 10) + E4 (Apr 8).
    const week3 = await withTenant(TENANT_T, () =>
      time.reviewTimesheet({ weekStart: "2026-04-06", actorId: ACTOR }),
    );
    expect(week3.reviewed).toBe(2);
    expect((await withTenant(TENANT_T, () => time.find(E3))).status).toBe("APPROVED");
    expect((await withTenant(TENANT_T, () => time.find(E4))).status).toBe("APPROVED");

    // The batch audit rows (one per review — entity_id anchors on the
    // first flipped row: the NOT-NULL-uuid precedent; after carries the
    // window + the count + the full id list).
    const client = await tClient();
    const events = await client.query<{ entity_id: string; after: { reviewed: number; timeEntryIds: string[] } }>(
      `SELECT entity_id, after FROM audit_events
        WHERE action = 'crm.timesheet_reviewed'
        ORDER BY at`,
    );
    await client.end();
    expect(events.rows.map((row) => row.after.reviewed)).toEqual([1, 2, 2]);
    expect(events.rows.every((row) => row.after.timeEntryIds.length === row.after.reviewed)).toBe(true);
    expect(events.rows[2]!.after.timeEntryIds).toContain(E3); // the Apr 6–12 week
  });

  it("an empty week → typed TIMESHEET_EMPTY; a non-Monday weekStart → typed input error", async () => {
    await expect(
      withTenant(TENANT_T, () => time.reviewTimesheet({ weekStart: "2026-05-04", actorId: ACTOR })),
    ).rejects.toMatchObject({ code: "TIMESHEET_EMPTY" });
    await expect(
      withTenant(TENANT_T, () => time.reviewTimesheet({ weekStart: "2026-05-04", actorId: ACTOR })),
    ).rejects.toBeInstanceOf(TimesheetEmptyError);
    await expect(
      withTenant(TENANT_T, () => time.reviewTimesheet({ weekStart: "2026-04-07", actorId: ACTOR })), // a Tuesday
    ).rejects.toBeInstanceOf(TimeEntryInputInvalidError);
  });
});

describe("void + the pullable set (§6 + §5)", () => {
  it("DRAFT/APPROVED → VOID; VOID and BILLED refuse (typed TIME_ENTRY_STATE)", async () => {
    // A fresh DRAFT subject (never reviewed — week 2026-04-13 has no pass).
    const v1 = await withTenant(TENANT_T, () =>
      time.create(slip({ entryDate: "2026-04-15", hours: "0.75", narrative: "Drafting follow-up", unitRate: "200.000000" })),
    );
    const voided = await withTenant(TENANT_T, () => time.void(v1.id, ACTOR));
    expect(voided.status).toBe("VOID");
    expect(voided.billedInvoiceId).toBeNull();

    // A VOID entry never re-voids.
    await expect(withTenant(TENANT_T, () => time.void(v1.id, ACTOR))).rejects.toBeInstanceOf(
      TimeEntryStateError,
    );

    // APPROVED → VOID (E4 — the Site visit subject).
    const e4Voided = await withTenant(TENANT_T, () => time.void(E4, ACTOR));
    expect(e4Voided.status).toBe("VOID");

    // BILLED (simulated by patching the store directly): invoice history.
    const e5 = await withTenant(TENANT_T, () =>
      time.create(slip({ entryDate: "2026-04-05", hours: "1", narrative: "billed subject", contractId: null, unitRate: "100.000000" })),
    );
    await withTenant(TENANT_T, () => crmStore.patchTimeEntry({ id: e5.id, status: "BILLED" }));
    await expect(withTenant(TENANT_T, () => time.void(e5.id, ACTOR))).rejects.toMatchObject({
      code: "TIME_ENTRY_STATE",
    });
    expect((await withTenant(TENANT_T, () => time.find(e5.id))).status).toBe("BILLED");

    // The void audits (the created events also live on those entities).
    const client = await tClient();
    const events = await client.query<{ action: string }>(
      `SELECT action FROM audit_events
        WHERE entity_type = 'time_entry' AND action = 'crm.time_entry.voided'
          AND entity_id = ANY($1::uuid[])
        ORDER BY at`,
      [[v1.id, E4]],
    );
    await client.end();
    expect(events.rows.map((row) => row.action)).toEqual(["crm.time_entry.voided", "crm.time_entry.voided"]);

    // BILLED is immutable for edits too (§6: only DRAFT accepts edits).
    await expect(
      withTenant(TENANT_T, () => time.update(e5.id, { hours: "2", actorId: ACTOR })),
    ).rejects.toBeInstanceOf(TimeEntryStateError);
  });

  it("listPullableTimeEntries: APPROVED + unbilled + billable + in-window only", async () => {
    // April window on the contract: E2 (Apr 3) + E3 (Apr 10) — nothing else.
    // Excluded: the DRAFT manual-rate slip (Apr 22), the VOID v1 (Apr 15) +
    // E4 (Apr 8), the BILLED e5 + the contract-less slips (no contractId),
    // and E1 (Mar 28 — a different period window).
    const pullable = await withTenant(TENANT_T, () =>
      crmStore.listPullableTimeEntries({
        contractId: HOURLY_CONTRACT,
        fromDate: "2026-04-01",
        toDate: "2026-04-30",
      }),
    );
    expect(pullable.map((row) => row.id)).toEqual([E2, E3]);
    expect(pullable.map((row) => [row.hours, row.unitRate])).toEqual([
      ["2.000000", "250.000000"],
      ["1.500000", "250.000000"],
    ]);

    // The list read (row 32): the from/to + projectId + mine filters.
    const april = await withTenant(TENANT_T, () =>
      time.list({ fromDate: "2026-04-01", toDate: "2026-04-30", limit: 100 }),
    );
    expect(april.length).toBeGreaterThanOrEqual(6); // the whole April history
    expect(april.every((row) => row.entryDate >= "2026-04-01" && row.entryDate <= "2026-04-30")).toBe(true);
    const byProject = await withTenant(TENANT_T, () =>
      time.list({ projectId: CASE01, limit: 100 }),
    );
    expect(byProject.every((row) => row.projectId === CASE01)).toBe(true);
    const all = await withTenant(TENANT_T, () => time.list({ limit: 500 }));
    const byMine = await withTenant(TENANT_T, () => time.list({ feeEarnerUserId: ACTOR, limit: 500 }));
    expect(byMine.length).toBe(all.length); // every slip's fee earner is the actor
  });
});

describe("the billing preview's HOURLY branch (§5 — the honest timeslip)", () => {
  it("wouldInvoice per pullable entry; needsNarrative lists the narrative-less (never silently billed)", async () => {
    const preview = await withTenant(TENANT_T, () =>
      contracts.billingPreview(HOURLY_CONTRACT, "2026-05-01"),
    );
    expect(preview.asOf).toBe("2026-05-01");
    // billDate ≤ asOf: the March (03-31) + April (04-30) periods only —
    // May (05-31) and June (06-30) are future.
    expect(preview.items.map((item) => item.entry.periodKey)).toEqual(["2026-03", "2026-04"]);

    const march = preview.items[0]!;
    expect(march.periodStatus).toBe("OPEN");
    expect(march.periodLocked).toBe(false);
    expect(march.pullableTimeEntries.map((row) => row.id)).toEqual([E1]);
    expect(march.needsNarrative).toEqual([]);
    expect(march.wouldInvoice).toEqual([
      { feeItemId: FEE_HR, qty: "3.000000", unitPrice: "250.000000", description: "Research" },
    ]);

    const april = preview.items[1]!;
    expect(april.pullableTimeEntries.map((row) => row.id)).toEqual([E2, E3]);
    // The §15 hourly chain: the narrative-less 1.5h entry is LISTED + skipped.
    expect(april.needsNarrative.map((row) => row.id)).toEqual([E3]);
    expect(april.wouldInvoice).toEqual([
      { feeItemId: FEE_HR, qty: "2.000000", unitPrice: "250.000000", description: "Drafting" },
    ]);
  });
});
