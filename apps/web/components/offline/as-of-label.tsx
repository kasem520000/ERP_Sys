"use client";
/**
 * PHASE-021 T2-b · AsOfLabel (DR-P21-06/§6; matrix rows 4/5/13/33): the
 * cache as-of stamp — "last synced {time}", derived from
 * MAX(cursors.synced_at). Stale is labeled, never guessed
 * (OFFLINE_ARCHITECTURE §5.2); a never-synced store says so honestly.
 */
import type { JSX } from "react";

import { formatMessage } from "../../lib/messages";
import { getDictionary, type Locale } from "../../i18n/dictionaries";

export function AsOfLabel({ locale, asOf }: { locale: Locale; asOf: number | null }): JSX.Element {
  const d = getDictionary(locale);
  if (asOf === null) {
    return (
      <span lang={locale} className="text-sm text-gray-500">
        {d.offlineAsOfNever}
      </span>
    );
  }
  const formatted = new Date(asOf).toLocaleString(locale === "ar" ? "ar" : "en-GB", {
    dateStyle: "short",
    timeStyle: "short",
  });
  return (
    <span lang={locale} className="text-sm text-gray-600">
      {formatMessage(d.offlineAsOfLabel, { time: formatted })}
    </span>
  );
}
