/**
 * /{locale}/treasury/payments — money-out documents (requires
 * purchasing.payments.view). Mirror of the receipts list; payee names
 * resolve from the partners reference (limit=100).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { RetryButton } from "../../../../components/retry-button";
import { TreasuryDocsTable } from "../../../../components/treasury-docs-table";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { PartnerRow, TreasuryDocRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function TreasuryPaymentsPage({
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

  const [payments, partners] = await Promise.all([
    fetchApi<readonly TreasuryDocRow[]>("treasury/payments"),
    fetchApi<readonly PartnerRow[]>("partners/partners?limit=100"),
  ]);
  if (!payments.ok && payments.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!payments.ok) {
    const forbidden = payments.status === 403 || payments.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, payments.error, payments.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <TreasuryDocsTable
        locale={localeValue}
        kind="payments"
        initialRows={payments.data}
        partners={partners.ok ? partners.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="treasury/payments" title={d.treasuryPaymentsTitle}>
      {content}
    </AppShell>
  );
}
