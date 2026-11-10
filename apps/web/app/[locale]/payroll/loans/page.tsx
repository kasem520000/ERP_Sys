/**
 * /{locale}/payroll/loans — the employee loans register (PAGE_ARCHETYPES
 * §2, List+Search): server-fetches the loans register + the masked
 * employee pool (the employee column's reference); the client table
 * owns the employee/status filters (re-fetch through the BFF — the
 * API's own filter vocabulary). 403 renders the honest forbidden state.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { LoansTable } from "../../../../components/loans-table";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { EmployeeListRow, EmployeeLoanRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function PayrollLoansPage({
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

  const [loans, employees] = await Promise.all([
    fetchApi<readonly EmployeeLoanRow[]>("payroll/loans"),
    fetchApi<readonly EmployeeListRow[]>("payroll/employees"),
  ]);
  if ((!loans.ok && loans.status === 401) || (!employees.ok && employees.status === 401)) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!loans.ok) {
    const forbidden = loans.status === 403 || loans.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, loans.error, loans.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <LoansTable
        locale={localeValue}
        initialRows={loans.data}
        employees={employees.ok ? employees.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="payroll/loans" title={d.payLoansTitle}>
      {content}
    </AppShell>
  );
}
