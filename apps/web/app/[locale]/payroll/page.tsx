/**
 * /{locale}/payroll — the employees register (PAGE_ARCHETYPES §2,
 * List+Search): server-fetches the masked employee register + the
 * branch/structure reference lists; the client table owns the
 * status/branch filters (re-fetch through the BFF — the API's own filter
 * vocabulary) and the client-side free-text search. 403 renders the
 * honest forbidden state; the PII notice rides the client table.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../components/client-ui";

import { AppShell } from "../../../components/app-shell";
import { PayrollEmployeesTable } from "../../../components/payroll-employees-table";
import { RetryButton } from "../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import type { BranchRow, EmployeeListRow, SalaryStructureRow } from "../../../lib/api-types";
import { localizedApiError } from "../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../lib/server-api";

export default async function PayrollEmployeesPage({
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

  const [employees, structures, branches] = await Promise.all([
    // The employees list route carries no limit/search parameters — the
    // register is the per-tenant employee set (masked by construction).
    fetchApi<readonly EmployeeListRow[]>("payroll/employees"),
    fetchApi<readonly SalaryStructureRow[]>("payroll/salary-structures"),
    fetchApi<readonly BranchRow[]>("tenancy/branches"),
  ]);
  if (
    (!employees.ok && employees.status === 401) ||
    (!structures.ok && structures.status === 401) ||
    (!branches.ok && branches.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!employees.ok) {
    const forbidden = employees.status === 403 || employees.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, employees.error, employees.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <PayrollEmployeesTable
        locale={localeValue}
        initialRows={employees.data}
        structures={structures.ok ? structures.data : []}
        branches={branches.ok ? branches.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="payroll" title={d.payEmployeesTitle}>
      {content}
    </AppShell>
  );
}
