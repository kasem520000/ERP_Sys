/**
 * /{locale}/hr/performance — the talent board's performance family
 * (PHASE-047 T-11, PAGE_ARCHETYPES §2 List+Search — the hr/shifts
 * pattern): the cycles register + the own-rows review plane + the
 * calibration view (BR-090's aggregates) + the goals cascade + the
 * competency framework. The first fetch rides hr.performance.view (a
 * 403 renders the honest forbidden state); the own-planes' fetches
 * degrade to null (the honest no-permission notices render INSIDE the
 * board — the other tabs stay usable); reference pools (org units,
 * employees) degrade to empty (the 046 reference-scope precedent).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { HrPerformanceBoard } from "../../../../components/hr-performance-board";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CompetencyLevelRow,
  CompetencyRow,
  EmployeeListRow,
  GoalRow,
  OrgUnitRow,
  PerformanceCycleRow,
  PerformanceReviewRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function HrPerformancePage({
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

  const [cycles, competencies, levels, orgUnits, employees, ownReviews, ownGoals] = await Promise.all([
    fetchApi<readonly PerformanceCycleRow[]>("hr/performance/cycles?limit=200"),
    fetchApi<readonly CompetencyRow[]>("hr/performance/competencies?limit=500"),
    fetchApi<readonly CompetencyLevelRow[]>("hr/performance/competencies/levels"),
    fetchApi<readonly OrgUnitRow[]>("hr/org/units"),
    fetchApi<readonly EmployeeListRow[]>("payroll/employees"),
    // The own planes degrade to null (hr.performance.review absent — the
    // accountant's read-only scope keeps every other tab usable).
    fetchApi<readonly PerformanceReviewRow[]>("hr/performance/reviews/own"),
    fetchApi<readonly GoalRow[]>("hr/goals/own"),
  ]);
  if (
    (!cycles.ok && cycles.status === 401) ||
    (!competencies.ok && competencies.status === 401) ||
    (!levels.ok && levels.status === 401) ||
    (!orgUnits.ok && orgUnits.status === 401) ||
    (!employees.ok && employees.status === 401) ||
    (!ownReviews.ok && ownReviews.status === 401) ||
    (!ownGoals.ok && ownGoals.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!cycles.ok) {
    const forbidden = cycles.status === 403 || cycles.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, cycles.error, cycles.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <HrPerformanceBoard
        locale={localeValue}
        initialCycles={cycles.data}
        initialCompetencies={competencies.ok ? competencies.data : []}
        initialLevels={levels.ok ? levels.data : []}
        initialOwnReviews={ownReviews.ok ? ownReviews.data : null}
        initialOwnGoals={ownGoals.ok ? ownGoals.data : null}
        orgUnits={orgUnits.ok ? orgUnits.data : []}
        employees={employees.ok ? employees.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="hr/performance" title={d.hrPerformanceTitle}>
      {content}
    </AppShell>
  );
}
