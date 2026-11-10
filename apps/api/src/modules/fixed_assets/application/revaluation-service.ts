import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import type { JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { compareExact, subExact } from "../../accounting/application/decimal-strings";
import * as store from "../infrastructure/fixed-assets.store";
import { assertCategoryUsable } from "./category-service";
import {
  computeRevaluationLines,
  revaluationDelta,
} from "./current-basis";
import {
  AssetCategoryNotFoundError,
  AssetNotFoundError,
  AssetStatusError,
  InvalidAssetInputError,
} from "../domain/fixed-assets-errors";
import {
  LifecycleInputInvalidError,
  LiveDraftConflictError,
  RevaluationNotFoundError,
  RevaluationNotPostableError,
} from "./lifecycle-errors";

/**
 * Revaluation service (PHASE-026 T8; BR-044; POSTING_ENGINE §4.1 source
 * `ASSET_REVALUATION` operation `post`): optional, AUDITED revaluations that
 * restate an asset's basis and post the NBV delta to `REVALUATION_RESERVE`
 * — never through P&L. DRAFT → POSTED with a mandatory reason (1..500,
 * migration 0037 parity), one live DRAFT per asset, revaluation on a
 * DISPOSED/WRITTEN_OFF asset rejected (INV-023 terminal states).
 *
 * Journal (the three-way mirror, both directions golden-tested in
 * disposal-math.spec.ts via the pure builder {@link computeRevaluationLines}):
 *
 *   delta > 0:  DR FIXED_ASSET (newGross − cost)
 *               · DR/CR ACCUM_DEPRECIATION (|oldAccum − newAccum|)
 *               · CR REVALUATION_RESERVE delta
 *   delta < 0:  CR FIXED_ASSET (cost − newGross)
 *               · DR/CR ACCUM_DEPRECIATION (|oldAccum − newAccum|)
 *               · DR REVALUATION_RESERVE −delta
 *   delta = 0:  the two mirror legs alone (a pure reclass; the reserve line
 *               is skipped — never a zero line).
 *
 * The algebra is balanced BY CONSTRUCTION (see current-basis.ts):
 * g = newGross − cost, r = newAccum − oldAccum, delta = g − r ⇒ g = r + delta.
 *
 * FROZEN-DELTA CONTRACT: `delta` is computed once at DRAFT creation from the
 * then-live NBV (store.assetNbv) and never rewritten (the store exposes no
 * delta patch). At POST the journal derives the old side from the frozen
 * delta (oldAccum = newAccum − (g − delta)), so the stored row and the
 * posted journal agree by construction and RC-10 reconstructs the same
 * restatement from source rows. If a depreciation run lands between DRAFT
 * and POST the delta stays the draft-time figure — documented limitation
 * (the recommended operator flow is draft-and-post in one sitting; a refresh
 * needs a store delta-patch, an orchestrator follow-up).
 *
 * Subsequent depreciation runs use the revalued basis: P26-B consumes
 * {@link currentBasis} (current-basis.ts — the wiring point recorded in the
 * P26-C report).
 *
 * Permissions: `fixed_assets.revaluations.create` (draft) and
 * `fixed_assets.revaluations.post` (owner-only per AUTHORIZATION_MATRIX
 * §3.11) are enforced at the controller (P26-A's fixed-assets controller);
 * this service takes the acting userId for the audit trail.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONEY_RE = /^\d+(\.\d{1,4})?$/;

/** Terminal register states — revaluation is a live-asset document (INV-023). */
function assertRevaluable(asset: store.AssetRow): void {
  if (asset.status === "DISPOSED" || asset.status === "WRITTEN_OFF") {
    throw new AssetStatusError(
      `asset ${asset.id} is ${asset.status} — revaluation posts only on live assets (ACTIVE/FULLY_DEPRECIATED); DISPOSED/WRITTEN_OFF are terminal (INV-023)`,
      { assetId: asset.id, status: asset.status },
    );
  }
}

export interface CreateRevaluationInput {
  assetId: string;
  /** ISO date — must fall in an OPEN fiscal period (INV-011, engine-checked). */
  revaluationDate: string;
  newGrossValue: string;
  newAccumulated: string;
  /** Mandatory (BR-044 audited): 1..500 chars. */
  reason: string;
  actorId: string | null;
}

@Injectable()
export class RevaluationService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
  ) {}

  async find(id: string): Promise<store.AssetRevaluationRow> {
    const row = await store.findAssetRevaluationById(id);
    if (row === undefined) throw new RevaluationNotFoundError(id);
    return row;
  }

  async listByAsset(assetId: string): Promise<store.AssetRevaluationRow[]> {
    const asset = await store.findAssetById(assetId);
    if (asset === undefined) throw new AssetNotFoundError(assetId);
    return store.listAssetRevaluationsByAsset(assetId);
  }

  /**
   * Draft a revaluation: validates the new basis (migration 0037
   * ck_asset_revaluations_basis parity — newGross > 0, newAccum ≥ 0,
   * newGross − newAccum ≥ 0), enforces one-live-DRAFT-per-asset, freezes
   * delta = (newGross − newAccum) − live NBV, and audits the draft (BR-044).
   */
  async createDraft(input: CreateRevaluationInput): Promise<store.AssetRevaluationRow> {
    if (!DATE_RE.test(input.revaluationDate)) {
      throw new LifecycleInputInvalidError(
        `revaluationDate must be an ISO date (yyyy-mm-dd): ${input.revaluationDate}`,
        { revaluationDate: input.revaluationDate },
      );
    }
    if (!MONEY_RE.test(input.newGrossValue)) {
      throw new InvalidAssetInputError(
        `newGrossValue must be a positive decimal string with ≤ 4 decimals (ADR-0009): ${input.newGrossValue}`,
        { field: "newGrossValue", value: input.newGrossValue },
      );
    }
    if (!MONEY_RE.test(input.newAccumulated)) {
      throw new InvalidAssetInputError(
        `newAccumulated must be a non-negative decimal string with ≤ 4 decimals (ADR-0009): ${input.newAccumulated}`,
        { field: "newAccumulated", value: input.newAccumulated },
      );
    }
    const reason = input.reason.trim();
    if (reason === "" || reason.length > 500) {
      throw new LifecycleInputInvalidError(
        "reason is mandatory and must be 1..500 characters (BR-044 audited revaluation)",
        { reasonLength: reason.length },
      );
    }
    // Basis validity (ck_asset_revaluations_basis parity, service-side for
    // the typed failure pack).
    if (compareExact(input.newGrossValue, "0") <= 0) {
      throw new LifecycleInputInvalidError(
        `newGrossValue must be > 0 (revaluation basis): ${input.newGrossValue}`,
        { newGrossValue: input.newGrossValue },
      );
    }
    if (compareExact(input.newAccumulated, "0") < 0) {
      throw new LifecycleInputInvalidError(
        `newAccumulated must be ≥ 0: ${input.newAccumulated}`,
        { newAccumulated: input.newAccumulated },
      );
    }
    const newBasisNbv = subExact(input.newGrossValue, input.newAccumulated);
    if (compareExact(newBasisNbv, "0") < 0) {
      throw new LifecycleInputInvalidError(
        `the restated basis is negative — newGrossValue ${input.newGrossValue} − newAccumulated ${input.newAccumulated} = ${newBasisNbv} < 0`,
        { newGrossValue: input.newGrossValue, newAccumulated: input.newAccumulated },
      );
    }

    const asset = await store.findAssetById(input.assetId);
    if (asset === undefined) throw new AssetNotFoundError(input.assetId);
    assertRevaluable(asset);

    const liveDraft = await store.findLiveDraftRevaluation(input.assetId);
    if (liveDraft !== undefined) {
      throw new LiveDraftConflictError({ assetId: input.assetId, draftId: liveDraft.id });
    }

    // Freeze the delta against the live NBV read model (cost − accumulated).
    const currentNbv = await store.assetNbv(input.assetId);
    const delta = revaluationDelta(input.newGrossValue, input.newAccumulated, currentNbv);

    const created = await store.insertAssetRevaluation({
      assetId: input.assetId,
      revaluationDate: input.revaluationDate,
      newGrossValue: input.newGrossValue,
      newAccumulated: input.newAccumulated,
      delta,
      reason,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "fixed_assets.asset_revaluation_drafted",
      entityType: "asset_revaluation",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        assetId: input.assetId,
        assetCode: asset.code,
        revaluationDate: input.revaluationDate,
        newGrossValue: created.newGrossValue,
        newAccumulated: created.newAccumulated,
        delta: created.delta,
        reason,
        basisNbv: currentNbv,
      },
    });
    return created;
  }

  /**
   * Post the revaluation (BR-044): one engine journal
   * (`ASSET_REVALUATION:{revaluationId}:post`, INV-013-idempotent), the
   * status DRAFT → POSTED, the journal entry bound, and the audit event.
   * Runs inside the caller's ambient tenant UoW — an engine rejection rolls
   * back with zero residue (S-04).
   */
  async post(
    revaluationId: string,
    actorId: string | null,
  ): Promise<{ revaluation: store.AssetRevaluationRow; journalEntryId: string; idempotentReplay: boolean }> {
    const revaluation = await this.find(revaluationId);
    if (revaluation.status !== "DRAFT") {
      throw new RevaluationNotPostableError(
        `revaluation ${revaluationId} is ${revaluation.status} — only DRAFT revaluations post`,
        { revaluationId, status: revaluation.status },
      );
    }

    const asset = await store.findAssetById(revaluation.assetId);
    if (asset === undefined) throw new AssetNotFoundError(revaluation.assetId);
    // The asset may have left the register after this draft was created —
    // INV-023 terminal states reject the post.
    assertRevaluable(asset);

    // BR-041 at every posting boundary (the engine re-checks fail-closed).
    const category = await store.findAssetCategoryById(asset.categoryId);
    if (category === undefined) throw new AssetCategoryNotFoundError(asset.categoryId);
    await assertCategoryUsable(category);

    const lines = computeRevaluationLines({
      assetPurposeKey: category.assetPurposeKey,
      accumDepreciationPurposeKey: category.accumDepreciationPurposeKey,
      reservePurposeKey: "REVALUATION_RESERVE",
      cost: asset.cost,
      newGrossValue: revaluation.newGrossValue,
      newAccumulated: revaluation.newAccumulated,
      delta: revaluation.delta,
    });
    if (lines.length === 0) {
      throw new RevaluationNotPostableError(
        `revaluation ${revaluationId} restates nothing — the new basis equals the current basis on every leg (gross, accumulated, NBV)`,
        { revaluationId, newGrossValue: revaluation.newGrossValue, newAccumulated: revaluation.newAccumulated },
      );
    }

    const spec: JournalSpec = {
      source: { docType: "asset_revaluation", docId: revaluation.id, operation: "post" },
      entryDate: revaluation.revaluationDate,
      description: {
        en: `Asset revaluation ${asset.code}: ${revaluation.reason}`,
        ar: `إعادة تقييم الأصل ${asset.code}: ${revaluation.reason}`,
      },
      currency: await ownTenantBaseCurrency(),
      lines,
    };
    const result = await this.posting.post(spec, { postedBy: actorId });
    if (result.idempotentReplay) {
      // The stored entry is the truth (a prior post committed): return the
      // current row state — the UPDATE below would be a no-op.
      const current = await this.find(revaluationId);
      return { revaluation: current, journalEntryId: result.journalEntryId, idempotentReplay: true };
    }

    const posted = await store.updateAssetRevaluation(revaluationId, {
      status: "POSTED",
      postedAt: new Date().toISOString(),
      postedBy: actorId,
      journalEntryId: result.journalEntryId,
    });
    if (posted === undefined) throw new RevaluationNotFoundError(revaluationId);
    await this.audit.record({
      action: "fixed_assets.asset_revaluation_posted",
      entityType: "asset_revaluation",
      entityId: revaluationId,
      actorId: actorId ?? undefined,
      before: { status: "DRAFT" },
      after: {
        status: "POSTED",
        assetId: asset.id,
        assetCode: asset.code,
        delta: revaluation.delta,
        newGrossValue: revaluation.newGrossValue,
        newAccumulated: revaluation.newAccumulated,
        journalEntryId: result.journalEntryId,
        reason: revaluation.reason,
      },
    });
    return { revaluation: posted, journalEntryId: result.journalEntryId, idempotentReplay: false };
  }
}
