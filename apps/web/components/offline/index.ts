"use client";
/**
 * PHASE-021 T2-b (DR-P21-06 / MASTER-PLAN §6) — the six shared, browser-
 * safe, bilingual AR/EN offline components. Every one is capability-honest:
 * labels only, never a simulated offline behavior (OFFLINE_ARCHITECTURE §5).
 */
import type { Locale } from "../../i18n/dictionaries";

export { ConnectivityDot } from "./connectivity-dot";
export { OfflineBadge } from "./offline-badge";
export { AsOfLabel } from "./as-of-label";
export { OnlineOnlyDisabled } from "./online-only-disabled";
export { HonestStateBadge, OutboxStatusBadge } from "./honest-state-badge";
export { SyncNowButton } from "./sync-now-button";

/** The dir for a locale (the [locale] layout owns <html dir>; embedded
 * surfaces pass it down for local corrections). */
export function dirFor(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}
