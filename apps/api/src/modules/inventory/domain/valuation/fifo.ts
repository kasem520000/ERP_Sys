import { Decimal } from "@erp/domain-core";

import { cost6, money4 } from "./wac";

/**
 * FIFO valuation engine (PHASE-010 T4; INVENTORY_ACCOUNTING §1).
 *
 * PURE domain math over an ordered layer array — zero infrastructure.
 * Layers arrive oldest-first (the store's read order is
 * (received_at, created_at)); consumption is oldest-first ALWAYS. The
 * conservation property the phase mandates — Σ layer qty = on-hand exactly,
 * layers never negative — holds by construction here and is asserted by
 * the property suite against the persisted rows.
 *
 * The issue's value_amount is Σ(consumed qty_i × layer cost_i) at the
 * 4-decimal journal quantum; the reported unit_cost is the weighted
 * average of what was consumed (display metadata — value_amount is the
 * money truth, INV-010).
 */

export interface FifoLayer {
  id: string;
  remainingQty: string;
  unitCost: string;
}

export interface FifoConsumption {
  /** Per-layer decrements (oldest-first) applied by the caller. */
  consumptions: { layerId: string; qty: string }[];
  /** Σ qty_i × cost_i at the 4-decimal journal quantum. */
  valueAmount: string;
  /** Weighted average unit cost of what was consumed (6dp, display). */
  unitCost: string;
}

function dec(value: string): Decimal {
  return new Decimal(value);
}

/**
 * Consume qty from layers oldest-first. Throws when the layers cannot
 * cover the request (the BR-013 service guard maps this to
 * INSUFFICIENT_STOCK — the engine stays pure and loud).
 */
export function fifoConsume(layers: readonly FifoLayer[], qty: string): FifoConsumption {
  const requested = dec(qty);
  if (requested.lte(0)) {
    throw new Error("FIFO consumption requires a positive quantity");
  }
  const consumptions: { layerId: string; qty: string }[] = [];
  let remaining = requested;
  let total = new Decimal(0);
  for (const layer of layers) {
    if (remaining.lte(0)) break;
    const available = dec(layer.remainingQty);
    if (available.lte(0)) continue;
    const take = Decimal.min(available, remaining);
    consumptions.push({ layerId: layer.id, qty: take.toFixed(6) });
    total = total.plus(take.times(dec(layer.unitCost)));
    remaining = remaining.minus(take);
  }
  if (remaining.gt(0)) {
    throw new Error("FIFO layers cannot cover the issue (insufficient stock)");
  }
  return {
    consumptions,
    valueAmount: money4(total),
    unitCost: cost6(total.div(requested)),
  };
}

/** On-hand quantity: Σ layer remaining (exact — includes zeroed rows). */
export function fifoOnHand(layers: readonly FifoLayer[]): string {
  return layers
    .reduce((sum, layer) => sum.plus(dec(layer.remainingQty)), new Decimal(0))
    .toFixed(6);
}

/** On-hand valuation: Σ remaining × cost (exact decimal, 6dp scale). */
export function fifoValuation(layers: readonly FifoLayer[]): string {
  return money4(
    layers.reduce((sum, layer) => sum.plus(dec(layer.remainingQty).times(dec(layer.unitCost))), new Decimal(0)),
  );
}
