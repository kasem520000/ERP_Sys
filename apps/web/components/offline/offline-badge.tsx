"use client";
/**
 * PHASE-021 T2-b · OfflineBadge (DR-P21-06/§6): the console's phase badge —
 * the webview mirror of 2-a's HostState (browser/idle/syncing/read-only/
 * revoked/corrupt) plus the queue depth. State honesty: the label renders
 * exactly what the store says, never an optimistic "synced".
 */
import type { JSX } from "react";

import { getDictionary, type Locale } from "../../i18n/dictionaries";
import type { SyncMirrorPhase } from "../../lib/shell/sync-mirror";

export function OfflineBadge({
  locale,
  phase,
  queueDepth,
}: {
  locale: Locale;
  phase: SyncMirrorPhase;
  queueDepth: number;
}): JSX.Element {
  const d = getDictionary(locale);
  const label =
    phase === "browser"
      ? d.offlinePhaseBrowser
      : phase === "idle"
        ? d.offlinePhaseIdle
        : phase === "syncing"
          ? d.offlinePhaseSyncing
          : phase === "read-only"
            ? d.offlinePhaseReadOnly
            : phase === "revoked"
              ? d.offlinePhaseRevoked
              : d.offlinePhaseCorrupt;
  const tone =
    phase === "read-only"
      ? "border-warning-border bg-warning-bg text-warning-text"
      : phase === "revoked" || phase === "corrupt"
        ? "border-danger-border bg-danger-bg text-danger-text"
        : phase === "syncing"
          ? "border-default bg-surface-sunken text-gray-700"
          : "border-subtle bg-surface-card text-gray-700";
  return (
    <span
      lang={locale}
      className={`inline-flex items-center gap-2 rounded-sm border px-2 py-1 text-xs font-medium ${tone}`}
    >
      <span aria-hidden="true" className={phase === "syncing" ? "animate-pulse" : undefined}>
        ●
      </span>
      <span>{label}</span>
      {queueDepth > 0 && (
        <span
          dir={locale === "ar" ? "rtl" : "ltr"}
          className="ms-1 rounded-full border border-default bg-surface-card px-1.5 font-mono text-xs tabular-nums text-gray-700"
        >
          {d.offlineQueueLabel} {queueDepth}
        </span>
      )}
    </span>
  );
}
