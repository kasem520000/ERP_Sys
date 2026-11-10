/**
 * /{locale}/installments/[id] — the schedule document detail (PAGE_ARCHETYPES
 * §5): the plan overview + BR-049 policy DefLists and the lines table
 * (seq/due/amount/status/receipt refs/late fee) with the per-line actions
 * (waive — reason-required dialog, owner-permission-gated; charge-late-fee
 * — OVERDUE lines). 404 → notFound; 401 → login; reference 403s degrade.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { InstallmentPlanDetail } from "../../../../components/installment-plan-detail";
import { InstallmentsTabs } from "../../../../components/installments-tabs";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CurrentSession,
  InstallmentPlanDetailRow,
  PartnerRow,
  TenantProfile,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function InstallmentPlanDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<JSX.Element> {
  const { locale, id } = await params;
  if (!isLocale(locale)) {
    notFound();
  }
  const localeValue = locale as Locale;
  const d = getDictionary(localeValue);

  await requireSessionToken(localeValue);

  const detail = await fetchApi<InstallmentPlanDetailRow>(`installment-plans/${id}`);
  if (!detail.ok && detail.status === 401) {
    redirect(`/${locale}/login`);
  }
  if (!detail.ok && detail.status === 404) {
    notFound();
  }
  if (!detail.ok) {
    const forbidden = detail.status === 403 || detail.error.code === "FORBIDDEN";
    return (
      <AppShell locale={localeValue} pagePath={`installments/${id}`} title={d.instTitle}>
        <div className="flex flex-col gap-4">
          <InstallmentsTabs locale={localeValue} active="plans" />
          <ErrorState
            title={
              forbidden
                ? d.errorsForbidden
                : localizedApiError(d, detail.error, detail.retryAfterSeconds)
            }
            retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
          />
        </div>
      </AppShell>
    );
  }

  const [partners, session, profile] = await Promise.all([
    fetchApi<readonly PartnerRow[]>("partners?limit=500"),
    fetchApi<CurrentSession>("identity/sessions/current"),
    fetchApi<TenantProfile>("tenancy/profile"),
  ]);
  if (
    (!partners.ok && partners.status === 401) ||
    (!session.ok && session.status === 401) ||
    (!profile.ok && profile.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  const partner =
    partners.ok ? partners.data.find((entry) => entry.id === detail.data.plan.partnerId) ?? null : null;

  return (
    <AppShell
      locale={localeValue}
      pagePath={`installments/${id}`}
      title={detail.data.plan.sourceNo ?? d.instTitle}
    >
      <div className="flex flex-col gap-4">
        <InstallmentsTabs locale={localeValue} active="plans" />
        <InstallmentPlanDetail
          locale={localeValue}
          detail={detail.data}
          partner={partner}
          permissions={session.ok ? session.data.permissions : []}
          baseCurrency={profile.ok ? profile.data.baseCurrency : ""}
        />
      </div>
    </AppShell>
  );
}
