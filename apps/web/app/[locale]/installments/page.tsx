/**
 * /{locale}/installments — the plans list (PAGE_ARCHETYPES §2, List+Search):
 * server-fetches the plan snapshot + the partner reference list; the client
 * table owns the filters (partner/status incl. DRAFT→NULL, source type) and
 * re-fetches through the BFF. 403 renders the honest forbidden state.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../components/client-ui";

import { AppShell } from "../../../components/app-shell";
import { InstallmentsTable } from "../../../components/installments-table";
import { InstallmentsTabs } from "../../../components/installments-tabs";
import { RetryButton } from "../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import type { InstallmentPlanRow, PartnerRow } from "../../../lib/api-types";
import { localizedApiError } from "../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../lib/server-api";

export default async function InstallmentsPage({
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

  const [plans, partners] = await Promise.all([
    fetchApi<readonly InstallmentPlanRow[]>("installment-plans?limit=200"),
    fetchApi<readonly PartnerRow[]>("partners?limit=500"),
  ]);
  if (!plans.ok && plans.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!plans.ok) {
    const forbidden = plans.status === 403 || plans.error.code === "FORBIDDEN";
    content = (
      <div className="flex flex-col gap-4">
        <InstallmentsTabs locale={localeValue} active="plans" />
        <ErrorState
          title={
            forbidden
              ? d.errorsForbidden
              : localizedApiError(d, plans.error, plans.retryAfterSeconds)
          }
          retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
        />
      </div>
    );
  } else {
    content = (
      <div className="flex flex-col gap-4">
        <InstallmentsTabs locale={localeValue} active="plans" />
        <InstallmentsTable
          locale={localeValue}
          initialRows={plans.data}
          partners={partners.ok ? partners.data : []}
        />
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="installments" title={d.instTitle}>
      {content}
    </AppShell>
  );
}
