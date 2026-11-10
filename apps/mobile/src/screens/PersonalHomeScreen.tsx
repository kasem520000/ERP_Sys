/**
 * PHASE-022 T-P22-3-b · PersonalHomeScreen (MASTER-PLAN §8 "Personal:
 * balance/statement/invoices/receipts/due dates/notifications —
 * READ-CACHED, as-of labels, ZERO write affordances"; OFFLINE_CAPABIL
 * ITIES_MATRIX row 29; DR-P22-11 registry key "PersonalHome", a
 * FINANCIAL screen — FLAG_SECURE applies via the native shell).
 *
 * The READ-ONLY proof is structural (the no-write source scan) AND
 * rendered: this component contains NO Button and NO onPress handler
 * anywhere — the tiles are display cards, not controls. Every cached
 * section carries its as-of label (stale is labeled, never guessed).
 */
import type { ReactNode } from "react";
import { Text, View } from "react-native";

import type { StorageAdapter } from "@erp/sync-core";

import { bidiDocNumber, t, type Locale } from "../i18n";
import { Badge, Card, EmptyState, ListItem, MoneyText } from "../theme/primitives";
import { screenStyles, ScreenHeading, AsOfLabel } from "./chrome";
import {
  AGING_BUCKETS,
  buildPersonalHome,
  type AgingBucket,
  type PersonalHomeView,
} from "../personal";

/** The aging bucket label keys (the honest due-date structure). */
const AGING_LABEL_KEY: Readonly<Record<AgingBucket, Parameters<typeof t>[1]>> = {
  not_due: "agingNotDue",
  "1_30": "aging1To30",
  "31_60": "aging31To60",
  "61_90": "aging61To90",
  "90_plus": "aging90Plus",
};

/** One recent-document row (invoice or receipt — display only). */
function RecentDocRow({
  locale,
  view,
  index,
}: {
  locale: Locale;
  view: PersonalHomeView;
  index: number;
}): ReactNode {
  const doc = view.recentDocs[index]!;
  const title =
    doc.number === null ? doc.id.slice(0, 8) : bidiDocNumber(doc.number);
  const kindLabel = doc.kind === "invoice" ? t(locale, "invoicesColNumber") : t(locale, "personalReceiptViewTitle");
  return (
    <View>
      <ListItem
        title={title}
        subtitle={`${kindLabel} · ${doc.status}`}
        trailing={
          doc.amount === null ? null : (
            <MoneyText
              amount={doc.amount}
              currency={doc.currencyCode ?? ""}
              locale={locale}
              align="end"
              testID={`personal-doc-amount-${doc.id}`}
            />
          )
        }
        accessibilityLabel={`${title} ${doc.status}`}
        testID={`personal-doc-${doc.id}`}
      />
      <AsOfLabel locale={locale} iso={doc.asOf} />
    </View>
  );
}

/** The PersonalHome screen props (navigation glue supplies the store). */
export interface PersonalHomeScreenProps {
  locale: Locale;
  store: StorageAdapter;
}

/** The PersonalHome screen (DR-P22-11: "PersonalHome") — read-only. */
export function PersonalHomeScreen({
  locale,
  store,
}: PersonalHomeScreenProps): ReactNode {
  const view = buildPersonalHome(store);
  return (
    <View style={screenStyles.screen}>
      <ScreenHeading locale={locale} titleKey="personalTitle" introKey="personalReadonlyNotice" />

      {/* The read-only notice — the class IS the message. */}
      <Card testID="personal-balance-card">
        {view.balance === null ? (
          <EmptyState title={t(locale, "personalBalanceNone")} />
        ) : (
          <View style={screenStyles.bannerRow}>
            <Text style={screenStyles.bannerText}>{t(locale, "personalBalanceLabel")}</Text>
            <MoneyText
              amount={view.balance.amount}
              currency={view.balance.currencyCode}
              locale={locale}
              align="end"
              testID="personal-balance-amount"
            />
            <AsOfLabel locale={locale} iso={view.balance.asOf} />
          </View>
        )}
        {view.linkedPartner === null ? null : (
          <ListItem
            title={locale === "ar" && view.linkedPartner.nameAr !== null ? view.linkedPartner.nameAr : view.linkedPartner.name}
            subtitle={`${t(locale, "personalLinkedPartner")}: ${view.linkedPartner.code}`}
            accessibilityLabel={view.linkedPartner.name}
            testID="personal-linked-partner"
          />
        )}
      </Card>

      {/* The due-date structure (aging — honest, never a guessed date). */}
      <Card testID="personal-aging-card">
        <ListItem
          title={t(locale, "personalDueSoon")}
          accessibilityLabel={t(locale, "personalDueSoon")}
          testID="personal-aging-header"
        />
        {AGING_BUCKETS.map((bucket) => (
          <View key={bucket} style={screenStyles.row} testID={`personal-aging-${bucket}`}>
            <View style={screenStyles.grow}>
              <Text style={screenStyles.bannerText}>{t(locale, AGING_LABEL_KEY[bucket])}</Text>
            </View>
            <MoneyText
              amount={view.aging.find((row) => row.bucket === bucket)?.amount ?? "0"}
              currency={view.balance?.currencyCode ?? ""}
              locale={locale}
              align="end"
              testID={`personal-aging-${bucket}-amount`}
            />
          </View>
        ))}
      </Card>

      {/* Recent documents (invoices + receipts — display only). */}
      <Card testID="personal-recent-card">
        {view.recentDocs.length === 0 ? (
          <EmptyState title={t(locale, "invoicesEmptyPersonal")} />
        ) : (
          view.recentDocs.map((_doc, index) => (
            <RecentDocRow key={view.recentDocs[index]!.id} locale={locale} view={view} index={index} />
          ))
        )}
      </Card>

      {/* The notifications cache (unread count + as-of). */}
      <Card testID="personal-notifications-card">
        <ListItem
          title={t(locale, "notificationsTitle")}
          trailing={
            <Badge
              label={t(locale, "notificationsUnreadCount", { count: String(view.unreadCount) })}
              tone={view.unreadCount > 0 ? "warning" : "info"}
              accessibilityLabel={t(locale, "notificationsUnreadCount", { count: String(view.unreadCount) })}
              testID="personal-unread-badge"
            />
          }
          accessibilityLabel={t(locale, "notificationsTitle")}
          testID="personal-notifications-header"
        />
        {view.notifications.length === 0 ? (
          <EmptyState title={t(locale, "notificationsEmpty")} />
        ) : (
          view.notifications.map((note) => (
            <View key={note.id}>
              <ListItem
                title={locale === "ar" ? (note.titleAr ?? "") : (note.titleEn ?? "")}
                subtitle={note.category ?? undefined}
                accessibilityLabel={locale === "ar" ? (note.titleAr ?? "") : (note.titleEn ?? "")}
                testID={`personal-note-${note.id}`}
              />
              <AsOfLabel locale={locale} iso={note.asOf} />
            </View>
          ))
        )}
      </Card>
    </View>
  );
}
