/**
 * PHASE-050 (W-26 — T-08, 2026-11-23) THE CALIBRATION SWEEP'S PURE
 * ARITHMETIC (the cmms-sweep-math quality sibling — THIS module's own
 * home, no cross-module domain import, the 0111 pattern's W-26 extension
 * D-08 ordered):
 *
 *   THE WINDOWS (the tenant-configurable threshold ladder — the FIRST 050
 *   SETTINGS KEYS, `quality.calibration_sweep_thresholds`): the
 *   documented fail-closed default [30,7,0] (red line 5: tenant data,
 *   never hard-coded law); the normalize fold keeps integer day-values
 *   ≥ 0, drops duplicates, sorts DESCENDING — an empty/garbage residue
 *   reads as the documented default (a tenant who registers garbage never
 *   silently disables the sweep; the fail-closed direction). Pure: no
 *   clock, no store.
 *
 *   THE BANDS (the disjoint fold, the 0111 shape): each instrument falls
 *   in EXACTLY ONE band per pass — `fromDays < daysToDue <= toDays`, the
 *   TIGHTEST band's lower edge open (an already-overdue instrument stays
 *   caught: overdue calibration is exactly the exposure the alert exists
 *   for). No catch-up ladder for a late-registered instrument; across
 *   nights an instrument descends band by band — 30 → 7 → 0 — firing
 *   each threshold pass exactly once.
 *
 *   THE DEDUPE KEY (D-08's own axes — «per instrument+window+day»):
 *   `quality:calibration:{assetId}:{threshold}:{dueDate}` — the
 *   structural uq_notifications_dedupe on (tenant_id, dedupe_key) makes
 *   the once-per-pass semantics STRUCTURAL, never application-level.
 *   THE DAY AXIS is the DUE DATE the alert names (never the current day
 *   — the convergence law forbids a per-day accumulation: re-runs, the
 *   nightly cron, and a raced concurrent pass all CONVERGE within a
 *   cycle). The day axis is what lets an instrument RE-ALERT across its
 *   calibration cycles: a re-calibrated instrument carries a NEW due
 *   date, the new cycle's bands form NEW keys, and the next cycle alerts
 *   again — the cmms once-ever shape would go silent after one cycle
 *   exactly where a calibration program lives on cycles (the declared
 *   W-26 interpretation of D-08's "+day" axis, the wave README's table).
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

/** The documented default threshold list — the settings registry key
 * `quality.calibration_sweep_thresholds` carries the same default (one
 * source, two declarations, the 0099 precedent's constant law); this
 * constant is what a tenant with NO stored row fails closed to. */
export const DEFAULT_CALIBRATION_SWEEP_WINDOWS: readonly number[] = Object.freeze([30, 7, 0]);

/**
 * Normalize a configured threshold list into the sweep's window set
 * (the cmms normalize fold's own copy — this module's own home): keep
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

export function normalizeCalibrationSweepWindows(input: readonly unknown[]): number[] {
  const windows = [
    ...new Set(
      input
        .map((value) => parseWindowValue(value))
        .filter((days): days is number => days !== null),
    ),
  ].sort((a, b) => b - a);
  return windows.length > 0 ? windows : [...DEFAULT_CALIBRATION_SWEEP_WINDOWS];
}

/** One disjoint day-band of the sweep: instruments with
 * `fromDays < daysToDue <= toDays` — except the TIGHTEST band, whose
 * lower edge is open (already-overdue instruments stay caught). */
export interface CalibrationSweepBand {
  /** The band's threshold — the dedupe key's {threshold} axis. */
  readonly threshold: number;
  /** The exclusive lower edge in days-to-due (null = no floor — the
   * tightest band catches everything at or past its date). */
  readonly fromDays: number | null;
  /** The inclusive upper edge in days-to-due. */
  readonly toDays: number;
}

/** Fold the (descending) window set into DISJOINT bands. Each instrument
 * falls in EXACTLY ONE band per pass — the whole no-double-fire law is
 * this fold's own shape. */
export function calibrationSweepBands(windows: readonly number[]): CalibrationSweepBand[] {
  const descending = normalizeCalibrationSweepWindows(windows);
  const bands: CalibrationSweepBand[] = [];
  for (let index = 0; index < descending.length; index += 1) {
    const toDays = descending[index]!;
    const fromDays = index === descending.length - 1 ? null : descending[index + 1]!;
    bands.push({ threshold: toDays, fromDays, toDays });
  }
  return bands;
}

/** The band an instrument's days-to-due falls in (null = outside every
 * band — farther than the widest window; the pure fold the probe's SQL
 * mirrors). */
export function calibrationBandFor(
  bands: readonly CalibrationSweepBand[],
  daysToDue: number,
): CalibrationSweepBand | null {
  for (const band of bands) {
    if (daysToDue <= band.toDays && (band.fromDays === null || daysToDue > band.fromDays)) {
      return band;
    }
  }
  return null;
}

/**
 * The dedupe key's exact shape — D-08's own axes «per
 * instrument+window+day»:
 * `quality:calibration:{assetId}:{threshold}:{dueDate}`. The instrument
 * is the asset (D-08: the instrument IS an asset); the window is the
 * band's threshold; the DAY is the due date the alert names — the
 * per-cycle re-alert axis (a re-calibrated instrument's new due date
 * forms new keys; within one cycle the convergence law holds).
 */
export function calibrationDedupeKey(input: {
  readonly assetId: string;
  readonly threshold: number;
  readonly dueDate: string;
}): string {
  return `quality:calibration:${input.assetId}:${input.threshold}:${input.dueDate}`;
}

/** The S-15 severity ladder: info at the ≥ 30-day bands (the far
 * horizon — context), warning below (the near one — urgent). */
export function calibrationSweepSeverity(threshold: number): "info" | "warning" {
  return threshold >= 30 ? "info" : "warning";
}
