/**
 * /{locale}/payroll/runs/[id] — the run workspace (PAGE_ARCHETYPES §4):
 * server-fetches the run + its frozen per-employee lines + the period
 * name (the period's own year fetch) + the masked employee pool (line
 * names) + the treasury cash accounts (the G-30 payout pays from a real
 * cash account) + the base currency. 404 → notFound; 401 → login;
 * reference 403s degrade to empty pools (the honest scope).
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../../components/client-ui";

import { AppShell } from "../../../../../components/app-shell";
import { RetryButton } from "../../../../../components/retry-button";
import { RunWorkspace } from "../../../../../components/run-workspace";
import { getDictionary, isLocale, type Locale } from "../../../../../i18n/dictionaries";
import type {
  CashAccountRow,
  EmployeeListRow,
  FiscalPeriodRow,
  PayrollRunListRow,
  PayrollRunLineRow,
  TenantProfile,
} from "../../../../../lib/api-types";
import { localizedApiError } from "../../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../../lib/server-api";

export default async function RunDetailPage({
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

  const detail = await fetchApi<{ run: PayrollRunListRow; lines: PayrollRunLineRow[] }>(
    `payroll/runs/${id}`,
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
      <AppShell locale={localeValue} pagePath={`payroll/runs/${id}`} title={d.payRunsTitle}>
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

  const [employees, cashAccounts, profile] = await Promise.all([
    fetchApi<readonly EmployeeListRow[]>("payroll/employees"),
    fetchApi<readonly CashAccountRow[]>("treasury/cash-accounts"),
    fetchApi<TenantProfile>("tenancy/profile"),
  ]);
  if (
    (!employees.ok && employees.status === 401) ||
    (!cashAccounts.ok && cashAccounts.status === 401) ||
    (!profile.ok && profile.status === 401)
  ) {
    redirect(`/${locale}/login`);
  }

  // The period name: the run's fiscal period resolves through its own
  // detail fetch (the periods list endpoint is per-year; the single-row
  // fetch is the honest one-shot).
  const period = await fetchApi<FiscalPeriodRow>(
    `accounting/periods/${detail.data.run.fiscalPeriodId}`,
  );

  return (
    <AppShell
      locale={localeValue}
      pagePath={`payroll/runs/${id}`}
      title={detail.data.run.runNo ?? d.payRunsTitle}
    >
      <RunWorkspace
        locale={localeValue}
        run={detail.data.run}
        lines={detail.data.lines}
        periodName={period.ok ? period.data.name : detail.data.run.fiscalPeriodId}
        employees={employees.ok ? employees.data : []}
        cashAccounts={cashAccounts.ok ? cashAccounts.data : []}
        currency={profile.ok ? profile.data.baseCurrency : "SAR"}
      />
    </AppShell>
  );
}
