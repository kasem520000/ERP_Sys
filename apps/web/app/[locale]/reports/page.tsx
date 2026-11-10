/**
 * /{locale}/reports — the PHASE-013 report workspace (report archetype §7):
 * the registry snapshot + the run history load server-side; the client
 * component owns the catalog, parameter bar, saved views, run/poll, result
 * envelope, exports and print preview. The workspace itself requires
 * reporting.reports.run (the snapshot route's own guard — a 403 renders the
 * honest forbidden state); per-report rows are filtered against the
 * session's permission set, and exports additionally need
 * reporting.reports.export (derived as canExport, enforced server-side).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../components/client-ui";

import { AppShell } from "../../../components/app-shell";
import { ReportWorkspace } from "../../../components/report-workspace";
import { RetryButton } from "../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import type { CurrentSession, ReportRegistryItem, ReportRunSummary } from "../../../lib/api-types";
import { localizedApiError } from "../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../lib/server-api";

export default async function ReportsPage({
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
    const permissions = session.ok ? session.data.permissions : [];
    content = (
      <ReportWorkspace
        locale={localeValue}
        registry={registry.data}
        initialRuns={runs.ok ? runs.data : []}
        permissions={permissions}
        canExport={permissions.includes("reporting.reports.export")}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="reports" title={d.reportWorkspaceTitle}>
      {content}
    </AppShell>
  );
}
