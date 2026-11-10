/**
 * /{locale}/payroll/loans/new — employee loan create (PAGE_ARCHETYPES
 * §3): employee + amount + installments + start period (year → REGULAR
 * period) + the treasury cash account; the initial year's period list
 * rides the server fetch, later year switches reload through the BFF
 * (the client form). The server creates AND disburses in one ambient
 * transaction (the disbursement JE posts immediately — INV-013).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../../components/client-ui";

import { AppShell } from "../../../../../components/app-shell";
import { LoanForm } from "../../../../../components/loan-form";
import { RetryButton } from "../../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../../i18n/dictionaries";
import type {
  CashAccountRow,
  EmployeeListRow,
  FiscalPeriodRow,
  FiscalYearRow,
  TenantProfile,
} from "../../../../../lib/api-types";
import { localizedApiError } from "../../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../../lib/server-api";

export default async function NewLoanPage({
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

  const [employees, years, cashAccounts, profile] = await Promise.all([
    fetchApi<readonly EmployeeListRow[]>("payroll/employees"),
    fetchApi<readonly FiscalYearRow[]>("accounting/fiscal-years"),
    fetchApi<readonly CashAccountRow[]>("treasury/cash-accounts"),
    fetchApi<TenantProfile>("tenancy/profile"),
  ]);
  if (
    (!employees.ok && employees.status === 401) ||
    (!years.ok && years.status === 401) ||
    (!cashAccounts.ok && cashAccounts.status === 401) ||
    (!profile.ok && profile.status === 401)
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
    // The initial year's periods ride the server fetch (year switches in
    // the client form reload through the BFF).
    const initialYear = years.ok ? years.data[0] : undefined;
    const periods =
      initialYear === undefined
        ? { ok: true as const, data: [] as readonly FiscalPeriodRow[] }
        : await fetchApi<readonly FiscalPeriodRow[]>(
            `accounting/fiscal-years/${initialYear.id}/periods`,
          );
    if (!periods.ok && periods.status === 401) {
      redirect(`/${locale}/login`);
    }
    content = (
      <LoanForm
        locale={localeValue}
        employees={employees.data}
        years={years.ok ? years.data : []}
        initialPeriods={periods.ok ? periods.data : []}
        cashAccounts={cashAccounts.ok ? cashAccounts.data : []}
        currency={profile.ok ? profile.data.baseCurrency : "SAR"}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="payroll/loans/new" title={d.payLoanNew}>
      {content}
    </AppShell>
  );
}
