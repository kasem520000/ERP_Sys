import { beforeAll, describe, expect, it } from "vitest";


import { withTenant } from "../../infra/db/tenant-context";
import { superuserClient } from "../test-db";
import * as qualityStore from "../../modules/quality/infrastructure/quality.store";
import { planIssue } from "../../modules/inventory/application/movement-core";
import {
  QL_ACTOR,
  TENANT_QUALITY,
  TENANT_QUALITY_RLS,
  deliveries,
  ensureQualityPostingWorld,
  freshQualityFefoWorld,
  freshQualityHoldWorld,
  holds,
  setupQualityFixture,
  stock,
  transfers,
} from "./fixtures";

/**
 * PHASE-050 (W-28 — T-13) THE INV-035 BLOCKING MATRIX over every baseline
 * path + BR-101's release rule (the plan §4's own arm: "the INV-035
 * blocking matrix over every baseline path + the release rule"). The gate
 * is the shared blocking validation service wired INSIDE planIssue — so
 * the matrix proves BOTH sides: every baseline path that resolves a held
 * batch is refused SERVER-SIDE with the typed 409 and ZERO residue (the
 * document keeps its state, no moves, no journal), and the sole bypass
 * (the G-62 write-off) plus the release rule (BR-101) hold their own
 * laws. أذرع الرفض كلٌّ على عالمه — every arm on its own world.
 */
describe("quality holds — the INV-035 blocking matrix (every baseline path)", () => {
  beforeAll(async () => {
    await setupQualityFixture();
    await ensureQualityPostingWorld();
  });

  it("THE RAW CHOKE POINT: a planIssue on a held batch is refused with the typed gate naming the batch, the reason and the figures", async () => {
    const world = await freshQualityHoldWorld("GATE");
    const hold = await withTenant(TENANT_QUALITY, () =>
      holds.create({
        batchId: world.batchId,
        reason: "customer complaint under investigation",
        actorId: QL_ACTOR,
      }),
    );
    expect(hold.status).toBe("ACTIVE");
    await expect(
      withTenant(TENANT_QUALITY, () =>
        planIssue({
          itemId: world.itemId,
          warehouseId: world.warehouseId,
          qty: "5",
          movedAt: "2026-11-23",
          moveKind: "issue",
          sourceType: "manual_issue",
          sourceId: world.itemId,
          batchId: world.batchId,
        }),
      ),
    ).rejects.toMatchObject({
      code: "BATCH_QUALITY_HELD",
      details: { batchId: world.batchId, holdId: hold.id, reason: "customer complaint under investigation" },
    });
  });

  it("THE INVENTORY ISSUE PATH (the canonical baseline): manualIssue refuses with ZERO residue — no moves, no journal, the stock stands", async () => {
    const world = await freshQualityHoldWorld("MANUAL");
    await withTenant(TENANT_QUALITY, () =>
      holds.create({ batchId: world.batchId, reason: "hold — manual issue arm", actorId: QL_ACTOR }),
    );
    await expect(
      withTenant(TENANT_QUALITY, () =>
        stock.manualIssue({
          itemId: world.itemId,
          warehouseId: world.warehouseId,
          qty: "5",
          reason: "DAMAGE",
          counterAccountId: null,
          valueDate: "2026-11-23",
          batchId: world.batchId,
          actorId: QL_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "BATCH_QUALITY_HELD" });
    const su = await superuserClient();
    const moves = await su.query(
      `SELECT count(*)::int AS n FROM stock_moves WHERE tenant_id = $1 AND batch_id = $2`,
      [TENANT_QUALITY, world.batchId],
    );
    // The world's own receipt move stands; the refused issue added NOTHING.
    expect(moves.rows[0]!.n).toBe(1);
    // The zero-residue read is WORLD-SCOPED (this arm's own item — the
    // family's other worlds may legitimately carry their own issue
    // journals in the same tenant).
    const journals = await su.query(
      `SELECT count(*)::int AS n FROM journal_entries WHERE tenant_id = $1
         AND description::text LIKE '%Manual stock issue %' || $2 || '%'`,
      [TENANT_QUALITY, `QL-SCRAP-HOLD-MANUAL`],
    );
    expect(journals.rows[0]!.n).toBe(0);
    await su.end();
  });

  it("THE SALES DELIVERY PATH (the baseline ship path): the post refuses, the document stays DRAFT, ZERO residue", async () => {
    const world = await freshQualityHoldWorld("DELIVERY");
    await withTenant(TENANT_QUALITY, () =>
      holds.create({ batchId: world.batchId, reason: "hold — delivery arm", actorId: QL_ACTOR }),
    );
    const note = await withTenant(TENANT_QUALITY, async () =>
      deliveries.create({
        branchId: (await branchQl())!,
        customerId: (await customerQl())!,
        salesRepId: null,
        orderId: null,
        warehouseId: world.warehouseId,
        deliveryDate: "2026-11-23",
        currencyCode: "SAR",
        note: "the blocked delivery",
        noteAr: null,
        actorId: QL_ACTOR,
        lines: [
          {
            orderLineId: null,
            itemId: world.itemId,
            qty: "5",
            unitPrice: "10.000000",
            discountAmount: null,
            batchId: world.batchId,
            serialIds: null,
            description: null,
            descriptionAr: null,
            note: null,
          },
        ],
      }),
    );
    await expect(
      withTenant(TENANT_QUALITY, () => deliveries.post(note.id, QL_ACTOR)),
    ).rejects.toMatchObject({ code: "BATCH_QUALITY_HELD" });
    const su = await superuserClient();
    const state = await su.query<{ status: string; n: number }>(
      `SELECT status, (SELECT count(*)::int FROM stock_moves sm
         WHERE sm.tenant_id = dn.tenant_id AND sm.source_id = dn.id) AS n
       FROM delivery_notes dn WHERE dn.id = $1`,
      [note.id],
    );
    expect(state.rows[0]!.status).toBe("DRAFT");
    expect(state.rows[0]!.n).toBe(0);
    await su.end();
  });

  it("THE TRANSFER PATH: the dispatch refuses on the FEFO-resolved held batch (the auto-pick is gated alike)", async () => {
    const world = await freshQualityFefoWorld("XFER");
    await withTenant(TENANT_QUALITY, () =>
      holds.create({
        batchId: world.heldBatchId,
        reason: "hold — transfer arm",
        actorId: QL_ACTOR,
      }),
    );
    const transfer = await withTenant(TENANT_QUALITY, async () =>
      transfers.create({
        fromWarehouseId: world.warehouseId,
        toWarehouseId: (await warehouseQl())!,
        note: "the blocked transfer",
        noteAr: null,
        actorId: QL_ACTOR,
        lines: [{ itemId: world.itemId, qty: "5" }],
      }),
    );
    await expect(
      withTenant(TENANT_QUALITY, () => transfers.dispatch(transfer.id, QL_ACTOR)),
    ).rejects.toMatchObject({ code: "BATCH_QUALITY_HELD" });
  });

  it("THE FEFO ARM: the gate refuses the auto-pick — a held batch is never silently issued (no fallback to the later batch)", async () => {
    const world = await freshQualityFefoWorld("FEFO");
    await withTenant(TENANT_QUALITY, () =>
      holds.create({
        batchId: world.heldBatchId,
        reason: "hold — the FEFO-first batch",
        actorId: QL_ACTOR,
      }),
    );
    // No explicit batch: FEFO resolves the HELD batch (it expires first)
    // → the gate refuses (the strict law: reject, never silently skip to
    // the next batch).
    await expect(
      withTenant(TENANT_QUALITY, () =>
        stock.manualIssue({
          itemId: world.itemId,
          warehouseId: world.warehouseId,
          qty: "5",
          reason: "DAMAGE",
          counterAccountId: null,
          valueDate: "2026-11-23",
          actorId: QL_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({
      code: "BATCH_QUALITY_HELD",
      details: { batchId: world.heldBatchId },
    });
  });

  it("THE SOLE BYPASS: the G-62 write-off issues the held batch (the NCR disposition act — BR-101's own ordering)", async () => {
    const world = await freshQualityHoldWorld("BYPASS");
    await withTenant(TENANT_QUALITY, () =>
      holds.create({
        batchId: world.batchId,
        reason: "hold — the write-off bypass arm",
        actorId: QL_ACTOR,
      }),
    );
    // The NCR engine's SCRAP disposition lands AT the hold — the write-off
    // moves the held batch (the sole allowHeldBatch caller) and the hold
    // stays ACTIVE (its release is the NEXT act, justified by this very
    // disposition).
    const { NcrService } = await import("../../modules/quality/application/ncr-service");
    const { audit, numbering, posting } = await import("./fixtures");
    const ncrService = new NcrService(audit, posting, numbering);
    const created = await withTenant(TENANT_QUALITY, () =>
      ncrService.create({
        itemId: world.itemId,
        batchId: world.batchId,
        source: "PRODUCTION",
        severity: "HIGH",
        problem: "the held batch's scrap disposition (the bypass arm)",
        affectedQty: "10",
        actorId: QL_ACTOR,
      }),
    );
    const dispositioned = await withTenant(TENANT_QUALITY, () =>
      ncrService.disposition(created.id, { disposition: "SCRAP", actorId: QL_ACTOR }),
    );
    expect(dispositioned.ncr.status).toBe("DISPOSITIONED");
    expect(dispositioned.ncr.disposition).toBe("SCRAP");
    expect(dispositioned.writeOff).not.toBeNull();
    const su = await superuserClient();
    const moves = await su.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM stock_moves
        WHERE tenant_id = $1 AND batch_id = $2 AND source_type = 'ncr_record'`,
      [TENANT_QUALITY, world.batchId],
    );
    expect(moves.rows[0]!.n).toBe(1);
    await su.end();
  });

  it("THE RELEASE RULE (BR-101 + the flip-and-restore): the linked hold releases, and the previously blocked path posts GREEN", async () => {
    const world = await freshQualityHoldWorld("RELEASE");
    // The hold carries NO NCR link → the release is refused (BR-101's floor).
    const bare = await withTenant(TENANT_QUALITY, () =>
      holds.create({ batchId: world.batchId, reason: "hold — the release arm", actorId: QL_ACTOR }),
    );
    await expect(
      withTenant(TENANT_QUALITY, () =>
        holds.release({ holdId: bare.id, releaseNote: "try to release without the link", actorId: QL_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "HOLD_RELEASE_DISPOSITION_REQUIRED" });

    // The proper flow: an NCR with an ACCEPT disposition justifies the
    // release — the hold created WITH the link releases; the blocked
    // manual issue then posts GREEN (the flip-and-restore).
    const { NcrService } = await import("../../modules/quality/application/ncr-service");
    const { audit, numbering, posting } = await import("./fixtures");
    const ncrService = new NcrService(audit, posting, numbering);
    const ncr = await withTenant(TENANT_QUALITY, () =>
      ncrService.create({
        itemId: world.itemId,
        batchId: world.batchId,
        source: "PRODUCTION",
        severity: "LOW",
        problem: "the release arm's justifying NCR",
        affectedQty: "1",
        actorId: QL_ACTOR,
      }),
    );
    await withTenant(TENANT_QUALITY, () =>
      ncrService.disposition(ncr.id, { disposition: "ACCEPT", actorId: QL_ACTOR }),
    );
    // THE ONE-ACTIVE-PER-BATCH LAW: the bare hold still stands, so a
    // second ACTIVE hold on the SAME batch — even one carrying the link —
    // is refused BY NAME (the 0116 partial unique's own typed pre-check).
    await expect(
      withTenant(TENANT_QUALITY, () =>
        holds.create({
          batchId: world.batchId,
          reason: "a second active hold on the same batch",
          ncrId: ncr.id,
          actorId: QL_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "BATCH_HOLD_ALREADY_ACTIVE" });

    // The bare hold never gains its link (the register is append-only
    // evidence — the honest shape is a fresh world per arm): the
    // flip-and-restore completes on the SECOND world below.
    const world2 = await freshQualityHoldWorld("RELEASE2");
    const ncr2 = await withTenant(TENANT_QUALITY, () =>
      ncrService.create({
        itemId: world2.itemId,
        batchId: world2.batchId,
        source: "PRODUCTION",
        severity: "LOW",
        problem: "the flip-and-restore's justifying NCR",
        affectedQty: "1",
        actorId: QL_ACTOR,
      }),
    );
    await withTenant(TENANT_QUALITY, () =>
      ncrService.disposition(ncr2.id, { disposition: "ACCEPT", actorId: QL_ACTOR }),
    );
    const hold2 = await withTenant(TENANT_QUALITY, () =>
      holds.create({
        batchId: world2.batchId,
        reason: "hold — the flip-and-restore arm",
        ncrId: ncr2.id,
        actorId: QL_ACTOR,
      }),
    );
    await expect(
      withTenant(TENANT_QUALITY, () =>
        stock.manualIssue({
          itemId: world2.itemId,
          warehouseId: world2.warehouseId,
          qty: "5",
          reason: "DAMAGE",
          counterAccountId: null,
          valueDate: "2026-11-23",
          batchId: world2.batchId,
          actorId: QL_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "BATCH_QUALITY_HELD" });
    const released = await withTenant(TENANT_QUALITY, () =>
      holds.release({
        holdId: hold2.id,
        releaseNote: "the investigation closed — the NCR's ACCEPT disposition justifies the release",
        actorId: QL_ACTOR,
      }),
    );
    expect(released.status).toBe("RELEASED");
    expect(released.releasedAt).not.toBeNull();
    expect(released.releaseNote).toContain("justifies the release");
    // THE FLIP-AND-RESTORE: the same manual issue that was refused now
    // posts GREEN through the REAL engine.
    await expect(
      withTenant(TENANT_QUALITY, () =>
        stock.manualIssue({
          itemId: world2.itemId,
          warehouseId: world2.warehouseId,
          qty: "5",
          reason: "DAMAGE",
          counterAccountId: null,
          valueDate: "2026-11-23",
          batchId: world2.batchId,
          actorId: QL_ACTOR,
        }),
      ),
    ).resolves.toBeTruthy();
    // The RELEASED register refuses every move (the evidence law).
    await expect(
      withTenant(TENANT_QUALITY, () =>
        holds.release({ holdId: hold2.id, releaseNote: "again", actorId: QL_ACTOR }),
      ),
    ).rejects.toMatchObject({ code: "BATCH_QUALITY_HOLD_STATE" });
  });

  it("THE REGISTER'S OWN FLOORS: the not-found 404 shape, the batch's active read, the RLS boundary", async () => {
    await expect(
      withTenant(TENANT_QUALITY, () =>
        holds.release({
          holdId: "00000000-0000-4000-8000-000000000000",
          releaseNote: "no such hold",
          actorId: QL_ACTOR,
        }),
      ),
    ).rejects.toMatchObject({ code: "BATCH_QUALITY_HOLD_NOT_FOUND" });

    const world = await freshQualityHoldWorld("RLS");
    const hold = await withTenant(TENANT_QUALITY, () =>
      holds.create({ batchId: world.batchId, reason: "hold — the RLS arm", actorId: QL_ACTOR }),
    );
    const active = await withTenant(TENANT_QUALITY, () => holds.findActiveByBatch(world.batchId));
    expect(active?.id).toBe(hold.id);
    // The isolated tenant sees NO holds (the RLS boundary — the register
    // is tenant-scoped; the gate's read through the same store rides the
    // same boundary).
    const isolated = await withTenant(TENANT_QUALITY_RLS, () =>
      qualityStore.listBatchQualityHolds({ limit: 10 }),
    );
    expect(isolated).toHaveLength(0);
    const isolatedActive = await withTenant(TENANT_QUALITY_RLS, () =>
      qualityStore.findActiveHoldByBatch(world.batchId),
    );
    expect(isolatedActive).toBeUndefined();
  });
});

// ── the fixture world's own lookups (the QL tenant's standing rows) ─────────

async function branchQl(): Promise<string | null> {
  const su = await superuserClient();
  const rows = await su.query<{ id: string }>(
    `SELECT id FROM branches WHERE tenant_id = $1 AND code = 'BR-QL' LIMIT 1`,
    [TENANT_QUALITY],
  );
  await su.end();
  return rows.rows[0]?.id ?? null;
}

async function customerQl(): Promise<string | null> {
  const su = await superuserClient();
  const rows = await su.query<{ id: string }>(
    `SELECT id FROM partners WHERE tenant_id = $1 AND code = 'QL-CUST' LIMIT 1`,
    [TENANT_QUALITY],
  );
  await su.end();
  return rows.rows[0]?.id ?? null;
}

async function warehouseQl(): Promise<string | null> {
  const su = await superuserClient();
  const rows = await su.query<{ id: string }>(
    `SELECT id FROM warehouses WHERE tenant_id = $1 AND code = 'QL-WH' LIMIT 1`,
    [TENANT_QUALITY],
  );
  await su.end();
  return rows.rows[0]?.id ?? null;
}
