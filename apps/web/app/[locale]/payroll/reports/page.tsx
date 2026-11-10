/**
 * /{locale}/payroll/reports — the module report page (PAGE_ARCHETYPES
 * §7): the PHASE-013 report workspace reused with the module prefix —
 * the registry snapshot is filtered to the `payroll.*` keys
 * (payroll.register + payroll.cost-summary + payroll.eos-provision);
 * the run history scopes to the same prefix.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { InfoNotice } from "../../../../components/notices";
import { ReportWorkspace } from "../../../../components/report-workspace";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CurrentSession,
  ReportRegistryItem,
  ReportRunSummary,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

const REPORT_KEY_PREFIX = "payroll.";

export default async function PayrollReportsPage({
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

  const [registry, runs, session] = await Promise.all([
    fetchApi<readonly ReportRegistryItem[]>("reporting/reports"),
    fetchApi<readonly ReportRunSummary[]>("reporting/report-runs?limit=20"),
    fetchApi<CurrentSession>("identity/sessions/current"),
  ]);
  if (
    (!registry.ok && registry.status === 401) ||
    (!runs.ok && runs.status === 401) ||
    (!session.ok && session.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!registry.ok) {
    const forbidden = registry.status === 403 || registry.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, registry.error, registry.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    const moduleRegistry = registry.data.filter((item) =>
      item.id.startsWith(REPORT_KEY_PREFIX),
    );
    const moduleRuns = (runs.ok ? runs.data : []).filter((row) =>
      row.reportKey.startsWith(REPORT_KEY_PREFIX),
    );
    content = (
      <div className="flex flex-col gap-4">
        {moduleRegistry.length === 0 ? (
          <InfoNotice>{d.payReportsEmpty}</InfoNotice>
        ) : (
          <ReportWorkspace
            locale={localeValue}
            registry={moduleRegistry}
            initialRuns={moduleRuns}
            permissions={session.ok ? session.data.permissions : []}
            canExport={
              session.ok ? session.data.permissions.includes("reporting.reports.export") : false
            }
            reportKeyPrefix={REPORT_KEY_PREFIX}
          />
        )}
      </div>
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="payroll/reports" title={d.payReportsTitle}>
      {content}
    </AppShell>
  );
}
