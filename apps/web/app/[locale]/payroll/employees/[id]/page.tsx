/**
 * /{locale}/payroll/employees/[id] — the employee workspace
 * (PAGE_ARCHETYPES §4): server-fetches the masked employee row (the read
 * is audit-logged server-side — payroll.employee_read) + the EOS balance
 * + the EOS policy + the reference pools and the treasury cash accounts
 * (the G-31 settlement pays from a real cash account) + THE TALENT 360
 * EXTENSION (PHASE-047 W-5 — the talent panels compose from the module
 * APIs and degrade honestly per fetch: a 403 hides its panel, reference
 * pools degrade to empty). 404 → notFound (RLS makes foreign ids
 * indistinguishable); 401 → login; reference 403s degrade to empty pools
 * (the honest scope).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../../components/client-ui";

import { AppShell } from "../../../../../components/app-shell";
import { EmployeeTalent360 } from "../../../../../components/employee-talent-360";
import { EmployeeWorkspace } from "../../../../../components/employee-workspace";
import { RetryButton } from "../../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../../i18n/dictionaries";
import type {
  ApplicantRow,
  BranchRow,
  CashAccountRow,
  CertificationRow,
  CostCenterRow,
  EmployeeDocumentRow,
  EmployeePlacementView,
  EmployeeReviewTrendRead,
  EmployeeListRow,
  EosBalanceRow,
  EosPolicyRow,
  GoalRow,
  ProjectRow,
  SalaryStructureRow,
  TenantProfile,
  TrainingEnrollmentRow,
  TrainingProgramRow,
  VacancyRow,
} from "../../../../../lib/api-types";
import { localizedApiError } from "../../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../../lib/server-api";

export default async function EmployeeDetailPage({
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

  const employee = await fetchApi<EmployeeListRow>(`payroll/employees/${id}`);
  if (!employee.ok && employee.status === 401) {
    redirect(`/${locale}/login`);
  }
  if (!employee.ok && employee.status === 404) {
    notFound();
  }
  if (!employee.ok) {
    const forbidden = employee.status === 403 || employee.error.code === "FORBIDDEN";
    return (
      <AppShell locale={localeValue} pagePath={`payroll/employees/${id}`} title={d.payEmployeesTitle}>
        <ErrorState
          title={
            forbidden
              ? d.errorsForbidden
              : localizedApiError(d, employee.error, employee.retryAfterSeconds)
          }
          retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
        />
      </AppShell>
    );
  }

  const [eos, policy, structures, branches, costCenters, projects, cashAccounts, profile, talent360] =
    await Promise.all([
      fetchApi<EosBalanceRow>(`payroll/eos/employees/${id}/balance`),
      fetchApi<EosPolicyRow>("payroll/eos/policy"),
      fetchApi<readonly SalaryStructureRow[]>("payroll/salary-structures"),
      fetchApi<readonly BranchRow[]>("tenancy/branches"),
      fetchApi<readonly CostCenterRow[]>("accounting/cost-centers"),
      fetchApi<readonly ProjectRow[]>("accounting/projects"),
      fetchApi<readonly CashAccountRow[]>("treasury/cash-accounts"),
      fetchApi<TenantProfile>("tenancy/profile"),
      // THE TALENT 360 EXTENSION (PHASE-047 W-5): one composed read-model
      // pass — every fetch degrades honestly on its own permission plane
      // (a 403 hides that panel; the employee master stays fully usable).
      Promise.all([
        fetchApi<EmployeePlacementView>(`hr/org/placement/${id}`),
        fetchApi<EmployeeReviewTrendRead>(`hr/performance/reviews/for-employee/${id}`),
        fetchApi<readonly GoalRow[]>(`hr/goals/for-employee/${id}`),
        fetchApi<readonly TrainingEnrollmentRow[]>(`hr/training/enrollments?employeeId=${id}&limit=200`),
        fetchApi<readonly TrainingProgramRow[]>("hr/training/programs?limit=500"),
        fetchApi<readonly CertificationRow[]>(`hr/training/certifications?employeeId=${id}&limit=500`),
        fetchApi<readonly EmployeeDocumentRow[]>(`hr/documents?employeeId=${id}&limit=500`),
        fetchApi<ApplicantRow | null>(`hr/recruitment/applicants/by-employee/${id}`),
        fetchApi<readonly VacancyRow[]>("hr/recruitment/vacancies?limit=200"),
      ]),
    ]);
  if (
    (!eos.ok && eos.status === 401) ||
    (!policy.ok && policy.status === 401) ||
    (!structures.ok && structures.status === 401) ||
    (!branches.ok && branches.status === 401) ||
    (!costCenters.ok && costCenters.status === 401) ||
    (!projects.ok && projects.status === 401) ||
    (!cashAccounts.ok && cashAccounts.status === 401) ||
    (!profile.ok && profile.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  const [placement, trend, goals, enrollments, programs, certifications, documents, applicant, vacancies] =
    talent360;

  return (
    <AppShell
      locale={localeValue}
      pagePath={`payroll/employees/${id}`}
      title={employee.data.code}
    >
      <div className="flex flex-col gap-4">
        <EmployeeWorkspace
          locale={localeValue}
          employee={employee.data}
          eos={eos.ok ? eos.data : { accrued: "0.0000", settled: null, balance: "0.0000" }}
          policy={policy.ok ? policy.data : { enabled: false, basisDays: null }}
          structures={structures.ok ? structures.data : []}
          branches={branches.ok ? branches.data : []}
          costCenters={costCenters.ok ? costCenters.data : []}
          projects={projects.ok ? projects.data : []}
          cashAccounts={cashAccounts.ok ? cashAccounts.data : []}
          currency={profile.ok ? profile.data.baseCurrency : "SAR"}
        />
        <EmployeeTalent360
          locale={localeValue}
          employeeId={employee.data.id}
          placement={placement.ok ? placement.data : null}
          trend={trend.ok ? trend.data.reviews : null}
          goals={goals.ok ? goals.data : null}
          enrollments={enrollments.ok ? enrollments.data : null}
          programs={programs.ok ? programs.data : []}
          certifications={certifications.ok ? certifications.data : null}
          documents={documents.ok ? documents.data : null}
          documentsAllowed={documents.ok}
          sourceApplicant={applicant.ok ? applicant.data : null}
          vacancies={vacancies.ok ? vacancies.data : []}
        />
      </div>
    </AppShell>
  );
}
