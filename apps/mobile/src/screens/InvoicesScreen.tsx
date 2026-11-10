/**
 * PHASE-022 T-P22-3-b · InvoicesScreen (MASTER-PLAN §8 row 14 — the
 * companion's OWN documents list; DR-P22-11 registry key "InvoiceList",
 * a FINANCIAL screen — FLAG_SECURE applies via the native shell). THIN
 * by construction: the view-model is `buildOwnDocuments` (locally-created
 * + synced — the outbox rows with their honest states; the official
 * number appears ONLY on ACKED rows); this component only renders.
 */
import type { ReactNode } from "react";
import { View } from "react-native";

import type { StorageAdapter } from "@erp/sync-core";

import { bidiDocNumber, t, type Locale } from "../i18n";
import { Card, EmptyState, ListItem, MoneyText } from "../theme/primitives";
import { screenStyles, ScreenHeading, AsOfLabel, StateChipRow } from "./chrome";
import { buildOwnDocuments, type OwnDocumentRow } from "../companion";
import { flowStateLabelKey } from "../fieldsales/state-machine";

/** One own-document row (locally-created or synced). */
function DocumentRow({
  locale,
  doc,
  currencyFallback,
}: {
  locale: Locale;
  doc: OwnDocumentRow;
  currencyFallback: string;
}): ReactNode {
  const number = doc.officialNo ?? doc.localRef;
  const title = number === null ? t(locale, "invoiceViewNotPostedYet") : bidiDocNumber(number);
  const subtitleParts = [doc.orderDate ?? "", t(locale, flowStateLabelKey(doc.state))];
  return (
    <View>
      <ListItem
        title={title}
        subtitle={subtitleParts.filter((part) => part !== "").join(" · ")}
        trailing={
          <MoneyText
            amount={doc.totalAmount}
            currency={doc.currencyCode ?? currencyFallback}
            locale={locale}
            align="end"
            testID={`invoice-total-${doc.commandId}`}
          />
        }
        accessibilityLabel={`${title} ${doc.totalAmount}`}
        testID={`invoice-row-${doc.commandId}`}
      />
      <StateChipRow locale={locale} state={doc.state} serverStatus={doc.serverStatus} />
      <AsOfLabel locale={locale} iso={doc.asOf} />
    </View>
  );
}

/** The Invoices screen props (navigation glue supplies the store). */
export interface InvoicesScreenProps {
  locale: Locale;
  store: StorageAdapter;
  /** An optional filter (official no / local ref / partner id). */
  query?: string;
  /** The currency shown when a local document carries none. */
  currencyFallback?: string;
  /** The list cap. */
  limit?: number;
}

/** The Invoices screen (DR-P22-11: "InvoiceList"). */
export function InvoicesScreen({
  locale,
  store,
  query,
  currencyFallback = "SAR",
  limit = 50,
}: InvoicesScreenProps): ReactNode {
  const all = buildOwnDocuments(store, { limit });
  const needle = (query ?? "").trim().toLowerCase();
  const docs =
    needle === ""
      ? all
      : all.filter((doc) => {
          const haystack = [doc.officialNo, doc.localRef, doc.partnerId, doc.commandId]
            .filter((part): part is string => part !== null)
            .join(" ")
            .toLowerCase();
          return haystack.includes(needle);
        });
  return (
    <View style={screenStyles.screen}>
      <ScreenHeading locale={locale} titleKey="invoicesTitle" />
      {docs.length === 0 ? (
        <EmptyState title={t(locale, "invoicesEmpty")} />
      ) : (
        docs.map((doc) => (
          <Card key={doc.commandId} testID={`invoice-card-${doc.commandId}`}>
            <DocumentRow locale={locale} doc={doc} currencyFallback={currencyFallback} />
          </Card>
        ))
      )}
    </View>
  );
}
