/**
 * /{locale}/accounting/rates — the exchange-rate editor (requires
 * accounting.journal_entries.view for the list;
 * accounting.exchange_rates.manage for the upsert — enforced server-side).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AccountingRates } from "../../../../components/accounting-rates";
import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { ExchangeRateRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function RatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<JSX.Element> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const localeValue = locale as Locale;
  const d = getDictionary(localeValue);

  await requireSessionToken(localeValue);

  const rates = await fetchApi<readonly ExchangeRateRow[]>("accounting/exchange-rates");
  if (!rates.ok && rates.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!rates.ok) {
    const forbidden = rates.status === 403 || rates.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, rates.error, rates.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = <AccountingRates locale={localeValue} initialRates={rates.data} />;
  }

  return (
    <AppShell locale={localeValue} pagePath="accounting/rates" title={d.accountingRatesTitle}>
      {content}
    </AppShell>
  );
}
