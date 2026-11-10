/**
 * PHASE-022 T-P22-3-b · StatementScreen (MASTER-PLAN §8 row 13 — the
 * companion/personal statement; DR-P22-11 registry key "Statements", a
 * FINANCIAL screen — FLAG_SECURE applies via the native shell). THIN by
 * construction: the view-model is `buildStatementView` (the cached
 * StatementLite snapshot); this component only renders — entries with
 * their RUNNING BALANCE, the opening/closing balances, the aging rows,
 * and the as-of labels (stale is labeled, never guessed).
 */
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import type { StorageAdapter } from "@erp/sync-core";

import { t, type Locale } from "../i18n";
import { Card, EmptyState, ListItem, MoneyText } from "../theme/primitives";
import { screenStyles, ScreenHeading, AsOfLabel } from "./chrome";
import { buildStatementView, type StatementView } from "../companion";
import type { AgingBucket } from "../personal";

/** The aging bucket label keys (the honest due-date structure). */
const AGING_LABEL_KEY: Readonly<Record<AgingBucket, Parameters<typeof t>[1]>> = {
  not_due: "agingNotDue",
  "1_30": "aging1To30",
  "31_60": "aging31To60",
  "61_90": "aging61To90",
  "90_plus": "aging90Plus",
};

/** One statement entry row (doc + debit/credit + the running balance). */
function EntryRow({
  locale,
  view,
  index,
}: {
  locale: Locale;
  view: StatementView;
  index: number;
}): ReactNode {
  const entry = view.entries[index]!;
  const docLabel = entry.docRef ?? entry.sourceType;
  return (
    <View>
      <ListItem
        title={docLabel}
        subtitle={`${entry.entryDate} · ${t(locale, "statementsRunningBalance")}`}
        trailing={
          <View>
            <MoneyText amount={entry.debit} currency={entry.currencyCode} locale={locale} align="end" testID={`statement-debit-${index}`} />
            <MoneyText amount={`-${entry.credit}`} currency={entry.currencyCode} locale={locale} align="end" testID={`statement-credit-${index}`} />
          </View>
        }
        accessibilityLabel={`${docLabel} ${entry.entryDate}`}
        testID={`statement-entry-${index}`}
      />
      <MoneyText
        amount={entry.balance}
        currency={entry.currencyCode}
        locale={locale}
        align="end"
        testID={`statement-balance-${index}`}
      />
    </View>
  );
}

/** The Statements screen props (navigation glue supplies the store). */
export interface StatementScreenProps {
  locale: Locale;
  store: StorageAdapter;
  /** The partner whose statement is shown (null → the latest snapshot). */
  partnerId?: string | null;
}

/** The Statements screen (DR-P22-11: "Statements"). */
export function StatementScreen({
  locale,
  store,
  partnerId,
}: StatementScreenProps): ReactNode {
  const view = buildStatementView(store, { partnerId });
  return (
    <View style={screenStyles.screen}>
      <ScreenHeading locale={locale} titleKey="statementsTitle" introKey="statementsIntro" />
      {view === null ? (
        <EmptyState title={t(locale, "statementsEmpty")} />
      ) : (
        <Card testID="statement-card">
          <ListItem
            title={locale === "ar" && view.customerNameAr !== null ? view.customerNameAr : view.customerName}
            subtitle={`${t(locale, "commonReference")}: ${view.customerCode}`}
            accessibilityLabel={`${view.customerName} ${view.customerCode}`}
            testID="statement-partner"
          />
          <AsOfLabel locale={locale} iso={view.asOf} />
          {view.generatedAt === null ? null : (
            <ListItem
              title={t(locale, "statementsGeneratedAt", { date: view.generatedAt.slice(0, 10) })}
              accessibilityLabel={t(locale, "statementsGeneratedAt", { date: view.generatedAt.slice(0, 10) })}
              testID="statement-generated-at"
            />
          )}
          <View style={screenStyles.bannerRow}>
            <TextRow label={t(locale, "statementsOpeningBalance")} amount={view.openingBalance} currency={view.currencyCode} locale={locale} testID="statement-opening" />
          </View>
          {view.entries.map((_entry, index) => (
            <EntryRow key={index} locale={locale} view={view} index={index} />
          ))}
          <View style={screenStyles.bannerRow}>
            <TextRow label={t(locale, "statementsClosingBalance")} amount={view.closingBalance} currency={view.currencyCode} locale={locale} testID="statement-closing" />
          </View>
          {view.aging === null
            ? null
            : (Object.keys(AGING_LABEL_KEY) as AgingBucket[]).map((bucket) => (
                <View key={bucket} style={screenStyles.bannerRow} testID={`statement-aging-${bucket}`}>
                  <TextRow
                    label={t(locale, AGING_LABEL_KEY[bucket])}
                    amount={view.aging![bucket] ?? "0"}
                    currency={view.currencyCode}
                    locale={locale}
                    testID={`statement-aging-${bucket}-amount`}
                  />
                </View>
              ))}
        </Card>
      )}
    </View>
  );
}

/** A label + money row (the balance/aging lines). */
function TextRow({
  label,
  amount,
  currency,
  locale,
  testID,
}: {
  label: string;
  amount: string;
  currency: string;
  locale: Locale;
  testID: string;
}): ReactNode {
  return (
    <View style={screenStyles.row} testID={testID}>
      <View style={screenStyles.grow}>
        <Text style={screenStyles.bannerText} testID={`${testID}-label`}>
          {label}
        </Text>
      </View>
      <MoneyText amount={amount} currency={currency} locale={locale} align="end" testID={`${testID}-amount`} />
    </View>
  );
}
