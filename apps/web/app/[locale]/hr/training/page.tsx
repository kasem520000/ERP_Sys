/**
 * /{locale}/hr/training — the talent board's training family
 * (PHASE-047 T-13, PAGE_ARCHETYPES §2 — the hr/shifts pattern): the
 * program catalog + the enrollments register + the certifications
 * (with the expiry chips the sweep rides). The first fetch rides
 * hr.training.view (a 403 renders the honest forbidden state); the
 * reference pools (employees, the tenant profile for the currency)
 * degrade to empty/SAR.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { HrTrainingBoard } from "../../../../components/hr-training-board";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type {
  CertificationRow,
  EmployeeListRow,
  TenantProfile,
  TrainingEnrollmentRow,
  TrainingProgramRow,
} from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function HrTrainingPage({
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

  const [programs, enrollments, certifications, employees, profile] = await Promise.all([
    fetchApi<readonly TrainingProgramRow[]>("hr/training/programs?limit=200"),
    fetchApi<readonly TrainingEnrollmentRow[]>("hr/training/enrollments?limit=200"),
    fetchApi<readonly CertificationRow[]>("hr/training/certifications?limit=500"),
    fetchApi<readonly EmployeeListRow[]>("payroll/employees"),
    fetchApi<TenantProfile>("tenancy/profile"),
  ]);
  if (
    (!programs.ok && programs.status === 401) ||
    (!enrollments.ok && enrollments.status === 401) ||
    (!certifications.ok && certifications.status === 401) ||
    (!employees.ok && employees.status === 401) ||
    (!profile.ok && profile.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!programs.ok) {
    const forbidden = programs.status === 403 || programs.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, programs.error, programs.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <HrTrainingBoard
        locale={localeValue}
        initialPrograms={programs.data}
        initialEnrollments={enrollments.ok ? enrollments.data : []}
        initialCertifications={certifications.ok ? certifications.data : []}
        employees={employees.ok ? employees.data : []}
        currency={profile.ok ? profile.data.baseCurrency : "SAR"}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="hr/training" title={d.hrTrainingTitle}>
      {content}
    </AppShell>
  );
}
