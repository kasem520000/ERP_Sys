/**
 * /{locale}/hr/recruitment — the talent board's recruitment family
 * (PHASE-047 T-12, PAGE_ARCHETYPES §2 — the hr/shifts pattern): the
 * vacancy register + the BR-088 applicant pipeline + the panel
 * interviews. The first fetch rides hr.recruitment.view (a 403 renders
 * the honest forbidden state); the reference pools (positions,
 * employees, competencies) degrade to empty.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { HrRecruitmentBoard } from "../../../../components/hr-recruitment-board";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  ApplicantRow,
  CompetencyRow,
  EmployeeListRow,
  InterviewRow,
  PositionRow,
  VacancyRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function HrRecruitmentPage({
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

  const [vacancies, applicants, interviews, positions, employees, competencies] = await Promise.all([
    fetchApi<readonly VacancyRow[]>("hr/recruitment/vacancies?limit=200"),
    fetchApi<readonly ApplicantRow[]>("hr/recruitment/applicants?limit=200"),
    fetchApi<readonly InterviewRow[]>("hr/recruitment/interviews?limit=500"),
    fetchApi<readonly PositionRow[]>("hr/positions"),
    fetchApi<readonly EmployeeListRow[]>("payroll/employees"),
    fetchApi<readonly CompetencyRow[]>("hr/performance/competencies?active=true&limit=500"),
  ]);
  if (
    (!vacancies.ok && vacancies.status === 401) ||
    (!applicants.ok && applicants.status === 401) ||
    (!interviews.ok && interviews.status === 401) ||
    (!positions.ok && positions.status === 401) ||
    (!employees.ok && employees.status === 401) ||
    (!competencies.ok && competencies.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!vacancies.ok) {
    const forbidden = vacancies.status === 403 || vacancies.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, vacancies.error, vacancies.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <HrRecruitmentBoard
        locale={localeValue}
        initialVacancies={vacancies.data}
        initialApplicants={applicants.ok ? applicants.data : []}
        initialInterviews={interviews.ok ? interviews.data : []}
        positions={positions.ok ? positions.data : []}
        employees={employees.ok ? employees.data : []}
        activeCompetencies={competencies.ok ? competencies.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="hr/recruitment" title={d.hrRecruitmentTitle}>
      {content}
    </AppShell>
  );
}
