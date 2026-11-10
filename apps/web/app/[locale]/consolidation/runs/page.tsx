/**
 * /{locale}/consolidation/runs — the run Report Page (PHASE-034 T11,
 * PAGE_ARCHETYPES §7): server-fetches the runs register (the API's own filter
 * vocabulary — groupId/status deep links from the group Settings page land
 * here pre-filtered) + the group reference list + the fiscal calendar (period
 * labels); the client surface owns the create-run form (group + fiscal
 * period), the filters, the execute action and the COMPLETED snapshot viewer.
 * 403 renders the honest forbidden state; the reference 403s degrade.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { ConsolidationRuns } from "../../../../components/consolidation-runs";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  ConsolidationGroupRow,
  ConsolidationRunRow,
  FiscalPeriodRow,
  FiscalYearRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ConsolidationRunsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  const { locale } = await params;
  const query = await searchParams;
  if (!isLocale(locale)) {
    notFound();
  }
  const localeValue = locale as Locale;
  const d = getDictionary(localeValue);

  await requireSessionToken(localeValue);

  // Group-detail deep links (/consolidation/runs?groupId=…&status=…).
  const single = (key: string): string => {
    const value = query[key];
    return typeof value === "string" ? value : "";
  };
  const filters = {
    groupId: UUID_RE.test(single("groupId")) ? single("groupId") : "",
    status:
      single("status") === "QUEUED" ||
      single("status") === "RUNNING" ||
      single("status") === "COMPLETED" ||
      single("status") === "FAILED"
        ? single("status")
        : "",
  };

  const search = new URLSearchParams();
  if (filters.groupId !== "") {
    search.set("groupId", filters.groupId);
  }
  if (filters.status !== "") {
    search.set("status", filters.status);
  }
  const path =
    search.size === 0 ? "consolidation/runs" : `consolidation/runs?${search.toString()}`;

  const [runs, groups, years] = await Promise.all([
    fetchApi<readonly ConsolidationRunRow[]>(path),
    fetchApi<readonly ConsolidationGroupRow[]>("consolidation/groups"),
    fetchApi<readonly FiscalYearRow[]>("accounting/fiscal-years"),
  ]);
  if (!runs.ok && runs.status === 401) {
    redirect(`/${locale}/login`);
  }

  // The fiscal calendar is display-only (period labels); its 403 degrades to
  // raw period ids — the honest degrade, never a blocker.
  const yearRows = years.ok ? years.data : [];
  const periodLists = await Promise.all(
    yearRows.map((year) => fetchApi<readonly FiscalPeriodRow[]>(`accounting/fiscal-years/${year.id}/periods`)),
  );
  const periods = periodLists.flatMap((result) => (result.ok ? result.data : []));

  let content: JSX.Element;
  if (!runs.ok) {
    const forbidden = runs.status === 403 || runs.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, runs.error, runs.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <ConsolidationRuns
        locale={localeValue}
        initialRuns={runs.data}
        groups={groups.ok ? groups.data : []}
        periods={periods}
        initialFilters={filters}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="consolidation/runs" title={d.consolidationRunsNav}>
      {content}
    </AppShell>
  );
}
