/**
 * /{locale}/payroll/runs — the payroll runs register (PAGE_ARCHETYPES §2,
 * List+Search): server-fetches the runs register + the fiscal years + the
 * period pool (each year's periods in parallel — the period column's
 * reference); the client table owns the year/status filters (re-fetch
 * through the BFF — the API's own filter vocabulary). 403 renders the
 * honest forbidden state; period reference failures degrade to raw ids.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../../components/client-ui";

import { AppShell } from "../../../../components/app-shell";
import { PayrollRunsTable } from "../../../../components/payroll-runs-table";
import { RetryButton } from "../../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../../i18n/dictionaries";
import type { FiscalPeriodRow, FiscalYearRow, PayrollRunListRow } from "../../../../lib/api-types";
import { localizedApiError } from "../../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../../lib/server-api";

export default async function PayrollRunsPage({
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

  const [runs, years] = await Promise.all([
    fetchApi<readonly PayrollRunListRow[]>("payroll/runs"),
    fetchApi<readonly FiscalYearRow[]>("accounting/fiscal-years"),
  ]);
  if ((!runs.ok && runs.status === 401) || (!years.ok && years.status === 401)) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!runs.ok) {
    const forbidden = runs.status === 403 || runs.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, runs.error, runs.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    // The period pool: every year's periods in parallel (years are the
    // per-tenant fiscal calendar — a handful); failures degrade to an
    // empty pool and the table renders raw period ids.
    const yearList = years.ok ? years.data : [];
    const periodLists = await Promise.all(
      yearList.map((year) => fetchApi<readonly FiscalPeriodRow[]>(`accounting/fiscal-years/${year.id}/periods`)),
    );
    if (periodLists.some((entry) => !entry.ok && entry.status === 401)) {
      redirect(`/${locale}/login`);
    }
    const periods = periodLists.flatMap((entry) => (entry.ok ? entry.data : []));
    content = (
      <PayrollRunsTable
        locale={localeValue}
        initialRows={runs.data}
        years={yearList}
        periods={periods}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="payroll/runs" title={d.payRunsTitle}>
      {content}
    </AppShell>
  );
}
