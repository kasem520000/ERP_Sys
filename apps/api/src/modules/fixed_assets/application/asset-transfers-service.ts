import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import { findActivePurpose } from "../../accounting/infrastructure/accounting.store";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/cmms.store";
import {
  CmmsAssetNotOperableError,
  CmmsInputInvalidError,
  CmmsTransferBranchUnmappedError,
  CmmsTransferNotFoundError,
  CmmsTransferRaceError,
  CmmsTransferRejectReasonRequiredError,
  CmmsTransferSelfApprovalError,
  CmmsTransferStaleError,
  CmmsTransferStateError,
} from "../domain/cmms-errors";
import { netBookValue } from "../domain/cmms-plan-math";

/**
 * PHASE-049 (W-18 — T-10) THE TRANSFERS API: the branch-transfer ladder
 * (D-06 — BR-100/G-61) with XOR verdicts, CAS ladders and the seals
 * landing AFTER the operation succeeds, in the SAME transaction:
 *
 *   THE LADDER (0107's stamp law): DRAFT → SUBMITTED → APPROVED/REJECTED
 *   — one guarded CAS per move (the verdict stamps land in the same
 *   statement); the verdict XOR is the floor (never both verdicts —
 *   ck_asset_transfers_stamps), every illegal move refused BY NAME
 *   (TRANSFER_STATE_ERROR carrying both ends).
 *
 *   THE HONEST-TRANSFER FLOOR: the from-branch is DERIVED from the asset's
 *   current branch at authoring (never user-supplied — the wrong-side
 *   class cannot be authored), and the approval re-checks it: a transfer
 *   idling while another approved transfer moved the asset refuses BY
 *   NAME (TRANSFER_STALE with both branches) — never a silent wrong-side
 *   flip.
 *
 *   THE APPROVAL ACT (G-61 — the owner's W-18 order: «G-61 بـXOR وسلالم
 *   CAS والأختام بعد نجاح العملية في المعاملة نفسها»): ONE ambient
 *   transaction — (1) the SoD backstop (the creator never approves their
 *   own transfer, the disposal/treasury pattern); (2) THE MAPPING CHECK
 *   BEFORE THE FLIP: each side's branch asset account resolves through
 *   the EXISTING per-branch FIXED_ASSET purpose mapping (the derived key
 *   `FIXED_ASSET_{BRANCH_CODE}` — the account_purposes mechanism 0108
 *   declared "no new marker" for G-61); an unmapped branch refuses
 *   fail-closed BY NAME (PURPOSE_NOT_MAPPED, the engine's own vocabulary);
 *   (3) NBV = the pure fold netBookValue(cost, accumulated) — zero
 *   parallel computation; (4) NBV > 0 → the G-61 entry through the REAL
 *   engine (INV-013 idempotent on source `asset_transfer:{id}:approve`:
 *   DR the destination branch's mapped asset account · CR the source
 *   branch's mapped asset account — the asset's cost and accumulated
 *   columns UNTOUCHED, D-01: the branch dimension carries the move); NBV
 *   = 0 → no entry (a fully-depreciated asset transfers at zero — the
 *   0107 journal gate's own NULL allowance is exactly this path's floor;
 *   the declared interpretation); (5) the branch flip; (6) THE SEALS —
 *   approved_at/approved_by + the journal link in ONE guarded UPDATE
 *   (status = 'SUBMITTED' AND the stamps NULL — BR-100's exactly-once
 *   consumption), landing AFTER the posting and the flip succeeded in
 *   the same transaction (the 0105 completion-stamp precedent).
 *
 *   REJECTED stays readable forever (no DELETE — the contract history).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PURPOSE_KEY_RE = /^[A-Z][A-Z0-9_]{2,40}$/;

function requireUuid(value: string, what: string): string {
  if (!UUID_RE.test(value)) {
    throw new CmmsInputInvalidError(`${what} must be a UUID: ${value}`);
  }
  return value;
}

function nowIso(): string {
  return new Date().toISOString();
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The per-branch FIXED_ASSET purpose key (0108's declared G-61 mapping —
 * "the EXISTING per-branch FIXED_ASSET mapping, no new marker"): the
 * branch code normalized into the purpose-key shape (uppercase,
 * non-alphanumerics → underscores). The tenant maps each branch that
 * participates in transfers; unmapped fails closed BY NAME.
 */
export function branchAssetPurposeKey(branchCode: string): string {
  const normalized = branchCode.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const key = `FIXED_ASSET_${normalized}`;
  if (!PURPOSE_KEY_RE.test(key)) {
    throw new CmmsInputInvalidError(
      `branch code ${branchCode} cannot derive a purpose key (${key}) — rename the branch (codes are [A-Za-z0-9_-]{1,20})`,
    );
  }
  return key;
}

@Injectable()
export class AssetTransfersService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PostingService) private readonly posting: PostingService,
  ) {}

  // -- the register (D-06 — the honest-transfer floor) --------------------------

  async create(input: {
    assetId: string;
    toBranchId: string;
    reason: string;
    reasonAr?: string | null;
    note?: string | null;
    noteAr?: string | null;
    actorId: string | null;
  }): Promise<store.TransferRow> {
    requireUuid(input.assetId, "assetId");
    requireUuid(input.toBranchId, "toBranchId");
    if (input.reason.trim().length === 0 || input.reason.length > 2000) {
      throw new CmmsInputInvalidError("reason is required (1…2000 chars)");
    }
    // D-01's authoring guard: a disposed/written-off asset transfers nowhere.
    const basis = await store.findAssetTransferBasis(input.assetId);
    if (basis === undefined) {
      throw new CmmsInputInvalidError(`asset ${input.assetId} does not exist in this tenant`);
    }
    if (basis.status === "DISPOSED" || basis.status === "WRITTEN_OFF") {
      throw new CmmsAssetNotOperableError({ assetId: input.assetId, status: basis.status });
    }
    const toBranch = await store.findBranchLite(input.toBranchId);
    if (toBranch === undefined) {
      throw new CmmsInputInvalidError(`branch ${input.toBranchId} does not exist in this tenant`);
    }
    if (!toBranch.isActive) {
      throw new CmmsInputInvalidError(
        `branch ${toBranch.code} is inactive — transfers land on active branches only (the branches' own law: inactive branches reject new documents)`,
      );
    }
    // The from ≠ to law (0107's CHECK is the floor; the typed first line
    // names both branches). The from-branch is DERIVED — never supplied.
    if (basis.branchId === input.toBranchId) {
      throw new CmmsInputInvalidError(
        `asset ${input.assetId} already sits in branch ${toBranch.code} — a transfer moves it to a DIFFERENT branch (from ≠ to, 0107's floor)`,
      );
    }
    const fromBranch = await store.findBranchLite(basis.branchId);
    if (fromBranch === undefined) {
      throw new CmmsInputInvalidError(`the asset's branch ${basis.branchId} does not exist`);
    }
    const transfer = await store.insertTransfer({
      assetId: input.assetId,
      fromBranchId: basis.branchId,
      toBranchId: input.toBranchId,
      reason: input.reason,
      reasonAr: input.reasonAr ?? null,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "assets.asset_transfer_created",
      entityType: "asset_transfer",
      entityId: transfer.id,
      actorId: input.actorId ?? undefined,
      after: {
        assetId: transfer.assetId,
        fromBranchId: transfer.fromBranchId,
        toBranchId: transfer.toBranchId,
        status: transfer.status,
      },
    });
    return transfer;
  }

  async get(transferId: string): Promise<store.TransferRow> {
    requireUuid(transferId, "transferId");
    const transfer = await store.findTransferById(transferId);
    if (transfer === undefined) throw new CmmsTransferNotFoundError(transferId);
    return transfer;
  }

  async list(filter: { assetId?: string; status?: string }): Promise<store.TransferRow[]> {
    if (filter.assetId !== undefined) requireUuid(filter.assetId, "assetId");
    if (
      filter.status !== undefined &&
      !["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"].includes(filter.status)
    ) {
      throw new CmmsInputInvalidError(
        `status must be one of DRAFT/SUBMITTED/APPROVED/REJECTED: ${filter.status}`,
      );
    }
    return store.listTransfers(filter);
  }

  // -- the ladder (D-06 — one CAS per move, refused BY NAME) --------------------

  /** DRAFT → SUBMITTED (the submission stamps land in the same statement). */
  async submit(transferId: string, actorId: string | null): Promise<store.TransferRow> {
    requireUuid(transferId, "transferId");
    const transfer = await this.get(transferId);
    if (transfer.status !== "DRAFT") {
      throw new CmmsTransferStateError({
        transferId,
        from: transfer.status,
        to: "SUBMITTED",
        reason: "only a DRAFT transfer submits",
      });
    }
    const moved = await store.casSubmitTransfer({
      id: transferId,
      submittedAt: nowIso(),
      actorId,
    });
    if (moved === undefined) {
      throw new CmmsTransferRaceError({ transferId, action: "the submission" });
    }
    await this.audit.record({
      action: "assets.asset_transfer_submitted",
      entityType: "asset_transfer",
      entityId: transferId,
      actorId: actorId ?? undefined,
      before: { status: "DRAFT" },
      after: { status: "SUBMITTED" },
    });
    return moved;
  }

  /**
   * THE APPROVAL ACT (G-61 — the seals after the operation, the same
   * transaction). The zero-NBV path (a fully-depreciated asset) flips the
   * branch with NO entry — the 0107 gate's own NULL allowance (declared
   * interpretation: the engine writes only positive amounts, so a
   * zero-NBV reclassification has no entry to write).
   */
  async approve(input: {
    transferId: string;
    actorId: string | null;
  }): Promise<{
    transfer: store.TransferRow;
    journalEntryId: string | null;
    nbv: string;
    fromAccountId: string | null;
    toAccountId: string | null;
  }> {
    requireUuid(input.transferId, "transferId");
    const transfer = await this.get(input.transferId);
    if (transfer.status !== "SUBMITTED") {
      throw new CmmsTransferStateError({
        transferId: transfer.id,
        from: transfer.status,
        to: "APPROVED",
        reason: "only a SUBMITTED transfer takes a verdict (the ladder is DRAFT → SUBMITTED → APPROVED/REJECTED)",
      });
    }
    // SoD (§4, the disposal/treasury pattern): the creator never approves
    // their own transfer — a system-created row (createdBy NULL) never trips.
    if (transfer.createdBy !== null && transfer.createdBy === input.actorId) {
      throw new CmmsTransferSelfApprovalError({ transferId: transfer.id, userId: input.actorId ?? "unknown" });
    }
    // The honest-transfer floor: the asset still sits where the transfer
    // departs (another approved transfer may have moved it — never a
    // wrong-side flip).
    const basis = await store.findAssetTransferBasis(transfer.assetId);
    if (basis === undefined) {
      throw new CmmsInputInvalidError(`asset ${transfer.assetId} no longer exists`);
    }
    if (basis.status === "DISPOSED" || basis.status === "WRITTEN_OFF") {
      throw new CmmsAssetNotOperableError({ assetId: transfer.assetId, status: basis.status });
    }
    if (basis.branchId !== transfer.fromBranchId) {
      throw new CmmsTransferStaleError({
        transferId: transfer.id,
        fromBranchId: transfer.fromBranchId,
        assetBranchId: basis.branchId,
      });
    }

    // NBV — the PURE fold (zero parallel computation: the register's own
    // columns are the only inputs).
    const nbv = netBookValue(basis.cost, basis.accumulated);

    let journalEntryId: string | null = null;
    let fromAccountId: string | null = null;
    let toAccountId: string | null = null;
    if (new Decimal(nbv).greaterThan(0)) {
      // THE MAPPING CHECK BEFORE THE FLIP (fail-closed, BY NAME — the
      // branch↔account pair through the EXISTING per-branch FIXED_ASSET
      // purpose mapping; 0108's "no new marker" declaration).
      const fromBranch = await store.findBranchLite(transfer.fromBranchId);
      const toBranch = await store.findBranchLite(transfer.toBranchId);
      if (fromBranch === undefined || toBranch === undefined) {
        throw new CmmsInputInvalidError("the transfer's branches no longer exist in this tenant");
      }
      const fromKey = branchAssetPurposeKey(fromBranch.code);
      const toKey = branchAssetPurposeKey(toBranch.code);
      const fromMapping = await findActivePurpose(fromKey);
      if (fromMapping === undefined) {
        throw new CmmsTransferBranchUnmappedError({
          branchId: transfer.fromBranchId,
          branchCode: fromBranch.code,
          purposeKey: fromKey,
        });
      }
      const toMapping = await findActivePurpose(toKey);
      if (toMapping === undefined) {
        throw new CmmsTransferBranchUnmappedError({
          branchId: transfer.toBranchId,
          branchCode: toBranch.code,
          purposeKey: toKey,
        });
      }
      fromAccountId = fromMapping.accountId;
      toAccountId = toMapping.accountId;

      // THE G-61 ENTRY through the REAL engine (INV-013 idempotent on
      // asset_transfer:{id}:approve): DR the destination's mapped asset
      // account · CR the source's — the NBV reclassification between the
      // branch asset accounts; the asset's own carrying columns UNTOUCHED.
      const today = todayIso();
      const lines: JournalLineSpec[] = [
        {
          accountId: toMapping.accountId,
          direction: "DEBIT",
          amount: nbv,
          memo: {
            en: `Asset transfer ${transfer.id} — NBV reclassified IN (G-61)`,
            ar: `نقل أصل ${transfer.id} — إعادة تصنيف القيمة الدفترية الصافية دخولًا (G-61)`,
          },
        },
        {
          accountId: fromMapping.accountId,
          direction: "CREDIT",
          amount: nbv,
          memo: {
            en: `Asset transfer ${transfer.id} — NBV reclassified OUT (G-61)`,
            ar: `نقل أصل ${transfer.id} — إعادة تصنيف القيمة الدفترية الصافية خروجًا (G-61)`,
          },
        },
      ];
      const spec: JournalSpec = {
        source: { docType: "asset_transfer", docId: transfer.id, operation: "approve" },
        entryDate: today,
        description: {
          en: `Asset transfer approval — G-61 NBV reclassification (${fromBranch.code} → ${toBranch.code})`,
          ar: `اعتماد نقل أصل — إعادة تصنيف القيمة الدفترية الصافية G-61 (${fromBranch.code} ← ${toBranch.code})`,
        },
        currency: await ownTenantBaseCurrency(),
        lines,
      };
      const posted = await this.posting.post(spec, { postedBy: input.actorId });
      journalEntryId = posted.journalEntryId;
    }

    // THE BRANCH FLIP (the same transaction; the asset's cost and
    // accumulated columns are NEVER touched — D-01).
    await store.flipAssetBranch({
      assetId: transfer.assetId,
      toBranchId: transfer.toBranchId,
      actorId: input.actorId,
    });

    // THE SEALS — after the operation succeeded, ONE guarded UPDATE (the
    // single consumption: status = 'SUBMITTED' AND the stamps NULL).
    const approved = await store.sealTransferApproved({
      id: transfer.id,
      journalEntryId,
      approvedAt: nowIso(),
      actorId: input.actorId,
    });
    if (approved === undefined) {
      throw new CmmsTransferRaceError({ transferId: transfer.id, action: "the approval (the verdict stamps are single-use)" });
    }

    await this.audit.record({
      action: "assets.asset_transfer_approved",
      entityType: "asset_transfer",
      entityId: transfer.id,
      actorId: input.actorId ?? undefined,
      before: { status: "SUBMITTED" },
      after: {
        status: "APPROVED",
        journalEntryId,
        nbv,
        fromBranchId: transfer.fromBranchId,
        toBranchId: transfer.toBranchId,
      },
    });
    return { transfer: approved, journalEntryId, nbv, fromAccountId, toAccountId };
  }

  /** SUBMITTED → REJECTED — the verdict XOR's other side (the reason is
   * never silent; one guarded CAS). */
  async reject(input: {
    transferId: string;
    rejectReason: string;
    actorId: string | null;
  }): Promise<store.TransferRow> {
    requireUuid(input.transferId, "transferId");
    if (input.rejectReason.trim().length === 0 || input.rejectReason.length > 2000) {
      throw new CmmsTransferRejectReasonRequiredError({ transferId: input.transferId });
    }
    const transfer = await this.get(input.transferId);
    if (transfer.status !== "SUBMITTED") {
      throw new CmmsTransferStateError({
        transferId: transfer.id,
        from: transfer.status,
        to: "REJECTED",
        reason: "only a SUBMITTED transfer takes a verdict (the ladder is DRAFT → SUBMITTED → APPROVED/REJECTED)",
      });
    }
    // SoD: the creator never rejects their own transfer either (the same
    // verdict plane, the same separation).
    if (transfer.createdBy !== null && transfer.createdBy === input.actorId) {
      throw new CmmsTransferSelfApprovalError({ transferId: transfer.id, userId: input.actorId ?? "unknown" });
    }
    const rejected = await store.sealTransferRejected({
      id: transfer.id,
      rejectedAt: nowIso(),
      rejectReason: input.rejectReason,
      actorId: input.actorId,
    });
    if (rejected === undefined) {
      throw new CmmsTransferRaceError({ transferId: transfer.id, action: "the rejection (the verdict stamps are single-use)" });
    }
    await this.audit.record({
      action: "assets.asset_transfer_rejected",
      entityType: "asset_transfer",
      entityId: transfer.id,
      actorId: input.actorId ?? undefined,
      before: { status: "SUBMITTED" },
      after: { status: "REJECTED", rejectReason: input.rejectReason },
    });
    return rejected;
  }
}
