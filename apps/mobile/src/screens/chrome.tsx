/**
 * PHASE-022 T-P22-2-e · the screen chrome helpers (MASTER-PLAN §8 + DR-P22-11:
 * screens are THIN view-model renders — these shared bits keep every field
 * screen identical in structure: heading, as-of label, advisory/blocking
 * banners, honest-state chips, the saved banner).
 *
 * Binding rules (the same as the primitives):
 *   - tokens ONLY (erp-ui/no-raw-design-values), logical style props ONLY
 *     (DR-P22-03 — the eslint ban is active), ≥44px targets come from the
 *     primitives (Button/ListItem/TabBar start from theme.touchTarget()).
 *   - every string through `t()` (DR-P22-04); every identifier run through
 *     the bidi isolates; money/qty/dates PRE-FORMATTED via digits.ts.
 *   - honest states render through the state-machine's tone + label keys
 *     (FLOW_STATE_TONE / flowStateLabelKey — a screen never invents a
 *     state color), and the SERVER document status renders through
 *     StatusChip (the §3 binding map — the only status→color path for
 *     document lifecycle states).
 */
import type { ReactNode } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";

import { Badge, StatusChip } from "../theme/primitives";
import { colors, space, typeScale, fontWeight } from "../theme/tokens";
import { formatDate, formatMoney, formatQty, t, type Locale } from "../i18n";
import type { PrevalidationIssue } from "../fieldsales/prevalidation";
import {
  FLOW_STATE_TONE,
  flowStateLabelKey,
  type HonestFlowState,
} from "../fieldsales/state-machine";

/** The shared screen styles (logical props only — DR-P22-03). */
export const screenStyles = StyleSheet.create({
  screen: { flex: 1, flexDirection: "column" },
  header: { flexDirection: "column", padding: space[4] },
  title: {
    fontSize: typeScale.xl.fontSize,
    lineHeight: typeScale.xl.lineHeight,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
  },
  intro: {
    fontSize: typeScale.sm.fontSize,
    lineHeight: typeScale.sm.lineHeight,
    color: colors.gray[600],
    marginTop: space[1],
  },
  body: { flexDirection: "column", padding: space[4], paddingTop: space[2] },
  row: { flexDirection: "row", alignItems: "center" },
  grow: { flex: 1 },
  bannerRow: { flexDirection: "column", marginTop: space[2], marginBottom: space[2] },
  bannerText: {
    fontSize: typeScale.sm.fontSize,
    lineHeight: typeScale.sm.lineHeight,
    color: colors.gray[900],
    marginTop: space[1],
  },
  metaText: {
    fontSize: typeScale.xs.fontSize,
    lineHeight: typeScale.xs.lineHeight,
    color: colors.gray[600],
    marginTop: space[1],
  },
  chipRow: { flexDirection: "row", alignItems: "center", marginTop: space[2], columnGap: space[2] },
  actionsRow: { flexDirection: "row", alignItems: "center", columnGap: space[2], marginTop: space[2] },
});

/** The screen heading (title + intro — both from the catalog). */
export function ScreenHeading({ locale, titleKey, introKey }: {
  locale: Locale;
  titleKey: Parameters<typeof t>[1];
  introKey?: Parameters<typeof t>[1];
}): ReactNode {
  return (
    <View style={screenStyles.header}>
      <Text accessibilityRole="header" style={screenStyles.title}>
        {t(locale, titleKey)}
      </Text>
      {introKey === undefined ? null : <Text style={screenStyles.intro}>{t(locale, introKey)}</Text>}
    </View>
  );
}

/** The as-of label for cached data (null → the never-synced honesty string). */
export function AsOfLabel({ locale, iso }: { locale: Locale; iso: string | null }): ReactNode {
  const text =
    iso === null
      ? t(locale, "asOfNeverSynced")
      : t(locale, "asOfLabel", { date: formatDate(locale, iso, "canonical") });
  return (
    <Text accessibilityLabel={text} style={screenStyles.metaText}>
      {text}
    </Text>
  );
}

/** Render one pre-validation issue's localized message — every numeric
 * context value PRE-FORMATTED through digits.ts (qty keys via formatQty,
 * money keys via formatMoney; the i18n handoff rule: screens never render
 * raw number strings). */
export function issueText(locale: Locale, issue: PrevalidationIssue): string {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(issue.context)) {
    if (key === "available" || key === "requested") {
      params[key] = formatQty(locale, value);
    } else if (key === "limit" || key === "used" || key === "balance") {
      params[key] = formatMoney(locale, value, "");
    } else {
      params[key] = value;
    }
  }
  const suffix = issue.line === undefined || issue.line === 0 ? "" : ` · ${String(issue.line)}`;
  const body = t(locale, issue.messageKey, params);
  return suffix === "" ? body : `${body}${suffix}`;
}

/** The advisory banner (warning tone) — advisories NEVER block the save. */
export function AdvisoryBanner({ locale, issues }: { locale: Locale; issues: readonly PrevalidationIssue[] }): ReactNode {
  if (issues.length === 0) return null;
  return (
    <View
      accessibilityLabel={issues.map((issue) => issueText(locale, issue)).join(" ")}
      style={screenStyles.bannerRow}
    >
      {issues.map((issue) => (
        <View key={`${issue.code}-${issue.line ?? 0}`} style={screenStyles.row}>
          <Badge label={t(locale, "advisoryLabel")} tone="warning" />
          <Text style={screenStyles.bannerText}>{issueText(locale, issue)}</Text>
        </View>
      ))}
    </View>
  );
}

/** The blocking banner (danger tone) — structural issues refuse the save. */
export function BlockingBanner({ locale, issues }: { locale: Locale; issues: readonly PrevalidationIssue[] }): ReactNode {
  if (issues.length === 0) return null;
  return (
    <View
      accessibilityLabel={issues.map((issue) => issueText(locale, issue)).join(" ")}
      style={screenStyles.bannerRow}
    >
      {issues.map((issue) => (
        <View key={`${issue.code}-${issue.line ?? 0}`} style={screenStyles.row}>
          <Badge label={t(locale, "blockingLabel")} tone="danger" />
          <Text style={screenStyles.bannerText}>{issueText(locale, issue)}</Text>
        </View>
      ))}
    </View>
  );
}

/** The honest-state chip: the flow state (Badge + the state-machine tone
 * binding) and, when the server decided, the server document status
 * (StatusChip — the §3 map). A screen never invents a state color. */
export function StateChipRow({ locale, state, serverStatus }: {
  locale: Locale;
  state: HonestFlowState;
  /** The server-side document status of an ACKED command (e.g. "DRAFT"). */
  serverStatus?: string | null;
}): ReactNode {
  return (
    <View style={screenStyles.chipRow}>
      <Badge
        label={t(locale, flowStateLabelKey(state))}
        tone={FLOW_STATE_TONE[state]}
        accessibilityLabel={t(locale, flowStateLabelKey(state))}
        testID={`flow-state-${state}`}
      />
      {serverStatus === undefined || serverStatus === null ? null : (
        <StatusChip status={serverStatus} testID="server-status-chip" />
      )}
    </View>
  );
}

/** The post-save banner (the SavedLocal vocabulary + the honest state). */
export function SavedBanner({ locale, messageKey, params, state }: {
  locale: Locale;
  messageKey: Parameters<typeof t>[1];
  params?: Record<string, string>;
  state: HonestFlowState;
}): ReactNode {
  const message = params === undefined ? t(locale, messageKey) : t(locale, messageKey, params);
  return (
    <View style={screenStyles.bannerRow} accessibilityLabel={message}>
      <Text style={screenStyles.bannerText}>{message}</Text>
      <StateChipRow locale={locale} state={state} />
    </View>
  );
}

/** A thin wrapper for layout (the screens' scroll container). */
export function ScreenBody({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }): ReactNode {
  return <View style={[screenStyles.body, style]}>{children}</View>;
}
