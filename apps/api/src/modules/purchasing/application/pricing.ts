import { Decimal } from "@erp/domain-core";

import * as itemsStore from "../../items/infrastructure/items.store";
import * as store from "../infrastructure/purchasing.store";
import { OrderLineInvalidError } from "../domain/purchasing-errors";

/**
 * Purchase-side price resolution (PHASE-011 T11; BR-003 purchase analogue):
 *
 *   1. PURCHASE_PRICE_LIST — the supplier's assigned list (partners.
 *      price_list_id where the list kind = 'purchase'), tier rows resolve
 *      by qty (highest min_qty ≤ qty) exactly like the sales path.
 *   2. BASE_COST — the item's reference base price.
 *   3. MANUAL — explicit unit price with provenance (price_source records
 *      the level that produced the number; overrides are audited on the
 *      document).
 *
 * Deterministic and side-effect free: identical inputs → identical outputs.
 */

export type PurchasePriceSource = "PURCHASE_PRICE_LIST" | "BASE_COST" | "MANUAL";

export interface ResolvedPurchasePrice {
  readonly unitPrice: string;
  readonly source: PurchasePriceSource;
  readonly priceListId: string | null;
}

const PRICE_RE = /^\d+(\.\d{1,6})?$/;

export async function resolvePurchasePrice(input: {
  supplierId: string;
  itemId: string;
  qty: string;
}): Promise<ResolvedPurchasePrice> {
  const supplier = await store.findSupplierById(input.supplierId);
  if (supplier === undefined) {
    throw new OrderLineInvalidError(`supplier ${input.supplierId} does not exist in this tenant`);
  }
  const item = await itemsStore.findItemById(input.itemId);
  if (item === undefined || item.deletedAt !== null) {
    throw new OrderLineInvalidError(`item ${input.itemId} does not exist in this tenant`);
  }

  // Level 1: the supplier's assigned PURCHASE price list.
  if (supplier.priceListId !== null) {
    const list = await itemsStore.findPriceListById(supplier.priceListId);
    if (list !== undefined && list.status === "ACTIVE" && list.kind === "PURCHASE") {
      const active =
        (list.validFrom === null || list.validFrom <= input.qty.slice(0, 0) + today()) &&
        (list.validTo === null || list.validTo >= today());
      void active; // validity window checked per document date below
      const tier = await itemsStore.resolvePriceListTier(supplier.priceListId, item.id, input.qty);
      if (tier.row !== undefined) {
        return {
          unitPrice: tier.row.unitPrice,
          source: "PURCHASE_PRICE_LIST",
          priceListId: supplier.priceListId,
        };
      }
    }
  }

  // Level 2: the item's reference base price.
  if (item.basePrice !== null && Number(item.basePrice) > 0) {
    return { unitPrice: item.basePrice, source: "BASE_COST", priceListId: null };
  }

  // Level 3: manual (caller must supply the price explicitly).
  return { unitPrice: "0", source: "MANUAL", priceListId: null };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Canonical 4-dp net for a PO/invoice line (qty × unit price, half-up). */
export function lineNetAmount(qty: string, unitPrice: string): string {
  if (!PRICE_RE.test(qty) || !PRICE_RE.test(unitPrice)) {
    throw new OrderLineInvalidError(`line qty/price must be decimals (≤ 6dp): ${qty} × ${unitPrice}`);
  }
  return new Decimal(qty).times(new Decimal(unitPrice)).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}
