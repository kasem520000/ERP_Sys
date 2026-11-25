"use client";

/**
 * PHASE-051 (W-39 — T-14, D-17) — THE INCOTERM SELECTOR: the shared
 * piece embedded in the PO/SO create forms. BR-106's mandate is
 * server-side (the order's own posting gate — the typed
 * ORDER_INCOTERM_REQUIRED refusal); the selector is the honest input
 * surface: the registry's ACTIVE rows (fetched ONCE by the host page,
 * degrading to [] on its own 403 — the job-cards rule) + THE RISK-HINT
 * MATRIX rendered at selection time VERBATIM (the API's own
 * renderIncotermMatrix output — zero parallel computation; the AR side
 * on the Arabic locale, the EN side on the English one).
 */
import type { JSX } from "react";

import { Select } from "@erp/ui";

import { getDictionary, type Locale } from "../i18n/dictionaries";
import type { TradeIncotermRow } from "../lib/api-types";
import { localizedName } from "../lib/messages";

export function IncotermSelector({
  locale,
  incoterms,
  value,
  onValueChange,
}: {
  locale: Locale;
  incoterms: readonly TradeIncotermRow[];
  value: string;
  onValueChange: (code: string) => void;
}): JSX.Element {
  const d = getDictionary(locale);
  const selected = incoterms.find((row) => row.code === value) ?? null;
  return (
    <div className="flex flex-col gap-2">
      <Select
        label={d.tradeIncotermSelectorLabel}
        value={value}
        onValueChange={onValueChange}
        placeholder={d.tradeIncotermSelectorPlaceholder}
        options={[
          { value: "", label: d.tradeIncotermSelectorPlaceholder },
          ...incoterms.map((row) => ({
            value: row.code,
            label: `${row.code} · ${localizedName(row.name, row.nameAr, locale)}`,
          })),
        ]}
      />
      {/* The mandate's own hint (BR-106's trigger reading — never the
          enforcement, which rides the server-side gate). */}
      <p className="text-xs text-muted-foreground">{d.tradeIncotermSelectorHint}</p>
      {/* THE RISK-HINT MATRIX — the API's own output rendered VERBATIM at
          selection time (D-10: the five ownership axes; the active
          locale's side). */}
      {selected !== null ? (
        <div
          className="rounded-md border border-subtle bg-gray-50 px-3 py-2"
          role="status"
          lang={locale}
        >
          <p className="text-xs font-semibold text-gray-700">
            {d.tradeIncotermSelectorMatrixTitle} — {selected.code}
          </p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {(locale === "ar" ? selected.matrix.ar : selected.matrix.en).map((line) => (
              <li key={line} className="text-xs text-gray-600">
                {line}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
