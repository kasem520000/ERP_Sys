import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import { setupTradeFixture, TENANT_TRADE, TR_ACTOR } from "./fixtures";
import { CollectionsService } from "../../modules/trade/application/collections-service";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import {
  CollectionRecordNotFoundError,
  CollectionSettlementInvalidError,
  CollectionStateError,
  CollectionUsanceError,
  TradeInputInvalidError,
} from "../../modules/trade/domain/trade-errors";

/**
 * PHASE-051 (W-35 — T-07, 2026-11-25) `trade-collections.db.spec` — THE
 * DOCUMENTARY COLLECTIONS ENGINE over real PG16 (the plan §4's own arm;
 * the master plan §3 W-35's exit: the collections fold's settlement
 * windows): the D/P golden lifecycle (at sight — present → settle with
 * the settled pair landing TOGETHER) and the D/A golden lifecycle
 * (usance — present → accept → settle at its recorded maturity), every
 * rung's stamps proven on their own floor (the 0119 XOR laws hold by
 * the CAS statements' own shapes), the usance floor's refusal, the
 * terms gates (the D/P never accepts · the D/A settles only from its
 * acceptance), the stamp law's OPEN-only exit, the settlement pair's
 * shape, the terminal law, and THE NON-LEDGER LAW — the register
 * carries ZERO journal entries and ZERO cash movements by design (the
 * money lands through the existing receipts discipline; the matrix's
 * own wording).
 *
 * THE PER-ARM-WORLD LAW (the owner's «أذرع الرفض كلٌّ على عالمه»): every
 * arm builds its own collection through the service's own create (the
 * official COLL number reserves per row — every world naturally
 * unique); a rejection arm never shares mutable rows with another arm.
 */

const audit = new AuditService(new DrizzleAuditStore());
const numbering = new NumberingService(audit);
const collections = new CollectionsService(audit, numbering);

const world: { purchaseOrderId?: string } = {};

beforeAll(async () => {
  const fixture = await setupTradeFixture();
  // A purchase order link for the golden lifecycles' chain arm: the
  // PO → collection link (acceptance #8's chain, the D-15 (b)
  // documented contract's trade side) — created through the REAL PO
  // service inside the tenant's own scope.
  await withTenant(TENANT_TRADE, async () => {
    const { PurchaseOrderService } = await import("../../modules/purchasing/application/orders");
    const purchaseOrders = new PurchaseOrderService(audit, numbering);
    const po = await purchaseOrders.create({
      branchId: fixture.branchId,
      supplierId: fixture.supplierId,
      orderDate: "2026-11-25",
      expectedDate: null,
      currencyCode: "SAR",
      exchangeRate: null,
      note: null,
      noteAr: null,
      actorId: TR_ACTOR,
      lines: [
        { itemId: fixture.itemId, qty: "10", unitPrice: "45.000000", taxCodeId: null, requestLineId: null, note: null },
      ],
    });
    world.purchaseOrderId = po.id;
  });
});

/** The register row's raw read (the XOR floors' own assertions). */
async function rawCollection(id: string) {
  const rows = await requireTenantContext().tx!.execute<{
    status: string;
    presentedAt: string | null;
    acceptedAt: string | null;
    paidAt: string | null;
    settledAt: string | null;
    settlementRef: string | null;
    dueDate: string | null;
    documents: string[];
  }>(sql`
    SELECT status, presented_at::text AS "presentedAt", accepted_at::text AS "acceptedAt",
           paid_at::text AS "paidAt", settled_at::text AS "settledAt",
           settlement_ref AS "settlementRef", due_date::text AS "dueDate", documents
    FROM documentary_collections WHERE id = ${id}
  `);
  return rows.rows[0]!;
}

/** THE NON-LEDGER READ: zero journals, zero movements, for a register row. */
async function ledgerFootprintOf(collectionId: string): Promise<{ journals: number; movements: number }> {
  const tx = requireTenantContext().tx!;
  const journals = await tx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM journal_entries
    WHERE source_type = 'documentary_collections' AND source_id = ${collectionId}`);
  const movements = await tx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM cash_movements
    WHERE source_type = 'documentary_collections' AND source_id = ${collectionId}`);
  return { journals: journals.rows[0]!.n, movements: movements.rows[0]!.n };
}

async function auditActionsOf(collectionId: string): Promise<string[]> {
  const rows = await requireTenantContext().tx!.execute<{ action: string }>(sql`
    SELECT action FROM audit_events
    WHERE entity_type = 'documentary_collections' AND entity_id = ${collectionId}
    ORDER BY at`);
  return rows.rows.map((row) => row.action);
}

describe("PHASE-051 W-35 — THE COLLECTIONS REGISTER (T-07: the D/P vs D/A settlement windows, the stamps' own floors, the non-ledger law)", () => {
  it("THE D/P GOLDEN LIFECYCLE (at sight): create → present → settle — the paid stamps + the settled pair land TOGETHER; the register carries ZERO ledger footprint; the audit trail walks the rungs", async () => {
    const created = await withTenant(TENANT_TRADE, () =>
      collections.create({
        purchaseOrderId: world.purchaseOrderId!,
        termsType: "D/P",
        amount: "42000.0000",
        currency: "USD",
        dueDate: null,
        documents: ["COMMERCIAL INVOICE", "BILL OF LADING", "CERTIFICATE OF ORIGIN"],
        note: null,
        noteAr: null,
        actorId: TR_ACTOR,
      }),
    );
    expect(created.status).toBe("OPEN");
    expect(created.collectionNo).toMatch(/^COLL-\d{4}-\d{6}$/);
    // The D/P's due_date stays free (the usance floor's other side).
    expect(created.dueDate).toBeNull();
    expect(created.documents).toEqual(["COMMERCIAL INVOICE", "BILL OF LADING", "CERTIFICATE OF ORIGIN"]);

    // ZERO RESIDUE at OPEN: no stamps anywhere.
    const open = await withTenant(TENANT_TRADE, () => rawCollection(created.id));
    expect(open.presentedAt).toBeNull();
    expect(open.acceptedAt).toBeNull();
    expect(open.paidAt).toBeNull();
    expect(open.settledAt).toBeNull();
    expect(open.settlementRef).toBeNull();

    const presented = await withTenant(TENANT_TRADE, () =>
      collections.present(created.id, { actorId: TR_ACTOR }));
    expect(presented.status).toBe("PRESENTED");
    expect(presented.presentedAt).not.toBeNull();
    expect(presented.acceptedAt).toBeNull();
    expect(presented.paidAt).toBeNull();

    const settled = await withTenant(TENANT_TRADE, () =>
      collections.settle(created.id, {
        settlementRef: "RECEIPT-2026-000214",
        actorId: TR_ACTOR,
      }),
    );
    expect(settled.status).toBe("PAID");
    expect(settled.paidAt).not.toBeNull();
    // THE SETTLED PAIR lands TOGETHER (the 0119 XOR floor's own law).
    expect(settled.settledAt).not.toBeNull();
    expect(settled.settlementRef).toBe("RECEIPT-2026-000214");
    // THE AT-SIGHT ACCEPTANCE (the 0119 accepted_shape floor's own
    // reading — declared interpretation #4 at the claim site): the PAID
    // row carries the FULL ceremony; a D/P's acceptance and payment are
    // one banking event (the same instant — accepted_at = paid_at).
    expect(settled.acceptedAt).not.toBeNull();
    const paidRow = await withTenant(TENANT_TRADE, () => rawCollection(created.id));
    expect(paidRow.acceptedAt).toBe(paidRow.paidAt);

    // THE NON-LEDGER LAW: zero journals, zero movements, forever.
    const footprint = await withTenant(TENANT_TRADE, () => ledgerFootprintOf(created.id));
    expect(footprint.journals).toBe(0);
    expect(footprint.movements).toBe(0);

    // The audit trail walks the rungs.
    const actions = await withTenant(TENANT_TRADE, () => auditActionsOf(created.id));
    expect(actions).toEqual([
      "trade.collection_created",
      "trade.collection_presented",
      "trade.collection_settled",
    ]);

    // THE TERMINAL LAW: the PAID register refuses every act.
    await expect(
      withTenant(TENANT_TRADE, () => collections.present(created.id, { actorId: TR_ACTOR })),
    ).rejects.toMatchObject({ code: "COLLECTION_STATE" });
    await expect(
      withTenant(TENANT_TRADE, () => collections.settle(created.id, { settlementRef: "X", actorId: TR_ACTOR })),
    ).rejects.toMatchObject({ code: "COLLECTION_STATE" });
    await expect(
      withTenant(TENANT_TRADE, () => collections.cancel(created.id, { actorId: TR_ACTOR })),
    ).rejects.toMatchObject({ code: "COLLECTION_STATE" });
  });

  it("THE D/A GOLDEN LIFECYCLE (usance): create (the maturity from birth) → present → accept (the usance act) → settle — the maturity rides the row as data; the settlement window is the acceptance", async () => {
    const created = await withTenant(TENANT_TRADE, () =>
      collections.create({
        termsType: "D/A",
        amount: "18000.0000",
        currency: "EUR",
        dueDate: "2027-03-31",
        documents: ["COMMERCIAL INVOICE", "BILL OF LADING"],
        actorId: TR_ACTOR,
      }),
    );
    // THE USANCE FLOOR: the D/A carries its maturity from birth.
    expect(created.dueDate).toBe("2027-03-31");

    // THE USANCE SETTLEMENT GATE: a usance collection refuses to settle
    // before its acceptance — the drawee's acceptance precedes the payment.
    await expect(
      withTenant(TENANT_TRADE, () =>
        collections.settle(created.id, { settlementRef: "EARLY-1", actorId: TR_ACTOR })),
    ).rejects.toMatchObject({ code: "COLLECTION_STATE" });

    const presented = await withTenant(TENANT_TRADE, () =>
      collections.present(created.id, { actorId: TR_ACTOR }));
    expect(presented.status).toBe("PRESENTED");

    const accepted = await withTenant(TENANT_TRADE, () =>
      collections.accept(created.id, { actorId: TR_ACTOR }));
    expect(accepted.status).toBe("ACCEPTED");
    expect(accepted.acceptedAt).not.toBeNull();
    expect(accepted.paidAt).toBeNull();

    // The declared interpretation's own arm: the maturity is DATA, never
    // a gate — the settlement records the bank's fact whenever it lands
    // (this arm settles BEFORE its 2027-03-31 maturity: early payment).
    const settled = await withTenant(TENANT_TRADE, () =>
      collections.settle(created.id, { settlementRef: "RECEIPT-2026-000215", actorId: TR_ACTOR }));
    expect(settled.status).toBe("PAID");
    expect(settled.settlementRef).toBe("RECEIPT-2026-000215");
    // The D/A's usance shape: the EXPLICIT acceptance rung precedes the
    // payment (accepted_at < paid_at — the register's own evidence
    // tells the terms apart from the D/P's at-sight instant).
    const daRow = await withTenant(TENANT_TRADE, () => rawCollection(created.id));
    expect(daRow.acceptedAt! < daRow.paidAt!).toBe(true);

    const footprint = await withTenant(TENANT_TRADE, () => ledgerFootprintOf(created.id));
    expect(footprint.journals).toBe(0);
    expect(footprint.movements).toBe(0);
  });

  it("THE USANCE FLOOR'S REFUSAL: a D/A collection without its maturity never opens — the typed error, ZERO residue", async () => {
    await expect(
      withTenant(TENANT_TRADE, () =>
        collections.create({
          termsType: "D/A",
          amount: "9000.0000",
          currency: "USD",
          dueDate: null,
          documents: ["COMMERCIAL INVOICE"],
          actorId: TR_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "COLLECTION_USANCE_INVALID" });
    // ZERO RESIDUE: no OPEN row, no numbering gap consumed under a refusal
    // — the register carries only the successful arms' rows.
    const rows = await withTenant(TENANT_TRADE, async () => {
      const result = await requireTenantContext().tx!.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM documentary_collections
        WHERE tenant_id = ${TENANT_TRADE} AND currency = 'USD' AND amount = 9000`);
      return result.rows[0]!.n;
    });
    expect(rows).toBe(0);
  });

  it("THE TERMS GATES: the D/P never accepts (it pays at sight); the refusal names the register and the fold's own reason", async () => {
    const created = await withTenant(TENANT_TRADE, () =>
      collections.create({
        termsType: "D/P",
        amount: "5500.0000",
        currency: "SAR",
        documents: ["COMMERCIAL INVOICE"],
        actorId: TR_ACTOR,
      }),
    );
    await withTenant(TENANT_TRADE, () => collections.present(created.id, { actorId: TR_ACTOR }));
    const refusal = (await withTenant(TENANT_TRADE, () =>
      collections.accept(created.id, { actorId: TR_ACTOR }).catch((error: unknown) => error))) as CollectionStateError;
    expect(refusal).toBeInstanceOf(CollectionStateError);
    expect(refusal.code).toBe("COLLECTION_STATE");
    expect(refusal.details!.collectionNo).toBe(created.collectionNo);
    expect(refusal.details!.reason).toContain("pays at sight");
    // ZERO RESIDUE: the row stays PRESENTED, no acceptance stamp.
    const row = await withTenant(TENANT_TRADE, () => rawCollection(created.id));
    expect(row.status).toBe("PRESENTED");
    expect(row.acceptedAt).toBeNull();
  });

  it("THE STAMP LAW'S EXIT: the cancellation window is OPEN only — the presentation and the acceptance are monotone evidence; the refused cancel leaves the row untouched", async () => {
    // A PRESENTED collection cannot cancel (the stamps never regress).
    const presented = await withTenant(TENANT_TRADE, () =>
      collections.create({
        termsType: "D/P",
        amount: "3100.0000",
        currency: "SAR",
        documents: ["COMMERCIAL INVOICE"],
        actorId: TR_ACTOR,
      }),
    );
    await withTenant(TENANT_TRADE, () => collections.present(presented.id, { actorId: TR_ACTOR }));
    const refusal = (await withTenant(TENANT_TRADE, () =>
      collections.cancel(presented.id, { actorId: TR_ACTOR }).catch((error: unknown) => error))) as CollectionStateError;
    expect(refusal.code).toBe("COLLECTION_STATE");
    expect(refusal.details!.reason).toContain("stamps never regress");
    const stillPresented = await withTenant(TENANT_TRADE, () => rawCollection(presented.id));
    expect(stillPresented.status).toBe("PRESENTED");
    expect(stillPresented.presentedAt).not.toBeNull();

    // An ACCEPTED collection cannot cancel either (the drawee's signed
    // undertaking — its only exit is the settlement).
    const accepted = await withTenant(TENANT_TRADE, async () => {
      const row = await collections.create({
        termsType: "D/A",
        amount: "2400.0000",
        currency: "SAR",
        dueDate: "2027-05-31",
        documents: ["COMMERCIAL INVOICE"],
        actorId: TR_ACTOR,
      });
      await collections.present(row.id, { actorId: TR_ACTOR });
      await collections.accept(row.id, { actorId: TR_ACTOR });
      return row;
    });
    await expect(
      withTenant(TENANT_TRADE, () => collections.cancel(accepted.id, { actorId: TR_ACTOR })),
    ).rejects.toMatchObject({
      code: "COLLECTION_STATE",
      details: { reason: expect.stringContaining("signed undertaking") },
    });

    // An OPEN collection cancels freely — and the CANCELLED register is
    // terminal (no stamps ever landed on it, the XOR floor's own reading).
    const openRow = await withTenant(TENANT_TRADE, () =>
      collections.create({
        termsType: "D/P",
        amount: "700.0000",
        currency: "SAR",
        documents: ["COMMERCIAL INVOICE"],
        actorId: TR_ACTOR,
      }),
    );
    const cancelled = await withTenant(TENANT_TRADE, () =>
      collections.cancel(openRow.id, { actorId: TR_ACTOR }));
    expect(cancelled.status).toBe("CANCELLED");
    await expect(
      withTenant(TENANT_TRADE, () => collections.present(openRow.id, { actorId: TR_ACTOR })),
    ).rejects.toMatchObject({ code: "COLLECTION_STATE" });
    await expect(
      withTenant(TENANT_TRADE, () => collections.cancel(openRow.id, { actorId: TR_ACTOR })),
    ).rejects.toMatchObject({ code: "COLLECTION_STATE" });
  });

  it("THE SETTLEMENT PAIR'S SHAPE: the empty and the oversized references refuse (the typed error, ZERO residue); the double settle on a PAID row refuses by the terminal law", async () => {
    const created = await withTenant(TENANT_TRADE, () =>
      collections.create({
        termsType: "D/P",
        amount: "6400.0000",
        currency: "SAR",
        documents: ["COMMERCIAL INVOICE"],
        actorId: TR_ACTOR,
      }),
    );
    await withTenant(TENANT_TRADE, () => collections.present(created.id, { actorId: TR_ACTOR }));
    const empty = (await withTenant(TENANT_TRADE, () =>
      collections.settle(created.id, { settlementRef: "   ", actorId: TR_ACTOR })
        .catch((error: unknown) => error))) as CollectionSettlementInvalidError;
    expect(empty).toBeInstanceOf(CollectionSettlementInvalidError);
    expect(empty.code).toBe("COLLECTION_SETTLEMENT_INVALID");
    const oversized = "R".repeat(201);
    await expect(
      withTenant(TENANT_TRADE, () =>
        collections.settle(created.id, { settlementRef: oversized, actorId: TR_ACTOR })),
    ).rejects.toMatchObject({ code: "COLLECTION_SETTLEMENT_INVALID" });
    // ZERO RESIDUE: still PRESENTED, nothing stamped.
    const row = await withTenant(TENANT_TRADE, () => rawCollection(created.id));
    expect(row.status).toBe("PRESENTED");
    expect(row.paidAt).toBeNull();

    await withTenant(TENANT_TRADE, () =>
      collections.settle(created.id, { settlementRef: "RECEIPT-2026-000216", actorId: TR_ACTOR }));
    // The double settle: the terminal law's refusal (the single-use CAS).
    await expect(
      withTenant(TENANT_TRADE, () =>
        collections.settle(created.id, { settlementRef: "AGAIN-1", actorId: TR_ACTOR })),
    ).rejects.toMatchObject({ code: "COLLECTION_STATE" });
  });

  it("THE DOUBLE PRESENT: the stamp is single-use — the CAS refuses the second presentation; the unknown id is the typed 404 shape", async () => {
    const created = await withTenant(TENANT_TRADE, () =>
      collections.create({
        termsType: "D/A",
        amount: "5200.0000",
        currency: "USD",
        dueDate: "2027-08-31",
        documents: ["COMMERCIAL INVOICE"],
        actorId: TR_ACTOR,
      }),
    );
    await withTenant(TENANT_TRADE, () => collections.present(created.id, { actorId: TR_ACTOR }));
    await expect(
      withTenant(TENANT_TRADE, () => collections.present(created.id, { actorId: TR_ACTOR })),
    ).rejects.toMatchObject({ code: "COLLECTION_STATE" });

    const notFound = (await withTenant(TENANT_TRADE, () =>
      collections.find("9f9f9f9f-9f9f-4999-8999-9f9f9f9f9f9f")
        .catch((error: unknown) => error))) as CollectionRecordNotFoundError;
    expect(notFound).toBeInstanceOf(CollectionRecordNotFoundError);
    expect(notFound.code).toBe("COLLECTION_RECORD_NOT_FOUND");
  });

  it("THE DOCUMENTS SET: the empty set and the malformed entry refuse at create (the typed input floor, ZERO residue); the created set is frozen data", async () => {
    await expect(
      withTenant(TENANT_TRADE, () =>
        collections.create({
          termsType: "D/P",
          amount: "800.0000",
          currency: "SAR",
          documents: [],
          actorId: TR_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TradeInputInvalidError);
    await expect(
      withTenant(TENANT_TRADE, () =>
        collections.create({
          termsType: "D/P",
          amount: "800.0000",
          currency: "SAR",
          documents: ["BAD;ENTRY;WITH;SEMICOLONS!"],
          actorId: TR_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TradeInputInvalidError);
    // The terms vocabulary itself refuses (the input floor).
    await expect(
      withTenant(TENANT_TRADE, () =>
        collections.create({
          termsType: "D/X" as "D/P",
          amount: "800.0000",
          currency: "SAR",
          documents: ["COMMERCIAL INVOICE"],
          actorId: TR_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TradeInputInvalidError);
    // The bad-currency shape refuses (the ISO floor).
    await expect(
      withTenant(TENANT_TRADE, () =>
        collections.create({
          termsType: "D/P",
          amount: "800.0000",
          currency: "usd",
          documents: ["COMMERCIAL INVOICE"],
          actorId: TR_ACTOR,
        }),
      ),
    ).rejects.toBeInstanceOf(TradeInputInvalidError);
  });

  it("THE USANCE-FOLD TYPED ERROR'S OWN SHAPE (the refusal names the terms and the 0119 floor)", async () => {
    const refusal = (await withTenant(TENANT_TRADE, () =>
      collections.create({
        termsType: "D/A",
        amount: "1200.0000",
        currency: "SAR",
        dueDate: null,
        documents: ["COMMERCIAL INVOICE"],
        actorId: TR_ACTOR,
      }).catch((error: unknown) => error))) as CollectionUsanceError;
    expect(refusal).toBeInstanceOf(CollectionUsanceError);
    expect(refusal.code).toBe("COLLECTION_USANCE_INVALID");
    expect(refusal.details!.termsType).toBe("D/A");
    expect(refusal.details!.reason).toContain("usance floor");
  });
});
