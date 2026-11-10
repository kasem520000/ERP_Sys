"use client";

/**
 * useItemPricing (COMPONENT_CATALOG §9; P6-T11a) — price-resolution state for
 * ItemPicker / LineItemsEditor hosts: resolves the unit price for
 * (item, partner?, branch?, uom?, qty?) through the app-injected resolver
 * (apps/web binds it to the BFF's `items/resolve-price` — BR-003 service
 * endpoint). Money is canonical decimal strings (ADR-0009).
 */
import { useEffect, useRef, useState } from "react";

export interface ItemPriceRequest {
  itemId: string;
  partnerId?: string;
  branchId?: string;
  uomId?: string;
  qty?: string;
}

export interface ItemPriceResolution {
  unitPrice: string;
  source: "CUSTOMER_PRICE_LIST" | "DEFAULT_PRICE_LIST" | "BASE_PRICE";
  priceListId: string | null;
  appliedUomId: string;
  baseUomId: string;
  conversionFactor: string;
  manualOverrideAllowed: boolean;
  basis: string;
}

export interface ItemPricingState {
  resolution: ItemPriceResolution | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useItemPricing(
  request: ItemPriceRequest | undefined,
  resolvePrice: ((req: ItemPriceRequest) => Promise<ItemPriceResolution | null>) | undefined,
): ItemPricingState {
  const [resolution, setResolution] = useState<ItemPriceResolution | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const runRef = useRef(0);
  const requestKey = request === undefined ? "" : JSON.stringify(request);

  useEffect(() => {
    const parsed = requestKey === "" ? undefined : (JSON.parse(requestKey) as ItemPriceRequest);
    if (parsed === undefined || resolvePrice === undefined || parsed.itemId === "") {
      setResolution(null);
      setLoading(false);
      setError(null);
      return;
    }
    const run = runRef.current + 1;
    runRef.current = run;
    let cancelled = false;
    setLoading(true);
    setError(null);
    resolvePrice(parsed)
      .then((result) => {
        if (cancelled || run !== runRef.current) return;
        setResolution(result);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled || run !== runRef.current) return;
        setResolution(null);
        setError("price resolution unavailable");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey, resolvePrice, nonce]);

  return { resolution, loading, error, refresh: () => setNonce((n) => n + 1) };
}
