import { Inject, Injectable } from "@nestjs/common";

import { Decimal } from "@erp/domain-core";

import { AuditService } from "../../audit/api/audit";
import {
  ownTenantBaseCurrency,
  readEffectiveSetting,
} from "../../../infra/settings/setting-reader";
import * as store from "../infrastructure/items.store";
import { PriceListInvalidError, PriceListNotFoundError, UomNotFoundError } from "../domain/items-errors";
import { UomService } from "./uom-service";

/**
 * Price lists + BR-003 pricing resolution service (PHASE-006 §2.2–§2.3/T5):
 * precedence **customer's price list → customer-tier list (distribution,
 * PHASE-017 — explicitly later per the phase doc) → branch default list →
 * item base price**, with per-request provenance (which level resolved,
 * applied UoM conversion) and the manual-override allowance flag from
 * `sales.price_override_allowed` (BR-002/003 ceilings enforce at sales
 * approval, PHASE-012).
 */

export interface PriceListInput {
  name: string;
  nameAr: string | null;
  kind: "SALE" | "PURCHASE";
  currencyCode: string;
  validFrom: string | null;
  validTo: string | null;
}

export interface PriceResolutionRequest {
  itemId: string;
  partnerId?: string;
  branchId?: string;
  uomId?: string;
  qty?: string;
  date?: string;
}

export interface PriceResolution {
  itemId: string;
  unitPrice: string;
  /** CUSTOMER_PRICE_LIST | DEFAULT_PRICE_LIST | BASE_PRICE */
  source: "CUSTOMER_PRICE_LIST" | "DEFAULT_PRICE_LIST" | "BASE_PRICE";
  priceListId: string | null;
  appliedUomId: string;
  baseUomId: string;
  conversionFactor: string;
  manualOverrideAllowed: boolean;
  basis: string;
}

@Injectable()
export class PriceListService {
  constructor(
    @Inject(AuditService) private readonly audit: AuditService,
    private readonly uoms: UomService,
  ) {}

  // -- list CRUD --------------------------------------------------------------

  async list(kind: string | undefined): Promise<store.PriceListRow[]> {
    return store.listPriceLists(kind);
  }

  async get(id: string): Promise<store.PriceListRow> {
    const row = await store.findPriceListById(id);
    if (row === undefined) {
      throw new PriceListNotFoundError(id);
    }
    return row;
  }

  async create(actorId: string, input: PriceListInput): Promise<store.PriceListRow> {
    if (input.validFrom !== null && input.validTo !== null && input.validTo < input.validFrom) {
      throw new PriceListInvalidError("valid_to must not precede valid_from");
    }
    const base = await ownTenantBaseCurrency();
    if (input.currencyCode !== base) {
      throw new PriceListInvalidError(
        `price list currency must be the tenant base currency (${base}) at this phase`,
      );
    }
    const row = await store.insertPriceList(input);
    await this.audit.record({
      action: "price_list.created",
      entityType: "price_list",
      entityId: row.id,
      actorId,
      after: { name: row.name, kind: row.kind, currency: row.currencyCode },
    });
    return row;
  }

  async update(
    actorId: string,
    id: string,
    patch: { name?: string; nameAr?: string | null; validFrom?: string | null; validTo?: string | null; status?: string },
  ): Promise<store.PriceListRow> {
    const before = await store.findPriceListById(id);
    if (before === undefined) {
      throw new PriceListNotFoundError(id);
    }
    const from = patch.validFrom !== undefined ? patch.validFrom : before.validFrom;
    const to = patch.validTo !== undefined ? patch.validTo : before.validTo;
    if (from !== null && to !== null && to < from) {
      throw new PriceListInvalidError("valid_to must not precede valid_from");
    }
    const updated = await store.updatePriceList(id, patch);
    if (updated === undefined) {
      throw new PriceListNotFoundError(id);
    }
    await this.audit.record({
      action: "price_list.updated",
      entityType: "price_list",
      entityId: id,
      actorId,
      before: { name: before.name, status: before.status },
      after: { name: updated.name, status: updated.status },
    });
    return updated;
  }

  async listRows(priceListId: string): Promise<store.PriceListItemRow[]> {
    await this.get(priceListId);
    return store.listPriceListItems(priceListId);
  }

  async upsertRow(
    actorId: string,
    priceListId: string,
    input: { itemId: string; uomId: string; unitPrice: string; minQty: string },
  ): Promise<store.PriceListItemRow> {
    const list = await this.get(priceListId);
    if (list.status !== "ACTIVE") {
      throw new PriceListInvalidError("price list is inactive");
    }
    const item = await store.findItemById(input.itemId);
    if (item === undefined || item.deletedAt !== null) {
      throw new PriceListInvalidError(`item ${input.itemId} does not exist in this tenant`);
    }
    const uom = await store.findUomById(input.uomId);
    if (uom === undefined) {
      throw new UomNotFoundError(input.uomId);
    }
    if (Number(input.unitPrice) < 0 || Number(input.minQty) <= 0) {
      throw new PriceListInvalidError("unitPrice >= 0 and minQty > 0 required");
    }
    // Same tier (list, item, uom, min_qty) → price update; else a new tier row.
    const tiers = await store.listPriceListItems(priceListId);
    const existingTier = tiers.find(
      (row) =>
        row.itemId === input.itemId && row.uomId === input.uomId && row.minQty === input.minQty,
    );
    const row =
      existingTier !== undefined
        ? (await store.updatePriceListItem(existingTier.id, { unitPrice: input.unitPrice }))!
        : await store.insertPriceListItem({ priceListId, ...input });
    await this.audit.record({
      action: "price_list.row_upserted",
      entityType: "price_list",
      entityId: priceListId,
      actorId,
      before: existingTier === undefined ? undefined : { unit_price: existingTier.unitPrice },
      after: { item_id: input.itemId, uom_id: input.uomId, unit_price: row.unitPrice, min_qty: row.minQty },
    });
    return row;
  }

  // -- BR-003 resolution --------------------------------------------------------

  /**
   * Resolve the selling price with provenance:
   * 1. CUSTOMER_PRICE_LIST — the partner's assigned list (partners.price_list_id)
   * 2. DEFAULT_PRICE_LIST — the branch default list (branches.default_price_list_id)
   * 3. BASE_PRICE — the item's base price
   * Tier rows resolve by qty (highest min_qty ≤ qty); UoM conversion is
   * exact-decimal with the composed factor reported in provenance.
   */
  async resolvePrice(request: PriceResolutionRequest): Promise<PriceResolution> {
    const item = await store.findItemById(request.itemId);
    if (item === undefined || item.deletedAt !== null) {
      throw new PriceListInvalidError(`item ${request.itemId} does not exist in this tenant`);
    }
    const baseUomId = item.uomId;
    const appliedUomId = request.uomId ?? baseUomId;
    const qty = request.qty ?? "1";
    const overrideAllowed = (await readEffectiveSetting<boolean>("sales.price_override_allowed")) ?? true;

    // Level 1: the customer's price list.
    if (request.partnerId !== undefined) {
      const partner = await store.partnerForPricing(request.partnerId);
      if (partner === undefined) {
        throw new PriceListInvalidError(`partner ${request.partnerId} does not exist in this tenant`);
      }
      if (partner.priceListId !== null) {
        const resolved = await this.tryTier(
          partner.priceListId,
          item,
          qty,
          appliedUomId,
          baseUomId,
          "CUSTOMER_PRICE_LIST",
          overrideAllowed,
        );
        if (resolved !== undefined) {
          return resolved;
        }
      }
    }

    // Level 2: the branch default list.
    if (request.branchId !== undefined) {
      const branchListId = await store.branchDefaultPriceListId(request.branchId);
      if (branchListId !== undefined && branchListId !== null) {
        const resolved = await this.tryTier(
          branchListId,
          item,
          qty,
          appliedUomId,
          baseUomId,
          "DEFAULT_PRICE_LIST",
          overrideAllowed,
        );
        if (resolved !== undefined) {
          return resolved;
        }
      }
    }

    // Level 3: base price (converted to the requested UoM when needed).
    // Per-unit semantics as above: price_per_applied = base_price × the
    // factor expressing one applied unit in base units.
    if (appliedUomId === baseUomId) {
      return {
        itemId: item.id,
        unitPrice: item.basePrice ?? "0",
        source: "BASE_PRICE",
        priceListId: null,
        appliedUomId,
        baseUomId,
        conversionFactor: "1",
        manualOverrideAllowed: overrideAllowed,
        basis: "item.base_price",
      };
    }
    const factor = await this.uoms.resolveFactor(appliedUomId, baseUomId);
    const converted =
      item.basePrice === null ? "0" : new Decimal(item.basePrice).times(new Decimal(factor)).toString();
    return {
      itemId: item.id,
      unitPrice: converted,
      source: "BASE_PRICE",
      priceListId: null,
      appliedUomId,
      baseUomId,
      conversionFactor: factor,
      manualOverrideAllowed: overrideAllowed,
      basis: "item.base_price",
    };
  }

  private async tryTier(
    priceListId: string,
    item: store.ItemRow,
    qty: string,
    appliedUomId: string,
    baseUomId: string,
    source: PriceResolution["source"],
    overrideAllowed: boolean,
  ): Promise<PriceResolution | undefined> {
    const list = await store.findPriceListById(priceListId);
    if (list === undefined || list.status !== "ACTIVE") {
      return undefined;
    }
    if (list.kind !== "SALE") {
      return undefined;
    }
    if (!listActiveOn(list.validFrom, list.validTo)) {
      return undefined;
    }
    const tier = await store.resolvePriceListTier(priceListId, item.id, qty);
    if (tier.row === undefined) {
      return undefined;
    }
    if (tier.row.uomId === appliedUomId) {
      return {
        itemId: item.id,
        unitPrice: tier.row.unitPrice,
        source,
        priceListId,
        appliedUomId,
        baseUomId,
        conversionFactor: "1",
        manualOverrideAllowed: overrideAllowed,
        basis: `price_list tier min_qty=${tier.row.minQty}`,
      };
    }
    // Tier is in another UoM: convert exactly. A price is per-unit, so
    // converting per-tier-UoM → per-applied-UoM multiplies by the factor
    // expressing ONE applied unit in tier units (price_applied =
    // price_tier × resolveFactor(applied → tier)), the inverse of the
    // quantity conversion direction.
    try {
      const factor = await this.uoms.resolveFactor(appliedUomId, tier.row.uomId);
      const converted = new Decimal(tier.row.unitPrice).times(new Decimal(factor)).toString();
      return {
        itemId: item.id,
        unitPrice: converted,
        source,
        priceListId,
        appliedUomId,
        baseUomId,
        conversionFactor: factor,
        manualOverrideAllowed: overrideAllowed,
        basis: `price_list tier min_qty=${tier.row.minQty} uom=${tier.row.uomId}`,
      };
    } catch {
      return undefined;
    }
  }
}

function listActiveOn(from: string | null, to: string | null): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (from !== null && today < from) {
    return false;
  }
  if (to !== null && today > to) {
    return false;
  }
  return true;
}
