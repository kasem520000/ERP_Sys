/**
 * /{locale}/treasury/receipts — money-in documents (requires
 * sales.receipts.view). Partner names resolve from the partners reference
 * (limit=100); filters (status + value-date range) refetch through the BFF.
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

export default async function TreasuryReceiptsPage({
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

  const [receipts, partners] = await Promise.all([
    fetchApi<readonly TreasuryDocRow[]>("treasury/receipts"),
    fetchApi<readonly PartnerRow[]>("partners/partners?limit=100"),
  ]);
  if (!receipts.ok && receipts.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!receipts.ok) {
    const forbidden = receipts.status === 403 || receipts.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, receipts.error, receipts.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <TreasuryDocsTable
        locale={localeValue}
        kind="receipts"
        initialRows={receipts.data}
        partners={partners.ok ? partners.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="treasury/receipts" title={d.treasuryReceiptsTitle}>
      {content}
    </AppShell>
  );
}
