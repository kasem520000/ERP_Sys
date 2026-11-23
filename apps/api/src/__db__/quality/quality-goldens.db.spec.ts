import { sql } from "drizzle-orm";
import { Decimal } from "@erp/domain-core";
import { beforeAll, describe, expect, it } from "vitest";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import { superuserClient } from "../test-db";
import { planIssue } from "../../modules/inventory/application/movement-core";
import { PostingError } from "../../modules/accounting/domain/posting-engine/posting-errors";
import { NcrService } from "../../modules/quality/application/ncr-service";
import { CapaService } from "../../modules/quality/application/capa-service";
import { NcrAffectedQtyAboveOnHandError } from "../../modules/quality/domain/quality-errors";
import {
  QL_ACTOR,
  TENANT_QUALITY,
  audit,
  deliveries,
  ensureQualityPostingWorld,
  freshQualityFefoWorld,
  freshQualityScrapWorld,
  holds,
  numbering,
  posting,
  setupQualityFixture,
  stock,
  transfers,
} from "./fixtures";

/**
 * PHASE-050 (W-31 — T-18a, 2026-11-23) · `quality-goldens.db.spec` —
 * THE GOLDEN TRANSCRIPTS with their MANDATORY FAILURE PACKS (the
 * JOURNAL_RULES §7 law, the 049 cmms-goldens precedent's shape: every
 * golden row is mirrored by a golden test whose failure pack flips the
 * world to the failing shape, proves the typed refusal WITH ITS FULL
 * PAYLOAD and the ZERO RESIDUE, restores, and the SAME act re-runs
 * green). The transcripts:
 *
 * - G-62 (D-05 — the NCR SCRAP write-off): 5 × 2.500000 = 12.5000 ·
 *   DR INVENTORY_SHRINKAGE 5110 · CR the per-warehouse INVENTORY 1140 —
 *   the journal, the stock_moves write-off row (source ncr_record,
 *   reason QUALITY_SCRAP), the INV-013 single-use key and the
 *   disposition stamps, EVERY figure asserted EXACT; the pack carries
 *   the unmapped-purpose flip (PURPOSE_NOT_MAPPED with its payload, the
 *   stock untouched, the record OPEN) and the live on-hand floor (the
 *   typed refusal naming BOTH figures);
 * - G-63 (D-06 — the CAPA external quality cost): DR QUALITY_EXPENSE
 *   5320 · CR EXTERNAL_ACCRUAL 2137 — the single-use key, the cost
 *   stamp + the journal link landed in ONE CAS, and the pack's unmapped
 *   EXTERNAL_ACCRUAL flip with the zero residue and the green re-run;
 * - THE INV-035 BLOCKING-MATRIX GOLDEN (D-07): a held batch refused on
 *   EVERY baseline path IN ONE ARM — the raw planIssue, the manual
 *   issue, the sales delivery post and the transfer dispatch (the FEFO
 *   auto-pick included) — each refusal's full payload pinned
 *   (batchId/holdId/reason/heldAt), ZERO residue per path, then the
 *   linked-hold release (BR-101) and the GREEN re-run of the very
 *   manual issue that was refused (the flip-and-restore);
 * - THE OFFLINE-REJECTION SHAPE (D-20/OA-02): the gate is SERVER-SIDE
 *   in planIssue, so an offline document carrying a held batch is
 *   rejected at sync reconciliation when its POST runs this same plan —
 *   the arm proves the SHAPE EQUALITY (the offline leg's POST sees the
 *   SAME typed BATCH_QUALITY_HELD refusal the online path sees).
 *
 * Every arm builds its OWN fresh world (the owner's per-arm-world law)
 * and every failure pack restores the world it flipped.
 */

const ncr = new NcrService(audit, posting, numbering);
const capa = new CapaService(audit, posting, numbering);

function expectDec(actual: string | null | undefined, expected: string): void {
  expect(actual === null || actual === undefined ? null : new Decimal(actual).toString()).toBe(
    new Decimal(expected).toString(),
  );
}

/** The journal lines a source-keyed entry posted (direction + account
 * code + amount, ordered by line_no). */
async function journalLines(
  docType: string,
  docId: string,
  operation: string,
): Promise<ReadonlyArray<{ direction: string; code: string; amount: string }>> {
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
async function ncrMoves(ncrId: string): Promise<
  ReadonlyArray<{
    direction: string;
    move_kind: string;
    qty: string;
    value_amount: string;
    posted_journal_id: string;
    warehouse_id: string;
    reason: string;
    batch_id: string | null;
  }>
> {
  const rows = await requireTenantContext().tx!.execute<{
    direction: string;
    move_kind: string;
    qty: string;
    value_amount: string;
    posted_journal_id: string;
    warehouse_id: string;
    reason: string;
    batch_id: string | null;
  }>(sql`
    SELECT direction, move_kind, qty::text AS qty, value_amount::text AS value_amount,
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

/** The flip-and-restore idiom's FLIP: supersede an active purpose
 * mapping (the tenant's own runtime surface — never a raw table poke),
 * so the next engine act fails closed. */
async function supersedePurposeKey(purposeKey: string): Promise<void> {
  const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
  const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
  const active = await tenancy.findActivePurpose(purposeKey);
  expect(active).toBeDefined();
  await accounting.supersedePurpose(active!.id, active!.activeFrom);
}

/** The flip-and-restore idiom's RESTORE: re-map the purpose key to the
 * seeded CoA's own account (the tenant's own runtime repair path). */
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

// ── the fixture world's own lookups (the QL tenant's standing rows) ─────────

async function branchQl(): Promise<string> {
  const su = await superuserClient();
  const rows = await su.query<{ id: string }>(
    `SELECT id FROM branches WHERE tenant_id = $1 AND code = 'BR-QL' LIMIT 1`,
    [TENANT_QUALITY],
  );
  await su.end();
  return rows.rows[0]!.id;
}

async function customerQl(): Promise<string> {
  const su = await superuserClient();
  const rows = await su.query<{ id: string }>(
    `SELECT id FROM partners WHERE tenant_id = $1 AND code = 'QL-CUST' LIMIT 1`,
    [TENANT_QUALITY],
  );
  await su.end();
  return rows.rows[0]!.id;
}

async function warehouseQl(): Promise<string> {
  const su = await superuserClient();
  const rows = await su.query<{ id: string }>(
    `SELECT id FROM warehouses WHERE tenant_id = $1 AND code = 'QL-WH' LIMIT 1`,
    [TENANT_QUALITY],
  );
  await su.end();
  return rows.rows[0]!.id;
}

beforeAll(async () => {
  await setupQualityFixture();
  await ensureQualityPostingWorld();
});

describe("PHASE-050 W-31 — T-18a: G-62 (the NCR SCRAP write-off — the golden transcript with its mandatory failure pack)", () => {
  it("G-62 THE GOLDEN TRANSCRIPT — the pinned world's write-off line by line: the journal EXACT, the WMS witness, the INV-013 key, the disposition stamps", async () => {
    const world = await freshQualityScrapWorld("GLD-G62");
    const created = await withTenant(TENANT_QUALITY, () =>
      ncr.create({
        source: "PRODUCTION",
        itemId: world.itemId,
        batchId: world.batchId,
        problem: "The G-62 golden transcript world",
        affectedQty: "5",
        actorId: QL_ACTOR,
      }),
    );

    // No posting occurs before the disposition (the lines stand, the
    // journal does not).
    expect(await withTenant(TENANT_QUALITY, () => entryCount("ncr_record", created.id))).toBe(0);
    expect(await withTenant(TENANT_QUALITY, () => batchOnHand(world.batchId))).toBe(
      "100.000000",
    );

    const result = await withTenant(TENANT_QUALITY, () =>
      ncr.disposition(created.id, { disposition: "SCRAP", actorId: QL_ACTOR }),
    );

    // THE TRANSCRIPT — the journal lines EXACT (5 × 2.500000 = 12.5000;
    // DR INVENTORY_SHRINKAGE 5110 · CR the per-warehouse INVENTORY 1140),
    // balanced to the cent.
    const lines = await withTenant(TENANT_QUALITY, () =>
      journalLines("ncr_record", created.id, "disposition"),
    );
    expect(lines).toEqual([
      { direction: "DEBIT", code: "5110", amount: "12.5000" },
      { direction: "CREDIT", code: "1140", amount: "12.5000" },
    ]);
    const debits = lines.filter((line) => line.direction === "DEBIT");
    const credits = lines.filter((line) => line.direction === "CREDIT");
    expect(debits).toHaveLength(1);
    expect(credits).toHaveLength(1);
    expect(
      new Decimal(debits[0]!.amount).equals(new Decimal(credits[0]!.amount)),
    ).toBe(true);

    // THE WMS WITNESS — the write-off row on the append-only ledger:
    // sourced ncr_record, reason QUALITY_SCRAP, the batch pinned, the
    // journal linked.
    const moves = await withTenant(TENANT_QUALITY, () => ncrMoves(created.id));
    expect(moves).toHaveLength(1);
    expect(moves[0]!.direction).toBe("OUT");
    expect(moves[0]!.move_kind).toBe("adjust");
    expect(moves[0]!.reason).toBe("QUALITY_SCRAP");
    expect(moves[0]!.batch_id).toBe(world.batchId);
    expect(moves[0]!.warehouse_id).toBe(world.warehouseId);
    expectDec(moves[0]!.qty, "5");
    expectDec(moves[0]!.value_amount, "12.5");
    expect(moves[0]!.posted_journal_id).toBe(result.journalEntryId);

    // THE INV-013 SINGLE-USE KEY — exactly one entry for the source key.
    expect(await withTenant(TENANT_QUALITY, () => entryCount("ncr_record", created.id))).toBe(1);

    // THE DISPOSITION STAMPS + the engine's own figures (the write-off's
    // totals, never a client figure).
    expect(result.ncr.status).toBe("DISPOSITIONED");
    expect(result.ncr.disposition).toBe("SCRAP");
    expect(result.ncr.dispositionAt).not.toBeNull();
    expect(result.ncr.journalEntryId).toBe(result.journalEntryId);
    expect(result.journalEntryId).not.toBeNull();
    expect(result.writeOff).not.toBeNull();
    expect(result.writeOff!.totalValue).toBe("12.5000");
    expect(result.writeOff!.perWarehouse).toHaveLength(1);
    expect(result.writeOff!.perWarehouse[0]!.warehouseId).toBe(world.warehouseId);
    expectDec(result.writeOff!.perWarehouse[0]!.qty, "5");
    expectDec(result.writeOff!.perWarehouse[0]!.valueAmount, "12.5");

    // The batch's own ledger: 100 − 5 = 95.
    expect(await withTenant(TENANT_QUALITY, () => batchOnHand(world.batchId))).toBe(
      "95.000000",
    );
  });

  it("G-62's FAILURE PACK — the unmapped INVENTORY_SHRINKAGE refusal WITH ITS FULL PAYLOAD, the ZERO residue, the flip-and-restore green re-run (the same balanced transcript)", async () => {
    const world = await freshQualityScrapWorld("GLD-G62-FP");
    const created = await withTenant(TENANT_QUALITY, () =>
      ncr.create({
        source: "PRODUCTION",
        itemId: world.itemId,
        batchId: world.batchId,
        problem: "The G-62 failure-pack world",
        affectedQty: "5",
        actorId: QL_ACTOR,
      }),
    );

    await withTenant(TENANT_QUALITY, async () => {
      await supersedePurposeKey("INVENTORY_SHRINKAGE");
      try {
        const refused = await ncr
          .disposition(created.id, { disposition: "SCRAP", actorId: QL_ACTOR })
          .catch((error: unknown) => error);
        // (a) THE TYPED REFUSAL WITH ITS FULL PAYLOAD (the engine's own
        // fail-closed law — no fallback account, CHART_OF_ACCOUNTS §2).
        expect(refused).toBeInstanceOf(PostingError);
        expect((refused as PostingError).code).toBe("PURPOSE_NOT_MAPPED");
        expect((refused as PostingError).details).toEqual({
          purposeKey: "INVENTORY_SHRINKAGE",
        });

        // (b) THE ZERO RESIDUE — the record keeps its OPEN state, the
        // stock is UNCHANGED, zero journal rows, zero moves
        // (together-or-nothing).
        const stillOpen = await ncr.find(created.id);
        expect(stillOpen.status).toBe("OPEN");
        expect(stillOpen.disposition).toBeNull();
        expect(stillOpen.journalEntryId).toBeNull();
        expect(await entryCount("ncr_record", created.id)).toBe(0);
        expect((await ncrMoves(created.id)).length).toBe(0);
        expect(await batchOnHand(world.batchId)).toBe("100.000000");
      } finally {
        // THE RESTORE — the tenant's own runtime repair path.
        await restorePurposeKey("INVENTORY_SHRINKAGE", "5110");
      }

      // (c) THE GREEN RE-RUN — the SAME disposition re-runs cleanly and
      // lands the SAME balanced transcript the golden pins.
      const result = await ncr.disposition(created.id, {
        disposition: "SCRAP",
        actorId: QL_ACTOR,
      });
      expect(result.ncr.status).toBe("DISPOSITIONED");
      expect(result.journalEntryId).not.toBeNull();
      expect(await entryCount("ncr_record", created.id)).toBe(1);
      const lines = await journalLines("ncr_record", created.id, "disposition");
      expect(lines).toEqual([
        { direction: "DEBIT", code: "5110", amount: "12.5000" },
        { direction: "CREDIT", code: "1140", amount: "12.5000" },
      ]);
      const moves = await ncrMoves(created.id);
      expect(moves).toHaveLength(1);
      expect(moves[0]!.reason).toBe("QUALITY_SCRAP");
      expectDec(moves[0]!.qty, "5");
      expectDec(moves[0]!.value_amount, "12.5");
      expect(await batchOnHand(world.batchId)).toBe("95.000000");
    });
  });

  it("G-62's ON-HAND FLOOR FAILURE — the affected quantity above the batch's on-hand at the ACT: the typed refusal naming BOTH figures + zero residue", async () => {
    const world = await freshQualityScrapWorld("GLD-G62-FLOOR");
    // The record is legal at create (the floor reads the LIVE ledger),
    // the stock moves under it, and the act re-reads the floor.
    const created = await withTenant(TENANT_QUALITY, () =>
      ncr.create({
        source: "PRODUCTION",
        itemId: world.itemId,
        batchId: world.batchId,
        problem: "The on-hand floor failure world",
        affectedQty: "90",
        actorId: QL_ACTOR,
      }),
    );
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
    // THE TYPED REFUSAL naming BOTH figures (affectedQty + the live
    // on-hand) — never a silent backorder.
    expect(refused).toBeInstanceOf(NcrAffectedQtyAboveOnHandError);
    expect((refused as NcrAffectedQtyAboveOnHandError).code).toBe("NCR_AFFECTED_QTY_ABOVE_ON_HAND");
    expect((refused as NcrAffectedQtyAboveOnHandError).details).toMatchObject({
      batchId: world.batchId,
      affectedQty: "90.000000",
      onHand: "40.000000",
    });
    // THE ZERO RESIDUE — the record stays OPEN, nothing posted, nothing
    // moved (the batch keeps exactly its post-issue 40).
    const stillOpen = await withTenant(TENANT_QUALITY, () => ncr.find(created.id));
    expect(stillOpen.status).toBe("OPEN");
    expect(await withTenant(TENANT_QUALITY, () => entryCount("ncr_record", created.id))).toBe(0);
    expect((await withTenant(TENANT_QUALITY, () => ncrMoves(created.id))).length).toBe(0);
    expect(await withTenant(TENANT_QUALITY, () => batchOnHand(world.batchId))).toBe(
      "40.000000",
    );
  });
});

describe("PHASE-050 W-31 — T-18a: G-63 (the CAPA external quality cost — the golden transcript with its mandatory failure pack)", () => {
  /** A started CAPA (create + root cause — the IN_PROGRESS record the
   * cost act demands). */
  async function startedCapa(code: string): Promise<{ id: string; capaNo: string }> {
    const created = await withTenant(TENANT_QUALITY, () =>
      capa.create({ title: `The ${code} golden CAPA`, actorId: QL_ACTOR }),
    );
    const started = await withTenant(TENANT_QUALITY, () =>
      capa.recordRootCause(created.id, {
        rootCause: `The ${code} root cause analysis`,
        actorId: QL_ACTOR,
      }),
    );
    return { id: started.id, capaNo: started.capaNo };
  }

  it("G-63 THE GOLDEN TRANSCRIPT — DR QUALITY_EXPENSE 5320 · CR EXTERNAL_ACCRUAL 2137 exactly, the INV-013 single-use key, the cost stamp + the journal link in ONE CAS", async () => {
    const started = await startedCapa("GLD-G63");

    // No posting before the act (the record carries no cost stamp).
    expect(await withTenant(TENANT_QUALITY, () => entryCount("capa_record", started.id))).toBe(0);

    const result = await withTenant(TENANT_QUALITY, () =>
      capa.recordExternalCost(started.id, { amount: "480", actorId: QL_ACTOR }),
    );

    // THE TRANSCRIPT — the two legs EXACT (480.0000).
    const lines = await withTenant(TENANT_QUALITY, () =>
      journalLines("capa_record", started.id, "external_cost"),
    );
    expect(lines).toEqual([
      { direction: "DEBIT", code: "5320", amount: "480.0000" },
      { direction: "CREDIT", code: "2137", amount: "480.0000" },
    ]);

    // THE INV-013 SINGLE-USE KEY — exactly one entry for the source key.
    expect(await withTenant(TENANT_QUALITY, () => entryCount("capa_record", started.id))).toBe(1);

    // THE COST STAMP + THE JOURNAL LINK IN ONE CAS — the act's own
    // figures, the record's own link (never two writes the caller
    // reconciles).
    expect(result.capa.externalCost).toBe("480.0000");
    expect(result.capa.journalEntryId).toBe(result.journalEntryId);
    expect(result.journalEntryId).not.toBeNull();
    const row = await withTenant(TENANT_QUALITY, () => capa.find(started.id));
    expect(row.externalCost).toBe("480.0000");
    expect(row.journalEntryId).toBe(result.journalEntryId);
  });

  it("G-63's FAILURE PACK — the unmapped EXTERNAL_ACCRUAL refusal WITH ITS FULL PAYLOAD, the ZERO residue, the flip-and-restore green re-run (the pack's figures all in one arm)", async () => {
    const started = await startedCapa("GLD-G63-FP");

    await withTenant(TENANT_QUALITY, async () => {
      await supersedePurposeKey("EXTERNAL_ACCRUAL");
      try {
        const refused = await capa
          .recordExternalCost(started.id, { amount: "480", actorId: QL_ACTOR })
          .catch((error: unknown) => error);
        // (a) THE TYPED REFUSAL WITH ITS FULL PAYLOAD (the engine's own
        // fail-closed law — no fallback account).
        expect(refused).toBeInstanceOf(PostingError);
        expect((refused as PostingError).code).toBe("PURPOSE_NOT_MAPPED");
        expect((refused as PostingError).details).toEqual({
          purposeKey: "EXTERNAL_ACCRUAL",
        });

        // (b) THE ZERO RESIDUE — the record keeps its pre-act state (the
        // cost still 0, no journal link), zero journal rows.
        const untouched = await capa.find(started.id);
        expect(untouched.externalCost).toBe("0.0000");
        expect(untouched.journalEntryId).toBeNull();
        expect(untouched.status).toBe("IN_PROGRESS");
        expect(await entryCount("capa_record", started.id)).toBe(0);
      } finally {
        // THE RESTORE — the tenant's own runtime repair path.
        await restorePurposeKey("EXTERNAL_ACCRUAL", "2137");
      }

      // (c) THE GREEN RE-RUN — the SAME act re-runs cleanly and lands
      // the SAME transcript the golden pins (the pack's figures all in
      // one arm: 480.0000 on both legs).
      const result = await capa.recordExternalCost(started.id, {
        amount: "480",
        actorId: QL_ACTOR,
      });
      expect(result.capa.externalCost).toBe("480.0000");
      expect(result.capa.journalEntryId).not.toBeNull();
      expect(await entryCount("capa_record", started.id)).toBe(1);
      const lines = await journalLines("capa_record", started.id, "external_cost");
      expect(lines).toEqual([
        { direction: "DEBIT", code: "5320", amount: "480.0000" },
        { direction: "CREDIT", code: "2137", amount: "480.0000" },
      ]);
    });
  });
});

describe("PHASE-050 W-31 — T-18a: THE INV-035 BLOCKING-MATRIX GOLDEN + THE OFFLINE-REJECTION SHAPE", () => {
  it("THE INV-035 GOLDEN — a held batch refused on EVERY baseline path IN ONE ARM (the raw plan, the manual issue, the delivery post, the transfer dispatch), every payload pinned, ZERO residue per path, then the release + the GREEN re-run", async () => {
    // The world: the FEFO pair — the HELD batch expires first, so even
    // the transfer's auto-pick resolves it (the four canonical paths,
    // one world; the code keeps the warehouse code's 20-char floor).
    const world = await freshQualityFefoWorld("GLDMTX");
    // The release's justification FIRST (BR-101: the hold carries the
    // disposition-linked NCR from its creation — the one-active-per-
    // batch law leaves no room for a later link).
    const justifying = await withTenant(TENANT_QUALITY, () =>
      ncr.create({
        source: "PRODUCTION",
        itemId: world.itemId,
        batchId: world.heldBatchId,
        severity: "LOW",
        problem: "the matrix's justifying NCR",
        affectedQty: "1",
        actorId: QL_ACTOR,
      }),
    );
    await withTenant(TENANT_QUALITY, () =>
      ncr.disposition(justifying.id, { disposition: "ACCEPT", actorId: QL_ACTOR }),
    );
    const hold = await withTenant(TENANT_QUALITY, () =>
      holds.create({
        batchId: world.heldBatchId,
        reason: "the matrix's own hold — every baseline path refused",
        ncrId: justifying.id,
        actorId: QL_ACTOR,
      }),
    );
    expect(hold.status).toBe("ACTIVE");

    // The transcript's own zero-residue read: this arm's world carries
    // exactly the FEFO pair's two receipt moves before any act.
    const su = await superuserClient();
    const receiptsBefore = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM stock_moves
        WHERE tenant_id = $1 AND batch_id = $2`,
      [TENANT_QUALITY, world.heldBatchId],
    );
    expect(receiptsBefore.rows[0]!.n).toBe(1);
    await su.end();

    // THE FIRST PATH — the raw choke point itself (planIssue on the
    // held batch, the typed refusal WITH ITS FULL PAYLOAD).
    const rawRefusal = await withTenant(TENANT_QUALITY, () =>
      planIssue({
        itemId: world.itemId,
        warehouseId: world.warehouseId,
        qty: "5",
        movedAt: "2026-11-23",
        moveKind: "issue",
        sourceType: "manual_issue",
        sourceId: world.itemId,
        batchId: world.heldBatchId,
      }).catch((error: unknown) => error),
    );
    expect((rawRefusal as { code?: string }).code).toBe("BATCH_QUALITY_HELD");
    expect((rawRefusal as { details?: unknown }).details).toMatchObject({
      batchId: world.heldBatchId,
      holdId: hold.id,
      reason: "the matrix's own hold — every baseline path refused",
    });

    // THE SECOND PATH — the manual issue (the inventory engine's own
    // baseline).
    const manualRefusal = await withTenant(TENANT_QUALITY, () =>
      stock.manualIssue({
        itemId: world.itemId,
        warehouseId: world.warehouseId,
        qty: "5",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: "2026-11-23",
        batchId: world.heldBatchId,
        actorId: QL_ACTOR,
      }).catch((error: unknown) => error),
    );
    expect((manualRefusal as { code?: string }).code).toBe("BATCH_QUALITY_HELD");
    expect((manualRefusal as { details?: unknown }).details).toMatchObject({
      batchId: world.heldBatchId,
      holdId: hold.id,
      reason: "the matrix's own hold — every baseline path refused",
    });

    // THE THIRD PATH — the sales delivery post (the baseline ship path).
    const note = await withTenant(TENANT_QUALITY, async () =>
      deliveries.create({
        branchId: await branchQl(),
        customerId: await customerQl(),
        salesRepId: null,
        orderId: null,
        warehouseId: world.warehouseId,
        deliveryDate: "2026-11-23",
        currencyCode: "SAR",
        note: "the matrix's blocked delivery",
        noteAr: null,
        actorId: QL_ACTOR,
        lines: [
          {
            orderLineId: null,
            itemId: world.itemId,
            qty: "5",
            unitPrice: "10.000000",
            discountAmount: null,
            batchId: world.heldBatchId,
            serialIds: null,
            description: null,
            descriptionAr: null,
            note: null,
          },
        ],
      }),
    );
    const deliveryRefusal = await withTenant(TENANT_QUALITY, () =>
      deliveries.post(note.id, QL_ACTOR).catch((error: unknown) => error),
    );
    expect((deliveryRefusal as { code?: string }).code).toBe("BATCH_QUALITY_HELD");
    expect((deliveryRefusal as { details?: unknown }).details).toMatchObject({
      batchId: world.heldBatchId,
      holdId: hold.id,
      reason: "the matrix's own hold — every baseline path refused",
    });

    // THE FOURTH PATH — the transfer dispatch (the FEFO auto-pick: no
    // explicit batch, the resolver picks the HELD batch because it
    // expires first — the strict law refuses, never silently skips).
    const transfer = await withTenant(TENANT_QUALITY, async () =>
      transfers.create({
        fromWarehouseId: world.warehouseId,
        toWarehouseId: await warehouseQl(),
        note: "the matrix's blocked transfer",
        noteAr: null,
        actorId: QL_ACTOR,
        lines: [{ itemId: world.itemId, qty: "5" }],
      }),
    );
    const transferRefusal = await withTenant(TENANT_QUALITY, () =>
      transfers.dispatch(transfer.id, QL_ACTOR).catch((error: unknown) => error),
    );
    expect((transferRefusal as { code?: string }).code).toBe("BATCH_QUALITY_HELD");
    expect((transferRefusal as { details?: unknown }).details).toMatchObject({
      batchId: world.heldBatchId,
      holdId: hold.id,
      reason: "the matrix's own hold — every baseline path refused",
    });

    // THE ZERO RESIDUE PER PATH — the delivery stays DRAFT with no
    // moves of its own, the transfer stays DRAFT, the batch's ledger
    // carries exactly its one receipt move, and NO journal row landed
    // for any of the four refused acts.
    const su2 = await superuserClient();
    const deliveryState = await su2.query<{ status: string; n: number }>(
      `SELECT status, (SELECT count(*)::int FROM stock_moves sm
         WHERE sm.tenant_id = dn.tenant_id AND sm.source_id = dn.id) AS n
       FROM delivery_notes dn WHERE dn.id = $1`,
      [note.id],
    );
    expect(deliveryState.rows[0]!.status).toBe("DRAFT");
    expect(deliveryState.rows[0]!.n).toBe(0);
    const transferState = await su2.query<{ status: string; n: number }>(
      `SELECT status, (SELECT count(*)::int FROM stock_moves sm
         WHERE sm.tenant_id = st.tenant_id AND sm.source_id = st.id) AS n
       FROM stock_transfers st WHERE st.id = $1`,
      [transfer.id],
    );
    expect(transferState.rows[0]!.status).toBe("DRAFT");
    expect(transferState.rows[0]!.n).toBe(0);
    const batchMoves = await su2.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM stock_moves
        WHERE tenant_id = $1 AND batch_id = $2`,
      [TENANT_QUALITY, world.heldBatchId],
    );
    expect(batchMoves.rows[0]!.n).toBe(1);
    const refusedJournals = await su2.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM journal_entries
        WHERE tenant_id = $1 AND source_id IN ($2, $3)`,
      [TENANT_QUALITY, note.id, transfer.id],
    );
    expect(refusedJournals.rows[0]!.n).toBe(0);
    await su2.end();

    // THE RELEASE (BR-101 — the linked-hold flow): the hold carries its
    // disposition-linked NCR, so the release lands.
    const released = await withTenant(TENANT_QUALITY, () =>
      holds.release({
        holdId: hold.id,
        releaseNote: "the investigation closed — the ACCEPT disposition justifies the release",
        actorId: QL_ACTOR,
      }),
    );
    expect(released.status).toBe("RELEASED");
    expect(released.releasedAt).not.toBeNull();

    // THE GREEN RE-RUN (the flip-and-restore) — the very manual issue
    // that was refused now posts GREEN through the REAL engine.
    const issued = await withTenant(TENANT_QUALITY, () =>
      stock.manualIssue({
        itemId: world.itemId,
        warehouseId: world.warehouseId,
        qty: "5",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: "2026-11-23",
        batchId: world.heldBatchId,
        actorId: QL_ACTOR,
      }),
    );
    expect(issued).toBeTruthy();
    const su3 = await superuserClient();
    const after = await su3.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM stock_moves
        WHERE tenant_id = $1 AND batch_id = $2`,
      [TENANT_QUALITY, world.heldBatchId],
    );
    expect(after.rows[0]!.n).toBe(2);
    await su3.end();
  });

  it("THE OFFLINE-REJECTION SHAPE (D-20/OA-02) — the gate is SERVER-SIDE in planIssue: the offline document's POST runs the same plan and sees the SAME typed refusal (the shape equality)", async () => {
    // D-20/OA-02's own law (hold-gate.ts's dated comment): the check
    // lives in the server's PLAN phase, not the client — an offline
    // document carrying a held batch is rejected AT SYNC RECONCILIATION
    // when its POST runs this same planIssue. The arm's proof is the
    // SHAPE EQUALITY: the offline leg's POST (the delivery post — the
    // same server-side planIssue the online manual issue rides) sees
    // the SAME typed BATCH_QUALITY_HELD refusal, payload for payload.
    const world = await freshQualityFefoWorld("GLDOFF");
    const hold = await withTenant(TENANT_QUALITY, () =>
      holds.create({
        batchId: world.heldBatchId,
        reason: "the offline-shape hold — captured offline, refused at sync",
        actorId: QL_ACTOR,
      }),
    );

    // THE ONLINE PATH's refusal (the manual issue — the gate's own
    // baseline shape), captured first.
    const onlineRefusal = await withTenant(TENANT_QUALITY, () =>
      stock.manualIssue({
        itemId: world.itemId,
        warehouseId: world.warehouseId,
        qty: "5",
        reason: "DAMAGE",
        counterAccountId: null,
        valueDate: "2026-11-23",
        batchId: world.heldBatchId,
        actorId: QL_ACTOR,
      }).catch((error: unknown) => error),
    );

    // THE OFFLINE DOCUMENT — a delivery captured on the device while
    // disconnected (DRAFT is the offline client's own state), carrying
    // the held batch; its POST at sync reconciliation runs the SAME
    // server-side planIssue.
    const offlineNote = await withTenant(TENANT_QUALITY, async () =>
      deliveries.create({
        branchId: await branchQl(),
        customerId: await customerQl(),
        salesRepId: null,
        orderId: null,
        warehouseId: world.warehouseId,
        deliveryDate: "2026-11-23",
        currencyCode: "SAR",
        note: "the offline-captured delivery (reconciled at sync)",
        noteAr: null,
        actorId: QL_ACTOR,
        lines: [
          {
            orderLineId: null,
            itemId: world.itemId,
            qty: "5",
            unitPrice: "10.000000",
            discountAmount: null,
            batchId: world.heldBatchId,
            serialIds: null,
            description: null,
            descriptionAr: null,
            note: null,
          },
        ],
      }),
    );
    const offlineRefusal = await withTenant(TENANT_QUALITY, () =>
      deliveries.post(offlineNote.id, QL_ACTOR).catch((error: unknown) => error),
    );

    // THE SHAPE EQUALITY — the same typed refusal, payload for payload:
    // the offline leg's POST is the same plan.
    expect((offlineRefusal as { code?: string }).code).toBe("BATCH_QUALITY_HELD");
    expect((offlineRefusal as { code?: string }).code).toBe(
      (onlineRefusal as { code?: string }).code,
    );
    expect((offlineRefusal as { details?: Record<string, unknown> }).details).toEqual(
      (onlineRefusal as { details?: Record<string, unknown> }).details,
    );
    expect((offlineRefusal as { details?: Record<string, unknown> }).details).toMatchObject({
      batchId: world.heldBatchId,
      holdId: hold.id,
      reason: "the offline-shape hold — captured offline, refused at sync",
    });

    // ZERO RESIDUE — the offline document stays exactly as the client
    // left it (DRAFT, no moves, no journal): the reconciliation refused
    // the POST, never rewrote the document.
    const su = await superuserClient();
    const state = await su.query<{ status: string; n: number }>(
      `SELECT status, (SELECT count(*)::int FROM stock_moves sm
         WHERE sm.tenant_id = dn.tenant_id AND sm.source_id = dn.id) AS n
       FROM delivery_notes dn WHERE dn.id = $1`,
      [offlineNote.id],
    );
    expect(state.rows[0]!.status).toBe("DRAFT");
    expect(state.rows[0]!.n).toBe(0);
    await su.end();
  });
});
