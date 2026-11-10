/**
 * PHASE-021 · the binding golden constants (MASTER-PLAN §0) as a LEAF
 * module: every area (store/updater/system/telemetry/sync) imports from
 * HERE, never from the package root barrel — the root re-exports this
 * module, so a module → root import would close a dependency-cruiser
 * `no-circular` violation (the W2 gate). Zero imports of its own.
 */

/** The desktop device class (contracts DeviceClass — "tauri-desktop"). */
export const DESKTOP_DEVICE_CLASS = "tauri-desktop" as const;

/** Minimum supported WebView2 Evergreen version (DR-P21-04; config-bumpable
 * via the updater channel — rides the manifest, this is the shipped floor). */
export const WEBVIEW2_MINIMUM = "109.0.1518.78" as const;

/** Recommended WebView2 version — ≥ minimum but < recommended ⇒ degraded
 * capability notices (MASTER-PLAN §0 constants table). */
export const WEBVIEW2_RECOMMENDED = "120.0.2210.61" as const;

/** The desktop local storage budget — 1 GB byte-exact (DR-P21-03). */
export const DESKTOP_STORAGE_BUDGET_BYTES = 1_073_741_824 as const;

/** Rollout stage percentages (10% → 50% → 100%; RELEASE_STRATEGY §Rollout). */
export const ROLLOUT_STAGES = [10, 50, 100] as const;

/** Crash-free-session rollout gates (trailing 24 h): promote 10→50 needs
 * ≥ 99.5% over ≥ 200 sessions; 50→100 needs ≥ 99.7% over ≥ 500; below
 * 98.5% ⇒ halt + force-update (DR-P21-05). */
export const CRASH_FREE_GATES = {
  promote10to50: { rate: 0.995, minSessions: 200 },
  promote50to100: { rate: 0.997, minSessions: 500 },
  halt: 0.985,
} as const;
