/**
 * PHASE-022 T-P22-1b · EmptyState (MASTER-PLAN §4) — the empty/loading
 * placeholder: icon slot (gray-400 decorative), title (md, gray-700), and a
 * gray-600 message — meaningful text never uses gray-400 (§16 placeholder
 * exemption is scoped).
 */
import type { ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, space, typeScale } from "../tokens";

export interface EmptyStateProps {
  title: string;
  message?: string;
  /** Decorative icon/glyph slot (rendered gray-400, hidden from a11y). */
  icon?: ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const styles = StyleSheet.create({
  state: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: space[6],
  },
  icon: { marginBottom: space[3], opacity: 0.9 },
  title: {
    fontSize: typeScale.md.fontSize,
    lineHeight: typeScale.md.lineHeight,
    fontWeight: "500",
    color: colors.gray[700],
    textAlign: "center",
  },
  message: {
    fontSize: typeScale.sm.fontSize,
    lineHeight: typeScale.sm.lineHeight,
    color: colors.gray[600],
    textAlign: "center",
    marginTop: space[2],
  },
});

export function EmptyState({ title, message, icon, testID, style }: EmptyStateProps): ReactNode {
  return (
    <View testID={testID} style={[styles.state, style]}>
      {icon === undefined ? null : (
        <View style={styles.icon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {icon}
        </View>
      )}
      <Text style={styles.title}>{title}</Text>
      {message === undefined ? null : <Text style={styles.message}>{message}</Text>}
    </View>
  );
}
