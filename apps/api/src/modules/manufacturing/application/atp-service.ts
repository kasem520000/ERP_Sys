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
 * THE JUDGMENT CONTRACT (the 043-audit item-6 fix — time-phased, made
 * explicit; pre-fix the verdict compared the requested qty against
 * available-NOW only, so a promise weeks out failed even when the
 * covering supply was already scheduled to land in time, and an
 * undated/imminent leg could back a suggested date):
 *
 * 1. The basis is EXPIRY-AWARE against the promise date: an on-hand
 *    batch whose expiry precedes the (effective) requested date cannot
 *    back it (the engine's batch-aware-carry law, M-10 — a batch that
 *    will be gone by then never promises).
 * 2. The coverage at the requested date = the expiry-aware basis + the
 *    DATED incoming legs (open POs by expected date, open MOs by
 *    planned date) that arrive on/before the requested date and inside
 *    the horizon. Verdict OK iff coverage ≥ the requested qty — the
 *    trivial case is the basis alone covering.
 * 3. In-transit transfers are VISIBLE evidence but NEVER promiseable
 *    (BR-016's law — the pre-fix code counted them at the as-of date
 *    against its own documentation); an undated leg never promises (a
 *    promise needs a date). Both stay in the incoming evidence list.
 * 4. Unreserved sibling demand (other ISSUED order lines without an
 *    ACTIVE reservation) does NOT reduce the basis — the
 *    soft-reservation law: only reservations hold stock; the SHORT
 *    verdict is the line's own over-promise warning.
 * 5. A requested date in the past is floored to the as-of date (a
 *    promise never back-dates).
 *
 * CTP: the first DATED supply date the remaining shortfall is covered
 * (deterministic order: date, then kind), within the horizon; null when
 * the horizon cannot cover it.
 */

const QTY_RE = /^\d+(\.\d{1,6})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface AtpResult {
  itemId: string;
  warehouseId: string;
  asOf: string;
  requestedQty: string;
  requestedDate: string;
  /** The promiseable basis: qualified AVAILABLE bins − ACTIVE
   * reservations (BR-080 — the hard exclusions applied). */
  availableNow: string;
  /** The CTP scan: the first date the remaining shortfall is covered by
   * scheduled supply; null when the horizon cannot cover it. */
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
    // item + warehouse, EXPIRY-AWARE against the promise date (law 1: a
    // batch whose expiry precedes the requested date never backs it).
    const onHandRows = (await store.listQualifiedOnHand(input.warehouseId)).filter(
      (row) =>
        row.itemId === input.itemId &&
        (row.expiresOn === null || row.expiresOn >= effectiveRequested),
    );
    const reservationRows = (await store.listActiveReservations(input.warehouseId)).filter(
      (row) => row.itemId === input.itemId,
    );
    const reserved = reservationRows.reduce((sum, row) => sum.plus(new Decimal(row.qty)), new Decimal(0));
    const availableNow = Decimal.max(
      onHandRows.reduce((sum, row) => sum.plus(new Decimal(row.qty)), new Decimal(0)).minus(reserved),
      new Decimal(0),
    );

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
    // cumulative supply covers the shortfall.
    const datedLegs = incoming.filter(
      (leg) => leg.date !== null && leg.kind !== "INBOUND_TRANSFER",
    );
    let suggestedDate: string | null = null;
    if (availableNow.greaterThanOrEqualTo(requested)) {
      suggestedDate = null;
    } else {
      let remaining = requested.minus(availableNow);
      for (const leg of datedLegs) {
        if (remaining.lessThanOrEqualTo(0)) break;
        if (leg.date! > horizonEnd) break;
        remaining = remaining.minus(new Decimal(leg.qty));
        if (remaining.lessThanOrEqualTo(0)) {
          suggestedDate = leg.date;
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
      // requested date — the informative supply landing).
      suggestedDate,
      verdict,
      incoming,
    };
  }
}
