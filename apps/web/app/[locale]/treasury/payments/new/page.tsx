/**
 * /{locale}/treasury/payments/new — the money-out transaction entry
 * (transaction-entry archetype; requires purchasing.payments.create):
 * mirror of the receipt form with the AP allocation panel (supplier open
 * items). Saving creates the DRAFT then PUTs the allocations.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../../components/client-ui";

import { AppShell } from "../../../../../components/app-shell";
import { RetryButton } from "../../../../../components/retry-button";
import { TreasuryDocForm } from "../../../../../components/treasury-doc-form";
import { getDictionary, isLocale, type Locale } from "../../../../../i18n/dictionaries";
import type { CashAccountRow, PartnerRow, TenantProfile } from "../../../../../lib/api-types";
import { localizedApiError } from "../../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../../lib/server-api";

export default async function NewPaymentPage({
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

  const [cashAccounts, partners, profile] = await Promise.all([
    fetchApi<readonly CashAccountRow[]>("treasury/cash-accounts"),
    fetchApi<readonly PartnerRow[]>("partners/partners?limit=100"),
    fetchApi<TenantProfile>("tenancy/profile"),
  ]);
  if (
    (!cashAccounts.ok && cashAccounts.status === 401) ||
    (!partners.ok && partners.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!cashAccounts.ok) {
    const forbidden = cashAccounts.status === 403 || cashAccounts.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, cashAccounts.error, cashAccounts.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <TreasuryDocForm
        locale={localeValue}
        kind="payments"
        side="AP"
        baseCurrency={profile.ok ? profile.data.baseCurrency : ""}
        cashAccounts={cashAccounts.data}
        partners={partners.ok ? partners.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="treasury/payments/new" title={d.treasuryPaymentsNew}>
      {content}
    </AppShell>
  );
}
