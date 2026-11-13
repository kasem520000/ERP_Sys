import { Decimal } from "@erp/domain-core";

/**
 * PHASE-043 (T-04, INV-030): the PURE net-requirements kernel — bucketing,
 * the exact netting formula, lot sizing, and the AUTO safety-stock policy.
 * No DB, no services: the engine service reads the supply/demand facts,
 * hands them here, and writes the snapshots this kernel returns. Every
 * formula is Decimal-exact at the house quanta (qty 6dp half-up) and every
 * term the formula consumes is snapshotted (the explanation-first law —
 * the per-suggestion netting drill-down is THIS data).
 *
 * THE FORMULA (INV-030 — the spec's acceptance criterion 2 property):
 *   net(bucket) = (MPS + unreserved firm sales + safety-stock gap)
 *               − (qualified on-hand − reserved)
 *               − (open POs + open MOs + inbound transfers)
 * computed per (item, bucket) as a sequential projected-balance walk:
 *   balance(k) = carry(k−1) + supply(k) − demand(k)
 *   safety gap = max(0, ss − balance(k))   [a level, not a standing demand]
 *   net(k)     = max(0, −balance(k)) + gap(k)
 *   order(k)   = lotSize(net(k))           [feeds the carry — no repeated
 *                                           safety restoration: the placed
 *                                           order lifts the projection]
 *   carry(k)   = max(balance(k) + order(k), 0)
 * A surplus carries forward (never a negative carry — a deficit became the
 * bucket's net requirement the moment it was measured).
 *
 * RESERVED rows subtract (the formula's (on-hand − reserved) term — the
 * demand side already excluded the reserved sales lines; the reservation
 * holds their stock). Expiry-qualified ON_HAND (M-10): a batch whose
 * expiry precedes the bucket start contributes ZERO to that bucket.
 */

/** Canonical 6dp, half-up. */
export function round6(value: Decimal): Decimal {
  return value.toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
}

// -- buckets -------------------------------------------------------------------------

/** UTC date math — deterministic, never the host clock/tz. */
export function addDaysIso(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/** The ISO week start (Monday) of a date — the WEEK bucket anchor. */
export function weekStartIso(date: string): string {
  const utc = new Date(`${date}T00:00:00Z`);
  const day = utc.getUTCDay(); // 0=Sun..6=Sat
  const delta = day === 0 ? -6 : 1 - day;
  return addDaysIso(date, delta);
}

/** The bucket start covering `date` for a bucket size. */
export function bucketStartOf(date: string, bucketSize: "DAY" | "WEEK"): string {
  return bucketSize === "DAY" ? date : weekStartIso(date);
}

/** Build the horizon's bucket starts: bucket 0 is the CURRENT bucket (the
 * as-of date's own bucket); past-due demand folds into it (the
 * deterministic past-due fold — 0076's demand-lines note). */
export function buildBuckets(asOf: string, bucketSize: "DAY" | "WEEK", horizon: number): string[] {
  const starts: string[] = [];
  const anchor = bucketStartOf(asOf, bucketSize);
  for (let index = 0; index < horizon; index += 1) {
    starts.push(bucketSize === "DAY" ? addDaysIso(anchor, index) : addDaysIso(anchor, index * 7));
  }
  return starts;
}

/** The bucket index covering `date` (before-horizon dates fold to bucket
 * 0 — the past-due fold; beyond-horizon clamps to the last bucket). */
export function bucketIndexCovering(
  date: string,
  bucketStarts: readonly string[],
  bucketSize: "DAY" | "WEEK",
): number {
  const start = bucketStartOf(date, bucketSize);
  if (start < bucketStarts[0]!) return 0;
  for (let index = bucketStarts.length - 1; index >= 0; index -= 1) {
    if (start >= bucketStarts[index]!) return index;
  }
  return 0;
}

// -- the netting terms ================================================================

/** One gross demand contribution landing in a bucket (qty ≥ 0, 6dp). */
export interface DemandTerm {
  itemId: string;
  bucketIndex: number;
  /** MPS | SALES_ORDER | SAFETY_STOCK | BOM_EXPLOSION | SUBSTITUTION. */
  kind: string;
  qty: string;
  /** Optional lineage (the run snapshot writes it back). */
  salesOrderLineId?: string | null;
  mpsEntryId?: string | null;
  parentItemId?: string | null;
  substitutedItemId?: string | null;
  substitutes?: unknown;
}

/** One supply contribution landing in a bucket (qty ≥ 0, 6dp). */
export interface SupplyTerm {
  itemId: string;
  bucketIndex: number;
  /** ON_HAND | RESERVED | OPEN_PO | OPEN_MO | INBOUND_TRANSFER |
   * CO_PRODUCT | SUGGESTED_RECEIPT. */
  kind: string;
  qty: string;
  /** ON_HAND rows: the per-batch shape (batchId NULL for batch-less
   * items) with the expiry riding the row — a batch whose expiry precedes
   * the bucket start does NOT cover it (M-10). */
  batchId?: string | null;
  expiresOn?: string | null;
  purchaseOrderId?: string | null;
  productionOrderId?: string | null;
  stockTransferId?: string | null;
}

// -- lot sizing (M-01 — the 0078-seeded catalog) ======================================

/** The lot-sizing rule of one item (the items columns the rule consumes). */
export interface LotSizingInput {
  rule: "LOT_FOR_LOT" | "FIXED_ORDER_QTY" | "ORDER_MULTIPLE" | "PERIOD_SUPPLY";
  fixedOrderQty: string | null;
  orderMultiple: string | null;
  periodSupplyBuckets: number | null;
}

/** One planned order the kernel emits (feeds the carry + becomes the
 * suggestion candidate). */
export interface PlannedOrder {
  /** The bucket the order must ARRIVE by (its net bucket). */
  bucketIndex: number;
  bucketStart: string;
  qty: string;
  /** The raw net the order answers (the drill-down's before-lot-sizing
   * figure). */
  net: string;
}

/** Round one raw net up to the rule's order quantum. */
function lotSizeNet(net: Decimal, lotSizing: LotSizingInput): Decimal {
  if (lotSizing.rule === "FIXED_ORDER_QTY" || lotSizing.rule === "ORDER_MULTIPLE") {
    const operand = new Decimal(
      (lotSizing.rule === "FIXED_ORDER_QTY" ? lotSizing.fixedOrderQty : lotSizing.orderMultiple) ?? "1",
    );
    const quantum = operand.lessThanOrEqualTo(0) ? new Decimal(1) : operand;
    const multiples = net.div(quantum).toDecimalPlaces(0, Decimal.ROUND_CEIL);
    return round6(quantum.times(multiples.greaterThan(0) ? multiples : new Decimal(1)));
  }
  return round6(net);
}

// -- the per-(item, bucket) result ====================================================

/** The per-(item, bucket) netting result — the INV-030 snapshot row. */
export interface NetBucket {
  itemId: string;
  bucketIndex: number;
  bucketStart: string;
  /** The demand terms consumed (each visible — the drill-down). */
  demand: readonly DemandTerm[];
  /** The supply terms consumed (RESERVED included as evidence). */
  supply: readonly SupplyTerm[];
  /** Σ demand terms (incl. the safety gap when it fired). */
  grossRequirement: string;
  /** Σ positive supply − Σ RESERVED (the formula's supply side). */
  supplyAvailable: string;
  /** The carried-in projected balance (≥ 0). */
  carriedIn: string;
  /** net = the bucket's actionable requirement (shortfall + safety gap),
   * BEFORE lot sizing. */
  netRequirement: string;
  /** The order this bucket generated (lot-sized; feeds the carry). */
  plannedOrderQty: string;
  /** The balance carried to the NEXT bucket (≥ 0; includes the order). */
  carriedOut: string;
}

/** The full plan for one item over the horizon. */
export interface ItemPlan {
  itemId: string;
  buckets: readonly NetBucket[];
  orders: readonly PlannedOrder[];
}

/**
 * The sequential projected-balance walk for ONE item — INV-030's exact
 * arithmetic with lot sizing integrated (the placed order lifts the
 * projection, so a safety breach restores once, not per bucket). All
 * Decimal, canonical 6dp. Deterministic: same terms ⇒ same plan.
 */
export function planItemBuckets(input: {
  itemId: string;
  bucketStarts: readonly string[];
  demand: readonly DemandTerm[];
  supply: readonly SupplyTerm[];
  safetyStockQty: string;
  lotSizing: LotSizingInput;
}): ItemPlan {
  const { lotSizing } = input;
  const safety = new Decimal(input.safetyStockQty);
  const span = lotSizing.rule === "PERIOD_SUPPLY" ? Math.max(1, lotSizing.periodSupplyBuckets ?? 1) : 1;
  const buckets: NetBucket[] = [];
  const orders: PlannedOrder[] = [];
  /**
   * The batch-aware carry (M-10's honest discipline): the projected
   * balance is a set of PORTIONS — each a (qty, expiresOn) pair. A
   * portion whose expiry precedes a bucket start DROPS OUT of that
   * bucket's carry (expired stock never covers far demand, even when it
   * was counted in an earlier bucket); consumption eats portions in FEFO
   * order (earliest expiry first — the physical pick law); the placed
   * order and the scheduled receipts join as non-expiring portions.
   */
  type Portion = { qty: Decimal; expiresOn: string | null };
  let portions: Portion[] = [];
  /** The remaining buckets a PERIOD_SUPPLY span order still covers. */
  let spanRemaining = 0;

  for (let index = 0; index < input.bucketStarts.length; index += 1) {
    const bucketStart = input.bucketStarts[index]!;
    const demand = input.demand
      .filter((term) => term.bucketIndex === index)
      .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));
    const supply = input.supply
      .filter((term) => term.bucketIndex === index)
      .sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0));

    const grossDemand = demand.reduce((sum, term) => sum.plus(new Decimal(term.qty)), new Decimal(0));
    const supplyAvailable = supply.reduce((sum, term) => {
      if (term.kind === "RESERVED") return sum.minus(new Decimal(term.qty));
      // M-10: an expiring batch does not cover a bucket starting after the
      // expiry (a NULL expiry never disqualifies).
      if (
        term.kind === "ON_HAND" &&
        term.expiresOn !== null &&
        term.expiresOn !== undefined &&
        term.expiresOn < bucketStart
      ) {
        return sum;
      }
      return sum.plus(new Decimal(term.qty));
    }, new Decimal(0));

    // The live carry: portions that survived this bucket's expiry gate.
    const live = portions.filter(
      (portion) => portion.expiresOn === null || portion.expiresOn >= bucketStart,
    );
    const carry = live.reduce((sum, portion) => sum.plus(portion.qty), new Decimal(0));

    let balance = carry.plus(supplyAvailable).minus(grossDemand);
    // A span order placed earlier still covers this bucket: its quantity
    // already entered the carry at its start bucket; the span bookkeeping
    // only suppresses NEW orders inside the span.
    const insideSpan = spanRemaining > 0;
    if (insideSpan) spanRemaining -= 1;

    // The safety gap: a level, not a standing demand — fires only when the
    // balance (orders included, via the carry) dips below it. When ss > 0
    // the gap IS the net (it covers the shortfall AND restores the level:
    // ss − balance already includes the deficit); when ss = 0 the net is
    // the pure shortfall.
    let gap = new Decimal(0);
    let net = new Decimal(0);
    if (safety.greaterThan(0)) {
      if (balance.lessThan(safety)) {
        gap = safety.minus(balance);
        net = gap;
      }
    } else {
      net = Decimal.max(balance.negated(), new Decimal(0));
    }

    let orderQty = new Decimal(0);
    if (net.greaterThan(0) && !insideSpan) {
      if (lotSizing.rule === "PERIOD_SUPPLY") {
        // One order covering this bucket's net plus the RAW nets of the
        // next (span − 1) buckets (the raw projection: each raw bucket
        // nets against its own clamped raw carry — deterministic).
        let spanNet = net;
        let rawCarry = Decimal.max(balance, new Decimal(0));
        for (let ahead = 1; ahead < span && index + ahead < input.bucketStarts.length; ahead += 1) {
          const aheadIndex = index + ahead;
          const aheadStart = input.bucketStarts[aheadIndex]!;
          const aheadDemand = input.demand
            .filter((term) => term.bucketIndex === aheadIndex)
            .reduce((sum, term) => sum.plus(new Decimal(term.qty)), new Decimal(0));
          const aheadSupply = input.supply
            .filter((term) => term.bucketIndex === aheadIndex)
            .reduce((sum, term) => {
              if (term.kind === "RESERVED") return sum.minus(new Decimal(term.qty));
              if (
                term.kind === "ON_HAND" &&
                term.expiresOn !== null &&
                term.expiresOn !== undefined &&
                term.expiresOn < aheadStart
              ) {
                return sum;
              }
              return sum.plus(new Decimal(term.qty));
            }, new Decimal(0));
          const rawBalance = rawCarry.plus(aheadSupply).minus(aheadDemand);
          let aheadGap = new Decimal(0);
          let aheadNet = new Decimal(0);
          if (safety.greaterThan(0)) {
            if (rawBalance.lessThan(safety)) {
              aheadGap = safety.minus(rawBalance);
              aheadNet = aheadGap;
            }
          } else {
            aheadNet = Decimal.max(rawBalance.negated(), new Decimal(0));
          }
          if (aheadNet.greaterThan(0)) spanNet = spanNet.plus(aheadNet);
          rawCarry = Decimal.max(rawBalance, new Decimal(0));
        }
        orderQty = round6(spanNet);
        spanRemaining = span - 1;
      } else {
        orderQty = lotSizeNet(net, lotSizing);
      }
      orders.push({
        bucketIndex: index,
        bucketStart,
        qty: orderQty.toFixed(6),
        net: round6(net).toFixed(6),
      });
      balance = balance.plus(orderQty);
    }

    buckets.push({
      itemId: input.itemId,
      bucketIndex: index,
      bucketStart,
      demand:
        gap.greaterThan(0)
          ? [
              ...demand,
              {
                itemId: input.itemId,
                bucketIndex: index,
                kind: "SAFETY_STOCK",
                qty: round6(gap).toFixed(6),
              },
            ]
          : demand,
      supply,
      grossRequirement: round6(grossDemand.plus(gap)).toFixed(6),
      supplyAvailable: round6(supplyAvailable).toFixed(6),
      carriedIn: round6(carry).toFixed(6),
      netRequirement: round6(net).toFixed(6),
      plannedOrderQty: orderQty.toFixed(6),
      carriedOut: round6(Decimal.max(balance, new Decimal(0))).toFixed(6),
    });

    // Rebuild the portions: the live carry + this bucket's qualified
    // on-hand batches + the scheduled receipts + the placed order, then
    // consume (demand + reservations) in FEFO order. Σ portions ==
    // max(balance, 0) whenever nothing expires mid-horizon; the expiry
    // gate at the next bucket start is the M-10 divergence.
    const reservedQty = supply
      .filter((term) => term.kind === "RESERVED")
      .reduce((sum, term) => sum.plus(new Decimal(term.qty)), new Decimal(0));
    const next: Portion[] = [...live];
    for (const term of supply) {
      if (term.kind === "RESERVED") continue;
      if (
        term.kind === "ON_HAND" &&
        term.expiresOn !== null &&
        term.expiresOn !== undefined &&
        term.expiresOn < bucketStart
      ) {
        continue;
      }
      next.push({ qty: new Decimal(term.qty), expiresOn: term.expiresOn ?? null });
    }
    if (orderQty.greaterThan(0)) {
      next.push({ qty: orderQty, expiresOn: null });
    }
    next.sort((a, b) => {
      const aEx = a.expiresOn ?? "9999-12-31";
      const bEx = b.expiresOn ?? "9999-12-31";
      return aEx < bEx ? -1 : aEx > bEx ? 1 : 0;
    });
    let consume = grossDemand.plus(reservedQty);
    for (const portion of next) {
      if (consume.lessThanOrEqualTo(0)) break;
      const take = Decimal.min(portion.qty, consume);
      portion.qty = portion.qty.minus(take);
      consume = consume.minus(take);
    }
    portions = next.filter((portion) => portion.qty.greaterThan(0));
  }
  return { itemId: input.itemId, buckets, orders };
}

// -- the AUTO safety-stock policy (M-01 — deterministic, no invented statistics) -------

/** The z-table for the four sanctioned service levels (the seeded policy —
 * deterministic, documented, never fitted at run time). */
const Z_TABLE: Readonly<Record<string, string>> = {
  "90": "1.28",
  "95": "1.645",
  "98": "2.054",
  "99": "2.326",
};

/**
 * AUTO safety stock: z × σ(daily demand over the look-back) × √LT — the
 * deterministic textbook formula over the demand variability the tenant
 * already recorded (the look-back window reads delivered sales quantities
 * per day; σ is the population standard deviation of the daily totals,
 * 6dp). No smoothing, no forecasting — PHASE-064 may assist later; this
 * stays exact and explainable.
 */
export function autoSafetyStock(input: {
  serviceLevelPct: string;
  /** Daily demand totals over the look-back window (each ≥ 0, 6dp). */
  dailyDemands: readonly string[];
  leadTimeDays: number;
}): string {
  const z = new Decimal(Z_TABLE[input.serviceLevelPct] ?? "1.645");
  if (input.dailyDemands.length < 2 || input.leadTimeDays <= 0) {
    return "0.000000";
  }
  const values = input.dailyDemands.map((value) => new Decimal(value));
  const mean = values.reduce((sum, value) => sum.plus(value), new Decimal(0)).div(values.length);
  const variance = values
    .reduce((sum, value) => sum.plus(value.minus(mean).times(value.minus(mean))), new Decimal(0))
    .div(values.length);
  const sigma = variance.sqrt();
  const ltRoot = new Decimal(input.leadTimeDays).sqrt();
  return round6(z.times(sigma).times(ltRoot)).toFixed(6);
}
