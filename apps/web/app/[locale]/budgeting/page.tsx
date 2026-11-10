/**
 * /{locale}/budgeting — the budgets register (PAGE_ARCHETYPES §2,
 * List+Search): server-fetches the version register snapshot + the fiscal
 * year reference list; the client table owns the status/scope/year
 * filters and re-fetches through the BFF (the API's own filter
 * vocabulary), the free-text box filters the loaded page client-side (the
 * budgets list endpoint carries no search parameter — the honest
 * degrade). 403 renders the honest forbidden state; the year list 403
 * degrades to empty options.
 */
import { notFound, redirect } from "next/navigation";
import type { JSX } from "react";

import { ErrorState } from "../../../components/client-ui";

import { AppShell } from "../../../components/app-shell";
import { BudgetsTable } from "../../../components/budgets-table";
import { RetryButton } from "../../../components/retry-button";
import { getDictionary, isLocale, type Locale } from "../../../i18n/dictionaries";
import type { BudgetListRow, FiscalYearRow } from "../../../lib/api-types";
import { localizedApiError } from "../../../lib/messages";
import { fetchApi, requireSessionToken } from "../../../lib/server-api";

export default async function BudgetingPage({
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

  const [budgets, years] = await Promise.all([
    // The budgets list route carries no limit parameter — the register is
    // the per-tenant version set (bounded by the fiscal years × scopes).
    fetchApi<readonly BudgetListRow[]>("budgeting/budgets"),
    fetchApi<readonly FiscalYearRow[]>("accounting/fiscal-years"),
  ]);
  if (!budgets.ok && budgets.status === 401) {
    redirect(`/${locale}/login`);
  }

  let content: JSX.Element;
  if (!budgets.ok) {
    const forbidden = budgets.status === 403 || budgets.error.code === "FORBIDDEN";
    content = (
      <ErrorState
        title={
          forbidden
            ? d.errorsForbidden
            : localizedApiError(d, budgets.error, budgets.retryAfterSeconds)
        }
        retry={forbidden ? undefined : <RetryButton label={d.retryLabel} />}
      />
    );
  } else {
    content = (
      <BudgetsTable
        locale={localeValue}
        initialRows={budgets.data}
        years={years.ok ? years.data : []}
      />
    );
  }

  return (
    <AppShell locale={localeValue} pagePath="budgeting" title={d.budgetsTitle}>
      {content}
    </AppShell>
  );
}
