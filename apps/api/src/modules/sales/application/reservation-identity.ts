/**
 * THE ORDER-LINE RESERVATION IDENTITY READ (the joint review round,
 * 2026-11-15 — the reviewer's directive): every place the sales side
 * CONSUMES or RELEASES an order line's "own" reservation must re-verify
 * the LIVE row's identity — the same law the hard-review round applied
 * to the beneficiary ALLOWANCE — never the reservation id alone.
 *
 * The law (one definition everywhere — the allowance, the delivery
 * settlement's consumption (5b), the fully-delivered finalization's
 * release (5c), and the order terminations' release (cancel/close) all
 * answer through THIS read): the row must be LIVE (ACTIVE and
 * non-expired — the exact liveness the reserved pool nets) and must
 * match the line's ITEM, the ORDER's WAREHOUSE, and the BENEFICIARY
 * holder (holderType SALES_ORDER, holderId THIS order). A dead, expired,
 * or foreign row entitles NOTHING: the caller skips it (fail-closed —
 * a third party's coverage is never consumed or released through a
 * crafted or stale order-line link) and treats the stored link as
 * stale.
 */
export interface LiveOwnReservation {
  id: string;
  qty: string;
}

export async function liveOwnReservationForOrder(input: {
  /** The order line's stored reservation link (may be stale or rogue). */
  reservationId: string | null;
  /** The beneficiary order — the only holder the row may serve. */
  orderId: string;
  /** The order line's item (identity dim 1). */
  itemId: string;
  /** The order's warehouse (identity dim 2). */
  warehouseId: string;
}): Promise<LiveOwnReservation | null> {
  if (input.reservationId === null) return null;
  const invStore = await import("../../inventory/infrastructure/inventory.store");
  const own = await invStore.findLiveReservationRow(input.reservationId);
  if (own === undefined) return null; // dead (non-ACTIVE or lapsed)
  if (own.itemId !== input.itemId) return null; // a different item's coverage
  if (own.warehouseId !== input.warehouseId) return null; // another warehouse's pool
  if (own.holderType !== "SALES_ORDER" || own.holderId !== input.orderId) {
    return null; // a third party's beneficiary row
  }
  return { id: own.id, qty: own.qty };
}
