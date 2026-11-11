import { Decimal } from "@erp/domain-core";

/**
 * PHASE-038 sourcing math — the PURE computation core (no I/O, no
 * context): the award-matrix scoring fold, the 3-bid (BR-062) decision,
 * the blanket commitment math, the early-payment discount window, and
 * the P-11 tolerance-band resolution. Deterministic and side-effect
 * free: identical inputs → identical outputs (the house pricing.ts
 * discipline). Money travels as canonical decimal strings (ADR-0009).
 *
 * Scoring weights (the P-04/P-08 documented baseline — fixed here so the
 * frozen comparison snapshot is reproducible):
 *   price 60% · delivery 30% · terms 10% (the comparison/award matrix);
 *   delivery 40% · quality 40% · price 20% (the supplier scorecard).
 */

export const AWARD_WEIGHTS = { price: 0.6, delivery: 0.3, terms: 0.1 } as const;
export const SCORECARD_WEIGHTS = { delivery: 0.4, quality: 0.4, price: 0.2 } as const;

const PCT = new Decimal(100);

function round2(value: Decimal): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/** One offer as the scoring fold reads it. */
export interface ScoredOfferInput {
  quoteId: string;
  supplierId: string;
  /** Canonical decimal string (the offered line unit price). */
  unitPrice: string;
  /** Days to deliver; null = no commitment (scores 0 on delivery). */
  leadTimeDays: number | null;
  /** ISO date — null/absent validity scores 0 on terms. */
  validUntil: string | null;
  /** The evaluation date (ISO) — the terms leg compares against it. */
  asOf: string;
}

export interface ScoredOffer {
  quoteId: string;
  supplierId: string;
  unitPrice: string;
  lineTotal: string;
  leadTimeDays: number | null;
  validUntil: string | null;
  priceScore: string;
  deliveryScore: string;
  termsScore: string;
  weightedScore: string;
}

/** One requested line's scoring fold: the lowest price / shortest lead
 * lead anchor 100, others proportional (100 × min/own); terms 100 while
 * the offer is still valid at the evaluation date. */
export function scoreOffers(
  rfqQty: string,
  offers: readonly ScoredOfferInput[],
): ScoredOffer[] {
  const qty = new Decimal(rfqQty);
  if (offers.length === 0) return [];
  const minPrice = offers
    .map((o) => new Decimal(o.unitPrice))
    .reduce((a, b) => (a.comparedTo(b) <= 0 ? a : b));
  const leadTimes = offers
    .map((o) => o.leadTimeDays)
    .filter((d): d is number => d !== null);
  const minLead = leadTimes.length > 0 ? Math.min(...leadTimes) : null;

  return offers.map((offer) => {
    const price = new Decimal(offer.unitPrice);
    const lineTotal = qty.times(price).toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4);
    const priceScore = price.gt(0)
      ? round2(PCT.times(minPrice).div(price))
      : "100.00";
    const deliveryScore =
      offer.leadTimeDays === null || minLead === null
        ? "0.00"
        : round2(PCT.times(minLead).dividedBy(offer.leadTimeDays));
    const termsScore =
      offer.validUntil !== null && offer.validUntil >= offer.asOf ? "100.00" : "0.00";
    const weighted = new Decimal(priceScore)
      .times(AWARD_WEIGHTS.price)
      .plus(new Decimal(deliveryScore).times(AWARD_WEIGHTS.delivery))
      .plus(new Decimal(termsScore).times(AWARD_WEIGHTS.terms));
    return {
      quoteId: offer.quoteId,
      supplierId: offer.supplierId,
      unitPrice: offer.unitPrice,
      lineTotal,
      leadTimeDays: offer.leadTimeDays,
      validUntil: offer.validUntil,
      priceScore,
      deliveryScore,
      termsScore,
      weightedScore: round2(weighted),
    };
  });
}

/** The BR-062 decision: the rule's posture + the received count →
 * "proceed" | "warn" | "reject". */
export function threeBidDecision(input: {
  mode: string;
  minQuoteCount: number;
  submittedQuotes: number;
}): "proceed" | "warn" | "reject" {
  if (input.mode !== "ADVISORY" && input.mode !== "ENFORCED") return "proceed";
  if (input.minQuoteCount <= 0) return "proceed";
  if (input.submittedQuotes >= input.minQuoteCount) return "proceed";
  return input.mode === "ENFORCED" ? "reject" : "warn";
}

/** The blanket commitment guard: is `requested` within the remaining
 * (max − already released)? Returns the typed-rejection inputs when not. */
export function blanketReleaseCheck(input: {
  requested: string;
  releasedAmount: string;
  maxCommitment: string;
}): { ok: true; remainingAfter: string } | { ok: false; remaining: string } {
  const requested = new Decimal(input.requested);
  const released = new Decimal(input.releasedAmount);
  const max = new Decimal(input.maxCommitment);
  const remaining = max.minus(released);
  if (requested.lte(0) || requested.comparedTo(remaining) > 0) {
    return { ok: false, remaining: remaining.toDecimalPlaces(4, Decimal.ROUND_HALF_UP).toFixed(4) };
  }
  return {
    ok: true,
    remainingAfter: max
      .minus(released.plus(requested))
      .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
      .toFixed(4),
  };
}

/** The early-payment discount window (G-34): invoice date + discount
 * days → the deadline (ISO); the capture must be paid on/before it. */
export function discountDeadline(invoiceDate: string, discountDays: number): string {
  const date = new Date(`${invoiceDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + discountDays);
  return date.toISOString().slice(0, 10);
}

export function isWithinDiscountWindow(input: {
  invoiceDate: string;
  discountDays: number;
  paymentDate: string;
}): boolean {
  return input.paymentDate <= discountDeadline(input.invoiceDate, input.discountDays);
}

/** The discount amount: gross × pct% (4dp HALF_UP). */
export function discountAmount(invoiceGross: string, discountPct: string): string {
  return new Decimal(invoiceGross)
    .times(new Decimal(discountPct))
    .div(100)
    .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
    .toFixed(4);
}

/** The net-to-pay: gross − discount. */
export function netAfterDiscount(invoiceGross: string, discount: string): string {
  return new Decimal(invoiceGross)
    .minus(new Decimal(discount))
    .toDecimalPlaces(4, Decimal.ROUND_HALF_UP)
    .toFixed(4);
}

export interface ToleranceBand {
  maxLineAmount: string;
  qtyPct: string;
  pricePct: string;
}

/** The P-11 band resolution: the FIRST band whose maxLineAmount ≥ the
 * line amount governs; bands above the largest threshold never match
 * (the flat keys govern those lines). */
export function resolveToleranceForLine(
  lineAmount: string,
  bands: readonly ToleranceBand[],
): { qtyPct: string; pricePct: string } | null {
  const amount = new Decimal(lineAmount);
  for (const band of bands) {
    if (amount.comparedTo(new Decimal(band.maxLineAmount)) <= 0) {
      return { qtyPct: band.qtyPct, pricePct: band.pricePct };
    }
  }
  return null;
}

/** The scorecard fold (P-04): delivery/quality/price → overall via the
 * documented weights. Inputs are 0..100 (2dp strings); price variance
 * drags the price score linearly (0% → 100, ≥15% → 0). */
export function foldScorecard(input: {
  deliveryScore: string;
  qualityScore: string;
  priceVariancePct: string | null;
}): { priceScore: string; overallScore: string } {
  let price = new Decimal(100);
  if (input.priceVariancePct !== null) {
    const variance = new Decimal(input.priceVariancePct);
    const clamped = Decimal.max(Decimal.min(variance, new Decimal(15)), new Decimal(0));
    price = PCT.minus(clamped.div(15).times(PCT));
  }
  const overall = new Decimal(input.deliveryScore)
    .times(SCORECARD_WEIGHTS.delivery)
    .plus(new Decimal(input.qualityScore).times(SCORECARD_WEIGHTS.quality))
    .plus(price.times(SCORECARD_WEIGHTS.price));
  return { priceScore: round2(price), overallScore: round2(overall) };
}
