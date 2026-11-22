import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { Decimal } from "@erp/domain-core";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { MaintenanceWorkOrderService } from "../../modules/fixed_assets/application/maintenance-work-order-service";
import { AssetTransfersService } from "../../modules/fixed_assets/application/asset-transfers-service";
import {
  CmmsPartsShortfallError,
  CmmsTransferBranchUnmappedError,
  CmmsTransferSelfApprovalError,
  CmmsWorkOrderCompletedError,
} from "../../modules/fixed_assets/domain/cmms-errors";
import {
  CM_ACTOR,
  CM_ACTOR2,
  TENANT_CMMS,
  ensureCmmsG61World,
  ensureCmmsG59World,
  freshAsset,
  freshPartsWorld,
  freshTransferAsset,
  numbering,
  posting,
  type CmmsG61World,
  type CmmsG59World,
} from "./fixtures";

/**
 * PHASE-049 (W-22 — T-17a, dated 2026-11-22) · `cmms-goldens.db.spec` —
 * THE GOLDEN TRANSCRIPTS with their FAILURE PACKS (the JOURNAL_RULES §7
 * law: every golden row is mirrored by a golden test with a MANDATORY
 * failure pack — the statutory-goldens precedent's shape: the golden
 * pins every journal line + the INV-013 source key + the engine's own
 * figures; the failure pack flips the world to the failing shape,
 * proves the typed refusal WITH ITS FULL PAYLOAD and the ZERO residue,
 * restores, and the same act re-runs green).
 *
 * The transcripts: G-59 (the fused maintenance-expense completion —
 * labor + parts + external in ONE entry, the parts issued through the
 * REAL WMS path in the same transaction, the asset untouched) · G-60
 * (the spares consumption — the inventory-issue leg with the move
 * sourced to the order and the per-line issue stamps) · G-61 (the
 * transfer approval — the NBV reclassification between the branch
 * asset accounts, posted exactly once) — plus THE INV-034 GOLDEN
 * (فعل-واحد-بشهادتين — act one, witness two: ONE completion act whose
 * FIRST witness is the engine's own verdict (the reconciliation the
 * act itself returns) and whose SECOND witness is the journal's own
 * landed lines — the two agree TO THE CENT, and no posting occurs
 * before completion).
 *
 * Every arm rides the CMMS world (the fixtures' G-59/G-61 substrates);
 * every golden builds its OWN fresh asset world (the per-arm-world
 * law) and every failure pack restores the world it flipped (the
 * sibling specs' refusals stay provable regardless of file order).
 */

const audit = new AuditService(new DrizzleAuditStore());
const orders = new MaintenanceWorkOrderService(audit, posting, numbering);
const transfers = new AssetTransfersService(audit, posting);

let world: CmmsG59World;
let g61: CmmsG61World;
/** The spec's OWN parts world (the per-arm-world law — never the W-17
 * spec's shared stock). */
let parts: { itemId: string; warehouseId: string };

function expectDec(actual: string | null | undefined, expected: string): void {
  expect(actual === null || actual === undefined ? null : new Decimal(actual).toString()).toBe(
    new Decimal(expected).toString(),
  );
}

/** The journal lines a source-keyed entry posted (direction + account
 * code + amount, ordered by line_no). */
async function linesBySource(
  docType: string,
  docId: string,
  operation: string,
): Promise<
  ReadonlyArray<{ direction: string; code: string; amount: string }>
> {
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

/** The stock position for the world's parts item. */
async function stockQty(): Promise<string> {
  const rows = await requireTenantContext().tx!.execute<{ qty: string }>(sql`
    SELECT qty::text AS qty FROM item_stock
    WHERE item_id = ${parts.itemId} AND warehouse_id = ${parts.warehouseId}`);
  return rows.rows[0]!.qty;
}

/** The order's stock moves. */
async function orderMoves(orderId: string): Promise<
  ReadonlyArray<{ qty: string; value_amount: string; posted_journal_id: string }>
> {
  const rows = await requireTenantContext().tx!.execute<{
    qty: string;
    value_amount: string;
    posted_journal_id: string;
  }>(sql`
    SELECT qty::text AS qty, value_amount::text AS value_amount, posted_journal_id
    FROM stock_moves WHERE source_type = 'maintenance_work_order' AND source_id = ${orderId}`);
  return rows.rows;
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
 * same account (the tenant's own runtime repair path). */
async function restorePurposeKey(purposeKey: string): Promise<void> {
  const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
  const active = await tenancy.findActivePurpose(purposeKey);
  if (active === undefined) {
    // Re-map to the account the sibling world uses (the 1211/1212 pair
    // or the 0108 markers — resolved by the caller's world).
    const accountId = await defaultAccountFor(purposeKey);
    await tenancy.insertAccountPurpose({
      purposeKey,
      accountId,
      activeFrom: new Date().toISOString().slice(0, 10),
    });
  }
}

/** The standing account for a purpose key (the seeded CoA's own). */
async function defaultAccountFor(purposeKey: string): Promise<string> {
  const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
  const codes: Record<string, string> = {
    MAINTENANCE_EXPENSE: "5310",
    INVENTORY: "1140",
    FIXED_ASSET_BR_CM3: "1212",
  };
  const account = await tenancy.findAccountByCode(codes[purposeKey] ?? "1212");
  expect(account).toBeDefined();
  return account!.id;
}

/** The full legal walk to IN_PROGRESS on a fresh asset. */
async function startOrder(assetId: string, problem: string): Promise<string> {
  const created = await orders.create({ assetId, problem, actorId: CM_ACTOR });
  await orders.plan(created.id, CM_ACTOR);
  await orders.start(created.id, CM_ACTOR);
  return created.id;
}

beforeAll(async () => {
  world = await ensureCmmsG59World();
  g61 = await ensureCmmsG61World();
  parts = await freshPartsWorld("GD");
});

describe("PHASE-049 W-22 — T-17a: G-59 + G-60 (the fused completion — one act, the maintenance expense and the inventory issue together)", () => {
  it("G-59 THE GOLDEN TRANSCRIPT — D-04's worked example pinned line by line with the source key, the engine's verdict, the WMS witness and the untouched asset", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const assetId = await freshAsset("GD-G59");
      const orderId = await startOrder(assetId, "The G-59 golden world");
      await orders.addLine({
        workOrderId: orderId,
        legType: "LABOR",
        employeeId: world.technicianEmployeeId,
        hours: "2.5",
        unitRate: "480",
        actorId: CM_ACTOR,
      });
      await orders.addLine({
        workOrderId: orderId,
        legType: "PARTS",
        itemId: parts.itemId,
        warehouseId: parts.warehouseId,
        qty: "20",
        actorId: CM_ACTOR,
      });
      await orders.addLine({
        workOrderId: orderId,
        legType: "EXTERNAL",
        partnerId: world.supplierPartnerId,
        amount: "500",
        description: "Calibration service",
        actorId: CM_ACTOR,
      });

      // No posting occurs before completion (INV-034's precondition —
      // the lines stand, the journal does not).
      expect(await entryCount("maintenance_work_order", orderId)).toBe(0);
      expect(await stockQty()).toBe("100.000000");

      const result = await orders.complete({
        workOrderId: orderId,
        solution: "Serviced per the golden transcript",
        actorId: CM_ACTOR,
      });

      // THE TRANSCRIPT — every line pinned (the fused G-59 shape).
      const lines = await linesBySource("maintenance_work_order", orderId, "complete");
      expect(lines).toEqual([
        { direction: "DEBIT", code: "5310", amount: "2500.0000" }, // MAINTENANCE_EXPENSE
        { direction: "CREDIT", code: "1140", amount: "800.0000" }, // INVENTORY (G-60's leg)
        { direction: "CREDIT", code: "2138", amount: "1200.0000" }, // LABOR_CLEARING
        { direction: "CREDIT", code: "2137", amount: "500.0000" }, // EXTERNAL_ACCRUAL
      ]);

      // THE INV-013 SOURCE KEY — exactly one entry.
      expect(await entryCount("maintenance_work_order", orderId)).toBe(1);
      expect(result.journalEntryId).toBeTruthy();
      expect(result.order.journalEntryId).toBe(result.journalEntryId);

      // THE ENGINE'S OWN FIGURES (the totals + the stamps, one guarded
      // UPDATE).
      expectDec(result.order.laborTotal, "1200");
      expectDec(result.order.partsTotal, "800");
      expectDec(result.order.externalTotal, "500");
      expect(result.order.status).toBe("COMPLETED");
      expect(result.order.completedAt).not.toBeNull();

      // THE ASSET IS UNTOUCHED (D-04's own law).
      const assetRow = await requireTenantContext().tx!.execute<{
        cost: string;
        opening_accumulated: string;
      }>(sql`
        SELECT cost::text AS cost, opening_accumulated::text AS opening_accumulated
        FROM assets WHERE id = ${assetId}`);
      expectDec(assetRow.rows[0]!.cost, "100000");
      expectDec(assetRow.rows[0]!.opening_accumulated, "0");
    });
  });

  it("G-59's FAILURE PACK — the replay refusal WITH ITS PAYLOAD, then the unmapped flip-and-restore with the zero residue and the green re-run", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const assetId = await freshAsset("GD-G59-FP");
      const orderId = await startOrder(assetId, "The G-59 failure-pack world");
      await orders.addLine({
        workOrderId: orderId,
        legType: "EXTERNAL",
        partnerId: world.supplierPartnerId,
        amount: "300",
        description: "Bill",
        actorId: CM_ACTOR,
      });
      const first = await orders.complete({ workOrderId: orderId, actorId: CM_ACTOR });
      expect(first.order.status).toBe("COMPLETED");

      // (a) THE REPLAY — the typed refusal WITH ITS FULL PAYLOAD (the
      // single-use stamp: the completedAt + the action's own words).
      const replay = await orders
        .complete({ workOrderId: orderId, actorId: CM_ACTOR })
        .catch((error: unknown) => error);
      expect(replay).toBeInstanceOf(CmmsWorkOrderCompletedError);
      expect((replay as CmmsWorkOrderCompletedError).code).toBe("WORK_ORDER_COMPLETED");
      expect((replay as CmmsWorkOrderCompletedError).details).toMatchObject({
        workOrderId: orderId,
        action: expect.stringContaining("single-use"),
      });
      // ZERO REMAINING — exactly the one entry stands.
      expect(await entryCount("maintenance_work_order", orderId)).toBe(1);

      // (b) THE UNMAPPED FLIP — a SECOND order whose completion fails
      // closed with the whole act rolled back, then the restore and
      // the green re-run (the same order).
      const assetId2 = await freshAsset("GD-G59-FP2");
      const orderId2 = await startOrder(assetId2, "The rollback arm");
      await orders.addLine({
        workOrderId: orderId2,
        legType: "LABOR",
        employeeId: world.technicianEmployeeId,
        hours: "1",
        unitRate: "100",
        actorId: CM_ACTOR,
      });
      await orders.addLine({
        workOrderId: orderId2,
        legType: "PARTS",
        itemId: parts.itemId,
        warehouseId: parts.warehouseId,
        qty: "10",
        actorId: CM_ACTOR,
      });
      const stockBeforeFlip = await stockQty();

      await supersedePurposeKey("MAINTENANCE_EXPENSE");
      try {
        const refusal = await orders
          .complete({ workOrderId: orderId2, actorId: CM_ACTOR })
          .catch((error: unknown) => error);
        expect((refusal as { code?: string }).code).toBe("PURPOSE_NOT_MAPPED");

        // ZERO RESIDUE — the order still IN_PROGRESS, the stock intact
        // (the shared world's own position — the pack asserts the
        // UNCHANGED figure, never an absolute), zero journal rows,
        // zero moves (together-or-nothing).
        const after = await orders.get(orderId2);
        expect(after.status).toBe("IN_PROGRESS");
        expect(after.journalEntryId).toBeNull();
        expect(await stockQty()).toBe(stockBeforeFlip);
        expect(await entryCount("maintenance_work_order", orderId2)).toBe(0);
        expect((await orderMoves(orderId2)).length).toBe(0);
      } finally {
        await restorePurposeKey("MAINTENANCE_EXPENSE");
      }

      // THE GREEN RE-RUN — the same order completes cleanly (the
      // tenant's own runtime repair path; the act is retryable).
      const done = await orders.complete({ workOrderId: orderId2, actorId: CM_ACTOR });
      expect(done.order.status).toBe("COMPLETED");
      expect(done.reconciliation.balanced).toBe(true);
      expect((await orderMoves(orderId2)).length).toBe(1);
    });
  });

  it("G-60 THE GOLDEN TRANSCRIPT — the spares consumption as the REAL WMS issue: the move sourced to the order, the per-line stamps, the stock, and the inventory credit leg", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const assetId = await freshAsset("GD-G60");
      const orderId = await startOrder(assetId, "The G-60 golden world");
      await orders.addLine({
        workOrderId: orderId,
        legType: "PARTS",
        itemId: parts.itemId,
        warehouseId: parts.warehouseId,
        qty: "15",
        actorId: CM_ACTOR,
      });
      await orders.addLine({
        workOrderId: orderId,
        legType: "LABOR",
        employeeId: world.technicianEmployeeId,
        hours: "0.5",
        unitRate: "200",
        actorId: CM_ACTOR,
      });

      const before = await stockQty();
      const result = await orders.complete({ workOrderId: orderId, actorId: CM_ACTOR });

      // THE MOVE — sourced to the order, the issue's OWN value (15 × 40
      // = 600), the posted journal link = the completion's entry.
      const moves = await orderMoves(orderId);
      expect(moves).toHaveLength(1);
      expectDec(moves[0]!.qty, "15");
      expectDec(moves[0]!.value_amount, "600");
      expect(moves[0]!.posted_journal_id).toBe(result.journalEntryId);

      // THE PER-LINE STAMPS — the parts line priced by the issue at
      // completion (amount + unit cost + the stamp).
      const partsLine = (await orders.listLines(orderId)).find((line) => line.legType === "PARTS");
      expectDec(partsLine?.amount, "600");
      expectDec(partsLine?.issueUnitCost, "40");
      expect(partsLine?.issuedAt).not.toBeNull();

      // THE STOCK — decremented through the REAL WMS path only.
      const after = await stockQty();
      expectDec(new Decimal(before).minus(new Decimal(after)).toString(), "15");

      // THE INVENTORY CREDIT LEG — G-60's own line on the fused entry.
      const lines = await linesBySource("maintenance_work_order", orderId, "complete");
      const inventoryLeg = lines.find(
        (line) => line.code === "1140" && line.direction === "CREDIT",
      );
      expect(inventoryLeg).toBeDefined();
      expectDec(inventoryLeg!.amount, "600");
      // The expense leg carries the fused total: 100 labor + 600 parts.
      expectDec(lines[0]!.amount, "700");
    });
  });

  it("G-60's FAILURE PACK — the shortfall refusal WITH ITS PAYLOAD + the cumulative floor + the INVENTORY unmapped flip-and-restore with the zero residue and the green re-run", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const assetId = await freshAsset("GD-G60-FP");
      const orderId = await startOrder(assetId, "The G-60 failure-pack world");

      // (a) THE SHORTFALL — the named refusal WITH ITS FULL PAYLOAD
      // (onHand + requested; never a silent backorder).
      const onHand = await stockQty();
      const requested = new Decimal(onHand).plus(new Decimal("25")).toFixed(6);
      const shortfall = await orders
        .addLine({
          workOrderId: orderId,
          legType: "PARTS",
          itemId: parts.itemId,
          warehouseId: parts.warehouseId,
          qty: requested,
          actorId: CM_ACTOR,
        })
        .catch((error: unknown) => error);
      expect(shortfall).toBeInstanceOf(CmmsPartsShortfallError);
      expect((shortfall as CmmsPartsShortfallError).code).toBe("PARTS_SHORTFALL");
      expectDec((shortfall as CmmsPartsShortfallError).details?.onHand as string, onHand);
      expectDec((shortfall as CmmsPartsShortfallError).details?.requested as string, requested);
      // ZERO REMAINING — no move, no line.
      expect((await orderMoves(orderId)).length).toBe(0);
      expect(await orders.listLines(orderId)).toHaveLength(0);

      // (b) THE CUMULATIVE FLOOR — the SECOND claim sees the first's.
      const first = await orders.addLine({
        workOrderId: orderId,
        legType: "PARTS",
        itemId: parts.itemId,
        warehouseId: parts.warehouseId,
        qty: "5",
        actorId: CM_ACTOR,
      });
      void first;
      const cumulative = await orders
        .addLine({
          workOrderId: orderId,
          legType: "PARTS",
          itemId: parts.itemId,
          warehouseId: parts.warehouseId,
          qty: new Decimal(onHand).minus(new Decimal("4")).toFixed(6),
          actorId: CM_ACTOR,
        })
        .catch((error: unknown) => error);
      expect(cumulative).toBeInstanceOf(CmmsPartsShortfallError);

      // (c) THE INVENTORY UNMAPPED FLIP — the completion fails closed
      // with the stock intact, then the restore and the green re-run.
      await orders.removeLine({
        workOrderId: orderId,
        lineId: (await orders.listLines(orderId))[0]!.id,
        actorId: CM_ACTOR,
      });
      await orders.addLine({
        workOrderId: orderId,
        legType: "LABOR",
        employeeId: world.technicianEmployeeId,
        hours: "2",
        unitRate: "150",
        actorId: CM_ACTOR,
      });
      await orders.addLine({
        workOrderId: orderId,
        legType: "PARTS",
        itemId: parts.itemId,
        warehouseId: parts.warehouseId,
        qty: "5",
        actorId: CM_ACTOR,
      });
      const stockBefore = await stockQty();

      await supersedePurposeKey("INVENTORY");
      try {
        const refusal = await orders
          .complete({ workOrderId: orderId, actorId: CM_ACTOR })
          .catch((error: unknown) => error);
        expect((refusal as { code?: string }).code).toBe("PURPOSE_NOT_MAPPED");
        // ZERO RESIDUE — the stock intact, zero journal rows, zero moves.
        expect(await stockQty()).toBe(stockBefore);
        expect(await entryCount("maintenance_work_order", orderId)).toBe(0);
        expect((await orderMoves(orderId)).length).toBe(0);
      } finally {
        await restorePurposeKey("INVENTORY");
      }

      // THE GREEN RE-RUN.
      const done = await orders.complete({ workOrderId: orderId, actorId: CM_ACTOR });
      expect(done.order.status).toBe("COMPLETED");
      expectDec(done.order.partsTotal, "200"); // 5 × 40
      expect((await orderMoves(orderId)).length).toBe(1);
    });
  });
});

describe("PHASE-049 W-22 — T-17a: G-61 (the transfer approval — the NBV reclassification, exactly once)", () => {
  it("G-61 THE GOLDEN TRANSCRIPT — the two legs pinned with the source key, the branch flip, the seals and the untouched carrying columns", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const assetId = await freshTransferAsset("GD-G61");
      const created = await transfers.create({
        assetId,
        toBranchId: g61.branchCm2Id,
        reason: "The G-61 golden relocation",
        actorId: CM_ACTOR,
      });
      await transfers.submit(created.id, CM_ACTOR);

      // No posting before the verdict.
      expect(await entryCount("asset_transfer", created.id)).toBe(0);

      const approved = await transfers.approve({ transferId: created.id, actorId: CM_ACTOR2 });

      // THE TRANSCRIPT — exactly the two legs, the branch asset
      // accounts, 75,000 (the NBV by the pure fold).
      const lines = await linesBySource("asset_transfer", created.id, "approve");
      expect(lines).toEqual([
        { direction: "DEBIT", code: "1212", amount: "75000.0000" }, // the destination branch's assets
        { direction: "CREDIT", code: "1211", amount: "75000.0000" }, // the source branch's assets
      ]);

      // THE INV-013 SOURCE KEY + the seals (one guarded UPDATE after
      // the posting and the flip).
      expect(await entryCount("asset_transfer", created.id)).toBe(1);
      expectDec(approved.nbv, "75000");
      expect(approved.journalEntryId).toBeTruthy();
      expect(approved.fromAccountId).toBe(g61.fromAccountId);
      expect(approved.toAccountId).toBe(g61.toAccountId);
      expect(approved.transfer.status).toBe("APPROVED");
      expect(approved.transfer.approvedBy).toBe(CM_ACTOR2);
      expect(approved.transfer.journalEntryId).toBe(approved.journalEntryId);

      // THE FLIP + the untouched carrying columns (D-01: the branch
      // dimension carries the move).
      const assetRow = await requireTenantContext().tx!.execute<{
        branch_id: string;
        cost: string;
        opening_accumulated: string;
      }>(sql`
        SELECT branch_id::text AS branch_id, cost::text AS cost,
          opening_accumulated::text AS opening_accumulated
        FROM assets WHERE id = ${assetId}`);
      expect(assetRow.rows[0]!.branch_id).toBe(g61.branchCm2Id);
      expectDec(assetRow.rows[0]!.cost, "100000");
      expectDec(assetRow.rows[0]!.opening_accumulated, "25000");
    });
  });

  it("G-61's FAILURE PACK — the SoD refusal WITH ITS PAYLOAD, then the unmapped-branch flip-and-restore with the zero residue and the green re-run", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const assetId = await freshTransferAsset("GD-G61-FP");
      const created = await transfers.create({
        assetId,
        toBranchId: g61.branchCm2Id,
        reason: "The G-61 failure-pack relocation",
        actorId: CM_ACTOR,
      });
      await transfers.submit(created.id, CM_ACTOR);

      // (a) THE SoD — the creator never approves their own transfer
      // (the typed refusal WITH ITS PAYLOAD).
      const self = await transfers
        .approve({ transferId: created.id, actorId: CM_ACTOR })
        .catch((error: unknown) => error);
      expect(self).toBeInstanceOf(CmmsTransferSelfApprovalError);
      expect((self as CmmsTransferSelfApprovalError).code).toBe("TRANSFER_SELF_APPROVAL_BLOCKED");
      expect((self as CmmsTransferSelfApprovalError).details).toMatchObject({
        transferId: created.id,
        userId: CM_ACTOR,
      });
      // ZERO REMAINING — still SUBMITTED, no entry.
      expect(await entryCount("asset_transfer", created.id)).toBe(0);

      // (b) THE UNMAPPED BRANCH — the fail-closed refusal WITH ITS FULL
      // PAYLOAD (the branch + the expected purpose key), zero residue,
      // then the map + the green re-run (the same transfer). THE ORDER-
      // ROBUSTNESS FLIP FIRST: the sibling transfers spec's own green
      // re-run maps this very purpose and leaves it mapped — this spec
      // flips the world to the UNMAPPED state it needs (the supersede
      // dance, the W-14 law: the family chunk's file order is never
      // guaranteed), and its finally restores the unmapped state again
      // so the sibling's refusal arm stays provable in turn.
      const tenancyPre = await import("../../modules/tenancy/infrastructure/tenancy.store");
      const accountingPre = await import("../../modules/accounting/infrastructure/accounting.store");
      const standingPre = await tenancyPre.findActivePurpose("FIXED_ASSET_BR_CM3");
      if (standingPre !== undefined) {
        await accountingPre.supersedePurpose(standingPre.id, standingPre.activeFrom);
      }

      const unmappedAssetId = await freshTransferAsset("GD-G61-FP2");
      const unmapped = await transfers.create({
        assetId: unmappedAssetId,
        toBranchId: g61.branchUnmappedId,
        reason: "To the unmapped branch",
        actorId: CM_ACTOR,
      });
      await transfers.submit(unmapped.id, CM_ACTOR);

      const refused = await transfers
        .approve({ transferId: unmapped.id, actorId: CM_ACTOR2 })
        .catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(CmmsTransferBranchUnmappedError);
      expect((refused as CmmsTransferBranchUnmappedError).code).toBe("PURPOSE_NOT_MAPPED");
      expect((refused as CmmsTransferBranchUnmappedError).details).toMatchObject({
        branchCode: "BR-CM3",
        purposeKey: "FIXED_ASSET_BR_CM3",
      });
      // ZERO RESIDUE — the row SUBMITTED, the asset unmoved, zero rows.
      const row = await requireTenantContext().tx!.execute<{ status: string; branch_id: string }>(sql`
        SELECT t.status, a.branch_id::text AS branch_id FROM asset_transfers t
        JOIN assets a ON a.id = t.asset_id WHERE t.id = ${unmapped.id}`);
      expect(row.rows[0]!.status).toBe("SUBMITTED");
      expect(row.rows[0]!.branch_id).toBe(g61.branchCmId);
      expect(await entryCount("asset_transfer", unmapped.id)).toBe(0);

      // THE GREEN RE-RUN — map the branch, approve the SAME transfer,
      // then SUPERSEDE the mapping back in the finally (the sibling
      // transfers spec's unmapped-refusal arm stays provable regardless
      // of file order — the W-14 order-robustness law, the supersede
      // dance's exact shape).
      const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
      const accounting = await import("../../modules/accounting/infrastructure/accounting.store");
      let mappedForRestore: string | undefined;
      try {
        const standing = await tenancy.findActivePurpose("FIXED_ASSET_BR_CM3");
        if (standing === undefined) {
          await tenancy.insertAccountPurpose({
            purposeKey: "FIXED_ASSET_BR_CM3",
            accountId: g61.toAccountId,
            activeFrom: new Date().toISOString().slice(0, 10),
          });
        } else {
          mappedForRestore = standing.id;
        }
        const approved = await transfers.approve({ transferId: unmapped.id, actorId: CM_ACTOR2 });
        expect(approved.transfer.status).toBe("APPROVED");
        expectDec(approved.nbv, "75000");
        expect(await entryCount("asset_transfer", unmapped.id)).toBe(1);
      } finally {
        // THE RESTORE — the branch returns to its unmapped world (the
        // fixture's own standing state) so the sibling spec's refusal
        // arm sees exactly the world it expects.
        const standing = await tenancy.findActivePurpose("FIXED_ASSET_BR_CM3");
        if (standing !== undefined && standing.id !== mappedForRestore) {
          await accounting.supersedePurpose(standing.id, standing.activeFrom);
        }
      }

      // And the FIRST transfer (the SoD world's) still completes under
      // the second user — the pack's own green re-run.
      const done = await transfers.approve({ transferId: created.id, actorId: CM_ACTOR2 });
      expect(done.transfer.status).toBe("APPROVED");
      expect(await entryCount("asset_transfer", created.id)).toBe(1);
    });
  });
});

describe("PHASE-049 W-22 — T-17a: THE INV-034 GOLDEN (فعل-واحد-بشهادتين — act one, witness two)", () => {
  it("ONE completion act, TWO witnesses — the engine's own verdict and the journal's own landed lines agree TO THE CENT; and no posting occurs before the act", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const assetId = await freshAsset("GD-INV034");
      const orderId = await startOrder(assetId, "The INV-034 golden world");
      await orders.addLine({
        workOrderId: orderId,
        legType: "LABOR",
        employeeId: world.technicianEmployeeId,
        hours: "3",
        unitRate: "310.5", // 931.5 — a rounding-bearing leg
        actorId: CM_ACTOR,
      });
      await orders.addLine({
        workOrderId: orderId,
        legType: "PARTS",
        itemId: parts.itemId,
        warehouseId: parts.warehouseId,
        qty: "7",
        actorId: CM_ACTOR,
      });
      await orders.addLine({
        workOrderId: orderId,
        legType: "EXTERNAL",
        partnerId: world.supplierPartnerId,
        amount: "417.25",
        description: "Specialist calibration",
        actorId: CM_ACTOR,
      });

      // WITNESS ZERO — the precondition: the lines stand, NO posting
      // exists, no stock moved (INV-034's "no posting occurs before
      // completion").
      expect(await entryCount("maintenance_work_order", orderId)).toBe(0);
      expect((await orderMoves(orderId)).length).toBe(0);

      // THE ONE ACT.
      const result = await orders.complete({ workOrderId: orderId, actorId: CM_ACTOR });

      // WITNESS ONE — the engine's own verdict, carried by the act
      // itself: the per-leg breakdown, the source total, the GL debit
      // and the difference — all the act's own strings.
      const verdict = result.reconciliation;
      expect(verdict.balanced).toBe(true);
      expectDec(verdict.labor, "931.5"); // 3 × 310.5, the pure fold's half-up
      expectDec(verdict.parts, "280"); // 7 × 40 (the issue's own value)
      expectDec(verdict.external, "417.25");
      expectDec(verdict.sourceTotal, "1628.75");
      expectDec(verdict.glExpenseDebit, "1628.75");
      expectDec(verdict.difference, "0");

      // WITNESS TWO — the journal's own landed lines, read back from
      // the entry the act posted: the expense DEBIT equals the verdict's
      // source total TO THE CENT.
      const lines = await linesBySource("maintenance_work_order", orderId, "complete");
      const debit = lines.filter((line) => line.direction === "DEBIT");
      expect(debit).toHaveLength(1);
      expectDec(debit[0]!.amount, verdict.sourceTotal);
      expectDec(debit[0]!.amount, "1628.75");
      // The credit legs decompose into exactly the verdict's legs.
      const credits = lines.filter((line) => line.direction === "CREDIT");
      expectDec(
        credits.reduce((acc, line) => new Decimal(acc).plus(new Decimal(line.amount)).toString(), "0"),
        "1628.75",
      );

      // THE TWO WITNESSES AGREE — the act's own verdict and the journal
      // it landed: one figure, two attestations, zero drift.
      expect(new Decimal(verdict.glExpenseDebit).equals(new Decimal(debit[0]!.amount))).toBe(true);
      expect(new Decimal(verdict.sourceTotal).equals(new Decimal(debit[0]!.amount))).toBe(true);
    });
  });
});
