import { Decimal } from "@erp/domain-core";

import * as itemsStore from "../../items/infrastructure/items.store";
import * as distributionStore from "../../distribution/infrastructure/distribution.store";
import * as store from "../infrastructure/sales.store";
import { OrderLineInvalidError } from "../domain/sales-errors";

/**
 * Sales-side price resolution (PHASE-012; BR-003 precedence, widened with
 * the PHASE-017 tier level):
 *
 *   1. SALES_PRICE_LIST — the customer's assigned list (partners.
 *      price_list_id where the list kind = 'SALE'), tier rows resolve by
 *      qty (highest min_qty ≤ qty).
 *   2. TIER_PRICE_LIST — the customer's assigned customer tier's list
 *      (partners.customer_tier_id → customer_tiers.price_list_id,
 *      PHASE-017 §2 item 8) when both the tier and its list are ACTIVE.
 *   3. BASE_PRICE — the item's reference base price.
 *   4. MANUAL — explicit unit price with provenance (price_source records
 *      the level that produced the number; overrides allowed within the
 *      sales.price_override_allowed policy, BR-002 ceilings enforced at
 *      the document level). Tier resolution NEVER overrides an explicitly
 *      quoted price — the resolve only produces defaults, and a manual
 *      quote always travels with its own unitPrice.
 *
 * Deterministic and side-effect free: identical inputs → identical outputs.
 * (The branch-default level of the full BR-003 chain lives in the
 * items-side PriceListService.resolvePrice — sale documents resolve through
 * this seam.)
 */

export type SalesPriceSource = "SALES_PRICE_LIST" | "TIER_PRICE_LIST" | "BASE_PRICE" | "MANUAL";

export interface ResolvedSalesPrice {
  readonly unitPrice: string;
  readonly source: SalesPriceSource;
  readonly priceListId: string | null;
}

const PRICE_RE = /^\d+(\.\d{1,6})?$/;

export async function resolveSalesPrice(input: {
  customerId: string;
  itemId: string;
  qty: string;
}): Promise<ResolvedSalesPrice> {
  const customer = await store.findCustomerById(input.customerId);
  if (customer === undefined) {
    throw new OrderLineInvalidError(`customer ${input.customerId} does not exist in this tenant`);
  }
  const item = await itemsStore.findItemById(input.itemId);
  if (item === undefined) {
    throw new OrderLineInvalidError(`item ${input.itemId} does not exist in this tenant`);
  }
  // Soft-deleted master data = ITEM_INACTIVE vocabulary (CONFLICT_
  // RESOLUTION §3; PHASE-020 C-11 — same trues-up as requireSellableItem).
  if (item.deletedAt !== null) {
    const { ItemInactiveError } = await import("../domain/sales-errors");
    throw new ItemInactiveError(input.itemId);
  }

  // Level 1: the customer's assigned SALES price list.
  if (customer.priceListId !== null) {
    const list = await itemsStore.findPriceListById(customer.priceListId);
    if (list !== undefined && list.status === "ACTIVE" && list.kind === "SALE") {
      const tier = await itemsStore.resolvePriceListTier(customer.priceListId, item.id, input.qty);
      if (tier.row !== undefined) {
        return {
          unitPrice: tier.row.unitPrice,
          source: "SALES_PRICE_LIST",
          priceListId: customer.priceListId,
        };
      }
    }
  }

  // Level 2 (PHASE-017 §2 item 8 / BR-003): the customer's TIER price list —
  // partners.customer_tier_id → customer_tiers.price_list_id, only when the
  // tier AND its list are ACTIVE (the read is the distribution store's
  // read-only findPartnerTier). Tier resolution never overrides an
  // explicitly quoted price: callers only consult this resolve for DEFAULT
  // pricing (manual quotes carry their own unitPrice; the approval
  // staleness gate re-resolves through this same level, so tier-aware
  // drafts stay consistent when price_override_allowed is false).
  const customerTier = await distributionStore.findPartnerTier(input.customerId);
  if (customerTier !== undefined && customerTier.status === "ACTIVE" && customerTier.priceListId !== null) {
    const tierList = await itemsStore.findPriceListById(customerTier.priceListId);
    if (tierList !== undefined && tierList.status === "ACTIVE" && tierList.kind === "SALE") {
      const tierRow = await itemsStore.resolvePriceListTier(customerTier.priceListId, item.id, input.qty);
      if (tierRow.row !== undefined) {
        return {
          unitPrice: tierRow.row.unitPrice,
          source: "TIER_PRICE_LIST",
          priceListId: customerTier.priceListId,
        };
      }
    }
  }

  // Level 3: the item's reference base price.
  if (item.basePrice !== null && Number(item.basePrice) > 0) {
    return { unitPrice: item.basePrice, source: "BASE_PRICE", priceListId: null };
  }

  // Level 4: manual (the caller must supply the price explicitly).
  return { unitPrice: "0", source: "MANUAL", priceListId: null };
}

/** Canonical 4-dp net for a sales line (qty × unit price − discount, half-up). */
export function salesLineNetAmount(qty: string, unitPrice: string, discountAmount: string): string {
  if (!PRICE_RE.test(qty) || !PRICE_RE.test(unitPrice) || !/^\d+(\.\d{1,4})?$/.test(discountAmount)) {
    throw new OrderLineInvalidError(
      `line qty/price/discount must be decimals: ${qty} × ${unitPrice} − ${discountAmount}`,
    );
  }
  const gross = new Decimal(qty).times(new Decimal(unitPrice));
  const net = gross.minus(new Decimal(discountAmount));
  if (net.lt(0)) {
    throw new OrderLineInvalidError(
      `line discount ${discountAmount} exceeds the gross ${gross.toFixed(4)} (BR-008: free goods are zero-price lines, never negative)`,
    );
  }
  return net.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
}

export { PRICE_RE };
