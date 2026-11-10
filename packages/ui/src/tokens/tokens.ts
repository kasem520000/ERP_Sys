/**
 * @erp/ui — TypeScript token mirror (docs/ui/DESIGN_TOKENS.md §17).
 * The cross-platform contract for consumers that cannot read CSS custom
 * properties (Android RN theme — PHASE-022, charts, print CSS build).
 * Values MUST stay byte-identical to tokens.css — enforced by
 * src/tokens/__tests__/tokens.test.ts (parses both, compares maps).
 */
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

export const surfaces = {
  page: "#F9FAFB",
  card: "#FFFFFF",
  sunken: "#F3F4F6",
  overlay: "rgba(3, 7, 18, 0.45)",
  pos: "#032726",
  posRaised: "#042F2E",
} as const;

export const borders = { subtle: "#E5E7EB", default: "#D1D5DB", strong: "#9CA3AF" } as const;

export const shadows = {
  e1: "0 1px 2px rgba(3, 7, 18, 0.06)",
  e2: "0 2px 4px rgba(3, 7, 18, 0.07)",
  e3: "0 4px 12px rgba(3, 7, 18, 0.10)",
  e4: "0 8px 24px rgba(3, 7, 18, 0.14)",
} as const;

export const fonts = {
  ar: "'IBM Plex Sans Arabic', 'Inter', system-ui, sans-serif",
  latin: "'Inter', 'IBM Plex Sans Arabic', system-ui, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, monospace",
} as const;

export const text = {
  xs: "0.75rem", // 12px
  sm: "0.8125rem", // 13px
  base: "0.875rem", // 14px
  md: "0.9375rem", // 15px
  lg: "1.125rem", // 18px
  xl: "1.375rem", // 22px
  xl2: "1.75rem", // 28px
} as const;

export const leading = { tight: 1.2, normal: 1.45, relaxed: 1.7 } as const;

/** 4px base grid — allowed stops only (§7). */
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

export const radii = { sm: "4px", md: "6px", lg: "8px", full: "9999px" } as const;

/** §9 Density measurements — compact (default) / comfortable. */
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

/** §11 Focus ring — 2px/2px, color by context. */
export const focusRing = {
  light: "#0F766E",
  brand: "#99F6E4",
  pos: "#5EEAD4",
  invalid: "#B91C1C",
} as const;

export const breakpoints = { sm: 640, md: 768, lg: 1024, xl: 1280, xl2: 1536 } as const;

/** §12 layout widths (JournalEntryGrid horizontal-scroll floor, §6.3). */
export const layoutWidths = { journalGrid: 960 } as const;

/** §13 Motion — durations & easings (150ms absolute maximum). */
export const motion = {
  durationInstant: "0ms",
  durationFast: "120ms",
  durationBase: "150ms",
  easeStandard: "cubic-bezier(0.2, 0, 0, 1)",
  easeEnter: "cubic-bezier(0, 0, 0.2, 1)",
  easeExit: "cubic-bezier(0.4, 0, 1, 1)",
} as const;

/** §14 Iconography — Lucide, stroke 1.5, sizes. */
export const iconography = { library: "lucide", stroke: 1.5, sizes: { table: 16, toolbar: 20, pos: 24 } } as const;
