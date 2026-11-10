"use client";
/**
 * PHASE-021 T2-b · ConnectivityDot (DR-P21-06/§6): the live connectivity
 * marker — online/offline from the shell's connectivity watcher (or
 * navigator.onLine in a browser). A LABEL surface only: going offline
 * never fakes queued work; the console's honesty comes from the store.
 */
import type { JSX } from "react";

import { getDictionary, type Locale } from "../../i18n/dictionaries";

export function ConnectivityDot({ locale, online }: { locale: Locale; online: boolean }): JSX.Element {
  const d = getDictionary(locale);
  return (
    <span
      role="status"
      lang={locale}
      className="inline-flex items-center gap-2 text-sm text-gray-700"
    >
      <span
        aria-hidden="true"
        className={`inline-block h-2.5 w-2.5 rounded-full ${
          online ? "bg-success-700" : "bg-gray-400"
        }`}
      />
      <span>{online ? d.offlineOnlineLabel : d.offlineOfflineLabel}</span>
    </span>
  );
}
