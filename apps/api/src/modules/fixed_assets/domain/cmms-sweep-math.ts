/**
 * PHASE-049 (W-19 — T-12, D-10) THE ASSET-EXPIRY SWEEP'S PURE ARITHMETIC
 * (the plan §4's unit-first law; the hr talent-math BR-091 folds' cmms
 * sibling, this module's own home — no cross-module domain import):
 *
 *   THE WINDOWS (the tenant-configurable threshold ladder — the FIRST 049
 *   SETTINGS KEYS, `assets.expiry_sweep_thresholds`): the documented
 *   fail-closed default [30,7,0] (red line 5: tenant-configurable DATA,
 *   never hard-coded law); `normalizeSweepWindows` keeps integer day-values
 *   ≥ 0, drops duplicates, sorts DESCENDING — an empty/garbage residue
 *   reads as the documented default (a tenant who registers garbage never
 *   silently disables the sweep; the fail-closed direction). Pure: no
 *   clock, no store.
 *
 *   THE BANDS (the disjoint fold): each item falls in EXACTLY ONE band per
 *   pass — `fromDays < daysToExpiry <= toDays`, the TIGHTEST band's lower
 *   edge open (already-expired items stay caught: an expired license is
 *   exactly the exposure the alert product exists for). No catch-up ladder
 *   for a late-registered item (it fires its CURRENT band's key once,
 *   never the whole ladder at once); across nights an item descends band
 *   by band — 30 → 7 → 0 — firing each threshold pass exactly once.
 *
 *   THE DEDUPE KEY (the BR-091 cmms shape): `assets:{class}:{assetId}:
 *   {threshold}` — the notifications table's uq_notifications_dedupe on
 *   (tenant_id, dedupe_key) makes the once-per-pass semantics STRUCTURAL,
 *   never application-level.
 *
 *   THE SEVERITY LADDER (the S-15 shape): info at the ≥ 30-day bands,
 *   warning below — the far horizon is context, the near one is urgent.
 *
 *   THE CLOCK LAW (the owner's W-19 order: «ساعة مثبتة أو خطوة مشتقة —
 *   لا Date.now()+دلتا أبدًا»): this layer is PURE — the band edges are
 *   day-values only; the probes derive the dates in SQL from the
 *   database's own CURRENT_DATE (the derived step), never from a JS
 *   wall-clock arithmetic. No Date.now() anywhere in the sweep's path.
 */

/** The four sweep classes — 0108's column family, one ladder governing all
 * (the inspection class is the R-10 fleet-light fourth, used where a tenant
 * tracks it). */
export type AssetExpiryClass = "warranty" | "insurance" | "license" | "inspection";

export const ASSET_EXPIRY_CLASSES: readonly AssetExpiryClass[] = Object.freeze([
  "warranty",
  "insurance",
  "license",
  "inspection",
]);

/** The documented default threshold list — amendment A-2 + red line 5's
 * cmms reading: 30/7/0 is the DOCUMENTED TENANT-CONFIGURABLE DEFAULT (the
 * settings registry key `assets.expiry_sweep_thresholds`), never a
 * hard-coded law; this constant is what a tenant with NO stored row fails
 * closed to (the registry default IS this list — one source, two
 * declarations, the 0099 precedent's constant law). */
export const DEFAULT_ASSET_EXPIRY_SWEEP_WINDOWS: readonly number[] = Object.freeze([30, 7, 0]);

/**
 * Normalize a configured threshold list into the sweep's window set:
 * keep integer day-values ≥ 0 (actual numbers, plus STRICT integer
 * strings only — a jsonb row may carry "30"; null/bool/floats/garbage
 * all DROP, never coerce: Number(null) === 0 would FABRICATE a 0-day
 * window — the honest fold refuses the coercion class entirely), drop
 * duplicates, sort DESCENDING (widest first — `sweepBands` walks
 * tightest-first from the fold). Pure: no clock, no store; garbage
 * never disables (an empty residue reads as the documented default —
 * the fail-closed direction).
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

export function normalizeSweepWindows(input: readonly unknown[]): number[] {
  const windows = [
    ...new Set(
      input
        .map((value) => parseWindowValue(value))
        .filter((days): days is number => days !== null),
    ),
  ].sort((a, b) => b - a);
  return windows.length > 0 ? windows : [...DEFAULT_ASSET_EXPIRY_SWEEP_WINDOWS];
}

/** One disjoint day-band of the sweep: items with
 * `fromDays < daysToExpiry <= toDays` — except the TIGHTEST band, whose
 * lower edge is open (already-expired items stay caught). */
export interface AssetSweepBand {
  /** The band's threshold — the dedupe key's {threshold} axis. */
  readonly threshold: number;
  /** The exclusive lower edge in days-to-expiry (null = no floor — the
   * tightest band catches everything at or past its date). */
  readonly fromDays: number | null;
  /** The inclusive upper edge in days-to-expiry. */
  readonly toDays: number;
}

/** Fold the (descending) window set into DISJOINT bands. Each item falls
 * in EXACTLY ONE band per pass — the whole no-double-fire law is this
 * fold's own shape. */
export function sweepBands(windows: readonly number[]): AssetSweepBand[] {
  const descending = normalizeSweepWindows(windows);
  const bands: AssetSweepBand[] = [];
  for (let index = 0; index < descending.length; index += 1) {
    const toDays = descending[index]!;
    const fromDays = index === descending.length - 1 ? null : descending[index + 1]!;
    bands.push({ threshold: toDays, fromDays, toDays });
  }
  return bands;
}

/** The band an item's days-to-expiry falls in (null = outside every band —
 * farther than the widest window; the pure fold the probes' SQL mirrors). */
export function bandFor(
  bands: readonly AssetSweepBand[],
  daysToExpiry: number,
): AssetSweepBand | null {
  for (const band of bands) {
    if (daysToExpiry <= band.toDays && (band.fromDays === null || daysToExpiry > band.fromDays)) {
      return band;
    }
  }
  return null;
}

/** The dedupe key's exact shape — `assets:{class}:{assetId}:{threshold}`
 * (BR-091's cmms sibling; the structural uq_notifications_dedupe on
 * (tenant_id, dedupe_key) is the once-per-pass floor). The asset is both
 * the subject and the register's own key — no placeholder axis needed. */
export function assetExpiryDedupeKey(input: {
  readonly assetExpiryClass: AssetExpiryClass;
  readonly assetId: string;
  readonly threshold: number;
}): string {
  return `assets:${input.assetExpiryClass}:${input.assetId}:${input.threshold}`;
}

/** The S-15 severity ladder: info at the ≥ 30-day bands (the far horizon —
 * context), warning below (the near one — urgent). */
export function sweepSeverity(threshold: number): "info" | "warning" {
  return threshold >= 30 ? "info" : "warning";
}
