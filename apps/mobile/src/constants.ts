/**
 * PHASE-022 · the binding golden constants (MASTER-PLAN §0) as a LEAF
 * module: every area (theme/i18n/auth/device/store/sync/fieldsales/
 * companion/personal/reconciliation/notifications/release/screens) imports
 * from HERE, never from the package root barrel — the root re-exports this
 * module, so a module → root import would close a dependency-cruiser
 * `no-circular` violation. Zero imports of its own (the desktop
 * src/constants.ts pattern).
 */

/** The two mobile device classes (contracts DeviceClass — the ONE app's TWO
 * capability experiences: field sales vs personal-account companion). */
export const MOBILE_DEVICE_CLASSES = {
  field: "android-field",
  personal: "android-personal",
} as const;

/** The registration platform string (contracts platform — "android"). */
export const ANDROID_PLATFORM = "android" as const;

/** The per-class registration capability labels (MASTER-PLAN §0 golden
 * constants: `["van_sales"]` / `["personal_account"]` — advisory strings
 * that ride the registration record; the server gates feeds by
 * deviceClass, never by these labels). */
export const MOBILE_CAPABILITY_LABELS = {
  field: "van_sales",
  personal: "personal_account",
} as const;

/** The mobile local storage budget — 128 MB byte-exact, LRU-pruned
 * (the DR-P21-03 port); outbox/inbox/meta/cursors never pruned. */
export const MOBILE_STORAGE_BUDGET_BYTES = 134_217_728 as const;

/** Foreground sync cycle when dirty — 2 min (MASTER-PLAN §0 sync schedule). */
export const SYNC_FOREGROUND_INTERVAL_MS = 120_000 as const;

/** Background fetch floor — ≤ 15 min OS-scheduled (Doze-aware; the OS may
 * always defer further — budgets are ceilings, not guarantees). */
export const SYNC_BACKGROUND_MIN_INTERVAL_MS = 900_000 as const;

/** Connectivity-regained push debounce — 5 s (C-05/B-05 family: never
 * hammer a flaky radio with immediate full cycles). */
export const SYNC_CONNECTIVITY_DEBOUNCE_MS = 5_000 as const;

/** Per-cycle pull budget (cellular default) — ≤ 8 MB. */
export const SYNC_PULL_BUDGET_BYTES = 8_388_608 as const;

/** Per-cycle push budget (cellular default) — ≤ 2 MB. */
export const SYNC_PUSH_BUDGET_BYTES = 2_097_152 as const;

/** Personal-account background pull budget — ≤ 256 KB (the read-mostly
 * companion profile must stay invisible on metered batteries). */
export const PERSONAL_BACKGROUND_PULL_BUDGET_BYTES = 262_144 as const;

/** Rollout stage percentages (10% → 50% → 100%; RELEASE_STRATEGY §Rollout). */
export const ROLLOUT_STAGES = [10, 50, 100] as const;

/** Crash-free-session rollout gates (trailing 24 h): promote 10→50 needs
 * ≥ 99.5% over ≥ 200 sessions; 50→100 needs ≥ 99.7% over ≥ 500; below
 * 98.5% ⇒ halt + force-update via published `minVersion` (the DR-P21-05
 * port). */
export const CRASH_FREE_GATES = {
  to50: { crashFree: 0.995, sessions: 200 },
  to100: { crashFree: 0.997, sessions: 500 },
  halt: 0.985,
} as const;

/** Minimum accessible touch target — ≥ 44 px (ACCESSIBILITY §touch). */
export const TOUCH_TARGET_MIN = 44 as const;

/** Field-draft price tolerance — 2% tenant-configurable (0% for POS;
 * PRICE_CHANGED fires beyond tolerance; advisory warning client-side, the
 * server always decides). */
export const PRICE_TOLERANCE_FIELD_PCT = 2 as const;
