/**
 * PHASE-022 T-P22-1b · Button + IconButton (MASTER-PLAN §4).
 *
 * Binding rules implemented:
 *   - ACCESSIBILITY §touch: ≥ 44px minimum target (theme.touchTarget()).
 *   - DESIGN_TOKENS §11: the focus ring (2px solid, 2px offset) drawn as a
 *     bordered wrapper — `focused` is a prop because RN has no
 *     :focus-visible; screens drive it from their focus state.
 *   - DR-P22-03: logical style props ONLY (paddingStart/End, no left/right).
 *   - Tokens only — no raw design values (erp-ui/no-raw-design-values).
 */
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";

import { colors, fontWeight, radius, space, surfaces, typeScale, type FocusRingVariant } from "../tokens";
import { theme } from "../theme";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "danger" | "pos";

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  /** Replaces the label with a Spinner and blocks presses. */
  loading?: boolean;
  /** Draws the §11 focus ring around the control. */
  focused?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** §11 ring context per variant: brand ring on primary fills, pos ring on
 *  the dark POS surface, light ring on light surfaces (danger included — a
 *  danger-colored ring around a danger button would be invisible). */
const FOCUS_VARIANT: Record<ButtonVariant, FocusRingVariant> = {
  primary: "brand",
  secondary: "light",
  danger: "light",
  pos: "pos",
};

interface VariantStyle {
  base: ViewStyle;
  pressed: ViewStyle;
  label: TextStyle;
}

const styles = StyleSheet.create({
  base: {
    ...theme.touchTarget(),
    borderRadius: radius.md,
    paddingStart: space[4],
    paddingEnd: space[4],
    paddingTop: space[2],
    paddingBottom: space[2],
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { backgroundColor: colors.gray[100], borderWidth: 0 },
  label: {
    fontSize: typeScale.base.fontSize,
    lineHeight: typeScale.base.lineHeight,
    fontWeight: fontWeight.semibold,
    textAlign: "center",
  },
  labelDisabled: { color: colors.gray[500] },
  primary: { backgroundColor: colors.primary[600] },
  primaryPressed: { backgroundColor: colors.primary[700] },
  primaryLabel: { color: surfaces.card },
  secondary: { backgroundColor: surfaces.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.gray[300] },
  secondaryPressed: { backgroundColor: colors.primary[50] },
  secondaryLabel: { color: colors.gray[900] },
  danger: { backgroundColor: colors.danger.solid },
  dangerPressed: { backgroundColor: colors.danger.tintText },
  dangerLabel: { color: surfaces.card },
  pos: { backgroundColor: surfaces.posRaised },
  posPressed: { backgroundColor: colors.primary[900] },
  posLabel: { color: colors.primary[300] },
});

const VARIANTS: Record<ButtonVariant, VariantStyle> = {
  primary: { base: styles.primary, pressed: styles.primaryPressed, label: styles.primaryLabel },
  secondary: { base: styles.secondary, pressed: styles.secondaryPressed, label: styles.secondaryLabel },
  danger: { base: styles.danger, pressed: styles.dangerPressed, label: styles.dangerLabel },
  pos: { base: styles.pos, pressed: styles.posPressed, label: styles.posLabel },
};

/** Spinner tone per variant — light spinner on filled variants. */
function spinnerTone(variant: ButtonVariant): string {
  return variant === "primary" || variant === "danger" ? surfaces.card : colors.primary[600];
}

function pressableStyle(variant: ButtonVariant, inert: boolean, style: StyleProp<ViewStyle> | undefined) {
  const variantStyle = VARIANTS[variant];
  return ({ pressed }: { pressed: boolean }): StyleProp<ViewStyle> => [
    styles.base,
    variantStyle.base,
    pressed && !inert && variantStyle.pressed,
    inert && styles.disabled,
    style,
  ];
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
  focused = false,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: ButtonProps): ReactNode {
  const inert = disabled || loading;
  const variantStyle = VARIANTS[variant];
  const button = (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inert, busy: loading }}
      onPress={inert ? undefined : onPress}
      style={pressableStyle(variant, inert, style)}
    >
      {loading ? (
        <Spinner size="small" color={spinnerTone(variant)} />
      ) : (
        <Text style={[styles.label, variantStyle.label, inert && styles.labelDisabled]}>{label}</Text>
      )}
    </Pressable>
  );
  return focused ? <View style={theme.focusRing(FOCUS_VARIANT[variant])}>{button}</View> : button;
}

export interface IconButtonProps {
  /** The glyph node (an icon component or a text glyph) — never a bare string. */
  icon: ReactNode;
  /** REQUIRED — an icon-only control is unlabelled without it (ACCESSIBILITY). */
  accessibilityLabel: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  focused?: boolean;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  variant = "secondary",
  disabled = false,
  loading = false,
  focused = false,
  accessibilityHint,
  testID,
  style,
}: IconButtonProps): ReactNode {
  const inert = disabled || loading;
  const button = (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inert, busy: loading }}
      onPress={inert ? undefined : onPress}
      style={pressableStyle(variant, inert, style)}
    >
      {loading ? <Spinner size="small" color={spinnerTone(variant)} /> : icon}
    </Pressable>
  );
  return focused ? <View style={theme.focusRing(FOCUS_VARIANT[variant])}>{button}</View> : button;
}
