"use client";
/**
 * PHASE-021 T2-b · SyncNowButton (DR-P21-09/§6): the manual sync/push
 * trigger, GATED on capabilities.sync (the optional bridge.sync member —
 * older shells predate it). When the capability is absent the button
 * renders DISABLED with the honest unavailable reason — never a silent
 * no-op, never a simulated cycle. The engine itself lives in the shell
 * runtime; this control only invokes bridge.sync.
 */
import type { JSX } from "react";

import { Button } from "@erp/ui";

import { getDictionary, type Locale } from "../../i18n/dictionaries";

export function SyncNowButton({
  locale,
  variant,
  available,
  busy = false,
  disabled = false,
  onClick,
}: {
  locale: Locale;
  /** "sync" = full cycle (pull+push); "push" = the post-write fast push. */
  variant: "sync" | "push";
  /** capabilities.sync === true (DR-P21-09). */
  available: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}): JSX.Element {
  const d = getDictionary(locale);
  const label = variant === "sync" ? d.offlineSyncNow : d.offlinePushNow;
  if (!available) {
    return (
      <span lang={locale} className="inline-flex flex-col gap-1">
        <Button variant="secondary" disabled aria-disabled="true">
          {label}
        </Button>
        <span className="text-xs text-gray-500">{d.offlineSyncUnavailable}</span>
      </span>
    );
  }
  return (
    <Button
      variant="secondary"
      iconStart={variant === "sync" ? "arrow-left-right" : "send"}
      loading={busy}
      disabled={disabled || busy}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}
