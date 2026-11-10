/**
 * PHASE-022 T-P22-1b · Spinner (MASTER-PLAN §4) — the RN ActivityIndicator
 * wearing tokens: primary-600 by default, caller-supplied tone for filled
 * surfaces (Button passes its label color). `label` adds an accessible
 * progressbar name ("جارٍ الحفظ…" / "Saving…").
 */
import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, space, typeScale } from "../tokens";

export interface SpinnerProps {
  size?: "small" | "large";
  color?: string;
  /** Accessible label for the busy state (announced, not necessarily shown). */
  label?: string;
  showLabel?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  label: {
    fontSize: typeScale.sm.fontSize,
    lineHeight: typeScale.sm.lineHeight,
    color: colors.gray[600],
    marginStart: space[2],
  },
});

export function Spinner({ size = "small", color = colors.primary[600], label, showLabel = false, testID, style }: SpinnerProps): ReactNode {
  const indicator = (
    <View testID={testID} accessibilityRole="progressbar" accessibilityLabel={label} style={[styles.row, style]}>
      <ActivityIndicator size={size} color={color} />
      {label !== undefined && showLabel ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
  return indicator;
}
