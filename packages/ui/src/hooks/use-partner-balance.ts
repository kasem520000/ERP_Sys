"use client";

/**
 * usePartnerBalance (COMPONENT_CATALOG §9; P6-T11a) — read-only partner
 * balance + credit-limit pre-screening state for PartnerPicker hosts.
 *
 * Headless by contract: the hook never fetches (the @erp/ui surface has no
 * app fetcher); the app injects a `fetchBalance` that resolves the snapshot
 * (apps/web binds it to the BFF's `partners/partners/:id/balance`). Money is
 * canonical decimal strings (ADR-0009).
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** GET partners/:id/balance → data. `basis` is DRAFTS_ONLY at PHASE-006. */
export interface PartnerBalanceSnapshot {
  openBalance: string;
  draftBalance: string;
  overdueAmount: string;
  /** Honest disclosure label for the balance read-model source. */
  basis: "DRAFTS_ONLY";
}

export interface PartnerBalanceState {
  balance: PartnerBalanceSnapshot | null;
  loading: boolean;
  error: string | null;
  /** Re-run the fetch for the current partnerId (e.g. after a draft change). */
  refresh: () => void;
}

export function usePartnerBalance(
  partnerId: string | undefined,
  fetchBalance: ((id: string) => Promise<PartnerBalanceSnapshot | null>) | undefined,
): PartnerBalanceState {
  const [balance, setBalance] = useState<PartnerBalanceSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const runRef = useRef(0);

  useEffect(() => {
    if (partnerId === undefined || partnerId === "" || fetchBalance === undefined) {
      setBalance(null);
      setLoading(false);
      setError(null);
      return;
    }
    const run = runRef.current + 1;
    runRef.current = run;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchBalance(partnerId)
      .then((snapshot) => {
        if (cancelled || run !== runRef.current) return;
        setBalance(snapshot);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled || run !== runRef.current) return;
        setBalance(null);
        setError("balance unavailable");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [partnerId, fetchBalance, nonce]);

  const refresh = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  return { balance, loading, error, refresh };
}
