/**
 * /{locale}/fixed-assets/depreciation — the runs list + run workspace
 * (PAGE_ARCHETYPES §4): runs server-seeded; the fiscal calendar (years)
 * rides the accounting route and degrades on 403 (raw period ids); the
 * client owns the period picker, assemble/post/reverse actions, the
 * editable UoP grid and the MoneySummaryBar live totals.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { DepreciationRuns } from "../../../../components/depreciation-runs";
import { FixedAssetsTabs } from "../../../../components/fixed-assets-tabs";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  DepreciationRunListRow,
  FiscalYearRow,
  TenantProfile,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function FixedAssetDepreciationPage({
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

  const [runs, years, profile] = await Promise.all([
    fetchApi<readonly DepreciationRunListRow[]>("fixed-assets/depreciation-runs?limit=50"),
    fetchApi<readonly FiscalYearRow[]>("accounting/fiscal-years"),
    fetchApi<TenantProfile>("tenancy/profile"),
  ]);
  if (!runs.ok && runs.status === 401) {
    redirect(`/${locale}/login`);
  }
  if (!profile.ok && profile.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!runs.ok) {
    const forbidden = runs.status === 403 || runs.error.code === "FORBIDDEN";
    content = (
      <div className="flex flex-col gap-4">
        <FixedAssetsTabs locale={localeValue} active="depreciation" />
        <ErrorState
          title={
            forbidden
              ? d.errorsForbidden
              : localizedApiError(d, runs.error, runs.retryAfterSeconds)
          }
          retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
        />
      </div>
    );
  } else {
    content = (
      <div className="flex flex-col gap-4">
        <FixedAssetsTabs locale={localeValue} active="depreciation" />
        <DepreciationRuns
          locale={localeValue}
          baseCurrency={profile.ok ? profile.data.baseCurrency : ""}
          initialRuns={runs.data}
          initialYears={years.ok ? years.data : []}
        />
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="fixed-assets/depreciation" title={d.faDepTitle}>
      {content}
    </AppShell>
  );
}
