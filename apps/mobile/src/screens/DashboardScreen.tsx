/**
 * PHASE-022 T-P22-3-b · DashboardScreen (MASTER-PLAN §8 "Companion:
 * dashboard … READ-CACHED with as-of labels"; DR-P22-11 registry key
 * "Dashboard"). THIN by construction: the view-model is
 * `buildCompanionDashboard` + `searchMasterData` + `approvalsAffordance`
 * (all pure reads); this component only renders.
 *
 * NOT a financial screen (2-b's FINANCIAL_SCREENS keeps capture enabled
 * for the dashboard chrome — the money surfaces Statements/InvoiceList/
 * InvoiceView/PersonalHome carry FLAG_SECURE).
 */
import { useState, type ReactNode } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";

import type { StorageAdapter } from "@erp/sync-core";

import { t, type Locale } from "../i18n";
import { Badge, Button, Card, EmptyState, Field, ListItem, MoneyText } from "../theme/primitives";
import { screenStyles, ScreenHeading, AsOfLabel } from "./chrome";
import {
  approvalsAffordance,
  buildCompanionDashboard,
  searchMasterData,
  type DashboardMetric,
} from "../companion";
import { space, typeScale, colors } from "../theme/tokens";

const inputStyles = StyleSheet.create({
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.gray[300],
    borderRadius: 8,
    paddingStart: space[2],
    paddingEnd: space[2],
    color: colors.gray[900],
    fontSize: typeScale.sm.fontSize,
  },
});

/** One metric row: the per-currency sums + count + the as-of label. */
function MetricRows({
  locale,
  label,
  metric,
  testID,
}: {
  locale: Locale;
  label: string;
  metric: DashboardMetric;
  testID: string;
}): ReactNode {
  if (metric.count === 0) return null;
  return (
    <View style={screenStyles.bannerRow} testID={testID}>
      <Text style={screenStyles.bannerText}>{label}</Text>
      {metric.byCurrency.map((row) => (
        <MoneyText
          key={row.currencyCode}
          amount={row.amount}
          currency={row.currencyCode}
          locale={locale}
          align="end"
          testID={`${testID}-${row.currencyCode}`}
        />
      ))}
      <AsOfLabel locale={locale} iso={metric.asOf} />
    </View>
  );
}

/** The Dashboard screen props (navigation glue supplies the store). */
export interface DashboardScreenProps {
  locale: Locale;
  store: StorageAdapter;
  /** The business date (defaults to the device's today). */
  today?: string;
  /** Connectivity (the approvals affordance is ONLINE-ONLY — row 16). */
  online?: boolean;
  /** The approvals link-out (enabled only while online). */
  onApprovals?: () => void;
  /** The master-data search cap per kind (row 33). */
  searchLimit?: number;
}

/** The Dashboard screen (DR-P22-11: "Dashboard"). */
export function DashboardScreen({
  locale,
  store,
  today,
  online = false,
  onApprovals,
  searchLimit = 5,
}: DashboardScreenProps): ReactNode {
  const businessDay = today ?? new Date().toISOString().slice(0, 10);
  const dashboard = buildCompanionDashboard(store, { today: businessDay });
  const [query, setQuery] = useState("");
  const hits = searchMasterData(store, { query, limit: searchLimit });
  const approvals = approvalsAffordance(online);

  return (
    <View style={screenStyles.screen}>
      <ScreenHeading locale={locale} titleKey="homeTitle" introKey="dashboardIntro" />
      <Card testID="dashboard-today">
        <ListItem
          title={t(locale, "homeSectionToday")}
          subtitle={t(locale, "commonToday")}
          trailing={
            <Badge
              label={t(locale, "homeParkedTile", { count: String(dashboard.parkedRejections) })}
              tone={dashboard.parkedRejections > 0 ? "warning" : "info"}
              accessibilityLabel={t(locale, "homeParkedTile", { count: String(dashboard.parkedRejections) })}
              testID="dashboard-parked-badge"
            />
          }
          accessibilityLabel={t(locale, "homeSectionToday")}
          testID="dashboard-today-header"
        />
        <MetricRows locale={locale} label={t(locale, "homeMetricSales")} metric={dashboard.sales} testID="dashboard-metric-sales" />
        <MetricRows locale={locale} label={t(locale, "homeMetricCollections")} metric={dashboard.collections} testID="dashboard-metric-collections" />
        <MetricRows locale={locale} label={t(locale, "homeMetricCash")} metric={dashboard.cash} testID="dashboard-metric-cash" />
        <MetricRows locale={locale} label={t(locale, "homeMetricReturns")} metric={dashboard.returns} testID="dashboard-metric-returns" />
        {dashboard.vanStock === null ? null : (
          <View style={screenStyles.bannerRow} testID="dashboard-van-stock">
            <Text style={screenStyles.bannerText}>{t(locale, "homeVanStock")}</Text>
            <MoneyText amount={dashboard.vanStock.totalQty} currency="" locale={locale} align="end" testID="dashboard-van-stock-qty" />
            <AsOfLabel locale={locale} iso={dashboard.vanStock.asOf} />
          </View>
        )}
      </Card>

      {/* Row 16 — the ONLINE-ONLY approvals affordance: enabled only while
          online; offline → disabled WITH the honest reason (never queued). */}
      <Card testID="dashboard-approvals">
        <View style={screenStyles.row}>
          <View style={screenStyles.grow}>
            <Text style={screenStyles.bannerText}>{t(locale, "homeApprovalsTile")}</Text>
          </View>
          <Button
            label={t(locale, "homeApprovalsTile")}
            onPress={approvals.enabled && onApprovals !== undefined ? onApprovals : undefined}
            disabled={!approvals.enabled}
            accessibilityLabel={t(locale, "homeApprovalsTile")}
            accessibilityHint={approvals.enabled ? undefined : t(locale, "onlineOnlyReason")}
            testID="dashboard-approvals-button"
          />
        </View>
        {approvals.enabled ? null : (
          <Text style={screenStyles.metaText} testID="dashboard-approvals-reason">
            {t(locale, "approvalsOnlineOnly")}
          </Text>
        )}
      </Card>

      {/* Row 33 — master-data search from cache (as-of labeled per hit). */}
      <Card testID="dashboard-master-search">
        <Field label={t(locale, "masterSearchTitle")} hint={t(locale, "commonSearch")}>
          <TextInput
            accessibilityLabel={t(locale, "masterSearchTitle")}
            value={query}
            onChangeText={setQuery}
            testID="master-search-input"
            style={inputStyles.input}
          />
        </Field>
        {query.trim() === "" ? null : hits.length === 0 ? (
          <EmptyState title={t(locale, "masterSearchEmpty")} />
        ) : (
          hits.map((hit) => (
            <View key={`${hit.kind}-${hit.id}`}>
              <ListItem
                title={locale === "ar" && hit.nameAr !== null ? hit.nameAr : hit.name}
                subtitle={hit.kind === "item" ? t(locale, "commonItem") : t(locale, "commonCustomer")}
                leading={<Badge label={hit.code} mono tone="info" accessibilityLabel={hit.code} testID={`master-hit-${hit.kind}-${hit.id}`} />}
                accessibilityLabel={`${hit.code} ${hit.name}`}
                testID={`master-row-${hit.kind}-${hit.id}`}
              />
              <AsOfLabel locale={locale} iso={hit.asOf} />
            </View>
          ))
        )}
      </Card>
    </View>
  );
}
