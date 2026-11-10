/**
 * PHASE-022 T-P22-1b · Field (MASTER-PLAN §4) — label + control + error
 * message. The label is announced: the wrapper carries accessibilityLabel
 * (defaults to the label text) so screen readers name the group; the error
 * line renders in the §3 danger color (validation errors) and is exposed to
 * a11y as part of the label. §6: form labels are the 500 weight.
 */
import type { ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, fontWeight, space, typeScale } from "../tokens";

export interface FieldProps {
  label: string;
  /** The a11y name for the control group — defaults to `label`. */
  accessibilityLabel?: string;
  /** Validation error (§3 danger) — rendered under the control. */
  error?: string;
  /** Helper hint (gray-600) — never gray-400 (meaningful text, §16). */
  hint?: string;
  required?: boolean;
  children: ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const styles = StyleSheet.create({
  field: { flexDirection: "column", alignSelf: "stretch" },
  label: {
    fontSize: typeScale.sm.fontSize,
    lineHeight: typeScale.sm.lineHeight,
    fontWeight: fontWeight.medium,
    color: colors.gray[700],
    marginBottom: space[1],
  },
  required: { color: colors.danger.solid },
  error: {
    fontSize: typeScale.xs.fontSize,
    lineHeight: typeScale.xs.lineHeight,
    color: colors.danger.solid,
    marginTop: space[1],
  },
  hint: {
    fontSize: typeScale.xs.fontSize,
    lineHeight: typeScale.xs.lineHeight,
    color: colors.gray[600],
    marginTop: space[1],
  },
});

export function Field({ label, accessibilityLabel, error, hint, required = false, children, testID, style }: FieldProps): ReactNode {
  const trailingText = error ?? hint;
  return (
    <View testID={testID} accessibilityLabel={accessibilityLabel ?? label} style={[styles.field, style]}>
      <Text style={styles.label}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      {children}
      {trailingText === undefined ? null : (
        <Text
          style={error === undefined ? styles.hint : styles.error}
          accessibilityRole="text"
        >
          {trailingText}
        </Text>
      )}
    </View>
  );
}
