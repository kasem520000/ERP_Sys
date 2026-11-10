/**
 * PHASE-022 T-P22-1b · MoneyText (MASTER-PLAN §4) — the money display
 * primitive:
 *
 *   - SIGN COLOR by value (DESIGN_TOKENS §4, binding): ≥ 0 exclusive →
 *     positive green, < 0 → negative red, zero → neutral gray-600, malformed
 *     → neutral (an unparsable amount makes no sign claim). Red means
 *     negative BY SIGN — never "credit column" (theme.financeSignColor is
 *     the only color path).
 *   - AMOUNT IS TEXT (ADR-0009): a canonical decimal string, formatted by
 *     the i18n runtime's formatMoney — grouping ","/".", minus leads the
 *     digits, exact scale preserved, latn digits by default (the `arab`
 *     display is the tenant-configurable option, DR-P22-04).
 *   - TABULAR NUMERALS (§6 binding): fontVariant ['tabular-nums'] via the
 *     i18n runtime's TABULAR_NUMS_STYLE.
 *   - BIDI ISOLATION (DR-P22-03/RTL §5): the full money run (amount +
 *     currency label) is wrapped in U+2066…U+2069 (strong-LTR isolate) after
 *     sanitizeBidi() strips any smuggled direction controls — the minus and
 *     the grouping separators can never be reordered by an RTL paragraph.
 *     Doc numbers elsewhere use the same helpers (bidiDocNumber).
 */
import type { ReactNode } from "react";
import { StyleSheet, Text, type StyleProp, type TextStyle } from "react-native";

import { TABULAR_NUMS_STYLE, bidiIsolateStrong, formatMoney, sanitizeBidi, type Locale, type NumeralsOption } from "../../i18n";
import { typeScale, type TypeScaleStep } from "../tokens";
import { theme } from "../theme";

export interface MoneyTextProps {
  /** TEXT canonical decimal string (ADR-0009) — e.g. "-1234.50", "0.00". */
  amount: string;
  /** ISO currency code ("" = bare amount). Localized label by the runtime. */
  currency?: string;
  locale?: Locale;
  /** Tenant-configurable arab digit display (identifiers stay latn). */
  numerals?: NumeralsOption;
  /** Sign coloring (§4) — default on; set false for neutral ledger columns. */
  colorBySign?: boolean;
  size?: TypeScaleStep;
  /** Money columns align to the inline END edge (RTL_DESIGN_RULES §8 —
   *  "text-end logical alignment = decimal side"). RN 0.76's TextStyle has
   *  no textAlign "start"/"end" (upstream added it after 0.76), so this maps
   *  to alignSelf flex-start/flex-end — RN flexbox flips with I18nManager
   *  RTL, which is the direction-correct, DR-P22-03-clean equivalent. */
  align?: "start" | "end";
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<TextStyle>;
}

const styles = StyleSheet.create({
  xs: { fontSize: typeScale.xs.fontSize, lineHeight: typeScale.xs.lineHeight },
  sm: { fontSize: typeScale.sm.fontSize, lineHeight: typeScale.sm.lineHeight },
  base: { fontSize: typeScale.base.fontSize, lineHeight: typeScale.base.lineHeight },
  md: { fontSize: typeScale.md.fontSize, lineHeight: typeScale.md.lineHeight },
  lg: { fontSize: typeScale.lg.fontSize, lineHeight: typeScale.lg.lineHeight },
  xl: { fontSize: typeScale.xl.fontSize, lineHeight: typeScale.xl.lineHeight },
  xl2: { fontSize: typeScale.xl2.fontSize, lineHeight: typeScale.xl2.lineHeight },
  alignStart: { alignSelf: "flex-start" },
  alignEnd: { alignSelf: "flex-end" },
});

export function MoneyText({
  amount,
  currency = "",
  locale = "ar",
  numerals = "latn",
  colorBySign = true,
  size = "base",
  align,
  accessibilityLabel,
  testID,
  style,
}: MoneyTextProps): ReactNode {
  const formatted = formatMoney(locale, amount, currency, { numerals });
  const isolated = bidiIsolateStrong(sanitizeBidi(formatted));
  return (
    <Text
      testID={testID}
      accessibilityLabel={accessibilityLabel ?? formatted}
      style={[
        styles[size],
        TABULAR_NUMS_STYLE,
        colorBySign ? { color: theme.financeSignColor(amount) } : null,
        align === "end" ? styles.alignEnd : align === "start" ? styles.alignStart : null,
        style,
      ]}
    >
      {isolated}
    </Text>
  );
}
