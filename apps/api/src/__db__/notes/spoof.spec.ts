import { beforeAll, describe, expect, it } from "vitest";

import {
  FOREIGN_FIXTURE_IDS,
  N_ACTOR,
  TENANT_N,
  TENANT_N_FOREIGN,
  collection,
  discount,
  dishonor,
  endorsement,
  noteService,
  receive,
  setupNotesFixture,
  su,
  withTenant,
  type NotesFixture,
} from "./fixtures";

/**
 * PHASE-027 wave G spoof suite (SECURITY_TEST_PLAN §2 — the S-04 row; the
 * fixed-assets spoof precedent): foreign partner / invoice / note ids in
 * notes payloads are rejected with typed 404-shape errors and ZERO partial
 * creation — the note row, its journal, its allocations, and its events all
 * roll back together, and every lookup is tenant-scoped so a foreign id is
 * indistinguishable from an unknown one (A7).
 *
 * The foreign world is REAL (a partner + posted invoice + a received note
 * that genuinely settled the foreign AR item, all inside TENANT_N_FOREIGN),
 * so the asymmetric dishonor probe can assert the foreign tenant's register
 * never gets restored by an attack aimed from tenant N.
 */

const UNKNOWN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let fixture: NotesFixture;

beforeAll(async () => {
  fixture = await setupNotesFixture();
});

/** Count rows the attack must NOT have created (superuser, tenant-scoped). */
async function countRows(sql: string, params: unknown[]): Promise<number> {
  const client = await su();
  const result = await client.query<{ n: number }>(sql, params);
  await client.end();
  return result.rows[0]?.n ?? 0;
}

/** Residue surfaces inside the FOREIGN tenant (must stay untouched). */
async function foreignResidue(): Promise<Record<string, number>> {
  const client = await su();
  const count = async (table: string): Promise<number> => {
    const result = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id = $1`,
      [TENANT_N_FOREIGN],
    );
    return result.rows[0]?.n ?? 0;
  };
  const snapshot = {
    notes: await count("notes"),
    events: await count("note_events"),
    journals: await count("journal_entries"),
    allocations: await count("treasury_allocations"),
  };
  await client.end();
  return snapshot;
}

describe("S-04 — foreign references in notes payloads → typed rejection, zero partial creation", () => {
  it("a note created against a foreign partner id is rejected; no note row survives", async () => {
    const before = await foreignResidue();
    const notesBefore = await countRows(`SELECT count(*)::int AS n FROM notes WHERE tenant_id = $1`, [TENANT_N]);
    await expect(
      withTenant(TENANT_N, () =>
        receive.receiveNote({
          partnerId: FOREIGN_FIXTURE_IDS.partner,
          kind: "CHEQUE",
          number: "N-CHQ-SPOOF-PARTNER",
          issuingBank: "Al Rajhi",
          amount: "1000.0000",
          currency: "SAR",
          maturityDate: "2026-07-01",
          eventDate: "2026-06-10",
          actorId: N_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "PARTNER_NOT_FOUND" });
    // Zero partial creation in EITHER tenant (the FK alone would have
    // surfaced an untyped 500 — the typed lookup fires first).
    expect(
      await countRows(`SELECT count(*)::int AS n FROM notes WHERE tenant_id = $1`, [TENANT_N]),
    ).toBe(notesBefore);
    expect(await foreignResidue()).toEqual(before);
  });

  it("a note created against a foreign invoice id is rejected with NOTE_SOURCE_INVALID; no note survives", async () => {
    const before = await foreignResidue();
    await expect(
      withTenant(TENANT_N, () =>
        receive.receiveNote({
          partnerId: fixture.partners.customer.id,
          kind: "CHEQUE",
          number: "N-CHQ-SPOOF-INVOICE",
          amount: "1000.0000",
          currency: "SAR",
          maturityDate: "2026-07-01",
          sourceInvoiceId: FOREIGN_FIXTURE_IDS.invoice,
          eventDate: "2026-06-10",
          actorId: N_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "NOTE_SOURCE_INVALID" });
    expect(
      await countRows(
        `SELECT count(*)::int AS n FROM notes WHERE tenant_id = $1 AND number = $2`,
        [TENANT_N, "N-CHQ-SPOOF-INVOICE"],
      ),
    ).toBe(0);
    expect(await foreignResidue()).toEqual(before);
  });

  it("endorse / dishonor / discount / collect on a foreign note id → NOTE_NOT_FOUND, zero effects anywhere", async () => {
    const before = await foreignResidue();
    // Thunks (NOT pre-created promises): each rejection gets its handler
    // attached immediately — no unhandled-rejection window between them.
    const attempts: [string, () => Promise<unknown>][] = [
      [
        "endorse",
        () =>
          withTenant(TENANT_N, () =>
            endorsement.endorse({ noteId: fixture.foreign.noteId, eventDate: "2026-06-18", actorId: N_ACTOR }),
          ),
      ],
      [
        "dishonor",
        () =>
          withTenant(TENANT_N, () =>
            dishonor.dishonor({
              noteId: fixture.foreign.noteId,
              reason: "spoofed dishonor",
              eventDate: "2026-06-25",
              actorId: N_ACTOR,
            }),
          ),
      ],
      [
        "discount",
        () =>
          withTenant(TENANT_N, () =>
            discount.discount({
              noteId: fixture.foreign.noteId,
              cashAccountId: fixture.bank.sar,
              fee: "10.0000",
              eventDate: "2026-06-22",
              actorId: N_ACTOR,
            }),
          ),
      ],
      [
        "collect",
        () =>
          withTenant(TENANT_N, () =>
            collection.collect({
              noteId: fixture.foreign.noteId,
              cashAccountId: fixture.bank.sar,
              eventDate: "2026-07-10",
              actorId: N_ACTOR,
            }),
          ),
      ],
    ];
    for (const [label, attempt] of attempts) {
      await expect(attempt(), `the ${label} attack must reject typed`).rejects.toMatchObject({
        code: "NOTE_NOT_FOUND",
      });
    }
    // Zero events / journals for the foreign tenant — the register never moved.
    expect(await foreignResidue()).toEqual(before);
  });

  it("the asymmetric dishonor NEVER restores the foreign AR item (the spoofed restore probe)", async () => {
    const before = await foreignResidue();
    // The foreign item is settled by the foreign note (outstanding 0). A
    // successful spoof would flip it back to 1000.
    await expect(
      withTenant(TENANT_N, () =>
        dishonor.dishonor({
          noteId: fixture.foreign.noteId,
          reason: "cross-tenant restore attempt",
          eventDate: "2026-06-25",
          actorId: N_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "NOTE_NOT_FOUND" });
    const open = await withTenant(TENANT_N_FOREIGN, async () => {
      const treasury = await import("../../modules/treasury/infrastructure/treasury.store");
      return treasury.listOpenItems({
        partnerId: fixture.foreign.partnerId,
        side: "AR",
        openOnly: true,
        limit: 200,
      });
    });
    expect(open.filter((row) => row.id === fixture.foreign.itemId)).toHaveLength(0);
    expect(await foreignResidue()).toEqual(before);
    // The foreign note row itself is untouched (still IN_CUSTODY).
    const noteRow = await withTenant(TENANT_N_FOREIGN, async () => {
      const store = await import("../../modules/notes/infrastructure/notes.store");
      return store.findNoteById(fixture.foreign.noteId);
    });
    expect(noteRow!.status).toBe("IN_CUSTODY");
  });

  it("A7 route id-probe parity: unknown-vs-foreign ids render identically (typed 404s)", async () => {
    const unknown = await withTenant(TENANT_N, () =>
      noteServiceSafe(UNKNOWN_ID),
    );
    const foreign = await withTenant(TENANT_N, () => noteServiceSafe(fixture.foreign.noteId));
    expect(unknown).toBe("NOTE_NOT_FOUND");
    expect(foreign).toBe("NOTE_NOT_FOUND");

    // Source-invoice probes: unknown and foreign invoice ids both render as
    // NOTE_SOURCE_INVALID (never a different shape).
    const unknownInvoice = await withTenant(TENANT_N, () =>
      receive
        .receiveNote({
          partnerId: fixture.partners.customer.id,
          kind: "CHEQUE",
          amount: "1000.0000",
          currency: "SAR",
          maturityDate: "2026-07-01",
          sourceInvoiceId: UNKNOWN_ID,
          eventDate: "2026-06-10",
          actorId: N_ACTOR,
        })
        .catch((error: { code?: string }) => error.code),
    );
    const foreignInvoice = await withTenant(TENANT_N, () =>
      receive
        .receiveNote({
          partnerId: fixture.partners.customer.id,
          kind: "CHEQUE",
          amount: "1000.0000",
          currency: "SAR",
          maturityDate: "2026-07-01",
          sourceInvoiceId: FOREIGN_FIXTURE_IDS.invoice,
          eventDate: "2026-06-10",
          actorId: N_ACTOR,
        })
        .catch((error: { code?: string }) => error.code),
    );
    expect(unknownInvoice).toBe("NOTE_SOURCE_INVALID");
    expect(foreignInvoice).toBe("NOTE_SOURCE_INVALID");
  });
});

/** getNote probe → its typed error code (the parity helper). */
async function noteServiceSafe(id: string): Promise<string> {
  try {
    await noteService.getNote(id);
    return "NO_ERROR";
  } catch (error) {
    return (error as { code?: string }).code ?? "UNKNOWN";
  }
}
