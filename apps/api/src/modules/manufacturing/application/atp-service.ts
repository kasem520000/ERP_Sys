import { Injectable } from "@nestjs/common";
import { Decimal } from "@erp/domain-core";

import * as store from "../infrastructure/planning.store";
import { AtpInputInvalidError } from "../domain/manufacturing-errors";

/**
 * ATP/CTP service (PHASE-043 T-08; M-06/S-10): available-to-promise and
 * capable-to-promise per item + warehouse + date, consumed by sales order
 * lines (the promise-date suggestion + the over-promise warning).
 *
 * THE HARD EXCLUSIONS (BR-080 — conservative by law, never configured
 * away): quarantined, reserved, and consignment-owned stock NEVER
 * promise. The promiseable basis is the BR-080-faithful bin-level fold:
 *   bin_contents (status='AVAILABLE' AND owner_partner_id IS NULL)
 *   − ACTIVE non-expired stock_reservations
 * (the same basis the engine's qualified on-hand uses — one truth). The
 * batch-level quarantine (item_batches.status <> 'ACTIVE') is already
 * excluded by the join.
 *
 * THE JUDGMENT CONTRACT (the 043-audit item-6 fix, made time-phased;
 * the round-2 item-3 hardening — coverage vs BATCH EXPIRY at EVERY
 * candidate date):
 *
 * 1. The basis is EXPIRY-AWARE against the date it answers for: an
 *    on-hand batch whose expiry precedes that date cannot back it (the
 *    engine's batch-aware-carry law, M-10 — a batch that will be gone
 *    by then never promises). `availableNow` (the result field) is the
 *    basis at the EFFECTIVE REQUESTED DATE — NOT "free stock today":
 *    a batch alive now but dead by the promise date never appears in
 *    it, and the reserved pool is netted at every date it answers for.
 * 2. The coverage at the requested date = the expiry-aware basis (at
 *    THAT date) + the DATED incoming legs (open POs by expected date,
 *    open MOs by planned date) that arrive on/before the requested date
 *    and inside the horizon. Verdict OK iff coverage ≥ the requested
 *    qty — the trivial case is the basis alone covering.
 * 3. In-transit transfers are VISIBLE evidence but NEVER promiseable
 *    (BR-016's law); an undated leg never promises (a promise needs a
 *    date). Both stay in the incoming evidence list.
 * 4. Unreserved sibling demand (other ISSUED order lines without an
 *    ACTIVE reservation) does NOT reduce the basis — the
 *    soft-reservation law: only reservations hold stock; the SHORT
 *    verdict is the line's own over-promise warning. *** THIS IS AN
 *    OPEN BUSINESS DECISION, NOT AN APPROVED POLICY (the round-2
 *    item-5 finding, proven in atp-unreserved-promise.spec): two
 *    UNRESERVED orders can BOTH stamp OK on the same stock — the ATP
 *    stamp is an ADVISORY availability check at check-time, never a
 *    protected promise; the first delivery to post physically wins
 *    (the soft model — reservation-basis.spec test (c)). The owner
 *    must choose: auto-reserve at issue, a blocking ATP gate, or the
 *    declared soft model (RISK-032). ***
 * 5. A requested date in the past is floored to the as-of date (a
 *    promise never back-dates).
 * 6. THE CTP WALK is expiry-aware at EVERY candidate date: the
 *    suggested date is the earliest date the FULL requested qty
 *    actually exists — the basis recomputed against EACH dated leg's
 *    arrival date (a batch valid at the requested date but EXPIRED by
 *    a later candidate date never covers it: the pre-fix walk counted
 *    it and promised a date at which the batch was already dead),
 *    never earlier than the as-of date (a LATE open PO's informative
 *    landing floors to today — the law-5 mirror), and reservations
 *    reduce the basis at every candidate date (the pool never frees
 *    by date).
 */

const QTY_RE = /^\d+(\.\d{1,6})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface AtpResult {
  itemId: string;
  warehouseId: string;
  asOf: string;
  requestedQty: string;
  requestedDate: string;
  /** The promiseable basis AT THE EFFECTIVE REQUESTED DATE (the
   * round-2 item-3 clarified semantics): qualified AVAILABLE bins whose
   * batches are alive AT THAT DATE − ACTIVE reservations (BR-080 — the
   * hard exclusions applied). It is NOT "free stock today": a batch
   * alive now but dead by the promise date never appears in it. */
  availableNow: string;
  /** The CTP scan (law 6): the earliest date the FULL requested qty
   * exists — the expiry-aware basis AT that date + the dated legs
   * landing on/before it, floored to the as-of date; null when the
   * horizon cannot cover it. */
  suggestedDate: string | null;
  /** OK = availableNow ≥ requestedQty at the requested date; SHORT = the
   * over-promise warning (the sales line stamps it). */
  verdict: "OK" | "SHORT";
  /** The incoming supply legs the CTP scan walked (the evidence). */
  incoming: {
    kind: "OPEN_PO" | "OPEN_MO" | "INBOUND_TRANSFER";
    date: string | null;
    qty: string;
  }[];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

@Injectable()
export class AtpService {
  /** The ATP/CTP computation for one (item, warehouse, qty, date). */
  async check(input: {
    itemId: string;
    warehouseId: string;
    qty: string;
    date?: string | null;
    /** The CTP forward-scan horizon (days); default 90. */
    horizonDays?: number;
  }): Promise<AtpResult> {
    if (!QTY_RE.test(input.qty) || new Decimal(input.qty).lessThanOrEqualTo(0)) {
      throw new AtpInputInvalidError(`qty must be a positive decimal (≤ 6dp): ${input.qty}`);
    }
    const asOf = today();
    const requestedDate = input.date ?? asOf;
    if (!DATE_RE.test(requestedDate) || Number.isNaN(Date.parse(`${requestedDate}T00:00:00Z`))) {
      throw new AtpInputInvalidError(`date must be an ISO date (YYYY-MM-DD): ${requestedDate}`);
    }
    // Contract law 5: a promise never back-dates.
    const effectiveRequested = requestedDate < asOf ? asOf : requestedDate;
    const horizonDays = input.horizonDays ?? 90;
    const horizonEnd = addDaysIso(asOf, horizonDays);

    // The promiseable basis — the same qualified fold the engine uses
    // (bin AVAILABLE + tenant-owned − ACTIVE reservations), scoped to the
    // item + warehouse, EXPIRY-AWARE AGAINST THE DATE IT ANSWERS FOR
    // (law 1: a batch whose expiry precedes that date never backs it).
    // Law 6 (the round-2 item-3 fix): the CTP walk recomputes this basis
    // at EVERY candidate date — pre-fix the walk carried the
    // REQUESTED-date basis forward, so a batch alive at the request but
    // dead by a later candidate date still "covered" it (a promise of
    // a date at which the batch no longer existed).
    const onHandRows = (await store.listQualifiedOnHand(input.warehouseId)).filter(
      (row) => row.itemId === input.itemId,
    );
    const reservationRows = (await store.listActiveReservations(input.warehouseId)).filter(
      (row) => row.itemId === input.itemId,
    );
    const reserved = reservationRows.reduce((sum, row) => sum.plus(new Decimal(row.qty)), new Decimal(0));
    /** The expiry-aware promiseable basis at ONE date (laws 1 + 6): the
     * qualified on-hand alive at that date − the reserved pool (the pool
     * never frees by date), floored at 0. */
    const basisAt = (date: string): Decimal =>
      Decimal.max(
        onHandRows
          .filter((row) => row.expiresOn === null || row.expiresOn >= date)
          .reduce((sum, row) => sum.plus(new Decimal(row.qty)), new Decimal(0))
          .minus(reserved),
        new Decimal(0),
      );
    const availableNow = basisAt(effectiveRequested);

    const requested = new Decimal(input.qty);

    // The incoming evidence — everything scheduled (dated legs) or on the
    // truck (transfers). Dated PO/MO legs are the PROMISEABLE supply
    // (law 2); transfers and undated legs are visible but never promise
    // (law 3).
    const incoming: AtpResult["incoming"] = [];
    for (const row of await store.listOpenPoSupply(input.warehouseId)) {
      if (row.itemId !== input.itemId) continue;
      incoming.push({ kind: "OPEN_PO", date: row.expectedDate, qty: row.remainingQty });
    }
    for (const row of await store.listOpenMoSupply(input.warehouseId)) {
      if (row.itemId !== input.itemId) continue;
      incoming.push({ kind: "OPEN_MO", date: row.plannedDate, qty: row.remainingQty });
    }
    for (const row of await store.listInboundTransfers(input.warehouseId)) {
      if (row.itemId !== input.itemId) continue;
      incoming.push({ kind: "INBOUND_TRANSFER", date: asOf, qty: row.qty });
    }
    incoming.sort((a, b) => {
      const aDate = a.date ?? "9999-12-31";
      const bDate = b.date ?? "9999-12-31";
      if (aDate !== bDate) return aDate < bDate ? -1 : 1;
      return a.kind < b.kind ? -1 : 1;
    });

    // The CTP walk over the PROMISEABLE legs only (law 3: a DATED open-PO/
    // open-MO leg — never an in-transit transfer (its as-of date is
    // "on the truck", not a landing date) and never an undated leg),
    // deterministic order, within the horizon — the earliest date the
    // FULL requested qty EXISTS (law 6): at each candidate date the
    // basis is recomputed against THAT date (a batch dead by then never
    // covers it) plus the dated legs landing on/before it, and the
    // suggested date never precedes the as-of date (a LATE open PO's
    // informative landing floors to today — law 5's mirror: a promise
    // never back-dates).
    const datedLegs = incoming.filter(
      (leg) => leg.date !== null && leg.kind !== "INBOUND_TRANSFER",
    );
    let suggestedDate: string | null = null;
    if (availableNow.greaterThanOrEqualTo(requested)) {
      suggestedDate = null;
    } else {
      for (const leg of datedLegs) {
        if (leg.date! > horizonEnd) break;
        const coverageAtLeg = datedLegs
          .filter((other) => other.date! <= leg.date! && other.date! <= horizonEnd)
          .reduce((sum, other) => sum.plus(new Decimal(other.qty)), basisAt(leg.date!));
        if (coverageAtLeg.greaterThanOrEqualTo(requested)) {
          suggestedDate = leg.date! < asOf ? asOf : leg.date!; // the floor
          break;
        }
      }
    }

    // The time-phased verdict (law 2): coverage at the requested date =
    // the expiry-aware basis + the dated legs arriving on/before it.
    const coverageAtRequested = datedLegs
      .filter((leg) => leg.date! <= effectiveRequested && leg.date! <= horizonEnd)
      .reduce((sum, leg) => sum.plus(new Decimal(leg.qty)), availableNow);
    const verdict = coverageAtRequested.greaterThanOrEqualTo(requested) ? "OK" : "SHORT";

    return {
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      asOf,
      requestedQty: requested.toFixed(6),
      requestedDate,
      availableNow: availableNow.toFixed(6),
      // When the verdict is OK but the basis alone cannot cover, the
      // suggested date is the earliest full-coverage DATED leg (≤ the
      // requested date — the informative supply landing; floored to the
      // as-of date when the covering leg is a LATE one — law 6).
      suggestedDate,
      verdict,
      incoming,
    };
  }
}
