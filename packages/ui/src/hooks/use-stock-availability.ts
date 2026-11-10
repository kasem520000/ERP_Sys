/**
 * useStockAvailability (COMPONENT_CATALOG §9; P6-T11a) — the HONEST phase stub:
 * on-hand/available quantity lands with the stock ledger (PHASE-010 stock
 * posting); at PHASE-006 nothing is posted, so the hook reports
 * `available: null` with the explicit `STOCK_POSTS_IN_PHASE_010` basis rather
 * than fabricating a zero. ItemPicker hosts render the basis label instead of
 * a misleading 0.
 */
import { useEffect } from "react";

export interface StockAvailabilityState {
  itemId?: string;
  /** Always null at this phase — no stock postings exist yet. */
  available: null;
  /** Honest disclosure: the stock ledger ships with PHASE-010. */
  basis: "STOCK_POSTS_IN_PHASE_010";
  loading: false;
  error: null;
}

export function useStockAvailability(itemId: string | undefined): StockAvailabilityState {
  // Identity-stable no-op subscription: keeps the contract future-proof for
  // the PHASE-010 wiring without fetching anything today.
  useEffect(() => {
    void itemId;
    return () => undefined;
  }, [itemId]);
  return { itemId, available: null, basis: "STOCK_POSTS_IN_PHASE_010", loading: false, error: null };
}
