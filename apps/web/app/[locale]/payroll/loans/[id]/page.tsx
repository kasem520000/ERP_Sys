/**
 * /{locale}/payroll/loans/[id] — the loan workspace (PAGE_ARCHETYPES
 * §4): server-fetches the loan + its per-period schedule + the masked
 * employee row (the header) + the period pool (every year's periods in
 * parallel — the schedule's period column). 404 → notFound; 401 →
 * login; reference 403s degrade (raw period ids / a null employee).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../../components/client-ui";

import { AppShell } from "../../../../../components/app-shell";
import { LoanWorkspace } from "../../../../../components/loan-workspace";
import { RetryButton } from "../../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../../i18n/dictionaries";
import type {
  EmployeeListRow,
  EmployeeLoanRow,
  EmployeeLoanLineRow,
  FiscalPeriodRow,
  FiscalYearRow,
} from "../../../../../lib/api-types";
import { localizedApiError } from "../../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../../lib/server-api";

export default async function LoanDetailPage({
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

  const detail = await fetchApi<{ loan: EmployeeLoanRow; lines: EmployeeLoanLineRow[] }>(
    `payroll/loans/${id}`,
  );
  if (!detail.ok && detail.status === 401) {
    redirect(`/${locale}/login`);
  }
  if (!detail.ok && detail.status === 404) {
    notFound();
  }
  if (!detail.ok) {
    const forbidden = detail.status === 403 || detail.error.code === "FORBIDDEN";
    return (
      <AppShell locale={localeValue} pagePath={`payroll/loans/${id}`} title={d.payLoansTitle}>
        <ErrorState
          title={
            forbidden
              ? d.errorsForbidden
              : localizedApiError(d, detail.error, detail.retryAfterSeconds)
          }
          retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
        />
      </AppShell>
    );
  }

  const [employees, years] = await Promise.all([
    fetchApi<readonly EmployeeListRow[]>("payroll/employees"),
    fetchApi<readonly FiscalYearRow[]>("accounting/fiscal-years"),
  ]);
  if ((!employees.ok && employees.status === 401) || (!years.ok && years.status === 401)) {
    redirect(`/${locale}/login`);
  }

  const employee =
    employees.ok
      ? (employees.data.find((row) => row.id === detail.data.loan.employeeId) ?? null)
      : null;

  // The period pool: every year's periods in parallel (the schedule
  // spans consecutive periods — usually one or two years); failures
  // degrade to raw period ids in the schedule column.
  const yearList = years.ok ? years.data : [];
  const periodLists = await Promise.all(
    yearList.map((year) => fetchApi<readonly FiscalPeriodRow[]>(`accounting/fiscal-years/${year.id}/periods`)),
  );
  if (periodLists.some((entry) => !entry.ok && entry.status === 401)) {
    redirect(`/${locale}/login`);
  }
  const periods = periodLists.flatMap((entry) => (entry.ok ? entry.data : []));

  return (
    <AppShell locale={localeValue} pagePath={`payroll/loans/${id}`} title={detail.data.loan.code}>
      <LoanWorkspace
        locale={localeValue}
        loan={detail.data.loan}
        lines={detail.data.lines}
        employee={employee}
        periods={periods}
      />
    </AppShell>
  );
}
