/**
 * PHASE-022 T-P22-1b · Badge + StatusChip (MASTER-PLAN §4).
 *
 * Badge renders any semantic tone with the §3 tint triple (tintBg surface,
 * tintText label, tintBorder outline). StatusChip is the ONLY component that
 * maps a document lifecycle state to a tone — through tokens.statusBadge
 * (DESIGN_TOKENS §3, the binding map): DRAFT→info, PENDING_APPROVAL→warning,
 * APPROVED→successInfo, POSTED→success, VOIDED/CANCELLED→danger. No screen
 * may invent a per-screen status color; an unmapped status renders as plain
 * neutral text (visible in review, never silently mislabeled).
 */
import type { ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, fontFamily, fontWeight, radius, space, statusBadge, typeScale, type DocumentStatus, type SemanticFamily } from "../tokens";

export interface BadgeProps {
  label: string;
  /** The §3 semantic tone. */
  tone?: SemanticFamily;
  /** Monospace the label (badge carrying a doc number / amount). */
  mono?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const TONE_STYLES = StyleSheet.create({
  success: { backgroundColor: colors.success.tintBg, borderColor: colors.success.tintBorder },
  successInfo: { backgroundColor: colors.successInfo.tintBg, borderColor: colors.successInfo.tintBorder },
  warning: { backgroundColor: colors.warning.tintBg, borderColor: colors.warning.tintBorder },
  danger: { backgroundColor: colors.danger.tintBg, borderColor: colors.danger.tintBorder },
  info: { backgroundColor: colors.info.tintBg, borderColor: colors.info.tintBorder },
});

const TONE_TEXT = StyleSheet.create({
  success: { color: colors.success.tintText },
  successInfo: { color: colors.successInfo.tintText },
  warning: { color: colors.warning.tintText },
  danger: { color: colors.danger.tintText },
  info: { color: colors.info.tintText },
});

const styles = StyleSheet.create({
  badge: {
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingStart: space[2],
    paddingEnd: space[2],
    paddingTop: space[1],
    paddingBottom: space[1],
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
  },
  label: { fontSize: typeScale.xs.fontSize, lineHeight: typeScale.xs.lineHeight, fontWeight: fontWeight.medium },
  /** Unmapped status fallback — plain body text, no badge chrome. */
  unmapped: { color: colors.gray[600] },
});

export function Badge({ label, tone = "info", mono = false, accessibilityLabel, testID, style }: BadgeProps): ReactNode {
  return (
    <View
      testID={testID}
      accessibilityLabel={accessibilityLabel ?? label}
      style={[styles.badge, TONE_STYLES[tone], style]}
    >
      <Text style={[styles.label, TONE_TEXT[tone], mono ? { fontFamily: fontFamily.mono } : null]}>{label}</Text>
    </View>
  );
}

export interface StatusChipProps {
  /** A document lifecycle state — tokens.statusBadge keys; an unmapped
   *  state renders as plain neutral text (no invented color, §3 contract). */
  status: DocumentStatus | (string & {});
  /** The translated label (screens pass the i18n `t()` string; the raw
   *  status code is the fallback). */
  label?: string;
  mono?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

export function StatusChip({ status, label, mono, accessibilityLabel, testID, style }: StatusChipProps): ReactNode {
  const tone = statusBadge[status as DocumentStatus];
  if (tone === undefined) {
    // Not in the binding map → no invented color (the §3 contract).
    return (
      <Text testID={testID} accessibilityLabel={accessibilityLabel ?? label ?? status} style={styles.unmapped}>
        {label ?? status}
      </Text>
    );
  }
  return (
    <Badge
      label={label ?? status}
      tone={tone}
      mono={mono}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={style}
    />
  );
}
