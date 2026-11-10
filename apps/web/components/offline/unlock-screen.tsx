"use client";
/**
 * PHASE-021 T2-b · the unlock screen (MASTER-PLAN §4.3 / SECURITY §5 —
 * offline authorization; D-04): reads the cached permission snapshot via
 * store-client.unlockSnapshot() — within 7 days of the watermark the
 * unlock grants FULL console access per the cached key set (listed
 * honestly, derived never authoritative); beyond it the app degrades to
 * read-only + online-required; with no snapshot at all the same
 * read-only verdict with the NO_SNAPSHOT reason. In a browser there is
 * no local store — read-only + online required, honestly.
 */
import { useEffect, useState } from "react";
import type { JSX } from "react";

import { formatMessage } from "../../lib/messages";
import { getDictionary, type Locale } from "../../i18n/dictionaries";
import { useShell } from "../../lib/shell/bridge";
import { unlockSnapshot, type UnlockDecision } from "../../lib/shell/store-client";

export function UnlockScreen({ locale }: { locale: Locale }): JSX.Element {
  const d = getDictionary(locale);
  const { bridge, mode } = useShell();
  const [decision, setDecision] = useState<UnlockDecision | null>(null);

  useEffect(() => {
    if (bridge === null || bridge.capabilities.sqlite !== true) {
      setDecision(null);
      return;
    }
    let cancelled = false;
    void unlockSnapshot(bridge).then((result) => {
      if (!cancelled) setDecision(result);
    });
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const isFull = decision !== null && decision.mode === "full";
  const snapshotText =
    decision !== null && "snapshotAt" in decision
      ? formatMessage(d.unlockSnapshotAt, { date: decision.snapshotAt.toISOString().slice(0, 19) })
      : null;
  const reasonText =
    decision === null
      ? mode === "browser"
        ? d.unlockBrowserNote
        : d.unlockReasonNone
      : decision.mode === "readonly" && decision.reason === "SNAPSHOT_EXPIRED"
        ? d.unlockReasonExpired
        : d.unlockReasonNone;

  return (
    <div lang={locale} dir={locale === "ar" ? "rtl" : "ltr"} className="flex flex-col gap-5">
      <p className="max-w-3xl text-sm leading-6 text-gray-700">{d.unlockIntro}</p>
      <p className="max-w-3xl text-sm leading-6 text-gray-600">{d.unlockRuleNote}</p>

      <div
        role="status"
        className={`flex flex-col gap-2 rounded-lg border p-4 ${
          isFull
            ? "border-success-border bg-success-bg text-success-text"
            : "border-warning-border bg-warning-bg text-warning-text"
        }`}
      >
        <span className="text-md font-semibold">
          {isFull ? d.unlockModeFull : d.unlockModeReadOnly}
        </span>
        <span className="text-sm">{reasonText}</span>
        {snapshotText !== null && (
          <span dir="ltr" className="font-mono text-xs">
            {snapshotText}
          </span>
        )}
      </div>

      {isFull && decision.mode === "full" && (
        <section className="flex flex-col gap-2 rounded-lg border border-subtle bg-surface-card p-4">
          <h2 className="text-md font-semibold text-gray-900">{d.unlockPermissionsHeading}</h2>
          <ul className="flex max-h-48 flex-wrap gap-1 overflow-y-auto" dir="ltr">
            {decision.permissions.map((key) => (
              <li
                key={key}
                className="rounded-sm border border-subtle bg-surface-sunken px-1.5 py-0.5 font-mono text-xs text-gray-700"
              >
                {key}
              </li>
            ))}
          </ul>
          {decision.permissions.length === 0 && (
            <p className="text-sm text-gray-500">—</p>
          )}
        </section>
      )}

      <a
        lang={locale}
        href={`/${locale}/offline`}
        className="inline-flex w-fit min-h-11 items-center rounded-md border border-default bg-surface-card px-3 text-sm font-medium text-gray-800 underline-offset-2 hover:border-strong hover:underline"
      >
        {d.unlockGoOffline}
      </a>
    </div>
  );
}
