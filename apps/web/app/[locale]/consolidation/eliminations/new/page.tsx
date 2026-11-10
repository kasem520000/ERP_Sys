/**
 * /{locale}/consolidation/eliminations/new — the elimination Transaction
 * Entry workspace (PHASE-034 T11, PAGE_ARCHETYPES §4): group + fiscal period
 * + kind picks, the INTERCOMPANY member-pair uuid inputs with the on-demand
 * reader suggestions, the member-pair lines editor with the LIVE balanced
 * DR/CR preview, and the DRAFT → approve (SoD) → post → reverse lifecycle on
 * the created row. Reference lists are fetched server-side; the members +
 * suggestions load on demand through the BFF.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../../components/client-ui";

import { AppShell } from "../../../../../components/app-shell";
import { EliminationWorkspace } from "../../../../../components/elimination-workspace";
import { RetryButton } from "../../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../../i18n/dictionaries";
import type {
  ConsolidationGroupRow,
  FiscalPeriodRow,
  FiscalYearRow,
} from "../../../../../lib/api-types";
import { localizedApiError } from "../../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../../lib/server-api";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewEliminationPage({
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

  // Group-detail deep link (/consolidation/eliminations/new?groupId=…).
  const rawGroupId = query.groupId;
  const initialGroupId =
    typeof rawGroupId === "string" && UUID_RE.test(rawGroupId) ? rawGroupId : "";

  const [groups, years] = await Promise.all([
    fetchApi<readonly ConsolidationGroupRow[]>("consolidation/groups"),
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
      <EliminationWorkspace
        locale={localeValue}
        groups={groups.data}
        periods={periods}
        initialGroupId={initialGroupId}
        today={new Date().toISOString().slice(0, 10)}
      />
    );
  }

  return (
    <AppShell
      locale={localeValue}
      pagePath="consolidation/eliminations/new"
      title={d.consolidationNewElimination}
    >
      {content}
    </AppShell>
  );
}
