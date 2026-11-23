/**
 * PHASE-050 (W-29 — T-15) — THE BATCH-HOLD BANNER: the shared presentational
 * piece that surfaces an ACTIVE quality hold (INV-035's register) on every
 * batch-bearing host surface. Server-compatible (no "use client", no
 * state): the host page fetches the holds ONCE (GET quality/holds
 * ?status=ACTIVE&limit=200) and hands the relevant row in; a tenant without
 * the quality entitlement (403 on that read) degrades to no banners — the
 * banner is ADDITIVE on host surfaces, never a typed refusal there.
 *
 * THE ENGINE-OUTPUT LAW: the hold's own reason renders VERBATIM (the
 * register's text, never a summary) and heldAt is the engine's own string
 * as-is in an LTR-mono isolation — zero client-side date arithmetic.
 */
import type { JSX } from "react";

import type { Dictionary, Locale } from "../i18n/dictionaries";
import type { BatchQualityHoldRow } from "../lib/api-types";

/** The row-level chip (the lean host wiring: the batch rows badge held
 * batches before any selection expands the full banner). */
export function BatchHoldChip({ label }: { label: string }): JSX.Element {
  return (
    <span className="ms-2 inline-flex w-fit items-center rounded-sm border border-warning-border bg-warning-bg px-1.5 py-0.5 text-xs leading-4 text-warning-text">
      {label}
    </span>
  );
}

export function BatchHoldBanner({
  hold,
  locale,
  d,
}: {
  hold: BatchQualityHoldRow | null;
  locale: Locale;
  d: Dictionary;
}): JSX.Element | null {
  if (hold === null) {
    return null;
  }
  return (
    <div
      role="status"
      lang={locale}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning-text"
    >
      <span className="font-semibold">{d.qualityHoldBannerTitle}</span>
      {/* The register's own reason, VERBATIM. */}
      <span>{hold.reason}</span>
      <span className="flex items-center gap-1">
        {d.qualityHoldHeldAt}:{" "}
        <span className="font-mono tabular-nums" dir="ltr">
          {hold.heldAt}
        </span>
      </span>
      {hold.ncrId !== null ? (
        <span className="flex items-center gap-1">
          {d.qualityHoldNcr}:{" "}
          <a
            href={`/${locale}/quality/ncr`}
            className="font-mono underline-offset-2 hover:underline"
            dir="ltr"
          >
            {hold.ncrId}
          </a>
        </span>
      ) : null}
    </div>
  );
}
