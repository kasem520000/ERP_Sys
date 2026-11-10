/**
 * /{locale}/installments/new — the plan wizard (PAGE_ARCHETYPES §9): step 1
 * the source document (posted CREDIT sales invoices + ACTIVE service
 * contracts — the exact sets the API accepts; no manual UUID fallback
 * needed), step 2 the schedule parameters with the LIVE preview (the
 * client-side kernel mirror), step 3 the BR-049 policy with the
 * PLACEHOLDER (OQ-002) defaults. Reference lists are fetched server-side.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { InstallmentsTabs } from "../../../../components/installments-tabs";
import { InstallmentPlanWizard } from "../../../../components/installment-plan-wizard";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  PartnerRow,
  SalesInvoiceRow,
  ServiceContractReadRow,
  TenantProfile,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function NewInstallmentPlanPage({
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

  const [partners, salesInvoices, contracts, profile] = await Promise.all([
    fetchApi<readonly PartnerRow[]>("partners?limit=500"),
    fetchApi<readonly SalesInvoiceRow[]>("sales/sales-invoices?status=POSTED&kind=CREDIT&limit=50"),
    fetchApi<readonly ServiceContractReadRow[]>("crm/contracts?status=ACTIVE&limit=50"),
    fetchApi<TenantProfile>("tenancy/profile"),
  ]);
  if (
    (!partners.ok && partners.status === 401) ||
    (!salesInvoices.ok && salesInvoices.status === 401) ||
    (!contracts.ok && contracts.status === 401) ||
    (!profile.ok && profile.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!partners.ok) {
    const forbidden = partners.status === 403 || partners.error.code === "FORBIDDEN";
    content = (
      <div className="flex flex-col gap-4">
        <InstallmentsTabs locale={localeValue} active="plans" />
        <ErrorState
          title={
            forbidden
              ? d.errorsForbidden
              : localizedApiError(d, partners.error, partners.retryAfterSeconds)
          }
          retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
        />
      </div>
    );
  } else {
    content = (
      <div className="flex flex-col gap-4">
        <InstallmentsTabs locale={localeValue} active="plans" />
        <InstallmentPlanWizard
          locale={localeValue}
          partners={partners.data}
          salesInvoices={salesInvoices.ok ? salesInvoices.data : []}
          contracts={contracts.ok ? contracts.data : []}
          baseCurrency={profile.ok ? profile.data.baseCurrency : ""}
          today={new Date().toISOString().slice(0, 10)}
        />
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="installments/new" title={d.instNewTitle}>
      {content}
    </AppShell>
  );
}
