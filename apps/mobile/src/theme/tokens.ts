/**
 * PHASE-022 T-P22-1b · the mobile design-token layer (MASTER-PLAN §4,
 * DR-P22-02): a TWO-LAYER mirror of the canonical export
 * `packages/ui/src/tokens/tokens.ts` (DESIGN_TOKENS.md §17 — "CSS file + TS
 * object for RN/Android mirroring").
 *
 * Layer 1 — the CANONICAL MIRROR: the families below re-declare the
 * canonical values BYTE-IDENTICALLY (same nesting, same key names). This is
 * what the root gate `pnpm check:mobile-tokens` proves: it imports BOTH
 * token modules (scripts/ lives outside the depcruise-banned paths — the
 * check:i18n-parity precedent) and asserts every canonical leaf has a mobile
 * twin with the same value. The web-only spellings (rem/px strings, CSS font
 * stacks, "inherit") are mirrored verbatim ON PURPOSE — the mirror is the
 * contract, and the derivations below normalize them for RN.
 *
 * Layer 2 — the RN ADAPTATIONS: RN needs numbers where CSS uses px/rem
 * strings, single fontFamily names instead of stacks, and elevation-friendly
 * shadow objects instead of box-shadow strings. Those live in the second
 * section and are derivation-checked (root gate + __tests__/theme-parity).
 *
 * Binding maps that exist ONLY on the mobile side (the canonical export has
 * no equivalent): the document-status badge binding (DESIGN_TOKENS §3) and
 * the finance sign palette (§4 — the canonical `colors.finance.neutral` is
 * the CSS keyword "inherit", meaningless in RN; the RN-usable neutral is
 * gray-600 per §4 "Zero renders gray-600, never red or green").
 *
 * ZERO imports (the constants.ts leaf pattern): this module is pure data so
 * the root gate can load it without react-native in scope. Raw hex/px STRING
 * literals are legal HERE and ONLY here — `apps/mobile/src/theme/tokens` is
 * allowlisted in packages/ui/lint/plugin.mjs `erp-ui/no-raw-design-values`
 * (the PHASE-013 packages/ui/print precedent); every other mobile module
 * reads tokens, never re-declares values.
 */

// == Layer 1 — canonical mirror (byte-identical to packages/ui/src/tokens) ==

/** §1/§2/§3/§4 — color ramps, neutrals, semantic states, finance signs. */
export const colors = {
  primary: {
    50: "#F0FDFA",
    100: "#CCFBF1",
    200: "#99F6E4",
    300: "#5EEAD4",
    400: "#2DD4BF",
    500: "#14B8A6",
    600: "#0F766E",
    700: "#115E59",
    800: "#134E4A",
    900: "#042F2E",
    950: "#032726",
  },
  gray: {
    50: "#F9FAFB",
    100: "#F3F4F6",
    200: "#E5E7EB",
    300: "#D1D5DB",
    400: "#9CA3AF",
    500: "#6B7280",
    600: "#4B5563",
    700: "#374151",
    800: "#1F2937",
    900: "#111827",
    950: "#030712",
  },
  success: { solid: "#15803D", tintBg: "#DCFCE7", tintText: "#166534", tintBorder: "#BBF7D0" },
  successInfo: { solid: "#0E7490", tintBg: "#CFFAFE", tintText: "#155E75", tintBorder: "#A5F3FC" },
  warning: { solid: "#B45309", tintBg: "#FEF3C7", tintText: "#92400E", tintBorder: "#FDE68A" },
  danger: { solid: "#B91C1C", tintBg: "#FEE2E2", tintText: "#991B1B", tintBorder: "#FECACA" },
  info: { solid: "#1D4ED8", tintBg: "#DBEAFE", tintText: "#1E40AF", tintBorder: "#BFDBFE" },
  finance: { positive: "#15803D", negative: "#B91C1C", neutral: "inherit" },
} as const;

/** §5 — surfaces (page/card/sunken/overlay + the POS dark panel pair). */
export const surfaces = {
  page: "#F9FAFB",
  card: "#FFFFFF",
  sunken: "#F3F4F6",
  overlay: "rgba(3, 7, 18, 0.45)",
  pos: "#032726",
  posRaised: "#042F2E",
} as const;

/** §5 — border colors. */
export const borders = { subtle: "#E5E7EB", default: "#D1D5DB", strong: "#9CA3AF" } as const;

/** §5 — shadow strings (canonical CSS form; see `elevation` for the RN shape). */
export const shadows = {
  e1: "0 1px 2px rgba(3, 7, 18, 0.06)",
  e2: "0 2px 4px rgba(3, 7, 18, 0.07)",
  e3: "0 4px 12px rgba(3, 7, 18, 0.10)",
  e4: "0 8px 24px rgba(3, 7, 18, 0.14)",
} as const;

/** §6 — font stacks (canonical CSS form; see `fontFamily` for the RN shape). */
export const fonts = {
  ar: "'IBM Plex Sans Arabic', 'Inter', system-ui, sans-serif",
  latin: "'Inter', 'IBM Plex Sans Arabic', system-ui, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
} as const;

/** §6 — the type scale (canonical rem form; see `typeScale` for px). */
export const text = {
  xs: "0.75rem", // 12px
  sm: "0.8125rem", // 13px
  base: "0.875rem", // 14px
  md: "0.9375rem", // 15px
  lg: "1.125rem", // 18px
  xl: "1.375rem", // 22px
  xl2: "1.75rem", // 28px
} as const;

/** §6 — line-height multipliers. */
export const leading = { tight: 1.2, normal: 1.45, relaxed: 1.7 } as const;

/** §7 — spacing, the 4px base grid (allowed stops only). */
export const spacing = {
  0: "0px",
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "20px",
  6: "24px",
  8: "32px",
  12: "48px",
  16: "64px",
} as const;

/** §8 — radii (canonical px form; see `radius` for the RN numbers). */
export const radii = { sm: "4px", md: "6px", lg: "8px", full: "9999px" } as const;

/** §9 — density measurements — compact (default) / comfortable. */
export const density = {
  compact: {
    rowHeight: 32,
    controlHeight: 32,
    cellPaddingY: 6,
    cellPaddingX: 12,
    cellFont: text.sm,
    formLabel: "inline-start",
    touchTarget: 32,
  },
  comfortable: {
    rowHeight: 40,
    controlHeight: 40,
    cellPaddingY: 10,
    cellPaddingX: 16,
    cellFont: text.base,
    formLabel: "stacked",
    touchTarget: 40,
  },
} as const;

/** §10 — z-index layers. */
export const z = {
  base: 0,
  raised: 10,
  banner: 150,
  dropdown: 1000,
  drawer: 1100,
  overlay: 1200,
  dialog: 1300,
  popover: 1400,
  tooltip: 1500,
  toast: 1600,
} as const;

/** §11 — focus-ring colors by context (geometry: 2px solid, offset 2px). */
export const focusRing = {
  light: "#0F766E",
  brand: "#99F6E4",
  pos: "#5EEAD4",
  invalid: "#B91C1C",
} as const;

/** §11 — the focus-ring context variants (color sources in `focusRing`). */
export type FocusRingVariant = keyof typeof focusRing;

/** §12 — breakpoints (sm 640 = the phone owner view). */
export const breakpoints = { sm: 640, md: 768, lg: 1024, xl: 1280, xl2: 1536 } as const;

/** §12 — layout widths (JournalEntryGrid horizontal-scroll floor). */
export const layoutWidths = { journalGrid: 960 } as const;

/** §13 — motion durations & easings (150ms absolute maximum). */
export const motion = {
  durationInstant: "0ms",
  durationFast: "120ms",
  durationBase: "150ms",
  easeStandard: "cubic-bezier(0.2, 0, 0, 1)",
  easeEnter: "cubic-bezier(0, 0, 0.2, 1)",
  easeExit: "cubic-bezier(0.4, 0, 1, 1)",
} as const;

/** §14 — iconography: Lucide, stroke 1.5, sizes 16/20/24. */
export const iconography = { library: "lucide", stroke: 1.5, sizes: { table: 16, toolbar: 20, pos: 24 } } as const;

// == Layer 2 — RN adaptations (derived; derivation-checked, never hand-tuned) ==

/** §7 — the spacing grid as RN numbers (dp). */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  12: 48,
  16: 64,
} as const;

/** §8 — radii as RN numbers (dp). */
export const radius = { sm: 4, md: 6, lg: 8, full: 9999 } as const;

/** §6 — the four documented weights (400 body · 500 emphasis/labels ·
 *  600 headings/buttons · 700 totals & 2xl only). */
export const fontWeight = { regular: "400", medium: "500", semibold: "600", bold: "700" } as const;

/** §6 — the type scale in RN terms: px = rem × 16, per-step default weight
 *  and line height straight from the §6 table (base is 14px — dense data
 *  screens). `tabular-nums` (§6 binding numerals rule) is joined separately
 *  via the i18n runtime's TABULAR_NUMS_STYLE on every money/qty/doc-number
 *  element. */
export const typeScale = {
  xs: { fontSize: 12, fontWeight: "400", lineHeight: 16 },
  sm: { fontSize: 13, fontWeight: "400", lineHeight: 20 },
  base: { fontSize: 14, fontWeight: "400", lineHeight: 20 },
  md: { fontSize: 15, fontWeight: "500", lineHeight: 24 },
  lg: { fontSize: 18, fontWeight: "600", lineHeight: 28 },
  xl: { fontSize: 22, fontWeight: "600", lineHeight: 30 },
  xl2: { fontSize: 28, fontWeight: "700", lineHeight: 36 },
} as const;

/** A step of the type scale (the shared spelling for primitive/screen props). */
export type TypeScaleStep = keyof typeof typeScale;

/** §6 — RN takes a SINGLE family per style; the canonical stacks cross-fall
 *  back on the web but cannot on RN, so the mirror takes each stack's first
 *  (primary) family. Android ships the same three faces via the native
 *  asset pipeline (native/, EAS CI) — on-device font loading is a 4-a
 *  concern; in tests the family name is only a string. */
export const fontFamily = {
  ar: "IBM Plex Sans Arabic",
  latin: "Inter",
  mono: "IBM Plex Mono",
} as const;

/** §13 — durations as RN animation numbers (ms). */
export const durations = { instant: 0, fast: 120, base: 150 } as const;

/** §13 — easings as cubic-bezier control points (feed to RN's
 *  Easing.bezier(…points)). */
export const easings = {
  standard: [0.2, 0, 0, 1],
  enter: [0, 0, 0.2, 1],
  exit: [0.4, 0, 1, 1],
} as const;

/** §5 — the canonical shadows as RN elevation-friendly objects
 *  (iOS shadow* + Android `elevation`). Derivation rule (binding, checked
 *  by the gate + tests): shadowColor = the canonical rgba base = gray-950;
 *  offsetY/blur/opacity parsed from the canonical box-shadow string;
 *  elevation = offsetY (e1→1 … e4→8). */
export interface ElevationShadow {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
}

export const elevation: Readonly<Record<keyof typeof shadows, ElevationShadow>> = {
  e1: { shadowColor: colors.gray[950], shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 2, elevation: 1 },
  e2: { shadowColor: colors.gray[950], shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.07, shadowRadius: 4, elevation: 2 },
  e3: { shadowColor: colors.gray[950], shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 12, elevation: 4 },
  e4: { shadowColor: colors.gray[950], shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.14, shadowRadius: 24, elevation: 8 },
};

/** §11 — the focus-ring geometry: 2px solid ring at 2px offset (RN has no
 *  CSS outline; primitives draw the ring as a bordered wrapper — see
 *  theme.focusRing()). Colors come from the `focusRing` mirror above. */
export const focusRingGeometry = { width: 2, offset: 2 } as const;

// == Mobile-only binding maps (no canonical TS equivalent) ==

/** The semantic-state families (§3) — the values StatusChip/Badge accept. */
export type SemanticFamily = "success" | "successInfo" | "warning" | "danger" | "info";

/**
 * §3 — the DOCUMENT-STATUS BADGE BINDING (binding, adopted 2026-10-28):
 * document lifecycle states render status badges through this table and ONLY
 * through this table — DRAFT→Info, PENDING_APPROVAL→Warning, APPROVED→
 * Success-info, POSTED→Success, VOIDED/CANCELLED→Danger. No screen may
 * invent a per-screen status color; workflow state (this map) is additive to
 * and independent of money sign colors (§4).
 */
export const statusBadge = {
  DRAFT: "info",
  PENDING_APPROVAL: "warning",
  APPROVED: "successInfo",
  POSTED: "success",
  VOIDED: "danger",
  CANCELLED: "danger",
} as const satisfies Record<string, SemanticFamily>;

/** Every lifecycle state the binding map covers (screens extend this union
 *  as flows grow — the map stays the single color authority). */
export type DocumentStatus = keyof typeof statusBadge;

/**
 * §4 — finance sign semantics, RN-usable form: positive #15803D / negative
 * #B91C1C (byte-equal to `colors.finance`, which is itself byte-equal to the
 * success/danger solids) and neutral = gray-600 ("zero renders gray-600,
 * never red or green"). Red means negative BY SIGN — never "credit column"
 * or "money owed". Values reference the mirror so the layer cannot drift.
 */
export const financeSign = {
  positive: colors.finance.positive,
  negative: colors.finance.negative,
  neutral: colors.gray[600],
} as const;
