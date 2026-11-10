/**
 * PHASE-022 T-P22-1b · the Theme aggregator (MASTER-PLAN §4): every RN
 * surface reads design values through THIS object — never a raw hex/px, and
 * never a per-screen color decision. It aggregates the token mirror
 * (./tokens) plus the helpers that encode the binding rules:
 *
 *   statusColor(status)     — the §3 document-status badge binding (the ONLY
 *                             way workflow state becomes color);
 *   financeSignColor(amount)— §4 finance signs (the ONLY way money sign
 *                             becomes color — red is negative-by-sign, never
 *                             "credit column");
 *   touchTarget()           — ACCESSIBILITY §touch: ≥ 44 px minimum target;
 *   focusRing(variant)      — §11: 2px solid ring, 2px offset, color by
 *                             context (light/brand/pos/invalid).
 *
 * PURE TS (DR-P22-01): styles are plain structural objects — RN's
 * ViewStyle/TextStyle accept them structurally, so this module never imports
 * react-native (the i18n TABULAR_NUMS_STYLE pattern). Money signs are parsed
 * from the TEXT canonical decimal string (ADR-0009) with pure string
 * inspection — no floats, no Math rounding.
 */
import { TOUCH_TARGET_MIN } from "../constants";
import {
  borders,
  breakpoints,
  colors,
  density,
  durations,
  easings,
  elevation,
  financeSign,
  focusRing,
  focusRingGeometry,
  fontFamily,
  fonts,
  iconography,
  layoutWidths,
  leading,
  motion,
  radius,
  radii,
  shadows,
  space,
  spacing,
  statusBadge,
  surfaces,
  text,
  typeScale,
  z,
  type DocumentStatus,
  type FocusRingVariant,
  type SemanticFamily,
} from "./tokens";

/** A semantic-state color set (§3): 700-level solid anchor + the badge tint
 *  triple. The shape screens/badges consume. */
export interface SemanticFamilyColors {
  solid: string;
  tintBg: string;
  tintText: string;
  tintBorder: string;
}

/** ACCESSIBILITY §touch — the minimum accessible touch target. */
export interface TouchTargetStyle {
  minWidth: number;
  minHeight: number;
}

/** §11 — the focus ring drawn as a bordered wrapper (RN has no CSS outline):
 *  2px solid ring in the context color at 2px offset, md corner radius. */
export interface FocusRingStyle {
  borderWidth: number;
  borderColor: string;
  borderRadius: number;
  margin: number;
}

/** The §3 semantic families → their color sets. */
const SEMANTIC_COLORS: Readonly<Record<SemanticFamily, SemanticFamilyColors>> = {
  success: colors.success,
  successInfo: colors.successInfo,
  warning: colors.warning,
  danger: colors.danger,
  info: colors.info,
};

/** §3 — the ONLY status→color path: the binding map picks the family, the
 *  family provides the tint set. Unknown statuses must NOT invent a color:
 *  they get `null` and the caller renders plain body text, so a new
 *  lifecycle state fails visibly in review instead of silently mislabeling.
 *  The `(string & {})` union keeps DocumentStatus literal autocompletion
 *  while accepting open runtime strings (statuses arrive from data). */
export function statusColor(status: DocumentStatus | (string & {})): SemanticFamilyColors | null {
  const family: SemanticFamily | undefined = statusBadge[status as DocumentStatus];
  if (family === undefined) {
    return null;
  }
  return SEMANTIC_COLORS[family];
}

/** The badge tint pair for a semantic family (Badge/StatusChip styling). */
export function semanticColors(family: SemanticFamily): SemanticFamilyColors {
  return SEMANTIC_COLORS[family];
}

/** The §3 family a status maps to (the map value itself, for labels/tests). */
export function statusFamily(status: DocumentStatus): SemanticFamily {
  return statusBadge[status];
}

/** §4 — money-sign color from the TEXT canonical decimal string
 *  (ADR-0009 — money is never a JS number):
 *    "-120.00"  → negative #B91C1C
 *    "0"/"0.00" → neutral gray-600 (zero is NEVER red or green)
 *    "150.00"   → positive #15803D
 *    malformed  → neutral (an unparsable amount makes no sign claim).
 *  Pure string inspection — no parseFloat, no rounding. */
export function financeSignColor(amount: string): string {
  const trimmed = amount.trim();
  if (trimmed === "" || !/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return financeSign.neutral;
  }
  if (trimmed.startsWith("-")) {
    return /^-0+(\.0+)?$/.test(trimmed) ? financeSign.neutral : financeSign.negative;
  }
  return /^0+(\.0+)?$/.test(trimmed) ? financeSign.neutral : financeSign.positive;
}

/** ACCESSIBILITY §touch — the ≥44px minimum target, merged into pressable
 *  styles (Button/IconButton/ListItem/TabBar all start from this). */
export function touchTarget(): TouchTargetStyle {
  return { minWidth: TOUCH_TARGET_MIN, minHeight: TOUCH_TARGET_MIN };
}

/** §11 — the focus ring, 2px solid + 2px offset, color by context:
 *   light (default) #0F766E on light surfaces · brand #99F6E4 on
 *   primary-600+ fills · pos #5EEAD4 on the dark POS surface · invalid
 *   #B91C1C for errored fields. Same geometry for every context. */
export function focusRingStyle(variant: FocusRingVariant = "light"): FocusRingStyle {
  return {
    borderWidth: focusRingGeometry.width,
    borderColor: focusRing[variant],
    borderRadius: radius.md,
    margin: focusRingGeometry.offset,
  };
}

/** The variant names of the §11 focus-ring contexts. */
export type { FocusRingVariant };

/**
 * The aggregated Theme object — the single import surface for screens
 * (`import { theme } from "@erp/mobile"`). Token families keep their
 * canonical names; the RN adaptations ride alongside with their own names
 * (space/radius/typeScale/fontFamily/durations/easings/elevation).
 */
export const theme = {
  // Layer 1 — the canonical mirror families.
  colors,
  surfaces,
  borders,
  shadows,
  fonts,
  text,
  leading,
  spacing,
  radii,
  density,
  z,
  focusRingColors: focusRing,
  breakpoints,
  layoutWidths,
  motion,
  iconography,
  // Layer 2 — the RN adaptations.
  space,
  radius,
  typeScale,
  fontFamily,
  durations,
  easings,
  elevation,
  focusRingGeometry,
  // Mobile-only binding maps.
  statusBadge,
  financeSign,
  // Helpers.
  statusColor,
  statusFamily,
  semanticColors,
  financeSignColor,
  touchTarget,
  focusRing: focusRingStyle,
} as const;

export type Theme = typeof theme;
