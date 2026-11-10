/**
 * /{locale}/payroll/employees/new — employee registration
 * (PAGE_ARCHETYPES §3, Create/Edit): bilingual identity + employment
 * fields; the reference pools (structures/branches/cost-centers/projects
 * + the base currency for the money field) are fetched server-side; the
 * client form owns the inputs and the create POST through the BFF. PII
 * inputs cross the wire once (create) and never return in clear — the
 * register renders masked shapes only.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../../components/client-ui";

import { AppShell } from "../../../../../components/app-shell";
import { EmployeeForm } from "../../../../../components/employee-form";
import { RetryButton } from "../../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../../i18n/dictionaries";
import type {
  BranchRow,
  CostCenterRow,
  ProjectRow,
  SalaryStructureRow,
  TenantProfile,
} from "../../../../../lib/api-types";
import { localizedApiError } from "../../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../../lib/server-api";

export default async function NewEmployeePage({
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

  const [structures, branches, costCenters, projects, profile] = await Promise.all([
    fetchApi<readonly SalaryStructureRow[]>("payroll/salary-structures"),
    fetchApi<readonly BranchRow[]>("tenancy/branches"),
    fetchApi<readonly CostCenterRow[]>("accounting/cost-centers"),
    fetchApi<readonly ProjectRow[]>("accounting/projects"),
    fetchApi<TenantProfile>("tenancy/profile"),
  ]);
  if (
    (!structures.ok && structures.status === 401) ||
    (!branches.ok && branches.status === 401) ||
    (!costCenters.ok && costCenters.status === 401) ||
    (!projects.ok && projects.status === 401) ||
    (!profile.ok && profile.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!structures.ok) {
    const forbidden = structures.status === 403 || structures.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, structures.error, structures.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <EmployeeForm
        locale={localeValue}
        mode="create"
        structures={structures.data}
        branches={branches.ok ? branches.data : []}
        costCenters={costCenters.ok ? costCenters.data : []}
        projects={projects.ok ? projects.data : []}
        currency={profile.ok ? profile.data.baseCurrency : "SAR"}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="payroll/employees/new" title={d.payEmployeeCreateTitle}>
      {content}
    </AppShell>
  );
}
