/**
 * PHASE-022 T-P22-2-e · RouteVisitsScreen (MASTER-PLAN §8 — the Journey
 * G2/G3 list; DR-P22-11 registry key "RouteVisits"): today's visits with
 * per-customer tier pricing + balances from cache, visit completion state,
 * and the sell-here / collect-here navigation affordances.
 *
 * THIN by construction: the view-model is `buildRouteVisitDays` (the pure
 * route-visits flow module); this component only renders it (plus the
 * as-of labels the READ-CACHED rows demand — stale is labeled, never
 * guessed). NOT a financial screen (2-b's FINANCIAL_SCREENS list).
 */
import type { ReactNode } from "react";
import { View } from "react-native";

import { t, formatMoney, type Locale } from "../i18n";
import type { StorageAdapter } from "@erp/sync-core";
import { Badge, Button, Card, EmptyState, ListItem, MoneyText } from "../theme/primitives";
import { screenStyles, ScreenHeading, AsOfLabel } from "./chrome";
import { buildRouteVisitDays, type RouteVisitCustomer } from "../fieldsales/route-visits";

/** The RouteVisits screen props (navigation glue supplies the store). */
export interface RouteVisitsScreenProps {
  locale: Locale;
  store: StorageAdapter;
  /** The plan date (defaults to the device's today). */
  today?: string;
  /** Narrow to one rep's routes (the logged-in rep). */
  salesRepId?: string | null;
  /** "Sell here" → VanSaleCapture with the partner preselected. */
  onSell?: (partnerId: string, partnerName: string, vanWarehouseId: string | null) => void;
  /** "Collect here" → Collection with the partner preselected. */
  onCollect?: (partnerId: string, partnerName: string) => void;
}

/** The visit-state chip (PLANNED/DONE/SKIPPED — the flow's states). */
function VisitStateBadge({ locale, state }: { locale: Locale; state: RouteVisitCustomer["visitState"] }): ReactNode {
  const label =
    state === "DONE" ? t(locale, "routesVisitDone") : state === "SKIPPED" ? t(locale, "routesVisitSkipped") : t(locale, "routesVisitPlanned");
  const tone = state === "DONE" ? "success" : state === "SKIPPED" ? "warning" : "info";
  return <Badge label={label} tone={tone} accessibilityLabel={label} testID={`visit-state-${state}`} />;
}

/** One customer visit row. */
function VisitRow({ locale, customer, currency, onSell, onCollect }: {
  locale: Locale;
  customer: RouteVisitCustomer;
  currency: string;
  onSell?: RouteVisitsScreenProps["onSell"];
  onCollect?: RouteVisitsScreenProps["onCollect"];
}): ReactNode {
  const subtitleParts: string[] = [];
  if (customer.creditLimit !== null) {
    subtitleParts.push(t(locale, "routesVisitCreditLimit", { limit: formatMoney(locale, customer.creditLimit, customer.currencyCode ?? currency) }));
  }
  subtitleParts.push(t(locale, "routesVisitOpenInvoices", { count: String(customer.openInvoices) }));
  subtitleParts.push(customer.tierPricing ? t(locale, "routesVisitTierPricing") : t(locale, "routesVisitNoTierPricing"));
  return (
    <View>
      <ListItem
        title={customer.name}
        subtitle={subtitleParts.join(" · ")}
        leading={<VisitStateBadge locale={locale} state={customer.visitState} />}
        trailing={
          customer.balance === null ? null : (
            <MoneyText amount={customer.balance} currency={customer.currencyCode ?? currency} locale={locale} align="end" />
          )
        }
        accessibilityLabel={`${customer.name} ${customer.balance === null ? "" : formatMoney(locale, customer.balance, customer.currencyCode ?? currency)}`}
        testID={`visit-row-${customer.partnerId}`}
      />
      <AsOfLabel locale={locale} iso={customer.asOf} />
      <View style={screenStyles.actionsRow}>
        {onSell === undefined ? null : (
          <Button
            label={t(locale, "routesVisitSellHere")}
            onPress={() => onSell(customer.partnerId, customer.name, null)}
            accessibilityLabel={t(locale, "routesVisitSellHere")}
            testID={`sell-here-${customer.partnerId}`}
          />
        )}
        {onCollect === undefined ? null : (
          <Button
            label={t(locale, "routesVisitCollectHere")}
            variant="secondary"
            onPress={() => onCollect(customer.partnerId, customer.name)}
            accessibilityLabel={t(locale, "routesVisitCollectHere")}
            testID={`collect-here-${customer.partnerId}`}
          />
        )}
      </View>
    </View>
  );
}

/** The RouteVisits screen (DR-P22-11: "RouteVisits"). */
export function RouteVisitsScreen({
  locale,
  store,
  today,
  salesRepId,
  onSell,
  onCollect,
}: RouteVisitsScreenProps): ReactNode {
  const days = buildRouteVisitDays(store, { today, salesRepId });
  return (
    <View style={screenStyles.screen}>
      <ScreenHeading locale={locale} titleKey="routesTitle" introKey="routesIntro" />
      {days.length === 0 ? (
        <EmptyState title={t(locale, "routesEmpty")} />
      ) : (
        days.map((day) => (
          <Card key={day.routeId} testID={`route-day-${day.routeId}`}>
            <ListItem
              title={day.name}
              subtitle={day.code}
              accessibilityLabel={`${day.name} ${day.code}`}
              testID={`route-header-${day.routeId}`}
            />
            {day.customers.map((customer) => (
              <VisitRow
                key={`${day.routeId}-${customer.partnerId}`}
                locale={locale}
                customer={customer}
                currency="SAR"
                onSell={
                  onSell === undefined
                    ? undefined
                    : (partnerId, partnerName) => onSell(partnerId, partnerName, day.vanWarehouseId)
                }
                onCollect={onCollect}
              />
            ))}
          </Card>
        ))
      )}
    </View>
  );
}
