import { beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { Decimal } from "@erp/domain-core";

import { requireTenantContext, withTenant } from "../../infra/db/tenant-context";
import { AssetTransfersService } from "../../modules/fixed_assets/application/asset-transfers-service";
import {
  CmmsAssetNotOperableError,
  CmmsInputInvalidError,
  CmmsTransferBranchUnmappedError,
  CmmsTransferSelfApprovalError,
  CmmsTransferStaleError,
  CmmsTransferStateError,
} from "../../modules/fixed_assets/domain/cmms-errors";
import { AuditService } from "../../modules/audit/api/audit";
import { DrizzleAuditStore } from "../../modules/audit/infrastructure/drizzle-audit.store";
import { superuserClient } from "../test-db";
import {
  CM_ACTOR,
  CM_ACTOR2,
  TENANT_CMMS,
  ensureCmmsG61World,
  freshTransferAsset,
  posting,
  type CmmsG61World,
} from "./fixtures";

/**
 * PHASE-049 (W-18 — T-10) — the transfers ladder + G-61 pinned over real
 * PostgreSQL 16 (the plan §4's `cmms-transfers.db.spec`):
 *
 * - THE LADDER (D-06): DRAFT → SUBMITTED → APPROVED/REJECTED, one CAS per
 *   move; every illegal move refuses BY NAME (TRANSFER_STATE_ERROR with
 *   both ends); the from-branch is DERIVED from the asset's current branch
 *   (the wrong-side class cannot be authored); the same-branch transfer
 *   refuses at the typed first line.
 * - THE SoD (§4): the creator never approves (or rejects) their own
 *   transfer — the typed backstop, the disposal/treasury pattern.
 * - THE G-61 GOLDEN (the acceptance #3 arm, W-18's wave per the criteria
 *   ledger): cost 100,000 · opening accumulated 25,000 → NBV 75,000 by the
 *   PURE fold; the approval (the SECOND user) posts through the REAL
 *   engine — DR the destination branch's mapped asset account (1212)
 *   75,000 · CR the source branch's (1211) 75,000 — flips the asset's
 *   branch, leaves the carrying columns UNTOUCHED, and lands the seals
 *   (approved stamps + the journal link) in ONE guarded UPDATE after the
 *   posting and the flip; BR-100's exactly-once: the replay refuses BY
 *   NAME.
 * - THE MAPPING CHECK BEFORE THE FLIP: an unmapped destination branch
 *   fails closed BY NAME (PURPOSE_NOT_MAPPED carrying the branch + the
 *   expected key) with ZERO residue (the row stays SUBMITTED, the asset
 *   unmoved, zero journal rows).
 * - THE STALE FLOOR: a transfer idling while another approval moved the
 *   asset refuses BY NAME (TRANSFER_STALE with both branches).
 * - THE ZERO-NBV PATH: a fully-depreciated asset transfers with NO entry
 *   (the 0107 gate's own NULL allowance — the declared interpretation).
 * - THE REJECTION: the verdict XOR's other side, the reason never silent.
 */

const audit = new AuditService(new DrizzleAuditStore());
const transfers = new AssetTransfersService(audit, posting);

let world: CmmsG61World;

function expectDec(actual: string | null | undefined, expected: string): void {
  expect(actual === null || actual === undefined ? null : new Decimal(actual).toString()).toBe(
    new Decimal(expected).toString(),
  );
}

beforeAll(async () => {
  world = await ensureCmmsG61World();
});

describe("PHASE-049 W-18 — the transfers ladder (D-06: the CAS moves, refused BY NAME)", () => {
  it("the from-branch is DERIVED from the asset's current branch; a same-branch transfer refuses at the typed first line", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshTransferAsset("TR-DERIVE");
      const created = await transfers.create({
        assetId: asset,
        toBranchId: world.branchCm2Id,
        reason: "Derived from",
        actorId: CM_ACTOR,
      });
      expect(created.fromBranchId).toBe(world.branchCmId);
      expect(created.toBranchId).toBe(world.branchCm2Id);
      expect(created.status).toBe("DRAFT");

      const sameBranch = await transfers
        .create({ assetId: asset, toBranchId: world.branchCmId, reason: "No-op", actorId: CM_ACTOR })
        .catch((error: unknown) => error);
      expect(sameBranch).toBeInstanceOf(CmmsInputInvalidError);
      expect((sameBranch as CmmsInputInvalidError).message).toContain("already sits in branch");
    });
  });

  it("the legal ladder walks DRAFT → SUBMITTED → APPROVED; the illegal moves refuse BY NAME with both ends", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshTransferAsset("TR-LADDER");
      const created = await transfers.create({
        assetId: asset,
        toBranchId: world.branchCm2Id,
        reason: "Ladder walk",
        actorId: CM_ACTOR,
      });
      // A verdict on a DRAFT refuses.
      const early = await transfers
        .approve({ transferId: created.id, actorId: CM_ACTOR2 })
        .catch((error: unknown) => error);
      expect(early).toBeInstanceOf(CmmsTransferStateError);
      expect((early as CmmsTransferStateError).details).toMatchObject({ from: "DRAFT", to: "APPROVED" });

      const moved = await transfers.submit(created.id, CM_ACTOR);
      expect(moved.status).toBe("SUBMITTED");
      expect(moved.submittedAt).not.toBeNull();

      // A re-submit refuses.
      const resubmit = await transfers.submit(created.id, CM_ACTOR).catch((error: unknown) => error);
      expect(resubmit).toBeInstanceOf(CmmsTransferStateError);
      expect((resubmit as CmmsTransferStateError).details).toMatchObject({ from: "SUBMITTED", to: "SUBMITTED" });

      const approved = await transfers.approve({ transferId: created.id, actorId: CM_ACTOR2 });
      expect(approved.transfer.status).toBe("APPROVED");

      // The verdict on a decided row refuses (the XOR's floor, typed).
      const reVerdict = await transfers
        .approve({ transferId: created.id, actorId: CM_ACTOR2 })
        .catch((error: unknown) => error);
      expect(reVerdict).toBeInstanceOf(CmmsTransferStateError);
      const reReject = await transfers
        .reject({ transferId: created.id, rejectReason: "too late", actorId: CM_ACTOR2 })
        .catch((error: unknown) => error);
      expect(reReject).toBeInstanceOf(CmmsTransferStateError);
    });
  });

  it("D-01's authoring guard: a DISPOSED asset transfers nowhere", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshTransferAsset("TR-DISPOSED");
      const su = await superuserClient();
      await su.query(`UPDATE assets SET status = 'DISPOSED', disposed_at = now() WHERE tenant_id = $1 AND id = $2`, [
        TENANT_CMMS,
        asset,
      ]);
      await su.end();
      const refused = await transfers
        .create({ assetId: asset, toBranchId: world.branchCm2Id, reason: "Nope", actorId: CM_ACTOR })
        .catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(CmmsAssetNotOperableError);
    });
  });
});

describe("PHASE-049 W-18 — THE G-61 GOLDEN (T-10 — D-06/BR-100, the owner's seals-after-success order)", () => {
  it("the approval posts the NBV reclassification through the REAL engine, flips the branch, touches no carrying column, seals after the operation — and the replay refuses (BR-100)", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshTransferAsset("TR-GOLDEN");
      const created = await transfers.create({
        assetId: asset,
        toBranchId: world.branchCm2Id,
        reason: "Relocated to the new workshop",
        reasonAr: "نقل إلى الورشة الجديدة",
        actorId: CM_ACTOR,
      });
      await transfers.submit(created.id, CM_ACTOR);

      // SoD first: the creator never approves their own transfer.
      const self = await transfers
        .approve({ transferId: created.id, actorId: CM_ACTOR })
        .catch((error: unknown) => error);
      expect(self).toBeInstanceOf(CmmsTransferSelfApprovalError);

      // THE APPROVAL — the second user.
      const approved = await transfers.approve({ transferId: created.id, actorId: CM_ACTOR2 });
      expectDec(approved.nbv, "75000");
      expect(approved.journalEntryId).toBeTruthy();
      expect(approved.fromAccountId).toBe(world.fromAccountId);
      expect(approved.toAccountId).toBe(world.toAccountId);

      // The seals: the verdict stamps + the journal link on the APPROVED row.
      expect(approved.transfer.status).toBe("APPROVED");
      expect(approved.transfer.approvedAt).not.toBeNull();
      expect(approved.transfer.approvedBy).toBe(CM_ACTOR2);
      expect(approved.transfer.journalEntryId).toBe(approved.journalEntryId);
      expect(approved.transfer.rejectedAt).toBeNull();

      // THE ENTRY — exactly the two legs, the branch asset accounts, 75,000
      // (the in-tx read — the ambient transaction's own rows).
      const tx = requireTenantContext().tx!;
      const lines = await tx.execute<{ direction: string; amount: string; account_id: string }>(sql`
        SELECT jl.direction, jl.amount::text AS amount, jl.account_id
        FROM journal_lines jl WHERE jl.journal_entry_id = ${approved.journalEntryId}
        ORDER BY jl.line_no`);
      const lineRows = lines.rows as unknown as { direction: string; amount: string; account_id: string }[];
      expect(lineRows).toHaveLength(2);
      expect(lineRows[0]!.direction).toBe("DEBIT");
      expect(lineRows[0]!.account_id).toBe(world.toAccountId);
      expectDec(lineRows[0]!.amount, "75000");
      expect(lineRows[1]!.direction).toBe("CREDIT");
      expect(lineRows[1]!.account_id).toBe(world.fromAccountId);
      expectDec(lineRows[1]!.amount, "75000");

      // The entry is the asset_transfer source (INV-013's key) — exactly one.
      const entries = await tx.execute<{ count: string }>(sql`
        SELECT count(*)::text AS count FROM journal_entries
        WHERE source_type = 'asset_transfer' AND source_id = ${created.id}`);
      expect((entries.rows as unknown as { count: string }[])[0]!.count).toBe("1");

      // THE FLIP + the untouched carrying columns (D-01: the branch
      // dimension carries the move — cost and accumulated stay EXACTLY).
      const assetRows = await tx.execute<{ branch_id: string; cost: string; opening_accumulated: string }>(sql`
        SELECT branch_id::text AS branch_id, cost::text AS cost,
          opening_accumulated::text AS opening_accumulated
        FROM assets WHERE id = ${asset}`);
      const assetRow = (assetRows.rows as unknown as { branch_id: string; cost: string; opening_accumulated: string }[])[0]!;
      expect(assetRow.branch_id).toBe(world.branchCm2Id);
      expectDec(assetRow.cost, "100000");
      expectDec(assetRow.opening_accumulated, "25000");

      // BR-100's exactly-once: the replay refuses BY NAME (the document-
      // side twin of INV-013 — the verdict stamps are single-use).
      const replay = await transfers
        .approve({ transferId: created.id, actorId: CM_ACTOR2 })
        .catch((error: unknown) => error);
      expect(replay).toBeInstanceOf(CmmsTransferStateError);
      expect((replay as CmmsTransferStateError).details).toMatchObject({ from: "APPROVED", to: "APPROVED" });
    });
  });

  it("THE MAPPING CHECK BEFORE THE FLIP: an unmapped branch fails closed BY NAME with ZERO residue", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshTransferAsset("TR-UNMAPPED");
      const created = await transfers.create({
        assetId: asset,
        toBranchId: world.branchUnmappedId,
        reason: "To the unmapped branch",
        actorId: CM_ACTOR,
      });
      await transfers.submit(created.id, CM_ACTOR);

      const refused = await transfers
        .approve({ transferId: created.id, actorId: CM_ACTOR2 })
        .catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(CmmsTransferBranchUnmappedError);
      expect((refused as CmmsTransferBranchUnmappedError).code).toBe("PURPOSE_NOT_MAPPED");
      expect((refused as CmmsTransferBranchUnmappedError).details).toMatchObject({
        branchCode: "BR-CM3",
        purposeKey: "FIXED_ASSET_BR_CM3",
      });

      // Zero residue: the row stays SUBMITTED, the asset unmoved, zero
      // journal rows for the transfer (the whole act rolled back — the
      // in-tx read of the act's own uncommitted world).
      const tx = requireTenantContext().tx!;
      const rows = await tx.execute<{ status: string; branch_id: string }>(sql`
        SELECT t.status, a.branch_id::text AS branch_id FROM asset_transfers t
        JOIN assets a ON a.id = t.asset_id
        WHERE t.id = ${created.id}`);
      const row = (rows.rows as unknown as { status: string; branch_id: string }[])[0]!;
      expect(row.status).toBe("SUBMITTED");
      expect(row.branch_id).toBe(world.branchCmId);
      const entries = await tx.execute<{ count: string }>(sql`
        SELECT count(*)::text AS count FROM journal_entries
        WHERE source_type = 'asset_transfer' AND source_id = ${created.id}`);
      expect((entries.rows as unknown as { count: string }[])[0]!.count).toBe("0");

      // The honest completion of the same transfer: map the branch, approve
      // again — the act completes cleanly (the fail-closed discipline's
      // own re-run shape, the W-17 all-nothing arm's precedent).
      const tenancy = await import("../../modules/tenancy/infrastructure/tenancy.store");
      const account = await tenancy.findAccountByCode("1212");
      if ((await tenancy.findActivePurpose("FIXED_ASSET_BR_CM3")) === undefined) {
        await tenancy.insertAccountPurpose({
          purposeKey: "FIXED_ASSET_BR_CM3",
          accountId: account!.id,
          activeFrom: new Date().toISOString().slice(0, 10),
        });
      }
      const approved = await transfers.approve({ transferId: created.id, actorId: CM_ACTOR2 });
      expect(approved.transfer.status).toBe("APPROVED");
      expectDec(approved.nbv, "75000");
    });
  });

  it("THE STALE FLOOR: a transfer idling while another approval moved the asset refuses BY NAME — never a wrong-side flip", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshTransferAsset("TR-STALE");
      const first = await transfers.create({
        assetId: asset,
        toBranchId: world.branchCm2Id,
        reason: "The move that lands",
        actorId: CM_ACTOR,
      });
      const second = await transfers.create({
        assetId: asset,
        toBranchId: world.branchUnmappedId,
        reason: "The move that stales",
        actorId: CM_ACTOR,
      });
      await transfers.submit(first.id, CM_ACTOR);
      await transfers.submit(second.id, CM_ACTOR);
      await transfers.approve({ transferId: first.id, actorId: CM_ACTOR2 });

      const stale = await transfers
        .approve({ transferId: second.id, actorId: CM_ACTOR2 })
        .catch((error: unknown) => error);
      expect(stale).toBeInstanceOf(CmmsTransferStaleError);
      expect((stale as CmmsTransferStaleError).details).toMatchObject({
        fromBranchId: world.branchCmId,
        assetBranchId: world.branchCm2Id,
      });

      // Zero residue on the stale one: still SUBMITTED, no journal.
      const entries = await requireTenantContext().tx!.execute<{ count: string }>(sql`
        SELECT count(*)::text AS count FROM journal_entries
        WHERE source_type = 'asset_transfer' AND source_id = ${second.id}`);
      expect((entries.rows as unknown as { count: string }[])[0]!.count).toBe("0");
    });
  });

  it("THE ZERO-NBV PATH: a fully-depreciated asset transfers with NO entry (the 0107 gate's own NULL allowance)", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshTransferAsset("TR-ZERO-NBV", { openingAccumulated: "100000" });
      const created = await transfers.create({
        assetId: asset,
        toBranchId: world.branchCm2Id,
        reason: "Fully depreciated, still moving",
        actorId: CM_ACTOR,
      });
      await transfers.submit(created.id, CM_ACTOR);
      const approved = await transfers.approve({ transferId: created.id, actorId: CM_ACTOR2 });
      expectDec(approved.nbv, "0");
      expect(approved.journalEntryId).toBeNull();
      expect(approved.transfer.status).toBe("APPROVED");
      expect(approved.transfer.journalEntryId).toBeNull();

      // The flip landed all the same — and the carrying columns stand.
      const assetRows = await requireTenantContext().tx!.execute<{ branch_id: string; cost: string }>(sql`
        SELECT branch_id::text AS branch_id, cost::text AS cost FROM assets WHERE id = ${asset}`);
      const assetRow = (assetRows.rows as unknown as { branch_id: string; cost: string }[])[0]!;
      expect(assetRow.branch_id).toBe(world.branchCm2Id);
      expectDec(assetRow.cost, "100000");
    });
  });

  it("THE REJECTION: the verdict XOR's other side — the reason never silent, the asset never moves", async () => {
    await withTenant(TENANT_CMMS, async () => {
      const asset = await freshTransferAsset("TR-REJECT");
      const created = await transfers.create({
        assetId: asset,
        toBranchId: world.branchCm2Id,
        reason: "The refused move",
        actorId: CM_ACTOR,
      });
      await transfers.submit(created.id, CM_ACTOR);

      const noReason = await transfers
        .reject({ transferId: created.id, rejectReason: "  ", actorId: CM_ACTOR2 })
        .catch((error: unknown) => error);
      expect(noReason).toBeInstanceOf(Error);
      expect((noReason as Error).message).toContain("reason");

      // SoD: the creator never rejects their own transfer either.
      const selfReject = await transfers
        .reject({ transferId: created.id, rejectReason: "own", actorId: CM_ACTOR })
        .catch((error: unknown) => error);
      expect(selfReject).toBeInstanceOf(CmmsTransferSelfApprovalError);

      const rejected = await transfers.reject({
        transferId: created.id,
        rejectReason: "The workshop stays where it is",
        actorId: CM_ACTOR2,
      });
      expect(rejected.status).toBe("REJECTED");
      expect(rejected.rejectedAt).not.toBeNull();
      expect(rejected.rejectReason).toBe("The workshop stays where it is");

      // REJECTED stays readable; the asset never moved.
      const assetRows = await requireTenantContext().tx!.execute<{ branch_id: string }>(sql`
        SELECT branch_id::text AS branch_id FROM assets WHERE id = ${asset}`);
      expect((assetRows.rows as unknown as { branch_id: string }[])[0]!.branch_id).toBe(world.branchCmId);
    });
  });
});
