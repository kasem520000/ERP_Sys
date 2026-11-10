/**
 * PHASE-022 T-P22-1b · Card (MASTER-PLAN §4) — the §5 surface treatment:
 * card surface, lg radius, hairline subtle border, the e1 elevation token
 * ("cards, inputs on hover" — the product must feel printed, not floating).
 */
import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { borders, elevation, radius, space, surfaces, type ElevationShadow } from "../tokens";

export interface CardProps {
  children: ReactNode;
  /** §5 elevation token — default e1 (cards); e2+ for overlays. */
  level?: keyof typeof elevation;
  padding?: number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: surfaces.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: borders.subtle,
    padding: space[4],
  },
});

export function Card({ children, level = "e1", padding, testID, style }: CardProps): ReactNode {
  const shadow: ElevationShadow = elevation[level];
  const cardStyle: ViewStyle = padding === undefined ? styles.card : { ...styles.card, padding };
  return (
    <View testID={testID} style={[cardStyle, shadow, style]}>
      {children}
    </View>
  );
}
