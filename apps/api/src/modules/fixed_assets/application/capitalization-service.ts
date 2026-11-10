import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { PostingService } from "../../accounting/application/posting-service";
import { ownTenantBaseCurrency } from "../../../infra/settings/setting-reader";
import type { JournalLineSpec, JournalSpec } from "../../accounting/domain/posting-engine/journal-spec";
import { findPartnerById } from "../../partners/infrastructure/partners.store";
import * as store from "../infrastructure/fixed-assets.store";
import { assertCategoryUsable, PURPOSE_KEY_RE } from "./category-service";
import {
  AlreadyCapitalizedError,
  AssetCategoryNotFoundError,
  AssetNotFoundError,
  AssetStatusError,
  CapitalizationError,
  InvalidAssetInputError,
  PartnerNotFoundError,
} from "../domain/fixed-assets-errors";

/**
 * Direct-capitalization service (PHASE-026 T4; golden G-21; POSTING_ENGINE
 * §4.1 source `FIXED_ASSET_CAPITALIZATION` operation `post`): posts the
 * acquisition journal for an existing register asset, then binds the
 * capitalization source onto the asset. ONE journal per asset — INV-013
 * idempotency keys on (tenant, FIXED_ASSET_CAPITALIZATION, assetId, post),
 * so a retried call replays the stored entry instead of double-posting.
 *
 * Journal shapes (G-21, register §F — lines are purpose-keyed; the engine
 * resolves them fail-closed PURPOSE_NOT_MAPPED, re-checking BR-041 after
 * this service's own pre-check):
 *
 * - CREDIT — `DR FIXED_ASSET (category.asset_purpose_key) cost · CR
 *   AP_CONTROL (partnerId) cost` — the credit line CARRIES partnerId
 *   (INV-009: the AP subledger row is written by the engine's partner
 *   port in the same transaction).
 * - CASH — `DR FIXED_ASSET cost · CR CASH cost` (purpose CASH — the
 *   tenant's active cash mapping; fail-closed when unmapped).
 * - OPENING (onboarding existing assets) — the funding leg plus the
 *   accumulated-to-date leg, ONE balanced journal:
 *     DR FIXED_ASSET cost                        (funding debit)
 *     DR OPENING_EQUITY opening_accumulated      (accumulated-to-date debit)
 *     CR ACCUM_DEPRECIATION opening_accumulated  (category contra account)
 *     CR OPENING_EQUITY cost                     (funding credit)
 *   Net effect: FIXED_ASSET +cost, ACCUM_DEPRECIATION +accum,
 *   OPENING_EQUITY net (cost − accum) — future runs resume from the true
 *   NBV (INV-023 from day one; PHASE-007 opening-balances discipline).
 *   When opening_accumulated = 0 the journal is the plain 2-line funding
 *   pair (the accum leg is omitted, never a zero line). The opening-equity
 *   purpose defaults to OPENING_EQUITY and may be overridden per call for
 *   tenants that map a dedicated opening account.
 *
 * The asset stays ACTIVE (it is born ACTIVE at registration); source_type
 * becomes FIXED_ASSET_CAPITALIZATION with source_id = journalEntryId.
 * Corrections are engine reversal (INV-014) — never a second capitalization.
 */

/** G-21 funding discriminator (input shape). */
export type CapitalizationFunding =
  | { kind: "CREDIT"; partnerId: string }
  | { kind: "CASH" }
  | { kind: "OPENING"; openingEquityPurposeKey?: string };

export interface CapitalizeInput {
  assetId: string;
  funding: CapitalizationFunding;
  /** ISO date — must fall in an OPEN fiscal period (INV-011). */
  postingDate: string;
  description?: string | null;
  actorId: string | null;
}

export interface CapitalizeResult {
  asset: store.AssetRow;
  journalEntryId: string;
  idempotentReplay: boolean;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Credit-funding partner gate (A7): exists + supplier-capable + ACTIVE. */
async function requireCreditPartner(partnerId: string): Promise<void> {
  const partner = await findPartnerById(partnerId);
  if (partner === undefined) throw new PartnerNotFoundError(partnerId);
  if (partner.kind !== "SUPPLIER" && partner.kind !== "BOTH") {
    throw new CapitalizationError(
      `partner ${partnerId} (${partner.code}) is kind ${partner.kind} — credit capitalization books AP_CONTROL, so the partner must be supplier-capable (kind SUPPLIER or BOTH)`,
      { partnerId, kind: partner.kind },
    );
  }
  if (partner.status !== "ACTIVE") {
    throw new CapitalizationError(
      `partner ${partnerId} (${partner.code}) is ${partner.status} — credit capitalization requires an ACTIVE supplier`,
      { partnerId, status: partner.status },
    );
  }
}

@Injectable()
export class CapitalizationService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly posting: PostingService,
  ) {}

  /**
   * Capitalize an asset (G-21). Runs inside the caller's ambient tenant
   * UoW (the HTTP interceptor's transaction) — an engine rejection rolls
   * back with zero residue (S-04).
   */
  async capitalize(input: CapitalizeInput): Promise<CapitalizeResult> {
    if (!DATE_RE.test(input.postingDate)) {
      throw new InvalidAssetInputError(
        `postingDate must be an ISO date (yyyy-mm-dd): ${input.postingDate}`,
        { postingDate: input.postingDate },
      );
    }

    const asset = await store.findAssetById(input.assetId);
    if (asset === undefined) throw new AssetNotFoundError(input.assetId);
    if (asset.sourceType !== null) {
      throw new AlreadyCapitalizedError({
        assetId: asset.id,
        sourceType: asset.sourceType,
        sourceId: asset.sourceId,
      });
    }

    // Status gate: capitalization posts only on a live asset — DISPOSED and
    // WRITTEN_OFF are terminal (INV-023); FULLY_DEPRECIATED assets have
    // already absorbed their funding + depreciation history.
    if (asset.status !== "ACTIVE") {
      throw new AssetStatusError(
        `asset ${asset.id} is ${asset.status} — capitalization posts only on ACTIVE assets (INV-023: disposal/write-off are terminal)`,
        { assetId: asset.id, status: asset.status },
      );
    }

    // BR-041 at every posting boundary (A7 typed 404 on the category).
    const category = await store.findAssetCategoryById(asset.categoryId);
    if (category === undefined) throw new AssetCategoryNotFoundError(asset.categoryId);
    await assertCategoryUsable(category);

    const cost = new Decimal(asset.cost).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
    if (new Decimal(cost).lte(0)) {
      throw new CapitalizationError(
        `asset ${asset.id} carries zero cost — nothing to capitalize (journal lines must be > 0)`,
        { assetId: asset.id, cost },
      );
    }

    const base = await ownTenantBaseCurrency();
    const memo = {
      en: input.description ?? `Asset capitalization ${asset.code}`,
      ar: `رسملة أصل ثابت ${asset.code}`,
    };

    const lines: JournalLineSpec[] = [];
    if (input.funding.kind === "CREDIT") {
      await requireCreditPartner(input.funding.partnerId);
      // DR FIXED_ASSET (category account) · CR AP_CONTROL (partner) — INV-009.
      lines.push(
        { purpose: category.assetPurposeKey, direction: "DEBIT", amount: cost, memo },
        {
          purpose: "AP_CONTROL",
          direction: "CREDIT",
          amount: cost,
          partnerId: input.funding.partnerId,
          memo,
        },
      );
    } else if (input.funding.kind === "CASH") {
      // DR FIXED_ASSET · CR CASH (active cash mapping, fail-closed).
      lines.push(
        { purpose: category.assetPurposeKey, direction: "DEBIT", amount: cost, memo },
        { purpose: "CASH", direction: "CREDIT", amount: cost, memo },
      );
    } else if (input.funding.kind === "OPENING") {
      const equityPurpose =
        input.funding.openingEquityPurposeKey !== undefined &&
        input.funding.openingEquityPurposeKey !== ""
          ? input.funding.openingEquityPurposeKey
          : "OPENING_EQUITY";
      if (!PURPOSE_KEY_RE.test(equityPurpose)) {
        throw new InvalidAssetInputError(
          `openingEquityPurposeKey must match ${String(PURPOSE_KEY_RE)}: ${equityPurpose}`,
          { openingEquityPurposeKey: equityPurpose },
        );
      }
      const openingAccumulated = new Decimal(asset.openingAccumulated)
        .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
        .toFixed(4);
      // Funding leg: DR FIXED_ASSET cost · CR OPENING_EQUITY cost.
      lines.push(
        { purpose: category.assetPurposeKey, direction: "DEBIT", amount: cost, memo },
        { purpose: equityPurpose, direction: "CREDIT", amount: cost, memo },
      );
      // Accumulated-to-date leg (only when > 0 — never a zero journal line):
      // DR OPENING_EQUITY accum · CR ACCUM_DEPRECIATION accum (category key).
      if (new Decimal(openingAccumulated).gt(0)) {
        lines.push(
          { purpose: equityPurpose, direction: "DEBIT", amount: openingAccumulated, memo },
          {
            purpose: category.accumDepreciationPurposeKey,
            direction: "CREDIT",
            amount: openingAccumulated,
            memo,
          },
        );
      }
    } else {
      throw new CapitalizationError(
        `funding kind ${(input.funding as { kind: string }).kind} is unknown — expected CREDIT | CASH | OPENING`,
        { funding: input.funding },
      );
    }

    const spec: JournalSpec = {
      source: { docType: "fixed_asset_capitalization", docId: asset.id, operation: "post" },
      entryDate: input.postingDate,
      description: {
        en: input.description ?? `Fixed-asset capitalization ${asset.code} (${input.funding.kind})`,
        ar: `رسملة أصل ثابت ${asset.code} (${
          input.funding.kind === "CREDIT"
            ? "على الحساب"
            : input.funding.kind === "CASH"
              ? "نقداً"
              : "رصيد افتتاحي"
        })`,
      },
      currency: base,
      lines,
    };
    const result = await this.posting.post(spec, { postedBy: input.actorId });

    // Bind the source (idempotent on replay — the UPDATE is a no-op then).
    const bound = await store.updateAsset(asset.id, {
      sourceType: "fixed_asset_capitalization",
      sourceId: result.journalEntryId,
    });
    if (bound === undefined) throw new AssetNotFoundError(asset.id);

    if (!result.idempotentReplay) {
      await this.audit.record({
        action: "fixed_assets.asset_capitalized",
        entityType: "asset",
        entityId: asset.id,
        actorId: input.actorId ?? undefined,
        after: {
          code: asset.code,
          funding: input.funding.kind,
          partnerId: input.funding.kind === "CREDIT" ? input.funding.partnerId : null,
          cost,
          openingAccumulated:
            input.funding.kind === "OPENING" ? asset.openingAccumulated : "0.0000",
          journalEntryId: result.journalEntryId,
          postingDate: input.postingDate,
        },
      });
    }
    return { asset: bound, journalEntryId: result.journalEntryId, idempotentReplay: result.idempotentReplay };
  }
}
