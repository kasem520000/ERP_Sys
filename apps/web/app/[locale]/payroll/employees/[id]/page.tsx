/**
 * /{locale}/payroll/employees/[id] — the employee workspace
 * (PAGE_ARCHETYPES §4): server-fetches the masked employee row (the read
 * is audit-logged server-side — payroll.employee_read) + the EOS balance
 * + the EOS policy + the reference pools and the treasury cash accounts
 * (the G-31 settlement pays from a real cash account). 404 → notFound
 * (RLS makes foreign ids indistinguishable); 401 → login; reference
 * 403s degrade to empty pools (the honest scope).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../../components/client-ui";

import { AppShell } from "../../../../../components/app-shell";
import { EmployeeWorkspace } from "../../../../../components/employee-workspace";
import { RetryButton } from "../../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../../i18n/dictionaries";
import type {
  BranchRow,
  CashAccountRow,
  CostCenterRow,
  EosBalanceRow,
  EosPolicyRow,
  EmployeeListRow,
  ProjectRow,
  SalaryStructureRow,
  TenantProfile,
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

  const [eos, policy, structures, branches, costCenters, projects, cashAccounts, profile] =
    await Promise.all([
      fetchApi<EosBalanceRow>(`payroll/eos/employees/${id}/balance`),
      fetchApi<EosPolicyRow>("payroll/eos/policy"),
      fetchApi<readonly SalaryStructureRow[]>("payroll/salary-structures"),
      fetchApi<readonly BranchRow[]>("tenancy/branches"),
      fetchApi<readonly CostCenterRow[]>("accounting/cost-centers"),
      fetchApi<readonly ProjectRow[]>("accounting/projects"),
      fetchApi<readonly CashAccountRow[]>("treasury/cash-accounts"),
      fetchApi<TenantProfile>("tenancy/profile"),
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

  return (
    <AppShell
      locale={localeValue}
      pagePath={`payroll/employees/${id}`}
      title={employee.data.code}
    >
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
    </AppShell>
  );
}
