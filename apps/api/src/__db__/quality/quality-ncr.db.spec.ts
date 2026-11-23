import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import {
  QL_ACTOR,
  TENANT_QUALITY,
  ensureQualityPostingWorld,
  freshQualityItem,
  freshQualityScrapWorld,
  setupQualityFixture,
  stock,
} from "./fixtures";
import { NcrService } from "../../modules/quality/application/ncr-service";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { NumberingService } from "../../modules/accounting/application/numbering-service";
import { PostingService } from "../../modules/accounting/application/posting-service";
import { PartnerSubledgerService } from "../../modules/partners/application/subledger-service";
import {
  NcrAffectedQtyAboveOnHandError,
  NcrDispositionRequiredError,
  NcrStateError,
  QualityInputInvalidError,
  QualityInspectionNotFoundError,
} from "../../modules/quality/domain/quality-errors";

/**
 * PHASE-050 (W-25 — T-06, 2026-11-23) `quality-ncr.db.spec` — THE NCR
 * ENGINE over real PG16 (the plan §4's own arm; acceptance #2's NCR
 * arms): BR-102's closure gate (the typed refusal NAMING the record),
 * G-62's exactly-once (the single-use source key + the single-use
 * disposition stamp), the unmapped-purpose fail-closed with the ZERO
 * RESIDUE and the flip-and-restore re-run, the affected-quantity floor
 * at create AND at the act (the live stock read naming BOTH figures),
 * the source-shape law + the INSPECTION binding (the mapping contract's
 * second consumer), and the honest no-GL shapes (REWORK/ACCEPT/
 * RETURN_TO_SUPPLIER + the batch-less SCRAP).
 */

const audit = new AuditService(new DrizzleAuditStore());
const posting = new PostingService(audit, new PartnerSubledgerService());
const numbering = new NumberingService(audit);
const ncr = new NcrService(audit, posting, numbering);

beforeAll(async () => {
  await setupQualityFixture();
  await ensureQualityPostingWorld();
});

/** The journal lines of a source key (the golden read's own shape). */
async function journalLines(docType: string, docId: string, operation: string) {
  const rows = await requireTenantContext().tx!.execute<{
    direction: string;
    code: string;
    amount: string;
  }>(sql`
    SELECT jl.direction, a.code, jl.base_amount::text AS amount
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.journal_entry_id
    JOIN accounts a ON a.id = jl.account_id
    WHERE je.source_type = ${docType} AND je.source_id = ${docId}
      AND je.operation = ${operation}
    ORDER BY jl.line_no
  `);
  return rows.rows;
}

/** Count a source key's entries (the INV-013 idempotency proof). */
async function entryCount(docType: string, docId: string): Promise<number> {
  const rows = await requireTenantContext().tx!.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM journal_entries
    WHERE source_type = ${docType} AND source_id = ${docId}
  `);
  return rows.rows[0]!.n;
}

/** The NCR's own write-off moves. */
async function ncrMoves(ncrId: string) {
  const rows = await requireTenantContext().tx!.execute<{
    id: string;
    direction: string;
    move_kind: string;
    qty: string;
    value_amount: string;
    posted_journal_id: string;
    warehouse_id: string;
    reason: string;
    batch_id: string | null;
  }>(sql`
    SELECT id, direction, move_kind, qty::text AS qty, value_amount::text AS value_amount,
           posted_journal_id, warehouse_id, reason, batch_id
    FROM stock_moves WHERE source_type = 'ncr_record' AND source_id = ${ncrId}
  `);
  return rows.rows;
}

/** The batch's total on-hand (the ledger's own fold). */
async function batchOnHand(batchId: string): Promise<string> {
  const rows = await requireTenantContext().tx!.execute<{ q: string }>(sql`
    SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN qty ELSE -qty END), 0)::text AS q
    FROM stock_moves WHERE batch_id = ${batchId}`);
  return rows.rows[0]!.q;
}

/** The flip-and-restore idiom (the cmms goldens' own): supersede an
 * active purpose mapping through the tenant's runtime surface. */
async function supersedePurposeKey(purposeKey: string): Promise<void> {
  const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
  const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
  const active = await tenancy.findActivePurpose(purposeKey);
  expect(active).toBeDefined();
  await accounting.supersedePurpose(active!.id, active!.activeFrom);
}

async function restorePurposeKey(purposeKey: string, code: string): Promise<void> {
  const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
  const active = await tenancy.findActivePurpose(purposeKey);
  if (active === undefined) {
    const account = await tenancy.findAccountByCode(code);
    expect(account).toBeDefined();
    await tenancy.insertAccountPurpose({
      purposeKey,
      accountId: account!.id,
      activeFrom: new Date().toISOString().slice(0, 10),
    });
  }
}

describe("PHASE-050 W-25 — T-06: the NCR register (create — the shapes, the binding, the floor)", () => {
  it("creates a PRODUCTION-sourced NCR with the official number and the source-shape law at the service floor", async () => {
    const world = await freshQualityScrapWorld("NCR-CREATE");
    const created = await withTenant(TENANT_QUALITY, () =>
      ncr.create({
        source: "PRODUCTION",
        itemId: world.itemId,
        batchId: world.batchId,
        problem: "Viscosity out of band on the morning run",
        affectedQty: "5",
        actorId: QL_ACTOR,
      }),
    );
    expect(created.ncrNo).toMatch(/^NCR-20\d{2}-\d{6}$/);
    expect(created.status).toBe("OPEN");
    expect(created.disposition).toBeNull();
    expect(created.journalEntryId).toBeNull();
    expect(created.affectedQty).toBe("5.000000");
    expect(created.batchId).toBe(world.batchId);
  });

  it("the INSPECTION source binds to the inspections module's OWN row — a foreign id is the typed not-found", async () => {
    const itemId = await freshQualityItem("NCR-INS-BIND");
    const refused = await withTenant(TENANT_QUALITY, () =>
      ncr
        .create({
          source: "INSPECTION",
          itemId,
          problem: "Found at receiving inspection",
          affectedQty: "2",
          inspectionId: "99999999-9999-4999-8999-999999999999",
          actorId: QL_ACTOR,
        })
        .catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(QualityInspectionNotFoundError);
    expect((refused as QualityInspectionNotFoundError).code).toBe("QUALITY_INSPECTION_NOT_FOUND");
  });

  it("the source-shape law: an INSPECTION source without its inspection is the typed refusal, never a raw 23514", async () => {
    const itemId = await freshQualityItem("NCR-SHAPE");
    const refused = await withTenant(TENANT_QUALITY, () =>
      ncr
        .create({
          source: "INSPECTION",
          itemId,
          problem: "Missing the inspection row",
          affectedQty: "2",
          actorId: QL_ACTOR,
        })
        .catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(QualityInputInvalidError);
    expect((refused as QualityInputInvalidError).code).toBe("QUALITY_INPUT_INVALID");
    const refusedPartner = await withTenant(TENANT_QUALITY, () =>
      ncr
        .create({
          source: "SUPPLIER",
          itemId,
          problem: "Missing the supplier",
          affectedQty: "2",
          actorId: QL_ACTOR,
        })
        .catch((error: unknown) => error),
    );
    expect(refusedPartner).toBeInstanceOf(QualityInputInvalidError);
  });

  it("G-62's floor at create: the affected quantity above the batch's own on-hand is refused with BOTH figures", async () => {
    const world = await freshQualityScrapWorld("NCR-FLRC");
    const refused = await withTenant(TENANT_QUALITY, () =>
      ncr
        .create({
          source: "PRODUCTION",
          itemId: world.itemId,
          batchId: world.batchId,
          problem: "Over-affected",
          affectedQty: "200",
          actorId: QL_ACTOR,
        })
        .catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(NcrAffectedQtyAboveOnHandError);
    expect((refused as NcrAffectedQtyAboveOnHandError).code).toBe(
      "NCR_AFFECTED_QTY_ABOVE_ON_HAND",
    );
    expect((refused as NcrAffectedQtyAboveOnHandError).details).toMatchObject({
      batchId: world.batchId,
      affectedQty: "200",
      onHand: "100.000000",
    });
  });
});

describe("PHASE-050 W-25 — T-06: G-62 — the SCRAP write-off through the REAL engine (D-05)", () => {
  it("THE GOLDEN-CLASS ARM: DR INVENTORY_SHRINKAGE · CR INVENTORY at the affected quantity's own value — the journal, the moves, the floor, the stamps", async () => {
    const world = await freshQualityScrapWorld("NCR-G62");
    const created = await withTenant(TENANT_QUALITY, () =>
      ncr.create({
        source: "PRODUCTION",
        itemId: world.itemId,
        batchId: world.batchId,
        problem: "Contaminated batch found on the line",
        affectedQty: "5",
        actorId: QL_ACTOR,
      }),
    );
    const result = await withTenant(TENANT_QUALITY, () =>
      ncr.disposition(created.id, { disposition: "SCRAP", actorId: QL_ACTOR }),
    );
    // The record: DISPOSITIONED with the disposition pair + the journal link.
    expect(result.ncr.status).toBe("DISPOSITIONED");
    expect(result.ncr.disposition).toBe("SCRAP");
    expect(result.ncr.dispositionAt).not.toBeNull();
    expect(result.journalEntryId).not.toBeNull();
    expect(result.ncr.journalEntryId).toBe(result.journalEntryId);
    // The write-off's own figures: 5 × 2.500000 = 12.5000 (the G-13
    // golden's own figures — the position's own valuation, never a client
    // figure).
    expect(result.writeOff).not.toBeNull();
    expect(result.writeOff!.totalValue).toBe("12.5000");
    expect(result.writeOff!.perWarehouse).toHaveLength(1);
    expect(result.writeOff!.perWarehouse[0]!.qty).toBe("5.000000");
    // THE JOURNAL LINES: DR 5110 12.5000 · CR 1140 12.5000.
    const lines = await withTenant(TENANT_QUALITY, () =>
      journalLines("ncr_record", created.id, "disposition"),
    );
    expect(lines).toEqual([
      { direction: "DEBIT", code: "5110", amount: "12.5000" },
      { direction: "CREDIT", code: "1140", amount: "12.5000" },
    ]);
    // THE WMS WITNESS: the write-off move — OUT, adjust kind, sourced
    // ncr_record, the batch pinned, the journal linked, the reason
    // QUALITY_SCRAP.
    const moves = await withTenant(TENANT_QUALITY, () => ncrMoves(created.id));
    expect(moves).toHaveLength(1);
    expect(moves[0]!.direction).toBe("OUT");
    expect(moves[0]!.move_kind).toBe("adjust");
    expect(moves[0]!.qty).toBe("5.000000");
    expect(moves[0]!.value_amount).toBe("12.5000");
    expect(moves[0]!.reason).toBe("QUALITY_SCRAP");
    expect(moves[0]!.batch_id).toBe(world.batchId);
    expect(moves[0]!.posted_journal_id).toBe(result.journalEntryId);
    expect(moves[0]!.warehouse_id).toBe(world.warehouseId);
    // The batch's own ledger: 100 − 5 = 95.
    const onHand = await withTenant(TENANT_QUALITY, () => batchOnHand(world.batchId));
    expect(onHand).toBe("95.000000");
  });

  it("INV-013's exactly-once: the second disposition is the typed ALREADY_DISPOSITIONED — one journal, one move, zero new rows", async () => {
    const world = await freshQualityScrapWorld("NCR-ONCE");
    const created = await withTenant(TENANT_QUALITY, () =>
      ncr.create({
        source: "PRODUCTION",
        itemId: world.itemId,
        batchId: world.batchId,
        problem: "The exactly-once world",
        affectedQty: "3",
        actorId: QL_ACTOR,
      }),
    );
    await withTenant(TENANT_QUALITY, () =>
      ncr.disposition(created.id, { disposition: "SCRAP", actorId: QL_ACTOR }),
    );
    const refused = await withTenant(TENANT_QUALITY, () =>
      ncr
        .disposition(created.id, { disposition: "SCRAP", actorId: QL_ACTOR })
        .catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(NcrStateError);
    expect((refused as NcrStateError).code).toBe("NCR_STATE_ERROR");
    expect((refused as NcrStateError).details).toMatchObject({ from: "DISPOSITIONED" });
    // The single-use proof: exactly one journal for the source key and
    // exactly one move — the replay wrote NOTHING.
    const entries = await withTenant(TENANT_QUALITY, () =>
      entryCount("ncr_record", created.id),
    );
    expect(entries).toBe(1);
    const moves = await withTenant(TENANT_QUALITY, () => ncrMoves(created.id));
    expect(moves).toHaveLength(1);
    expect(moves[0]!.qty).toBe("3.000000");
  });

  it("THE UNMAPPED-PURPOSE FAIL-CLOSED: INVENTORY_SHRINKAGE superseded → PURPOSE_NOT_MAPPED with ZERO RESIDUE; restored → the re-run GREEN", async () => {
    const world = await freshQualityScrapWorld("NCR-UNMAPPED");
    const created = await withTenant(TENANT_QUALITY, () =>
      ncr.create({
        source: "PRODUCTION",
        itemId: world.itemId,
        batchId: world.batchId,
        problem: "The unmapped-purpose world",
        affectedQty: "4",
        actorId: QL_ACTOR,
      }),
    );
    await withTenant(TENANT_QUALITY, async () => {
      await supersedePurposeKey("INVENTORY_SHRINKAGE");
      const refused = await ncr
        .disposition(created.id, { disposition: "SCRAP", actorId: QL_ACTOR })
        .catch((error: unknown) => error);
      // The engine's own refusal (fail-closed — no fallback account).
      expect((refused as { code?: string }).code).toBe("PURPOSE_NOT_MAPPED");
      // THE ZERO RESIDUE: the record stays OPEN, zero journals, zero moves.
      const stillOpen = await ncr.find(created.id);
      expect(stillOpen.status).toBe("OPEN");
      expect(await entryCount("ncr_record", created.id)).toBe(0);
      expect((await ncrMoves(created.id)).length).toBe(0);
      // THE RESTORE: the tenant's own runtime repair path — the re-run
      // GREEN (the flip-and-restore idiom).
      await restorePurposeKey("INVENTORY_SHRINKAGE", "5110");
      const result = await ncr.disposition(created.id, {
        disposition: "SCRAP",
        actorId: QL_ACTOR,
      });
      expect(result.ncr.status).toBe("DISPOSITIONED");
      expect(result.journalEntryId).not.toBeNull();
      expect(await entryCount("ncr_record", created.id)).toBe(1);
      expect((await ncrMoves(created.id)).length).toBe(1);
    });
  });

  it("the floor re-read at the ACT: stock moved after the create — the write-off refuses with BOTH figures and zero residue", async () => {
    const world = await freshQualityScrapWorld("NCR-FLOOR-ACT");
    const created = await withTenant(TENANT_QUALITY, () =>
      ncr.create({
        source: "PRODUCTION",
        itemId: world.itemId,
        batchId: world.batchId,
        problem: "The floor-at-the-act world",
        affectedQty: "90",
        actorId: QL_ACTOR,
      }),
    );
    // The stock moves under the record: 60 out through the inventory's
    // own manual issue (the engine's path — the on-hand read is LIVE).
    await withTenant(TENANT_QUALITY, () =>
      stock.manualIssue({
        itemId: world.itemId,
        warehouseId: world.warehouseId,
        qty: "60",
        reason: "COUNT_LOSS",
        counterAccountId: null,
        valueDate: "2026-02-15",
        batchId: world.batchId,
        actorId: QL_ACTOR,
      }),
    );
    const refused = await withTenant(TENANT_QUALITY, () =>
      ncr
        .disposition(created.id, { disposition: "SCRAP", actorId: QL_ACTOR })
        .catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(NcrAffectedQtyAboveOnHandError);
    expect((refused as NcrAffectedQtyAboveOnHandError).details).toMatchObject({
      affectedQty: "90.000000",
      onHand: "40.000000",
    });
    // Zero residue: the record stays OPEN, nothing posted, nothing moved.
    const stillOpen = await withTenant(TENANT_QUALITY, () => ncr.find(created.id));
    expect(stillOpen.status).toBe("OPEN");
    const entries = await withTenant(TENANT_QUALITY, () => entryCount("ncr_record", created.id));
    expect(entries).toBe(0);
    const moves = await withTenant(TENANT_QUALITY, () => ncrMoves(created.id));
    expect(moves).toHaveLength(0);
  });

  it("the two-warehouse coverage: the per-account credit split at each warehouse's own value (the 1141 override)", async () => {
    const world = await freshQualityScrapWorld("NCR-SPLIT");
    const postingWorld = await ensureQualityPostingWorld();
    // The second position: 50 × 2.500000 at the OVERRIDE warehouse (its
    // own 1141 account — resolveInventoryAccount's explicit override
    // path).
    await withTenant(TENANT_QUALITY, () =>
      stock.manualReceipt({
        itemId: world.itemId,
        warehouseId: postingWorld.warehouseBId,
        qty: "50",
        unitCost: "2.500000",
        reason: "COUNT_GAIN",
        counterAccountId: null,
        valueDate: "2026-02-05",
        batchId: world.batchId,
        actorId: QL_ACTOR,
      }),
    );
    const created = await withTenant(TENANT_QUALITY, () =>
      ncr.create({
        source: "PRODUCTION",
        itemId: world.itemId,
        batchId: world.batchId,
        problem: "The two-warehouse coverage world",
        affectedQty: "120",
        actorId: QL_ACTOR,
      }),
    );
    const result = await withTenant(TENANT_QUALITY, () =>
      ncr.disposition(created.id, { disposition: "SCRAP", actorId: QL_ACTOR }),
    );
    // Σ = 120 × 2.500000 = 300.0000 across the two warehouses.
    expect(result.writeOff!.totalValue).toBe("300.0000");
    expect(result.writeOff!.perWarehouse).toHaveLength(2);
    const qtySum = result
      .writeOff!.perWarehouse.reduce((sum, leg) => sum + Number(leg.qty), 0);
    expect(qtySum).toBe(120);
    // THE PER-ACCOUNT SPLIT: two credit lines on the two accounts, each
    // at ITS warehouse's own value — and the DR equals their sum.
    const lines = await withTenant(TENANT_QUALITY, () =>
      journalLines("ncr_record", created.id, "disposition"),
    );
    const debits = lines.filter((line) => line.direction === "DEBIT");
    const credits = lines.filter((line) => line.direction === "CREDIT");
    expect(debits).toEqual([{ direction: "DEBIT", code: "5110", amount: "300.0000" }]);
    expect(credits).toHaveLength(2);
    const creditCodes = credits.map((line) => line.code).sort();
    expect(creditCodes).toEqual(["1140", "1141"]);
    const creditSum = credits.reduce((sum, line) => sum + Number(line.amount), 0);
    expect(creditSum).toBe(300);
    // Each credit line equals its warehouse's moves value (the
    // per-warehouse attribution, order-free).
    const moves = await withTenant(TENANT_QUALITY, () => ncrMoves(created.id));
    expect(moves).toHaveLength(2);
    const byWarehouse = new Map(moves.map((move) => [move.warehouse_id, move]));
    for (const leg of result.writeOff!.perWarehouse) {
      const move = byWarehouse.get(leg.warehouseId)!;
      expect(move.qty).toBe(leg.qty);
      expect(move.value_amount).toBe(leg.valueAmount);
    }
    // Both moves carry the journal id.
    for (const move of moves) {
      expect(move.posted_journal_id).toBe(result.journalEntryId);
    }
  });
});

describe("PHASE-050 W-25 — T-06: BR-102 (the closure gate) + the honest no-GL shapes", () => {
  it("BR-102: the close on OPEN is the typed refusal NAMING the record", async () => {
    const world = await freshQualityScrapWorld("NCR-BR102");
    const created = await withTenant(TENANT_QUALITY, () =>
      ncr.create({
        source: "PRODUCTION",
        itemId: world.itemId,
        batchId: world.batchId,
        problem: "The BR-102 world",
        affectedQty: "2",
        actorId: QL_ACTOR,
      }),
    );
    const refused = await withTenant(TENANT_QUALITY, () =>
      ncr.close(created.id, QL_ACTOR).catch((error: unknown) => error),
    );
    expect(refused).toBeInstanceOf(NcrDispositionRequiredError);
    expect((refused as NcrDispositionRequiredError).code).toBe("NCR_DISPOSITION_REQUIRED");
    expect((refused as NcrDispositionRequiredError).details).toMatchObject({
      ncrId: created.id,
      ncrNo: created.ncrNo,
      status: "OPEN",
    });
  });

  it("the legal ladder: REWORK carries NO GL entry → the close stamps CLOSED; the closed register refuses every move", async () => {
    const world = await freshQualityScrapWorld("NCR-LADDER");
    const created = await withTenant(TENANT_QUALITY, () =>
      ncr.create({
        source: "PRODUCTION",
        itemId: world.itemId,
        batchId: world.batchId,
        problem: "The ladder world",
        affectedQty: "2",
        actorId: QL_ACTOR,
      }),
    );
    const dispositioned = await withTenant(TENANT_QUALITY, () =>
      ncr.disposition(created.id, { disposition: "REWORK", actorId: QL_ACTOR }),
    );
    // D-05's honest shape: REWORK carries NO GL entry.
    expect(dispositioned.journalEntryId).toBeNull();
    expect(dispositioned.ncr.journalEntryId).toBeNull();
    expect(dispositioned.writeOff).toBeNull();
    expect(await withTenant(TENANT_QUALITY, () => entryCount("ncr_record", created.id))).toBe(0);
    expect((await withTenant(TENANT_QUALITY, () => ncrMoves(created.id))).length).toBe(0);
    // The close: DISPOSITIONED → CLOSED with the closed_at stamp.
    const closed = await withTenant(TENANT_QUALITY, () => ncr.close(created.id, QL_ACTOR));
    expect(closed.status).toBe("CLOSED");
    expect(closed.closedAt).not.toBeNull();
    expect(closed.disposition).toBe("REWORK");
    // The CLOSED register is evidence: every move refused BY NAME.
    const refusedClose = await withTenant(TENANT_QUALITY, () =>
      ncr.close(created.id, QL_ACTOR).catch((error: unknown) => error),
    );
    expect(refusedClose).toBeInstanceOf(NcrStateError);
    expect((refusedClose as NcrStateError).details).toMatchObject({ from: "CLOSED" });
    const refusedDisposition = await withTenant(TENANT_QUALITY, () =>
      ncr
        .disposition(created.id, { disposition: "SCRAP", actorId: QL_ACTOR })
        .catch((error: unknown) => error),
    );
    expect(refusedDisposition).toBeInstanceOf(NcrStateError);
    expect((refusedDisposition as NcrStateError).details).toMatchObject({ from: "CLOSED" });
  });

  it("the batch-less SCRAP: the declared honest shape — the disposition stamps with NO journal (the 0114 gate's NULL allowance)", async () => {
    const itemId = await freshQualityItem("NCR-SCRAP-NOBATCH");
    // PRODUCTION carries the batch WHEN KNOWN — this record names none
    // (the goods were never booked under a batch of this record), so the
    // SCRAP stamps with NO journal and NO stock move: the 0114 gate's own
    // NULL allowance, the wave's declared interpretation.
    const created = await withTenant(TENANT_QUALITY, () =>
      ncr.create({
        source: "PRODUCTION",
        itemId,
        problem: "Rejected before booking under a batch",
        affectedQty: "10",
        actorId: QL_ACTOR,
      }),
    );
    const result = await withTenant(TENANT_QUALITY, () =>
      ncr.disposition(created.id, { disposition: "SCRAP", actorId: QL_ACTOR }),
    );
    expect(result.ncr.status).toBe("DISPOSITIONED");
    expect(result.journalEntryId).toBeNull();
    expect(result.ncr.journalEntryId).toBeNull();
    expect(result.writeOff).toBeNull();
    expect(await withTenant(TENANT_QUALITY, () => entryCount("ncr_record", created.id))).toBe(0);
    expect((await withTenant(TENANT_QUALITY, () => ncrMoves(created.id))).length).toBe(0);
  });

  it("ACCEPT and RETURN_TO_SUPPLIER carry NO GL entry (D-05's recorded honest shape)", async () => {
    const world = await freshQualityScrapWorld("NCR-NOTA");
    const created = await withTenant(TENANT_QUALITY, () =>
      ncr.create({
        source: "PRODUCTION",
        itemId: world.itemId,
        batchId: world.batchId,
        problem: "The no-GL dispositions world",
        affectedQty: "1",
        actorId: QL_ACTOR,
      }),
    );
    for (const disposition of ["ACCEPT", "RETURN_TO_SUPPLIER"] as const) {
      // Each disposition needs a fresh OPEN record — the stamp is
      // single-use.
      const fresh = await withTenant(TENANT_QUALITY, () =>
        ncr.create({
          source: "PRODUCTION",
          itemId: world.itemId,
          batchId: world.batchId,
          problem: `The ${disposition} arm`,
          affectedQty: "1",
          actorId: QL_ACTOR,
        }),
      );
      const result = await withTenant(TENANT_QUALITY, () =>
        ncr.disposition(fresh.id, { disposition, actorId: QL_ACTOR }),
      );
      expect(result.journalEntryId).toBeNull();
      expect(result.writeOff).toBeNull();
      expect(result.ncr.disposition).toBe(disposition);
    }
    expect(created.status).toBe("OPEN");
  });
});
