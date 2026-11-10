import { beforeAll, describe, expect, it } from "vitest";

import { Decimal } from "@erp/domain-core";

import {
  N_ACTOR,
  TENANT_N,
  collection,
  dishonor,
  issue,
  mintPostedSalesInvoice,
  mintPostedSupplierInvoice,
  notesReconciliation,
  periods,
  receive,
  setupNotesFixture,
  su,
  withTenant,
  type NotesFixture,
} from "./fixtures";

/**
 * rc-11.spec (PHASE-027 wave G — RECONCILIATION.md §1 row 11): the notes
 * register ↔ GL check. Green after each event set (register == GL == the
 * pure fold's expectation); SEEDED DRIFT (a note row without its journal)
 * surfaces BROKEN; PC-04 blocks the period LOCK over the BROKEN run; the
 * documented cleanup heals the register and the lock proceeds.
 */

let fixture: NotesFixture;

beforeAll(async () => {
  fixture = await setupNotesFixture();
});

function n4(value: string | number | null | undefined): string {
  return new Decimal(String(value ?? "0")).toDecimalPlaces(4).toFixed(4);
}

/** Runs the RC-11 check in tenant N's scope. */
async function runCheck(asOf: string) {
  return withTenant(TENANT_N, () =>
    notesReconciliation.runNotesCheck({ asOf, runMode: "ON_DEMAND", checkedBy: N_ACTOR }),
  );
}

/** The register-side expectation the check must equal (the pure fold). */
async function expectedSides(): Promise<{ received: string; issued: string }> {
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
    };
  });
}

describe("RC-11 — green after each event set (register == GL == the fold's expectation)", () => {
  it("receive → collect → dishonor all leave the check OK with exact balances", async () => {
    // (1) RECEIVE: a live note carries its full side on the GL.
    const worldA = await withTenant(TENANT_N, async () => {
      const minted = await mintPostedSalesInvoice({
        partnerId: fixture.partners.customer.id,
        amount: "1000.0000",
        currency: "SAR",
        invoiceNo: "N-INV-RC11-A",
        invoiceDate: "2026-06-05",
      });
      const note = await receive.receiveNote({
        partnerId: fixture.partners.customer.id,
        kind: "CHEQUE",
        number: "N-CHQ-RC11-A",
        amount: "1000.0000",
        currency: "SAR",
        maturityDate: "2026-07-01",
        sourceInvoiceId: minted.invoiceId,
        eventDate: "2026-06-10",
        actorId: N_ACTOR,
      });
      return { noteId: note.id };
    });
    let run = await runCheck("2026-06-28");
    let expected = await expectedSides();
    expect(run.status).toBe("OK");
    expect(n4(run.subledgerBalance)).toBe(
      new Decimal(expected.received).plus(expected.issued).toDecimalPlaces(4).toFixed(4),
    );
    expect(n4(run.controlBalance)).toBe(n4(run.subledgerBalance));
    expect(run.diffCount).toBe(0);
    // The close-checklist row renders OK for a healthy run WITH live notes
    // (asserted here — at this point note A is live; by the end of the test
    // every note is resolved and the honest checklist state is
    // NOT_APPLICABLE, "no live notes — nothing to reconcile").
    const { notesCheckItem } = await import("../../modules/notes/application/notes-reconciliation");
    const itemWithLiveNotes = notesCheckItem(run);
    expect(itemWithLiveNotes.state).toBe("OK");
    expect(itemWithLiveNotes.detail).toContain("RC-11");

    // (2) COLLECT: the note leaves the register AND the GL together.
    await withTenant(TENANT_N, () =>
      collection.collect({ noteId: worldA.noteId, cashAccountId: fixture.bank.sar, eventDate: "2026-07-10", actorId: N_ACTOR }),
    );
    run = await runCheck("2026-06-28");
    expected = await expectedSides();
    expect(run.status).toBe("OK");
    expect(n4(run.controlBalance)).toBe(
      new Decimal(expected.received).plus(expected.issued).toDecimalPlaces(4).toFixed(4),
    );

    // (3) DISHONOR: the restore keeps both sides in lockstep.
    const worldB = await withTenant(TENANT_N, async () => {
      const minted = await mintPostedSalesInvoice({
        partnerId: fixture.partners.customer.id,
        amount: "1000.0000",
        currency: "SAR",
        invoiceNo: "N-INV-RC11-B",
        invoiceDate: "2026-06-05",
      });
      const note = await receive.receiveNote({
        partnerId: fixture.partners.customer.id,
        kind: "CHEQUE",
        number: "N-CHQ-RC11-B",
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
      dishonor.dishonor({ noteId: worldB.noteId, reason: "bounced", eventDate: "2026-06-27", actorId: N_ACTOR }),
    );
    run = await runCheck("2026-06-28");
    expect(run.status).toBe("OK");
    expect(n4(run.controlBalance)).toBe(n4(run.subledgerBalance));

    // (4) ISSUED (the credit-natured side): a live ISSUED note must tie too —
    // NOTES_PAYABLE's signed DEBIT−CREDIT balance is negative while the
    // register fold is positive, so the check reads the GL side
    // CREDIT-POSITIVE (the fixed-assets accum / GRNI sign convention; the
    // P27-G fix — before it, any tenant holding issued notes read BROKEN on
    // a perfectly tied register).
    const worldC = await withTenant(TENANT_N, async () => {
      const minted = await mintPostedSupplierInvoice({
        partnerId: fixture.partners.supplier.id,
        amount: "2500.0000",
        currency: "SAR",
        invoiceNo: "N-SUPP-RC11-C",
        internalNo: "N-SUPP-RC11-C",
        invoiceDate: "2026-06-05",
      });
      const note = await issue.issueNote({
        partnerId: fixture.partners.supplier.id,
        kind: "PROMISSORY_NOTE",
        number: "N-PN-RC11-C",
        amount: "2500.0000",
        currency: "SAR",
        maturityDate: "2026-07-01",
        sourceInvoiceId: minted.invoiceId,
        eventDate: "2026-06-10",
        actorId: N_ACTOR,
      });
      return { noteId: note.id };
    });
    run = await runCheck("2026-06-28");
    expected = await expectedSides();
    expect(run.status).toBe("OK");
    expect(run.diffCount).toBe(0);
    expect(n4(run.subledgerBalance)).toBe(
      new Decimal(expected.received).plus(expected.issued).toDecimalPlaces(4).toFixed(4),
    );
    expect(n4(run.controlBalance)).toBe(n4(run.subledgerBalance));
    // And the check stays green once the issued note is paid at maturity
    // (the G-27 mirror leaves both sides together).
    await withTenant(TENANT_N, () =>
      collection.collect({ noteId: worldC.noteId, cashAccountId: fixture.bank.sar, eventDate: "2026-07-10", actorId: N_ACTOR }),
    );
    run = await runCheck("2026-06-28");
    expect(run.status).toBe("OK");
    expect(n4(run.controlBalance)).toBe(n4(run.subledgerBalance));

    // The final checklist state derives from THIS run's recorded live count
    // (the file order across spec files is not deterministic — notes-rules
    // may or may not have left its live G-27 note in the shared tenant — so
    // the honest assertion is the mapping, not a coincidental emptiness):
    // an empty register ⇒ NOT_APPLICABLE ("no live notes"); any live note ⇒
    // OK naming RC-11 (the OK-with-live-notes shape is also asserted right
    // after the RECEIVE step above).
    const finalItem = notesCheckItem(run);
    const liveCount = (run.diff as { notes?: number }).notes ?? 0;
    if (liveCount === 0) {
      expect(finalItem.state).toBe("NOT_APPLICABLE");
      expect(finalItem.detail).toContain("no live notes");
    } else {
      expect(finalItem.state).toBe("OK");
      expect(finalItem.detail).toContain("RC-11");
    }
  });
});

describe("RC-11 — SEEDED DRIFT: a note row without its journal breaks the check", () => {
  it("superuser-inserted drift (500 IN_CUSTODY, no journal) → BROKEN with the exact delta", async () => {
    const greenBefore = await runCheck("2026-06-28");
    const liveBefore = (greenBefore.diff as { notes?: number }).notes ?? 0;

    // The drift: a register row WITHOUT its G-24 journal (external write —
    // the only way to break the invariant; the services can never do this).
    const client = await su();
    await client.query(
      `INSERT INTO notes (id, tenant_id, kind, direction, partner_id, number, amount, currency,
          exchange_rate, maturity_date, status, source_type, source_id, note)
        VALUES (gen_random_uuid(), $1, 'CHEQUE', 'RECEIVED', $2, 'DRIFT-RC11-1', 500, 'SAR',
          1, '2026-07-01', 'IN_CUSTODY', NULL, NULL, 'seeded drift row')`,
      [TENANT_N, fixture.partners.customer.id],
    );
    await client.end();

    const broken = await runCheck("2026-06-30");
    expect(broken.status).toBe("BROKEN");
    expect(broken.diffCount).toBeGreaterThanOrEqual(1);
    // The offending register row joined the fold: live count +1, and the
    // register side exceeds the GL by exactly the drift (500).
    expect((broken.diff as { notes?: number }).notes).toBe(liveBefore + 1);
    const delta = new Decimal(broken.subledgerBalance).minus(broken.controlBalance);
    expect(delta.toDecimalPlaces(4).toFixed(4)).toBe("500.0000");
    // The offending row names the NOTES_RECEIVABLE side.
    const rows = (broken.diff as { rows: { purposeKey: string; expected: string; actual: string }[] }).rows;
    const nrRow = rows.find((row) => row.purposeKey === "NOTES_RECEIVABLE");
    expect(nrRow).toBeDefined();
    expect(n4(nrRow!.expected)).toBe(
      new Decimal(
        (await expectedSides()).received,
      ).toDecimalPlaces(4).toFixed(4),
    );

    // The critical inbox notification fired (category reconciliation).
    const inboxClient = await su();
    const inbox = await inboxClient.query(
      `SELECT category, severity FROM notifications WHERE tenant_id = $1 AND dedupe_key = $2`,
      [TENANT_N, `notes-reconciliation-broken:${broken.id}`],
    );
    await inboxClient.end();
    expect(inbox.rows).toEqual([{ category: "reconciliation", severity: "critical" }]);

    // PC-04: the BROKEN run blocks the period LOCK covering the drift.
    const june = fixture.periodIds["FY2026-06"]!;
    await withTenant(TENANT_N, async () => {
      await periods.softClose(N_ACTOR, june);
    });
    await expect(withTenant(TENANT_N, () => periods.lock(N_ACTOR, june))).rejects.toMatchObject({
      code: "RECONCILIATION_BROKEN",
      details: { kind: "NOTES" },
    });
    // The close-checklist row renders BROKEN and names PC-04.
    const { notesCheckItem } = await import("../../modules/notes/application/notes-reconciliation");
    const item = notesCheckItem(broken);
    expect(item.state).toBe("BROKEN");
    expect(item.detail).toContain("PC-04");

    // Documented cleanup: delete the drift row (superuser; the register
    // repair in production is a compensating document, never a re-write).
    const cleanup = await su();
    await cleanup.query(`DELETE FROM notes WHERE tenant_id = $1 AND number = 'DRIFT-RC11-1'`, [TENANT_N]);
    await cleanup.end();

    // Healed: the check goes green again and the lock proceeds.
    const healed = await runCheck("2026-06-30");
    expect(healed.status).toBe("OK");
    expect(n4(healed.controlBalance)).toBe(n4(healed.subledgerBalance));
    const locked = await withTenant(TENANT_N, () => periods.lock(N_ACTOR, june));
    expect(locked.status).toBe("LOCKED");
    // Cross-suite hygiene: reopen June for the suites that follow.
    await withTenant(TENANT_N, () =>
      periods.reopen(N_ACTOR, june, "rc-11 PC-04 pack: period-lock restore"),
    );
  });
});
