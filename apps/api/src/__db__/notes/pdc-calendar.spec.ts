import { beforeAll, describe, expect, it } from "vitest";

import { Decimal } from "@erp/domain-core";

import {
  N_ACTOR,
  TENANT_N,
  collection,
  dishonor,
  discount,
  endorsement,
  mintPostedSalesInvoice,
  receive,
  setupNotesFixture,
  withTenant,
  type NotesFixture,
} from "./fixtures";

/**
 * pdc-calendar.spec (PHASE-027 wave G — BR-045's auto-derived read model):
 * the PDC maturity calendar is job-derived from maturity_date ONLY. Buckets
 * are correct after EVERY event kind; the fold is idempotent (compute twice
 * → deep-equal buckets, ONE snapshot per tenant — replace, never append);
 * staleness is LABELED, never silent (26h); every custody event invalidates
 * the cached snapshot.
 */

let fixture: NotesFixture;

beforeAll(async () => {
  fixture = await setupNotesFixture();
});

const AS_OF = "2026-06-20";

/** Computes the live snapshot inside tenant N's scope. */
async function compute(now?: string) {
  return withTenant(TENANT_N, async () => {
    const { computePdcCalendar } = await import("../../modules/notes/application/pdc-calendar-queries");
    return computePdcCalendar({ tenantId: TENANT_N, asOf: AS_OF, now });
  });
}

/** Whether the note is currently in the calendar's drill + its bucket row. */
async function membership(noteId: string): Promise<{ present: boolean }> {
  return withTenant(TENANT_N, async () => {
    const { computePdcCalendar } = await import("../../modules/notes/application/pdc-calendar-queries");
    const snapshot = await computePdcCalendar({ tenantId: TENANT_N, asOf: AS_OF });
    return { present: snapshot.drill.notes.some((note) => note.id === noteId) };
  });
}

/** A fresh received note (maturity configurable) inside tenant N. */
async function newNote(maturity: string, number: string): Promise<string> {
  return withTenant(TENANT_N, async () => {
    const minted = await mintPostedSalesInvoice({
      partnerId: fixture.partners.customer.id,
      amount: "1000.0000",
      currency: "SAR",
      invoiceNo: `N-INV-PDC-${number}`,
      invoiceDate: "2026-06-05",
    });
    const note = await receive.receiveNote({
      partnerId: fixture.partners.customer.id,
      kind: "CHEQUE",
      number: `N-CHQ-PDC-${number}`,
      issuingBank: "Al Rajhi",
      amount: "1000.0000",
      currency: "SAR",
      maturityDate: maturity,
      sourceInvoiceId: minted.invoiceId,
      eventDate: "2026-06-10",
      actorId: N_ACTOR,
    });
    return note.id;
  });
}

describe("bucket correctness after every event kind", () => {
  it("a six-maturity spread lands exactly one note per bucket (integral day math)", async () => {
    const before = await compute();
    // asOf 2026-06-20: −10d overdue · +5d thisWeek · +15d d30 · +45d d60 ·
    // +75d d90 · +120d beyond. One note each, 1,000 SAR (base 1).
    const ids = [
      await newNote("2026-06-10", "OV"), // overdue
      await newNote("2026-06-25", "TW"), // thisWeek
      await newNote("2026-07-05", "D30"), // d30
      await newNote("2026-08-04", "D60"), // d60
      await newNote("2026-09-03", "D90"), // d90
      await newNote("2026-10-18", "BY"), // beyond
    ];
    const after = await compute();
    const d = (a: { count: number }, b: { count: number }) => a.count - b.count;
    expect(d(after.buckets.received.overdue, before.buckets.received.overdue)).toBe(1);
    expect(d(after.buckets.received.thisWeek, before.buckets.received.thisWeek)).toBe(1);
    expect(d(after.buckets.received.d30, before.buckets.received.d30)).toBe(1);
    expect(d(after.buckets.received.d60, before.buckets.received.d60)).toBe(1);
    expect(d(after.buckets.received.d90, before.buckets.received.d90)).toBe(1);
    expect(d(after.buckets.received.beyond, before.buckets.received.beyond)).toBe(1);
    // amountBase follows the same deltas (1,000 × rate 1 each).
    expect(after.buckets.received.overdue.amountBase).toBe(
      new Decimal(before.buckets.received.overdue.amountBase).plus("1000.0000").toFixed(4),
    );
    expect(after.buckets.received.beyond.amountBase).toBe(
      new Decimal(before.buckets.received.beyond.amountBase).plus("1000.0000").toFixed(4),
    );
    // The issued side never moved.
    expect(after.buckets.issued).toEqual(before.buckets.issued);
    // Every created note is drillable, and the partner row aggregates.
    for (const id of ids) {
      expect((await membership(id)).present).toBe(true);
    }
    const partnerRow = after.drill.byPartner.find((row) => row.partnerId === fixture.partners.customer.id);
    const partnerRowBefore = before.drill.byPartner.find(
      (row) => row.partnerId === fixture.partners.customer.id,
    );
    expect(partnerRow!.count - (partnerRowBefore?.count ?? 0)).toBe(6);
  });

  it("ENDORSE + DEPOSIT change custody only — same bucket membership, identical buckets", async () => {
    const endorsed = await newNote("2026-06-25", "END");
    const deposited = await newNote("2026-06-25", "DEP");
    const before = await compute();
    await withTenant(TENANT_N, () =>
      endorsement.endorse({ noteId: endorsed, eventDate: "2026-06-21", endorsee: "SNB", actorId: N_ACTOR }),
    );
    await withTenant(TENANT_N, () =>
      collection.deposit({ noteId: deposited, cashAccountId: fixture.bank.sar, eventDate: "2026-06-21", actorId: N_ACTOR }),
    );
    const after = await compute();
    expect(after.buckets).toEqual(before.buckets); // status changed, membership did not
    expect(after.drill.notes.map((note) => note.id)).toContain(endorsed);
    expect(after.drill.notes.map((note) => note.id)).toContain(deposited);
  });

  it("COLLECT / DISHONOR / DISCOUNT / RETURN remove the note from the live calendar", async () => {
    const collected = await newNote("2026-06-25", "COL");
    const dishonored = await newNote("2026-06-25", "DISH");
    const discounted = await newNote("2026-06-25", "DISC");
    const returned = await newNote("2026-06-25", "RET");
    expect((await membership(collected)).present).toBe(true);

    await withTenant(TENANT_N, () =>
      collection.collect({ noteId: collected, cashAccountId: fixture.bank.sar, eventDate: "2026-07-10", actorId: N_ACTOR }),
    );
    await withTenant(TENANT_N, () =>
      dishonor.dishonor({ noteId: dishonored, reason: "bounced", eventDate: "2026-06-28", actorId: N_ACTOR }),
    );
    await withTenant(TENANT_N, () =>
      discount.discount({ noteId: discounted, cashAccountId: fixture.bank.sar, fee: "25.0000", eventDate: "2026-06-22", actorId: N_ACTOR }),
    );
    await withTenant(TENANT_N, () =>
      dishonor.returnNote({ noteId: returned, eventDate: "2026-06-25", actorId: N_ACTOR }),
    );
    for (const id of [collected, dishonored, discounted, returned]) {
      expect((await membership(id)).present).toBe(false);
    }
  });
});

describe("idempotency + the one-snapshot-per-tenant cache", () => {
  it("computing twice yields deep-equal buckets (the daily sweep's re-run never duplicates)", async () => {
    const first = await compute();
    const second = await compute("2026-06-20T02:20:00.000Z");
    expect(second.buckets).toEqual(first.buckets);
    expect(second.drill).toEqual(first.drill);
    expect(second.asOf).toBe(first.asOf);
  });

  it("replacePdcCalendarSnapshot twice → getPdcCalendarSnapshot serves the SECOND (never two entries)", async () => {
    await withTenant(TENANT_N, async () => {
      const queries = await import("../../modules/notes/application/pdc-calendar-queries");
      const first = await queries.computePdcCalendar({ tenantId: TENANT_N, asOf: "2026-06-20" });
      const second = await queries.computePdcCalendar({ tenantId: TENANT_N, asOf: "2026-06-21" });
      expect(first.asOf).not.toBe(second.asOf);
      queries.replacePdcCalendarSnapshot(first);
      expect(queries.getPdcCalendarSnapshot()?.asOf).toBe("2026-06-20");
      queries.replacePdcCalendarSnapshot(second);
      const served = queries.getPdcCalendarSnapshot();
      // The SECOND replaced the FIRST — one entry per tenant, never append.
      expect(served?.asOf).toBe("2026-06-21");
      expect(served?.buckets).toEqual(second.buckets);
      expect(served?.drill).toEqual(second.drill);
    });
  });
});

describe("staleness is labeled, never silent (BR-045's freshness contract)", () => {
  it("a 30h-old computedAt flags stale; a fresh one does not (26h threshold)", async () => {
    await withTenant(TENANT_N, async () => {
      const queries = await import("../../modules/notes/application/pdc-calendar-queries");
      expect(queries.CALENDAR_STALE_AFTER_HOURS).toBe(26);
      const fresh = await queries.computePdcCalendar({
        tenantId: TENANT_N,
        asOf: AS_OF,
        now: "2026-06-20T02:20:00.000Z",
      });
      // The computed snapshot shape carries the freshness stamps.
      expect(fresh.asOf).toBe(AS_OF);
      expect(fresh.computedAt).toBe("2026-06-20T02:20:00.000Z");
      expect(queries.isStale(fresh, "2026-06-20T04:20:00.000Z")).toBe(false); // 2h — fresh
      // The test seam forces a computedAt age (a skipped nightly run).
      const stale = { ...fresh, computedAt: "2026-06-18T20:20:00.000Z" };
      queries.__setSnapshotForTests(stale);
      expect(queries.getPdcCalendarSnapshot()?.computedAt).toBe("2026-06-18T20:20:00.000Z");
      expect(queries.isStale(stale, "2026-06-20T02:20:00.000Z")).toBe(true); // 30h — stale
    });
  });
});

describe("on-event invalidation (every mutating service drops the cache)", () => {
  it("an ENDORSE after a computed snapshot leaves getPdcCalendarSnapshot null", async () => {
    const noteId = await newNote("2026-06-25", "INV");
    await withTenant(TENANT_N, async () => {
      const queries = await import("../../modules/notes/application/pdc-calendar-queries");
      const seeded = await queries.getOrComputePdcCalendar(AS_OF);
      expect(seeded.asOf).toBe(AS_OF);
      expect(queries.getPdcCalendarSnapshot()).not.toBeNull();
    });
    await withTenant(TENANT_N, () =>
      endorsement.endorse({ noteId, eventDate: "2026-06-21", endorsee: "SNB", actorId: N_ACTOR }),
    );
    await withTenant(TENANT_N, async () => {
      const queries = await import("../../modules/notes/application/pdc-calendar-queries");
      expect(queries.getPdcCalendarSnapshot()).toBeNull();
      // Cross-suite hygiene: drop any entry this spec left behind.
      queries.invalidatePdcCalendar();
    });
  });
});
