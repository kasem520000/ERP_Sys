import { Inject, Injectable } from "@nestjs/common";

import { AuditService } from "../../audit/api/audit";
import { findActivePurpose } from "../../accounting/infrastructure/accounting.store";
import * as store from "../infrastructure/fixed-assets.store";
import {
  AssetCategoryCodeConflictError,
  AssetCategoryNotFoundError,
  CategoryNotUsableError,
  InvalidAssetInputError,
} from "../domain/fixed-assets-errors";

/**
 * Asset-category service (PHASE-026 T2; DR-002 §1; BR-041): categories bind
 * the three posting purposes (asset / accumulated-depreciation / depreciation-
 * expense) onto the tenant's CoA BEFORE any asset may post. A category whose
 * purposes do not all resolve to ACTIVE accounts is created fine (tenants may
 * stage categories before mapping) but is UNUSABLE: {@link assertCategoryUsable}
 * blocks asset creation and every G-21/G-22/G-23 posting (fail-closed,
 * CHART_OF_ACCOUNTS §2). Deactivation is allowed; deletion is NOT offered
 * (INV-015 — no delete function exists). Every create/update is audited.
 *
 * In-use policy (documented contract): once a category has assets, the
 * useful-life and depreciation-method DEFAULTS may still change — defaults
 * apply to NEW assets only; live assets keep their frozen columns (assets
 * are immutable on those fields — see asset-service). Purpose keys may also
 * change on an in-use category, but ONLY when the new effective key set
 * fully resolves (BR-041 on update — a live category must never be steered
 * onto an unmapped purpose).
 */

/** DATA_DICTIONARY §9: the exhaustive method enum (DR-002 §5). */
export const DEPRECIATION_METHODS = [
  "STRAIGHT_LINE",
  "DECLINING_BALANCE",
  "UNITS_OF_PRODUCTION",
] as const;
export type DepreciationMethod = (typeof DEPRECIATION_METHODS)[number];

/** Purpose-key shape (migration 0037 ck_asset_categories_purpose_shape). */
export const PURPOSE_KEY_RE = /^[A-Z][A-Z0-9_]{2,40}$/;

export const MIN_LIFE_MONTHS = 1;
export const MAX_LIFE_MONTHS = 1200;

function assertMethod(value: string, field: string): asserts value is DepreciationMethod {
  if (!(DEPRECIATION_METHODS as readonly string[]).includes(value)) {
    throw new InvalidAssetInputError(
      `${field} must be one of ${DEPRECIATION_METHODS.join(" | ")} (DATA_DICTIONARY §9 — the enum is exhaustive)`,
      { field, value },
    );
  }
}

function assertLifeMonths(value: number, field: string): void {
  if (!Number.isInteger(value) || value < MIN_LIFE_MONTHS || value > MAX_LIFE_MONTHS) {
    throw new InvalidAssetInputError(
      `${field} must be an integer between ${MIN_LIFE_MONTHS} and ${MAX_LIFE_MONTHS} months`,
      { field, value },
    );
  }
}

function assertPurposeKeyShape(value: string, field: string): void {
  if (!PURPOSE_KEY_RE.test(value)) {
    throw new InvalidAssetInputError(
      `${field} must match ${String(PURPOSE_KEY_RE)} (purpose-key shape, migration 0037)`,
      { field, value },
    );
  }
}

function assertBilingualName(value: string, field: string): void {
  if (value.trim() === "") {
    throw new InvalidAssetInputError(`${field} is required (§3 bilingual rules — both names)`, {
      field,
    });
  }
}

/**
 * BR-041 check (exported — the module's shared gate): every one of the
 * category's three purpose keys must resolve to an ACTIVE account via the
 * purpose-mapping read model (account_purposes with active_to IS NULL).
 * Any missing key → {@link CategoryNotUsableError} naming ALL missing keys
 * (bilingual). Used by the asset service (first asset use), the
 * capitalization service (every G-21 posting), the purchasing hook, and the
 * P26-B/C services (runs/revaluations/disposals) — the engine re-checks at
 * account resolution, so a race between check and post still fails closed
 * (PURPOSE_NOT_MAPPED).
 */
export async function assertCategoryUsable(category: store.AssetCategoryRow): Promise<void> {
  const keys = [
    category.assetPurposeKey,
    category.accumDepreciationPurposeKey,
    category.expensePurposeKey,
  ];
  const missing: string[] = [];
  for (const key of keys) {
    const mapping = await findActivePurpose(key);
    if (mapping === undefined) missing.push(key);
  }
  if (missing.length > 0) {
    throw new CategoryNotUsableError({ code: category.code, missingPurposeKeys: missing });
  }
}

/** Pure variant for callers that only need the verdict (no throw). */
export async function categoryMissingPurposes(
  category: Pick<
    store.AssetCategoryRow,
    "assetPurposeKey" | "accumDepreciationPurposeKey" | "expensePurposeKey"
  >,
): Promise<string[]> {
  const missing: string[] = [];
  for (const key of [
    category.assetPurposeKey,
    category.accumDepreciationPurposeKey,
    category.expensePurposeKey,
  ]) {
    if ((await findActivePurpose(key)) === undefined) missing.push(key);
  }
  return missing;
}

export interface CategoryInput {
  code: string;
  name: string;
  nameAr: string;
  usefulLifeMonthsDefault: number;
  depreciationMethodDefault: string;
  assetPurposeKey: string;
  accumDepreciationPurposeKey: string;
  expensePurposeKey: string;
  note?: string | null;
  noteAr?: string | null;
  actorId: string | null;
}

@Injectable()
export class CategoryService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async list(filter: { activeOnly?: boolean }): Promise<store.AssetCategoryRow[]> {
    return store.listAssetCategories(filter);
  }

  async find(id: string): Promise<store.AssetCategoryRow> {
    const category = await store.findAssetCategoryById(id);
    if (category === undefined) throw new AssetCategoryNotFoundError(id);
    return category;
  }

  async create(input: CategoryInput): Promise<store.AssetCategoryRow> {
    const code = input.code.trim();
    if (code === "") {
      throw new InvalidAssetInputError("category code is required (tenant-scoped natural key, ADR-0006)");
    }
    assertBilingualName(input.name, "name");
    assertBilingualName(input.nameAr, "nameAr");
    assertLifeMonths(input.usefulLifeMonthsDefault, "usefulLifeMonthsDefault");
    assertMethod(input.depreciationMethodDefault, "depreciationMethodDefault");
    assertPurposeKeyShape(input.assetPurposeKey, "assetPurposeKey");
    assertPurposeKeyShape(input.accumDepreciationPurposeKey, "accumDepreciationPurposeKey");
    assertPurposeKeyShape(input.expensePurposeKey, "expensePurposeKey");

    const existing = await store.findAssetCategoryByCode(code);
    if (existing !== undefined) {
      throw new AssetCategoryCodeConflictError({ code, existingId: existing.id });
    }

    const created = await store.insertAssetCategory({
      code,
      name: input.name.trim(),
      nameAr: input.nameAr.trim(),
      usefulLifeMonthsDefault: input.usefulLifeMonthsDefault,
      depreciationMethodDefault: input.depreciationMethodDefault,
      assetPurposeKey: input.assetPurposeKey,
      accumDepreciationPurposeKey: input.accumDepreciationPurposeKey,
      expensePurposeKey: input.expensePurposeKey,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "fixed_assets.asset_category_created",
      entityType: "asset_category",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        code: created.code,
        usefulLifeMonthsDefault: created.usefulLifeMonthsDefault,
        depreciationMethodDefault: created.depreciationMethodDefault,
        assetPurposeKey: created.assetPurposeKey,
        accumDepreciationPurposeKey: created.accumDepreciationPurposeKey,
        expensePurposeKey: created.expensePurposeKey,
      },
    });
    return created;
  }

  /**
   * Update (PATCH semantics; `code` is immutable — the store takes no code
   * patch, by design). BR-041 on update: when the category is IN USE (has
   * assets) and any purpose key changes, the new effective key set must
   * fully resolve — a live category never steers onto an unmapped purpose.
   * Defaults (life/method) may always change: they affect NEW assets only;
   * live assets keep their frozen columns (asset-service immutability).
   * `active: false` deactivates (blocks NEW asset registration only — the
   * register + postings of existing assets continue); deletion is NOT
   * offered anywhere (INV-015).
   */
  async update(
    id: string,
    patch: {
      name?: string;
      nameAr?: string;
      usefulLifeMonthsDefault?: number;
      depreciationMethodDefault?: string;
      assetPurposeKey?: string;
      accumDepreciationPurposeKey?: string;
      expensePurposeKey?: string;
      active?: boolean;
      note?: string | null;
      noteAr?: string | null;
    },
    actorId: string | null,
  ): Promise<store.AssetCategoryRow> {
    const current = await this.find(id);
    if (patch.name !== undefined) assertBilingualName(patch.name, "name");
    if (patch.nameAr !== undefined) assertBilingualName(patch.nameAr, "nameAr");
    if (patch.usefulLifeMonthsDefault !== undefined) {
      assertLifeMonths(patch.usefulLifeMonthsDefault, "usefulLifeMonthsDefault");
    }
    if (patch.depreciationMethodDefault !== undefined) {
      assertMethod(patch.depreciationMethodDefault, "depreciationMethodDefault");
    }
    if (patch.assetPurposeKey !== undefined) {
      assertPurposeKeyShape(patch.assetPurposeKey, "assetPurposeKey");
    }
    if (patch.accumDepreciationPurposeKey !== undefined) {
      assertPurposeKeyShape(patch.accumDepreciationPurposeKey, "accumDepreciationPurposeKey");
    }
    if (patch.expensePurposeKey !== undefined) {
      assertPurposeKeyShape(patch.expensePurposeKey, "expensePurposeKey");
    }

    const purposeKeysChange =
      (patch.assetPurposeKey !== undefined && patch.assetPurposeKey !== current.assetPurposeKey) ||
      (patch.accumDepreciationPurposeKey !== undefined &&
        patch.accumDepreciationPurposeKey !== current.accumDepreciationPurposeKey) ||
      (patch.expensePurposeKey !== undefined && patch.expensePurposeKey !== current.expensePurposeKey);

    if (purposeKeysChange) {
      const inUse = (await store.countAssetsByCategory(id)) > 0;
      if (inUse) {
        // BR-041 on update: the NEXT effective key set must fully resolve.
        const next = {
          assetPurposeKey: patch.assetPurposeKey ?? current.assetPurposeKey,
          accumDepreciationPurposeKey:
            patch.accumDepreciationPurposeKey ?? current.accumDepreciationPurposeKey,
          expensePurposeKey: patch.expensePurposeKey ?? current.expensePurposeKey,
        };
        const missing: string[] = [];
        for (const key of [
          next.assetPurposeKey,
          next.accumDepreciationPurposeKey,
          next.expensePurposeKey,
        ]) {
          if ((await findActivePurpose(key)) === undefined) missing.push(key);
        }
        if (missing.length > 0) {
          throw new CategoryNotUsableError({ code: current.code, missingPurposeKeys: missing });
        }
      }
    }

    const updated = await store.updateAssetCategory(id, {
      name: patch.name !== undefined ? patch.name.trim() : undefined,
      nameAr: patch.nameAr !== undefined ? patch.nameAr.trim() : undefined,
      usefulLifeMonthsDefault: patch.usefulLifeMonthsDefault,
      depreciationMethodDefault: patch.depreciationMethodDefault,
      assetPurposeKey: patch.assetPurposeKey,
      accumDepreciationPurposeKey: patch.accumDepreciationPurposeKey,
      expensePurposeKey: patch.expensePurposeKey,
      active: patch.active,
      note: patch.note,
      noteAr: patch.noteAr,
    });
    if (updated === undefined) throw new AssetCategoryNotFoundError(id);
    await this.audit.record({
      action: "fixed_assets.asset_category_updated",
      entityType: "asset_category",
      entityId: id,
      actorId: actorId ?? undefined,
      before: {
        name: current.name,
        nameAr: current.nameAr,
        usefulLifeMonthsDefault: current.usefulLifeMonthsDefault,
        depreciationMethodDefault: current.depreciationMethodDefault,
        assetPurposeKey: current.assetPurposeKey,
        accumDepreciationPurposeKey: current.accumDepreciationPurposeKey,
        expensePurposeKey: current.expensePurposeKey,
        active: current.active,
      },
      after: {
        name: updated.name,
        nameAr: updated.nameAr,
        usefulLifeMonthsDefault: updated.usefulLifeMonthsDefault,
        depreciationMethodDefault: updated.depreciationMethodDefault,
        assetPurposeKey: updated.assetPurposeKey,
        accumDepreciationPurposeKey: updated.accumDepreciationPurposeKey,
        expensePurposeKey: updated.expensePurposeKey,
        active: updated.active,
      },
    });
    return updated;
  }
}
