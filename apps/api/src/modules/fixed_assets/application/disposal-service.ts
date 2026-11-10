import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import { NumberingService } from "../../accounting/application/numbering-service";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { absExact, compareExact, subExact } from "../../accounting/application/decimal-strings";
import * as store from "../infrastructure/fixed-assets.store";
import { assertCategoryUsable } from "./category-service";
import { assertCanTransitionTo, type AssetStatus } from "./asset-service";
import {
  AssetCategoryNotFoundError,
  AssetNotFoundError,
  InvalidAssetInputError,
} from "../domain/fixed-assets-errors";
import {
  DisposalNotApprovedError,
  DisposalNotFoundError,
  DisposalStateError,
  DisposedAssetReuseError,
  LifecycleInputInvalidError,
  ScrapProceedsRequiredError,
  SelfApprovalBlockedError,
} from "./lifecycle-errors";

/**
 * Disposal service (PHASE-026 T9; BR-043; POSTING_ENGINE §4.1 source
 * `ASSET_DISPOSAL` operation `post` — golden G-23): SALE/SCRAP documents,
 * DRAFT → approve (SoD second user) → POST. The draft FREEZES the register
 * side (net_book_value = store.assetNbv, accumulated_snapshot =
 * store.assetAccumulated, gain_loss = proceeds − NBV — immutable after
 * post); posting assigns the official disposal_no (numbering service,
 * INV-021/ADR-0006), posts the G-23 journal with the MANDATORY loss mirror,
 * and LOCKS the asset (status DISPOSED — INV-023: once, only from
 * ACTIVE/FULLY_DEPRECIATED).
 *
 * G-23 journal (JOURNAL_RULES §7; both gain and loss shapes golden-tested
 * via the pure builder {@link computeDisposalLines}):
 *
 *   DR CASH proceeds (when > 0)
 *   DR ACCUM_DEPRECIATION accumulated_snapshot (when > 0)
 *   CR FIXED_ASSET cost
 *   residual:  proceeds > NBV → CR ASSET_DISPOSAL_GAIN (proceeds − NBV)
 *              proceeds < NBV → DR ASSET_DISPOSAL_LOSS (NBV − proceeds)  ← MANDATORY mirror
 *
 * Balanced by construction: with NBV = cost − accum,
 *   proceeds + accum − cost − (proceeds − NBV)
 *     = proceeds + accum − cost − proceeds + cost − accum = 0 ✓
 * A zero-proceeds SCRAP of a fully-depreciated asset reduces to the
 * two-line shape DR ACCUM · CR FIXED_ASSET (cash and residual legs omitted
 * at 0 — the engine requires amount > 0, never a zero line).
 *
 * SoD (AUTHORIZATION_MATRIX §4): `fixed_assets.disposals.approve` is on the
 * segregation list — the approver MUST be a second user
 * ({@link SelfApprovalBlockedError} backstop), approval is recorded
 * (approved_by/approved_at) and audited, and POST refuses an unapproved
 * disposal ({@link DisposalNotApprovedError}).
 *
 * WRITTEN_OFF policy (documented): a zero-proceeds SCRAP IS the write-off
 * path (same G-23); the asset lands DISPOSED for both SALE and SCRAP —
 * `written_off_at` stays NULL (no separate flag; the kind + proceeds on the
 * disposal document are the audit trail).
 *
 * Permissions: `fixed_assets.disposals.create` / `.approve` / `.post`
 * (§3.11) are enforced at the controller; this service takes the acting
 * userId for the SoD backstop + audit trail.
 */

/** Official disposal numbers (INV-021/ADR-0006; the treasury
 * {PREFIX}-{YYYY}-{SEQ:6} convention, docType `asset_disposal`). */
const DISPOSAL_NUMBER_FORMAT = {
  prefix: "DSP",
  format: "DSP-{YYYY}-{SEQ:6}",
  docType: "asset_disposal",
} as const;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_RE = /^\d+(\.\d{1,4})?$/;

export type DisposalKind = "SALE" | "SCRAP";

/** Disposal is a live-register operation: ACTIVE/FULLY_DEPRECIATED only
 * (INV-023 — DISPOSED/WRITTEN_OFF are terminal). */
function assertDisposable(asset: store.AssetRow): void {
  if (asset.status !== "ACTIVE" && asset.status !== "FULLY_DEPRECIATED") {
    throw new DisposedAssetReuseError({ assetId: asset.id, status: asset.status });
  }
}

export interface DisposalLineInput {
  /** Purpose key of the proceeds account (defaults to CASH — the tenant's
   * active cash mapping, fail-closed when unmapped; mirrors G-21 CASH). */
  cashPurposeKey?: string;
  assetPurposeKey: string;
  accumDepreciationPurposeKey: string;
  /** The frozen disposal-time figures (the document row). */
  cost: string;
  proceeds: string;
  accumulatedSnapshot: string;
  netBookValue: string;
}

/**
 * The G-23 line builder — PURE (exported for the golden suite
 * disposal-math.spec.ts). Zero legs are omitted (engine contract: every
 * amount > 0); the loss mirror is ALWAYS present when proceeds < NBV.
 */
export function computeDisposalLines(input: DisposalLineInput): JournalLineSpec[] {
  const cashPurpose = input.cashPurposeKey ?? "CASH";
  const memo = { en: "Asset disposal", ar: "استبعاد أصل ثابت" };
  const lines: JournalLineSpec[] = [];
  if (compareExact(input.proceeds, "0") > 0) {
    lines.push({ purpose: cashPurpose, direction: "DEBIT", amount: input.proceeds, memo });
  }
  if (compareExact(input.accumulatedSnapshot, "0") > 0) {
    lines.push({
      purpose: input.accumDepreciationPurposeKey,
      direction: "DEBIT",
      amount: input.accumulatedSnapshot,
      memo,
    });
  }
  if (compareExact(input.cost, "0") > 0) {
    lines.push({
      purpose: input.assetPurposeKey,
      direction: "CREDIT",
      amount: input.cost,
      memo,
    });
  }
  // The residual — THE LOSS MIRROR IS MANDATORY (register §F): gain credits
  // ASSET_DISPOSAL_GAIN, loss debits ASSET_DISPOSAL_LOSS. Balanced by
  // construction (see the class comment).
  const gainLoss = subExact(input.proceeds, input.netBookValue);
  if (compareExact(gainLoss, "0") > 0) {
    lines.push({
      purpose: "ASSET_DISPOSAL_GAIN",
      direction: "CREDIT",
      amount: gainLoss,
      memo,
    });
  } else if (compareExact(gainLoss, "0") < 0) {
    lines.push({
      purpose: "ASSET_DISPOSAL_LOSS",
      direction: "DEBIT",
      amount: absExact(gainLoss),
      memo,
    });
  }
  return lines;
}

export interface CreateDisposalInput {
  assetId: string;
  kind: DisposalKind;
  /** ISO date — must fall in an OPEN fiscal period (INV-011, engine-checked). */
  disposalDate: string;
  /**
   * REQUIRED EXPLICIT INPUT — never a default. A zero-proceeds SCRAP is
   * entered as "0" on purpose (ScrapProceedsRequiredError otherwise); a
   * SALE must carry proceeds > 0.
   */
  proceeds: string;
  note?: string | null;
  noteAr?: string | null;
  actorId: string | null;
}

@Injectable()
export class DisposalService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
    private readonly numbering: NumberingService,
  ) {}

  async find(id: string): Promise<store.AssetDisposalRow> {
    const row = await store.findAssetDisposalById(id);
    if (row === undefined) throw new DisposalNotFoundError(id);
    return row;
  }

  /** The asset's disposal document (disposal is exactly-once, INV-023). */
  async findByAsset(assetId: string): Promise<store.AssetDisposalRow | null> {
    const asset = await store.findAssetById(assetId);
    if (asset === undefined) throw new AssetNotFoundError(assetId);
    return (await store.findAssetDisposalByAsset(assetId)) ?? null;
  }

  /**
   * Draft a disposal: freezes the register side at draft time (NBV,
   * accumulated, gain/loss) and enforces the INV-023 entry gates — only
   * ACTIVE/FULLY_DEPRECIATED assets, and NO existing disposal document for
   * the asset (DRAFT or POSTED: there is no rejected state, so any row
   * blocks — disposal is exactly once).
   */
  async createDraft(input: CreateDisposalInput): Promise<store.AssetDisposalRow> {
    if (input.kind !== "SALE" && input.kind !== "SCRAP") {
      throw new LifecycleInputInvalidError(
        `kind must be SALE or SCRAP (DATA_DICTIONARY §9 disposal_kind): ${String(input.kind)}`,
        { kind: input.kind },
      );
    }
    if (!DATE_RE.test(input.disposalDate)) {
      throw new LifecycleInputInvalidError(
        `disposalDate must be an ISO date (yyyy-mm-dd): ${input.disposalDate}`,
        { disposalDate: input.disposalDate },
      );
    }
    // Proceeds is an EXPLICIT required input — the field itself carries the
    // zero-proceeds-SCRAP decision (never a silent default).
    if (input.proceeds === undefined || input.proceeds === null || input.proceeds === "") {
      throw new ScrapProceedsRequiredError(
        "proceeds is a required explicit input — a zero-proceeds SCRAP must be entered as proceeds: \"0\"",
        { assetId: input.assetId, kind: input.kind },
      );
    }
    if (!MONEY_RE.test(input.proceeds)) {
      throw new InvalidAssetInputError(
        `proceeds must be a non-negative decimal string with ≤ 4 decimals (ADR-0009): ${input.proceeds}`,
        { field: "proceeds", value: input.proceeds },
      );
    }
    if (compareExact(input.proceeds, "0") < 0) {
      throw new InvalidAssetInputError(
        `proceeds must be ≥ 0: ${input.proceeds}`,
        { field: "proceeds", value: input.proceeds },
      );
    }
    if (input.kind === "SALE" && compareExact(input.proceeds, "0") <= 0) {
      throw new ScrapProceedsRequiredError(
        'a SALE must carry proceeds > 0 — a zero-proceeds disposal is a SCRAP with an explicit proceeds input of "0"',
        { assetId: input.assetId, kind: input.kind },
      );
    }

    const asset = await store.findAssetById(input.assetId);
    if (asset === undefined) throw new AssetNotFoundError(input.assetId);
    assertDisposable(asset);
    const existing = await store.findAssetDisposalByAsset(input.assetId);
    if (existing !== undefined) {
      throw new DisposedAssetReuseError({
        assetId: input.assetId,
        status: asset.status,
        existingDisposalId: existing.id,
      });
    }

    // Freeze the register side (immutable after post — migration 0037).
    const netBookValue = await store.assetNbv(input.assetId);
    const accumulatedSnapshot = await store.assetAccumulated(input.assetId);
    const gainLoss = subExact(input.proceeds, netBookValue);

    const created = await store.insertAssetDisposal({
      assetId: input.assetId,
      kind: input.kind,
      disposalDate: input.disposalDate,
      proceeds: input.proceeds,
      netBookValue,
      accumulatedSnapshot,
      gainLoss,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "fixed_assets.asset_disposal_drafted",
      entityType: "asset_disposal",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        assetId: input.assetId,
        assetCode: asset.code,
        kind: created.kind,
        disposalDate: created.disposalDate,
        proceeds: created.proceeds,
        netBookValue: created.netBookValue,
        accumulatedSnapshot: created.accumulatedSnapshot,
        gainLoss: created.gainLoss,
      },
    });
    return created;
  }

  /**
   * Approve a disposal (SoD, AUTHORIZATION_MATRIX §4): the approver MUST be
   * a second user — the creator never approves their own disposal
   * (SELF_APPROVAL_BLOCKED backstop behind the controller's
   * `fixed_assets.disposals.approve` permission). Records approved_by/at
   * and audits (audited on use).
   */
  async approve(disposalId: string, approverId: string): Promise<store.AssetDisposalRow> {
    const disposal = await this.find(disposalId);
    if (disposal.status === "POSTED") {
      throw new DisposalStateError(
        `disposal ${disposalId} is POSTED — posted disposals are immutable`,
        { disposalId, status: disposal.status },
      );
    }
    if (disposal.approvedBy !== null) {
      throw new DisposalStateError(
        `disposal ${disposalId} is already approved (by ${disposal.approvedBy}) — awaiting post`,
        { disposalId, approvedBy: disposal.approvedBy },
      );
    }
    // SoD backstop: creator ≠ approver (the treasury expense-approval
    // pattern — a system-created document with createdBy NULL never trips).
    if (disposal.createdBy !== null && disposal.createdBy === approverId) {
      throw new SelfApprovalBlockedError();
    }
    const approved = await store.updateAssetDisposal(disposalId, {
      approvedBy: approverId,
      approvedAt: new Date().toISOString(),
    });
    if (approved === undefined) throw new DisposalNotFoundError(disposalId);
    await this.audit.record({
      action: "fixed_assets.asset_disposal_approved",
      entityType: "asset_disposal",
      entityId: disposalId,
      actorId: approverId,
      after: {
        approvedBy: approverId,
        approvedAt: approved.approvedAt,
        assetId: disposal.assetId,
        kind: disposal.kind,
        proceeds: disposal.proceeds,
        gainLoss: disposal.gainLoss,
      },
    });
    return approved;
  }

  /**
   * Post the disposal (G-23): requires the second-user approval first
   * (DISPOSAL_NOT_APPROVED), assigns the official disposal_no via the
   * numbering service (INV-021; bound to the document), posts the journal
   * with the mandatory loss mirror, and LOCKS the asset (status DISPOSED,
   * disposed_at — INV-023: once, terminal). INV-013-idempotent on
   * (tenant, ASSET_DISPOSAL, disposalId, post); runs inside the caller's
   * ambient tenant UoW (S-04 zero-residue rollback).
   */
  async post(
    disposalId: string,
    actorId: string | null,
  ): Promise<{
    disposal: store.AssetDisposalRow;
    journalEntryId: string;
    disposalNo: string;
    idempotentReplay: boolean;
  }> {
    const disposal = await this.find(disposalId);
    if (disposal.status === "POSTED") {
      throw new DisposalStateError(
        `disposal ${disposalId} is already POSTED (journal ${disposal.journalEntryId ?? "?"}) — posted disposals are immutable; corrections are new-period documents`,
        { disposalId, journalEntryId: disposal.journalEntryId },
      );
    }
    if (disposal.approvedBy === null) {
      throw new DisposalNotApprovedError({ disposalId });
    }

    const asset = await store.findAssetById(disposal.assetId);
    if (asset === undefined) throw new AssetNotFoundError(disposal.assetId);
    // The register gate re-checked at post (a concurrent disposal / status
    // move between approve and post fails closed).
    assertDisposable(asset);
    assertCanTransitionTo(asset.status as AssetStatus, "DISPOSED");

    // BR-041 at every posting boundary (the engine re-checks fail-closed).
    const category = await store.findAssetCategoryById(asset.categoryId);
    if (category === undefined) throw new AssetCategoryNotFoundError(asset.categoryId);
    await assertCategoryUsable(category);

    const lines = computeDisposalLines({
      cashPurposeKey: "CASH",
      assetPurposeKey: category.assetPurposeKey,
      accumDepreciationPurposeKey: category.accumDepreciationPurposeKey,
      cost: asset.cost,
      proceeds: disposal.proceeds,
      accumulatedSnapshot: disposal.accumulatedSnapshot,
      netBookValue: disposal.netBookValue,
    });

    const spec: JournalSpec = {
      source: { docType: "asset_disposal", docId: disposal.id, operation: "post" },
      entryDate: disposal.disposalDate,
      description: {
        en: `Asset disposal ${asset.code} (${disposal.kind === "SALE" ? "sale" : "scrap"})`,
        ar: `استبعاد الأصل ${asset.code} (${disposal.kind === "SALE" ? "بيع" : "كشط"})`,
      },
      currency: await ownTenantBaseCurrency(),
      lines,
    };
    const result = await this.posting.post(spec, { postedBy: actorId });
    if (result.idempotentReplay) {
      // A prior post committed (its UoW carried the number + the lock):
      // replay the stored state, never consume a second number.
      const current = await this.find(disposalId);
      return {
        disposal: current,
        journalEntryId: result.journalEntryId,
        disposalNo: current.disposalNo ?? "",
        idempotentReplay: true,
      };
    }

    // Official number (INV-021): assigned at posting, immutable, bound to
    // the document through the numbering assignment row.
    const year = disposal.disposalDate.slice(0, 4);
    const acquired = await this.numbering.reserve({
      docType: DISPOSAL_NUMBER_FORMAT.docType,
      branchId: null,
      periodKey: year,
      format: DISPOSAL_NUMBER_FORMAT.format,
      prefix: DISPOSAL_NUMBER_FORMAT.prefix,
      year,
    });
    await this.numbering.bind(DISPOSAL_NUMBER_FORMAT.docType, acquired.number, disposal.id);

    const posted = await store.updateAssetDisposal(disposalId, {
      status: "POSTED",
      postedAt: new Date().toISOString(),
      postedBy: actorId,
      journalEntryId: result.journalEntryId,
      disposalNo: acquired.number,
    });
    if (posted === undefined) throw new DisposalNotFoundError(disposalId);

    // THE LOCK (INV-023): the asset leaves the register exactly once —
    // DISPOSED for both SALE and SCRAP (the written-off-at column stays
    // NULL; the disposal document's kind + proceeds are the audit trail).
    const locked = await store.updateAsset(disposal.assetId, {
      status: "DISPOSED",
      disposedAt: new Date().toISOString(),
    });
    if (locked === undefined) throw new AssetNotFoundError(disposal.assetId);

    await this.audit.record({
      action: "fixed_assets.asset_disposal_posted",
      entityType: "asset_disposal",
      entityId: disposalId,
      actorId: actorId ?? undefined,
      before: { status: "DRAFT" },
      after: {
        status: "POSTED",
        disposalNo: acquired.number,
        assetId: disposal.assetId,
        assetCode: asset.code,
        kind: disposal.kind,
        proceeds: disposal.proceeds,
        netBookValue: disposal.netBookValue,
        accumulatedSnapshot: disposal.accumulatedSnapshot,
        gainLoss: disposal.gainLoss,
        journalEntryId: result.journalEntryId,
        assetStatusAfter: locked.status,
      },
    });
    return {
      disposal: posted,
      journalEntryId: result.journalEntryId,
      disposalNo: acquired.number,
      idempotentReplay: false,
    };
  }
}
