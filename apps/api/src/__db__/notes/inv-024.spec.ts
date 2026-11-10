import { beforeAll, describe, expect, it } from "vitest";

import { Decimal } from "@erp/domain-core";

import {
  N_ACTOR,
  TENANT_N,
  collection,
  dishonor,
  discount,
  endorsement,
  issue,
  mintPostedSalesInvoice,
  mintPostedSupplierInvoice,
  receive,
  setupNotesFixture,
  withTenant,
  type NotesFixture,
} from "./fixtures";

/**
 * inv-024.spec (PHASE-027 wave G — ACCOUNTING_INVARIANTS §INV-024; the
 * accounting/invariants property-suite style): custody equals journal
 * effects. For EVERY status in the custody graph the register fold
 * (notesRegisterExpectedSides) must carry exactly the live statuses'
 * amount×rate — every terminal state contributes ZERO — and the money
 * moments (collect/dishonor/return/discount) are the ONLY journal writers
 * (endorsement never journals).
 */

let fixture: NotesFixture;

beforeAll(async () => {
  fixture = await setupNotesFixture();
});

function n4(value: string | number | null | undefined): string {
  return new Decimal(String(value ?? "0")).toDecimalPlaces(4).toFixed(4);
}

/** Fold over the CURRENT live register (the RC-11 input). */
async function liveFold(): Promise<{ received: string; issued: string; ids: string[] }> {
  return withTenant(TENANT_N, async () => {
    const store = await import("../../modules/notes/infrastructure/notes.store");
    const { notesRegisterExpectedSides } = await import("../../modules/notes/application/notes-reconciliation");
    const live = await store.listLiveNotes(500);
    const sides = notesRegisterExpectedSides(
      live.map((note) => ({ direction: note.direction, amount: note.amount, exchangeRate: note.exchangeRate })),
    );
    return {
      received: sides.find((side) => side.purposeKey === "NOTES_RECEIVABLE")!.expected,
      issued: sides.find((side) => side.purposeKey === "NOTES_PAYABLE")!.expected,
      ids: live.map((note) => note.id),
    };
  });
}

describe("INV-024 — the pure register fold (live statuses carry amount×rate)", () => {
  it("folds both directions at exact 4dp with live counts", async () => {
    const { notesRegisterExpectedSides } = await import(
      "../../modules/notes/application/notes-reconciliation"
    );
    const sides = notesRegisterExpectedSides([
      { direction: "RECEIVED", amount: "1000.0000", exchangeRate: "3.750000" },
      { direction: "RECEIVED", amount: "500.0000", exchangeRate: "1" },
      { direction: "ISSUED", amount: "2500.0000", exchangeRate: "1" },
    ]);
    expect(sides).toEqual([
      { purposeKey: "NOTES_RECEIVABLE", direction: "RECEIVED", expected: "4250.0000", notes: 2 },
      { purposeKey: "NOTES_PAYABLE", direction: "ISSUED", expected: "2500.0000", notes: 1 },
    ]);
    // An empty register folds to zero on both sides.
    expect(notesRegisterExpectedSides([])).toEqual([
      { purposeKey: "NOTES_RECEIVABLE", direction: "RECEIVED", expected: "0.0000", notes: 0 },
      { purposeKey: "NOTES_PAYABLE", direction: "ISSUED", expected: "0.0000", notes: 0 },
    ]);
  });
});

describe("INV-024 — every live status carries its note; every terminal status contributes zero", () => {
  it("walks one note per terminal state; the live register follows custody exactly", async () => {
    const journal = await import("../../modules/accounting/infrastructure/journal.store");
    const treasury = await import("../../modules/treasury/infrastructure/treasury.store");
    const foldBefore = await liveFold();

    // (1) IN_CUSTODY: received note R (1,000 SAR) — live, carries 1000.
    const worldR = await withTenant(TENANT_N, async () => {
      const minted = await mintPostedSalesInvoice({
        partnerId: fixture.partners.customer.id,
        amount: "1000.0000",
        currency: "SAR",
        invoiceNo: "N-INV-INV024-R",
        invoiceDate: "2026-06-05",
      });
      const note = await receive.receiveNote({
        partnerId: fixture.partners.customer.id,
        kind: "CHEQUE",
        number: "N-CHQ-INV024-R",
        amount: "1000.0000",
        currency: "SAR",
        maturityDate: "2026-07-01",
        sourceInvoiceId: minted.invoiceId,
        eventDate: "2026-06-10",
        actorId: N_ACTOR,
      });
      return { noteId: note.id, itemId: minted.itemId };
    });
    let fold = await liveFold();
    expect(fold.ids).toContain(worldR.noteId);
    expect(fold.received).toBe(
      new Decimal(foldBefore.received).plus("1000.0000").toDecimalPlaces(4).toFixed(4),
    );

    // (2) ENDORSED_OUT: custody moves, the note stays live — same fold.
    const journalsBeforeEndorse = await withTenant(TENANT_N, () =>
      journal.listEntries({ limit: 1_000_000 }).then((page) => page.rows.length),
    );
    await withTenant(TENANT_N, () =>
      endorsement.endorse({ noteId: worldR.noteId, eventDate: "2026-06-18", endorsee: "SNB", actorId: N_ACTOR }),
    );
    fold = await liveFold();
    expect(fold.ids).toContain(worldR.noteId);
    expect(fold.received).toBe(
      new Decimal(foldBefore.received).plus("1000.0000").toDecimalPlaces(4).toFixed(4),
    );
    // Endorsement never journals (BR-047): the ledger is unchanged.
    const journalsAfterEndorse = await withTenant(TENANT_N, () =>
      journal.listEntries({ limit: 1_000_000 }).then((page) => page.rows.length),
    );
    expect(journalsAfterEndorse).toBe(journalsBeforeEndorse);

    // (3) COLLECTED: terminal — the note leaves the register, zero side.
    await withTenant(TENANT_N, () =>
      collection.collect({ noteId: worldR.noteId, cashAccountId: fixture.bank.sar, eventDate: "2026-07-10", actorId: N_ACTOR }),
    );
    fold = await liveFold();
    expect(fold.ids).not.toContain(worldR.noteId);
    expect(fold.received).toBe(foldBefore.received);

    // (4) DEPOSITED: a second note D deposits — live, carries its amount.
    const worldD = await withTenant(TENANT_N, async () => {
      const minted = await mintPostedSalesInvoice({
        partnerId: fixture.partners.customer.id,
        amount: "1000.0000",
        currency: "SAR",
        invoiceNo: "N-INV-INV024-D",
        invoiceDate: "2026-06-05",
      });
      const note = await receive.receiveNote({
        partnerId: fixture.partners.customer.id,
        kind: "CHEQUE",
        number: "N-CHQ-INV024-D",
        amount: "1000.0000",
        currency: "SAR",
        maturityDate: "2026-07-01",
        sourceInvoiceId: minted.invoiceId,
        eventDate: "2026-06-10",
        actorId: N_ACTOR,
      });
      await collection.deposit({ noteId: note.id, cashAccountId: fixture.bank.sar, eventDate: "2026-06-20", actorId: N_ACTOR });
      return { noteId: note.id, itemId: minted.itemId };
    });
    fold = await liveFold();
    expect(fold.ids).toContain(worldD.noteId);

    // (5) DISHONORED: terminal — zero side AND the original item byte-equal.
    const settledItem = await withTenant(TENANT_N, () => treasury.findOpenItemById(worldD.itemId));
    await withTenant(TENANT_N, () =>
      dishonor.dishonor({ noteId: worldD.noteId, reason: "bounced at the bank", eventDate: "2026-06-28", actorId: N_ACTOR }),
    );
    fold = await liveFold();
    expect(fold.ids).not.toContain(worldD.noteId);
    expect(fold.received).toBe(foldBefore.received);
    const restored = await withTenant(TENANT_N, () => treasury.findOpenItemById(worldD.itemId));
    expect(restored!.id).toBe(settledItem!.id);
    expect(restored!.amount).toBe(settledItem!.amount);
    expect(n4(restored!.outstanding)).toBe("1000.0000");
    // The note purpose side contributes zero for the whole graph so far.
    const nrBalance = await withTenant(TENANT_N, () =>
      journal.controlAccountBalance(fixture.accountIds.notesReceivable),
    );
    const expectedNr = new Decimal(fold.received);
    expect(n4(nrBalance)).toBe(expectedNr.toDecimalPlaces(4).toFixed(4));

    // (6) DISCOUNTED + RETURNED: the last two terminal states.
    const worldK = await withTenant(TENANT_N, async () => {
      const minted = await mintPostedSalesInvoice({
        partnerId: fixture.partners.customer.id,
        amount: "1000.0000",
        currency: "SAR",
        invoiceNo: "N-INV-INV024-K",
        invoiceDate: "2026-06-05",
      });
      const note = await receive.receiveNote({
        partnerId: fixture.partners.customer.id,
        kind: "CHEQUE",
        number: "N-CHQ-INV024-K",
        amount: "1000.0000",
        currency: "SAR",
        maturityDate: "2026-07-01",
        sourceInvoiceId: minted.invoiceId,
        eventDate: "2026-06-10",
        actorId: N_ACTOR,
      });
      return { noteId: note.id };
    });
    await withTenant(TENANT_N, () =>
      discount.discount({ noteId: worldK.noteId, cashAccountId: fixture.bank.sar, fee: "50.0000", eventDate: "2026-06-22", actorId: N_ACTOR }),
    );
    const worldT = await withTenant(TENANT_N, async () => {
      const minted = await mintPostedSupplierInvoice({
        partnerId: fixture.partners.supplier.id,
        amount: "2500.0000",
        currency: "SAR",
        invoiceNo: "N-SUPP-INV024-T",
        internalNo: "N-SUPP-INV024-T",
        invoiceDate: "2026-06-05",
      });
      const noteId = await issueAgainst(minted.invoiceId);
      return { noteId };
    });
    await withTenant(TENANT_N, () =>
      dishonor.returnNote({ noteId: worldT.noteId, eventDate: "2026-06-25", actorId: N_ACTOR }),
    );
    fold = await liveFold();
    expect(fold.ids).not.toContain(worldK.noteId);
    expect(fold.ids).not.toContain(worldT.noteId);
    // The whole register now ties: GL == fold on BOTH purpose sides. The
    // payable side is CREDIT-natured (G-27 credits NOTES_PAYABLE), so its raw
    // signed DEBIT−CREDIT balance is negative while the register fold is
    // positive — compare CREDIT-POSITIVE, the fixed-assets accum / GRNI sign
    // convention (the same convention RC-11's GL read now applies).
    const npSigned = await withTenant(TENANT_N, () =>
      journal.controlAccountBalance(fixture.accountIds.notesPayable),
    );
    expect(n4(npSigned)).toBe(new Decimal(fold.issued).negated().toDecimalPlaces(4).toFixed(4));
    expect(n4(nrBalance)).toBe(new Decimal(fold.received).toDecimalPlaces(4).toFixed(4));
  });
});

/** Issues a note against a minted supplier invoice id (INV-024 helper). */
async function issueAgainst(supplierInvoiceId: string): Promise<string> {
  const issued = await issue.issueNote({
    partnerId: fixture.partners.supplier.id,
    kind: "PROMISSORY_NOTE",
    number: "N-PN-INV024-T",
    amount: "2500.0000",
    currency: "SAR",
    maturityDate: "2026-07-01",
    sourceInvoiceId: supplierInvoiceId,
    eventDate: "2026-06-10",
    actorId: N_ACTOR,
  });
  return issued.id;
}
