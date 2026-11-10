import { beforeAll, describe, expect, it } from "vitest";

import { Decimal } from "@erp/domain-core";

import {
  N_ACTOR,
  N_JUL,
  N_LOCKED_DATE,
  TENANT_N,
  collection,
  discount,
  dishonor,
  endorsement,
  mintPostedSalesInvoice,
  mintPostedSupplierInvoice,
  noteService,
  periods,
  receive,
  setupNotesFixture,
  su,
  issue,
  withTenant,
  type NotesFixture,
} from "./fixtures";

/**
 * notes-rules.spec (PHASE-027 wave G — BUSINESS_RULES §8 rows BR-045…BR-047
 * + ACCOUNTING_TESTS §3 line shapes G-24/G-25/G-26/G-27): the notes business
 * rules and golden journals exercised against real PostgreSQL through the
 * module services exactly as production code paths run — no direct register
 * or journal inserts; every posting flows through PostingService.post.
 *
 * - BR-045: a note requires partner + maturity and lands IN_CUSTODY with its
 *   G-24/G-27 entry attached; the settle target is the invoice's open item
 *   (the engine's partner-subledger port).
 * - BR-046: dishonor requires a reason and restores the ORIGINAL open item
 *   byte-equal (the repoint-restore: allocations re-anchored on the new
 *   control entry, which is anchored so the aging never double-counts).
 * - BR-047: custody-only events (ENDORSE/DEPOSIT/RECLASSIFY) never journal —
 *   the ledger-delta test asserts the journal-entry count is unchanged.
 * - The failure packs (PERIOD_LOCKED, PURPOSE_NOT_MAPPED, ALREADY_POSTED,
 *   INVALID_CUSTODY_TRANSITION, DISHONOR_REASON_REQUIRED,
 *   NOTE_SOURCE_INVALID/CURRENCY/RATE, INV-016 bounds) all leave ZERO
 *   residue — the whole ambient UoW rolls back.
 */

let fixture: NotesFixture;

beforeAll(async () => {
  fixture = await setupNotesFixture();
});

// -- spec helpers ----------------------------------------------------------------------

/** Canonical 4dp normalization for pg numeric text reads. */
function n4(value: string | number | null | undefined): string {
  return new Decimal(String(value ?? "0")).toDecimalPlaces(4).toFixed(4);
}

/** Snapshot of TENANT_N's residue surfaces (zero-residue probes). */
async function residue(): Promise<Record<string, number>> {
  const client = await su();
  const count = async (table: string): Promise<number> => {
    const result = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
      [TENANT_N],
    );
    return result.rows[0]?.n ?? 0;
  };
  const snapshot = {
    journals: await count("journal_entries"),
    notes: await count("notes"),
    events: await count("note_events"),
    allocations: await count("treasury_allocations"),
  };
  await client.end();
  return snapshot;
}

/** Journal-entry count of TENANT_N (the ledger-delta probe). */
async function journalCount(): Promise<number> {
  return withTenant(TENANT_N, async () => {
    const journal = await import("../../modules/accounting/infrastructure/journal.store");
    return (await journal.listEntries({ limit: 1_000_000 })).rows.length;
  });
}

/** The golden journal lines of (docType, docId, operation) — account/direction/amount/partner. */
async function goldenLines(
  docType: string,
  docId: string,
  operation: string,
): Promise<{ id: string; lines: [string, string, string, string | null][] }> {
  const journal = await import("../../modules/accounting/infrastructure/journal.store");
  const entry = await journal.findEntryBySourceKey(docType, docId, operation);
  expect(entry, `journal entry ${docType}/${docId}/${operation} missing`).toBeDefined();
  const lines = await journal.listLines(entry!.id);
  return {
    id: entry!.id,
    lines: lines.map((line) => [line.accountId, line.direction, n4(line.amount), line.partnerId ?? null]),
  };
}

/** One fresh G-24 world: minted invoice + received note (IN_CUSTODY). */
async function mintReceivedNote(input?: {
  amount?: string;
  currency?: string;
  exchangeRate?: string | null;
  number?: string;
  maturity?: string;
}): Promise<{ noteId: string; itemId: string; invoiceId: string }> {
  return withTenant(TENANT_N, async () => {
    const world = await mintPostedSalesInvoice({
      partnerId: fixture.partners.customer.id,
      amount: input?.amount ?? "1000.0000",
      currency: input?.currency ?? "SAR",
      exchangeRate: input?.exchangeRate ?? null,
      invoiceNo: `N-RULES-${(Math.random() * 1_000_000 | 0)}`,
      invoiceDate: "2026-06-05",
    });
    const note = await receive.receiveNote({
      partnerId: fixture.partners.customer.id,
      kind: "CHEQUE",
      number: input?.number ?? `N-CHQ-${(Math.random() * 1_000_000 | 0)}`,
      issuingBank: "Al Rajhi",
      amount: input?.amount ?? "1000.0000",
      currency: input?.currency ?? "SAR",
      exchangeRate: input?.exchangeRate ?? null,
      issueDate: "2026-06-01",
      maturityDate: input?.maturity ?? "2026-07-01",
      sourceInvoiceId: world.invoiceId,
      eventDate: "2026-06-10",
      actorId: N_ACTOR,
    });
    return { noteId: note.id, itemId: world.itemId, invoiceId: world.invoiceId };
  });
}

describe("BR-045 + G-24 — receive into custody against a POSTED credit invoice", () => {
  it("posts exactly the canonical G-24 shape; the open item settles; the partner nets to zero", async () => {
    // The partner's read-model delta: this mint's invoice DR + note CR must
    // net to exactly zero whatever earlier suites left open for the partner
    // (delta-asserts stay order-independent across spec files).
    const partners = await import("../../modules/partners/infrastructure/partners.store");
    const balanceBefore = await withTenant(TENANT_N, () =>
      partners.findPartnerBalance(fixture.partners.customer.id),
    );
    const world = await mintReceivedNote();
    const golden = await withTenant(TENANT_N, () => goldenLines("note", world.noteId, "post"));
    expect(golden.lines).toEqual([
      [fixture.accountIds.notesReceivable, "DEBIT", "1000.0000", null],
      [fixture.accountIds.arControl, "CREDIT", "1000.0000", fixture.partners.customer.id],
    ]);

    // The register row (BR-045): partner + maturity carried, IN_CUSTODY with
    // its G-24 entry attached.
    const row = await withTenant(TENANT_N, () => noteService.getNote(world.noteId));
    expect(row.note.status).toBe("IN_CUSTODY");
    expect(row.note.journalEntryId).toBe(golden.id);
    expect(row.note.partnerId).toBe(fixture.partners.customer.id);
    expect(row.note.maturityDate).toBe("2026-07-01");
    expect(row.note.kind).toBe("CHEQUE");
    expect(row.note.direction).toBe("RECEIVED");

    // The invoice open item settles exactly (INV-016 effective by presence).
    const store = await import("../../modules/notes/infrastructure/notes.store");
    const treasury = await import("../../modules/treasury/infrastructure/treasury.store");
    const item = await withTenant(TENANT_N, () => treasury.findOpenItemById(world.itemId));
    expect(n4(item!.outstanding)).toBe("0.0000");
    expect(item!.sourceId).toBe(world.invoiceId);

    // The note's allocations ride the notes-owned treasury_allocations rows.
    const allocations = await withTenant(TENANT_N, () => store.listNoteAllocations(world.noteId));
    expect(allocations.map((row) => [row.openItemId, n4(row.amount)])).toEqual([
      [world.itemId, "1000.0000"],
    ]);

    // The partner's read model nets the mint to zero: invoice DR − note CR.
    const balance = await withTenant(TENANT_N, () =>
      partners.findPartnerBalance(fixture.partners.customer.id),
    );
    expect(n4(balance?.openBalance)).toBe(n4(balanceBefore?.openBalance));

    // The aging view has no double count: nothing open for this partner.
    const open = await withTenant(TENANT_N, () =>
      treasury.listOpenItems({ partnerId: fixture.partners.customer.id, side: "AR", openOnly: true, limit: 200 }),
    );
    expect(open.filter((row) => row.id === world.itemId)).toHaveLength(0);
  });
});

describe("G-25 — DEPOSIT (no journal) then COLLECT at the bank", () => {
  it("DEPOSIT moves custody only — zero new journal rows (BR-047)", async () => {
    const world = await mintReceivedNote();
    const before = await journalCount();
    const deposited = await withTenant(TENANT_N, () =>
      collection.deposit({
        noteId: world.noteId,
        cashAccountId: fixture.bank.sar,
        eventDate: "2026-06-20",
        actorId: N_ACTOR,
      }),
    );
    const after = await journalCount();
    expect(deposited.note.status).toBe("DEPOSITED");
    expect(deposited.note.cashAccountId).toBe(fixture.bank.sar);
    expect(deposited.event.journalEntryId).toBeNull();
    expect(after).toBe(before);
  });

  it("COLLECT posts exactly the canonical G-25 shape + the treasury movement (INV-019)", async () => {
    const world = await mintReceivedNote();
    await withTenant(TENANT_N, () =>
      collection.deposit({ noteId: world.noteId, cashAccountId: fixture.bank.sar, eventDate: "2026-06-20", actorId: N_ACTOR }),
    );
    const journal = await import("../../modules/accounting/infrastructure/journal.store");
    const treasury = await import("../../modules/treasury/infrastructure/treasury.store");
    const balanceBefore = await withTenant(TENANT_N, () =>
      journal.controlAccountBalance(fixture.accountIds.notesReceivable),
    );

    const collected = await withTenant(TENANT_N, () =>
      collection.collect({
        noteId: world.noteId,
        cashAccountId: fixture.bank.sar,
        eventDate: N_JUL,
        actorId: N_ACTOR,
      }),
    );
    expect(collected.note.status).toBe("COLLECTED");
    const golden = await withTenant(TENANT_N, () => goldenLines("note", world.noteId, "collect"));
    expect(golden.lines).toEqual([
      [fixture.accountIds.bankGl, "DEBIT", "1000.0000", null],
      [fixture.accountIds.notesReceivable, "CREDIT", "1000.0000", null],
    ]);

    // The treasury movement (INV-019): one IN row, base == the journal cash
    // leg, and the movement balance equals the GL base balance of the bank.
    const movements = await withTenant(TENANT_N, () =>
      treasury.listMovements({ cashAccountId: fixture.bank.sar, limit: 500 }),
    );
    const mine = movements.filter((row) => row.sourceType === "note" && row.sourceId === world.noteId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.direction).toBe("IN");
    expect(n4(mine[0]!.baseAmount)).toBe("1000.0000");
    const movementBalance = await withTenant(TENANT_N, () => treasury.movementBalance(fixture.bank.sar));
    const glBalance = await withTenant(TENANT_N, () => treasury.glBaseBalanceAsOf(fixture.accountIds.bankGl));
    expect(n4(movementBalance)).toBe(n4(glBalance));

    // The notes purpose account drops by the note: contribution now zero.
    const balanceAfter = await withTenant(TENANT_N, () =>
      journal.controlAccountBalance(fixture.accountIds.notesReceivable),
    );
    expect(n4(balanceAfter)).toBe(
      new Decimal(n4(balanceBefore)).minus("1000.0000").toDecimalPlaces(4).toFixed(4),
    );
  });
});

describe("G-26 — dishonor restores the ORIGINAL open item byte-equal (the repoint-restore)", () => {
  it("posts the canonical G-26 shape with the bank-fee legs; the original item returns; the anchor never double-counts", async () => {
    const treasury = await import("../../modules/treasury/infrastructure/treasury.store");
    const store = await import("../../modules/notes/infrastructure/notes.store");
    const partners = await import("../../modules/partners/infrastructure/partners.store");
    // Deltas captured BEFORE the mint: whatever earlier suites left open for
    // this partner, the dishonor must add EXACTLY ONE restored 1,000 — never
    // a second copy (order-independent across spec files).
    const openBefore = await withTenant(TENANT_N, () =>
      treasury.listOpenItems({ partnerId: fixture.partners.customer.id, side: "AR", openOnly: true, limit: 200 }),
    );
    const openSumBefore = openBefore.reduce(
      (acc, row) => new Decimal(acc).plus(row.outstanding),
      new Decimal("0"),
    );
    const balanceBefore = await withTenant(TENANT_N, () =>
      partners.findPartnerBalance(fixture.partners.customer.id),
    );
    const world = await mintReceivedNote({ number: "N-CHQ-G26" });
    // Snapshot the settled item (the byte-equal reference).
    const settledItem = await withTenant(TENANT_N, () => treasury.findOpenItemById(world.itemId));

    const dishonored = await withTenant(TENANT_N, () =>
      dishonor.dishonor({
        noteId: world.noteId,
        reason: "bounced",
        bankFee: "25.0000",
        cashAccountId: fixture.bank.sar,
        eventDate: "2026-06-25",
        actorId: N_ACTOR,
      }),
    );
    expect(dishonored.note.status).toBe("DISHONORED");
    expect(dishonored.anchored).toBe(true);

    // G-26 golden: DR AR_CONTROL (partner) · CR NOTES_RECEIVABLE · fee legs.
    const golden = await withTenant(TENANT_N, () => goldenLines("note", world.noteId, "dishonor"));
    expect(golden.lines).toEqual([
      [fixture.accountIds.arControl, "DEBIT", "1000.0000", fixture.partners.customer.id],
      [fixture.accountIds.notesReceivable, "CREDIT", "1000.0000", null],
      [fixture.accountIds.bankCharges, "DEBIT", "25.0000", null],
      [fixture.accountIds.bankGl, "CREDIT", "25.0000", null],
    ]);

    // The ORIGINAL item comes back byte-equal (same row id, untouched fields).
    const restored = await withTenant(TENANT_N, () => treasury.findOpenItemById(world.itemId));
    expect(restored!.id).toBe(settledItem!.id);
    expect(restored!.amount).toBe(settledItem!.amount);
    expect(restored!.partnerId).toBe(settledItem!.partnerId);
    expect(restored!.sourceType).toBe(settledItem!.sourceType);
    expect(restored!.sourceId).toBe(settledItem!.sourceId);
    expect(restored!.memo).toBe(settledItem!.memo);
    expect(n4(restored!.outstanding)).toBe("1000.0000");

    // The new control entry is ANCHORED (outstanding 0) — no double count.
    const anchor = await withTenant(TENANT_N, () => store.findControlEntryForJournal(golden.id));
    expect(anchor).toBeDefined();
    expect(anchor!.partnerId).toBe(fixture.partners.customer.id);
    const anchoredItem = await withTenant(TENANT_N, () => treasury.findOpenItemById(anchor!.id));
    expect(n4(anchoredItem!.outstanding)).toBe("0.0000");

    // The note's allocations now point at the anchor, consolidated.
    const allocations = await withTenant(TENANT_N, () => store.listNoteAllocations(world.noteId));
    expect(allocations.map((row) => [row.openItemId, n4(row.amount)])).toEqual([
      [anchor!.id, "1000.0000"],
    ]);

    // The aging total gains EXACTLY the one restored item — and the partner
    // read model agrees (consistency, never a second copy).
    const open = await withTenant(TENANT_N, () =>
      treasury.listOpenItems({ partnerId: fixture.partners.customer.id, side: "AR", openOnly: true, limit: 200 }),
    );
    const total = open.reduce((acc, row) => new Decimal(acc).plus(row.outstanding), new Decimal("0"));
    expect(total.toDecimalPlaces(4).toFixed(4)).toBe(
      new Decimal(openSumBefore).plus("1000.0000").toDecimalPlaces(4).toFixed(4),
    );
    const balance = await withTenant(TENANT_N, () =>
      partners.findPartnerBalance(fixture.partners.customer.id),
    );
    expect(n4(balance?.openBalance)).toBe(
      new Decimal(n4(balanceBefore?.openBalance)).plus("1000.0000").toDecimalPlaces(4).toFixed(4),
    );

    // The fee's treasury movement (INV-019 exact — the fee credit leg's base).
    const movements = await withTenant(TENANT_N, () =>
      treasury.listMovements({ cashAccountId: fixture.bank.sar, limit: 500 }),
    );
    const fee = movements.filter((row) => row.sourceType === "note" && row.sourceId === world.noteId);
    expect(fee).toHaveLength(1);
    expect(fee[0]!.direction).toBe("OUT");
    expect(n4(fee[0]!.baseAmount)).toBe("25.0000");

    // The note never re-enters the RC-11 live register (fold contribution 0).
    const live = await withTenant(TENANT_N, () => store.listLiveNotes(500));
    expect(live.some((row) => row.id === world.noteId)).toBe(false);

    // BR-046's surfacing: the dishonor inbox notification exists (category notes).
    const client = await su();
    const inboxRows = await client.query(
      `SELECT category, severity FROM notifications
        WHERE tenant_id = $1 AND dedupe_key = $2`,
      [TENANT_N, `note-dishonored:${world.noteId}`],
    );
    await client.end();
    expect(inboxRows.rows).toEqual([{ category: "notes", severity: "warning" }]);
  });

  it("INV-013: a second dishonor attempt rejects ALREADY_POSTED (the money event ran once)", async () => {
    const world = await mintReceivedNote({ number: "N-CHQ-G26-2" });
    await withTenant(TENANT_N, () =>
      dishonor.dishonor({ noteId: world.noteId, reason: "bounced", eventDate: "2026-06-25", actorId: N_ACTOR }),
    );
    const before = await residue();
    await expect(
      withTenant(TENANT_N, () =>
        dishonor.dishonor({ noteId: world.noteId, reason: "bounced again", eventDate: "2026-06-26", actorId: N_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "ALREADY_POSTED" });
    expect(await residue()).toEqual(before);
  });

  it("a COLLECTED note can never dishonor (INVALID_CUSTODY_TRANSITION)", async () => {
    const world = await mintReceivedNote();
    await withTenant(TENANT_N, () =>
      collection.collect({ noteId: world.noteId, cashAccountId: fixture.bank.sar, eventDate: N_JUL, actorId: N_ACTOR }),
    );
    const before = await residue();
    await expect(
      withTenant(TENANT_N, () =>
        dishonor.dishonor({ noteId: world.noteId, reason: "late bounce", eventDate: "2026-07-05", actorId: N_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "INVALID_CUSTODY_TRANSITION" });
    expect(await residue()).toEqual(before);
  });
});

describe("G-27 — issue to a supplier + the paid-at-maturity mirror", () => {
  it("issues exactly the canonical G-27 shape; the AP item settles", async () => {
    const issued = await withTenant(TENANT_N, () =>
      issue.issueNote({
        partnerId: fixture.partners.supplier.id,
        kind: "PROMISSORY_NOTE",
        number: "N-PN-2001",
        issuingBank: "Al Rajhi",
        amount: "2500.0000",
        currency: "SAR",
        issueDate: "2026-06-01",
        maturityDate: "2026-07-01",
        sourceInvoiceId: fixture.invoices.supplier,
        eventDate: "2026-06-10",
        actorId: N_ACTOR,
      }),
    );
    expect(issued.status).toBe("IN_CUSTODY");
    const golden = await withTenant(TENANT_N, () => goldenLines("note", issued.id, "post"));
    expect(golden.lines).toEqual([
      [fixture.accountIds.apControl, "DEBIT", "2500.0000", fixture.partners.supplier.id],
      [fixture.accountIds.notesPayable, "CREDIT", "2500.0000", null],
    ]);
    const treasury = await import("../../modules/treasury/infrastructure/treasury.store");
    const item = await withTenant(TENANT_N, () => treasury.findOpenItemById(fixture.items.supplier));
    expect(n4(item!.outstanding)).toBe("0.0000");
  });

  it("the paid mirror: collect on an ISSUED note posts DR NOTES_PAYABLE · CR bank + movement OUT", async () => {
    const world = await withTenant(TENANT_N, async () => {
      const minted = await mintPostedSupplierInvoice({
        partnerId: fixture.partners.supplier.id,
        amount: "2500.0000",
        currency: "SAR",
        invoiceNo: "N-SUPP-G27-PAY",
        internalNo: "N-SUPP-G27-PAY",
        invoiceDate: "2026-06-05",
      });
      const issued = await issue.issueNote({
        partnerId: fixture.partners.supplier.id,
        kind: "CHEQUE",
        number: "N-CHQ-G27-PAY",
        issuingBank: "Al Rajhi",
        amount: "2500.0000",
        currency: "SAR",
        issueDate: "2026-06-01",
        maturityDate: "2026-07-01",
        sourceInvoiceId: minted.invoiceId,
        eventDate: "2026-06-10",
        actorId: N_ACTOR,
      });
      return { invoiceId: minted.invoiceId, itemId: minted.itemId, noteId: issued.id };
    });
    const paid = await withTenant(TENANT_N, () =>
      collection.collect({ noteId: world.noteId, cashAccountId: fixture.bank.sar, eventDate: N_JUL, actorId: N_ACTOR }),
    );
    expect(paid.note.status).toBe("COLLECTED");
    const golden = await withTenant(TENANT_N, () => goldenLines("note", world.noteId, "collect"));
    expect(golden.lines).toEqual([
      [fixture.accountIds.notesPayable, "DEBIT", "2500.0000", null],
      [fixture.accountIds.bankGl, "CREDIT", "2500.0000", null],
    ]);
    const treasury = await import("../../modules/treasury/infrastructure/treasury.store");
    const movements = await withTenant(TENANT_N, () =>
      treasury.listMovements({ cashAccountId: fixture.bank.sar, limit: 500 }),
    );
    const mine = movements.filter((row) => row.sourceType === "note" && row.sourceId === world.noteId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.direction).toBe("OUT");
    expect(n4(mine[0]!.baseAmount)).toBe("2500.0000");
  });

  it("the mirror repoint: RETURN of an issued note restores the AP item byte-equal", async () => {
    const treasury = await import("../../modules/treasury/infrastructure/treasury.store");
    const store = await import("../../modules/notes/infrastructure/notes.store");
    const partners = await import("../../modules/partners/infrastructure/partners.store");
    // Deltas captured BEFORE the mint (order-independent across spec files).
    const openBefore = await withTenant(TENANT_N, () =>
      treasury.listOpenItems({ partnerId: fixture.partners.supplier.id, side: "AP", openOnly: true, limit: 200 }),
    );
    const openSumBefore = openBefore.reduce(
      (acc, row) => new Decimal(acc).plus(row.outstanding),
      new Decimal("0"),
    );
    const balanceBefore = await withTenant(TENANT_N, () =>
      partners.findPartnerBalance(fixture.partners.supplier.id),
    );
    const world = await withTenant(TENANT_N, async () => {
      const minted = await mintPostedSupplierInvoice({
        partnerId: fixture.partners.supplier.id,
        amount: "2500.0000",
        currency: "SAR",
        invoiceNo: "N-SUPP-G27-RET",
        internalNo: "N-SUPP-G27-RET",
        invoiceDate: "2026-06-05",
      });
      const issued = await issue.issueNote({
        partnerId: fixture.partners.supplier.id,
        kind: "PROMISSORY_NOTE",
        number: "N-PN-G27-RET",
        issuingBank: "Al Rajhi",
        amount: "2500.0000",
        currency: "SAR",
        issueDate: "2026-06-01",
        maturityDate: "2026-07-01",
        sourceInvoiceId: minted.invoiceId,
        eventDate: "2026-06-10",
        actorId: N_ACTOR,
      });
      return { invoiceId: minted.invoiceId, itemId: minted.itemId, noteId: issued.id };
    });
    const settledItem = await withTenant(TENANT_N, () => treasury.findOpenItemById(world.itemId));

    const returned = await withTenant(TENANT_N, () =>
      dishonor.returnNote({ noteId: world.noteId, eventDate: "2026-06-25", actorId: N_ACTOR }),
    );
    expect(returned.note.status).toBe("RETURNED");
    expect(returned.anchored).toBe(true);

    // The ISSUED restore mirror: DR NOTES_PAYABLE · CR AP_CONTROL (partner).
    const golden = await withTenant(TENANT_N, () => goldenLines("note", world.noteId, "return"));
    expect(golden.lines).toEqual([
      [fixture.accountIds.notesPayable, "DEBIT", "2500.0000", null],
      [fixture.accountIds.apControl, "CREDIT", "2500.0000", fixture.partners.supplier.id],
    ]);

    // The ORIGINAL AP item comes back byte-equal.
    const restored = await withTenant(TENANT_N, () => treasury.findOpenItemById(world.itemId));
    expect(restored!.id).toBe(settledItem!.id);
    expect(restored!.amount).toBe(settledItem!.amount);
    expect(restored!.sourceId).toBe(settledItem!.sourceId);
    expect(n4(restored!.outstanding)).toBe("2500.0000");

    // The anchor: the new control entry, outstanding 0.
    const anchor = await withTenant(TENANT_N, () => store.findControlEntryForJournal(golden.id));
    const anchoredItem = await withTenant(TENANT_N, () => treasury.findOpenItemById(anchor!.id));
    expect(n4(anchoredItem!.outstanding)).toBe("0.0000");

    // The aging total gains EXACTLY the one restored AP item; the partner
    // agrees — on the AP side the restored payable is a CREDIT (negative
    // signed sum): the E3 anchor lands as a new payable, outstanding 0.
    const open = await withTenant(TENANT_N, () =>
      treasury.listOpenItems({ partnerId: fixture.partners.supplier.id, side: "AP", openOnly: true, limit: 200 }),
    );
    const total = open.reduce((acc, row) => new Decimal(acc).plus(row.outstanding), new Decimal("0"));
    expect(total.toDecimalPlaces(4).toFixed(4)).toBe(
      new Decimal(openSumBefore).plus("2500.0000").toDecimalPlaces(4).toFixed(4),
    );
    const balance = await withTenant(TENANT_N, () =>
      partners.findPartnerBalance(fixture.partners.supplier.id),
    );
    expect(n4(balance?.openBalance)).toBe(
      new Decimal(n4(balanceBefore?.openBalance)).minus("2500.0000").toDecimalPlaces(4).toFixed(4),
    );
  });
});

describe("FX mirrors — INV-008 settles at the item's original stored rate; FX accrues at the money moment", () => {
  it("G-24 (USD): create at the item's rate 3.75 posts base 3750; a mismatched rate rejects", async () => {
    const world = await withTenant(TENANT_N, async () => {
      const minted = await mintPostedSalesInvoice({
        partnerId: fixture.partners.customerFx.id,
        amount: "1000.0000",
        currency: "USD",
        exchangeRate: "3.75",
        invoiceNo: "N-INV-FX-1",
        invoiceDate: "2026-06-05",
      });
      const note = await receive.receiveNote({
        partnerId: fixture.partners.customerFx.id,
        kind: "CHEQUE",
        number: "N-CHQ-FX-1",
        issuingBank: "Emirates NBD",
        amount: "1000.0000",
        currency: "USD",
        exchangeRate: "3.75",
        issueDate: "2026-06-01",
        maturityDate: "2026-07-01",
        sourceInvoiceId: minted.invoiceId,
        eventDate: "2026-06-10",
        actorId: N_ACTOR,
      });
      return { noteId: note.id, itemId: minted.itemId };
    });
    const golden = await withTenant(TENANT_N, () => goldenLines("note", world.noteId, "post"));
    expect(golden.lines).toEqual([
      [fixture.accountIds.notesReceivable, "DEBIT", "3750.0000", null],
      [fixture.accountIds.arControl, "CREDIT", "3750.0000", fixture.partners.customerFx.id],
    ]);
    const row = await withTenant(TENANT_N, () => noteService.getNote(world.noteId));
    expect(n4(row.note.exchangeRate)).toBe("3.7500");

    // The mismatched rate at create: typed NOTE_RATE_MISMATCH, zero residue.
    const before = await residue();
    await expect(
      withTenant(TENANT_N, async () => {
        const minted = await mintPostedSalesInvoice({
          partnerId: fixture.partners.customerFx.id,
          amount: "1000.0000",
          currency: "USD",
          exchangeRate: "3.75",
          invoiceNo: "N-INV-FX-BAD",
          invoiceDate: "2026-06-05",
        });
        return receive.receiveNote({
          partnerId: fixture.partners.customerFx.id,
          kind: "CHEQUE",
          number: "N-CHQ-FX-BAD",
          amount: "1000.0000",
          currency: "USD",
          exchangeRate: "3.76",
          maturityDate: "2026-07-01",
          sourceInvoiceId: minted.invoiceId,
          eventDate: "2026-06-10",
          actorId: N_ACTOR,
        });
      }),
    ).rejects.toMatchObject({ code: "NOTE_RATE_MISMATCH" });
    expect(await residue()).toEqual(before);
  });

  it("G-25 (USD) collected at 3.76: explicit FX_GAIN leg — never absorbed", async () => {
    const world = await withTenant(TENANT_N, async () => {
      const minted = await mintPostedSalesInvoice({
        partnerId: fixture.partners.customerFx.id,
        amount: "1000.0000",
        currency: "USD",
        exchangeRate: "3.75",
        invoiceNo: "N-INV-FX-GAIN",
        invoiceDate: "2026-06-05",
      });
      const note = await receive.receiveNote({
        partnerId: fixture.partners.customerFx.id,
        kind: "CHEQUE",
        number: "N-CHQ-FX-GAIN",
        amount: "1000.0000",
        currency: "USD",
        exchangeRate: "3.75",
        maturityDate: "2026-07-01",
        sourceInvoiceId: minted.invoiceId,
        eventDate: "2026-06-10",
        actorId: N_ACTOR,
      });
      return { noteId: note.id };
    });
    await withTenant(TENANT_N, () =>
      collection.collect({
        noteId: world.noteId,
        cashAccountId: fixture.bank.usd,
        exchangeRate: "3.76",
        eventDate: N_JUL,
        actorId: N_ACTOR,
      }),
    );
    const golden = await withTenant(TENANT_N, () => goldenLines("note", world.noteId, "collect"));
    expect(golden.lines).toEqual([
      [fixture.accountIds.usdBankGl, "DEBIT", "3760.0000", null],
      [fixture.accountIds.notesReceivable, "CREDIT", "3750.0000", null],
      [fixture.accountIds.fxGain, "CREDIT", "10.0000", null],
    ]);
    const treasury = await import("../../modules/treasury/infrastructure/treasury.store");
    const movements = await withTenant(TENANT_N, () =>
      treasury.listMovements({ cashAccountId: fixture.bank.usd, limit: 500 }),
    );
    const mine = movements.filter((row) => row.sourceType === "note" && row.sourceId === world.noteId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.direction).toBe("IN");
    expect(n4(mine[0]!.baseAmount)).toBe("3760.0000");
    expect(mine[0]!.currencyCode).toBe("USD");
  });

  it("G-25 (USD) collected at 3.74: explicit FX_LOSS leg", async () => {
    const world = await withTenant(TENANT_N, async () => {
      const minted = await mintPostedSalesInvoice({
        partnerId: fixture.partners.customerFx.id,
        amount: "1000.0000",
        currency: "USD",
        exchangeRate: "3.75",
        invoiceNo: "N-INV-FX-LOSS",
        invoiceDate: "2026-06-05",
      });
      const note = await receive.receiveNote({
        partnerId: fixture.partners.customerFx.id,
        kind: "PROMISSORY_NOTE",
        number: "N-PN-FX-LOSS",
        amount: "1000.0000",
        currency: "USD",
        exchangeRate: "3.75",
        maturityDate: "2026-07-01",
        sourceInvoiceId: minted.invoiceId,
        eventDate: "2026-06-10",
        actorId: N_ACTOR,
      });
      return { noteId: note.id };
    });
    await withTenant(TENANT_N, () =>
      collection.collect({
        noteId: world.noteId,
        cashAccountId: fixture.bank.usd,
        exchangeRate: "3.74",
        eventDate: N_JUL,
        actorId: N_ACTOR,
      }),
    );
    const golden = await withTenant(TENANT_N, () => goldenLines("note", world.noteId, "collect"));
    expect(golden.lines).toEqual([
      [fixture.accountIds.usdBankGl, "DEBIT", "3740.0000", null],
      [fixture.accountIds.notesReceivable, "CREDIT", "3750.0000", null],
      [fixture.accountIds.fxLoss, "DEBIT", "10.0000", null],
    ]);
  });

  it("G-27 paid (USD) at 3.74: DR NOTES_PAYABLE · CR bank · CR FX_GAIN (the ISSUED mirror)", async () => {
    const world = await withTenant(TENANT_N, async () => {
      const minted = await mintPostedSupplierInvoice({
        partnerId: fixture.partners.supplierFx.id,
        amount: "1000.0000",
        currency: "USD",
        exchangeRate: "3.75",
        invoiceNo: "N-SUPP-FX-PAY",
        internalNo: "N-SUPP-FX-PAY",
        invoiceDate: "2026-06-05",
      });
      const issued = await issue.issueNote({
        partnerId: fixture.partners.supplierFx.id,
        kind: "CHEQUE",
        number: "N-CHQ-FX-PAY",
        amount: "1000.0000",
        currency: "USD",
        exchangeRate: "3.75",
        maturityDate: "2026-07-01",
        sourceInvoiceId: minted.invoiceId,
        eventDate: "2026-06-10",
        actorId: N_ACTOR,
      });
      return { noteId: issued.id };
    });
    await withTenant(TENANT_N, () =>
      collection.collect({
        noteId: world.noteId,
        cashAccountId: fixture.bank.usd,
        exchangeRate: "3.74",
        eventDate: N_JUL,
        actorId: N_ACTOR,
      }),
    );
    const golden = await withTenant(TENANT_N, () => goldenLines("note", world.noteId, "collect"));
    expect(golden.lines).toEqual([
      [fixture.accountIds.notesPayable, "DEBIT", "3750.0000", null],
      [fixture.accountIds.usdBankGl, "CREDIT", "3740.0000", null],
      [fixture.accountIds.fxGain, "CREDIT", "10.0000", null],
    ]);
    const treasury = await import("../../modules/treasury/infrastructure/treasury.store");
    const movements = await withTenant(TENANT_N, () =>
      treasury.listMovements({ cashAccountId: fixture.bank.usd, limit: 500 }),
    );
    const mine = movements.filter((row) => row.sourceType === "note" && row.sourceId === world.noteId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.direction).toBe("OUT");
    expect(n4(mine[0]!.baseAmount)).toBe("3740.0000");
    // INV-019: every USD movement ties to the GL base balance of 1122.
    const movementBalance = await withTenant(TENANT_N, () => treasury.movementBalance(fixture.bank.usd));
    const glBalance = await withTenant(TENANT_N, () => treasury.glBaseBalanceAsOf(fixture.accountIds.usdBankGl));
    expect(n4(movementBalance)).toBe(n4(glBalance));
  });
});

describe("BR-047 — discounting at the bank (the money moment with an explicit fee)", () => {
  it("posts DR cash (amount−fee) · DR NOTES_DISCOUNT_EXPENSE fee · CR NOTES_RECEIVABLE amount", async () => {
    const journal = await import("../../modules/accounting/infrastructure/journal.store");
    const treasury = await import("../../modules/treasury/infrastructure/treasury.store");
    // The purpose side BEFORE the mint: whatever earlier suites left live on
    // NOTES_RECEIVABLE, this note's G-24 must add exactly 1,000 and the
    // discount must remove exactly 1,000 (order-independent deltas).
    const nrBefore = await withTenant(TENANT_N, () =>
      journal.controlAccountBalance(fixture.accountIds.notesReceivable),
    );
    const world = await mintReceivedNote({ number: "N-CHQ-DISC" });
    const nrAfterCreate = await withTenant(TENANT_N, () =>
      journal.controlAccountBalance(fixture.accountIds.notesReceivable),
    );
    expect(n4(nrAfterCreate)).toBe(
      new Decimal(n4(nrBefore)).plus("1000.0000").toDecimalPlaces(4).toFixed(4),
    );
    const discounted = await withTenant(TENANT_N, () =>
      discount.discount({
        noteId: world.noteId,
        cashAccountId: fixture.bank.sar,
        fee: "100.0000",
        eventDate: "2026-06-22",
        actorId: N_ACTOR,
      }),
    );
    expect(n4(discounted.proceeds)).toBe("900.0000");
    const row = await withTenant(TENANT_N, () => noteService.getNote(world.noteId));
    expect(row.note.status).toBe("DISCOUNTED");
    const golden = await withTenant(TENANT_N, () => goldenLines("note", world.noteId, "discount"));
    expect(golden.lines).toEqual([
      [fixture.accountIds.bankGl, "DEBIT", "900.0000", null],
      [fixture.accountIds.notesDiscountExpense, "DEBIT", "100.0000", null],
      [fixture.accountIds.notesReceivable, "CREDIT", "1000.0000", null],
    ]);
    const movements = await withTenant(TENANT_N, () =>
      treasury.listMovements({ cashAccountId: fixture.bank.sar, limit: 500 }),
    );
    const mine = movements.filter((row) => row.sourceType === "note" && row.sourceId === world.noteId);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.direction).toBe("IN");
    expect(n4(mine[0]!.baseAmount)).toBe("900.0000");
    // INV-024: the purpose side drops back by exactly the note — this
    // discounted note's contribution is now zero.
    const balance = await withTenant(TENANT_N, () =>
      journal.controlAccountBalance(fixture.accountIds.notesReceivable),
    );
    expect(n4(balance)).toBe(n4(nrBefore));
  });
});

describe("BR-047 — custody-only events never journal (the ledger-delta test)", () => {
  it("ENDORSE moves custody with zero journal rows; the event carries no journal id", async () => {
    const world = await mintReceivedNote({ number: "N-CHQ-END" });
    const before = await journalCount();
    const endorsed = await withTenant(TENANT_N, () =>
      endorsement.endorse({ noteId: world.noteId, eventDate: "2026-06-18", endorsee: "Bank of Riyadh", actorId: N_ACTOR }),
    );
    const after = await journalCount();
    expect(endorsed.note.status).toBe("ENDORSED_OUT");
    expect(endorsed.event.journalEntryId).toBeNull();
    expect(after).toBe(before);
  });

  it("RECLASSIFY corrects metadata with zero journal rows; substantive fields stay immutable", async () => {
    const world = await mintReceivedNote({ number: "N-CHG-RECL" });
    const before = await journalCount();
    const reclassified = await withTenant(TENANT_N, () =>
      noteService.reclassify(
        world.noteId,
        { number: "N-CHQ-RECL-2", issuingBank: "SNB", note: "corrected metadata" },
        [],
        N_ACTOR,
      ),
    );
    const after = await journalCount();
    expect(reclassified.note.number).toBe("N-CHQ-RECL-2");
    expect(reclassified.note.issuingBank).toBe("SNB");
    expect(reclassified.note.status).toBe("IN_CUSTODY");
    expect(reclassified.event.journalEntryId).toBeNull();
    expect(after).toBe(before);

    // Substantive fields are immutable after create (typed 422).
    const before2 = await residue();
    await expect(
      withTenant(TENANT_N, () =>
        noteService.reclassify(world.noteId, { note: "illegal attempt" }, ["amount", "partnerId"], N_ACTOR),
      ),
    ).rejects.toMatchObject({ code: "NOTE_FIELDS_IMMUTABLE" });
    expect(await residue()).toEqual(before2);
  });
});

describe("the custody transition matrix (BR-047 machine — LEGAL_TRANSITIONS is the single source)", () => {
  it("every legal (direction, event, from) lands EVENT_TARGET; every illegal one rejects typed", async () => {
    const { LEGAL_TRANSITIONS, EVENT_TARGET, TERMINAL_STATUSES, assertTransition } = await import(
      "../../modules/notes/application/custody-machine"
    );
    const statuses = ["IN_CUSTODY", "ENDORSED_OUT", "DEPOSITED", "COLLECTED", "DISHONORED", "DISCOUNTED", "RETURNED"] as const;
    const events = ["ENDORSE", "DEPOSIT", "COLLECT", "DISHONOR", "DISCOUNT", "RETURN"] as const;
    let legalCount = 0;
    for (const direction of ["RECEIVED", "ISSUED"] as const) {
      for (const event of events) {
        for (const from of statuses) {
          const legal = LEGAL_TRANSITIONS[direction][event]?.includes(from) ?? false;
          if (legal) {
            legalCount += 1;
            expect(assertTransition({ noteId: "matrix", direction, eventKind: event, from })).toBe(
              EVENT_TARGET[event],
            );
          } else {
            expect(() => assertTransition({ noteId: "matrix", direction, eventKind: event, from })).toThrowError(
              expect.objectContaining({ code: "INVALID_CUSTODY_TRANSITION" }),
            );
          }
        }
      }
    }
    // The machine's shape: RECEIVED has 13 legal transitions, ISSUED 3.
    expect(legalCount).toBe(16);
    expect(TERMINAL_STATUSES).toContain("COLLECTED");
    expect(TERMINAL_STATUSES).not.toContain("IN_CUSTODY");
  });
});

describe("the failure packs (typed rejections, zero residue)", () => {
  it("PERIOD_LOCKED: event_date inside a LOCKED period never posts", async () => {
    const march = fixture.periodIds["FY2026-03"]!;
    await withTenant(TENANT_N, async () => {
      await periods.softClose(N_ACTOR, march);
      await periods.lock(N_ACTOR, march);
    });
    const before = await residue();
    await expect(
      withTenant(TENANT_N, async () => {
        const minted = await mintPostedSalesInvoice({
          partnerId: fixture.partners.customer.id,
          amount: "1000.0000",
          currency: "SAR",
          invoiceNo: "N-INV-LOCKED",
          invoiceDate: "2026-06-05",
        });
        return receive.receiveNote({
          partnerId: fixture.partners.customer.id,
          kind: "CHEQUE",
          number: "N-CHQ-LOCKED",
          amount: "1000.0000",
          currency: "SAR",
          maturityDate: "2026-07-01",
          sourceInvoiceId: minted.invoiceId,
          eventDate: N_LOCKED_DATE,
          actorId: N_ACTOR,
        });
      }),
    ).rejects.toMatchObject({ code: "PERIOD_LOCKED" });
    expect(await residue()).toEqual(before);
    // Cross-suite hygiene: restore the period to OPEN (INV-020 reopen).
    await withTenant(TENANT_N, () =>
      periods.reopen(N_ACTOR, march, "notes-rules PERIOD_LOCKED pack: period-lock restore"),
    );
  });

  it("PURPOSE_NOT_MAPPED: unmapping NOTES_RECEIVABLE fails closed; restoring heals", async () => {
    const client = await su();
    // active_to must satisfy the window CHECK (≥ active_from — the template
    // provisions carry TODAY as active_from); far-future expiry unmaps it.
    await client.query(
      `UPDATE account_purposes SET active_to = '2099-12-31'
        WHERE tenant_id = $1 AND purpose_key = 'NOTES_RECEIVABLE' AND active_to IS NULL`,
      [TENANT_N],
    );
    await client.end();
    const before = await residue();
    await expect(mintReceivedNote({ number: "N-CHQ-UNMAPPED" })).rejects.toMatchObject({
      code: "PURPOSE_NOT_MAPPED",
    });
    expect(await residue()).toEqual(before);
    // Restore the mapping — the next create heals.
    const heal = await su();
    await heal.query(
      `UPDATE account_purposes SET active_to = NULL
        WHERE tenant_id = $1 AND purpose_key = 'NOTES_RECEIVABLE'`,
      [TENANT_N],
    );
    await heal.end();
    const healed = await mintReceivedNote({ number: "N-CHQ-REMAPPED" });
    expect(healed.noteId).not.toBe("");
  });

  it("DISHONOR_REASON_REQUIRED: a blank reason never restores", async () => {
    const world = await mintReceivedNote({ number: "N-CHQ-NOREASON" });
    const before = await residue();
    await expect(
      withTenant(TENANT_N, () =>
        dishonor.dishonor({ noteId: world.noteId, reason: "   ", eventDate: "2026-06-25", actorId: N_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "DISHONOR_REASON_REQUIRED" });
    expect(await residue()).toEqual(before);
  });

  it("NOTE_SOURCE_INVALID: a non-POSTED invoice never settles", async () => {
    const before = await residue();
    await expect(
      withTenant(TENANT_N, async () => {
        const sales = await import("../../modules/sales/infrastructure/sales.store");
        const draft = await sales.insertSalesInvoice({
          branchId: fixture.branchId,
          customerId: fixture.partners.customer.id,
          salesRepId: null,
          kind: "CREDIT",
          invoiceDate: "2026-06-05",
          dueDate: "2026-07-15",
          currencyCode: "SAR",
          exchangeRate: null,
          orderId: null,
          deliveryId: null,
          warehouseId: null,
          cashAccountId: null,
          note: null,
          noteAr: null,
          actorId: N_ACTOR,
          totalNet: "1000.0000",
          totalTax: "0.0000",
          totalGross: "1000.0000",
          taxSummary: null,
          creditCheck: null,
          lines: [],
        });
        return receive.receiveNote({
          partnerId: fixture.partners.customer.id,
          kind: "CHEQUE",
          number: "N-CHQ-DRAFT-SRC",
          amount: "1000.0000",
          currency: "SAR",
          maturityDate: "2026-07-01",
          sourceInvoiceId: draft.id,
          eventDate: "2026-06-10",
          actorId: N_ACTOR,
        });
      }),
    ).rejects.toMatchObject({ code: "NOTE_SOURCE_INVALID" });
    expect(await residue()).toEqual(before);
  });

  it("NOTE_SOURCE_INVALID: a partner mismatch never settles (the invoice belongs to someone else)", async () => {
    const before = await residue();
    await expect(
      withTenant(TENANT_N, () =>
        receive.receiveNote({
          partnerId: fixture.partners.customer.id,
          kind: "CHEQUE",
          number: "N-CHQ-PARTNER-X",
          amount: "1000.0000",
          currency: "SAR",
          maturityDate: "2026-07-01",
          sourceInvoiceId: fixture.invoices.customerFx,
          eventDate: "2026-06-10",
          actorId: N_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "NOTE_SOURCE_INVALID" });
    expect(await residue()).toEqual(before);
  });

  it("NOTE_CURRENCY_MISMATCH: the note currency must equal the source invoice currency", async () => {
    const before = await residue();
    await expect(
      withTenant(TENANT_N, () =>
        receive.receiveNote({
          partnerId: fixture.partners.customer.id,
          kind: "CHEQUE",
          number: "N-CHQ-CCY-X",
          amount: "1000.0000",
          currency: "USD",
          exchangeRate: "3.75",
          maturityDate: "2026-07-01",
          sourceInvoiceId: fixture.invoices.customer,
          eventDate: "2026-06-10",
          actorId: N_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "NOTE_CURRENCY_MISMATCH" });
    expect(await residue()).toEqual(before);
  });

  it("INV-016 (per-item bound): an explicit allocation beyond the outstanding rejects typed", async () => {
    const before = await residue();
    await expect(
      withTenant(TENANT_N, async () => {
        const minted = await mintPostedSalesInvoice({
          partnerId: fixture.partners.customer.id,
          amount: "1000.0000",
          currency: "SAR",
          invoiceNo: "N-INV-BOUND",
          invoiceDate: "2026-06-05",
        });
        return receive.receiveNote({
          partnerId: fixture.partners.customer.id,
          kind: "CHEQUE",
          number: "N-CHQ-BOUND",
          amount: "2000.0000",
          currency: "SAR",
          maturityDate: "2026-07-01",
          sourceInvoiceId: null,
          allocations: [{ openItemId: minted.itemId, amount: "1500.0000" }],
          eventDate: "2026-06-10",
          actorId: N_ACTOR,
        });
      }),
    ).rejects.toMatchObject({ code: "ALLOCATION_EXCEEDS_OPEN_ITEM" });
    expect(await residue()).toEqual(before);
  });

  it("INV-016 (document bound): Σ allocations beyond the note amount rejects typed", async () => {
    const before = await residue();
    await expect(
      withTenant(TENANT_N, async () => {
        const minted = await mintPostedSalesInvoice({
          partnerId: fixture.partners.customer.id,
          amount: "1000.0000",
          currency: "SAR",
          invoiceNo: "N-INV-DOCBOUND",
          invoiceDate: "2026-06-05",
        });
        return receive.receiveNote({
          partnerId: fixture.partners.customer.id,
          kind: "CHEQUE",
          number: "N-CHQ-DOCBOUND",
          amount: "1000.0000",
          currency: "SAR",
          maturityDate: "2026-07-01",
          sourceInvoiceId: null,
          allocations: [{ openItemId: minted.itemId, amount: "1500.0000" }],
          eventDate: "2026-06-10",
          actorId: N_ACTOR,
        });
      }),
    ).rejects.toMatchObject({ code: "ALLOCATION_EXCEEDS_DOCUMENT" });
    expect(await residue()).toEqual(before);
  });
});
