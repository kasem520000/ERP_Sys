/**
 * PHASE-022 T-P22-1b · ListItem (MASTER-PLAN §4) — the compact-density row
 * (§9: control padding-y 8, cell padding-x 12) with leading/title/subtitle/
 * trailing slots, a ≥44px touch target when pressable, and the §5 subtle
 * hairline divider. Logical props only (DR-P22-03): the divider is a
 * bottom border, slots are laid out with flexDirection + row-reverse never
 * needed — RN mirrors the row automatically under RTL.
 */
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { borders, colors, space, typeScale } from "../tokens";
import { theme } from "../theme";

export interface ListItemProps {
  title: string;
  subtitle?: string;
  /** Start-edge slot (icon, avatar, status chip). */
  leading?: ReactNode;
  /** End-edge slot (chevron, amount, badge). */
  trailing?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  /** The §5 subtle hairline divider under the row (list usage). */
  divider?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const styles = StyleSheet.create({
  row: {
    ...theme.touchTarget(),
    flexDirection: "row",
    alignItems: "center",
    paddingStart: space[3],
    paddingEnd: space[3],
    paddingTop: space[2],
    paddingBottom: space[2],
    backgroundColor: "transparent",
  },
  pressed: { backgroundColor: colors.primary[50] },
  disabled: { opacity: 0.5 },
  leading: { marginEnd: space[3] },
  content: { flex: 1, flexDirection: "column" },
  title: { fontSize: typeScale.base.fontSize, lineHeight: typeScale.base.lineHeight, color: colors.gray[900] },
  subtitle: {
    fontSize: typeScale.sm.fontSize,
    lineHeight: typeScale.sm.lineHeight,
    color: colors.gray[600],
    marginTop: space[1],
  },
  trailing: { marginStart: space[3] },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: borders.subtle },
});

export function ListItem({
  title,
  subtitle,
  leading,
  trailing,
  onPress,
  disabled = false,
  divider = false,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: ListItemProps): ReactNode {
  const body = (
    <View style={styles.content}>
      <Text style={styles.title}>{title}</Text>
      {subtitle === undefined ? null : <Text style={styles.subtitle}>{subtitle}</Text>}
    </View>
  );
  if (onPress === undefined) {
    return (
      <View testID={testID} style={[styles.row, divider && styles.divider, disabled && styles.disabled, style]}>
        {leading === undefined ? null : <View style={styles.leading}>{leading}</View>}
        {body}
        {trailing === undefined ? null : <View style={styles.trailing}>{trailing}</View>}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [styles.row, divider && styles.divider, pressed && !disabled && styles.pressed, disabled && styles.disabled, style]}
    >
      {leading === undefined ? null : <View style={styles.leading}>{leading}</View>}
      {body}
      {trailing === undefined ? null : <View style={styles.trailing}>{trailing}</View>}
    </Pressable>
  );
}
