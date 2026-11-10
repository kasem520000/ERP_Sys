import { Decimal } from "@erp/domain-core";

/**
 * WAC valuation engine (PHASE-010 T3; INVENTORY_ACCOUNTING §1; ADR-0009).
 *
 * PURE domain math — zero infrastructure. Canonical decimal-string in/out;
 * internal cost precision 6 decimals (numeric(19,6), DATABASE_CONVENTIONS
 * §4); the journal money quantum is rounded half-up to 4 decimals at the
 * movement boundary so Σ value_amount == the GL inventory account exactly
 * (the INV-010 invariant the reconciliation job asserts with zero
 * tolerance).
 *
 * Rule (moving average): after each receipt
 *   newAvg = (qtyOnHand × oldAvg + qtyIn × unitCost) / (qtyOnHand + qtyIn)
 * kept at 6-decimal precision; issues price at the current average and
 * never mutate it. With BR-013 negative stock explicitly enabled the same
 * formula stays algebraically exact (qtyOnHand may be negative); issues
 * price at the last known average.
 */

const QTY_SCALE = 6;
const MONEY_SCALE = 4;

function dec(value: string): Decimal {
  return new Decimal(value);
}

/** Round half-up to the quantity/cost scale (6dp — ADR-0009). */
export function cost6(value: Decimal): string {
  return value.toDecimalPlaces(QTY_SCALE, Decimal.ROUND_HALF_UP).toFixed(QTY_SCALE);
}

/** Round half-up to the journal money scale (4dp — ADR-0009). */
export function money4(value: Decimal): string {
  return value.toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP).toFixed(MONEY_SCALE);
}

/** Exact multiplication qty × unitCost at the money scale (value_amount). */
export function valueAmount(qty: string, unitCost: string): string {
  return money4(dec(qty).times(dec(unitCost)));
}

export interface WacReceipt {
  /** New average cost (6dp) after receiving qtyIn at unitCost. */
  avgCost: string;
  /** The receipt's journal quantum (4dp): qtyIn × unitCost. */
  valueAmount: string;
}

/**
 * Receive into a WAC position. Algebraic edge: qtyOnHand + qtyIn = 0 with a
 * nonzero old position is impossible under the BR-013 service guard
 * (issues cannot cross zero when the policy is off; when on, the guard
 * still refuses a receipt that would zero the denominator with a residual
 * numerator — InvalidCostError is thrown, never a silent misprice).
 */
export function wacReceive(
  qtyOnHand: string,
  oldAvg: string,
  qtyIn: string,
  unitCost: string,
): WacReceipt {
  const onHand = dec(qtyOnHand);
  const inQty = dec(qtyIn);
  const cost = dec(unitCost);
  const newQty = onHand.plus(inQty);
  if (newQty.isZero()) {
    throw new Error("WAC receipt cannot zero the on-hand denominator (BR-013 guard)");
  }
  const weighted = onHand.times(dec(oldAvg)).plus(inQty.times(cost));
  const avg = cost6(weighted.div(newQty));
  return { avgCost: avg, valueAmount: money4(inQty.times(cost)) };
}

export interface WacIssue {
  /** The issue's journal quantum (4dp): qty × current average. */
  valueAmount: string;
  /** The exact unit cost the issue prices at (6dp). */
  unitCost: string;
}

/** Issue from a WAC position at the current average — never mutates it. */
export function wacIssue(avgCost: string, qty: string): WacIssue {
  const unit = cost6(dec(avgCost));
  return { valueAmount: money4(dec(qty).times(dec(unit))), unitCost: unit };
}
