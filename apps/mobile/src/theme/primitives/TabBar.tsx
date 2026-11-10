/**
 * PHASE-022 T-P22-1b · TabBar (MASTER-PLAN §4) — the bottom navigation bar:
 * card surface, §5 subtle top hairline, z-raised layer, one accessible tab
 * per item (role "tab" + selected state, ≥44px targets). Active/inactive
 * colors are brand primary-600 / gray-600 (§1/§2); labels are xs.
 */
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { borders, colors, fontWeight, space, surfaces, typeScale, z } from "../tokens";
import { theme } from "../theme";

export interface TabBarItem {
  key: string;
  label: string;
  onPress: () => void;
  active?: boolean;
  /** Icon node above the label (active/inactive tone is the label color). */
  icon?: ReactNode;
  accessibilityLabel?: string;
}

export interface TabBarProps {
  items: readonly TabBarItem[];
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: surfaces.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: borders.subtle,
    zIndex: z.raised,
  },
  tab: {
    ...theme.touchTarget(),
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: space[2],
    paddingBottom: space[2],
  },
  tabIcon: { marginBottom: space[1] },
  label: { fontSize: typeScale.xs.fontSize, lineHeight: typeScale.xs.lineHeight, fontWeight: fontWeight.regular },
  active: { color: colors.primary[600], fontWeight: fontWeight.medium },
  inactive: { color: colors.gray[600] },
});

export function TabBar({ items, testID, style }: TabBarProps): ReactNode {
  return (
    <View testID={testID} style={[styles.bar, style]}>
      {items.map((item) => {
        const active = item.active === true;
        const tone = active ? styles.active : styles.inactive;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityLabel={item.accessibilityLabel ?? item.label}
            accessibilityState={{ selected: active }}
            onPress={item.onPress}
            style={({ pressed }) => [styles.tab, pressed && { backgroundColor: colors.primary[50] }]}
          >
            {item.icon === undefined ? null : <View style={styles.tabIcon}>{item.icon}</View>}
            <Text style={[styles.label, tone]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
