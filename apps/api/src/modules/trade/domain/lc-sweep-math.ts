/**
 * PHASE-051 (W-34 — T-06, 2026-11-25) THE TRADE-EXPIRY SWEEP'S PURE
 * ARITHMETIC (D-09 — the 0111/calibration pattern's 051 extension,
 * BR-105's own fold; THIS module's own home, no cross-module domain
 * import, the quality calibration-sweep-math sibling):
 *
 *   THE WINDOWS (the tenant-configurable threshold ladder — the trade
 *   module's own settings keys, `trade.lc_expiry_sweep_thresholds`): the
 *   documented fail-closed default [30,14,7,1] — BR-105's own ladder
 *   (the phase doc §2 names the four days verbatim; red line 5: tenant
 *   data, never hard-coded law). The normalize fold keeps integer
 *   day-values ≥ 0, drops duplicates, sorts DESCENDING — an
 *   empty/garbage residue reads as the documented default (a tenant who
 *   registers garbage never silently disables the sweep; the
 *   fail-closed direction). Pure: no clock, no store.
 *
 *   THE BANDS (the disjoint fold, the 0111/quality shape): each LC falls
 *   in EXACTLY ONE band per pass — `fromDays < daysToExpiry <= toDays`,
 *   the TIGHTEST band's lower edge open (an already-expired instrument
 *   stays caught: an expired LC is exactly the exposure the alert and
 *   the sweep's own expiry transition exist for). No catch-up ladder for
 *   a late-registered LC; across nights an LC descends band by band —
 *   30 → 14 → 7 → 1 — firing each threshold pass exactly once.
 *
 *   THE DEDUPE KEYS (D-09's own axes — «per LC+window+day»):
 *   `trade:lc:{lcId}:{threshold}:{expiryDate}` — the structural
 *   uq_notifications_dedupe on (tenant_id, dedupe_key) makes the
 *   once-per-pass semantics STRUCTURAL, never application-level. THE DAY
 *   AXIS is the EXPIRY DATE the alert names (never the current day — the
 *   convergence law forbids a per-day accumulation: re-runs, the nightly
 *   cron, and a raced concurrent pass all CONVERGE within a cycle). The
 *   discrepancy alert rides the same axes with its own marker:
 *   `trade:lc:{lcId}:disc:{threshold}:{expiryDate}` — the open
 *   discrepancies (unverified documents carrying notes) name the same
 *   instrument, the same band, the same day; both families converge
 *   independently.
 *
 *   THE SEVERITY LADDER (the S-15 shape): info at the ≥ 30-day bands,
 *   warning below — the far horizon is context, the near one is urgent.
 *
 *   THE CLOCK LAW (the owner's standing order: «ساعة مثبتة أو خطوة مشتقة
 *   — لا Date.now()+دلتا أبدًا»): this layer is PURE — the band edges
 *   are day-values only; the probe derives the dates in SQL from the
 *   database's own CURRENT_DATE (the derived step), never from JS
 *   wall-clock arithmetic. No Date.now() anywhere in the sweep's path.
 */

/** The documented default threshold list — BR-105's own ladder
 * (30/14/7/1, the phase doc §2's verbatim days); the settings registry
 * key `trade.lc_expiry_sweep_thresholds` carries the same default (one
 * source, two declarations, the 0099 precedent's constant law); this
 * constant is what a tenant with NO stored row fails closed to. */
export const DEFAULT_LC_EXPIRY_WINDOWS: readonly number[] = Object.freeze([30, 14, 7, 1]);

/**
 * Normalize a configured threshold list into the sweep's window set
 * (the quality normalize fold's own copy — this module's own home): keep
 * integer day-values ≥ 0 (actual numbers, plus STRICT integer strings
 * only — null/bool/floats/garbage all DROP, never coerce: Number(null)
 * === 0 would FABRICATE a 0-day window — the honest fold refuses the
 * coercion class entirely), drop duplicates, sort DESCENDING. Garbage
 * never disables (an empty residue reads as the documented default).
 */
const INTEGER_STRING_RE = /^(0|[1-9][0-9]*)$/;

function parseWindowValue(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === "string" && INTEGER_STRING_RE.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return null;
}

export function normalizeLcSweepWindows(input: readonly unknown[]): number[] {
  const windows = [
    ...new Set(
      input
        .map((value) => parseWindowValue(value))
        .filter((days): days is number => days !== null),
    ),
  ].sort((a, b) => b - a);
  return windows.length > 0 ? windows : [...DEFAULT_LC_EXPIRY_WINDOWS];
}

/** One disjoint day-band of the sweep: LCs with
 * `fromDays < daysToExpiry <= toDays` — except the TIGHTEST band, whose
 * lower edge is open (already-expired instruments stay caught). */
export interface LcSweepBand {
  /** The band's threshold — the dedupe key's {threshold} axis. */
  readonly threshold: number;
  /** The exclusive lower edge in days-to-expiry (null = no floor — the
   * tightest band catches everything at or past its date). */
  readonly fromDays: number | null;
  /** The inclusive upper edge in days-to-expiry. */
  readonly toDays: number;
}

/** Fold the (descending) window set into DISJOINT bands. Each LC falls
 * in EXACTLY ONE band per pass — the whole no-double-fire law is this
 * fold's own shape. */
export function lcSweepBands(windows: readonly number[]): LcSweepBand[] {
  const descending = normalizeLcSweepWindows(windows);
  const bands: LcSweepBand[] = [];
  for (let index = 0; index < descending.length; index += 1) {
    const toDays = descending[index]!;
    const fromDays = index === descending.length - 1 ? null : descending[index + 1]!;
    bands.push({ threshold: toDays, fromDays, toDays });
  }
  return bands;
}

/** The band an LC's days-to-expiry falls in (null = outside every band
 * — farther than the widest window; the pure fold the probe's SQL
 * mirrors). */
export function lcSweepBandFor(
  bands: readonly LcSweepBand[],
  daysToExpiry: number,
): LcSweepBand | null {
  for (const band of bands) {
    if (daysToExpiry <= band.toDays && (band.fromDays === null || daysToExpiry > band.fromDays)) {
      return band;
    }
  }
  return null;
}

/**
 * The expiry alert's dedupe key — D-09's own axes «per LC+window+day»:
 * `trade:lc:{lcId}:{threshold}:{expiryDate}`. The instrument is the LC;
 * the window is the band's threshold; the DAY is the expiry date the
 * alert names — never the current day (the convergence law). */
export function lcExpiryDedupeKey(input: {
  readonly lcId: string;
  readonly threshold: number;
  readonly expiryDate: string;
}): string {
  return `trade:lc:${input.lcId}:${input.threshold}:${input.expiryDate}`;
}

/**
 * The discrepancy alert's dedupe key — the same axes with the disc
 * marker: `trade:lc:{lcId}:disc:{threshold}:{expiryDate}`. The open
 * discrepancies (unverified documents carrying notes) name the same
 * instrument, band and day; the marker keeps the two families' keys
 * disjoint so an expiry alert never suppresses a discrepancy alert (or
 * the converse) — both converge independently within a cycle. */
export function lcDiscrepancyDedupeKey(input: {
  readonly lcId: string;
  readonly threshold: number;
  readonly expiryDate: string;
}): string {
  return `trade:lc:${input.lcId}:disc:${input.threshold}:${input.expiryDate}`;
}

/** The S-15 severity ladder: info at the ≥ 30-day bands (the far
 * horizon — context), warning below (the near one — urgent). */
export function lcSweepSeverity(threshold: number): "info" | "warning" {
  return threshold >= 30 ? "info" : "warning";
}
