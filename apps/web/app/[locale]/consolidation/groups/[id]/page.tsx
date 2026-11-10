/**
 * /{locale}/consolidation/groups/[id] — the group Settings surface
 * (PHASE-034 T11, PAGE_ARCHETYPES §8): the group header + editable settings
 * (name/nameAr/FX method/status via PUT), the members table with the
 * add/update/remove actions, and the group's eliminations + runs strips
 * (deep links into the module surfaces). 404 → notFound; 401 → login; the
 * reference 403s degrade (fiscal calendar labels fall back to raw ids).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../../components/client-ui";

import { AppShell } from "../../../../../components/app-shell";
import { ConsolidationGroupDetail } from "../../../../../components/consolidation-group-detail";
import { RetryButton } from "../../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../../i18n/dictionaries";
import type {
  ConsolidationGroupRow,
  ConsolidationRunRow,
  EliminationRow,
  FiscalPeriodRow,
  FiscalYearRow,
  GroupMemberRow,
} from "../../../../../lib/api-types";
import { localizedName, localizedApiError } from "../../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../../lib/server-api";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ConsolidationGroupDetailPage({
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

  const group = await fetchApi<ConsolidationGroupRow>(`consolidation/groups/${id}`);
  if (!group.ok && group.status === 401) {
    redirect(`/${locale}/login`);
  }
  if (!group.ok && (group.status === 404 || !UUID_RE.test(id))) {
    notFound();
  }
  if (!group.ok) {
    const forbidden = group.status === 403 || group.error.code === "FORBIDDEN";
    return (
      <AppShell
        locale={localeValue}
        pagePath={`consolidation/groups/${id}`}
        title={d.consolidationGroupsNav}
      >
        <ErrorState
          title={
            forbidden
              ? d.errorsForbidden
              : localizedApiError(d, group.error, group.retryAfterSeconds)
          }
          retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
        />
      </AppShell>
    );
  }

  const [members, eliminations, runs, years] = await Promise.all([
    fetchApi<readonly GroupMemberRow[]>(`consolidation/groups/${id}/members`),
    fetchApi<readonly EliminationRow[]>(`consolidation/eliminations?groupId=${id}`),
    fetchApi<readonly ConsolidationRunRow[]>(`consolidation/runs?groupId=${id}`),
    fetchApi<readonly FiscalYearRow[]>("accounting/fiscal-years"),
  ]);
  if (
    (!members.ok && members.status === 401) ||
    (!eliminations.ok && eliminations.status === 401) ||
    (!runs.ok && runs.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  // The fiscal calendar is display-only (period labels); a 403 degrades to
  // raw period ids — the honest degrade, never a blocker.
  const yearRows = years.ok ? years.data : [];
  const periodLists = await Promise.all(
    yearRows.map((year) => fetchApi<readonly FiscalPeriodRow[]>(`accounting/fiscal-years/${year.id}/periods`)),
  );
  const periods = periodLists.flatMap((result) => (result.ok ? result.data : []));

  return (
    <AppShell
      locale={localeValue}
      pagePath={`consolidation/groups/${id}`}
      title={localizedName(group.data.name, group.data.nameAr, localeValue)}
    >
      <ConsolidationGroupDetail
        locale={localeValue}
        initialGroup={group.data}
        initialMembers={members.ok ? members.data : []}
        initialEliminations={eliminations.ok ? eliminations.data : []}
        initialRuns={runs.ok ? runs.data : []}
        periods={periods}
      />
    </AppShell>
  );
}
