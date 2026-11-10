/**
 * /{locale}/consolidation — the consolidation workspace hub (PHASE-034 T11,
 * PAGE_ARCHETYPES §2 landing surface): server-fetches the groups + the recent
 * runs (+ the fiscal calendar for period labels); the client surface owns the
 * create-group dialog and re-fetches through the BFF. 403 renders the honest
 * forbidden state; the runs/fiscal-calendar 403s degrade to empty (the
 * reference-list rule — the hub itself stays usable).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../components/client-ui";

import { AppShell } from "../../../components/app-shell";
import { ConsolidationGroups } from "../../../components/consolidation-groups";
import { RetryButton } from "../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import type {
  ConsolidationGroupRow,
  ConsolidationRunRow,
  FiscalPeriodRow,
  FiscalYearRow,
} from "../../../lib/api-types";
import { localizedApiError } from "../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../lib/server-api";

export default async function ConsolidationPage({
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

  const [groups, runs, years] = await Promise.all([
    fetchApi<readonly ConsolidationGroupRow[]>("consolidation/groups"),
    fetchApi<readonly ConsolidationRunRow[]>("consolidation/runs"),
    fetchApi<readonly FiscalYearRow[]>("accounting/fiscal-years"),
  ]);
  if (!groups.ok && groups.status === 401) {
    redirect(`/${locale}/login`);
  }

  // The fiscal calendar is a display-only reference (period labels); its 403
  // degrades to raw period ids — the honest degrade, never a blocker.
  const yearRows = years.ok ? years.data : [];
  const periodLists = await Promise.all(
    yearRows.map((year) => fetchApi<readonly FiscalPeriodRow[]>(`accounting/fiscal-years/${year.id}/periods`)),
  );
  const periods = periodLists.flatMap((result) => (result.ok ? result.data : []));

  let content: JSX.Element;
  if (!groups.ok) {
    const forbidden = groups.status === 403 || groups.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, groups.error, groups.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <ConsolidationGroups
        locale={localeValue}
        initialGroups={groups.data}
        initialRuns={runs.ok ? runs.data.slice(0, 10) : []}
        periods={periods}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="consolidation" title={d.consolidationTitle}>
      {content}
    </AppShell>
  );
}
