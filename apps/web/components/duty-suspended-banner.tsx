/**
 * PHASE-051 (W-39 — T-14, D-17) — THE DUTY-SUSPENDED BANNER: the shared
 * presentational piece that surfaces G-66's suspended stock (the bonded
 * register's EXECUTED IN_BOND moves) on every bonded-bearing inventory
 * host surface. Server-compatible (no "use client", no state): the host
 * page fetches the moves ONCE (GET trade/bonded/moves
 * ?moveKind=IN_BOND&status=EXECUTED&limit=200) and hands the relevant
 * row in; a tenant without the trade entitlement (403 on that read)
 * degrades to no banners — the banner is ADDITIVE on host surfaces,
 * never a typed refusal there (the 050 hold-banner pattern).
 *
 * THE ENGINE-OUTPUT LAW: the move's own figures render VERBATIM — the
 * moveNo, the line's own quantity under bond, the executedAt timestamp
 * (the engine's own string as-is in an LTR-mono isolation) — zero
 * client-side arithmetic, never a recomputed suspended balance (the
 * engine's bond ledger owns that figure).
 */
import type { JSX } from "react";

import type { Dictionary, Locale } from "../i18n/dictionaries";
import type { TradeBondedMoveRow } from "../lib/api-types";

/** The row-level chip (the lean host wiring: the stock rows badge
 * suspended items before any selection expands the full banner). */
export function DutySuspendedChip({ label }: { label: string }): JSX.Element {
  return (
    <span className="ms-2 inline-flex w-fit items-center rounded-sm border border-warning-border bg-warning-bg px-1.5 py-0.5 text-xs leading-4 text-warning-text">
      {label}
    </span>
  );
}

export function DutySuspendedBanner({
  move,
  qty,
  locale,
  d,
}: {
  move: TradeBondedMoveRow | null;
  /** The item's own quantity under bond — the MOVE LINE's own figure
   * (the host hands the engine's own string; never a client-side sum). */
  qty: string | null;
  locale: Locale;
  d: Dictionary;
}): JSX.Element | null {
  if (move === null) {
    return null;
  }
  return (
    <div
      role="status"
      lang={locale}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm text-warning-text"
    >
      <span className="font-semibold">{d.tradeDutySuspendedBannerTitle}</span>
      {/* The register's own figures, VERBATIM. */}
      <span className="flex items-center gap-1">
        {d.tradeDutySuspendedMove}:{" "}
        <span className="font-mono tabular-nums" dir="ltr">
          {move.moveNo}
        </span>
      </span>
      {qty !== null ? (
        <span className="flex items-center gap-1">
          {d.tradeDutySuspendedQty}:{" "}
          <span className="font-mono tabular-nums" dir="ltr">
            {qty}
          </span>
        </span>
      ) : null}
      {move.executedAt !== null ? (
        <span className="flex items-center gap-1">
          {d.tradeDutySuspendedExecutedAt}:{" "}
          <span className="font-mono tabular-nums" dir="ltr">
            {move.executedAt}
          </span>
        </span>
      ) : null}
    </div>
  );
}
