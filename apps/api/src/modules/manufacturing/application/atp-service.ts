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
 * excluded by the join. In-transit is VISIBLE but never promiseable
 * until received (BR-016's law).
 *
 * CTP: the first date live supply can cover the remainder — the forward
 * scan over open POs (expected dates), open MOs (planned dates), and
 * inbound transfers (imminent — the as-of date) using the same
 * deterministic netting the engine snapshots.
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
    const horizonDays = input.horizonDays ?? 90;

    // The promiseable basis — the same qualified fold the engine uses
    // (bin AVAILABLE + tenant-owned − ACTIVE reservations), scoped to the
    // item + warehouse.
    const onHandRows = (await store.listQualifiedOnHand(input.warehouseId)).filter(
      (row) => row.itemId === input.itemId,
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
    if (availableNow.greaterThanOrEqualTo(requested)) {
      return {
        itemId: input.itemId,
        warehouseId: input.warehouseId,
        asOf,
        requestedQty: requested.toFixed(6),
        requestedDate,
        availableNow: availableNow.toFixed(6),
        suggestedDate: null,
        verdict: "OK",
        incoming: [],
      };
    }

    // CTP: the forward scan over scheduled supply (deterministic order:
    // date, then kind). Inbound transfers count at the as-of date (they
    // are on the truck — imminent, not dated).
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

    let remaining = requested.minus(availableNow);
    let suggestedDate: string | null = null;
    for (const leg of incoming) {
      if (remaining.lessThanOrEqualTo(0)) break;
      if (leg.date !== null && leg.date > addDaysIso(asOf, horizonDays)) break;
      remaining = remaining.minus(new Decimal(leg.qty));
      if (remaining.lessThanOrEqualTo(0)) {
        suggestedDate = leg.date ?? asOf;
        break;
      }
    }

    return {
      itemId: input.itemId,
      warehouseId: input.warehouseId,
      asOf,
      requestedQty: requested.toFixed(6),
      requestedDate,
      availableNow: availableNow.toFixed(6),
      suggestedDate,
      verdict: "SHORT",
      incoming,
    };
  }
}
