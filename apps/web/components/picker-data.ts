"use client";

/**
 * P6-T11b — picker option wiring for the @erp/ui pickers (PartnerPicker /
 * ItemPicker are headless by contract: the app supplies options + search).
 * Each hook loads the first list page on mount and re-resolves through the
 * trigram search endpoints (≥2 chars); a run counter drops stale responses.
 * Labels are active-locale bilingual names; code/SKU ride as mono meta.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { PickerOption } from "@erp/ui";

import type { Locale } from "../i18n/dictionaries";
import type { ItemRow, PartnerRow } from "../lib/api-types";
import { bffFetch } from "../lib/client-api";
import { localizedName } from "../lib/messages";

export interface PickerOptionsState {
  options: PickerOption[];
  onSearch: (query: string) => void;
  loading: boolean;
}

const SEARCH_MIN_CHARS = 2;

export function usePartnerPickerOptions(locale: Locale, limit = 25): PickerOptionsState {
  const [options, setOptions] = useState<PickerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const runRef = useRef(0);

  const resolve = useCallback(
    async (rows: readonly PartnerRow[]): Promise<void> => {
      setOptions(
        rows.map((partner) => ({
          id: partner.id,
          label: localizedName(partner.name, partner.nameAr, locale),
          labelAr: partner.nameAr ?? undefined,
          meta: partner.code,
        })),
      );
    },
    [locale],
  );

  useEffect(() => {
    const run = runRef.current + 1;
    runRef.current = run;
    setLoading(true);
    void bffFetch<readonly PartnerRow[]>(`partners/partners?limit=${limit}`).then((result) => {
      if (run !== runRef.current) return; // stale response
      setLoading(false);
      if (result.ok) void resolve(result.data);
    });
  }, [limit, resolve]);

  const onSearch = useCallback(
    (query: string) => {
      const trimmed = query.trim();
      if (trimmed.length < SEARCH_MIN_CHARS) return; // combobox shows the full initial page
      const run = runRef.current + 1;
      runRef.current = run;
      setLoading(true);
      void bffFetch<readonly PartnerRow[]>(
        `partners/search?q=${encodeURIComponent(trimmed)}`,
      ).then((result) => {
        if (run !== runRef.current) return; // stale response
        setLoading(false);
        if (result.ok) void resolve(result.data);
      });
    },
    [resolve],
  );

  return { options, onSearch, loading };
}

export function useItemPickerOptions(locale: Locale, limit = 100): PickerOptionsState {
  const [options, setOptions] = useState<PickerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const runRef = useRef(0);

  const resolve = useCallback(
    async (rows: readonly ItemRow[]): Promise<void> => {
      setOptions(
        rows.map((item) => ({
          id: item.id,
          label: localizedName(item.name, item.nameAr, locale),
          labelAr: item.nameAr ?? undefined,
          meta: item.sku,
        })),
      );
    },
    [locale],
  );

  useEffect(() => {
    const run = runRef.current + 1;
    runRef.current = run;
    setLoading(true);
    void bffFetch<readonly ItemRow[]>(`items/items?limit=${limit}`).then((result) => {
      if (run !== runRef.current) return; // stale response
      setLoading(false);
      if (result.ok) void resolve(result.data);
    });
  }, [limit, resolve]);

  const onSearch = useCallback(
    (query: string) => {
      const trimmed = query.trim();
      if (trimmed.length < SEARCH_MIN_CHARS) return; // combobox shows the full initial page
      const run = runRef.current + 1;
      runRef.current = run;
      setLoading(true);
      void bffFetch<readonly ItemRow[]>(`items/search?q=${encodeURIComponent(trimmed)}`).then(
        (result) => {
          if (run !== runRef.current) return; // stale response
          setLoading(false);
          if (result.ok) void resolve(result.data);
        },
      );
    },
    [resolve],
  );

  return { options, onSearch, loading };
}
