"use client";
/**
 * PHASE-021 T2-b · OnlineOnlyDisabled (DR-P21-06/§6; OFFLINE_CAPABILITIES
 * MATRIX rows 15–20/22/24/30/36 — "disabled in the UI with the reason
 * 'requires connection'; no simulated/queued behavior is permitted"):
 *
 * The console's browser-mode and capability-missing posture. The reason is
 * a dictionary key (AR/EN); the component renders the disabled state and
 * the reason, and NEVER queues. Optional children render inert below the
 * reason (aria-disabled) — e.g. a preview of the form that would exist.
 */
import type { JSX, ReactNode } from "react";

import { getDictionary, type Dictionary, type Locale } from "../../i18n/dictionaries";

export function OnlineOnlyDisabled({
  locale,
  reason,
  reasonIsKey = false,
  children,
}: {
  locale: Locale;
  /** Either a dictionary key (reasonIsKey) or a ready bilingual string. */
  reason: keyof Dictionary | string;
  reasonIsKey?: boolean;
  children?: ReactNode;
}): JSX.Element {
  const d = getDictionary(locale);
  const text = reasonIsKey ? d[reason as keyof Dictionary] : (reason as string);
  return (
    <div
      lang={locale}
      dir={locale === "ar" ? "rtl" : "ltr"}
      role="note"
      className="flex flex-col gap-3 rounded-lg border border-subtle bg-surface-sunken p-4"
    >
      <span className="inline-flex w-fit items-center rounded-sm border border-default bg-surface-card px-2 py-1 text-xs font-medium text-gray-700">
        {d.offlineOnlineOnlyTitle}
      </span>
      <p className="text-sm leading-6 text-gray-700">{text}</p>
      {children !== undefined && (
        <div aria-disabled="true" dir="ltr" className="rounded-md border border-subtle bg-surface-card p-3 opacity-60">
          {children}
        </div>
      )}
    </div>
  );
}
