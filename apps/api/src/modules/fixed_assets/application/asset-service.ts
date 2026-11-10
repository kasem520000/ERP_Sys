import { Inject, Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import { requireTenantContext } from "../../../infra/db/tenant-context";
import { findBranchById } from "../../tenancy/infrastructure/tenancy.store";
import { findMembershipForUserInTenant } from "../../identity/api/identity";
import * as store from "../infrastructure/fixed-assets.store";
import {
  assertCategoryUsable,
  DEPRECIATION_METHODS,
  MAX_LIFE_MONTHS,
  MIN_LIFE_MONTHS,
} from "./category-service";
import {
  AssetCategoryNotFoundError,
  AssetCodeConflictError,
  AssetNotFoundError,
  AssetStatusError,
  BranchNotFoundError,
  InvalidAssetInputError,
  UserNotFoundError,
} from "../domain/fixed-assets-errors";

/**
 * Asset-register service (PHASE-026 T3; DR-002 option A): the register of
 * record for `assets`. Creation enforces BR-041 (the category must EXIST,
 * be ACTIVE, and have all three purposes resolvable), tenant-scoped code
 * uniqueness, the money shape (cost ≥ 0, salvage ≤ cost,
 * opening_accumulated ≤ cost − salvage — INV-023 preconditions), the
 * 1..1200-month life window, and UoP's total_estimated_units requirement.
 *
 * IMMUTABILITY CONTRACT (documented, service-enforced): after creation the
 * economic columns — cost, salvage_value, opening_accumulated,
 * useful_life_months, depreciation_method, total_estimated_units,
 * acquisition_date, category_id — NEVER change through edits. Corrections
 * to book value are revaluation territory (BR-044); leaving the register is
 * disposal territory (G-23); both are separate posted documents with their
 * own approval + audit. `edit` accepts only descriptive/custodial fields
 * (name, nameAr, custodian, branch, notes). Status NEVER changes through
 * edits either — only module operations move it (run floor →
 * FULLY_DEPRECIATED, disposal → DISPOSED, zero-proceeds scrap/write-off →
 * WRITTEN_OFF/DISPOSED) via the exported status machine below.
 */

/** DATA_DICTIONARY §9 asset_status — the exhaustive set. */
export const ASSET_STATUSES = ["ACTIVE", "FULLY_DEPRECIATED", "DISPOSED", "WRITTEN_OFF"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/**
 * The legal transition set (INV-023: disposal exactly once, only from
 * ACTIVE/FULLY_DEPRECIATED; the run floor flips ACTIVE →
 * FULLY_DEPRECIATED; zero-proceeds scrap writes off from ACTIVE).
 * DISPOSED/WRITTEN_OFF are terminal.
 */
const STATUS_TRANSITIONS: Record<AssetStatus, readonly AssetStatus[]> = {
  ACTIVE: ["FULLY_DEPRECIATED", "DISPOSED", "WRITTEN_OFF"],
  FULLY_DEPRECIATED: ["DISPOSED"],
  DISPOSED: [],
  WRITTEN_OFF: [],
};

/** Pure predicate — exported for the P26-B/C services and the rule suite. */
export function canTransitionTo(from: AssetStatus, to: AssetStatus): boolean {
  return STATUS_TRANSITIONS[from].includes(to);
}

/** Throwing variant (AssetStatusError on any illegal move). */
export function assertCanTransitionTo(from: AssetStatus, to: AssetStatus): void {
  if (!canTransitionTo(from, to)) {
    throw new AssetStatusError(
      `asset status ${from} cannot transition to ${to} — legal set: ${STATUS_TRANSITIONS[from].join(", ") || "(terminal)"} (INV-023)`,
      { from, to, legal: [...STATUS_TRANSITIONS[from]] },
    );
  }
}

const MONEY_RE = /^\d+(\.\d{1,4})?$/;
const UNITS_RE = /^\d+(\.\d{1,6})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function money4(value: string): string {
  return new Decimal(value).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

function assertMoney(value: string, field: string): void {
  if (!MONEY_RE.test(value)) {
    throw new InvalidAssetInputError(
      `${field} must be a non-negative decimal string with ≤ 4 decimals (ADR-0009): ${value}`,
      { field, value },
    );
  }
}

function assertDate(value: string, field: string): void {
  if (!DATE_RE.test(value)) {
    throw new InvalidAssetInputError(`${field} must be an ISO date (yyyy-mm-dd): ${value}`, {
      field,
      value,
    });
  }
}

/** Branch binding (A7): tenant-scoped lookup — foreign id ≡ unknown id. */
async function requireBranch(branchId: string): Promise<void> {
  const branch = await findBranchById(branchId);
  if (branch === undefined) throw new BranchNotFoundError(branchId);
}

/** Custodian binding (A7): a membership in THIS tenant — a foreign-tenant
 * user id is indistinguishable from an unknown one. */
async function requireCustodianMembership(custodianUserId: string): Promise<void> {
  const { tenantId } = requireTenantContext();
  const membership = await findMembershipForUserInTenant(custodianUserId, tenantId);
  if (membership === undefined) throw new UserNotFoundError(custodianUserId);
}

export interface CreateAssetInput {
  code: string;
  name: string;
  nameAr: string;
  categoryId: string;
  branchId: string;
  acquisitionDate: string;
  cost: string;
  salvageValue?: string;
  openingAccumulated?: string;
  usefulLifeMonths?: number;
  depreciationMethod?: string;
  totalEstimatedUnits?: string | null;
  custodianUserId?: string | null;
  note?: string | null;
  noteAr?: string | null;
  actorId: string | null;
}

@Injectable()
export class AssetService {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  async list(filter: store.AssetListFilter): Promise<store.AssetRow[]> {
    return store.listAssets(filter);
  }

  async find(id: string): Promise<store.AssetRow> {
    const asset = await store.findAssetById(id);
    if (asset === undefined) throw new AssetNotFoundError(id);
    return asset;
  }

  /**
   * Detail read model: the asset + its category + the NBV read model
   * (accumulated = opening_accumulated + Σ posted non-reversed run lines;
   * NBV = cost − accumulated) + the full depreciation history (append-only
   * lines with their run status).
   */
  async detail(id: string): Promise<{
    asset: store.AssetRow;
    category: store.AssetCategoryRow | null;
    accumulated: string;
    netBookValue: string;
    depreciationHistory: Awaited<ReturnType<typeof store.listDepreciationLinesByAsset>>;
  }> {
    const asset = await this.find(id);
    const category = await store.findAssetCategoryById(asset.categoryId);
    const accumulated = await store.assetAccumulated(id);
    const netBookValue = await store.assetNbv(id);
    const depreciationHistory = await store.listDepreciationLinesByAsset(id);
    return { asset, category: category ?? null, accumulated, netBookValue, depreciationHistory };
  }

  /**
   * Register an asset. The category must exist, be ACTIVE, and be USABLE
   * (BR-041 — all three purposes resolve); life/method default from the
   * category unless overridden. The asset is born ACTIVE, un-capitalized
   * (source_type NULL) — the G-21 capitalization step binds the source.
   */
  async create(input: CreateAssetInput): Promise<store.AssetRow> {
    const code = input.code.trim();
    if (code === "") {
      throw new InvalidAssetInputError("asset code is required (tenant-scoped natural key, ADR-0006)");
    }
    if (input.name.trim() === "" || input.nameAr.trim() === "") {
      throw new InvalidAssetInputError("asset name and nameAr are both required (§3 bilingual rules)");
    }
    assertDate(input.acquisitionDate, "acquisitionDate");
    assertMoney(input.cost, "cost");
    const salvage = input.salvageValue ?? "0";
    assertMoney(salvage, "salvageValue");
    const opening = input.openingAccumulated ?? "0";
    assertMoney(opening, "openingAccumulated");

    // Category (A7 typed 404) + active + BR-041.
    const category = await store.findAssetCategoryById(input.categoryId);
    if (category === undefined) throw new AssetCategoryNotFoundError(input.categoryId);
    if (!category.active) {
      throw new InvalidAssetInputError(
        `asset category ${category.code} is inactive — new assets register under active categories only (deactivation retires a category for new use; INV-015 keeps its history)`,
        { categoryId: input.categoryId, code: category.code },
      );
    }
    await assertCategoryUsable(category);

    // Life / method: category defaults unless overridden.
    const life =
      input.usefulLifeMonths ?? category.usefulLifeMonthsDefault;
    if (!Number.isInteger(life) || life < MIN_LIFE_MONTHS || life > MAX_LIFE_MONTHS) {
      throw new InvalidAssetInputError(
        `usefulLifeMonths must be an integer between ${MIN_LIFE_MONTHS} and ${MAX_LIFE_MONTHS} (got ${String(life)})`,
        { usefulLifeMonths: life },
      );
    }
    const method = input.depreciationMethod ?? category.depreciationMethodDefault;
    if (!(DEPRECIATION_METHODS as readonly string[]).includes(method)) {
      throw new InvalidAssetInputError(
        `depreciationMethod must be one of ${DEPRECIATION_METHODS.join(" | ")} (DATA_DICTIONARY §9)`,
        { depreciationMethod: method },
      );
    }

    // INV-023 preconditions (mirrors the DB CHECKs — service-side for the
    // typed, localized failure pack).
    const costD = new Decimal(input.cost);
    const salvageD = new Decimal(salvage);
    const openingD = new Decimal(opening);
    if (salvageD.comparedTo(costD) > 0) {
      throw new InvalidAssetInputError(
        `salvageValue ${salvage} cannot exceed cost ${input.cost} (INV-023 salvage floor)`,
        { cost: input.cost, salvageValue: salvage },
      );
    }
    const depreciableBase = costD.minus(salvageD);
    if (openingD.comparedTo(depreciableBase) > 0) {
      throw new InvalidAssetInputError(
        `openingAccumulated ${opening} cannot exceed the depreciable base cost − salvage = ${depreciableBase.toFixed(4)} (INV-023)`,
        { cost: input.cost, salvageValue: salvage, openingAccumulated: opening },
      );
    }

    // UoP requires total_estimated_units > 0 (DB CHECK parity).
    let totalEstimatedUnits: string | null = null;
    if (method === "UNITS_OF_PRODUCTION") {
      if (input.totalEstimatedUnits === undefined || input.totalEstimatedUnits === null) {
        throw new InvalidAssetInputError(
          "UNITS_OF_PRODUCTION assets require totalEstimatedUnits > 0 (usage is manual per run line — DR-002 §5)",
          { depreciationMethod: method },
        );
      }
      if (!UNITS_RE.test(input.totalEstimatedUnits) || new Decimal(input.totalEstimatedUnits).lte(0)) {
        throw new InvalidAssetInputError(
          `totalEstimatedUnits must be a positive decimal (≤ 6dp): ${input.totalEstimatedUnits}`,
          { totalEstimatedUnits: input.totalEstimatedUnits },
        );
      }
      totalEstimatedUnits = new Decimal(input.totalEstimatedUnits).toFixed(6);
    }

    // FK bindings (A7 typed 404s; membership-scoped custodian).
    await requireBranch(input.branchId);
    if (input.custodianUserId !== undefined && input.custodianUserId !== null) {
      await requireCustodianMembership(input.custodianUserId);
    }

    const existing = await store.findAssetByCode(code);
    if (existing !== undefined) {
      throw new AssetCodeConflictError({ code, existingId: existing.id });
    }

    const created = await store.insertAsset({
      code,
      name: input.name.trim(),
      nameAr: input.nameAr.trim(),
      categoryId: input.categoryId,
      acquisitionDate: input.acquisitionDate,
      cost: money4(input.cost),
      salvageValue: money4(salvage),
      openingAccumulated: money4(opening),
      usefulLifeMonths: life,
      depreciationMethod: method,
      totalEstimatedUnits,
      branchId: input.branchId,
      custodianUserId: input.custodianUserId ?? null,
      status: "ACTIVE",
      sourceType: null,
      sourceId: null,
      note: input.note ?? null,
      noteAr: input.noteAr ?? null,
      createdBy: input.actorId,
    });
    await this.audit.record({
      action: "fixed_assets.asset_created",
      entityType: "asset",
      entityId: created.id,
      actorId: input.actorId ?? undefined,
      after: {
        code: created.code,
        categoryId: created.categoryId,
        branchId: created.branchId,
        custodianUserId: created.custodianUserId,
        cost: created.cost,
        salvageValue: created.salvageValue,
        openingAccumulated: created.openingAccumulated,
        usefulLifeMonths: created.usefulLifeMonths,
        depreciationMethod: created.depreciationMethod,
        totalEstimatedUnits: created.totalEstimatedUnits,
      },
    });
    return created;
  }

  /**
   * Edit — descriptive/custodial fields ONLY (name, nameAr, custodian,
   * branch, notes). cost/salvage/opening/life/method/units/acquisition-date/
   * category are IMMUTABLE after creation (corrections are revaluation or
   * disposal documents — never register edits); status moves ONLY via
   * module operations (the exported status machine). The PATCH therefore
   * carries no such fields at all — the shape is the contract.
   */
  async edit(
    id: string,
    patch: {
      name?: string;
      nameAr?: string;
      branchId?: string;
      custodianUserId?: string | null;
      note?: string | null;
      noteAr?: string | null;
    },
    actorId: string | null,
  ): Promise<store.AssetRow> {
    const current = await this.find(id);
    if (patch.name !== undefined && patch.name.trim() === "") {
      throw new InvalidAssetInputError("name cannot be empty");
    }
    if (patch.nameAr !== undefined && patch.nameAr.trim() === "") {
      throw new InvalidAssetInputError("nameAr cannot be empty");
    }
    if (patch.branchId !== undefined && patch.branchId !== current.branchId) {
      await requireBranch(patch.branchId);
    }
    if (
      patch.custodianUserId !== undefined &&
      patch.custodianUserId !== null &&
      patch.custodianUserId !== current.custodianUserId
    ) {
      await requireCustodianMembership(patch.custodianUserId);
    }
    const updated = await store.updateAsset(id, {
      name: patch.name !== undefined ? patch.name.trim() : undefined,
      nameAr: patch.nameAr !== undefined ? patch.nameAr.trim() : undefined,
      branchId: patch.branchId,
      custodianUserId: patch.custodianUserId,
      note: patch.note,
      noteAr: patch.noteAr,
    });
    if (updated === undefined) throw new AssetNotFoundError(id);
    await this.audit.record({
      action: "fixed_assets.asset_edited",
      entityType: "asset",
      entityId: id,
      actorId: actorId ?? undefined,
      before: {
        name: current.name,
        nameAr: current.nameAr,
        branchId: current.branchId,
        custodianUserId: current.custodianUserId,
        note: current.note,
        noteAr: current.noteAr,
      },
      after: {
        name: updated.name,
        nameAr: updated.nameAr,
        branchId: updated.branchId,
        custodianUserId: updated.custodianUserId,
        note: updated.note,
        noteAr: updated.noteAr,
      },
    });
    return updated;
  }
}
